# Helper conformance harness

The suite in `tests/run-tests.sh` exercises the four front-ends against the
stub `openshell`. This directory adds a recorded contract on top of those cases,
so a second implementation of the helper can be run through the same case set
and compared with the current one.

## What is recorded

For every case the harness writes an artifact directory containing:

- `recording.log` — every stub `openshell` invocation as normalized argv, with
  `@env NAME` lines naming the front-end setting variables and the credential
  variables the case declared. Names only, never values.
- `state.digest` — sorted state-root-relative paths with a hash per field, so a
  changed registry field can be named without printing its value.
- `output.log` — the exit status and stdout/stderr of every backend run.
- `meta` — the final exit status.

Artifacts go under `$WORK/conformance` by default; set
`OSA_CONFORMANCE_ARTIFACTS=<dir>` to keep them, and `KEEP_WORK=1` to keep the
whole case tree.

## Modes

| Mode | How | Effect |
| --- | --- | --- |
| default | `make test` / `tests/run-tests.sh` | run every case, compare the goldens that exist, report unrecorded cases |
| strict | `make test-conformance` | same, but an unrecorded case not in `excluded.txt` fails |
| record | `OSA_CONFORMANCE_RECORD=1 make test` | rewrite goldens and list each written file; the only mode that writes |
| parity | `tests/conformance/harness.sh parity` | run the case set twice into two artifact trees and print one verdict per case |
| self-test | `make test-conformance-self` | prove the normalizer cannot hide a real change and the leak scan catches a leak |

`OSA_CONFORMANCE=0` disables the harness for a debugging run.
`OSA_CONFORMANCE_COMPARE=0` records without comparing.

## Goldens and the review rule

Goldens live in `golden/<test function>__<case>.log`, one file per case. A case
with no golden is recorded but not compared; `excluded.txt` lists the cases
that intentionally have none and why. The suite prints how many cases were
unrecorded and how many were excluded at the end of a run.

A golden may only contain data that crosses a process boundary — the argv and
environment names the stub saw. Anything else (internal call order, log text,
timings) belongs in the case body's own assertion. Normalization is closed and
enumerated in `normalize.sh`: only case/work/repo paths, timestamps, epoch
values, sandbox ids, commit ids, caller keys, and pids are replaced. Never add
a broad substitution to make a flaky golden pass; fix the case or exclude it
with a reason.

The recording rule also means `@env` lines are names, not values. If a case
needs to observe a value, it asserts it through the helper's output, never
through the recording.

## Selecting a backend

The `osa` command and each front-end resolve from one variable at the top of
`tests/run-tests.sh`:

- `OSA_BACKEND_OSA`
- `OSA_BACKEND_MAKI`
- `OSA_BACKEND_OPENCODE`
- `OSA_BACKEND_CLAUDE`
- `OSA_BACKEND_CODEX`

Each holds a command path or an argv prefix, space-separated. Unset means the
repository's `bin/<front-end>`. No case body needs editing:

```sh
OSA_BACKEND_MAKI="$PWD/target/release/maki-oss" tests/run-tests.sh
OSA_BACKEND_MAKI="cargo run --release --" tests/run-tests.sh
```

Parity mode runs the case set twice: the first run uses these variables, the
second uses `OSA_BACKEND_<NAME>_2`. To compare the Rust `osa` with the shell
implementation kept in a checkout, restore that script from git as
`bin/osa-shell` and run the `osa` cases only:

```sh
git show <revision>:bin/osa >bin/osa-shell && chmod +x bin/osa-shell
OSA_BACKEND_OSA="$PWD/bin/osa-shell" OSA_BACKEND_OSA_2="$PWD/bin/osa" \
    RUN_ONLY='test_osa*' tests/conformance/harness.sh parity
```

### Refreshing goldens

```sh
OSA_CONFORMANCE_RECORD=1 make test
git diff tests/conformance/golden/
```

Review the diff: every changed line must be a change to what crossed the seam.
Then run `make test` in compare mode.

### Parity between two backends

Run the current backend and a second one. The second is selected with the
`_2` suffix on the same variables; unset falls back to the first.

```sh
OSA_BACKEND_MAKI_2="$PWD/target/release/maki-oss" \
    tests/conformance/harness.sh parity
```

Each case prints one verdict: `identical`, `divergent in recording`,
`divergent in state`, or `divergent in exit status or output`. Divergence does
not abort the run; the command exits non-zero after every case is reported.
Use `RUN_ONLY=<glob>` to limit a parity run while investigating.

`backends/drift.sh` is the divergence smoke test: an argv prefix that runs the
real front-end and then changes one registry field.

```sh
RUN_ONLY=test_up_creates \
OSA_BACKEND_MAKI_2="$PWD/tests/conformance/backends/drift.sh $PWD/bin/maki-oss" \
    tests/conformance/harness.sh parity
```

### Leak check

Every credentialed case declares its fixture variables through
`CREDENTIAL_ENV`/`CREDENTIAL_LOG`, so the harness knows the exact values the
helper put in the child environment. It fails the case if any value appears in
the recording, the helper's state root, or stdout/stderr.

`backends/leaky.sh` is the negative test: a stub `openshell` wrapper that moves
the fixture credential into argv. `make test-conformance-self` installs it on
`PATH` and asserts the suite fails at the recorded argument position, then runs
the same case against the real front-end and asserts it passes.

## Adding a case

1. Write the case in `tests/run-tests.sh` as usual; assert behavior in the case
   body.
2. Run it once (`RUN_ONLY=<test function> make test`) to see the artifact and
   confirm the recording is stable across two runs.
3. Record its golden with `OSA_CONFORMANCE_RECORD=1 RUN_ONLY=<test function> make test`.
4. If it cannot be recorded deterministically (for example its sandbox name is
   hashed from the absolute case directory), add its case id and a reason to
   `excluded.txt` instead.
