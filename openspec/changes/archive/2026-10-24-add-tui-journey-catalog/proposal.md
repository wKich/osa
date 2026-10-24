# Proposal

## Why

The compatibility report is closed at the pin (33 reachable routes triaged, 0
open defects, every non-verified feature pin-blocked), yet that says little
about whether the OpenCode TUI feels like OpenCode when Maki is behind it.
"Reachable" is whatever the two captured TUI sessions happened to call: one
boot, one plain turn, one permission prompt. Resuming a session, `/compact`,
undo, diffs, shell, @-mentions, and session switching never ran, so their
routes sit `out-of-scope` and nothing measures them. Every check is offline
against fixtures: nothing compares what a user sees in real OpenCode with what
the same user sees through the bridge.

The target is that OpenCode TUI + Maki looks and behaves like OpenCode TUI +
OpenCode. That needs a unit the user recognizes, a **journey**, recorded
against real OpenCode first, then measured on the Maki side.

## What Changes

- Add a journey catalog, `bridge/compat/journeys.json`: one row per user
  journey the OpenCode TUI at the pin offers, with `slug`, `name`,
  `description`, `area`, a `scenario` (ordered steps plus named checkpoints
  describing what the reference screen shows), the OpenCode source that
  defines it, the route and feature rows it exercises, `scope`, `blockedBy`,
  `status`, and evidence.
- Fix a journey status vocabulary: `unrecorded` → `referenced` → `parity` /
  `diverges` / `broken`. `parity` requires a reference snapshot from real
  OpenCode, a Maki-side snapshot, and a diff with no unaccepted checkpoint
  difference; an accepted difference carries a written reason.
- Render a Journeys lens and a native parity score (parity journeys over
  reachable journeys) in `docs/compatibility.md`, and validate the catalog in
  `scripts/gen-compat.ts` and `bridge/test/crosscheck.test.ts`.
- Add the `discovering-tui-journeys` project skill, written with the
  `writing-skills` method (a recorded failing baseline before the text, a
  passing re-run after it). It enumerates journeys from the OpenCode TUI
  source at the pin, records them, and triages compared journeys into the
  existing feature, route, and defect loops.
- Seed the catalog with the skill's first pass: every journey at the pin is
  recorded `unrecorded`, with its scenario and source citation.
- Amend `running-feature-discovery` so a diverging or broken journey is a
  discovery input, and Maki-side journey request logs join the measured
  reachable set.
- Record the follow-up `/goal` (reference recording, Maki-side comparison, and
  upstream parity) in `design.md`.

No recording harness, mock provider, or screen renderer is built here: those
are the follow-up goal's first change. This change defines what is measured
and how a row moves; no bridge runtime behavior changes.

## Capabilities

### New Capabilities

- `tui-journey-parity`: a catalog of OpenCode TUI user journeys with a status
  measuring how closely OpenCode TUI + Maki reproduces OpenCode TUI +
  OpenCode, its evidence rules, and the journey lens and parity score in the
  compatibility report.

### Modified Capabilities

(none)

## Impact

- New data: `bridge/compat/journeys.json`.
- Report generator and gate: `scripts/gen-compat.ts`,
  `bridge/test/crosscheck.test.ts`, regenerated `docs/compatibility.md`.
- Skills: new `.claude/skills/discovering-tui-journeys/SKILL.md`; amended
  `.claude/skills/running-feature-discovery/SKILL.md`.
- Upstream reads only: `anomalyco/opencode` at tag `v2.0.32` (TUI commands,
  keybindings, dialogs), indexed through `docs/ai/references.md`
  (https://github.com/anomalyco/opencode).
- No bridge runtime, API, dependency, sandbox, or security-surface change. The
  default suite stays offline.
