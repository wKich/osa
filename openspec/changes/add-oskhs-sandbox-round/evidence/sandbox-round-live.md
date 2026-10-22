# Live exit for add-oskhs-sandbox-round (B1.3c)

Recorded 2026-10-23: kiss local stack (branch `feat/oskhs-executor-marker`),
channel `kiss-local-test` marked `executor: oskhs`, local OpenShell gateway,
`maki-synthetic` provider attached by hand, model
`synthetic/hf:deepseek-ai/DeepSeek-V4.1-Flash-1017`. Bare mirrors made by
hand over the developer's SSH key:
`<mirrors>/dmitry.lazarev/kiss.git` (23 MB) and
`<mirrors>/dmitry.lazarev/ascii-minecraft-mimo-2.6-pro.git` (3.4 MB). The
inbound task was written as kiss's Mattermost source writes it, on a real
thread root of the channel (see the B1.3b evidence for why).

```sh
bun oskhs/src/cli.ts worker --once --mirror-dir <mirrors> --provider maki-synthetic \
  --model synthetic/hf:deepseek-ai/DeepSeek-V4.1-Flash-1017 --agent-name svc_kiss --round-timeout 300
```

## 3.1 A question answered by Maki in the sandbox, posted by kiss

Task `o13c0001`: «В репозитории ascii-minecraft: на каком языке написан проект
и что делает скрипт run.sh? Ответь кратко.»

```
oskhs: worker oskhs-dev started (sandbox round, rounds ≤ 2, per project ≤ 1, logs in /private/tmp/claude-501/-Users-ki-Projects-experiments-maki-openshell/7e4fe520-d211-4ca5-9b59-c153881fdbb1/scratchpad/state/oskhs/tasks)
oskhs: creating sandbox repo-kiss-local
oskhs: sync repo-kiss-local/dmitry.lazarev_kiss: 12556449 bytes, 1 updated, 0 pruned
oskhs: sync repo-kiss-local/dmitry.lazarev_ascii-minecraft-mimo-2.6-pro: 3482593 bytes, 1 updated, 0 pruned
oskhs: round o13c0001 in repo-kiss-local:/sandbox/tasks/o13c0001 (dmitry.lazarev_kiss, dmitry.lazarev_ascii-minecraft-mimo-2.6-pro)
{"ts":"2026-10-22T21:53:27.596Z","event":"claimed","state":"processing","runtimeState":"running"}
{"ts":"2026-10-22T21:53:27.599Z","event":"round-start","timeoutSec":300}
{"ts":"2026-10-22T21:53:38.159Z","event":"round-end","ok":true,"chars":501}
{"ts":"2026-10-22T21:53:38.162Z","event":"idle"}
```

`replyMessage` (the `Reply` field of Maki's `[RESULT]` block):

> Проект написан на **Rust** (edition 2021; сборка через Cargo, есть крейты
> `cdylib`/`rlib` и wasm-сборка для браузера). Скрипт `run.sh` — это лаунчер:
> … собирает релизный бинарник (`cargo build --release`) и запускает
> `target/release/ascii-minecraft`, передавая ему все аргументы.

Checked against the mirror: `Cargo.toml` and `run.sh` match. Orchestrator:

```
[task-notifier]: ✅ Task o13c0001: completed notification sent
```

The first round seeded both repositories in one go (12.6 MB + 3.5 MB
bundles); round wall time 10.6 s, total 12.1 s.

## 3.2 No secrets in the sandbox; kiss-mongo unreachable

Credential-like variables in `repo-kiss-local`, classified inside the
sandbox (names and classes only left it):

```
env SYNTHETIC_API_KEY stand-in
```

No Mongo, GitLab, or database variable exists.

Effective policy (`openshell policy get repo-kiss-local --full`), network
part: a single rule `_provider_maki_synthetic` — `api.synthetic.new:443`,
binary `/usr/local/bin/maki`. Nothing else is allowed (deny-by-default), so
no process in the sandbox can reach the kiss MongoDB. Direct probes agree:

```
TCP 192.168.117.2:27017 (kiss-mongo-1 on kiss-net)  refused/blocked
TCP host.docker.internal:27017                       refused/blocked
TCP 172.17.0.1:27017                                 refused/blocked
TCP kiss-mongo-1:27017                               refused/blocked
curl http://192.168.117.2:27017                      000
```

Raw TCP from `bash` is blocked even to the allowed model host (the rule is
bound to the `maki` binary), so the probes alone would not prove much; the
policy is the authoritative check and the round itself shows `maki`'s one
allowed endpoint works.

## Cancel of a real round (found and fixed during this exit)

First attempt: after a cancel the worker released the task, but Maki and
its `sleep 120` kept running and the workspace stayed. Two causes:

1. A separate `openshell sandbox exec` cannot read the run's
   `/proc/<pid>/environ` (permission denied for the same uid: each exec is
   its own isolation domain; signals and `cmdline` do cross). The kill-by-tag
   sweep therefore found nothing. Fix: maki-oss's timeout wrapper watches
   `/tmp/maki-oss-stop/<tag>` and stops the run from inside its own domain;
   oskhs creates that file on abort.
2. The worker stopped waiting for the round on abort, so with `--once` the
   process exited before cleanup. Fix: an aborted round gets
   `--abort-grace-sec` (30 s) to finish.

Second attempt (`o13c0003`, Maki told to run `sleep 120`; cancel written
as kiss's `cancelTask` writes it once `sleep` was running):

```
{"ts":"2026-10-22T22:00:27.644Z","event":"claimed","state":"processing","runtimeState":"running"}
{"ts":"2026-10-22T22:00:27.647Z","event":"round-start","timeoutSec":300}
{"ts":"2026-10-22T22:00:34.547Z","event":"round-end","ok":false,"error":"aborted"}
{"ts":"2026-10-22T22:00:34.549Z","event":"cancelled"}
maki/sleep processes left: 0
tasks dir: []
```

Task: `state: closed`, `runtimeState: idle_stopped`, `cancelledAt` set, no
`replyMessage`. The helper-level check (no oskhs): a `run --timeout 300`
with `MAKI_OSS_RUN_TAG=stoptest1` returned 1 s after the stop file appeared
(exit 143) with nothing left; a plain `--timeout 8` run still ends with 124
and nothing left.
