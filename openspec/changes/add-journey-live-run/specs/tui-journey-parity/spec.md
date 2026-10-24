# Spec Delta

## ADDED Requirements

### Requirement: Live journey comparison against real Maki
`make test-journeys-live` SHALL run every scripted journey against the OpenCode
TUI, the bridge, and the real pinned Maki binary inside an OpenShell sandbox,
render and normalize the screens with the same rules as the offline
comparison, and compare them with the journey's committed reference
snapshots. The live verdict SHALL follow the offline verdict rule and SHALL be
recorded on the journey row as live evidence: the live snapshots, the
comparison, the Maki and image versions, and the verdict. The target SHALL
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

### Requirement: Live runs keep the sandbox boundary
A live journey run SHALL use a dedicated sandbox created for the run from the
project image with the minimal policy and no provider attached, and SHALL
delete it when the run ends, whether it passed or failed. The scripted model
provider SHALL run inside that sandbox on its own loopback. The run SHALL NOT
add a network rule, provider profile, credential, bind mount, or `--env`
value, SHALL NOT make the host's loopback reachable from the sandbox, and
SHALL NOT use or modify any other sandbox.

#### Scenario: The run's sandbox is throwaway
- **WHEN** a live run ends, by success, failure, or interruption
- **THEN** the sandbox it created no longer exists, and no other sandbox was
  created, attached, or changed

#### Scenario: No egress is added
- **WHEN** the live run's sandbox is inspected during the run
- **THEN** its effective policy equals the minimal policy with no provider
  rules, and Maki's only model endpoint is the in-sandbox loopback provider
