---
name: discovering-tui-journeys
description: Use when asked to catalog, enumerate, record, or compare OpenCode TUI user journeys for the bridge compatibility report; when a journey's status may move between unrecorded, referenced, parity, diverges, and broken; or when a diverging or broken journey must be triaged into the existing feature, route, or defect loops.
---

# Discovering TUI journeys

## Overview

Discover → record → hand off. A route says what the TUI called; a journey says
what the user did and saw. The journey is the unit of "native": OpenCode TUI +
Maki looks and behaves like OpenCode TUI + OpenCode.

```
discovering-tui-journeys
├── missing row                  → enumerate the pinned TUI source, record unrecorded
├── reference recorded           → referenced
├── compared                     → parity | diverges | broken → hand off below
└── no Maki/sandbox counterpart  → out-of-scope with a written reason
```

Recording is not implementing. Never move a journey past `unrecorded` without
a committed reference snapshot, and never report `parity` while an unaccepted
checkpoint difference remains.

## Ground first (read-only)

| File | Why |
| --- | --- |
| `bridge/compat/journeys.json` | the durable catalog; the only file journeys are recorded in |
| `bridge/compat/statuses.json`, `bridge/defects.json` | route and feature rows the journeys link, and open defects |
| `docs/compatibility.md` | generated — **never hand-edit** |
| `docs/ai/references.md` | the only index of upstream source links |
| `bridge/test/crosscheck.test.ts`, `scripts/gen-compat.ts` | the enforced vocabulary, evidence rules, and gate |
| newest `opencode-tui-features.md` / `cross-map.md` | in the newest `openspec/changes/…/evidence/` or archive; an open change's copy wins |

The pin is `pin.opencode` in `journeys.json` (currently `2.0.32`), the same
version as the bridge contract. Read the TUI source only at that tag. A
versionless docs page or a newer tag is a pointer to where to look, never a
source or a citation.

## Enumerate from source (the job)

Journeys come from the pinned TUI source, not from captured traffic. The
captures prove what one boot happened to call; they cannot name a journey the
boot never reached. Use them later as evidence, never as the enumeration.

Read at the pin, and cover every user-facing surface:

| Surface | Where at `anomalyco/opencode` v2.0.32 |
| --- | --- |
| keybindings | `packages/tui/src/config/keybind.ts` — every `Definitions` entry whose default is not `none`; skip ones marked deprecated |
| commands | `packages/tui/src/routes/session/index.tsx` (`baseCommands`), `packages/tui/src/app.tsx` (`appCommands`) |
| slash commands | every `slash: { name: … }` on a command; aliases are the same journey |
| dialogs | `packages/tui/src/component/dialog-*.tsx` (session list, model, agent, theme, status, MCP, skills, stash, workspaces, integration, open, …) |
| session views | `packages/tui/src/routes/session/` and `packages/tui/src/feature-plugins/` — transcript, diff viewer, terminal pane, timeline, fork, form, permission, session tabs, sidebar, subagents |
| prompt | `packages/tui/src/component/prompt/` — attachments, `@`-mentions/autocomplete, editor, stash, move, `/cd`, skills |

Rules:

- **One row per user intent**, not per route or keybind. "Resume a session and
  see its history" is one journey even though it calls several routes.
- **Enumerate, don't sample.** Walk every surface above; a quiet command is
  still a journey. Traffic never decides the list.
- **A surface the pin removed is not a journey.** At v2.0.32 `session.share`
  and `session.unshare` are `"Deprecated: session sharing was removed"` — there
  is no sharing journey to record, even if an older doc or the proposal
  mentions one.
- **Cite the source at the tag**: the file (and line where useful) that
  defines the command, keybind, dialog, or view. A docs page is not a
  citation.
- **Seed every new row `unrecorded`.** Enumeration can never produce evidence;
  only a recording does.

## Record

One row per journey in `bridge/compat/journeys.json`:

```json
{
  "slug": "resume-session-history",
  "name": "Resume a session and see its history",
  "description": "Reopen an earlier session from the session list; its transcript renders as it was left.",
  "area": "session",
  "source": "packages/tui/src/component/dialog-session-list.tsx at v2.0.32",
  "scenario": {
    "steps": ["boot", "prompt 'Reply PONG'", "open the session list", "select the earlier session"],
    "checkpoints": [
      { "id": "history-visible", "after": 4, "expect": "the PONG exchange renders in the transcript pane" }
    ]
  },
  "routes": ["GET /api/session", "GET /api/session/{sessionID}/message"],
  "features": [],
  "scope": "reachable",
  "blockedBy": "none",
  "status": "unrecorded",
  "evidence": {},
  "acceptedDiffs": []
}
```

Fixed vocabularies (the generator rejects anything else):

- `area`: `session`, `prompt`, `permission`, `navigation`, `model`, `tools`,
  `files`, `config`
- `scope`: `reachable` | `out-of-scope`
- `blockedBy`: `pin` | `none`
- `status`: `unrecorded` | `referenced` | `parity` | `diverges` | `broken`
- `evidence` keys: `reference`, `maki`, `diff`

Every row needs a kebab-case unique `slug`, `name`, a one-sentence
`description`, `area`, `source`, a `scenario` with ordered `steps` and at least
one checkpoint (`id`, 1-based `after` step, `expect` screen), `routes`,
`features`, `scope`, `blockedBy`, `status`, `evidence`, and `acceptedDiffs`.
Every named route and feature must already have a row in `statuses.json`.

Status machine:

```
unrecorded --reference recorded--> referenced --Maki side compared--> parity | diverges | broken
```

- `referenced` needs a committed `evidence.reference` snapshot of real
  OpenCode (TUI backed by a real OpenCode server).
- `parity`, `diverges`, and `broken` also need committed `evidence.maki` and
  `evidence.diff`.
- An accepted checkpoint difference is an `acceptedDiffs` entry
  (`{ "checkpoint": "<id>", "reason": "<why the Maki screen is correct>" }`).
  A difference without a reason is not accepted, so the row cannot be
  `parity`. A `broken` journey cannot accept a difference at all.
- `blockedBy: "pin"` needs a `pinCitation` naming the pinned upstream source
  that prevents closing the gap.
- `out-of-scope` needs a `reason` explaining the missing counterpart.

`out-of-scope` is only for a journey that depends on an OpenCode-hosted
service with no Maki or sandbox counterpart (pairing a device, connecting an
integration whose credential the sandbox deliberately binds through an
OpenShell profile, updating OpenCode, restarting the OpenCode service). "The
bridge does not serve it yet" is never a reason: that is a reachable journey,
and its gap is work.

Do not shrink the reachable denominator to move the score. The score counts
`parity` journeys over reachable journeys; an `out-of-scope` row must survive
the reason test on its own.

## Compare and triage (only once the harness exists)

The recording harness is the follow-up goal's first change. Until it exists,
stop at `unrecorded` (or `referenced` with only a reference snapshot). When it
exists:

1. Drive the same scenario against real OpenCode (TUI + its own server, a
   temporary XDG home, a scripted local provider, no credentials) and against
   the TUI + bridge (fake-maki offline, real Maki in the sandbox for the gated
   live run).
2. Render both terminal streams into text screens at each checkpoint;
   normalize ids, timestamps, durations, ports, paths, and provider/model
   labels.
3. Diff per checkpoint. Complete with no difference → `parity`. Complete with
   at least one difference → `diverges`. Cannot complete → `broken`.
4. Record the reference, Maki-side, and diff paths. Accept a difference only
   with a written reason; the report prints every reason.
5. Hand every finding to an existing loop:

| Finding | Hand-off |
| --- | --- |
| a route the journey calls is untriaged or faked wrongly | route queue in `running-feature-discovery` |
| behavior missing on the bridge | capability feature row through `proposing-coverage-change` |
| behavior present but wrong | `bridge/defects.json` entry through `proposing-fix-change` |
| gap needs Maki upstream | `blockedBy: "pin"` with a `pinCitation` |
| Maki screen correct by design | `acceptedDiffs` with a written reason |

Maki-side journey request logs join the two committed captures as the measured
reachable set once they exist (`running-feature-discovery`, Scope). A route a
journey calls but the captures never saw becomes reachable and enters the route
queue; it does not stay out-of-scope.

## Do not

- Mark any status past `unrecorded` without a committed reference snapshot.
- Claim `parity` without both snapshots and a diff with no unaccepted
  checkpoint difference.
- Accept a `broken` step, or accept any difference without a written reason.
- Use `out-of-scope` for behavior the bridge merely does not serve yet, or to
  keep the score denominator small.
- Name a journey the pinned TUI does not offer, or derive anything from a tag
  newer than the pin.
- Sample journeys from captures, route rows, or the features the captures
  happen to exercise.
- Hand-edit `docs/compatibility.md`.

## Finish

```sh
bun scripts/gen-compat.ts && bun scripts/gen-compat.ts --check
cd bridge && bun test          # crosscheck validates links, vocab, and evidence
make compat                    # regen + git diff --exit-code
```

Report the scoreboard before the details: reachable and total journeys, counts
by status, the native parity score, the `unrecorded` slugs, every `diverges`
and `broken` slug with its hand-off, and the out-of-scope count with reasons.
