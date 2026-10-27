# Proposal

## Why

The only way to start the dashboard today is `cd <repo>/dashboard && bun run start`. That works for someone working on the repository, not for someone using it. They must know where the checkout is, that Bun runs it, and which `osa` the dashboard will spawn. Everything else a user touches, including `osa`, the front-ends, and the fish plugin, is a command on `PATH`. With M4 the dashboard is where setup, resolve, egress, and health all happen, so starting it should take one command from any folder.

## What Changes

- Add **`osa dashboard [--port N] [--host ADDR] [--token T] [--read-only] [--open]`**. It runs the repository's dashboard with Bun in the foreground; Ctrl-C stops it. It does not start a daemon, write a PID file, or run in the background.
  - It finds the dashboard next to `osa` (`<repo>/dashboard/src/main.ts`) and sets `DASHBOARD_OSA_BIN` to this `osa`. The UI and the CLI therefore always use the same copy of `osa`.
  - It checks that Bun is installed and is at least the supported version. If not, it prints the install link and exits with a dependency error before anything starts.
  - It passes only the listed flags through, unchanged. The dashboard's own parser stays the single place that validates them, and the `DASHBOARD_*` environment variables keep working.
- Add **`--open`** to the dashboard. Once the server is listening, it opens the page in the default browser (`open` on macOS, `xdg-open` elsewhere).
  - The URL it opens never contains the token. On a non-loopback bind `--open` opens nothing, and the server says how to open the page with the token.
  - When no opener is available, it prints the URL and keeps serving.
- Update the `osa entry point` requirement with `dashboard`. The command itself changes nothing. The server it starts can make only the changes the dashboard spec already allows, and only through `osa`.
- Update the docs:
  - The dashboard README's Quick start and the top-level README lead with `osa dashboard`.
  - `bun run start` stays documented for development.
  - `fish/completions/osa.fish` gains the command and its flags.

Out of scope:

- running the dashboard as a background service (launchd or systemd units);
- installing Bun;
- a packaged or relocatable dashboard outside the checkout;
- TLS.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `osa-project-layer`: MODIFIED "osa entry point" (adds `dashboard`). ADDED "osa dashboard starts the web UI".
- `dashboard`: ADDED "Open in the browser on start".

## Impact

- `bin/osa`: `dashboard` parsing, the Bun check, and `exec bun run <repo>/dashboard/src/main.ts` with `DASHBOARD_OSA_BIN` set; `usage()`.
- `dashboard/src/main.ts`: the `--open` flag, the opener, and usage text.
- `fish/completions/osa.fish`, `dashboard/README.md`, `README.md`, `docs/helper.md`.
- Tests:
  - `tests/run-tests.sh` with a stub `bun` that records argv and environment;
  - `dashboard/test` for `--open` parsing and opener selection, with an injected opener so no browser starts.
- Security: the default bind stays loopback, and the token is never placed in an opener's argv. No new routes, bind mounts, or secret paths.
- Spec order: this delta's "osa entry point" text builds on `add-provider-setup-noninteractive` and `dashboard-image-build`, which are still pending. Archive them first (design D5).
