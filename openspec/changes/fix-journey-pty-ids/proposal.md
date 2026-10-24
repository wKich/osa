# Proposal

## Why

Recording `open-terminal-pane` logged literal `pty_…` path segments
(`/api/experimental/persistent-pty/pty_…/snapshot`), so the terminal routes
would enter the measured route set as paths outside the contract.

## What Changes

- Journey request logs name `pty_…` path segments `{ptyID}`.

## Capabilities

### Modified Capabilities

- `tui-journey-parity`: the reproducibility requirement lists `{ptyID}`.

## Impact

`bridge/test/journeys/harness/record.ts` and its test. No committed log
carries a PTY id yet; no bridge runtime change.
