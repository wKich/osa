# Design

## Context

The real server derives the map from `RunCoordinator.active`, the keys of its
in-flight executions (`core/src/session/run-coordinator.ts` v2.0.32 L179). The
TUI marks every key `running` and treats missing keys as idle
(`client/src/solid/data.ts` L644). Execution events override the snapshot.

## Decisions

1. **An open turn is an execution.** `Translator.inTurn` is true from
   `session.execution.started` until the turn's result. That is the same
   window in which the real server lists the session. A dead child is never
   listed.
2. **A queued prompt is not a second entry.** A queued prompt sits behind the
   running turn of the same session, which is already listed.
