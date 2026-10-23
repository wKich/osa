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
  "session.step.started": 1, "session.step.ended": 1,
  "session.reasoning.started": 1, "session.reasoning.ended": 1,
  "session.text.started": 1, "session.text.ended": 1,
  "session.tool.input.started": 1, "session.tool.input.ended": 1,
  "session.tool.called": 1, "session.tool.success": 2, "session.tool.failed": 2,
  "session.retry.scheduled": 1,
  "session.inbox.delivered": 1, "session.inbox.delivery.changed": 1, "session.inbox.cancelled": 1,
};

type UserPrompt = { text: string; id: string; delivery: string; files?: AnyObj[] };

// maki's tool names are PascalCase (Bash, Read, TodoWrite); the OpenCode side
// spells them lowerCamel (mapping-table.md §3)
const toolName = (name: unknown): string => {
  const s = typeof name === "string" && name ? name : "tool";
  return s[0]!.toLowerCase() + s.slice(1);
};

type PartKind = "reasoning" | "text" | "tool";
interface StreamPart { ordinal: number; ended: boolean; text: string; id?: string; name?: string }

export class Translator {
  private hooks: TranslatorHooks;
  private am = ""; // the turn's minted assistant message id
  private turnOpen = false;
  private interruptRequested = false;
  // prompts admitted while a turn runs: the pinned child answers each stdin
  // prompt in its own run after the current one (sdk_mode.rs v0.6.4 L701,
  // L763), so their turns start in order as results land
  private queued: { am: string; user?: UserPrompt }[] = [];
  // the model the child last announced (system.init / assistant.model);
  // synthesized defaults serve only until then (design decision 3)
  private announced?: { providerID: string; id: string };
  // per-kind part indexes: the same part keeps the same index (and ordinal)
  // whether it arrived streamed or buffered
  private counts: Record<PartKind, number> = { reasoning: 0, text: 0, tool: 0 };
  private streamCursor: Record<PartKind, number> = { reasoning: 0, text: 0, tool: 0 };
  private streamed = new Map<string, StreamPart>();

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
    // shortcut: the real server also emits session.inbox.delivered once the
    // runner consumes the item; omitted for an item that starts at once (no
    // consumer needs it) and emitted for a queued one, which stays pending in
    // OpenCode's inbox model until delivered or cancelled
    if (user) this.enqueue(assistantMessageID, user);
    this.startTurn(assistantMessageID);
    return user?.delivery;
  }

  private enqueue(am: string, user: UserPrompt): void {
    this.hooks.sink.emit("session.inbox.enqueued", {
      sessionID: this.hooks.sessionID,
      assistantMessageID: am,
      inboxID: user.id,
      item: { type: "user", payload: user.files?.length ? { text: user.text, files: user.files } : { text: user.text }, delivery: user.delivery },
    }, 1);
  }

  private startTurn(assistantMessageID: string): void {
    this.am = assistantMessageID;
    this.turnOpen = true;
    this.interruptRequested = false;
    this.counts = { reasoning: 0, text: 0, tool: 0 };
    this.streamCursor = { reasoning: 0, text: 0, tool: 0 };
    this.streamed = new Map();
    this.emitExec("session.execution.started", {});
    this.emit("session.step.started", {
      sessionID: this.hooks.sessionID,
      assistantMessageID: this.am,
      agent: this.hooks.agent(),
      model: this.modelNow(),
      started: Date.now(),
    });
  }

  /** the running turn ended: the next queued prompt's run begins */
  private startNext(): void {
    const next = this.queued.shift();
    if (!next) return;
    if (next.user) this.emitExec("session.inbox.delivered", { inboxID: next.user.id });
    this.startTurn(next.am);
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
          const attempt = Number.isInteger(frame.attempt) && frame.attempt > 0 ? frame.attempt : 1;
          this.emit("session.retry.scheduled", {
            attempt,
            at: Date.now(),
            error: { type: "Error", message: String(frame.error ?? "provider retry") },
          });
        }
        break;
      case "assistant": this.handleAssistant(frame); break;
      case "user": this.handleUser(frame); break;
      case "stream_event": this.handleStreamEvent(frame); break;
      case "result": this.handleResult(frame); break;
      default: break; // control_* and unknown types are the bridge's business
    }
  }

  // ---------- buffered `assistant` message (the floor) ----------
  private handleAssistant(frame: AnyObj): void {
    // every assistant message names the model that produced it
    this.announced = parseModel(frame.message?.model) ?? this.announced;
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
    if (!streamed) {
      this.emit("session.tool.input.started", { id, name: toolName(part.name) });
      this.emit("session.tool.input.ended", { id, text: JSON.stringify(input) });
    } else if (!streamed.ended) {
      // streaming showed partial input; the buffered message has the full JSON
      this.emit("session.tool.input.ended", { id, text: JSON.stringify(input) });
      streamed.ended = true;
    }
    this.emit("session.tool.called", { id, input });
  }

  // ---------- `user` message with tool_result parts ----------
  private handleUser(frame: AnyObj): void {
    const content = frame.message?.content;
    if (!Array.isArray(content)) return;
    for (const part of content) {
      if (part?.type !== "tool_result") continue;
      const id = String(part.tool_use_id ?? "");
      if (part.is_error) {
        // spec error shape is {type, message} (mapping-table.md §3); the
        // spike's stub emitted {name, data} and the TUI tolerated it
        this.emit("session.tool.failed", { id, error: { type: "Error", message: resultText(part.content) } });
      } else {
        this.emit("session.tool.success", { id, content: resultContent(part.content) });
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
        if (partKind === "tool") this.emit("session.tool.input.started", { id: String(block.id ?? ""), name: toolName(block.name) });
        else this.emit(`session.${partKind}.started`, { ordinal });
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
        if (!state.id) break;
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
            if (state.id) this.emit("session.tool.input.ended", { id: state.id, text: state.text });
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
    const usage = frame.usage;
    if (usage) {
      data.tokens = {
        input: usage.input_tokens ?? 0,
        output: usage.output_tokens ?? 0,
        reasoning: 0,
        cache: { read: usage.cache_read_input_tokens ?? 0, write: usage.cache_creation_input_tokens ?? 0 },
      };
    }
    if (typeof frame.total_cost_usd === "number" && frame.total_cost_usd > 0) data.cost = frame.total_cost_usd;
    this.emit("session.step.ended", data);
    if (ok) this.emitExec("session.execution.succeeded", {});
    // maki reports a cancelled run as an error result (sdk_mode.rs v0.6.4
    // L1168–L1172); after an interrupt that is the pinned interrupted end
    // (session-event.ts v2.0.32 Execution.Interrupted), not a failure
    else if (this.interruptRequested) this.emitExec("session.execution.interrupted", { reason: "user" });
    else {
      this.emitExec("session.execution.failed", {
        error: { type: "Error", message: String(frame.result ?? frame.subtype ?? "maki turn failed") },
      });
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
