# Proposal

## Why

The `permission-reask` row of the compatibility report claims a behavior the
offline gate has never exercised: its only evidence is the archived live
`api-check.log`, so `make test-bridge` proves nothing about the re-ask policy
the spec already commits to ("A reply of `always` SHALL be honored for that
one call only; every later tool call re-prompts"). The same subsystem has a
second untested path: `replyPermission` fails closed on a reply whose decision
is not `once`/`always`/`reject`, and that behavior has neither a test nor a
spec scenario.

## What Changes

- Add two tests to `bridge/test/session-api.test.ts` over the existing
  `MAKI_CHILD_CMD` scripted-child seam: (1) a reply of `always` allows that one
  call and the next gated call asks the TUI again, nothing cached; (2) an
  invalid decision answers 400, answers Maki `behavior: deny`, and leaves the
  target untouched.
- Move the `permission-reask` row's evidence in `bridge/compat/statuses.json`
  from the archived live log to `bridge/test/session-api.test.ts`. The status
  stays `degraded`: the recorded limitation (Maki's wire offers only
  `allow`/`deny`, so `always` can never persist) is a property of the wire, not
  of the test, and was a deliberate row decision.
- Regenerate `docs/compatibility.md` through `make compat` so the evidence
  link changes.
- No bridge runtime code changes — the tests pin shipped behavior
  (`bridge/src/bridge.ts` reply handling) as it stands.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `openspec/specs/opencode-tui-bridge`: the "Round-trip tool permissions"
  requirement gains a scenario pinning that a reply with an invalid decision
  fails closed instead of letting the tool through.

## Impact

- Tests: `bridge/test/session-api.test.ts` (two new cases in the existing
  describe block, reusing the spawned-bridge harness; no fixture file needed —
  `fake-maki.ts` already issues a fresh `can_use_tool` for each gated command).
- Statuses/report: `bridge/compat/statuses.json` (evidence string only),
  `docs/compatibility.md` (regenerated).
- No runtime, API, dependency, or security-surface change: the sandbox
  invariants and the `MAKI_CHILD_CMD` seam are untouched.
