# Design

## Context

See `proposal.md` — Why. Current state the design must work with:

- The helper sends every internal probe as `sh -c <script> <label>`, where the
  label is `<profile>-<purpose>`: `<profile>-git` (sync scripts),
  `<profile>-run` (the agent wrapper), `<profile>-idle` (the idle scan). Agent
  runs are not shell scripts — their argv starts with the agent binary.
- The fake gateway (`osa-core/crates/stub-gateway`) already reads the per-run
  fixture channel (`exec.cases`, `exec.fail`, `exec.stdout`, `exec.exit`,
  `exec.stdin-log`, `exec.tools`, `exec.git-trace`) from the case's state root,
  written by `run_maki_with_input`.
- Today's classification in `stub-gateway` is a two-suffix check
  (`-git`, `-run`), so the idle probe falls through to the agent path and gets
  the default canned output. The watcher then records `scan-failed` and never
  reaches `stop_sandbox`, which is the event the failing case asserts.
- Conformance goldens for seven idle cases predate the typed-client discovery
  pair (`gateway info --output json`, `sandbox get --output json`) that the idle
  path now performs.

## Goals / Non-Goals

**Goals:**

- One classification rule in the fake gateway that covers every internal probe,
  present and future, so a fixture-driven case behaves identically over both
  transports.
- Goldens that reflect the real, reviewed idle-path transcript.
- A boundary record produced from an actual gate run.

**Non-Goals:**

- No change to the helper's probe scripts, labels, or control flow.
- No new fixture channel, no new request field, no helper-visible behavior.
- No relaxation of the gate: if a part fails, it still fails.

## Decisions

### D1. Classify by invocation shape, not by label suffix

The fake gateway SHALL treat a request as an internal script when its command is
`sh` with `-c`, a script argument, and the helper's label argument — i.e. the
shape every probe already uses — instead of checking `-git`/`-run`.

*Why:* the missing label was the entire defect. A suffix allowlist makes the
next probe (a new purpose, or a renamed profile) repeat it silently, and the
failure surfaces as a confusing `scan-failed`/`closed` event rather than a test
failure.

*Alternative rejected:* add `-idle` to the suffix list. It fixes today's case
and leaves the trap. Also rejected: pass an explicit "internal" flag on the
request, which would change the wire for a test-double concern.

### D2. Keep the fixture channel unchanged

The fixtures already reach the fake gateway through the state-root files the CLI
stub reads. The defect is where the gateway decides to consult them, not how
they travel.

*Why:* the channel is specified by `gateway-client` ("Both transports see one
fixture") and has credential-scan coverage; touching it would widen the change
for no behavioral gain.

### D3. Re-record goldens under review, never blindly

Re-record only the idle set, then read the diff. A legitimate diff contains the
discovery pair and environment-block ordering and nothing else — no changed
exit status, no changed assertion line, no new exclusion.

*Why:* re-recording is how the suite accepts a deliberate transport change, but
it is also how a real regression gets hidden. The review rule is the control.

*Alternative rejected:* hand-editing the goldens. The transcript is generated;
a hand edit would not be reproduced by a later run.

### D4. Verify in layers, record last

1. `cargo test -p stub-gateway` — the classification and fixture scenarios.
2. `RUN_ONLY='*idle*' tests/run-tests.sh` — the idle set green with the
   committed goldens.
3. `make test` and `make test-conformance` (strict) — no other golden moved.
4. `make test-boundary BOUNDARY_ARGS='--sandbox <name>'` with
   `OSKHS_TEST_MONGO_URI` set and a verification sandbox holding a provider —
   all three parts run, exit 0.
5. Copy the printed boundary record into `docs/verification-log.md`.

*Why:* each layer catches a different failure; the record is evidence only after
the gate has actually completed all three parts.

## Risks / Trade-offs

- **Over-broad classification swallows an agent run** → the shape rule requires
  the shell form; a unit test asserts `maki -p …` stays an agent run, and the
  conformance suite would fail on every session case if it did not.
- **A default masks a missing fixture** → the spec requires a probe with no case
  fixture to fall back identically on both transports, and the idle case asserts
  the answer it supplied, not just a successful exit.
- **A green gate is cited as more than it proves** → the gate's record and
  `docs/ai/verification/claims.md` keep the boundary layer scoped; the record
  names only what ran, and an incomplete run still cannot read as a pass.
- **Re-recording hides a regression** → D3's diff review plus steps 1–3 of D4.

## Migration Plan

No deployed surface changes: the fix is a test double plus goldens. Land the
stub change and its unit test, re-record and review the idle goldens in the same
commit, then run the gate on a host and add the record. Rollback is a revert;
goldens come back with the same commit, so no state migration is needed.

## Open Questions

None.
