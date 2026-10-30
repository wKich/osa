# Proposal

## Why

The helper's contract with OpenShell — the argv it builds, the exit codes and
JSON it reads back, the registry and marker files it writes — is pinned today
only by hand-written assertions inside `tests/run-tests.sh`. Those assertions
name `bin/maki-oss` and friends directly, so they cannot answer the question a
migration needs answered: *does a second implementation of the helper produce
the same observable behavior?*

Before any part of the helper moves to another language, the contract needs to
be a recorded, backend-neutral artifact. Otherwise "behavior preserved" is a
claim made by reading a diff, not by running the new binary through the same
cases.

## What Changes

- Add a conformance harness under `tests/conformance/` that runs one unmodified
  case set against a **selectable backend** (an executable or argv prefix),
  defaulting to the current `bin/` front-ends.
- Record every `openshell` invocation the stub sees as argv plus child
  environment **key names only**, and diff it against a committed golden file
  per case when the case has one.
- Add a secret-leak case: fixture credential values must never appear in a
  recorded argv, in a helper-written file, or in stdout.
- Add `make test-conformance`, and include it in `make test-all` so the
  repository has one gate.
- Add a parity mode that runs the case set against two backends and reports
  per-case divergence, so a swapped implementation is verified case by case.

Non-goal: this change does not move any helper code. It only makes the seam
executable and recorded.

## Capabilities

### New Capabilities

- `helper-conformance`: the backend-neutral contract test for the helper ↔
  OpenShell seam: case selection, invocation recording, golden comparison,
  secret-leak assertion, state-tree assertion, and two-backend parity.

### Modified Capabilities

- `test-gate`: `make test-all` additionally runs the conformance suite, and
  `make test-conformance` becomes part of the documented gate.

## Impact

- New: `tests/conformance/` (driver, case set, `golden/` fixtures), one
  `Makefile` target, one CI wiring change.
- Modified: `tests/run-tests.sh` gains a backend indirection so cases resolve
  the helper through a variable instead of a hard-coded path. Existing cases
  keep their assertions and their meaning.
- Unaffected: `bin/`, `lib/`, the sandbox image, the security invariants. No
  new host dependency; the harness needs only POSIX `sh` and the existing stub
  binaries.
- Risk: a case set that asserts implementation details becomes a brake on
  later work. Mitigated by constraining recorded data to argv, exit codes,
  stdout/stderr, and the state tree, and never to internal function calls.
