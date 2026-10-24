#!/usr/bin/env bun
// Scripted Maki child for this repository's bridge runs: speaks the Maki SDK
// wire over stdio and executes the tool calls on the host, so the API-level
// harness (api-check.ts) can drive the permission round trip deterministically
// without a live model. This is the injectable-child seam the spec allows
// ("a scripted process that speaks the Maki SDK wire").
//
//   MAKI_CHILD_CMD=<this file> bun bridge/src/bridge.ts
//
// Behavior per prompt: commands containing `rm` go through a
// `can_use_tool` control request (answered by the bridge); every other
// command runs immediately. Tool results and the turn `result` follow.
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const cwd = process.env.OPENMAKI_CWD ?? process.cwd();
let toolSeq = 0;
const answers = new Map<string, (a: "allow" | "deny") => void>();
// Maki's AllowSession: an `allow` carrying `updatedPermissions` adds a session
// rule for the call's generalized scope (maki-agent permissions.rs v0.6.4
// apply_decision L685, generalize_bash_segment L1047–L1059: `<word> *`), and a
// later call inside a rule runs without asking
const sessionRules = new Set<string>();
const askedCommands = new Map<string, string>();
const generalize = (command: string) => {
  const word = command.trim().split(/\s+/)[0] ?? "";
  return /^[A-Za-z0-9_.:\/@+-]+$/.test(word) ? `${word} *` : command;
};
// the run in flight, so an inbound control_request/interrupt can cancel it the
// way the pinned child does (ack, then an error result for the cancelled run)
let current: { proc?: { kill(): void }; cancelled: boolean } | undefined;
// an interrupt that lands before its run starts is kept, as the pinned
// bounded(1) cancel channel keeps it for the run that picks it up
// (maki-agent headless.rs v0.6.4 L335, L366–L374)
let pendingCancel = false;

// opt-in trace so a test can prove which frames the bridge sent the child
// (e.g. that an agent selection sends no control frame); the child's own
// outbound can_use_tool asks are recorded with dir:"out"
const trace = process.env.FAKE_MAKI_TRACE;

const SESSION_ID = "fake-maki-session";
// the model a set_model switched to; assistant frames then name it, as the
// pinned child's do (AssistantMessage.model)
let switchedModel: string | undefined;
const out = (obj: unknown, after?: () => void) => {
  if (switchedModel && (obj as any).type === "assistant") (obj as any).message.model = switchedModel;
  // child -> bridge asks are traced too, so a test can pair the bridge's answer
  // with the request_id the child sent
  if (trace && (obj as any).type === "control_request") {
    appendFileSync(trace, JSON.stringify({ dir: "out", ...(obj as object) }) + "\n");
  }
  process.stdout.write(
    JSON.stringify({ ...(obj as object), session_id: SESSION_ID, uuid: crypto.randomUUID() }) + "\n",
    after,
  );
};

// knob so one bridge test can prove deltas reach the stream without changing
// any existing test's frames (the real child streams only with --include-partial-messages)
const streaming = process.env.FAKE_MAKI_STREAM === "1";

// knob so one bridge test can prove the child-exit abort path: die on the first
// prompt after one assistant frame, with no result
const crash = process.env.FAKE_MAKI_CRASH === "1";

/** the captured stream_event spelling (maki-stream-live.jsonl), before the buffered message */
function streamParts(parts: string[]): void {
  out({ type: "stream_event", event: { type: "message_start", message: { role: "assistant", content: [] } } });
  out({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } });
  for (const delta of parts) {
    out({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: delta } } });
  }
  out({ type: "stream_event", event: { type: "content_block_stop", index: 0 } });
  out({ type: "stream_event", event: { type: "message_stop" } });
}

function streamText(text: string): void {
  streamParts([text.slice(0, 3), text.slice(3)]);
}

// FAKE_MAKI_SCRIPT=<json> replays one journey script's model turns as Maki
// wire frames (design decision 3), so the Maki side consumes the same turns
// as the reference run's mock provider.
type ScriptTurn = {
  text?: string;
  stream?: string[];
  delayMs?: number;
  tool?: { command: string; needsPermission?: boolean };
  call?: { maki: { name: string; input: Record<string, unknown>; result: string; isError?: boolean }; needsPermission?: boolean };
  fail?: { status: number; message: string };
};
const script: ScriptTurn[] = process.env.FAKE_MAKI_SCRIPT ? JSON.parse(process.env.FAKE_MAKI_SCRIPT) : [];
// Turns are consumed in order across prompts, like the reference provider's
// one-turn-per-request: a text turn ends its run, a tool turn continues it.
// The bridge spawns one child per session, so an optional state file carries
// the consumed count across child processes.
const scriptState = process.env.FAKE_MAKI_SCRIPT_STATE;
let scriptNext =
  scriptState && existsSync(scriptState)
    ? readFileSync(scriptState, "utf8").split("\n").filter(Boolean).length
    : 0;
function nextTurn() {
  const index = scriptNext++;
  if (scriptState) appendFileSync(scriptState, `${index}\n`);
  return script[index];
}

// FAKE_MAKI_TOOLS (comma-separated) replaces the advertised tool list, so a
// test can stand in for MCP tools (`<server>__<tool>`) or `tool_search`
const tools = process.env.FAKE_MAKI_TOOLS?.split(",").filter(Boolean) ?? ["Bash"];
out({ type: "system", subtype: "init", session_id: "fake-maki-session", cwd, model: "synthetic/fake", tools });

function toolFrames(toolUseID: string, command: string, isError: boolean, content: string): void {
  out({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "tool_use", id: toolUseID, name: "Bash", input: { command } }] },
  });
  out({
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolUseID, content, is_error: isError }] },
  });
}

// The pinned order for a model tool call: the turn's buffered assistant
// message (TurnComplete, run.rs v0.6.4 L605) before dispatch, then the
// streamed tool_use block (ToolStart, sdk_mode.rs v0.6.4 L1037–L1052), and
// only then the permission ask (L1115–L1149)
// one scripted model call's usage, as the journey's mock provider reports it
const CALL_USAGE = { input_tokens: 1, output_tokens: 1 };
let runCalls = 0;

// Maki's wire names its tools Claude-style (sdk_mode.rs v0.6.4 L43–L60)
const CLAUDE_NAME: Record<string, string> = {
  bash: "Bash", read: "Read", edit: "Edit", write: "Write", grep: "Grep", glob: "Glob", todo_write: "TodoWrite",
  webfetch: "WebFetch", websearch: "WebSearch", task: "Task", multiedit: "MultiEdit", code_execution: "CodeExecution",
  index: "Index", memory: "Memory", question: "Question", skill: "Skill",
};

function toolCall(toolUseID: string, command: string, name = "Bash", input: Record<string, unknown> = { command }): void {
  runCalls++;
  out({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "tool_use", id: toolUseID, name, input }], usage: CALL_USAGE },
  });
  out({ type: "stream_event", event: { type: "message_start", message: { role: "assistant", content: [] } } });
  out({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: toolUseID, name, input: {} } } });
  out({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } } });
  out({ type: "stream_event", event: { type: "content_block_stop", index: 0 } });
}

// A paced stream checks for an interrupt between chunks; a cancelled stream
// ends with no buffered message (TurnComplete never fires), only the error
// result (run.rs v0.6.4 L560–L571, sdk_mode.rs L1162–L1178)
async function pacedParts(parts: string[], delayMs: number, run: { cancelled: boolean }): Promise<boolean> {
  out({ type: "stream_event", event: { type: "message_start", message: { role: "assistant", content: [] } } });
  out({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } });
  for (const [i, delta] of parts.entries()) {
    if (i > 0) await Bun.sleep(delayMs);
    if (run.cancelled) return false;
    out({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: delta } } });
  }
  await Bun.sleep(delayMs);
  if (run.cancelled) return false;
  out({ type: "stream_event", event: { type: "content_block_stop", index: 0 } });
  out({ type: "stream_event", event: { type: "message_stop" } });
  return true;
}

function toolResult(toolUseID: string, isError: boolean, content: string): void {
  out({
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolUseID, content, is_error: isError }] },
  });
}

// the pinned bash plugin's result text (plugins/bash/init.lua v0.6.4
// L407–L421): a silent success says `Exit code: 0`, a failure appends its code
function bashResult(code: number, output: string): string {
  if (code === 0) return output === "" ? "Exit code: 0" : output;
  return output === "" ? `Exit code: ${code}` : `${output}\nExit code: ${code}`;
}

const success = () =>
  out({ type: "result", subtype: "success", result: "ok", usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 });

// a cancelled run ends with the pinned error subtype (sdk_mode.rs v0.6.4
// L1168–L1172, L996–L1000)
const cancelledResult = () =>
  out({ type: "result", subtype: "error_during_execution", is_error: true, result: "", usage: { input_tokens: 1, output_tokens: 0 }, total_cost_usd: 0 });

function replyTool(toolUseID: string, command: string, isError: boolean, content: string): void {
  toolFrames(toolUseID, command, isError, content);
  success();
}

async function runCommand(command: string): Promise<void> {
  const run: { proc?: { kill(): void }; cancelled: boolean } = { cancelled: false };
  current = run;
  try {
    await runTool(command, run);
  } finally {
    if (current === run) current = undefined;
  }
}

// Play the journey's turns in order: text turns become stream deltas plus the
// buffered assistant message, and a tool turn asks for permission when the
// turn says so, runs the command, then moves to the next turn.
// the pinned result carries the run's ledger total (run.rs v0.6.4 L868–L882)
const runResult = () => {
  const n = runCalls;
  runCalls = 0;
  out({ type: "result", subtype: "success", result: "ok", usage: { input_tokens: n, output_tokens: n }, total_cost_usd: 0 });
};

async function runScript(): Promise<void> {
  const run: { proc?: { kill(): void }; cancelled: boolean } = { cancelled: false };
  current = run;
  try {
    await playScript(run);
  } finally {
    if (current === run) current = undefined;
  }
}

async function playScript(run: { cancelled: boolean }): Promise<void> {
  // A short beat so the TUI has registered the prompt and its session before
  // the scripted frames arrive; a real model never answers in the same tick.
  await Bun.sleep(300);
  let attempt = 0;
  for (;;) {
    if (run.cancelled) {
      runCalls = 0;
      cancelledResult();
      return;
    }
    const turn = nextTurn();
    if (!turn) {
      streamParts(["No more scripted turns."]);
      runCalls++;
      out({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "No more scripted turns." }], usage: CALL_USAGE } });
      runResult();
      return;
    }
    if (turn.fail) {
      // the provider error as the pinned agent formats it (maki-providers
      // error.rs v0.6.4 L106); 429 and 5xx are retried with an api_retry
      // notice (error.rs L2, sdk_mode.rs L1076–L1089), anything else ends the run
      const message = `API error (${turn.fail.status}): ${turn.fail.message}`;
      if (turn.fail.status === 429 || turn.fail.status >= 500) {
        out({ type: "system", subtype: "api_retry", attempt: ++attempt, retry_delay_ms: 1000, error: message });
        await Bun.sleep(1000);
        continue;
      }
      runCalls = 0;
      out({ type: "result", subtype: "error_during_execution", is_error: true, result: message, usage: { input_tokens: 0, output_tokens: 0 }, total_cost_usd: 0 });
      return;
    }
    if (turn.call) {
      const toolUseID = `toolu_fake${String(++toolSeq).padStart(6, "0")}`;
      const name = CLAUDE_NAME[turn.call.maki.name] ?? turn.call.maki.name;
      toolCall(toolUseID, "", name, turn.call.maki.input);
      let answer: "allow" | "deny" = "allow";
      if (turn.call.needsPermission) {
        const requestID = `req_fake${String(toolSeq).padStart(10, "0")}`;
        out({ type: "control_request", request_id: requestID, request: { subtype: "can_use_tool", tool_name: name, tool_use_id: toolUseID, input: turn.call.maki.input } });
        answer = await new Promise((resolve) => answers.set(requestID, resolve));
      }
      if (answer === "deny") toolResult(toolUseID, true, "Permission denied: rejected by the user");
      else toolResult(toolUseID, turn.call.maki.isError === true, turn.call.maki.result);
      continue;
    }
    if (!turn.tool) {
      const text = turn.text ?? "";
      if (turn.delayMs) {
        if (!(await pacedParts(turn.stream ?? [text], turn.delayMs, run))) {
          runCalls = 0;
          cancelledResult();
          return;
        }
      } else streamParts(turn.stream ?? [text]);
      runCalls++;
      out({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }], usage: CALL_USAGE } });
      runResult();
      return;
    }
    const toolUseID = `toolu_fake${String(++toolSeq).padStart(6, "0")}`;
    toolCall(toolUseID, turn.tool.command);
    let answer: "allow" | "deny" = "allow";
    if (turn.tool.needsPermission) {
      const requestID = `req_fake${String(toolSeq).padStart(10, "0")}`;
      out({
        type: "control_request",
        request_id: requestID,
        request: { subtype: "can_use_tool", tool_name: "Bash", tool_use_id: toolUseID, input: { command: turn.tool.command } },
      });
      askedCommands.set(requestID, turn.tool.command);
      answer = await new Promise((resolve) => answers.set(requestID, resolve));
    }
    if (answer === "deny") {
      toolResult(toolUseID, true, "Permission denied: rejected by the user");
      continue;
    }
    const proc = Bun.spawn(["/bin/sh", "-c", turn.tool.command], { stdout: "pipe", stderr: "pipe" });
    const code = await proc.exited;
    const output = (await new Response(proc.stdout).text()).trim();
    toolResult(toolUseID, code !== 0, bashResult(code, output));
  }
}

async function runTool(command: string, run: { proc?: { kill(): void }; cancelled: boolean }): Promise<void> {
  const toolUseID = `toolu_fake${String(++toolSeq).padStart(6, "0")}`;
  let answer: "allow" | "deny" = "allow";
  if (/\brm\b/.test(command) && !sessionRules.has(generalize(command))) {
    const requestID = `req_fake${String(toolSeq).padStart(10, "0")}`;
    out({
      type: "control_request",
      request_id: requestID,
      request: { subtype: "can_use_tool", tool_name: "Bash", tool_use_id: toolUseID, input: { command } },
    });
    askedCommands.set(requestID, command);
    answer = await new Promise((resolve) => answers.set(requestID, resolve));
  }
  if (answer === "deny") {
    toolFrames(toolUseID, command, true, "Permission denied: rejected by the user");
    // the denial goes back to the model before the run ends, so an interrupt
    // written right after a deny still lands on this run
    await Bun.sleep(100);
    if (run.cancelled) cancelledResult();
    else success();
    return;
  }
  const proc = Bun.spawn(["/bin/sh", "-c", command], { stdout: "pipe", stderr: "pipe" });
  run.proc = proc;
  const code = await proc.exited;
  if (run.cancelled) cancelledResult();
  else if (code === 0) replyTool(toolUseID, command, false, "ok");
  else replyTool(toolUseID, command, true, `Exit code: ${code}`);
}

let runs: Promise<void> = Promise.resolve();
let buf = "";
for await (const chunk of Bun.stdin.stream()) {
  buf += new TextDecoder().decode(chunk, { stream: true });
  let i: number;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let frame: any;
    try { frame = JSON.parse(line); } catch { continue; }
    if (trace) appendFileSync(trace, JSON.stringify(frame) + "\n");
    if (frame.type === "control_response") {
      const requestID = String(frame.response?.request_id ?? "");
      const command = askedCommands.get(requestID);
      if (command !== undefined && frame.response?.behavior === "allow" && frame.response?.updatedPermissions !== undefined) {
        sessionRules.add(generalize(command));
      }
      answers.get(requestID)?.(frame.response?.behavior === "deny" ? "deny" : "allow");
      continue;
    }
    if (frame.type === "control_request" && frame.request?.subtype === "set_model") {
      // the pinned resolution: a string spec is resolved and policy-checked,
      // anything refused acks an error (sdk_mode.rs v0.6.4 L861–L874); here a
      // bare id or a provider this child knows resolves, any other provider
      // (the TUI's synthesized "sample", "invalid") is refused
      const model = frame.request.model;
      const provider = typeof model === "string" && model.includes("/") ? model.slice(0, model.indexOf("/")) : "";
      if (typeof model === "string" && model && (provider === "" || provider === "synthetic" || provider === "maki-test")) {
        switchedModel = model;
        out({ type: "control_response", response: { subtype: "success", request_id: frame.request_id, response: {} } });
      } else {
        out({ type: "control_response", response: { subtype: "error", request_id: frame.request_id, error: "invalid or disallowed model" } });
      }
      continue;
    }
    if (frame.type === "control_request" && frame.request?.subtype === "interrupt") {
      out({ type: "control_response", response: { subtype: "success", request_id: frame.request_id, response: {} } });
      if (current) {
        current.cancelled = true;
        current.proc?.kill();
      } else {
        pendingCancel = true;
      }
      continue;
    }
    if (frame.type === "user" && Array.isArray(frame.message?.content)) {
      // the pinned headless session runs one stdin prompt at a time, each to
      // its own result (maki-agent headless.rs v0.6.4 L365)
      const prompt = frame;
      runs = runs.then(() => answerPrompt(prompt));
    }
  }
}

async function answerPrompt(frame: any): Promise<void> {
  if (pendingCancel) {
    pendingCancel = false;
    cancelledResult();
    return;
  }
  if (script.length) {
    await runScript();
    return;
  }
  const text = frame.message.content.find((p: any) => p?.type === "text")?.text ?? "";
  if (crash) {
    // exit inside the write callback so the frame is flushed before the
    // process goes away (process.exit does not drain buffered stdout)
    out({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "PONG" }] } }, () => process.exit(1));
    return;
  }
  const exact = /run exactly: (.+?) \./.exec(text);
  if (!exact && !/\b(false|rm)\b/.test(text)) {
    // plain prompt: an assistant text turn, no tool call
    if (streaming) streamText("PONG");
    out({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "PONG" }] },
    });
    out({ type: "result", subtype: "success", result: "ok", usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 });
    return;
  }
  await runCommand(exact ? exact[1] : text).catch((err) => {
    console.error(`[fake-maki] ${err}`);
    process.exit(1);
  });
}
