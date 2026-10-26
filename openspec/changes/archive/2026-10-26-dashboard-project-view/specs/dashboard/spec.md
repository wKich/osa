# Spec Delta

## ADDED Requirements

### Requirement: Project list
The dashboard MUST show a Projects view that lists every entry in the osa project registry (`$XDG_STATE_HOME/osa/projects/*.toml`) across all agent tags, with the agent, project name, host path, sandbox name, and whether a sandbox with that name is currently visible on the gateway. An agent tag the dashboard does not know MUST still be listed, shown by its raw tag. The list MUST refresh at least every 5 seconds without a full page reload and MUST NOT contact the gateway to build the list itself. An entry that cannot be parsed, or whose contract `version` is not `"1"`, MUST be listed by its file name with a note instead of failing the view. A row whose sandbox is visible on the gateway MUST link to that sandbox's detail view. A missing or empty registry MUST show an empty state that names the front-end commands that register a project.

#### Scenario: Projects from every agent are listed
- **WHEN** the registry holds one entry for agent `mk` and one for agent `cc`
- **THEN** the Projects view lists both rows with their agent, project, host path, and sandbox name

#### Scenario: New registration appears
- **WHEN** a front-end registers a new project while the Projects view is open
- **THEN** the new row appears within one refresh interval without user action

#### Scenario: Sandbox missing from the gateway
- **WHEN** a registry entry names a sandbox that the gateway does not list
- **THEN** the row is shown with a "not on gateway" note and no link to a sandbox detail view

#### Scenario: Unreadable entry
- **WHEN** one registry file is not valid TOML and another is valid
- **THEN** the valid entry is listed normally and the invalid one is listed by file name with a parse note

#### Scenario: Newer contract version
- **WHEN** a registry entry has `version = "2"`
- **THEN** the row is listed by its file name with an "unsupported contract version" note and none of its other fields are interpreted

#### Scenario: Empty registry
- **WHEN** the registry directory does not exist
- **THEN** the Projects view shows an empty state and the page does not show an error banner

### Requirement: Project sync badges
Each project row MUST show the pending kind from that sandbox's `pending` marker (`retained`, `parked`, or none) and MUST show an orphan badge when the entry's `host_path` no longer exists. Each row MUST also show whether the host changed since the last sync (`changed`, `unchanged`, or `unknown`), as reported by `osa status --quick --json` for that path. The dashboard MUST NOT compute this host-change result on every list refresh: a result MAY be reused for up to 60 seconds, and the user MUST be able to request a fresh one. On request, the dashboard MUST show a project's full status from `osa status --json` for that path: sync state (`clean`, `behind`, `retained`, or `parked`), phase, and the next command the front-end suggests. A failing `osa` call MUST be shown on the affected row with its error text and MUST NOT remove the row or the pending and orphan badges.

#### Scenario: Retained patch badge
- **WHEN** a sandbox's `pending` marker has `kind = "retained"`
- **THEN** that project's row shows a `retained` badge

#### Scenario: Orphan badge
- **WHEN** a registry entry's `host_path` does not exist on the host
- **THEN** the row shows an orphan badge and its host-change result is `unknown`

#### Scenario: Host change shown
- **WHEN** `osa status --quick --json` reports `fingerprint_result` `changed` for a project
- **THEN** that row shows that the host changed since the last sync

#### Scenario: Host-change checks are not run per refresh
- **WHEN** the Projects view stays open across several list refreshes within 60 seconds
- **THEN** `osa status --quick` runs at most once per project in that time unless the user requests a fresh check

#### Scenario: Full status on request
- **WHEN** the user requests the full status of a project whose front-end reports `behind`
- **THEN** the row shows sync state `behind` and the suggested next command

#### Scenario: osa is unavailable
- **WHEN** the `osa` command cannot be started
- **THEN** each row keeps its pending and orphan badges, shows the host-change result as unavailable with the error text, and the page does not crash

### Requirement: Attention counter
The page header MUST show the number of registered projects that need attention: those with a retained patch, a parked workspace, or a missing host folder. The counter MUST be visible from every view, MUST update with each project list refresh, and MUST be hidden or show zero when no project needs attention. Activating the counter MUST open the Projects view.

#### Scenario: Counter counts pending and orphans
- **WHEN** the registry holds one project with a retained patch, one with a parked workspace, one orphan, and one clean project
- **THEN** the header counter shows 3

#### Scenario: Counter follows resolution
- **WHEN** a front-end resolves a retained patch and removes its `pending` marker
- **THEN** the counter drops by one within one refresh interval

### Requirement: Read-only patch viewer
For a project whose `pending` marker records a retained patch, the dashboard MUST show the patch text read-only, with added and removed lines visually distinct, and its file name and size. The patch route MUST require the session token, in read-only mode too, and MUST return 403 without reading the file when the token is missing or wrong. The dashboard MUST serve a patch only when the marker's `patch` path resolves to a regular file inside that sandbox's session directory under the state root; any other path, including one that escapes through a symbolic link, MUST be refused. A patch larger than 2 MiB MUST be truncated with a visible notice. Patch content MUST reach the page as text only, never as markup. The patch viewer MUST NOT offer apply, branch, drop, or any other control that changes the patch, the marker, or the host project.

#### Scenario: Retained patch is shown
- **WHEN** the user opens the patch of a project with a retained patch
- **THEN** the dashboard shows the diff with added and removed lines marked and no apply, branch, or drop control

#### Scenario: Patch request without token
- **WHEN** a request reaches the patch route without the session token
- **THEN** the dashboard returns 403 and does not read the patch file

#### Scenario: Patch path outside the session directory
- **WHEN** a `pending` marker's `patch` path points outside that sandbox's session directory, directly or through a symbolic link
- **THEN** the patch route refuses the request and serves no file content

#### Scenario: Markup in a patch stays text
- **WHEN** a patch contains the text `<img src=x onerror=alert(1)>`
- **THEN** the viewer shows that text literally and no element is created from it

#### Scenario: Large patch is truncated
- **WHEN** a retained patch is larger than 2 MiB
- **THEN** the viewer shows the first 2 MiB and a notice that the patch was truncated

### Requirement: Project data stays read-only
The dashboard MUST NOT create, modify, or delete any file under the osa state root or in a registered host project, and MUST NOT run any `osa` command other than `osa status` with `--json`, with or without `--quick`. No project route MUST accept a method other than GET.

#### Scenario: Browsing projects changes nothing
- **WHEN** the user opens the Projects view, requests full status for every project, and opens every retained patch
- **THEN** no file under the state root or in any registered host folder changes

#### Scenario: Write method is refused
- **WHEN** a client sends POST to a project route
- **THEN** the dashboard answers with an error status and runs no command
