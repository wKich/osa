# Tasks

## 1. Gates (live, settle before coding)

- [x] 1.1 Refresh-schedule gate: import a scratch copy of the D4 profile (`refresh_before: "300s"`) under a new id, create a provider from a fresh throwaway host login, run a fresh `openshell provider refresh configure`, and watch `openshell provider refresh status` for two hours; pass if `LAST_REFRESH` advances at most twice with no failure, and record the interval in `spike.md`. If it fails, stop and run `/opsx:update add-codex-oss` to switch to design D10 before any other task
- [x] 1.2 Build a throwaway `ubuntu:24.04` image with the pinned musl `codex` and the D3 files, and in an OpenShell sandbox with the gate's provider attached: verify `codex exec --strict-config` accepts `/etc/codex/managed_config.toml`; check whether a user `/sandbox/.codex/config.toml` and a `-c model_providers…base_url=…` override can redirect the provider; find which `/etc/codex/` rules location the pinned version reads; check whether `sudo -n true` is refused under `--dangerously-bypass-approvals-and-sandbox`. Record each result in `spike.md` and pick the D3 rules location or its fallback
- [x] 1.3 In the same sandbox, run one headless and one interactive session and read `openshell logs` for every connection by `/usr/local/bin/codex`; record the host set (expected only `chatgpt.com`) and whether a request outside `/backend-api/codex/**` (for example `backend-api/wham`) is denied or sent without the credential

## 2. Subproject

- [x] 2.1 Write `codex-oss/image/Dockerfile` per D2 and verify `docker build` succeeds on the host architecture, `codex --version` prints the pin, `id` reports 1500 with `HOME=/sandbox`, no `node`/`bun`/`/sandbox/.agents` exists, and a build with a changed version but unchanged checksums fails
- [x] 2.2 Write `codex-oss/image/managed_config.toml` and the command rules per D3 (and the task 1.2 outcome), installed root-owned, and verify uid 1500 cannot write under `/etc/codex/`, the files hold no credential or account ID, and `codex exec --strict-config` reports no error
- [x] 2.3 Write `codex-oss/providers/` (`codex-chatgpt.yaml` per D4, `catalog.tsv` with `gpt-6-astra` as the example model, a header-only `stores.tsv`, `template.yaml`), and verify `openshell profile lint --from codex-oss/providers` passes on a gateway without `codex-chatgpt`, every `binaries` list is exactly `/usr/local/bin/codex`, and every catalog row names an existing profile
- [x] 2.4 Write `codex-oss/policies/minimal.yaml`, and verify in a sandbox that writes to `/sandbox/x` and `/tmp/x` succeed and a write to `/etc/x` fails
- [x] 2.5 Verify that `grep -r` for the provider-placeholder prefix under `codex-oss/` finds nothing

## 3. Core hook

- [x] 3.1 Add the optional `agent_provider_setup` hook to `cmd_provider_setup` in `lib/oss-core.sh` per D6, with no default definition, and verify `make test` passes with every existing `maki-oss`, `opencode-oss`, and `claude-oss` case unedited

## 4. Front-end

- [x] 4.1 Create `bin/codex-oss` with the D1 identity and `agent_usage`, add it to the Makefile shellcheck target, and verify `bin/codex-oss help` lists the spec's command set (no `maki`, `opencode`, `claude`, or `fish`) and `make lint` passes
- [x] 4.2 Extend the openshell stub's agent case to `codex`, implement `agent_headless_argv`, `agent_interactive_argv`, `agent_exec_stdin`, and `agent_exec_env` per D5, and verify stub tests for the headless argv with closed stdin, the interactive argv without `exec`, `-m` in both modes, `CODEX_CHATGPT_ACCOUNT_ID` in the exec environment, and exit-code pass-through
- [x] 4.3 Implement `agent_check_session_flags` per D5, and verify stub tests for `--continue` (headless `exec resume --last`, interactive `resume --last --include-non-interactive`), `--resume ID` in both modes, and usage errors with no gateway call for `--session-id` and for a missing account ID
- [x] 4.4 Implement `agent_dispatch` for `codex`, `image build` (`--codex-version` via `agent_parse_option`, the checksum hint on failure), and `mcp status`, and verify stub tests for the image build argv, exit 2 with the hint on a failed build, and dispatch of bare/`codex` to the interactive session
- [x] 4.5 Add `cx` to `front_end` in `bin/osa`, and verify a test where a `codex-oss up` registration appears in `osa projects --json` with agent `cx` and `osa status --json` matches `codex-oss status`

## 5. Provider setup

- [x] 5.1 Add `tests/stub/codex` (fake `codex login` writing an `auth.json` with unsigned JWTs into the given `CODEX_HOME`, with fail and hang modes) and the openshell stub's `provider refresh configure|status|delete`, recording argv and env-var names only, and verify the stubs with a direct test of each mode
- [x] 5.2 Implement `agent_provider_setup` per D7, and verify stub tests of `provider setup --yes`: profile import, provider create with `--credential CODEX_CHATGPT_TOKEN`, `refresh configure` with the stub's `client_id` and `exp`, `account_id` written to the config file, the temporary home removed, and no token value in any argv, file, or output (reuse the `STUB_CREDENTIAL_ENV` checks)
- [x] 5.3 Verify stub tests for a re-run (`refresh delete` before `configure`, `provider update` instead of create), `--device-auth` (the settings note is printed and the flag reaches the stub), an interrupted login (temporary home removed, no provider created), `--from`/`--file`/`--field`/`--env` refused naming the login flow, a missing host `codex` (exit 2), and that no file under a fake `~/.codex/` is opened

## 6. Doctor and MCP status

- [x] 6.1 Implement `agent_doctor_extra` per D8, and verify stub tests for the `ok` line with a nine-day expiry, `warn` for no refresh config, for a failed refresh, for under 24 hours to expiry, and for continuous refresh (expiry one hour after the last refresh against the profile's lead time), each with an unchanged exit code
- [x] 6.2 Implement `agent_mcp_servers` over TOML per D9, and verify stub tests with host and sandbox `config.toml` fixtures: server missing in the sandbox (names `codex-mcp-<name>`), server present, http and stdio rows, `enabled = false`, `CODEX_HOME` selecting the host file, and an inline-table file reported as unreadable

## 7. Docs and live verification

- [x] 7.1 Write `docs/codex-oss.md` (install, config and `CODEX_OSS_*`, the host login with browser and device-auth notes, gateway refresh and the continuous-refresh warning, session mapping including `--include-non-interactive`, model IDs, MCP status and its table form, what is not supported), and verify it has no `--env`/`--env-from` credential use and passes the placeholder-spelling check
- [x] 7.2 Update `AGENTS.md` per D12 and add the root `README.md` pointer, and verify `scripts/check-links.sh` passes and the placeholder-spelling check finds nothing
- [x] 7.3 Live verification with the real gateway: `codex-oss image build`, `provider setup` (browser flow), `doctor` (refresh `ok`), bare session (TUI opens with no login or trust prompt), `run "reply OK"`, `run --resume <id>`, a change synced back to a git project, `download` of a created file, `mcp status`, the egress host set and path-scoping result from `openshell logs`, `printenv CODEX_CHATGPT_TOKEN` showing a placeholder, no `auth.json` in the sandbox, `rm --yes`; record each command and its observed output in `codex-oss/README.md`'s verification record, with the helper-first guide and the raw-command fallback
- [x] 7.4 Record in `codex-oss/README.md` the `codex-chatgpt` refresh state now (`openshell provider refresh status codex-chatgpt` and `codex-oss doctor`: configured, no failure, expiry about 240 h after setup) and a follow-up note: the first scheduled gateway refresh falls about 2026-11-05, five minutes before expiry; after it, `codex-oss doctor` must still report refresh `ok`, which is the evidence that the gateway saves the rotated refresh token, and a failure there is recovered by rerunning `codex-oss provider setup`. Verify the README rows and the note are present

## 8. Close

- [x] 8.1 Verify that `git diff --stat` touches only the paths the `codex-oss` self-contained requirement allows plus the D6 hook in `lib/oss-core.sh`, that `make test` and `make lint` pass, and that `openspec validate add-codex-oss --strict` passes
