import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  journeyMakiConfig,
  liveEnvironment,
  LIVE_PREFIX,
  uploadJourneyConfig,
  withSandbox,
  type LiveEnvironment,
} from "./live-sandbox.ts";

const FAKE = fileURLToPath(new URL("../../fake-openshell.ts", import.meta.url));
const HERE = fileURLToPath(new URL(".", import.meta.url));

let dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), "journey-live-sandbox-"));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
  delete process.env.FAKE_OPENSHELL_TRACE;
  delete process.env.FAKE_SANDBOX_ROOT;
  delete process.env.FAKE_SANDBOX_LIST;
});

function fake(): { env: LiveEnvironment; root: string; trace: () => string[][] } {
  const dir = temp();
  const traceFile = join(dir, "trace.jsonl");
  const root = join(dir, "sandbox-root");
  process.env.FAKE_OPENSHELL_TRACE = traceFile;
  process.env.FAKE_SANDBOX_ROOT = root;
  return {
    env: liveEnvironment({ OPENSHELL_BIN: FAKE, MAKI_OSS_IMAGE: "image:test", MAKI_OSS_POLICY: "/policy.yaml" }),
    root,
    trace: () =>
      readFileSync(traceFile, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as string[]),
  };
}

const has = (trace: string[][], subcommand: string) => trace.filter((argv) => argv[1] === subcommand);

describe("throwaway sandbox lifecycle", () => {
  test("creates, reports Ready, and deletes on success", async () => {
    const { env, trace } = fake();
    let seen = "";
    await withSandbox(env, async (name) => {
      seen = name;
      expect(name.startsWith(LIVE_PREFIX)).toBe(true);
      expect(name.length).toBeLessThanOrEqual(19);
    });
    expect(seen.startsWith(LIVE_PREFIX)).toBe(true);
    expect(has(trace(), "create").length).toBe(1);
    expect(has(trace(), "delete").length).toBe(1);
    expect(trace().at(-1)?.[1]).toBe("delete");
  });

  test("deletes when the run throws", async () => {
    const { env, trace } = fake();
    await expect(
      withSandbox(env, async () => {
        throw new Error("journey failed");
      }),
    ).rejects.toThrow("journey failed");
    expect(has(trace(), "delete").length).toBe(1);
  });

  test("refuses to start while a journey sandbox is left over", async () => {
    const { env, trace } = fake();
    process.env.FAKE_SANDBOX_LIST = `someone-else\n${LIVE_PREFIX}a`;
    await expect(withSandbox(env, async () => {})).rejects.toThrow(`${LIVE_PREFIX}a`);
    expect(has(trace(), "create").length).toBe(0);
    expect(has(trace(), "delete").length).toBe(0);
  });

  test("deletes on SIGINT", async () => {
    const { env, trace } = fake();
    const script = join(temp(), "child.ts");
    writeFileSync(
      script,
      `import { withSandbox, liveEnvironment } from ${JSON.stringify(join(HERE, "live-sandbox.ts"))};\n` +
        `await withSandbox(liveEnvironment(), async () => {\n` +
        `  console.log("running");\n` +
        `  await new Promise(() => {});\n` +
        `});\n`,
    );
    const proc = Bun.spawn([process.execPath, script], {
      env: {
        ...process.env,
        OPENSHELL_BIN: env.openshell,
        MAKI_OSS_IMAGE: env.image,
        MAKI_OSS_POLICY: env.policy,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    let out = "";
    for await (const part of proc.stdout) {
      out += new TextDecoder().decode(part, { stream: true });
      if (out.includes("running")) break;
    }
    proc.kill("SIGINT");
    await Promise.race([proc.exited, Bun.sleep(10_000)]);
    expect(has(trace(), "delete").length).toBe(1);
  });
});

describe("journey-only Maki config", () => {
  test("names only the loopback provider with a placeholder key and YOLO off", () => {
    const config = journeyMakiConfig(47901);
    expect(config["init.lua"]).toContain("always_yolo = false");
    expect(config["init.lua"]).toContain('default_model = "mock/mock-model"');
    expect(config["providers.toml"]).toContain('base_url = "http://127.0.0.1:47901/v1"');
    expect(config["providers.toml"]).toContain('api_key = "journey-placeholder"');
    expect(config["providers.toml"].match(/^\[[^\]]+\]$/gm)).toEqual(["[mock]"]);
    // the reference's MCP set: none
    expect(config["mcp.toml"]).not.toMatch(/^\s*\[/m);
  });

  test("uploads only the three config files and issues no env, provider, or policy command", async () => {
    const { env, root, trace } = fake();
    const configDir = join(temp(), "config");
    await withSandbox(env, async (name) => {
      uploadJourneyConfig(env, name, 47901, configDir);
    });
    const calls = trace();
    expect(calls.some((argv) => argv.some((a) => a === "--env" || a.startsWith("--env=")))).toBe(false);
    expect(calls.some((argv) => argv.includes("--provider"))).toBe(false);
    expect(calls.some((argv) => ["policy", "profile", "provider"].includes(argv[0]))).toBe(false);
    expect(has(calls, "upload").length).toBe(3);

    const published = journeyMakiConfig(47901);
    for (const file of ["init.lua", "providers.toml", "mcp.toml"]) {
      const uploaded = readFileSync(join(root, "sandbox", ".config", "maki", file), "utf8");
      expect(uploaded).toBe(published[file]);
    }
    const providers = readFileSync(join(root, "sandbox", ".config", "maki", "providers.toml"), "utf8");
    expect(providers.match(/http:\/\/[^"\s]+/g)).toEqual(["http://127.0.0.1:47901/v1"]);
  });
});
