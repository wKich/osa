// Contract with kiss's own mongoose schemas (design decision 11). oskhs imports
// no kiss code at runtime; this test loads kiss's model files from KISS_REPO
// (default: the sibling checkout) and checks every document shape the worker
// writes. A kiss rename of a field or enum value fails here.
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import * as p from "../src/kiss/protocol.ts";

const kiss = process.env.KISS_REPO ?? resolve(import.meta.dir, "../../../../yourpapai/kiss");
const available = existsSync(`${kiss}/src/models/AgentTask.ts`) && existsSync(`${kiss}/node_modules/mongoose`);
if (!available) console.log(`kiss contract: skipped (no kiss checkout at ${kiss}; set KISS_REPO)`);

const now = new Date("2026-10-23T00:00:00Z");

describe.skipIf(!available)("kiss schema contract", async () => {
  const { AgentTask } = available ? await import(`${kiss}/src/models/AgentTask.ts`) : ({} as never);
  const { AgentSubTask } = available ? await import(`${kiss}/src/models/AgentSubTask.ts`) : ({} as never);

  const taskUpdates: [string, p.Update][] = [
    ["claim", p.claimUpdate(now, "oskhs-h")],
    ["heartbeat", p.heartbeatUpdate(now)],
    ["answer", p.answerUpdate(now, "echo")],
    ["failure", p.failureUpdate(now, "boom")],
    ["refusal", p.refusalUpdate(now, p.RESTRICTED_MESSAGE)],
    ["idle", p.idleUpdate(now)],
    ["cancel finish", p.cancelFinishUpdate(now)],
    ["requeue", p.requeueUpdate(now, 1)],
  ];
  const subTaskUpdates: [string, p.Update][] = [
    ["claim", p.subTaskClaimUpdate(now)],
    ["reset", p.subTaskResetUpdate(now)],
    ["complete", p.subTaskCompleteUpdate(now, "reply")],
    ["error", p.subTaskErrorUpdate(now, "no")],
  ];

  test.each(taskUpdates)("task update '%s' is valid for kiss's AgentTask", (_name, update) => {
    for (const key of Object.keys(update.$set)) expect(AgentTask.schema.path(key)).toBeDefined();
    const doc = new AgentTask({ _id: "t1", prompt: "q", executor: "oskhs", ...update.$set });
    expect(doc.validateSync()).toBeUndefined();
  });

  test.each(subTaskUpdates)("sub-task update '%s' is valid for kiss's AgentSubTask", (_name, update) => {
    for (const key of Object.keys(update.$set)) expect(AgentSubTask.schema.path(key)).toBeDefined();
    const doc = new AgentSubTask({ _id: "s1", taskId: "t1", type: "thread_instruction", prompt: "q", ...update.$set });
    expect(doc.validateSync()).toBeUndefined();
  });

  test("every field the claim filter reads exists in kiss's schema", () => {
    const keys = (f: p.Doc): string[] =>
      Object.entries(f).flatMap(([k, v]) => (k === "$and" || k === "$or" ? (v as p.Doc[]).flatMap(keys) : [k]));
    for (const key of keys(p.claimFilter(now, ["x"]))) expect(AgentTask.schema.path(key)).toBeDefined();
  });

  test("enum values oskhs relies on", () => {
    expect(AgentTask.schema.path("executor").options.enum).toContain(p.EXECUTOR);
    expect(AgentTask.schema.path("runtimeState").options.enum).toEqual(
      expect.arrayContaining(["queued", "running", "idle_stopped", "stopping", "failed"]),
    );
    expect(AgentTask.schema.path("state").options.enum).toEqual(expect.arrayContaining(["processing", "review", "completed", "closed"]));
    expect(AgentSubTask.schema.path("state").options.enum).toEqual(["pending", "processing", "completed", "error"]);
    expect(AgentSubTask.schema.path("type").options.enum).toContain("thread_instruction");
  });

  test("collection names", () => {
    expect(AgentTask.collection.collectionName).toBe(p.TASKS);
    expect(AgentSubTask.collection.collectionName).toBe(p.SUBTASKS);
  });
});
