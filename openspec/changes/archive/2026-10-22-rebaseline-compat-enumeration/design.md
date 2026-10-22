# Design

## Context

`bridge/compat/statuses.json` is the machine-readable source behind the
generated `docs/compatibility.md`. Its 35 route rows and 21 feature rows were
enumerated offline during the snapshot era, before the discovery skill
required deriving the chart from pinned upstream docs and source. Measured
against the pins this change re-baselines to:

- `bridge/src/openapi-2.0.32.json`: **142 `/api/*` operations**, 35 rows in
  `statuses.json`, **108 with no row**, **1 phantom** (`GET
  /api/session/{sessionID}/terminal`, absent from the pin).
- Maki wire pin `sdk_mode.rs` v0.6.4 and OpenCode pin `session-event.ts`
  v2.0.32: the iteration-1 matrices (`maki-sdk-wire-features.md`,
  `opencode-tui-features.md`, `cross-map.md`) total 190 lines against a
  contract surface several times that.

`bridge/src/bridge.ts:411-423` shows why the 108 are invisible today: dispatch
falls through to `synthesize()`, which answers from the vendored spec, and any
route it does not recognize returns 404 with `matched: false`. The rows that
never existed in the enumeration therefore never reach the report, and no
downstream test can assert their absence.

See proposal.md for why this matters; this document is only how to do it.

## Goals / Non-Goals

**Goals:**

- Every `/api/*` operation in the pinned OpenAPI has exactly one route row.
- Every wire message kind and SSE event envelope present at the pins has
  exactly one feature row.
- A matrix row naming a route absent from the pinned contract is removed, and
  the loop is taught to catch the class.
- The report stays reproducible: `make compat` is a no-op on a clean tree, and
  `cd bridge && bun test` stays green.

**Non-Goals:**

- Changing any bridge runtime behavior. `bridge/src/**` is untouched; the
  bridge already 404s unknown routes and already answers spec-valid bodies.
- Covering the new rows with tests. Recording a row at `unverified` or
  `deferred` is this change's job; turning one into `verified` is
  `proposing-coverage-change`'s job, one coherent slice at a time.
- The evidence-strength tier (`contract-only`) and the live subagent capture.
  Those are the follow-on changes, sized after this audit lands.
- Raising a pin. The pin is the contract; nothing here reads a newer tag.

## Decisions

### D1 — Enumerate from the vendored pin, never a live re-capture

The route enumeration is derived by reading `bridge/src/openapi-2.0.32.json`
directly — the vendored, committed artifact — rather than by running
`make compat-drift` against the installed binary. The skill's rule is "pinned
source beats current docs," and the vendored copy *is* the pinned source; a
live re-capture introduces a second source that can disagree with the contract
the tests validate against.

**Alternative considered:** re-capture `/openapi.json` from the installed
`opencode v2.0.32` and diff three ways (vendored, installed, rows). Rejected
for the enumeration itself — it is the job of the existing `compat-drift` gate
and would conflate "the pin is under-recorded" with "the installed binary
drifts from the pin." It is still run once during implementation as a
consistency check, not as the source.

### D2 — One row per operation, no grouping, no `out-of-scope`

142 rows, one per method+path. The iteration-1 cross-map bucketed "PTY/shell,
OAuth integrations, voice, worktrees, stats/export, background tasks, forms,
inbox bodies" into a single `out-of-scope` line; that bucket is precisely the
unverified guess this change exists to test, so it is expanded to individual
rows. Grouping would recreate the blind spot at larger scale.

The report grows from 35 route rows to ~140. That is accepted: it is a
generated artifact, the growth is the finding, and each row now carries a
truthful status instead of being silently absent.

**Alternative considered:** add an `out-of-scope` route status so genuinely
irrelevant rows could be collapsed. Rejected — it would require changing the
enforced vocabulary in `scripts/gen-compat.ts` and the
`opencode-tui-bridge` "Generated compatibility report" requirement, and it
would assert a judgment (`out-of-scope`) that only a later coverage change can
earn. See D3 for what each row gets instead.

### D3 — A route the bridge 404s is `unhandled`; `deferred` stays earned

The existing vocabulary is `served-live | served-faked | deferred | unhandled`,
and its documented discriminator is behavioral: `deferred` means "a spec-valid
minimal answer while the capability is not implemented," `unhandled` means
"outside the pinned contract or 404 as spelled."

Applying that literally: dispatch falls through to `synthesize()`, which
answers from the vendored spec for most unrecognized routes — so most of the
108 are `served-faked`, not `unhandled`. That is the honest row, and it is the
one users need: a TUI that calls `POST /api/session/{id}/compact` gets a
synthesized body today, not a 404. A handful that dispatch genuinely rejects
stay `unhandled`. Rows already `deferred` are left as-is unless the diff
contradicts them.

This is a vocabulary-fidelity decision, not a coverage claim: `served-faked`
here means "the bridge answers from the spec with synthesized values," exactly
as the 20 boot routes already reported.

### D4 — Every new row's evidence is the pinned artifact it was derived from

`crosscheck.test.ts` requires every route row to carry an evidence key that
resolves on disk. For a row derived by enumeration, the truthful evidence is
the pinned source that proves the route exists and how it is answered:

- the row's own existence → `bridge/src/openapi-2.0.32.json`
- `served-faked` → `bridge/src/spec-answers.ts` (the `synthesize` path)
- `unhandled` → `bridge/src/bridge.ts` (the 404 fallthrough)
- `deferred` → whichever of the two the existing row already cites

No row is recorded as `verified` by this change, so the stricter
`isTestOrFixture` rule for features is not engaged.

### D5 — The enumeration is a committed artifact, not a one-off measurement

The 142-row enumeration and its diff land as `evidence/` files in this change,
copied forward from the iteration-1 matrices and extended. The diff is what a
later discovery pass compares against, so the next "is the matrix stale?"
question has a baseline instead of a re-derivation. It also makes this change's
claim auditable: the 108/1 numbers in proposal.md are reproducible from a
committed file rather than a shell command someone would have to re-invent.

### D6 — The skill gains a fourth finding class, in two lines

`running-feature-discovery` names two finding classes for the enumeration
diff: "present upstream but missing from the matrices," and staleness as "a
matrix row contradicting a later `statuses.json` flip." A row whose route does
not exist upstream is neither, which is how `/terminal` survived. Two lines
add it. The skill is git-tracked, so this is a reviewable diff alongside the
status file it protects.

## Risks / Trade-offs

- **[A ~140-row report buries the rows that matter]** → The report's three
  lenses stay separate, so the 21 feature rows and the version matrix are
  unaffected by route growth; and rows keep their grouping by status, so
  `served-live` (what actually works) stays a short list at the top.
- **[Misclassifying a row as `served-faked` when the bridge actually rejects
  it]** → Classification is derived from `bridge/src/bridge.ts` dispatch plus
  one `bun bridge/test/discovery.ts` pass that logs `matched` for each
  requested route, not from reading the OpenAPI alone. A row's status is
  re-checkable by curling the bridge.
- **[The pinned OpenAPI itself is under-specified for SSE envelopes]** →
  Recorded as a limitation, not worked around: `V2EventEncoded` is an opaque
  JSON string, so SSE envelope rows are derived from `session-event.ts` at the
  OpenCode tag and cited to that file. Already documented in the iteration-1
  cross-map; this change does not pretend the OpenAPI covers it.
- **[A later pin bump invalidates the enumeration]** → Inherent and accepted:
  the pin is the contract, and `compat-drift` is the gate that announces a
  bump. The committed diff artifact is what makes the re-enumeration cheap.
- **[A feature row's evidence is source-pinned but never live-captured]** →
  Out of scope here by design (Non-Goals); tracked as the follow-on
  evidence-strength change so this one stays a pure re-baseline.

## Migration Plan

Single commit, no rollback complexity: the status file, the regenerated
report, the evidence matrices, and the skill edit land together, and
`make compat` + `cd bridge && bun test` gate the whole thing. Removing one
phantom row cannot orphan a test — no test references `/terminal` — and the
wrap-up task rewrites any evidence path that points into this not-yet-archived
change dir to the dated archive path at archive time, per the loop's standing
rule.

## Open Questions

None that change the specs, the approach, or the task breakdown. Whether the
newly recorded rows deserve offline tests — and in what slices — is
`proposing-coverage-change`'s triage decision, made after this audit's numbers
are committed.
