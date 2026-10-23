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
import { MakiSession, type ImageBlock } from "./maki.ts";
import { Translator } from "./translator.ts";
import { mintEvent, mintMessage, mintPermission, mintSession } from "./ids.ts";
import { synthesize, type AnyObj } from "./spec-answers.ts";
import { readGitState, sandboxRun } from "./sandbox.ts";

const PORT = Number(process.env.PORT ?? 4600);
const CANONICAL = process.env.OPENMAKI_CWD ?? process.cwd();
const MAKI_MODEL = process.env.MAKI_MODEL;
const LOG = process.env.BRIDGE_LOG;
const SSE_LOG = process.env.BRIDGE_SSE_LOG;

// ---------- session registry ----------
interface PendingAsk {
  requestID: string; // maki's control_request id
  toolName: string;
  toolUseID: string;
  messageID: string; // the turn's assistant message id
  message: string;
}

interface BridgeSession {
  id: string;
  directory: string;
  agent: string;
  model: { providerID: string; id: string };
  maki: MakiSession;
  translator: Translator;
  makiSessionID?: string; // maki's own session_id, mapped on first system.init
  pending: Map<string, PendingAsk>; // per_ id -> unanswered permission ask
  controls: Map<string, (ack: AnyObj) => void>; // bridge control request_id -> ack handler
  created: number;
  updated: number;
  cost?: number;
  tokens?: AnyObj;
}

const sessions = new Map<string, BridgeSession>();

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

function emit(type: string, data: AnyObj, durableVersion?: number): void {
  const ev: AnyObj = { id: mintEvent(), created: Date.now(), type };
  const dir = typeof data.sessionID === "string" ? sessions.get(data.sessionID)?.directory : undefined;
  if (dir) ev.location = { directory: dir };
  ev.data = data;
  if (durableVersion && typeof data.sessionID === "string") {
    ev.durable = { aggregateID: data.sessionID, seq: durableSeq++, version: durableVersion };
  }
  const frame = { id: ev.id, event: type, data: ev };
  seenFrames.push(frame);
  pushFrame(frame);
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
const projectReady = readGitState(CANONICAL).then((git) => {
  if (git.root) {
    projectID = git.root;
    projectVcs = "git";
  }
});

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
    time: { created: s.created, updated: s.updated },
    location: { directory: s.directory },
  };
}

function pendingList(s: BridgeSession): AnyObj[] {
  return [...s.pending.entries()].map(([perID, p]) => ({
    id: perID, sessionID: s.id, action: "allow", resources: [p.toolName],
    save: [p.toolName], message: p.message, source: { type: "tool", messageID: p.messageID, id: p.toolUseID },
  }));
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

  // The TUI's requested directory is its own host cwd (design decision 5):
  // the sandbox workdir is canonical, so every session runs there and no host
  // path can enter the sandbox through `sandbox exec --workdir`.
  const directory = CANONICAL;

  let s: BridgeSession;
  const translator = new Translator({
    sink: { emit },
    sessionID: id,
    agent: () => s.agent,
    model: () => s.model,
    onInit: (info) => {
      s.makiSessionID = info.sessionID;
      // the TUI read the model list at boot, before this child existed, and
      // gates the composer on the selected model being in that list — so the
      // announcement has to invalidate it or every later submit is refused
      emit("model.updated", { sessionID: id });
      // design decision 5: the helper-supplied sandbox workdir is canonical
      // and maki's own cwd confirms it; a drift means the transport and the
      // helper disagree and every location answer would be wrong
      if (info.cwd && info.cwd !== directory) {
        console.error(`[bridge] session ${id}: maki cwd ${info.cwd} differs from canonical ${directory}`);
      }
    },
    onResult: (r) => {
      s.updated = Date.now();
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
  try {
    maki = new MakiSession({
      cwd: directory,
      model: MAKI_MODEL,
      onFrame: (frame) => onMakiFrame(id, frame),
      onExit: () => onMakiExit(id),
    });
  } catch (err) {
    // e.g. no sandbox name and no child override: refuse rather than run
    // maki on the host
    return { status: 500, payload: { _tag: "InternalError", message: String((err as Error).message ?? err) } };
  }
  s = {
    id,
    directory,
    agent: typeof body?.agent === "string" ? body.agent : defaultAgent(),
    model: (body?.model && typeof body.model === "object" && body.model.providerID && body.model.id)
      ? { providerID: String(body.model.providerID), id: String(body.model.id) }
      : defaultModel(),
    maki,
    translator,
    pending: new Map(),
    controls: new Map(),
    created: Date.now(),
    updated: Date.now(),
  };
  sessions.set(id, s);
  if (payload?.data) {
    payload.data = { ...payload.data, id, projectID, time: { ...payload.data.time, created: s.created, updated: s.updated }, location: { directory } };
  }
  return { status, payload };
}

function listSessions(): { status: number; payload: AnyObj } {
  const { payload } = synthesize("GET", "/api/session", asUrl("/api/session"), null, CANONICAL);
  return { status: 200, payload: { ...payload, data: [...sessions.values()].map(sessionObject) } };
}

// files[] -> what the pinned child can take: base64 image blocks in Maki's
// media types (maki-providers types.rs v0.6.4 L30–L35). PDFs and other data
// URIs have no block on the inbound `user` wire (sdk_mode.rs L786–L816), and a
// `file://` URI names a host path the bridge does not read on a client's
// behalf; the mention text stays in the prompt either way
const IMAGE_DATA_URI = /^data:(image\/(?:png|jpeg|gif|webp));base64,((?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)$/;

function promptImages(files: unknown): { blocks: ImageBlock[]; delivered: AnyObj[] } {
  const blocks: ImageBlock[] = [];
  const delivered: AnyObj[] = [];
  for (const file of Array.isArray(files) ? files : []) {
    const m = IMAGE_DATA_URI.exec(typeof file?.uri === "string" ? file.uri : "");
    if (!m || !m[2]) continue;
    blocks.push({ type: "image", source: { type: "base64", media_type: m[1]!, data: m[2] } });
    // the admitted prompt reports a delivered file in the pinned Prompt shape
    // (opencode v2.0.32 schema/src/prompt.ts FileAttachment)
    delivered.push({
      data: m[2], mime: m[1], source: { type: "inline" },
      ...(typeof file.name === "string" ? { name: file.name } : {}),
      ...(typeof file.description === "string" ? { description: file.description } : {}),
    });
  }
  return { blocks, delivered };
}

function prompt(sid: string, body: AnyObj, url: URL): { status: number; payload: any } {
  const s = sessions.get(sid);
  if (!s) return sessionNotFound(sid);
  if (!s.maki.running) {
    return { status: 503, payload: { _tag: "ServiceUnavailableError", message: "maki session is not running" } };
  }
  const text = String(body?.text ?? "");
  const userMsgID = typeof body?.id === "string" && /^msg_/.test(body.id) ? body.id : mintMessage();
  // mint the turn's assistant message id before maki can answer, so every part
  // event of the turn carries the same msg_ (mapping-table.md §5); the user
  // frame goes out first, before the child is written to, so the transcript
  // orders Q-A-Q-A within and across turns (spec: "Prompt renders before its
  // response"; shape pinned live in evidence/cross-map.md)
  const images = promptImages(body?.files);
  const delivery = s.translator.beginTurn(mintMessage(), { text, id: userMsgID, delivery: String(body?.delivery ?? "steer"), files: images.delivered });
  s.maki.prompt(text, images.blocks);
  const { status, payload } = synthesize("POST", `/api/session/${sid}/prompt`, url, body, CANONICAL);
  const delivered = images.delivered.length ? { text, files: images.delivered } : { text };
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
  const decision = String(body?.decision ?? "");
  if (decision !== "once" && decision !== "always" && decision !== "reject") {
    // invalid reply: fail closed rather than letting the tool through
    s.maki.answer(pending.requestID, "deny");
    s.pending.delete(perID);
    return { status: 400, payload: { _tag: "InvalidRequestError", message: `invalid decision: ${decision}` } };
  }
  emit("permission.replied", { sessionID: s.id, requestID: perID, reply: decision });
  // the bridge caches nothing: `always` becomes Maki's session-scoped allow,
  // and Maki decides which later calls its session rule covers; a reject
  // reason reaches the model as guidance
  const message = typeof body?.message === "string" ? body.message : "";
  if (decision === "always") s.maki.answer(pending.requestID, "allow", { updatedPermissions: sessionRule(pending.toolName) });
  else if (decision === "reject") s.maki.answer(pending.requestID, "deny", message ? { message } : {});
  else s.maki.answer(pending.requestID, "allow");
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
  const requestID = s.maki.setModel(providerID === "maki" ? id : `${providerID}/${id}`);
  s.controls.set(requestID, (ack) => {
    if (ack.subtype === "success") {
      s.translator.announceModel(model);
      emit("model.updated", { sessionID: s.id });
    } else {
      console.error(`[bridge] session ${s.id}: maki refused model ${providerID}/${id}: ${ack.error ?? "unknown error"}`);
    }
  });
  return { status: 204, payload: null };
}

// session.interrupt: `interrupted` says whether an active execution was
// stopped, so an idle session is the pinned no-op and nothing is written
function interrupt(s: BridgeSession): { status: number; payload: any } {
  if (!s.translator.inTurn || !s.maki.running) return { status: 200, payload: { interrupted: false } };
  // a run parked on a permission ask is unparked with a deny first; the ask is
  // then settled for the TUI too, since maki forgets it when the run ends
  for (const [perID, pending] of s.pending) {
    s.maki.answer(pending.requestID, "deny");
    emit("permission.replied", { sessionID: s.id, requestID: perID, reply: "reject" });
  }
  s.pending.clear();
  s.translator.markInterrupted();
  s.controls.set(s.maki.interrupt(), () => {});
  return { status: 200, payload: { interrupted: true } };
}

function onMakiFrame(sessionID: string, frame: AnyObj): void {
  const s = sessions.get(sessionID);
  if (!s) return;
  if (frame.type === "control_request" && frame.request?.subtype === "can_use_tool") {
    // maki blocks this tool call until the TUI's reply reaches control_response
    const req = frame.request ?? {};
    const toolName = String(req.tool_name ?? "tool");
    const toolUseID = String(req.tool_use_id ?? "");
    const perID = mintPermission();
    s.pending.set(perID, {
      requestID: String(frame.request_id ?? ""),
      toolName,
      toolUseID,
      messageID: s.translator.assistantMessageID,
      message: `Maki wants to run: ${toolName} ${JSON.stringify(req.input ?? {})}`,
    });
    // object-form Permission.Source (design decision 4); `save` lists what the
    // TUI's "Always allow" names (opencode v2.0.32 tui/util/permission.ts),
    // here the tool the session rule is for
    emit("permission.asked", {
      id: perID,
      sessionID,
      action: "allow",
      resources: [toolName],
      save: [toolName],
      message: `Maki wants to run: ${toolName} ${JSON.stringify(req.input ?? {})}`,
      source: { type: "tool", messageID: s.translator.assistantMessageID, id: toolUseID },
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

function onMakiExit(sessionID: string): void {
  const s = sessions.get(sessionID);
  if (!s) return;
  s.translator.abortTurn("maki process exited");
  console.error(`[bridge] maki exited behind session ${sessionID}`);
}

function sessionRoute(method: string, sid: string, rest: string, body: AnyObj, url: URL): { status: number; payload: any } {
  if (rest === "") {
    const s = sessions.get(sid);
    if (method === "GET") return s ? { status: 200, payload: { data: sessionObject(s) } } : sessionNotFound(sid);
    if (method === "DELETE") {
      if (!s) return sessionNotFound(sid);
      s.maki.kill();
      sessions.delete(sid);
      return { status: 204, payload: null };
    }
  }
  const s = sessions.get(sid);
  if (!s) return sessionNotFound(sid);
  if (rest === "prompt" && method === "POST") return prompt(sid, body, url);
  if (rest === "model" && method === "POST") return selectModel(s, body);
  if (rest === "agent" && method === "POST") {
    if (typeof body?.agent === "string") s.agent = body.agent;
    return { status: 204, payload: null };
  }
  if (rest === "permission" && method === "GET") {
    const { status, payload } = synthesize(method, `/api/session/${sid}/permission`, url, body, CANONICAL);
    return { status, payload: { ...payload, data: pendingList(s) } };
  }
  if (rest === "interrupt" && method === "POST") return interrupt(s);
  const reply = /^permission\/([^/]+)\/reply$/.exec(rest);
  if (reply && method === "POST") return replyPermission(s, reply[1]!, body);
  // deferred session surfaces (message/inbox/form/terminal, resume/fork/…)
  // answer from the spec set with the spike's minimal fakes
  return synthesize(method, `/api/session/${sid}${rest ? `/${rest}` : ""}`, url, body, CANONICAL);
}

// /api/model must name the model a live child has announced, not a spec
// placeholder (design decision 3); synthesis serves only before an announcement
function modelList(url: URL): { status: number; payload: any } {
  const result = synthesize("GET", "/api/model", url, null, CANONICAL);
  const announced = [...sessions.values()].map((s) => s.translator.announcedModel).find(Boolean);
  if (announced && Array.isArray(result.payload?.data) && result.payload.data[0]) {
    const first = result.payload.data[0];
    result.payload.data[0] = { ...first, id: announced.id, modelID: announced.id, providerID: announced.providerID, name: announced.id, enabled: true };
  }
  return result;
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
    capabilities: { persistentPty: false },
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

// /api/project and /api/location name the one project the bridge serves
async function projectList(url: URL): Promise<{ status: number; payload: any }> {
  await projectReady;
  const { status } = synthesize("GET", "/api/project", url, null, CANONICAL);
  const active = Math.max(BOOTED, ...[...sessions.values()].map((s) => s.updated));
  const project: AnyObj = { id: projectID, canonical: CANONICAL, name: posix.basename(CANONICAL) || CANONICAL };
  if (projectVcs) project.vcs = projectVcs;
  project.time = { created: BOOTED, updated: BOOTED, active };
  project.sandboxes = [];
  return { status, payload: [project] };
}

async function location(url: URL): Promise<{ status: number; payload: any }> {
  await projectReady;
  const result = synthesize("GET", "/api/location", url, null, CANONICAL);
  result.payload = { ...result.payload, project: { ...result.payload.project, id: projectID } };
  return result;
}

// /api/vcs: the footer's `dir:branch` and the sidebar read the checkout's
// branch (tui prompt/index.tsx v2.0.32 L1620), read fresh from the sandbox on
// every location sync
async function vcsInfo(url: URL): Promise<{ status: number; payload: any }> {
  const { status, payload } = synthesize("GET", "/api/vcs", url, null, CANONICAL);
  const git = await readGitState(CANONICAL);
  const branch: AnyObj = {};
  if (git.branch) branch.current = git.branch;
  if (git.defaultBranch) branch.default = git.defaultBranch;
  const data: AnyObj = git.root || git.branch ? { provider: "git", branch } : { branch };
  return { status, payload: { ...payload, data } };
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
async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const method = req.method.toUpperCase();
  const path = url.pathname;
  const bodyText = method === "GET" || method === "HEAD" ? "" : await req.text();
  let body: AnyObj = {};
  if (bodyText) { try { body = JSON.parse(bodyText); } catch { body = { raw: bodyText }; } }

  if (method === "GET" && path === "/api/event") return openEventStream();

  let result: { status: number; payload: any; matched?: boolean };
  const parts = path.split("/"); // ["", "api", "session", <sid>, ...rest]
  if (parts[1] === "api" && parts[2] === "session" && parts.length === 3) {
    // a session names its project, so creation waits for the id like every
    // other answer that names one
    if (method === "POST") result = (await projectReady, createSession(body));
    else if (method === "GET") result = listSessions();
    else result = synthesize(method, path, url, body, CANONICAL);
  } else if (parts[1] === "api" && parts[2] === "session" && parts[3] && parts[3] !== "active") {
    result = sessionRoute(method, parts[3]!, parts.slice(4).join("/"), body, url);
  } else if (method === "GET" && path === "/api/model") {
    result = modelList(url);
  } else if (method === "GET" && path === "/api/session/active") {
    result = activeSessions(url);
  } else if (method === "GET" && path === "/api/project") {
    result = await projectList(url);
  } else if (method === "GET" && path === "/api/location") {
    result = await location(url);
  } else if (method === "GET" && path === "/api/vcs") {
    result = await vcsInfo(url);
  } else if (method === "GET" && path === "/api/fs/list") {
    result = await fsList(url);
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
  for (const s of sessions.values()) s.maki.kill();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", () => { for (const s of sessions.values()) s.maki.kill(); });

// server.port (not PORT): with PORT=0 the listen line must name the bound
// port, which is what wait_for_bridge_port parses
const server = Bun.serve({ port: PORT, hostname: "127.0.0.1", idleTimeout: 0, fetch: handle });
console.log(`bridge listening on http://127.0.0.1:${server.port} (canonical: ${CANONICAL})`);
