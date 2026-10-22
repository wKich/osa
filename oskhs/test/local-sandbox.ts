// A Runner that plays the gateway with real git on the host: in-sandbox
// `sh -c` scripts run locally with /sandbox paths mapped into a temp root,
// uploads are copies, and `maki-oss` calls get a scripted answer. Host-side
// git runs for real. This tests the sync scripts' semantics, not only argv.
import { cpSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { spawnRunner, type RunOpts, type RunOutput, type Runner } from "../src/exec.ts";
import type { Ctx } from "../src/openshell.ts";
import { answerLine, type Call } from "./fake.ts";

export interface LocalSandbox {
  ctx: Ctx;
  calls: Call[];
  root: string; // host directory standing in for /sandbox
  path: (sandboxPath: string) => string;
  sh: (script: string) => Promise<RunOutput>; // run at the sandbox root
  /** Called for every maki-oss run; return its output. */
  onRun: (argv: string[], opts: RunOpts) => Promise<Partial<RunOutput>>;
  /** Runs before the default handling; a returned output replaces it. */
  intercept: (argv: string[]) => Promise<Partial<RunOutput> | undefined>;
}

export function localSandbox(): LocalSandbox {
  const root = mkdtempSync(join(tmpdir(), "oskhs-local-sb-"));
  const path = (p: string) => (p.startsWith("/sandbox") ? join(root, p.slice("/sandbox".length)) : p);
  const calls: Call[] = [];
  const ready = new Set(["repo-fx"]); // `maki-oss up` adds the sandbox it creates
  const sb: LocalSandbox = {
    ctx: undefined as unknown as Ctx,
    calls,
    root,
    path,
    sh: (script) => spawnRunner(["sh", "-c", script], { cwd: root }),
    onRun: async () => ({ code: 0, stdout: answerLine + "\n" }),
    intercept: async () => undefined,
  };
  const run: Runner = async (argv, opts = {}) => {
    calls.push({ argv, opts });
    const out = (await sb.intercept(argv)) ?? (await dispatch(argv, opts));
    return { code: 0, stdout: "", stderr: "", timedOut: false, ...out };
  };
  async function dispatch(argv: string[], opts: RunOpts): Promise<Partial<RunOutput>> {
    if (argv[0] === "openshell") {
      if (argv.includes("list")) return { code: 0, stdout: JSON.stringify({ sandboxes: [...ready].map((name) => ({ name, phase: "Ready" })) }) };
      if (argv.includes("upload")) {
        const [local, dest] = argv.slice(-2) as [string, string];
        mkdirSync(dirname(path(dest)), { recursive: true });
        cpSync(local, path(dest));
        return { code: 0 };
      }
      if (argv.includes("download")) {
        const [src, dir] = argv.slice(-2) as [string, string];
        cpSync(path(src), join(dir, basename(src)));
        return { code: 0 };
      }
      const c = argv.indexOf("-c");
      if (argv[c - 1] === "sh") {
        const args = argv.slice(c + 2).map(path); // argv[c+1] is the script, then $0
        const [script, zero] = [argv[c + 1]!, args[0]!];
        return spawnRunner(["sh", "-c", script, zero, ...args.slice(1)], { stdin: opts.stdin, cwd: root });
      }
      throw new Error(`unexpected openshell call: ${argv.join(" ")}`);
    }
    if (argv[0] === "maki-oss") {
      if (argv[1] === "up") ready.add(opts.env!.MAKI_OSS_SANDBOX_NAME!);
      return argv[1] === "run" ? sb.onRun(argv, opts) : { code: 0 };
    }
    return spawnRunner(argv, opts); // host-side git
  }
  sb.ctx = { run, openshell: "openshell", makiOss: "maki-oss", log: () => {} };
  return sb;
}

/** Fixture repo on the host (the same one the live checks use). */
export async function fixture(): Promise<string> {
  const dir = join(mkdtempSync(join(tmpdir(), "oskhs-fx-")), "fx");
  const out = await spawnRunner(["sh", join(import.meta.dir, "make-fixture.sh"), dir]);
  if (out.code !== 0) throw new Error(out.stderr);
  return dir;
}

export async function git(repo: string, ...args: string[]): Promise<string> {
  const out = await spawnRunner(["git", "-C", repo, "-c", "user.name=t", "-c", "user.email=t@t.invalid", ...args]);
  if (out.code !== 0) throw new Error(`git ${args.join(" ")}: ${out.stderr}`);
  return out.stdout.trim();
}
