# Design

## Context

See `proposal.md` — Why. Maki and OpenCode already prove the target shape:
`docs/ai/playbooks/<agent>.md` owns the ordered sandbox path and
`docs/ai/reference/<agent>.md` is a thin index of agent-specific differences.
Claude Code still has one flat page, `docs/claude-oss.md`, that mixes an
ordered quick start, raw commands, configuration differences, credentials,
MCP status, and image notes. The document contract already names
`docs/ai/playbooks/claude.md` and `docs/ai/reference/claude.md` as the target
paths.

The flat page also predates the shared host playbook split: its install
section starts with the helper and image, which are P2-P4 work, while
onboarding now routes P0-P2 to `docs/ai/host-playbook.md`.

## Goals / Non-Goals

**Goals:**

- Give Claude Code the same contract-shaped pages as Maki and OpenCode: a
  playbook a reader can execute phase by phase, and a reference that indexes
  only Claude differences.
- Keep every verified Claude behavior, command, and trap from
  `docs/claude-oss.md` and `claude-oss/README.md`.
- Leave one current path per subject: the playbook for procedure, the
  reference for configuration and differences, the README for the subproject
  and its verification record, and the shared docs for shared helper,
  provider, MCP, and environment behavior.
- Keep the helper and its tests behaviorally identical; only documentation
  path strings change.

**Non-Goals:**

- Creating `docs/ai/verification/claude.md`. The P6 cell and the playbook's
  `Handoff`/`Verification` metadata point at
  `claude-oss/README.md#verification-record` until that page exists.
- Editing `examples/`, `bridge/`, `oskhs/`, `dashboard/`, any image, policy, or
  provider file, or any Maki/OpenCode page or spec.
- Adding a redirect stub at the old `docs/claude-oss.md` path.
- Replacing the raw commands with helper commands. The raw path is the
  explicit-control and boundary-debugging path and stays documented.
- Editing `docs/verification.md`; the playbook uses its existing checks with
  Claude substitutions.

## Decisions

### D1 — Move the flat page, do not leave a stub

`docs/claude-oss.md` becomes `docs/ai/reference/claude.md`, and every current
link moves with it. No redirect page is added.

- **Why:** the contract forbids a second current path, and a stub would keep
  the old name discoverable after the move. The link checker makes a missed
  reference a build failure instead of a silent stale page.
- **Alternative rejected:** keep the flat page as a redirect. It duplicates a
  page name and lets old anchors drift.

### D2 — Playbook first, reference second

The playbook owns the ordered commands for P3-P8 and is helper-first, with the
raw `docker`/`openshell` commands as a fallback under the same phase. The
reference keeps the Claude-specific facts a reader needs while running those
phases: config paths, credentials, profiles, session/model behavior, MCP
status, store shape, and differences.

- **Why:** a reader who already knows the shared procedure wants an index, not
  a second procedure; a reader setting up wants one ordered path. Splitting
  them removes the duplication the flat page carried.
- **Alternative rejected:** keep one page and add phase headings. The result
  is still a mixed page that the contract cannot enforce as one kind.

### D3 — Helper-first, raw commands still executable

Each phase starts with the `claude-oss` command and then shows the raw
equivalent. The helper is the everyday path; the raw path remains for
scripting, boundary debugging, and readers who do not want the helper.

- **Why:** the helper encodes the credentials, approval step, stdin, and
  session traps, while the raw commands are already verified in
  `claude-oss/README.md`. Both must stay true.
- **Alternative rejected:** helper-only. The playbook exists to show the
  sandbox boundary, and the helper hides some of it.

### D4 — Keep Claude's traps normative in the playbook

The playbook states, in the phase where each applies:

- the credential comes from the host: an `ANTHROPIC_API_KEY` already exported
  or stored, or a `CLAUDE_CODE_OAUTH_TOKEN` created by `claude setup-token` on
  the host;
- no `/login`, `claude auth`, or `claude setup-token` in the sandbox, and no
  `ANTHROPIC_BASE_URL` or `apiKeyHelper` there;
- the default `/sandbox/.claude/` and `/sandbox/.claude.json` locations,
  because `sandbox exec` does not pass image `ENV` through;
- the API-key approval step before an interactive run, because Claude Code's
  default answer to its own API-key prompt disables the key;
- `--dangerously-skip-permissions` in both modes while the root-owned managed
  deny rules still apply;
- `-p --output-format stream-json --verbose` for headless runs and
  `</dev/null`, because `sandbox exec` leaves stdin open;
- `--resume` for a headless session, because `--continue` opens the last
  interactive session;
- provider profiles bound to `/usr/local/bin/claude`.

- **Why:** these are the differences that make Claude Code fail in a sandbox
  when copied from a host workflow. Hiding them in the reference would make
  the playbook unsafe to follow.
- **Alternative rejected:** rely on the helper to hide them. A reader using
  the raw fallback would hit every trap.

### D5 — P6 points at the existing verification record

The playbook's `Handoff`/`Verification` metadata and the onboarding P6 cell
point at `claude-oss/README.md#verification-record`. The playbook still
references `docs/verification.md` for the shared isolation checklist, with the
Claude substitutions.

- **Why:** the README already records the pinned Claude Code run; a separate
  verification page would duplicate it before its own alignment change.
- **Alternative rejected:** create an empty verification page. It would fail
  the contract's required blocks or claim checks that were not run.

### D6 — The reference says `not yet verified`

The playbook carries the existing Claude Code v2.1.308 / OpenShell v0.1.5 /
2026-10-26 record; the reference says `not yet verified` because it is an
index, not a separate procedure.

- **Why:** the contract ties `Verified` to the last real run of that page. The
  reference has not been run as a procedure.
- **Alternative rejected:** copy the playbook's version claim onto the
  reference. That would imply a second verified procedure.

### D7 — Path strings in the helper, not behavior

`bin/claude-oss` changes four documentation strings (`OSS_CONFIG_EXAMPLE`,
`OSS_MCP_FIX_DOC`, the header comment, and the help text), and
`tests/run-tests.sh` changes the placeholder-spelling scan path to the moved
reference.

- **Why:** the helper prints these paths to users, so they must not name the
  removed page; the scan must not silently skip the moved page. No code path,
  argument, or sandbox behavior changes.
- **Alternative rejected:** leave the strings and accept a dead path in output;
  that violates the one-current-path rule and weakens the scan.

### D8 — Three path-only spec deltas

The change modifies the `claude-oss` allowlist and cross-subproject scenario,
the `agent-onboarding` agent-page scenario, and the `host-setup` per-agent page
list. The `host-setup` delta names `docs/ai/playbooks/claude.md` as the Claude
owner and keeps the reference out of the owner list.

- **Why:** a current spec that names a removed path is stale even if the docs
  are right; the acceptance grep includes `openspec/specs`.
- **Alternative rejected:** leave `host-setup` untouched as "historical". The
  requirement is current behavior, not a historical record.

### D9 — Claude upstream links move to the reference pack

The moved page's external Claude Code links go to
`docs/ai/references.md` under a new `## Claude Code` section, and the reference
links that pack. `claude-oss/README.md` keeps its own subproject links.

- **Why:** `docs/ai/references.md` is the only index of external documentation
  links under `docs/ai`; adding a new page with direct upstream links would
  bypass that rule.
- **Alternative rejected:** keep the links on the reference. It duplicates the
  index and lets the two link sets drift.

## Risks / Trade-offs

- **A missed old path** → acceptance greps over `docs`, `AGENTS.md`,
  `README.md`, `claude-oss`, `bin`, `tests`, and `openspec/specs`; the link
  checker and test suite catch the rest.
- **A missed anchor** → every onboarding cell and README link is checked
  manually because `scripts/check-links.sh` strips fragments.
- **Trimmed content loses a verified behavior** → the playbook must still
  contain the approval step, `--dangerously-skip-permissions`,
  `--output-format stream-json`, `--resume`, `</dev/null`, the no-auth rule,
  the default config locations, and `/usr/local/bin/claude`; the reference
  keeps credentials, profile naming, session flags, model resolution, MCP
  status, store shape, and differences.
- **The helper's output changes** → only the path string changes; the
  stub-backed tests assert the messages and the full suite runs.
- **The docs claim more verification than exists** → the playbook copies the
  existing record's versions/date, and the reference says `not yet verified`.
