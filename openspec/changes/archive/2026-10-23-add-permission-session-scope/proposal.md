# Proposal

## Why

Two reachable rows were `degraded` with `blockedBy: none`:
`permission-reply-vocabulary` (the bridge sends only bare `allow`/`deny`) and
`permission-reask` (`always` is honored for one call, so the TUI re-asks
forever). Both rested on the iteration-1 premise, decided with the user, that
Maki's wire has only `allow|deny`. At the pin it has four answers: Maki v0.6.4
decodes `allow` + `updatedPermissions` as `AllowSession` and `deny` + a
non-empty `message` as `DenyWithGuidance` (`src/sdk_mode.rs` L918–L927).
OpenCode v2.0.32's reply body carries `{decision, message}` (vendored OpenAPI),
and its TUI sends a rejection reason (`tui/src/routes/session/permission.tsx`
L136–L149). The iteration-4 triage marks both rows `capability`.

## What Changes

- `always` → `allow` with `updatedPermissions` (the stream-json session-rule
  shape; Maki only checks that the key is present). Maki adds a rule for the
  call's generalized scope; the bridge caches nothing.
- `reject` with a non-empty `message` → `deny` with `message`; otherwise a
  bare `deny`. `once` and the invalid-decision path are unchanged.
- `permission.asked` and the pending list advertise `save: [toolName]` instead
  of `["once"]`: the TUI renders `save` as the patterns "Always allow" covers.
- The scripted child models `AllowSession` (a session rule for `<word> *`,
  per maki-agent `permissions.rs` L685 and L1047–L1059); the live harness
  `api-check.ts` expects no re-ask after `always`.
- `permission-reply-vocabulary` → `verified`. `permission-reask` →
  `degraded` with `blockedBy: pin`: the TUI's copy says "for this project",
  and the SDK wire has no project-scoped answer (L918–L927).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `opencode-tui-bridge`: "Round-trip tool permissions" is replaced by "Round-trip
  tool permissions in Maki's answer vocabulary" (the session-scoped allow, the
  guided deny, and `save` replace the re-ask policy and the bare-answer rule).

## Impact

- Runtime: `bridge/src/bridge.ts` (`replyPermission`, `save`),
  `bridge/src/maki.ts` (`answer` extras).
- Tests: `bridge/test/permission-egress.test.ts`,
  `bridge/test/session-api.test.ts`, `bridge/test/fake-maki.ts`,
  `bridge/test/api-check.ts` (live harness, not in the offline gate).
- Report data: `bridge/compat/statuses.json`, `docs/compatibility.md`.
- TUI-visible: the "Always allow" panel lists the tool name; the gated TUI
  smoke (`make test-ui`) is rerun.
