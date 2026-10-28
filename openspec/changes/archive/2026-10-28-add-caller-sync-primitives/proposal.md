# Proposal

## Why

Conveyor (a task orchestrator that runs Claude Code headless in host git
worktrees, with human approval gates) can run its agents isolated, but only
through Docker or GeoFront. osa could be its third isolated backend on
macOS/Linux, but today an external caller cannot drive `claude-oss` the way
Conveyor drives the local `claude` CLI. The prompt must be an argument (Conveyor
writes it to stdin), every run forces `--dangerously-skip-permissions` (Conveyor
relies on per-role tool rules), and caller mode offers no way to move a dirty
working tree into the sandbox and the agent's edits back out (Conveyor keeps
work uncommitted until a human commits). This change adds the smallest osa-side
surface that lets an orchestrator run one sandboxed developer pass end to end.
It is milestone M1 of the roadmap in `design.md`.

## What Changes

- `claude-oss run` reads the prompt from standard input when no prompt argument
  is given (or the argument is `-`), and relays it to Claude Code inside the
  sandbox instead of closing stdin.
- `claude-oss run` accepts Claude Code permission flags after `--`
  (`--permission-mode`, `--allowedTools`, `--disallowedTools`, `--add-dir`,
  `--fork-session`, `--effort`) from an allowlist. When any permission flag is
  supplied, the helper omits `--dangerously-skip-permissions`. Flags outside the
  allowlist are a usage error before any gateway call.
- New caller-mode command `sync-in HOST_TREE`: replaces the sandbox workdir with
  the gitignore-filtered host tree (uncommitted changes included, no host
  `.git`) and records a baseline commit in a sandbox-side git directory outside
  the workdir. `--json` prints the baseline and counts.
- New caller-mode command `collect-patch --out FILE`: writes a binary git patch
  of the workdir relative to the last `sync-in` baseline to a host file
  (additions, modifications, deletions, renames, binary files). `--json` prints
  whether the patch is empty and the changed paths. It never touches the host
  tree; the caller applies the patch.
- Both commands are shared in `lib/oss-core.sh`, so `maki-oss`, `opencode-oss`,
  and `codex-oss` gain them too; outside caller mode they are a usage error.
- Docs: the caller-owned workspace section of `docs/helper.md` documents the
  new commands and a full orchestrator sequence.

## Capabilities

### New Capabilities

- `caller-workspace-sync`: caller-mode `sync-in` and `collect-patch` that let an
  orchestrator move a working tree into the sandbox and receive the agent's
  edits as a patch, with machine-readable results.

### Modified Capabilities

- `claude-oss-helper`: the headless launch contract changes. The prompt may
  come from stdin, allowlisted permission flags pass through, and
  `--dangerously-skip-permissions` is dropped when they are present.

## Impact

- Code: `lib/oss-core.sh` (new commands, stdin relay for headless runs),
  `bin/claude-oss` (`agent_headless_argv`, `agent_exec_stdin`, flag allowlist).
- Tests: shell test suite under `tests/` for the new commands and the launch
  contract.
- Docs: `docs/helper.md`, `docs/claude-oss.md` (or the agent page that covers
  `run`).
- Consumers: oskhs is unaffected (it keeps its bundle transport). Conveyor's
  `claude-osa` mode and `AgentOsaLauncher` are built in the Conveyor repo
  against this contract and are not part of this change.
- Upstream behavior relied on: `openshell sandbox upload`/`download` and
  `sandbox exec` stdio relay
  (https://docs.nvidia.com/openshell/how-it-works/workspaces.md,
  https://docs.nvidia.com/openshell/how-it-works/sandboxes/overview.md).
