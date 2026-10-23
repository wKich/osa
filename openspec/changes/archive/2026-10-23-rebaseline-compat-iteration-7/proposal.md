# Proposal

## Why

The route-queue burndown landed seven changes after discovery pass 6. A fresh
pass must confirm the result against the pins, and the copied matrices still
show the iteration-6 rows as `unverified`.

## What Changes

- Run the discovery passes and record them in `evidence/discovery-log.md`.
- Copy the matrices forward from `rebaseline-compat-iteration-6`, refreshing
  the nine stale cross-map rows, marked **(i7)**.

## Impact

Evidence only, plus the TUI captures `make test-ui` rewrites. No change to
`statuses.json`, `defects.json`, tests, runtime or specs.
