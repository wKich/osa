# Design

## Context

See `proposal.md` — Why. The repository already has the four-agent playbooks,
references, verification pages, and a checked document contract. The missing
piece is a single ordered route from a human prompt to a verified sandbox, plus
consistency in the shared pages that were written when the product had fewer
agents.

The relevant behavior is documentation and documentation tests. The helper,
images, policies, providers, bridge, dashboard runtime, and sandbox are not
changing. `scripts/check-playbooks.sh` enforces page shape; `tests/run-tests.sh`
already has `test_asset_agent_onboarding`, which is the natural place for
landmark checks. `scripts/check-links.sh` verifies links.

The two specs that own this behavior are `agent-onboarding` and `host-setup`.
`host-setup` currently requires the host Maki CLI install and version check in
the Maki playbook; this change makes that check optional. The rest of the
required version consistency is already in the spec and will be brought into
compliance by the documentation edits.

## Goals / Non-Goals

**Goals:**

- A human can hand setup to an agent with one short prompt and no command
  knowledge.
- The agent has exactly one ordered route and one owning phase per action.
- Project preparation cannot commit the user’s work or secrets.
- The shared reference pages either cover all four front-ends or state their
  Maki scope.
- First-run commands are executable in the order written.
- The asset test catches the important regressions.

**Non-Goals:**

- Changing `doctor` behavior, the helper’s sandbox naming, or any image,
  policy, provider, bridge, dashboard, or sandbox code.
- Adding a fifth agent or new runtime support.
- Re-running live image or OpenShell verification. Version claims align with
  the existing references and verification log.
- Rewriting the roadmap, compatibility, bridge, or oskhs documents.

## Decisions

### D1 — README carries the short human prompt; onboarding carries the detailed prompt

`README.md` gets a short “Let your agent set it up” block before the manual
install commands. The prompt is three sentences: set up osa for the agent the
user already runs and do not switch agents, read `AGENTS.md` and
`docs/ai/onboarding.md`, audit first, show the plan, ask before changes,
complete through verification, and never ask for a pasted secret. The human
supplies no project path or agent name; the agent detects both. The full prompt
with placeholders and the report format stays in `docs/ai/onboarding.md`, and
the README block links it.

The manual install sequence stays immediately below the prompt, introduced as
“If you prefer to do it yourself.” This preserves the existing human path and
makes the delegation path the first thing a reader sees.

- **Why:** the current README tells a human to “choose your path in the
  onboarding guide,” but that guide is written for an onboarding assistant and
  starts with a long prompt. A short prompt in the README is the smallest
  change that makes the delegation path discoverable.
- **Alternative rejected:** move the prompt to a new page. It adds a file and
  another link without making the first screen clearer.

### D2 — One owning phase per action

`P2` becomes repository, helper, and shell: clone, `bin/` on `PATH`, and the
helper resolution check. `P3` becomes the image plus the post-build `doctor`
run. `P4` becomes the provider. The onboarding table, the local-numbering map,
the document contract, and each playbook’s `Covers` / `Preconditions` metadata
agree with that split.

Maki and Codex keep `Covers: P0-P8` because they own a host-only preflight
(host Maki optional in this change; host Codex for the ChatGPT login).
OpenCode and Claude keep `P3-P8` because their CLIs are image-baked. The
document contract’s playbook template uses `P3-P8` as the default and states
the `P0-P8` exception for a host-only agent CLI.

- **Why:** the current `P2` gate requires the image and provider profile, then
  `P3` builds the image and `P4` imports the provider. An agent following the
  table runs the work twice.
- **Alternative rejected:** change `doctor` to tolerate a missing image. That
  is helper behavior and would leave the duplicate phase problem in place.

### D3 — Helper-first playbooks, raw fallback kept separate

The Maki playbook is restructured to match OpenCode, Claude, and Codex:
each phase starts with the helper command, then a labelled “Raw fallback”
section shows the `docker` / `openshell` equivalent. The helper’s sandbox name
(`mk-<project>-<hash>` for Maki) and the raw fallback’s name (`maki`) are both
stated. A “choose one path” note near the top says the two paths are not mixed
in one run; the “helper shortcut performs Phases 2–7” paragraph is removed.

- **Why:** the current Maki page says the helper is primary, then walks raw
  build, provider, and sandbox commands, then offers a helper shortcut. A
  linear reader can create a raw `maki` sandbox and then a helper `mk-…` sandbox.
- **Alternative rejected:** make the page raw-only. The helper is the product’s
  recommended path and the reason the docs exist.

### D4 — Project preparation never commits

All four playbooks replace the `git init` / `printf … >> .gitignore` /
`git add -A && git commit -qm init` block with a consent gate:

- if the project is already a git repository, add or verify the ignore entries
  and show the diff; do not commit;
- if it is not a git repository, ask before `git init`; then add the ignore
  entries; do not commit;
- never stage or commit `.env` or another secret file;
- state that the helper records a dirty baseline and the raw upload only needs
  a git work tree for `.gitignore` filtering.

- **Why:** the current block commits the user’s uncommitted work and can commit
  a secret. The helper already handles dirty baselines, so the commit is not
  needed.
- **Alternative rejected:** ask the user to commit first. That is still a host
  mutation the user may not want, and it is unnecessary for the upload.

### D5 — Build before doctor

`README.md`, `docs/helper.md` (Install and Cookbook), and the Maki daily-driver
list run `image build` before `doctor`. The comment changes from “verify
prerequisites” to “verify the built image and host.” `docs/setup-guide.md`
already builds before it verifies; it gains the missing repository/PATH start
and moves `mcp status` after sandbox creation.

The Maki verification page is reconciled with the 0.6.5 pin: if no current run
exists, checks 1–6 are marked as the historical 0.6.4 run and a current 0.6.5
note is added; the page must not read as a 0.6.5 measurement it did not make.

- **Why:** `doctor` checks that the configured image exists and exits non-zero
  when it does not. On a clean host the current first command fails for a
  reason that is not a prerequisite.
- **Alternative rejected:** leave the order and rely on the reader to continue
  past a red `fail`. That is exactly the confusing first run this change is
  meant to remove.

### D6 — Shared references name all four, or say they are Maki-scoped

`docs/helper.md` becomes a four-front-end helper index: the intro lists
`maki-oss`, `opencode-oss`, `claude-oss`, and `codex-oss`; the code layout
includes `bin/codex-oss`; the configuration table is labelled “Maki defaults”
and links each agent reference for its own prefix and paths; the Fish section
says only Maki and OpenCode have fish plugins. `docs/providers.md` gains a
scope line: it is the Maki provider catalog; OpenCode, Claude, and Codex
provider setup is in their playbooks and references. `docs/glossary.md` adds
the `cc` / `cx` agent tags and makes the base-image and MCP definitions
agent-neutral. `dashboard/README.md` adds `codex-oss`. `AGENTS.md` lists all
four playbooks and the shared helper and provider references. The onboarding
Codex skills target becomes `/sandbox/.agents/skills/`.

- **Why:** the shared pages are linked from the README and from onboarding as
  the shared reference. A Codex or Claude reader currently lands on a page that
  documents only Maki, or on a helper page that omits `codex-oss` entirely.
- **Alternative rejected:** duplicate the full per-agent references into the
  shared pages. That recreates the drift problem.

### D7 — Setup guide is a detailed manual path, not a second install path

`docs/setup-guide.md` gets a short “before you start” repository step (clone,
`cd`, `export PATH`). It pins OpenShell to `v0.1.5`, matching
`docs/ai/host-playbook.md` and `docs/ai/references.md`, instead of installing
whatever `main` currently is and accepting “0.1.5 or later.” The `mcp status`
paragraph moves after the sandbox-creation section. The manual provider recipe
uses the wizard or a hidden `read -rs` export followed by
`provider create --from-existing`; it no longer shows `KEY=<value> command`.

The container-engine claim is made consistent in the same pass: the host
playbook either documents Podman (the `engine` setting and its verification
command) or the README stops offering it. A user must not follow a claimed
engine the playbook does not check.

- **Why:** the guide claims to start from a clean machine but assumes a clone
  and a resolved helper; it also documents an unpinned OpenShell and a
  history-visible key. The README offers Podman while the playbook only checks
  Docker.
- **Alternative rejected:** delete the guide. It is the detailed manual
  reference and the source of the raw commands the helper wraps.

### D8 — Extend the existing onboarding asset test

`test_asset_agent_onboarding` in `tests/run-tests.sh` gains landmark checks:

- README contains the short setup prompt and links `docs/ai/onboarding.md`;
- the onboarding prompt names the shared host playbook and the agent playbook;
- the `P2` row does not contain `image build` or `provider setup`, and `P3` /
  `P4` do;
- no agent playbook contains `git add -A` or `git commit`;
- the Maki playbook has `maki-oss up` before the first
  `openshell sandbox create` (helper-first);
- `README.md` and the `## Install` section of `docs/helper.md` have
  `image build` before `doctor`, and the same order holds in the helper
  Cookbook and the Maki daily-driver list;
- the shared reference pages name all four agents;
- onboarding names `/sandbox/.agents/skills/` for Codex.

- **Why:** `scripts/check-playbooks.sh` checks shape, not truth. These
  assertions are narrow and catch the regressions that caused this change.
- **Alternative rejected:** a new checker script. The existing asset test is
  already wired into `make test` and has the right scope.

## Risks / Trade-offs

- **The README prompt and the onboarding prompt drift.** → Keep the README
  prompt deliberately shorter; assert the shared landmarks, not exact prose.
- **Helper-first playbooks hide the raw commands.** → Keep the raw fallback
  sections and label them; assert the helper command appears before the first
  raw sandbox create.
- **The asset test becomes brittle.** → Assert landmarks and relative line
  order, not full sentences or exact numbers.
- **The setup guide duplicates README setup.** → Keep only the clone/PATH
  lines and link README for the full quick start.
- **Making the host Maki CLI optional leaves users without it for host-side
  debugging.** → Label the check optional and explain that the sandbox binary
  is image-pinned; keep the installer link for users who want it.
- **Pinning OpenShell to v0.1.5 may lag a newer verified release.** → The pin
  already matches `docs/ai/references.md` and the verification log; a future
  bump changes both together.

## Migration Plan

No runtime migration. The documentation edits land as one change. On rollback,
revert the documentation and the asset-test additions; no state, schema,
credential, or sandbox migration is involved.
