## ADDED Requirements

### Requirement: Project removal

Outside read-only mode, the dashboard MUST offer a Remove action on every row of the Projects view, orphans included. Before any request is sent, Remove MUST require the user to type the row's sandbox name. While the user confirms, the dashboard MUST say what will happen:
- when the sandbox is visible on the gateway, that the sandbox will be deleted on the gateway and the project forgotten;
- when it is not, that the project will only be forgotten.

The action MUST be disabled, with the reason shown, while the row has a `retained` or `parked` badge, or while `osa status --quick` reports the project `busy`.

The action MUST be sent to a remove route. That route:
- MUST require the session token in the `X-Dashboard-Token` header;
- MUST be refused with 403 in read-only mode;
- MUST run exactly one `osa remove SANDBOX --yes --json` for the registered sandbox named in the route, with no client-supplied argument;
- MUST answer 409, running nothing, while a resolve or remove for the same sandbox is running.

After the action, the dashboard MUST show one of:
- what was removed;
- that nothing changed, with `osa`'s message, when `osa` refused;
- the error text, when it failed.

After a successful removal, it MUST re-read the project list and the inventory without waiting for the next poll, so that the row disappears.

#### Scenario: Remove a stale row
- **WHEN** a row shows "not on gateway" and the user presses Remove, types the sandbox name, and confirms
- **THEN** the server runs `osa remove <sandbox> --yes --json`, and the row disappears from the Projects view without waiting for a poll

#### Scenario: Remove a project with a live sandbox
- **WHEN** a row's sandbox is visible on the gateway and the user opens Remove
- **THEN** the confirmation says the sandbox will be deleted on the gateway, and after confirming, the sandbox is gone from the inventory and the row from the Projects view

#### Scenario: Remove requires the typed name
- **WHEN** the user activates Remove without typing the exact sandbox name
- **THEN** no request is sent

#### Scenario: Pending work disables Remove
- **WHEN** a row has a `retained` badge
- **THEN** its Remove action is disabled and the row says the pending work must be resolved first

#### Scenario: Refusal is shown as no change
- **WHEN** `osa remove` exits 2 because a session started after the last poll
- **THEN** the row says nothing changed, shows `osa`'s message, and stays listed

#### Scenario: Read-only mode refuses remove
- **WHEN** read-only mode is active and a client posts to the remove route with the page token
- **THEN** the server responds 403 and runs no command

#### Scenario: Missing token refuses remove
- **WHEN** a client posts to the remove route without the `X-Dashboard-Token` header
- **THEN** the server responds 403 and runs no command

## MODIFIED Requirements

### Requirement: Project writes go through osa resolve
The dashboard MUST NOT create, modify, or delete any file under the osa state root or in a registered host project except by running `osa resolve` or `osa remove`. The only `osa` commands it MAY run for projects are:
- `osa status PATH --json`;
- `osa status PATH --quick --json`;
- `osa resolve SANDBOX ACTION --json`, with `--yes` only for `drop` and `discard`;
- `osa remove SANDBOX --yes --json`.

`SANDBOX` is a name from the registry, and `ACTION` is one of `apply`, `branch`, `drop`, `rescue`, or `discard`. The resolve and remove routes are the only project routes that accept a method other than GET: each MUST accept only POST, and every other project route MUST accept only GET.

#### Scenario: Browsing projects changes nothing
- **WHEN** the user opens the Projects view, requests full status for every project, and opens every retained patch without pressing an action button
- **THEN** no file under the state root or in any registered host folder changes

#### Scenario: Write method is refused
- **WHEN** a client sends POST to the project list, status, or patch route
- **THEN** the dashboard answers with an error status and runs no command

#### Scenario: Unknown action is refused
- **WHEN** a client posts `{ "action": "rm" }` to the resolve route with a valid token
- **THEN** the dashboard answers 400 and runs no command

#### Scenario: Remove route accepts POST only
- **WHEN** a client sends GET to the remove route
- **THEN** the dashboard answers 405 and runs no command
