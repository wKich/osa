// Warm repo sandbox: ensure it exists and is Ready. Its repository is
// created and filled by the incremental sync (sync.ts).
import { tail } from "./exec.ts";
import { sandboxPhase, type Ctx } from "./openshell.ts";
import { StageError } from "./result.ts";

export interface SandboxSpec {
  sandbox: string;
  providers: string[];
}

// Every maki-oss call: oskhs owns the workspace (no session sync, registry,
// or parking in the helper core) and the warm sandbox's lifecycle (B2).
export const CALLER_ENV: Readonly<Record<string, string>> = { MAKI_OSS_WORKSPACE: "caller", MAKI_OSS_IDLE_STOP: "0" };

export async function ensureSandbox(ctx: Ctx, spec: SandboxSpec, waitMs = 120_000): Promise<void> {
  let phase = await sandboxPhase(ctx, spec.sandbox);
  if (phase !== "Ready") {
    ctx.log(phase ? `starting sandbox ${spec.sandbox} (phase ${phase})` : `creating sandbox ${spec.sandbox}`);
    const env: Record<string, string> = { ...CALLER_ENV, MAKI_OSS_SANDBOX_NAME: spec.sandbox };
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
