// MongoTaskStore against a real MongoDB (an ephemeral database, dropped
// afterwards). Runs only with OSKHS_TEST_MONGO_URI, e.g.
//   OSKHS_TEST_MONGO_URI=mongodb://127.0.0.1:27017 make test-oskhs
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { MongoClient, ObjectId } from "mongodb";
import { MongoTaskStore } from "../src/kiss/store.ts";
import * as p from "../src/kiss/protocol.ts";

const base = process.env.OSKHS_TEST_MONGO_URI;
if (!base) console.log("store: skipped (set OSKHS_TEST_MONGO_URI to run against a real MongoDB)");

describe.skipIf(!base)("MongoTaskStore", () => {
  const dbName = `oskhs_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  let admin: MongoClient;
  let store: MongoTaskStore;
  const due = () => ({ state: "processing", runtimeState: "queued", wakeRequestedAt: new Date(Date.now() - 1000), cancelRequestedAt: null, createdAt: new Date() });

  beforeAll(async () => {
    admin = new MongoClient(base!);
    await admin.connect();
    store = await MongoTaskStore.connect(`${base!.replace(/\/$/, "")}/${dbName}`);
  });
  afterAll(async () => {
    await store?.close();
    await admin?.db(dbName).dropDatabase();
    await admin?.close();
  });
  const tasks = () => admin.db(dbName).collection<p.Doc>(p.TASKS);

  test("claims only marked tasks, honors project caps", async () => {
    const pa = new ObjectId();
    const pb = new ObjectId();
    await tasks().insertMany([
      { _id: "plain" as never, prompt: "q", ...due() },
      { _id: "a" as never, prompt: "q", executor: "oskhs", projectId: pa, ...due() },
      { _id: "b" as never, prompt: "q", executor: "oskhs", projectId: pb, ...due() },
    ]);
    const first = await store.claim("oskhs-test", [pa]);
    expect(first?._id).toBe("b");
    expect(first).toMatchObject({ runtimeState: "running", agentHostId: "oskhs-test", wakeRequestedAt: null });
    expect((await store.claim("oskhs-test", [pa]))).toBeNull();
    expect((await store.claim("oskhs-test", []))?._id).toBe("a");
    expect(await tasks().findOne({ _id: "plain" as never })).toMatchObject({ runtimeState: "queued" });
  });

  test("heartbeat outcomes", async () => {
    await tasks().insertOne({ _id: "h" as never, prompt: "q", executor: "oskhs", ...due() });
    await store.claim("oskhs-test", []);
    expect(await store.heartbeat("h")).toBe("updated");
    await tasks().updateOne({ _id: "h" as never }, { $set: { runtimeState: "idle_stopped" } });
    expect(await store.heartbeat("h")).toBe("stopped");
    await tasks().updateOne({ _id: "h" as never }, { $set: { runtimeState: "running", cancelRequestedAt: new Date() } });
    expect(await store.heartbeat("h")).toBe("cancelled");
    expect(await store.isCancelling("h")).toBe(true);
    expect(await store.updateTask(p.unlessCancelling("h"), p.answerUpdate(new Date(), "x"))).toBe(false);
  });

  test("sub-tasks in FIFO order, reset of orphans", async () => {
    const sub = admin.db(dbName).collection<p.Doc>(p.SUBTASKS);
    await sub.insertMany([
      { _id: "s2" as never, taskId: "t", type: "thread_instruction", prompt: "2", state: "pending", createdAt: new Date(2) },
      { _id: "s1" as never, taskId: "t", type: "thread_instruction", prompt: "1", state: "pending", createdAt: new Date(1) },
      { _id: "s0" as never, taskId: "t", type: "thread_instruction", prompt: "0", state: "processing", createdAt: new Date(0) },
    ]);
    expect(await store.resetSubTasks("t")).toBe(1);
    expect((await store.claimSubTask("t"))?._id).toBe("s0");
    expect((await store.claimSubTask("t"))?._id).toBe("s1");
    await store.updateSubTask("s1", p.subTaskCompleteUpdate(new Date(), "r"));
    expect(await sub.findOne({ _id: "s1" as never })).toMatchObject({ state: "completed", reply: "r" });
  });

  test("restriction lookup", async () => {
    const id = new ObjectId();
    await admin.db(dbName).collection(p.PROJECTS).insertOne({ _id: id, networkRestrictionProfileId: new ObjectId() });
    expect(await store.restriction(id)).not.toBeNull();
    expect(await store.restriction(new ObjectId())).toBeNull();
    expect(await store.restriction(null)).toBeNull();
  });
});
