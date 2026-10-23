# Proposal

## Why

The permission round trip is `verified` by its effects — an allowed call runs,
a denied call does not — but no test asserts the frame the bridge actually
writes to the child. The bridge's only control-plane egress, the
`control_response` naming Maki's `request_id` and `behavior`
(`sdk_mode.rs` v0.6.4 L918–L927; captured spelling in
`bridge/test/fixtures/maki-permission.jsonl`), is exactly the seam where a
wrong id or a dropped answer would leave the child blocked forever. Two report
rows for that seam are `unverified`: `control-response-emission` and
`permission-reply-vocabulary`.

## What Changes

- Add `bridge/test/permission-egress.test.ts`: one spawned bridge with the
  scripted child's inbound trace on `FAKE_MAKI_TRACE`, pinning that each
  answered ask writes exactly one `control_response`
  `{response:{request_id, behavior}}` whose id is the one Maki sent and whose
  `behavior` is `allow` for `once`/`always`, `deny` for `reject`/invalid, and
  that no richer shape (`updatedPermissions`, `message`) is written.
- Flip `control-response-emission` to `verified` with that test as evidence,
  and correct its title to describe the bridge's egress (the current title
  mixes the two directions of the wire).
- Move `permission-reply-vocabulary` to `degraded` with that test as
  evidence: the bridge deliberately sends only bare `allow`/`deny`, so the
  richer Maki shapes remain unimplemented and are now visible as a limitation
  rather than an untested claim.
- Regenerate `docs/compatibility.md`.
- No bridge runtime change.

## Capabilities

### New Capabilities

(none — no new capability path)

### Modified Capabilities

- `opencode-tui-bridge`: the existing "Round-trip tool permissions"
  requirement gains one scenario pinning the wire answer itself (its id and
  its bare behavior). No requirement text changes.

## Impact

- Test assets: `bridge/test/permission-egress.test.ts` (new),
  `bridge/test/fake-maki.ts` (records its outbound `can_use_tool` ask with
  `dir:"out"` so a test can pair the bridge's answer with the child's
  request id), and `bridge/test/agent-switch.test.ts` (its "no control
  frame" filter now ignores outbound asks). No new fixture, so no provenance
  entry.
- Report data: `bridge/compat/statuses.json` (two row edits),
  `docs/compatibility.md` (regenerated).
- No runtime, API, dependency, sandbox, or security-surface change. The suite
  stays offline: no Docker, gateway, network, or provider call.
