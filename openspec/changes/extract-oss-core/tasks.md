# Tasks

## 1. Baseline

- [ ] 1.1 Capture the pre-refactor reference outputs (`bin/maki-oss --help`, `bin/maki-oss help`, a bare usage error, `bin/maki-oss provider setup --help` if present) into the scratchpad, and verify `make test` and `make lint` pass on the untouched tree (record pass counts)

## 2. Move verbatim

- [ ] 2.1 Create `lib/oss-core.sh` (POSIX sh header, `# shellcheck shell=sh`, functions only, no top-level side effects) and move the agent-neutral sections into it verbatim: output helpers, config parse/resolve/write, OpenShell wrappers, safety checks, lifecycle commands, session ensure/baseline/patch sync, idle stop, upload/download, status/list/logs/start/stop/rm, policy commands, provider add/attach/list and the setup engine, argument parsing and dispatch. Verify `make test` passes unchanged
- [ ] 2.2 Make `bin/maki-oss` source the core (`# shellcheck source=../lib/oss-core.sh`) after its repo-root resolution and call `oss_main "$@"`, and verify `make test` passes and the `--help` and usage outputs byte-match 1.1

## 3. Parameterize

- [ ] 3.1 Introduce the design D2 identity and default variables in `bin/maki-oss`, set to today's values, and replace every hard-coded use in the core (`MAKI_OSS_*` via `env_setting KEY`, config path, `.maki-oss`, `/tmp/maki-oss-*`, profiles dir, catalog file, `maki-` custom-profile prefix). Verify `make test` passes and the 1.1 outputs byte-match
- [ ] 3.2 Split the agent code into the design D3 hooks (`agent_usage`, `agent_interactive_argv`, `agent_headless_argv`, `agent_exec_stdin`, `agent_check_session_flags`, `agent_dispatch`, `agent_parse_option`, `agent_doctor_extra`, `agent_setup_hint`), with session/run orchestration in the core and the Maki argv, bridge mode, `mcp status`, `image build`, and `fish` in the front-end. Verify `make test` passes and the 1.1 outputs byte-match
- [ ] 3.3 Verify that `grep -nE 'maki|MAKI_OSS|\.maki-oss|examples/' lib/oss-core.sh` finds only comments, and that the core runs nothing when sourced: `sh -c '. lib/oss-core.sh'` exits 0 with no output

## 4. Lint and docs

- [ ] 4.1 Add `lib/oss-core.sh` to the `make lint` shellcheck target, and verify `make lint` passes
- [ ] 4.2 Add a short "Code layout" note to `docs/helper.md` (front-end in `bin/`, sourced core in `lib/oss-core.sh`, `lib/` required next to `bin/`), and verify the doc has no placeholder spelling (`tests/run-tests.sh` placeholder test passes)

## 5. Equivalence and smoke

- [ ] 5.1 Verify `make test` passes with zero edits to `tests/` (`git diff --stat -- tests/` is empty) and records the same pass count as 1.1
- [ ] 5.2 Live smoke on the real gateway: `bin/maki-oss status` and `bin/maki-oss run "reply OK"` in a scratch project with a remembered provider, and verify the JSON reply and exit 0
- [ ] 5.3 Verify `openspec validate extract-oss-core --strict` passes and that `git diff --stat` touches only `bin/maki-oss`, `lib/oss-core.sh`, `Makefile`, `docs/helper.md`, and this change directory
