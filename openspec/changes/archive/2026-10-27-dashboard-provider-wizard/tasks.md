# Tasks

## 1. Server

- [x] 1.1 Extend `dashboard/test/stub/osa` with `providers --json` fixtures (stdin agent, login agent, custom profile, gateway error, markup in a note) and `provider setup` modes: created, updated, refused (2), failed after create (3), slow (timeout), and echo-secret. The stub records argv and the stdin byte count, never the value. Verify with a stub self-test.
- [x] 1.2 Add the two argv shapes to `isAllowedOsaArgv` and `runWithStdin` to `OsaRunner` (design D1, D3). Verify with unit tests for the accepted shapes and for rejected ones: extra flag, bad id, `--yes` in the wrong place, `providers` without `--json`. Also verify that `run` refuses the setup shape and `runWithStdin` refuses every other shape.
- [x] 1.3 Add `GET /api/providers`, and `POST /api/providers/setup` with the guard order, redaction, and outcome mapping (design D2–D4). Verify with server tests:
  - loopback-only 403 before the body is read, using a request body stream that fails if read;
  - read-only 403, missing token 403, 415, 413 for both a large `Content-Length` and a large chunked body, and 400 per field;
  - 409 while one setup runs;
  - each exit code's mapping;
  - redaction of the echo-secret mode;
  - the fixture credential appearing in no response, recorded argv, or captured server output.

## 2. Frontend

- [x] 2.1 Add the Setup tab (creating it if `dashboard-image-build` has not), plus `src/app/providers.js` and `src/app/setup.js` (design D5). Serve the new modules through the allowlist. Verify that `bun test` still passes the no-HTML-sink test with the new modules included.
- [x] 2.2 Add the Configure link in `detail.js` for a registered sandbox with no attached providers. Verify it in the browser journey (3.1).

## 3. Journey and docs

- [x] 3.1 Add one provider journey to `scripts/browser-check.ts`:
  - create with attach shows the outcome, and the provider list refreshes with no further page action;
  - the credential input is empty afterwards, and `localStorage`/`sessionStorage` hold no value equal to the fixture;
  - a taken name keeps submit disabled until Replace is checked;
  - the Codex card shows the command and no credential field;
  - the markup note renders as text;
  - in read-only mode the wizard is absent.

  Verify with `bun run scripts/browser-check.ts` passing.
- [x] 3.2 Update `dashboard/README.md` (API table, security notes, threat model) per design D6. Verify with `make lint-docs` passing.
- [x] 3.3 Run `cd dashboard && bun test`, the browser check, and `openspec validate dashboard-provider-wizard --strict`. Then, on this host with `add-provider-setup-noninteractive` applied, set up a real provider from the browser, attach it, start a session that uses it, and record the result in `docs/verification-log.md`. Verify that everything passes and the log entry exists.
