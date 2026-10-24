# Design

## Source of the transcript

The SDK wire has no history read, and a Maki session file in the sandbox
(`maki-storage` JSONL) stores Maki's own message model, not OpenCode's. The
bridge already emits every OpenCode frame the TUI renders, so projecting
those frames reproduces exactly what a live TUI built — the same way the real
server's projector builds its store from the same events. The bridge's
sessions live in the bridge process, so the history has the same lifetime as
the session list it belongs to.

## Projection

`SessionHistory.apply` handles the frame types the bridge emits:
`session.inbox.enqueued/delivered/cancelled` (a user message appears at
delivery, with its prompt payload), `session.step.started/ended`,
`session.text.*`, `session.reasoning.*`, `session.tool.input.*`,
`session.tool.called/success/failed`, `session.retry.scheduled`, and the
terminal execution frames (an idle marker whose id is the event id with the
`msg_` prefix, as `messageIDFromEvent` mints it). Order is emission order.

## Paging

Mirrors `server/src/handlers/message.ts`: `cursor` with `order` is a 400
`InvalidCursorError`; an undecodable cursor is the same 400; a non-empty page
always carries `previous` and `next` cursors for its first and last message.
