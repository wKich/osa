# Design

## Context

See `proposal.md` — Why. Maki, OpenCode, and Claude Code already prove the
target shape: `docs/ai/playbooks/<agent>.md` owns the ordered sandbox path,
`docs/ai/reference/<agent>.md` is a thin index of agent-specific differences,
and `docs/ai/verification/<agent>.md` is the canonical verification record.
Codex still has one flat page, `docs/codex-oss.md`, that mixes an ordered
quick start, raw `docker` and `openshell` commands, configuration differences,
the host-only ChatGPT login, gateway refresh, sessions, MCP status, and image
notes. Its verification table lives inside `codex-oss/README.md`.

Codex adds two constraints the other front-ends do not have:

- The one-time ChatGPT login needs a `codex` binary **on the host**, while the
  sandbox binary is image-pinned at `0.164.0`. The image must never receive an
  `auth.json` or the host's `~/.codex`.
- The access token is refreshed by the OpenShell gateway, and the sandbox
  receives only an opaque stand-in plus the non-secret account ID in
  `CODEX_CHATGPT_ACCOUNT_ID` (sent as `ChatGPT-Account-Id`).

The document contract already names the per-agent path pattern and the
metadata shape; it still describes three agents, and onboarding still routes
only three.

## Goals / Non-Goals

**Goals:**

- Give Codex the same contract-shaped pages as the other front-ends: a
  playbook a reader can execute phase by phase, a reference that indexes only
  Codex differences, and a verification page that owns the recorded run.
- Preserve every verified behavior, command, trap, version, and date already
  in `docs/codex-oss.md` and `codex-oss/README.md`.
- Leave one current path per subject: the playbook for procedure, the reference
  for configuration and differences, the verification page for evidence, the
  README for the subproject and its raw path, and the shared docs for shared
  helper, provider, and environment behavior.
- Make onboarding, the document contract, `AGENTS.md`, the root `README.md`,
  the host playbook, and the reference pack describe four front-ends.
- Keep the helper and its tests behaviorally identical; only documentation
  path strings change.

**Non-Goals:**

- Re-running any check. The verification page reorganizes the recorded
  2026-10-26 OpenShell v0.1.5 / Codex v0.164.0 table and claims nothing newer.
- Changing any helper, image, managed config, rules, policy, provider, bridge,
  oskhs, dashboard, or sandbox behavior.
- Generalizing `docs/ai/environment-playbook.md`; that is the separate
  `align-environment-playbook` follow-up.
- Adding Codex sections to `docs/helper.md` or `docs/providers.md`; shared
  helper behavior stays where it is, and Codex-specific profile and session
  facts belong in the Codex reference.
- Adding a redirect stub at the old `docs/codex-oss.md` path.
- Replacing the raw commands with helper commands. The raw path remains the
  explicit-control and boundary-debugging path.

## Decisions

### D1 — Move the flat page, do not leave a stub

`docs/codex-oss.md` becomes `docs/ai/reference/codex.md`, and every current
link moves with it. No redirect page is added.

- **Why:** the contract forbids a second current path, and a stub keeps the old
  name discoverable after the move. The link checker and the test suite make a
  missed reference a failure instead of a silent stale page.
- **Alternative rejected:** keep the flat page as a redirect. It duplicates a
  page name and lets old anchors drift.

### D2 — Playbook first, reference second

The playbook owns the ordered commands and decisions for the Codex path. The
reference keeps the Codex-specific facts a reader needs while running those
phases: config paths, credentials and refresh, profiles, sessions, MCP, store
shape, and differences. Shared helper and provider behavior stays in
`docs/helper.md` and `docs/providers.md`.

- **Why:** a reader who already knows the shared procedure wants an index, not
  a second procedure; a reader setting up wants one ordered path. Splitting
  them removes the duplication the flat page carried.
- **Alternative rejected:** keep one page and add phase headings. The result is
  still a mixed page that the contract cannot enforce as one kind.

### D3 — Phase 0 covers the Codex-specific host CLI

The playbook adds `## Phase 0 — Host Codex CLI and preflight`, which checks the
engine, the gateway, `codex --version`, and the architecture, and installs the
host CLI only when needed. The image pin remains authoritative for sandbox
runs. The local numbering table maps P0 and P1 to Phase 0, and P2 to Phases
1-2, as it does for Maki's host CLI.

- **Why:** `codex-oss provider setup` runs `codex login` on the host. Without a
  host binary the P1 gate is not met, and a reader cannot reach P4. Pinning the
  host CLI would be invented policy: only the sandbox version is pinned and
  verified.
- **Alternative rejected:** keep the host CLI in `Inputs` only. The onboarding
  phase map then has no checkable P0/P1 Codex cell, and a bare host fails at
  `provider setup` with no earlier gate.

### D4 — Four-agent router, not a Codex appendix

`docs/ai/onboarding.md` gains a Codex column in the phase map and local
numbering table, a Codex column in the same-agent migration matrix, a Codex
choice in the copy-paste prompt, Codex `See also` entries, and the Codex
authentication invariants. The Codex migration column names only paths the
repository records:

- credentials: host ChatGPT login in a throwaway `CODEX_HOME` →
  `codex-chatgpt` via `codex-oss provider setup`;
- MCP and settings: `$CODEX_HOME/config.toml` (else `~/.codex/config.toml`) →
  the store's `/sandbox/.codex/config.toml`;
- skills: `/sandbox/.agents/` when a store bakes it;
- commands and plugins: no recorded same-agent path, so report unsupported;
- project-local configuration: `AGENTS.md` stays with the project.

- **Why:** a fourth column is the only shape that keeps the existing gate
  contract. The matrix must not invent a Codex command or plugin surface the
  repository has not verified.
- **Alternative rejected:** add a Codex note below a three-agent table. That
  hides the Codex gate and lets the columns drift.

### D5 — Codex authentication rules stay normative in the playbook

The playbook states, in the phase where each applies:

- the login is host-only: `codex-oss provider setup` runs `codex login` in a
  new, private, throwaway `CODEX_HOME`, never `~/.codex`, and deletes it on
  success, failure, and interrupt;
- browser login is the default; `--device-auth` uses a device code and needs
  device-code login enabled first in ChatGPT settings;
- the helper reads the access token, refresh token, account ID, OAuth client
  ID, and expiry, imports `codex-chatgpt`, creates the provider, and configures
  gateway refresh;
- the gateway refreshes the access token; the sandbox sees only a stand-in in
  `CODEX_CHATGPT_TOKEN`, and the non-secret account ID travels per exec as
  `CODEX_CHATGPT_ACCOUNT_ID` / `ChatGPT-Account-Id`;
- no `auth.json`, no host `~/.codex`, no `codex login` inside the sandbox, no
  API-key or Enterprise-token path (`--with-api-key`, `--with-access-token`),
  and no provider base-URL override;
- `--dangerously-bypass-approvals-and-sandbox` is used in both modes because
  the OpenShell sandbox is the boundary, while the root-owned
  `/etc/codex/managed_config.toml` and `/etc/codex/rules/default.rules` still
  apply;
- `codex exec` closes stdin and streams JSONL; `--resume` uses the first
  event's `thread_id`; `--session-id` is a usage error; interactive
  `--continue` includes headless runs;
- the sandbox uses `/sandbox/.codex` because `sandbox exec` does not pass image
  `ENV`; a custom `--workdir` is trusted once in the TUI;
- `mcp status` compares `[mcp_servers.<name>]` tables and expects
  `codex-mcp-<name>`;
- `codex-oss` has no fish plugin, and the shared `tui` key is accepted but
  ignored.

- **Why:** these are the differences that make Codex fail or, worse, log in
  inside the sandbox when copied from a host workflow. Hiding them in the
  reference would make the playbook unsafe to follow.
- **Alternative rejected:** rely on the helper to hide them. A reader using the
  raw fallback would hit every trap.

### D6 — The verification page is canonical; the README summarizes

`docs/ai/verification/codex.md` reorganizes the README's verification table
into four `## Check` blocks (image/managed config/profile; credential, refresh,
and egress; sessions, rules, and TUI; helper path, sync, MCP, and teardown).
The README keeps its Egress table, the one-line refresh-interval observation
its existing requirement asks for, and a short pinned-version summary that
links the page. The first scheduled refresh, due about 2026-11-05 15:29 UTC,
stays a `## Follow-up` note and is not recorded as a passed check.

- **Why:** a verification page is evidence. Duplicating the long table in both
  places guarantees drift, and claiming the scheduled refresh before it happens
  would be a second, weaker opinion.
- **Alternative rejected:** keep the table in the README and add a copy on the
  page. Two current records can disagree, and the spec would have to allow
  both.

### D7 — Path strings in the helper and tests, not behavior

`bin/codex-oss` changes four documentation strings (`OSS_CONFIG_EXAMPLE`,
`OSS_MCP_FIX_DOC`, the header comment, and the help footer), and
`tests/run-tests.sh` changes the placeholder-spelling scan path to the moved
reference. `codex-oss/providers/stores.tsv` updates one comment.

- **Why:** the helper prints these paths to users, so they must not name the
  removed page; the scan must not silently skip the moved page. No code path,
  argument, or sandbox behavior changes.
- **Alternative rejected:** leave the strings and accept a dead path in output;
  that violates the one-current-path rule and weakens the scan.

### D8 — Three spec deltas, no helper delta

The change modifies the `codex-oss` self-contained requirement (allowlist plus
canonical verification page), six `agent-onboarding` requirements (same-agent
routing, phase map, migration matrix, policy-bound binary path, safety and
Codex auth, discoverable framing), and three `host-setup` requirements
(no agent CLI on the shared page, per-agent host steps, Codex version
consistency). `codex-oss-helper` is unchanged because no requirement names the
flat page or the README record.

- **Why:** a current spec that names a removed path is stale even if the docs
  are right; the acceptance grep includes `openspec/specs`. The helper contract
  is behavioral and the helper's behavior does not change.
- **Alternative rejected:** leave `host-setup` untouched as "historical". The
  requirement is current behavior, not a historical record.

### D9 — Codex upstream links move to the reference pack

The moved page's external Codex link joins a new `## Codex` section in
`docs/ai/references.md`, and the new pages link that pack instead of spelling
external URLs. `codex-oss/README.md` keeps its own subproject links.

- **Why:** `docs/ai/references.md` is the only index of external documentation
  links under `docs/ai`; adding pages with direct upstream links would bypass
  that rule.
- **Alternative rejected:** keep the links on the reference. It duplicates the
  index and lets the two link sets drift.

### D10 — Sibling pages get a one-line four-agent navigation update

The Maki, OpenCode, and Claude playbook banners and the OpenCode and Claude
reference `See also` lines add Codex. No sibling procedure or configuration
content changes.

- **Why:** those lines are current navigation. After Codex is a supported path,
  "return to onboarding for Maki or Claude" is incomplete and sends a Codex
  reader away.
- **Alternative rejected:** leave the siblings untouched. The onboarding
  router would name four agents while every agent page named three.

### D11 — The OAuth stop condition is scoped, not relaxed

The onboarding stop condition changes from "no API key or an OAuth-only
credential" to "no usable credential for the chosen agent". The matrix's OAuth
rule keeps the stop for Maki and OpenCode, keeps Claude's host-created
subscription-token path, and adds Codex's host-only ChatGPT login. No agent
gains an in-sandbox login or a token-extraction path.

- **Why:** Codex's credential *is* a ChatGPT OAuth login handled by
  `provider setup`, so the old wording would tell the assistant to stop on the
  one path the agent supports. Scoping the rule keeps the invariant.
- **Alternative rejected:** keep "OAuth-only" as a blanket stop. It
  contradicts the Codex path and invites an exception elsewhere.

## Risks / Trade-offs

- **A missed old path** → acceptance greps over `docs`, `AGENTS.md`,
  `README.md`, `codex-oss`, `bin`, `tests`, and `openspec/specs`; the link
  checker and test suite catch the rest.
- **A missed anchor** → every onboarding cell and README link is checked
  manually because `scripts/check-links.sh` strips fragments.
- **The verification page overclaims** → it copies only the recorded
  2026-10-26 table and marks the first scheduled refresh as an unobserved
  follow-up; `doctor` after that date is the evidence to record.
- **The migration matrix invents a Codex path** → only recorded paths are
  named; commands and plugins are reported unsupported until a same-agent path
  exists.
- **Helper output changes** → only path strings change; the Codex stub-backed
  tests assert the messages, and `make test` runs the full suite.
- **Sibling page updates widen the diff** → they are limited to the navigation
  banner and `See also` line; no procedure changes.
- **The agent-onboarding capability Purpose still names three agents** → it is
  prose, not a requirement, and this planning change does not edit existing
  specs; the apply phase can decide whether to update it directly after the
  four-agent requirements land.

## Migration Plan

1. Create the verification page from the recorded README table; then replace
   the README table with the summary and link.
2. Move the flat page to the reference and rewrite the current links.
3. Create the playbook and point onboarding, the contract, and the shared pages
   at the three new pages.
4. Update the helper strings, the provider comment, and the test scan path.
5. Sync the three spec deltas and run the gates in `tasks.md`.

Rollback is a revert of the change commit; no runtime state, credential, image,
or sandbox is touched.

## Open Questions

- **Codex skills and commands.** The Dockerfile records that Codex reads skills
  from `/sandbox/.agents`, outside its home, but the repository does not record
  a host path or a custom-command surface. The plan names only
  `/sandbox/.agents` for skills and reports commands unsupported. Confirm that
  scope during apply if a verified host path exists; otherwise keep the
  unsupported report.
- **agent-onboarding Purpose.** The capability Purpose still says the contract
  is "across Maki, OpenCode, and Claude Code." Updating it means editing
  `openspec/specs/agent-onboarding/spec.md` directly, not a delta. Confirm
  whether the apply phase should make that prose edit or leave it for a later
  docs pass; the four-agent requirements are the actual contract.
