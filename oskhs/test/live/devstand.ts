#!/usr/bin/env bun
// Dev-stand helper for the oskhs live checks (kiss local stack, kiss branch
// with the executor marker). Writes the documents kiss itself would write:
//
//   devstand.ts mark-channel <channelId> | unmark-channel <channelId>
//   devstand.ts insert <taskId> <threadRootPostId> "<prompt>"   # as MattermostTaskSource + startTask
//   devstand.ts cancel <taskId>                                 # as AgentRuntimeService.cancelTask
//   devstand.ts follow-up <taskId> <subTaskId> "<prompt>"       # thread mention: sub-task + requestWake
//   devstand.ts show <taskId>
//   devstand.ts delete <taskId>
//
// OSKHS_MONGO_URI selects the database (default: the local stack).
import { MongoClient } from "mongodb";

const uri = process.env.OSKHS_MONGO_URI ?? "mongodb://127.0.0.1:27017/kiss-agent";
const [cmd, ...args] = process.argv.slice(2);
const client = new MongoClient(uri);
await client.connect();
const db = client.db();
const tasks = db.collection<Record<string, unknown>>("agenttasks");
const subTasks = db.collection<Record<string, unknown>>("agentsubtasks");
const projects = db.collection("projects");
const now = new Date();

async function channelProject(channelId: string) {
  const project = await projects.findOne({ "channels.channelId": channelId });
  if (!project) throw new Error(`no project has channel ${channelId}`);
  return project;
}

switch (cmd) {
  case "mark-channel":
  case "unmark-channel": {
    const [channelId] = args as [string];
    const project = await channelProject(channelId);
    const value = cmd === "mark-channel" ? "oskhs" : null;
    await projects.updateOne({ _id: project._id }, { $set: { "channels.$[c].executor": value } }, { arrayFilters: [{ "c.channelId": channelId }] });
    console.log(`${cmd}: ${project.title} / ${channelId}`);
    break;
  }
  case "insert": {
    const [id, rootPostId, prompt] = args as [string, string, string];
    const channelId = process.env.OSKHS_DEV_CHANNEL ?? "ihtptp4bobd5b858qkfkk16sqe";
    const project = await channelProject(channelId);
    const channel = (project.channels as { channelId: string; channelName: string; executor?: string }[]).find((c) => c.channelId === channelId)!;
    await tasks.insertOne({
      _id: id as never,
      prompt,
      agentRuntime: "pi",
      executor: channel.executor ?? project.executor ?? null,
      state: "processing",
      runtimeState: "queued",
      wakeRequestedAt: now,
      lastExternalActivityAt: now,
      lastMeaningfulActivityAt: now,
      runtimeStartFailures: 0,
      runtimeRetryAfter: null,
      cancelRequestedAt: null,
      cancelledAt: null,
      projectId: project._id,
      sourceChannelId: channelId,
      channelName: channel.channelName,
      sourceMessageId: rootPostId,
      // statuses go to the reply only: an old thread's root keeps its reactions
      suppressRootStatusReactions: true,
      ackPostId: null,
      source: `https://chat.skbkontur.ru/_redirect/pl/${rootPostId}`,
      taskSourceId: "mattermost",
      notificationState: "loading",
      taskRepositories: ((project.repositories as { projectPath: string }[]) ?? []).map((r) => ({ projectPath: r.projectPath })),
      readOnly: false,
      createdAt: now,
      updatedAt: now,
    });
    console.log(`inserted ${id} (executor ${channel.executor ?? project.executor ?? "KHS"})`);
    break;
  }
  case "cancel": {
    const [id] = args as [string];
    const res = await tasks.updateOne(
      { _id: id as never, cancelRequestedAt: null },
      { $set: { cancelRequestedAt: now, wakeRequestedAt: null, editModeRequestedAt: null, state: "closed", notificationState: "closed", updatedAt: now } },
    );
    console.log(`cancel ${id}: ${res.modifiedCount ? "requested" : "not applied"}`);
    break;
  }
  case "follow-up": {
    const [id, subId, prompt] = args as [string, string, string];
    await subTasks.insertOne({ _id: subId as never, taskId: id, type: "thread_instruction", prompt, state: "pending", ackPostIds: [], createdAt: now, updatedAt: now });
    // requestWake's last branch: idle_stopped/failed → failed + wake
    const res = await tasks.updateOne(
      { _id: id as never, cancelRequestedAt: null, runtimeState: { $in: ["idle_stopped", "failed", null] } },
      { $set: { runtimeState: "failed", runtimeStartFailures: 0, runtimeRetryAfter: null, wakeRequestedAt: now, lastExternalActivityAt: now, lastMeaningfulActivityAt: now, idleStoppedAt: null, updatedAt: now } },
    );
    console.log(`follow-up ${subId} on ${id}: ${res.modifiedCount ? "woken" : "not woken"}`);
    break;
  }
  case "show": {
    const [id] = args as [string];
    const t = await tasks.findOne({ _id: id as never }, { projection: { prompt: 0, taskRepositories: 0 } });
    const subs = await subTasks.find({ taskId: id }, { projection: { state: 1, type: 1, reply: 1, errorMessage: 1, repliedInChat: 1 } }).toArray();
    console.log(JSON.stringify({ task: t, subTasks: subs }, null, 1));
    break;
  }
  case "delete": {
    const [id] = args as [string];
    await tasks.deleteOne({ _id: id as never });
    await subTasks.deleteMany({ taskId: id });
    console.log(`deleted ${id}`);
    break;
  }
  default:
    console.error("usage: devstand.ts mark-channel|unmark-channel|insert|cancel|follow-up|show|delete …");
    process.exitCode = 1;
}
await client.close();
