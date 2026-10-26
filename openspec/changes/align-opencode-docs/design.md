# Design

## Context

See `proposal.md` — Why. Maki already proves the target shape:
`docs/ai/playbooks/maki.md` owns the ordered sandbox path and
`docs/ai/reference/maki.md` is a thin index of agent-specific differences.
OpenCode still has one flat page, `docs/opencode-oss.md`, that mixes an ordered
quick start, helper behavior, raw commands, configuration differences, MCP
status, and a personal-environment recipe. The document contract names
`docs/ai/playbooks/opencode.md` and `docs/ai/reference/opencode.md` as the
target paths.

The flat page also predates the shared host playbook split: its install section
starts with the helper and image, which are P2-P4 work, while onboarding now
routes P0-P2 to `docs/ai/host-playbook.md`.

## Goals / Non-Goals

**Goals:**

- Give OpenCode the same contract-shaped pages as Maki: a playbook a reader
  can execute phase by phase, and a reference that indexes only OpenCode
  differences.
- Keep every verified OpenCode behavior, command, and trap from
  `docs/opencode-oss.md` and `opencode-oss/README.md`.
- Leave one current path per subject: the playbook for procedure, the
  reference for configuration and differences, the README for the subproject
  and its verification record, and the shared docs for shared helper,
  provider, MCP, and environment behavior.
- Keep the helper and its tests behaviorally identical; only documentation
  path strings change.

**Non-Goals:**

- Creating `docs/ai/verification/opencode.md`. The P6 cell points at
  `opencode-oss/README.md#verification-record` until that page exists.
- Editing `examples/`, `bridge/`, `oskhs/`, `dashboard/`, any image, policy, or
  provider file, or any Claude page/spec.
- Adding a redirect stub at the old `docs/opencode-oss.md` path.
- Replacing the raw commands with helper commands. The raw path is the
  explicit-control and debugging path and stays documented.

## Decisions

### D1 — Move the flat page, do not leave a stub

`docs/opencode-oss.md` becomes `docs/ai/reference/opencode.md`, and every
current link moves with it. No redirect page is added.

- **Why:** the contract forbids a second current path, and a stub would keep
  the old name discoverable after the move. The link checker makes a missed
  reference a build failure instead of a silent stale page.
- **Alternative rejected:** keep the flat page as a redirect. It duplicates a
  page name and lets old anchors drift.

### D2 — Playbook first, reference second

The playbook owns the ordered commands for P3-P8 and is helper-first, with the
raw `docker`/`openshell` commands as a fallback under the same phase. The
reference keeps the OpenCode-specific facts a reader needs while running those
phases: config paths, profiles, session/model behavior, MCP status, store
shape, and differences.

- **Why:** a reader who already knows the shared procedure wants an index, not
  a second procedure; a reader setting up wants one ordered path. Splitting
  them removes the duplication the flat page carried.
- **Alternative rejected:** keep one page and add phase headings. The result
  is still a mixed page that the contract cannot enforce as one kind.

### D3 — Helper-first, raw commands still executable

Each phase starts with the `opencode-oss` command and then shows the raw
equivalent. The helper is the everyday path; the raw path remains for
scripting, boundary debugging, and readers who do not want the helper.

- **Why:** the helper encodes the traps (`--standalone`, stdin, TUI model
  overlay, catalog-fetch switch), while the raw commands are already verified
  in `opencode-oss/README.md`. Both must stay true.
- **Alternative rejected:** helper-only. The playbook exists to show the
  sandbox boundary, and the helper hides some of it.

### D4 — Keep OpenCode's traps normative in the playbook

The playbook states, in the phase where each applies:

- `--standalone` on every OpenCode exec; without it OpenCode starts a
  background service and writes `service.json`.
- stdin redirected from `/dev/null` for headless `opencode run`, because
  `sandbox exec` leaves stdin open.
- `--auto` on `run` only; the TUI asks before un-denied tool calls, and
  automatic approval is a permissions preference in a derived image.
- TUI model selection through `/models` or the project's own `opencode.json`;
  the helper's model overlay is described in the reference.
- `OPENCODE_DISABLE_MODELS_FETCH=1` on every exec, because `sandbox exec` does
  not pass image `ENV` through.
- No `opencode auth login` or base-URL override in the sandbox; provider
  profiles bind `/usr/local/bin/opencode`.

- **Why:** these are the differences that make OpenCode fail in a sandbox when
  copied from a host workflow. Hiding them in the reference would make the
  playbook unsafe to follow.
- **Alternative rejected:** rely on the helper to hide them. A reader using
  the raw fallback would hit every trap.

### D5 — P6 points at the existing verification record

The playbook's `Handoff`/`Verification` metadata and the onboarding P6 cell
point at `opencode-oss/README.md#verification-record`. The playbook still
references `docs/verification.md` for the shared isolation checklist, with the
OpenCode substitutions.

- **Why:** the README already records the pinned OpenCode run; a separate
  verification page would duplicate it before its own alignment change.
- **Alternative rejected:** create an empty verification page. It would fail
  the contract's required blocks or claim checks that were not run.

### D6 — The reference says `not yet verified`

The playbook carries the existing OpenCode v2.1.4 / OpenShell v0.1.5 /
2026-10-25 record; the reference says `not yet verified` because it is an
index, not a separate procedure.

- **Why:** the contract ties `Verified` to the last real run of that page. The
  reference has not been run as a procedure.
- **Alternative rejected:** copy the playbook's version claim onto the
  reference. That would imply a second verified procedure.

### D7 — Path strings in the helper, not behavior

`bin/opencode-oss` changes four documentation strings (`OSS_CONFIG_EXAMPLE`,
`OSS_MCP_FIX_DOC`, the header comment, and the help text), and
`tests/run-tests.sh` updates the one expected message that quotes
`OSS_MCP_FIX_DOC`.

- **Why:** the helper prints these paths to users, so they must not name the
  removed page. No code path, argument, or sandbox behavior changes.
- **Alternative rejected:** leave the strings and accept a dead path in output;
  that violates the one-current-path rule.

### D8 — Three path-only spec deltas

The change modifies the `opencode-oss` allowlist and cross-subproject
scenario, the `agent-onboarding` agent-page scenario, and the `host-setup`
per-agent page list. The `host-setup` delta is a path-and-ownership
correction: it names `docs/ai/playbooks/opencode.md` as the OpenCode owner and
removes the reference from the owner list.

- **Why:** a current spec that names a removed path is stale even if the docs
  are right; the acceptance grep includes `openspec/specs`.
- **Alternative rejected:** leave `host-setup` untouched as "historical". The
  requirement is current behavior, not a historical record.

## Risks / Trade-offs

- **A missed old path** → acceptance greps over `docs`, `AGENTS.md`,
  `README.md`, `opencode-oss`, `bin`, `tests`, and `openspec/specs`; the link
  checker and test suite catch the rest.
- **A missed anchor** → every onboarding cell and README link is checked
  manually because `scripts/check-links.sh` strips fragments.
- **Trimmed content loses a verified behavior** → the playbook must still
  contain `--standalone`, `</dev/null`, `--auto`, `/models`,
  `OPENCODE_DISABLE_MODELS_FETCH=1`, the no-auth rule, and
  `/usr/local/bin/opencode`; the reference keeps session flags, model
  resolution, MCP status, store shape, and image-pin notes.

- **The helper's output changes** → only the path string changes; the
  stub-backed tests assert the message and the full suite runs.
- **The docs claim more verification than exists** → the playbook copies the
  existing record's versions/date, and the reference says `not yet verified`.
