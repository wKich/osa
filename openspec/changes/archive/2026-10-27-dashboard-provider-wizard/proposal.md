# Proposal

## Why

A sandbox without a provider cannot reach a model, and today the only way to add one is `<front-end> provider setup` in a terminal. The dashboard already shows every project and sandbox, but a user who sees a sandbox with no provider has to leave it to fix that. M4 adds setup to the dashboard. It is also the first time a secret passes through the dashboard, which until now has promised never to handle credential values, so the route, the page, and the threat model must keep the secret out of argv, logs, caches, and responses. `add-provider-setup-noninteractive` supplies `osa providers` and `osa provider setup ... --json`, which take the secret on stdin, so the dashboard only collects the secret and hands it over.

## What Changes

- Add a **Setup** tab with a **Providers** section. For each agent it shows the providers on the gateway, the remembered providers, and the profiles available, from `GET /api/providers` (`osa providers --json`).
- Add a **provider wizard**:
  - pick an agent with `setup` `stdin` (Codex shows its terminal command instead);
  - pick a profile, curated or custom, with its note and credential variable;
  - name the provider (defaults to the profile id);
  - paste the credential into a password field;
  - optionally attach the provider to one of that agent's registered sandboxes that is on the gateway;
  - confirm replacing an existing provider when the name is taken.
- Add **`POST /api/providers/setup`**.
  - It requires the session token, is refused in read-only mode, and is refused on any non-loopback bind, because the dashboard serves plain HTTP.
  - It runs exactly one `osa provider setup TAG --profile ID [--name N] [--attach S] [--yes] --json`, writes the credential to its stdin, and closes it.
  - One setup runs at a time; a second request gets 409.
- The **credential** is never placed in argv, logged, cached, kept in client state or storage, or echoed back. Any copy of it in `osa`'s output is replaced with `[redacted]` before anything is returned.
- Add a **Configure** link on a registered sandbox's detail view when it shows no attached provider. It opens the wizard with the agent and sandbox preselected.
- Rewrite the README's "No secrets through the dashboard" note and add a **secrets in transit** section to the threat model.

Out of scope: custom profile generation, Codex login, default model selection, detaching or deleting providers, and use off loopback.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `dashboard`: ADDED "Provider setup wizard" and "Provider credentials in transit".

## Impact

- `dashboard/src/projects.ts`:
  - argv gate shapes `providers --json` and `provider setup …`;
  - a stdin-writing runner variant;
  - a `ProviderService`, or functions on the existing service.
- `dashboard/src/server.ts`: `GET /api/providers` and `POST /api/providers/setup`, plus body size and content-type checks and the loopback-only gate.
- Frontend:
  - new `src/app/setup.js` and `src/app/providers.js`;
  - Setup tab wiring in `main.js`, `state.js`, and `page.ts`;
  - the Configure link in `detail.js`.
- Tests:
  - `dashboard/test/stub/osa` gains `providers` and `provider setup`; the stub records the stdin length, never the value, and prints a mode that echoes the secret to test redaction;
  - server tests;
  - one browser journey.
- `dashboard/README.md`: API table, security notes, and threat model.
- Depends on `add-provider-setup-noninteractive`.
- Security: the browser sends the credential to `127.0.0.1` in one same-origin `fetch` body. It leaves the dashboard only on an `osa` stdin pipe. No new bind mounts, `--env` values, or egress.
