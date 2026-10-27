# Design

## Context

See `proposal.md` — Why. The page already claims to be agent-agnostic, so this
change makes the content match the claim rather than redefining the page's
role. The document contract lists `docs/ai/environment-playbook.md` as shared,
but also says a shared page describes work "identical for every agent"; a
four-row adapter table is therefore a deliberate contract clarification.

Every front-end already has the pieces the table needs: a base image, a helper
with its own config path and `image` setting, and a reference page. Maki has
`examples/maki-image/` and `docs/ai/reference/maki.md`; OpenCode has
`opencode-oss/image/` and `docs/ai/reference/opencode.md`; Claude Code has
`claude-oss/image/` and `docs/ai/reference/claude.md`; Codex has
`codex-oss/image/` and the current flat `docs/codex-oss.md` plus
`codex-oss/README.md`. Each helper is a thin front-end over `lib/oss-core.sh`,
so `image`, `doctor`, `status`, provider attachment, and MCP gates exist in all
four with different names and defaults.

Only the Maki reference store is shipped and verified. OpenCode and Claude
document their store shapes in their reference pages; Codex documents the
equivalent in its current page and README. None of the three has a committed,
built store. `align-codex-docs` is a parallel change that moves Codex to
`docs/ai/reference/codex.md` and `docs/ai/playbooks/codex.md`.

## Goals / Non-Goals

**Goals:**

- One shared procedure that a Maki, OpenCode, Claude Code, or Codex reader can
  execute without translating Maki commands.
- A per-agent adapter table that carries the minimum executable facts: base
  image, helper config path, store config directory, image setting, provider
  setup, MCP config, skills and plugins, and limitations.
- Keep the verified Maki reference store as the worked example and make that
  role explicit.
- Make the environment-layer contract truthful about which requirements are
  Maki-scoped and which are agent-agnostic.

**Non-Goals:**

- Four separate environment playbooks or four shipped reference stores.
- Building or live-verifying an OpenCode, Claude, or Codex environment store in
  this change.
- Changing any helper, image, policy, provider, bridge, oskhs, dashboard, or
  sandbox behavior.
- Adding Codex to the onboarding phase map; `align-codex-docs` owns that
  routing change.
- Adding a document-contract metadata table or `## Phase` structure to the
  environment playbook. It remains a shared procedure page, not an agent
  playbook.

## Decisions

### D1 — One shared procedure plus an adapter table, not four playbooks

The audit, classification, store generation, build, selection, verification,
and report steps are the same for every agent. Only paths, commands, and a few
agent limits differ. The playbook keeps one ordered procedure and puts the
differences in one table; each stage says "use the selected row" and the Maki
worked example shows the concrete run.

- **Why:** four pages would duplicate the shared reasoning and drift; putting
  everything only in agent references would force a reader to leave the
  procedure at every command.
- **Alternative rejected:** a separate `environment-playbook/<agent>.md` per
  agent. It repeats the audit/classify/build/verify text and gives no single
  page for a human with several agents.

### D2 — The adapter table is the only per-agent command index

The table has one row per agent and one column for each required fact. Values
come from the agent's reference page and its image Dockerfile, and the row
links that reference for detail. MCP cells include the provider naming
convention (`mcp-<name>`, `opencode-mcp-<name>`, `claude-mcp-<name>`, or
`codex-mcp-<name>`) and the matching `mcp status` gate. Later stages do not
repeat the table; they name the selected row and use Maki as the example.

- **Why:** one index is easy to audit and keeps Maki, OpenCode, Claude, and
  Codex values side by side. It is not a second procedure.
- **Alternative rejected:** one short table plus per-agent bullet lists in
  every stage. That is the current duplication problem with four agents instead
  of one.

### D3 — Keep the Maki store as the worked example, labeled as Maki

`examples/environments/reference/` stays the verified example. Its README and
the playbook say it is the Maki worked example; the other rows use their own
base image and store config and do not require it. The playbook's Stage 3
keeps the Maki Dockerfile, `mcp.toml`, `init.lua`, and `providers.toml` as the
concrete walkthrough.

- **Why:** it is the only store with a recorded build and verification. Turning
  it into a multi-agent template would mix unrelated configs and invalidate the
  evidence; adding three more stores is unverified scope.
- **Alternative rejected:** rename the reference store to a generic name. The
  contents are Maki-specific (`init.lua`, `mcp.toml`, `/sandbox/.config/maki/`),
  so a generic name would be misleading.

### D4 — Codex is a full row, linked to whichever Codex page exists

The Codex row names `codex-agent:local`, the `codex-oss` helper and its config
path, `/sandbox/.codex/config.toml` plus `/sandbox/.agents/skills/` for skills,
the host-only ChatGPT provider setup, and the codex MCP table form. Until
`align-codex-docs` lands, the row links `docs/codex-oss.md` and
`codex-oss/README.md`; after it lands, it links `docs/ai/reference/codex.md`.

- **Why:** Codex exists in the repository and has a distinct credential and
  store shape (host-only ChatGPT login, no `auth.json`, no API-key path,
  plugins disabled), so omitting it would leave the table incomplete. Linking
  the current page avoids a dead link while the other change is in flight.
- **Alternative rejected:** wait for Codex alignment. That leaves the
  "agent-agnostic" table with three rows and repeats the original problem for
  Codex readers.

### D5 — Per-agent limitations are part of the table, not footnotes

The limitations column and the matching stage notes state the failure modes a
naive copy hits:

- **Maki:** a store `init.lua` replaces the base file, so repeat
  `always_yolo = true` and the trust block; OAuth-only credentials have no
  path; provider profiles bind `/usr/local/bin/maki`.
- **OpenCode:** a store `opencode.json` replaces the baked file, so repeat its
  `permissions` deny rules and update/share switches; an npm plugin that
  fetches at startup has no same-agent path; the base has no Node/Bun, so a
  plugin or stdio server needs a pinned runtime in the store.
- **Claude Code:** a store `.claude.json` replaces the base seed, so keep its
  onboarding and trust keys; plugins have no supported path; the base has no
  Node/Bun or ripgrep; a subscription token is created on the host only and
  only one provider is attached.
- **Codex:** the managed provider, base URL, and traffic switches are
  root-owned and outrank `/sandbox/.codex/config.toml`; plugins are disabled;
  the base has no Node/Bun, so `npx` servers need a runtime; MCP status reads
  only `[mcp_servers.<name>]` tables, so inline or dotted definitions are
  reported unreadable; there is no API-key path and no `auth.json`; login
  happens on the host.

- **Why:** these are the differences that make a copied host setup fail or
  weaken the boundary. Hiding them in a reference would make the shared page
  unsafe to follow.
- **Alternative rejected:** a generic "check your agent's limitations" line.
  It gives the reader no actionable stop condition.

### D6 — Four spec requirements change; the base-image requirement stays Maki-scoped

The delta modifies the procedure requirement (the direct contradiction), the
store-boundary requirement ("the base image" becomes the selected agent's
base), the reference-store requirement (explicit Maki worked example), and the
derived-image requirement (`maki-oss` becomes each front-end helper). The
base-image requirement stays as the Maki baseline because the OpenCode, Claude,
and Codex specs already own their base-image requirements. The capability
purpose is edited directly during sync to say the boundary applies to each
agent's base image, the concrete base/store requirements use Maki as the worked
example, and the procedure generalizes through the adapter table.

- **Why:** changing only the procedure requirement would leave the store and
  image requirements asserting Maki-only behavior one layer below the new
  claim. Changing every requirement would duplicate the other agent specs and
  claim behavior this change does not verify.
- **Alternative rejected:** `skip_specs: true`. The documentation behavior and
  its scenarios change, so there is a real spec delta.

### D7 — The document contract allows per-agent adapters on a shared page

The shared-page definition changes from "work identical for every agent" to
"work every agent follows, with a per-agent adapter or linked reference where
the step differs; no default agent." The environment playbook is called out as
the example: one procedure, one adapter table, Maki store as the worked
example.

- **Why:** otherwise the contract forbids the exact page shape this change
  introduces.
- **Alternative rejected:** reclassify the environment playbook as a Maki page.
  That contradicts the task's preference to generalize and loses the shared
  procedure for the other three agents.

### D8 — No helper or image change; only the reference-store README is relabeled

`docs/helper.md` is the `maki-oss` front-end reference. Its `image build` and
`Configuration` sections are accurate for `maki-oss`; the other reference pages
already say only their names and defaults differ and link the helper for shared
behavior. No helper, image, policy, or provider file changes. The only
`examples/` edit is a README paragraph identifying the reference store as the
Maki worked example and pointing other agents at their adapter row.

- **Why:** the helper behavior is already generic through `lib/oss-core.sh`;
  this change is documentation alignment, not a behavior change.
- **Alternative rejected:** rewrite `docs/helper.md` around a four-agent config
  table. That duplicates the adapter table and the agent references.

### D9 — Documentation gates, no new live run

Only the Maki store has a recorded build; the playbook says the other rows are
documented from their agent pages and does not claim a verified non-Maki store.
Verification is the documentation gate set: `scripts/check-playbooks.sh docs/ai`,
`scripts/check-links.sh`, `make lint-docs`, `make test`, `make lint`, and
`openspec validate align-environment-playbook --strict`, plus acceptance greps
for each agent's base image, store path, provider command, and MCP command.

- **Why:** adding four live store builds would be a much larger change and
  would still not prove the documentation is coherent; the existing Maki
  evidence plus per-agent references is the truthful level of proof.
- **Alternative rejected:** mark the page `Verified` for all four agents. That
  would be a claim without a run.

## Risks / Trade-offs

- **Adapter table drifts from an agent reference** → each row links its source,
  the task list greps every agent's base image and store path, and
  `scripts/check-links.sh` catches moved pages.
- **A wide table is hard to scan** → keep cells terse and put detail behind the
  row link; the stage text uses the Maki example for the concrete run.
- **Readers infer a non-Maki store is verified** → the playbook and reference
  README say only the Maki store is the worked example; the limitations column
  distinguishes documented shape from a built store.
- **Codex documentation moves during implementation** → the task checks for
  `docs/ai/reference/codex.md` first and falls back to the current Codex pages;
  whichever of the two changes lands second updates the link.
- **A store replaces a safety file** → the stage notes make the replacement
  explicit for Maki `init.lua`, OpenCode `opencode.json`, and Claude
  `.claude.json`; the verification steps check the built image, never the build.
- **The purpose edit and the delta disagree** → sync the delta first, then edit
  the purpose directly, and compare the final spec's purpose with the delta's
  wording.

## Migration Plan

1. Add the four-row adapter table and mark the Maki reference store as the
   worked example.
2. Generalize the intro, the five stages, the report, the paste-able prompt,
   and the invariants.
3. Update the document contract, the onboarding `See also` wording, and the
   reference-store README label.
4. Write the `environment-layer` delta, sync it, and update the capability
   purpose directly.
5. Run the documentation gates and the acceptance greps; rollback is restoring
   the edited Markdown and the synced spec, with no runtime state involved.

## Open Questions

- `align-codex-docs` may land before or after this change. The Codex row uses
  `docs/ai/reference/codex.md` when present and the current Codex pages
  otherwise; this is an ordering detail, not a spec or behavior choice.
