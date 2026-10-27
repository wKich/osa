// HTTP server tests: routing, JSON payloads against the stub CLI, token and
// read-only guards, and SSE lifecycle. No gateway, no Docker, no network
// beyond loopback.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DashboardConfig } from "../src/config.ts";
import {
  OpenShellClient,
  type LogsProcess,
  type Result,
} from "../src/openshell.ts";
import { PATCH_LIMIT_BYTES, ProjectService } from "../src/projects.ts";
import {
  createDashboardServer,
  moduleAllowlist,
  type DashboardHandle,
} from "../src/server.ts";
import {
  buildStateFixture,
  emptyStateHome,
  RETAINED_PATCH,
  SANDBOX,
  writeMarker,
  type StateFixture,
} from "./state-fixture.ts";

const stubDir = join(import.meta.dir, "stub");

const testConfig: DashboardConfig = {
  image: "maki-agent:local",
  policy: "/repo/examples/policies/maki-minimal.yaml",
  providers: ["maki-anthropic"],
  cpu: "2",
  memory: "4Gi",
  configPath: "/home/test/.config/maki-oss/config.toml",
};

let workDir: string;
let stateDir: string;
let logPath: string;
let handles: DashboardHandle[];

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "dashboard-server-test-"));
  stateDir = join(workDir, "state");
  logPath = join(workDir, "argv.log");
  mkdirSync(stateDir, { recursive: true });
  handles = [];
});

afterEach(() => {
  for (const handle of handles) handle.stop();
  rmSync(workDir, { recursive: true, force: true });
});

function seedSandbox(name: string, phase = "Ready"): void {
  mkdirSync(join(stateDir, "sandboxes"), { recursive: true });
  mkdirSync(join(stateDir, "providers"), { recursive: true });
  writeFileSync(join(stateDir, "sandboxes", name), `${phase}\n`);
  writeFileSync(join(stateDir, "providers", name), "maki-anthropic\n");
}

function makeClient(env: Record<string, string | undefined> = {}): OpenShellClient {
  return new OpenShellClient({
    env: {
      PATH: `${stubDir}:${process.env.PATH ?? ""}`,
      STUB_STATE_DIR: stateDir,
      STUB_LOG: logPath,
      ...env,
    },
  });
}

function start(
  overrides: {
    readOnly?: boolean;
    token?: string;
    host?: string;
    config?: DashboardConfig;
    client?: OpenShellClient;
    projects?: ProjectService;
  } = {},
): DashboardHandle {
  const handle = createDashboardServer({
    host: overrides.host,
    port: 0,
    client: overrides.client ?? makeClient(),
    config: overrides.config ?? testConfig,
    readOnly: overrides.readOnly,
    token: overrides.token,
    projects: overrides.projects,
  });
  handles.push(handle);
  return handle;
}

function base(handle: DashboardHandle): string {
  return `http://127.0.0.1:${handle.port}`;
}

function authHeaders(handle: DashboardHandle): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-dashboard-token": handle.token ?? "",
  };
}

function argvLog(): string {
  return existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
}

function resetLog(): void {
  writeFileSync(logPath, "");
}

function phase(name: string): string {
  return readFileSync(join(stateDir, "sandboxes", name), "utf8").trim();
}

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (text: string) => boolean,
  timeoutMs = 2000,
): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + timeoutMs;
  while (!predicate(text)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error(`timed out waiting for SSE output; got: ${JSON.stringify(text)}`);
    }
    const result = await Promise.race([
      reader.read(),
      Bun.sleep(remaining).then(
        (): { done: boolean; value: Uint8Array | undefined } => ({
          done: true,
          value: undefined,
        }),
      ),
    ]);
    if (result.done) break;
    text += decoder.decode(result.value, { stream: true });
  }
  return text;
}

describe("page and doctor", () => {
  test("GET / serves the shell with the session bootstrap", async () => {
    const handle = start();
    const response = await fetch(`${base(handle)}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("dashboard-bootstrap");
    expect(html).toContain('id="tab-projects"');
    expect(html).toContain('id="tab-sandboxes"');
    expect(html).toContain('id="attention"');
    expect(html).toContain('<script type="module" src="/app/main.js"></script>');
    expect(html).toContain(`"token":"${handle.token}"`);
    expect(html).toContain('"readOnly":false');
    expect(html).toContain('"refreshMs":3000');
    expect(html).toContain(testConfig.image);
  });

  test("loopback read-only mode serves a read token for streams", async () => {
    const handle = start({ readOnly: true });
    expect(handle.token).toBeString();
    const html = await (await fetch(`${base(handle)}/`)).text();
    expect(html).toContain('"readOnly":true');
    expect(html).toContain(`"token":"${handle.token}"`);
  });

  test("GET /api/doctor reports CLI and gateway status", async () => {
    const handle = start();
    const body = await (await fetch(`${base(handle)}/api/doctor`)).json();
    expect(body.cli.ok).toBe(true);
    expect(body.cli.version).toContain("openshell");
    expect(body.gateway.ok).toBe(true);
    expect(body.readOnly).toBe(false);
    expect(body.tokenRequired).toBe(true);
  });

  test("non-loopback bind requires an explicit token", () => {
    expect(() => createDashboardServer({ host: "0.0.0.0", port: 0 })).toThrow(/token/);
  });
});

const REMOTE_TOKEN = "remote-secret-token";

function startRemote(overrides: { readOnly?: boolean; host?: string } = {}): DashboardHandle {
  return start({ host: overrides.host ?? "0.0.0.0", token: REMOTE_TOKEN, readOnly: overrides.readOnly });
}

describe("host validation", () => {
  test("a loopback bind refuses a foreign Host before the page or any API route", async () => {
    seedSandbox("demo");
    const handle = start();
    resetLog();
    for (const path of ["/", "/api/sandboxes", "/api/doctor", "/api/projects", "/app/main.js"]) {
      const response = await fetch(`${base(handle)}${path}`, {
        headers: { host: `evil.example:${handle.port}` },
      });
      expect(response.status).toBe(403);
      const text = await response.text();
      expect(text).not.toContain(handle.token ?? "no-token");
      expect(text).not.toContain("demo");
    }
    const stream = await fetch(`${base(handle)}/events/logs?name=demo&token=${handle.token}`, {
      headers: { host: "evil.example" },
    });
    expect(stream.status).toBe(403);
    expect(argvLog()).toBe("");
  });

  test("a loopback bind accepts only the loopback names and its own port", async () => {
    const handle = start();
    const hosts = [
      `127.0.0.1:${handle.port}`,
      `localhost:${handle.port}`,
      `[::1]:${handle.port}`,
      "localhost",
      "LOCALHOST",
    ];
    for (const host of hosts) {
      const response = await fetch(`${base(handle)}/api/doctor`, { headers: { host } });
      expect(response.status).toBe(200);
    }
    for (const host of [`localhost:${handle.port + 1}`, "localhost.evil.example", "127.0.0.2", "[::2]"]) {
      const response = await fetch(`${base(handle)}/api/doctor`, { headers: { host } });
      expect(response.status).toBe(403);
    }
  });

  test("a concrete non-loopback bind also accepts its own address", async () => {
    // A concrete non-loopback address; skip if this host cannot bind it.
    let handle: DashboardHandle;
    try {
      handle = startRemote({ host: "127.0.0.2" });
    } catch {
      return;
    }
    const headers = { "x-dashboard-token": REMOTE_TOKEN };
    const own = await fetch(`http://127.0.0.2:${handle.port}/api/doctor`, { headers });
    expect(own.status).toBe(200);
    const foreign = await fetch(`http://127.0.0.2:${handle.port}/api/doctor`, {
      headers: { ...headers, host: `evil.example:${handle.port}` },
    });
    expect(foreign.status).toBe(403);
  });

  test("a wildcard bind accepts any host but still needs the token", async () => {
    const handle = startRemote();
    const host = `dashboard.internal:${handle.port}`;
    const open = await fetch(`${base(handle)}/api/doctor`, { headers: { host } });
    expect(open.status).toBe(403);
    const authed = await fetch(`${base(handle)}/api/doctor`, {
      headers: { host, "x-dashboard-token": REMOTE_TOKEN },
    });
    expect(authed.status).toBe(200);
  });
});

describe("non-loopback token confidentiality", () => {
  test("the page without the token is refused and leaks nothing", async () => {
    seedSandbox("demo");
    const handle = startRemote();
    resetLog();
    for (const path of ["/", "/index.html", "/?token=wrong", "/?token="]) {
      const response = await fetch(`${base(handle)}${path}`);
      expect(response.status).toBe(403);
      const text = await response.text();
      expect(text).not.toContain(REMOTE_TOKEN);
      expect(text).not.toContain("dashboard-bootstrap");
      expect(text).not.toContain(testConfig.image);
    }
    expect(argvLog()).toBe("");
  });

  test("the page with the token embeds it for same-origin calls", async () => {
    const handle = startRemote();
    const response = await fetch(`${base(handle)}/?token=${REMOTE_TOKEN}`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("dashboard-bootstrap");
    expect(html).toContain(`"token":"${REMOTE_TOKEN}"`);
  });

  test("API reads without the token are refused and run no command", async () => {
    seedSandbox("demo");
    const handle = startRemote();
    resetLog();
    const paths = [
      "/api/doctor",
      "/api/sandboxes",
      "/api/sandboxes/demo",
      "/api/sandboxes/demo/policy",
      "/api/sandboxes/demo/rules",
      "/api/projects",
      "/api/projects/demo/status",
      "/api/projects/demo/patch",
    ];
    for (const path of paths) {
      for (const headers of [{}, { "x-dashboard-token": "wrong" }]) {
        const response = await fetch(`${base(handle)}${path}`, { headers });
        expect(response.status).toBe(403);
        const text = await response.text();
        expect(text).not.toContain(REMOTE_TOKEN);
        expect(text).not.toContain("demo");
      }
    }
    expect(argvLog()).toBe("");
  });

  test("API reads with the token are served", async () => {
    seedSandbox("demo");
    const handle = startRemote();
    const headers = { "x-dashboard-token": REMOTE_TOKEN };
    const sandboxes = await fetch(`${base(handle)}/api/sandboxes`, { headers });
    expect(sandboxes.status).toBe(200);
    expect(JSON.stringify(await sandboxes.json())).toContain("demo");
    const projects = await fetch(`${base(handle)}/api/projects`, { headers });
    expect(projects.status).toBe(200);
  });

  test("streams need the token and mutations keep needing the header", async () => {
    seedSandbox("demo");
    const handle = startRemote();
    resetLog();
    const stream = await fetch(`${base(handle)}/events/logs?name=demo`);
    expect(stream.status).toBe(403);
    await stream.text();
    const mutation = await fetch(`${base(handle)}/api/sandboxes/demo/stop`, { method: "POST" });
    expect(mutation.status).toBe(403);
    expect(argvLog()).toBe("");
    expect(phase("demo")).toBe("Ready");

    const authed = await fetch(`${base(handle)}/api/sandboxes/demo/stop`, {
      method: "POST",
      headers: { "x-dashboard-token": REMOTE_TOKEN },
    });
    expect(authed.status).toBe(200);
    expect(phase("demo")).toBe("Stopped");
  });

  test("static modules stay open so the authenticated page can load them", async () => {
    const handle = startRemote();
    const response = await fetch(`${base(handle)}/app/main.js`);
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain(REMOTE_TOKEN);
  });

  test("read-only remote requires the token for page, reads, and logs, and refuses every mutation", async () => {
    seedSandbox("demo");
    const handle = startRemote({ readOnly: true });
    resetLog();
    expect((await fetch(`${base(handle)}/`)).status).toBe(403);
    expect((await fetch(`${base(handle)}/api/sandboxes`)).status).toBe(403);
    const logs = await fetch(`${base(handle)}/events/logs?name=demo`);
    expect(logs.status).toBe(403);
    await logs.text();
    const bare = await fetch(`${base(handle)}/api/sandboxes/demo/stop`, { method: "POST" });
    expect(bare.status).toBe(403);
    const withToken = await fetch(`${base(handle)}/api/sandboxes/demo/stop`, {
      method: "POST",
      headers: { "x-dashboard-token": REMOTE_TOKEN },
    });
    expect(withToken.status).toBe(403);
    expect((await withToken.json()).error.kind).toBe("read_only");
    expect(argvLog()).toBe("");
    expect(phase("demo")).toBe("Ready");

    const page = await fetch(`${base(handle)}/?token=${REMOTE_TOKEN}`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('"readOnly":true');
    const reads = await fetch(`${base(handle)}/api/sandboxes`, {
      headers: { "x-dashboard-token": REMOTE_TOKEN },
    });
    expect(reads.status).toBe(200);
  });
});

describe("read routes", () => {
  test("GET /api/sandboxes lists inventory", async () => {
    seedSandbox("demo");
    const handle = start();
    const body = await (await fetch(`${base(handle)}/api/sandboxes`)).json();
    expect(body.sandboxes).toHaveLength(1);
    expect(body.sandboxes[0].name).toBe("demo");
    expect(body.sandboxes[0].phase).toBe("Ready");
  });

  test("GET /api/sandboxes/:name bundles detail, providers, and revisions", async () => {
    seedSandbox("demo");
    const handle = start();
    const response = await fetch(`${base(handle)}/api/sandboxes/demo`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.sandbox.name).toBe("demo");
    expect(body.sandbox.policySource).toBe("sandbox");
    expect(body.providers[0].name).toBe("maki-anthropic");
    expect(body.revisions).toHaveLength(3);
    expect(body.errors).toEqual({});
  });

  test("policy view selects base or effective payload", async () => {
    seedSandbox("demo");
    const handle = start();
    const full = await (await fetch(`${base(handle)}/api/sandboxes/demo/policy`)).json();
    const baseView = await (
      await fetch(`${base(handle)}/api/sandboxes/demo/policy?view=base`)
    ).json();
    const fullKeys = Object.keys(full.policy.policy.network_policies);
    const baseKeys = Object.keys(baseView.policy.policy.network_policies);
    expect(fullKeys).toContain("provider:stub");
    expect(baseKeys).not.toContain("provider:stub");
  });

  test("rules list parses pending proposals", async () => {
    seedSandbox("demo");
    const handle = start();
    const body = await (
      await fetch(`${base(handle)}/api/sandboxes/demo/rules?status=pending`)
    ).json();
    expect(body.rules).toHaveLength(1);
    expect(body.rules[0].chunkId).toBe("chunk-pending-1");
    expect(body.rules[0].status).toBe("pending");
  });

  test("unknown routes return 404 JSON", async () => {
    const handle = start();
    const response = await fetch(`${base(handle)}/api/nope`);
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.kind).toBe("not_found");
  });
});

describe("mutation guards", () => {
  test("mutating routes reject a missing or wrong token", async () => {
    seedSandbox("demo");
    const handle = start();

    const noToken = await fetch(`${base(handle)}/api/sandboxes/demo/stop`, { method: "POST" });
    expect(noToken.status).toBe(403);
    expect(phase("demo")).toBe("Ready");

    const wrongToken = await fetch(`${base(handle)}/api/sandboxes/demo/stop`, {
      method: "POST",
      headers: { "x-dashboard-token": "not-the-token" },
    });
    expect(wrongToken.status).toBe(403);
    expect(phase("demo")).toBe("Ready");

    const ok = await fetch(`${base(handle)}/api/sandboxes/demo/stop`, {
      method: "POST",
      headers: authHeaders(handle),
    });
    expect(ok.status).toBe(200);
    expect(phase("demo")).toBe("Stopped");
  });

  test("read-only mode rejects every mutation and performs no action", async () => {
    seedSandbox("demo");
    const handle = start({ readOnly: true });
    const response = await fetch(`${base(handle)}/api/sandboxes/demo/delete`, {
      method: "POST",
      headers: { "x-dashboard-token": "anything" },
    });
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.kind).toBe("read_only");
    expect(existsSync(join(stateDir, "sandboxes", "demo"))).toBe(true);
  });

  test("create uses configured defaults and requires the token", async () => {
    seedSandbox("demo");
    const handle = start();

    const denied = await fetch(`${base(handle)}/api/sandboxes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "scratch" }),
    });
    expect(denied.status).toBe(403);
    expect(existsSync(join(stateDir, "sandboxes", "scratch"))).toBe(false);

    const created = await fetch(`${base(handle)}/api/sandboxes`, {
      method: "POST",
      headers: authHeaders(handle),
      body: JSON.stringify({ name: "scratch" }),
    });
    expect(created.status).toBe(201);
    expect(existsSync(join(stateDir, "sandboxes", "scratch"))).toBe(true);

    const log = argvLog();
    expect(log).toContain("--from");
    expect(log).toContain(testConfig.image);
    expect(log).toContain("--policy");
    expect(log).toContain(testConfig.policy!);
    expect(log).toContain("--provider");
    expect(log).toContain("maki-anthropic");
    expect(log).toContain("--cpu");
    expect(log).toContain("--memory");
  });

  test("rule approve and reject-with-reason hit the CLI; empty reason does not", async () => {
    seedSandbox("demo");
    const handle = start();

    const approve = await fetch(
      `${base(handle)}/api/sandboxes/demo/rules/chunk-pending-1/approve`,
      { method: "POST", headers: authHeaders(handle) },
    );
    expect(approve.status).toBe(200);
    expect(argvLog()).toContain("chunk-pending-1");

    const empty = await fetch(
      `${base(handle)}/api/sandboxes/demo/rules/chunk-pending-1/reject`,
      {
        method: "POST",
        headers: authHeaders(handle),
        body: JSON.stringify({ reason: "   " }),
      },
    );
    expect(empty.status).toBe(400);
    expect(argvLog()).not.toContain("reject");

    const rejected = await fetch(
      `${base(handle)}/api/sandboxes/demo/rules/chunk-pending-1/reject`,
      {
        method: "POST",
        headers: authHeaders(handle),
        body: JSON.stringify({ reason: "narrow the path" }),
      },
    );
    expect(rejected.status).toBe(200);
    expect(argvLog()).toContain("narrow the path");
  });

  test("malformed JSON bodies return 400", async () => {
    seedSandbox("demo");
    const handle = start();
    const response = await fetch(`${base(handle)}/api/sandboxes`, {
      method: "POST",
      headers: authHeaders(handle),
      body: "not json",
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.kind).toBe("invalid_request");
  });
});

describe("page assets and DOM safety", () => {
  test("every served module is free of HTML sinks", async () => {
    const handle = start();
    const names = [...moduleAllowlist()];
    expect(names).toContain("main.js");
    expect(names).toContain("dom.js");
    for (const name of names) {
      const response = await fetch(`${base(handle)}/app/${name}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("javascript");
      const source = await response.text();
      for (const sink of ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write"]) {
        if (source.includes(sink)) throw new Error(`${name} contains the HTML sink ${sink}`);
      }
    }
    const dom = await (await fetch(`${base(handle)}/app/dom.js`)).text();
    expect(dom).toContain("document.createElement");
  });

  test("only allowlisted modules are served under /app/", async () => {
    const handle = start();
    const allowed = await fetch(`${base(handle)}/app/state.js`);
    expect(allowed.status).toBe(200);
    expect(await allowed.text()).toContain("export const state");
    for (const path of [
      "/app.js",
      "/app/../server.ts",
      "/app/%2e%2e%2fserver.ts",
      "/app/%2e%2e/server.ts",
      "/app/server.ts",
      "/app/Main.js",
      "/app/",
      "/app/main.js/x",
    ]) {
      const response = await fetch(`${base(handle)}${path}`);
      if (response.status !== 404) throw new Error(`${path} returned ${response.status}`);
      const body = await response.text();
      expect(body).not.toContain("Bun.serve");
    }
  });

  test("page and script carry hardening headers", async () => {
    const handle = start();
    const page = await fetch(`${base(handle)}/`);
    expect(page.headers.get("content-security-policy")).toContain("script-src 'self'");
    expect(page.headers.get("x-content-type-options")).toBe("nosniff");
    const script = await fetch(`${base(handle)}/app/main.js`);
    expect(script.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("bootstrap data block parses as JSON", async () => {
    const handle = start();
    const html = await (await fetch(`${base(handle)}/`)).text();
    const match = /<script id="dashboard-bootstrap" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match![1]!);
    expect(parsed.token).toBe(handle.token);
    expect(parsed.readOnly).toBe(false);
    expect(parsed.refreshMs).toBe(3000);
    expect(parsed.defaults.image).toBe(testConfig.image);
    expect(parsed.defaults.providers).toEqual(["maki-anthropic"]);
  });
});

describe("SSE logs", () => {
  test("streams stub log lines over SSE", async () => {
    seedSandbox("demo");
    const handle = start({
      client: makeClient({
        STUB_LOG_LINES: "3",
        STUB_LOG_INTERVAL: "0.01",
        STUB_LOG_KEEPALIVE: "0",
      }),
    });
    const response = await fetch(
      `${base(handle)}/events/logs?name=demo&token=${handle.token}`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const text = await readUntil(response.body!.getReader(), (value) =>
      value.includes("sandbox log line 2"),
    );
    expect(text).toContain("event: ready");
    expect(text).toContain("gateway log line 1");
    expect(text).toContain("sandbox log line 2");
  });

  test("client disconnect kills the tail child", async () => {
    seedSandbox("demo");
    let killed = false;
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
    const stdout = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
    });
    const fakeProcess: LogsProcess = {
      pid: 77,
      stdout,
      exited: new Promise<number>(() => {}),
      kill: () => {
        killed = true;
      },
    };
    const fakeClient = {
      spawnLogs: (): Result<LogsProcess> => ({ ok: true, value: fakeProcess }),
    } as unknown as OpenShellClient;
    const handle = start({ client: fakeClient });

    const abort = new AbortController();
    const response = await fetch(
      `${base(handle)}/events/logs?name=demo&token=${handle.token}`,
      {
        signal: abort.signal,
      },
    );
    const reader = response.body!.getReader();
    streamController?.enqueue(new TextEncoder().encode("through the stream\n"));
    await readUntil(reader, (value) => value.includes("through the stream"));
    expect(killed).toBe(false);

    abort.abort();
    const deadline = Date.now() + 2000;
    while (!killed && Date.now() < deadline) await Bun.sleep(10);
    expect(killed).toBe(true);
  });

  test("SSE without a name returns 400", async () => {
    const handle = start();
    const response = await fetch(`${base(handle)}/events/logs?token=${handle.token}`);
    expect(response.status).toBe(400);
  });

  test("stream without token is refused and spawns nothing", async () => {
    seedSandbox("demo");
    const handle = start();
    resetLog();
    const response = await fetch(`${base(handle)}/events/logs?name=demo`);
    expect(response.status).toBe(403);
    await response.text();
    expect(argvLog()).toBe("");
  });

  test("stream with a wrong token is refused", async () => {
    seedSandbox("demo");
    const handle = start();
    resetLog();
    const response = await fetch(`${base(handle)}/events/logs?name=demo&token=wrong`);
    expect(response.status).toBe(403);
    await response.text();
    expect(argvLog()).toBe("");
  });

  test("read-only mode can stream but never mutate", async () => {
    seedSandbox("demo");
    const handle = start({
      readOnly: true,
      client: makeClient({
        STUB_LOG_LINES: "1",
        STUB_LOG_INTERVAL: "0.01",
        STUB_LOG_KEEPALIVE: "0",
      }),
    });
    const response = await fetch(
      `${base(handle)}/events/logs?name=demo&token=${handle.token}`,
    );
    expect(response.status).toBe(200);
    const text = await readUntil(response.body!.getReader(), (value) =>
      value.includes("sandbox log line 0"),
    );
    expect(text).toContain("event: ready");

    const mutation = await fetch(`${base(handle)}/api/sandboxes/demo/stop`, {
      method: "POST",
      headers: { "x-dashboard-token": handle.token ?? "" },
    });
    expect(mutation.status).toBe(403);
    expect(phase("demo")).toBe("Ready");
  });

  test("an idle hub is dropped and a later stream starts clean", async () => {
    seedSandbox("alpha");
    seedSandbox("beta");
    const handle = start({
      client: makeClient({
        STUB_LOG_LINES: "2",
        STUB_LOG_INTERVAL: "0.01",
        STUB_LOG_KEEPALIVE: "0",
      }),
    });

    const first = new AbortController();
    const firstResponse = await fetch(
      `${base(handle)}/events/logs?name=alpha&token=${handle.token}`,
      { signal: first.signal },
    );
    const firstText = await readUntil(
      firstResponse.body!.getReader(),
      (value) => value.includes("sandbox log line 1"),
    );
    expect(firstText).toContain("alpha");

    first.abort();
    const deadline = Date.now() + 2000;
    while (handle.hubCount() > 0 && Date.now() < deadline) await Bun.sleep(10);
    expect(handle.hubCount()).toBe(0);

    // A later stream for another sandbox must not replay the old buffer.
    const second = await fetch(
      `${base(handle)}/events/logs?name=beta&token=${handle.token}`,
    );
    const replay = await readUntil(second.body!.getReader(), (value) =>
      value.includes("sandbox log line 1"),
    );
    expect(replay).toContain("event: ready");
    expect(replay).not.toContain("alpha");
  });
});

// ---------------------------------------------------------------------------
// Project routes
// ---------------------------------------------------------------------------

const osaStub = join(stubDir, "osa");

describe("project routes", () => {
  let fixture: StateFixture;
  let osaLog: string;
  let osaAnswers: string;

  beforeEach(() => {
    fixture = buildStateFixture();
    osaLog = join(workDir, "osa-argv.log");
    osaAnswers = join(workDir, "osa-answers.json");
    writeFileSync(
      osaAnswers,
      JSON.stringify({
        [fixture.appPath]: {
          quick: [
            { sandbox_name: SANDBOX.retained, fingerprint_result: "changed" },
            { sandbox_name: SANDBOX.parked, fingerprint_result: "unchanged" },
          ],
          full: [
            {
              sandbox_name: SANDBOX.retained,
              agent: "mk",
              status: {
                phase: "Ready",
                sync: "behind",
                patch: "",
                next: "maki-oss refresh",
              },
            },
            { sandbox_name: SANDBOX.parked, agent: "oc", status: { sync: "parked" } },
          ],
        },
      }),
    );
  });

  afterEach(() => {
    rmSync(fixture.dir, { recursive: true, force: true });
  });

  /** Adds `resolve` answers to the stub fixture. */
  function setResolveAnswers(answers: Record<string, unknown>): void {
    const current = JSON.parse(readFileSync(osaAnswers, "utf8")) as Record<string, unknown>;
    writeFileSync(osaAnswers, JSON.stringify({ ...current, resolve: answers }));
  }

  function projectService(
    env: Record<string, string> = {},
    options: { binary?: string; fullTimeoutMs?: number; stateRoot?: string } = {},
  ): ProjectService {
    return new ProjectService({
      stateRoot: options.stateRoot ?? fixture.stateRoot,
      runnerOptions: {
        binary: options.binary ?? osaStub,
        env: { STUB_OSA_FIXTURE: osaAnswers, STUB_OSA_LOG: osaLog, ...env },
      },
      fullTimeoutMs: options.fullTimeoutMs,
    });
  }

  function osaCalls(): string[][] {
    if (!existsSync(osaLog)) return [];
    return readFileSync(osaLog, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as string[]);
  }

  async function listRows(handle: DashboardHandle, query = ""): Promise<Array<Record<string, any>>> {
    const response = await fetch(`${base(handle)}/api/projects${query}`);
    expect(response.status).toBe(200);
    return ((await response.json()) as { projects: Array<Record<string, any>> }).projects;
  }

  function row(rows: Array<Record<string, any>>, sandbox: string): Record<string, any> {
    const found = rows.find((candidate) => candidate.sandbox_name === sandbox);
    if (!found) throw new Error(`no row for ${sandbox}`);
    return found;
  }

  test("GET /api/projects lists rows with badges and cached host changes", async () => {
    const projects = projectService();
    const handle = start({ projects });
    resetLog();
    const first = await listRows(handle);
    expect(first).toHaveLength(7);
    expect(row(first, SANDBOX.retained)).toMatchObject({
      agent: "mk",
      project: "app",
      host_path: fixture.appPath,
      pending: "retained",
      orphan: false,
      note: null,
      osaError: null,
    });
    expect(row(first, SANDBOX.orphan)).toMatchObject({ orphan: true, fingerprintResult: "unknown" });
    expect(first.find((candidate) => candidate.file === "broken.toml")!.note).toContain("parsed");

    await projects.cache.idle();
    const second = await listRows(handle);
    expect(row(second, SANDBOX.retained).fingerprintResult).toBe("changed");
    expect(row(second, SANDBOX.parked).fingerprintResult).toBe("unchanged");
    expect(row(second, SANDBOX.retained).checkedAt).toBeGreaterThan(0);
    expect(argvLog()).toBe("");
  });

  test("an empty state root lists nothing", async () => {
    const home = emptyStateHome();
    const handle = start({ projects: projectService({}, { stateRoot: join(home, "osa") }) });
    expect(await listRows(handle)).toEqual([]);
    rmSync(home, { recursive: true, force: true });
  });

  test("a missing osa keeps pending and orphan badges and reports osaError", async () => {
    const projects = projectService({}, { binary: join(workDir, "no-such-osa") });
    const handle = start({ projects });
    resetLog();
    await listRows(handle);
    await projects.cache.idle();
    const rows = await listRows(handle);
    expect(row(rows, SANDBOX.retained).pending).toBe("retained");
    expect(row(rows, SANDBOX.retained).osaError.kind).toBe("missing_cli");
    expect(row(rows, SANDBOX.retained).fingerprintResult).toBeNull();
    expect(row(rows, SANDBOX.parked).pending).toBe("parked");
    expect(row(rows, SANDBOX.orphan).orphan).toBe(true);
    expect(argvLog()).toBe("");
  });

  test("refresh=1 runs the quick checks again", async () => {
    const projects = projectService();
    const handle = start({ projects });
    await listRows(handle);
    await projects.cache.idle();
    await listRows(handle);
    await projects.cache.idle();
    const quickFor = () =>
      osaCalls().filter((argv) => argv[1] === fixture.appPath && argv.includes("--quick")).length;
    expect(quickFor()).toBe(1);
    await listRows(handle, "?refresh=1");
    await projects.cache.idle();
    expect(quickFor()).toBe(2);
  });

  test("path= restricts the list, and refresh=1&path= checks only that path", async () => {
    const projects = projectService();
    const handle = start({ projects });
    await listRows(handle);
    await projects.cache.idle();
    const quickFor = (path: string) =>
      osaCalls().filter((argv) => argv[1] === path && argv.includes("--quick")).length;
    expect(quickFor(fixture.appPath)).toBe(1);
    expect(quickFor(fixture.quotedPath)).toBe(1);

    const rows = await listRows(handle, `?refresh=1&path=${encodeURIComponent(fixture.appPath)}`);
    expect(rows.map((entry) => entry.sandbox_name).sort()).toEqual([SANDBOX.retained, SANDBOX.parked].sort());
    await projects.cache.idle();
    expect(quickFor(fixture.appPath)).toBe(2);
    expect(quickFor(fixture.quotedPath)).toBe(1);
    expect(quickFor(fixture.toolPath)).toBe(1);

    const quoted = await listRows(handle, `?path=${encodeURIComponent(fixture.quotedPath)}`);
    expect(quoted.map((entry) => entry.sandbox_name)).toEqual([SANDBOX.noKind]);
    expect(await listRows(handle, "?path=%2Fnot%2Fregistered")).toEqual([]);
  });

  describe("resolve route", () => {
    function resolveUrl(handle: DashboardHandle, sandbox: string = SANDBOX.retained): string {
      return `${base(handle)}/api/projects/${sandbox}/resolve`;
    }

    async function post(
      handle: DashboardHandle,
      body: unknown,
      options: { sandbox?: string; headers?: Record<string, string> } = {},
    ): Promise<{ status: number; body: Record<string, any> }> {
      const response = await fetch(resolveUrl(handle, options.sandbox), {
        method: "POST",
        headers: options.headers ?? authHeaders(handle),
        body: typeof body === "string" ? body : JSON.stringify(body),
      });
      return { status: response.status, body: (await response.json()) as Record<string, any> };
    }

    function resolveCalls(): string[][] {
      return osaCalls().filter((argv) => argv[0] === "resolve");
    }

    beforeEach(() => {
      setResolveAnswers({
        [SANDBOX.retained]: {
          apply: { changed: ["base.txt"], message: "Applied the retained patch" },
          branch: { exit: 2, message: "The dry run failed; try branch" },
          drop: { changed: ["/state/dropped/p.patch"], message: "Dropped" },
        },
        [SANDBOX.parked]: {
          rescue: { exit: 3, message: "download failed", stderr: "openshell: connection reset" },
          discard: { changed: [`${SANDBOX.parked}:/sandbox`], message: "Discarded" },
        },
      });
    });

    test("no token, a wrong token, or read-only mode is 403 and runs nothing", async () => {
      const handle = start({ projects: projectService() });
      const json = { "content-type": "application/json" };
      expect((await post(handle, { action: "apply" }, { headers: json })).status).toBe(403);
      expect(
        (await post(handle, { action: "apply" }, { headers: { ...json, "x-dashboard-token": "wrong" } }))
          .status,
      ).toBe(403);
      const readOnly = start({ projects: projectService(), readOnly: true });
      const refused = await post(readOnly, { action: "apply" });
      expect(refused.status).toBe(403);
      expect(refused.body.error.kind).toBe("read_only");
      expect(resolveCalls()).toEqual([]);
      expect(osaCalls()).toEqual([]);
    });

    test("bad bodies and unknown actions are 400; an unregistered sandbox is 404", async () => {
      const handle = start({ projects: projectService() });
      for (const body of ["not json", { action: "rm" }, {}, { action: ["apply"] }, "null"]) {
        expect({ body, status: (await post(handle, body)).status }).toEqual({ body, status: 400 });
      }
      for (const sandbox of ["not-registered", SANDBOX.future]) {
        expect((await post(handle, { action: "apply" }, { sandbox })).status).toBe(404);
      }
      expect(osaCalls()).toEqual([]);
    });

    test("success is 200 with changed; drop gets --yes", async () => {
      const handle = start({ projects: projectService() });
      const apply = await post(handle, { action: "apply" });
      expect(apply).toEqual({
        status: 200,
        body: {
          sandbox: SANDBOX.retained,
          action: "apply",
          ok: true,
          changed: ["base.txt"],
          message: "Applied the retained patch",
          exitCode: 0,
        },
      });
      expect((await post(handle, { action: "drop" })).status).toBe(200);
      expect((await post(handle, { action: "discard" }, { sandbox: SANDBOX.parked })).status).toBe(200);
      expect(resolveCalls()).toEqual([
        ["resolve", SANDBOX.retained, "apply", "--json"],
        ["resolve", SANDBOX.retained, "drop", "--json", "--yes"],
        ["resolve", SANDBOX.parked, "discard", "--json", "--yes"],
      ]);
    });

    test("a refusal is 409 and a failure is 502 with detail", async () => {
      const handle = start({ projects: projectService() });
      const refused = await post(handle, { action: "branch" });
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({
        ok: false,
        changed: [],
        exitCode: 2,
        message: "The dry run failed; try branch",
        error: { kind: "refused" },
      });
      const failed = await post(handle, { action: "rescue" }, { sandbox: SANDBOX.parked });
      expect(failed.status).toBe(502);
      expect(failed.body).toMatchObject({
        exitCode: 3,
        error: { kind: "exit", message: "download failed", detail: "openshell: connection reset" },
      });
    });

    test("a second request while one runs is 409 and runs nothing", async () => {
      setResolveAnswers({ [SANDBOX.retained]: { apply: { delay: 0.4, changed: ["base.txt"] } } });
      const handle = start({ projects: projectService() });
      const first = post(handle, { action: "apply" });
      await Bun.sleep(100);
      const second = await post(handle, { action: "apply" });
      expect(second.status).toBe(409);
      expect(second.body.error.kind).toBe("busy");
      expect((await first).status).toBe(200);
      expect(resolveCalls()).toHaveLength(1);
    });

    test("GET or PUT on the resolve route is 405", async () => {
      const handle = start({ projects: projectService() });
      for (const method of ["GET", "PUT", "DELETE"]) {
        const response = await fetch(resolveUrl(handle), { method, headers: authHeaders(handle) });
        expect(response.status).toBe(405);
        expect(response.headers.get("allow")).toBe("POST");
      }
      expect(osaCalls()).toEqual([]);
    });
  });

  test("full status returns the sandbox's own entry", async () => {
    const handle = start({ projects: projectService() });
    const response = await fetch(`${base(handle)}/api/projects/${SANDBOX.retained}/status`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: Record<string, any> };
    expect(body.status.sandbox_name).toBe(SANDBOX.retained);
    expect(body.status.status.sync).toBe("behind");
    expect(body.status.status.next).toBe("maki-oss refresh");
    expect(osaCalls()).toContainEqual(["status", fixture.appPath, "--json"]);
  });

  test("full status of an unknown sandbox is 404 and runs nothing", async () => {
    const handle = start({ projects: projectService() });
    const response = await fetch(`${base(handle)}/api/projects/not-registered/status`);
    expect(response.status).toBe(404);
    expect(osaCalls()).toEqual([]);
  });

  test("full status times out", async () => {
    const handle = start({
      projects: projectService({ STUB_OSA_FAIL: "hang" }, { fullTimeoutMs: 300 }),
    });
    const response = await fetch(`${base(handle)}/api/projects/${SANDBOX.retained}/status`);
    expect(response.status).toBe(504);
    const body = (await response.json()) as { error: { kind: string } };
    expect(body.error.kind).toBe("timeout");
  });

  describe("patch route", () => {
    function spiedService(): { projects: ProjectService; reads: string[] } {
      const projects = projectService();
      const reads: string[] = [];
      const original = projects.readPatchFile.bind(projects);
      projects.readPatchFile = (path: string, limit: number) => {
        reads.push(path);
        return original(path, limit);
      };
      return { projects, reads };
    }

    function patchUrl(handle: DashboardHandle, sandbox: string = SANDBOX.retained): string {
      return `${base(handle)}/api/projects/${sandbox}/patch`;
    }

    test("without a token is 403 and the file is not opened", async () => {
      const { projects, reads } = spiedService();
      const handle = start({ projects });
      const response = await fetch(patchUrl(handle));
      expect(response.status).toBe(403);
      expect(await response.text()).not.toContain("diff --git");
      expect(reads).toEqual([]);
    });

    test("a wrong token is 403", async () => {
      const { projects, reads } = spiedService();
      const handle = start({ projects });
      const response = await fetch(patchUrl(handle), { headers: { "x-dashboard-token": "wrong" } });
      expect(response.status).toBe(403);
      expect(reads).toEqual([]);
    });

    test("the token serves the patch, in read-only mode too", async () => {
      for (const readOnly of [false, true]) {
        const { projects, reads } = spiedService();
        const handle = start({ projects, readOnly });
        const response = await fetch(patchUrl(handle), { headers: authHeaders(handle) });
        expect(response.status).toBe(200);
        const body = (await response.json()) as { patch: Record<string, any> };
        expect(body.patch).toEqual({
          name: "patch-20261026105609-57768.patch",
          size: RETAINED_PATCH.length,
          truncated: false,
          text: RETAINED_PATCH,
        });
        expect(reads).toHaveLength(1);
      }
    });

    test("a marker pointing outside the session directory is refused", async () => {
      writeMarker(fixture, SANDBOX.retained, { kind: "retained", patch: "/etc/hosts" });
      const { projects, reads } = spiedService();
      const handle = start({ projects });
      const response = await fetch(patchUrl(handle), { headers: authHeaders(handle) });
      expect(response.status).toBe(403);
      expect(reads).toEqual([]);
    });

    test("a symlink in the session directory pointing outside is refused", async () => {
      const outside = join(fixture.dir, "secret.txt");
      writeFileSync(outside, "host secret\n");
      const link = join(fixture.sessionsDir, SANDBOX.retained, "patch-link.patch");
      symlinkSync(outside, link);
      writeMarker(fixture, SANDBOX.retained, { kind: "retained", patch: link });
      const { projects, reads } = spiedService();
      const handle = start({ projects });
      const response = await fetch(patchUrl(handle), { headers: authHeaders(handle) });
      expect(response.status).toBe(403);
      expect(await response.text()).not.toContain("host secret");
      expect(reads).toEqual([]);
    });

    test("a directory is refused", async () => {
      const dir = join(fixture.sessionsDir, SANDBOX.retained, "patch-dir.patch");
      mkdirSync(dir);
      writeMarker(fixture, SANDBOX.retained, { kind: "retained", patch: dir });
      const { projects, reads } = spiedService();
      const handle = start({ projects });
      const response = await fetch(patchUrl(handle), { headers: authHeaders(handle) });
      expect(response.status).toBe(403);
      expect(reads).toEqual([]);
    });

    test("a 3 MiB patch is truncated to 2 MiB", async () => {
      const line = `+${"x".repeat(1022)}\n`;
      writeFileSync(fixture.retainedPatchPath, line.repeat(3 * 1024));
      const handle = start({ projects: projectService() });
      const response = await fetch(patchUrl(handle), { headers: authHeaders(handle) });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { patch: Record<string, any> };
      expect(body.patch.size).toBe(3 * 1024 * 1024);
      expect(body.patch.truncated).toBe(true);
      expect(body.patch.text.length).toBe(PATCH_LIMIT_BYTES);
    });

    test("a sandbox with no marker, or not registered, is 404", async () => {
      const { projects, reads } = spiedService();
      const handle = start({ projects });
      for (const sandbox of [SANDBOX.unknownTag, "not-registered", SANDBOX.future]) {
        const response = await fetch(patchUrl(handle, sandbox), { headers: authHeaders(handle) });
        expect(response.status).toBe(404);
      }
      expect(reads).toEqual([]);
    });
  });

  test("non-GET project requests are 405 and run nothing", async () => {
    const handle = start({ projects: projectService() });
    resetLog();
    for (const path of [
      "/api/projects",
      `/api/projects/${SANDBOX.retained}/status`,
      `/api/projects/${SANDBOX.retained}/patch`,
      "/api/projects/anything/else",
    ]) {
      for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
        const response = await fetch(`${base(handle)}${path}`, {
          method,
          headers: authHeaders(handle),
          body: method === "DELETE" ? undefined : "{}",
        });
        if (response.status !== 405) throw new Error(`${method} ${path} returned ${response.status}`);
        expect(response.headers.get("allow")).toBe("GET");
      }
    }
    expect(osaCalls()).toEqual([]);
    expect(argvLog()).toBe("");
  });

  test("browsing every project route changes no file", async () => {
    function snapshot(root: string): Record<string, string> {
      const result: Record<string, string> = {};
      const walk = (dir: string) => {
        result[dir] = `dir ${lstatSync(dir).mtimeMs}`;
        for (const name of readdirSync(dir)) {
          const path = join(dir, name);
          const info = lstatSync(path);
          if (info.isDirectory()) walk(path);
          else result[path] = `${info.mtimeMs} ${Bun.hash(readFileSync(path)).toString()}`;
        }
      };
      walk(root);
      return result;
    }
    const roots = [fixture.stateHome, join(fixture.dir, "hosts")];
    const before = roots.map(snapshot);

    for (const readOnly of [false, true]) {
      const projects = projectService();
      const handle = start({ projects, readOnly });
      const rows = await listRows(handle);
      await projects.cache.idle();
      await listRows(handle, "?refresh=1");
      await projects.cache.idle();
      for (const entry of rows) {
        const sandbox = entry.sandbox_name || entry.file;
        await (await fetch(`${base(handle)}/api/projects/${sandbox}/status`)).text();
        await (
          await fetch(`${base(handle)}/api/projects/${sandbox}/patch`, { headers: authHeaders(handle) })
        ).text();
      }
    }

    expect(roots.map(snapshot)).toEqual(before);

    // A resolve changes only what osa reports: here the stub clears the marker.
    const marker = join(fixture.sessionsDir, SANDBOX.retained, "pending");
    setResolveAnswers({
      [SANDBOX.retained]: { apply: { changed: ["base.txt"], remove: [marker] } },
    });
    const handle = start({ projects: projectService() });
    const response = await fetch(`${base(handle)}/api/projects/${SANDBOX.retained}/resolve`, {
      method: "POST",
      headers: authHeaders(handle),
      body: JSON.stringify({ action: "apply" }),
    });
    expect(response.status).toBe(200);
    const after = roots.map(snapshot);
    const changed = (index: number) =>
      [...new Set([...Object.keys(before[index]!), ...Object.keys(after[index]!)])].filter(
        (path) => before[index]![path] !== after[index]![path],
      );
    expect(changed(0).sort()).toEqual([join(fixture.sessionsDir, SANDBOX.retained), marker].sort());
    expect(changed(1)).toEqual([]);
  });
});
