# Tasks

## 1. Fake gateway: internal probes

- [x] 1.1 Classify a scripted exec as an internal probe by invocation shape (`sh`, `-c`, script, label) instead of the `-git`/`-run` suffix list, in `osa-core/crates/stub-gateway/src/lib.rs`; verify the existing suite's internal-script cases still pass with `cargo test -p stub-gateway`
- [x] 1.2 Add a unit test that sends the idle probe (`sh -c <script> <profile>-idle`) to the fake gateway with an `exec.cases` fixture and asserts the fixture's stdout and exit status come back; verify `cargo test -p stub-gateway` names the test as passed
- [x] 1.3 Add a unit test that sends an internal probe with an `exec.fail` fixture and asserts the probe fails with the fixture's exit status; verify `cargo test -p stub-gateway` names the test as passed
- [x] 1.4 Add a unit test that sends an agent command (`maki -p …`) and asserts it is still handled as an agent run, not as an internal script; verify `cargo test -p stub-gateway` names the test as passed

## 2. Idle goldens under review

- [x] 2.1 Re-record the idle set with `OSA_CONFORMANCE_RECORD=1 RUN_ONLY='*idle*' tests/run-tests.sh`, then run it again without record mode; verify the second run reports 10 passed, 0 failed
- [x] 2.2 Review `git diff tests/conformance/golden/client/` and confirm every change is the discovery pair (`gateway info --output json`, `sandbox get --output json`) or environment-block ordering, with no changed exit status, assertion line, or assertion text; verify by reading the diff and stating the reason per file in the commit message
- [x] 2.3 Scan the recorded transcripts for credential-like values with the suite's own leak scan over `tests/conformance/golden/`; verify it reports zero leaks, and confirm `tests/e2e/excluded.txt` gained no entry

## 3. Suite regression

- [x] 3.1 Run `make test`; verify 329 passed, 0 failed, 0 skipped
- [x] 3.2 Run `make test-conformance` (strict mode); verify 0 mismatched and no unrecorded case
- [x] 3.3 Run `cargo test --workspace --manifest-path osa-core/Cargo.toml`; verify the workspace suite passes

## 4. Boundary gate and record

- [x] 4.1 Start a MongoDB (`docker run -d --rm -p 27017:27017 mongo:7`) and export `OSKHS_TEST_MONGO_URI`; verify `mongosh --eval 'db.runCommand({ping:1}).ok'` returns `1`
- [x] 4.2 Create the verification sandbox (`openshell sandbox create --name <name> --from maki-agent:local --policy examples/policies/maki-minimal.yaml --provider <provider>`) and run `tests/boundary/checks.sh --sandbox <name> --credential-var <VAR>`; verify all six checks report PASS
- [x] 4.3 Run `make test-boundary BOUNDARY_ARGS='--sandbox <name> --credential-var <VAR>'`; verify all three parts run, the exit status is 0, and the record's verdict is `passed`
- [x] 4.4 Copy the printed boundary record into `docs/verification-log.md` with its date, gateway, agent, engine, and image versions; verify no credential value and no literal placeholder appears in the entry, and `scripts/check-links.sh` passes
- [x] 4.5 Archive the change with `openspec archive make-boundary-gate-verifiable`; verify `openspec validate gateway-client --type spec` reports valid and the delta's requirement is present in `openspec/specs/gateway-client/spec.md`
