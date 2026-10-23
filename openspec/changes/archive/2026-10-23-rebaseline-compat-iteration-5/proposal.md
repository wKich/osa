# Proposal

## Why

The iteration-4 record closed the burndown for the current pin. A fresh
discovery pass must still confirm the result against pinned upstream rather
than trust the record. That re-read found the matrices lagging `statuses.json`
in three places: API retry visibility (verified, but recorded as never mapped),
the SDK handshake (out of scope, but recorded as unverified), and message
replay (an out-of-scope deferred route, but recorded as unverified).

## What Changes

- Copy the four matrices forward from `rebaseline-compat-iteration-4` and
  refresh the stale rows, marked **(i5)**.
- Record the iteration-5 enumeration, findings and triage in
  `evidence/cross-map.md` and the passes and scoreboard in
  `evidence/discovery-log.md`.

## Impact

Evidence only. `bridge/compat/statuses.json`, `bridge/defects.json`, tests,
runtime and specs are unchanged.
