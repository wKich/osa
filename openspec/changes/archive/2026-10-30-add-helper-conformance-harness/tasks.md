# Tasks

## 1. Backend indirection

- [x] 1.1 In `tests/run-tests.sh`, resolve `MAKI`, `OC`, `CLAUDE`, and `CODEX` from `OSA_BACKEND_MAKI`, `OSA_BACKEND_OPENCODE`, `OSA_BACKEND_CLAUDE`, and `OSA_BACKEND_CODEX` as a command path or argv prefix, defaulting to the current `bin/` paths; verify `make test` passes unchanged with no variable set
- [x] 1.2 Replace every case-body literal front-end path with the resolved variable, and verify `grep -n 'bin/maki-oss\|bin/opencode-oss' tests/run-tests.sh` finds no case body
- [x] 1.3 Verify a case still fails as expected when invoked through a wrapper that exits non-zero, so a resolved variable really is being executed

## 2. Recording

- [x] 2.1 Extend `tests/stub/openshell` to append `@env NAME` lines for an allow-listed child environment after each invocation's argv lines, and verify with one case that the log contains argv plus env names and no values
- [x] 2.2 Add `tests/conformance/normalize.sh` implementing the closed path/timestamp/sandbox-id substitution set, and verify a unit self-test that an added, removed, or reordered argument still differs after normalization
- [x] 2.3 Verify the same case run twice produces byte-identical normalized recordings

## 3. Golden comparison

- [x] 3.1 Add `tests/conformance/harness.sh` with default, record, and parity modes, exposing per-case `record`, `compare`, and `state` helpers; verify `make test` still passes with the harness sourced
- [x] 3.2 Implement golden compare against `tests/conformance/golden/<case>.log` with a `diff -u` failure that names the case, and verify with a case whose golden was edited by one argument
- [x] 3.3 Implement record mode that rewrites goldens, lists changed files, and is the only mode that writes; verify a normal run leaves golden modification times unchanged
- [x] 3.4 Report the unrecorded-case count at the end of a run, and verify it decreases as batch 4 lands goldens

## 4. Case coverage and goldens

- [x] 4.1 Record goldens for the sandbox lifecycle cases (create, up, stop, rm, resolve) in one reviewed batch, and verify each case passes in compare mode
- [x] 4.2 Record goldens for the provider/credential cases in one reviewed batch, and verify each case passes in compare mode
- [x] 4.3 Record goldens for the session/sync cases (upload, patch collect, pending markers, locks, idle stop) in one reviewed batch, and verify each case passes in compare mode
- [x] 4.4 Record goldens for the four front-ends' shared ensure path, and verify each front-end still resolves through its own `OSA_BACKEND_*` variable
- [x] 4.5 Add any case name found unrecorded to a documented exclusion list with a reason, and verify the unrecorded count equals the exclusion list length

## 5. Secret-leak gate

- [x] 5.1 Add `tests/conformance/backends/leaky.sh`, a wrapper that moves the fixture credential from environment to argv, and verify it reproduces a leak the harness can observe
- [x] 5.2 Implement the fixture-scan assertion over recording, state tree, stdout, and stderr, and verify the leaky backend fails the case while the real front-ends pass it
- [x] 5.3 Add one credentialed case per front-end, and verify all four pass in compare mode

## 6. Parity mode

- [x] 6.1 Implement state digest capture (sorted state-root-relative paths with content hashes) and verify two runs of the same backend produce identical digests
- [x] 6.2 Implement parity mode running the case set twice into separate artifact trees with per-case verdicts and a non-zero exit on any divergence; verify with two copies of the same backend that every case reports identical
- [x] 6.3 Verify a backend that changes one registry field value reports `divergent in state`, names the field, and still runs the remaining cases

## 7. Gate wiring

- [x] 7.1 Add `make test-conformance`, and verify it runs the full case set and exits non-zero on a failing case named in the output
- [x] 7.2 Add the conformance suite to `make test-all` and to the CI job, and verify a conformance-only failure makes `make test-all` exit non-zero naming the conformance suite
- [x] 7.3 Verify the conformance target runs on a host without `bun` (stub `bun` off `PATH`) and does not skip
- [x] 7.4 Document the modes, the record workflow, the golden review rule, and the `OSA_BACKEND_*` variables in `tests/README.md` or the conformance directory's own README, and verify the documented commands run as written
