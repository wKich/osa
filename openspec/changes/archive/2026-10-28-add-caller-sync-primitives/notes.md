# Notes: live verification (task 6.2)

2026-10-28, macOS (Darwin 25.5), OpenShell 0.1.5, local Docker gateway,
`claude-agent:local`, provider `claude-anthropic-oauth`.

## Sequence

Caller mode, sandbox `osa-live-sync`, workdir `/sandbox/tasks/t1`. Host tree:
a linked worktree (`.git` file) of a scratch repo with a modified tracked
file, an untracked file, and an ignored `bin/out.dll`.

| Step | Result |
|---|---|
| `up` | Sandbox ready in 0.8 s (image present) |
| `sync-in WT --json` | `{"files":4,"bytes":70}`; workdir held the modified and untracked files, no `bin/`, and `git status` there said "not a git repository" |
| `printf ... \| run --timeout 600 - -- --permission-mode acceptEdits --disallowedTools 'Bash(git commit:*)'` | Exit 0; 8 stream-json lines; the `init` event reported `permissionMode: acceptEdits`; it ended in a `result` event of subtype `success` |
| `collect-patch --out t1.diff --json` | `{"empty":false,"files":[{"status":"M","path":"calc.py"}]}`; file mode `-rw-------`; a second collect was byte-identical |
| `git apply --check` and `git apply` in WT | Clean; `git status` showed `M calc.py` next to the pre-existing `M README.md` and `?? NOTES.txt`; the ignored `bin/out.dll` was untouched |
| `rm --yes` | Sandbox deleted |

## Upload time (input for roadmap M4)

`sync-in .` of this repository: 2,240 files, 14.8 MB after `.gitignore`
filtering (77 MB on disk including `.git`), took **1.25 s** and then 1.26 s,
for the clear, upload, and baseline steps together, against a local gateway.
At this size a full snapshot per pass is cheap; incremental sync (M4) only
matters for much larger trees or remote gateways, which this run did not
measure.

## Observed, out of scope

In caller mode, `run`'s session lock and `rm`'s archive step still create
empty directories under `osa/sessions/<name>`. They hold no data, and neither
`sync-in` nor `collect-patch` creates them (a `sync-in`-only sandbox left
nothing). The caller-mode spec's "no host-side session state" is about data,
so this was left as is.
