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
const cwd = process.env.OPENMAKI_CWD ?? process.cwd();
let toolSeq = 0;
const answers = new Map<string, (a: "allow" | "deny") => void>();

const SESSION_ID = "fake-maki-session";
const out = (obj: unknown) =>
  process.stdout.write(
    JSON.stringify({ ...(obj as object), session_id: SESSION_ID, uuid: crypto.randomUUID() }) + "\n",
  );

// knob so one bridge test can prove deltas reach the stream without changing
// any existing test's frames (the real child streams only with --include-partial-messages)
const streaming = process.env.FAKE_MAKI_STREAM === "1";

/** the captured stream_event spelling (maki-stream-live.jsonl), before the buffered message */
function streamText(text: string): void {
  out({ type: "stream_event", event: { type: "message_start", message: { role: "assistant", content: [] } } });
  out({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } });
  for (const delta of [text.slice(0, 3), text.slice(3)]) {
    out({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: delta } } });
  }
  out({ type: "stream_event", event: { type: "content_block_stop", index: 0 } });
  out({ type: "stream_event", event: { type: "message_stop" } });
}

out({ type: "system", subtype: "init", session_id: "fake-maki-session", cwd, model: "synthetic/fake", tools: ["Bash"] });

function replyTool(toolUseID: string, command: string, isError: boolean, content: string): void {
  out({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "tool_use", id: toolUseID, name: "Bash", input: { command } }] },
  });
  out({
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolUseID, content, is_error: isError }] },
  });
  out({ type: "result", subtype: "success", result: "ok", usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 });
}

async function runCommand(command: string): Promise<void> {
  const toolUseID = `toolu_fake${String(++toolSeq).padStart(6, "0")}`;
  let answer: "allow" | "deny" = "allow";
  if (/\brm\b/.test(command)) {
    const requestID = `req_fake${String(toolSeq).padStart(10, "0")}`;
    out({
      type: "control_request",
      request_id: requestID,
      request: { subtype: "can_use_tool", tool_name: "Bash", tool_use_id: toolUseID, input: { command } },
    });
    answer = await new Promise((resolve) => answers.set(requestID, resolve));
  }
  if (answer === "deny") {
    replyTool(toolUseID, command, true, "Permission denied: rejected by the user");
    return;
  }
  const proc = Bun.spawn(["/bin/sh", "-c", command], { stdout: "pipe", stderr: "pipe" });
  const code = await proc.exited;
  if (code === 0) replyTool(toolUseID, command, false, "ok");
  else replyTool(toolUseID, command, true, `Exit code: ${code}`);
}

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
    if (frame.type === "control_response") {
      answers.get(String(frame.response?.request_id ?? ""))?.(frame.response?.behavior === "deny" ? "deny" : "allow");
      continue;
    }
    if (frame.type === "user" && Array.isArray(frame.message?.content)) {
      const text = frame.message.content.find((p: any) => p?.type === "text")?.text ?? "";
      const exact = /run exactly: (.+?) \./.exec(text);
      if (!exact && !/\b(false|rm)\b/.test(text)) {
        // plain prompt: an assistant text turn, no tool call
        if (streaming) streamText("PONG");
        out({
          type: "assistant",
          message: { role: "assistant", content: [{ type: "text", text: "PONG" }] },
        });
        out({ type: "result", subtype: "success", result: "ok", usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 });
        continue;
      }
      void runCommand(exact ? exact[1] : text).catch((err) => {
        console.error(`[fake-maki] ${err}`);
        process.exit(1);
      });
    }
  }
}
