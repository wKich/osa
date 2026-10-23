# Proposal

## Why

The polish loop only produces work from feature rows and defects. A reachable
`served-faked` route with no feature row is treated as "a scope statement, not
debt", so the loop can finish with every feature closed while the TUI still
reads synthesized data from 21 of its 32 reachable routes (`/api/vcs`,
`/api/fs/list`, `/api/project`, `/api/session/active`, …). Discovery cannot
surface most of them either: its cross-map compares the Maki wire with the
OpenCode API, and routes whose real data lives in the sandbox (files, git,
processes) have no Maki counterpart, so they read as "accept". The last
`/goal` run closed the whole feature queue and still left those routes
untouched, because nothing records a decision for them or counts the ones
without one.

## What Changes

- Route rows in `bridge/compat/statuses.json` gain two optional fields:
  `feature` (the feature row that makes the route real, or that records why it
  cannot be) and `fakeReason` (one line on why synthesized data is correct by
  design). Every reachable `served-faked` route is then either triaged —
  linked, accepted, or flipped to `deferred` — or counted as untriaged.
- `bridge/test/crosscheck.test.ts` rejects malformed triage: an unknown
  `feature` id, a `fakeReason` on a route that is not `served-faked`, a route
  carrying both fields, a route whose linked feature is `verified` and not
  pin-blocked but which is not `served-live`, and a `served-live` route
  recorded `out-of-scope`. Untriaged routes are a queue, not a build failure,
  the same way an `unverified` feature is.
- `scripts/gen-compat.ts` renders each reachable route's decision and adds the
  untriaged reachable route count and up to three next routes to the burndown.
- `POST /api/session/{sessionID}/interrupt` moves to `scope: reachable`: it is
  served live, which the existing requirement already defines as reachable.
- Skills (text applied in this change, written with the `writing-skills`
  method — a recorded failing baseline before the edit, a passing re-run
  after it): `running-feature-discovery` gains a route queue, the four route
  decisions, the sandbox as a valid data source, and an untriaged-route line
  on its scoreboard; `proposing-coverage-change` gains the rule that a
  capability linked to a route flips that route to `served-live` in the same
  change.
- Regenerate `docs/compatibility.md`.
- No route is triaged in this change beyond `interrupt`'s scope fix, and no
  bridge runtime behavior changes; triaging the 21 routes is the follow-up
  loop's work.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `opencode-tui-bridge`: the generated compatibility report requirement gains
  route triage fields with their consistency rules, a rendered decision per
  reachable route, untriaged reachable routes in the burndown, and an explicit
  check that a live route is never out of scope.

## Impact

- Report data: `bridge/compat/statuses.json` (new optional fields; one scope
  fix on `interrupt`; no status changes).
- Report generator: `scripts/gen-compat.ts`.
- Tests: `bridge/test/crosscheck.test.ts`.
- Generated artifact: `docs/compatibility.md`.
- Skills: `.claude/skills/running-feature-discovery/SKILL.md`,
  `.claude/skills/proposing-coverage-change/SKILL.md` (procedural text).
- No bridge runtime, API, dependency, sandbox, or security-surface change. The
  suite stays offline.
