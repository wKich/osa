# Spec Delta

## ADDED Requirements

### Requirement: Project health panel
The dashboard MUST offer a Health panel for each registered project, from the Projects view and from the detail view of a registered sandbox. Opening the panel MUST run `osa health SANDBOX --json` for that sandbox and show the idle-stop state, each MCP server with each gate's result and fix text, and each doctor check with its status and detail. The dashboard MUST run `osa health` only when the user opens the panel or asks for a refresh, never on a poll tick. A section that reports an error MUST show the error text while the other sections are shown. MCP reported as `unsupported` MUST be shown as such, not as a failure. The panel MUST NOT offer any control that changes configuration, providers, or the sandbox. All values MUST reach the page as text only.

#### Scenario: Failing MCP gate shows its fix
- **WHEN** the user opens the Health panel of a project whose MCP server fails the policy gate
- **THEN** the panel shows that server with the failed gate and the fix text

#### Scenario: Health is on demand
- **WHEN** the Projects view stays open for several refresh intervals without the user opening a Health panel
- **THEN** `osa health` is never run

#### Scenario: Partial failure
- **WHEN** `osa health` reports an MCP error because the gateway is unreachable
- **THEN** the panel shows the MCP error text and still shows the idle stop and doctor sections

#### Scenario: Health output stays text
- **WHEN** a doctor check's detail contains `<img src=x onerror=alert(1)>`
- **THEN** the panel shows that text literally and no element is created from it

### Requirement: Idle stop countdown
Each project row MUST show its idle-stop state from `osa status --quick --json`. While the state is `counting`, the row MUST show the time left until the deadline and update it at least every second without a request. When the deadline passes, the row MUST show that the stop is due until the next quick status reports the new state. Other states MUST be shown as a short label (`off`, `no session`, `session running`, `stopped`, `skipped`, `stop failed`).

#### Scenario: Countdown ticks without requests
- **WHEN** quick status reports idle state `counting` with a deadline 5 minutes away
- **THEN** the row shows about 5 minutes left and the value decreases each second with no new request to the server

#### Scenario: Deadline passed
- **WHEN** the deadline passes before the next quick status
- **THEN** the row shows that the stop is due
