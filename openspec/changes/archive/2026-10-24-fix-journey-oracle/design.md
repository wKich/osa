# Design

## Context

See `proposal.md` — Why. The facts the design rests on:

- `send-prompt-stream-reply` is the first committed journey. Its Maki side
  emits a complete turn in `maki-frames.jsonl`, and the `streamed` checkpoint
  renders `PONG`, but above the submitted user message instead of below it.
  The reference side reaches the same checkpoint with the prompt first.
- A reproduction that adds one `session.inbox.delivered` frame in
  `Translator.beginTurn` orders the prompt before the reply. The current code
  emits `session.inbox.enqueued` and starts the turn immediately, but only
  emits `delivered` for a prompt that waited behind another turn.
- `transcript-order` and `stream-deltas` are `verified` via
  `bridge/test/golden.test.ts`; `message-order-inversion` is `fixed`. The
  golden projection asserts the bridge's event sequence, not the TUI's
  dependency on the delivered event.
- `record.ts` runs the bridge with `OPENMAKI_CWD: ROOT` and without
  `MAKI_MODEL`; `bin/maki-oss` uses the sandbox workdir and the resolved
  model. The committed snapshot therefore shows the repository branch and the
  fake sandbox's first model, not the journey's workdir and scripted model.
- `make test-journeys` is not a Makefile target yet. `crosscheck.test.ts`
  checks that journey evidence paths exist, not that the committed diff
  reproduces the status. `make compat` is currently red because
  `docs/compatibility.md` predates the pilot's catalog change.

## Goals / Non-Goals

**Goals:**
- The TUI journey is the independent oracle for native claims.
- The bridge's first user-visible journey completes and renders.
- The harness is deterministic, production-shaped, and self-explaining when a
  checkpoint is unreached.
- The offline suite can reproduce every journey verdict from committed files.
- The skills tell the next agent to use the journey, not the route/feature
  matrix, as proof.

**Non-Goals:**
- Implementing the remaining 50+ journeys.
- Implementing the full live runner; only the first live smoke is in scope.
- Fixing the deferred `GET /api/session/{sessionID}/message` surface used by
  `resume-session-history`; that remains a route-queue finding.
- Adding a session-title generator to the bridge. The title difference is
  recorded as an accepted difference with a reason.
- Changing the sandbox, image, policy, provider profiles, or egress.

## Decisions

### 1. Deliver the prompt at turn start, not at enqueue

`beginTurn` currently enqueues the user item and calls `startTurn` in the same
branch for an idle session. `startNext` already emits `delivered` for a queued
turn. Move the delivered emission into the common turn-start path so both
paths agree:

```
beginTurn
  +-- turn running --> enqueue + queue; delivered later at startNext
  +-- turn idle    --> enqueue + startTurn --> delivered
```

Alternative rejected: emit `delivered` at enqueue for every prompt. That
would report a queued prompt as consumed before the runner starts it, which
contradicts the inbox state the TUI shows while a turn is running.

The event remains durable on the session (`DURABLE_VERSION` already has
`session.inbox.delivered`). The golden for the plain turn gains the delivered
frame and the journey becomes the regression test.

### 2. Report the oracle, do not add a new feature status

The feature vocabulary is fixed (`verified|unverified|degraded|buggy`).
Adding `journey-verified` as a status would force every consumer of
`statuses.json` to change. Instead, derive the reverse link from
`journeys[].features` and render a journey column in the report:

```
feature row            linked journeys                  report label
verified               all parity or accepted diverges  journey-verified
verified               any broken or unaccepted diff    unit-verified only
verified               broken and finding assigned      buggy + open defect
verified               no reachable journey              unit-verified only
```

`crosscheck.test.ts` enforces the label inputs: it derives the reverse map,
rejects a `buggy` row without an open defect, and fails a `verified` row that
is linked to a broken journey unless the row is `buggy` or the report marks it
unit-verified only. The report's native parity score stays
`parity / reachable journeys`; feature counts never enter it.

Alternative rejected: downgrade every feature listed by the broken pilot.
That would mark unrelated features buggy because one journey exercises many
surfaces, and it hides which finding belongs to which feature. The defect
hand-off names `transcript-order` and `stream-deltas`; only those rows move.

### 3. Mirror the helper's invocation in the harness

The harness is a test of the deployed bridge configuration, so it must use the
same seam `bin/maki-oss` uses:

| Variable | Reference side | Maki side | Why |
| --- | --- | --- | --- |
| `OPENMAKI_CWD` | `paths.work` | `paths.work` | canonical directory is the journey workdir |
| `MAKI_MODEL` | n/a | the scripted model id | the TUI selects the announced model |
| `HOME` / XDG | fresh temp dirs | fresh temp dirs | isolation |
| `OPENCODE_*`, `*_API_KEY` | absent | absent | no host credential/config |

The fake sandbox's `maki models` catalog may still return several models, but
`MAKI_MODEL` puts the scripted one first. The normalizer's model labels are
derived from the actual `/api/model` and `/api/provider` responses, not a
hardcoded `makiModels` list. The harness asserts `opencode --version` equals
`journeys.json.pin.opencode` before either side starts.

### 4. A harness failure is not a journey verdict

Introduce a `HarnessError` for setup failures (version mismatch, bridge did
not listen, missing binary, PTY spawn failure, mock-provider bind failure).
`makiRun` rethrows it; `record()` logs it and leaves the catalog untouched.
A `StepError` after the reference succeeded is a product failure: it records
`unreached` for the checkpoint, saves the final screen and the error beside
the checkpoint, and sets `broken`. This keeps "the bridge is wrong" separate
from "the test rig is wrong".

### 5. Apply accepted differences from the catalog

`record.ts` reads the journey row's `acceptedDiffs` and passes a reason map to
`diffCheckpoints`. A checkpoint with a non-empty reason is accepted; a
`broken` journey still cannot accept anything (the existing rule). The pilot's
title difference is proposed as accepted:

> `streamed`: the Maki side has no server-side session-title generator, so
> "New session" is the true placeholder; the reference's "Journey" comes from
> the mock provider's title turn and is not a Maki behavior.

The model and footer differences are not accepted; they are harness config
bugs and must disappear under decision 3.

### 6. Gate before growth

`make test-journeys` runs the recorder and is gated on `opencode` and `bun`,
like `make test-ui`. The offline suite owns the reproducible part:

- re-diff every committed reference/Maki snapshot and assert the row's status;
- check script checkpoint ids against the catalog row, in order;
- read every `maki-requests.jsonl` into the measured route set;
- `make compat` regenerates and fails on a stale report.

The three pilots must pass twice with byte-identical snapshots before a fourth
script is added. The first live real-Maki smoke runs before the 50 remaining
journeys; it is a single scripted prompt through a throwaway sandbox, not the
full `add-journey-live-run` runner.

### 7. Skills carry the same rule

The four skill files are documentation of the loop, not runtime. They change
in the same change so the next discovery pass cannot recreate the old
behavior:

- `discovering-tui-journeys`: the journey is the oracle; a feature is not
  native from a golden; a broken journey is triaged before coverage; harness
  fidelity and failure evidence; live smoke before scaling.
- `running-feature-discovery`: the done condition includes zero broken or
  diverging reachable journeys without accepted differences; the report shows
  unit-only versus journey-verified features.
- `proposing-coverage-change`: a capability slice that changes event shapes
  or ordering includes a journey or journey-level test; a unit-only row is
  labeled as such.
- `proposing-fix-change`: a defect names the journey checkpoint that exposed
  it, and a TUI-visible fix re-runs the journey and records the new status.

## Risks / Trade-offs

- [The missing delivered frame is one of several TUI event-order assumptions
  in the fake child] -> The first live smoke is a task, not a later change;
  any further gap becomes a journey `broken` with a named checkpoint.
- [The accepted title difference hides a real gap] -> The reason is printed
  beside the journey; a title surface is a separate capability if wanted.
- [The report's journey column makes the matrix noisier] -> It shows the
  truth the scoreboard was hiding; the native score stays the single number.
- [The harness still runs a mock provider in the reference side] -> That is
  intentional for determinism; the live smoke covers the real stack.
- [The new gate makes `make test-bridge` slower] -> The offline re-diff is
  pure file comparison; recording remains gated and outside `make test`.
- [The change overlaps the unstarted `add-journey-harness`] -> Apply its
  harness core first and this change as the corrective pass; or fold these
  tasks into that change before applying. The tasks name the seam.

## Migration Plan

1. Add the bridge frame and its regression; the pilot's Maki side renders.
2. Correct the harness invocation and evidence rules; re-record the three
   pilots twice.
3. Add the offline gate and regenerate the report; re-triage the matrix and
   defect rows.
4. Update the skills and the live-smoke ordering.
5. Rollback is a revert of the bridge frame and the harness/gate edits; no
   sandbox or credential state changes.

## Open Questions

None that change the approach. The title-acceptance reason and the
fold-versus-follow-up relationship are named above; both are review decisions
at apply time, not unresolved design branches.
