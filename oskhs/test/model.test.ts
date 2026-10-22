import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CREDENTIAL_ENV, ensureModelProvider, ModelError, pinSandboxProvider, planModel, providerStateFile } from "../src/kiss/model.ts";
import { sandboxRound } from "../src/kiss/sandboxRound.ts";
import { fixture, git, localSandbox } from "./local-sandbox.ts";

const KEY = "test-key-0123456789abcdef";
const openai = { id: "syn:large:text", providerType: "openai", baseUrl: "https://api.synthetic.new/openai/v1/", apiKey: KEY, isExternal: false };
const anthropic = { id: "hf:deepseek-ai/DeepSeek-V4.1-Flash-1017", providerType: "anthropic", baseUrl: "https://llm.example.com:8443", apiKey: KEY };

describe("planModel", () => {
  test("OpenAI protocol under a base path", () => {
    const p = planModel(openai, "kiss-local");
    expect(p).toMatchObject({ protocol: "openai", host: "api.synthetic.new", port: 443, baseUrl: "https://api.synthetic.new/openai/v1", providerName: "oskhs-kiss-local", modelSpec: "kiss/syn:large:text" });
    expect(p.rules).toEqual([{ method: "POST", path: "/openai/v1/chat/completions" }, { method: "GET", path: "/openai/v1/models" }]);
    expect(p.profileId).toMatch(/^oskhs-openai-api-synthetic-new-[0-9a-f]{6}$/);
    expect(p.profileYaml).toContain("auth_style: bearer");
    expect(p.profileYaml).not.toContain("access:");
    expect(p.profileYaml).toContain(`env_vars: [${CREDENTIAL_ENV}]`);
    expect(p.makiConfig).toContain('protocol = "openai"');
    expect(p.makiConfig).toContain('base_url = "https://api.synthetic.new/openai/v1"');
  });
  test("Anthropic protocol at an origin with a port", () => {
    const p = planModel(anthropic, "minecraft");
    expect(p).toMatchObject({ protocol: "anthropic", host: "llm.example.com", port: 8443 });
    expect(p.rules).toEqual([{ method: "POST", path: "/v1/messages" }, { method: "GET", path: "/v1/models" }]);
    expect(p.profileYaml).toContain("header_name: x-api-key");
    expect(p.profileYaml).toContain("port: 8443");
  });
  test("the key appears nowhere but in the fingerprint input", () => {
    const p = planModel(openai, "kiss-local");
    expect(JSON.stringify(p)).not.toContain(KEY);
    expect(planModel({ ...openai, apiKey: "other" }, "kiss-local").fingerprint).not.toBe(p.fingerprint);
    expect(planModel({ ...openai, baseUrl: "https://api.synthetic.new/anthropic", providerType: "anthropic" }, "x").profileId).not.toBe(p.profileId);
  });
  test("incomplete or unsupported providers are refused", () => {
    expect(() => planModel(null, "p")).toThrow(ModelError);
    expect(() => planModel({ ...openai, apiKey: "" }, "p")).toThrow("no API key");
    expect(() => planModel({ ...openai, baseUrl: "http://x.example/v1" }, "p")).toThrow("https");
    expect(() => planModel({ ...openai, providerType: "gemini" }, "p")).toThrow("not supported");
  });
});

describe.skipIf(!Bun.which("openshell"))("generated profiles lint", () => {
  test.each([["openai", openai], ["anthropic", anthropic]] as const)("%s", async (_n, mp) => {
    const file = join(mkdtempSync(join(tmpdir(), "oskhs-lint-")), "p.yaml");
    // a fresh id: lint also refuses ids the gateway already holds
    writeFileSync(file, planModel(mp, "p").profileYaml.replace(/^id: .*$/m, `id: oskhs-lint-${Date.now()}`));
    const out = Bun.spawnSync(["openshell", "profile", "lint", "-f", file]);
    expect(out.exitCode).toBe(0);
  });
});

describe("provider sync", () => {
  test("create once, skip when unchanged, update on a new key, re-create on a new type", async () => {
    const sb = localSandbox();
    const state = providerStateFile(mkdtempSync(join(tmpdir(), "oskhs-state-")));
    const plan = planModel(openai, "kiss-local");
    await ensureModelProvider(sb.ctx, plan, KEY, state);
    expect(sb.gateway.providers.get("oskhs-kiss-local")).toBe(plan.profileId);
    expect(sb.gateway.secrets.get("oskhs-kiss-local")).toBe(KEY);
    expect(statSync(state).mode & 0o777).toBe(0o600);
    const n = sb.calls.length;
    await ensureModelProvider(sb.ctx, plan, KEY, state);
    expect(sb.calls.slice(n).map((c) => c.argv.slice(1, 3).join(" "))).toEqual(["profile describe", "provider get"]);
    const rotated = planModel({ ...openai, apiKey: "rotated" }, "kiss-local");
    await ensureModelProvider(sb.ctx, rotated, "rotated", state);
    expect(sb.calls.at(-1)!.argv.slice(1, 3)).toEqual(["provider", "update"]);
    expect(sb.gateway.secrets.get("oskhs-kiss-local")).toBe("rotated");
    sb.gateway.attached.set("repo-kiss-local", new Set(["oskhs-kiss-local"]));
    const switched = planModel({ ...anthropic, apiKey: "rotated" }, "kiss-local");
    await ensureModelProvider(sb.ctx, switched, "rotated", state);
    expect(sb.gateway.providers.get("oskhs-kiss-local")).toBe(switched.profileId);
    expect([...sb.gateway.attached.get("repo-kiss-local")!]).toEqual([]); // detached before the delete
    for (const c of sb.calls) {
      expect(c.argv.join(" ")).not.toContain(KEY);
      expect(c.argv.join(" ")).not.toContain("rotated");
    }
  });

  test("the project's provider becomes the sandbox's only one", async () => {
    const sb = localSandbox();
    sb.gateway.attached.set("repo-x", new Set(["maki-synthetic", "mcp-context7"]));
    await pinSandboxProvider(sb.ctx, "repo-x", "oskhs-x");
    expect([...sb.gateway.attached.get("repo-x")!]).toEqual(["oskhs-x"]);
  });
});

describe("sandbox round with a kiss model provider", () => {
  const task = (mp: unknown) => ({ _id: "ab12cd34", prompt: "q", state: "processing", projectId: "p1", taskRepositories: [{ projectPath: "g/fx" }], modelProvider: mp });

  async function mirrorDir() {
    const dir = mkdtempSync(join(tmpdir(), "oskhs-mirrors-"));
    await git(tmpdir(), "clone", "-q", "--mirror", await fixture(), join(dir, "g/fx.git"));
    return dir;
  }

  test("syncs the provider, writes Maki's config, runs kiss/<id>", async () => {
    const sb = localSandbox();
    const round = sandboxRound({ ctx: sb.ctx, mirrorDir: await mirrorDir(), providers: ["ignored"], model: "ignored/x", agentName: "k", internalModels: true, stateDir: mkdtempSync(join(tmpdir(), "oskhs-state-")) });
    sb.onRun = async () => ({ code: 0, stdout: '{"type":"result","is_error":false,"result":"ok","session_id":"S"}\n' });
    const reply = await round({ task: task(openai) as never, project: { _id: "p1", title: "kiss-local" }, prompt: "", timeoutSec: 5 }, new AbortController().signal);
    expect(reply).toEqual({ ok: true, text: "ok" });
    const run = sb.calls.find((c) => c.argv[1] === "run")!;
    expect(run.argv).toContain("kiss/syn:large:text");
    expect(run.opts.env).toMatchObject({ MAKI_OSS_PROVIDERS: "oskhs-kiss-local" });
    expect([...sb.gateway.attached.get("repo-kiss-local")!]).toEqual(["oskhs-kiss-local"]);
    const config = readFileSync(sb.path("/sandbox/.config/maki/providers.toml"), "utf8");
    expect(config).toContain(`api_key_env = "${CREDENTIAL_ENV}"`);
    expect(config).not.toContain(KEY);
  });

  test("internal models need --internal-models", async () => {
    const sb = localSandbox();
    const round = sandboxRound({ ctx: sb.ctx, mirrorDir: await mirrorDir(), providers: [], agentName: "k", internalModels: false, stateDir: mkdtempSync(join(tmpdir(), "oskhs-state-")) });
    const reply = await round({ task: task(openai) as never, project: null, prompt: "", timeoutSec: 5 }, new AbortController().signal);
    expect(reply.ok).toBe(false);
    expect((reply as { error: string }).error).toContain("--internal-models");
    expect(sb.calls.some((c) => c.argv[0] === "openshell")).toBe(false);
  });

  test("a provider oskhs cannot use fails the round with the reason", async () => {
    const sb = localSandbox();
    const round = sandboxRound({ ctx: sb.ctx, mirrorDir: await mirrorDir(), providers: [], agentName: "k", internalModels: true, stateDir: mkdtempSync(join(tmpdir(), "oskhs-state-")) });
    const reply = await round({ task: task({ ...openai, providerType: "gemini" }) as never, project: null, prompt: "", timeoutSec: 5 }, new AbortController().signal);
    expect(reply).toEqual({ ok: false, error: "oskhs model setup: model provider type 'gemini' is not supported by oskhs" });
    expect(existsSync(sb.path("/sandbox/.config/maki/providers.toml"))).toBe(false);
  });
});
