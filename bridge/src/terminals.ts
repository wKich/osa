// Persistent terminals in the project sandbox: the TUI's terminal pane
// (tui component/terminal-pane.tsx v2.0.32, context/session-terminals.tsx)
// over OpenCode's persistent-PTY routes and attach socket (server
// handlers/persistent-pty.ts v2.0.32 L17–L209). Each terminal is the sandbox
// user's shell, run by `openshell sandbox exec --tty` inside a Bun PTY on the
// host — the transport every other sandbox read uses, with no --env value —
// so its size follows the TUI and the shell's output streams back as is.
import { randomBytes } from "node:crypto";
import type { ServerWebSocket } from "bun";

const RETAINED_BYTES = 2 * 1024 * 1024;
const TICKET_TTL_SECONDS = 60;

export interface TerminalInfo {
  id: string;
  title: string;
  command: string;
  args: string[];
  cwd: string;
  status: "running" | "exited";
  pid: number;
  exitCode?: number;
  sessionID: string;
  foregroundProcess: string | null;
  size: { cols: number; rows: number };
  output: { head: number; tail: number };
}

export interface SocketData {
  ptyID: string;
  cursor: number;
  attachmentID: string;
  takeover: boolean;
}

type Socket = ServerWebSocket<SocketData>;

interface Terminal {
  info: TerminalInfo;
  proc: ReturnType<typeof Bun.spawn>;
  chunks: { start: number; data: Uint8Array }[];
  sockets: Set<Socket>;
  controller?: string;
  generation: number;
}

const b58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const mintPty = () => `pty_${[...randomBytes(22)].map((b) => b58[b % b58.length]).join("")}`;

export class SandboxTerminals {
  private terminals = new Map<string, Terminal>();
  private tickets = new Map<string, { ptyID: string; expires: number }>();

  constructor(
    private readonly env: { openshell: string; sandbox?: string },
    private readonly emit: (type: string, data: Record<string, unknown>) => void,
  ) {}

  /** whether a sandbox exists to open terminals in (capabilities.persistentPty) */
  get available(): boolean {
    return Boolean(this.env.sandbox);
  }

  list(sessionID: string): TerminalInfo[] {
    return [...this.terminals.values()].filter((t) => t.info.sessionID === sessionID).map((t) => ({ ...t.info }));
  }

  get(ptyID: string): TerminalInfo | undefined {
    const t = this.terminals.get(ptyID);
    return t && { ...t.info };
  }

  /** persistentPty.create: the shell the sandbox user logs in with, unless a command is given */
  create(sessionID: string, input: { command?: string; args?: string[]; cwd: string; title?: string; size?: { cols: number; rows: number } }): TerminalInfo | undefined {
    if (!this.env.sandbox) return undefined;
    const id = mintPty();
    const size = { cols: input.size?.cols ?? 80, rows: input.size?.rows ?? 24 };
    const command = input.command ?? "";
    const args = input.args ?? [];
    const argv = command
      ? [command, ...args]
      : ["sh", "-c", 'exec "${SHELL:-/bin/sh}" -i'];
    const exec = [this.env.openshell, "sandbox", "exec", "--tty", "-n", this.env.sandbox, "--no-login-shell", "--workdir", input.cwd, "--", ...argv];
    let t: Terminal | undefined;
    const early: Uint8Array[] = [];
    const proc = Bun.spawn(exec, {
      cwd: process.cwd(),
      terminal: {
        cols: size.cols,
        rows: size.rows,
        data: (_term, data) => (t ? this.output(t, data) : early.push(Uint8Array.from(data))),
      },
    });
    t = {
      info: {
        id, title: input.title ?? "Terminal", command: command || "shell", args, cwd: input.cwd,
        status: "running", pid: proc.pid, sessionID, foregroundProcess: null, size, output: { head: 0, tail: 0 },
      },
      proc,
      chunks: [],
      sockets: new Set(),
      generation: 1,
    };
    this.terminals.set(id, t);
    for (const data of early.splice(0)) this.output(t, data);
    const opened = t;
    void proc.exited.then((code) => this.exited(opened, code));
    this.emit("persistent-pty.added", { sessionID, terminal: { ...t.info } });
    return { ...t.info };
  }

  resize(ptyID: string, size: { cols: number; rows: number }): TerminalInfo | undefined {
    const t = this.terminals.get(ptyID);
    if (!t) return undefined;
    this.applySize(t, size);
    return { ...t.info };
  }

  remove(ptyID: string): boolean {
    const t = this.terminals.get(ptyID);
    if (!t) return false;
    this.terminals.delete(ptyID);
    if (t.info.status === "running") t.proc.kill();
    for (const s of t.sockets) s.close(1000);
    this.emit("persistent-pty.removed", { sessionID: t.info.sessionID, ptyID });
    return true;
  }

  /** snapshot: the retained output replays the screen into the client's
   * terminal; the text and cursor are read from its tail */
  snapshot(ptyID: string): { info: TerminalInfo; text: string; checkpoint: string; cursor: { x: number; y: number } } | undefined {
    const t = this.terminals.get(ptyID);
    if (!t) return undefined;
    const replay = Buffer.concat(t.chunks.map((c) => c.data));
    const plain = replay.toString("utf8").replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\r(?!\n)/g, "");
    const lines = plain.split("\n").slice(-t.info.size.rows);
    const last = lines.at(-1) ?? "";
    return {
      info: { ...t.info },
      text: lines.join("\n"),
      checkpoint: replay.toString("base64"),
      cursor: { x: Math.min(last.length, t.info.size.cols - 1), y: Math.max(0, lines.length - 1) },
    };
  }

  issueTicket(ptyID: string): { ticket: string; expires_in: number } | undefined {
    if (!this.terminals.has(ptyID)) return undefined;
    const ticket = randomBytes(24).toString("base64url");
    this.tickets.set(ticket, { ptyID, expires: Date.now() + TICKET_TTL_SECONDS * 1000 });
    return { ticket, expires_in: TICKET_TTL_SECONDS };
  }

  /** a single-use ticket for this terminal, or none at all (the handler accepts both) */
  consumeTicket(ticket: string | null, ptyID: string): boolean {
    if (!ticket) return true;
    const entry = this.tickets.get(ticket);
    this.tickets.delete(ticket);
    return Boolean(entry && entry.ptyID === ptyID && entry.expires > Date.now());
  }

  has(ptyID: string): boolean {
    return this.terminals.has(ptyID);
  }

  open(ws: Socket): void {
    const t = this.terminals.get(ws.data.ptyID);
    if (!t) {
      ws.close(4404, "terminal unavailable");
      return;
    }
    t.sockets.add(ws);
    const head = t.chunks[0]?.start ?? t.info.output.tail;
    const from = Math.max(ws.data.cursor, head);
    if (ws.data.takeover || !t.controller) {
      t.controller = ws.data.attachmentID;
      t.generation++;
    }
    const role = t.controller === ws.data.attachmentID ? "controller" : "observer";
    ws.send(JSON.stringify({
      type: "attached", attachmentID: ws.data.attachmentID, inputProtocol: 1, info: { ...t.info }, role, generation: t.generation,
      replay: { requestedOffset: ws.data.cursor, availableOffset: head, endOffset: t.info.output.tail, truncated: ws.data.cursor < head },
    }));
    const replay = this.since(t, from);
    if (replay.length > 0) ws.send(replay);
    ws.send(JSON.stringify({ type: "replay_complete", endOffset: t.info.output.tail }));
    if (role === "controller") this.broadcast(t, JSON.stringify({ type: "controller_changed", attachmentID: t.controller, generation: t.generation }), ws);
    if (t.info.status === "exited") ws.send(JSON.stringify({ type: "exited", exitCode: t.info.exitCode, finalOffset: t.info.output.tail }));
  }

  /** an interaction frame: type 0 takes control at a size, type 1 also carries input */
  message(ws: Socket, message: string | Buffer): void {
    const t = this.terminals.get(ws.data.ptyID);
    if (!t) return;
    const data = typeof message === "string" ? Buffer.from(message) : message;
    if (data.byteLength < 5) return;
    const type = data[0];
    const cols = data.readUInt16BE(1);
    const rows = data.readUInt16BE(3);
    if ((type !== 0 && type !== 1) || cols === 0 || rows === 0) return;
    if (t.controller !== ws.data.attachmentID) {
      t.controller = ws.data.attachmentID;
      t.generation++;
      this.broadcast(t, JSON.stringify({ type: "controller_changed", attachmentID: t.controller, generation: t.generation }));
    }
    if (cols !== t.info.size.cols || rows !== t.info.size.rows) this.applySize(t, { cols, rows });
    if (type === 1 && t.info.status === "running") t.proc.terminal?.write(data.subarray(5));
  }

  close(ws: Socket): void {
    const t = this.terminals.get(ws.data.ptyID);
    if (!t) return;
    t.sockets.delete(ws);
    if (t.controller === ws.data.attachmentID) t.controller = undefined;
  }

  shutdown(): void {
    for (const t of this.terminals.values()) if (t.info.status === "running") t.proc.kill();
  }

  private applySize(t: Terminal, size: { cols: number; rows: number }): void {
    t.info.size = size;
    if (t.info.status === "running") t.proc.terminal?.resize(size.cols, size.rows);
    t.generation++;
    const checkpoint = Buffer.concat(t.chunks.map((c) => c.data)).toString("base64");
    this.broadcast(t, JSON.stringify({ type: "resized", cols: size.cols, rows: size.rows, generation: t.generation, checkpoint }));
  }

  private output(t: Terminal, data: Uint8Array): void {
    const copy = Uint8Array.from(data);
    t.chunks.push({ start: t.info.output.tail, data: copy });
    t.info.output.tail += copy.byteLength;
    let retained = t.info.output.tail - (t.chunks[0]?.start ?? 0);
    while (retained > RETAINED_BYTES && t.chunks.length > 1) {
      t.chunks.shift();
      retained = t.info.output.tail - t.chunks[0]!.start;
    }
    t.info.output.head = t.chunks[0]?.start ?? t.info.output.tail;
    for (const s of t.sockets) s.send(copy);
  }

  private since(t: Terminal, offset: number): Uint8Array {
    const parts: Uint8Array[] = [];
    for (const c of t.chunks) {
      const end = c.start + c.data.byteLength;
      if (end <= offset) continue;
      parts.push(c.start >= offset ? c.data : c.data.subarray(offset - c.start));
    }
    return Buffer.concat(parts);
  }

  private exited(t: Terminal, code: number | null): void {
    t.info.status = "exited";
    if (typeof code === "number" && code >= 0) t.info.exitCode = code;
    this.broadcast(t, JSON.stringify({ type: "exited", exitCode: t.info.exitCode, finalOffset: t.info.output.tail }));
  }

  private broadcast(t: Terminal, message: string, except?: Socket): void {
    for (const s of t.sockets) if (s !== except) s.send(message);
  }
}
