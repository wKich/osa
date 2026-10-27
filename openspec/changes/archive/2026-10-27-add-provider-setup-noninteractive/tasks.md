# Tasks

## 1. Front-end setup

- [x] 1.1 Add `--stdin` parsing and the stdin source to `cmd_provider_setup` with the empty, multi-line, and 64 KiB checks and the `setup_noninteractive` override of `is_interactive` (design D1). Verify with tests: a piped key creates the provider with `--from-existing` and no prompt text; each invalid input exits 1 with no recorded mutation; `--stdin` without `--profile` and `--stdin --env X` are usage errors; `MAKI_OSS_INTERACTIVE=1` does not bring prompts back.
- [x] 1.2 Let `--profile` take an id resolved through `$profiles_dir` then `$helper_profiles_dir` (design D2). Verify with tests for a curated id, a generated id, `../x`, and an unknown id, the last two exiting 1 with no `openshell` call.
- [x] 1.3 Add `__providers-json` with the per-front-end catalog note column and the `login` setup kind for Codex (design D3), and route it in all four front-ends. Verify with tests that parse the JSON per agent, including an unreadable profile and a failing `provider list`.
- [x] 1.4 Add `__provider-setup` (and its `--probe`) with step tracking, the `--provider-name` option, refused vs failed exits, and JSON on stdout only (design D4, D5). Verify with tests for created, updated with `--yes`, refused without `--yes`, attach to a missing sandbox (2), attach failure after create (3, steps listed), and the Codex probe (2).

## 2. osa

- [x] 2.1 Add `osa providers [--agent TAG] [--json]` with a text rendering, plus `usage()`, the unknown-command list, and `fish/completions/osa.fish`. Verify with tests for all agents, one agent, an unknown tag (1), and the gateway-down case (exit 0, error object).
- [x] 2.2 Add `osa provider setup` with tag, id, name, and `--attach` registry checks, the probe, and the `exec` with stdin inherited (design D4). Verify with the scenarios from the spec, including that `osa` itself never reads stdin (a test closes stdin after the probe and still sees the front-end read the key).
- [x] 2.3 Add a secret-scan test: run every setup path, success and failure, with a distinctive fixture key, and assert it appears in no recorded `openshell` argv, no stdout, no stderr, and no file under `$XDG_STATE_HOME` or `$XDG_CONFIG_HOME`. Extend "osa never changes a sandbox" with `osa providers --json`. Verify with `make test`.

## 3. Docs and verification

- [x] 3.1 Document `--stdin` and `--profile ID` in `docs/providers.md`, and `osa providers` and `osa provider setup` in `docs/helper.md`. Verify with `make lint-docs` and `make lint` passing.
- [x] 3.2 Run `make test` and `openspec validate add-provider-setup-noninteractive --strict`; on this host, pipe a real key with `osa provider setup mk --profile <id> --attach <sandbox> --json` and confirm a session can use it. Record the result in `docs/verification-log.md`. Verify all pass and the log entry exists.
