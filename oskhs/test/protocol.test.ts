import { describe, expect, test } from "bun:test";
import * as p from "../src/kiss/protocol.ts";

const now = new Date("2026-10-23T00:00:00Z");

describe("claim", () => {
  test("is KHS's filter plus the executor clause", () => {
    // kiss origin/master KissHostService.claimTask, with executor: { $ne: 'oskhs' } there
    const khs = {
      state: { $in: ["processing", "review", "completed", "closed"] },
      runtimeState: { $in: ["queued", "failed"] },
      wakeRequestedAt: { $ne: null, $lte: now },
      cancelRequestedAt: null,
      $and: [
        { $or: [{ runtimeRetryAfter: null }, { runtimeRetryAfter: { $lte: now } }] },
        { $or: [{ runtimeStartFailures: { $exists: false } }, { runtimeStartFailures: { $lt: 4 } }] },
      ],
    };
    expect(p.claimFilter(now)).toEqual({ ...khs, executor: "oskhs" });
  });
  test("excludes saturated projects", () => {
    expect(p.claimFilter(now, ["p1"]).projectId).toEqual({ $nin: ["p1"] });
  });
  test("sets the runtime fields KHS sets", () => {
    expect(p.claimUpdate(now, "oskhs-h")).toEqual({
      $set: { runtimeState: "running", agentHostId: "oskhs-h", lastRuntimeHeartbeatAt: now, wakeRequestedAt: null, updatedAt: now },
    });
  });
});

describe("runtime writes", () => {
  test("heartbeat never revives a stopped runtime and loses to a cancel", () => {
    expect(p.heartbeatFilter("t")).toEqual({ _id: "t", cancelRequestedAt: null, runtimeState: { $nin: ["stopping", "idle_stopped"] } });
    expect(p.heartbeatUpdate(now).$set).not.toHaveProperty("runtimeStartFailures");
  });
  test("answer, failure, refusal", () => {
    expect(p.answerUpdate(now, "hi").$set).toMatchObject({ state: "completed", replyMessage: "hi" });
    expect(p.failureUpdate(now, "x").$set).toMatchObject({ state: "closed", errorMessage: "x", runtimeState: "failed" });
    expect(p.refusalUpdate(now, "no").$set).toMatchObject({ runtimeStartFailures: 4, wakeRequestedAt: null, state: "closed" });
  });
  test("cancel finish mirrors markCancelFinished", () => {
    expect(p.cancelFinishFilter("t")).toEqual({ _id: "t", cancelRequestedAt: { $ne: null } });
    expect(p.cancelFinishUpdate(now).$set).toMatchObject({ cancelledAt: now, runtimeState: "idle_stopped", wakeRequestedAt: null });
  });
  test("every $set carries updatedAt", () => {
    const updates = [
      p.claimUpdate(now, "h"), p.heartbeatUpdate(now), p.answerUpdate(now, "a"), p.failureUpdate(now, "f"),
      p.refusalUpdate(now, "r"), p.idleUpdate(now), p.cancelFinishUpdate(now), p.requeueUpdate(now, 1),
      p.subTaskClaimUpdate(now), p.subTaskResetUpdate(now), p.subTaskCompleteUpdate(now, "r"), p.subTaskErrorUpdate(now, "e"),
    ];
    for (const u of updates) expect(u.$set.updatedAt).toBe(now);
  });
});
