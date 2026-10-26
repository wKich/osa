# Design

## Context

See `proposal.md` — Why. `add-doc-contract` and `add-agent-onboarding` have
landed. The router and the contract name these Maki pages:

- `docs/ai/playbooks/maki.md`
- `docs/ai/reference/maki.md`
- `docs/ai/verification/maki.md`

The current tree still has `docs/ai/agent-playbook.md`, no Maki reference, and
`docs/verification.md` at the flat path. The Maki playbook already has the
contract metadata and phase blocks; it needs a move, not a rewrite.

The active `add-codex-oss` change is a separate front-end slice. This change
does not touch its files; if it lands first, rebase the onboarding link edit.

## Goals / Non-Goals

**Goals:**

- Move the Maki sandbox playbook to its contract path with no content rewrite.
- Add the Maki reference as a thin index.
- Keep every relative link and the `host-setup` spec path consistent.
- Prove the move/link/spec pattern that the OpenCode and Claude slices repeat.

**Non-Goals:**

- Moving or restructuring `docs/verification.md`. Its 400+ lines need a
  section-by-section conversion to `## Check` blocks; that is
  `align-maki-verification`.
- Trimming `docs/ai/host-playbook.md`'s Maki-specific image, provider, and
  daily-driver content. That is `align-host-playbook`.
- Removing the playbook's local Phase 0. The local numbering and content stay
  as they are; `Covers` becomes `P0, P3-P8` to tell the truth.
- Moving OpenCode or Claude docs.

## Decisions

### D1 — Move the playbook, do not rewrite it

`docs/ai/agent-playbook.md` becomes `docs/ai/playbooks/maki.md`; its phase
content, commands, and verified results stay. Only the title, metadata paths,
`Covers` value, and relative links change.

- **Why:** the page is already verified and contract-shaped. A content rewrite
  in the same change as the move would hide link/spec mistakes.
- **Alternative rejected:** rewrite the phases while moving — it mixes the
  pilot with a content change and makes review harder.

### D2 — Keep local Phase 0, set `Covers` honestly

The playbook still starts with `Phase 0 — Preflight`, which maps to `P0`.
Removing it and folding provider selection into Phase 2 is content work for a
follow-up. The metadata therefore says `Covers: P0, P3-P8`, not `P3-P8`.

- **Why:** the contract allows local numbering to differ; the metadata must not
  claim the page is only P3-P8 when it contains P0.
- **Alternative rejected:** delete Phase 0 now — it would require rewriting
  the provider-choice text and the onboarding mapping table, expanding the
  pilot.

### D3 — The Maki reference is a thin index

`docs/ai/reference/maki.md` uses the `reference` kind and points at the
canonical pages: `docs/helper.md` for shared behavior, `docs/providers.md` for
profiles, `docs/mcp-migration.md` for MCP, and
`docs/ai/environment-playbook.md` for the store. It lists the Maki paths and
differences, but does not copy the shared explanations.

- **Why:** a second full explanation would drift; the reference exists to make
  the Maki surface discoverable in one place.
- **Alternative rejected:** move `docs/helper.md` into the reference — it is
  shared by all three front-ends.

### D4 — Defer the verification move

`docs/verification.md` stays where it is. The playbook's `Handoff` and
`Verification` metadata and the onboarding P6 links keep pointing at it.

- **Why:** converting it to the contract's `verification` kind means splitting
  nine sections (and eight sync subsections) into `Check` blocks. That is a
  separate, reviewable change.
- **Alternative rejected:** add `Kind: verification` without restructuring —
  the checker would fail, and a `reference` kind would mislabel a checklist.

### D5 — Defer the host-playbook trim

`docs/ai/host-playbook.md` keeps its Maki-specific image, provider, and
daily-driver content. Its `Handoff` metadata and links move to the new Maki
playbook path, but the page's scope is unchanged.

- **Why:** trimming it means moving content into the playbook and deciding what
  remains shared across three agents; that is `align-host-playbook`.
- **Alternative rejected:** trim it now — it would mix a shared-page redesign
  with the Maki move.

### D6 — No redirect stub

`docs/ai/agent-playbook.md` is removed after the move. Every current reference
is updated in the same change.

- **Why:** a stub would hide a missed link and keep the old path alive. The
  link checker is the gate; a docs-only pilot can afford a clean move.
- **Alternative rejected:** leave a one-line “moved” stub for a release — it
  adds a page that will be forgotten and weakens the symmetry.

### D7 — Update the spec path in the same change

`host-setup` names `docs/ai/agent-playbook.md` in its “Clear boundary to the
sandbox playbook” requirement. The delta carries the full modified requirement
with `docs/ai/playbooks/maki.md`; the behavior is unchanged.

- **Why:** the spec is the durable contract; leaving it on the old path would
  make the move incomplete.
- **Alternative rejected:** rely on the docs only — the spec would fail its own
  handoff scenario.

### D8 — Reference verification is honest

The new reference page has no live run of its own. Its metadata says
`Verified: not yet verified`, and `Scope` explains that it indexes pages that
carry their own verified results.

- **Why:** the contract allows an index that has not been run; claiming a run
  it did not have would be false.
- **Alternative rejected:** copy the playbook's version/date — the reference
  itself was not exercised.

## Risks / Trade-offs

- **Missed old-path link** → update every current reference, run
  `grep -rn 'agent-playbook.md'` and `scripts/check-links.sh`; no redirect
  stub.
- **Relative links break in the new directory** → move from `docs/ai/` to
  `docs/ai/playbooks/`; rewrite `../verification.md` to
  `../../verification.md`, `host-playbook.md` to `../host-playbook.md`, and
  the other `../` links; the link checker catches the rest.
- **Reference duplicates shared content** → keep it a link index, not a copy;
  the contract reference kind requires only `Scope` and `See also`.
- **`Covers` still includes P0** → set `P0, P3-P8`; the content trim is a
  follow-up.
- **Conflict with active `add-codex-oss`** → it touches the onboarding guide
  and AGENTS/README for a fourth agent; rebase this change after it or
  coordinate the onboarding edit. The Maki move itself does not touch Codex
  files.
- **No live verification** → this is a move and an index; no sandbox behavior
  changes. The existing verification record remains the evidence.

## Migration Plan

1. Create `docs/ai/playbooks/` and `git mv docs/ai/agent-playbook.md` there.
2. Update the title, metadata, `Covers`, `Reference`, and relative links.
3. Add `docs/ai/reference/maki.md`.
4. Update the onboarding, host playbook, references, AGENTS, and setup-guide
   links.
5. Add the `host-setup` spec delta.
6. Run `make lint-docs`, `scripts/check-links.sh`, and
   `openspec validate align-maki-docs --strict`.
7. Rollback: move the file back, delete the reference, revert the link and
   spec edits. No runtime state or user data is involved.
