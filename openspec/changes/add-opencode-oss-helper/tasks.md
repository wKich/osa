# Tasks

Prerequisite: `extract-oss-core` is merged and `make test` is green on it.

## 1. Spikes (live, settle before coding)

- [x] 1.1 In an `opencode-agent:local` sandbox with one profile attached, run `opencode run` and the TUI with `--env OPENCODE_CONFIG_CONTENT={"model":"<profile model>"}` and `--env OPENCODE_DISABLE_MODELS_FETCH=1`. Verify that the model is used, that no `models.opencode.ai` denial appears in `openshell logs`, and that a `shell sudo -n true` call and an edit under `/sandbox/.config/` are still denied. Record whether the overlay merges with or replaces the global config, and pick the design D2/Risks branch accordingly
- [x] 1.2 Confirm `opencode run --session <new-id>` creates a session with that ID and that a second call with it resumes the session, and record the result for the design D3 mapping

## 2. Core hook gaps

- [x] 2.1 Add the optional `agent_exec_env` (default: none) and `agent_exec_stdin` (default `tty`) hooks to `lib/oss-core.sh`, route their output through the existing credential-name guard, and verify `make test` passes with zero edits to existing tests

## 3. Front-end

- [x] 3.1 Create `bin/opencode-oss` with the design D1 identity and defaults and `agent_usage`, and verify `bin/opencode-oss help` lists the spec's command set (no `maki`, no `fish`) and `make lint` passes with the file added to the shellcheck target
- [x] 3.2 Implement `agent_interactive_argv`, `agent_headless_argv`, `agent_exec_stdin` (`null` for run), and `agent_exec_env` per design D2, and verify stub tests assert the run argv, closed stdin, the TUI argv without `--auto`, the fetch switch on every exec, and the model overlay only on interactive sessions
- [x] 3.3 Implement `agent_check_session_flags` and the session mapping (design D3), and verify stub tests for `--resume` → `--session`, `--session-id` → `--session`, `--continue`, and the usage error with no sandbox work on conflicting flags
- [x] 3.4 Implement `agent_dispatch` for `opencode`, `image build` (with `--opencode-version` via `agent_parse_option`), and `mcp status`, and verify stub tests for the image build argv and the dispatch of bare/`opencode` to the interactive session

## 4. Provider setup

- [x] 4.1 Create `opencode-oss/providers/stores.tsv` (four-column wizard format, Maki and OpenCode store slugs → `opencode-*` profiles), and verify a check that every row names an existing profile and every curated profile is reachable from at least one slug
- [x] 4.2 Implement `agent_setup_hint` from `catalog.tsv`'s example model, and verify a stub test of `provider setup --from opencode --credential synthetic --yes` that asserts the imported profile, the created provider name, the recorded config, the printed example model, and that the credential value never appears in argv, files, or output (reuse the existing `STUB_CREDENTIAL_ENV` checks)

## 5. MCP status

- [x] 5.1 Implement the design D5 JSON parsing (`jq`) behind the MCP hook, and verify stub tests with host and sandbox `opencode.json` fixtures: server missing in the sandbox, server present, disabled server, unreadable (JSONC) file, and missing `jq` → dependency exit and doctor skip line

## 6. Parity tests

- [x] 6.1 Add an `opencode-oss` group to `tests/run-tests.sh` covering prefix/config isolation from `maki-oss`, up/status/rm confirmation, the `--env` credential guard, `run --timeout`, no-provider behavior, proposals enablement, and one sync scenario per path (clean git, dirty host, plain directory, no-git) under `.opencode-oss`, and verify `make test` passes with every existing Maki test unedited

## 7. Docs

- [x] 7.1 Write `docs/opencode-oss.md` (install, config file and `OPENCODE_OSS_*`, the differences from `maki-oss` with links to `docs/helper.md` for shared behavior, model selection, session mapping, MCP status, and what is not supported), and verify it has no `--env`/`--env-from` credential use and passes the placeholder-spelling check
- [x] 7.2 Update `opencode-oss/README.md` to lead with the helper (`opencode-oss provider setup`, bare `opencode-oss`, `opencode-oss run`) and keep the raw commands as "without the helper", and verify that every command in it runs as written in the live pass (7.3)
- [x] 7.3 Live verification with the real gateway: `opencode-oss image build`, `provider setup` (synthetic), bare session (TUI renders on the configured model), `run "reply OK"`, `run --continue`, a change synced back to a git project, `mcp status`, `rm --yes`. Verify each check and record the commands and observed output in the README's verification record

## 8. Close

- [x] 8.1 Verify that `git diff --stat` matches the modified `opencode-oss` requirement's allowed paths, that `make test` and `make lint` pass, and that `openspec validate add-opencode-oss-helper --strict` passes
