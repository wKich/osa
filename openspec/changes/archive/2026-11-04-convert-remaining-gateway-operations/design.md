# Design

## Context

See `proposal.md` — Why, and `add-openshell-sdk-transport` — Design D4, D11, and
D12. The previous change left a selectable CLI transport
(`OSA_GATEWAY_TRANSPORT=cli`) so parity is measurable while operations convert.
This change removes every remaining exemption and then deletes the selector's
need in production, keeping it only as the parity/rollback tool.

Facts that constrain the approach:

- `openshell-sdk` exposes `exec_sandbox_interactive` as a bidirectional stream
  with TTY and resize frames; the curated `exec` takes stdin as bytes.
- `CreateSandboxRequest` carries the parsed policy, the template, providers, and
  environment, but not the policy's host path; the current CLI argv assertion
  checks that path.
- The CLI's `rule get` output is text. A structured listing exists on the
  gateway, so the rendering can move into the core.
- The conformance harness drives a stub gateway process that is long-lived for
  a case, while `STUB_EXEC_STDOUT`, `STUB_EXEC_CASES`, and `STUB_RULE_PENDING`
  are per-run env vars the CLI stub sees and the gateway does not.

## Goals / Non-Goals

**Goals:**

- Every covered operation goes through the trait; the CLI remains only for
  file transfer, gateway info/status, policy show/apply, settings, and provider
  profile import/lint.
- The interactive session and the probes keep their TTY, stdin, fixture, and
  exit-status behaviour.
- Parity is a gate over the converted set, not a manual check.

**Non-Goals:**

- Converting file transfer to `raw_grpc`; it stays unverified and explicit.
- A new authentication mode or a change to provider credential semantics.
- Changing user-visible text beyond what the CLI already prints.

## Decisions

### D1. Interactive exec is a bidi stream, not buffered

Add `exec_interactive(request, input, output)` to the trait. `input` is a
channel of stdin bytes, resize, and close frames; `output` receives chunks as
they arrive; the return value is the exit status. The CLI transport implements
it by spawning `openshell sandbox exec --tty` and forwarding the same three
streams, so a parity case can compare them. The session, the timeout wrapper,
and the probes share the same request type.

*Why not keep the CLI for the session:* it is the largest remaining argv path,
and it is the one where output visibility matters most. A buffered RPC result
would change when output appears; the bidi stream preserves it.

*Why not `raw_grpc` only:* the curated client owns reconnect and error mapping;
using the generated stream for this one operation is acceptable because the
gateway's interactive RPC is the documented surface, but the error mapping is
still the trait's.

### D2. ProviderSpec carries the create command's whole surface

`ProviderSpec` gains `from_existing`, `global_profile`, `runtime_credentials`,
`credential_keys`, and `config` pairs. The SDK implementation maps them to the
provider RPC the gateway already exposes; `--from-existing` selects the
existing-credential mode rather than adding a second secret channel. The CLI
transport keeps the argv form for parity.

*Why not a separate provider-create trait method:* one operation, one method,
and the recording transport keeps working. The recording normalizes the
credential to the redaction token and records only field names.

### D3. Sandbox create records its full spec

`SandboxSpec` already holds image, policy path, CPU, memory, providers, and
environment pairs. The SDK request carries the parsed policy; the policy path
is not part of the RPC. The transport therefore records the spec it was given
before building the request, and the conformance assertion reads that record.
The CLI transport records the argv it actually built.

*Why this is not cosmetic:* the create argument surface is the contract the
existing cases pin. Losing `--policy` from the recording would make a policy
regression invisible.

### D4. Rule listing renders from structured data

`list_rules` returns chunk id, rule name, binary, endpoints, status, and prover
verdict. A renderer in the core produces the CLI's text for `policy review` and
for the pending-proposal note. The CLI transport returns the same structured
values parsed from the CLI text, so parity compares the rendered result.

*Why a renderer and not pass-through:* the spec already requires the listing to
carry the structured fields and not depend on a text-only response. The
renderer is the one place that text lives.

### D5. Per-run fixtures reach the fake gateway

The suite gets a control file per case, for example
`<state>/fixtures/<kind>` written by `run_maki_with_input` before the command
runs: exec stdout/exit/cases, pending rule text, create arguments, attach and
delete failures. The stub gateway reads it per request. The CLI stub reads the
same file, so both transports see one fixture.

*Alternative rejected:* passing fixtures by environment to the gateway process.
The gateway is started per case, but a test function switches cases and reruns
commands inside one case; the fixture changes per run.

*Alternative rejected:* a control RPC. It adds a surface to the fake gateway
that production never has, and the state root is already the case's shared
channel.

### D6. Parity runs in the gate

`scripts/test-all.sh` runs the suite twice for the converted set: once with the
typed client and once with `OSA_GATEWAY_TRANSPORT=cli`, then compares state,
exit status, output, and the transport declaration. `identical` and
`transport-changed` pass; anything else fails.

*Why not a full second run of every case:* the case set is large and the
comparison is per case. The harness already supports `RUN_ONLY`; the gate names
the converted set and grows it as operations land.

## Risks / Trade-offs

- **TTY parity** (signals, resize, raw mode) → keep the CLI transport
  selectable and compare the interactive session on a real terminal as part of
  verification, not only under the stub.
- **Provider create mapping** (`--from-existing` semantics) → map it to the
  existing-credential request mode and keep the credential out of argv; a case
  asserts the sentinel still appears only in the designated field.
- **Fixture channel drift** between the CLI stub and the gateway → one writer
  (`run_maki_with_input`) and one reader per transport; a case that changes the
  fixture must fail on both.
- **Golden churn** → one re-record after all operations convert, reviewed per
  transport; no golden is edited by hand.

## Migration Plan

1. Add the fixture channel and make the existing CLI-stub cases pass through it
   without changing their recordings.
2. Convert rule listing and provider create; parity must report
   `transport-changed` before the CLI implementation is removed.
3. Convert sandbox create and the exec family; re-record the create and exec
   goldens once.
4. Run the parity gate over the whole converted set; delete the exemption list
   from the docs and the narrowed requirement from the spec.
5. Keep `OSA_GATEWAY_TRANSPORT=cli` as the rollback path and the parity input.

## Open Questions

Whether the interactive exec can match the CLI's signal timing exactly under
`SIGINT`; if it cannot, the session keeps a documented CLI exception and the
rest of this change still lands.
