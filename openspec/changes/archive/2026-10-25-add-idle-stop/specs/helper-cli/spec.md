# Spec Delta

## ADDED Requirements

### Requirement: Session idle stop
When a session launched by bare `maki-oss`, `maki-oss maki`, `maki-oss run`,
or the OpenCode TUI mode ends, for any reason (including a non-zero exit, an
interrupt, SIGHUP from a closed terminal, or the helper being killed), the
helper SHALL stop the project sandbox with `openshell sandbox stop` once the
idle period has passed since that session ended. The stop SHALL NOT happen
when, at that moment:
- a later session of the same sandbox has started through the helper, or
- a `maki` process is running inside the sandbox.

The stop SHALL run without the user's terminal, so closing the terminal
neither cancels nor speeds it up. A sandbox that never had a session (one
started only by `maki-oss up` or `maki-oss start`) SHALL NOT be stopped by this
mechanism. A failed stop or in-sandbox check SHALL leave the sandbox as it
is, SHALL print nothing to the terminal the session used, and SHALL NOT retry.

#### Scenario: Sandbox stops after the idle period
- **WHEN** `idle_stop` is `2s`, the user's only session exits, and no other session starts
- **THEN** within a few seconds after the 2 seconds pass, the helper calls `openshell sandbox stop maki-myproject` exactly once

#### Scenario: Closing the terminal still arms the stop
- **WHEN** `idle_stop` is `2s` and the helper process running the session receives SIGHUP and dies without running its exit hook
- **THEN** the sandbox is still stopped after the idle period

#### Scenario: A newer session cancels the pending stop
- **WHEN** `idle_stop` is `5s`, a session exits, and a new session for the same sandbox starts 2 seconds later and is still running
- **THEN** no stop is issued at the first session's deadline, and the stop happens only after the new session exits and its own idle period passes

#### Scenario: A running Maki keeps the sandbox up
- **WHEN** the idle period passes but a `maki` process is running in the sandbox (for example, started from another host or through `openshell sandbox connect`)
- **THEN** the helper does not stop the sandbox

#### Scenario: Concurrent sessions stop only after the last one
- **WHEN** two sessions share the sandbox, the first exits, and the second is still running when the first session's idle period passes
- **THEN** the sandbox stays up until the second session exits and its idle period passes

#### Scenario: up alone does not arm the stop
- **WHEN** the user runs `maki-oss up` and starts no session
- **THEN** the helper never stops the sandbox automatically

### Requirement: Idle stop setting
The idle period SHALL come from `--idle-stop`, `MAKI_OSS_IDLE_STOP`, or the
config key `idle_stop`, using the standard configuration precedence. The
default is `1h`. The value SHALL be a non-negative integer of seconds,
optionally followed by `s`, `m`, or `h`. `0` SHALL disable the idle stop, so
the session starts no watcher. Any other value SHALL be a usage error before
any sandbox call.

#### Scenario: Default is one hour
- **WHEN** no flag, environment variable, or config key sets the idle period
- **THEN** the idle period is 3600 seconds

#### Scenario: Suffix forms resolve to seconds
- **WHEN** `idle_stop = "90m"` is set in the config file
- **THEN** the idle period is 5400 seconds

#### Scenario: Zero disables the idle stop
- **WHEN** the user runs `maki-oss maki --idle-stop 0` and the session exits
- **THEN** the helper never calls `openshell sandbox stop` for that session

#### Scenario: Invalid value is a usage error
- **WHEN** the user runs `maki-oss maki --idle-stop soon`
- **THEN** the helper exits with status 1 before any `openshell` sandbox call and the error names the `idle_stop` setting
