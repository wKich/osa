# Spec Delta

## ADDED Requirements

### Requirement: Token confidentiality and authenticated remote reads

When the dashboard is bound to a non-loopback address, every request for the page or for an API read route MUST present the configured token, either as the `token` query parameter for the page and stream or as the `X-Dashboard-Token` header for API reads. An unauthenticated response MUST NOT contain the token or any project, sandbox, policy, rule, log, or host-path data. The page SHALL embed the token only after the request has proved it knows it. Mutating routes SHALL keep requiring the header, and read-only mode SHALL keep rejecting every mutation while still requiring the token for remote reads and logs.

The dashboard MUST validate the `Host` header against the configured bind address and port. On a loopback bind it MUST accept only `127.0.0.1`, `localhost`, and `[::1]`; a request with any other host, including a DNS name that resolves to the loopback address, MUST be refused before the page or any API route is served. On a concrete non-loopback bind it MUST accept its own address in addition to the loopback names, and on a wildcard bind it MAY accept any hostname because the token remains required.

#### Scenario: Remote page without a token is refused
- **WHEN** the dashboard is bound to `0.0.0.0` with a configured token and a client requests `/` without the token
- **THEN** the response is 403 and its body contains neither the token nor project or sandbox data

#### Scenario: Remote page with the token is served
- **WHEN** the same client requests `/?token=<token>`
- **THEN** the page is served and the bootstrap contains the token for its same-origin API calls

#### Scenario: Remote reads require the token
- **WHEN** a client requests `/api/sandboxes` or `/api/projects` from a non-loopback bind without `X-Dashboard-Token`
- **THEN** the response is 403 and no gateway or `osa` command runs

#### Scenario: DNS rebinding is refused
- **WHEN** a request reaches the loopback server with `Host: evil.example:<port>`
- **THEN** the dashboard answers 403 before serving the page or any API data

#### Scenario: Read-only remote logs require the token
- **WHEN** read-only mode is active on a non-loopback bind and a client opens `/events/logs?name=<sandbox>` without the token
- **THEN** the response is 403 and no log process is spawned
