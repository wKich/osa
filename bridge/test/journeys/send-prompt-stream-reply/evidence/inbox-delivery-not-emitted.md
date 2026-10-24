# inbox-delivery-not-emitted — reproduction

Captured before the `Translator.startTurn` fix with the production-shaped
harness (`OPENMAKI_CWD` = the journey workdir, `MAKI_MODEL` =
`synthetic/fake`), then re-recorded after the fix.

| Evidence | Path |
| --- | --- |
| pre-fix bridge frames | `inbox-delivery-not-emitted.frames.jsonl` |
| pre-fix final screen | `inbox-delivery-not-emitted.screen.txt` |
| pre-fix comparison (without an accepted difference) | `inbox-delivery-not-emitted.diff.json` |

The frames show `session.inbox.enqueued` and a complete assistant turn
(`session.text.started`, deltas, `session.text.ended`,
`session.execution.succeeded`) but no `session.inbox.delivered`. The screen
shows the observed symptom: `PONG` renders above the submitted user message,
because the TUI has not been told the prompt was consumed. (The reply text was
present; the ordering was wrong, not the reply missing.)

After the fix the same journey records `enqueued -> delivered -> text` and
`streamed` is equal apart from the accepted session-title difference.
