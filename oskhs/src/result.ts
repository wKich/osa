// Typed round results (design decision 7). Maki reports a provider failure
// as `is_error: true` with exit 0, so the kind comes from the result line,
// not from the exit code alone.

export type Stage = "sandbox" | "seed" | "sync" | "worktree" | "run" | "parse";

export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export type RoundResult =
  | { kind: "answer"; text: string; sessionId: string; durationMs: number; numTurns: number; usage: Usage }
  | { kind: "agent-error"; message: string; sessionId?: string }
  | { kind: "timeout"; seconds: number }
  | { kind: "failed"; stage: Stage; exitCode: number; stderr: string };

/** Thrown by pipeline steps; `runRound` turns it into a `failed` result. */
export class StageError extends Error {
  constructor(
    readonly stage: Stage,
    readonly exitCode: number,
    readonly stderr: string,
  ) {
    super(`${stage} failed (exit ${exitCode}): ${stderr}`);
  }
}

interface MakiResultLine {
  type: "result";
  subtype?: string;
  is_error?: boolean;
  result?: string;
  session_id?: string;
  duration_ms?: number;
  num_turns?: number;
  usage?: Usage;
}

function resultLine(stdout: string): MakiResultLine | undefined {
  const lines = stdout.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("{"));
  for (const line of lines.reverse()) {
    try {
      const parsed = JSON.parse(line);
      if (parsed && parsed.type === "result") return parsed as MakiResultLine;
    } catch {
      // not JSON; keep looking
    }
  }
  return undefined;
}

/** Maps one `maki-oss run` invocation to a result. */
export function interpretRun(out: { code: number; stdout: string; stderr: string; timedOut: boolean }, timeoutSec: number): RoundResult {
  if (out.timedOut || out.code === 124) return { kind: "timeout", seconds: timeoutSec };
  const line = resultLine(out.stdout);
  if (!line) {
    return { kind: "failed", stage: out.code === 0 ? "parse" : "run", exitCode: out.code, stderr: out.stderr.trimEnd().split("\n").slice(-20).join("\n") };
  }
  if (line.is_error || out.code !== 0) {
    return { kind: "agent-error", message: line.result ?? `maki exited ${out.code}`, sessionId: line.session_id };
  }
  return {
    kind: "answer",
    text: line.result ?? "",
    sessionId: line.session_id ?? "",
    durationMs: line.duration_ms ?? 0,
    numTurns: line.num_turns ?? 0,
    usage: line.usage ?? {},
  };
}
