# Proposal

## Why

The host boundary gate cannot produce a verdict on the current tree. Running
`tests/boundary/gate.sh --sandbox <name>` stops at part 1/3: `scripts/test-all.sh`
reports 322 passed, 8 failed, and every failure is an idle-stop case. The record
it prints says `checks: none recorded`, `verdict: failed`, so the isolation
checks and the live journey run never run, and no boundary record can be written
to `docs/verification-log.md`.

Two causes remain behind those 8 failures:

- **Stale goldens (7 cases).** The typed-client conversion made the idle path
  discover its endpoint and read the sandbox over the gateway
  (`openshell gateway info --output json`, then `sandbox get --output json`).
  The committed idle goldens predate that and differ only by those recorded
  operations and a moved environment block.
- **A fake-gateway fidelity gap (1 case).** The idle watcher answers its probe
  with `sh -c <script> <profile>-idle`. The fake gateway classifies a scripted
  exec as internal only when the label ends in `-git` or `-run`, so the idle
  probe is treated as an agent command: the case's canned answer and failure
  fixture never apply, the watcher records `scan-failed`, and the
  `stop-failed` path is never exercised. The case fails even after a re-record.

The boundary layer itself is implemented and archived; it is unverifiable only
because the suite it composes is red.

## What Changes

- The fake gateway SHALL treat a scripted exec as a helper-internal probe by its
  invocation shape — `sh -c <script> <label>` — rather than by the two labels
  today's code happens to emit, so every internal script, including the idle
  scan, sees the same `exec.cases`, `exec.fail`, `exec.stdout`, `exec.exit`,
  stdin, tools, and git-trace fixtures the CLI stub receives.
- Add a unit test in `stub-gateway` that runs the idle probe over the fake
  gateway and asserts the case answer and the failure fixture both apply, and
  one that asserts an agent command (`maki -p …`) is still handled as an agent
  run, not as an internal script.
- Re-record the 7 idle goldens and review the diff: it must contain only the
  discovery operations and environment-block ordering, with no credential-like
  value and no case that needed an exclusion.
- Verify the gate end to end on a host: `make test`, `make test-conformance`
  (strict), then `make test-boundary` with `OSKHS_TEST_MONGO_URI` set and a
  verification sandbox holding a provider; copy the printed record into
  `docs/verification-log.md`.

**Non-goals:** no product behavior change, no new isolation check, no change to
the gate's command set, verdicts, or patch handoff, and no frontier change to
what any layer claims.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `gateway-client`: the requirement "Both transports see one fixture" is
  extended so the fake gateway applies the per-run exec fixtures to
  helper-internal scripts, not only to agent commands, and so a probe whose
  answer a case supplied cannot silently fall back to a default that changes the
  helper's own control flow.

## Impact

- `osa-core/crates/stub-gateway/src/lib.rs` — internal-script classification and
  its unit tests.
- `tests/conformance/golden/client/` — 7 idle goldens re-recorded after review.
- `docs/verification-log.md` — the boundary record of the verified gate run.
- No change under `examples/`, `bin/`, or any policy; no new endpoint,
  credential, or egress rule. The sandbox remains the only boundary.
