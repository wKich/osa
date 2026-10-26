## ADDED Requirements

### Requirement: Caller-owned workspace mode

The helper SHALL read a workspace mode from the front-end's
`<PREFIX>_WORKSPACE` environment variable (`MAKI_OSS_WORKSPACE` for
maki-oss): `managed` (the default when unset) or `caller`. Any other value
SHALL be a usage error before any gateway call. The mode is a caller
interface for programs that own the sandbox workspace; it has no flag and
no config key.

In `caller` mode, `up` and `run` SHALL treat the sandbox workspace as owned
by the caller:

- The sandbox name SHALL come from `<PREFIX>_SANDBOX_NAME` (or `--name`);
  without one the command SHALL exit as a usage error before any gateway
  call. `run` SHALL also require `<PREFIX>_WORKDIR` (or `--workdir`).
- The helper SHALL NOT read, write, or check the project registry, so the
  caller's current directory never binds the sandbox name.
- Creating the sandbox SHALL NOT upload any host directory.
- `run` SHALL NOT record a baseline, classify, refresh, or prune the
  workspace, SHALL NOT collect or apply a patch, and SHALL NOT write a
  `pending`, `synced`, or `baseline` marker; a parked or retained marker
  left for that sandbox SHALL NOT block the run. `--no-sync` is accepted and
  has no further effect. The Session sync-back and Session baseline and
  freshness requirements do not apply to a caller-mode run.
- The helper SHALL NOT enable the policy advisor on the sandbox.
- Everything else SHALL behave as in `managed` mode: provider attachment,
  model selection, the headless run timeout with its run tag and stop file,
  the session lock, the idle stop (controlled by its own setting), stdout
  carrying only the agent's output, and the agent's exit code.

#### Scenario: Consecutive caller-mode runs on one sandbox
- **WHEN** `MAKI_OSS_WORKSPACE=caller MAKI_OSS_SANDBOX_NAME=repo-app MAKI_OSS_WORKDIR=/sandbox/tasks/t1 maki-oss run --timeout 60 "q1"` runs, and then the same command with `MAKI_OSS_WORKDIR=/sandbox/tasks/t2` runs from a different current directory
- **THEN** both runs reach the agent and exit with its code, no sandbox-side sync script runs, and the helper's state root holds no `pending`, `synced`, or `baseline` file and no registry entry for `repo-app`

#### Scenario: A parked marker does not block a caller-mode run
- **WHEN** the state root holds a `parked` pending marker for `repo-app` and a caller-mode `run` starts on `repo-app`
- **THEN** the run reaches the agent and the marker is left unchanged

#### Scenario: Caller mode never uploads on create
- **WHEN** `MAKI_OSS_WORKSPACE=caller MAKI_OSS_SANDBOX_NAME=repo-app maki-oss up` runs in a non-empty directory and `repo-app` does not exist
- **THEN** the sandbox is created and no `sandbox upload` call is recorded

#### Scenario: Caller mode requires an explicit name and workdir
- **WHEN** `MAKI_OSS_WORKSPACE=caller maki-oss run "q"` runs without a sandbox name, or with a name but without a workdir
- **THEN** the helper exits as a usage error before any gateway call

#### Scenario: Caller mode leaves the policy advisor off
- **WHEN** a caller-mode `run` ensures its sandbox
- **THEN** no `settings set … agent_policy_proposals_enabled` call is recorded

#### Scenario: Run wrapper and stop file are unchanged
- **WHEN** a caller-mode `run` has `--timeout 30` and `MAKI_OSS_RUN_TAG=oskhs-t1`
- **THEN** the exec argv after `--` is the same tag wrapper as in managed mode, and creating `/tmp/maki-oss-stop/oskhs-t1` stops the run

#### Scenario: Invalid mode is refused
- **WHEN** `MAKI_OSS_WORKSPACE=shared maki-oss run "q"` runs
- **THEN** the helper exits as a usage error naming `managed` and `caller`, and records no gateway call

#### Scenario: Managed mode is unchanged
- **WHEN** `MAKI_OSS_WORKSPACE` is unset and the user runs `maki-oss run --no-sync "q"`
- **THEN** the workspace is parked as before
