// Maki SDK wire -> OpenCode event frames (mapping-table.md, field by field).
// The buffered `assistant` message path is the floor (design decision 5);
// `stream_event` deltas are an enhancement on top of it.
import type { AnyObj } from "./spec-answers.ts";

export interface Sink {
  emit(type: string, data: AnyObj, durableVersion?: number): void;
}

export interface TranslatorHooks {
  sink: Sink;
  sessionID: string;
  agent: () => string;
  model: () => { providerID: string; id: string };
  /** first `system.init` of the process: maki's session id, cwd, model, tools */
  onInit?: (info: { sessionID: string; cwd: string; model: string; tools: string[] }) => void;
  /** turn result, for session cost/token bookkeeping */
  onResult?: (result: AnyObj) => void;
  /** a `Task` call is a subagent (plugins/task/init.lua v0.6.4): the bridge
   * runs it as a child session; frames flagged with its id go there */
  subagent?: {
    start(toolUseID: string, input: AnyObj): string | undefined;
    frame(toolUseID: string, frame: AnyObj): boolean;
    end(toolUseID: string, isError: boolean, text: string): void;
  };
  /** a prompt's turn starts: write it to the child now, after the synthetic
   * inputs admitted before it (shell notices), which ride as its preamble */
  deliver?: (user: UserPrompt, preamble: string[]) => void;
}

// the child is the single source of model identity (design decision 3):
// `provider/id` splits on the first "/", ids without one keep the raw value
// under the "maki" provider
function parseModel(raw: unknown): { providerID: string; id: string } | undefined {
  if (typeof raw !== "string" || !raw) return undefined;
  const slash = raw.indexOf("/");
  return slash === -1 ? { providerID: "maki", id: raw } : { providerID: raw.slice(0, slash), id: raw.slice(slash + 1) };
}

// durable events carry {aggregateID, seq, version}; versions are binary-derived
// (spike stub measurement), delta/permission events are ephemeral
const DURABLE_VERSION: Record<string, number> = {
  "session.execution.started": 1, "session.execution.succeeded": 1, "session.execution.interrupted": 1,
  "session.step.started": 1, "session.step.ended": 1, "session.step.failed": 1,
  "session.reasoning.started": 1, "session.reasoning.ended": 1,
  "session.text.started": 1, "session.text.ended": 1,
  "session.tool.input.started": 1, "session.tool.input.ended": 1,
  "session.tool.called": 1, "session.tool.success": 2, "session.tool.failed": 2,
  "session.retry.scheduled": 1,
  "session.inbox.delivered": 1, "session.inbox.delivery.changed": 1, "session.inbox.cancelled": 1,
};

// `child` is what the Maki child is sent when the prompt's turn starts (its
// text and image blocks); the bridge holds a queued prompt until then
type UserPrompt = { text: string; id: string; delivery: string; files?: AnyObj[]; skills?: AnyObj[]; child?: unknown; created?: number };

/** the pinned Prompt payload of an admitted user prompt */
export const userPayload = (u: { text: string; files?: AnyObj[]; skills?: AnyObj[] }): AnyObj => ({
  text: u.text,
  ...(u.files?.length ? { files: u.files } : {}),
  ...(u.skills?.length ? { skills: u.skills } : {}),
});

// maki's tool names are PascalCase (Bash, Read, TodoWrite); the OpenCode side
// spells them lowerCamel (mapping-table.md §3)
const toolName = (name: unknown): string => {
  const s = typeof name === "string" && name ? name : "tool";
  return s[0]!.toLowerCase() + s.slice(1);
};

type PartKind = "reasoning" | "text" | "tool";
// `replayed`: the pinned child streams a tool_use block after the buffered
// message already carried it (sdk_mode.rs v0.6.4 L1037–L1052 after L1115), so
// the block repeats a part the TUI has and emits nothing
interface StreamPart { ordinal: number; ended: boolean; text: string; id?: string; name?: string; replayed?: boolean }

export class Translator {
  private hooks: TranslatorHooks;
  private am = ""; // the turn's minted assistant message id
  private turnOpen = false;
  private interruptRequested = false;
  // prompts admitted while a turn runs: the pinned child answers each stdin
  // prompt in its own run after the current one (sdk_mode.rs v0.6.4 L701,
  // L763) and cannot take one back, so the bridge holds them and writes each
  // when its turn starts; until then the TUI can list or cancel them
  private queued: { am: string; user?: UserPrompt }[] = [];
  // synthetic inputs (a user shell's notice) wait for the next turn, as
  // OpenCode admits them with resume:false (core session/session.ts v2.0.32
  // L213–L219, L273–L303)
  private synthetics: { id: string; text: string }[] = [];
  // the model the child last announced (system.init / assistant.model);
  // synthesized defaults serve only until then (design decision 3)
  private announced?: { providerID: string; id: string };
  // per-kind part indexes: the same part keeps the same index (and ordinal)
  // whether it arrived streamed or buffered
  private counts: Record<PartKind, number> = { reasoning: 0, text: 0, tool: 0 };
  private streamCursor: Record<PartKind, number> = { reasoning: 0, text: 0, tool: 0 };
  private streamed = new Map<string, StreamPart>();
  // tool ids the turn already rendered, from either path
  private toolIDs = new Set<string>();
  // the usage of the turn's last model call: each assistant frame carries its
  // own call's, while `result` carries the run total (sdk_mode.rs v0.6.4
  // L1090–L1112, L1162–L1178)
  private lastUsage?: AnyObj;
  // a provider retry was announced: the next attempt restarts the step
  private retryPending = false;
  // subagent tool ids -> their child session ids, and the ones still running
  private subagents = new Map<string, string>();
  private runningSubagents: string[] = [];
  // tools a subagent called -> its child session: the pinned can_use_tool
  // names only the tool id (sdk_mode.rs v0.6.4 L1122–L1160)
  private subagentTools = new Map<string, string>();
  // the task call's own streamed block (it follows the buffered call) is the
  // parent's, not the subagent's
  private inTaskBlock = false;

  constructor(hooks: TranslatorHooks) {
    this.hooks = hooks;
  }

  get assistantMessageID(): string {
    return this.am;
  }

  /** a turn has begun and its result has not arrived */
  get inTurn(): boolean {
    return this.turnOpen;
  }

  /** the TUI interrupted this turn: its error result ends it as interrupted */
  markInterrupted(): void {
    if (this.turnOpen) this.interruptRequested = true;
  }

  /** the child acked a model switch: it is the model from now on */
  announceModel(model: { providerID: string; id: string }): void {
    this.announced = model;
  }

  /** the child's announced model, or undefined before the first announcement */
  get announcedModel(): { providerID: string; id: string } | undefined {
    return this.announced;
  }

  private modelNow(): { providerID: string; id: string } {
    return this.announced ?? this.hooks.model();
  }

  /** prompt accepted: turn boundary frames (mapping-table.md §2). The user
   * prompt representation is emitted here, at admission, because maki never
   * echoes plain user text (cross-map.md pinned shape). Returns the delivery
   * the item really gets: a prompt admitted mid-turn waits for the running
   * turn, so a `steer` is reported as `queue`. */
  beginTurn(assistantMessageID: string, user?: UserPrompt): string | undefined {
    if (this.turnOpen) {
      if (user) {
        this.enqueue(assistantMessageID, user);
        if (user.delivery !== "queue") {
          this.hooks.sink.emit("session.inbox.delivery.changed",
            { sessionID: this.hooks.sessionID, inboxID: user.id, delivery: "queue" }, DURABLE_VERSION["session.inbox.delivery.changed"]);
        }
      }
      this.queued.push({ am: assistantMessageID, user });
      return user ? "queue" : undefined;
    }
    // The prompt is represented at admission, but delivery belongs to the
    // common turn-start path: a prompt that starts at once and a prompt that
    // waited behind a running turn must report the same enqueued -> delivered
    // -> assistant sequence (the TUI renders the reply after delivery).
    if (user) this.enqueue(assistantMessageID, user);
    this.startTurn(assistantMessageID, user);
    return user?.delivery;
  }

  private enqueue(am: string, user: UserPrompt): void {
    this.hooks.sink.emit("session.inbox.enqueued", {
      sessionID: this.hooks.sessionID,
      assistantMessageID: am,
      inboxID: user.id,
      item: { type: "user", payload: userPayload(user), delivery: user.delivery },
    }, 1);
  }

  private startTurn(assistantMessageID: string, user?: UserPrompt): void {
    if (user) {
      const preamble = this.synthetics.splice(0);
      for (const item of preamble) this.emitExec("session.inbox.delivered", { inboxID: item.id });
      this.emitExec("session.inbox.delivered", { inboxID: user.id });
      this.hooks.deliver?.(user, preamble.map((item) => item.text));
    }
    this.am = assistantMessageID;
    this.turnOpen = true;
    this.interruptRequested = false;
    this.counts = { reasoning: 0, text: 0, tool: 0 };
    this.streamCursor = { reasoning: 0, text: 0, tool: 0 };
    this.streamed = new Map();
    this.toolIDs = new Set();
    this.lastUsage = undefined;
    this.retryPending = false;
    this.emitExec("session.execution.started", {});
    this.startStep();
  }

  private startStep(): void {
    this.emit("session.step.started", {
      sessionID: this.hooks.sessionID,
      assistantMessageID: this.am,
      agent: this.hooks.agent(),
      model: this.modelNow(),
      started: Date.now(),
    });
  }

  /** the attempt after a retry starts its step again on the same message,
   * as OpenCode's retried attempt does, which clears the retry row (client
   * data.ts v2.0.32 L881–L895) */
  private resumeAfterRetry(): void {
    if (!this.retryPending) return;
    this.retryPending = false;
    this.startStep();
  }

  /** the running turn ended: the next queued prompt's run begins */
  private startNext(): void {
    const next = this.queued.shift();
    if (!next) return;
    this.startTurn(next.am, next.user);
  }

  /** admits a synthetic input for the next turn */
  admitSynthetic(id: string, payload: { text: string; description?: string; metadata?: AnyObj }): void {
    this.synthetics.push({ id, text: payload.text });
    this.hooks.sink.emit("session.inbox.enqueued", {
      sessionID: this.hooks.sessionID,
      inboxID: id,
      item: { type: "synthetic", payload, delivery: "steer" },
    }, 1);
  }

  /** prompts waiting for their turn, in delivery order (session.inbox.list) */
  get pending(): UserPrompt[] {
    return this.queued.flatMap((q) => (q.user ? [q.user] : []));
  }

  /** drops a waiting prompt before the child sees it; false when it is not
   * waiting (already delivered or unknown), which the pinned cancel treats as
   * a no-op (server handlers/session.ts v2.0.32 L552–L560) */
  cancelPending(inboxID: string): boolean {
    const at = this.queued.findIndex((q) => q.user?.id === inboxID);
    if (at < 0) return false;
    this.queued.splice(at, 1);
    this.emitExec("session.inbox.cancelled", { inboxID });
    return true;
  }

  /** the child session a tool call belongs to: a subagent's own call, or,
   * for a call not seen yet, the subagent the parent is waiting on (the
   * parent run is blocked on its task call meanwhile); undefined for the
   * session's own calls */
  toolOwner(toolUseID: string): string | undefined {
    const known = this.subagentTools.get(toolUseID);
    if (known) return known;
    if (this.toolIDs.has(toolUseID) || this.subagents.has(toolUseID)) return undefined;
    const running = this.runningSubagents.at(-1);
    return running ? this.subagents.get(running) : undefined;
  }

  /** maki died with a turn in flight: fail the execution instead of a stuck
   * spinner, and cancel what was queued behind it (no child will answer it) */
  abortTurn(message: string): void {
    if (!this.turnOpen) return;
    this.turnOpen = false;
    this.emitExec("session.execution.failed", { error: { type: "Error", message } });
    for (const q of this.queued.splice(0)) {
      if (q.user) this.emitExec("session.inbox.cancelled", { inboxID: q.user.id });
    }
  }

  onFrame(frame: AnyObj): void {
    // the pinned child flags a subagent's buffered frames but not its stream
    // events (sdk_mode.rs v0.6.4 L1022–L1050); the parent run waits on the
    // task call meanwhile, so a stream event then is the running subagent's
    const flagged = typeof frame.parent_tool_use_id === "string" ? frame.parent_tool_use_id : undefined;
    if (!flagged && frame.type === "stream_event") {
      const ev = frame.event ?? {};
      if (ev.type === "content_block_start" && ev.content_block?.type === "tool_use" && this.subagents.has(String(ev.content_block.id ?? ""))) {
        this.inTaskBlock = true;
      }
    }
    const owner = flagged ?? (frame.type === "stream_event" && !this.inTaskBlock ? this.runningSubagents.at(-1) : undefined);
    if (this.inTaskBlock && frame.type === "stream_event" && frame.event?.type === "content_block_stop") this.inTaskBlock = false;
    if (owner && this.subagents.has(owner)) {
      const child = this.subagents.get(owner)!;
      for (const id of toolUseIDs(frame)) this.subagentTools.set(id, child);
      if (this.hooks.subagent?.frame(owner, frame)) return;
    }
    switch (frame.type) {
      case "system":
        if (frame.subtype === "init") {
          this.announced = parseModel(frame.model) ?? this.announced;
          this.hooks.onInit?.({
            sessionID: frame.session_id,
            cwd: frame.cwd,
            model: frame.model,
            tools: frame.tools ?? [],
          });
        } else if (frame.subtype === "api_retry" && this.turnOpen) {
          // the pinned event names the turn's assistant message, so a retry
          // outside a turn has nothing to attach to and stays tolerated
          // Maki counts the failures so far and names the backoff
          // (maki-agent streaming.rs v0.6.4 L214–L325); the pinned event names
          // the upcoming attempt and when it runs (core runner/retry.ts
          // v2.0.32 L67–L110)
          // a second retry means the retried attempt ran (and failed) first
          this.resumeAfterRetry();
          const failures = Number.isInteger(frame.attempt) && frame.attempt > 0 ? frame.attempt : 1;
          const delay = typeof frame.retry_delay_ms === "number" && frame.retry_delay_ms > 0 ? frame.retry_delay_ms : 0;
          this.emit("session.retry.scheduled", {
            attempt: failures + 1,
            at: Date.now() + delay,
            error: { type: "Error", message: String(frame.error ?? "provider retry") },
          });
          this.retryPending = true;
        }
        break;
      case "assistant": this.resumeAfterRetry(); this.handleAssistant(frame); break;
      case "user": this.handleUser(frame); break;
      case "stream_event": this.resumeAfterRetry(); this.handleStreamEvent(frame); break;
      case "result": this.handleResult(frame); break;
      default: break; // control_* and unknown types are the bridge's business
    }
  }

  // ---------- buffered `assistant` message (the floor) ----------
  private handleAssistant(frame: AnyObj): void {
    // every assistant message names the model that produced it
    this.announced = parseModel(frame.message?.model) ?? this.announced;
    // a subagent's call (parent_tool_use_id set) is not the parent step's
    if (!frame.parent_tool_use_id && frame.message?.usage && typeof frame.message.usage === "object") {
      this.lastUsage = frame.message.usage;
    }
    const content = frame.message?.content;
    if (!Array.isArray(content)) return;
    for (const part of content) {
      if (part?.type === "thinking") {
        const index = this.counts.reasoning++;
        const text = String(part.thinking ?? "");
        if (this.finishStreamed("reasoning", index, text)) continue;
        this.reasoning(index, text);
      } else if (part?.type === "text") {
        const index = this.counts.text++;
        const text = String(part.text ?? "");
        if (this.finishStreamed("text", index, text)) continue;
        this.textPart(index, text);
      } else if (part?.type === "tool_use") {
        this.toolPart(this.counts.tool++, part);
      }
    }
  }

  private reasoning(ordinal: number, text: string): void {
    this.emit("session.reasoning.started", { ordinal });
    this.emit("session.reasoning.delta", { ordinal, delta: text });
    this.emit("session.reasoning.ended", { ordinal, text });
  }

  private textPart(ordinal: number, text: string): void {
    this.emit("session.text.started", { ordinal });
    this.emit("session.text.delta", { ordinal, delta: text });
    this.emit("session.text.ended", { ordinal, text });
  }

  private toolPart(index: number, part: AnyObj): void {
    const id = String(part.id ?? `tool_${index}`);
    const input = part.input ?? {};
    const streamed = this.streamed.get(`tool:${index}`);
    this.toolIDs.add(id);
    if (!streamed) {
      this.emit("session.tool.input.started", { id, name: toolName(part.name) });
      this.emit("session.tool.input.ended", { id, text: JSON.stringify(input) });
    } else if (!streamed.ended) {
      // streaming showed partial input; the buffered message has the full JSON
      this.emit("session.tool.input.ended", { id, text: JSON.stringify(input) });
      streamed.ended = true;
    }
    // executed reports a provider-executed call (publish-llm-event.ts v2.0.32
    // L391); every Maki tool runs in the child
    this.emit("session.tool.called", { id, input, executed: false });
    // a subagent's tool part names its child session, as OpenCode's subagent
    // tool reports progress (core tool/plugin/subagent.ts v2.0.32 L200)
    if (part.name === "Task" && !this.subagents.has(id)) {
      const child = this.hooks.subagent?.start(id, input);
      if (child) {
        this.subagents.set(id, child);
        this.runningSubagents.push(id);
        this.emit("session.tool.progress", { id, metadata: { sessionID: child, status: "running" } });
      }
    }
  }

  // ---------- `user` message with tool_result parts ----------
  private handleUser(frame: AnyObj): void {
    const content = frame.message?.content;
    if (!Array.isArray(content)) return;
    for (const part of content) {
      if (part?.type !== "tool_result") continue;
      const id = String(part.tool_use_id ?? "");
      const child = this.subagents.get(id);
      const metadata = child ? { metadata: { sessionID: child, status: part.is_error ? "error" : "completed" } } : {};
      if (child) {
        this.runningSubagents = this.runningSubagents.filter((x) => x !== id);
        this.hooks.subagent?.end(id, part.is_error === true, resultText(part.content));
      }
      if (part.is_error) {
        // spec error shape is {type, message} (mapping-table.md §3); the
        // spike's stub emitted {name, data} and the TUI tolerated it
        this.emit("session.tool.failed", { id, error: { type: "Error", message: resultText(part.content) }, executed: false, ...metadata });
      } else {
        this.emit("session.tool.success", { id, content: resultContent(part.content), executed: false, ...metadata });
      }
    }
  }

  // ---------- `stream_event` deltas (enhancement, cost 6) ----------
  // Two spellings reach here: the authored fixture puts the variant on the
  // frame (`subtype`) with a flat `delta`, while the live wire (captured
  // 2026-10-23, fixture maki-stream-live.jsonl) wraps it in
  // `content_block_delta` with the variant on `event.delta.type`. Both are
  // accepted; unknown variants are dropped and the buffered message is the
  // floor, so a wrong guess degrades to buffering rather than losing text.
  // shortcut: tool_use input deltas are still not observed live (the captured
  // turn was text-only); maki-stream.jsonl authors that block. Extend after a
  // tool-streaming capture.
  private handleStreamEvent(frame: AnyObj): void {
    const ev = frame.event ?? frame.data ?? frame;
    const payload = ev?.delta ?? ev;
    let kind = frame.subtype ?? ev?.type ?? ev?.subtype;
    if (kind === "content_block_delta") kind = payload?.type;
    switch (kind) {
      case "content_block_start": {
        const block = ev?.content_block ?? ev ?? {};
        const partKind = block.type === "thinking" ? "reasoning" : block.type === "text" ? "text"
          : block.type === "tool_use" ? "tool" : null;
        if (!partKind) break;
        const ordinal = this.streamCursor[partKind]!;
        this.streamCursor[partKind] = ordinal + 1;
        const state: StreamPart = { ordinal, ended: false, text: "", id: block.id, name: block.name };
        this.streamed.set(`${partKind}:${ordinal}`, state);
        if (partKind === "tool" && this.toolIDs.has(String(block.id ?? ""))) state.replayed = true;
        else if (partKind === "tool") {
          this.toolIDs.add(String(block.id ?? ""));
          this.emit("session.tool.input.started", { id: String(block.id ?? ""), name: toolName(block.name) });
        } else this.emit(`session.${partKind}.started`, { ordinal });
        break;
      }
      case "thinking_delta":
      case "text_delta": {
        const partKind: PartKind = kind === "thinking_delta" ? "reasoning" : "text";
        const delta = String(payload?.text ?? payload?.thinking ?? (typeof payload === "string" ? payload : ""));
        const state = this.openStreamPart(partKind);
        state.text += delta;
        this.emit(`session.${partKind}.delta`, { ordinal: state.ordinal, delta });
        break;
      }
      case "input_json_delta": {
        // no block start seen -> no id to key the delta on; the buffered tool
        // part renders it instead
        const state = this.openStreamPart("tool");
        if (!state.id || state.replayed) break;
        const delta = String(payload?.partial_json ?? "");
        state.text += delta;
        this.emit("session.tool.input.delta", { id: state.id, delta });
        break;
      }
      case "content_block_stop": {
        const block = ev?.content_block ?? {};
        const partKind: PartKind | null = block.type === "thinking" ? "reasoning" : block.type === "text" ? "text"
          : block.type === "tool_use" ? "tool" : null;
        for (const kind of partKind ? [partKind] : (["tool", "text", "reasoning"] as PartKind[])) {
          const state = this.latestOpen(kind);
          if (!state) continue;
          state.ended = true;
          if (kind === "tool") {
            if (state.id && !state.replayed) this.emit("session.tool.input.ended", { id: state.id, text: state.text });
          } else {
            this.emit(`session.${kind}.ended`, { ordinal: state.ordinal, text: state.text });
          }
          break;
        }
        break;
      }
      default:
        break; // message_start/delta/stop carry no part-level info we render
    }
  }

  private openStreamPart(kind: PartKind): StreamPart {
    const open = this.latestOpen(kind);
    if (open) return open;
    const ordinal = this.streamCursor[kind]!;
    this.streamCursor[kind] = ordinal + 1;
    const state: StreamPart = { ordinal, ended: false, text: "" };
    this.streamed.set(`${kind}:${ordinal}`, state);
    if (kind !== "tool") this.emit(`session.${kind}.started`, { ordinal });
    return state;
  }

  private latestOpen(kind: PartKind): StreamPart | undefined {
    let found: StreamPart | undefined;
    for (const [key, state] of this.streamed) {
      if (key.startsWith(`${kind}:`) && !state.ended) found = state;
    }
    return found;
  }

  /** a part rendered by the stream: finish it from the buffered text (or skip if already ended) */
  private finishStreamed(kind: PartKind, index: number, text: string): boolean {
    const state = this.streamed.get(`${kind}:${index}`);
    if (!state) return false;
    if (!state.ended) {
      state.ended = true;
      if (kind !== "tool") this.emit(`session.${kind}.ended`, { ordinal: state.ordinal, text });
    }
    return true;
  }

  // ---------- `result`: turn end ----------
  private handleResult(frame: AnyObj): void {
    if (!this.turnOpen) return;
    this.turnOpen = false;
    const ok = frame.subtype === "success" && !frame.is_error;
    const data: AnyObj = { finish: ok ? "stop" : "error" };
    // a step is one model call in OpenCode, and the TUI's context counter reads
    // the last step's tokens (tui util/session.ts v2.0.32 L45–L59)
    const usage = this.lastUsage ?? frame.usage;
    if (usage) {
      data.tokens = {
        input: usage.input_tokens ?? 0,
        output: usage.output_tokens ?? 0,
        reasoning: 0,
        cache: { read: usage.cache_read_input_tokens ?? 0, write: usage.cache_creation_input_tokens ?? 0 },
      };
    }
    if (typeof frame.total_cost_usd === "number" && frame.total_cost_usd > 0) data.cost = frame.total_cost_usd;
    // an interrupted step fails with the pinned interruption error and no
    // usage, which the TUI shows as `· interrupted` (core runner/step.ts
    // v2.0.32 L63, L225; publish-llm-event.ts L420–L437)
    const message = String(frame.result ?? frame.subtype ?? "maki turn failed");
    if (!ok && this.interruptRequested) {
      this.emit("session.step.failed", { error: { type: "aborted", message: "Step interrupted" } });
    } else if (!ok) {
      // a failed step carries its error, which the TUI renders under the turn
      // (client data.ts v2.0.32 L933–L945; tui session/index.tsx L1905–L1909)
      this.emit("session.step.failed", { error: { type: "Error", message } });
    } else this.emit("session.step.ended", data);
    if (ok) this.emitExec("session.execution.succeeded", {});
    // maki reports a cancelled run as an error result (sdk_mode.rs v0.6.4
    // L1168–L1172); after an interrupt that is the pinned interrupted end
    // (session-event.ts v2.0.32 Execution.Interrupted), not a failure
    else if (this.interruptRequested) this.emitExec("session.execution.interrupted", { reason: "user" });
    else {
      this.emitExec("session.execution.failed", { error: { type: "Error", message } });
    }
    this.hooks.onResult?.(frame);
    this.startNext();
  }

  /** part/step frames carry the turn's assistant message id */
  private emit(type: string, fields: AnyObj, durableVersion?: number): void {
    this.hooks.sink.emit(type, { sessionID: this.hooks.sessionID, assistantMessageID: this.am, ...fields },
      durableVersion ?? DURABLE_VERSION[type]);
  }

  /** execution frames carry only the session id (measured frame shape) */
  private emitExec(type: string, fields: AnyObj): void {
    this.hooks.sink.emit(type, { sessionID: this.hooks.sessionID, ...fields }, DURABLE_VERSION[type]);
  }
}

/** tool_result content is a string or a part list; normalize to plain text */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((c) => (typeof c === "string" ? c : String(c?.text ?? ""))).join("\n");
  }
  if (content && typeof content === "object") return String((content as AnyObj).text ?? "");
  return String(content ?? "");
}

function resultContent(content: unknown): AnyObj[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (Array.isArray(content)) {
    return content.map((c) => (typeof c === "string" ? { type: "text", text: c } : c)).filter(Boolean);
  }
  if (content && typeof content === "object") return [content as AnyObj];
  return [{ type: "text", text: String(content ?? "") }];
}

/** the tool_use ids a frame introduces: a streamed block's start or an
 * assistant message's tool_use blocks */
function toolUseIDs(frame: AnyObj): string[] {
  if (frame.type === "stream_event") {
    const block = frame.event?.type === "content_block_start" ? frame.event.content_block : undefined;
    return block?.type === "tool_use" && typeof block.id === "string" ? [block.id] : [];
  }
  if (frame.type === "assistant" && Array.isArray(frame.message?.content)) {
    return frame.message.content.filter((b: AnyObj) => b?.type === "tool_use" && typeof b.id === "string").map((b: AnyObj) => b.id);
  }
  return [];
}
