# Proposal

## Why

The final journey-parity verification ran `make test-bridge` with one failure:
`session-isolation.test.ts:117` ("deleting one session kills only its own
child and spares the other") saw the second session's child already gone.
It passes alone and on re-run. The test takes the bridge's direct children
(`pgrep -P`) as the two scripted Maki children, but the bridge's short-lived
sandbox reads (`sandboxRun` in `src/sandbox.ts`: skills scan, git) are direct
children too. Under load one of them is still running when the test samples,
so `pidB` is a helper that exits on its own, not the second session's child.

## What Changes

- `bridge/test/session-isolation.test.ts` picks only the scripted Maki
  children (`pgrep -P <bridge> -f fake-maki`).

## Impact

Test only. No change to the bridge, the journey harness, `statuses.json`,
`journeys.json`, `defects.json` or specs.
