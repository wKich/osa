# Spec Delta

## ADDED Requirements

### Requirement: Accept prompt attachments without claiming they were delivered
The bridge SHALL accept a prompt whose request carries `files[]` (OpenCode's
`PromptInput.FileAttachment` with `uri` and optional `name`) and admit it like
any other prompt: `200` with the admitted `Session.Inbox.User`, and one
`session.inbox.enqueued` user item. Because the bridge does not build the Maki
inbound image blocks the pinned wire accepts, it MUST NOT claim the attachment
was delivered: the response's `payload` and the enqueued user item SHALL carry
only the prompt text, with no `files`, and the Maki child SHALL receive only a
text content block — no image block and no attachment URI. An unknown session
SHALL answer `404` `SessionNotFoundError` and write no frame to any child.

#### Scenario: An attachment-bearing prompt is admitted with text only
- **WHEN** the TUI submits a prompt whose body carries prompt text and one
  `files[]` entry naming a URI
- **THEN** the route answers `200`, the response's admitted user payload
  carries the text and no `files`, and the `session.inbox.enqueued` item
  carries the same text-only payload

#### Scenario: The child receives no attachment
- **WHEN** an attachment-bearing prompt is admitted
- **THEN** the Maki child receives one `user` frame whose content is exactly
  the prompt text block, with no image content block and no attachment URI

#### Scenario: An unknown session is not a silent success
- **WHEN** an attachment-bearing prompt names a session the bridge does not
  know
- **THEN** the route answers `404` with `_tag: "SessionNotFoundError"` and no
  frame is written to any child
