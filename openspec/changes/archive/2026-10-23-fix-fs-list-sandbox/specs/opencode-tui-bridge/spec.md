## MODIFIED Requirements

### Requirement: Sandbox transport and host exposure
The bridge SHALL run Maki by spawning `openshell sandbox exec` for the project
sandbox with `--no-login-shell`, the configured workdir, Maki's SDK flags
(`-p --input-format stream-json --output-format stream-json
--include-partial-messages`), and the configured model, over a stdin/stdout
pipe that stays open for the session's lifetime. The child SHALL be asked for
partial output so streamed turns reach the transcript incrementally rather
than only at completion. The exec invocation MUST NOT pass any `--env` value.
The Maki child command SHALL be overridable through one environment variable
so a scripted process can replace it. The bridge SHALL listen on loopback only
by default; binding to any other address SHALL require a configured password
and print a warning. Bridge logs MUST NOT contain credential material.

#### Scenario: Exec carries no environment values
- **WHEN** the bridge starts a Maki child for a session
- **THEN** the recorded `openshell sandbox exec` argv contains
  `--input-format stream-json`, `--output-format stream-json`,
  `--include-partial-messages`, `--no-login-shell` and the workdir, and
  contains no `--env` flag

#### Scenario: A scripted child replaces the sandbox transport
- **WHEN** the Maki child override environment variable points at a scripted
  process that speaks the Maki SDK wire
- **THEN** the bridge drives that process exactly as it drives the sandbox
  child, with no other code path difference

#### Scenario: Default bind is loopback
- **WHEN** the bridge starts with no address configured
- **THEN** it listens only on `127.0.0.1` and the startup output states the URL

#### Scenario: Logs are free of credentials
- **WHEN** a full session has run with bridge logging enabled
- **THEN** the request, SSE, and stdout logs match a credential-pattern scan
  with no finding

#### Scenario: Sandbox state is read through the same exec transport
- **WHEN** a route answers from sandbox state — the TUI lists its directory
  through `GET /api/fs/list`
- **THEN** the bridge runs a read-only `openshell sandbox exec -n <sandbox>
  --no-login-shell --workdir <workdir> -- …` with no `--env` value, answers
  with the sandbox workdir's entries under the directory the client named,
  lists nothing for a path outside that directory, reads no host directory,
  and answers an empty list when no sandbox is configured
