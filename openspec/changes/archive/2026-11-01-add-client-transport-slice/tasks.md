# Tasks

## 1. Establish the baseline

- [x] 1.1 Capture what the CLI prints: run `openshell sandbox list` twice against the host gateway and confirm the two captures are byte-identical, then commit the captured table as `osa-core/crates/osa-core/tests/fixtures/sandbox-list.txt` so the layout the renderer must reproduce is recorded rather than remembered
- [x] 1.2 Capture the case as it stands: run the `status, list, and logs` case in record mode and keep its recording, so the post-conversion diff has a reference, and verify its golden contains a `sandbox list` entry

## 2. Let the suite host a gateway

- [x] 2.1 Start `stub-gateway` from the test runner with an ephemeral port, read the `http://<addr>` line it prints before serving, export it for the case, and stop the process on every exit path; verify no process the suite started is still listening after a normal run and after a deliberately failing case
- [x] 2.2 Teach `tests/stub/openshell` to report the exported value as `server` in `gateway info`, keeping today's value as the default when it is unset, and verify every existing case still passes with no golden change
- [x] 2.3 Verify the suite still needs no provisioned gateway: run it with no gateway reachable on the host and no `OPENSHELL_GATEWAY` set, and confirm every case runs and none reports a gateway error

## 3. Give the context a client

- [x] 3.1 Add a lazily constructed client accessor to the command context, built from the discovered endpoint on first use, and verify a registry-only command (`osa projects`) still succeeds with the OpenShell CLI absent from `PATH` and performs no discovery
- [x] 3.2 Verify the accessor resolves discovery at most once per process and that a discovery failure surfaces the documented message and exit code; verify both with a test against an unreachable endpoint

## 4. Convert `list` and measure parity

- [x] 4.1 Convert `commands::list` from the CLI invocation to the client's sandbox listing and render the table the CLI prints — `NAME`, `CREATED`, and `PHASE`, with the name column as wide as the widest name (minimum 4) followed by two spaces and a 19-wide `CREATED` — and verify the rendered output matches the 1.1 capture byte for byte, recording any residual difference rather than accepting it silently
- [x] 4.2 Replace the case's `assert_log_has "list"` with two assertions — no `sandbox list` invocation was recorded, and the output carries the expected rows — and verify the case passes and then fails when the CLI invocation is reintroduced
- [x] 4.3 Update the `status` case recording to the post-conversion form, and verify the diff against 1.2 is exactly the removed `sandbox list` invocations with no other line changed
- [x] 4.4 Verify the `helper-cli` scenarios: all four front-ends produce identical output for the fixed state, and an empty gateway prints no sandbox row and exits 0

## 5. Record the measurement

- [x] 5.1 Write the result into this change's design — files touched, lines added for the rendering, whether parity held and where it did not — and name the `add-openshell-sdk-transport` tasks the number revises; verify every figure against the change's own diff
- [x] 5.2 Verify `make test-core` and `make test-conformance` both pass on a host with no gateway, no Docker, and no network

## 6. The authentication path

- [x] 6.1 Build a channel that carries a client identity, read from the `ca.crt`, `tls.crt`, and `tls.key` of an explicit directory and handed to the client through its `from_parts` constructor, and verify against the host's mTLS gateway that `list` reports the same table the CLI does
- [x] 6.2 Fail before contacting the gateway when one of the three files cannot be read, naming the file and the directory, and verify with a directory holding only `ca.crt`
- [x] 6.3 Name `--tls-dir` in the unreachable failure when no certificate is supplied, since discovery reports `auth: null` for an mTLS gateway, and verify the message against the host's mTLS gateway
- [x] 6.4 Verify no path disables certificate verification and no key material is printed: `grep -r insecure_skip_verify osa-core/crates/osa-core/src` is empty, and the identity's `Debug` prints redaction tokens
- [x] 6.5 Expose the directory as `--tls-dir`, `MAKI_OSS_TLS_DIR`, and the config key `tls_dir`, and document it in the four usage texts
