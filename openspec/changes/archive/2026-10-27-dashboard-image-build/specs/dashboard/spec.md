# Spec Delta

## ADDED Requirements

### Requirement: Base image builds

The dashboard MUST show, for each agent `osa images --json` reports, the base image tag, whether it exists locally and when it was created, the engine, the configured session image when it differs, and any per-agent error. Outside read-only mode it MUST offer a Build action per agent. The action MUST be sent to a build route that requires the session token in `X-Dashboard-Token`, MUST be refused with 403 in read-only mode, and MUST run exactly one `osa image build <tag>` for an agent tag from the known set, with no other client-supplied argument. Only one build MUST run at a time across all agents: a build request while one is running MUST be refused with 409 and MUST start nothing. The build MUST keep running when every browser disconnects. The dashboard MUST stream the build's output to the page live, through a stream that requires the session token. A reconnecting or newly opened page MUST receive the current or most recent build's output from the start (up to a bounded number of lines) and then live lines. The end of the build MUST be marked with its result (succeeded, failed with exit status, or cancelled). The dashboard MUST offer Cancel while a build runs, behind the same token and read-only guards, which stops the build. After a build ends, the dashboard MUST refresh the image list without waiting for user action. Build output MUST be rendered only as text.

#### Scenario: Build a missing image
- **WHEN** the `mk` base image is missing and the user presses Build for `mk`
- **THEN** the server runs `osa image build mk`, the page shows its output as it arrives, and after it succeeds the row shows the image as present

#### Scenario: Second build is refused
- **WHEN** a build is running and a client requests a build for any agent
- **THEN** the response is 409 and no second `osa image build` is spawned

#### Scenario: Build survives a closed tab
- **WHEN** the user starts a build, closes the page, and opens it again before the build ends
- **THEN** the build is still running, and the new page shows the output from the start followed by live lines

#### Scenario: Cancel a build
- **WHEN** the user presses Cancel while a build runs
- **THEN** the build stops, and the log ends with a cancelled result

#### Scenario: Failed build shows its status
- **WHEN** `osa image build` exits non-zero
- **THEN** the log ends with a failed result carrying the exit status, and the row still reports the image's previous state

#### Scenario: Read-only mode refuses builds
- **WHEN** read-only mode is active
- **THEN** the Build and Cancel controls are absent, and a client posting to the build route with the page token receives 403 and nothing is spawned

#### Scenario: Build stream requires the token
- **WHEN** a client opens the build stream without the session token
- **THEN** the response is 403
