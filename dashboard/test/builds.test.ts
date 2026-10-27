// Image build tests (dashboard-image-build): the stub osa's `images` and
// `image build`, the build hub, and the image routes and stream. No engine,
// no gateway, no network beyond loopback.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DashboardConfig } from "../src/config.ts";
import { BuildHub, type BuildSummary } from "../src/builds.ts";
import { OpenShellClient } from "../src/openshell.ts";
import { OsaRunner, ProjectService } from "../src/projects.ts";
import { createDashboardServer, type DashboardHandle } from "../src/server.ts";
import { emptyStateHome } from "./state-fixture.ts";

const stubDir = join(import.meta.dir, "stub");
const osaStub = join(stubDir, "osa");

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
let hubs: BuildHub[];
let handles: DashboardHandle[];

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "dashboard-builds-test-"));
  answersPath = join(workDir, "osa-answers.json");
  osaLog = join(workDir, "osa-argv.log");
  writeFileSync(answersPath, "{}");
  hubs = [];
  handles = [];
});

afterEach(() => {
  for (const hub of hubs) hub.stop();
  for (const handle of handles) handle.stop();
  rmSync(workDir, { recursive: true, force: true });
});

function setAnswers(answers: Record<string, unknown>): void {
  writeFileSync(answersPath, JSON.stringify(answers));
}

function stubEnv(): Record<string, string> {
  return { STUB_OSA_FIXTURE: answersPath, STUB_OSA_LOG: osaLog };
}

function runner(): OsaRunner {
  return new OsaRunner({ binary: osaStub, env: stubEnv() });
}

function hub(options: ConstructorParameters<typeof BuildHub>[1] = {}): BuildHub {
  const created = new BuildHub(runner(), options);
  hubs.push(created);
  return created;
}

function osaCalls(): string[][] {
  if (!existsSync(osaLog)) return [];
  return readFileSync(osaLog, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as string[]);
}

async function answer(args: string[], signal?: { afterMs: number; name: string }) {
  const proc = Bun.spawn({
    cmd: [osaStub, ...args],
    env: { ...process.env, ...stubEnv() },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (signal) setTimeout(() => proc.kill(signal.name), signal.afterMs);
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

interface SseEvent {
  event: string;
  data: string;
}

/** Reads SSE frames from a stream until `until` holds for the events so far. */
async function readEvents(
  stream: ReadableStream<Uint8Array>,
  until: (events: SseEvent[]) => boolean,
  timeoutMs = 5000,
): Promise<SseEvent[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const events: SseEvent[] = [];
  let buffer = "";
  const deadline = Date.now() + timeoutMs;
  try {
    while (!until(events)) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`timed out; events so far: ${JSON.stringify(events)}`);
      const result = await Promise.race([
        reader.read(),
        Bun.sleep(remaining).then(() => ({ done: true, value: undefined }) as const),
      ]);
      if (result.done) break;
      buffer += decoder.decode(result.value, { stream: true });
      let index = buffer.indexOf("\n\n");
      while (index !== -1) {
        const frame = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const event = /^event: (.*)$/m.exec(frame)?.[1];
        const data = /^data: (.*)$/m.exec(frame)?.[1];
        if (event !== undefined && data !== undefined) events.push({ event, data });
        index = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
  return events;
}

const isDone = (events: SseEvent[]) => events.some((event) => event.event === "done");

function doneOf(events: SseEvent[]): BuildSummary {
  const done = events.find((event) => event.event === "done");
  if (!done) throw new Error("no done event");
  return JSON.parse(done.data) as BuildSummary;
}

async function finished(target: BuildHub, timeoutMs = 5000): Promise<BuildSummary> {
  const deadline = Date.now() + timeoutMs;
  while (target.isRunning()) {
    if (Date.now() > deadline) throw new Error("build did not finish");
    await Bun.sleep(20);
  }
  return target.summary()!;
}

// ---------------------------------------------------------------------------
// Stub
// ---------------------------------------------------------------------------

describe("stub osa images and image build", () => {
  test("images answers the built-in fixtures, or the fixture's", async () => {
    const builtIn = JSON.parse((await answer(["images", "--json"])).stdout) as Array<Record<string, any>>;
    expect(builtIn.map((image) => image.agent)).toEqual(["mk", "oc", "cc", "cx"]);
    expect(builtIn[0]).toMatchObject({ present: true, image: "maki-agent:local" });
    expect(builtIn[1]).toMatchObject({ present: false, error: null });
    expect(builtIn[2]!.error.message).toContain("<img src=x onerror=alert(1)>");
    expect(builtIn[3]).toMatchObject({ present: true, configured: "codex-env:me" });
    setAnswers({ images: [{ agent: "mk", present: false }] });
    expect(JSON.parse((await answer(["images", "--json"])).stdout)).toEqual([{ agent: "mk", present: false }]);
  });

  test("image build prints timed lines, fails with a chosen status, or sleeps until TERM", async () => {
    setAnswers({ build: { oc: { lines: 4, interval: 0.01 }, cc: { exit: 7 }, mk: { mode: "sleep" } } });
    const built = await answer(["image", "build", "oc"]);
    expect(built.code).toBe(0);
    expect(built.stdout).toContain("Step 1/4: building oc");
    expect(built.stderr).toContain("Step 2/4: building oc");
    const images = JSON.parse((await answer(["images", "--json"])).stdout) as Array<Record<string, any>>;
    expect(images.find((image) => image.agent === "oc")!.present).toBe(true);
    expect((await answer(["image", "build", "cc"])).code).toBe(7);
    const slept = await answer(["image", "build", "mk"], { afterMs: 300, name: "SIGTERM" });
    expect(slept.code).toBe(143);
    expect(slept.stdout).toContain("build cancelled");
    expect((await answer(["image", "build", "zz"])).code).toBe(1);
    expect((await answer(["image", "build", "mk", "--maki-version", "1"])).code).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Hub
// ---------------------------------------------------------------------------

describe("build hub", () => {
  test("a second build while one runs is refused and spawns nothing", async () => {
    setAnswers({ build: { default: { mode: "sleep" } } });
    const target = hub();
    expect(target.start("mk").ok).toBe(true);
    const second = target.start("oc");
    expect(second).toMatchObject({ ok: false, kind: "busy" });
    await Bun.sleep(100);
    expect(osaCalls()).toEqual([["image", "build", "mk"]]);
    expect(target.cancel()).toBe(true);
    await finished(target);
  });

  test("a subscriber gets the replay, then live lines, then done", async () => {
    setAnswers({ build: { mk: { lines: 6, interval: 0.1 } } });
    const target = hub();
    target.start("mk");
    await Bun.sleep(250);
    const events = await readEvents(target.subscribe().stream, isDone);
    const lines = events.filter((event) => event.event === "line").map((event) => event.data);
    expect(events[0]!.event).toBe("start");
    expect(lines).toEqual([1, 2, 3, 4, 5, 6].map((step) => `Step ${step}/6: building mk`));
    expect(doneOf(events)).toMatchObject({ agent: "mk", exitCode: 0, cancelled: false });
  });

  test("a late subscriber gets the replay and done at once", async () => {
    setAnswers({ build: { oc: { lines: 3, interval: 0 } } });
    const target = hub();
    target.start("oc");
    await finished(target);
    const events = await readEvents(target.subscribe().stream, isDone, 1000);
    expect(events.map((event) => event.event)).toEqual(["start", "line", "line", "line", "done"]);
  });

  test("a subscriber leaving does not stop the build", async () => {
    setAnswers({ build: { mk: { lines: 4, interval: 0.05 } } });
    const target = hub();
    target.start("mk");
    const subscription = target.subscribe();
    subscription.unsubscribe();
    await subscription.stream.cancel().catch(() => {});
    const summary = await finished(target);
    expect(summary.exitCode).toBe(0);
    expect(target.snapshot()).toHaveLength(4);
    expect(target.subscriberCount()).toBe(0);
  });

  test("cancel sends SIGTERM; a build that ignores it gets SIGKILL after the grace", async () => {
    setAnswers({ build: { mk: { mode: "sleep" }, oc: { mode: "ignore-term" } } });
    const target = hub({ killGraceMs: 300 });
    target.start("mk");
    await Bun.sleep(300);
    target.cancel();
    const cancelled = await finished(target);
    expect(cancelled).toMatchObject({ cancelled: true, reason: "cancel", exitCode: 143 });
    expect(target.snapshot()).toContain("stub osa: build cancelled");

    target.start("oc");
    await Bun.sleep(300);
    const started = Date.now();
    target.cancel();
    const killed = await finished(target, 3000);
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
    expect(killed).toMatchObject({ cancelled: true, exitCode: 137 });
    expect(target.cancel()).toBe(false);
  });

  test("a full ring drops the oldest lines and says how many", async () => {
    setAnswers({ build: { cx: { lines: 12, interval: 0 } } });
    const target = hub({ ringLimit: 5 });
    target.start("cx");
    const summary = await finished(target);
    expect(summary.dropped).toBe(7);
    // stdout and stderr are separate pipes, so only the count is exact.
    expect(target.snapshot()).toHaveLength(5);
    expect(target.snapshot().every((line) => /^Step \d+\/12: building cx$/.test(line))).toBe(true);
    const events = await readEvents(target.subscribe().stream, isDone, 1000);
    expect(JSON.parse(events[0]!.data).dropped).toBe(7);
  });

  test("the hard cap cancels a build that runs too long", async () => {
    setAnswers({ build: { mk: { mode: "sleep" } } });
    const target = hub({ hardCapMs: 300 });
    target.start("mk");
    const summary = await finished(target, 3000);
    expect(summary).toMatchObject({ cancelled: true, reason: "timeout", exitCode: 143 });
  });
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

describe("image routes", () => {
  let stateHome: string;

  beforeEach(() => {
    stateHome = emptyStateHome();
  });

  afterEach(() => {
    rmSync(stateHome, { recursive: true, force: true });
  });

  function start(overrides: { readOnly?: boolean } = {}): DashboardHandle {
    const projects = new ProjectService({
      stateRoot: join(stateHome, "osa"),
      runnerOptions: { binary: osaStub, env: stubEnv() },
    });
    const handle = createDashboardServer({
      port: 0,
      client: new OpenShellClient({ env: { PATH: `${stubDir}:${process.env.PATH ?? ""}` } }),
      config: testConfig,
      readOnly: overrides.readOnly,
      projects,
    });
    handles.push(handle);
    return handle;
  }

  const base = (handle: DashboardHandle) => `http://127.0.0.1:${handle.port}`;
  const post = (handle: DashboardHandle, path: string, token: string | null = handle.token) =>
    fetch(`${base(handle)}${path}`, {
      method: "POST",
      headers: token === null ? {} : { "x-dashboard-token": token },
    });

  test("GET /api/images lists osa images; GET /api/images/build is null before a build", async () => {
    const handle = start();
    const images = (await (await fetch(`${base(handle)}/api/images`)).json()) as { images: unknown[] };
    expect(images.images).toHaveLength(4);
    expect(await (await fetch(`${base(handle)}/api/images/build`)).json()).toEqual({ build: null });
    expect(osaCalls()).toEqual([["images", "--json"]]);
  });

  test("build and cancel need the token and are refused in read-only mode", async () => {
    const handle = start();
    expect((await post(handle, "/api/images/mk/build", null)).status).toBe(403);
    expect((await post(handle, "/api/images/mk/build", "wrong")).status).toBe(403);
    expect((await post(handle, "/api/images/build/cancel", null)).status).toBe(403);
    const readOnly = start({ readOnly: true });
    const refused = await post(readOnly, "/api/images/mk/build");
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as any).error.kind).toBe("read_only");
    expect((await post(readOnly, "/api/images/build/cancel")).status).toBe(403);
    expect(osaCalls()).toEqual([]);
  });

  test("an unknown agent is 400 and cancel with nothing running is 409", async () => {
    const handle = start();
    expect((await post(handle, "/api/images/zz/build")).status).toBe(400);
    expect((await post(handle, "/api/images/build/cancel")).status).toBe(409);
    expect(osaCalls()).toEqual([]);
  });

  test("a second build is 409; the stream replays it; cancel ends it", async () => {
    setAnswers({ build: { default: { mode: "sleep" } } });
    const handle = start();
    const first = await post(handle, "/api/images/mk/build");
    expect(first.status).toBe(202);
    expect(((await first.json()) as any).build).toMatchObject({ agent: "mk", finishedAt: null });
    const second = await post(handle, "/api/images/oc/build");
    expect(second.status).toBe(409);
    expect(((await second.json()) as any).error.kind).toBe("busy");
    await Bun.sleep(300);
    const stream = await fetch(`${base(handle)}/events/build?token=${handle.token}`);
    expect(stream.status).toBe(200);
    const cancel = await post(handle, "/api/images/build/cancel");
    expect(cancel.status).toBe(200);
    const events = await readEvents(stream.body!, isDone);
    expect(events.some((event) => event.event === "line" && event.data === "Step 1: building mk")).toBe(true);
    expect(doneOf(events)).toMatchObject({ cancelled: true, exitCode: 143 });
    expect(osaCalls().filter((argv) => argv[0] === "image")).toEqual([["image", "build", "mk"]]);
  });

  test("the stream needs the token", async () => {
    const handle = start();
    expect((await fetch(`${base(handle)}/events/build`)).status).toBe(403);
    expect((await fetch(`${base(handle)}/events/build?token=wrong`)).status).toBe(403);
  });
});
