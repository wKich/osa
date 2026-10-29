# Design

## Context

See `proposal.md` — Why. The document contract names
`docs/ai/verification/maki.md`, `docs/ai/verification/opencode.md`, and
`docs/ai/verification/claude.md` as the per-agent verification pages. Only the
Maki checklist exists, at the flat `docs/verification.md` path; the OpenCode and
Claude records are tables inside their READMEs. All three P6 cells point at the
flat page, and the playbooks' `Handoff`/`Verification` rows point either at that
page or at the README anchors.

The source records use different shapes: the Maki page is a 400+ line
procedure with numbered sections, and the two READMEs are tables of check,
command, and observed result. The target contract is one shape: metadata,
`## Scope`, one or more `## Check` blocks with `### Run` / `### Verify` /
`### Stop if`, `## Invariants`, and `## See also`.

## Goals / Non-Goals

**Goals:**

- Give each agent one canonical verification page that the checker enforces.
- Preserve every recorded command, expected result, observed result, and link.
  The pages reorganize recorded runs; they do not claim a new run.
- Make the onboarding P6 cell, each playbook's Phase 5, and each reference point
  at the matching page.
- Keep the two subproject READMEs as a pinned-version summary that links the
  canonical record, so the record is not duplicated.

**Non-Goals:**

- Re-running any check. The pages carry the dates and versions of the recorded
  runs already in the repository.
- Changing sandbox behavior, policies, providers, images, helpers, or tests.
- Adding a redirect stub at `docs/verification.md`.
- Creating a new `verification` capability. The pages sit under `docs/ai` and
  the existing capabilities already own their links and content rules.

## Decisions

### D1 — Move the Maki checklist; do not leave a stub

`docs/verification.md` becomes `docs/ai/verification/maki.md` with `git mv`, and
every current link moves with it.

- **Why:** the contract forbids a second current path, and a stub would keep the
  old name discoverable after the move. The link checker makes a missed
  reference a build failure instead of a silent stale page.
- **Alternative rejected:** keep the flat page as a redirect. It duplicates a
  page name and lets old anchors drift.

### D2 — One canonical record per agent; READMEs summarize

The full OpenCode and Claude tables move to their verification pages. Each
README keeps the pinned versions, the run date, the live-profile caveat where it
exists, and a link to the page.

- **Why:** a README is the subproject guide, not the contract-shaped record.
  Duplicating a long table in both places guarantees drift, and a summary with a
  link keeps the README useful without owning the record.
- **Alternative rejected:** keep the README table and add a copy on the page.
  Two current records can disagree, and the spec would have to allow both.

### D3 — Check blocks follow the existing isolation areas

For Maki, checks 1-6 and 8-9 map one-to-one to the existing sections. Check 7
(workspace refresh) keeps the seven/eight case matrix as `####` subheadings
under one `### Run`, followed by one `### Verify` and one `### Stop if`. Checks 8
and 9 keep their `8a`-`8e` and `9a`-`9d` cases as `####` under `### Run`, again
with one `### Verify` and one `### Stop if` per check.

For OpenCode and Claude, related rows are grouped into about six and four
`## Check` blocks. Each block has a command table under `### Run`, an observed
results table under `### Verify`, and a single `### Stop if`.

- **Why:** the checker reads `###` state inside a `## Check`; `####` subcases
  keep one Verify/Expected/Stop contract per check without losing the case
  detail. Inline "Expected:" paragraphs inside a check also stay valid prose.
- **Alternative rejected:** one `## Check` per table row. That inflates the page
  and repeats the same stop condition for rows that share one boundary.

### D4 — P6 points at the page, not the README anchor

The onboarding P6 cells, the playbook metadata and Phase 5, and the references
point at `docs/ai/verification/<agent>.md`.

- **Why:** the page is canonical; pointing at a README anchor after moving the
  record would land on a summary.
- **Alternative rejected:** keep the README anchor until a later change. There
  is no later change; this is the one that creates the pages.

### D5 — Recorded dates stay as recorded

The Maki page records the 2026-10-22 OpenShell v0.1.5 run and the 2026-10-26
sync-matrix re-run. The image at the 2026-10-22 run pinned Maki 0.6.4; the
2026-10-26 sync re-run followed the 0.6.5 rebaseline. The page states both rather
than claiming a single Maki version for both dates. OpenCode records
2026-10-25 with 2.1.4 and 2026-10-26 for the helper path; Claude records
2026-10-26 with 2.1.308. No page claims a version it was not run against.

- **Why:** a verification page is evidence. Carrying a version forward without a
  run would make it a second, weaker opinion.
- **Alternative rejected:** use the current pin for every page. That would
  misdate the Maki checklist by three days and the image by one minor version.

### D6 — Specs govern paths and record ownership

The `host-setup` versions requirement names the Maki page in its consistency and
re-verification scenarios. The `opencode-oss` and `claude-oss` self-contained
requirements add the verification page to their allowlists, make the page the
canonical record, and require the README to summarize and link. The
`agent-onboarding` spec is untouched because it does not name the old path and
its "Phase links resolve" scenario already covers the new targets.

- **Why:** the specs are the durable contract; leaving the old path in a
  scenario would make the move incomplete.
- **Alternative rejected:** add a new `verification` capability. The pages are
  documents under `docs/ai` and the existing capabilities already own them.
