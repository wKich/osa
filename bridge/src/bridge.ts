// The OpenCode TUI bridge: serves the OpenCode 2.0.32 HTTP+SSE surface the TUI
// actually exercises (evidence/tui-route-inventory.md) over one live Maki SDK
// process per session, translating the Maki wire into OpenCode event frames.
//
//   bun src/bridge.ts
//   PORT=4600                  listen port (default 4600)
//   OPENMAKI_CWD=<dir>         sandbox workdir: the session/canonical directory
//                              (default: process cwd)
//   MAKI_MODEL=<provider/id>   model spec for the maki child (default: maki's)
//   MAKI_CHILD_CMD=<path>      override the maki child executable (scripted
//                              process seam; SDK flags still appended)
//   OPENSHELL_BIN=<path>       openshell CLI for the sandbox transport
//   OPENMAKI_SANDBOX=<name>    project sandbox (required unless MAKI_CHILD_CMD)
//   BRIDGE_LOG=<file.jsonl>    request/response log (optional, redacted)
//   BRIDGE_SSE_LOG=<file>      emitted SSE frames (optional, redacted)
//   SSE_HEARTBEAT_MS=<ms>      idle-keepalive comment interval (default 15000)
//
// The helper sets these (bin/maki-oss OpenCode mode) and attaches the TUI with
// `opencode --server http://127.0.0.1:$PORT`.
import { appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { posix } from "node:path";
import { MakiSession, type ContentBlock } from "./maki.ts";
import { readAttachment, readSkillAttachment } from "./mentions.ts";
import { sessionStats } from "./session-stats.ts";
import { ProjectWorktrees } from "./worktrees.ts";
import { fileDiff as editFileDiff, undoEdit } from "./edit-diff.ts";
import { Translator, userPayload } from "./translator.ts";
import { mintEvent, mintMessage, mintPermission, mintSession } from "./ids.ts";
import { synthesize, type AnyObj } from "./spec-answers.ts";
import { makiTitle } from "./title.ts";
import { runUserShell, shellNotice } from "./user-shell.ts";
import { reviewBase, reviewDiff, reviewStatus, VcsError, type Mode } from "./vcs.ts";
import { find as findFiles, LIST_FILES } from "./fs-find.ts";
import { SandboxTerminals, type SocketData } from "./terminals.ts";
import { exportSession, SessionHistory } from "./history.ts";
import { readGitState, readMcpConfig, readModelCatalog, readSkills, sandboxRun } from "./sandbox.ts";

const PORT = Number(process.env.PORT ?? 4600);
const CANONICAL = process.env.OPENMAKI_CWD ?? process.cwd();
const MAKI_MODEL = process.env.MAKI_MODEL;
const LOG = process.env.BRIDGE_LOG;
const SSE_LOG = process.env.BRIDGE_SSE_LOG;

// ---------- session registry ----------
interface PendingAsk {
  requestID: string; // maki's control_request id
  toolName: string;
  ask: PermissionAsk;
  toolUseID: string;
  messageID: string; // the turn's assistant message id
  message: string;
  maki?: MakiSession; // the child that asked, when not the session's own (a subagent's)
}

interface BridgeSession {
  id: string;
  directory: string;
  agent: string;
  model: { providerID: string; id: string };
  maki: MakiSession;
  translator: Translator;
  makiSessionID?: string; // maki's own session_id, mapped on first system.init
  baseMode?: string; // the permission mode the child started in (system.init), which `build` restores
  childModel?: string; // the model spec the child runs: its `-m`, or the last acked set_model
  tools?: string[]; // the tool names the child advertised on system.init
  pending: Map<string, PendingAsk>; // per_ id -> unanswered permission ask
  controls: Map<string, (ack: AnyObj) => void>; // bridge control request_id -> ack handler
  created: number;
  updated: number;
  cost?: number;
  tokens?: AnyObj;
  firstPrompt?: string; // the first non-empty prompt text, Maki's title source
  idle?: number; // the last terminal execution transition (Session.Info time.idle)
  viewed?: number; // the idle watermark a viewer acknowledged
  outcome?: "succeeded" | "failed" | "interrupted";
  title?: string; // set when the first run ends, as Maki records it, or by a rename
  metadata?: AnyObj; // host annotations the TUI sets (Session.Info metadata)
  fork?: { sessionID: string; boundary: { type: "through"; messageID: string } }; // the parent it was forked from
  parentID?: string; // the session whose subagent this session is
  history: SessionHistory; // the projected transcript a reopened TUI reads
}

const sessions = new Map<string, BridgeSession>();

// the sandbox terminals (persistent PTYs) the TUI's terminal pane opens
const terminals = new SandboxTerminals(
  { openshell: process.env.OPENSHELL_BIN ?? "openshell", sandbox: process.env.OPENMAKI_SANDBOX },
  (type, data) => emit(type, data),
);

// ---------- SSE fan-out (design decision 4: bare `data:` frames) ----------
// Idle keepalive: the client aborts an event stream it has heard nothing
// from for 45s ("Event stream stalled", opencode 2.0.32) and re-boots on the
// reconnect, so each stream sends the real server's `: heartbeat` comment well
// inside that window (evidence: mapping-table.md §0, defect
// tui-sse-idle-reconnect-drops-next-turn)
const HEARTBEAT_MS = Number(process.env.SSE_HEARTBEAT_MS) || 15_000;
const HEARTBEAT = ": heartbeat\n\n";
const subscribers = new Set<ReadableStreamDefaultController<Uint8Array>>();
const seenFrames: { id: string; event: string; data: AnyObj }[] = [];
let durableSeq = 0;

function pushFrame(frame: { id: string; event: string; data: AnyObj }): void {
  if (SSE_LOG) appendFileSync(SSE_LOG, JSON.stringify({ ts: new Date().toISOString(), ...frame }) + "\n");
  const bytes = new TextEncoder().encode(`data: ${JSON.stringify(frame.data)}\n\n`);
  for (const c of subscribers) {
    try { c.enqueue(bytes); } catch { subscribers.delete(c); }
  }
}

function emit(type: string, data: AnyObj, durableVersion?: number, eventID?: string, directory?: string): void {
  const ev: AnyObj = { id: eventID ?? mintEvent(), created: Date.now(), type };
  const dir = typeof data.sessionID === "string" ? sessions.get(data.sessionID)?.directory : directory;
  if (dir) ev.location = { directory: dir };
  ev.data = data;
  if (durableVersion && typeof data.sessionID === "string") {
    ev.durable = { aggregateID: data.sessionID, seq: durableSeq++, version: durableVersion };
  }
  projectIdle(type, data, ev.created);
  if (typeof data.sessionID === "string") sessions.get(data.sessionID)?.history.apply(type, data, ev.created, ev.id);
  const frame = { id: ev.id, event: type, data: ev };
  seenFrames.push(frame);
  pushFrame(frame);
  if (OUTCOME[type]) void checkSkills();
}

// A terminal execution transition is the session's idle marker, as the real
// projector records it (core session/projector.ts v2.0.32 L412–L440): strictly
// advancing, so the TUI's unread check (idle > viewed) sees every new one; a
// shutdown interrupt is not an idle transition. It is set before the frame goes
// out, since the TUI re-reads the session when it sees the frame.
const OUTCOME: Record<string, BridgeSession["outcome"]> = {
  "session.execution.succeeded": "succeeded",
  "session.execution.failed": "failed",
  "session.execution.interrupted": "interrupted",
};

function projectIdle(type: string, data: AnyObj, created: number): void {
  const outcome = OUTCOME[type];
  const s = outcome && typeof data.sessionID === "string" ? sessions.get(data.sessionID) : undefined;
  if (!s || (outcome === "interrupted" && data.reason === "shutdown")) return;
  s.idle = Math.max(created, s.idle === undefined ? created : s.idle + 1);
  s.outcome = outcome;
}

function openEventStream(): Response {
  // the client refuses a stream that does not start with server.connected
  // (binary: "Event stream did not start with server.connected")
  const connected = { id: mintEvent(), type: "server.connected", data: {} };
  if (SSE_LOG) {
    appendFileSync(SSE_LOG, JSON.stringify({ ts: new Date().toISOString(), id: connected.id, event: "server.connected", data: connected }) + "\n");
  }
  const enc = new TextEncoder();
  const beat = enc.encode(HEARTBEAT);
  let ctrl: ReadableStreamDefaultController<Uint8Array> | undefined;
  let hb: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c;
      subscribers.add(c);
      // flush headers immediately: without an early byte the client treats the
      // stream as dead and reconnects
      c.enqueue(enc.encode(`data: ${JSON.stringify(connected)}\n\n`));
      const replay = seenFrames.map((f) => `data: ${JSON.stringify(f.data)}\n\n`).join("");
      if (replay) c.enqueue(enc.encode(replay));
      hb = setInterval(() => {
        try { c.enqueue(beat); } catch { clearInterval(hb!); subscribers.delete(c); }
      }, HEARTBEAT_MS);
    },
    cancel() { if (hb) clearInterval(hb); if (ctrl) subscribers.delete(ctrl); },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
}

// ---------- synthesized answers shared with the stateful routes ----------
// defaults for agent/model/project come from the same spec answers the TUI
// reads, so what the composer selects always matches what events report
const asUrl = (p: string) => new URL(`http://bridge.local${p}`);

function defaultAgent(): string {
  const { payload } = synthesize("GET", "/api/agent", asUrl("/api/agent"), null, CANONICAL);
  return String(payload?.data?.[0]?.id ?? "primary");
}

function defaultModel(): { providerID: string; id: string } {
  const { payload } = synthesize("GET", "/api/model", asUrl("/api/model"), null, CANONICAL);
  const first = payload?.data?.[0];
  return { providerID: String(first?.providerID ?? "sample"), id: String(first?.id ?? first?.modelID ?? "sample") };
}

// The project is the sandbox checkout. OpenCode names a repository's project
// after its first root commit and anything else "global"; the id is read once
// from the sandbox at boot, and every answer that names a project (sessions,
// location, project list) waits for it so they never disagree.
const BOOTED = Date.now();
let projectID = "global";
let projectVcs: string | undefined;
// every id this project has been reported under: a client that read the id
// before the checkout gained its first commit still names the old one
const reportedProjectIDs = new Set<string>(["global"]);
const applyGit = (git: { root?: string }) => {
  projectID = git.root ?? "global";
  reportedProjectIDs.add(projectID);
  projectVcs = git.root ? "git" : undefined;
};
const projectReady = readGitState(CANONICAL).then(applyGit);

// a checkout can become a repository mid-run (the agent runs `git init`); the
// real server resolves the project when a client opens the location, so the
// project and location reads look again
async function refreshProject(): Promise<void> {
  await projectReady;
  applyGit(await readGitState(CANONICAL));
}

// Session.Info is synthesized once and patched per session: patching keeps the
// required field set intact while replacing every value with real state
function sessionTemplate(): AnyObj {
  const { payload } = synthesize("GET", "/api/session/ses_template", asUrl("/api/session/ses_template"), null, CANONICAL);
  return payload?.data ?? {};
}

const SESSION_TEMPLATE = sessionTemplate();

function sessionObject(s: BridgeSession): AnyObj {
  return {
    ...SESSION_TEMPLATE,
    id: s.id,
    projectID,
    agent: s.agent,
    model: s.translator.announcedModel ?? s.model,
    cost: s.cost ?? 0,
    tokens: s.tokens ?? { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: {
      created: s.created,
      updated: s.updated,
      ...(s.idle !== undefined ? { idle: s.idle } : {}),
      ...(s.viewed !== undefined ? { viewed: s.viewed } : {}),
    },
    ...(s.outcome ? { outcome: s.outcome } : {}),
    location: { directory: s.directory },
    ...(s.title ? { title: s.title } : {}),
    ...(s.metadata ? { metadata: s.metadata } : {}),
    ...(s.fork ? { fork: s.fork } : {}),
    ...(s.parentID ? { parentID: s.parentID } : {}),
  };
}

// A subagent (Maki's Task tool) runs inside the parent's Maki child; OpenCode
// runs one as a child session (core tool/plugin/subagent.ts v2.0.32
// L184–L215), so the bridge opens a child session for it — titled with the
// task's description, under Maki's subagent type (plugins/task/init.lua
// v0.6.4, default `research`) — whose transcript is the subagent's prompt and
// the frames flagged with the task call's id, ended by the task's result.
const subagentChild = (): MakiSession =>
  ({ running: false, prompt() {}, answer() {}, interrupt: () => "", setModel: () => "", kill() {} }) as unknown as MakiSession;

function subagentHooks(parent: () => BridgeSession) {
  const children = new Map<string, BridgeSession>();
  return {
    start(toolUseID: string, input: AnyObj): string | undefined {
      const p = parent();
      const agent = typeof input.subagent_type === "string" && input.subagent_type ? input.subagent_type : "research";
      const opened = openSession(mintSession(), { agent, model: p.translator.announcedModel ?? p.model, parentID: p.id });
      if ("error" in opened) return undefined;
      const c = opened.session;
      if (typeof input.description === "string" && input.description) c.title = input.description;
      children.set(toolUseID, c);
      emit("session.created", {
        sessionID: c.id, projectID, location: { directory: c.directory }, parentID: p.id,
        slug: c.id.replace(/^ses_/, ""), ...(c.title ? { title: c.title } : {}), agent: c.agent, model: c.model, version: "2.0.32",
      }, 1);
      // the subagent's prompt is the task's, as Maki sends it (task/init.lua L211–L214)
      const prompt = typeof input.prompt === "string" ? input.prompt : "";
      c.firstPrompt = prompt || undefined;
      c.translator.beginTurn(mintMessage(), { text: prompt, id: mintMessage(), delivery: "steer" });
      return c.id;
    },
    frame(toolUseID: string, frame: AnyObj): boolean {
      const c = children.get(toolUseID);
      if (!c) return false;
      c.translator.onFrame({ ...frame, parent_tool_use_id: undefined });
      return true;
    },
    end(toolUseID: string, isError: boolean, text: string): void {
      const c = children.get(toolUseID);
      if (!c) return;
      c.translator.onFrame({ type: "result", subtype: isError ? "error_during_execution" : "success", is_error: isError, result: text });
    },
  };
}

function pendingList(s: BridgeSession): AnyObj[] {
  return [...s.pending.entries()].map(([perID, p]) => ({
    id: perID, sessionID: s.id, ...p.ask, message: p.message, source: { type: "tool", messageID: p.messageID, id: p.toolUseID },
  }));
}

// The TUI picks the dialog body from the action in its own tool vocabulary
// (tui util/tool-display.ts v2.0.32 L1–L6, util/permission.ts L24–L144); maki
// names tools Claude-style on the wire (sdk_mode.rs v0.6.4 L43–L60)
interface PermissionAsk { action: string; resources: string[]; save: string[] }
const PERMISSION_ACTION: Record<string, string> = { Bash: "shell", Task: "subagent" };

// Maki's AllowSession scope for one shell segment (permissions.rs v0.6.4
// L44–L47, L1047–L1059): `<word> *` when the first word names one program
const SHELL_KEYWORDS = new Set(["if", "then", "elif", "else", "fi", "for", "while", "until", "do", "done", "case", "esac", "select", "function", "time"]);
function shellScope(command: string): string {
  const word = command.trim().split(/\s+/)[0] ?? "";
  return word && /^[A-Za-z0-9_.:\/@+-]+$/.test(word) && !SHELL_KEYWORDS.has(word) ? `${word} *` : command;
}

function permissionAsk(toolName: string, input: unknown): PermissionAsk {
  const action = PERMISSION_ACTION[toolName] ?? toolName.toLowerCase();
  const command = (input as AnyObj | null)?.command;
  if (action === "shell" && typeof command === "string" && command) {
    return { action, resources: [command], save: [shellScope(command)] };
  }
  return { action, resources: [toolName], save: [toolName] };
}

function sessionNotFound(sid: string): { status: number; payload: AnyObj } {
  return { status: 404, payload: { _tag: "SessionNotFoundError", sessionID: sid, message: `Session not found: ${sid}` } };
}

// ---------- stateful routes ----------
function createSession(body: AnyObj): { status: number; payload: any } {
  const id = typeof body?.id === "string" && /^ses/.test(body.id) ? body.id : mintSession();
  const existing = sessions.get(id);
  if (existing) return { status: 200, payload: { data: sessionObject(existing) } };
  const { status, payload } = synthesize("POST", "/api/session", asUrl("/api/session"), body, CANONICAL);
  // a session opens in the workdir, or in one of the project's worktrees the
  // TUI names (a worktree is its own checkout, unlike a host directory)
  const asked = typeof body?.location?.directory === "string" ? posix.normalize(body.location.directory) : undefined;
  const opened = openSession(id, {
    directory: asked && asked !== CANONICAL && worktrees.contains(asked) ? asked : undefined,
    agent: typeof body?.agent === "string" ? body.agent : defaultAgent(),
    model: (body?.model && typeof body.model === "object" && body.model.providerID && body.model.id)
      ? { providerID: String(body.model.providerID), id: String(body.model.id) }
      : defaultModel(),
  });
  if ("error" in opened) return opened.error;
  const s = opened.session;
  // a session created as the plan agent runs its first turn in plan mode
  if (s.agent === "plan") s.maki.setPermissionMode("plan");
  if (payload?.data) {
    payload.data = { ...payload.data, id, projectID, agent: s.agent, time: { ...payload.data.time, created: s.created, updated: s.updated }, location: { directory: s.directory } };
  }
  return { status, payload };
}

/** one bridge session and its Maki child; `fork` continues a stored Maki
 * session under a new id */
function openSession(
  id: string,
  opts: { agent: string; model: { providerID: string; id: string }; fork?: string; parentID?: string; directory?: string },
): { session: BridgeSession } | { error: { status: number; payload: any } } {
  // The TUI's requested directory is its own host cwd (design decision 5):
  // the sandbox workdir is canonical, so a session runs there — or in one of
  // the project's worktrees, which live in the sandbox too — and no host path
  // can enter the sandbox through `sandbox exec --workdir`.
  const directory = opts.directory ?? CANONICAL;

  let s: BridgeSession;
  const translator = new Translator({
    sink: { emit },
    sessionID: id,
    agent: () => s.agent,
    model: () => s.model,
    onInit: (info) => {
      s.makiSessionID = info.sessionID;
      s.tools = info.tools;
      // the child's tool list settles each configured MCP server's status
      // (an MCP tool is `<server>__<tool>`); the TUI read /api/mcp at boot and
      // refetches on mcp.status.changed (client solid/data.ts v2.0.32 L1332–L1335)
      void readMcpConfig(CANONICAL).then((servers) => {
        for (const server of servers) emit("mcp.status.changed", { server: server.name }, undefined, undefined, CANONICAL);
      });
      s.baseMode = info.permissionMode ?? s.baseMode ?? "default";
      // the TUI read the model list at boot, before this child existed, and
      // gates the composer on the selected model being in that list — so the
      // announcement has to invalidate it or every later submit is refused
      emit("model.updated", { sessionID: id });
      // design decision 5: the helper-supplied sandbox workdir is canonical
      // and maki's own cwd confirms it; a drift means the transport and the
      // helper disagree and every location answer would be wrong
      if (info.cwd && info.cwd !== s.directory) {
        console.error(`[bridge] session ${id}: maki cwd ${info.cwd} differs from the session directory ${s.directory}`);
      }
    },
    // a subagent session has no Maki child of its own: its frames arrive
    // through the parent's child, flagged with the task call's id
    ...(opts.parentID ? {} : { subagent: subagentHooks(() => s) }),
    // a prompt is written to the child when its turn starts, so one still
    // waiting can be cancelled
    deliver: (user, preamble) => s.maki.prompt([...preamble, user.text].join("\n\n"), (user.child as ContentBlock[] | undefined) ?? []),
    onResult: (r) => {
      s.updated = Date.now();
      // Maki titles the session when it records the first run
      // (maki-agent session.rs v0.6.4 L143–L166, L203–L217)
      if (!s.title && s.firstPrompt) {
        s.title = makiTitle(s.firstPrompt);
        if (s.title) emit("session.renamed", { sessionID: id, title: s.title }, 1);
      }
      if (r.total_cost_usd != null) s.cost = r.total_cost_usd;
      if (r.usage) {
        s.tokens = {
          input: r.usage.input_tokens ?? 0,
          output: r.usage.output_tokens ?? 0,
          reasoning: 0,
          cache: { read: r.usage.cache_read_input_tokens ?? 0, write: r.usage.cache_creation_input_tokens ?? 0 },
        };
      }
    },
  });
  let maki: MakiSession;
  let childModel: string | undefined;
  try {
    childModel = opts.parentID ? undefined : startModel(opts.model);
    maki = opts.parentID ? subagentChild() : startChild(id, { cwd: directory, model: childModel, fork: opts.fork });
  } catch (err) {
    // e.g. no sandbox name and no child override: refuse rather than run
    // maki on the host
    return { error: { status: 500, payload: { _tag: "InternalError", message: String((err as Error).message ?? err) } } };
  }
  s = {
    id,
    directory,
    childModel,
    agent: opts.agent,
    model: opts.model,
    maki,
    translator,
    pending: new Map(),
    controls: new Map(),
    history: Object.assign(new SessionHistory(), { origin: { directory } }),
    created: Date.now(),
    updated: Date.now(),
    ...(opts.parentID ? { parentID: opts.parentID } : {}),
  };
  sessions.set(id, s);
  return { session: s };
}

// session.shell (core session/session.ts v2.0.32 L179–L222): the command runs
// in the sandbox; started and ended frames carry the pinned Shell.Info and
// Output (schema shell.ts L25–L84), and the result reaches the model with the
// next turn as OpenCode's user-shell notice
let shellSeq = 0;
function userShell(s: BridgeSession, body: AnyObj): { status: number; payload: any } {
  const command = typeof body?.command === "string" ? body.command : "";
  if (!command.trim()) return { status: 400, payload: { _tag: "InvalidRequestError", message: "command is required" } };
  const run = runUserShell(command, s.directory);
  if (!run) return { status: 503, payload: { _tag: "ServiceUnavailableError", message: "no sandbox to run the command in", service: "shell" } };
  const messageID = typeof body?.id === "string" && /^msg_/.test(body.id) ? body.id : mintMessage();
  const info: AnyObj = {
    id: `sh_${Date.now().toString(16)}${String(++shellSeq).padStart(4, "0")}`,
    status: "running",
    command,
    cwd: s.directory,
    shell: "/bin/sh",
    file: "",
    metadata: { sessionID: s.id, background: true },
    time: { started: Date.now() },
  };
  emit("session.shell.started", { sessionID: s.id, shell: info }, 1, messageID.replace(/^msg_/, "evt_"));
  void run.then((result) => {
    const ended = { ...info, status: "exited", exit: result.exit, time: { ...info.time, completed: Date.now() } };
    const size = Buffer.byteLength(result.output);
    emit("session.shell.ended", { sessionID: s.id, shell: ended, output: { output: result.output, cursor: size, size, truncated: result.truncated } }, 1);
    s.translator.admitSynthetic(mintMessage(), {
      // no description, as OpenCode's notice has none: the TUI keeps it out of
      // the transcript (tui routes/session/rows.ts v2.0.32 L383)
      text: shellNotice(info.id, command, result),
      metadata: { source: "shell", shellID: info.id, state: "completed", truncated: result.truncated, exit: result.exit },
    });
  });
  return { status: 204, payload: null };
}

// session.fork (server handlers/session.ts v2.0.32 L226–L239, core session.ts
// L319–L358): the pinned child forks a whole stored session (`-r <id>
// --fork-session`, src/cli.rs v0.6.4 L53–L63, L114–L117) and cannot cut its
// history at a message, so only the full-session fork is served
function forkSession(parent: BridgeSession, body: AnyObj): { status: number; payload: any } {
  const before = typeof body?.before === "string" ? body.before : undefined;
  if (before && !parent.history.has(before)) {
    return { status: 404, payload: { _tag: "MessageNotFoundError", sessionID: parent.id, messageID: before, message: `Message not found: ${before}` } };
  }
  if (parent.history.size === 0 || !parent.makiSessionID) {
    return { status: 400, payload: { _tag: "InvalidRequestError", message: `Cannot fork empty session: ${parent.id}`, kind: "empty_session" } };
  }
  if (before) {
    return { status: 400, payload: { _tag: "InvalidRequestError", message: "Maki forks a whole session only; fork the full session instead" } };
  }
  const id = mintSession();
  const opened = openSession(id, { agent: parent.agent, model: parent.translator.announcedModel ?? parent.model, fork: parent.makiSessionID });
  if ("error" in opened) return opened.error;
  const s = opened.session;
  const eventID = mintEvent();
  const boundary = s.history.forkFrom(parent.history, eventID);
  // the copy keeps the parent's title with a fork suffix (core
  // session/projector.ts L51–L56) and its first prompt, so Maki's first-run
  // title never replaces it
  s.title = forkTitle(parent.title);
  s.firstPrompt = parent.firstPrompt;
  if (parent.metadata) s.metadata = parent.metadata;
  s.fork = { sessionID: parent.id, boundary: { type: "through", messageID: boundary! } };
  emit("session.forked", { sessionID: id, parentID: parent.id, boundary: s.fork.boundary }, 2);
  return { status: 200, payload: { data: sessionObject(s) } };
}

const forkTitle = (value?: string) => {
  if (value === undefined) return undefined;
  const match = /^(.+) \(fork #(\d+)\)$/.exec(value);
  return match ? `${match[1]} (fork #${Number.parseInt(match[2]!, 10) + 1})` : `${value} (fork #1)`;
};

// session.list: `parentID` names a parent's children, `null` the roots
function listSessions(url: URL): { status: number; payload: AnyObj } {
  const { payload } = synthesize("GET", "/api/session", asUrl("/api/session"), null, CANONICAL);
  const parent = url.searchParams.get("parentID");
  const list = [...sessions.values()].filter((s) => parent === null || (parent === "null" ? !s.parentID : s.parentID === parent));
  return { status: 200, payload: { ...payload, data: list.map(sessionObject) } };
}

// files[] -> what the pinned child can take (mentions.ts): image data URIs
// and mentioned sandbox paths; a host path is never read, and a PDF or other
// binary has no block on the inbound `user` wire (sdk_mode.rs L786–L816) —
// the mention text stays in the prompt either way
async function promptFiles(files: unknown, clientDir: string): Promise<{ blocks: ContentBlock[]; delivered: AnyObj[] }> {
  const read = await Promise.all((Array.isArray(files) ? files : []).map((f) => readAttachment(f, clientDir, CANONICAL)));
  const found = read.filter((a): a is NonNullable<typeof a> => a !== null);
  return { blocks: found.flatMap((a) => a.blocks), delivered: found.map((a) => a.delivered) };
}

// skills[] -> the selected skills' prepared text (mentions.ts); an unknown id
// is dropped
async function promptSkills(skills: unknown): Promise<{ blocks: ContentBlock[]; delivered: AnyObj[] }> {
  const list = Array.isArray(skills) ? skills : [];
  if (list.length === 0) return { blocks: [], delivered: [] };
  const known = await readSkills(CANONICAL);
  const read = await Promise.all(list.map((k) => readSkillAttachment(k, known, CANONICAL)));
  const found = read.filter((a): a is NonNullable<typeof a> => a !== null);
  return { blocks: found.flatMap((a) => a.blocks), delivered: found.map((a) => a.delivered) };
}

// prompts are admitted in arrival order even when one waits on a sandbox read
const admitting = new Map<string, Promise<unknown>>();
function prompt(sid: string, body: AnyObj, url: URL): Promise<{ status: number; payload: any }> {
  const next = (admitting.get(sid) ?? Promise.resolve()).then(() => admitPrompt(sid, body, url));
  admitting.set(sid, next.catch(() => {}));
  return next;
}

async function admitPrompt(sid: string, body: AnyObj, url: URL): Promise<{ status: number; payload: any }> {
  const s = sessions.get(sid);
  if (!s) return sessionNotFound(sid);
  if (!s.maki.running) {
    return { status: 503, payload: { _tag: "ServiceUnavailableError", message: "maki session is not running" } };
  }
  // a mention names a path under the client's directory, which maps onto the
  // sandbox workdir as /api/fs/list does
  const asked = url.searchParams.get("location[directory]");
  const images = await promptFiles(body?.files, asked?.startsWith("/") ? asked : s.directory);
  const skills = await promptSkills(body?.skills);
  if (!s.maki.running) {
    return { status: 503, payload: { _tag: "ServiceUnavailableError", message: "maki session is not running" } };
  }
  const text = String(body?.text ?? "");
  if (s.firstPrompt === undefined && text.trim()) s.firstPrompt = text;
  const userMsgID = typeof body?.id === "string" && /^msg_/.test(body.id) ? body.id : mintMessage();
  // mint the turn's assistant message id before maki can answer, so every part
  // event of the turn carries the same msg_ (mapping-table.md §5); the user
  // frame goes out first, before the child is written to, so the transcript
  // orders Q-A-Q-A within and across turns (spec: "Prompt renders before its
  // response"; shape pinned live in evidence/cross-map.md)
  const delivery = s.translator.beginTurn(mintMessage(), {
    text, id: userMsgID, delivery: String(body?.delivery ?? "steer"), files: images.delivered, skills: skills.delivered,
    child: [...images.blocks, ...skills.blocks], created: Date.now(),
  });
  const { status, payload } = synthesize("POST", `/api/session/${sid}/prompt`, url, body, CANONICAL);
  const delivered = userPayload({ text, files: images.delivered, skills: skills.delivered });
  if (payload?.data) payload.data = { ...payload.data, id: userMsgID, sessionID: sid, time: { created: Date.now() }, payload: delivered, delivery };
  return { status, payload };
}

// Maki only checks that the key is present; the value is the stream-json
// session-rule shape, so the frame reads the same to any SDK consumer
function sessionRule(toolName: string): unknown[] {
  return [{ type: "addRules", rules: [{ toolName }], behavior: "allow", destination: "session" }];
}

function replyPermission(s: BridgeSession, perID: string, body: AnyObj): { status: number; payload: any } {
  const pending = s.pending.get(perID);
  if (!pending) return { status: 404, payload: { _tag: "PermissionNotFoundError", requestID: perID, message: `Permission request not found: ${perID}` } };
  // a subagent's ask is answered by the parent's Maki child
  const maki = pending.maki ?? s.maki;
  const decision = String(body?.decision ?? "");
  if (decision !== "once" && decision !== "always" && decision !== "reject") {
    // invalid reply: fail closed rather than letting the tool through
    maki.answer(pending.requestID, "deny");
    s.pending.delete(perID);
    return { status: 400, payload: { _tag: "InvalidRequestError", message: `invalid decision: ${decision}` } };
  }
  emit("permission.replied", { sessionID: s.id, requestID: perID, reply: decision });
  // the bridge caches nothing: `always` becomes Maki's session-scoped allow,
  // and Maki decides which later calls its session rule covers; a reject
  // reason reaches the model as guidance
  const message = typeof body?.message === "string" ? body.message : "";
  if (decision === "always") maki.answer(pending.requestID, "allow", { updatedPermissions: sessionRule(pending.toolName) });
  else if (decision === "reject") maki.answer(pending.requestID, "deny", message ? { message } : {});
  else maki.answer(pending.requestID, "allow");
  s.pending.delete(perID);
  return { status: 204, payload: null };
}

// session.model: "switch the model used by subsequent provider turns". The
// selection goes to the child as set_model; only its success ack moves the
// model the session and later step frames report, so a model maki's policy
// rejects is never claimed
function selectModel(s: BridgeSession, body: AnyObj): { status: number; payload: any } {
  const providerID = body?.model?.providerID;
  const id = body?.model?.id;
  if (typeof providerID !== "string" || !providerID || typeof id !== "string" || !id) {
    return { status: 400, payload: { _tag: "InvalidRequestError", message: "model must name a providerID and an id" } };
  }
  const model = { providerID, id };
  const current = s.translator.announcedModel ?? s.model;
  s.model = model;
  // the TUI re-posts the model it already shows (its boot default included);
  // that is no switch, so nothing is sent
  if (current.providerID === providerID && current.id === id) return { status: 204, payload: null };
  // ids the child announced without a provider are listed under "maki"
  // (translator parseModel), so they go back bare
  const spec = providerID === "maki" ? id : `${providerID}/${id}`;
  const requestID = s.maki.setModel(spec);
  s.controls.set(requestID, (ack) => {
    if (ack.subtype === "success") {
      s.childModel = spec;
      s.translator.announceModel(model);
      // the session's model is durable state the TUI reads back (client
      // solid/data.ts v2.0.32 L705–L716; tui context/local.tsx L256–L264, L344)
      emit("session.model.selected", { sessionID: s.id, model: { id, providerID }, previous: { id: current.id, providerID: current.providerID } }, 1);
      emit("model.updated", { sessionID: s.id });
    } else {
      console.error(`[bridge] session ${s.id}: maki refused model ${providerID}/${id}: ${ack.error ?? "unknown error"}`);
    }
  });
  return { status: 204, payload: null };
}

// session.agent: Maki's agents are its modes (spec-answers /api/agent), so a
// switch is set_permission_mode — `plan`, or for `build` the mode the child
// started in — written before the next user message, which runs in it
// (sdk_mode.rs v0.6.4 L688–L696, L846–L860). The selection is the session's
// durable state, as the real server records it (core session/
// message-updater.ts v2.0.32 L91–L103); a mode Maki refuses restores the
// previous agent.
const AGENT_MODES = new Set(["build", "plan"]);
function agentMode(s: BridgeSession, agent: string): string {
  return agent === "plan" ? "plan" : (s.baseMode ?? "default");
}
function selectAgent(s: BridgeSession, body: AnyObj): { status: number; payload: any } {
  const agent = body?.agent;
  if (typeof agent !== "string" || !AGENT_MODES.has(agent)) {
    return { status: 400, payload: { _tag: "InvalidRequestError", message: `unknown agent: ${String(agent)}` } };
  }
  const previous = s.agent;
  if (agent === previous) return { status: 204, payload: null };
  s.agent = agent;
  emit("session.agent.selected", { sessionID: s.id, agent, previous }, 1);
  if (s.parentID) return { status: 204, payload: null };
  const requestID = s.maki.setPermissionMode(agentMode(s, agent));
  s.controls.set(requestID, (ack) => {
    if (ack.subtype === "success" || s.agent !== agent) return;
    console.error(`[bridge] session ${s.id}: maki refused mode for agent ${agent}: ${ack.error ?? "unknown error"}`);
    s.agent = previous;
    emit("session.agent.selected", { sessionID: s.id, agent: previous, previous: agent }, 1);
  });
  return { status: 204, payload: null };
}

// session.interrupt: `interrupted` says whether an active execution was
// stopped, so an idle session is the pinned no-op and nothing is written
function interrupt(s: BridgeSession): { status: number; payload: any } {
  if (!s.translator.inTurn || !s.maki.running) return { status: 200, payload: { interrupted: false } };
  // a run parked on a permission ask is unparked with a deny first; the ask is
  // then settled for the TUI too, since maki forgets it when the run ends
  // (a subagent's asks wait in its child sessions)
  for (const owner of [s, ...[...sessions.values()].filter((c) => c.parentID === s.id)]) {
    for (const [perID, pending] of owner.pending) {
      s.maki.answer(pending.requestID, "deny");
      emit("permission.replied", { sessionID: owner.id, requestID: perID, reply: "reject" });
    }
    owner.pending.clear();
  }
  s.translator.markInterrupted();
  s.controls.set(s.maki.interrupt(), () => {});
  return { status: 200, payload: { interrupted: true } };
}

// session.update (server handlers/session.ts v2.0.32 L259–L281): a title
// renames the session; an empty or null title asks for a generated one, which
// for Maki is its first-prompt rule; metadata is the host's annotation set.
// Permissions are Maki's rule set, which the pinned SDK cannot change
// (sdk_mode.rs v0.6.4 has no rules control request), so they are not applied.
function updateSession(s: BridgeSession, body: AnyObj): { status: number; payload: any } {
  if ("title" in (body ?? {})) {
    const title = typeof body.title === "string" && body.title ? body.title : s.firstPrompt ? makiTitle(s.firstPrompt) : undefined;
    if (title) {
      s.title = title;
      emit("session.renamed", { sessionID: s.id, title }, 1);
    }
  }
  if (body?.metadata && typeof body.metadata === "object") {
    s.metadata = body.metadata;
    emit("session.metadata.updated", { sessionID: s.id, metadata: body.metadata }, 1);
  }
  if (body?.permissions !== undefined && body.permissions !== null) {
    console.error(`[bridge] session ${s.id}: permission rules are Maki's and cannot be set over the SDK; not applied`);
  }
  return { status: 204, payload: null };
}

// session.view: a viewer acknowledges the idle transition it saw. The real
// server ignores a watermark for no transition, one past the current
// transition, or one already covered (core session/session.ts v2.0.32
// L61–L70), and keeps the watermark monotone (projector.ts L601–L611)
function viewSession(s: BridgeSession, body: AnyObj): { status: number; payload: any } {
  const idle = body?.idle;
  if (typeof idle !== "number" || !Number.isFinite(idle)) {
    return { status: 400, payload: { _tag: "InvalidRequestError", message: "idle must be a number" } };
  }
  if (s.idle === undefined || idle > s.idle || (s.viewed !== undefined && s.viewed >= idle)) return { status: 204, payload: null };
  s.viewed = Math.max(idle, s.viewed ?? idle);
  emit("session.viewed", { sessionID: s.id, idle }, 1);
  return { status: 204, payload: null };
}

// session.generate: a transient answer from the session's context that leaves
// its history untouched (server handlers/session.ts v2.0.32 L596–L609). The
// pinned child has no such request, so a throwaway child forks the stored
// session (`-r <id> --fork-session`), answers once with every tool ask denied
// (generate runs no tool loop), and its fork is deleted from Maki's store
// (`maki session delete <id> --force`, src/cli.rs v0.6.4 L303–L321)
function generateAside(sid: string, body: AnyObj): Promise<{ status: number; payload: any }> {
  const parent = sessions.get(sid);
  if (!parent) return Promise.resolve(sessionNotFound(sid));
  const prompt = typeof body?.prompt === "string" ? body.prompt : "";
  if (!prompt) return Promise.resolve({ status: 400, payload: { _tag: "InvalidRequestError", message: "prompt is required" } });
  return new Promise((resolve) => {
    let forkID: string | undefined;
    let text = "";
    let settled = false;
    const finish = (out: { status: number; payload: any }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      // the fork's id is Maki's own; the scripted sandbox has no store
      if (forkID && forkID !== parent.makiSessionID) {
        void sandboxRun(["maki", "session", "delete", forkID, "--force"], CANONICAL);
      }
      resolve(out);
    };
    const unavailable = (message: string) =>
      finish({ status: 503, payload: { _tag: "ServiceUnavailableError", message, service: "session generation" } });
    let child: MakiSession;
    try {
      child = new MakiSession({
        cwd: parent.directory,
        model: MAKI_MODEL,
        fork: parent.makiSessionID,
        onFrame: (frame) => {
          if (frame.type === "system" && frame.subtype === "init") {
            forkID = typeof frame.session_id === "string" ? frame.session_id : undefined;
          } else if (frame.type === "control_request" && frame.request?.subtype === "can_use_tool") {
            child.answer(String(frame.request_id ?? ""), "deny", { message: "Answer from what you already know; no tools in a side question." });
          } else if (frame.type === "assistant" && !frame.parent_tool_use_id && Array.isArray(frame.message?.content)) {
            const parts = frame.message.content.filter((p: AnyObj) => p?.type === "text").map((p: AnyObj) => String(p.text ?? ""));
            if (parts.length) text = parts.join("\n");
          } else if (frame.type === "result") {
            if (frame.subtype === "success" && !frame.is_error) finish({ status: 200, payload: { data: { text: text || String(frame.result ?? "") } } });
            else unavailable(String(frame.result ?? "maki generation failed"));
          }
        },
        onExit: () => unavailable("maki exited before answering"),
      });
    } catch (err) {
      return resolve({ status: 503, payload: { _tag: "ServiceUnavailableError", message: String((err as Error).message ?? err), service: "session generation" } });
    }
    const timer = setTimeout(() => unavailable("maki did not answer in time"), 120_000);
    child.prompt(prompt);
  });
}

// session.wait: answers once the session's agent loop is idle — no turn
// running and no prompt waiting (server handlers/session.ts v2.0.32 L456–L460)
async function waitIdle(sid: string): Promise<{ status: number; payload: any }> {
  let s = sessions.get(sid);
  if (!s) return sessionNotFound(sid);
  while (s && s.maki.running && (s.translator.inTurn || s.translator.pending.length > 0)) {
    await new Promise((r) => setTimeout(r, 50));
    s = sessions.get(sid);
  }
  return { status: 204, payload: null };
}

// experimental.session.export: the transcript the copy and export commands
// format (tui routes/session/index.tsx v2.0.32 L1191–L1240)
function sessionExport(sid: string, url: URL): { status: number; payload: any } {
  const s = sessions.get(sid);
  if (!s) return sessionNotFound(sid);
  return { status: 200, payload: { data: exportSession(sessionObject(s), s.history, url.searchParams.get("sanitize") === "true") } };
}

// session.inbox.list: the prompts the bridge holds for the child
function inboxList(s: BridgeSession): AnyObj[] {
  return s.translator.pending.map((u) => ({
    id: u.id, sessionID: s.id, time: { created: u.created ?? s.updated }, type: "user",
    payload: userPayload(u), delivery: "queue",
  }));
}

// session.inbox.update: every held prompt already waits for the next turn, so
// `queue` is a no-op; `steer` would merge it into the running turn, which the
// pinned child cannot take mid-run (feature mid-turn-steering), so it is the
// pinned conflict (server handlers/session.ts v2.0.32 L562–L571)
function updateInbox(s: BridgeSession, inboxID: string, body: AnyObj): { status: number; payload: any } {
  const delivery = body?.delivery;
  if (delivery !== "queue" && delivery !== "steer") {
    return { status: 400, payload: { _tag: "InvalidRequestError", message: "delivery must be steer or queue" } };
  }
  const held = s.translator.pending.some((u) => u.id === inboxID);
  if (delivery === "queue" && held) return { status: 204, payload: null };
  return { status: 409, payload: { _tag: "ConflictError", message: `Pending input cannot change to ${delivery}` } };
}

// session.messages: the projected transcript, paged as the real handler pages
function messagePage(s: BridgeSession, url: URL): { status: number; payload: any } {
  const q = url.searchParams;
  const page = s.history.page({ limit: q.get("limit"), order: q.get("order"), cursor: q.get("cursor"), type: q.get("type") });
  if (!page.ok) return { status: 400, payload: { _tag: "InvalidCursorError", message: page.message } };
  return { status: 200, payload: { data: page.data, cursor: page.cursor } };
}

// A session's Maki frames are handled in arrival order; a frame that needs a
// sandbox read first (an edit's result, edit-diff.ts) holds the ones after it
const frameChains = new Map<string, Promise<void>>();
function onMakiFrame(sessionID: string, frame: AnyObj): void {
  const next = (frameChains.get(sessionID) ?? Promise.resolve())
    .then(() => enrichFrame(sessionID, frame))
    .then(() => handleMakiFrame(sessionID, frame))
    .catch((err) => console.error(`[bridge] session ${sessionID}: frame failed: ${String(err)}`));
  frameChains.set(sessionID, next);
}

// the parent's own Edit calls, by id, with their input
const editCalls = new Map<string, AnyObj>();
async function enrichFrame(sessionID: string, frame: AnyObj): Promise<void> {
  if (frame.parent_tool_use_id) return;
  const content = Array.isArray(frame.message?.content) ? frame.message.content : [];
  if (frame.type === "assistant") {
    for (const part of content) if (part?.type === "tool_use" && part.name === "Edit") editCalls.set(String(part.id), part.input ?? {});
    return;
  }
  if (frame.type !== "user") return;
  const s = sessions.get(sessionID);
  for (const part of content) {
    if (part?.type !== "tool_result" || part.is_error) continue;
    const input = editCalls.get(String(part.tool_use_id));
    editCalls.delete(String(part.tool_use_id));
    if (!s || !input || typeof input.path !== "string") continue;
    const abs = input.path.startsWith("/") ? posix.normalize(input.path) : posix.join(CANONICAL, input.path);
    const res = await sandboxRun(["cat", "--", abs], CANONICAL);
    if (res?.code !== 0) continue;
    const before = undoEdit(res.stdout, input);
    if (before === undefined) continue;
    const file = abs.startsWith(`${CANONICAL}/`) ? abs.slice(CANONICAL.length + 1) : abs;
    s.translator.attachResultMetadata(String(part.tool_use_id), { files: [editFileDiff(file, before, res.stdout)] });
  }
}

function handleMakiFrame(sessionID: string, frame: AnyObj): void {
  const s = sessions.get(sessionID);
  if (!s) return;
  if (frame.type === "control_request" && frame.request?.subtype === "can_use_tool") {
    // maki blocks this tool call until the TUI's reply reaches control_response
    const req = frame.request ?? {};
    const toolName = String(req.tool_name ?? "tool");
    const toolUseID = String(req.tool_use_id ?? "");
    const perID = mintPermission();
    const ask = permissionAsk(toolName, req.input);
    // a subagent's call is asked in its child session, as OpenCode asks it
    // (the TUI then offers a reject reason: tui routes/session/permission.tsx
    // v2.0.32 L248–L251); the answer still goes to the one Maki child
    const childID = s.translator.toolOwner(toolUseID);
    const owner = (childID && sessions.get(childID)) || s;
    owner.pending.set(perID, {
      requestID: String(frame.request_id ?? ""),
      toolName,
      ask,
      toolUseID,
      messageID: owner.translator.assistantMessageID,
      message: `Maki wants to run: ${toolName} ${JSON.stringify(req.input ?? {})}`,
      maki: s.maki,
    });
    // object-form Permission.Source (design decision 4); `save` lists what the
    // TUI's "Always allow" names (opencode v2.0.32 tui/util/permission.ts),
    // here the scope Maki's session rule will cover
    emit("permission.asked", {
      id: perID,
      sessionID: owner.id,
      ...ask,
      message: `Maki wants to run: ${toolName} ${JSON.stringify(req.input ?? {})}`,
      source: { type: "tool", messageID: owner.translator.assistantMessageID, id: toolUseID },
    });
    return;
  }
  if (frame.type === "control_response") {
    // maki's ack of a bridge control request (sdk_mode.rs L428–L441)
    const id = String(frame.response?.request_id ?? "");
    const onAck = s.controls.get(id);
    s.controls.delete(id);
    onAck?.(frame.response ?? {});
    return;
  }
  s.translator.onFrame(frame);
}

/** a session's Maki child; an exit counts only while it is still the
 * session's child (a moved session replaces it) */
function startChild(id: string, opts: { cwd: string; model?: string; fork?: string; resume?: string }): MakiSession {
  const child: MakiSession = new MakiSession({
    ...opts,
    onFrame: (frame) => onMakiFrame(id, frame),
    // the exit is handled after the frames the child wrote before it
    onExit: () => {
      const next = (frameChains.get(id) ?? Promise.resolve()).then(() => {
        const s = sessions.get(id);
        if (!s || s.maki === child) onMakiExit(id);
      });
      frameChains.set(id, next);
    },
  });
  return child;
}

// session.move (core session/move.ts v2.0.32 L64–L157): the destination
// resolves against the session's directory and must be a directory; here it
// must also lie in the sandbox workdir, the one project the bridge serves.
// Maki has no control that changes a child's workdir, so the move waits for
// the running turn, then restarts the child there, resuming the same Maki
// session (`-r`), and records the durable session.moved.
async function moveSession(s: BridgeSession, body: AnyObj): Promise<{ status: number; payload: any }> {
  const asked = typeof body?.directory === "string" ? body.directory.trim() : "";
  const invalid = (message: string) => ({ status: 400, payload: { _tag: "InvalidRequestError", message } });
  if (!asked) return invalid("directory is required");
  if (s.parentID) return invalid("a subagent session moves with its parent");
  const target = posix.resolve(s.directory, asked);
  if (!worktrees.contains(target)) return invalid(`Directory is outside the project: ${target}`);
  const res = await sandboxRun(["sh", "-c", 'if [ -d "$1" ]; then echo D; elif [ -e "$1" ]; then echo F; else echo N; fi', "sh", target], CANONICAL);
  const kind = res?.stdout.trim();
  if (kind === "N" || kind === undefined) return invalid(`Directory does not exist: ${target}`);
  if (kind === "F") return invalid(`Not a directory: ${target}`);
  await waitIdle(s.id);
  if (!sessions.has(s.id)) return sessionNotFound(s.id);
  if (target !== s.directory) {
    const old = s.maki;
    s.directory = target;
    // the spec the child runs (a bare announced id is no valid `-m`)
    s.maki = startChild(s.id, { cwd: target, model: s.childModel ?? MAKI_MODEL, resume: s.makiSessionID });
    old.kill();
    if (s.agent === "plan") s.maki.setPermissionMode("plan");
    emit("session.moved", {
      sessionID: s.id,
      location: { directory: target },
      projectID,
      subpath: posix.relative(CANONICAL, target),
    }, 1);
  }
  return { status: 204, payload: null };
}

function onMakiExit(sessionID: string): void {
  const s = sessions.get(sessionID);
  if (!s) return;
  s.translator.abortTurn("maki process exited");
  console.error(`[bridge] maki exited behind session ${sessionID}`);
}

function sessionRoute(method: string, sid: string, rest: string, body: AnyObj, url: URL): { status: number; payload: any } | Promise<{ status: number; payload: any }> {
  if (rest === "") {
    const s = sessions.get(sid);
    if (method === "GET") return s ? { status: 200, payload: { data: sessionObject(s) } } : sessionNotFound(sid);
    if (method === "PATCH") return s ? updateSession(s, body) : sessionNotFound(sid);
    if (method === "DELETE") {
      if (!s) return sessionNotFound(sid);
      s.maki.kill();
      // the TUI drops the session and leaves its route on this frame
      // (session-event.ts v2.0.32 L177–L184; client data.ts L682–L684)
      emit("session.deleted", { sessionID: sid }, 2);
      sessions.delete(sid);
      return { status: 204, payload: null };
    }
  }
  const s = sessions.get(sid);
  if (!s) return sessionNotFound(sid);
  if (rest === "prompt" && method === "POST") return prompt(sid, body, url);
  if (rest === "model" && method === "POST") return selectModel(s, body);
  if (rest === "agent" && method === "POST") return selectAgent(s, body);
  if (rest === "permission" && method === "GET") {
    const { status, payload } = synthesize(method, `/api/session/${sid}/permission`, url, body, CANONICAL);
    return { status, payload: { ...payload, data: pendingList(s) } };
  }
  if (rest === "interrupt" && method === "POST") return interrupt(s);
  if (rest === "view" && method === "POST") return viewSession(s, body);
  if (rest === "move" && method === "POST") return moveSession(s, body);
  if (rest === "fork" && method === "POST") return forkSession(s, body);
  if (rest === "shell" && method === "POST") return userShell(s, body);
  if (rest === "message" && method === "GET") return messagePage(s, url);
  if (rest === "inbox" && method === "GET") return { status: 200, payload: { data: inboxList(s) } };
  const inboxItem = /^inbox\/([^/]+)$/.exec(rest);
  if (inboxItem && method === "DELETE") {
    s.translator.cancelPending(inboxItem[1]!);
    return { status: 204, payload: null };
  }
  if (inboxItem && method === "PATCH") return updateInbox(s, inboxItem[1]!, body);
  const reply = /^permission\/([^/]+)\/reply$/.exec(rest);
  if (reply && method === "POST") return replyPermission(s, reply[1]!, body);
  // deferred session surfaces (message/inbox/form/terminal, resume/fork/…)
  // answer from the spec set with the spike's minimal fakes
  return synthesize(method, `/api/session/${sid}${rest ? `/${rest}` : ""}`, url, body, CANONICAL);
}

// /api/model, /api/provider and /api/integration describe what Maki can run
// in the sandbox: the catalog `maki models` reports, read once at boot, with
// the model the child announced — or, before any announcement, the one the
// helper configured — first, since the TUI selects the first valid model
// (design decision 3). Only with neither a catalog nor a known model does
// the list fall back to the synthesized entry the spec permits before an
// announcement.
let catalogReady = readModelCatalog(CANONICAL);
let catalogRead: Awaited<typeof catalogReady> | undefined;
void catalogReady.then((c) => (catalogRead = c));

// location.reload (server handlers/location.ts v2.0.32 L22–L31): OpenCode
// rebuilds the location's services and the TUI then refetches every location
// resource (client solid/data.ts L1955–L1967). The bridge re-reads what it
// serves from the sandbox: the model catalog (otherwise read once at boot),
// the checkout, its worktrees and its skills. Maki itself has no inbound
// control to reload its own configuration (sdk_mode.rs v0.6.4 L818–L880), so
// a running child keeps the configuration it started with.
async function reloadLocation(): Promise<{ status: number; payload: any }> {
  const next = readModelCatalog(CANONICAL);
  catalogReady = next;
  catalogRead = await next;
  await refreshProject();
  if (await worktrees.refresh()) emit("worktree.updated", { projectID }, undefined, undefined, CANONICAL);
  await checkSkills();
  return { status: 204, payload: null };
}

// A session starts on the model it was created with (the TUI creates it on
// its selection, then re-posts that model: tui component/prompt/index.tsx
// v2.0.32 L1233–L1241, L1283–L1286), so the child is started on it when
// Maki's catalog lists it; otherwise on the configured model, which a later
// selection switches with set_model
function startModel(model: { providerID: string; id: string }): string | undefined {
  const spec = model.providerID === "maki" ? model.id : `${model.providerID}/${model.id}`;
  if (spec === MAKI_MODEL) return spec;
  const listed = catalogRead?.models.some((m) => m.providerID === model.providerID && m.id === model.id);
  return listed ? spec : MAKI_MODEL;
}

function splitModel(spec?: string): { providerID: string; id: string } | undefined {
  const cut = spec ? spec.indexOf("/") : -1;
  return cut > 0 ? { providerID: spec!.slice(0, cut), id: spec!.slice(cut + 1) } : undefined;
}

function modelInfo(m: { providerID: string; id: string }): AnyObj {
  return {
    id: m.id, modelID: m.id, providerID: m.providerID, name: m.id,
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    variants: [], time: { released: 0 }, cost: [], status: "active", enabled: true,
    limit: { context: 0, output: 0 },
  };
}

async function knownModels(): Promise<{ providerID: string; id: string }[]> {
  const { models } = await catalogReady;
  const announced = [...sessions.values()].map((s) => s.translator.announcedModel).find(Boolean);
  const first = announced ?? splitModel(MAKI_MODEL);
  if (!first) return models;
  return [first, ...models.filter((m) => !(m.providerID === first.providerID && m.id === first.id))];
}

async function modelList(url: URL): Promise<{ status: number; payload: any }> {
  const result = synthesize("GET", "/api/model", url, null, CANONICAL);
  const known = await knownModels();
  if (known.length) result.payload = { ...result.payload, data: known.map(modelInfo) };
  return result;
}

async function providerList(url: URL): Promise<{ status: number; payload: any }> {
  const { status, payload } = synthesize("GET", "/api/provider", url, null, CANONICAL);
  const { envProviders } = await catalogReady;
  const names = new Map(envProviders.map((p) => [p.id, p.name]));
  const ids = [...new Set([...(await knownModels()).map((m) => m.providerID), ...names.keys()])];
  const data = ids.map((id) => {
    const p: AnyObj = { id, name: names.get(id) ?? id, activation: "enabled", package: "maki" };
    if (names.has(id)) p.integrationID = id;
    return p;
  });
  return { status, payload: { ...payload, data } };
}

// a provider is connected through the variable its OpenShell profile injects;
// the only method is that variable — credentials never enter through the TUI
async function integrationList(url: URL): Promise<{ status: number; payload: any }> {
  const { status, payload } = synthesize("GET", "/api/integration", url, null, CANONICAL);
  const { envProviders } = await catalogReady;
  const data = envProviders.map((p) => ({
    id: p.id, name: p.name,
    methods: [{ type: "env", names: [p.env] }],
    connections: [{ type: "env", name: p.env }],
  }));
  return { status, payload: { ...payload, data } };
}

// /api/info describes this process, the server the TUI is attached to: its
// pid and listen URL (the TUI's pair dialog parses urls[0]), the pinned
// version (a mismatch warns), and no persistent PTY — the TUI offers
// terminals unless persistentPty is false (session-terminals.tsx v2.0.32
// L62–L77), and the bridge serves none
function serverInfo(url: URL): { status: number; payload: any } {
  const result = synthesize("GET", "/api/info", url, null, CANONICAL);
  result.payload = {
    ...result.payload,
    pid: process.pid,
    urls: [`http://127.0.0.1:${server.port}`],
    paths: { tmp: tmpdir() },
    capabilities: { persistentPty: terminals.available },
  };
  return result;
}

// /api/session/active: the real server maps every session with an execution
// in flight to {type: "running"} (handlers/session.ts v2.0.32 L182–L188); the
// TUI reads it on server.connected, so a reconnect mid-turn keeps the busy
// state and the interrupt control instead of showing the session idle
function activeSessions(url: URL): { status: number; payload: any } {
  const { status } = synthesize("GET", "/api/session/active", url, null, CANONICAL);
  const data: AnyObj = {};
  for (const s of sessions.values()) if (s.translator.inTurn && s.maki.running) data[s.id] = { type: "running" };
  return { status, payload: { data } };
}

// /api/mcp: the pinned child announces `mcp_servers: []` whatever it loaded
// (sdk_mode.rs v0.6.4 L623), so the servers come from the sandbox's Maki
// config and their state from what a child advertised: an MCP tool is named
// `<server>__<tool>` in system.init.tools, so a server with one is connected.
// Without one, the server failed — unless the child defers MCP tools behind
// `tool_search` (config.rs v0.6.4 defer_tools), or no child has started yet,
// where the state is not observable and the answer is `pending`.
async function mcpServers(url: URL): Promise<{ status: number; payload: any }> {
  const { status, payload } = synthesize("GET", "/api/mcp", url, null, CANONICAL);
  const config = await readMcpConfig(CANONICAL);
  const advertised = [...sessions.values()].map((s) => s.tools).find((t) => t !== undefined);
  const deferred = advertised?.some((t) => t.replace(/_/g, "").toLowerCase() === "toolsearch") ?? false;
  const data = config.map(({ name, enabled }) => {
    if (!enabled) return { name, status: { status: "disabled" } };
    if (advertised?.some((t) => t.startsWith(`${name}__`))) return { name, status: { status: "connected" } };
    if (!advertised || deferred) return { name, status: { status: "pending" } };
    return { name, status: { status: "failed", error: "the Maki session advertised no tool from this server" } };
  });
  return { status, payload: { ...payload, data } };
}

// /api/skill: the skills the child's skill plugin discovers in the sandbox;
// the TUI offers them as `@skill` mentions, whose text rides in the prompt
let servedSkills: string | undefined;
async function skillList(url: URL): Promise<{ status: number; payload: any }> {
  const { status, payload } = synthesize("GET", "/api/skill", url, null, CANONICAL);
  const skills = await readSkills(CANONICAL);
  servedSkills = JSON.stringify(skills);
  return { status, payload: { ...payload, data: skills } };
}

// The TUI caches the skill list until `skill.updated` (client solid/data.ts
// v2.0.32 L1269–L1272), which OpenCode emits when its skill directories
// change; Maki's skill tool rediscovers skills on every call (plugins/skill/
// init.lua v0.6.4 L163), so a skill a turn wrote is usable at once. After each
// turn the bridge re-reads the sandbox's skills and announces a change.
async function checkSkills(): Promise<void> {
  if (servedSkills === undefined) return;
  const now = JSON.stringify(await readSkills(CANONICAL));
  if (now === servedSkills) return;
  servedSkills = now;
  emit("skill.updated", {}, undefined, undefined, CANONICAL);
}

// /api/project and /api/location name the one project the bridge serves
async function projectList(url: URL): Promise<{ status: number; payload: any }> {
  await refreshProject();
  const { status } = synthesize("GET", "/api/project", url, null, CANONICAL);
  const active = Math.max(BOOTED, ...[...sessions.values()].map((s) => s.updated));
  const project: AnyObj = { id: projectID, canonical: CANONICAL, name: posix.basename(CANONICAL) || CANONICAL };
  if (projectVcs) project.vcs = projectVcs;
  project.time = { created: BOOTED, updated: BOOTED, active };
  project.sandboxes = [];
  return { status, payload: [project] };
}

async function location(url: URL): Promise<{ status: number; payload: any }> {
  await refreshProject();
  const result = synthesize("GET", "/api/location", url, null, CANONICAL);
  result.payload = { ...result.payload, project: { ...result.payload.project, id: projectID } };
  return result;
}

// /api/vcs: the footer's `dir:branch` and the sidebar read the checkout's
// branch (tui prompt/index.tsx v2.0.32 L1620), read fresh from the sandbox on
// every location sync
async function vcsInfo(url: URL): Promise<{ status: number; payload: any }> {
  const { status, payload } = synthesize("GET", "/api/vcs", url, null, CANONICAL);
  // a worktree is its own checkout, with its own HEAD
  const asked = url.searchParams.get("location[directory]");
  const checkout = asked && asked !== CANONICAL && worktrees.contains(asked) ? posix.normalize(asked) : CANONICAL;
  const git = await readGitState(checkout);
  const branch: AnyObj = {};
  if (git.branch) branch.current = git.branch;
  if (git.defaultBranch) branch.default = git.defaultBranch;
  const data: AnyObj = git.root || git.branch ? { provider: "git", branch } : { branch };
  return { status, payload: { ...payload, data } };
}

// /api/vcs/diff, /base, /status: the diff viewer's review of the sandbox
// checkout, from OpenCode's git provider ported in vcs.ts (server
// handlers/vcs.ts v2.0.32 L61–L100); a provider error is the pinned 503
async function vcsReview(path: string, url: URL): Promise<{ status: number; payload: any }> {
  const { status, payload } = synthesize("GET", path, url, null, CANONICAL);
  try {
    let data: unknown;
    if (path === "/api/vcs/base") data = await reviewBase(CANONICAL);
    else if (path === "/api/vcs/status") data = await reviewStatus(CANONICAL);
    else {
      const mode = (url.searchParams.get("mode") ?? "") as Mode;
      if (!["working", "branch", "committed"].includes(mode)) {
        return { status: 400, payload: { _tag: "InvalidRequestError", message: `invalid mode: ${mode}` } };
      }
      const context = url.searchParams.get("context");
      data = await reviewDiff(CANONICAL, mode, {
        base: url.searchParams.get("base") ?? undefined,
        context: context !== null && /^\d+$/.test(context) ? Number(context) : undefined,
      });
    }
    return { status, payload: { ...payload, data } };
  } catch (err) {
    if (!(err instanceof VcsError)) throw err;
    return { status: 503, payload: { _tag: "ServiceUnavailableError", message: err.message, service: "vcs" } };
  }
}

// persistent terminals in the sandbox (terminals.ts)
function terminalRoute(method: string, path: string, url: URL, body: AnyObj, req: Request): { status: number; payload: any } {
  const notFound = (ptyID: string) => ({ status: 404, payload: { _tag: "PtyNotFoundError", ptyID, message: `PTY session not found: ${ptyID}` } });
  const unavailable = { status: 503, payload: { _tag: "ServiceUnavailableError", message: "no sandbox to open a terminal in", service: "opencode-pty" } };
  const session = /^\/api\/experimental\/session\/([^/]+)\/terminal$/.exec(path);
  if (session) {
    const sid = session[1]!;
    const s = sessions.get(sid);
    if (method === "GET") return { status: 200, payload: { data: terminals.list(sid) } };
    if (method !== "POST") return synthesize(method, path, url, body, CANONICAL);
    if (!terminals.available) return unavailable;
    // the TUI names its own host directory; terminals open in the sandbox
    // workdir, as every session runs there (design decision 5)
    const asked = typeof body?.cwd === "string" ? posix.normalize(body.cwd) : "";
    const cwd = asked === CANONICAL || asked.startsWith(`${CANONICAL}/`) ? asked : (s?.directory ?? CANONICAL);
    const size = body?.size && Number.isInteger(body.size.cols) && Number.isInteger(body.size.rows) ? { cols: body.size.cols, rows: body.size.rows } : undefined;
    const info = terminals.create(sid, {
      command: typeof body?.command === "string" && body.command ? body.command : undefined,
      args: Array.isArray(body?.args) ? body.args.map(String) : [],
      cwd,
      title: typeof body?.title === "string" ? body.title : undefined,
      size,
    });
    return info ? { status: 200, payload: { data: info } } : unavailable;
  }
  const m = /^\/api\/experimental\/persistent-pty\/([^/]+)(\/snapshot|\/connect-token)?$/.exec(path)!;
  const ptyID = m[1]!;
  if (m[2] === "/snapshot" && method === "GET") {
    const snap = terminals.snapshot(ptyID);
    return snap ? { status: 200, payload: { data: snap } } : notFound(ptyID);
  }
  if (m[2] === "/connect-token" && method === "POST") {
    if (req.headers.get("x-opencode-ticket") !== "1") return { status: 403, payload: { _tag: "ForbiddenError", message: "Invalid persistent PTY connect token request" } };
    const ticket = terminals.issueTicket(ptyID);
    return ticket ? { status: 200, payload: { data: ticket } } : notFound(ptyID);
  }
  if (!m[2] && method === "GET") {
    const info = terminals.get(ptyID);
    return info ? { status: 200, payload: { data: info } } : notFound(ptyID);
  }
  if (!m[2] && method === "PUT") {
    const size = body?.size;
    if (!size || !Number.isInteger(size.cols) || !Number.isInteger(size.rows) || size.cols < 1 || size.rows < 1) {
      return { status: 400, payload: { _tag: "InvalidRequestError", message: "size must name positive cols and rows" } };
    }
    const info = terminals.resize(ptyID, { cols: size.cols, rows: size.rows });
    return info ? { status: 200, payload: { data: info } } : notFound(ptyID);
  }
  if (!m[2] && method === "DELETE") return terminals.remove(ptyID) ? { status: 204, payload: null } : notFound(ptyID);
  return synthesize(method, path, url, body, CANONICAL);
}

// /api/fs/list: the TUI lists its own (host) directory at startup and for
// `/cd` completion; the project it names lives in the sandbox workdir, so the
// listing is the sandbox's, read over the exec transport — never the host
// directory the client names (defect fs-list-reads-host-directory). The
// answer keeps the client's directory as its location, so entries resolve
// against the path the TUI asked about.
async function fsList(url: URL): Promise<{ status: number; payload: any }> {
  const { status, payload } = synthesize("GET", "/api/fs/list", url, null, CANONICAL);
  const asked = url.searchParams.get("location[directory]");
  const base = asked?.startsWith("/") ? posix.normalize(asked) : CANONICAL;
  const rel = url.searchParams.get("path") ?? "";
  const abs = rel.startsWith("/") ? posix.normalize(rel) : posix.join(base, rel);
  // only the client's directory and what lies under it map onto the workdir
  const inside = abs === base || abs.startsWith(base === "/" ? "/" : `${base}/`);
  const target = inside ? posix.join(CANONICAL, abs.slice(base.length)) : null;
  let entries: AnyObj[] = [];
  const res = target ? await sandboxRun(["ls", "-1Ap", "--", target], CANONICAL) : null;
  if (res?.code === 0) {
    entries = res.stdout
      .split("\n")
      .filter(Boolean)
      .map((name) => (name.endsWith("/") ? { path: name.slice(0, -1), type: "directory" } : { path: name, type: "file" }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }
  return { status, payload: { ...payload, location: { directory: abs }, data: entries } };
}

// /api/worktree: the project's worktrees in the sandbox (worktrees.ts)
const worktrees = new ProjectWorktrees(CANONICAL);
const worktreeError = (err: unknown) => ({
  status: 400,
  payload: { _tag: "WorktreeError", name: "WorktreeError", data: { message: err instanceof Error ? err.message : String(err) } },
});
async function worktreeRoute(method: string, path: string, url: URL, body: AnyObj): Promise<{ status: number; payload: any }> {
  await refreshProject();
  const asked = method === "GET" ? url.searchParams.get("projectID") : body?.projectID;
  if (typeof asked !== "string" || !reportedProjectIDs.has(asked)) return { status: 404, payload: { _tag: "ProjectNotFoundError", projectID: asked, message: `Project not found: ${asked}` } };
  // the event names the id the client asked with, which it filters on
  const updated = () => emit("worktree.updated", { projectID: asked }, undefined, undefined, CANONICAL);
  try {
    if (path === "/api/worktree/refresh") {
      if (await worktrees.refresh()) updated();
      return { status: 204, payload: null };
    }
    // the checkout is listed from the first read, as the real server's stored rows are
    if (method === "GET") {
      if (worktrees.list().length === 0) await worktrees.refresh();
      return { status: 200, payload: worktrees.list() };
    }
    if (method === "POST") {
      const created = await worktrees.create({
        projectID,
        name: typeof body?.name === "string" ? body.name : undefined,
        branch: typeof body?.branch === "string" ? body.branch : undefined,
        from: typeof body?.from === "string" ? body.from : undefined,
      });
      updated();
      return { status: 200, payload: created };
    }
    await worktrees.remove(String(body?.directory ?? ""), body?.force === true);
    updated();
    return { status: 204, payload: null };
  } catch (err) {
    return worktreeError(err);
  }
}

// /api/experimental/session/stats aggregates the bridge's own session
// histories (session-stats.ts); a range that ends before it starts is refused
// as the real handler refuses it (core session/stats.ts v2.0.32 L84–L87)
function statsRoute(url: URL): { status: number; payload: any } {
  const time = (v: string | null) => {
    if (v === null || v === "") return undefined;
    const n = Number(v);
    const t = Number.isFinite(n) ? n : Date.parse(v);
    return Number.isFinite(t) ? t : undefined;
  };
  const from = time(url.searchParams.get("from"));
  const to = time(url.searchParams.get("to"));
  if (from !== undefined && from >= (to ?? Date.now())) {
    return { status: 400, payload: { _tag: "InvalidRequestError", message: `invalid stats range: ${from} >= ${to ?? "now"}` } };
  }
  const tools = url.searchParams.get("tools");
  const data = sessionStats(
    [...sessions.values()].map((s) => ({ parentID: s.parentID, messages: s.history.all() })),
    {
      from, to,
      timezone: url.searchParams.get("timezone") ?? undefined,
      tools: tools === "none" || tools === "summary" || tools === "detail" ? tools : undefined,
    },
  );
  return { status: 200, payload: { data } };
}

// /api/fs/find answers from the sandbox workdir's files (fs-find.ts); like
// /api/fs/list it never reads the host directory the client names.
async function fsFind(url: URL): Promise<{ status: number; payload: any }> {
  const { status, payload } = synthesize("GET", "/api/fs/find", url, null, CANONICAL);
  const type = url.searchParams.get("type");
  const limit = Number(url.searchParams.get("limit"));
  const res = await sandboxRun(LIST_FILES, CANONICAL);
  const files = res?.code === 0 ? res.stdout.split("\n").filter(Boolean) : [];
  const data = findFiles(files, {
    query: url.searchParams.get("query") ?? "",
    type: type === "file" || type === "directory" ? type : undefined,
    limit: Number.isInteger(limit) && limit > 0 ? limit : undefined,
  });
  const asked = url.searchParams.get("location[directory]");
  return { status, payload: { ...payload, location: asked?.startsWith("/") ? { ...payload.location, directory: asked } : payload.location, data } };
}

// ---------- request logging (redacted; design decision 6 hygiene) ----------
const SECRET_KEY = /\b(authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|secret|password|cookie|credential)\b/i;
const SECRET_VALUE = /\b(sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]{8,})/g;
function redact(v: any): any {
  if (typeof v === "string") return v.replace(SECRET_VALUE, "[REDACTED]");
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === "object") {
    const out: AnyObj = {};
    for (const [k, val] of Object.entries(v)) out[k] = SECRET_KEY.test(k) ? "[REDACTED]" : redact(val);
    return out;
  }
  return v;
}
function logRequest(entry: AnyObj, status: number, path: string, method: string): void {
  if (LOG) appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), ...redact(entry), status }) + "\n");
  console.log(`${method} ${path} ${status}${entry.matched === false ? " (unmatched)" : ""}`);
}

// ---------- server ----------
async function handle(req: Request, srv: Bun.Server<SocketData>): Promise<Response | undefined> {
  const url = new URL(req.url);
  const method = req.method.toUpperCase();
  const path = url.pathname;
  // persistentPty.connect is a WebSocket upgrade (server handlers/persistent-pty.ts v2.0.32 L127–L209)
  const connect = /^\/api\/experimental\/persistent-pty\/([^/]+)\/connect$/.exec(path);
  if (method === "GET" && connect) {
    const ptyID = connect[1]!;
    const cursor = Number(url.searchParams.get("cursor") ?? "0");
    if (!Number.isSafeInteger(cursor) || cursor < 0) return new Response(null, { status: 400 });
    if (!terminals.has(ptyID) || !terminals.consumeTicket(url.searchParams.get("ticket"), ptyID)) return new Response(null, { status: 403 });
    const data: SocketData = { ptyID, cursor, attachmentID: url.searchParams.get("attachment_id") ?? crypto.randomUUID(), takeover: url.searchParams.get("takeover") === "true" };
    logRequest({ method, path, query: Object.fromEntries(url.searchParams), body: {}, resp: null }, 101, path, method);
    return srv.upgrade(req, { data }) ? undefined : new Response(null, { status: 400 });
  }
  const bodyText = method === "GET" || method === "HEAD" ? "" : await req.text();
  let body: AnyObj = {};
  if (bodyText) { try { body = JSON.parse(bodyText); } catch { body = { raw: bodyText }; } }

  if (method === "GET" && path === "/api/event") return openEventStream();

  let result: { status: number; payload: any; matched?: boolean };
  const parts = path.split("/"); // ["", "api", "session", <sid>, ...rest]
  if (method === "POST" && parts[1] === "api" && parts[2] === "session" && parts[4] === "generate" && parts.length === 5) {
    result = await generateAside(parts[3]!, body);
  } else if (parts[1] === "api" && parts[2] === "session" && parts.length === 3) {
    // a session names its project, so creation waits for the id like every
    // other answer that names one
    if (method === "POST") result = (await projectReady, createSession(body));
    else if (method === "GET") result = listSessions(url);
    else result = synthesize(method, path, url, body, CANONICAL);
  } else if (parts[1] === "api" && parts[2] === "session" && parts[3] && parts[3] !== "active") {
    result = await sessionRoute(method, parts[3]!, parts.slice(4).join("/"), body, url);
  } else if (method === "POST" && /^\/api\/experimental\/session\/[^/]+\/wait$/.test(path)) {
    result = await waitIdle(parts[4]!);
  } else if (method === "GET" && /^\/api\/experimental\/session\/[^/]+\/export$/.test(path)) {
    result = sessionExport(parts[4]!, url);
  } else if (method === "GET" && path === "/api/model") {
    result = await modelList(url);
  } else if (method === "GET" && path === "/api/provider") {
    result = await providerList(url);
  } else if (method === "GET" && path === "/api/integration") {
    result = await integrationList(url);
  } else if (method === "GET" && path === "/api/skill") {
    result = await skillList(url);
  } else if (method === "GET" && path === "/api/mcp") {
    result = await mcpServers(url);
  } else if (method === "GET" && path === "/api/session/active") {
    result = activeSessions(url);
  } else if (method === "GET" && path === "/api/project") {
    result = await projectList(url);
  } else if (method === "GET" && path === "/api/location") {
    result = await location(url);
  } else if (method === "GET" && path === "/api/vcs") {
    result = await vcsInfo(url);
  } else if (method === "GET" && (path === "/api/vcs/diff" || path === "/api/vcs/base" || path === "/api/vcs/status")) {
    result = await vcsReview(path, url);
  } else if (/^\/api\/experimental\/(?:session\/[^/]+\/terminal|persistent-pty\/[^/]+(?:\/snapshot|\/connect-token)?)$/.test(path) && !path.endsWith("/terminal/read")) {
    result = terminalRoute(method, path, url, body, req);
  } else if (method === "GET" && path === "/api/fs/list") {
    result = await fsList(url);
  } else if (method === "POST" && path === "/api/location/reload") {
    result = await reloadLocation();
  } else if (path === "/api/worktree" || (method === "POST" && path === "/api/worktree/refresh")) {
    result = await worktreeRoute(method, path, url, body);
  } else if (method === "GET" && path === "/api/experimental/session/stats") {
    result = statsRoute(url);
  } else if (method === "GET" && path === "/api/fs/find") {
    result = await fsFind(url);
  } else if (method === "GET" && path === "/api/info") {
    result = serverInfo(url);
  } else {
    result = synthesize(method, path, url, body, CANONICAL);
  }

  logRequest({ method, path, query: Object.fromEntries(url.searchParams), body, resp: result.payload, matched: result.matched }, result.status, path, method);
  if (result.status === 204) return new Response(null, { status: result.status });
  if (result.status === 404 && result.matched === false) {
    // unknown route (a new TUI version calling something new): visible in the
    // request log instead of silently synthesized
    return new Response(JSON.stringify(result.payload), { status: 404, headers: { "content-type": "application/json" } });
  }
  return Response.json(result.payload ?? null, { status: result.status });
}

function shutdown(): void {
  terminals.shutdown();
  for (const s of sessions.values()) s.maki.kill();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", () => { for (const s of sessions.values()) s.maki.kill(); });

// server.port (not PORT): with PORT=0 the listen line must name the bound
// port, which is what wait_for_bridge_port parses
const server = Bun.serve<SocketData>({
  port: PORT,
  hostname: "127.0.0.1",
  idleTimeout: 0,
  fetch: handle,
  websocket: {
    open: (ws) => terminals.open(ws),
    message: (ws, message) => terminals.message(ws, message as string | Buffer),
    close: (ws) => terminals.close(ws),
  },
});
console.log(`bridge listening on http://127.0.0.1:${server.port} (canonical: ${CANONICAL})`);
