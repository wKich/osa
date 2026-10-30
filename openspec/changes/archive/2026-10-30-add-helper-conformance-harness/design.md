# Design

## Context

See `proposal.md` - Why.

The current suite already has the right shape for this: `tests/run-tests.sh`
creates one directory per case (`new_case`), points the stub `openshell` at a
per-case `STUB_LOG` and `STUB_STATE_DIR`, and asserts exit code, stdout/stderr,
and files under the case directory. The stub already writes argv to `STUB_LOG`,
one argument per line, invocations separated by `---`.

What is missing is not observation, it is **indirection and durability**: cases
resolve `$MAKI`, `$OC`, `$CLAUDE`, `$CODEX` from fixed repository paths, and the
expected argv lives only in shell assertions scattered through an 11k-line file.

Constraints that shape the design:

- `make test` must stay POSIX-sh-only; the conformance suite is part of that
  class and must not need `bun` even after it joins `make test-all`.
- The stub `openshell` is the only seam; there is no gateway in the test path.
- Credentials must never be observable, so a recording that captured
  environment values would itself become a leak surface.
- Cases are long-lived and numerous; a harness that forces rewriting them is
  not worth having.

## Goals / Non-Goals

**Goals:**

- One case set, selectable backend, no case-body duplication.
- A recorded, diffable artifact of what crossed the seam.
- A parity verdict that a migration can cite per case.
- Zero new host dependency for the gate.

**Non-Goals:**

- Recording or asserting internal structure (function names, call order inside
  a single process).
- Replacing the existing per-case assertions. The harness adds a layer; it does
  not restructure the suite.
- Coverage measurement or mutation testing.
- A gateway-backed or Docker-backed mode. Offline only.

## Decisions

### D1. Backend selection by environment, resolved in one place

Four variables — `OSA_BACKEND_MAKI`, `OSA_BACKEND_OPENCODE`,
`OSA_BACKEND_CLAUDE`, `OSA_BACKEND_CODEX` — each holding a command path or an
argv prefix (space-separated). `tests/run-tests.sh` resolves `$MAKI`, `$OC`,
`$CLAUDE`, `$CODEX` from them at startup, defaulting to the current `bin/`
paths. A case that needs to see the raw prefix (to assert argv ordering) uses
the resolved variable, not the literal.

*Alternative rejected:* a `--backend` flag threaded into each case. It edits
every case body and makes the default path diverge from the tested path.

*Alternative rejected:* a symlink farm that shadows `bin/` on `PATH`. It cannot
express an argv prefix (a Rust binary plus a subcommand), which is exactly the
shape a migration needs.

### D2. Invocation recording extends the existing `STUB_LOG` format

The stub appends, after each invocation's argv lines, zero or more
`@env NAME` lines naming the variables present in the child environment's
allow-list, then the existing `---` separator. Recordings are the stub log with
absolute paths rewritten to `<case>`-relative form and with known-nondeterministic
values (temp paths, timestamps, sandbox IDs) replaced by stable tokens.

*Why not a new capture mechanism:* the stub already records argv; adding two
lines of grammar is a smaller change than a second tap, and it keeps the
recording meaningful when a human reads the log by hand.

*Why env names and not values:* the helper passes credentials only through the
child environment (`helper-cli` requirement on credential delivery). Recording
values would turn the artifact into the leak it is supposed to detect. Names are
enough to detect "a new variable appeared" and "a variable stopped being
passed", and the secret-leak case covers values directly.

### D3. Goldens live beside the harness, one file per case, selected by name

`tests/conformance/golden/<case>.log`. A case opts in by having a golden file;
no golden means record-only. Record mode (`OSA_CONFORMANCE_RECORD=1`) rewrites
goldens and lists them; a normal run never writes.

*Why not a single golden file for the whole suite:* per-case files keep a diff
readable and let a case own its contract, and they let a migration land one case
at a time.

### D4. State assertions stay explicit; parity compares a digest

Per-case assertions keep asserting named fields (`e_phase`, marker kind, lock
presence) so a failure names the field. Parity mode additionally captures a
normalized state digest — a sorted listing of state-root-relative paths, each
with a hash for file contents — so two backends can be compared without
enumerating every field twice.

*Alternative rejected:* snapshot state as a golden. It duplicates D3, goes stale
on every unrelated field, and buries the field name in a diff.

### D5. Harness is POSIX `sh`, invoked as a mode of the existing suite

`tests/conformance/harness.sh` is sourced by `tests/run-tests.sh` and adds three
modes: default (run + compare), `OSA_CONFORMANCE_RECORD=1` (run + write
goldens), `OSA_CONFORMANCE_PARITY=<second backend set>` (run twice into two
artifact trees then compare). `make test-conformance` runs the first;
`make test-parity` is not added — parity is a manual, documented invocation.

*Why not a Node/Bun harness:* it would put `bun` in the gate's path, which the
`test-gate` delta forbids.

*Why not Python:* no better than `sh` for `diff -u` and state listings, and it
adds a dependency the host playbook does not otherwise require.

### D6. The leak case needs a backend that leaks

A deliberately broken backend (`tests/conformance/backends/leaky.sh`) wraps the
real front-end and moves the fixture credential from the environment into argv.
The case asserts the harness *catches* it. A negative test that cannot fail is
not a gate.

### D7. Parity runs the whole set and reports every case

Divergence does not abort the run; the harness records a verdict per case and
exits non-zero at the end. A migration wants the complete divergence list, not
the first one.

## Risks / Trade-offs

- **Golden brittleness** (an unrelated change rewrites 40 files) → recordings
  are restricted to argv and env names, with absolute paths and IDs normalized;
  record mode makes the update one command and the diff reviewable.
- **A case asserting an implementation detail becomes a migration brake** →
  review rule for this suite: a golden may only contain data that crosses a
  process boundary. Anything else belongs in a per-case assertion.
- **Parity mode doubles wall-clock time** → allowed to be slow; it is not in
  `make test-all`.
- **Lock-presence assertions can flake on a loaded machine** → the harness
  polls with a bounded retry window instead of a single `test -f`.
- **The recording normalizer itself hides a real change** (over-broad
  substitution) → the substitution set is closed and enumerated in one function,
  and a self-test asserts that a changed argv still differs after normalization.
- **`run-tests.sh` grows another mode in an already large file** → the driver
  and normalizer live in `tests/conformance/`, leaving `run-tests.sh` with the
  resolution hook and the mode dispatch only.

## Migration Plan

1. Land the harness with backend defaults unchanged; `make test` behavior and
   output are identical apart from new mode flags.
2. Record goldens for the existing cases in reviewed batches (not one giant
   commit), so each batch's diff is inspectable.
3. Add the target to `make test-conformance` and wire it into `make test-all`.
4. Rollback: removing the target and the four `OSA_BACKEND_*` resolutions
   restores today's suite exactly. No helper code is touched.

## Open Questions

None that affect the specs or the task breakdown. Whether parity mode should
later run against a third backend, or per-command rather than per-front-end, can
be answered when a second implementation actually exists.
