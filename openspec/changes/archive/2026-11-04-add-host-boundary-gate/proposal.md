# Proposal

## Why

The isolation checks and the live journey run need a real gateway, a real
engine, and a real container: they are statements about the boundary, so they
can only execute where the boundary is. Today they are a hand-run checklist in
`docs/ai/verification/`, nothing connects a patch authored inside a sandbox to
them, and nothing in the repository states which green pass proves which claim —
so an in-sandbox result can be mistaken for a boundary result.

## What Changes

- Add `make test-boundary`, a host-only gate that runs `make test-all`, the
  live journey run, and a scripted version of the isolation checklist (egress
  denial, placeholder-only credential variable, host paths invisible, non-root
  identity, no bind mount, gateway-log refusal). Each check fails instead of
  instructing a human to stop.
- Define the handoff: work authored inside a sandbox leaves as a patch through
  caller-mode `collect-patch`; the host applies it to a throwaway checkout and
  runs the gate with a fixed command. Nothing in the sandbox may choose the
  command that runs on the host, and nothing runs automatically on a patch the
  sandbox produced.
- Add the layer-claim table to `docs/ai/verification/`: which suite is
  authoritative for parsing, transport, orchestration, and boundary, and the
  rule that a sandbox pass is never evidence for a boundary claim.
- Add the boundary-run record format to `docs/verification-log.md`, naming the
  gateway and engine versions, the patch commit, and the checks that ran.
- Keep `make test-all` unchanged in meaning; the boundary gate composes it.

## Capabilities

### New Capabilities
- `boundary-verification`: the host-only gate that composes the full suite,
  the live journey run, and the scripted isolation checks; the patch handoff
  contract from a sandbox; and the claim table that scopes every result to the
  layer it proves.

### Modified Capabilities
- None. `test-gate` continues to define `make test-all`; the boundary gate runs
  it rather than redefining it, and the isolation checks keep the meanings
  `sandbox-policy` already states.

## Impact

- New: `tests/boundary/` (scripted isolation checks and their harness) and
  `docs/ai/verification/claims.md` (the layer-claim table).
- Modified: `Makefile`, `docs/ai/verification/{maki,opencode,claude,codex}.md`
  (point the hand-run sections at the scripted gate), `docs/verification-log.md`,
  and optionally `.github/workflows/` if the gate joins CI.
- Dependencies: `add-insandbox-e2e-suite` for the patch handoff, and a host
  with a reachable gateway and engine for the gate itself.
- Security: the gate is the only place a real boundary claim is produced; it
  adds no egress rule and no credential handling beyond what
  `docs/ai/verification/` already requires.
