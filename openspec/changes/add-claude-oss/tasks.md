# Tasks

## 1. Spikes (live, settle before coding)

- [x] 1.1 Build a throwaway `ubuntu:24.04` image with the pinned native `claude` at `/usr/local/bin/claude` (design D2), run `claude --version` and a Grep-tool headless run as uid 1500, and record whether the bundled ripgrep works or `ripgrep` must be installed
- [x] 1.2 In an OpenShell sandbox from that image with `claude-anthropic` attached and the D3 managed settings in place, run one headless and one interactive session, and verify with `openshell logs` that `/usr/local/bin/claude` contacts no host other than `api.anthropic.com`; record whether the settings `env` block is enough or the D3 per-exec fallback is needed
- [x] 1.3 In the same sandbox, attach the TUI with the D4 seed in `/sandbox/.claude/.claude.json`, and record which screens still appear (onboarding, theme, trust, bypass confirmation, API-key approval); pick the D4 seed or its build-time fallback accordingly
- [x] 1.4 Verify both credential kinds end to end against `api.anthropic.com` through the proxy: a headless `reply OK` run with only `claude-anthropic`, then with only `claude-anthropic-oauth` (token from `claude setup-token` on the host), and record the exit codes and that `printenv` in the sandbox shows no real value

## 2. Subproject

- [x] 2.1 Write `claude-oss/image/Dockerfile` (D2 build arguments, checksum check, uid/gid 1500, `CLAUDE_CONFIG_DIR`), and verify `docker build` succeeds on the host architecture, `claude --version` prints the pin, `id` reports 1500, and a build with a changed version but unchanged checksums fails
- [x] 2.2 Write `claude-oss/image/managed-settings.json` (D3) and install it root-owned, and verify a headless run reports no settings error, refuses `sudo -n true` and a write under `/sandbox/.claude/` with `--dangerously-skip-permissions`, and that uid 1500 cannot write the settings file
- [x] 2.3 Write the `claude-oss/image/claude.json` seed (at `/sandbox/.claude.json`) and the `approve-api-key` launcher step per design D4, and verify a fresh sandbox's TUI opens on the prompt in `/sandbox/project` with `claude-anthropic` attached, that the step is a no-op with only the token attached, and that the seed contains no credential value
- [x] 2.4 Write `claude-oss/providers/` (`claude-anthropic.yaml`, `claude-anthropic-oauth.yaml`, `catalog.tsv`, `stores.tsv`, `template.yaml`) per D5 and D7, and verify `openshell profile lint --from claude-oss/providers` passes, every `binaries` list is exactly `/usr/local/bin/claude`, and every catalog and stores row names an existing profile
- [x] 2.5 Write `claude-oss/policies/minimal.yaml`, and verify in a sandbox that writes to `/sandbox/x` and `/tmp/x` succeed and a write to `/etc/x` fails

## 3. Front-end

- [x] 3.1 Create `bin/claude-oss` with the D1 identity and `agent_usage`, add it to the Makefile shellcheck target, and verify `bin/claude-oss help` lists the spec's command set (no `maki`, `opencode`, or `fish`) and `make lint` passes
- [x] 3.2 Extend the openshell stub's agent case to `claude` (it already records exec argv and stdin, so no separate `tests/stub/claude` is needed), implement `agent_headless_argv`, `agent_interactive_argv`, and `agent_exec_stdin` per D6, and verify stub tests assert the headless argv with closed stdin, the interactive argv without `-p`, `--model` in both modes, and exit-code pass-through
- [x] 3.3 Implement `agent_check_session_flags` with the UUID check (D6), and verify stub tests for pass-through of `--continue`, `--resume`, and a UUID `--session-id`, and a usage error with no gateway call for a non-UUID ID and for each conflicting pair
- [x] 3.4 Implement `agent_dispatch` for `claude`, `image build` (`--claude-version` via `agent_parse_option`, checksum hint on failure), and `mcp status`, and verify stub tests for the image build argv, the exit 2 and hint on a failed build, and dispatch of bare/`claude` to the interactive session
- [x] 3.5 Add `cc` to `front_end` in `bin/osa`, and verify a test where a `claude-oss up` registration appears in `osa projects --json` with agent `cc` and `osa status --json` matches `claude-oss status`

## 4. Provider setup and doctor

- [x] 4.1 Wire the API-key route through `stores.tsv` (D7), and verify a stub test of `provider setup --from maki --credential anthropic --yes` that asserts the imported `claude-anthropic` profile, the created provider, the printed example model, and that the value never appears in argv, files, or output (reuse the `STUB_CREDENTIAL_ENV` checks)
- [x] 4.2 Wire the subscription route (D7; add the curated-profile choice hook only if the generic flow cannot reach a curated profile), and verify a stub test of `provider setup --env CLAUDE_CODE_OAUTH_TOKEN --yes` creating `claude-anthropic-oauth` with the same non-exposure checks, the `claude setup-token` hint when no token is given, and that no file under a fake `~/.claude/` or `~/.config/anthropic/` is opened
- [x] 4.3 Implement `agent_doctor_extra` (model report, the both-providers precedence warning, the MCP section), and verify stub tests for the warning line with both providers attached, its absence with one, and an unchanged exit code

## 5. MCP status

- [x] 5.1 Implement `agent_mcp_servers` over `.mcpServers` (D8), and verify stub tests with host and sandbox `.claude.json` fixtures: server missing in the sandbox (names `claude-mcp-<name>`), server present, http and stdio rows, `CLAUDE_CONFIG_DIR` selecting the host file, an unreadable file, and missing `jq`

## 6. Parity tests

- [x] 6.1 Add a `claude-oss` group to `tests/run-tests.sh` covering prefix and config isolation from the other front-ends, up/status/rm confirmation, the `--env` credential guard for `CLAUDE_CODE_OAUTH_TOKEN`, `run --timeout`, no-provider behavior, proposals enablement, idle stop waiting on `claude`, the shared `osa` state root with no `claude-oss/` state dir, and one sync scenario per path under `.claude-oss`, and verify `make test` passes with every existing `maki-oss` and `opencode-oss` test unedited

## 7. Docs and live verification

- [x] 7.1 Write `docs/claude-oss.md` (install, config and `CLAUDE_OSS_*`, the two credential routes with `claude setup-token` on the host, precedence, session mapping including the `--continue` split, MCP status, what is not supported), and verify it has no `--env`/`--env-from` credential use and passes the placeholder-spelling check
- [x] 7.2 Update `AGENTS.md` per D9 and add the root `README.md` pointer, and verify `scripts/check-links.sh` passes and the placeholder-spelling check finds nothing
- [x] 7.3 Live verification with the real gateway: `claude-oss image build`, `provider setup` for each credential kind, bare session (TUI opens on the prompt with no first-run screens), `run "reply OK"`, `run --resume <id>`, a change synced back to a git project, `download` of a created file, `mcp status`, `rm --yes`; verify each check and record the commands and observed output in `claude-oss/README.md`'s verification record, with the helper-first guide and the raw-command fallback

## 8. Close

- [x] 8.1 Verify that `git diff --stat` touches only the paths the `claude-oss` self-contained requirement allows, that `make test` and `make lint` pass, and that `openspec validate add-claude-oss --strict` passes
