# Tasks

## 1. Setting

- [x] 1.1 Add `idle_stop` to the config parser's known keys, `--idle-stop` to the flag parser (including the trailing-flag "requires a value" case), and `resolved_idle_stop` (default `1h`; accepts `N`, `Ns`, `Nm`, `Nh`; returns seconds; usage error naming `idle_stop` otherwise). Verify with new stub cases: no setting gives 3600, `idle_stop = "90m"` gives 5400, `--idle-stop soon` exits 1 with no `openshell` line in `$STUB_LOG`
- [x] 1.2 Document `--idle-stop` in `usage` and add a fish completion in `fish/completions/`. Verify that `maki-oss help` lists it and that `make lint` passes

## 2. Watcher

- [x] 2.1 Add the idle stamp helpers in `bin/maki-oss`: write a token `<epoch>.<pid>` to `sessions/<name>/idle` through a temp file and `mv`, read it back, and append one line to `sessions/<name>/idle.log`. Verify with `make lint` (shellcheck) and the cases in 3.x
- [x] 2.2 Add the internal `__idle-watch NAME PID SECS` subcommand, routed before the provider and session checks and absent from `usage`. It polls `kill -0 PID`; on exit it writes a close token; it sleeps SECS; it bails when the stamp changed; it runs the `/proc/*/comm` scan for `maki` through `sandbox exec`; it calls `openshell sandbox stop NAME` only when the scan prints `idle`; and it logs each decision. Verify with the cases in 3.x
- [x] 2.3 In the session path shared by `cmd_maki`, `cmd_run`, and `cmd_opencode_tui`, validate `idle_stop` first. Unless it is 0, write the start token and spawn the watcher detached (`nohup`, stdio to `/dev/null`) with `$$` before `ensure_project_sandbox`. Verify that a stub case with `--idle-stop 0` spawns no watcher (no `idle` file is written) and that `cmd_up` writes no stamp

## 3. Tests

- [x] 3.1 Export `MAKI_OSS_IDLE_STOP=0` by default in `run_maki_with_input` (an `ENV_IDLE_STOP` override), so existing cases spawn no watchers. Verify that the full `make test` run still passes and leaves no `__idle-watch` process (`pgrep -f __idle-watch` is empty afterward)
- [x] 3.2 Stub case "stops after idle": `ENV_IDLE_STOP=2s`, one `maki` session exits, and the scan prints `idle` through `STUB_EXEC_CASES`. A bounded wait (10s at most) sees exactly one `sandbox stop maki-…` in `$STUB_LOG`
- [x] 3.3 Stub case "closed terminal": start the helper in the background with a stub Maki that sleeps, then `kill -HUP` the helper. Verify that the stop still appears after the idle period
- [x] 3.4 Stub case "newer session cancels": a second session starts after the first closes, with `ENV_IDLE_STOP=3`, the second still running at the first deadline. Verify there is no stop at the first deadline and exactly one stop after the second session ends plus 3s
- [x] 3.5 Stub case "maki still running": the scan prints `busy` through `STUB_EXEC_CASES`. Verify that after the idle period `$STUB_LOG` has the scan exec and no `sandbox stop`, and that `idle.log` records `busy`
- [x] 3.6 Stub case "stop failure is silent": `sandbox stop` fails. Verify that the session's stderr is unchanged, `idle.log` records `stop-failed`, and exactly one stop attempt appears

## 4. Docs

- [x] 4.1 Add an "Idle stop" section to `docs/helper.md` (behavior, the `idle_stop` setting, `0` to disable, the shell-only `connect` caveat, no stop across reboot, `idle.log` location) and one line in `README.md`. Verify by reading the rendered section and checking that `grep -n idle_stop docs/helper.md README.md` finds both
- [x] 4.2 Add `idle_stop` to `examples/config.toml` as a commented example. Verify that `maki-oss status` with that file uncommented parses without an unknown-key error

## 5. Verification

- [x] 5.1 Run `make test` and `make lint` and verify that both pass
- [x] 5.2 Live check on a real gateway: set `idle_stop = "60s"`, run a `maki-oss maki` session, and exit. Verify that `maki-oss status` shows `Stopped` within about 70s and that the next `maki-oss maki --continue` restarts it and resumes the session. Record the result in `docs/verification-log.md`
