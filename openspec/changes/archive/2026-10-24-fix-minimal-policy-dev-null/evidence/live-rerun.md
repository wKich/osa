# Live re-run with `/dev/null` (2026-10-24)

`bun bridge/test/journeys/harness/live.ts allow-permission-once`, OpenShell
0.1.5, Maki 0.6.4, image `maki-agent:local`, no `--provider`, no `--env`.

- [`policy-during-live-run.txt`](policy-during-live-run.txt): the effective
  policy captured while the journey sandbox was alive — the minimal policy
  plus `/dev/null` read-write, no network rule, no provider rule.
- `bridge/test/journeys/allow-permission-once/live/allowed.txt`: the bash
  call now runs; Maki reports `Exit code: 0` (before: `error: Permission
  denied (os error 13)`), the same text the offline scripted child produces.

Remaining live-only difference: the footer context counter (`4` live vs `2`
reference) — the bridge reports the run's cumulative usage as the last
step's tokens. Handed to its own fix change (`step-tokens-cumulative`).
