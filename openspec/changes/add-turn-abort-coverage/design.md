# Design

## Context

See proposal.md — Why. Two shipped paths already handle a dead child:

- `bridge/src/maki.ts` reports the child's `exit` through `onExit`;
  `bridge/src/bridge.ts`'s `onMakiExit` calls `Translator.abortTurn("maki
  process exited")`.
- `Translator.abortTurn` (`bridge/src/translator.ts:109-114`) returns early
  when no turn is open, otherwise emits `session.execution.failed` with
  `{error: {type: "Error", message}}` and closes the turn.
- A later prompt is refused by `prompt()` because `s.maki.running` is false
  (`bridge/src/bridge.ts`), answering 503.

The offline harness has two lenses: goldens replay `*.jsonl` frames through
the translator (no child process, so no exit), and `startBridge()` spawns the
real bridge entrypoint with `bridge/test/fake-maki.ts` on the
`MAKI_CHILD_CMD` seam. The abort path belongs to the second lens.

## Goals / Non-Goals

**Goals:**

- Make the child-exit half of turn termination executable with one seam knob,
  one offline test file, and one report row.
- Keep `make test-bridge` offline and free of new harness code.

**Non-Goals:**

- No translator or bridge runtime change: the shipped abort path is what gets
  pinned.
- No pinned `session.step.ended` on abort: the shipped path ends the
  execution only. If the TUI proves to need a step boundary, that is a
  runtime behavior change with its own spec delta.
- No coverage of the remaining unverified cross-map rows (interrupt, model
  switch, steering, attachments, retry visibility, SDK handshake, richer
  permission vocabulary): each needs runtime behavior the bridge does not
  have.

## Decisions

1. **A new file, `bridge/test/turn-abort.test.ts`, with its own bridge.**
   Child death is terminal for that bridge session, so folding the case into
   `session-api.test.ts` would make later tests depend on ordering and on a
   dead child. One extra spawned bridge keeps every other test deterministic.
2. **An env knob (`FAKE_MAKI_CRASH=1`), not a prompt-text marker.** The
   scripted child receives the same SDK flags as a real child, and
   `startBridge(extraEnv)` already exists for seam knobs. A magic prompt word
   would leak into ordinary prompts and could collide with a test that sends
   it for another reason.
3. **The crash frame is flushed with a write callback before `exit(1)`.**
   `process.exit` does not guarantee buffered stdout reaches the bridge; the
   child's last assistant frame must land so the test can prove partial output
   survives the abort. Emitting it and then exiting inside the write callback
   is deterministic without a sleep.
4. **Assertions are the API-level frames, not a golden.** The abort frame is
   produced by bridge lifecycle, not by wire input, so `runFixture` cannot
   express it. The test asserts: assistant text `ended`, exactly one
   `session.execution.failed` with `{type:"Error", message:"maki process
   exited"}`, zero `session.execution.succeeded`, then a 503 prompt with no
   new `session.execution.started`.
5. **The new report row is `turn-abort-mapping`, `verified`, citing the test
   path.** This follows `turn-failure-mapping`: a newly recorded behavior gets
   its own row rather than stretching an unrelated one. Evidence lives under
   `bridge/test/`, so archiving needs no path rewrite.

## Risks / Trade-offs

- [The bridge-owned message "maki process exited" is pinned by the
  assertion] → It is the only signal that distinguishes an abort from a
  result failure; a rewording is a deliberate change and should update the
  test and the row.
- [The abort path emits no `session.step.ended`] → The pinned claim is the
  execution boundary only; the limitation is recorded here and in the test
  comment rather than asserted away.
- [The crash knob crashes on the first prompt whenever it is set] → Only the
  dedicated test file sets it, through `startBridge(extraEnv)`, so no other
  suite sees the mode.
- [Statuses/report drift] → `make compat` regenerates
  `docs/compatibility.md` and fails on a diff; part of the task gate.
