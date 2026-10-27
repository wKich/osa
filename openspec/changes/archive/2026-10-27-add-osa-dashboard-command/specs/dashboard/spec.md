# Spec Delta

## ADDED Requirements

### Requirement: Open in the browser on start

The dashboard SHALL accept `--open`. With `--open` on a loopback bind, the dashboard SHALL open the page in the user's default browser once the server is listening. The URL it opens MUST NOT contain the token. With `--open` on a non-loopback bind, it MUST NOT open a browser, and SHALL print that the page must be opened with `?token=`. The URL and the token MUST NOT be placed together in any process argument. When no browser opener is available or the opener fails, the dashboard SHALL print the URL and a note and SHALL keep serving. Without `--open`, the dashboard MUST NOT start any other process at startup.

#### Scenario: Open on loopback
- **WHEN** the dashboard starts with `--open` on the default bind
- **THEN** after it is listening, the opener receives `http://127.0.0.1:<port>/` with no query string

#### Scenario: No open off loopback
- **WHEN** the dashboard starts with `--host 0.0.0.0 --token T --open`
- **THEN** no opener runs, and the startup output says to open the page with `?token=`

#### Scenario: Opener missing
- **WHEN** `--open` is given and no opener is available
- **THEN** the dashboard prints the URL with a note and keeps serving
