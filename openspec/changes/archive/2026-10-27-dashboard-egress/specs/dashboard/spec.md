# Spec Delta

## ADDED Requirements

### Requirement: Egress denials
The dashboard MUST show the network denials a sandbox logged within a user-selected window of 15 minutes, 1 hour (the default), or 6 hours, read from the gateway's sandbox log through the `openshell` CLI. A denial is an OCSF log line whose decision is `DENIED`. Denials MUST be grouped by destination host, destination port (absent when the line names none), and process binary (absent when the line names none), and each group MUST show its count, first and last time seen, and the distinct `reason` values. Lines that are not OCSF denials MUST be ignored, and a denial line the dashboard cannot parse MUST be counted and reported as unparsed instead of failing the view. The denials route MUST require the session token, in read-only mode too, and MUST return 403 without calling the CLI when the token is missing or wrong. The dashboard MUST NOT read logs for denials in the background; it MUST read them only when the user opens the Rules view or asks for a refresh, and MAY reuse a result for the same sandbox and window for up to 30 seconds. A CLI failure MUST be shown with its error text and MUST NOT clear the proposal list.

#### Scenario: Denials are grouped
- **WHEN** the sandbox log holds three `DENIED /usr/bin/curl(64) -> example.com:443` lines and one `DENIED example.com [reason:policy_dns_ineligible]` line in the window
- **THEN** the view shows one group for `example.com:443` from `/usr/bin/curl` with count 3 and one group for `example.com` with no port and count 1 with reason `policy_dns_ineligible`

#### Scenario: Window bounds the read
- **WHEN** the user selects the 15-minute window
- **THEN** the CLI is asked only for log lines from the last 15 minutes

#### Scenario: Unparsed denial is reported
- **WHEN** a log line has level `OCSF` and decision `DENIED` but an unknown layout
- **THEN** the view shows a count of unparsed denials and the other groups are still shown

#### Scenario: Token required
- **WHEN** a request reaches the denials route without the session token
- **THEN** the dashboard returns 403 and the CLI is not called

#### Scenario: Gateway failure
- **WHEN** the logs call fails because the gateway is unreachable
- **THEN** the view shows the CLI's error text and the pending proposals stay listed

### Requirement: Denials beside rule proposals
In the Rules view, each pending proposal MUST show the denial groups that match it. A group matches a proposal when the group's host equals one of the proposal's endpoint hosts (case-insensitive) and either the group has no port or its port equals that endpoint's port, and, when both the group and the proposal name binaries, the group's binary is one of the proposal's binaries. A group MAY match more than one proposal. Groups that match no pending proposal MUST be listed under a separate "denied, no proposal" heading. The inventory row and the project row for a sandbox MUST show the number of unmatched groups from the last read, and MUST show nothing when no read has happened yet. The denial view MUST NOT offer any control that creates or changes policy.

#### Scenario: Denial shown under its proposal
- **WHEN** a pending proposal names endpoint `api.example.com:443` and the log holds denials to `api.example.com:443`
- **THEN** those denials are shown under that proposal and not under "denied, no proposal"

#### Scenario: Binary mismatch does not match
- **WHEN** a proposal names endpoint `api.example.com:443` and binary `/usr/bin/node`, and the denials come from `/usr/bin/curl`
- **THEN** the denials are listed under "denied, no proposal"

#### Scenario: Unmatched count on the inventory
- **WHEN** the last read found two denial groups and one of them matches a pending proposal
- **THEN** the inventory row for that sandbox shows a denied count of 1

#### Scenario: Log text stays text
- **WHEN** a denial line names the host `<img src=x onerror=alert(1)>`
- **THEN** the view shows that text literally and no element is created from it
