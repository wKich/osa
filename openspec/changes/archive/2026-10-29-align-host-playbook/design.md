# Design

## Context

See `proposal.md` — Why. The metadata already says `Agent: shared` and
`Covers: P0-P2`, so this change makes the content match the claim rather than
changing the page's role. The Maki playbook already exists at
`docs/ai/playbooks/maki.md` with contracts metadata and raw sandbox phases.

The shared page currently mixes the three genuinely shared setup phases with
Maki image, provider, shell, and daily-driver steps. The onboarding router links
every agent's P0-P2 to that page, so the mismatch sends OpenCode and Claude
readers into Maki-only commands.

## Goals / Non-Goals

**Goals:**

- Leave `docs/ai/host-playbook.md` with only work identical for every agent:
  preflight, host tooling, and a cloned repository with `bin/` on `PATH`.
- Keep every Maki-specific step, including its verification, in
  `docs/ai/playbooks/maki.md`.
- Make the handoff route through `docs/ai/onboarding.md` so the shared page
  does not pick a default agent.
- Keep the `host-setup` spec truthful about which page owns each step.

**Non-Goals:**

- Rewriting the Maki sandbox phases, moving `docs/verification.md`, or
  changing OpenCode/Claude pages.
- Changing the OpenCode or Claude phase-map cells.
- Adding a fish plugin or fallback variable for OpenCode or Claude; their pages
  own their own differences.
- Adding redirect stubs or new external documentation links.

## Decisions

### D1 — End the shared page at a verified repository and shell

The shared page stops after Phase 3. It verifies `command -v osa`, the
agent-neutral reporter built from the same `bin/` directory, rather than any
agent helper. The page no longer runs `doctor`, builds an image, imports a
profile, or starts a session.

- **Why:** those commands are either agent-specific or sandbox work; `osa` is
  the one command that proves `bin/` is on `PATH` without choosing an agent.
- **Alternative rejected:** keep a per-agent verification matrix on the shared
  page — it duplicates each agent page and drifts.

### D2 — Move Maki-only content instead of summarizing it

The Maki CLI version check and install pointer go to the Maki playbook's Phase
0; fish integration and the `MAKI_OSS_BIN` fallback become a plain
`Shell preparation` section; the helper doctor/image/provider alternatives join
Phases 1-2; the daily-driver loop becomes a plain `Daily driver` section. Raw
image, provider, run, and cleanup commands stay in the Maki phases.

- **Why:** the commands and their expected output already exist and are
  verified; moving them keeps one source of truth.
- **Alternative rejected:** leave a Maki summary on the shared page — any Maki
  command there fails the shared-page requirement and invites drift.

### D3 — Fish integration and fallback stay Maki-named

`./bin/maki-oss fish install` and `MAKI_OSS_BIN` name Maki-specific files and
variables, so they live in the Maki playbook. The shared page tells fish users
to follow the chosen agent's shell integration and fallback section.

- **Why:** OpenCode has its own fish wrapper (`OPENCODE_OSS_BIN`) and Claude has
  no fish plugin; a shared section would have to branch three ways.
- **Alternative rejected:** put all three names on the shared page — that is
  agent-specific content with a shared label.

### D4 — Hand off to onboarding, not directly to Maki

The shared page's metadata `Handoff` and its `## Handoff` section both point at
`docs/ai/onboarding.md`, and the text says the chosen agent's playbook owns the
agent-specific part of P1-P2 and all of P3-P8.

- **Why:** a direct Maki handoff would make the shared page pick a default
  agent, which the onboarding contract forbids.
- **Alternative rejected:** list all three handoffs inline — the router already
  does that with the same links.

### D5 — Keep the raw Maki commands and add helper alternatives

The Maki playbook keeps the `docker build`, profile/provider, `sandbox exec`,
download, and delete commands. Helper commands are presented as alternatives
with their own verification, not replacements.

- **Why:** the raw path is the debugging and boundary-control path and is
  already verified; the helper path is the everyday path.
- **Alternative rejected:** replace the raw commands with helper commands —
  that removes the explicit sandbox steps the playbook exists to teach.

### D6 — Update both spec deltas and the main `host-setup` purpose

The `host-setup` delta rewrites every requirement that named Maki-only content
and adds the per-agent split. The `agent-onboarding` delta changes one
scenario. The main `host-setup` purpose is edited directly because OpenSpec
delta specs have no Purpose operation for an existing capability.

- **Why:** the spec is the durable contract; a shared page that still says
  "provision Maki" in its purpose is stale even if the requirements pass.
- **Alternative rejected:** use `skip_specs` — the observable documentation
  behavior changes and has testable scenarios.

## Risks / Trade-offs

- **A Maki command survives on the shared page** → the per-agent requirement
  searches for `maki --version`, `maki-oss`, and `maki-agent`; the acceptance
  grep and task check catch it.
- **Moved content is summarized away** → task checks require `maki --version`,
  `maki-oss doctor`, `maki-oss image build`, `maki-oss provider setup`,
  `maki-oss fish install`, and `MAKI_OSS_BIN` in the Maki playbook.
- **The shared handoff leaves a reader without an agent** → the page links the
  onboarding router at the top and in `## Handoff`, and onboarding links all
  three paths.
- **Spec sync rewrites more than intended** → only the `host-setup` and
  `agent-onboarding` deltas are synced; `docs/verification.md` and the
  OpenCode/Claude specs are untouched.
- **No live run is added** → this is a documentation split; the existing
  verification record remains the evidence, and the page keeps its existing
  `Verified` date for the shared steps.

## Migration Plan

1. Rewrite `docs/ai/host-playbook.md` to three shared phases and the onboarding
   handoff.
2. Move the Maki-only steps into `docs/ai/playbooks/maki.md`.
3. Update the Maki P0-P2 cells and host-playbook description in
   `docs/ai/onboarding.md`.
4. Update the one-line descriptions in `AGENTS.md` and `README.md`.
5. Write the `host-setup` and `agent-onboarding` deltas, then sync them.
6. Run `scripts/check-playbooks.sh docs/ai`,
   `openspec validate align-host-playbook --strict`, `make lint-docs`,
   `scripts/check-links.sh`, `make test`, and `make lint`.
7. Rollback: restore the five edited docs and the two synced specs. No runtime
   state or user data is involved.
