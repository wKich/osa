# Proposal

## Why

Claude Code still uses the flat `docs/claude-oss.md` page, while Maki and
OpenCode now have an ordered playbook and a thin reference at the document
contract's paths. An onboarding reader cannot follow Claude Code phase by
phase, and the flat page mixes an ordered quick start, raw commands,
configuration differences, credential rules, MCP status, and image notes that
belong in separate pages.

## What Changes

- Add `docs/ai/playbooks/claude.md`: helper-first Phases 1-7 (image,
  credentials/provider, policy, sandbox, isolation, run, cleanup) with
  raw-command fallbacks and `### Run` / `### Verify` / `### Stop if` in every
  phase.
- Move `docs/claude-oss.md` to `docs/ai/reference/claude.md` with contract
  metadata and `## Scope` / `## See also`, and trim it to Claude-specific
  config paths, credentials, profiles, sessions and model selection, MCP,
  store shape, and differences.
- Preserve the Claude-specific behavior in the playbook: an API key or a
  host-created subscription token, no in-sandbox `/login`, `claude auth`, or
  `claude setup-token`, no `ANTHROPIC_BASE_URL` or `apiKeyHelper`, default
  `/sandbox/.claude/` and `/sandbox/.claude.json`, the API-key approval step
  for interactive runs, `--dangerously-skip-permissions`, `-p` stream-json,
  `--resume`, stdin from `/dev/null`, and provider profiles bound to
  `/usr/local/bin/claude`.
- Update the Claude P0-P8 cells, local phase map, and `See also` in
  `docs/ai/onboarding.md`; point P6 at
  `claude-oss/README.md#verification-record` until a verification page exists.
- Update the Claude links in `docs/ai/references.md`,
  `docs/ai/host-playbook.md`, and `claude-oss/README.md`; the upstream Claude
  links move to the reference pack, which is the only external-link index.
- Update the doc-path strings and help text in `bin/claude-oss`, and the
  placeholder-spelling scan path in `tests/run-tests.sh`.
- Update the `claude-oss`, `agent-onboarding`, and `host-setup` spec deltas so
  the new paths are the contract.
- **Does not** change any helper, image, policy, provider, bridge, oskhs,
  dashboard, or sandbox behavior. The only `bin/claude-oss` edits are
  documentation path strings.
- **Does not** add a redirect stub; the old `docs/claude-oss.md` path is
  removed.
- **Does not** create `docs/ai/verification/claude.md`; P6 points at the
  existing verification record in `claude-oss/README.md`.

## Capabilities

### New Capabilities

_None._ This change moves and reshapes documentation; no runtime behavior is
introduced.

### Modified Capabilities

- `claude-oss`: the self-contained subproject allowlist names
  `docs/ai/playbooks/claude.md` and `docs/ai/reference/claude.md` instead of
  the flat page, and allows the old `docs/claude-oss.md` only as the removed
  source of the move. The README verification-record requirement is unchanged.
- `agent-onboarding`: the "Agent page names its path" scenario names the
  Claude playbook and reference instead of the flat page.
- `host-setup`: the per-agent host-steps requirement names the Claude playbook
  as the page that owns Claude-specific steps; the reference is not a step
  owner.

## Impact

- **Moved file:** `docs/claude-oss.md` → `docs/ai/reference/claude.md`.
- **New file:** `docs/ai/playbooks/claude.md`.
- **Edited files:** `docs/ai/onboarding.md`, `docs/ai/host-playbook.md`,
  `docs/ai/references.md`, `claude-oss/README.md`, `bin/claude-oss`,
  `tests/run-tests.sh`.
- **Spec deltas:** `openspec/specs/claude-oss/spec.md`,
  `openspec/specs/agent-onboarding/spec.md`, and
  `openspec/specs/host-setup/spec.md` (paths and scenarios only).
- **No code, image, policy, provider, bridge, oskhs, dashboard, or sandbox
  changes.** No credential path or egress rule is touched; the helper keeps
  every `--dangerously-skip-permissions`, approval, stdin, stream-json, and
  session behavior.
- **Risk:** a missed old link or anchor is a visible failure, because there is
  no redirect stub. `scripts/check-playbooks.sh`, `scripts/check-links.sh`,
  and the test suite are the gates.
- **Dependencies:** the `align-host-playbook` and `align-opencode-docs` changes
  have landed, so the shared host path P0-P2 and the sibling contract-shaped
  pages already exist; this change starts at P3.
