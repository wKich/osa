# Design

## Context

Pinned wire, cited before code:

- Maki v0.6.4 `src/sdk_mode.rs` `decode_permission_response` (L918–L927):
  `allow` with an `updatedPermissions` key → `AllowSession`; bare `allow` →
  `AllowOnce`; `deny` with a non-empty string `message` →
  `DenyWithGuidance(message)`; anything else → `Deny`. Only key presence is
  read. There is no project or global answer on this wire, though Maki has
  them internally (`AllowAlwaysProject`/`Global`, maki-agent `permissions.rs`).
- maki-agent `permissions.rs` `apply_decision` (L670–L700): `AllowSession` adds
  session rules for the generalized scopes; a bash segment generalizes to
  `<first word> *` (L1047–L1059).
- OpenCode v2.0.32: the reply route body is `{decision, message?}` (vendored
  OpenAPI); `Permission.Request.save` is optional `string[]`
  (`packages/schema/src/permission.ts`); the TUI offers "Always allow" only
  when `save` is non-empty and describes it as "This will always allow the
  following patterns for this project" (`tui/src/routes/session/permission.tsx`
  L233–L240, `tui/src/util/permission.ts` L154–L160).

## Goals / Non-Goals

**Goals**
- Send every answer the pinned decoder understands, from the TUI reply that
  means it.
- Keep the bridge stateless about decisions: Maki owns session rules.

**Non-Goals**
- Project or global persistence of `always`: the SDK wire cannot express it.
- Computing Maki's generalized scope in the bridge: `save` names the tool, not
  Maki's internal pattern.
- The `action` field of `permission.asked` (still `allow`).

## Decisions

1. **`updatedPermissions` carries the stream-json session-rule shape**
   (`[{type:"addRules", rules:[{toolName}], behavior:"allow",
   destination:"session"}]`). Maki reads only presence, so any value works; the
   conventional shape keeps the frame meaningful to other SDK consumers.
2. **Empty or null `message` stays a bare `deny`.** That matches the decoder's
   `!msg.is_empty()` guard and keeps the old frame for the common case.
3. **`save: [toolName]`.** `["once"]` was a reply name rendered as a pattern.
   The tool name matches `resources` and is the closest truthful pattern the
   bridge knows; the exact scope is Maki's.
4. **The scripted child models `AllowSession`**, citing the pinned
   generalization, so the offline test shows the end-to-end effect (no ask for
   a matching call in that session, an ask in another session) while the
   bridge-side assertion stays the wire frame.
5. **`permission-reask` becomes `degraded`/`pin`, not `verified`.** The TUI
   promises project scope; Maki grants session scope; the pinned decoder is
   the limit.

## Risks / Trade-offs

- [This reverses a policy decided with the user] → The policy's stated reason
  ("only allow|deny") is contradicted by the pinned decoder; the final report
  flags the reversal.
- [Maki's session rule is broader than one command (`rm *`)] → That is Maki's
  documented `AllowSession` behavior; the TUI's "Always allow" already promises
  a broader grant.
- [Tests sharing one child would inherit a session rule] → `always` cases run
  in fresh sessions.
