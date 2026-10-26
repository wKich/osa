# Design

## Context

See `proposal.md` - Why. Today `lib/oss-core.sh` (about 4.3k lines) is the shared core under two front-ends, `bin/maki-oss` and `bin/opencode-oss`. Each front-end picks its own config and state names. Session state is `key=value` files under `$XDG_STATE_HOME/<tool>/sessions/<sandbox>/` (`baseline`, `synced`, `pending`, patch files). `baseline` records `workdir=`, but that is the path inside the sandbox, not on the host. `maki-oss status` computes the sync state by hashing the current directory's tree (`capture_host_baseline`), which is too expensive to poll for many projects. Default names come from the `helper-cli` requirement "Sandbox names fit the gateway": `{project}` is the cleaned folder name, and only when the name would exceed OpenShell's 19-character limit is the project part shortened and suffixed with a 4-character hash of the project name. D4 changes this so the hash is always added and is computed from the host path.

The dashboard (`dashboard/`, Bun + TypeScript, no build step) shells out to `openshell` with argv arrays for inventory, lifecycle, logs, policy, and rule proposals. It knows nothing about projects or sync.

## Vision and roadmap

This section records the trajectory this change starts. Later changes link back here instead of restating it.

### Layering

```
   maki-oss        opencode-oss       (thin: "run agent X here")
       \               /
        v             v
     osa / project layer  (agent-neutral: one state root, registry keyed
                           by (host_path, agent), sync, providers, idle stop)
        |        ^
        |        |  --json  (writes, and on-demand status)
        |        |
        |     dashboard ---- reads state files directly (badges, poll)
        |        |
        v        v
        openshell  (primitives: lifecycle, logs, policy, rules)
```

- **OpenShell primitives** (lifecycle, logs, policy, proposals): clients call `openshell` directly. No wrapper tool is added for them.
- **Project and sync behavior**: the project layer is the only implementation. Clients never reimplement sync rules.
- **Agent front-ends**: carry only what is agent-specific (image, launch command, agent config).

### Decided so far

- The dashboard evolves into a **project-centric workbench**, with the old sandbox list kept as an "All sandboxes" view.
- The dashboard **may cause host file writes** (applying or discarding patches), but only through the project layer's commands and their safety checks, and only for registered project paths. Its threat model is rewritten when that lands.
- The dashboard calls **`openshell` directly** for primitives, and the **project layer's `--json` commands** for project and sync actions.
- The dashboard **reads the versioned state files directly** for list badges and polling, and never writes them.
- **No web terminal** (xterm.js is dropped). Interactive Maki or OpenCode sessions stay in the user's terminal; the dashboard offers copyable commands instead.
- No policy YAML editor, multi-gateway support, remote/TLS serving, or multi-user auth on the roadmap.

### Milestones

```
 [done] disposable-sandbox-sync
        |
        v
 M0 Project layer (this change) --> M1 Projects view --> M2 Resolve
        |
        +--> M3 Egress & health           M4 Setup (providers, images)

 M0  osa contract      helper only, no UI         groundwork
 M1  Projects view     UI only, read-only         first visible web UI
 M2  Resolve           helper command + UI        first host writes
 M3  Egress & health   UI only
 M4  Setup             helper (stdin secrets) + UI wizard
 --  later             full `osa` runner; rename env prefixes, config, repo
```

M0 unifies state and publishes the contract the dashboard stands on. It is not a rename: only the state root moves and `osa` is added. From M1 on every milestone is web UI work, and a milestone adds a helper command only where the UI would otherwise have to reimplement project logic.

| # | Milestone | What the user gets | Changes |
|---|---|---|---|
| M0 | Project layer | `osa` entry point, one state root, a registry, hashed sandbox names, a TOML state contract, a host fingerprint, `--json` status/list across both agents | this change |
| M1 | Projects view (read-only) | Project list with sync badges, attention counter, read-only patch diff viewer. `app.js` split into ES modules. Dashboard spec Purpose updated | `dashboard-project-view` |
| M2 | Resolve from the browser | Parked workspaces resolved via the existing `download` / `upload --discard` / `rm --discard`. Retained patches applied, branched, or dropped via a new project-layer command using the exit-sync safety checks. Threat model rewritten for host writes | `add-sync-resolve-commands`, `dashboard-sync-actions` |
| M3 | Egress & health | OCSF denials from logs shown next to the matching pending proposal. Idle-stop countdown, MCP status, doctor panel | `dashboard-egress`, `dashboard-health` |
| M4 | Setup | Provider setup wizard: the secret goes to the project layer on stdin, never argv, logs, or API responses. Environment image builds with a streamed log | `add-provider-setup-noninteractive`, `dashboard-provider-wizard`, `dashboard-image-build` |
| later | Unify and rename | `osa --agent <tag>` runs sessions, the front-ends become wrappers or aliases, and env prefixes, config directories, and the repository take the `osa` name | not yet named |

Cross-cutting: every milestone extends the offline stubs and adds one `browser-check.ts` journey. The README threat model is updated by M2 (host writes) and M4 (secrets in transit), each in its own change.

## Goals / Non-Goals

**Goals:**

- Every agent front-end writes to one state root, so one client sees every project.
- Given a sandbox, a client can find its host project path and agent, and the other way round.
- Two git worktrees or two same-named folders never share a sandbox by default.
- A client can show "changed since last sync" for N projects with one cheap spawn each, without N tree hashes.
- This host's existing retained patches and parked markers survive the move.

**Non-Goals:**

- Any dashboard UI (M1 and later).
- New sync resolution commands (M2).
- Wrapping more `openshell` primitives.
- Concurrent sessions on one sandbox.
- An `osa` session runner (`osa --agent maki`). The front-ends keep running agents in M0.
- Renaming env prefixes (`MAKI_OSS_*`, `OPENCODE_OSS_*`), config directories, or the repository.
- Proving `clean` from the read path. Only the full `status` classifies `clean` vs `behind`.
- Migration code or a compatibility read of the old state roots.

## Decisions

### D1: `osa` is the agent-neutral entry point, read-only in M0

`bin/osa` sources `lib/oss-core.sh` and offers `osa projects [--json]` and `osa status [PATH] [--json] [--quick]` across every registered agent. `osa status PATH` reports one entry per agent registered for that path, and an empty list when the path is not registered. It sets no agent, so it never creates, runs, or syncs anything. Full `osa status` asks the owning front-end for its status (an internal `__status-json` command), which may run the same read-only workspace probe `status` already runs, so both report the same classification. `osa projects` and `--quick` read only the state files and the host fingerprint, never the gateway. The contract helpers live in `lib/osa-state.sh`, so `bin/osa` loads them without the agent core. `maki-oss` and `opencode-oss` keep every command they have today.

Alternatives: a full runner (`osa --agent maki ...`) with the front-ends turned into wrappers. It is the likely end state, but it widens M0 into a CLI redesign that the dashboard does not need yet. Deferred.

### D2: One state root, per-agent config

State lives under `$XDG_STATE_HOME/osa/`: `projects/<sandbox_name>.toml` for the registry and `sessions/<sandbox>/` for sync state, as today. Sessions stay keyed by sandbox name, which already carries the agent. Config (`$XDG_CONFIG_HOME/maki-oss/config.toml`, `opencode-oss/config.toml`), custom profiles, remembered providers, and the model stay per agent and do not move in M0.

Alternatives: a merged config with per-agent sections. It would need a new config shape and loses nothing by waiting for the rename. Rejected for M0.

### D3: Registry keyed by `(host_path, agent)`

One flat TOML file per entry, `projects/<sandbox_name>.toml` (for example `projects/mk-maki-oss-3f2a.toml`). Sandbox names are unique on the gateway, and D4's refusal rule binds each name to one host path, so file names cannot collide even when two paths share a 4-character hash. `(host_path, agent)` stays the logical key; readers find an entry by scanning the directory, which holds one small file per project. Fields: `version`, `agent`, `host_path` (absolute, resolved), `project`, `sandbox_name`, `sandbox_id`, `created`, `last_session`, `fingerprint` (absent when the folder is not a git repository). Fields that are known from the start are written on create; `sandbox_id`, `last_session`, and the fingerprint are written on each session. `rm` removes the entry together with the archived session state. If `host_path` no longer exists, readers report the entry as an orphan. M0 adds no automatic pruning.

Alternatives: one shared registry file. Rejected because two sessions would rewrite the same file, and the flat-file parser cannot read tables.

### D4: Default sandbox name is `<tag>-<project>-<hash>`, at most 19 characters

OpenShell limits sandbox names to 19 characters.

- `<tag>` is a 2-letter agent tag set by the front-end: `mk` for Maki, `oc` for OpenCode.
- `<project>` is the repository name from `git remote get-url origin` (the last path segment, with `.git` dropped), falling back to the folder name. It is cleaned with the existing character rule, then cut to 11 characters with any trailing `-` removed.
- `<hash>` is the first 4 hex characters of a hash of the absolute host path, so each git worktree of one repository gets its own sandbox. Uniqueness comes from the hash, not the truncated project name. The registry keeps the full project name and path for display.
- The defaults are templates, `mk-{project}-{hash}` and `oc-{project}-{hash}` (OpenCode already uses `oc`; Maki moves from `maki-` to `mk-`). `{hash}` is a new placeholder computed with the existing `cksum`-based 4-hex hash (`lib/oss-core.sh:299`), applied to the absolute physical path. The existing fitting code shortens `{project}` to the remaining budget, which is 11 characters for the defaults.
- Example: this repository (`origin` is `git@github.com:wKich/maki-oss.git`) with Maki becomes `mk-maki-oss-` plus 4 hex characters.
- An explicit `--name`, `<PREFIX>_SANDBOX_NAME` (`MAKI_OSS_`, `OPENCODE_OSS_`), or `sandbox_name` in config still wins. A user template keeps today's behavior: `{project}` is the full cleaned project name, and a template without `{hash}` that is too long gets today's project-name hash suffix. A name that breaks the character rules stays a usage error before any gateway call.
- Once a project is registered, its recorded `sandbox_name` wins over the default. That keeps existing sandboxes on their names and keeps a project on its sandbox if its remote changes.
- Creating a sandbox whose name is already registered to a different `host_path` fails and suggests `--name`.

Alternatives: the folder name alone (today's behavior) shares a sandbox and its sync state across worktrees and same-named folders. Rejected.

### D5: Flat TOML is the published state contract

The contract files are `projects/<sandbox_name>.toml` and `sessions/<sandbox>/pending`, now written as flat TOML with `version = "1"` (a quoted string, because the flat parser accepts only quoted values). They use only `key = "value"` lines, so the shell reads them with `parse_config_file`, generalized from its hard-coded config key set (`lib/oss-core.sh:69`) to a key allowlist per file, and writes them with the existing atomic line writer, and the dashboard reads them with `Bun.TOML.parse` and no npm dependency. `baseline`, `synced`, patches, and archives stay internal, and their format may change without a version bump.

Alternatives: JSON is easier for TypeScript but needs a hand-written JSON writer in POSIX sh, and escaping paths is easy to get wrong. Keeping `key=value` would leave clients with a custom parser. Both rejected.

### D6: Cheap host fingerprint, recorded at sync

At each successful sync point (the first upload on create, refresh, clean apply) the session records `fingerprint` in the registry entry: git `HEAD` plus a hash of `git status --porcelain` output. It covers commits, staged and unstaged edits, and untracked files that git does not ignore. A folder that is not a git repository records no fingerprint. `osa status --json --quick` computes the current fingerprint and reports `changed`, `unchanged`, or `unknown` without hashing the tree. The full `status` keeps the existing classification.

Alternatives: `HEAD` plus index mtime misses unstaged edits. Having the dashboard compute the fingerprint itself would duplicate project logic outside the layer. Both rejected.

### D7: JSON is an output format, not a storage format

`--json` output is emitted by the shell from already-resolved values, using the same escaping rules the TOML writer uses. Files on disk stay TOML. Clients read the files for polling and call `osa ... --json` for authoritative or computed values.

## Risks / Trade-offs

- [Published state files become a public contract that blocks internal refactors] → Version the format, keep the contract to two files, and test it.
- [Hand migration misses a retained patch] → The migration task lists every session directory before and after and checks each `pending` patch path, and the old roots stay in place until the check passes.
- [The registry goes stale when folders move or are deleted] → Readers report orphans instead of failing. Pruning is deferred to a later explicit command.
- [The fingerprint costs more than expected on very large repositories] → `--quick` runs one `git status` per project per request, never per poll tick. Clients cache the result.
- [Changing the default name surprises users of other installations] → Registered projects keep their names. The README and `docs/helper.md` describe the new default and the state move.
- [Two paths share the tag, truncated project name, and 4-character hash, so they would resolve to the same sandbox name] → D4's refusal rule turns that into an error that suggests `--name`, never a shared sandbox. Registry files are named by sandbox name, so the collision cannot overwrite another project's entry.

## Migration Plan

Applied by hand on this host as tasks, without shipping code:

1. Stop running sessions, then copy `$XDG_STATE_HOME/maki-oss/sessions/` and `$XDG_STATE_HOME/opencode-oss/sessions/` into `$XDG_STATE_HOME/osa/sessions/`.
2. Rewrite each `pending` as TOML, and update `patch` paths that point into the old roots.
3. Write a registry entry for each existing sandbox with its current name and host path, then run the matching front-end's `status` from each project to confirm the classification is unchanged.
4. Keep the old roots until the check passes, then remove them.

Rollback: restore the old roots and run the previous helper. Nothing in them is modified before step 4.
