# Reproduce: oskhs-style calls against the unchanged core

2026-10-26, `tests/run-tests.sh` with `RUN_ONLY='test_caller_*'`, before any
core change. The cases drive `bin/maki-oss` with the stub `openshell` the way
oskhs does: `up` from one directory, each `run` from a different empty
directory, `MAKI_OSS_SANDBOX_NAME=repo-app`, `MAKI_OSS_WORKDIR` per task,
`MAKI_OSS_PROVIDERS` set. Result: 1 passed, 21 assertion failures.

## Registry binds the sandbox to the first caller's cwd

`up` from `cwd1`, then `run "q1"` from `cwd2`. Not only the second round: the
first round after the seeding `up` already fails, because oskhs runs `up`
from its own cwd and every `run` from a fresh temp dir.

```
maki-oss: sandbox name 'repo-app' is registered to …/caller-runs/cwd1; choose another name with --name
```

exit 1, no agent exec.

## A parked marker blocks the next run

With a `kind = "parked"` pending marker for `repo-app` (what `run --no-sync`
leaves behind) and no registry entry:

```
Adopting the sandbox workspace as the baseline for 'repo-app'.
Workspace 'repo-app' is parked: it holds changes with no durable patch.
maki-oss: sandbox changes are not in the host project; the workspace is parked
maki-oss:   sandbox:   repo-app
maki-oss:   workspace: …/caller-parked/sandbox/tasks/t1
…
maki-oss:   discard:   osa resolve repo-app discard --yes   (or maki-oss upload --discard, maki-oss rm --discard)
```

exit 1, no agent exec; the marker is rewritten (`reason = "workspace parked"`).

## Also observed

- `run` records `settings set … agent_policy_proposals_enabled` on the
  sandbox.
- `up` and `run` write a registry entry `projects/repo-app.toml` with the
  caller's cwd as `host_path`.
- The timeout wrapper, the caller's run tag, and the workdir pass through
  unchanged (the one passing case).
