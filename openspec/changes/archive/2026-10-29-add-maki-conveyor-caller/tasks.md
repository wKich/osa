# Tasks

## 1. Failing tests for the Maki headless contract

- [x] 1.1 In `tests/run-tests.sh`, add `test_mk_run_argv` asserting that `maki-oss run --model <m> "check"` records `maki --print --yolo --trust --output-format stream-json --verbose --model <m> "check"`, in that order, with stdin at end of file. Verify it fails against the current helper with `sh tests/run-tests.sh` (or the suite's filter).
- [x] 1.2 Add `test_mk_run_stdin_prompt`, `test_mk_run_stdin_large` (2 MiB prompt; no recorded argv contains it), `test_mk_run_stdin_empty` (exit 1, no gateway call), `test_mk_run_stdin_timeout` (sleeping stub exits 124 and tagged processes are swept), and `test_mk_run_stdin_with_passthrough` (piped prompt plus `--disallowed-tools Write,Edit`). Verify they fail.
- [x] 1.3 Add pass-through tests: `test_mk_run_passthrough_deny_tools` (forwards `--disallowed-tools Write,Edit --fork-session` after `--verbose` and before the prompt), `test_mk_run_passthrough_rejects_unknown` (`--allowed-tools`, `--permission-mode`, `--output-format`, `--input-format`, `--mcp-config`), `test_mk_run_passthrough_missing_value`, and `test_mk_tui_rejects_passthrough`. Each rejection must exit 1 naming the flag with no recorded gateway call. Verify they fail.

## 2. Implement the Maki launch contract

- [x] 2.1 In `bin/maki-oss`, change `agent_headless_argv` to `maki --print --yolo --trust --output-format stream-json --verbose`, then the model and session flags, then the `--` pass-through, and only add the prompt argument when it is not a stdin prompt. Change `agent_exec_stdin` to print `null`. Verify the 1.1 and 1.2 tests pass.
- [x] 2.2 Add the `agent_stdin_prompt` no-op marker so the core reads no-argument or `-` prompts from stdin before any gateway call. Verify `test_mk_run_stdin_prompt`, `test_mk_run_stdin_large`, `test_mk_run_stdin_empty`, and `test_mk_run_stdin_timeout` pass.
- [x] 2.3 Add `agent_passthrough_check` accepting only `--disallowed-tools` (one value) and `--fork-session` (no value); refuse every other flag and missing values with a message naming the flag. Verify the 1.3 tests pass and `sh tests/run-tests.sh` is green.

## 3. Documentation and help

- [x] 3.1 Update `docs/helper.md`: the `run` contract (stream-json, stdin prompt, deny/fork pass-through, refused `--allowed-tools` and `--permission-mode`) and the caller-owned workspace example from `claude-oss` to `maki-oss`. Verify with `make lint-docs`.
- [x] 3.2 Update `docs/ai/reference/maki.md` and the headless step in `docs/ai/playbooks/maki.md` to the stream-json argv and the stdin form. Verify links and wording with `make lint-docs`.
- [x] 3.3 Update the `maki-oss` usage text in `bin/maki-oss` for the stdin prompt and pass-through, and extend the existing help test (`test_help` or the Maki equivalent) to expect the new lines. Verify with `sh tests/run-tests.sh` and the fish completion smoke tests.

## 4. Integration check

- [x] 4.1 Run `make test-all` and verify every suite passes, including oskhs against a stream-json result line.
- [x] 4.2 On a live OpenShell gateway on macOS, run a caller-mode sandbox with `maki-oss`: `up`, `sync-in` of a dirty linked worktree, `printf <prompt> | maki-oss run -- --disallowed-tools Write,Edit`, `collect-patch`, and `git apply` on the host. Verify stdout is stream-json ending in a `result` event, the patch applies cleanly, and the host tree shows the agent's edit. Record the event types, Maki version, and upload time in the change's `notes.md`.
