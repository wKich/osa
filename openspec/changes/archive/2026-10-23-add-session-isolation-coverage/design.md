# Design

## Context

See proposal.md — Why. The shipped facts the test relies on:

- `bridge/src/bridge.ts` keeps `sessions: Map<string, BridgeSession>`, and
  `createSession` constructs one `Translator` and one `MakiSession` per entry
  (`bridge/src/bridge.ts:189–247`).
- `onMakiFrame(sessionID, frame)` looks the session up by the id it was
  created with, so a child's frames can only reach that session's translator
  (`bridge/src/bridge.ts:298–328`).
- `DELETE /api/session/{id}` calls `s.maki.kill()` on that session's child and
  removes only that entry (`bridge/src/bridge.ts:341–346`).

The offline harness to use is the black-box one: `startBridge()` spawns the
real entrypoint with `bridge/test/fake-maki.ts` on `MAKI_CHILD_CMD`. The
scripted child is identical per session, so the test tells the children apart
by process id, not by wire content.

## Goals / Non-Goals

**Goals:**

- Make the per-session isolation the spec already claims executable with one
  offline test file and one report row.
- Cover concurrent turns (both prompts in flight at once), because sequential
  turns would not distinguish "isolated" from "the second prompt waited".

**Non-Goals:**

- No runtime change: isolation is shipped, this pins it.
- No model-list or announced-model isolation claim: `GET /api/model` reports
  one announcement for the whole bridge, and two identical scripted children
  cannot distinguish that path. A future row if it matters.
- No coverage of the remaining unverified cross-map rows (interrupt, model
  switch, steering, attachments, retry visibility, SDK handshake, richer
  permission vocabulary): each needs runtime behavior the bridge does not
  have.

## Decisions

1. **A new file, `bridge/test/session-isolation.test.ts`, with its own
   bridge.** `session-api.test.ts` is one shared session with ordering-sensitive
   turn counters; two more live children there would complicate its teardown
   assertions. One extra spawned bridge keeps both files deterministic.
2. **Map sessions to child pids by creation order.** `pgrep -P <bridge pid>`
   before and after the second `POST /api/session` names the second child: the
   constructor spawns synchronously, so one wait per creation is enough.
   Nothing in the wire distinguishes the identical scripted children.
3. **Assertions are per-session frame filters, not goldens.** A golden replays
   one fixture through one translator and cannot express two sessions. The
   test filters the single SSE subscriber by `data.sessionID` and asserts each
   transcript holds exactly its own prompt id, one `PONG`, and one success —
   plus that no frame names an unknown session.
4. **The new row is `session-isolation`, `verified`, citing the test path.**
   It follows `turn-abort-mapping`: a newly recorded shipped behavior gets its
   own row instead of stretching `session-crud`. Evidence lives under
   `bridge/test/`, so archiving needs no path rewrite.

## Risks / Trade-offs

- [Child-pid mapping by order] → Both children come from the same constructor
  path, so the wait for a new pid after the second create is the only ordering
  assumption; the test fails loudly (`pidB > 0`) if the child never appears.
- [A single bridge's SSE stream also carries the second session's frames] →
  That is the point: the filters prove frames do not cross rather than
  proving each stream is alone.
- [Statuses/report drift] → `make compat` regenerates `docs/compatibility.md`
  and fails on a diff; part of the task gate.
