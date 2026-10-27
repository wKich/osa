# Playbook: Maki

| Field | Value |
|---|---|
| Doc | `playbook-maki` |
| Kind | `playbook` |
| Agent | `Maki` |
| Covers | `P0-P8` |
| Preconditions | `docs/ai/host-playbook.md` `P0-P2` |
| Handoff | `docs/ai/verification/maki.md` |
| Verification | `docs/ai/verification/maki.md` |
| Reference | `docs/ai/reference/maki.md` |
| Verified | OpenShell v0.1.5, Maki v0.6.5, 2026-10-25 |

> **Maki path; return to onboarding for OpenCode, Claude, or Codex** — [open the
> onboarding guide](../onboarding.md).

## Scope

Ordered, executable steps for a coding agent. Run every command from the
repository root. After each phase, run its verification and stop on a
mismatch — do not work around a failed check by weakening isolation.

If a denial blocks the task, read `docs/setup-guide.md` §8 and
`docs/ai/references.md` before changing anything. Never relax an invariant
listed at the end of this file.

## Inputs

- A model API key — exported in the environment, or already present in a Maki
  or OpenCode credential store.
- The project path to upload (optional; skip the upload steps to work in an
  empty workspace).

## Phase 0 — Preflight

### Run

```sh
docker version --format '{{.Server.Version}}'
openshell status
maki --version
uname -m
```

The host Maki CLI is checked here even though sessions run the binary baked
into the image. If `maki --version` is missing, install it with the Maki install
script listed in [`docs/ai/references.md`](../references.md), then re-check.
The image pin stays authoritative for sandbox runs.

Then choose the provider (decision point A):

- If `maki-oss` is available, prefer the wizard: run `maki-oss provider setup`
  (interactive) or `maki-oss provider setup --from maki --credential <slug>
  --yes` for a credential already in a store. It imports the curated profile
  and creates the provider, so skip Phase 2's raw provider commands; Phase 1
  still builds the image.
- Otherwise map an exported key to its curated profile:
  - `ANTHROPIC_API_KEY` → `examples/providers/maki-anthropic.yaml`, type
    `maki-anthropic`
  - `OPENROUTER_API_KEY` → `examples/providers/maki-openrouter.yaml`, type
    `maki-openrouter`
  - `DEEPSEEK_API_KEY`, `SYNTHETIC_API_KEY`, `OPENAI_API_KEY`,
    `GEMINI_API_KEY`, `MISTRAL_API_KEY`, `XAI_API_KEY`, `ZHIPU_API_KEY`, or
    `OPENCODE_API_KEY` → the matching `maki-*` profile under
    `examples/providers/`; use the catalog table in `docs/providers.md` to
    pick between plans (for example Z.AI coding vs standard).
- If no key is available, stop and ask the user to export one or to run
  `maki-oss provider setup`. Do not accept a key pasted into the conversation,
  and do not put a key on a command line.

OAuth-only credentials (for example a ChatGPT or xAI OAuth login) are not
usable here; report that and point at `docs/migrating-providers.md` instead of
extracting tokens.

### Verify

Expected: Docker `28.0` or later; `openshell status` shows
`Status: Connected`; `maki --version` prints `maki 0.6.5` (the version pinned
by `examples/maki-image/Dockerfile`); `uname -m` is a supported architecture
(`arm64` or `x86_64`).

### Stop if

A preflight command mismatches, the host Maki CLI cannot be installed at the
pinned version, no usable key is available, or the only credential is
OAuth-only. Ask the user for an exported key or a store credential; do not
extract tokens or accept a key in the conversation.

## Shell preparation

Run this after the shared host playbook has put the repository's `bin/` on
`PATH`, and before the helper alternatives in Phases 1-2. Choose exactly one
primary path per shell; verify it before moving on.

### Run

**zsh (and other POSIX shells)** — the shared page already adds `bin/` to
`PATH`; no Maki-specific step is needed beyond that. If the repository moved,
update the `PATH` entry.

**fish** — from the repository root, let the helper symlink its own function
and completions. It needs no plugin manager and works before `maki-oss`
resolves anywhere:

```sh
./bin/maki-oss fish install
```

With fisher already installed, `fisher install ./fish` installs the same
plugin; fisher copies the files instead of symlinking them, so put the
repository's `bin/` on `PATH` (as for zsh) or set `MAKI_OSS_BIN` below.

**Fallback:** if neither the `PATH` entry nor the fish function resolves
`maki-oss`, set `MAKI_OSS_BIN` to the absolute path of this repository's
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
under zsh and bash.

### Stop if

The helper resolves to another installation or the fish completion is missing.
Report which path or shell failed; do not mix the two shell paths.

## Phase 1 — Build the image

### Run

```sh
docker build --build-arg MAKI_VERSION=0.6.5 -t maki-agent:local examples/maki-image
docker run --rm maki-agent:local maki --version
IMAGE=maki-agent:local
REPO_ROOT=$(pwd)
```

Or use the helper's thin wrapper for the build, then verify with the helper:

```sh
./bin/maki-oss image build
./bin/maki-oss doctor
```

The base image is agent-only: no MCP servers, no MCP-specific runtime, and no
personal UI preferences. It starts every Maki session in YOLO mode because
OpenShell, not Maki, is the permission boundary; the baked deny rules still
apply. If the task needs a server, runtime, or UI preference, build an
environment image on top and use its tag instead of the base:

```sh
docker build -t maki-agent:reference examples/environments/reference
IMAGE=maki-agent:reference
```

For a user-owned store, follow the environment playbook
([`docs/ai/environment-playbook.md`](../environment-playbook.md)); never edit
`examples/maki-image/` for a personal choice. Set the same tag in the helper's
`image` setting when using `maki-oss`.

### Verify

Expected: the build succeeds and prints `maki 0.6.5`; `./bin/maki-oss doctor`
exits `0` (its image check now passes) and every line reads `ok` except the
optional `jq` warning; when a derived image is used, its tag matches the
helper's `image` setting.

### Stop if

The build fails, the printed version is not `maki 0.6.5`, or `maki-oss doctor`
reports `warn` or `fail` for anything except the optional `jq` warning. Report
the build or doctor output and the pinned version instead of tagging the image
as current.

## Phase 2 — Load the provider profile and create the provider

### Run

If Phase 0 used `maki-oss provider setup`, the lint, import, and provider
creation already happened; run the verification commands below. Otherwise
substitute the profile file, type, and provider name chosen in Phase 0; the
example uses `maki-anthropic`:

```sh
PROVIDER=maki-anthropic
openshell profile lint -f examples/providers/maki-anthropic.yaml
openshell profile import -f examples/providers/maki-anthropic.yaml --global
openshell provider create --name maki-anthropic --type maki-anthropic --from-existing
```

Or run the helper wizard, which lints and imports the curated profile and
creates the provider:

```sh
./bin/maki-oss provider setup
```

Without a terminal, name the credential instead of waiting for prompts:
`--from STORE --credential SLUG --yes`, `--env VAR`, or `--file PATH` — the
full flag table is in [`docs/providers.md`](../../providers.md).

### Verify

```sh
openshell profile describe maki-anthropic
openshell provider list
```

Expected: the profile shows the provider's endpoint and binary
(`api.anthropic.com:443` and `/usr/local/bin/maki` for this example); the
provider list names the instance and exposes credential key names only (never
values).

### Stop if

`provider create` fails, the profile is missing, or the provider list shows a
credential value. Report the command and output; do not retry with a key on
the command line.

## Phase 3 — Choose the sandbox policy

### Run

Default: `examples/policies/maki-minimal.yaml` (no network rules of its own;
the provider adds the model endpoint).

Decision point B — does the task need `git push` to GitHub?

- No: keep `maki-minimal.yaml`.
- Yes: copy `examples/policies/maki-git-push.yaml` to a scratch file, replace
  its two repository placeholders (owner and repository name, case-sensitive),
  and import/attach the upstream `github` profile plus a GitHub provider for
  credentials.

Policy choice is fixed into the sandbox at creation; network rules can be
changed later with `openshell policy set`.

### Verify

```sh
test -f "$REPO_ROOT/examples/policies/maki-minimal.yaml"
```

Expected: the default policy exists and, when `git push` is required, the
scratch copy has both repository placeholders replaced.

### Stop if

`git push` is required and the scratch policy still contains the repository
placeholders. Report the missing decision instead of creating the sandbox with
the template policy.

## Phase 4 — Create the sandbox

### Run

Decision point C — is there a project to upload?

Before uploading, make the project a git repo with its dependency directories
gitignored. `openshell sandbox upload` applies `.gitignore` filtering only
inside a git work tree and warns when it uploads everything, so an un-ignored
`.venv`, `node_modules`, or `target` directory is copied into the sandbox at
full size — a macOS `.venv` round-tripped 491 MB of useless, non-executable
files into a Linux sandbox once. The session patch does not bring ignored files
back, but the upload still pays for them in time and disk. Ignore the
dependency directories so the upload carries only the source.

```sh
cd "$PROJECT_PATH"
git init
printf '.venv/\nnode_modules/\ntarget/\n__pycache__/\n' >>.gitignore
git add -A && git commit -qm init
```

```sh
# With a project (uploads require the create command to have no trailing
# main command; Maki is launched later with sandbox exec):
WORKDIR=/sandbox/project/$(basename "$PROJECT_PATH")
openshell sandbox create --name maki \
  --from "$IMAGE" \
  --policy "$REPO_ROOT/examples/policies/maki-minimal.yaml" \
  --provider "$PROVIDER" \
  --upload "$PROJECT_PATH:/sandbox/project"

# Without a project:
WORKDIR=/sandbox/project
openshell sandbox create --name maki \
  --from "$IMAGE" \
  --policy "$REPO_ROOT/examples/policies/maki-minimal.yaml" \
  --provider "$PROVIDER"
```

`--upload "$PROJECT_PATH:/sandbox/project"` lands the project at
`/sandbox/project/<basename>`, which is why `WORKDIR` includes the basename.
Phases 6-7 use `$WORKDIR`; without a project it is `/sandbox/project`.

### Verify

```sh
openshell sandbox list
openshell policy get maki --full
```

Expected: the sandbox reaches `Ready`; the effective policy contains
`/usr/local/bin/maki -> api.anthropic.com:443` contributed by the provider
(`_provider_*` rule). A missing provider rule means the provider attachment
failed.

### Stop if

The sandbox does not reach `Ready`, or the effective policy lacks the provider
rule. Report both outputs; do not attach a broader policy to fix it.

## Phase 5 — Run the isolation checks

### Run

Execute every check in [`docs/ai/verification/maki.md`](../verification/maki.md)
and record each command and output.

### Verify

Expected: every check in
[`docs/ai/verification/maki.md`](../verification/maki.md) reports its stated
result.

### Stop if

Any check fails or reports an unexpected value. Report the command and output;
do not weaken isolation to continue.

## Phase 6 — Run Maki

### Run

Smoke test first (cheap, proves model access end to end):

```sh
openshell sandbox exec -n maki --workdir "$WORKDIR" --no-login-shell -- \
  maki -p "Reply with OK." --output-format json
```

Then run the real task the same way: pass the user's task text as the argument
to `-p` in place of the smoke-test string.

`sandbox exec` starts a new process, so it picks up the current provider
placeholders. Use `--output-format json` for machine-readable results.

#### Helper shortcut

If `maki-oss` is available (from this repository), it performs Phases 2–7 —
except cleanup — in one command per project. The one-time setup and the
everyday session loop are in [`## Daily driver`](#daily-driver) below.

The helper still uses provider profiles and the minimal policy, and never
relaxes the invariants below. Use the raw commands when you need explicit
control or are debugging the boundary itself.

### Verify

Expected: the smoke-test JSON reports a successful turn with the reply `OK`;
the real task exits `0` and its JSON contains a result rather than an error.

### Stop if

The smoke test fails or reports a network or policy denial. Report the JSON and
the policy decision; do not retry with a broader rule.

## Phase 7 — Collect results and clean up

### Run

```sh
openshell sandbox download maki "$WORKDIR" ./project-out
openshell sandbox delete maki
```

Downloads are limited to paths inside the sandbox working directory — keep
results under `/sandbox`. When the project was run through `maki-oss`, the
session already collected a patch at exit; this download is the explicit
full-copy escape hatch, not the default sync path.

### Verify

```sh
ls ./project-out
openshell sandbox list
```

Expected: `./project-out` contains the downloaded project files, and the
sandbox list no longer names `maki`.

### Stop if

The download fails or the sandbox still exists after deletion. Report the
command and output; do not delete or overwrite host files to force a clean
state.

## Daily driver

This is the everyday Maki loop once the one-time setup and the phases above
have been verified. The raw commands in Phases 6-7 remain the explicit-control
path.

### Run

**Once per machine** (completed in Shell preparation and Phases 1-2; listed
here only to keep it separate from the loop): `maki-oss doctor`,
`maki-oss image build`, an optional environment-store build,
`maki-oss provider setup`, and setting `image` when a derived environment image
is used.

**Every project** — the everyday loop:

```sh
cd ~/code/myproject
maki-oss                              # interactive session
maki-oss run "fix the failing tests"  # headless variant
maki-oss status                       # project sandbox state
maki-oss stop                         # park the sandbox
maki-oss rm                           # delete it (prompts; --yes non-interactive)
```

Bare `maki-oss` creates or reuses the project sandbox, refreshes the disposable
project workspace when the host tree moved, attaches remembered providers,
launches Maki, and on exit collects the sandbox changes as a patch. A clean
repository is fast-forwarded; a dirty, moved, or older sandbox keeps the patch
or a review branch instead of overwriting host files (`--no-sync` opts out). A
retained patch never blocks the next session; a parked workspace (collection
failed or `--no-sync`) refuses the next session until you download or discard
it. `maki-oss status` prints the sync state and the next command. Full
reference: [`docs/helper.md`](../../helper.md).

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
gitignored (see Phase 4) so uploads stay small; the patch sync only carries
tracked changes and never drags a `.venv` or `node_modules` back into the host
tree.

### Verify

```sh
cd ~/code/myproject
maki-oss status
```

Expected: `Exists: yes` with the project sandbox's phase and attached
providers. `Exists: no` (with a non-zero exit) means no sandbox was created
yet, or the loop's `rm` deleted it — run `maki-oss up` to create one, or
`maki-oss` to start a session.

### Stop if

`maki-oss status` reports a parked workspace, a failed sync, or any state
other than `Exists: yes` after the create or start command. Report the sync
state and the helper's next-command hint.

## Handoff

The path ends with the sandbox deleted and results on the host. Report the
commands that ran, the verification results, any retained patch, and the next
action; do not start a new sandbox to fix a report.

## Invariants (never relax these to make a command work)

- No host bind mounts. Move files with `sandbox upload` / `sandbox download`.
- No secrets via `openshell sandbox create --env`/`--env-from` or
  `sandbox exec --env`/`--env-from`. Credentials come from provider profiles
  only.
- Egress stays deny-by-default. Add the narrowest missing rule, never `tls:
  skip`, `access: full`, or a wildcard host to fix a denial.
- The sandbox process stays non-root (uid/gid 1500).
- Never run `maki auth login` inside a sandbox, and never set a provider
  base-URL override there (for example `ANTHROPIC_BASE_URL`,
  `OPENROUTER_BASE_URL`, or `DEEPSEEK_BASE_URL`).
- Do not edit `examples/` to match a failing local state; fix the local state
  or report the drift.

## See also

- [`docs/ai/host-playbook.md`](../host-playbook.md) — shared host prerequisites
  P0-P2, preceding this path.
- [`docs/ai/reference/maki.md`](../reference/maki.md) — Maki configuration,
  profiles, MCP, and store shape.
- [`docs/ai/environment-playbook.md`](../environment-playbook.md) — personal
  runtimes, MCP servers, and preferences on top of the base image.
- [`docs/ai/verification/maki.md`](../verification/maki.md) — isolation
  checklist used by Phase 5.
- [`docs/helper.md`](../../helper.md) — `maki-oss` command reference and the
  helper shortcut.
- [`docs/ai/references.md`](../references.md) — upstream documentation index.
- [`docs/ai/document-contract.md`](../document-contract.md) — page shape used by
  this playbook.
