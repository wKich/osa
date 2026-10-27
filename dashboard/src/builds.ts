// Base image build hub (dashboard-image-build design D3).
//
// One build at a time across every agent. The hub owns the `osa image build
// TAG` child, splits its stdout and stderr into lines in arrival order, keeps
// the current or last build's lines in a bounded ring for replay, and fans
// them out over SSE. Unlike the log hub, a subscriber leaving never stops the
// child: a build keeps running when every browser disconnects. Cancel sends
// SIGTERM (the front-end forwards it to the engine) and SIGKILL after a grace
// period; a hard cap cancels a build that runs too long.

import type { OsaRunner } from "./projects.ts";
import type { AgentTag } from "./projects.ts";

/** Lines kept for replay. */
export const BUILD_RING_LIMIT = 5000;
/** How long a cancelled build may take to stop before SIGKILL, milliseconds. */
export const BUILD_KILL_GRACE_MS = 10_000;
/** The longest a build may run before it is cancelled, milliseconds. */
export const BUILD_HARD_CAP_MS = 60 * 60_000;
/** Heartbeat interval for SSE comments, milliseconds. */
const HEARTBEAT_MS = 15_000;

export interface BuildSummary {
  id: string;
  agent: AgentTag;
  startedAt: number;
  finishedAt: number | null;
  exitCode: number | null;
  cancelled: boolean;
  /** Why the build was cancelled: "cancel" or "timeout", else null. */
  reason: "cancel" | "timeout" | null;
  /** Lines dropped from the start of the ring. */
  dropped: number;
}

export type BuildStart =
  | { ok: true; build: BuildSummary }
  | { ok: false; kind: "busy" | "invalid_request" | "missing_cli" | "spawn"; message: string };

export interface BuildSubscription {
  stream: ReadableStream<Uint8Array>;
  unsubscribe(): void;
}

export interface BuildHubOptions {
  ringLimit?: number;
  killGraceMs?: number;
  hardCapMs?: number;
  heartbeatMs?: number;
}

interface Subscriber {
  enqueue(chunk: Uint8Array): void;
  close(): void;
}

interface Running {
  proc: BunSubprocess;
  cap: ReturnType<typeof setTimeout>;
  kill: ReturnType<typeof setTimeout> | null;
}

export class BuildHub {
  private readonly ringLimit: number;
  private readonly killGraceMs: number;
  private readonly hardCapMs: number;
  private readonly heartbeatMs: number;
  private readonly encoder = new TextEncoder();
  private readonly subscribers = new Set<Subscriber>();
  private build: BuildSummary | null = null;
  private lines: string[] = [];
  private running: Running | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private sequence = 0;

  constructor(
    private readonly runner: OsaRunner,
    options: BuildHubOptions = {},
  ) {
    this.ringLimit = options.ringLimit ?? BUILD_RING_LIMIT;
    this.killGraceMs = options.killGraceMs ?? BUILD_KILL_GRACE_MS;
    this.hardCapMs = options.hardCapMs ?? BUILD_HARD_CAP_MS;
    this.heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
  }

  /** The current or last build, without its lines. */
  summary(): BuildSummary | null {
    return this.build ? { ...this.build } : null;
  }

  isRunning(): boolean {
    return this.running !== null;
  }

  /** Lines currently retained (oldest first). */
  snapshot(): string[] {
    return [...this.lines];
  }

  subscriberCount(): number {
    return this.subscribers.size;
  }

  /** Starts `osa image build AGENT` unless a build is running. */
  start(agent: AgentTag): BuildStart {
    if (this.running) return { ok: false, kind: "busy", message: "a build is running" };
    const spawned = this.runner.spawnBuild(["image", "build", agent]);
    if (!spawned.ok) {
      const kind = spawned.error.kind === "missing_cli" || spawned.error.kind === "invalid_request"
        ? spawned.error.kind
        : "spawn";
      return { ok: false, kind, message: spawned.error.message };
    }
    const proc = spawned.value;
    this.sequence += 1;
    this.build = {
      id: `${Date.now().toString(36)}-${this.sequence}`,
      agent,
      startedAt: Date.now(),
      finishedAt: null,
      exitCode: null,
      cancelled: false,
      reason: null,
      dropped: 0,
    };
    this.lines = [];
    this.running = {
      proc,
      cap: setTimeout(() => this.cancel("timeout"), this.hardCapMs),
      kill: null,
    };
    // Subscribers from the previous build see the new one from its start.
    this.broadcast({ event: "start", data: JSON.stringify(this.build) });
    this.ensureHeartbeat();
    void this.watch(proc, this.build);
    return { ok: true, build: { ...this.build } };
  }

  /** Cancels the running build; false when nothing runs. */
  cancel(reason: "cancel" | "timeout" = "cancel"): boolean {
    const running = this.running;
    if (!running || !this.build) return false;
    if (!this.build.cancelled) {
      this.build.cancelled = true;
      this.build.reason = reason;
    }
    try {
      running.proc.kill("SIGTERM");
    } catch {
      // Already exited; the exit handler finishes the build.
    }
    if (running.kill === null) {
      running.kill = setTimeout(() => {
        try {
          running.proc.kill("SIGKILL");
        } catch {
          // Already exited.
        }
      }, this.killGraceMs);
    }
    return true;
  }

  /** A stream that replays the current or last build, then follows it live. */
  subscribe(): BuildSubscription {
    let subscriber: Subscriber;
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        subscriber = {
          enqueue: (chunk) => {
            try {
              controller.enqueue(chunk);
            } catch {
              this.subscribers.delete(subscriber);
            }
          },
          close: () => {
            try {
              controller.close();
            } catch {
              // Already closed by the client side.
            }
          },
        };
        this.subscribers.add(subscriber);
        this.ensureHeartbeat();
        if (!this.build) {
          this.send(subscriber, { event: "none", data: "no build" });
          return;
        }
        this.send(subscriber, { event: "start", data: JSON.stringify(this.build) });
        for (const line of this.lines) this.send(subscriber, { event: "line", data: line });
        if (!this.running) this.send(subscriber, { event: "done", data: JSON.stringify(this.build) });
      },
      cancel: () => {
        this.subscribers.delete(subscriber);
        this.stopHeartbeatIfIdle();
      },
    });
    return {
      stream,
      unsubscribe: () => {
        this.subscribers.delete(subscriber);
        this.stopHeartbeatIfIdle();
      },
    };
  }

  /** Server shutdown: kill the child and end every stream. */
  stop(): void {
    const running = this.running;
    if (running) {
      clearTimeout(running.cap);
      if (running.kill) clearTimeout(running.kill);
      try {
        running.proc.kill("SIGKILL");
      } catch {
        // Already exited.
      }
    }
    for (const subscriber of [...this.subscribers]) subscriber.close();
    this.subscribers.clear();
    if (this.heartbeat !== null) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private async watch(proc: BunSubprocess, build: BuildSummary): Promise<void> {
    await Promise.all([this.pump(proc.stdout), this.pump(proc.stderr)]);
    const exitCode = await proc.exited;
    const running = this.running;
    if (running && running.proc === proc) {
      clearTimeout(running.cap);
      if (running.kill) clearTimeout(running.kill);
      this.running = null;
    }
    build.exitCode = exitCode;
    build.finishedAt = Date.now();
    this.broadcast({ event: "done", data: JSON.stringify(build) });
    this.stopHeartbeatIfIdle();
  }

  private async pump(stream: ReadableStream<Uint8Array> | undefined): Promise<void> {
    if (!stream) return;
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        let index = pending.indexOf("\n");
        while (index !== -1) {
          this.push(pending.slice(0, index).replace(/\r$/, ""));
          pending = pending.slice(index + 1);
          index = pending.indexOf("\n");
        }
      }
      pending += decoder.decode();
      if (pending) this.push(pending.replace(/\r$/, ""));
    } catch {
      // The child was killed; nothing more to read.
    }
  }

  private push(line: string): void {
    // A carriage return inside a line (progress output) would end the SSE
    // data line early; keep the text after the last one.
    const text = line.includes("\r") ? line.slice(line.lastIndexOf("\r") + 1) : line;
    this.lines.push(text);
    if (this.lines.length > this.ringLimit) {
      const extra = this.lines.length - this.ringLimit;
      this.lines.splice(0, extra);
      if (this.build) this.build.dropped += extra;
    }
    this.broadcast({ event: "line", data: text });
  }

  private ensureHeartbeat(): void {
    if (this.heartbeat !== null || this.subscribers.size === 0) return;
    this.heartbeat = setInterval(() => {
      for (const subscriber of [...this.subscribers]) subscriber.enqueue(this.encoder.encode(": ping\n\n"));
    }, this.heartbeatMs);
  }

  private stopHeartbeatIfIdle(): void {
    if (this.subscribers.size > 0 || this.heartbeat === null) return;
    clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private send(subscriber: Subscriber, message: { event: string; data: string }): void {
    subscriber.enqueue(this.encoder.encode(`event: ${message.event}\ndata: ${message.data}\n\n`));
  }

  private broadcast(message: { event: string; data: string }): void {
    for (const subscriber of [...this.subscribers]) this.send(subscriber, message);
  }
}
