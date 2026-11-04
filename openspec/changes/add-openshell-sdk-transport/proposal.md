# Proposal

## Why

Every gateway operation in this repository is a child process: the tool builds
an `openshell …` argv, runs it, and parses whatever it printed. That was the
shape of `lib/oss-core.sh` (33 `openshell` call sites), and it is still the shape
of the four TypeScript wrappers and of the Rust core (`agent/gateway.rs`, 26
call sites). The cost is visible in the specs themselves: `helper-cli` needs
separate scenarios for pretty, compact, and single-line gateway JSON so a reader
can be written at all, and `policy-review` records that gateway v0.1.2 has no
JSON output and the helper must parse text.

OpenShell is a Rust project and publishes `openshell-sdk`
(<https://github.com/nvidia/openshell/blob/main/docs/sdk/rust.mdx>), the async
gateway client its own CLI and TUI use. It covers sandbox CRUD, readiness and
deletion waits, and streamed exec, with the complete RPC surface reachable
through `raw_grpc`. Using it removes argv assembly and output scraping from the
core, gives streamed output instead of buffered text, and produces errors the
code can branch on instead of strings to match.

## What Changes

- Add a `Gateway` trait in `osa-core` with one production implementation backed
  by `openshell-sdk`, and test doubles behind a test-only seam.
- Add a fake gateway server (`stub-gateway`), an in-process service implementing
  OpenShell's generated RPC surface over temporary state, so the client's
  requests, waits, streams, and error paths are tested with no gateway, Docker,
  or network.
- Convert the core's gateway operations to the trait: sandbox create / start /
  stop / delete / get / list, readiness and deletion waits, exec probes, log
  streaming, providers, and rules.
- Resolve the gateway endpoint in exactly one place. The client does not read
  the CLI's gateway configuration from disk
  (<https://github.com/nvidia/openshell/blob/main/docs/sdk/rust.mdx>), so the
  core asks `openshell gateway info --output json` once per process and caches
  the result, rather than reading OpenShell's private registry at
  `~/.config/openshell/gateways`.
- Keep the CLI for operations the client does not cover (file upload and
  download), outside the trait, so the split is visible; the trait today has one
  method per covered operation and no transfer method, and the transfer calls
  still sit in `agent/session.rs`.
- Replace argv goldens for converted operations with gateway-request
  transcripts, and teach the conformance harness to distinguish an intentional
  transport change from a behavioral divergence.
- Pin the SDK to the same release tag as the gateway the host playbook pins.

Non-goals: no front-end, dashboard, bridge, or oskhs code; no change to which
gateway operations a command performs; no mTLS client-certificate support (the
client does not offer it and nothing here needs it).

## Capabilities

### New Capabilities

- `gateway-client`: the typed gateway client contract — endpoint discovery,
  operation-to-RPC mapping, streamed exec and logs, provider and rule
  semantics, credential handling over the wire, error taxonomy, redaction, and
  the two test seams: a recording client and a fake gateway server.

### Modified Capabilities

- `osa-core`: credential delivery becomes transport-neutral instead of
  "child environment only", and the parity requirement changes from argv
  identity to semantic equivalence for converted operations.
- `helper-conformance`: a case may record either CLI argv or gateway request
  transcripts, and parity reports a declared transport change as
  `transport-changed` rather than as a divergence.

## Impact

- New: `osa-core/crates/osa-core/src/gateway/` (trait, SDK implementation,
  recording implementation, discovery module, error taxonomy),
  `osa-core/crates/stub-gateway/` (the in-process OpenShell service the client is
  tested against, with its own SDK contract test), and
  `osa-core/crates/osa-core/tests/sdk_transport.rs`; SDK dependency pinned to the
  same `v0.1.5` release tag the host playbook pins.
- Modified once the conversion lands: the core's sandbox, provider, rule, exec,
  and log paths; the conformance harness's recording and parity comparison; the
  host playbook's version pin, which must now cover both the gateway and the SDK
  tag.
- Security: provider credentials reach the gateway in an RPC payload instead of
  a child environment. The invariant is unchanged — no value in argv, no value
  under the state root, no value in output — and the redaction requirement is
  extended to cover error text and any request tracing. Egress stays
  deny-by-default: the client gains no ability to add or widen a rule beyond
  what the current commands do, and an approval still targets exactly one
  chunk.
- Status: the client is complete and tested with no gateway or Docker. Converted
  commands are sandbox start/stop/delete/get/list, the waits, logs, provider
  list/attach/detach, and rule approval; sandbox create, interactive and
  script/probe exec, provider create, and rule get/list keep the CLI and are
  named in the transport note. The conformance suite declares a transport per
  case, stores goldens per transport, and reports `transport-changed`; a parity
  run over each transport passes for the converted cases. The follow-up change
  `convert-remaining-gateway-operations` carries the remaining conversions.
- Risk: the SDK is consumed from source and pinned by tag, so a gateway upgrade
  becomes a source dependency bump; the covered surface is partial, so the CLI
  path does not disappear entirely; and a converted operation loses its argv
  golden, so the gate moves from recording identity to state-and-output
  equivalence plus a recorded request transcript.
- Depended on `add-rust-osa-core` (and therefore
  `add-helper-conformance-harness`); both are archived, so that dependency is
  satisfied.
