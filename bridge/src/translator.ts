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
  "session.execution.started": 1, "session.execution.succeeded": 1,
  "session.step.started": 1, "session.step.ended": 1,
  "session.reasoning.started": 1, "session.reasoning.ended": 1,
  "session.text.started": 1, "session.text.ended": 1,
  "session.tool.input.started": 1, "session.tool.input.ended": 1,
  "session.tool.called": 1, "session.tool.success": 2, "session.tool.failed": 2,
};

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

  /** the child's announced model, or undefined before the first announcement */
  get announcedModel(): { providerID: string; id: string } | undefined {
    return this.announced;
  }

  private modelNow(): { providerID: string; id: string } {
    return this.announced ?? this.hooks.model();
  }

  /** prompt accepted: turn boundary frames (mapping-table.md §2). The user
   * prompt representation is emitted here, at admission, because maki never
   * echoes plain user text (cross-map.md pinned shape). */
  beginTurn(assistantMessageID: string, user?: { text: string; id: string; delivery: string }): void {
    this.am = assistantMessageID;
    this.turnOpen = true;
    this.counts = { reasoning: 0, text: 0, tool: 0 };
    this.streamCursor = { reasoning: 0, text: 0, tool: 0 };
    this.streamed = new Map();
    if (user) {
      // shortcut: the real server also emits session.inbox.delivered once the
      // runner consumes the item; omitted (no consumer needs it yet) — add it
      // when a TUI behavior is proven to depend on it
      this.emit("session.inbox.enqueued", {
        inboxID: user.id,
        item: { type: "user", payload: { text: user.text }, delivery: user.delivery },
      }, 1);
    }
    this.emitExec("session.execution.started", {});
    this.emit("session.step.started", {
      sessionID: this.hooks.sessionID,
      assistantMessageID: this.am,
      agent: this.hooks.agent(),
      model: this.modelNow(),
      started: Date.now(),
    });
  }

  /** maki died with a turn in flight: fail the execution instead of a stuck spinner */
  abortTurn(message: string): void {
    if (!this.turnOpen) return;
    this.turnOpen = false;
    this.emitExec("session.execution.failed", { error: { type: "Error", message } });
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
  // sdk_mode names the variants but their shapes are unverified on the wire:
  // shortcut: several envelope spellings are accepted and unknown ones are
  // dropped — with the buffered path as the floor, a wrong guess degrades to
  // buffering, not a broken transcript. Upgrade after capturing a streaming
  // provider's stream_event frames.
  private handleStreamEvent(frame: AnyObj): void {
    const ev = frame.event ?? frame.data ?? frame;
    const kind = frame.subtype ?? ev?.type ?? ev?.subtype;
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
        const delta = String(ev?.delta ?? ev?.[`${partKind}_delta`] ?? "");
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
        const delta = String(ev?.partial_json ?? ev?.delta ?? "");
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
    else {
      this.emitExec("session.execution.failed", {
        error: { type: "Error", message: String(frame.result ?? frame.subtype ?? "maki turn failed") },
      });
    }
    this.hooks.onResult?.(frame);
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
