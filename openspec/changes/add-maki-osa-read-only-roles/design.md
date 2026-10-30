# Design

## Decisions

### Prompt plus no patch application, not a read-only sandbox

Conveyor already builds role-specific prompts: Reviewer, Planner, MrWriter, Researcher, Architect, Decomposer, DutyResponder, Consultant, MrReviewer, and TestAnalyst all say “НЕ изменяй файлы” (`PipelineServices.cs`, `PromptBuilder.*`). The host worktree is never mounted; the only host write is the patch the runner applies. Skipping `collect-patch` and `git apply` for those roles therefore makes the host boundary hold even if the agent ignores the prompt.

- Alternative: a read-only OpenShell filesystem policy. The workdir cannot be populated by `sync-in` when it is read-only: the helper's clear script and `sandbox upload` both run as the sandbox user under Landlock. The filesystem policy is fixed at sandbox creation, and OpenShell rejects removing a read-only path afterwards. It would require a separate sandbox design.
- Alternative: `--disallowed-tools Write,Edit`. The helper supports it, but Bash can still write, and `--yolo` makes allow lists ineffective. It would advertise a boundary that does not exist.
- Alternative: an ephemeral review sandbox. Stronger for sandbox-state isolation, but it adds lifecycle work and is not needed for host safety.

### Fixed read-only allowlist

The accepted roles are exactly those that read the task worktree and return text: `researcher`, `architect`, `decomposer`, `planner`, `mrwriter`, `dutyresponder`, `consultant`, `mrreviewer`, `testanalyst`, `reviewer`.

`speceditor`, `contextcollector`, `specanalyst`, and `specreviewer` use the analytics folder rather than the task worktree; `selfcheck` is the M3 sandbox self-check path. They stay refused with an actionable error.

### Developer path unchanged

`developer` keeps the existing `up` → `sync-in` → `run` → termination confirmation → `collect-patch` → `git apply --check` → `git apply` sequence. The read-only branch runs after termination confirmation and returns the agent outcome directly.

### Accepted residual risk

The read-only run can still write outside the workdir (`/sandbox/.config/maki`, `/sandbox/.local/state/maki`, `/tmp`) because the sandbox filesystem remains writable. This is not a host boundary: the host tree is untouched. It can affect later runs only through Maki config or session files in the retained sandbox; the role prompt is the only instruction there. A future change may use an ephemeral review sandbox or a real read-only run wrapper.

## Risks / Trade-offs

- A read-only agent that writes in the workdir consumes upload/collection time next run, but the next `sync-in` clears the workdir, so no stale file reaches the developer pass.
- `mrreviewer` and `testanalyst` are read-only but use a snapshot workspace; the host still applies the same `sync-in`/`run` path, and the Conveyor runner collects the host diff as before.
- The allowlist is code, not configuration. Adding a new role requires deciding whether it reads the task worktree or needs a different workspace.
