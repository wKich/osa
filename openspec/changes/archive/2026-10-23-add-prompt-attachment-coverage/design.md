# Design

## Context

See proposal.md — Why. `prompt()` reads only `body.text` (`bridge/src/bridge.ts:265–273`)
before `Translator.beginTurn` records the user item and `MakiSession.prompt`
writes `{type:"user", message:{content:[{type:"text", text}]}}`
(`bridge/src/maki.ts:68–70`). The pinned Maki wire accepts base64 image blocks
in that same content array (`src/sdk_mode.rs` v0.6.4 L688, L805–L815), and
OpenCode's prompt POST accepts `files[]` as `PromptInput.FileAttachment`
(`bridge/src/openapi-2.0.32.json`, tag v2.0.32). The bridge neither reads nor
builds either shape. The scripted child records every inbound frame when
`FAKE_MAKI_TRACE` names a file (`bridge/test/fake-maki.ts:22,102`), the seam
`model-switch.test.ts` and `interrupt.test.ts` already use to prove what is or
is not sent.

## Goals / Non-Goals

**Goals**
- Pin the route's shipped admission of an attachment-bearing prompt: `200`
  with the text-only admitted user object.
- Pin the transcript half: `session.inbox.enqueued` carries the same text-only
  payload, with no `files`.
- Pin the wire half: the child receives exactly the text block, with no image
  block and no attachment URI.
- Make the "accepted but never delivered" limitation an asserted fact rather
  than an untested claim.

**Non-Goals**
- No `files[]` → Maki image-block forwarding: that is a runtime feature, not
  coverage.
- No change to `agents[]` / `skills[]` handling, prompt ids, delivery, or the
  dead-child 503 path.
- No work on the other three `unverified` rows (steering, retry visibility,
  the SDK handshake).

## Decisions

1. **A new test file, one spawned bridge.** The trace is a per-bridge env value
   and the lifecycle is the test's own; `prompt-attachments.test.ts` follows
   the one-bridge pattern rather than adding the trace knob to
   `session-api.test.ts`.
2. **Drive the prompt through the real route with a `files[]` entry.** The
   assertion has to prove the route does not reject a known field it ignores;
   posting the same body the TUI posts is the black-box evidence.
3. **Assert the exact text-only payload in both places.** The response
   `payload` and the `session.inbox.enqueued` item are checked for the text and
   for the absence of `files`; this fails if a future forwarding change starts
   claiming delivery without updating the row and this test.
4. **Assert on the child's inbound trace for the wire half.** The claim is
   about what the child did not receive, so the test reads the scripted child's
   recorded stdin and asserts one text content block, no block whose type is
   `image`, and no occurrence of the attachment URI in any frame.
5. **Wait for the turn's success before reading the trace.** The user frame is
   written before the result, but waiting for `session.execution.succeeded`
   proves the child consumed the prompt and the trace is complete.
6. **Status is `degraded`, not `verified`.** Admission is tested; the
   capability the row names — `files[]` becoming image blocks — does not exist.
   Its title is rewritten to name the limitation, as the interrupt and
   permission-vocabulary rows do.
7. **Spec delta is ADDED, not MODIFIED.** No existing requirement covers
   prompt attachments; the new requirement names the accepted-but-dropped
   contract without restating the prompt-translation requirement.

## Risks / Trade-offs

- [The test pins a limitation and would fail when forwarding lands] → That is
  the intended tripwire: the scenario names the text-only child frame
  explicitly, so implementing attachments must update the row, the spec, and
  this test together.
- [The fake child does not interpret image blocks, so the trace is the only
  evidence] → The trace is the wire itself, which is what the claim is about;
  the assertion checks both block type and URI text.
- [No fixture is added, so no provenance entry is needed] → Confirmed by
  `git status --short bridge/test/fixtures` staying empty.
