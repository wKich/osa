// Session message history: the transcript a reopened TUI reads from
// `GET /api/session/{sessionID}/message`. The bridge is the server, so it
// projects its own emitted frames the way the real server projects its events
// (the client mirror is client/src/solid/data.ts v2.0.32 L792–L1106; the
// message shapes are schema/src/session-message.ts L75–L300). Only the frame
// types the bridge emits are projected.
import type { AnyObj } from "./spec-answers.ts";

type Message = AnyObj & { id: string; type: string };

interface Pending {
  id: string;
  type: "user" | "synthetic";
  payload: AnyObj;
}

export class SessionHistory {
  private messages: Message[] = [];
  private pending = new Map<string, Pending>();

  /** a fork's transcript: the settled messages, renamed as the real
   * projector renames copies (core session/projector.ts v2.0.32 L195–L229) */
  forkFrom(parent: SessionHistory, eventID: string): string | undefined {
    const prefix = eventID.replace(/^evt_/, "msg_");
    let boundary: string | undefined;
    parent.messages.forEach((m, i) => {
      boundary = m.id;
      if (m.type === "assistant" && m.time?.completed === undefined) return;
      this.messages.push({ ...structuredClone(m), id: `${prefix}_${i + 1}` });
    });
    return boundary;
  }

  get size(): number {
    return this.messages.length;
  }

  has(id: string): boolean {
    return this.messages.some((m) => m.id === id);
  }

  apply(type: string, data: AnyObj, created: number, eventID: string): void {
    switch (type) {
      case "session.inbox.enqueued":
        if (data.item?.type === "user" || data.item?.type === "synthetic") {
          this.pending.set(String(data.inboxID), { id: String(data.inboxID), type: data.item.type, payload: data.item.payload ?? {} });
        }
        return;
      case "session.inbox.cancelled":
        this.pending.delete(String(data.inboxID));
        return;
      case "session.inbox.delivered": {
        const item = this.pending.get(String(data.inboxID));
        if (!item) return;
        this.pending.delete(item.id);
        if (item.type === "synthetic") {
          const { text, description, metadata } = item.payload;
          this.messages.push({ id: item.id, type: "synthetic", text: String(text ?? ""), ...(description ? { description } : {}), ...(metadata ? { metadata } : {}), time: { created } });
          return;
        }
        const { text, files, agents, skills } = item.payload;
        this.messages.push({
          id: item.id,
          type: "user",
          text: String(text ?? ""),
          ...(files ? { files } : {}),
          ...(agents ? { agents } : {}),
          ...(skills ? { skills } : {}),
          time: { created },
        });
        return;
      }
      case "session.step.started": {
        const existing = this.assistant(data.assistantMessageID);
        if (existing) {
          Object.assign(existing, { agent: data.agent, model: data.model });
          existing.time = { created: data.started };
          return;
        }
        const active = this.activeAssistant();
        if (active) active.time.completed = created;
        this.messages.push({
          id: String(data.assistantMessageID),
          type: "assistant",
          agent: data.agent,
          model: data.model,
          content: [],
          time: { created: data.started ?? created },
        });
        return;
      }
      case "session.step.ended": {
        const a = this.assistant(data.assistantMessageID);
        if (!a) return;
        a.time.completed = created;
        for (const key of ["finish", "cost", "tokens"] as const) if (data[key] !== undefined) a[key] = data[key];
        return;
      }
      case "session.retry.scheduled": {
        const a = this.assistant(data.assistantMessageID);
        if (a) a.retry = { attempt: data.attempt, at: data.at, error: data.error };
        return;
      }
      case "session.text.started":
      case "session.reasoning.started": {
        const a = this.assistant(data.assistantMessageID);
        const kind = type === "session.text.started" ? "text" : "reasoning";
        if (a) a.content.push(kind === "text" ? { type: "text", text: "" } : { type: "reasoning", text: "", time: { created } });
        return;
      }
      case "session.text.delta":
      case "session.reasoning.delta": {
        const part = this.lastPart(data.assistantMessageID, type === "session.text.delta" ? "text" : "reasoning");
        if (part) part.text += String(data.delta ?? "");
        return;
      }
      case "session.text.ended":
      case "session.reasoning.ended": {
        const part = this.lastPart(data.assistantMessageID, type === "session.text.ended" ? "text" : "reasoning");
        if (!part) return;
        part.text = String(data.text ?? "");
        if (part.type === "reasoning") part.time = { created: part.time?.created ?? created, completed: created };
        return;
      }
      case "session.tool.input.started": {
        const a = this.assistant(data.assistantMessageID);
        if (a) a.content.push({ type: "tool", id: String(data.id), name: String(data.name), time: { created }, state: { status: "streaming", input: "" } });
        return;
      }
      case "session.tool.input.delta":
      case "session.tool.input.ended": {
        const tool = this.tool(data.assistantMessageID, data.id);
        if (tool?.state.status !== "streaming") return;
        tool.state.input = type === "session.tool.input.delta" ? tool.state.input + String(data.delta ?? "") : String(data.text ?? "");
        return;
      }
      case "session.tool.called": {
        const tool = this.tool(data.assistantMessageID, data.id);
        if (!tool) return;
        tool.time.ran = created;
        tool.executed = data.executed;
        tool.state = { status: "running", input: data.input ?? {}, metadata: {} };
        return;
      }
      case "session.tool.success":
      case "session.tool.failed": {
        const tool = this.tool(data.assistantMessageID, data.id);
        if (!tool || (tool.state.status !== "streaming" && tool.state.status !== "running")) return;
        const input = typeof tool.state.input === "string" ? {} : tool.state.input;
        tool.state = type === "session.tool.success"
          ? { status: "completed", input, content: data.content }
          : { status: "error", input, error: data.error, ...(data.content ? { content: data.content } : {}) };
        tool.executed = data.executed || tool.executed === true;
        tool.time.completed = created;
        return;
      }
      case "session.shell.started":
        this.messages.push({
          id: eventID.replace(/^evt_/, "msg_"),
          type: "shell",
          shellID: data.shell?.id,
          command: String(data.shell?.command ?? ""),
          status: data.shell?.status ?? "running",
          ...(data.shell?.exit !== undefined ? { exit: data.shell.exit } : {}),
          time: { created },
        });
        return;
      case "session.shell.ended": {
        const shell = this.messages.findLast((m) => m.type === "shell" && m.shellID === data.shell?.id);
        if (!shell) return;
        shell.status = data.shell?.status;
        shell.exit = data.shell?.exit;
        shell.output = data.output;
        shell.time.completed = created;
        return;
      }
      case "session.execution.succeeded":
      case "session.execution.failed":
      case "session.execution.interrupted": {
        if (type === "session.execution.interrupted" && data.reason === "shutdown") return;
        const outcome = type === "session.execution.succeeded" ? "succeeded" : type === "session.execution.failed" ? "failed" : "interrupted";
        this.messages.push({
          id: eventID.replace(/^evt_/, "msg_"),
          type: "idle",
          outcome,
          ...(type === "session.execution.failed" ? { error: data.error } : {}),
          time: { created },
        });
        return;
      }
      default:
        return;
    }
  }

  /** One page, as the real handler pages (server/src/handlers/message.ts
   * v2.0.32 L9–L65): default 50, newest first unless `order` says otherwise,
   * and a cursor naming the boundary message, its order, and its direction. */
  page(query: { limit?: string | null; order?: string | null; cursor?: string | null; type?: string | null }):
    | { ok: true; data: Message[]; cursor: { previous?: string; next?: string } }
    | { ok: false; message: string } {
    if (query.cursor && query.order) return { ok: false, message: "Cursor cannot be combined with order" };
    let decoded: { id: string; order: "asc" | "desc"; direction: "previous" | "next" } | undefined;
    if (query.cursor) {
      try {
        decoded = JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8"));
      } catch {
        return { ok: false, message: "Invalid cursor" };
      }
      if (!decoded || typeof decoded.id !== "string" || !["asc", "desc"].includes(decoded.order) || !["previous", "next"].includes(decoded.direction)) {
        return { ok: false, message: "Invalid cursor" };
      }
    }
    const order = decoded?.order ?? (query.order === "asc" ? "asc" : "desc");
    const limit = query.limit && Number(query.limit) > 0 ? Math.floor(Number(query.limit)) : 50;
    let list = this.messages.filter((m) => !query.type || m.type === query.type);
    if (order === "desc") list = list.slice().reverse();
    if (decoded) {
      const at = list.findIndex((m) => m.id === decoded!.id);
      list = at < 0 ? [] : decoded.direction === "next" ? list.slice(at + 1) : list.slice(0, at).slice(-limit);
    }
    const data = list.slice(0, limit).map((m) => structuredClone(m));
    const encode = (m: Message, direction: "previous" | "next") =>
      Buffer.from(JSON.stringify({ id: m.id, order, direction })).toString("base64url");
    const first = data[0];
    const last = data.at(-1);
    return {
      ok: true,
      data,
      cursor: { ...(first ? { previous: encode(first, "previous") } : {}), ...(last ? { next: encode(last, "next") } : {}) },
    };
  }

  private assistant(id: unknown): Message | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i]!;
      if (m.type === "assistant" && m.id === id) return m;
    }
    return undefined;
  }

  private activeAssistant(): Message | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i]!;
      if (m.type === "idle") return undefined;
      if (m.type === "assistant") return m.time.completed === undefined ? m : undefined;
    }
    return undefined;
  }

  private lastPart(assistantID: unknown, kind: "text" | "reasoning"): AnyObj | undefined {
    const a = this.assistant(assistantID);
    return a?.content.findLast((p: AnyObj) => p.type === kind);
  }

  private tool(assistantID: unknown, id: unknown): AnyObj | undefined {
    return this.assistant(assistantID)?.content.find((p: AnyObj) => p.type === "tool" && p.id === id);
  }
}

// session.export (core session/transfer.ts v2.0.32 L56–L62): the session and
// its settled messages oldest first; `sanitize` redacts content the way the
// real transfer does (L165–L348) for the message types the bridge projects
const settled = (m: AnyObj) => (m.type === "assistant" ? m.time?.completed !== undefined : true);
const redact = (kind: string, id: string, value: string) => (value.trim() ? `[redacted:${kind}:${id}]` : value);
const redactMeta = (kind: string, id: string, value: AnyObj | undefined) =>
  value && Object.keys(value).length > 0 ? { redacted: `${kind}:${id}` } : value;

function sanitizeToolState(id: string, state: AnyObj): AnyObj {
  if (state.status === "streaming") return { ...state, input: redact("tool-input", id, String(state.input ?? "")) };
  if (state.status === "running") return { ...state, input: { redacted: `tool-input:${id}` }, metadata: { redacted: `tool-metadata:${id}` } };
  const content = (items: AnyObj[] | undefined) =>
    items?.map((c) => (c.type === "text"
      ? { ...c, text: redact("tool-output", id, String(c.text ?? "")) }
      : { ...c, uri: redact("tool-file-uri", id, String(c.uri ?? "")), ...(c.name === undefined ? {} : { name: redact("tool-file-name", id, c.name) }) }));
  const out: AnyObj = { ...state, input: { redacted: `tool-input:${id}` } };
  if (state.content) out.content = content(state.content);
  if (state.metadata !== undefined) out.metadata = { redacted: `tool-metadata:${id}` };
  return out;
}

function sanitizeMessage(m: AnyObj): AnyObj {
  const meta = redactMeta("message-metadata", m.id, m.metadata);
  const base = meta === undefined ? { ...m } : { ...m, metadata: meta };
  if (m.type === "user") {
    return {
      ...base,
      text: redact("text", m.id, m.text),
      ...(m.files ? { files: m.files.map((f: AnyObj, i: number) => ({ ...f, data: "", source: { type: "inline" }, ...(f.name === undefined ? {} : { name: redact("file-name", String(i), f.name) }), ...(f.description === undefined ? {} : { description: redact("file-description", String(i), f.description) }) })) } : {}),
    };
  }
  if (m.type === "assistant") {
    return {
      ...base,
      content: m.content.map((c: AnyObj) => {
        if (c.type === "text" || c.type === "reasoning") {
          const out: AnyObj = { ...c, text: redact(c.type, m.id, c.text) };
          if (c.state) out.state = { redacted: `${c.type}-state:${m.id}` };
          return out;
        }
        return { ...c, state: sanitizeToolState(m.id, c.state) };
      }),
    };
  }
  return base;
}

export function exportSession(info: AnyObj, history: SessionHistory, sanitize: boolean): AnyObj {
  const messages = history.page({ order: "asc", limit: String(Number.MAX_SAFE_INTEGER) });
  const list = messages.ok ? messages.data.filter(settled) : [];
  if (!sanitize) return { info, messages: list };
  const out: AnyObj = { ...info };
  if (info.title !== undefined) out.title = redact("session-title", info.id, info.title);
  if (info.metadata && Object.keys(info.metadata).length > 0) out.metadata = { redacted: `session-metadata:${info.id}` };
  out.location = { ...info.location, directory: `/${redact("session-directory", info.id, info.location.directory)}` };
  return { info: out, messages: list.map(sanitizeMessage) };
}
