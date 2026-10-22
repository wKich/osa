// Gateway calls oskhs makes directly: sandbox exec for git steps, upload for
// bundles, list for readiness. No call ever carries --env (security
// invariant); in-sandbox scripts take their inputs as positional arguments,
// never by interpolating them into the script text.
import type { RunOpts, RunOutput, Runner } from "./exec.ts";

export interface Ctx {
  run: Runner;
  openshell: string; // openshell CLI
  makiOss: string; // bin/maki-oss
  gateway?: string;
  log: (msg: string) => void;
}

function base(ctx: Ctx): string[] {
  return ctx.gateway ? [ctx.openshell, "-g", ctx.gateway] : [ctx.openshell];
}

/** `sh -c <script> oskhs <args…>` in the sandbox, without login files. */
export function sandboxSh(ctx: Ctx, sandbox: string, script: string, args: string[] = [], opts: RunOpts = {}): Promise<RunOutput> {
  return ctx.run([...base(ctx), "sandbox", "exec", "-n", sandbox, "--no-login-shell", "--", "sh", "-c", script, "oskhs", ...args], opts);
}

export function upload(ctx: Ctx, sandbox: string, local: string, dest: string): Promise<RunOutput> {
  return ctx.run([...base(ctx), "sandbox", "upload", "--no-git-ignore", sandbox, local, dest]);
}

export async function sandboxPhase(ctx: Ctx, sandbox: string): Promise<string | undefined> {
  const out = await ctx.run([...base(ctx), "sandbox", "list", "--output", "json"]);
  if (out.code !== 0) throw new Error(`cannot list sandboxes (exit ${out.code}): ${out.stderr.trim()}`);
  const list = JSON.parse(out.stdout || "{}") as { sandboxes?: { name: string; phase?: string }[] };
  return list.sandboxes?.find((s) => s.name === sandbox)?.phase;
}
