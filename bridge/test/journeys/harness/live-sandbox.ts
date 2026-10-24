// Throwaway sandbox lifecycle and journey-only config for the live journey
// run (design decisions 2 and 3). Every command is plain `openshell` argv:
// no `--env`, no `--provider`, and no policy/subcommand other than the
// sandbox lifecycle, so the run cannot widen the boundary.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const LIVE_PREFIX = "maki-oss-journeys-";
export const SANDBOX_HOME = "/sandbox";
export const SANDBOX_WORKDIR = "/sandbox/journey-work";
export const SANDBOX_CONFIG = "/sandbox/.config/maki";

export interface LiveEnvironment {
  openshell: string;
  image: string;
  policy: string;
  engine: string;
}

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

export function liveEnvironment(env: NodeJS.ProcessEnv = process.env): LiveEnvironment {
  const policy = env.MAKI_OSS_POLICY ?? "examples/policies/maki-minimal.yaml";
  return {
    openshell: env.OPENSHELL_BIN ?? "openshell",
    image: env.MAKI_OSS_IMAGE ?? "maki-agent:local",
    policy: policy.startsWith("/") ? policy : join(ROOT, policy),
    engine: env.MAKI_OSS_ENGINE ?? "docker",
  };
}

export interface RunOptions {
  allowFail?: boolean;
}

/** Runs one CLI command and returns trimmed stdout; throws with stderr on failure. */
export function run(env: LiveEnvironment, argv: string[], opts: RunOptions = {}): string {
  const proc = Bun.spawnSync([argv[0] === "openshell" ? env.openshell : argv[0], ...argv.slice(1)], {
    // Bun does not inherit process.env when the option is omitted.
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = proc.stdout.toString().trim();
  if (!opts.allowFail && proc.exitCode !== 0) {
    throw new Error(`${argv.slice(0, 3).join(" ")} failed (${proc.exitCode}): ${proc.stderr.toString().trim()}`);
  }
  return stdout;
}

export function openshellFound(env: LiveEnvironment): boolean {
  return env.openshell.includes("/") ? existsSync(env.openshell) : Boolean(Bun.which(env.openshell));
}

export function gatewayReady(env: LiveEnvironment): boolean {
  if (!openshellFound(env)) return false;
  try {
    run(env, ["openshell", "status"]);
    return true;
  } catch {
    return false;
  }
}

/** The image's immutable id, or an error when the engine cannot see the image. */
export function imageId(env: LiveEnvironment): string {
  return run(env, [env.engine, "image", "inspect", "--format", "{{.Id}}", env.image]);
}

export function imagePresent(env: LiveEnvironment): boolean {
  try {
    imageId(env);
    return true;
  } catch {
    return false;
  }
}

export function sandboxNames(env: LiveEnvironment): string[] {
  return run(env, ["openshell", "sandbox", "list", "--names"])
    .split("\n")
    .map((name) => name.trim())
    .filter(Boolean);
}

/** The gateway caps sandbox names at 19 characters; the prefix is 18. */
const sandboxName = () => `${LIVE_PREFIX}${Math.random().toString(36).slice(2, 3) || "x"}`;

export function leftoverSandboxes(env: LiveEnvironment): string[] {
  return sandboxNames(env).filter((name) => name.startsWith(LIVE_PREFIX));
}

async function waitReady(env: LiveEnvironment, name: string, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const phase = JSON.parse(run(env, ["openshell", "sandbox", "get", name, "-o", "json"])).phase;
    if (phase === "Ready") return;
    if (phase === "Error" || phase === "Completed" || phase === "Stopped") {
      throw new Error(`sandbox ${name} is ${phase}`);
    }
    await Bun.sleep(500);
  }
  throw new Error(`sandbox ${name} did not become Ready within ${timeoutMs}ms`);
}

export function deleteSandbox(env: LiveEnvironment, name: string): void {
  try {
    run(env, ["openshell", "sandbox", "delete", name]);
  } catch (err) {
    console.error(`live journeys: could not delete sandbox ${name}: ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * Creates the run's throwaway sandbox, runs `body`, and deletes the sandbox on
 * success, failure, or SIGINT. Refuses to start when a previous run left one
 * behind, listing it instead of deleting it.
 */
export async function withSandbox<T>(env: LiveEnvironment, body: (name: string) => Promise<T>): Promise<T> {
  const leftovers = leftoverSandboxes(env);
  if (leftovers.length) {
    throw new Error(`leftover journey sandbox: ${leftovers.join(", ")}; delete it before a new run`);
  }
  const name = sandboxName();
  let deleted = false;
  const remove = () => {
    if (deleted) return;
    deleted = true;
    deleteSandbox(env, name);
  };
  // Installed before `create` so an interrupt that lands once the synchronous
  // create call returns still deletes the sandbox.
  const onInterrupt = () => {
    remove();
    process.exit(130);
  };
  process.on("SIGINT", onInterrupt);
  try {
    run(env, [
      "openshell",
      "sandbox",
      "create",
      "--name",
      name,
      "--from",
      env.image,
      "--policy",
      env.policy,
      "--detach",
    ]);
    await waitReady(env, name);
    return await body(name);
  } finally {
    process.off("SIGINT", onInterrupt);
    remove();
  }
}

/** The journey-only Maki config (design decision 3): loopback provider, YOLO off, no MCP server. */
export function journeyMakiConfig(port: number): Record<string, string> {
  return {
    "init.lua": `-- Journey-only Maki config uploaded by the live journey runner.
-- The baked image config keeps always_yolo on; the reference OpenCode asks
-- for permission by default, so the live Maki side must ask too.
maki.setup({
    always_yolo = false,
    provider = {
        default_model = "mock/mock-model",
    },
    ui = {
        thinking_lines = 0,
        typewriter_ms_per_char = 0,
    },
    trust = {
        paths = { "/sandbox", "/sandbox/**" },
        prompt = false,
    },
})
`,
    "providers.toml": `[mock]
display_name = "Mock"
protocol = "openai"
base_url = "http://127.0.0.1:${port}/v1"
api_key = "journey-placeholder"
default_model = "mock/mock-model"

[[mock.models]]
id = "mock-model"
tier = "medium"
context_window = 32768
max_output_tokens = 4096
`,
    // the reference config declares no MCP server; this replaces the image's
    // baked servers, which cannot connect with no provider attached
    "mcp.toml": `# Journey-only MCP config uploaded by the live journey runner: no server,
# the reference OpenCode config's MCP set.
`,
  };
}

/** Writes the journey config and uploads only those files into the sandbox. */
export function uploadJourneyConfig(env: LiveEnvironment, name: string, port: number, dir: string): void {
  mkdirSync(dir, { recursive: true });
  for (const [file, content] of Object.entries(journeyMakiConfig(port))) {
    const local = join(dir, file);
    writeFileSync(local, content);
    run(env, ["openshell", "sandbox", "upload", "--no-git-ignore", name, local, `${SANDBOX_CONFIG}/`]);
  }
}

/** The image's pinned Maki version, without the `maki ` prefix. */
export function makiVersion(env: LiveEnvironment, name: string): string {
  const raw = run(env, [
    "openshell",
    "sandbox",
    "exec",
    "-n",
    name,
    "--no-login-shell",
    "--workdir",
    SANDBOX_HOME,
    "--",
    "maki",
    "--version",
  ]);
  return raw.split(/\s+/).pop() ?? raw;
}

/** Clears Maki sessions and the workdir so each journey starts like a fresh home. */
export function resetSandbox(env: LiveEnvironment, name: string): void {
  run(env, [
    "openshell",
    "sandbox",
    "exec",
    "-n",
    name,
    "--no-login-shell",
    "--workdir",
    SANDBOX_HOME,
    "--",
    "sh",
    "-c",
    `if [ -f /tmp/journey-provider.pid ]; then kill "$(cat /tmp/journey-provider.pid)"; fi; rm -f /tmp/journey-provider.pid; rm -rf ${SANDBOX_HOME}/.local/state/maki ${SANDBOX_HOME}/.local/share/maki ${SANDBOX_WORKDIR} && mkdir -p ${SANDBOX_WORKDIR}`,
  ]);
}

const PROVIDER_FILES = ["standalone-provider.ts", "mock-provider.ts"] as const;

export interface RunningProvider {
  port: number;
  stop(): Promise<void>;
}

/** Starts the standalone provider under the image's Bun on the sandbox loopback. */
export async function startProvider(
  env: LiveEnvironment,
  name: string,
  turnsFile: string,
  timeoutMs = 15_000,
): Promise<RunningProvider> {
  run(env, [
    "openshell",
    "sandbox",
    "exec",
    "-n",
    name,
    "--no-login-shell",
    "--workdir",
    SANDBOX_HOME,
    "--",
    "mkdir",
    "-p",
    "/tmp/journey-provider",
  ]);
  for (const file of PROVIDER_FILES) {
    const local = fileURLToPath(new URL(`./${file}`, import.meta.url));
    run(env, ["openshell", "sandbox", "upload", "--no-git-ignore", name, local, "/tmp/journey-provider/"]);
  }
  run(env, ["openshell", "sandbox", "upload", "--no-git-ignore", name, turnsFile, "/tmp/journey-turns.json"]);

  const proc = Bun.spawn(
    [
      env.openshell,
      "sandbox",
      "exec",
      "-n",
      name,
      "--no-login-shell",
      "--workdir",
      SANDBOX_HOME,
      "--",
      "bun",
      "/tmp/journey-provider/standalone-provider.ts",
      "--turns",
      "/tmp/journey-turns.json",
    ],
    { env: process.env, stdout: "pipe", stderr: "pipe" },
  );
  let stderr = "";
  void (async () => {
    for await (const part of proc.stderr) stderr += new TextDecoder().decode(part);
  })();
  let stdout = "";
  const port = await (async () => {
    const read = (async () => {
      for await (const part of proc.stdout) {
        stdout += new TextDecoder().decode(part, { stream: true });
        const match = /listening on 127\.0\.0\.1:(\d+)/.exec(stdout);
        if (match) return Number(match[1]);
      }
      throw new Error(`in-sandbox provider exited before listening: ${stderr}`);
    })();
    return Promise.race([
      read,
      Bun.sleep(timeoutMs).then(() => {
        throw new Error(`in-sandbox provider did not listen within ${timeoutMs}ms: ${stderr}`);
      }),
    ]);
  })();

  return {
    port,
    async stop() {
      proc.kill();
      await Promise.race([proc.exited, Bun.sleep(5000)]);
      if (proc.exitCode === null) proc.kill(9);
      // The gateway may leave the remote command alive when the exec process
      // dies; end it by the pid the provider wrote.
      run(
        env,
        [
          "openshell",
          "sandbox",
          "exec",
          "-n",
          name,
          "--no-login-shell",
          "--workdir",
          SANDBOX_HOME,
          "--",
          "sh",
          "-c",
          `if [ -f /tmp/journey-provider.pid ]; then kill "$(cat /tmp/journey-provider.pid)"; fi; rm -f /tmp/journey-provider.pid`,
        ],
        { allowFail: true },
      );
    },
  };
}
