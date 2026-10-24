# Proposal

## Why

The first recorded TUI journey (`send-prompt-stream-reply`) is `broken`: the
bridge emits a complete assistant turn, but the OpenCode 2.0.32 TUI renders
only the user prompt. The missing frame is `session.inbox.delivered`, which
the bridge omits for a prompt that starts immediately; adding it makes the
reply render. The compatibility report still calls `transcript-order` and
`stream-deltas` `verified` and the defect inventory is empty, because those
claims rest on golden event projections rather than on the TUI.

The journey harness that found the bug is not yet an independent oracle: it
runs the bridge with a different canonical directory and without a model, so
its comparison carries harness artifacts; it cannot accept a documented
difference; it records a harness setup failure as a product `broken`; and its
offline re-diff gate is unwritten. The skills still present the route/feature
matrix as the source of truth and say to use the harness "once it exists".

This change makes the TUI journey the native oracle, fixes the one regression
it exposed, and makes the evidence and the workflows that judge it
trustworthy before the catalog grows.

## What Changes

- Fix prompt delivery in the bridge: emit `session.inbox.delivered` for every
  admitted prompt, including one that starts immediately, before assistant
  text. Add the regression to the TUI journey and the golden.
- Re-triage the oracle: `transcript-order` and `stream-deltas` become
  `buggy` with an open defect until the TUI renders. A feature is not
  reported as native from a golden alone; the report shows each verified
  feature's linked journey status and separates "unit-verified" from
  "journey-verified".
- Make the harness faithful: run the bridge as `bin/maki-oss` does
  (`OPENMAKI_CWD` = journey workdir, `MAKI_MODEL` = scripted model), assert
  the OpenCode pin, derive model labels from the real responses, apply the
  catalog's `acceptedDiffs`, save the final screen and error on an unreached
  checkpoint, and abort on a harness failure instead of writing a status.
- Wire the gate before adding journeys: `make test-journeys`, an offline
  re-diff of committed snapshots, script/catalog checkpoint consistency,
  journey request logs in the measured route set, and a regenerated
  `docs/compatibility.md`.
- Update the four discovery/proposal skills to state the journey oracle,
  harness fidelity, failure-evidence, and unit-only-versus-native rules.
- Reorder the live work: one real-Maki smoke before scaling the catalog; the
  full live runner remains `add-journey-live-run`.
- Record the pilot truthfully: after the fix and harness config, re-record
  `send-prompt-stream-reply`, `allow-permission-once`, and
  `resume-session-history`; accept only differences with a written reason.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `opencode-tui-bridge`: the prompt transcript requirement gains the
  immediately-started prompt delivery scenario. The TUI renders the assistant
  turn only after `session.inbox.delivered`.
- `tui-journey-parity`: the parity rules gain the journey-as-native-oracle
  requirement and the harness fidelity and failure-evidence requirement.

## Impact

- `bridge/src/translator.ts` (delivered frame), `bridge/test/fake-maki.ts`
  (per-prompt turn consumption), the journey harness under
  `bridge/test/journeys/`, `bridge/test/crosscheck.test.ts`,
  `scripts/gen-compat.ts`, `Makefile`, `bridge/compat/statuses.json`,
  `bridge/compat/journeys.json`, `bridge/defects.json`, and
  `docs/compatibility.md`.
- `.claude/skills/discovering-tui-journeys/SKILL.md`,
  `.claude/skills/running-feature-discovery/SKILL.md`,
  `.claude/skills/proposing-coverage-change/SKILL.md`, and
  `.claude/skills/proposing-fix-change/SKILL.md`.
- No sandbox, egress, credential, or image change. The reference run still
  uses a loopback mock provider and a temporary workdir; the Maki side still
  uses the scripted child offline.
- Relationship to open changes: this change amends the unstarted
  `add-journey-harness` (its harness design decisions 4, 6, and 7 and its
  gate tasks) and adds the first live smoke before `add-journey-live-run`
  scales. It does not duplicate their harness core; apply it on top of that
  core, or fold these tasks into that change before applying. The
  `resume-session-history` pilot's `GET /api/session/{sessionID}/message`
  remains deferred and is not fixed here.
