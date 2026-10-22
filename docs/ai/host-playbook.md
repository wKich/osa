# Host playbook: provision a bare host for maki-oss

Ordered, executable steps for a coding agent that starts from a bare macOS
(Apple Silicon) or Linux machine. Work from the repository root once the
repository exists (Phase 3). After each phase, run its `### Verify` block and
**stop on a mismatch** — report the failing command and its output instead of
working around it or continuing.

> **Verified against OpenShell v0.1.5 and Maki v0.6.4 on 2026-10-22.** The Maki
> version below is the one pinned by `examples/maki-image/Dockerfile`, and the
> OpenShell install command below pins the version `docs/ai/references.md`
> verifies; moving either pin is the same act as re-verifying, not a separate
> chore. External documentation links live only
> in [`docs/ai/references.md`](references.md) — this playbook restates the
> commands to type and points there for background.

This playbook covers host setup only. Sandbox phases (provider profiles,
policy choice, creation, isolation checks) continue in
[`docs/ai/agent-playbook.md`](agent-playbook.md); the two read as one
sequence. Never relax the security invariants listed at the end.

## Phase 1 — Preflight

Report which tools are already present; on a bare host every command below is
absent, which is expected:

```sh
docker version --format '{{.Server.Version}}'
openshell status
maki --version
uname -m
```

### Verify

Expected when a tool is present: the engine prints `28.0` or later;
`openshell status` shows `Status: Connected`; `maki --version` prints
`maki 0.6.4`; `uname -m` is `arm64` or `x86_64`. An absent command means the
matching step in Phase 2 installs it; a present tool whose version or status
does not match is a mismatch — fix it in Phase 2 rather than skipping ahead.

## Phase 2 — Host tooling install

### Host preconditions

Two things a bare host must supply that no step below installs; check them
first.

**macOS — Homebrew.** The engine step installs through `brew`:

```sh
brew --version
```

If that fails, install Homebrew first (the installer is on the Homebrew
homepage), then re-open the shell and re-check.

**Linux — engine access for your user.** The engine must be runnable without
root: either your user is in the docker group (adding it needs a full logout
and login to take effect) or you use a rootless engine. Check the group:

```sh
id -nG | tr ' ' '\n' | grep -qx docker
```

An empty result means the group is missing — installing the engine package
does not grant it. Rootless-engine users can skip this check.

### Container engine (Docker Engine 28+ or OrbStack)

macOS (Homebrew):

```sh
brew install --cask orbstack      # or Docker Desktop
```

Linux: install Docker Engine 28+ from your distribution's packages. Engine
background and the Docker Desktop networking toggles OpenShell needs are in
[`docs/setup-guide.md`](../setup-guide.md) §2; the OpenShell
[support matrix](https://docs.nvidia.com/openshell/about/support-matrix.md)
lists supported hosts.

### OpenShell CLI + gateway

Install via the upstream installer (CLI, policy prover, and local gateway in
one step; details in the OpenShell
[installation doc](https://docs.nvidia.com/openshell/about/installation.md)):

```sh
curl -LsSf https://raw.githubusercontent.com/NVIDIA/OpenShell/main/install.sh \
  | OPENSHELL_VERSION=v0.1.5 sh
openshell status
```

If `openshell status` is not `Connected`, restart the gateway service and
re-verify before proceeding — never continue on a disconnected gateway:

```sh
brew services restart openshell             # macOS
systemctl --user restart openshell-gateway  # Linux
```

### Maki CLI

```sh
curl -LsSf https://maki.sh/install.sh | sh
maki --version
```

The host Maki must be the release pinned by
[`examples/maki-image/Dockerfile`](../../examples/maki-image/Dockerfile)
(`ARG MAKI_VERSION`); Maki's [quick start](https://maki.sh/docs/quick-start/)
covers other install options. Never run `maki auth login` inside a sandbox
(see the invariants below). On the host, sessions get model credentials from
OpenShell provider profiles — Phase 3's wizard imports the key from wherever
you keep it, including Maki's or OpenCode's own store.

### Verify

```sh
docker version --format '{{.Server.Version}}'
openshell status
maki --version
```

Expected: `28.0` or later; `Status: Connected`; `maki 0.6.4`. Stop on any
mismatch.

## Phase 3 — Repository and helper setup

Clone this repository and work from its root:

```sh
git clone <repository-url> maki-oss
cd maki-oss
```

Run the executable preflight. On a fresh machine the image check fails until
the next step builds it; every other check must read `ok` — a `warn` line
about a missing `jq` is harmless (`jq` is optional, see
[`docs/helper.md`](../helper.md)):

```sh
./bin/maki-oss doctor
```

Build the sandbox image (bakes the pinned Maki release) and verify it:

```sh
./bin/maki-oss image build
docker run --rm maki-agent:local maki --version
```

The one-time provider wizard needs one input: a model API key — exported in
the environment, or already stored by Maki or OpenCode. It scans those
credential stores, lints and imports a profile, and creates the provider; the
credential never appears in argv, output, or this repository:

```sh
./bin/maki-oss provider setup
```

Without a terminal, name the credential instead of waiting for prompts:
`--from STORE --credential SLUG --yes`, `--env VAR`, or `--file PATH` — the
full flag table is in [`docs/providers.md`](../providers.md).

One provider is enough to start. To migrate a host that already holds many
credentials — audit both stores, classify each slug, and re-sync after a key
rotates — follow [`docs/dogfood-migration.md`](../dogfood-migration.md).

### Verify

```sh
./bin/maki-oss doctor
openshell provider list
```

Expected: every doctor line reads `ok` and it exits `0` (the image now
exists); the provider list names the provider you created. Stop on any
failure.

## Phase 4 — Shell preparation

Choose exactly one primary path per shell; verify it before moving on.

**zsh (and other POSIX shells)** — put the repository's `bin/` on `PATH`
(for example in `~/.zshrc`):

```sh
export PATH="/absolute/path/to/maki-oss/bin:$PATH"
```

**fish** — from the repository root, let the helper symlink its own function
and completions. It needs no plugin manager and works before `maki-oss`
resolves anywhere:

```sh
./bin/maki-oss fish install
```

With fisher already installed, `fisher install ./fish` installs the same
plugin; fisher copies the files instead of symlinking them, so put the
repository's `bin/` on `PATH` (as for zsh) or set `MAKI_OSS_BIN` below.

**Fallback:** if neither the `PATH` entry nor the fish function resolves the
helper, set `MAKI_OSS_BIN` to the absolute path of this repository's
`bin/maki-oss` — the wrapper resolves `$MAKI_OSS_BIN` first, then the source
repository, then `PATH`.

### Verify

POSIX shells (zsh, bash, …) — run this block:

```sh
command -v maki-oss
```

fish — run this block:

```sh
fish -c 'type -q maki-oss'                   # the fish function resolves
ls ~/.config/fish/completions/maki-oss.fish  # completions installed
```

Expected: `command -v maki-oss` (POSIX) or the fish check resolves to this
repository's `bin/maki-oss`, and the fish completion file exists. Run each
block only in the shell it names — `type -q` is a fish builtin and errors
under zsh and bash. Stop on any mismatch.

## Phase 5 — Daily driver

**Once per machine** (completed in Phase 3; listed here only to keep it
separate from the loop): `maki-oss doctor`, `maki-oss image build`,
`maki-oss provider setup`.

**Every project** — the everyday loop:

```sh
cd ~/code/myproject
maki-oss                              # interactive session
maki-oss run "fix the failing tests"  # headless variant
maki-oss status                       # project sandbox state
maki-oss stop                         # park the sandbox
maki-oss rm                           # delete it (prompts; --yes non-interactive)
```

Bare `maki-oss` creates or reuses the project sandbox, uploads the project on
first creation, attaches remembered providers, launches Maki, and syncs
changes back into the project directory on exit (`--no-sync` opts out). A
reused sandbox is not re-uploaded — run `maki-oss upload` first to refresh it
from the current host tree. Full reference: [`docs/helper.md`](../helper.md).

Every session enables the in-sandbox policy advisor and, on the way out,
checks for pending network-rule proposals. If the agent asked for an endpoint
that was denied, or OpenShell auto-drafted a rule from a blocked connection,
the helper prints a note with the count and how to review it:

```sh
maki-oss policy review                 # list pending proposals with verdicts
maki-oss policy approve <chunk-id>     # grant exactly that one (confirms first)
maki-oss policy reject <chunk-id> --reason "Scope this to docs/ paths only."
```

Approvals never happen on their own — the helper has no bulk or automatic
approval, so deny-by-default is unchanged. An agent that submitted a proposal
waits for your decision, so approving mid-session lets it retry the same
request in the same session; rejecting sends your reason back so it can narrow
or stop. Keep every project a git repo with its dependency directories
gitignored (see the agent playbook) so uploads stay small and the exit sync
never drags a `.venv` or `node_modules` back into the host tree.

### Verify

```sh
cd ~/code/myproject
maki-oss status
```

Expected: `Exists: yes` with the project sandbox's phase and attached
providers. `Exists: no` (with a non-zero exit) means no sandbox was created
yet, or the loop's `rm` deleted it — run `maki-oss up` to create one, or
`maki-oss` to start a session. Stop on any other mismatch.

### Handoff

Sandbox phases — provider profiles, policy choice, sandbox creation, isolation
checks, and running Maki with the raw commands — continue in
[`docs/ai/agent-playbook.md`](agent-playbook.md). This playbook ends here by
design; do not improvise sandbox steps from this file.

## Invariants (never relax these to make a command work)

- No host bind mounts — project files move with upload/download.
- No secrets through `--env`; credentials come from provider profiles only.
- Egress stays deny-by-default; add the narrowest missing rule, never a
  wildcard or `tls: skip`, to fix a denial.
- Sandbox processes stay non-root (uid/gid 1500).
- Never run `maki auth login` inside a sandbox, and never set a provider
  base-URL override there.
