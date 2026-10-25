# maki-oss: the sandbox helper

`bin/maki-oss` is a POSIX sh workflow layer over the OpenShell CLI. It
creates one sandbox per project, moves files in and out without bind mounts,
runs Maki headless or interactively, and encodes the safety rules from the
[setup guide](setup-guide.md) so they are not retyped per project.

Bare `maki-oss` (no subcommand) is the one-command session: it ensures the
project sandbox, uploads the project when the sandbox is first created,
launches Maki, and on exit collects the sandbox changes as a patch. The patch
is applied to the host only when the sandbox baseline still matches the host
tree; otherwise it is kept for review and the project is left untouched.
After a one-time `maki-oss provider setup`, a project needs no further setup
commands.

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
| `sandbox_name` | `MAKI_OSS_SANDBOX_NAME` | `maki-{project}` | Name pattern; `{project}` is the sanitized current directory name |
| `engine` | `MAKI_OSS_ENGINE` | `docker` | `docker` or `podman` |
| `gateway` | `MAKI_OSS_GATEWAY` | empty | OpenShell gateway name (`-g`) |
| `workdir` | `MAKI_OSS_WORKDIR` | `/sandbox/project` | In-sandbox project directory used by `upload`, `download`, `maki`, and `run` |
| `model` | `MAKI_OSS_MODEL` | empty | Default model passed to Maki (`provider/model`); `--model` overrides it |
| `tui` | `MAKI_OSS_TUI` | empty | Interactive TUI for bare `maki-oss` and `maki-oss maki`: empty keeps Maki's own TUI, `opencode` runs the OpenCode TUI against the local bridge; any other value is a usage error. `run` ignores it |

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

Builds `examples/maki-image/` with the configured engine and tags it as the
configured image. `MAKI_VERSION` is passed as a build argument.

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
3. attaches any remembered provider that is not attached yet.

When the session ends — including Ctrl-C or a non-zero exit — the helper
collects the sandbox workdir changes as a patch and applies them only through
the safety check described in [Safe session sync](#safe-session-sync). A host
edit is never overwritten by an automatic overlay. `--no-sync` skips collection
and leaves the changes in the sandbox. `--model provider/model` (or the config
`model` key) selects the model.

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
recreated (`maki-oss rm`). The helper's sync state (baseline, patches,
worktrees, pending marker) lives on the host under
`${XDG_STATE_HOME:-$HOME/.local/state}/maki-oss/sessions/<sandbox>/`.

A session that **reuses** an existing sandbox does not re-upload the project,
so the sandbox may still hold an earlier copy of your files. The helper prints
a `Reusing ...` note to stderr and compares the sandbox baseline tree with the
host tree. If they differ, the sandbox is stale: no patch is applied
automatically, and the collected patch is kept for review. Run
`maki-oss upload` first to refresh the sandbox from the current host tree.

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
| `baseline` | Mode, branch, commit, tree, dirty flag, upload mode, staleness |
| `patch-<timestamp>.patch` | Collected patch, retained until you remove it |
| `worktrees/<id>/` | Review worktree kept when no fast-forward happened |
| `review-<timestamp>/` | Selective export used when the host has no git |
| `pending` | Marker for unresolved changes; blocks automatic apply |

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
- **Stale sandbox or unresolved pending patch:** no automatic apply. The
  patch is retained and the recovery block points at the sandbox and patch.

A failed collection or apply writes nothing to the project, keeps the patch,
leaves the changes in the sandbox, and prints recovery commands:
`openshell sandbox connect <name>`, a `maki-oss download <path> <dest>`
example, and the pending marker path. Remove the marker after applying or
discarding the patch; until then a later session will not upload over the
sandbox or apply a new patch automatically. `maki-oss upload` re-records the
sandbox baseline and clears the marker, because it is an explicit refresh.

Gitignored files, empty directories, and sandbox-only artifacts do not travel
in a patch. Use `maki-oss download` when you need a full copy.

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
including Ctrl-C. Session resume flags (`--continue`, `--resume`,
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

`upload [LOCAL_PATH] [SANDBOX_DEST]` copies local files into the sandbox. The
default local path is `.` and the default destination is the workdir. An upload
to the workdir re-records the sandbox baseline and clears a pending marker.
`download [SANDBOX_PATH] DEST` copies files out to an explicit host
destination; with one argument that argument is the destination and the
workdir is downloaded. It is the explicit full-copy escape hatch and is never
run automatically by a session.

Both delegate to `openshell sandbox upload` / `download`; neither creates a
bind mount or exposes any other host path.

```sh
maki-oss upload .                          # project -> /sandbox/project
maki-oss upload ./dist /sandbox/project/dist
maki-oss download /sandbox/project/out ./out
```

### status / list / logs

`status` reports the project sandbox's existence, phase, configured image,
and attached providers. `list` delegates to `openshell sandbox list`. `logs`
forwards `--tail`, `--since`, `--source`, `--level`, and `-n`.

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
unless `--yes` is passed, and it never sends a delete request otherwise.

```sh
maki-oss stop
maki-oss start
maki-oss rm            # prompts
maki-oss rm --yes      # non-interactive
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
end: a server added to `~/.config/maki/mcp.toml` *after* the image was built is
silently absent in the sandbox. `mcp status` names it as `sandbox=missing` with
`maki-oss image build` as the fix. Because the config is baked at image build,
any change to the server set means a rebuild — see
[`docs/mcp-migration.md`](mcp-migration.md) §4.

An OAuth-gated server reports its provider as missing until the host-side login
has been handed to the gateway; the sandbox receives only a placeholder, never
the access token. A stdio server is judged by its **runtime gate** — the
command its `command` array names, checked read-only in the sandbox — instead
of being rejected for its transport. A missing runtime reads
`synthetic: sandbox=ok runtime=missing provider=ok transport=stdio` followed by
`fix: maki-oss image build (the runtime 'bun' that 'synthetic' runs with is
missing from the sandbox)`: the output names the missing command and the
image-build fix, and the helper never installs a runtime itself.

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

### help

```sh
maki-oss help
```

## Cookbook: two commands per project

```sh
# One-time machine setup (any provider, including keys already stored by
# Maki or OpenCode).
maki-oss doctor
maki-oss image build
maki-oss provider setup          # wizard; remembers the provider

# Every project, afterwards:
cd ~/code/myproject
maki-oss                         # ensure sandbox, upload on first run,
                                 # launch Maki, sync changes back on exit
maki-oss run "explain this project and fix the failing tests"
```

The session commands ensure the sandbox themselves: create when absent
(uploading the project once), start when stopped, attach remembered providers.
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
```

With fisher (the fish plugin manager) the same plugin installs by copy:

```sh
fisher install ./fish
```

Both install the `maki-oss` function plus completions. The wrapper locates the
helper via `$MAKI_OSS_BIN`, then the source repository (symlink install), then
`maki-oss` on `PATH`. Fisher copies plugin files into the fish config
directory, so with fisher put the repository's `bin/` on `PATH` or set
`MAKI_OSS_BIN=/path/to/repo/bin/maki-oss`.

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
| `image ... not found` | Run `maki-oss image build` |

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

