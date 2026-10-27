// Project reader tests: the state-root fixture, the contract reader, the
// conformance check against the real `bin/osa`, the `osa` runner, and the
// host-change cache. No gateway, no network.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  findProject,
  HostChangeCache,
  isAllowedOsaArgv,
  listProjects,
  OsaRunner,
  ProjectService,
  resolveArgv,
  resolveOsaBinary,
  resolveStateRoot,
  RESOLVE_ACTIONS,
  type ProjectEntry,
} from "../src/projects.ts";
import {
  buildStateFixture,
  emptyStateHome,
  INVALID_FILE,
  SANDBOX,
  type StateFixture,
} from "./state-fixture.ts";

const repoRoot = join(import.meta.dir, "..", "..");
const osaStub = join(import.meta.dir, "stub", "osa");

let fixture: StateFixture;
let cleanup: string[];

beforeEach(() => {
  fixture = buildStateFixture();
  cleanup = [fixture.dir];
});

afterEach(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

function byFile(entries: ProjectEntry[], file: string): ProjectEntry {
  const entry = entries.find((candidate) => candidate.file === file);
  if (!entry) throw new Error(`no entry for ${file}`);
  return entry;
}

function bySandbox(entries: ProjectEntry[], sandbox: string): ProjectEntry {
  return byFile(entries, `${sandbox}.toml`);
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

describe("state-root fixture", () => {
  test("contract files parse, or fail, as intended", () => {
    const registry = readdirSync(fixture.registryDir).sort();
    expect(registry).toEqual(
      [
        INVALID_FILE,
        `${SANDBOX.future}.toml`,
        `${SANDBOX.noKind}.toml`,
        `${SANDBOX.orphan}.toml`,
        `${SANDBOX.parked}.toml`,
        `${SANDBOX.retained}.toml`,
        `${SANDBOX.unknownTag}.toml`,
      ].sort(),
    );
    for (const name of registry) {
      const source = readFileSync(join(fixture.registryDir, name), "utf8");
      if (name === INVALID_FILE) {
        expect(() => Bun.TOML.parse(source)).toThrow();
        continue;
      }
      const parsed = Bun.TOML.parse(source) as Record<string, string>;
      expect(parsed.version).toBe(name === `${SANDBOX.future}.toml` ? "2" : "1");
    }

    const quoted = Bun.TOML.parse(
      readFileSync(join(fixture.registryDir, `${SANDBOX.noKind}.toml`), "utf8"),
    ) as Record<string, string>;
    expect(quoted.host_path).toBe(fixture.quotedPath);
    expect(quoted.host_path).toContain('my "app" dir');

    const markers = Object.fromEntries(
      [SANDBOX.retained, SANDBOX.parked, SANDBOX.noKind].map((sandbox) => [
        sandbox,
        Bun.TOML.parse(readFileSync(join(fixture.sessionsDir, sandbox, "pending"), "utf8")) as Record<
          string,
          string
        >,
      ]),
    );
    expect(markers[SANDBOX.retained]!.kind).toBe("retained");
    expect(existsSync(markers[SANDBOX.retained]!.patch!)).toBe(true);
    expect(markers[SANDBOX.parked]!.kind).toBe("parked");
    expect(markers[SANDBOX.noKind]!.kind).toBeUndefined();
    expect(existsSync(fixture.orphanPath)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Contract reader
// ---------------------------------------------------------------------------

describe("contract reader", () => {
  test("state root follows XDG_STATE_HOME, then HOME", () => {
    expect(resolveStateRoot({ XDG_STATE_HOME: "/x/state", HOME: "/home/u" })).toBe("/x/state/osa");
    expect(resolveStateRoot({ HOME: "/home/u" })).toBe("/home/u/.local/state/osa");
    expect(resolveStateRoot({ XDG_STATE_HOME: "", HOME: "/home/u" })).toBe(
      "/home/u/.local/state/osa",
    );
  });

  test("every fixture row is read as the contract says", () => {
    const entries = listProjects(fixture.stateRoot);
    expect(entries).toHaveLength(7);

    const retained = bySandbox(entries, SANDBOX.retained);
    expect(retained).toMatchObject({
      supported: true,
      agent: "mk",
      host_path: fixture.appPath,
      project: "app",
      sandbox_name: SANDBOX.retained,
      fingerprint: "abc123-1-2",
      pending: "retained",
      orphan: false,
      note: null,
    });

    expect(bySandbox(entries, SANDBOX.parked)).toMatchObject({
      agent: "oc",
      host_path: fixture.appPath,
      pending: "parked",
      orphan: false,
      note: null,
    });

    const noKind = bySandbox(entries, SANDBOX.noKind);
    expect(noKind.agent).toBe("cc");
    expect(noKind.host_path).toBe(fixture.quotedPath);
    expect(noKind.project).toBe('my "app" dir');
    expect(noKind.pending).toBe("parked");
    expect(noKind.note).toContain("no kind");
    expect(noKind.orphan).toBe(false);

    expect(bySandbox(entries, SANDBOX.unknownTag)).toMatchObject({
      supported: true,
      agent: "zz",
      pending: "",
      orphan: false,
    });

    expect(bySandbox(entries, SANDBOX.orphan)).toMatchObject({
      agent: "mk",
      host_path: fixture.orphanPath,
      pending: "",
      orphan: true,
    });

    const future = bySandbox(entries, SANDBOX.future);
    expect(future.supported).toBe(false);
    expect(future.note).toContain("unsupported contract version");
    expect(future.agent).toBe("");
    expect(future.host_path).toBe("");
    expect(future.sandbox_name).toBe("");

    const invalid = byFile(entries, INVALID_FILE);
    expect(invalid.supported).toBe(false);
    expect(invalid.note).toContain("could not be parsed");
    expect(invalid.sandbox_name).toBe("");
  });

  test("a missing registry directory is an empty list", () => {
    const home = emptyStateHome();
    cleanup.push(home);
    expect(listProjects(join(home, "osa"))).toEqual([]);
  });

  test("findProject only returns supported entries by sandbox name", () => {
    expect(findProject(fixture.stateRoot, SANDBOX.retained)?.agent).toBe("mk");
    expect(findProject(fixture.stateRoot, SANDBOX.future)).toBeNull();
    expect(findProject(fixture.stateRoot, "not-registered")).toBeNull();
    expect(findProject(fixture.stateRoot, "../projects")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Conformance with bin/osa
// ---------------------------------------------------------------------------

describe("conformance with bin/osa", () => {
  test("the dashboard reader agrees with osa projects --json", async () => {
    if (!existsSync("/bin/sh") || Bun.which("awk") === null) {
      console.log("skip conformance: /bin/sh or awk is missing");
      return;
    }
    const proc = Bun.spawn({
      cmd: [join(repoRoot, "bin", "osa"), "projects", "--json"],
      env: { ...process.env, XDG_STATE_HOME: fixture.stateHome },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    expect(code).toBe(0);
    const fromOsa = JSON.parse(stdout) as Array<Record<string, unknown>>;

    const compared = listProjects(fixture.stateRoot).filter(
      (entry) => entry.supported && entry.note === null,
    );
    // Every v1 entry whose marker (if any) carries a kind.
    expect(compared.map((entry) => entry.sandbox_name).sort()).toEqual(
      [SANDBOX.orphan, SANDBOX.parked, SANDBOX.retained, SANDBOX.unknownTag].sort(),
    );
    const fields = ["agent", "host_path", "project", "sandbox_name", "pending", "orphan"] as const;
    for (const entry of compared) {
      const other = fromOsa.find((candidate) => candidate.sandbox_name === entry.sandbox_name);
      expect(other).toBeDefined();
      for (const field of fields) {
        expect({ field, value: other![field] }).toEqual({ field, value: entry[field] });
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Stub osa
// ---------------------------------------------------------------------------

interface StubSetup {
  fixturePath: string;
  logPath: string;
  env: Record<string, string>;
}

function stubSetup(answers: Record<string, unknown>, extra: Record<string, string> = {}): StubSetup {
  const fixturePath = join(fixture.dir, "osa-answers.json");
  const logPath = join(fixture.dir, "osa-argv.log");
  writeFileSync(fixturePath, JSON.stringify(answers));
  return {
    fixturePath,
    logPath,
    env: { STUB_OSA_FIXTURE: fixturePath, STUB_OSA_LOG: logPath, ...extra },
  };
}

function loggedCalls(logPath: string): string[][] {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as string[]);
}

function defaultAnswers(): Record<string, unknown> {
  return {
    [fixture.appPath]: {
      quick: [
        { sandbox_name: SANDBOX.retained, fingerprint_result: "changed" },
        { sandbox_name: SANDBOX.parked, fingerprint_result: "unknown" },
      ],
      full: [
        {
          sandbox_name: SANDBOX.retained,
          status: { phase: "Ready", sync: "behind", next: "maki-oss refresh" },
        },
      ],
    },
    [fixture.quotedPath]: {
      quick: [{ sandbox_name: SANDBOX.noKind, fingerprint_result: "unchanged" }],
    },
    [fixture.toolPath]: { quick: [] },
  };
}

describe("stub osa", () => {
  test("answers status from the fixture and logs each argv", async () => {
    const setup = stubSetup(defaultAnswers());
    const runner = new OsaRunner({ binary: osaStub, env: setup.env });
    const quick = await runner.runJson(["status", fixture.appPath, "--quick", "--json"], 5000);
    expect(quick.ok).toBe(true);
    if (quick.ok) expect((quick.value as unknown[])[0]).toMatchObject({ fingerprint_result: "changed" });
    const full = await runner.runJson(["status", fixture.quotedPath, "--json"], 5000);
    expect(full).toEqual({ ok: true, value: [] });
    expect(loggedCalls(setup.logPath)).toEqual([
      ["status", fixture.appPath, "--quick", "--json"],
      ["status", fixture.quotedPath, "--json"],
    ]);
  });

  test("answers resolve from the fixture: success, refusal, failure, invalid JSON, slow", async () => {
    const marker = join(fixture.sessionsDir, SANDBOX.retained, "pending");
    const setup = stubSetup({
      [fixture.appPath]: { quick: [{ sandbox_name: SANDBOX.retained, busy: true }] },
      resolve: {
        [SANDBOX.retained]: {
          apply: { changed: ["base.txt"], message: "applied", remove: [marker] },
          branch: { exit: 2, message: "refused" },
          drop: { exit: 3, message: "failed", stderr: "stub osa: drop failed" },
        },
        [SANDBOX.parked]: {
          rescue: { raw: "not json", delay: 0.2 },
        },
      },
    });
    const run = (args: string[]) =>
      Bun.spawn({ cmd: [osaStub, ...args], env: { ...process.env, ...setup.env }, stdout: "pipe", stderr: "pipe" });
    const answer = async (args: string[]) => {
      const proc = run(args);
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { stdout, stderr, code };
    };

    const apply = await answer(["resolve", SANDBOX.retained, "apply", "--json"]);
    expect(apply.code).toBe(0);
    expect(JSON.parse(apply.stdout)).toEqual({
      sandbox: SANDBOX.retained,
      action: "apply",
      ok: true,
      changed: ["base.txt"],
      message: "applied",
    });
    expect(existsSync(marker)).toBe(false);

    const branch = await answer(["resolve", SANDBOX.retained, "branch", "--json"]);
    expect(branch.code).toBe(2);
    expect(JSON.parse(branch.stdout)).toMatchObject({ ok: false, changed: [], message: "refused" });

    const drop = await answer(["resolve", SANDBOX.retained, "drop", "--json", "--yes"]);
    expect(drop.code).toBe(3);
    expect(drop.stderr).toContain("drop failed");

    const started = Date.now();
    const rescue = await answer(["resolve", SANDBOX.parked, "rescue", "--json"]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(200);
    expect(rescue).toMatchObject({ code: 0, stdout: "not json" });

    const unanswered = await answer(["resolve", SANDBOX.parked, "discard", "--json", "--yes"]);
    expect(unanswered.code).toBe(2);

    const extra = await answer(["resolve", SANDBOX.parked, "discard", "--json", "--yes", "x"]);
    expect(extra.code).toBe(1);

    const quick = await answer(["status", fixture.appPath, "--quick", "--json"]);
    expect(JSON.parse(quick.stdout)).toEqual([
      {
        sandbox_name: SANDBOX.retained,
        busy: true,
        idle: { period: null, state: "none", deadline: null, estimated: false, last_event: null, last_time: null },
      },
    ]);

    expect(loggedCalls(setup.logPath)).toHaveLength(7);
    expect(loggedCalls(setup.logPath)[2]).toEqual(["resolve", SANDBOX.retained, "drop", "--json", "--yes"]);
  });
});

describe("stub osa health", () => {
  const answer = async (args: string[], env: Record<string, string>) => {
    const proc = Bun.spawn({ cmd: [osaStub, ...args], env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { stdout, stderr, code };
  };

  test("answers health from the built-in fixtures", async () => {
    const setup = stubSetup({});
    const report = async (sandbox: string) => {
      const result = await answer(["health", sandbox, "--json"], setup.env);
      expect(result.code).toBe(0);
      return JSON.parse(result.stdout);
    };
    const ok = await report("health-ok");
    expect(ok).toMatchObject({ sandbox: "health-ok", agent: "mk", mcp: { supported: true, ok: true }, doctor: { ok: true } });
    expect(ok.idle.state).toBe("running");
    const failing = await report("health-mcp-fail");
    expect(failing.mcp.ok).toBe(false);
    expect(failing.mcp.servers[0].gates).toContainEqual({
      gate: "provider",
      ok: false,
      fix: "maki-oss provider attach mcp-context7",
    });
    expect((await report("health-unsupported")).mcp).toEqual({ supported: false, ok: null, error: null, servers: [] });
    const partial = await report("health-partial");
    expect(partial.mcp.error).toContain("gateway");
    expect(partial.doctor.checks).toContainEqual({ name: "gateway", status: "fail", detail: "unreachable (openshell status failed)" });
    expect(partial.idle).toMatchObject({ state: "counting", deadline: "2026-10-27T12:00:00Z" });
    expect((await report("health-markup")).doctor.checks[0].detail).toContain("<img src=x onerror=alert(1)>");
    expect(loggedCalls(setup.logPath)).toHaveLength(5);
  });

  test("answers health from the fixture, and an unknown sandbox as a usage error", async () => {
    const setup = stubSetup({
      health: { [SANDBOX.retained]: { report: { sandbox: SANDBOX.retained, agent: "mk" }, stderr: "note" } },
      [fixture.appPath]: {
        quick: [{ sandbox_name: SANDBOX.retained, idle: { period: 60, state: "counting", deadline: "2026-10-27T10:00:00Z" } }],
      },
    });
    const fixed = await answer(["health", SANDBOX.retained, "--json"], setup.env);
    expect(JSON.parse(fixed.stdout)).toEqual({ sandbox: SANDBOX.retained, agent: "mk" });
    expect(fixed.stderr).toContain("note");
    const unknown = await answer(["health", "mk-nowhere", "--json"], setup.env);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain("not registered");
    expect((await answer(["health", SANDBOX.retained], setup.env)).code).toBe(1);
    const quick = await answer(["status", fixture.appPath, "--quick", "--json"], setup.env);
    expect(JSON.parse(quick.stdout)[0].idle).toEqual({ period: 60, state: "counting", deadline: "2026-10-27T10:00:00Z" });
  });
});

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

describe("osa runner", () => {
  test("binary comes from DASHBOARD_OSA_BIN, then bin/osa, then PATH", () => {
    expect(resolveOsaBinary({ DASHBOARD_OSA_BIN: "/opt/osa" }, repoRoot)).toBe("/opt/osa");
    expect(resolveOsaBinary({}, repoRoot)).toBe(join(repoRoot, "bin", "osa"));
    expect(resolveOsaBinary({}, fixture.dir)).toBe("osa");
  });

  test("only status --json and status --quick --json may run", async () => {
    expect(isAllowedOsaArgv(["status", "/p", "--json"])).toBe(true);
    expect(isAllowedOsaArgv(["status", "/p", "--quick", "--json"])).toBe(true);
    expect(isAllowedOsaArgv(["projects", "--json"])).toBe(false);
    expect(isAllowedOsaArgv(["up"])).toBe(false);
    expect(isAllowedOsaArgv(["status", "/p"])).toBe(false);
    expect(isAllowedOsaArgv(["status", "--json", "/p"])).toBe(false);
    expect(isAllowedOsaArgv(["status", "relative", "--json"])).toBe(false);
    expect(isAllowedOsaArgv(["status", "/p", "--json", "--quick"])).toBe(false);
    expect(isAllowedOsaArgv(["status", "/p", "--json", "--yes"])).toBe(false);
    expect(isAllowedOsaArgv(["health", "mk-app-1", "--json"])).toBe(true);
    for (const args of [
      ["health", "mk-app-1"],
      ["health", "--json", "mk-app-1"],
      ["health", "mk-app-1", "--json", "--yes"],
      ["health", "../x", "--json"],
      ["health", "-x", "--json"],
      ["health", "", "--json"],
      ["health", "a b", "--json"],
    ]) {
      expect({ args, allowed: isAllowedOsaArgv(args) }).toEqual({ args, allowed: false });
    }

    const setup = stubSetup({});
    const runner = new OsaRunner({ binary: osaStub, env: setup.env });
    for (const args of [["projects", "--json"], ["up"]]) {
      const result = await runner.runJson(args, 5000);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("invalid_request");
    }
    expect(loggedCalls(setup.logPath)).toEqual([]);
  });

  test("resolve may run only the five fixed shapes", () => {
    expect(RESOLVE_ACTIONS.map((action) => resolveArgv("mk-app-1", action))).toEqual([
      ["resolve", "mk-app-1", "apply", "--json"],
      ["resolve", "mk-app-1", "branch", "--json"],
      ["resolve", "mk-app-1", "drop", "--json", "--yes"],
      ["resolve", "mk-app-1", "rescue", "--json"],
      ["resolve", "mk-app-1", "discard", "--json", "--yes"],
    ]);
    for (const action of RESOLVE_ACTIONS) {
      expect(isAllowedOsaArgv(resolveArgv("mk-app-1", action))).toBe(true);
    }
    for (const args of [
      ["resolve", "x", "rm", "--json"],
      ["resolve", "x", "apply", "--json", "--yes"],
      ["resolve", "x", "branch", "--json", "--yes"],
      ["resolve", "x", "rescue", "--json", "--yes"],
      ["resolve", "x", "drop", "--json"],
      ["resolve", "x", "discard", "--json"],
      ["resolve", "-x", "apply", "--json"],
      ["resolve", "--yes", "apply", "--json"],
      ["resolve", "../x", "apply", "--json"],
      ["resolve", "", "apply", "--json"],
      ["resolve", "x", "apply"],
      ["resolve", "x", "apply", "--json", "extra"],
      ["resolve", "x", "drop", "--json", "--yes", "extra"],
      ["resolve", "x", "drop", "--yes", "--json"],
      ["resolve", "x", "--json", "apply"],
    ]) {
      expect({ args, allowed: isAllowedOsaArgv(args) }).toEqual({ args, allowed: false });
    }
  });

  test("a missing binary is missing_cli", async () => {
    const runner = new OsaRunner({ binary: join(fixture.dir, "no-such-osa") });
    const result = await runner.runJson(["status", "/p", "--json"], 5000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("missing_cli");
  });

  test("a failing osa is exit, with its message", async () => {
    const setup = stubSetup({}, { STUB_OSA_FAIL: "exit" });
    const result = await new OsaRunner({ binary: osaStub, env: setup.env }).runJson(
      ["status", "/p", "--json"],
      5000,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("exit");
      expect(result.error.message).toContain("stub osa: forced failure");
    }
  });

  test("a hanging osa is timeout", async () => {
    const setup = stubSetup({}, { STUB_OSA_FAIL: "hang" });
    const started = Date.now();
    const result = await new OsaRunner({ binary: osaStub, env: setup.env }).runJson(
      ["status", "/p", "--json"],
      300,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(3000);
  });

  test("non-JSON output is invalid_json", async () => {
    const setup = stubSetup({}, { STUB_OSA_FAIL: "invalid-json" });
    const result = await new OsaRunner({ binary: osaStub, env: setup.env }).runJson(
      ["status", "/p", "--json"],
      5000,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("invalid_json");
  });
});

// ---------------------------------------------------------------------------
// Host-change cache
// ---------------------------------------------------------------------------

describe("host-change cache", () => {
  function service(setup: StubSetup, now?: () => number): ProjectService {
    return new ProjectService({
      stateRoot: fixture.stateRoot,
      runnerOptions: { binary: osaStub, env: setup.env },
      cache: now ? { now } : undefined,
    });
  }

  function quickCalls(setup: StubSetup): string[] {
    return loggedCalls(setup.logPath)
      .filter((argv) => argv.includes("--quick"))
      .map((argv) => argv[1]!);
  }

  test("repeated lists within 60 s check each path once; agents share a path", async () => {
    const setup = stubSetup(defaultAnswers());
    const projects = service(setup);
    for (let index = 0; index < 5; index += 1) {
      projects.list();
      await projects.cache.idle();
    }
    const calls = quickCalls(setup);
    expect(calls.sort()).toEqual([fixture.appPath, fixture.quotedPath, fixture.toolPath].sort());

    const rows = projects.list();
    const row = (sandbox: string) => rows.find((candidate) => candidate.sandbox_name === sandbox)!;
    expect(row(SANDBOX.retained).fingerprintResult).toBe("changed");
    expect(row(SANDBOX.parked).fingerprintResult).toBe("unknown");
    expect(row(SANDBOX.noKind).fingerprintResult).toBe("unchanged");
    expect(row(SANDBOX.unknownTag).fingerprintResult).toBe("unknown");
    expect(row(SANDBOX.retained).checkedAt).toBeGreaterThan(0);
    expect(row(SANDBOX.retained).osaError).toBeNull();
  });

  test("orphans and unsupported entries spawn nothing", async () => {
    const setup = stubSetup(defaultAnswers());
    const projects = service(setup);
    const rows = projects.list();
    await projects.cache.idle();
    expect(quickCalls(setup)).not.toContain(fixture.orphanPath);
    expect(quickCalls(setup)).toHaveLength(3);
    const orphan = rows.find((candidate) => candidate.sandbox_name === SANDBOX.orphan)!;
    expect(orphan.fingerprintResult).toBe("unknown");
  });

  test("refresh=1 drops the cache and checks again", async () => {
    const setup = stubSetup(defaultAnswers());
    const projects = service(setup);
    projects.list();
    await projects.cache.idle();
    projects.list({ refresh: true });
    await projects.cache.idle();
    expect(quickCalls(setup).filter((path) => path === fixture.appPath)).toHaveLength(2);
  });

  test("a result older than 60 s is checked again in the background", async () => {
    const setup = stubSetup(defaultAnswers());
    let clock = 1_000_000;
    const projects = service(setup, () => clock);
    projects.list();
    await projects.cache.idle();
    clock += 59_000;
    projects.list();
    await projects.cache.idle();
    expect(quickCalls(setup).filter((path) => path === fixture.appPath)).toHaveLength(1);
    clock += 2_000;
    const stale = projects.list();
    // The stale result is still served while the new check runs.
    expect(stale.find((row) => row.sandbox_name === SANDBOX.retained)!.fingerprintResult).toBe(
      "changed",
    );
    await projects.cache.idle();
    expect(quickCalls(setup).filter((path) => path === fixture.appPath)).toHaveLength(2);
  });

  test("at most two checks run at once", async () => {
    const setup = stubSetup(defaultAnswers(), { STUB_OSA_DELAY: "0.2" });
    const runner = new OsaRunner({ binary: osaStub, env: setup.env });
    let running = 0;
    let peak = 0;
    const original = runner.runJson.bind(runner);
    runner.runJson = async (args, timeoutMs) => {
      running += 1;
      peak = Math.max(peak, running);
      try {
        return await original(args, timeoutMs);
      } finally {
        running -= 1;
      }
    };
    const cache = new HostChangeCache(runner);
    cache.schedule(["/a", "/b", "/c", "/d", "/e"]);
    await cache.idle();
    expect(peak).toBe(2);
    expect(quickCalls(setup)).toHaveLength(5);
  });

  test("a failing osa keeps the rows and records the error", async () => {
    const projects = new ProjectService({
      stateRoot: fixture.stateRoot,
      runnerOptions: { binary: join(fixture.dir, "no-such-osa") },
    });
    projects.list();
    await projects.cache.idle();
    const rows = projects.list();
    const retained = rows.find((row) => row.sandbox_name === SANDBOX.retained)!;
    expect(retained.pending).toBe("retained");
    expect(retained.fingerprintResult).toBeNull();
    expect(retained.osaError?.kind).toBe("missing_cli");
    const orphan = rows.find((row) => row.sandbox_name === SANDBOX.orphan)!;
    expect(orphan.orphan).toBe(true);
    expect(orphan.osaError).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Resolve
// ---------------------------------------------------------------------------

describe("resolve", () => {
  function resolveAnswers(answers: Record<string, unknown>): Record<string, unknown> {
    return { ...defaultAnswers(), resolve: answers };
  }

  function service(setup: StubSetup, options: { resolveTimeoutMs?: number; rescueTimeoutMs?: number } = {}) {
    return new ProjectService({
      stateRoot: fixture.stateRoot,
      runnerOptions: { binary: osaStub, env: setup.env },
      ...options,
    });
  }

  function resolveCalls(setup: StubSetup): string[][] {
    return loggedCalls(setup.logPath).filter((argv) => argv[0] === "resolve");
  }

  test("an unknown action is 400 and an unregistered sandbox 404; neither runs osa", async () => {
    const setup = stubSetup(defaultAnswers());
    const projects = service(setup);
    for (const action of ["rm", "", undefined, 3, "APPLY"]) {
      const reply = await projects.resolve(SANDBOX.retained, action);
      expect(reply.status).toBe(400);
      expect(reply.body.error?.kind).toBe("invalid_request");
    }
    for (const sandbox of ["not-registered", SANDBOX.future, "../projects", "-x"]) {
      const reply = await projects.resolve(sandbox, "apply");
      expect(reply.status).toBe(404);
    }
    expect(loggedCalls(setup.logPath)).toEqual([]);
  });

  test("exit 0 is 200 with osa's object; drop and discard get --yes", async () => {
    const setup = stubSetup(
      resolveAnswers({
        [SANDBOX.retained]: {
          apply: { changed: ["base.txt"], message: "Applied the retained patch" },
          drop: { changed: ["/state/dropped/p.patch"], message: "Dropped" },
        },
        [SANDBOX.parked]: {
          rescue: { changed: ["/state/rescue-1"], message: "Rescued" },
          discard: { changed: [`${SANDBOX.parked}:/sandbox/work`], message: "Discarded" },
        },
      }),
    );
    const projects = service(setup);
    const apply = await projects.resolve(SANDBOX.retained, "apply");
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
    expect((await projects.resolve(SANDBOX.retained, "drop")).status).toBe(200);
    expect((await projects.resolve(SANDBOX.parked, "rescue")).body.changed).toEqual(["/state/rescue-1"]);
    expect((await projects.resolve(SANDBOX.parked, "discard")).status).toBe(200);
    expect(resolveCalls(setup)).toEqual([
      ["resolve", SANDBOX.retained, "apply", "--json"],
      ["resolve", SANDBOX.retained, "drop", "--json", "--yes"],
      ["resolve", SANDBOX.parked, "rescue", "--json"],
      ["resolve", SANDBOX.parked, "discard", "--json", "--yes"],
    ]);
  });

  test("exit 2 is 409 refused, with osa's message and nothing changed", async () => {
    const setup = stubSetup(
      resolveAnswers({
        [SANDBOX.retained]: { apply: { exit: 2, message: "The dry run failed; try branch" } },
      }),
    );
    const reply = await service(setup).resolve(SANDBOX.retained, "apply");
    expect(reply.status).toBe(409);
    expect(reply.body).toMatchObject({
      ok: false,
      changed: [],
      exitCode: 2,
      message: "The dry run failed; try branch",
      error: { kind: "refused", message: "The dry run failed; try branch" },
    });
  });

  test("exit 3 and unparsable output are 502 with stderr in detail", async () => {
    const setup = stubSetup(
      resolveAnswers({
        [SANDBOX.parked]: {
          rescue: { exit: 3, message: "download failed", stderr: "openshell: connection reset" },
          discard: { raw: "garbage", stderr: "osa: something odd" },
        },
      }),
    );
    const projects = service(setup);
    const failed = await projects.resolve(SANDBOX.parked, "rescue");
    expect(failed.status).toBe(502);
    expect(failed.body).toMatchObject({
      exitCode: 3,
      error: { kind: "exit", message: "download failed", detail: "openshell: connection reset" },
    });
    const garbled = await projects.resolve(SANDBOX.parked, "discard");
    expect(garbled.status).toBe(502);
    expect(garbled.body.error).toMatchObject({ kind: "invalid_json", detail: "osa: something odd" });
  });

  test("a slow resolve times out; rescue has its own timeout", async () => {
    const setup = stubSetup(
      resolveAnswers({
        [SANDBOX.retained]: { apply: { delay: 5 } },
        [SANDBOX.parked]: { rescue: { delay: 0.5, changed: ["/r"] } },
      }),
    );
    const projects = service(setup, { resolveTimeoutMs: 300, rescueTimeoutMs: 3000 });
    const apply = await projects.resolve(SANDBOX.retained, "apply");
    expect(apply.status).toBeUndefined();
    expect(apply.body.error?.kind).toBe("timeout");
    expect((await projects.resolve(SANDBOX.parked, "rescue")).status).toBe(200);
  });

  test("a second resolve for the same sandbox while one runs is 409 and spawns nothing", async () => {
    const setup = stubSetup(
      resolveAnswers({
        [SANDBOX.retained]: { apply: { delay: 0.4, changed: ["base.txt"] } },
        [SANDBOX.parked]: { rescue: { changed: ["/r"] } },
      }),
    );
    const projects = service(setup);
    const first = projects.resolve(SANDBOX.retained, "apply");
    await Bun.sleep(50);
    const second = await projects.resolve(SANDBOX.retained, "drop");
    expect(second.status).toBe(409);
    expect(second.body.error?.kind).toBe("busy");
    // Another sandbox is not blocked.
    expect((await projects.resolve(SANDBOX.parked, "rescue")).status).toBe(200);
    expect((await first).status).toBe(200);
    expect(resolveCalls(setup).map((argv) => argv[2])).toEqual(["apply", "rescue"]);
    // Done: the sandbox takes a resolve again.
    expect((await projects.resolve(SANDBOX.retained, "apply")).status).toBe(200);
  });

  test("a resolve drops the cached quick status, so the next list checks that path again", async () => {
    const setup = stubSetup(
      resolveAnswers({ [SANDBOX.retained]: { apply: { exit: 2, message: "refused" } } }),
    );
    const projects = service(setup);
    projects.list();
    await projects.cache.idle();
    projects.list();
    await projects.cache.idle();
    const quickFor = (path: string) =>
      loggedCalls(setup.logPath).filter((argv) => argv.includes("--quick") && argv[1] === path).length;
    expect(quickFor(fixture.appPath)).toBe(1);
    await projects.resolve(SANDBOX.retained, "apply");
    expect(projects.cache.get(fixture.appPath)).toBeNull();
    expect(projects.cache.get(fixture.quotedPath)).not.toBeNull();
    projects.list();
    await projects.cache.idle();
    expect(quickFor(fixture.appPath)).toBe(2);
    expect(quickFor(fixture.quotedPath)).toBe(1);
  });

  test("busy from quick status reaches the row", async () => {
    const answers = defaultAnswers();
    (answers[fixture.appPath] as { quick: unknown[] }).quick = [
      { sandbox_name: SANDBOX.retained, fingerprint_result: "changed", busy: true },
      { sandbox_name: SANDBOX.parked, fingerprint_result: "unknown", busy: false },
    ];
    const projects = service(stubSetup(answers));
    projects.list();
    await projects.cache.idle();
    const rows = projects.list();
    const row = (sandbox: string) => rows.find((candidate) => candidate.sandbox_name === sandbox)!;
    expect(row(SANDBOX.retained).busy).toBe(true);
    expect(row(SANDBOX.parked).busy).toBe(false);
    expect(row(SANDBOX.noKind).busy).toBe(false);
  });
});
