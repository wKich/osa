# Proposal

## Why

`prompt-attachments` was `degraded` with `blockedBy: none`: the bridge accepted
`files[]` and dropped it, so an image pasted into the TUI never reached the
model. Both pins support images. Maki v0.6.4's inbound `user` content decodes
base64 image blocks (`src/sdk_mode.rs` L688, L807–L816) in png/jpeg/gif/webp
(`maki-providers/src/types.rs` L30–L35). OpenCode v2.0.32's TUI sends pasted
images as `data:` URIs (`tui/src/component/prompt/local-attachment.ts` L55)
and reads delivered files back as `Prompt.FileAttachment`
(`schema/src/prompt.ts` L26–L34). The iteration-4 triage marks it `capability`.

## What Changes

- `files[]` entries with an image `data:` URI in Maki's media types become
  base64 image blocks after the text block on the child's `user` frame.
- The admitted prompt's `payload` and the `session.inbox.enqueued` item list
  the forwarded files as inline `Prompt.FileAttachment`s; with nothing
  forwarded they stay text-only.
- PDFs and other `data:` types are dropped: the pinned inbound `user` has only
  text and image blocks (L786–L816). `file://` URIs (@-mentions) are not read:
  the bridge reads no host path on a client's behalf.
- `prompt-attachments` → `degraded` with `blockedBy: pin` (the PDF remainder),
  and a new `prompt-file-mentions` row → `out-of-scope` with that reason.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `opencode-tui-bridge`: "Accept prompt attachments without claiming they were
  delivered" is replaced by "Forward image attachments to the Maki child".

## Impact

- Runtime: `bridge/src/bridge.ts` (`promptImages`, prompt payload),
  `bridge/src/maki.ts` (`prompt` image blocks), `bridge/src/translator.ts`
  (inbox payload files).
- Tests: `bridge/test/prompt-attachments.test.ts` (rewritten). No fixture
  file, so no provenance entry.
- Report data: `bridge/compat/statuses.json`, `docs/compatibility.md`.
- Security: no new host read; attachment bytes come only from the request body.
