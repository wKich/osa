# dashboard Specification

## Purpose
A local web dashboard for osa and OpenShell: the projects every agent front-end has registered with their sync state, plus the gateway's sandboxes, streamed logs, policy inspection, and rule-proposal review, without replacing `openshell term` or the CLIs.

## Requirements

### Requirement: Local-only serving
The dashboard MUST bind to `127.0.0.1` by default. Binding to any other address MUST require an explicit token and MUST print a warning at startup.

#### Scenario: Default bind is loopback
- **WHEN** the server starts with no host argument
- **THEN** it listens only on `127.0.0.1` and the startup output states the URL

#### Scenario: Non-loopback bind demands a token
- **WHEN** the server is started with non-loopback host and no token
- **THEN** startup fails with an error that explains the requirement

### Requirement: Sandbox inventory
The dashboard MUST show every sandbox visible to the configured gateway with name, phase, image, labels, and notes (for example, invalid configuration), and MUST refresh this view at least every 5 seconds without a full page reload.

#### Scenario: New sandbox appears
- **WHEN** a sandbox is created through the CLI while the dashboard is open
- **THEN** the inventory shows it within one refresh interval without user action

#### Scenario: Invalid configuration note is visible
- **WHEN** a sandbox reports an invalid-configuration note
- **THEN** the inventory displays that note next to the sandbox

### Requirement: Lifecycle actions
The dashboard MUST support starting, stopping, and deleting an existing sandbox, and creating one from the configured defaults (image, policy, providers). Deleting MUST require the user to type the sandbox name. Every action MUST surface the gateway's success or error response in the UI.

#### Scenario: Stop reports the new phase
- **WHEN** the user stops a `Ready` sandbox
- **THEN** the action reports success and the inventory reflects the sandbox's new phase on a later refresh

#### Scenario: Delete requires typed confirmation
- **WHEN** the user activates delete without typing the exact sandbox name
- **THEN** no delete request is sent

#### Scenario: Gateway error is surfaced
- **WHEN** an action fails (for example, the sandbox was already deleted elsewhere)
- **THEN** the UI shows the CLI's error message and the inventory stays consistent with the gateway

### Requirement: Live log streaming
The dashboard MUST stream live logs for a selected sandbox, support client-side filtering by source and level, allow pause and resume, and replay a bounded recent buffer on reconnect. A stream MUST stop when its client disconnects or the sandbox is deleted. Starting a stream MUST require the session token embedded in the served page (as a query parameter, since the browser's stream API cannot send headers); in read-only mode that token gates streams only and still never permits mutations. When a stream's last subscriber leaves and its log process has ended, the dashboard MUST release the hub's state so repeated streams for different sandbox names cannot grow memory without bound. An unauthenticated request MUST NOT spawn a log process.

#### Scenario: Logs flow end to end
- **WHEN** the user opens the logs view for a running sandbox
- **THEN** new log lines appear in the browser within two seconds

#### Scenario: Disconnect stops the tail
- **WHEN** the client disconnects
- **THEN** the dashboard terminates the spawned log process for that client

#### Scenario: Stream without token is refused
- **WHEN** a request reaches the log stream route without the session token
- **THEN** the dashboard returns 403 and no log process is spawned

#### Scenario: Read-only mode can still stream
- **WHEN** the dashboard runs with `--read-only` and the served page opens the log stream
- **THEN** the stream works, using the page's token, while every mutating route still returns 403

#### Scenario: Idle hub state is released
- **WHEN** a log stream's last subscriber disconnects and its log process has ended
- **THEN** a later stream for a different sandbox name does not retain the previous sandbox's buffered lines or process state

### Requirement: Policy inspection
The dashboard MUST display the base and effective policy of a selected sandbox as read-only text and MUST list policy revisions with their load status.

#### Scenario: Effective policy includes provider rules
- **WHEN** a sandbox has an attached provider that contributes network rules
- **THEN** the effective view shows the provider-contributed entries that the base view does not

### Requirement: Rule proposal review
The dashboard MUST list pending rule proposals for a sandbox, allow approving one, and allow rejecting one with a required reason. A rejection without a reason MUST NOT be sent.

#### Scenario: Approve clears the pending item
- **WHEN** the user approves a pending proposal
- **THEN** the proposal leaves the pending list and the dashboard reports the gateway's acceptance

#### Scenario: Rejection requires a reason
- **WHEN** the user submits a rejection with an empty reason
- **THEN** no request is sent and the UI prompts for a reason

### Requirement: Read-only mode
The dashboard MUST provide a read-only mode (flag or environment) in which every mutating route fails and the UI disables or hides mutating controls.

#### Scenario: Mutations rejected
- **WHEN** read-only mode is active and a client posts to a start, stop, delete, or approve route
- **THEN** the server responds 403 and performs no gateway action

### Requirement: CLI failure surfacing
The dashboard MUST show a prominent status when the `openshell` CLI is missing, the gateway is unreachable, or a command's output cannot be parsed, and MUST keep serving previously fetched data where available.

#### Scenario: Gateway unreachable
- **WHEN** the gateway becomes unreachable while the dashboard is open
- **THEN** the banner reports the failure with the CLI's error text and the page does not crash

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
For a project whose `pending` marker records a retained patch, the dashboard MUST show the patch text read-only, with added and removed lines visually distinct, and its file name and size. The patch route MUST require the session token, in read-only mode too, and MUST return 403 without reading the file when the token is missing or wrong. The dashboard MUST serve a patch only when the marker's `patch` path resolves to a regular file inside that sandbox's session directory under the state root; any other path, including one that escapes through a symbolic link, MUST be refused. A patch larger than 2 MiB MUST be truncated with a visible notice. Patch content MUST reach the page as text only, never as markup. The patch text MUST NOT be editable. Outside read-only mode the viewer MUST offer the retained-patch actions defined by "Sync resolve actions"; in read-only mode it MUST offer no control that changes the patch, the marker, or the host project.

#### Scenario: Retained patch is shown
- **WHEN** the user opens the patch of a project with a retained patch outside read-only mode
- **THEN** the dashboard shows the diff with added and removed lines marked, and the Apply, Branch, and Drop actions

#### Scenario: Read-only viewer has no actions
- **WHEN** the dashboard runs in read-only mode and the user opens a retained patch
- **THEN** the diff is shown and no Apply, Branch, or Drop control is present

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


### Requirement: Project writes go through osa resolve
The dashboard MUST NOT create, modify, or delete any file under the osa state root or in a registered host project except by running `osa resolve`. The only `osa` commands it MAY run are `osa status PATH --json`, `osa status PATH --quick --json`, and `osa resolve SANDBOX ACTION --json`, with `--yes` only for `drop` and `discard`, where `SANDBOX` is a name from the registry and `ACTION` is one of `apply`, `branch`, `drop`, `rescue`, or `discard`. The resolve route is the only project route that accepts a method other than GET; it MUST accept only POST, and every other project route MUST accept only GET.

#### Scenario: Browsing projects changes nothing
- **WHEN** the user opens the Projects view, requests full status for every project, and opens every retained patch without pressing an action button
- **THEN** no file under the state root or in any registered host folder changes

#### Scenario: Write method is refused
- **WHEN** a client sends POST to the project list, status, or patch route
- **THEN** the dashboard answers with an error status and runs no command

#### Scenario: Unknown action is refused
- **WHEN** a client posts `{ "action": "rm" }` to the resolve route with a valid token
- **THEN** the dashboard answers 400 and runs no command

### Requirement: Sync resolve actions
Outside read-only mode, the dashboard MUST offer Apply, Branch, and Drop for a project with a retained patch, and Rescue and Discard for a project with a parked workspace, and no resolve action for any other project or for an orphan. Each action MUST be sent to a resolve route that requires the session token in the `X-Dashboard-Token` header, MUST be refused with 403 in read-only mode, and MUST run exactly one `osa resolve` for the registered sandbox named in the route. Drop and Discard MUST require the user to type the sandbox name before any request is sent. Before Apply runs, the dashboard MUST list the files the patch touches. While `osa status --quick` reports the project `busy`, the actions MUST be disabled with the reason shown. After an action, the dashboard MUST show what changed (files, branch name, or rescue folder), or that nothing changed when `osa` refused, or the error text when it failed, and MUST refresh that project's badges without waiting for the next poll. Concurrent actions on one sandbox MUST NOT run: a second request while one is running MUST be refused with 409.

#### Scenario: Apply a retained patch
- **WHEN** the user presses Apply on a project with a retained patch and confirms the listed files
- **THEN** the dashboard runs `osa resolve <sandbox> apply --json`, shows the changed files, and the row's `retained` badge disappears

#### Scenario: Refusal is shown as no change
- **WHEN** `osa resolve` refuses Apply because the dry run failed
- **THEN** the row says nothing changed, shows osa's message suggesting Branch, and keeps its `retained` badge

#### Scenario: Branch shows the branch name
- **WHEN** the user presses Branch on a retained patch
- **THEN** the outcome names the created `osa/<sandbox>-<timestamp>` branch

#### Scenario: Drop requires the typed name
- **WHEN** the user activates Drop without typing the exact sandbox name
- **THEN** no request is sent

#### Scenario: Rescue shows the folder
- **WHEN** the user presses Rescue on a parked workspace
- **THEN** the outcome shows the path of the new rescue folder and the row stays `parked`

#### Scenario: Read-only mode refuses resolve
- **WHEN** read-only mode is active and a client posts to the resolve route with the page token
- **THEN** the server responds 403 and runs no command

#### Scenario: Missing token refuses resolve
- **WHEN** a client posts to the resolve route without the `X-Dashboard-Token` header
- **THEN** the server responds 403 and runs no command

#### Scenario: Busy project
- **WHEN** a session is running for a project with a retained patch
- **THEN** its actions are disabled and the row says a session is running

#### Scenario: Second action while one runs
- **WHEN** an action for a sandbox is still running and another resolve request for the same sandbox arrives
- **THEN** the second request is answered 409 and runs no command
