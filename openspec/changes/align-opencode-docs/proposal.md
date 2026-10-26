# Proposal

## Why

OpenCode still uses the flat `docs/opencode-oss.md` page, while Maki already has
an ordered playbook and a thin reference at the document contract's paths. An
onboarding reader cannot follow OpenCode phase by phase, and the flat page
duplicates the shared helper, provider, and MCP explanations that belong in
the shared docs.

## What Changes

- Move `docs/opencode-oss.md` to `docs/ai/reference/opencode.md` with contract
  metadata and `## Scope` / `## See also`, and trim it to OpenCode-specific
  config paths, profiles, sessions and model selection, MCP, store, and
  differences.
- Add `docs/ai/playbooks/opencode.md`: helper-first Phases 1-7 (image, provider,
  policy, sandbox, isolation, run, cleanup) with raw-command fallbacks and
  `### Run` / `### Verify` / `### Stop if` in every phase.
- Preserve the OpenCode-specific runtime rules in the playbook: `--standalone`
  on every exec, stdin `/dev/null` for headless runs, `--auto` for `run` only,
  TUI model selection through `/models` or the project `opencode.json`,
  `OPENCODE_DISABLE_MODELS_FETCH=1` on every exec, no in-sandbox authentication,
  and provider profiles bound to `/usr/local/bin/opencode`.
- Update the OpenCode P0-P8 cells, local phase map, and `See also` in
  `docs/ai/onboarding.md`; point P6 at
  `opencode-oss/README.md#verification-record` until a verification page
  exists.
- Update the OpenCode links in `docs/ai/host-playbook.md`, `docs/helper.md`,
  and `opencode-oss/README.md`.
- Update the doc-path strings and help text in `bin/opencode-oss`, and the
  expected message in `tests/run-tests.sh`.
- Update the `opencode-oss`, `agent-onboarding`, and `host-setup` spec deltas
  so the new paths are the contract.
- **Does not** change any helper, image, policy, provider, bridge, oskhs,
  dashboard, or sandbox behavior. The only `bin/opencode-oss` edits are
  documentation path strings.
- **Does not** add a redirect stub; the old `docs/opencode-oss.md` path is
  removed.

## Capabilities

### New Capabilities

_None._ This change moves and reshapes documentation; no runtime behavior is
introduced.

### Modified Capabilities

- `opencode-oss`: the self-contained subproject allowlist names
  `docs/ai/playbooks/opencode.md` and `docs/ai/reference/opencode.md` instead of
  the flat page, and the no-cross-subproject scenario follows the same paths.
  The README verification-record requirement is unchanged.
- `agent-onboarding`: the "Agent page names its path" scenario names the
  OpenCode playbook and reference instead of the flat page.
- `host-setup`: the per-agent host-steps requirement names the OpenCode
  playbook and reference as the pages that own OpenCode-specific steps.

## Impact

- **Moved file:** `docs/opencode-oss.md` → `docs/ai/reference/opencode.md`.
- **New file:** `docs/ai/playbooks/opencode.md`.
- **Edited files:** `docs/ai/onboarding.md`, `docs/ai/host-playbook.md`,
  `docs/helper.md`, `opencode-oss/README.md`, `bin/opencode-oss`,
  `tests/run-tests.sh`.
- **Spec deltas:** `openspec/specs/opencode-oss/spec.md`,
  `openspec/specs/agent-onboarding/spec.md`, and
  `openspec/specs/host-setup/spec.md` (paths and scenarios only).
- **No code, image, policy, provider, bridge, oskhs, dashboard, or sandbox
  changes.** No credential path or egress rule is touched; the helper keeps
  every `--standalone`, stdin, `--auto`, and model-overlay behavior.
- **Risk:** a missed old link or anchor is a visible failure, because there is
  no redirect stub. `scripts/check-playbooks.sh`, `scripts/check-links.sh`,
  and the test suite are the gates.
- **Dependencies:** the `align-host-playbook` change has landed, so the shared
  host path P0-P2 already exists; this change starts at P3.
