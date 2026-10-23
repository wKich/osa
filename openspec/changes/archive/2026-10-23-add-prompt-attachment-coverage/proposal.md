# Proposal

## Why

The newest cross-map records `prompt-attachments` as `unverified`: the OpenCode
prompt POST carries `files[]` (`PromptInput.FileAttachment`), and the pinned
Maki inbound `user` content accepts base64 image blocks
(`src/sdk_mode.rs` v0.6.4 L688, L805–L815, https://github.com/tontinton/maki),
but the bridge reads only `body.text` (`bridge/src/bridge.ts:265–273`). No test
drives a prompt with attachments, so a future change could start claiming the
model saw a file — or silently start forwarding it — without the offline suite
noticing. This slice pins the shipped limitation; forwarding attachments is a
runtime feature and stays out.

## What Changes

- Add `bridge/test/prompt-attachments.test.ts`: one spawned bridge and one
  prompt carrying `files[]`, asserting the route admits it (`200`), the
  response and `session.inbox.enqueued` carry only the text, and the Maki child
  receives one text content block with no image block or attachment URI.
- Move the `prompt-attachments` feature row from `unverified` to `degraded`
  with that test as evidence, and title it as the limitation it is: attachments
  are accepted but dropped.
- Regenerate `docs/compatibility.md`.
- No bridge or translator runtime change, and no fixture file (the scripted
  child and its inbound trace already cover the wire half).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `opencode-tui-bridge`: adds one requirement that a prompt carrying `files[]`
  is admitted but not forwarded — only the text reaches the child — so the
  transcript makes no claim that the attachment was delivered.

## Impact

- Tests: `bridge/test/prompt-attachments.test.ts` (new; reuses
  `bridge/test/lib/bridge.ts` and the `FAKE_MAKI_TRACE` scripted-child seam).
- Report data: `bridge/compat/statuses.json` (one feature row),
  `docs/compatibility.md` (regenerated).
- No runtime, API, dependency, sandbox, or security-surface change. The suite
  stays offline: no Docker, gateway, network, or provider call.
