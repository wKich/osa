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
  payload: AnyObj;
}

export class SessionHistory {
  private messages: Message[] = [];
  private pending = new Map<string, Pending>();

  apply(type: string, data: AnyObj, created: number, eventID: string): void {
    switch (type) {
      case "session.inbox.enqueued":
        if (data.item?.type === "user") this.pending.set(String(data.inboxID), { id: String(data.inboxID), payload: data.item.payload ?? {} });
        return;
      case "session.inbox.cancelled":
        this.pending.delete(String(data.inboxID));
        return;
      case "session.inbox.delivered": {
        const item = this.pending.get(String(data.inboxID));
        if (!item) return;
        this.pending.delete(item.id);
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
