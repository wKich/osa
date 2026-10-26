# Proposal

## Why

The dashboard is moving from a sandbox list to a project-centric workbench (see `design.md` - Vision and roadmap), and that needs project and sync state it cannot get today. That state lives in two per-tool roots (`$XDG_STATE_HOME/maki-oss/` and `$XDG_STATE_HOME/opencode-oss/`, chosen by `OSS_CONFIG_NAME`). It is keyed by sandbox name only, never records the host project path, and is exposed only as human-readable `status` text. As a result no client can tell which folder a sandbox belongs to, see Maki and OpenCode projects together, or read sync state without re-running the host-tree hash. `disposable-sandbox-sync` has landed (archived 2026-10-26), so the sync states this layer exposes (`clean`, `behind`, `retained`, `parked`) are stable enough to publish as a contract.

## What Changes

- Name the agent-neutral **project layer** that already lives in `lib/oss-core.sh`: the project/sandbox binding, upload/refresh, baseline and patch sync, retained/parked resolution, provider memory, env hygiene, and idle stop. It sits between the thin agent front-ends (`maki-oss`, `opencode-oss`) and the `openshell` CLI.
- Add **`osa`** (OpenShell Agent), the agent-neutral entry point. In this change it offers only cross-agent read commands: `osa projects --json` and `osa status --json`. `maki-oss` and `opencode-oss` keep their commands unchanged. Renaming the rest (env prefixes, config directories, the repository) is later work.
- Introduce **one state root**, `$XDG_STATE_HOME/osa/`, shared by every agent front-end, so a single client sees all projects regardless of agent. Config stays per agent where it is today.
- Add a **project registry** keyed by `(host_path, agent)`, recording the sandbox name and sandbox ID.
- Change **default sandbox names** to `<tag>-<project>-<hash>`, within OpenShell's 19-character limit. `<tag>` is a 2-letter agent tag (`mk`, `oc`). `<project>` comes from the git remote repository name, falling back to the folder name, cut to 11 characters. `<hash>` is 4 hex characters of a hash of the absolute host path, so separate git worktrees and same-named folders get separate sandboxes. Existing sandboxes keep their names through the registry.
- Publish a **versioned, flat TOML state contract** (registry entries and `pending`) that clients may read directly, without writing it, for cheap polling.
- Record a **cheap host fingerprint** at sync time, so a client can show "changed since last sync" without hashing the tree. Proving `clean` stays with the full `status`.
- **BREAKING:** state moves from `$XDG_STATE_HOME/maki-oss/` and `$XDG_STATE_HOME/opencode-oss/` to `$XDG_STATE_HOME/osa/`. No migration code ships. This host's state is migrated by hand as an apply task, since it is the only installation.

This change unifies state and publishes the contract the dashboard reads. It is groundwork, not the rename: a later change gives `osa` a session runner and moves env prefixes, config directories, and the repository to the `osa` name.

Out of scope for this change: dashboard UI work (M1 and later in the roadmap), new sync resolution commands (M2), and any change to OpenShell primitives. The dashboard keeps calling `openshell` directly for those.

## Capabilities

### New Capabilities

- `osa-project-layer`: the agent-neutral project layer and the `osa` entry point. It covers the shared state root used by every agent front-end, the project registry, the versioned TOML state contract, the host fingerprint, and `osa projects|status --json`.

### Modified Capabilities

- `helper-cli`: MODIFIED "Sandbox names fit the gateway" (the 4-character hash is always added and is computed from the host path, the 2-letter agent tag replaces the agent name, and `{project}` comes from the git remote with the folder name as fallback). MODIFIED "Idempotent sandbox lifecycle" (its first-run scenario uses the new default name). State location moves to the shared root, and sessions register the project and record the fingerprint.
- `opencode-oss-helper`: MODIFIED "Feature parity with maki-oss" (the default name becomes `oc-{project}-{hash}`, and the "Products do not share state" scenario now keeps sandboxes and session directories separate under the one shared state root).

## Impact

- `lib/oss-core.sh`: state root resolution (`session_state_dir`, `state_base`), default name resolution (`resolved_name`, project name), registry writes on create/session/rm, fingerprint recording, TOML `pending`, and JSON emitters.
- `bin/osa` (new), `bin/maki-oss`, `bin/opencode-oss`: wiring.
- `fish/completions/`: new flags and subcommands.
- `tests/run-tests.sh`, `tests/stub/openshell`: registry, JSON schema, naming, fingerprint, and shared root across both front-ends.
- `docs/helper.md`, `docs/opencode-oss.md`, `docs/glossary.md`: the layering, state root, and state format reference.
- No new network endpoints, host bind mounts, or secret paths. The registry stores paths and IDs only, never credentials.
- The dashboard is unchanged here. It starts consuming this contract in M1.

Upstream behavior this depends on: `openshell sandbox get -o json` exposes a stable sandbox `Id` (<https://docs.nvidia.com/openshell/how-it-works/sandboxes/overview.md>).
