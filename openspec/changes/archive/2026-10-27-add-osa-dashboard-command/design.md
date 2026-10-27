# Design

## Context

`bin/osa` resolves its real location (`script_dir`, `repo_root`) whether it is run by path or found on `PATH`, so `<repo>/dashboard/src/main.ts` can always be found from it. The dashboard is Bun and TypeScript with no npm dependencies and no build step. `bun run src/main.ts` is the whole start procedure, and `bun install` resolves nothing. `main.ts` parses `--port`, `--host`, `--token`, and `--read-only`, plus the `DASHBOARD_*` environment variables, and prints `OpenShell dashboard listening on http://HOST:PORT`. It finds `osa` through `DASHBOARD_OSA_BIN`, else the repository's own `bin/osa`, else `osa` on `PATH`. The README asks for Bun ≥ 1.2. The dashboard spec says "no daemon".

## Goals / Non-Goals

**Goals:**

- One command from any folder starts the dashboard against the same checkout as the `osa` the user ran.
- Clear failure when Bun is missing or too old.
- Optional browser launch that never leaks the token.

**Non-Goals:**

- Background service management.
- Installing Bun.
- Moving the dashboard out of the checkout.
- TLS.
- Changing any dashboard route.

## Decisions

### D1: `osa dashboard` is an `exec` wrapper

`bin/osa` handles `dashboard` before any registry work:

1. **Parse the arguments.** Accept `--port V`, `--port=V`, `--host V`, `--host=V`, `--token V`, `--token=V`, `--read-only`, `--open`, and `-h`/`--help`. The help flag prints `osa`'s dashboard usage. Anything else is a usage error.
   - The arguments are kept as given, so the dashboard's parser validates the values.
   - `osa` only checks that a value-taking flag has a value. This keeps the error close to the user's command.
2. **Check that the dashboard exists.** `main=$repo_root/dashboard/src/main.ts` must exist, else the command dies with "dashboard not found at <path>".
3. **Check Bun.** `command -v bun`, then compare `bun --version` against `OSA_BUN_MIN=1.2.0` as numeric major.minor.patch. A pre-release suffix is ignored.
4. **Start it.** `DASHBOARD_OSA_BIN=$script_dir/osa exec bun run "$main" "$@"`.

The `exec` means Ctrl-C, the exit status, and process managers all see Bun directly, with no shell left in between.

Exit codes: 1 for a usage error, and 2 for a missing dependency, which is the front-ends' `EX_DEP` (`lib/oss-core.sh`). The codes are per command, so this 2 does not clash with `resolve`'s 2 (refused).

Alternatives:
- **A separate `bin/osa-dashboard` script:** one more thing to put on `PATH`. Rejected.
- **Spawning Bun as a child and forwarding signals:** more code and no benefit over `exec`.

### D2: `DASHBOARD_OSA_BIN` is always overridden

An inherited `DASHBOARD_OSA_BIN` could point the UI at a different checkout than the CLI the user just ran. `osa dashboard` therefore always sets it to its own path, and the test suite's stub `osa` is set by running the dashboard directly. The other `DASHBOARD_*` settings pass through, because they are user preferences, not identity.

### D3: `--open` lives in the dashboard, not in `osa`

Only the dashboard knows when it is listening and on which address. The bound port may also differ from the requested one, since `--port 0` lets the system pick.

- **Flag and opener.** `parseCliArgs` gains `open: boolean`. After `createDashboardServer` returns, `main.ts` calls `openBrowser(url)`:
  - on `process.platform === "darwin"` it runs `open`;
  - otherwise it runs `xdg-open` when that is on `PATH`;
  - in either case it uses `Bun.spawn` with an argv array, ignores the opener's output, and never waits on it in a way that blocks serving.
- **URL.** The opened URL is `http://<displayHost>:<port>/`.
  - On a loopback bind the page embeds the token itself, so the URL needs none.
  - On a non-loopback bind nothing is opened. The opener argv would otherwise carry `?token=`, which is visible in the process list.
- **Failure.** A failed spawn or a non-zero exit prints `could not open a browser; open <url>` and the server keeps running.
- **Testing.** The opener is injectable for tests.

`bun run start --open` works too, so developers get the same flag.

### D4: Docs lead with `osa dashboard`

- **Dashboard README, "Quick start":** becomes `osa dashboard` (with `bin/osa dashboard` from a checkout not on `PATH`). The `cd dashboard && bun run start` form moves to the "Scripts" section for development.
- **Top-level README:** the dashboard bullet names the command.
- **`docs/helper.md`:** documents the command and its exit codes.
- **`fish/completions/osa.fish`:** completes `dashboard` and its five flags.

### D5: Spec ordering

The MODIFIED "osa entry point" here builds on the text from `add-provider-setup-noninteractive` and `dashboard-image-build`. Those are pending and, judging by the working tree, being implemented. Archive this change after both. If it lands first, rebase its command list so that commands that have not landed are not listed.

## Risks / Trade-offs

- **[A Bun version check can be wrong for odd version strings]** Mitigation: parse only `^[0-9]+\.[0-9]+(\.[0-9]+)?`. An unparseable version warns and continues instead of refusing.
- **[`xdg-open` on a headless host]** It fails or does nothing, and the URL is printed either way, so the user is never left without it.
- **[An inherited `DASHBOARD_OSA_BIN` is ignored]** This is intentional. It is documented in the env table as "set by `osa dashboard`".

## Migration Plan

Additive. `bun run start` keeps working unchanged.

## Open Questions

None.
