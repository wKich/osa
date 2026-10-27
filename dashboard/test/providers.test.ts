// Provider setup tests (dashboard-provider-wizard): the stub osa's `providers`
// and `provider setup`, the argv gate and the stdin runner, and the provider
// routes with their guard order, redaction, and outcome mapping. No gateway,
// no network beyond loopback.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DashboardConfig } from "../src/config.ts";
import { OpenShellClient } from "../src/openshell.ts";
import {
  isAllowedOsaArgv,
  isProviderSetupArgv,
  OsaRunner,
  ProjectService,
  providerSetupArgv,
} from "../src/projects.ts";
import { ProviderService, redact, validateSetup } from "../src/providers.ts";
import { createDashboardServer, type DashboardHandle } from "../src/server.ts";
import { buildStateFixture, SANDBOX, type StateFixture } from "./state-fixture.ts";

const stubDir = join(import.meta.dir, "stub");
const osaStub = join(stubDir, "osa");
/** A distinctive credential every leak check looks for. */
const SECRET = "sk-fixture-9d2c7e41-secret";

const testConfig: DashboardConfig = {
  image: "maki-agent:local",
  policy: "/repo/examples/policies/maki-minimal.yaml",
  providers: [],
  cpu: "2",
  memory: "4Gi",
  configPath: null,
};

let workDir: string;
let answersPath: string;
let osaLog: string;
let stdinLog: string;
let fixture: StateFixture;
let handles: DashboardHandle[];

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "dashboard-providers-test-"));
  answersPath = join(workDir, "osa-answers.json");
  osaLog = join(workDir, "osa-argv.log");
  stdinLog = join(workDir, "osa-stdin.log");
  writeFileSync(answersPath, "{}");
  fixture = buildStateFixture();
  handles = [];
});

afterEach(() => {
  for (const handle of handles) handle.stop();
  rmSync(workDir, { recursive: true, force: true });
  rmSync(fixture.dir, { recursive: true, force: true });
});

function setAnswers(answers: Record<string, unknown>): void {
  writeFileSync(answersPath, JSON.stringify(answers));
}

function stubEnv(): Record<string, string> {
  return { STUB_OSA_FIXTURE: answersPath, STUB_OSA_LOG: osaLog, STUB_OSA_STDIN_LOG: stdinLog };
}

function runner(): OsaRunner {
  return new OsaRunner({ binary: osaStub, env: stubEnv() });
}

function osaCalls(): string[][] {
  if (!existsSync(osaLog)) return [];
  return readFileSync(osaLog, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as string[]);
}

function stdinCalls(): Array<{ argv: string[]; bytes: number }> {
  if (!existsSync(stdinLog)) return [];
  return readFileSync(stdinLog, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { argv: string[]; bytes: number });
}

async function answer(args: string[], input?: string) {
  const proc = Bun.spawn({
    cmd: [osaStub, ...args],
    env: { ...process.env, ...stubEnv() },
    stdin: input === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (input !== undefined && proc.stdin) {
    proc.stdin.write(input);
    await proc.stdin.end();
  }
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

// ---------------------------------------------------------------------------
// Stub
// ---------------------------------------------------------------------------

describe("stub osa providers and provider setup", () => {
  test("providers answers the built-in fixtures", async () => {
    const list = JSON.parse((await answer(["providers", "--json"])).stdout) as Array<Record<string, any>>;
    expect(list.map((entry) => `${entry.agent}:${entry.setup}`)).toEqual(["mk:stdin", "oc:stdin", "cc:stdin", "cx:login"]);
    expect(list[0]!.profiles.map((profile: any) => profile.source)).toContain("custom");
    expect(list[1]!.profiles[0].note).toContain("<img src=x onerror=alert(1)>");
    expect(list[2]!.gateway.error.message).toContain("gateway");
    expect(list[3]!.command).toBe("codex-oss provider setup");
  });

  test("setup modes answer as osa does and log the stdin byte count, never the value", async () => {
    const args = (profile: string, ...extra: string[]) => ["provider", "setup", "mk", "--profile", profile, ...extra, "--json"];
    setAnswers({
      setup: {
        "p-refused": { mode: "refused" },
        "p-failed": { mode: "failed" },
        "p-echo": { mode: "echo-secret" },
        "p-slow": { mode: "slow", delay: 0.2 },
      },
    });
    const created = await answer(args("maki-deepseek", "--attach", SANDBOX.retained), SECRET);
    expect(created.code).toBe(0);
    expect(JSON.parse(created.stdout)).toMatchObject({ outcome: "created", attached: SANDBOX.retained });
    const updated = await answer(args("maki-deepseek", "--yes"), SECRET);
    expect(JSON.parse(updated.stdout).outcome).toBe("updated");
    expect((await answer(args("p-refused"), SECRET)).code).toBe(2);
    const failed = await answer(args("p-failed", "--attach", SANDBOX.retained), SECRET);
    expect(failed.code).toBe(3);
    expect(JSON.parse(failed.stdout).steps).toEqual(["linted", "imported", "created", "remembered"]);
    expect((await answer(args("p-echo"), SECRET)).stdout).toContain(SECRET);
    const started = Date.now();
    expect((await answer(args("p-slow"), SECRET)).code).toBe(0);
    expect(Date.now() - started).toBeGreaterThanOrEqual(200);
    const logged = stdinCalls();
    expect(logged).toHaveLength(6);
    expect(logged.every((call) => call.bytes === SECRET.length)).toBe(true);
    expect(readFileSync(stdinLog, "utf8")).not.toContain(SECRET);
    expect(readFileSync(osaLog, "utf8")).not.toContain(SECRET);
    const listed = JSON.parse((await answer(["providers", "--json"])).stdout) as Array<Record<string, any>>;
    expect(listed[0]!.gateway).toContain("maki-deepseek");
  });
});

// ---------------------------------------------------------------------------
// Argv gate and runner
// ---------------------------------------------------------------------------

describe("provider argv gate and stdin runner", () => {
  test("the two shapes are accepted, built position by position", () => {
    expect(isAllowedOsaArgv(["providers", "--json"])).toBe(true);
    expect(providerSetupArgv({ agent: "mk", profile: "maki-deepseek" })).toEqual([
      "provider", "setup", "mk", "--profile", "maki-deepseek", "--json",
    ]);
    const full = providerSetupArgv({ agent: "oc", profile: "opencode-x", name: "my-x", attach: "oc-app-1", replace: true });
    expect(full).toEqual(["provider", "setup", "oc", "--profile", "opencode-x", "--name", "my-x", "--attach", "oc-app-1", "--yes", "--json"]);
    expect(isAllowedOsaArgv(full)).toBe(true);
    expect(providerSetupArgv({ agent: "mk", profile: "p", replace: false })).not.toContain("--yes");
    for (const args of [
      ["providers"],
      ["providers", "--json", "--agent", "mk"],
      ["provider", "setup", "mk", "--profile", "p", "--json", "--extra"],
      ["provider", "setup", "mk", "--profile", "p", "--stdin", "--json"],
      ["provider", "setup", "mk", "--profile", "../x", "--json"],
      ["provider", "setup", "mk", "--profile", "Bad_Id", "--json"],
      ["provider", "setup", "zz", "--profile", "p", "--json"],
      ["provider", "setup", "mk", "--profile", "p", "--name", "Bad Name", "--json"],
      ["provider", "setup", "mk", "--profile", "p", "--attach", "../x", "--json"],
      ["provider", "setup", "mk", "--yes", "--profile", "p", "--json"],
      ["provider", "setup", "mk", "--profile", "p", "--yes", "--name", "n", "--json"],
      ["provider", "setup", "mk", "--profile", "p", "--json", "--yes"],
      ["provider", "setup", "mk", "--profile", "p"],
      ["provider", "remove", "mk"],
    ]) {
      expect({ args, allowed: isAllowedOsaArgv(args) }).toEqual({ args, allowed: false });
    }
  });

  test("run refuses the setup shape and runWithStdin refuses every other shape", async () => {
    const osa = runner();
    const setupArgs = providerSetupArgv({ agent: "mk", profile: "maki-deepseek" });
    const refused = await osa.run(setupArgs, 5000);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.kind).toBe("invalid_request");
    for (const args of [["providers", "--json"], ["status", "/p", "--json"], ["image", "build", "mk"]]) {
      const result = await osa.runWithStdin(args, SECRET, 5000);
      expect(result.ok).toBe(false);
    }
    expect(osaCalls()).toEqual([]);
    const ran = await osa.runWithStdin(setupArgs, SECRET, 5000);
    expect(ran.ok).toBe(true);
    if (ran.ok) expect(ran.value.argv).not.toContain(SECRET);
    expect(stdinCalls()).toEqual([{ argv: setupArgs, bytes: SECRET.length }]);
  });

  test("validation names the field, never the value", () => {
    const root = fixture.stateRoot;
    const ok = validateSetup({ agent: "mk", profile: "maki-deepseek", attach: SANDBOX.retained, credential: SECRET }, root);
    expect(ok.ok).toBe(true);
    for (const [body, field] of [
      [{ agent: "zz", profile: "p", credential: SECRET }, "agent"],
      [{ agent: "mk", profile: "../p", credential: SECRET }, "profile"],
      [{ agent: "mk", profile: "p", name: "Bad Name", credential: SECRET }, "name"],
      [{ agent: "mk", profile: "p", attach: SANDBOX.parked, credential: SECRET }, "attach"],
      [{ agent: "mk", profile: "p", attach: "mk-nowhere-0000", credential: SECRET }, "attach"],
      [{ agent: "mk", profile: "p", replace: "yes", credential: SECRET }, "replace"],
      [{ agent: "mk", profile: "p", credential: "" }, "credential"],
      [{ agent: "mk", profile: "p", credential: `${SECRET}\nsecond` }, "credential"],
      [{ agent: "mk", profile: "p", credential: "k".repeat(65_537) }, "credential"],
      [{ agent: "mk", profile: "p", credential: SECRET, extra: 1 }, "extra"],
    ] as Array<[Record<string, unknown>, string]>) {
      const result = validateSetup(body, root);
      expect({ field, result: result.ok ? "ok" : result.field }).toEqual({ field, result: field });
      if (!result.ok) expect(result.message).not.toContain(SECRET);
    }
  });

  test("redaction replaces raw and JSON-escaped copies", () => {
    expect(redact(`a ${SECRET} b ${SECRET}`, SECRET)).toBe("a [redacted] b [redacted]");
    const quoted = 'p"q\\r';
    expect(redact(JSON.stringify({ message: `x ${quoted}` }), quoted)).toBe('{"message":"x [redacted]"}');
  });
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

describe("provider routes", () => {
  function start(
    overrides: { readOnly?: boolean; host?: string; token?: string; setupTimeoutMs?: number } = {},
  ): DashboardHandle {
    const projects = new ProjectService({
      stateRoot: fixture.stateRoot,
      runnerOptions: { binary: osaStub, env: stubEnv() },
    });
    const handle = createDashboardServer({
      host: overrides.host,
      port: 0,
      token: overrides.token,
      client: new OpenShellClient({ env: { PATH: `${stubDir}:${process.env.PATH ?? ""}` } }),
      config: testConfig,
      readOnly: overrides.readOnly,
      projects,
      providers: new ProviderService({
        stateRoot: fixture.stateRoot,
        runner: projects.runner,
        setupTimeoutMs: overrides.setupTimeoutMs,
      }),
    });
    handles.push(handle);
    return handle;
  }

  const base = (handle: DashboardHandle) => `http://127.0.0.1:${handle.port}`;
  const setupBody = (extra: Record<string, unknown> = {}) =>
    JSON.stringify({ agent: "mk", profile: "maki-deepseek", credential: SECRET, ...extra });

  async function post(
    handle: DashboardHandle,
    body: string | ReadableStream<Uint8Array>,
    headers: Record<string, string> = { "content-type": "application/json", "x-dashboard-token": handle.token ?? "" },
  ): Promise<{ status: number; text: string; body: Record<string, any> }> {
    const response = await fetch(`${base(handle)}/api/providers/setup`, {
      method: "POST",
      headers,
      body,
      // A stream body is sent chunked.
      ...(typeof body === "string" ? {} : { duplex: "half" }),
    } as RequestInit);
    const text = await response.text();
    let parsed: Record<string, any> = {};
    try {
      parsed = JSON.parse(text) as Record<string, any>;
    } catch {
      parsed = {};
    }
    return { status: response.status, text, body: parsed };
  }

  test("GET /api/providers lists osa providers, in read-only mode too", async () => {
    const handle = start({ readOnly: true });
    const response = await fetch(`${base(handle)}/api/providers`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { providers: Array<Record<string, any>> };
    expect(body.providers.map((entry) => entry.agent)).toEqual(["mk", "oc", "cc", "cx"]);
    expect(osaCalls()).toEqual([["providers", "--json"]]);
  });

  test("off loopback the route is 403 before the body is read", async () => {
    const handle = start({ host: "0.0.0.0", token: "remote-token" });
    let pulls = 0;
    // A body that never ends: a server that read it would never answer.
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        pulls += 1;
        if (pulls === 1) controller.enqueue(new TextEncoder().encode('{"credential":"'));
        else await new Promise(() => {});
      },
    });
    const started = Date.now();
    const result = await Promise.race([
      post(handle, body, { "content-type": "application/json", "x-dashboard-token": "remote-token" }),
      Bun.sleep(3000).then(() => ({ status: 0, text: "", body: {} })),
    ]);
    expect(result.status).toBe(403);
    expect(result.body.error.kind).toBe("loopback_only");
    expect(Date.now() - started).toBeLessThan(3000);
    const plain = await post(handle, setupBody(), { "content-type": "application/json", "x-dashboard-token": "remote-token" });
    expect(plain.status).toBe(403);
    expect(osaCalls()).toEqual([]);
  });

  test("read-only, a missing token, the content type, and the size are refused in order", async () => {
    const readOnly = start({ readOnly: true });
    const refused = await post(readOnly, setupBody());
    expect(refused).toMatchObject({ status: 403, body: { error: { kind: "read_only" } } });
    const handle = start();
    expect((await post(handle, setupBody(), { "content-type": "application/json" })).status).toBe(403);
    expect((await post(handle, setupBody(), { "content-type": "text/plain", "x-dashboard-token": handle.token! })).status).toBe(415);
    const large = JSON.stringify({ agent: "mk", profile: "p", credential: "k".repeat(72 * 1024) });
    expect((await post(handle, large)).status).toBe(413);
    const chunks = [large.slice(0, 1000), large.slice(1000)];
    const chunked = new ReadableStream<Uint8Array>({
      pull(controller) {
        const next = chunks.shift();
        if (next === undefined) controller.close();
        else controller.enqueue(new TextEncoder().encode(next));
      },
    });
    expect((await post(handle, chunked)).status).toBe(413);
    expect(osaCalls()).toEqual([]);
  });

  test("each invalid field is 400 naming the field, and runs nothing", async () => {
    const handle = start();
    for (const [extra, field] of [
      [{ agent: "zz" }, "agent"],
      [{ profile: "Bad" }, "profile"],
      [{ name: "a b" }, "name"],
      [{ attach: SANDBOX.parked }, "attach"],
      [{ replace: 1 }, "replace"],
      [{ credential: "" }, "credential"],
      [{ credential: `${SECRET}\n` }, "credential"],
    ] as Array<[Record<string, unknown>, string]>) {
      const result = await post(handle, setupBody(extra));
      expect({ field, status: result.status, got: result.body.error?.field }).toEqual({ field, status: 400, got: field });
      expect(result.text).not.toContain(SECRET);
    }
    expect((await post(handle, "not json")).status).toBe(400);
    expect(osaCalls()).toEqual([]);
  });

  test("a second setup while one runs is 409 and runs nothing", async () => {
    setAnswers({ setup: { "maki-deepseek": { delay: 0.5 } } });
    const handle = start();
    const first = post(handle, setupBody());
    await Bun.sleep(150);
    const second = await post(handle, setupBody({ profile: "maki-anthropic" }));
    expect(second).toMatchObject({ status: 409, body: { error: { kind: "busy" } } });
    expect((await first).status).toBe(200);
    expect(stdinCalls()).toHaveLength(1);
  });

  test("osa's exit codes map to 200, 409, 400, 502, and a timeout to 504", async () => {
    setAnswers({
      setup: {
        "p-refused": { mode: "refused" },
        "p-usage": { mode: "usage" },
        "p-failed": { mode: "failed" },
        "p-slow": { mode: "slow", delay: 5 },
      },
    });
    const handle = start({ setupTimeoutMs: 400 });
    const created = await post(handle, setupBody({ attach: SANDBOX.retained }));
    expect(created).toMatchObject({ status: 200, body: { outcome: "created", attached: SANDBOX.retained, exitCode: 0 } });
    const updated = await post(handle, setupBody({ replace: true }));
    expect(updated).toMatchObject({ status: 200, body: { outcome: "updated" } });
    const refused = await post(handle, setupBody({ profile: "p-refused" }));
    expect(refused).toMatchObject({ status: 409, body: { outcome: "refused", exitCode: 2, error: { kind: "refused" } } });
    expect((await post(handle, setupBody({ profile: "p-usage" }))).status).toBe(400);
    const failed = await post(handle, setupBody({ profile: "p-failed", attach: SANDBOX.retained }));
    expect(failed).toMatchObject({
      status: 502,
      body: { outcome: "failed", exitCode: 3, steps: ["linted", "imported", "created", "remembered"], error: { kind: "exit" } },
    });
    expect((await post(handle, setupBody({ profile: "p-slow" }))).status).toBe(504);
    const setups = osaCalls().filter((argv) => argv[0] === "provider");
    expect(setups[0]).toEqual(["provider", "setup", "mk", "--profile", "maki-deepseek", "--attach", SANDBOX.retained, "--json"]);
    expect(setups[1]).toEqual(["provider", "setup", "mk", "--profile", "maki-deepseek", "--yes", "--json"]);
  });

  test("an echoed credential is redacted, and the credential is in no response, argv, or server output", async () => {
    setAnswers({ setup: { "p-echo": { mode: "echo-secret" }, "p-failed": { mode: "failed" } } });
    const handle = start();
    const captured: string[] = [];
    const original = { log: console.log, warn: console.warn, error: console.error };
    for (const level of ["log", "warn", "error"] as const) {
      console[level] = (...args: unknown[]) => captured.push(args.map(String).join(" "));
    }
    const responses: string[] = [];
    try {
      const echoed = await post(handle, setupBody({ profile: "p-echo" }));
      expect(echoed.status).toBe(200);
      expect(echoed.body.message).toContain("[redacted]");
      responses.push(echoed.text);
      responses.push((await post(handle, setupBody({ profile: "p-failed" }))).text);
      responses.push((await post(handle, setupBody({ credential: `${SECRET}\nx` }))).text);
      responses.push(await (await fetch(`${base(handle)}/api/providers`)).text());
    } finally {
      Object.assign(console, original);
    }
    for (const text of responses) expect(text).not.toContain(SECRET);
    expect(captured.join("\n")).not.toContain(SECRET);
    expect(readFileSync(osaLog, "utf8")).not.toContain(SECRET);
    expect(stdinCalls().map((call) => call.bytes)).toEqual([SECRET.length, SECRET.length]);
  });
});
