# Design

## Context

Pinned wire, cited before code:

- Maki v0.6.4 `src/sdk_mode.rs`: an inbound `user` frame's content is read
  twice. `content_text` (L786–L804) joins the `text` blocks, and
  `content_images` (L807–L816) deserializes each `{"type":"image","source":…}`
  block into `ImageSource` and silently skips malformed ones. Both are applied
  at L687–L688. No other block kind is read.
- `maki-providers/src/types.rs` v0.6.4 L30–L35: `ImageMediaType` is png, jpeg,
  gif, webp.
- OpenCode v2.0.32: `PromptInput.FileAttachment` is `{uri, name?,
  description?, mention?}` (`schema/src/prompt-input.ts`); the TUI encodes
  pasted images and PDFs as `data:<mime>;base64,…` (`local-attachment.ts` L55,
  L167) and @-mentions as `file://` URIs (`autocomplete.tsx` L249–L268); the
  delivered shape is `Prompt.FileAttachment {data, mime, source, name?,
  description?, mention?}` (`schema/src/prompt.ts` L26–L34) with
  `source:{type:"inline"}` for inline bytes.

## Goals / Non-Goals

**Goals**
- Deliver pasted images to the model.
- Report back only what was delivered.

**Non-Goals**
- PDFs: no block at the pin.
- Reading `file://` paths: the bridge never reads host files for a client, and
  the request comes from any loopback caller. The mention text is already in
  the prompt, and Maki reads the project from its own workdir.
- Image resizing or validation beyond the base64 alphabet: Maki adapts images
  per model (`adapt_images_for_model`).

## Decisions

1. **Strict `data:` match.** The regex accepts only `data:image/<maki type>;
   base64,<canonical base64>` (the pinned `Prompt.Base64` pattern). Anything
   else is dropped rather than forwarded raw, because Maki would skip a
   malformed block silently while the TUI showed it as delivered.
2. **Text first, then images.** It matches the stream-json order and
   `content_text`'s join, so the prompt text is unchanged.
3. **Delivered files echo the inline shape.** `name` and `description` are
   kept; `mention` is dropped, because its offsets index the TUI's draft, not
   the delivered text.
4. **Two rows.** `prompt-attachments` stays `degraded` and becomes
   `blockedBy: pin` (PDFs are the remainder). `prompt-file-mentions` is a new
   `out-of-scope` row, a deliberate boundary rather than a pin limit, so the
   two exits stay distinguishable.

## Risks / Trade-offs

- [Large images inflate one stdin line] → The TUI already caps attachment
  bytes (`local-attachment.ts`); Maki reads stdin line by line with no fixed
  limit.
- [Dropping `file://` loses inlined file content the real server would add] →
  Recorded as `prompt-file-mentions` with the reason; the model still sees the
  `@path` and can read it in the sandbox.
