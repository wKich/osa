// The side-neutral journey script (design decision 2). One file drives the
// reference OpenCode run and the Maki-side run: the same key steps and the
// same model turns.

export type Turn =
  | { text: string; stream?: string[] }
  | { tool: { command: string; needsPermission?: boolean } };

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
