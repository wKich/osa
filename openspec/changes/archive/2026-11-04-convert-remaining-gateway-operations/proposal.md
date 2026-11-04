# Proposal

## Why

`add-openshell-sdk-transport` converted the operations the typed client could
express without changing a command's behaviour: sandbox `start`, `stop`,
`delete`, `get`, and `list`, the waits, `logs`, provider `list`/`attach`/
`detach`, and rule approval. It left four command paths on the OpenShell CLI and
named them in `docs/helper.md`:

- `sandbox create`, because its argv is the visible argument surface and the
  create-race exit status is part of the behaviour;
- the interactive session exec and the script/probe execs, because the typed
  exec cannot inherit a terminal's stdin and the fake gateway cannot otherwise
  receive the per-run fixtures;
- `provider add`/`provider setup`, because `--from-existing` and
  `--global-profile` have no request field in `ProviderSpec`;
- `policy review` and the pending-proposal note, because they render the CLI's
  full policy text.

Those exemptions are honest but they are debt. Every one of them keeps argv
assembly and output parsing in a path that the transport spec already calls
covered, and each makes a future OpenShell release capable of changing a
command's behaviour through its CLI rather than its RPC surface. This change
finishes the conversion and removes the exemptions.

## What Changes

- Extend the typed exec path for the interactive session: a bidirectional
  stream carrying stdin, TTY mode, resize, and output, with the process's exit
  status reported separately. The session, the timeout wrapper, and the
  script/probe helpers move to the client.
- Replace `ProviderSpec`'s credential-only shape with the full create surface:
  `--from-existing`, `--global-profile`, runtime credentials, named credential
  fields, and config pairs, mapped to the generated provider RPCs.
- Convert `sandbox create` and let the transport record the full spec (image,
  policy path, resources, providers, environment names) so the conformance
  arguments stay reviewable.
- Render `policy review` and the pending-proposal note from the structured rule
  listing, including chunk id, rule name, binary, endpoints, and prover verdict,
  matching the CLI text.
- Give the fake gateway the per-run fixtures the CLI stub receives today, so a
  case that runs an exec, a script probe, or a rule read behaves the same over
  both transports.
- Make the CLI-transport parity run part of the gate: the converted set must
  report `transport-changed` or `identical` with no state or output divergence.
- Delete the exemption list from `docs/helper.md` and the narrowed requirement
  from the `gateway-client` spec.

## Capabilities

### Modified Capabilities

- `gateway-client`: the covered-operation requirement loses its exemptions;
  interactive exec, the provider create surface, sandbox create, and rule
  listing become converted operations with their own requirements; the fake
  gateway is required to receive per-run fixtures.
- `helper-conformance`: parity mode becomes a gate over the converted set.

## Impact

- Code: `gateway/mod.rs` (trait signatures), `gateway/sdk.rs` (interactive exec,
  provider create, rule rendering, create spec), `gateway/cli_transport.rs`
  (the same operations for parity and rollback), `stub-gateway` (fixture
  plumbing and interactive exec), and the calling modules under `agent/`.
- Tests: the per-run fixture channel (`STUB_EXEC_STDOUT`, `STUB_EXEC_CASES`,
  `STUB_RULE_PENDING`, and the create arguments) reaches the gateway; the
  conformance goldens are re-recorded once; parity runs in the gate.
- Security: no new egress surface. Credentials continue to travel in the
  designated request field; the provider create conversion must keep
  `--from-existing` from becoming a second credential channel.
- Risk: the interactive exec is the hard part (TTY parity, signal ownership,
  resize). The change keeps the CLI transport selectable until parity passes.

## Status

Planned. Depends on `add-openshell-sdk-transport` (its converted set, CLI
transport, and transport-per-case conformance harness). Archive that change
first: this change's `gateway-client` delta modifies a requirement that change
introduces, and OpenSpec only accepts that delta once the capability exists in
the main specs. Until then `openspec validate` reports the expected archive
info, not an error.
