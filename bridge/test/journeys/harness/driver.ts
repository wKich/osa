// PTY driver (design decision 2/4): Bun's built-in terminal support runs the
// real TUI, the script writes one fused input at a time, and every step that
// depends on the TUI reacting waits for rendered screen content with a bounded
// timeout instead of a fixed sleep.
import { createScreen, type Screen } from "./render.ts";
import { pattern, type Step } from "./journey.ts";

export interface PtyOptions {
  command: string[];
  cwd: string;
  env: Record<string, string>;
  cols?: number;
  rows?: number;
}

export interface Pty {
  readonly pid: number;
  write(data: string): void;
  text(): Promise<string>;
  alive(): boolean;
  exited: Promise<number>;
  close(): Promise<void>;
}

export async function startPty(opts: PtyOptions): Promise<Pty> {
  const screen: Screen = createScreen(opts.cols ?? 120, opts.rows ?? 40);
  let exitedCode: number | undefined;

  const proc = Bun.spawn({
    cmd: opts.command,
    cwd: opts.cwd,
    env: opts.env,
    terminal: {
      cols: opts.cols ?? 120,
      rows: opts.rows ?? 40,
      data: (_term, data) => screen.feed(data),
    },
  });

  const exited = proc.exited.then((code) => {
    exitedCode = code;
    return code;
  });

  return {
    pid: proc.pid,
    write: (data) => proc.terminal!.write(data),
    text: () => screen.text(),
    alive: () => exitedCode === undefined,
    exited,
    async close() {
      if (exitedCode === undefined) {
        proc.kill();
        await Promise.race([exited, Bun.sleep(3000)]);
        if (exitedCode === undefined) proc.kill(9);
      }
      proc.terminal?.close();
    },
  };
}

export interface RunContext {
  slug: string;
  side: "reference" | "maki";
  pty: Pty;
  restart: () => Promise<Pty>;
  onCheckpoint: (id: string, text: string) => void | Promise<void>;
}

export class StepError extends Error {}

function label(step: Step): string {
  if (step.kind === "checkpoint") return step.id;
  if (step.kind === "waitFor") return step.name ?? `/${step.pattern}/`;
  if (step.kind === "restart") return "restart";
  if (step.kind === "pause") return `pause ${step.ms}ms`;
  return "type";
}

async function runWait(ctx: RunContext, step: Extract<Step, { kind: "waitFor" }>): Promise<void> {
  const match = pattern(step);
  const timeoutMs = step.timeoutMs ?? 20_000;
  const deadline = Date.now() + timeoutMs;
  const name = step.name ?? `/${step.pattern}/`;
  let lastMatch: string | undefined;
  let matchSince = Date.now();

  while (Date.now() < deadline) {
    const text = await ctx.pty.text();
    const found = match.exec(text)?.[0];
    if (found !== undefined) {
      if (found !== lastMatch) {
        lastMatch = found;
        matchSince = Date.now();
      }
      // Idle means the matched screen content stops changing; the rest of the
      // TUI (spinners, counters, clock) may keep repainting.
      if (step.idleMs === undefined || Date.now() - matchSince >= step.idleMs) return;
    } else {
      lastMatch = undefined;
    }
    if (!ctx.pty.alive()) {
      // Pending xterm writes may still land after the process exits; give them
      // one more chance before calling the step unreached.
      await Bun.sleep(100);
      if (match.test(await ctx.pty.text())) return;
      throw new StepError(
        `journey ${ctx.slug}: ${ctx.side} process exited before step "${name}" appeared`,
      );
    }
    await Bun.sleep(25);
  }
  throw new StepError(
    `journey ${ctx.slug}: ${ctx.side} step "${name}" did not show ${match} within ${timeoutMs}ms`,
  );
}

async function runStep(ctx: RunContext, step: Step): Promise<void> {
  if (step.kind === "type") {
    ctx.pty.write(step.text);
    // Let the TUI consume the fused write before a checkpoint can match the
    // text still sitting in the composer.
    await Bun.sleep(250);
    return;
  }
  if (step.kind === "waitFor") return runWait(ctx, step);
  if (step.kind === "restart") {
    ctx.pty = await ctx.restart();
    return;
  }
  if (step.kind === "pause") {
    await Bun.sleep(step.ms);
    return;
  }
  await runStep(ctx, step.step);
}

export async function runSteps(ctx: RunContext, steps: readonly Step[]): Promise<void> {
  for (const step of steps) {
    if (step.kind === "checkpoint") {
      const inner =
        step.step.kind === "waitFor" && step.step.name === undefined ? { ...step.step, name: step.id } : step.step;
      await runStep(ctx, inner);
      await ctx.onCheckpoint(step.id, await ctx.pty.text());
      continue;
    }
    try {
      await runStep(ctx, step);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new StepError(
        message.includes(`step "${label(step)}"`) ? message : `${message} (step "${label(step)}")`,
      );
    }
  }
}
