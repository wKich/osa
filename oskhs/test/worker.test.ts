import { describe, expect, test } from "bun:test";
import { echoRound, Worker, type Round, type WorkerOptions } from "../src/worker.ts";
import { dueTask, MemoryStore } from "./memory-store.ts";

function setup(round: Round = echoRound(), over: Partial<WorkerOptions> = {}) {
  const store = new MemoryStore();
  const events: { taskId: string; event: string; details?: Record<string, unknown> }[] = [];
  const worker = new Worker(store, round, {
    hostId: "oskhs-test",
    maxRounds: 2,
    maxPerProject: 1,
    roundTimeoutSec: 5,
    heartbeatSec: 0.05,
    cancelPollSec: 0.02,
    log: (taskId, event, details) => events.push({ taskId, event, details }),
    info: () => {},
    ...over,
  });
  return { store, worker, events };
}

const until = async (cond: () => boolean, ms = 2000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("condition not met");
    await Bun.sleep(5);
  }
};

describe("worker", () => {
  test("answers a first round the way kiss posts it", async () => {
    const { store, worker, events } = setup();
    store.tasks.set("t1", dueTask("t1"));
    store.tasks.set("plain", { ...dueTask("plain"), executor: null });
    expect(await worker.tick()).toBe(true);
    await worker.drain();
    expect(store.task("t1")).toMatchObject({ state: "completed", replyMessage: "echo: question t1", runtimeState: "idle_stopped", agentHostId: "oskhs-test" });
    expect(store.task("plain")).toMatchObject({ runtimeState: "queued" });
    expect(await worker.tick()).toBe(false);
    expect(events.filter((e) => e.taskId === "t1").map((e) => e.event)).toEqual(["claimed", "round-start", "round-end", "idle"]);
  });

  test("answers thread follow-ups and refuses unsupported sub-tasks", async () => {
    const { store, worker } = setup();
    store.tasks.set("t1", dueTask("t1", { state: "completed", runtimeState: "failed" }));
    store.subTasks.set("s1", { _id: "s1", taskId: "t1", type: "thread_instruction", prompt: "and then?", state: "pending", createdAt: new Date(1) });
    store.subTasks.set("s2", { _id: "s2", taskId: "t1", type: "gitlab_review_comment", prompt: "fix", state: "pending", createdAt: new Date(2) });
    await worker.tick();
    await worker.drain();
    expect({ ...store.subTasks.get("s1") }).toMatchObject({ state: "completed", reply: "echo: and then?" });
    expect(store.subTasks.get("s2")).toMatchObject({ state: "error" });
    expect(String(store.subTasks.get("s2")!.errorMessage)).toContain("oskhs");
    expect(store.task("t1")).toMatchObject({ state: "completed", runtimeState: "idle_stopped" });
    expect(store.task("t1").replyMessage).toBeUndefined();
  });

  test("refuses restricted-network projects fail-closed", async () => {
    let ran = false;
    const { store, worker } = setup(async () => ((ran = true), { ok: true, text: "x" }));
    store.projects.set("proj-1", { networkRestrictionProfileId: "profile" });
    store.tasks.set("t1", dueTask("t1"));
    await worker.tick();
    await worker.drain();
    expect(ran).toBe(false);
    expect(store.task("t1")).toMatchObject({ state: "closed", runtimeState: "failed", runtimeStartFailures: 4, wakeRequestedAt: null });
    expect(await worker.tick()).toBe(false); // never claimed again
  });

  test("a cancel mid-round aborts it and finishes the cancel", async () => {
    const { store, worker, events } = setup(echoRound(10));
    store.tasks.set("t1", dueTask("t1"));
    await worker.tick();
    await until(() => events.some((e) => e.event === "round-start"));
    store.tasks.set("t1", { ...store.task("t1"), cancelRequestedAt: new Date(), state: "closed", notificationState: "closed" });
    const started = Date.now();
    await worker.drain();
    expect(Date.now() - started).toBeLessThan(1000);
    expect(store.task("t1")).toMatchObject({ runtimeState: "idle_stopped", cancelledAt: expect.any(Date), wakeRequestedAt: null });
    expect(store.task("t1").replyMessage).toBeUndefined();
  });

  test("a round past its limit fails the task visibly", async () => {
    const { store, worker } = setup(echoRound(10), { roundTimeoutSec: 0.1 });
    store.tasks.set("t1", dueTask("t1"));
    await worker.tick();
    await worker.drain();
    expect(store.task("t1")).toMatchObject({ state: "closed", runtimeState: "failed" });
    expect(String(store.task("t1").errorMessage)).toContain("timed out");
  });

  test("heartbeats advance while a round runs", async () => {
    const { store, worker, events } = setup(echoRound(0.3));
    store.tasks.set("t1", dueTask("t1"));
    await worker.tick();
    await until(() => events.some((e) => e.event === "round-start"));
    const first = store.task("t1").lastRuntimeHeartbeatAt as Date;
    await Bun.sleep(150);
    expect((store.task("t1").lastRuntimeHeartbeatAt as Date).getTime()).toBeGreaterThan(first.getTime());
    await worker.drain();
  });

  test("project and worker caps", async () => {
    const { store, worker } = setup(echoRound(0.2));
    store.tasks.set("a1", dueTask("a1"));
    store.tasks.set("a2", dueTask("a2"));
    store.tasks.set("b1", dueTask("b1", { projectId: "proj-2" }));
    store.tasks.set("c1", dueTask("c1", { projectId: "proj-3" }));
    expect(await worker.tick()).toBe(true); // a1
    expect(await worker.tick()).toBe(true); // b1 — a2 waits for proj-1
    expect(store.task("a2").runtimeState).toBe("queued");
    expect(await worker.tick()).toBe(false); // worker cap 2
    await worker.drain();
    expect(await worker.tick()).toBe(true);
    await worker.drain();
  });

  test("shutdown requeues without counting a loss", async () => {
    const { store, worker } = setup(echoRound(10));
    store.tasks.set("t1", dueTask("t1", { runtimeStartFailures: 1 }));
    await worker.tick();
    await Bun.sleep(20);
    await worker.shutdown();
    expect(store.task("t1")).toMatchObject({ runtimeState: "failed", wakeRequestedAt: expect.any(Date), runtimeStartFailures: 1 });
  });
});

describe("recovery", () => {
  test("requeues own lost tasks and resets their sub-tasks", async () => {
    const { store, worker, events } = setup();
    store.tasks.set("t1", { ...dueTask("t1"), runtimeState: "running", agentHostId: "oskhs-test", wakeRequestedAt: null });
    store.tasks.set("other", { ...dueTask("other"), runtimeState: "running", agentHostId: "oskhs-elsewhere" });
    store.subTasks.set("s1", { _id: "s1", taskId: "t1", type: "thread_instruction", prompt: "x", state: "processing", createdAt: new Date() });
    await worker.recover();
    expect(store.task("t1")).toMatchObject({ runtimeState: "failed", wakeRequestedAt: expect.any(Date), runtimeStartFailures: 1 });
    expect({ ...store.subTasks.get("s1") }).toMatchObject({ state: "pending" });
    expect(store.task("other")).toMatchObject({ runtimeState: "running" });
    expect(events.find((e) => e.event === "recovered")?.details).toEqual({ action: "requeued", lost: 1 });
    expect(await worker.tick()).toBe(true);
    await worker.drain();
    expect(store.task("t1")).toMatchObject({ state: "completed", runtimeState: "idle_stopped", runtimeStartFailures: 0 });
  });

  test("the third loss closes the task", async () => {
    const { store, worker } = setup();
    store.tasks.set("t1", { ...dueTask("t1"), runtimeState: "running", agentHostId: "oskhs-test", runtimeStartFailures: 2 });
    await worker.recover();
    expect(store.task("t1")).toMatchObject({ state: "closed", runtimeState: "failed", runtimeStartFailures: 4 });
    expect(String(store.task("t1").errorMessage)).toContain("3 times");
  });

  test("a cancelled lost task finishes its cancel", async () => {
    const { store, worker } = setup();
    store.tasks.set("t1", { ...dueTask("t1"), runtimeState: "running", agentHostId: "oskhs-test", cancelRequestedAt: new Date() });
    await worker.recover();
    expect(store.task("t1")).toMatchObject({ runtimeState: "idle_stopped", cancelledAt: expect.any(Date) });
  });
});
