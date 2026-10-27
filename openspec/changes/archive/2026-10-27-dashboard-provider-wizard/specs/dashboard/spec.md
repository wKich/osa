# Spec Delta

## ADDED Requirements

### Requirement: Provider setup wizard

The dashboard MUST show, for each agent `osa providers --json` reports, the providers on the gateway, the providers remembered in that agent's config, and the profiles available for setup, with each profile's id, credential variable, source (`curated` or `custom`), and note. When the gateway cannot be listed, the profiles and remembered providers MUST still show, with the gateway error. Outside read-only mode and on a loopback bind, the dashboard MUST offer a wizard that sets up a provider through `osa provider setup` for an agent whose `setup` is `stdin`. For an agent whose `setup` is `login`, it MUST show the terminal command instead of the wizard. The wizard MUST collect a profile, a provider name (defaulting to the profile id), the credential, and optionally one sandbox to attach to. It MUST offer only registered sandboxes of the same agent that are visible on the gateway. When the name matches a provider on the gateway, the wizard MUST require an explicit choice to replace that provider's credential before it sends `--yes`. The setup route MUST require the session token in `X-Dashboard-Token`, MUST be refused with 403 in read-only mode, and MUST run exactly one `osa provider setup` built from validated fields, with no client-supplied argument passed through as is. A second setup request while one is running MUST be refused with 409. After a setup, the dashboard MUST show the outcome (created, updated, refused with osa's message, or failed with the steps that completed). It MUST refresh the provider list and the inventory without waiting for the next poll. A registered sandbox's detail view that shows no attached provider MUST offer a link that opens the wizard with its agent and sandbox selected.

#### Scenario: Create and attach from the wizard
- **WHEN** the user picks agent `mk`, profile `maki-deepseek`, pastes a key, selects sandbox `mk-demo-1a2b`, and submits
- **THEN** the server runs `osa provider setup mk --profile maki-deepseek --attach mk-demo-1a2b --json` with the key on stdin, and the wizard shows the provider created and attached

#### Scenario: Existing provider needs a replace choice
- **WHEN** the chosen name is already on the gateway and the user has not chosen to replace it
- **THEN** the submit control stays disabled, and no request is sent

#### Scenario: Login agent shows the terminal command
- **WHEN** the user opens the wizard for agent `cx`
- **THEN** no credential field is shown, and the page shows `codex-oss provider setup` as the command to run in a terminal

#### Scenario: Refused setup is shown as no change
- **WHEN** `osa provider setup` exits 2
- **THEN** the wizard says nothing changed and shows osa's message

#### Scenario: Read-only mode hides and refuses setup
- **WHEN** read-only mode is active
- **THEN** the wizard controls are absent, and a client posting to the setup route with the page token receives 403 and no command runs

#### Scenario: Concurrent setup is refused
- **WHEN** a setup is running and a second setup request arrives
- **THEN** the second request is answered 409 and no command runs

### Requirement: Provider credentials in transit

A credential entered in the dashboard MUST travel only in the body of one same-origin request to the setup route. From there it MUST go only to the standard input of the `osa provider setup` child, and that stdin MUST be closed after the credential is written. The dashboard MUST NOT place the credential in any process argument, environment variable, file, log line, cache, URL, response body, or error message. The page MUST NOT keep it in application state, `localStorage`, `sessionStorage`, or a cookie. It MUST clear the credential field when the setup finishes, is cancelled, or the wizard closes. The field MUST disable autocomplete and spell checking. Before the dashboard returns or logs any output of `osa`, every occurrence of the submitted credential in it MUST be replaced with `[redacted]`. On a non-loopback bind the setup route MUST be refused with 403 before the request body is read, and the wizard MUST say that setup is available only on a loopback bind. The route MUST refuse a request body over 70 KiB with 413 and a non-JSON content type with 415, and in both cases it MUST run no command.

#### Scenario: Credential stays out of argv and responses
- **WHEN** a setup runs with a distinctive fixture credential
- **THEN** the stub `osa` records the credential's length from stdin, its recorded argv does not contain the credential, and neither the response body nor the server's output contains it

#### Scenario: Echoed credential is redacted
- **WHEN** the stub `osa` prints the received credential inside its message
- **THEN** the response shows `[redacted]` in its place

#### Scenario: Remote bind refuses setup
- **WHEN** the dashboard is bound to `0.0.0.0` with a token and a client posts a setup request with the correct token
- **THEN** the response is 403, and no command runs

#### Scenario: Field is cleared
- **WHEN** a setup completes or the user cancels the wizard
- **THEN** the credential input is empty, and no browser storage key holds the value
