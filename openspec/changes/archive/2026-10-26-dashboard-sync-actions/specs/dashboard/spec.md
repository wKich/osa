# Spec Delta

## RENAMED Requirements

- FROM: `### Requirement: Project data stays read-only`
- TO: `### Requirement: Project writes go through osa resolve`

## MODIFIED Requirements

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

## ADDED Requirements

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
