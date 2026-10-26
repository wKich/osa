# Design

## Context

See `proposal.md` — Why. The current docs have three shapes:

- `docs/ai/host-playbook.md` and `docs/ai/agent-playbook.md`: Maki-only, phase
  ordered, with a verification after each phase;
- `docs/opencode-oss.md` and `docs/claude-oss.md`: agent references, organised
  by topic rather than phase;
- `docs/helper.md`: the shared helper reference.

There is no shared page header, phase vocabulary, or verification block. The
upcoming `add-agent-onboarding` change adds the first neutral router, and the
`align-*` changes move one agent at a time. Those changes should not each
invent their own structure.

## Goals / Non-Goals

**Goals:**

- One contract document that an author or an AI agent can read before writing
  a page.
- One small checker that makes the contract real without adding a runtime
  dependency.
- Stable phase IDs (`P0`-`P8`) shared by the router and the agent playbooks.
- The existing Maki playbooks pass the checker after a header/heading
  retrofit, with no file moves.

**Non-Goals:**

- Moving or renaming any document. That belongs to the per-agent `align-*`
  changes.
- Writing the onboarding guide, per-agent playbooks, references, or
  verification pages.
- Renumbering the existing Maki phase headings. Local numbers stay; the
  router maps them to `P0`-`P8`.
- Changing helper, image, policy, provider, or sandbox behavior.

## Decisions

### D1 — A contract document, not only a lint script

`docs/ai/document-contract.md` is the human- and agent-readable source of
truth. `scripts/check-playbooks.sh` only enforces the parts that are cheap to
check.

- **Why:** an AI agent needs to know the shape before writing; a script alone
  gives no rationale. A doc alone drifts.
- **Alternative rejected:** put the template only in the onboarding guide —
  then every later agent page copies the guide instead of a contract.

### D2 — Four page kinds, with required sections per kind

The contract defines these kinds:

- `router`: the neutral onboarding entry point (`add-agent-onboarding`);
- `playbook`: an agent's ordered `P3`-`P8` path;
- `verification`: an agent's isolation checklist;
- `reference`: an agent's config/profile/MCP/store reference.

Each kind has its own required headings. The checker dispatches on the
metadata `Kind` field, so a reference page is not forced to contain `Run` and
`Verify` blocks.

- **Why:** one universal template would either over-constrain references or
  under-constrain playbooks.
- **Alternative rejected:** one template for every page — it would make the
  reference pages look like incomplete playbooks.

### D3 — Metadata table is the dispatch key

Every page starts with:

```markdown
| Field | Value |
|---|---|
| Doc | `playbook-maki` |
| Kind | `playbook` |
| Agent | `Maki` |
| Covers | `P3-P8` |
| Preconditions | `host-playbook.md` `P0-P2` |
| Handoff | `onboarding.md#report` |
| Verification | `verification/maki.md` |
| Reference | `reference/maki.md` |
| Verified | OpenShell v0.1.5, Maki v0.6.5, 2026-10-25 |
```

`Doc`, `Kind`, `Agent`, `Covers`, and `Verified` are required. The rest are
required by kind: a playbook needs `Preconditions`, `Handoff`, `Verification`,
and `Reference`; a verification page needs `Reference`; a reference page
needs neither `Handoff` nor `Verification`.

- **Why:** the table is readable in Markdown, parseable with `grep`, and
  stable when files move because `Doc` is an ID, not a path.
- **Alternative rejected:** YAML front matter — the repository does not use it
  for docs, and a visible table is easier to review.

### D4 — Stable phase IDs, local numbering allowed

`P0`-`P8` are canonical:

| ID | Phase |
|---|---|
| P0 | Preflight / audit |
| P1 | Host tools |
| P2 | Repository + helper |
| P3 | Image |
| P4 | Provider |
| P5 | Sandbox |
| P6 | Verify |
| P7 | Run |
| P8 | Report |

The existing Maki playbooks keep their local `Phase 1`-`Phase 7` headings.
The onboarding guide maps them to `P0`-`P8`.

- **Why:** renumbering verified playbooks is unnecessary churn and breaks
  anchors. The stable IDs are for navigation and the migration matrix.
- **Alternative rejected:** renumber everything now — it mixes a docs
  contract with a content move.

### D5 — A POSIX sh checker, no new dependency

`scripts/check-playbooks.sh`:

1. finds `*.md` under `docs/ai/`;
2. reads the metadata table; skips files without `Kind`;
3. strips fenced code blocks before looking for headings;
4. checks the title and the kind's required sections;
5. for `playbook` and `verification`, checks the phase/check blocks have
   `Run`, `Verify`, and `Stop if`, and that `Verify` contains `Expected:`;
6. prints `file: missing <section>` and exits non-zero on the first failure
   class per file.

- **Why:** the repo already requires POSIX sh and has no Python/jq guarantee
  in the docs tooling. The checker should run in `make lint` on a bare host.
- **Alternative rejected:** a Node/Bun script — it adds a runtime to a docs
  check and fails on a host without Bun.

### D6 — Add `make lint-docs`, then include it in `make lint`

Add a separate target first. The same change retrofits the two Maki playbooks
and runs the checker; once those pass, add `lint-docs` to the existing `lint`
target so CI cannot skip it.

- **Why:** a separate target makes the first failure easy to reproduce; the
  combined target prevents drift.
- **Alternative rejected:** wire it immediately — a broken checker would block
  unrelated `make lint` work during the retrofit.

### D7 — Retrofit only the Maki playbooks in this change

`host-playbook.md` and `agent-playbook.md` get the metadata table and the
required headings. `opencode-oss.md` and `claude-oss.md` are references; they
receive metadata in their own `align-*` changes, where their content shape is
already being touched.

- **Why:** keeps this change docs-tooling-only and avoids editing in-flight
  `add-claude-oss` files.
- **Alternative rejected:** retrofit all five pages now — it mixes the
  contract with content changes and creates conflicts with `add-claude-oss`.

## Risks / Trade-offs

- **Over-strict checker** → per-kind required sections, a separate
  `lint-docs` target first, and a temporary broken-page check in verification.
- **Metadata drift** → the checker requires `Doc`, `Kind`, `Agent`, `Covers`,
  and `Verified`; the `add-agent-onboarding` asset test also checks the
  router's required rows.
- **Headings inside code fences** → strip fenced blocks before scanning.
- **Local phase numbers diverge from `P0`-`P8`** → the onboarding guide owns
  the mapping table; the contract fixes the IDs, not the local headings.
- **A future page kind needs a new section** → add it to the contract and the
  checker in the same change; the checker is intentionally small.

## Migration Plan

1. Add `docs/ai/document-contract.md` and `scripts/check-playbooks.sh`.
2. Add `make lint-docs`; run it against the contract (no targets yet).
3. Retrofit `docs/ai/host-playbook.md` and `docs/ai/agent-playbook.md`.
4. Run `make lint-docs` and `scripts/check-links.sh`.
5. Add `lint-docs` to `make lint`.
6. Rollback: revert the two playbooks, delete the contract, script, and
   target. No runtime state or user data is involved.
