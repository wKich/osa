# Spec Delta

## REMOVED Requirements

### Requirement: Accept prompt attachments without claiming they were delivered
**Reason**: The bridge now forwards image attachments as the base64 image
blocks the pinned Maki wire decodes; "accepted but dropped" no longer holds for
images.
**Migration**: Replaced by "Forward image attachments to the Maki child"
below; the unknown-session scenario carries over unchanged, and the text-only
shape remains for prompts with nothing deliverable.

## ADDED Requirements

### Requirement: Forward image attachments to the Maki child
The bridge SHALL translate each prompt `files[]` entry whose `uri` is a base64
`data:` URI of type `image/png`, `image/jpeg`, `image/gif`, or `image/webp`
into a Maki inbound image content block
(`{type:"image", source:{type:"base64", media_type, data}}`) after the prompt's
text block. The admitted prompt's `payload` and the `session.inbox.enqueued`
user item SHALL list exactly the forwarded files as inline
`Prompt.FileAttachment` entries (`data`, `mime`, `source:{type:"inline"}`, and
`name`/`description` when given), and SHALL carry only the text when nothing
was forwarded. Entries the pinned wire cannot carry (PDF and other `data:`
types, malformed base64) and `file://` URIs MUST NOT reach the child in any
form; the bridge MUST NOT read a host path named by a `file://` URI. An
unknown session SHALL answer `404` `SessionNotFoundError` and write no frame
to any child.

#### Scenario: An image attachment reaches the child
- **WHEN** the TUI submits a prompt with a `data:image/png;base64,…` entry in
  `files[]`
- **THEN** the child's `user` frame carries the text block followed by one
  base64 image block with media type `image/png` and the same data, and the
  admitted payload and inbox item list that file as an inline attachment

#### Scenario: Undeliverable attachments are dropped
- **WHEN** `files[]` also carries a PDF `data:` URI, a `file://` URI, an
  unsupported image type, or malformed base64
- **THEN** none of them appears in the child's frames or in the admitted
  payload, and no host file is read

#### Scenario: A prompt without attachments is unchanged
- **WHEN** a prompt carries no deliverable file
- **THEN** the admitted payload and inbox item carry only the text, and the
  child receives exactly one text content block

#### Scenario: An unknown session is not a silent success
- **WHEN** an attachment-bearing prompt names a session the bridge does not
  know
- **THEN** the route answers `404` with `_tag: "SessionNotFoundError"` and no
  frame is written to any child
