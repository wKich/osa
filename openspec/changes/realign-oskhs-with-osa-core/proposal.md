# Proposal: realign oskhs with the osa core (roadmap B1.6)

## Why

After B1.4 the shared helper core (`lib/oss-core.sh`) gained host-side
session state: a per-sandbox sync baseline with parking, a project registry
keyed by the caller's cwd, a per-sandbox idle-stop watcher, and the policy
advisor. oskhs drives `maki-oss` as a library caller, from a fresh empty
temp directory per round, against a workspace it owns
(`/sandbox/tasks/<id>`). Read against that, the new core breaks oskhs after
its first round on a project: `--no-sync` parks the workspace and the next
session refuses to launch on it, and the registry binds the sandbox name to
the first round's temp dir so every later round fails `registry_guard`.
oskhs's offline suite records argv instead of running the core, so it cannot
see this; nothing has run live since. B2 and B3 build on multi-round tasks,
so this has to be fixed first.

## What Changes

- **Caller-owned workspace mode in the core.** `MAKI_OSS_WORKSPACE=caller`
  (generic `<PREFIX>_WORKSPACE`, default `managed`) makes `run` and `up`
  treat the sandbox workspace as the caller's: no session sync, baseline,
  freshness classification, or parking; no registry guard or update; no
  upload on create; no policy advisor. It requires an explicit sandbox name
  and, for `run`, an explicit workdir. The run wrapper, `--timeout`, run tag,
  stop file, session lock, providers, model, and output stay as they are.
- **oskhs uses it.** Every `maki-oss up` and `run` call sets
  `MAKI_OSS_WORKSPACE=caller` and `MAKI_OSS_IDLE_STOP=0`; `--no-sync` is
  dropped from `run` (caller mode never syncs).
- **Fitted oskhs sandbox names.** `repo-<project>` is fitted to OpenShell's
  19 characters: a project part longer than 14 is shortened and suffixed
  with a four-character hash of the full project name, as the core fits its
  own names. Existing short names are unchanged.
- **Live re-verification** on the kiss dev stand: two tasks and a follow-up
  on one project, then a long project title.
- **Docs:** `docs/oskhs.md` and `docs/helper.md` describe the caller mode;
  roadmap B1.6 marked done.

No breaking change for interactive or headless users of `maki-oss`: the
default mode is unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `helper-cli`: adds the caller-owned workspace mode, which takes the place
  of session sync-back, baseline and freshness, the registry, and the policy
  advisor for a caller that owns the workspace.
- `oskhs-round`: sandbox naming fits the 19-character limit; seeding and
  rounds call `maki-oss` in caller mode with idle stop off and no
  `--no-sync`.

## Impact

- `lib/oss-core.sh` (`cmd_run`, `cmd_up`, `ensure_project_sandbox`, setting
  resolution), `tests/run-tests.sh` (stub-backed tests of the mode).
- `oskhs/src/names.ts`, `oskhs/src/sandbox.ts`, `oskhs/src/round.ts`, and
  their tests.
- Front-ends `opencode-oss`, `claude-oss`, `codex-oss` get the setting
  through the shared core with no change; nothing there uses it.
- Upstream behavior relied on: OpenShell sandbox names are limited to 19
  characters (the core's `SANDBOX_NAME_MAX`, from the `fit sandbox names`
  fix), and `openshell sandbox exec` does not stop the remote process when
  the client is killed (OpenShell v0.1.5, observed in B1.3c; sandbox model:
  https://docs.nvidia.com/openshell/how-it-works/sandboxes/overview.md),
  which is why the in-sandbox run wrapper stays.
