// Warm repo sandbox: ensure it exists, seed it once with full history.
//
// The clone is a bare repository whose delivered branches live under
// refs/remotes/origin/* (fetched from the bundle with an explicit refspec),
// so no branch is checked out by the repo itself and every task worktree
// starts detached. The seed bundle is deleted afterwards; the repo has no
// remote URL, so network git has nothing to reach.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tail } from "./exec.ts";
import { IN_DIR, REPO_DIR } from "./names.ts";
import { sandboxPhase, sandboxSh, upload, type Ctx } from "./openshell.ts";
import { StageError } from "./result.ts";

export interface SandboxSpec {
  sandbox: string;
  providers: string[];
}

export async function ensureSandbox(ctx: Ctx, spec: SandboxSpec, waitMs = 120_000): Promise<void> {
  let phase = await sandboxPhase(ctx, spec.sandbox);
  if (phase !== "Ready") {
    ctx.log(phase ? `starting sandbox ${spec.sandbox} (phase ${phase})` : `creating sandbox ${spec.sandbox}`);
    const env: Record<string, string> = { MAKI_OSS_SANDBOX_NAME: spec.sandbox };
    if (spec.providers.length) env.MAKI_OSS_PROVIDERS = spec.providers.join(",");
    if (ctx.gateway) env.MAKI_OSS_GATEWAY = ctx.gateway;
    // `up` never uploads a project directory (explore finding 1)
    const out = await ctx.run([ctx.makiOss, "up"], { env });
    if (out.code !== 0) throw new StageError("sandbox", out.code, tail(out.stderr + out.stdout));
    phase = await sandboxPhase(ctx, spec.sandbox);
  }
  const deadline = Date.now() + waitMs;
  while (phase !== "Ready") {
    if (Date.now() > deadline) throw new StageError("sandbox", 0, `sandbox ${spec.sandbox} still '${phase}' after ${waitMs / 1000}s`);
    await Bun.sleep(2000);
    phase = await sandboxPhase(ctx, spec.sandbox);
  }
}

export async function isSeeded(ctx: Ctx, sandbox: string): Promise<boolean> {
  const out = await sandboxSh(ctx, sandbox, 'git -C "$1" rev-parse --git-dir >/dev/null 2>&1', [REPO_DIR]);
  return out.code === 0;
}

// $1 repo dir, $2 uploaded bundle. Any failure removes the partial repo.
const CLONE_SCRIPT = `repo=$1 bundle=$2
fail() { rm -rf "$repo" "$bundle"; exit 1; }
rm -rf "$repo"
git init -q --bare "$repo" || fail
git -C "$repo" fetch -q "$bundle" '+refs/heads/*:refs/remotes/origin/*' '+refs/tags/*:refs/tags/*' || fail
rm -f "$bundle"`;

/** Full-history seed from a local clone; no-op when already seeded. */
export async function seedIfNeeded(ctx: Ctx, sandbox: string, repo: string): Promise<boolean> {
  if (await isSeeded(ctx, sandbox)) return false;
  ctx.log(`seeding ${sandbox} from ${repo}`);
  const dir = await mkdtemp(join(tmpdir(), "oskhs-seed-"));
  try {
    const bundle = join(dir, "seed.bundle");
    const made = await ctx.run(["git", "-C", repo, "bundle", "create", bundle, "--branches", "--tags"]);
    if (made.code !== 0) throw new StageError("seed", made.code, tail(made.stderr));
    const dest = `${IN_DIR}/seed-${Date.now()}.bundle`;
    const up = await upload(ctx, sandbox, bundle, dest);
    if (up.code !== 0) throw new StageError("seed", up.code, tail(up.stderr + up.stdout));
    const cloned = await sandboxSh(ctx, sandbox, CLONE_SCRIPT, [REPO_DIR, dest]);
    if (cloned.code !== 0) throw new StageError("seed", cloned.code, tail(cloned.stderr));
    return true;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
