## MODIFIED Requirements

### Requirement: Live journey comparison against real Maki
`make test-journeys-live` SHALL run every scripted journey against the OpenCode
TUI, the bridge, and the real pinned Maki binary inside an OpenShell sandbox,
render and normalize the screens with the same rules as the offline
comparison, and compare them with the journey's committed reference
snapshots. The live verdict SHALL follow the offline verdict rule and SHALL be
recorded on the journey row as live evidence: the live snapshots, the
comparison, the Maki and image versions, and the verdict. The live Maki
side SHALL run with a journey-only config that mirrors the reference
OpenCode config: the same loopback model provider, permission asking on, and
the same MCP server set (none unless the journey declares one), uploaded over
the image's baked files inside the run's sandbox. The target SHALL
skip cleanly, changing no file, when `openshell`, a reachable gateway, or the
project image is unavailable, and SHALL NOT join the default offline
`make test`.

#### Scenario: A live run records its verdict
- **WHEN** `make test-journeys-live` completes a scripted journey
- **THEN** the journey row carries live evidence with committed snapshots, a
  comparison, the Maki and image versions, and a verdict of `parity`,
  `diverges`, or `broken`

#### Scenario: Live evidence stays reproducible offline
- **WHEN** the offline suite re-compares a journey's committed live snapshots
  with its reference snapshots
- **THEN** the result reproduces the committed live verdict, and a mismatch
  fails the suite

#### Scenario: No gateway skips cleanly
- **WHEN** `make test-journeys-live` runs without a reachable OpenShell
  gateway
- **THEN** it prints a skip message, exits 0, and changes no file

#### Scenario: The live Maki side has the reference's MCP set
- **WHEN** a live journey runs in a sandbox built from an image that bakes
  MCP servers
- **THEN** the journey config replaces the baked MCP file with one that
  declares no server, and the bridge's `GET /api/mcp` lists none

