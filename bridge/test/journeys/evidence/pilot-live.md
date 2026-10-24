# Pilot live runs (tasks 4.1 and 4.2)

`make test-journeys-live` on 2026-10-24, gateway OpenShell 0.1.5, image
`sha256:7822b202e99387bbf2f07ea23e2b109b64d10188fbde336a0b166e28cc4b4a16`
(`maki-agent:local`), Maki 0.6.4. Both runs exited 0.

## Isolation during the run

The run created one `maki-oss-journeys-*` sandbox from the project image with
`examples/policies/maki-minimal.yaml`, no `--provider`, no `--env`, and deleted
it when the run ended. `openshell policy get <name> --full` captured while that
sandbox was alive is [`policy-during-live-run.txt`](policy-during-live-run.txt):
its hash is `6e5fffafe200cc9971c4dee34f634533042cf6f4f3ebfddf491bf79557cdfca2`
and its body is the minimal policy (the only differences from
`examples/policies/maki-minimal.yaml` are comments), with no provider rules
and no added network egress. `openshell sandbox list --names` after the run
shows no `maki-oss-journeys-*` sandbox.

## Verdicts

| Journey | Offline | Live | Live evidence |
| --- | --- | --- | --- |
| `send-prompt-stream-reply` | `diverges` | `diverges` | `send-prompt-stream-reply/live/`, `live-diff.json` |
| `allow-permission-once` | `diverges` | `broken` | `allow-permission-once/live/`, `live-diff.json` |
| `resume-session-history` | `broken` | `broken` | `resume-session-history/live/`, `live-diff.json` |

The live request logs are committed beside the snapshots as
`<slug>/live-maki-requests.jsonl` and join the measured route set in
`crosscheck.test.ts`.

## Reproducibility (task 4.2)

A second `make test-journeys-live` produced byte-identical live snapshots and
comparisons:

```
9b0a740394200c3b01bfc305cffbefea0eca5eff  allow-permission-once/live/permission-prompt.txt
d7abbb793bda51a958becdb2ba74c6ff65e2502e  resume-session-history/live/session-list.txt
6f4c05986ada8a84d4ea0c9572528c572f2be9d1  send-prompt-stream-reply/live/streamed.txt
034d8ceb33ed89a0e58a623075311d78048216ea  send-prompt-stream-reply/live/user-message.txt
1c5da6fff07a7e589c6fff1b4317097b9330fcf7  allow-permission-once/live-diff.json
d04bc70af1683fdc723ba6fcd90bd5a88484c6d6  resume-session-history/live-diff.json
e21d817e77abf4e7a9a84bb5fba15e1c30843f1e  send-prompt-stream-reply/live-diff.json
```

## Triage

### `send-prompt-stream-reply` (live equals offline)

The two remaining differences are the offline run's existing hand-offs:
session-title generation (the Maki tab shows the `New session` fallback instead
of the generated title) and transcript order (the reply renders above the
submitted user message). No new finding.

### `resume-session-history` (live equals offline)

`history-visible` is unreached on the live side too; the offline hand-off
(session message history behind `GET /api/session/{sessionID}/message`) already
covers it. No new finding.

### `allow-permission-once` (live `broken`, worse than offline `diverges`)

The permission dialog was reached and answered exactly as the reference: the
live snapshot `live/permission-prompt.txt` shows the same dialog chrome and
choices, with the same tool-label difference the offline run records. The turn
then failed, so `allowed` is unreached.

1. **Every bash tool call fails under the minimal policy.** Maki's bash plugin
   starts jobs with `stdin(Stdio::null())` (`maki-lua/src/api/fn.rs:299` at
   v0.6.4), and the minimal policy's filesystem rules do not include
   `/dev/null`, so the spawn fails with `Permission denied (os error 13)`.
   The bridge emitted `session.tool.failed` with exactly that message.
   Hand-off: a security-reviewed policy change to admit `/dev/null`, outside
   this change. The proposal's risk rule is explicit: do not relax the policy
   inside `add-journey-live-run`; report the observed denial instead.
2. **The TUI transcript never updates after the failed tool.** The bridge
   emitted `session.tool.failed` (and the following text/step frames), but the
   `session.tool.failed` payload carries only `id` and `error`. The pinned
   event type requires `executed: boolean` (and allows `content`), so the
   client cannot apply the frame and the running spinner stays
   (`packages/client/src/effect/api/api.ts` v2.0.32, `session.tool.failed`;
   bridge emission at `bridge/src/translator.ts:266`). Hand-off: a
   `proposing-fix-change` defect entry for the `session.tool.failed` payload,
   plus a live-render test for a failed tool. The offline suite misses this
   because its permission tool succeeds; the live run is the only one that
   fails a tool.
