# Design

## Context

See proposal.md, Why. The current state that shapes the approach:

- Session commands go through `ensure_project_sandbox` and then a foreground
  `openshell sandbox exec`. `cmd_maki`, `cmd_run`, and `cmd_opencode_tui` all
  `exit` from the helper process, and `arm_sync` hangs the patch sync on the
  EXIT trap. Only INT and TERM are trapped. A SIGHUP from a closed terminal
  kills dash without running the EXIT trap, so an "arm the timer on exit"
  hook would miss that case.
- Host-side per-sandbox state already lives at
  `${XDG_STATE_HOME:-~/.local/state}/maki-oss/sessions/<name>/`
  (`session_state_dir`).
- OpenShell has no idle or lifetime setting, and labels and annotations are
  create-only, so the helper keeps the clock on the host.
- The image (`examples/maki-image/Dockerfile`, ubuntu:24.04 with
  `--no-install-recommends`) installs no `procps`, so `pgrep` is not
  available inside the sandbox. The `run --timeout` wrapper already scans
  `/proc` instead.
- The OpenCode bridge starts its Maki child as `maki`
  (`bridge/src/maki.ts:48`), so a process-name check covers that mode too.
- The stub suite (`tests/run-tests.sh`) runs every session command against a
  stub `openshell` that logs its argv to `$STUB_LOG`.

## Goals / Non-Goals

**Goals:**
- One mechanism for all four session entry points, robust to any way the
  helper process dies.
- No daemon, launchd agent, or service to install.
- Testable in seconds against the stub.

**Non-Goals:**
- Stopping after a host reboot or logout (the watcher dies with the user
  session, and a reboot usually stops the `restart=no` containers anyway).
- Counting non-Maki activity in the sandbox (a bare shell from `connect`).
- oskhs task sandboxes.

## Decisions

### 1. A detached watcher started at session start, watching the helper PID

The session path spawns `maki-oss __idle-watch <name> <helper-pid> <secs>`
with `nohup … </dev/null >/dev/null 2>&1 &`, just before
`ensure_project_sandbox`. The watcher polls `kill -0 <helper-pid>` every few
seconds. When the PID is gone, it records the close and starts the idle
period.

- *Why at start, not in the EXIT trap:* SIGHUP and SIGKILL skip the trap. A
  watcher that is already running sees the helper die however it died.
- *Why the helper's own `$$`:* the helper outlives the foreground exec in
  every mode (`cmd_maki` and `cmd_run` wait on it, and `cmd_opencode_tui`
  waits on `opencode`). Its exit is therefore exactly "the session closed",
  including the post-session sync.
- *PID reuse:* if the PID is reused within the poll interval, the watcher
  keeps waiting on the unrelated process. The cost is a late stop, never a
  wrong one.
- *Alternatives:* a launchd/cron sweeper (rejected: an OS-level install step for
  the one case, reboot, that the watcher misses); a lazy sweep on the next helper
  call (rejected: no stop until the user comes back); an in-sandbox watchdog
  (rejected: the sandbox has no gateway access to stop itself, and giving it
  access crosses the security boundary).

`__idle-watch` is an internal subcommand: it is not in `usage`, and the
dispatcher routes it before the provider and session checks. It re-resolves
the gateway setting from the environment it inherits, so the stop goes to
the same gateway as the session.

### 2. One idle stamp per sandbox as the ownership token

`sessions/<name>/idle` holds one line: a token unique to the writer
(`<epoch-seconds>.<pid>`).

- Session start writes a new token *before* `ensure_project_sandbox`. Every
  older watcher now holds a stale token and will exit at its deadline without
  stopping anything. Writing first closes the race where a watcher stops the
  sandbox while a new session is between its phase check and its exec.
- When the helper PID is gone, the watcher always writes a fresh token (the
  close time) and remembers it: the last session to close owns the clock.
  Requiring the stamp to still hold the session's start token would break
  out-of-order exits. If B starts after A but exits first, A's later close
  would find B's token, skip the write, and leave no owner. A session still
  running when an earlier closer's deadline passes is caught by the
  in-sandbox check (decision 3).
- At the deadline, the watcher continues only if the file still holds its
  close token.

The writes use a temp file plus `mv`, so a reader never sees a partial line.
No locks: the last writer wins, which is the intended semantics, because the
latest session owns the clock.

*Alternative:* host lease files per live session (rejected: more state, and
a crash leaves a stale lease that needs PID liveness checks anyway; the
in-sandbox check covers concurrent sessions more truthfully).

### 3. In-sandbox liveness through a `/proc` scan for `maki`

Before stopping, the watcher runs
`openshell sandbox exec -n <name> --no-login-shell -- sh -c '<scan>'`. The
scan prints `busy` if any `/proc/[0-9]*/comm` equals `maki` and `idle`
otherwise. Only an exit status of 0 with `idle` on stdout lets the stop go
ahead. The answer is on stdout rather than in the exit status because a
gateway error can also exit 1. Any other result, such as `busy`, a gateway
error, or a sandbox that is already stopped, means the watcher does nothing,
per the spec's no-retry rule.

- This catches concurrent helper sessions whose watchers are still waiting,
  as well as sessions from other hosts and Maki started through `connect`.
- `comm` rather than `cmdline`, so the scan never matches its own `sh -c`.
- The scan's exec does not count as activity and does not change the stamp.

### 4. Setting parse and the disable path

`idle_stop` joins the config parser's known keys. It is resolved with
`resolve_setting "$opt_idle_stop" "${MAKI_OSS_IDLE_STOP:-}" "$config_idle_stop" 1h`
and normalized to seconds by a `resolved_idle_stop` that dies with a usage
error naming `idle_stop`, the same pattern as `resolved_tui`. The session
path validates it before any sandbox call. The value `0` skips spawning the
watcher; nothing else changes.

### 5. Silence and logging

The watcher has no terminal: stdout and stderr go to `/dev/null`. One line
per decision (`armed`, `superseded`, `busy`, `stopped`, `stop-failed`) is
appended to `sessions/<name>/idle.log` so the behavior can be diagnosed
without noise in the terminal.

## Risks / Trade-offs

- [Stub suite spawns real watchers that sleep for the 1h default] → the
  harness exports `MAKI_OSS_IDLE_STOP=0` by default. The idle cases override
  it with `2s`-scale values and wait on `$STUB_LOG` for the stop with a
  bounded loop.
- [A shell-only `openshell sandbox connect` session gets its sandbox stopped
  under it] → documented. The user can set `idle_stop = 0` or keep Maki
  running.
- [Watcher dies on logout or reboot] → accepted (non-goal). The next session
  restarts the sandbox through the existing `Stopped|Error` path either way.
- [The stop lands while another host is between ensure and exec] → there is
  no cross-host token, so that host's exec fails once, and its next run
  restarts the sandbox. This is rare, because only a Maki process holds the
  sandbox up.
- [Old watchers accumulate across many short sessions] → each one is a
  sleeping `sh` that exits at its deadline. Acceptable at one per session.

## Migration Plan

The default is on at `1h`. Existing users see sandboxes stop an hour after
their last session, and the next session restarts them (workspace and Maki
sessions survive `stop`). Rollback: set `idle_stop = "0"` in the config, or
revert the change. No state migration is needed; the stamp and log files are
new and ignored by older helpers.
