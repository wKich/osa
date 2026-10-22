// The single seam for every external command oskhs runs (design decision 9):
// openshell, maki-oss, and host-side git all go through a Runner, so tests
// inject a recorder and the unit suite needs no gateway.

export interface RunOpts {
  env?: Record<string, string>; // added to the inherited host environment
  cwd?: string;
  stdin?: string;
  timeoutMs?: number; // client-side backstop; the child is killed on expiry
  signal?: AbortSignal; // kills the local child; a remote process needs its own stop
}

export interface RunOutput {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export type Runner = (argv: string[], opts?: RunOpts) => Promise<RunOutput>;

export const spawnRunner: Runner = async (argv, opts = {}) => {
  const proc = Bun.spawn(argv, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdin: opts.stdin === undefined ? "ignore" : new TextEncoder().encode(opts.stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  const onAbort = () => proc.kill("SIGTERM");
  if (opts.signal?.aborted) onAbort();
  else opts.signal?.addEventListener("abort", onAbort, { once: true });
  const timer = opts.timeoutMs
    ? setTimeout(() => {
        timedOut = true;
        proc.kill("SIGKILL");
      }, opts.timeoutMs)
    : undefined;
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (timer) clearTimeout(timer);
  opts.signal?.removeEventListener("abort", onAbort);
  return { code, stdout, stderr, timedOut };
};

/** Last `n` lines of a stream, for error reports that stay readable. */
export function tail(text: string, n = 20): string {
  return text.trimEnd().split("\n").slice(-n).join("\n");
}
