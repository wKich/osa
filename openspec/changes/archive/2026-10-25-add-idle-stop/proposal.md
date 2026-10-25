# Proposal

## Why

A project sandbox keeps running after its last session closes. Nothing in the
helper or in OpenShell 0.1.5 stops it: `openshell sandbox create` has no idle
or lifetime option, the sandbox record carries only `created_at`, and the
containers run with `restart=no`. So a sandbox runs until the user remembers
`maki-oss stop`, or until the container engine goes down. `sandbox stop`
keeps the workspace and Maki's sessions
(https://github.com/NVIDIA/OpenShell — `openshell sandbox stop --help`:
"Stop a sandbox while preserving its workspace"), and session ensure already
restarts `Stopped` and `Error` sandboxes. An automatic stop therefore costs
only a cold start on the next session.

## What Changes

- Session commands (bare `maki-oss`, `maki-oss maki`, `maki-oss run`) and the
  OpenCode TUI mode start a detached idle watcher when the session begins.
  The watcher waits for the helper process to exit, for any reason, including
  a closed terminal or a crash. It then waits the idle period and stops the
  sandbox with `openshell sandbox stop`.
- A per-sandbox idle stamp in the helper's session state directory records
  the latest session start or close. A watcher stops the sandbox only if the
  stamp is still the one it wrote, so a newer session cancels every pending
  stop.
- Before stopping, the watcher checks inside the sandbox whether a `maki`
  process is running. A session the helper did not start, such as one from
  another host or a manual `openshell sandbox connect` running Maki, keeps
  the sandbox up.
- New setting `idle_stop` (`--idle-stop`, `MAKI_OSS_IDLE_STOP`, config key
  `idle_stop`): a duration in seconds, or with an `s`, `m`, or `h` suffix.
  The default is `1h`, and `0` disables the idle stop.
- A sandbox started with `maki-oss up` or `maki-oss start` and never given a
  session is not stopped automatically.
- Out of scope: oskhs task sandboxes, which keep their own `idle_stopped`
  lifecycle, and stopping across a host reboot or logout, because the watcher
  is a user process.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `helper-cli`: adds the session idle stop and the `idle_stop` setting.

## Impact

- `bin/maki-oss`: the `idle_stop` config key, a flag, the watcher, and the
  hook in the session ensure path and the OpenCode TUI path.
- `docs/helper.md` and the README: idle stop behavior and how to disable it.
- `fish/completions`: `--idle-stop`.
- Tests: a short `idle_stop` (seconds) against a stub `openshell`, covering
  the stop, a newer session cancelling it, and a running `maki` blocking it.
- No security invariant changes: no new mounts, env values, or egress. The
  in-sandbox check uses the existing `sandbox exec`.
