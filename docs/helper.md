# osa: the sandbox helper

`bin/maki-oss` and `bin/opencode-oss` are POSIX sh workflow layers over the
OpenShell CLI. They create one sandbox per project, move files in and out
without bind mounts, run the agent headless or interactively, and encode the
safety rules from the [setup guide](setup-guide.md) so they are not retyped per
project. The OpenCode path is in
[the OpenCode playbook](ai/playbooks/opencode.md) and its differences in
[the OpenCode reference](ai/reference/opencode.md).

Bare `maki-oss` (no subcommand) is the one-command session: it ensures the
project sandbox, makes the workspace match the host, launches Maki, and on
exit collects the sandbox changes as a patch. The sandbox **workspace** is a
disposable replica: it is refreshed before a session when the host moved and
no uncollected output would be lost. The patch is applied to the host only
when the sandbox baseline still matches the host tree; otherwise it is kept
for review and the project is left untouched. After a one-time
`maki-oss provider setup`, a project needs no further setup commands.

The sandbox remains the security boundary:

- no host bind mounts — project files move with `openshell sandbox upload` /
  `download`;
- credentials go through provider profiles, never `--env` or `--env-from`;
- `--env` and `--env-from` refuse credential-like names unless you pass
  `--allow-env`, and `--env-from` checks the source name too;
- `rm` requires confirmation or `--yes`;
- every gateway call uses the configured policy, and no command widens egress.

## Install

Prerequisites:

| Requirement | Check |
|---|---|
| OpenShell CLI and a running gateway | `openshell status` |
| Docker Engine 28+ (or Podman) | `docker version` |
| `jq` (optional, better parsing) | `jq --version` |
| `fish` (optional, for the plugin) | `fish --version` |

From a clone of this repository:

```sh
./bin/maki-oss doctor          # verify prerequisites
./bin/maki-oss image build     # build maki-agent:local from examples/maki-image
```

Either run `./bin/maki-oss` directly or put the repository's `bin/` on `PATH`:

```sh
export PATH="$PWD/bin:$PATH"
maki-oss help
```

Development checks live in the `Makefile`:

```sh
make test     # stub-backed suite: no Docker, no gateway, no network
make lint     # shellcheck + fish -n
```

### Code layout

The helper is four files:

- `bin/maki-oss` is the Maki front-end. It sets the identity and defaults
  (the `MAKI_OSS_` prefix, config and state paths, image, policy, sandbox
  name), defines the agent hooks (session argv, doctor's MCP section, the
  provider-setup hint), and keeps the Maki-only commands: `maki` and the
  OpenCode TUI mode. Each front-end defines its own `mcp status`,
  `image build`, and `fish install`/`uninstall`.
- `lib/oss-core.sh` is the agent-neutral core: config, OpenShell wrappers,
  safety checks, the session ensure and patch sync, idle stop, policy and
  provider commands, the project registry, and argument parsing. The
  front-end sources it and calls `oss_main`.
- `lib/osa-state.sh` holds the shared state root and the published state
  contract (flat TOML reading and writing, the host fingerprint). The core
  and `bin/osa` both load it.
- `bin/osa` is the agent-neutral, read-only reporter over every front-end's
  projects. See [osa](#osa).

Keep `lib/` next to `bin/`. The helper loads it from the repository root,
just as it loads `examples/` and `bridge/`, so a copy of `bin/maki-oss`
alone does not run.

## Configuration

Settings resolve in this order (first non-empty wins):

1. command-line flags (`--image`, `--provider`, ...);
2. `MAKI_OSS_<KEY>` environment variables;
3. the config file at `${XDG_CONFIG_HOME:-$HOME/.config}/maki-oss/config.toml`;
4. built-in defaults.

[`examples/config.toml`](../examples/config.toml) documents every supported
key. The file is parsed as data and never sourced: it accepts
`key = "value"` lines, `#` comments, and blank lines, and an unknown key is a
hard error that names the file and the key. Values are single-line quoted
strings; `providers` is a comma-separated list.

| Key | Environment | Default | Meaning |
|---|---|---|---|
| `image` | `MAKI_OSS_IMAGE` | `maki-agent:local` | Sandbox image reference |
| `policy` | `MAKI_OSS_POLICY` | `examples/policies/maki-minimal.yaml` | Policy YAML; relative paths are tried against the current directory first, then the repository root |
| `providers` | `MAKI_OSS_PROVIDERS` | empty | Comma-separated provider names attached at creation |
| `cpu` | `MAKI_OSS_CPU` | empty | CPU limit passed to `sandbox create` |
| `memory` | `MAKI_OSS_MEMORY` | empty | Memory limit passed to `sandbox create` |
| `sandbox_name` | `MAKI_OSS_SANDBOX_NAME` | `mk-{project}-{hash}` | Name pattern; `{project}` is the sanitized project name and `{hash}` a 4-character hash of the project folder's path. See [Sandbox names](#sandbox-names) |
| `engine` | `MAKI_OSS_ENGINE` | `docker` | `docker` or `podman` |
| `gateway` | `MAKI_OSS_GATEWAY` | empty | OpenShell gateway name (`-g`) |
| `workdir` | `MAKI_OSS_WORKDIR` | `/sandbox/project` | In-sandbox project directory used by `upload`, `download`, `maki`, and `run` |
| `model` | `MAKI_OSS_MODEL` | empty | Default model passed to Maki (`provider/model`); `--model` overrides it |
| `tui` | `MAKI_OSS_TUI` | empty | Interactive TUI for bare `maki-oss` and `maki-oss maki`: empty keeps Maki's own TUI, `opencode` runs the OpenCode TUI against the local bridge; any other value is a usage error. `run` ignores it |
| `idle_stop` | `MAKI_OSS_IDLE_STOP` | `1h` | Stop the sandbox this long after the last session closes (seconds, or with an `s`, `m`, or `h` suffix); `0` disables it. `--idle-stop` overrides it. See [Idle stop](#idle-stop) |

### Sandbox names

OpenShell accepts sandbox names of at most 19 lowercase letters, digits, and
hyphens. The default is `mk-{project}-{hash}`:

- `{project}` is the repository name of the project's `origin` remote (the
  last path segment, without `.git`), or the folder name when there is no git,
  no repository, or no `origin`. It is lowercased and sanitized to that
  alphabet.
- `{hash}` is a stable four-character hex hash of the project folder's
  absolute physical path, so two git worktrees of one repository, or two
  folders with the same name, get separate sandboxes and separate sync state.
- When the expanded name is too long, `{project}` is shortened (to 11
  characters for the default) and loses any trailing hyphen. A pattern
  without `{hash}` that has to be shortened gets a four-character hash of the
  full project name instead, so long names that share a prefix do not
  collide.

For example, this repository (`origin` is `wKich/osa`) becomes
`mk-osa-` plus four hex characters.

Once a project has a [registry](#shared-state-and-the-project-registry)
entry, its recorded sandbox name is used instead of the default, so a
sandbox keeps its name when the default rule or the remote changes. An
explicit `--name`, `MAKI_OSS_SANDBOX_NAME`, or `sandbox_name` still wins.
`up` and every session refuse, before any gateway call, a name that is
registered to a different project folder, and suggest `--name`. An explicit
name that breaks the length or character rules also fails before any gateway
call.

`MAKI_VERSION` (or `--maki-version`) sets the Maki release version passed to
`image build`; when unset, the Dockerfile default applies.

Exit codes: `0` success, `1` usage error, `2` missing local dependency
(CLI, engine, image, policy, profile file), `3` gateway or sandbox operation
failed (including a failing `profile lint`). `provider setup` exits `1` when
input or flags are missing, `2` when a named profile file is absent, and `3`
when a gateway operation fails. `run` and `maki` propagate the remote process
exit code instead; a failed session sync warns on stderr without changing that
exit code.

## Command reference

### doctor

Checks the `openshell` CLI, gateway connectivity, the configured container
engine, image presence, the policy file, and that configured provider names
exist. Prints one line per check and exits non-zero when any check fails.
When the CLI is missing the suite does not attempt gateway operations. When
the `tui` setting resolves to `opencode` it additionally checks `bun`, the
`opencode` binary, and the bridge entrypoint; those checks are skipped (and
never fail the run) when the setting is unset.

```sh
maki-oss doctor
maki-oss doctor --provider maki-anthropic
```

### image build

Builds `examples/maki-image/` with the configured engine and tags it
`maki-agent:local`. `--image` or `MAKI_OSS_IMAGE` may choose another tag for an
explicit base build. The `image` setting is ignored here: it names the sandbox
image and may be a derived environment, which a base build must not overwrite.
`MAKI_VERSION` is passed as a build argument.

This builds the generic **base** image: the agent runtime and safety baseline,
with no MCP servers, no MCP-specific runtime, and no personal UI preferences. To
add MCP servers or a runtime they need, build an environment store `FROM` the
base, set the helper's `image` setting to its derived tag, and rebuild that
store when it changes — see
[`docs/ai/environment-playbook.md`](ai/environment-playbook.md) and
[`examples/environments/reference/`](../examples/environments/reference/).
`image build` never builds or inspects a store.

```sh
maki-oss image build
MAKI_VERSION=0.6.1 maki-oss image build
maki-oss image build --engine podman
```

### init / up

Creates the project's sandbox when it does not exist, or starts it when it is
stopped. Running `up` twice never creates a second sandbox. The sandbox is
created detached, from the configured image, policy, providers, CPU, and
memory. `up` is lifecycle-only: it never uploads the project or launches Maki
(the session commands do that).

```sh
maki-oss up
maki-oss up --name maki-other-project
```

### maki (and bare `maki-oss`)

Ensures the project sandbox and attaches an interactive Maki session in the
sandbox workdir through `openshell sandbox exec --tty`. Running `maki-oss`
with no subcommand is the same command. The ensure step:

1. refuses to start when no provider is remembered — on a TTY it offers the
   provider setup wizard inline, and continues the session afterwards;
2. creates the sandbox when absent (uploading the project once) or starts a
   stopped one, never creating a second sandbox;
3. refreshes the workspace from the host when it is `behind`, or when a
   `retained` patch covers the sandbox output;
4. attaches any remembered provider that is not attached yet.

When the session ends — including Ctrl-C or a non-zero exit — the helper
collects the sandbox workdir changes as a patch and applies them only through
the safety check described in [Safe session sync](#safe-session-sync). A host
edit is never overwritten by an automatic overlay. `--no-sync` skips collection
and parks the workspace (the next session refuses until you download or
discard it). `--model provider/model` (or the config `model` key) selects the
model.

Three session flags are forwarded to Maki unchanged: `--continue` (`-c`)
resumes the most recent session in the sandbox workdir, `--resume <ID>`
(`-r <ID>`) resumes a specific session, and `--session-id <ID>` writes the run
under a chosen id. `--continue` together with `--resume` is a usage error.
Maki validates ids as base58 encoding of exactly 16 bytes, so a usable id is 22
characters with no `-`, `0`, `O`, `I`, or `l`; anything else is rejected by
Maki itself, not by the helper. On commands that do not launch Maki the flags
are accepted and ignored, like `--model`. Maki's own flag semantics are
documented in the upstream reference pack
([`docs/ai/references.md`](ai/references.md)).

Sessions live in the sandbox's container filesystem, not on the host: they
survive `stop` and `start`, but are lost when the sandbox is deleted and
recreated (`maki-oss rm`). The helper's sync state (baseline, synced pair,
patches, worktrees, pending marker) lives on the host under
`${XDG_STATE_HOME:-$HOME/.local/state}/osa/sessions/<sandbox>/`, in the state
root every front-end shares (see
[Shared state and the project registry](#shared-state-and-the-project-registry)).

The sandbox **workspace** is disposable; the container is not. Maki sessions,
installed dependencies, and caches survive `stop`/`start`, but the tracked
project tree is a replica of the host and is refreshed before a session when
it is safe. The helper records the sandbox instance ID and a host/sandbox tree
pair at each refresh or clean apply, then classifies the workspace as `clean`,
`behind`, `retained`, or `parked` (defined under [Sync state](glossary.md#sync-state)):

- `clean`: the host and sandbox match the recorded pair. No upload; the
  session reuses the workspace.
- `behind`: the host moved and the sandbox did not. The helper uploads the
  current host tree first. Upload is copy-in; tracked deletions are pruned
  while ignored sandbox artifacts such as `node_modules` survive.
- `retained`: a collected patch exists on the host for the sandbox output.
  The next session refreshes the workspace and keeps the patch for review;
  this state does not block. After the refresh, a patch whose result no longer
  matches the sandbox is only an advisory notice: the workspace is `clean` or
  `behind` and the patch file stays.
- `parked`: the sandbox has output with no durable patch (collection failed,
  `--no-sync`, or the workspace was edited outside the helper). The helper
  does not upload over it and refuses to launch Maki until you download it or
  pass `--discard`.

The recorded pair is what keeps a clean filter (LFS) or a submodule from
looking like a host change: those hash differently on each side, and comparing
them directly would mark a fresh sandbox stale.

```sh
cd ~/code/myproject
maki-oss             # ensure + interactive Maki + safe sync
maki-oss --continue  # resume the most recent session in the sandbox
maki-oss --no-sync   # leave changes in the sandbox only
```

#### Safe session sync

The sandbox is the source of the agent's work; the host decides whether that
work applies. The helper keeps an external git directory at
`<workdir parent>/.maki-oss/git` inside the sandbox, outside the project
workdir. At upload time it commits the uploaded tree as `refs/maki-oss/base`.
On exit it commits the workdir and emits
`git diff --binary --full-index base result` as a patch. `.git` never crosses
the boundary: OpenShell's git-aware upload skips the host `.git`, and the
sandbox git directory is outside the worktree, so it cannot enter the patch.

The host stores the baseline identity and the patch under the session state
directory (mode `700`; files `600`):

| Path | Meaning |
|---|---|
| `baseline` | Mode, branch, commit, tree, dirty flag, upload mode, sync state, sandbox ID |
| `synced` | Host and sandbox tree pair plus sandbox ID recorded at the last refresh or clean apply |
| `patch-<timestamp>.patch` | Collected patch, retained until you remove it |
| `worktrees/<id>/` | Review worktree kept when no fast-forward happened |
| `review-<timestamp>/` | Selective export used when the host has no git |
| `pending` | Marker for unresolved changes: `kind` (`retained` or `parked`), patch path, sandbox ID, result tree |

The apply path depends on the project and the baseline:

- **Clean git repository, matching baseline:** the patch is applied in a
  temporary worktree at the recorded commit, committed on a temporary branch,
  and the host branch is fast-forwarded only when it is still on the recorded
  branch and commit with no tracked changes. The worktree and branch are
  removed after the fast-forward.
- **Dirty or untracked git repository:** the baseline is a synthetic commit
  whose tree is the current working tree and whose parent is `HEAD`. The
  result is committed on the temporary branch but never fast-forwarded,
  because that would commit your uncommitted work. The helper prints the
  `git cherry-pick <result>` command and keeps the branch/worktree.
- **Host moved or dirty at exit:** no fast-forward. The result stays on the
  temporary branch, and the helper prints review/merge commands plus the patch
  path.
- **Plain directory (no repository):** `git apply --check` then `git apply`,
  which works outside a repository. A failed check leaves every file
  unchanged and keeps the patch.
- **No host git:** text patches use `patch` (dry run first); binary patches
  export only the changed files, with a path/hash manifest, into
  `review-<timestamp>/`. If neither tool is available, the helper fails closed.
- **Retained patch:** no automatic apply. The patch is kept for review and the
  next session refreshes the workspace from the host even when the host tree
  did not move. The helper clears the notice when the patch is already applied
  to the host (reverse check) but never deletes the patch file.
- **Parked workspace:** no upload and no apply. The recovery block prints the
  download and `--discard` commands.

A failed collection parks the workspace because no durable patch exists. An
apply failure or conflict retains the patch and does not park. Both write
nothing to the project and leave the changes in the sandbox. The recovery
block prints `openshell sandbox connect <name>`, a `maki-oss download <path>
<dest>` example, and the patch or pending path. A retained patch stays
available until you apply or delete it and never blocks a later session;
resolve a parked workspace with `maki-oss download` or `maki-oss upload
--discard` (or `rm --discard`).

Gitignored files, empty directories, and sandbox-only artifacts do not travel
in a patch. Use `maki-oss download` when you need a full copy.

#### Migration, rollback, and concurrency

State moved from the per-tool roots `~/.local/state/maki-oss/` and
`~/.local/state/opencode-oss/` to the shared `~/.local/state/osa/`, and the
`pending` marker became flat TOML. The helper does not read the old roots or
the old `key=value` marker; move the session directories and rewrite each
`pending` by hand when upgrading an installation. A marker with no `kind`
reads as `retained` when its patch file is present and non-empty, and as
`parked` otherwise.

To roll back, install the previous helper. It treats any `pending` file as a
blocking marker, which is exactly the old fail-closed behavior; remove
`pending` after resolving the patch when you want automatic apply again.
Patch files written by the new helper remain valid input for `git apply`.

State directories are scoped by sandbox name and instance. Recreating a
sandbox archives the old directory as
`sessions/<name>.archive-<timestamp>-<pid>`, so a new instance never inherits
a parked marker; `rm` archives the directory after deleting the sandbox and
retained patch files move with it into the archive.

Two sessions for the same project are not coordinated beyond that instance
check: both may classify the workspace and upload at once. The last writer
wins in the sandbox, and each exit collects the diff from its own baseline.
Run one session per project at a time if you need deterministic sync.

#### Idle stop

A sandbox otherwise runs until you stop it: OpenShell has no idle timeout.
So each session (bare `maki-oss`, `maki-oss maki`, `maki-oss run`, and the
OpenCode TUI mode) starts a small background watcher. When the session's
helper process exits, for any reason including a closed terminal or a crash,
the watcher waits the idle period (`idle_stop`, default `1h`). It then runs
`openshell sandbox stop`. It skips the stop when:

- a later session started in the meantime (that session's own watcher takes
  over), or
- a `maki` process is still running inside the sandbox (another terminal,
  another host, or Maki started through `openshell sandbox connect`).

`stop` keeps the workspace and Maki's sessions. The next session starts the
sandbox again, and `--continue` resumes where you were.

```sh
maki-oss maki --idle-stop 15m      # this session: stop 15 minutes after it closes
MAKI_OSS_IDLE_STOP=0 maki-oss      # never stop automatically
# config.toml: idle_stop = "0"
```

- Only a running `maki` keeps the sandbox up. A shell opened with
  `openshell sandbox connect` and running nothing else is stopped under you
  once the period passes. Set `idle_stop = "0"` for that workflow.
- The watcher is a user process on the host. It does not survive logout or
  a reboot, and nothing stops the sandbox then.
- `maki-oss up` and `maki-oss start` never arm the watcher.
- The watcher writes nothing to your terminal. A failed stop is not retried.
  Each decision (`armed`, `closed`, `superseded`, `busy`, `stopped`,
  `stop-failed`, `scan-failed`) is appended to
  `${XDG_STATE_HOME:-~/.local/state}/osa/sessions/<sandbox>/idle.log`.

#### OpenCode TUI mode (`tui = "opencode"`)

Setting `tui = "opencode"` in the config file (or `MAKI_OSS_TUI=opencode` in
the environment) changes bare `maki-oss` and `maki-oss maki` to run the
OpenCode TUI against a local opencode-tui-bridge instead of Maki's own TUI.
The bridge is a Bun server in `bridge/` that serves OpenCode's HTTP+SSE
contract over one live Maki SDK session in the same project sandbox: Maki
still runs only inside the sandbox, reached over `openshell sandbox exec`
stdio, with no bind mounts and no `--env` values. The session keeps the
shared lifecycle — the same ensure step, the same `model` setting, and the
same safe exit sync back into the project directory.

```sh
# one-time host prerequisites for this mode
bun --version
opencode --version

# config.toml: tui = "opencode"
cd ~/code/myproject
maki-oss              # ensure + bridge + OpenCode TUI + safe sync
maki-oss --no-sync    # same, without collecting a patch
```

The mode requires `bun` (to run the bridge) and the `opencode` binary on the
host; `maki-oss doctor` checks all three only when the setting resolves to
`opencode`. The bridge binds `127.0.0.1` and is killed when the TUI exits,
including Ctrl-C. The model picker is Maki's `maki models` list, read by the
bridge once at boot. The base image seeds a models.dev catalog snapshot at
build time, so the picker lists the full catalog even with deny-by-default
egress; host-only providers and plan settings belong in the environment
store's `providers.toml` and require an environment-image rebuild and a TUI
restart. Session resume flags (`--continue`, `--resume`,
`--session-id`) are refused in this mode — a bridge session has no
replayable transcript yet — and `maki-oss run` is unaffected by the
setting. Known rendering defects (message order and the status-line model
name) are recorded in the archived `add-opencode-tui-bridge` change's
[`evidence/known-defects.md`](../openspec/changes/archive/2026-10-21-add-opencode-tui-bridge/evidence/known-defects.md);
the machine-checked compatibility picture (served routes, wire features, and
the pinned versions) is generated at [`compatibility.md`](compatibility.md).

### run

Runs Maki headless with `--print --yolo --trust --output-format json`,
streams stdout unchanged, and exits with Maki's exit code. Like `maki`, it
ensures the sandbox first and runs the same safe sync on exit; helper messages
go to stderr so stdout carries only Maki's output. `--model <provider/model>`
is passed through as Maki's `--model` and overrides the config `model` key, so
any credentialed provider can be selected without touching the interactive
picker.

The session flags apply here too — `--continue`, `--resume <ID>`, and
`--session-id <ID>` — which is how a headless run is chained onto a previous
one. The same lifetime caveat applies: the session exists only as long as the
sandbox does.

```sh
maki-oss run "fix the failing tests"
maki-oss run --model deepseek/deepseek-chat "check the changelog"
maki-oss run --session-id aSmokeResumeSessAbcdXy "start the migration"
maki-oss run --resume aSmokeResumeSessAbcdXy "continue where the previous run stopped"
maki-oss run --timeout 600 "summarize the open TODOs"
```

`--timeout SECS` (or `MAKI_OSS_TIMEOUT`) bounds a headless run. The limit is
enforced inside the sandbox: the exec runs `timeout --kill-after=10 SECS maki
…`, so Maki and its children end there and the helper exits 124. The
gateway's own `sandbox exec --timeout`, and killing the local client, both
return early while the remote process keeps running (measured on OpenShell
0.1.5), which is why the helper does not rely on them. The value must be a
positive integer; anything else is a usage error before any gateway call.
`MAKI_OSS_RUN_TAG` sets the tag the wrapper exports (letters, digits, `.`,
`_`, `-`). A caller stops such a run early by creating
`/tmp/maki-oss-stop/<tag>` in the sandbox (any `sandbox exec` can): the
wrapper notices within a second, stops Maki, and sweeps the tagged
processes. The stop has to go through the wrapper because each
`sandbox exec` runs in its own isolation domain: another exec can signal
the run's processes but cannot read their environment to find them
(measured on OpenShell 0.1.5). oskhs uses this for cancellation.

### upload / download

`upload [--discard] [LOCAL_PATH] [SANDBOX_DEST]` copies local files into the
sandbox. The default local path is `.` and the default destination is the
workdir. An upload to the workdir refreshes the tracked tree: it uploads the
current host tree, removes tracked files deleted on the host, preserves
ignored sandbox-local artifacts such as `node_modules`, and re-records the
baseline and synced pair. A parked workspace is refused unless `--discard` is
passed; discard replaces the parked output and keeps existing patch files. A
retained patch is kept and its path is printed. An upload to any other
destination is a copy-in: it does not prune and does not re-record the
baseline. `upload` never clears a retained patch file.

`download [SANDBOX_PATH] DEST` copies files out to an explicit host
destination; with one argument that argument is the destination and the
workdir is downloaded. It is the explicit full-copy escape hatch and is never
run automatically by a session.

Both delegate to `openshell sandbox upload` / `download`; neither creates a
bind mount or exposes any other host path.

```sh
maki-oss upload .                          # project -> /sandbox/project
maki-oss upload --discard .                # replace a parked workspace
maki-oss upload ./dist /sandbox/project/dist
maki-oss download /sandbox/project/out ./out
```

### status / list / logs

`status` reports the project sandbox's existence, phase, configured image,
attached providers, and sync state (`clean`, `behind`, `retained`, or
`parked`), plus the retained patch path and the next command. A parked
workspace also prints the discard commands. `list` delegates to `openshell
sandbox list`. `logs` forwards `--tail`, `--since`, `--source`, `--level`, and
`-n`.

```sh
maki-oss status
maki-oss list
maki-oss logs --since 5m --tail
```

`status` marks the image `(configured)` because OpenShell's CLI JSON does not
report the booted sandbox image; the value shown is what this helper would
use for the next `up`.

### start / stop / rm

`start` and `stop` delegate to the gateway. `rm` prints the exact sandbox
name and asks for confirmation; when stdin is not a terminal it refuses
unless `--yes` is passed, and it never sends a delete request otherwise. A
parked workspace is refused unless `--discard` is passed, so uncollected
sandbox output cannot be deleted by accident. After a successful delete the
instance state directory is archived (retained patch files move with it) and
the project's registry entry is removed.

```sh
maki-oss stop
maki-oss start
maki-oss rm            # prompts
maki-oss rm --yes      # non-interactive
maki-oss rm --yes --discard  # delete a parked workspace
```

### policy show / edit / apply

`show` prints the base policy by default (`--full` for the effective policy,
`--global` for the gateway-global policy). `edit` opens the policy file in
`$EDITOR`. `apply` runs `openshell policy set` (add `--wait` to wait for the
sandbox to load it; `--global` requires `--yes`).

```sh
maki-oss policy show
maki-oss policy show --full
maki-oss policy edit
maki-oss policy apply --wait
```

### policy review / approve / reject

Act on network-rule proposals. A proposal is filed two ways: the in-sandbox
policy advisor lets an agent ask for an endpoint it was denied and wait for
your decision, and OpenShell auto-drafts one from any connection the policy
blocks. Neither ever takes effect on its own — you are the only approver, and
there is deliberately no bulk or automatic approval.

`review` prints the project sandbox's pending proposals (chunk id, rule name,
binary, endpoint, and the prover verdict), or reports an empty inbox and exits
zero. `approve` confirms the exact chunk id before sending it, and requires
`--yes` when stdin is not a TTY. `reject` requires `--reason`, which the agent
receives so it can narrow the request.

```sh
maki-oss policy review
maki-oss policy approve 2258b82a-8253-4094-bf5f-3e309b2b9c11
maki-oss policy approve 2258b82a-8253-4094-bf5f-3e309b2b9c11 --yes
maki-oss policy reject 2258b82a-8253-4094-bf5f-3e309b2b9c11 --reason "Scope this to docs/ paths only."
```

Every session that launches Maki also checks for proposals on the way out. If
any are pending, the helper prints a stderr note with the count and the
`policy review` command, so a denial never disappears silently. The check is
fail-soft: an unreachable gateway or an older `openshell` without `rule`
never masks Maki's exit code, and nothing is printed when the inbox is empty
or on the `--no-sync` path.

Read the prover line before approving. `no new findings` is an ordinary
request; a named finding (`l7_bypass_credentialed`,
`credential_reach_expansion`, `link_local_reach`) is a security signal and
deserves a reject or a much narrower re-ask. Approving a host that resolves
to a private address is accepted but stays blocked by the SSRF guard, so a
proposal can be approved and still not work — the review output's endpoint
and protocol tell you which case you are in.

### provider add / attach / list

`add` creates a provider. Credentials are captured from the environment with
`--from-existing` (or `--credential KEY`, which reads `KEY` from the
environment). Inline `--credential KEY=VALUE` is refused so secrets never
appear in shell history or process arguments. `attach` attaches a provider to
the project sandbox; `list` lists providers known to the gateway. Attached
providers also appear in `maki-oss status`.

```sh
maki-oss provider add maki-anthropic --type maki-anthropic --from-existing
maki-oss provider attach maki-anthropic
maki-oss provider list
```

Three more `add` flags pass straight through to `openshell provider create`
and are for profiles that do not fit the plain from-existing shape: `--config
KEY=VALUE` (repeatable) sets provider config pairs, `--runtime-credentials`
creates a provider whose credentials the gateway resolves at runtime rather
than binding a key held on the host, and `--global-profile` imports the
profile at platform scope instead of workspace scope. None of them is a
credential channel — a secret still travels through `--from-existing` or
`--credential KEY` and the child-process environment.

### provider setup

The wizard for any provider. It scans the Maki
(`~/.local/state/maki/auth`) and OpenCode (`~/.local/share/opencode/auth.json`)
credential stores, or reads a JSON file, a host environment variable, or a
hidden prompt, then resolves a profile — curated catalog, `--profile FILE`, or
interactive custom generation into
`${XDG_CONFIG_HOME:-$HOME/.config}/maki-oss/profiles/`. Every profile is
linted before `profile import --global`, and the provider is created when
absent or updated with `provider update --from-existing` when present.
Attachment (`sandbox provider attach --wait`) is offered at the end, or forced
with `--attach`.

Credential values move only through the child-process environment: never argv,
never output, never generated files, never the shell history. A successful
setup (and `maki-oss provider add`) records the provider instance name in the
config `providers` list, so the session commands attach it automatically; the
interactive wizard also offers to set the default `model`.

```sh
maki-oss provider setup
maki-oss provider setup --from maki --credential opencode-go --yes
maki-oss provider setup --file ~/creds.json --field api_key \
    --profile examples/providers/maki-deepseek.yaml --yes
maki-oss provider setup --env DEEPSEEK_API_KEY \
    --profile examples/providers/maki-deepseek.yaml --yes
```

Flags: `--from maki|opencode`, `--credential SLUG`, `--file PATH`,
`--field PATH`, `--env VAR`, `--profile FILE`, `--name NAME`, `--yes`,
`--attach` / `--no-attach`. OAuth store entries are listed as `(oauth)` and
refused with guidance. Without the flags needed to complete the flow on a
non-TTY stdin, the command exits non-zero before any gateway mutation, like
`rm`. `MAKI_OSS_INTERACTIVE=1` treats piped stdin as interactive so scripted
runs (and the test suite) can answer the prompts. The curated catalog and
troubleshooting live in [`docs/providers.md`](providers.md).

### mcp status

Reports whether every MCP server configured on the host will actually work
inside the sandbox. It compares two configs — the host's
`~/.config/maki/mcp.toml` and the sandbox's baked
`/sandbox/.config/maki/mcp.toml` — and prints one line per server naming the
gates that decide whether it works: **present in the sandbox** and **provider
attached** for every server, plus **endpoint in the effective policy** for an
HTTP server and **runtime present** — the command its `command` array names
resolving in the sandbox — for a stdio server. Each failing gate is followed
by the command that fixes it.

```sh
maki-oss mcp status
```

```text
MCP readiness for sandbox 'maki-myproject':
  context7: sandbox=ok provider=ok endpoint=ok transport=http
  synthetic: sandbox=ok runtime=ok provider=ok transport=stdio
```

It exits non-zero when any server fails a gate, so it is scriptable. Three
cases exit clean: no sandbox exists yet, neither side declares a server, or
every gate holds.

**The host-vs-sandbox drift check** covers the failure this command exists to
end: a server added to `~/.config/maki/mcp.toml` *after* the environment image
was built is silently absent in the sandbox. `mcp status` names it as
`sandbox=missing` and prints the environment-image build guidance plus
[`docs/ai/environment-playbook.md`](ai/environment-playbook.md) as the fix. The
base image declares no MCP servers, so a server is added by building and
selecting an environment image, not by rebuilding the base — see
[`docs/mcp-migration.md`](mcp-migration.md) §4.

An OAuth-gated server reports its provider as missing until the host-side login
has been handed to the gateway; the sandbox receives only a placeholder, never
the access token. A stdio server is judged by its **runtime gate** — the
command its `command` array names, checked read-only in the sandbox — instead
of being rejected for its transport. A missing runtime reads
`synthetic: sandbox=ok runtime=missing provider=ok transport=stdio` followed by
the environment-image build guidance and the environment playbook: the output
names the missing command, and the helper never installs a runtime itself.

**Reporting is read-only.** It never mutates the sandbox, the gateway, any
profile, or the policy, and it never prints a credential value — headers and
`environment` values are skipped rather than parsed. `maki-oss doctor` prints
the same table in an informational section after its prerequisite checks, but
MCP is not a prerequisite for running Maki: a failing MCP gate never changes
`doctor`'s exit code, and a project that never set up MCP is not failed.

### fish install / uninstall

Installs the fish plugin without fisher by symlinking
`fish/functions/maki-oss.fish` and `fish/completions/maki-oss.fish` into
`${XDG_CONFIG_HOME:-$HOME/.config}/fish`. The install is idempotent, refuses
to overwrite foreign files, and uninstall removes only symlinks that point
into this repository.

```sh
maki-oss fish install
maki-oss fish uninstall
```

`opencode-oss` has the same subcommand, symlinking its own
`fish/functions/opencode-oss.fish` and `fish/completions/opencode-oss.fish`.
Neither installs `fish/completions/osa.fish`; fisher picks it up with the
rest of `fish/completions/`, or link it by hand.

### help

```sh
maki-oss help
```

## Shared state and the project registry

Every front-end (`maki-oss`, `opencode-oss`) keeps its state under one root,
`${XDG_STATE_HOME:-$HOME/.local/state}/osa/`:

```
osa/
  projects/<sandbox>.toml     registry entry (published contract)
  sessions/<sandbox>/
    pending                   unresolved sync output (published contract)
    baseline, synced, patches, archives, idle.log   (internal)
```

Configuration stays per front-end (`~/.config/maki-oss/config.toml`,
`~/.config/opencode-oss/config.toml`).

The helper writes a registry entry when it creates a project's sandbox (or
first meets an existing one through `up` or a session), updates it on every
session, and removes it on `rm`. One entry exists per project folder and
agent. An entry whose folder no longer exists is an orphan: tools report it
and nothing deletes it automatically. The registry holds paths, names, and
IDs only, never credentials or `--env` values.

### State contract (version 1)

Registry entries and `pending` markers are a contract that other tools, such
as `osa` and the dashboard, may read directly, without writing them. Both are
flat TOML: one `key = "value"` line per key, every value a double-quoted
string (`\"` and `\\` escaped), and a `version = "1"` line. A standard TOML
parser reads them.

| File | Keys |
|---|---|
| `projects/<sandbox>.toml` | `version`, `agent` (`mk` or `oc`), `host_path` (absolute physical path), `project` (full sanitized name), `sandbox_name`, `sandbox_id`, `created`, `last_session`, `fingerprint` (git projects only) |
| `sessions/<sandbox>/pending` | `version`, `kind` (`retained` or `parked`), `patch`, `sandbox`, `sandbox_id`, `created`, `reason`, `result_tree` |

Within a version, keys may be added but never removed, renamed, or given a
new meaning; such a change bumps `version`. Readers ignore keys they do not
know. Every other file under the root is internal and may change at any
time. The dashboard (from roadmap milestone M1) relies on this contract.

### Host fingerprint

At each sync point (the first upload, each refresh, each clean apply) a git
project records `fingerprint`: `HEAD` plus a checksum of `git status
--porcelain` and the diff against `HEAD`. It changes with commits and with
tracked, staged, unstaged, and untracked non-ignored changes, without hashing
the tree, and it never takes git's optional locks. Editing the content of an
untracked file that was already untracked at the last sync does not change
it. A plain folder, or a host without git, records none.

## osa

`osa` reports on the projects every front-end has registered. It is
read-only: it never creates, starts, stops, deletes, uploads to, or
downloads from a sandbox, never launches an agent, and never writes the
state root.

```sh
osa projects                 # every project, with its pending kind
osa projects --json          # one JSON array, nothing else on stdout
osa status                   # this folder, one entry per agent
osa status ~/code/app --json
osa status --quick --json    # no gateway, no tree hash
```

`osa projects` lists each entry's agent, sandbox, pending kind (`retained`,
`parked`, or none), project, and folder, and marks orphans. `--json` prints
the registry fields plus `pending` and `orphan` for each entry.

`osa status [PATH]` reports every agent registered for the folder (default:
the current directory). The full mode asks the owning front-end, so it shows
the same phase, providers, sync state (`clean`, `behind`, `retained`, or
`parked`), patch, and next command as `maki-oss status` or
`opencode-oss status`, and may run the same read-only workspace probe. With
`--json` each entry carries that report under `status`. `--quick` skips the
gateway and the tree hash: it reports the pending kind and
`fingerprint_result`, which is `changed`, `unchanged`, or `unknown` (no
recorded fingerprint, a plain folder, or a missing folder), and never
`clean` or `behind`. A path with no entry prints `[]` with `--json`.

## Cookbook: two commands per project

```sh
# One-time machine setup (any provider, including keys already stored by
# Maki or OpenCode).
maki-oss doctor
maki-oss image build
# Optional: build a derived environment image (MCP servers, runtimes,
# preferences) and set `image` to its tag; see the environment playbook.
docker build -t maki-agent:reference examples/environments/reference
maki-oss provider setup          # wizard; remembers the provider

# Every project, afterwards:
cd ~/code/myproject
maki-oss                         # ensure sandbox, refresh when needed,
                                 # launch Maki, sync changes back on exit
maki-oss run "explain this project and fix the failing tests"
```

The session commands ensure the sandbox themselves: create when absent
(uploading the project once) or reuse when present (refreshing the workspace
when the host moved), start when stopped, attach remembered providers.
`maki-oss run` is the headless variant of the same flow. The first bare run
in a project with no remembered provider offers the setup wizard inline (or
exits with the exact command when stdin is not a TTY).

Explicit control is still available when you want it:

```sh
maki-oss up                      # create/start only
maki-oss upload .                # manual upload
maki-oss download /sandbox/project ./project-out
maki-oss status
maki-oss rm --yes
```

## Fish setup

From the repository root, let the helper symlink its own function and
completions (no plugin manager needed):

```sh
./bin/maki-oss fish install
./bin/opencode-oss fish install
```

With fisher (the fish plugin manager) the same plugin installs by copy:

```sh
fisher install ./fish
```

Both install the `maki-oss` function plus completions. The wrapper locates the
helper via `$MAKI_OSS_BIN`, then the source repository (symlink install), then
`maki-oss` on `PATH`. Fisher copies plugin files into the fish config
directory, so with fisher put the repository's `bin/` on `PATH` or set
`MAKI_OSS_BIN=/path/to/repo/bin/maki-oss`. The `opencode-oss` wrapper behaves
the same with `OPENCODE_OSS_BIN`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `openshell CLI not found on PATH` | Install OpenShell; see the [setup guide](setup-guide.md) |
| `gateway: unreachable` | Start the gateway service, then rerun `maki-oss doctor` |
| `refusing --env ANTHROPIC_API_KEY` | Use `provider add --from-existing` and `provider attach`, or `--allow-env KEY` for genuinely non-secret values; `--env-from` refuses the sandbox name and the source name the same way |
| `no '<slug>' credential in the maki store` | Store slug differs from the provider name | Run `maki-oss provider setup` to list the detected slugs |
| `credential '<store>:<slug>' is 'oauth'` | OAuth login selected | Use an API-key credential; see [`docs/migrating-providers.md`](migrating-providers.md) |
| `provider '<name>' already exists; pass --yes` | Non-TTY update needs confirmation | Rerun with `--yes` to update the provider |
| `no curated profile matches` on a non-TTY | Custom generation needs prompts | Pass `--profile FILE`, or rerun interactively |
| `policy file not found` | Point `--policy` / the config at an existing YAML file |
| `sandbox '<name>' not found` | Run `maki-oss up` first |
| `image ... not found` | Run `maki-oss image build` for the base, or build the environment store named by `image` |

The test suite (`make test`) covers every command above with a stubbed
OpenShell binary, so it runs without Docker, a gateway, or network access.

## Known limitations

Three boundaries are deliberate deferrals, recorded here rather than left as
surprises:

- **Sandbox `$HOME` writes are not synced back.** Only changes under the
  workdir (`/sandbox/project`) are collected into the patch. An agent that
  writes to its own home inside the sandbox — a tool whose convention is
  `~/.config/...`, for example — leaves that file behind when the session
  ends. Tell the agent to put deliverables under the project directory, or
  copy the file out by hand.
- **Ignored files and empty directories do not round-trip automatically.**
  The patch is content-based and follows `.gitignore`, so a build directory,
  model weights, or cache an agent creates in the sandbox stays there unless
  it is part of a tracked change. Use `maki-oss download` for a full copy;
  skipped and binary content is never merged silently.
- **OpenCode TUI mode (`tui = "opencode"`) has known rendering defects.**
  User prompts render after the assistant responses they caused
  (A-A-A-Q-Q-Q) and the status line shows a synthesized model name instead of
  Maki's real model. Both are recorded with their captures in the
  `add-opencode-tui-bridge` change's
  [`evidence/known-defects.md`](../openspec/changes/archive/2026-10-21-add-opencode-tui-bridge/evidence/known-defects.md)
  and belong to a later change; Maki's own TUI (the default) is unaffected.

## Manual verification

A full dry run against a real OpenShell 0.1.2 gateway (macOS 26.5, Apple
Silicon, Docker Engine 29.4.0 via OrbStack, `maki-agent:local` built from
Maki 0.6.0) produced:

```text
$ maki-oss doctor --provider maki-anthropic
ok    openshell CLI: /opt/homebrew/bin/openshell
ok    gateway: connected
ok    container engine: docker (/usr/local/bin/docker)
ok    image: maki-agent:local present
ok    policy file: .../examples/policies/maki-minimal.yaml
ok    providers: maki-anthropic
(exit 0)

$ maki-oss up --provider maki-anthropic
Creating sandbox 'maki-maki-oss' from maki-agent:local...
Created sandbox: maki-maki-oss
(exit 0)

$ maki-oss up --provider maki-anthropic     # idempotent
Sandbox 'maki-maki-oss' already exists (phase: Ready).
(exit 0)

$ maki-oss status
Sandbox:   maki-maki-oss
Exists:    yes
Phase:     Ready
Image:     maki-agent:local (configured)
Providers: maki-anthropic

$ maki-oss upload /tmp/maki-oss-smoke
✓ Upload complete
(exit 0; `openshell sandbox exec -n ... -- ls /sandbox/project` shows the
uploaded directory and no host mount exists)

$ maki-oss run "Reply with OK."
{"type":"result","subtype":"error","is_error":true,
 "result":"authentication failed, run `maki auth login` or check your API key", ...}
(exit 0, exactly Maki's code: JSON output mode reports the error in-band and
exits 0; the helper did not rewrite stdout)

$ maki-oss stop && maki-oss up
Starting sandbox 'maki-maki-oss' (phase: Stopped)...
✓ Started sandbox maki-maki-oss
(exit 0; no second sandbox was created)
```

No real Anthropic/OpenRouter key was available, so — as in the setup-guide
dry run — the provider was created with a deliberately fake credential and
deleted afterwards. The run exercises the full path (placeholder injection,
policy, proxy, Maki execution) up to the vendor returning an authentication
error. Interactive `maki` attachment is covered by the stub suite (its TTY
session is not automatable); the headless `run` above used the same exec
plumbing. The sandbox, provider, and profile were removed after the run;
`maki-agent:local` was left in place.

