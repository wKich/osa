// The side-neutral journey script (design decision 2). One file drives the
// reference OpenCode run and the Maki-side run: the same key steps and the
// same model turns.

/** One side's spelling of a tool call: OpenCode's tool name and input, or Maki's. */
export interface CallSpelling {
  name: string;
  input: Record<string, unknown>;
}

export type Turn =
  /** `delayMs` paces the stream chunks, so a turn can still be running when a step acts. */
  | { text: string; stream?: string[]; delayMs?: number }
  | { tool: { command: string; needsPermission?: boolean } }
  /**
   * A model tool call spelled per side; each side's real tool runs it. The
   * scripted Maki child cannot run Maki's tools, so `maki.result` is the text
   * the pinned tool returns for it (the live run checks it against real Maki).
   */
  | {
      call: {
        opencode: CallSpelling;
        maki: CallSpelling & { result: string; isError?: boolean };
        needsPermission?: boolean;
      };
    }
  /** The model call fails with this HTTP status and error message. */
  | { fail: { status: number; message: string } };

export interface WaitOptions {
  /** Wait until no terminal data has arrived for this long. */
  idleMs?: number;
  /** Fail after this long. */
  timeoutMs?: number;
  /** Step name used in a failure message. Defaults to the pattern. */
  name?: string;
}

export type Step =
  | { kind: "type"; text: string }
  | { kind: "waitFor"; pattern: string; flags: string; idleMs?: number; timeoutMs?: number; name?: string }
  | { kind: "checkpoint"; id: string; step: Step }
  | { kind: "restart" };

export interface Journey {
  slug: string;
  turns: Turn[];
  steps: Step[];
}

export function journey(slug: string, def: Omit<Journey, "slug">): Journey {
  return { slug, ...def };
}

export function waitFor(pattern: RegExp, opts: WaitOptions = {}): Step {
  return {
    kind: "waitFor",
    pattern: pattern.source,
    flags: pattern.flags,
    idleMs: opts.idleMs,
    timeoutMs: opts.timeoutMs,
    name: opts.name,
  };
}

/** One fused write: the measured TUI quirk is that a split CR drops submit. */
export function type(text: string): Step {
  return { kind: "type", text };
}

export function checkpoint(id: string, step: Step): Step {
  return { kind: "checkpoint", id, step };
}

/** Restart the TUI in place; the harness keeps the server on the other side. */
export function restart(): Step {
  return { kind: "restart" };
}

export const pattern = (step: { pattern: string; flags: string }) => new RegExp(step.pattern, step.flags);
