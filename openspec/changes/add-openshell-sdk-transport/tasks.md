# Tasks

Status as of the last sync: the typed client, discovery, error mapping, the
fake gateway, and the recovery paths are built and tested — `cargo test
--workspace` passes with 90 tests and needs no gateway or Docker. No command
calls the client yet: production still performs every gateway operation by
spawning `openshell` (26 `run_gateway` call sites under `agent/`). Section 8
carries that wiring. The recording transport sits behind the `test-support`
feature, which no target enables and which does not currently compile (2.5).
The conformance harness has no transport dimension yet (2.3, 2.4).

## 1. Client scaffolding

- [x] 1.1 Move the existing lenient gateway JSON reader from `osa-core/crates/osa-core/src/gateway.rs` into a `gateway/` module (`mod.rs` keeps the reader and its shape error), so the transport trait and its implementations can live beside it in `gateway/sdk.rs` and `gateway/cli.rs`; verify `cargo test --workspace` passes and no path outside `src/` references the moved file
- [x] 1.2 Add `openshell-sdk` pinned by git tag and `tokio` to the workspace manifest, and verify `cargo build --release` succeeds and the lock file records the tag
- [x] 1.3 Define the object-safe `Gateway` trait with one method per covered operation, and verify a compile-only test that stores it as `Arc<dyn Gateway>`
- [x] 1.4 Implement `gateway::discover()` with the explicit-selection-first order and a memoized `openshell gateway info --output json` fallback, and verify a test that asserts at most one CLI call per process
- [x] 1.5 Verify discovery failure exits non-zero with a message naming the gateway, the attempted sources, and the fix, and that `osa remove` changes no registry entry in that case
- [x] 1.6 Verify the source contains no reference to the gateway registry path (`grep -r 'openshell/gateways' osa-core/` is empty)
- [x] 1.7 Implement the transport `GatewayError` taxonomy in `gateway/error.rs` and its message/exit-code mapping, and verify a table test pins each variant's documented message and code
- [x] 1.8 Implement the unsupported-authentication-mode failure, and verify an mTLS-shaped discovery result exits non-zero naming the mode and the supported alternatives with no fallback to the CLI

## 2. Recording seam and conformance transport

- [x] 2.1 Add the `test-support` feature with `RecordingGateway` writing normalized transcripts to an explicit directory parameter, and verify the release build cannot construct it and ignores the environment variable
- [ ] 2.2 Implement transcript normalization (operation, target, non-secret fields, stable ordering) and verify the same case run twice produces byte-identical transcripts; the normalization and its test exist in `gateway/record.rs`, and the test runs only once 2.5 makes the feature compile
- [ ] 2.3 Extend the conformance harness with per-case transport declaration and per-transport golden storage, and verify a case declaring the CLI transport fails when the backend uses the client, naming both
- [ ] 2.4 Implement the `transport-changed` verdict, and verify a converted case with identical state and output passes while a state divergence still fails
- [ ] 2.5 Make the recording transport build and run: the provider fixture in `gateway/record.rs` predates `ProviderSpec::credential_key`, so `cargo test -p osa-core --features test-support` fails to compile and none of the module's five tests — stability, field naming, credential redaction, environment ignoring, one-write approval — ever run; verify the feature compiles, the tests pass, and `make test-core` enables it

## 3. Sandbox operations

- [ ] 3.1 Implement `get`, `list`, and the readiness and deletion waits over the client, and verify conformance cases report `transport-changed` with identical state and output
- [x] 3.2 Implement create, start, stop, and delete over the client, and verify the create-race case still re-reads and reuses instead of failing
- [x] 3.3 Verify a wait timeout message names the sandbox and the last observed phase, matching the recorded shell message
- [ ] 3.4 Delete the CLI implementations of the converted sandbox operations, and verify `gateway/cli.rs` no longer contains them; the file is already down to the process builder and `gateway_info`, but the spawns it was meant to absorb were never there — they are in `agent/gateway.rs::run_gateway`, and removing them is 8.2

## 4. Exec and logs

- [x] 4.1 Implement streamed exec over the client with a bounded channel, and verify output is written before the stream ends and that the terminal exit status is reported separately
- [ ] 4.2 Implement log streaming, and verify a both-endings case (normal end, interrupted) closes the stream and releases the child
- [ ] 4.3 Verify an interrupt during a streamed exec ends the stream and leaves no orphaned process or open stream
- [x] 4.4 Verify health probes may buffer, and that a probe reports exit code and output distinctly
- [ ] 4.5 Fix the follow inversion in `gateway/sdk.rs`: the log stream sets the client's follow flag unconditionally and uses the caller's `follow` argument only for the tail length, so a non-follow call never terminates; verify a non-following call drains its tail and returns, and that both endings still release the stream

## 5. Providers and rules

- [ ] 5.1 Implement provider create, list, attach, and detach over the client, and verify conformance cases report `transport-changed` with identical state and output; the implementation and its round-trip test are done, the conformance half waits on 2.3 and 2.4
- [x] 5.2 Implement rule get, list, and approve, and verify an approval transcript contains exactly one rule write targeting one chunk id
- [x] 5.3 Verify a listing carries chunk id, rule name, binary, endpoints, and prover verdict from structured data with no text parsing, and that a text-only gateway response is no longer required
- [x] 5.4 Verify no command other than an explicit approval produces a rule write in its transcript
- [ ] 5.5 Verify file upload and download remain in `gateway/cli.rs`, and record whether `raw_grpc` covers them in the module's own note; upload and download are in `agent/session.rs`, not `gateway/cli.rs`, so this task now covers moving them there and writing the note

## 6. Credentials and redaction

- [x] 6.1 Implement the credential payload type with no display, serialize, or derived debug, and verify a compile-fail test or a type-level assertion that formatting it is unavailable
- [ ] 6.2 Verify the sentinel credential appears in the captured request only in the designated field and nowhere in transcripts, tracing output, state files, or command output; the recorder already carries this case and runs once 2.5 compiles it
- [ ] 6.3 Verify a gateway rejection of a credentialed request produces an error naming the field and the status with no value in the text; the `CredentialRejected` variant and its message exist in `gateway/error.rs`, the test does not
- [ ] 6.4 Verify no path can print a credential. The crate has no `tracing` dependency, so the request-body filter this task originally asked for has no subject: verify instead that the type has no `Display`, `Serialize`, or derived `Debug`, that its only `Debug` emits the redaction token, and that no formatting call on `expose()` exists outside `gateway/sdk.rs`

## 7. Version pin, gate, and docs

- [x] 7.1 Extend `make compat-drift` to compare the SDK tag in `Cargo.toml` with the gateway version in the host playbook, and verify a deliberate mismatch fails naming both values
- [ ] 7.2 Verify `make test-core` and `make test-all` pass with the converted transport, and that no test requires a gateway or Docker; the core suite passes (90 tests, no gateway, no Docker) but `make test-all` needs bun and a Mongo URI and has not been run, and "the converted transport" is still unexercised because nothing is converted
- [ ] 7.3 Add a transport note to `docs/helper.md` covering the endpoint discovery sources, the unsupported authentication modes, and which operations still use the CLI, and verify the documented commands run as written
- [x] 7.4 Verify the host playbook states that the SDK tag and the gateway version are the same release, and that the statement matches `Cargo.toml`

## 8. Wiring the client into the commands

- [ ] 8.1 Construct the client once per process from the discovered endpoint and expose it on the command context as `Arc<dyn Gateway>`, and verify the binary builds with `SdkGateway` as the only production implementation
- [ ] 8.2 Convert the sandbox, exec, log, provider, and rule call sites under `agent/` to the trait, leaving `run_gateway` for file upload and download only, and verify the remaining `run_gateway(` call sites are exactly those two
- [ ] 8.3 Verify parity for the converted commands: `cargo test --workspace` and the stub-backed conformance suite pass, and no committed golden changes except where a case declares the new transport
- [ ] 8.4 Verify a conversion is observable end to end: a command run against the stub gateway performs no `openshell` invocation for a converted operation, and writes the same state a CLI-transport run wrote
