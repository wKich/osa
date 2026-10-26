# Design: realign oskhs with the osa core

## Context

oskhs calls `bin/maki-oss` in two places:

- `ensureSandbox` (`oskhs/src/sandbox.ts`): `maki-oss up` with
  `MAKI_OSS_SANDBOX_NAME`, `MAKI_OSS_PROVIDERS`, `MAKI_OSS_GATEWAY`, run in
  oskhs's own cwd.
- `runMaki` (`oskhs/src/round.ts`): `maki-oss run --no-sync --timeout N
  [--model M] -- <prompt>` with the same variables plus `MAKI_OSS_WORKDIR`
  (`/sandbox/tasks/<id>`) and `MAKI_OSS_RUN_TAG`, run from a fresh empty
  `mkdtemp` directory so that a sandbox recreated mid-round gets nothing
  uploaded.

What the core does on those paths today (`lib/oss-core.sh`), read
2026-10-26:

| Step | Where | Effect on oskhs |
|---|---|---|
| `registry_guard` / `registry_update` | `cmd_up`, `ensure_project_sandbox` | the entry `repo-<p>.toml` records `host_path` = the caller's `pwd -P`; `up` records oskhs's cwd, the first `run` its temp dir; the next call from any other directory dies with "sandbox name … is registered to …" |
| `enable_policy_advisor` | `ensure_project_sandbox` | lets the agent file network-rule proposals; nobody reviews them for an oskhs sandbox |
| `prepare_session_sync` | `ensure_project_sandbox` | adopts `/sandbox/tasks/<id>` as a baseline (a git dir per workdir in the sandbox); a `parked` pending marker sets `sync_blocked` and the run exits `EX_USAGE` |
| `sync_project_back` with `--no-sync` | exit hook | writes `pending kind=parked` for the sandbox |
| `arm_idle_stop` | `cmd_run` | stops the sandbox after 1h idle |
| `session_lock_take` | `cmd_run` | per-sandbox lock, read by `osa resolve` |

So round 1 on a project runs, round 2 fails on the registry (and would fail
on the parked marker next). The offline oskhs suite uses a recording runner,
and the core's own suite has no caller like oskhs, so neither catches it.

## Goals / Non-Goals

**Goals:**

- Any number of oskhs rounds on one sandbox, independent of oskhs's cwd.
- No host-side osa session state for oskhs sandboxes; oskhs (and the
  sandbox, for ref tips) stays the record.
- Keep the core's run wrapper (timeout, run tag, stop file) as the one
  implementation.
- oskhs sandbox names valid for every project title.

**Non-Goals:**

- Warm-sandbox lifecycle and whether idle-stop comes back for oskhs (B2.1).
- Showing oskhs sandboxes in the osa dashboard or `osa resolve`.
- Migrating sandboxes: names over 19 characters were never creatable, so no
  existing sandbox changes name.

## Decisions

### 1. A caller-owned workspace mode in the core, not a bypass in oskhs

`<PREFIX>_WORKSPACE=caller` switches off every host-side session-state
step listed above except the lock and the idle-stop setting.

- *Alternative: oskhs calls `openshell sandbox exec` with its own copy of
  the run wrapper.* Rejected: duplicates the timeout/tag/stop logic the core
  already tests, and loses provider attachment and model argv.
- *Alternative: oskhs runs from a fixed cwd and passes `--discard`.*
  Rejected: still adopts baselines, still couples oskhs to sync semantics
  that are built for a human's project folder.
- *Alternative: a `--no-session-state` flag.* Rejected: this is a program
  interface, like `MAKI_OSS_RUN_TAG`; an environment variable keeps it off
  the user-facing flag set and fish completions.

Implementation shape: resolve the mode once after option parsing
(`resolved_workspace_mode`), validate it, and branch in `cmd_up`,
`ensure_project_sandbox`, and the exit hook (`arm_sync` is not armed in
caller mode). `run_sandbox_create` already never uploads; the upload on
create lives in the session sync's refresh, which caller mode skips.

### 2. Explicit name and workdir in caller mode

Name derivation reads the cwd's git remote and path hash; neither means
anything for a caller. Requiring `<PREFIX>_SANDBOX_NAME` (and
`<PREFIX>_WORKDIR` for `run`) makes a misconfigured caller fail before any
gateway call instead of silently operating on `mk-<tmpdir>-xxxx`.

### 3. Lock stays, advisor off, idle stop by its own setting

- The session lock is cheap and lets `osa resolve` see that something is
  running in the sandbox; oskhs runs one round per project at a time
  (`--max-per-project 1`), so it never contends.
- The policy advisor needs a human; in an oskhs sandbox a proposal would
  only make the agent wait until the round's timeout.
- Idle stop is independent of the mode. oskhs passes `MAKI_OSS_IDLE_STOP=0`
  now so its warm sandbox is not stopped behind its back; B2.1 decides
  whether that stays, after checking that stop/start keeps `/sandbox`.

### 4. Sandbox name fitting in oskhs

Same shape as the core's hashed fitting: budget 14 for the project part
(`repo-` takes 5); over budget, keep the first 9 characters, drop trailing
hyphens, append `-` and 4 hex characters. The hash is the first four hex
characters of SHA-256 of the cleaned project name (Bun's `node:crypto`).
The core uses POSIX `cksum` mod 65536; nothing compares the two, so matching
it buys nothing. `sandboxFor`'s derived provider name
(`oskhs-<fitted project>`) follows the fitted name, so a project's provider,
fingerprint entry, and sandbox stay in step.

### 5. `--no-sync` dropped from oskhs's argv

Caller mode never syncs, so the flag is noise; the core still accepts it so
an older oskhs keeps working against a newer core.

## Risks / Trade-offs

- [The core grows a second mode every front-end inherits] → one setting,
  read in three places, covered by stub tests; documented as a caller
  interface in `docs/helper.md`, not in the user-facing help.
- [A human sets `MAKI_OSS_WORKSPACE=caller` by hand and loses sync-back] →
  the required explicit workdir makes accidental use fail fast; the mode is
  not a config key.
- [The registry and dashboard no longer see oskhs sandboxes] → intended;
  `maki-oss list` still shows them.
- [Findings come from code reading] → task 1.1 reproduces both blockers
  with the stub before any fix, and the live exit re-checks them.
