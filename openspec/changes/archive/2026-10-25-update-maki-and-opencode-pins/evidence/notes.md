# Change notes

## Rollback

- **Maki**: restore `ARG MAKI_VERSION=0.6.4` in
  `examples/maki-image/Dockerfile` and rebuild `maki-agent:local`; reinstall
  host Maki 0.6.4 from
  `maki-v0.6.4-aarch64-apple-darwin.tar.gz` (or the host's architecture).
  Restore `bridge/compat/statuses.json`'s `Maki SDK (wire)` row and the
  `/compact` citation (`maki-ui/src/app/mod.rs` L1970 → L1969).
- **OpenCode**: restore `bridge/src/openapi-2.0.32.json`, the
  `PINNED_VERSION`/session version `2.0.32`, the contract helper and script
  paths, the journey pin, snapshots, and the generated report from this
  change's diff.
- **Todo rendering**: removing the `TOOL_NAMES` map restores the old
  first-letter lower-casing; the `maki-todo` fixture, its golden, and the
  `see-agent-todos` journey are additive and can be removed with the map.

## Provider-turn verification

`maki` 0.6.5's provider fixes were read from the release notes (adaptive
thinking on OpenCode Zen/Go, Gemini 3 thinking, cached-token accounting,
base-URL slash handling, transient OAuth token endpoints, LiteLLM gateways
that reject the `thinking` field, and the per-session thread leak). The
headless turns against an OpenCode Go profile and a Gemini profile were not
run in this session: the OpenCode Go provider instance exists, but the host has
no Gemini credential or `maki-google` provider instance, and no model turn was
taken for either. The user accepted skipping this part of task 1.3 on
2026-10-25; the task stays unchecked so the gap is not mistaken for a pass.

## Coordination: parallel plugin-relay proposals

The eight untracked proposals under `openspec/changes/` —
`add-agent-question-relay`, `add-background-bash-detach`,
`add-edit-snapshot-revert`, `add-mcp-disconnect-gate`,
`add-maki-bridge-plugin`, `add-persistent-always-permission`,
`add-plugin-mid-turn-steering`, and `add-subagent-permission-relay` — were not
edited by this change. Their citations to Maki v0.6.4 and OpenCode v2.0.32,
and any journey/status claims they make, need a refresh against v0.6.5 and
v2.1.4 before they are applied or archived.

## Verification gates

- `make test`: 128 passed, 0 failed.
- `make test-bridge`: 225 passed, 0 failed (including the live-evidence
  cross-check after the 62 live runs).
- `make test-oskhs`: 122 passed, 6 skipped, 0 failed.
- `make test-ui`: PASS, 41 requests, 0 open defects.
- `make test-journeys`: 68 rows recorded (53 parity, 7 pin-blocked diverges,
  2 pin-blocked broken, 6 out-of-scope unrecorded); report regenerated.
- `make test-journeys-live`: 62 live journeys against `maki-agent:reference`
  (Maki 0.6.5), all live evidence at `0.6.5`.
- `make compat`, `make compat-drift`, `make maki-drift`: exit 0.
- `scripts/check-links.sh`: 0 failures.
- `openspec validate "update-maki-and-opencode-pins"`: valid, all artifacts
  done.

Remaining gap: task 1.3's OpenCode Go and Gemini headless turns (see
"Provider-turn verification" above).
