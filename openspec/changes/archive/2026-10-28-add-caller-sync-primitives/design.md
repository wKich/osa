# Design

## Context

See proposal.md for motivation. Relevant current state:

- Conveyor's runner (`src/Conveyor.Runner` in the Conveyor repo) runs agents
  through `IAgentHost`. `ClaudeCodeAgentHost` starts
  `claude -p --output-format stream-json --verbose` with the prompt on stdin and
  per-role arguments (`RoleArguments`): the developer gets
  `--permission-mode acceptEdits` with `git commit|push|reset|checkout|worktree`
  disallowed, and reviewer-like roles are read-only. Git commit and push always
  run on the host runner, on a human button press. Work stays uncommitted in the
  worktree across developer, review, and rework iterations.
- On macOS/Linux, Conveyor's isolated launchers (`AgentGeofrontLauncher`,
  `AgentDockerLauncher`) start a shell script directly. Windows/WSL is out of
  scope.
- osa caller mode (`*_WORKSPACE=caller`, `docs/helper.md`, "Caller-owned
  workspace") gives an orchestrator a sandbox with no registry, no upload, no
  sync, and no policy advisor. The orchestrator must move the workspace itself.
- Managed mode already has the pieces this change reuses: a gitignore-filtered
  upload (`cmd_upload`), a sandbox-side baseline in a git directory outside the
  workdir, and `SANDBOX_COLLECT_SCRIPT`, which writes a tree of the workdir and
  prints `git diff --binary --full-index` against `refs/<program>/base`.
- Managed mode does not fit Conveyor. When the host tree is dirty or has moved,
  the managed sync keeps the agent's changes on a review branch instead of
  applying them. Conveyor's worktree is dirty from the second iteration on, so
  the edits would never land in the worktree.

## Goals / Non-Goals

**Goals:**

- An orchestrator can run `up`, `sync-in`, `run` (prompt on stdin, role flags),
  `collect-patch`, and `rm` in caller mode, using only stdout, exit codes, and
  `--json` results.
- Role rules apply inside the sandbox the same way they do with a local
  `claude`.
- Dirty working trees round-trip without loss: uncommitted edits, deletions,
  renames, and binary files.

**Non-Goals:**

- Incremental sync, and detecting a host change during the run (roadmap M4).
- Git history inside the sandbox. The agent sees no repository, so Conveyor's
  reviewer `git diff`/`git log` rules have nothing to read. This is needed for
  the read-only roles in M2.
- Self-check (build/test) in the sandbox, and toolchain images (M3).
- Applying the patch to the host. The caller owns its tree.
- Any Conveyor-side code.

## Decisions

### Working-tree snapshot in, binary patch out (not git bundles)

`sync-in` uploads the tree as it is on disk and commits it as the baseline
inside a sandbox-side git directory. `collect-patch` diffs the workdir against
that baseline.

- **Alternative: git bundles (the oskhs transport).** A bundle carries only
  commits, so the uncommitted work would have to become a commit. That breaks
  Conveyor's model, where the human commits. Rejected for this caller; bundles
  remain useful for fixed-SHA MR-review checkouts later.
- **Alternative: download the whole tree and mirror it back.** That would
  delete ignored host files (`bin/`, `obj/`, `node_modules`), because they were
  never uploaded. Rejected.

### The baseline git directory lives outside the workdir

The same layout managed mode uses: the agent never sees or edits the baseline
refs, and an agent running `git init` in the workdir cannot corrupt them.
`collect-patch` ignores any `.git` the agent creates in the workdir.

### Sync code lives in osa, not in the orchestrator

- osa already owns the upload filtering, the baseline, and the collect script.
- OpenShell quirks, such as the 0.1.5 exec-timeout behavior, stay inside osa's
  tests.
- Conveyor's launcher stays as thin as `AgentGeofrontLauncher`.
- oskhs or another orchestrator can reuse the same commands.

Alternative: Conveyor calls `openshell sandbox upload/exec/download` itself.
Rejected because it ties C# code to OpenShell CLI details that osa cannot test.

### Permission flags pass through after `--`, from an allowlist

The flags after `--` are checked against this allowlist:
`--permission-mode`, `--allowedTools`, `--disallowedTools`, `--add-dir`,
`--fork-session`, and `--effort`. Anything else is a usage error, and so is
`--permission-mode bypassPermissions`: a caller that wants that mode passes no
permission flags, which keeps today's behavior. When any of
`--permission-mode`, `--allowedTools`, or `--disallowedTools` is present, the
helper omits `--dangerously-skip-permissions`.

- The allowlist keeps a caller from passing flags that point Claude Code at
  config outside the sandbox's control, such as `--mcp-config` or
  `--settings`, without review. It also keeps the stream format fixed, so
  `--output-format` cannot be overridden.
- Session flags keep their existing first-class options (`--resume`,
  `--continue`, `--session-id`) and are not repeated in the allowlist.
- The managed settings in the image (`/etc/claude-code/managed-settings.json`)
  still apply on top of the caller's rules.
- Alternative: rely on the sandbox and keep skip-permissions. Rejected because
  it lets the agent `git commit` or `reset` inside the snapshot, and a
  read-only role could edit files.

### Prompt on stdin through the exec relay

When `run` gets no prompt argument, or `-`, the helper relays its own stdin to
the in-sandbox `claude -p` through `sandbox exec`, and the prompt is not
placed in argv. A prompt passed as an argument keeps today's behavior, with
stdin closed. This avoids argv length limits for large Context Packs and keeps
the prompt out of process listings.

### Machine-readable results

`--json` on both commands prints one JSON object on stdout; human messages go
to stderr.

- `sync-in` prints `{"baseline": "<sha>", "files": N, "bytes": B}`.
- `collect-patch` prints `{"empty": bool, "baseline": "<sha>", "files": [{"status": "M", "path": "..."}]}`.

Exit codes follow the existing scheme: 0 success, 1 usage, 2 dependency,
3 gateway.

## Risks / Trade-offs

- **The full upload on every `sync-in` is slow for large repos.** M1 accepts
  this, and the M0 spike measures it. Incremental sync is M4.
- **The host tree can change between `sync-in` and patch apply.** The caller
  applies with `git apply --check` first and fails the run if the patch does
  not apply. Detecting the change inside osa is M4.
- **OpenShell may close or buffer piped stdin differently across versions.**
  A test with a large prompt (over 1 MB) checks the relay. If the relay proves
  unreliable, fall back to uploading the prompt as a file and running
  `claude -p < file` inside the sandbox.
- **The allowlist may miss a flag Conveyor needs.** That shows up as a usage
  error, which is cheap to extend, rather than a silent bypass.
- **There is no git history in the sandbox.** Read-only roles are limited
  until M2. The developer role works.

## Roadmap (context for this change)

This change delivers M1. Later milestones get their own changes, in osa or in
Conveyor.

| Milestone | Scope |
|---|---|
| M0 | Manual spike. Run an exported Conveyor prompt with `claude-oss run`. Check that Conveyor's stream parser reads the output unchanged, that a provider profile works, and how long a real repo takes to upload. |
| M1 (this change) | osa: prompt on stdin, permission pass-through, `sync-in`, `collect-patch`. Conveyor: a `claude-osa` mode (refused on Windows) and an `AgentOsaLauncher`, covering the developer role only. |
| M2 | All roles and sessions. One warm sandbox per task, so `--resume` and `--fork-session` work. Base-branch git history inside the sandbox for reviewer roles. Read-only roles must return an empty patch. Cancel through the run tag and stop file. Reference repos for `--add-dir`. Conveyor's `RemoveWorkspace` maps to `rm`. |
| M3 | Self-check in the sandbox. An environment-layer image with the .NET SDK and Node, egress profiles for nuget and npm, a `CreateExec` path for Conveyor's `SelfCheckExecutor`, and download of TRX results. |
| M4 | Transport hardening. Incremental sync, host-change detection, and bundles for fixed-SHA MR-review checkouts. A fast-forward from origin runs before `sync-in`. |
| M5 | Operations in Conveyor. Runner profile fields (provider profile, image, policy), `osa health` and `doctor` results reported at runner registration, policy denial proposals in the "awaiting your decision" lane with an audit record, and sandbox metrics. |
| M6 | `codex-osa` and the OpenCode and Maki hosts, MCP inside the sandbox, a remote OpenShell gateway, the future of oskhs relative to Conveyor, and Windows/WSL once hardware is available. |

## Open Questions

- Whether `sync-in` should also accept a tar stream on stdin, which would
  avoid a host temp copy. This can be decided during implementation; the
  contract stays `sync-in HOST_TREE`.
