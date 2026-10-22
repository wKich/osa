# Live exit for add-oskhs-task-worker (B1.3b)

Recorded 2026-10-23 against the kiss local stack (`scripts/start-local.sh`)
rebuilt from kiss branch `feat/oskhs-executor-marker`; real Mattermost
(`chat.skbkontur.ru`, private dev channel `kiss-local-test`). Worker:
`OSKHS_MONGO_URI=mongodb://127.0.0.1:27017/kiss-agent OSKHS_HOST_ID=oskhs-dev
bun oskhs/src/cli.ts worker …`, task logs under a scratch `XDG_STATE_HOME`.

**How the inbound message was produced.** No human Mattermost credential is
available to this session, so the channel was marked
(`devstand.ts mark-channel`) and each task was written as
`MattermostTaskSource` + `AgentRuntimeService.startTask` write it
(`devstand.ts insert`), on the real root post of an earlier thread in that
channel (`f996kcch…`, `suppressRootStatusReactions: true` so the old root's
reactions stay). Everything after that is real: oskhs's claim, kiss's status
sync, and kiss posting into the Mattermost thread. A human-sent message
exercises the same path from `MattermostTaskSource.buildTaskContext`
(executor resolution, unit-tested in kiss B1.3a).

## 3.1 Echo reply posted by kiss

`o13b0001`: worker → `state: completed`, `replyMessage: "echo: Ping from the
oskhs B1.3b live check"`, `runtimeState: idle_stopped`, `agentHostId:
oskhs-dev`. Orchestrator, 3 s later:

```
[sync:notifications]: Task o13b0001: state=completed, notificationState=loading, sourceMessageId=f996kcch178498wyyymcfpzi3w
[task-notifier]: ✅ Task o13b0001: completed notification sent
```

## 3.2 Cancel mid-round

`o13b0002` with `--fake-delay 60`; after `round-start`, the fields kiss's
`cancelTask` writes (`devstand.ts cancel`). Ended in ~3 s (cancel poll):

```
{"ts":"2026-10-22T21:30:14.767Z","event":"claimed","state":"processing","runtimeState":"running"}
{"ts":"2026-10-22T21:30:14.769Z","event":"round-start","timeoutSec":600}
{"ts":"2026-10-22T21:30:17.773Z","event":"round-end","ok":false,"error":"aborted"}
{"ts":"2026-10-22T21:30:17.775Z","event":"cancelled"}
```

Final: `state: closed`, `notificationState: closed`, `runtimeState:
idle_stopped`, `cancelledAt` set, `wakeRequestedAt: null`, no `replyMessage`.

## 3.3 SIGKILL mid-round, restart

`o13b0003`: worker killed with `kill -9` during the round (task left
`running`, `agentHostId: oskhs-dev`); a new worker with the same host id:

```
oskhs: recovered task o13b0003 (lost rounds: 1)
{"ts":"2026-10-22T21:30:30.557Z","event":"claimed","state":"processing","runtimeState":"running"}
{"ts":"2026-10-22T21:30:30.560Z","event":"round-start","timeoutSec":600}
{"ts":"2026-10-22T21:30:30.956Z","event":"recovered","action":"requeued","lost":1}
{"ts":"2026-10-22T21:30:30.959Z","event":"claimed","state":"processing","runtimeState":"running"}
{"ts":"2026-10-22T21:30:30.961Z","event":"round-start","timeoutSec":600}
{"ts":"2026-10-22T21:30:31.962Z","event":"round-end","ok":true,"chars":38}
{"ts":"2026-10-22T21:30:31.965Z","event":"idle"}
```

Final: `completed`, `idle_stopped`, `runtimeStartFailures: 0`, reply set.

## 3.4 Follow-up sub-task

`devstand.ts follow-up o13b0001 …` (a `thread_instruction` sub-task plus
`requestWake`'s update). Worker answered it; kiss posted it:

```
sub-task: state completed, reply "echo: And a follow-up question?", repliedInChat true
[sync:notifications]: 🧵 Subtask o13b0001-s1: reply posted and marked as replied
```

The parent stayed `completed` and went back to `idle_stopped`.
