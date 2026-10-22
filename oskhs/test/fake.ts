// Recording Runner: every call is logged, and a responder decides each
// output. The default responder models a healthy gateway with one sandbox.
import type { RunOpts, RunOutput, Runner } from "../src/exec.ts";
import type { Ctx } from "../src/openshell.ts";

export interface Call {
  argv: string[];
  opts: RunOpts;
}

export type Responder = (argv: string[], opts: RunOpts) => Partial<RunOutput> | undefined;

export const ok = (stdout = ""): Partial<RunOutput> => ({ code: 0, stdout });
export const fail = (code = 1, stderr = "boom"): Partial<RunOutput> => ({ code, stderr });

/** The `sh -c` script of an in-sandbox call, or undefined. */
export const script = (argv: string[]) => {
  const i = argv.indexOf("-c");
  return argv[i - 1] === "sh" ? argv[i + 1] : undefined;
};
export const isList = (argv: string[]) => argv.includes("list") && argv.includes("--output");
export const isUp = (argv: string[]) => argv[0] === "maki-oss" && argv[1] === "up";
export const isRun = (argv: string[]) => argv[0] === "maki-oss" && argv[1] === "run";
export const isUpload = (argv: string[]) => argv.includes("upload");
export const isBundle = (argv: string[]) => argv[0] === "git" && argv.includes("bundle");

export const answerLine = JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: false,
  result: "PELICAN",
  session_id: "S1",
  duration_ms: 10,
  num_turns: 2,
  usage: { input_tokens: 5 },
});

export interface World {
  phase?: string; // sandbox phase; undefined = missing
  seeded: boolean;
}

export function fakeCtx(world: World, override: Responder = () => undefined) {
  const calls: Call[] = [];
  const run: Runner = async (argv, opts = {}) => {
    calls.push({ argv, opts });
    const out = override(argv, opts) ?? defaultResponse(world, argv);
    return { code: 0, stdout: "", stderr: "", timedOut: false, ...out };
  };
  const ctx: Ctx = { run, openshell: "openshell", makiOss: "maki-oss", log: () => {} };
  return { ctx, calls };
}

function defaultResponse(world: World, argv: string[]): Partial<RunOutput> {
  if (isList(argv)) {
    const sandboxes = world.phase ? [{ name: "repo-fx", phase: world.phase }] : [];
    return ok(JSON.stringify({ sandboxes }));
  }
  if (isUp(argv)) {
    world.phase = "Ready";
    return ok();
  }
  const s = script(argv);
  if (s?.includes("rev-parse --git-dir")) return world.seeded ? ok() : fail(128);
  if (s?.includes("git init -q --bare")) {
    world.seeded = true;
    return ok();
  }
  if (isRun(argv)) return ok(answerLine + "\n");
  return ok();
}
