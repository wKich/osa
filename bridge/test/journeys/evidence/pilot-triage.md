# Pilot triage (task 4.3)

Three pilot journeys were recorded with `make test-journeys`; all three are
`diverges`. This file records one hand-off per differing checkpoint. Nothing
here is fixed in `add-journey-harness`.

## send-prompt-stream-reply

Committed comparison: `bridge/test/journeys/send-prompt-stream-reply/diff.json`.

| Checkpoint | Difference | Hand-off |
| --- | --- | --- |
| `user-message` | The Maki tab shows the timestamp fallback title `New session - <TIME>`; the reference shows the generated title `Journey`. The transcript is otherwise empty on both sides (the reply has not started). | Session-title generation, route-queue finding: the bridge has no title-generation path, so the TUI falls back to a timestamped title. Hand off to a coverage/capability change, not this one. |
| `streamed` | The Maki transcript renders `PONG` **above** the submitted user message; the reference renders the user message first, then the reply. | `message-order-inversion` (transcript-order). The inventory marks this `fixed`, but the pilot reproduces the symptom end to end. Reopen it and hand off to a fix change; the golden asserts frame order, the TUI still renders the assistant row first. |

## allow-permission-once

Committed comparison: `bridge/test/journeys/allow-permission-once/diff.json`.

| Checkpoint | Difference | Hand-off |
| --- | --- | --- |
| `permission-prompt` | The reference dialog shows the command (`$ rm -f probe.txt`); the Maki dialog shows a generic tool (`⚙ Call tool allow`, `Tool: allow`). The dialog chrome and choices are otherwise identical. | New permission-dialog finding: the bridge's `permission.asked` payload does not carry the tool input the reference dialog renders. Hand off to a fix change against the permission mapping; `permission-round-trip` covers the API round trip but not the dialog body. |
| `allowed` | The Maki transcript puts the tool result and `DONE` above the user message; the reference keeps the user message first. The empty command output is `(no output)` on the reference and a blank row on the Maki side. | `message-order-inversion` (same as above). The blank-output row is the bridge's rendering of an empty tool result and is recorded as part of the same hand-off. |

## resume-session-history

Committed comparison: `bridge/test/journeys/resume-session-history/diff.json`.
The script creates ALPHA in one session, restarts the TUI with the session
store intact, then reopens ALPHA from the session list. The restart is what
makes the cold client fetch history; a same-process reopen renders from the
live cache and never calls the message route.

| Checkpoint | Difference | Hand-off |
| --- | --- | --- |
| `session-list` | The reference lists `Journey`; the Maki side lists the timestamp fallback (`New session - <TIME>`), and the transcript pane is empty after the cold start. | Session-title generation (same route-queue finding as above). |
| `history-visible` | **Unreached**: after selecting the earlier session the Maki transcript does not render ALPHA. The Maki request log now contains `GET /api/session/{sessionID}/message` (and `GET /api/session/{sessionID}/inbox`), so the deferred-empty answer is measured. | Capability hand-off: implement session message history behind `GET /api/session/{sessionID}/message`; the route is now `reachable` with status `deferred`. This is a coverage/capability change, not a harness change. |

## Why these are hand-offs, not harness changes

- The harness compared normalized snapshots deterministically: two consecutive
  `make test-journeys` runs produced byte-identical snapshots, diffs, and logs.
- The title, permission-dialog, and transcript-order differences survive
  normalization on purpose. They are user-visible behavior, not volatile
  tokens, so accepting them would hide real gaps.
- The reference run stayed reliable on all three pilots; no Maki-side failure
  aborted a reference run.

## After `fix-journey-oracle`

`send-prompt-stream-reply` is `parity`: the delivered frame fixed the
transcript order and the session-title difference is accepted with a written
reason. `allow-permission-once` stays `diverges` (the permission dialog body),
and `resume-session-history` stays `broken` (`history-visible` is unreached).
