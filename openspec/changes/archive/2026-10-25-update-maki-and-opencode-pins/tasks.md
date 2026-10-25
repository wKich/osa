# Tasks

## 1. Maki v0.6.5

- [x] 1.1 Bump `ARG MAKI_VERSION` in `examples/maki-image/Dockerfile` and its
  build comment; update the host, agent, setup, reference, and roadmap version
  labels to `0.6.5`. Verify with
  `rg -n "0\\.6\\.4" examples/maki-image/Dockerfile docs/ai docs/setup-guide.md docs/roadmap.md`
  showing only intentional historical references, and
  `docker run --rm maki-agent:local maki --version` printing `maki 0.6.5` after
  the image build.
- [x] 1.2 Update the `Maki SDK (wire)` version row in
  `bridge/compat/statuses.json` and the one shifted citation
  (`maki-ui/src/app/mod.rs` `/compact` L1969 → L1970). Verify the citation at
  tag v0.6.5 and `make compat` exits 0.
- [ ] 1.3 Update the host `maki` CLI to 0.6.5 and rebuild the image. Verify
  `maki --version` and `docker run --rm maki-agent:local maki --version`
  both print 0.6.5, and run one headless turn on an OpenCode Go profile and a
  Gemini profile to exercise the adaptive-thinking and token-accounting fixes.
  **Skipped by user on 2026-10-25:** no Gemini credentials are available.
  The host CLI and image rebuild are done and verified; the two provider
  turns were not run and are recorded as an environment-gated gap.
- [x] 1.4 Record the v0.6.5 upgrade, provider fixes, and the stricter
  `providers.toml` validation in `docs/verification-log.md`; confirm the
  generated oskhs and live-journey `providers.toml` files still parse.
  Verify with a TOML parse of both generated configs and a named rollback note
  to v0.6.4.

## 2. OpenCode v2.1.4 contract

- [x] 2.1 Install OpenCode v2.1.4, capture its contract, and replace
  `bridge/src/openapi-2.0.32.json` with `bridge/src/openapi-2.1.4.json`.
  Update `PINNED_VERSION`, the bridge's advertised session version, the
  contract helper, and the route/drift scripts. Verify
  `bun scripts/compat-drift.ts` reports a v2.1.4 capture with no route or
  schema drift against the vendored copy.
- [x] 2.2 Add the six new operations to `bridge/compat/statuses.json` as
  `out-of-scope` rows: client MCP (HTTP and token), voice models and session
  instructions, saved-permission PATCH, and heap dump. Update the version
  matrix. Verify `bun scripts/enumerate-routes.ts --diff` is green after
  resolving the existing `GET /auth/connect/{code}` phantom row.
- [x] 2.3 Copy the evidence matrices forward and re-read them at v2.1.4.
  Triage the new TUI behavior: todo sidebar as a reachable feature, client MCP
  and new-designs/free-model experiments as out-of-scope, and session
  archiving/saved-permission editing as contract-only until the TUI exposes
  them. Verify every new operation has a row, no reachable route is
  untriaged, and the feature matrix names the new pin.
- [x] 2.4 Re-read the changed OpenCode TUI/core files cited by the status rows,
  bridge comments, and tests at v2.1.4; update line citations rather than
  bulk-replacing the version text. Verify no current-pin citation still names
  v2.0.32 and `rg -n "v2\\.0\\.32" bridge/src bridge/compat bridge/test` shows
  only intentional historical captures or open-change archives.
- [x] 2.5 Update version assertions and paths in `boot-surface.test.ts`,
  `contract.test.ts`/`lib/contract.ts`, the journey harness tests, and the
  compatibility scripts. Verify `make test-bridge` and
  `bun scripts/gen-compat.ts --check` pass.

## 3. Todo tool rendering

- [x] 3.1 Add an explicit Maki-to-OpenCode tool-name map covering
  `todo_write`/`TodoWrite` → `todowrite`, `WebFetch` → `webfetch`,
  `WebSearch` → `websearch`, and `CodeExecution` → `execute`, while leaving
  single-word names and permission asks unchanged. Verify with unit tests for
  all four mappings and the existing permission round-trip tests.
- [x] 3.2 Add an authored `maki-todo` fixture (a TodoWrite call with
  `todos: [{ content, status }]`) and its
  `bridge/test/fixtures/provenance.json` entry, plus a golden that asserts the
  `todowrite` part name and unchanged todos input. Verify
  `bun test` in `bridge/` and `crosscheck.test.ts` provenance checks pass.
- [x] 3.3 Add the todo feature row and a `see-agent-todos` journey whose
  checkpoints show the transcript list and sidebar, then record it. Verify the
  journey reaches `parity`, the feature is `verified`, and `make compat`
  regenerates without stale status.
- [x] 3.4 Confirm the permission path still names Maki's original tool and the
  answer reaches the child. Verify `allow-permission-once`,
  `allow-permission-always`, and `reject-permission-with-reason` fixtures still
  pass or retain their recorded pin-blocked verdict.

## 4. Journeys, captures, and live evidence

- [x] 4.1 Set the journey catalog `pin.opencode` to `2.1.4` and re-enumerate
  the 67 journey rows against the v2.1.4 TUI source. Add or remove a row only
  when the new source no longer offers the journey. Verify every row's source
  citation resolves at the new tag.
- [x] 4.2 Re-record all journeys with `make test-journeys`; review every
  semantic diff and accept only differences explained by the pin or Maki's
  behavior. Verify the catalog statuses, snapshots, diffs, and
  `docs/compatibility.md` are regenerated and `make compat` exits 0.
- [x] 4.3 Recapture `bridge/test/fixtures/bridge-requests.jsonl` and
  `bridge/test/captures/tui-last-requests.jsonl` against the v2.1.4 TUI; update
  the provenance note and measured-route set. Verify `make test-bridge`,
  `make test-ui`, and `crosscheck.test.ts` pass with no unhandled route.
- [x] 4.4 Run the 61 live journeys against the rebuilt v0.6.5 image and the
  v2.1.4 TUI. Update each `evidence.live` version/image/verdict. If the
  gateway, image, or engine is unavailable, keep the old evidence explicitly
  labeled v0.6.4 and record why in the change evidence; do not relabel it.
  Verify `make test-journeys-live` and the live crosscheck.
- [x] 4.5 Re-run the API and TUI discovery passes; triage any appended defect
  rather than leaving a red test. Verify `bun bridge/test/discovery.ts` appends
  nothing new or records a fix change, `make test-ui` passes, and
  `bridge/defects.json` has no unexplained open entry.

## 5. Documentation and OpenShell verification

- [x] 5.1 Update the OpenCode tag references, Maki version labels, and
  compatibility report; add the v2.1.4/v0.6.5 upgrade note to the verification
  log. Verify `scripts/check-links.sh`, `bun scripts/gen-compat.ts --check`,
  and `rg -n "2\\.0\\.32|0\\.6\\.4" docs` show only historical or
  intentionally pinned evidence.
- [x] 5.2 Verify OpenShell is still v0.1.5 on both the CLI and gateway, and
  that v0.1.5 is the latest stable release (`v0.1.6-pre.*` is pre-release
  only). Record that no pin move or verification re-run is required. Verify
  `openshell --version`, `openshell status`, and the GitHub release check.

## 6. Final gate and coordination

- [x] 6.1 Leave the eight untracked plugin-relay proposals untouched, but
  record in the change notes that their v0.6.4/v2.0.32 citations and
  journey/status claims need a refresh after this change. Verify
  `git status --short` shows no edits inside their change directories.
- [x] 6.2 Run the full gate: `make test`, `make test-bridge`,
  `make test-oskhs`, `make lint`, `make test-ui`, `make test-journeys`,
  `make test-journeys-live` when the gateway is available, `make compat`,
  `make compat-drift`, and `make maki-drift`. Verify every target exits 0;
  record any environment-gated skip with its reason.
- [x] 6.3 Run `openspec validate "update-maki-and-opencode-pins"` and
  `openspec status --change "update-maki-and-opencode-pins"`; verify the
  change is valid and all artifacts are done.
