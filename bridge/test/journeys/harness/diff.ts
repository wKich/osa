// Per-checkpoint comparison and the journey verdict (design decision 7):
// unreached Maki checkpoint -> broken; otherwise an unaccepted difference ->
// diverges; otherwise parity. A broken journey can never accept a difference.

export type Verdict = "parity" | "diverges" | "broken";
export type CheckpointVerdict = "equal" | "differs" | "unreached";

export interface CheckpointInput {
  id: string;
  /** Normalized reference screen; its presence means the reference completed. */
  reference: string;
  /** Normalized Maki screen; undefined means the Maki side never reached the checkpoint. */
  maki?: string;
  acceptedReason?: string;
}

export interface CheckpointResult {
  id: string;
  verdict: CheckpointVerdict;
  hunk?: string;
}

export interface DiffResult {
  status: Verdict;
  checkpoints: CheckpointResult[];
}

export function compare(reference: string, maki: string): string | undefined {
  // A committed snapshot carries a trailing newline; an in-memory screen does
  // not. The newline is storage, not rendered content.
  const a = reference.replace(/\n+$/, "");
  const b = maki.replace(/\n+$/, "");
  if (a === b) return undefined;
  return unified(a.split("\n"), b.split("\n"));
}

export function diffCheckpoints(checkpoints: CheckpointInput[]): DiffResult {
  const results = checkpoints.map((checkpoint): CheckpointResult => {
    if (checkpoint.maki === undefined) return { id: checkpoint.id, verdict: "unreached" };
    const hunk = compare(checkpoint.reference, checkpoint.maki);
    return hunk === undefined
      ? { id: checkpoint.id, verdict: "equal" }
      : { id: checkpoint.id, verdict: "differs", hunk };
  });

  const status: Verdict = results.some((r) => r.verdict === "unreached")
    ? "broken"
    : results.some(
        (r) =>
          r.verdict === "differs" &&
          !(checkpoints.find((c) => c.id === r.id)?.acceptedReason ?? "").trim(),
      )
      ? "diverges"
      : "parity";
  return { status, checkpoints: results };
}

/** One whole-file unified hunk: readable, and enough for a reviewer to triage. */
export function unified(a: string[], b: string[]): string {
  const n = a.length;
  const m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const lines = [`@@ -1,${n} +1,${m} @@`];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      lines.push(` ${a[i]}`);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      lines.push(`-${a[i++]}`);
    } else {
      lines.push(`+${b[j++]}`);
    }
  }
  while (i < n) lines.push(`-${a[i++]}`);
  while (j < m) lines.push(`+${b[j++]}`);
  return lines.join("\n");
}
