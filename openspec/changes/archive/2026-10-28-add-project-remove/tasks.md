# Tasks

## 1. Front-end `__remove` verb (`lib/oss-core.sh`)

- [x] 1.1 Add a non-dying gateway listing helper, or wrap `sandbox_phase` in a subshell, so that `__remove` can tell three outcomes apart: the sandbox is listed, it is not listed, or the gateway cannot be listed (design D3 step 4). Verify with a `tests/run-tests.sh` case that uses the `openshell` stub: a failing list gives exit 3, and `resolve_finish` still prints its JSON.
- [x] 1.2 Implement `cmd_remove` and dispatch `__remove` next to `__resolve`. It needs the owner check, the `--orphan` path (D2), `resolve_lock_take`, the pending refusal that reuses the resolve messages (D4), the gateway delete, `archive_state_dir "…" "project removed"`, `registry_remove`, and `resolve_finish` with `action` `remove` and the `changed` list (D3). Verify with the shell tests in 3.1.
- [x] 1.3 Extend `resolve_exit_hook`, or add a remove-specific hook, so that after the lock is released, `__remove` removes the empty `sessions/<sandbox>/locks` and `sessions/<sandbox>/` it left behind, and only warns when either is not empty. Verify in 3.1 that only `sessions/<sandbox>.archive-*` remains.

## 2. `osa remove` (`bin/osa`)

- [x] 2.1 Add `remove` to the usage text, the command list in the unknown-command error, and argument parsing (`SANDBOX`, `--yes`, `--json`). Verify that `osa help` lists `remove SANDBOX --yes` and that `osa up`'s error names `remove`.
- [x] 2.2 Implement `cmd_remove`:
  - refuse an unregistered name, an unknown agent, a name mismatch, or a missing `--yes` with exit 2 through `resolve_refuse`, with `action` `remove`;
  - run the front-end in the project folder, or from `$state_root` with `--orphan` for an orphan.

  Verify with the shell tests in 3.1.

## 3. Shell tests (`tests/run-tests.sh`)

- [x] 3.1 Add `test_osa_remove`, using the `openshell` stub, with these cases:
  - sandbox listed: one `sandbox delete` is recorded, the entry is gone, the archive exists, and `changed` has three items;
  - sandbox not listed: no delete call, and the entry is gone;
  - orphan;
  - retained pending: exit 2, the message names `apply`/`branch`/`drop --yes`, and no gateway call;
  - parked pending: exit 2;
  - missing `--yes`: exit 2;
  - unregistered name: exit 2;
  - gateway list failure: exit 3, and the entry and session directory are unchanged;
  - delete failure: exit 3, and the same are unchanged;
  - a live session lock: exit 2, and no gateway call.

  Verify that `make test` passes.
- [x] 3.2 Update the existing usage assertions (`test_osa_usage`, the resolve dispatch case's command list), and confirm that `test_osa_read_only` and `test_osa_dashboard_writes_nothing` still run no `remove`. Verify that `make test` passes.

## 4. Dashboard server (`dashboard/src`)

- [x] 4.1 In `projects.ts`, add `removeArgv(sandbox)` and `ProjectStore.remove(sandbox)`. It looks up the entry (404 when unregistered), shares the `resolving` set (409), runs with a 60 s timeout, drops the host-change cache, and maps exit codes as `resolve` does. Verify with new `test/projects.test.ts` cases: the argv is exactly `remove <sandbox> --yes --json`, an unregistered name returns 404, a running resolve returns 409, and exits 0/2/3 map to 200/409/502.
- [x] 4.2 In `server.ts`, add `POST /api/projects/:sandbox/remove` behind `guardMutation`. Other methods get 405. Update the header comment that calls resolve "the only project write". Verify with `test/server.test.ts` cases: a missing token gets 403, read-only mode gets 403, GET gets 405, and a valid POST runs one stub `osa remove`.
- [x] 4.3 Teach `test/stub/osa` a `remove SANDBOX --yes --json` answer, read from a fixture `remove` key, with a default refusal. Verify that `cd dashboard && bun test` passes.

## 5. Dashboard UI (`dashboard/src/app/projects.js`)

- [x] 5.1 Add the per-row **Remove…** toggle and its typed-name confirmation row:
  - the confirmation text depends on whether the sandbox is on the gateway;
  - the toggle is disabled, with the reason shown, for `retained`, `parked`, or `busy` rows;
  - the toggle is hidden in read-only mode;
  - on success, reload the projects and the inventory at once; on refusal or failure, show the outcome inline.

  Verify with a `scripts/browser-check.ts` journey that removes a "not on gateway" row from the state fixture and sees it disappear, checks that Remove is disabled on a `retained` row, and checks that no request is sent before the name is typed.

## 6. Documentation

- [x] 6.1 Update `docs/helper.md`:
  - add an `### osa remove` section (usage, order of operations, refusals, exit codes, JSON);
  - update the `## osa` overview sentence about which commands change anything and which may delete a sandbox;
  - mention `osa remove` under "Shared state and the project registry" as the way to clear an orphan.

  Verify with `make lint-docs`.
- [x] 6.2 Update `dashboard/README.md`:
  - add the remove route row to the API table;
  - describe the Remove action in the Projects section;
  - update the threat-model sentence that lists the `osa` commands the dashboard runs.

  Verify with `make lint-docs`.

## 7. End-to-end check

- [x] 7.1 On a real gateway:
  - remove the leftover `cc-osa-cb62` row from the dashboard; it should disappear, with `~/.local/state/osa/sessions/cc-osa-cb62.archive-*` present;
  - create a scratch sandbox with `claude-oss up` in a temporary folder, and remove it from the dashboard; it should be gone from `openshell sandbox list` and from `osa projects`.

  Record both results in `docs/verification-log.md`.
