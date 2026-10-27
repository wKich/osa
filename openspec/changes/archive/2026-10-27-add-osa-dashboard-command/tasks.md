# Tasks

## 1. osa

- [x] 1.1 Add `osa dashboard` to `bin/osa`: argument parsing, the dashboard path check, the Bun presence and version check, and `exec` with `DASHBOARD_OSA_BIN` set (design D1, D2). Exit 2 for a missing dependency, as the front-ends' `EX_DEP`. Verify with `tests/run-tests.sh` cases using a stub `bun` on `PATH` that records argv and `DASHBOARD_OSA_BIN`. The cases cover:
  - no flags;
  - all five flags in both `--x V` and `--x=V` forms, passed through in order;
  - `--daemon` (exit 1, stub not run);
  - `--port` with no value (exit 1);
  - no `bun` (exit 2, message names the minimum and the install link);
  - stub version `1.1.30` (refused) and `1.2.0` (runs);
  - an unparseable version (warns, runs);
  - an inherited `DASHBOARD_OSA_BIN` (overridden);
  - running from `/` (same result).
- [x] 1.2 Add a test that `osa dashboard` writes nothing under `$XDG_STATE_HOME` and makes no `openshell` call (stub log empty). Verify with `make test`.
- [x] 1.3 Update `usage()`, the unknown-command list, and `fish/completions/osa.fish`. Verify the usage-error test lists `dashboard`, and verify `make lint` passes.

## 2. Dashboard `--open`

- [x] 2.1 Add `open` to `parseCliArgs` and the usage text, plus an injectable `openBrowser` called after listen (design D3). Verify with `dashboard/test` cases:
  - the flag parses;
  - on loopback the opener receives `http://127.0.0.1:<port>/` with no query;
  - on `0.0.0.0` with a token no opener runs and the output mentions `?token=`;
  - a throwing opener prints the URL and the server still answers `GET /`;
  - without `--open` no opener is called.

## 3. Docs and verification

- [x] 3.1 Update `dashboard/README.md` (Quick start, Scripts, and the env table note for `DASHBOARD_OSA_BIN`), `README.md`, and `docs/helper.md` (design D4). Verify with `make lint-docs` passing.
- [x] 3.2 Run `make test`, `cd dashboard && bun test`, and `openspec validate add-osa-dashboard-command --strict`. On this host, run `osa dashboard --open` from `$HOME` and confirm that the browser opens the Projects view, that resolve and status use `<repo>/bin/osa`, and that Ctrl-C leaves no `bun` process. Record the result in `docs/verification-log.md`. Verify that everything passes and the log entry exists.
