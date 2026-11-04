# Proposal

## Why

The suite stops at the argv seam: it asserts which `openshell` invocation the
helper would run, with canned exec output. Nothing proves that a session
actually moves the working tree, runs the agent, collects a patch, or resolves
pending work — and none of it can run inside a sandbox. An agent that edits
`session.rs` or `commands.rs` therefore has no way to see its change work.

## What Changes

- Add one end-to-end suite, `tests/e2e/`, that drives the four front-ends as
  black boxes against the insandbox control plane and asserts observable
  outcomes rather than argv: files present or absent in the workspace, exit
  codes, registry and marker state, collected patches, and process lifetime.
- Cover, for each front-end: `up` then a scripted agent run then outcome
  collection; upload and download; `status`, `list`, `logs`, `doctor`,
  `policy`, and `provider` reads; `start`, `stop`, and `rm` including the
  refusal while work is pending; caller-mode `sync-in` and `collect-patch`;
  `resolve` apply, branch, and drop; idle stop; and an interrupted session that
  must leave resumable work.
- Use scripted fake agent binaries, so every case is deterministic and offline.
- Add one opt-in real-agent smoke case that performs a single headless turn
  through the outer sandbox's provider attachment, and is skipped, by name,
  when no provider is attached.
- Compare the same scenarios against host-recorded real-gateway transcripts
  through the existing parity mode, so the plane cannot drift silently from the
  gateway it imitates.
- Add two targets: `make test-e2e-local` (in a sandbox, against the plane) and
  `make test-e2e` (on a host, against a real gateway). Neither joins
  `make test`; each skips cleanly with a named reason when its prerequisites
  are absent.
- Document which pass proves which layer, so an in-sandbox green is never cited
  for an isolation claim.

## Capabilities

### New Capabilities
- `insandbox-e2e`: the end-to-end scenario set that runs the four front-ends
  inside an osa sandbox against the local control plane, the outcomes it
  asserts, the host comparison that keeps it honest, the optional real-agent
  smoke case, and the layer-claim table that scopes what a pass means.

### Modified Capabilities
- None. The parity requirement in `helper-conformance` already compares two
  selected backends; the recorded real-gateway fixtures are inputs to it, not a
  change to what it requires. `test-gate` keeps its meaning: `make test-all`
  still names the suites it runs, and the new targets do not join it.

## Impact

- New: `tests/e2e/` (harness, cases, fixtures), scripted agent binaries under
  it or under `tests/stub/`, and committed host-recorded transcripts.
- Modified: `Makefile` (two targets), `docs/ai/dev-environment.md`, and
  `docs/ai/verification/` (the layer-claim table).
- Dependencies: the insandbox control plane, the `add-osa-dev-environment`
  image, and `add-openshell-sdk-transport`.
- Security: cases assert placeholder-only provider variables by name and never
  a value; the suite adds no egress and no credential.
