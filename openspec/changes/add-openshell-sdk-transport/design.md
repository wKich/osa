# Design

## Context

See `proposal.md` - Why.

After `add-rust-osa-core`, the core is a synchronous Rust binary that spawns
`openshell` for every gateway operation, with argv recorded by the conformance
harness. `add-helper-conformance-harness` gave the suite a normalized recording
of that argv plus a state-and-output verdict, which is what makes a transport
swap measurable at all.

Facts that constrain the approach:

- `openshell-sdk` covers health, sandbox CRUD, readiness and deletion waits,
  and non-streaming exec; providers, policy, logs, SSH, and forwarding are
  reachable only through `raw_grpc` with generated protobuf types
  (<https://github.com/nvidia/openshell/blob/main/docs/sdk/rust.mdx>).
- The SDK does not read the CLI's gateway configuration from disk and supports
  neither mTLS client certificates nor the CLI's config-file discovery
  (same page).
- The SDK is consumed from source and must be used at the same release tag as
  the gateway (same page).
- OpenShell owns its gateway registry at `~/.config/openshell/gateways`, and
  this repository already states it does not copy it (`docs/roadmap.md`).
- `policy-review` records that gateway v0.1.2 has no JSON output for rules, so
  the current rule path parses text. A typed client makes that parser
  unnecessary in the core.

## Goals / Non-Goals

**Goals:**

- One trait, one production implementation, and test doubles behind a
  test-only seam.
- A discovery path that never reads a private file format.
- Streaming exec and logs with no whole-stream buffering on passthrough.
- A typed error set the commands can branch on.
- A test seam that cannot exist in a shipped binary.

**Non-Goals:**

- Converting file transfer if the client does not cover it.
- mTLS client-certificate support or any new authentication mode.
- Async runtime in paths that do not need it (the front-ends stay synchronous
  `sh` in this change).
- Changing which operations a command performs, or their user-visible ordering.
- Multi-gateway selection beyond passing the resolved gateway through.

## Decisions

### D1. One async trait, object-safe, injected at construction

`Gateway` is an `async_trait` with one method per covered operation, returning
`Result<_, GatewayError>`. The binary constructs `Arc<dyn Gateway>` once and
passes it down.

*Why `async_trait` instead of native async-in-trait:* the recording
implementation must be substituted at runtime in tests, which needs an
object-safe trait; native async fn in trait is not dyn-compatible without
boxing at every call site.

*Why not a compile-time generic parameter threaded through every command:* the
command code would become generic over the transport, which pollutes signatures
for no benefit at this size.

### D2. Discovery asks the CLI, once, and never reads the private registry

`gateway::discover()` resolves the endpoint in this order: explicit selection
(flag, environment, or the project's `gateway` config key), then
`openshell gateway info --output json`, memoized in a `OnceLock` for the process
lifetime. The parsed result is a small struct holding the endpoint and the
authentication mode.

*Why the CLI call is acceptable here:* it is one invocation per process, it uses
a documented subcommand the repository already calls (`doctor`, the verification
log), and it keeps OpenShell as the owner of its own configuration.

*Alternative rejected:* reading `~/.config/openshell/gateways`. It is an
undocumented private format, the repository's own roadmap commits to not copying
it, and a format change would break every command at once.

*Alternative rejected:* requiring `OPENSHELL_GATEWAY`/`OPENSHELL_TOKEN` for
every run. It makes the default path callers configure what the CLI already
knows.

### D3. Fail loudly on an unsupported authentication mode

If discovery reports a mode the client cannot express (mTLS client
certificates), the command fails with a message naming the mode and the
supported alternatives. There is no silent fallback to the CLI and no
accept-any-certificate path: a downgrade here would be an egress-integrity
regression, not a convenience.

*Alternative rejected:* automatic CLI fallback per operation. It would make the
transport depend on host configuration, so the same command would have two
behaviors and the conformance suite could not pin either.

### D4. Converted and unconverted operations are visible in one module

`gateway/mod.rs` declares the trait; `gateway/sdk.rs` implements covered
operations; `gateway/cli.rs` implements only the uncovered ones (file upload and
download, gateway info). A reviewer can see the entire remaining CLI surface in
one file.

*Why not delete the CLI path outright:* the SDK's curated surface has no file
transfer, and `raw_grpc` coverage for upload/download is unverified. Keeping it
explicit is more honest than a half-migrated abstraction.

*What actually happened:* `gateway/cli.rs` ended up holding only the `openshell`
process builder and `gateway_info`, because the converted operations were never
removed from `agent/` — they were never there to remove. The 26 remaining spawns
are `agent/gateway.rs::run_gateway`, and upload and download are in
`agent/session.rs`. The one-file property this decision exists for does not hold
yet; section 8 of `tasks.md` is the rest of it, and D11 records the seam that
took the recorder's place in the meantime.

### D5. Streaming exec is a chunk stream, not a buffered result

`exec_stream` returns a stream of output events plus a terminal exit status.
Passthrough consumers write each chunk; probe consumers collect. Backpressure
comes from a bounded channel rather than unbounded buffering.

*Why this matters beyond performance:* the current CLI path reads child stdout
as text; a buffered RPC result would change when output becomes visible to a
user watching a long run.

*Known deviation:* log streaming sets the client's follow flag unconditionally
and uses the caller's `follow` argument only for the tail length, so a
non-following call does not terminate. Task 4.5 covers it.

### D6. Recording lives behind a test-only feature

`RecordingGateway` is compiled only under a `test-support` feature that the
release build does not enable, and it writes transcripts to a directory named by
a test-only parameter — not an environment variable. A shipped binary therefore
cannot produce a transcript even if the variable is set.

*Alternative rejected:* an environment-gated recorder in the production build.
It puts a code path in the binary whose only purpose is to write gateway requests
to disk, and requests can carry credentials.

*Current state:* the feature gate is in place and no target enables it, so the
module is neither built nor tested today, and its provider fixture predates
`ProviderSpec::credential_key`, so enabling the feature does not compile. Task
2.5 makes the seam real. This is also why the recorder is not what verifies the
transport right now — D11 is.

### D7. Secret payloads are typed per field, and tracing never sees them

The credential travels in a `Credential` newtype that has no `Display`,
`Serialize`, or derived `Debug`; the SDK request is built by a function that
takes it and writes the designated field. A `Debug` impl that prints a fixed
redaction token keeps struct-level logging safe, and the client is constructed
with a subscriber filter that excludes request bodies.

*Why both a type and a policy:* the type stops accidental formatting; the filter
stops a future `tracing::debug!(?request)` from leaking a whole payload. The
conformance sentinel case covers the end-to-end path regardless.

*Current state:* `osa-core` has no `tracing` dependency, so the filter half of
this decision has no subject. The protection is the newtype plus a `Debug` impl
that prints a fixed redaction token, and task 6.4 is stated against that instead
of against a subscriber filter that does not exist.

### D8. Errors carry context, not strings

`GatewayError` distinguishes unreachable, unauthenticated, not found, already
exists, policy denied, timeout, and failure. Each variant carries the fields its
message needs (sandbox, phase, status, field). A single mapping function turns a
variant into the documented message and exit code.

*Why:* `helper-cli` currently branches on text from the CLI. A typed enum makes
the create-race reuse path and the policy-denied path explicit instead of a
substring match.

### D9. The version pin is checked, not remembered

The SDK is pinned by git tag equal to the gateway release the host playbook
pins. The existing drift target (`make compat-drift`) gains a check that reads
the tag from `Cargo.toml` and the version from the playbook and fails naming
both when they differ.

*Why a check and not a comment:* the SDK page states the client and gateway
should come from the same release; a silent mismatch produces RPCs the gateway
does not implement, discovered at runtime.

### D10. Conformance declares transport per case

The harness records the transport each backend used, stores goldens per
transport, and reports `transport-changed` when only the transport differs. This
is the mechanism that lets a conversion land operation by operation without
either hand-editing assertions or pretending a gateway request equals an argv.

### D11. The transport is verified against a fake gateway server

`stub-gateway` is an in-process service implementing OpenShell's generated
`OpenShell` trait over a temporary state directory: sandboxes as files, phases
and ids settable, providers and attachments on disk, policy chunks with a prover
verdict, a request log, and two provokers (`with_create_race`,
`with_delete_failure`). The client's integration tests connect a real
`SdkGateway` to it and assert the RPC surface, the waits, the streamed exec, the
provider and rule semantics, and the error paths.

*Why this rather than the recorder for verification:* a recorder observes what
the core already sends through the trait. It can prove stability and redaction,
but not that a gateway accepts the encoding. A service on the other side of the
wire proves the protobuf shape, the stream framing, and the status-to-variant
mapping, and lets the create race and a refused delete be provoked
deterministically instead of by timing. It needs no gateway, no Docker, and no
network, so the core suite stays offline.

*Why both exist:* they answer different questions. The recorder answers whether
two runs of a case send the same request and whether that request carries a
secret; the fake server answers whether a gateway accepts the request and
whether the client reads the answer. Neither substitutes for the other, which is
why D6 is fixed rather than deleted.

## Risks / Trade-offs

- **Source-pinned dependency churn** (a tag bump compiles new upstream code) →
  pin, build in CI, and let the version check catch an unplanned drift; keep the
  `cargo vendor` path available for an offline build.
- **Partial `raw_grpc` coverage** (a needed RPC exists only as protobuf types,
  or not at all) → the CLI implementation remains and the trait's uncovered
  methods stay in `gateway/cli.rs`; the change does not require converting
  everything.
- **Streaming complexity** (lifetimes, cancellation on interrupt) → a bounded
  channel with an explicit cancel path, plus a case that interrupts a streamed
  exec and asserts the child and the stream both end.
- **A converted operation silently changes error text** → the conformance suite
  compares exit status and output, and a per-variant message test pins the
  documented strings.
- **Authentication-mode gap** (a user on mTLS) → fail loudly at discovery with
  the supported alternatives; documented in the transport note.
- **Recording drift between transports** (a case converts and its old argv
  golden lingers) → goldens are stored per transport and record mode rewrites
  only the declared one; the unrecorded count exposes a stale file.
- **A client that passes its own tests but is never used** → the trap this
  change fell into once already: everything green while production still spawns
  `openshell`. Section 8 of `tasks.md` is the exit, and its last task asks for
  an end-to-end observation rather than another unit test.
- **`policy-review`'s front-end path still parses text** → out of scope here;
  the front-ends keep the CLI until their own change, and the core no longer
  depends on the text format.

## Migration Plan

1. Land the trait, discovery, error mapping, the fake gateway, and the client,
   tested against the fake gateway. This is where the change stands today: the
   trait is not reachable from a command, so behavior is unchanged because
   nothing switched over. Parity is trivially identical, and also unexercised.
2. Wire the client into the command context, then convert one operation family
   at a time (sandbox CRUD, then exec and logs, then providers, then rules),
   switching its conformance cases to the client transport and requiring
   `transport-changed` with identical state and output.
3. Delete the CLI implementations of converted operations; `gateway/cli.rs`
   keeps only file transfer and gateway info.
4. Roll back one family at a time by re-pointing the trait method at the CLI
   implementation. No on-disk format changes, so no state migration is needed.

## Open Questions

Two, neither of which changes the specs. Whether the file-transfer operations
can move to `raw_grpc` is still unanswered (task 5.5), with the CLI remaining
the default either way. And whether the conformance harness needs a
`transport-changed` verdict at all (tasks 2.3 and 2.4) is now worth asking: the
verdict exists to compare two backends on the same case, while the transport's
own correctness is proven against the fake gateway one operation at a time. The
harness dimension may still be what catches a state or output difference across
the swap, which is the reason to keep it in the plan rather than drop it.
