# Proposal

## Why

Conveyor's sandboxed runner now targets Maki first: milestone M1 needs one
caller-driven developer pass over an uncommitted git worktree. The workspace
transport for that pass already shipped (`sync-in`, `collect-patch`, prompt on
stdin, `--` pass-through), but its launch contract was built for `claude-oss`.
`maki-oss run` still emits a single `--output-format json` object, takes the
prompt only in argv, and forwards no tool rules, so Conveyor's Maki host cannot
consume it. This change gives `maki-oss` the same caller contract, so the M1
integration path becomes osa + `maki-oss` without changing Conveyor's stream
parser.

## What Changes

- **BREAKING** `maki-oss run` launches
  `maki --print --yolo --trust --output-format stream-json --verbose` and
  streams Maki's event lines unchanged, instead of one `--output-format json`
  object. Maki documents the one-shot `--print` path as a drop-in replacement
  with Claude Code's JSON fields, `--output-format` options, and `--verbose`
  behavior ([Headless mode](https://maki.sh/docs/headless/),
  [CLI](https://maki.sh/docs/cli/)).
- `maki-oss run` reads the prompt from standard input when no prompt argument
  is given, or the argument is `-`, and relays it to `maki -p`; the prompt
  never enters argv. Empty stdin is a usage error before any gateway call.
- `maki-oss run` accepts Maki's tool flags after `--` from an allowlist:
  `--disallowed-tools` and `--fork-session`. They are forwarded after the
  model and session flags, in the order given. Anything else, including
  `--allowed-tools`, `--permission-mode`, and `--output-format`, is a usage
  error before any gateway call. Maki's one-shot `--print` path has no
  `--permission-mode` (it is SDK-only), and under the fixed `--yolo` an allow
  list cannot narrow tools; forwarding either would let a caller believe a
  role rule applies when it does not.
- Docs: the Maki headless contract, the caller orchestrator sequence, and the
  reference page describe stream-json and the new flags.
- Out of scope: Conveyor-side `MakiAgentHost`/launcher code, changes to
  `sync-in`/`collect-patch`, the `claude-oss` path (it stays as it is), and
  read-only role enforcement beyond exposing `--disallowed-tools` (M2).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `helper-cli`: the `maki-oss` headless launch contract changes from
  `--output-format json` with the prompt in argv to Claude-compatible
  `--output-format stream-json --verbose`, a stdin prompt, and an allowlisted
  `--` tool pass-through. The session-resume scenarios that spell out the
  headless argv change with it.

## Impact

- Code: `bin/maki-oss` (`agent_headless_argv`, `agent_exec_stdin`,
  `agent_stdin_prompt`, `agent_passthrough_check`); `lib/oss-core.sh` already
  provides the stdin and `--` plumbing, so no core change is expected.
- Tests: `tests/run-tests.sh` — headless argv, stdin prompt (including a large
  prompt and the combined stdin + `--` case), pass-through allowlist, timeout
  with a piped prompt, and exit-code propagation.
- Docs: `docs/helper.md` (run contract and caller sequence),
  `docs/ai/reference/maki.md`, and the Maki playbook's headless step.
- Consumers: oskhs parses the last `type: result` line, which stream-json still
  provides; Conveyor's `ClaudeStreamParser` can read Maki's Claude-shaped
  events.
- Security invariants: unchanged — no bind mounts, no secrets in `--env`, the
  sandbox remains the permission boundary, and `--yolo` is not dropped.
