# Design

## Context

- A project is a registry entry (`projects/<sandbox>.toml`) plus a session directory (`sessions/<sandbox>/`), and usually a sandbox on the gateway.
- `cmd_rm` in `lib/oss-core.sh` is the only code that clears all three. It runs in the project folder, refuses when `sandbox_phase` finds no sandbox, prompts or requires `--yes`, refuses a parked workspace without `--discard`, then deletes the sandbox, archives the session directory (`archive_state_dir`), and removes the entry (`registry_remove`).
- `osa resolve` shows the pattern for an `osa` write. It looks up the entry by file name (`entry_file`), refuses unregistered names and orphans, then `cd`s into the project folder and runs the owning front-end's internal `__resolve` with `--name`. The front-end checks that the entry belongs to `project_path`, takes the resolve lock (`resolve_lock_take`), and reports through `resolve_finish`: one JSON object on fd 3, exit codes 0/1/2/3.
- The dashboard reaches `osa resolve` through `POST /api/projects/:sandbox/resolve`. The handler is in `server.ts` and calls `ProjectStore.resolve`, which keeps a per-sandbox `resolving` set. The stub `osa` in `dashboard/test/stub/osa` answers from a fixture.
- Gateway settings (`gateway`, used by `os()`) come from the front-end's configuration, so only a front-end can make the delete call.

## Goals / Non-Goals

**Goals:**
- One command, `osa remove SANDBOX --yes`, that leaves no registry entry for a project, whatever state its sandbox and folder are in, as long as nothing is pending.
- The dashboard reaches it the same way it reaches `osa resolve`: token, read-only guard, one argv, a per-sandbox 409.

**Non-Goals:**
- Changing `maki-oss rm` and the other front-ends' `rm`, or the inventory's sandbox Delete.
- Removing a project that has pending work. Resolve first.
- Deleting archives. Archives stay as `sessions/<sandbox>.archive-*`, as after `rm`.

## Decisions

### D1. `osa remove` delegates to a front-end `__remove` verb

`bin/osa` gets `cmd_remove`, which parses `remove SANDBOX [--yes] [--json]` and mirrors `cmd_resolve`:
1. It finds the entry with `entry_file` and loads it.
2. It refuses (exit 2) when the name is unregistered, the agent is unknown, or `--yes` is missing.
3. It runs `"$front" --name SANDBOX __remove --yes [--json]`.

Its JSON refusals use `resolve_refuse` with `action` set to `remove`.

The front-end runs the command, because only it knows the gateway setting (`os()`). It also already owns `archive_state_dir`, the locks, and `pending_kind`. *Alternative:* `osa` calls `openshell sandbox delete` itself. Rejected, because it would ignore a front-end's `gateway` setting and would duplicate the archive and lock code in `bin/osa`.

### D2. Orphans run outside the project folder

`__resolve` checks the entry's `host_path` against `project_path` (`pwd -P`), and an orphan has no folder to `cd` into.
- **Normal entry:** `osa` runs `__remove` in the project folder, as resolve does, so project-local configuration applies.
- **Orphan:** `osa` runs it from `$state_root` and passes `--orphan`. With `--orphan`, `__remove` skips the owner check. Instead it requires that the entry exist and that its `host_path` not exist, and it reads nothing from the current folder.

*Alternative:* always skip the owner check. Rejected, because the owner check is what keeps one folder's front-end from acting on another folder's sandbox.

### D3. Order of operations in `__remove`

Each step either refuses or fails before the next one changes anything:
1. Check the owner, as in D2.
2. `resolve_lock_take`. A live session or resolve gives exit 2.
3. `pending_kind`. When it is `retained` or `parked`, exit 2 with a message naming the matching `osa resolve` actions. The message text reuses the resolve messages.
4. List the gateway. `os sandbox list --output json` failing gives exit 3, and nothing local changes. `sandbox_phase` cannot be used as is, because it calls `die_gateway`, which would skip `resolve_finish`. Add a non-dying variant, or wrap it in a subshell and check its status.
5. When the gateway lists the sandbox, run `os sandbox delete NAME`. Failure gives exit 3, and nothing local changes.
6. Archive with `archive_state_dir "$state" "project removed"`. It moves `locks/` back into a fresh empty directory, so after the lock is released (the existing exit hook), `__remove` removes that leftover empty `sessions/<sandbox>/locks` and `sessions/<sandbox>/` with `rmdir`. A leftover non-empty directory is a warning, not a failure.
7. `registry_remove`.
8. `resolve_finish 0`, with `changed` listing `gateway:NAME` (when deleted), the archive path, and the registry file.

The gateway delete comes before any local change. A failure therefore leaves a project that is still fully registered, never a sandbox with no entry. Local cleanup after a successful delete cannot fail in a way the user cannot redo: a second `osa remove` sees "not on gateway" and finishes the cleanup.

### D4. Pending work is refused, not `--discard`ed

`rm --discard` exists, but `osa remove` gets no override flag. A retained patch or parked workspace holds host-relevant work, and the dashboard already has one-click resolve actions next to the row. This is the user's chosen behavior. It keeps `osa remove` from ever losing uncollected output.

### D5. Dashboard route and UI

- **Argv** (`projects.ts`): `removeArgv(sandbox)` returns `["remove", sandbox, "--yes", "--json"]`.
- **Store** (`ProjectStore.remove(sandbox)`):
  - reuses the registry lookup the resolve path uses (an unregistered name gets 404);
  - shares the `resolving` set, so that a resolve and a remove on one sandbox exclude each other (409);
  - maps exit codes as resolve does (0 → 200, 2 → 409, 3 or unparsable → 502), with a 60 s timeout.
- **Route** (`server.ts`): `POST /api/projects/:sandbox/remove`, with no body. It is guarded by `guardMutation` (token and read-only). Any other method gets 405.
- **UI** (`app/projects.js`): a **Remove…** toggle in each row's actions cell opens a typed-name confirmation row, using the same pattern as Drop and Discard.
  - The confirmation text depends on the inventory join already computed for the "not on gateway" note: "Deletes sandbox X on the gateway and forgets this project" or "Forgets this project (its sandbox is not on the gateway)".
  - The toggle is disabled with a title and inline reason when the row has a `retained` or `parked` badge, or when the row is `busy`.
  - On success: show the notice, then call `loadProjects()` and `loadInventory()` at once.
  - On refusal or failure: keep the row and show the outcome inline, as resolve does.

### D6. Spec wording for the osa invariant

The "osa entry point" requirement changes from "No `osa` command MUST create, stop, or delete a sandbox" to "only `osa remove` MAY delete a sandbox". `test_osa_read_only` and `test_osa_dashboard_writes_nothing` keep checking that the read commands make no delete call. They do not run `remove`.

## Risks / Trade-offs

- **[A sandbox recreated under the same name by another folder]** → The owner check (D2) uses the registry entry, so only that entry's owner can remove it. The gateway delete is by name, the same as `rm`.
- **[The dashboard's pending or busy state is up to 60 s old]** → The server does not rely on it. `__remove` re-checks the marker and the lock, and the UI shows a refusal as "nothing changed".
- **[Removing a project whose sandbox exists deletes the sandbox's workspace]** → Only when nothing is pending, which is the same condition under which `rm` deletes without `--discard`. The typed name and the explicit "deletes sandbox on the gateway" text make the consequence visible.
- **[The orphan path runs a front-end outside its project]** → `--orphan` is accepted only when the entry's folder really is missing, and `__remove` reads no project files.
