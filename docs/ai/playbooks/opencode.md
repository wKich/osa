| Field | Value |
|---|---|
| Doc | `playbook-opencode` |
| Kind | `playbook` |
| Agent | `OpenCode` |
| Covers | `P3-P8` |
| Preconditions | `docs/ai/host-playbook.md` `P0-P2` |
| Handoff | `docs/ai/verification/opencode.md` |
| Verification | `docs/ai/verification/opencode.md` |
| Reference | `docs/ai/reference/opencode.md` |
| Verified | OpenShell v0.1.5, OpenCode v2.1.4, 2026-10-25 |

# Playbook: OpenCode

> **OpenCode path; return to onboarding for Maki or Claude** — [open the
> onboarding guide](../onboarding.md).

## Scope

Ordered, executable steps for running OpenCode in a per-project OpenShell
sandbox. This page starts at P3 and ends at P8; the shared host prerequisites
(engine, OpenShell CLI and gateway, repository, and `bin/` on `PATH`) are in
[`docs/ai/host-playbook.md`](../host-playbook.md). The OpenCode CLI is baked
into the image, so there is no host agent install.

The `opencode-oss` helper is the primary path. The image, provider, sandbox,
run, and cleanup phases show the raw `docker` and `openshell` commands for
scripting or boundary debugging; the policy and isolation phases are checks
and decisions.
Run every command from the repository root unless a phase says otherwise.
After each phase, run its verification and stop on a mismatch — do not work
around a failed check by weakening isolation.

OpenCode-specific configuration, sessions, MCP, and store details are in
[`docs/ai/reference/opencode.md`](../reference/opencode.md). Shared helper
behavior is in [`docs/helper.md`](../../helper.md), provider profiles in
[`docs/providers.md`](../../providers.md), and MCP in
[`docs/mcp-migration.md`](../../mcp-migration.md).

## Inputs

- A model API key in the host environment or an OpenCode or Maki credential
  store. `provider setup` maps it to an `opencode-*` profile and prints that
  profile's example model.
- The project path to upload (optional; skip the upload steps to work in an
  empty sandbox workspace).
- The pinned OpenCode version is `2.1.4` from
  [`opencode-oss/image/Dockerfile`](../../../opencode-oss/image/Dockerfile);
  no host OpenCode CLI is required.

Never ask for a credential value in the conversation, and never put one on a
command line.

## Phase 1 — Build the image

### Run

Helper path:

```sh
./bin/opencode-oss image build
docker run --rm opencode-agent:local opencode --version
IMAGE=opencode-agent:local
```

Raw fallback:

```sh
docker build -t opencode-agent:local opencode-oss/image
docker run --rm opencode-agent:local opencode --version
IMAGE=opencode-agent:local
```

The base image is agent-only: pinned OpenCode `2.1.4`, uid/gid 1500, no
Node/Bun runtime, no MCP server, no plugin, and no credential. A personal
config, MCP server, plugin, or skill belongs in an environment image built
`FROM opencode-agent:local`; follow
[`docs/ai/environment-playbook.md`](../environment-playbook.md) and select the
derived tag through the helper's `image` setting. Never edit
`opencode-oss/image/` for a personal choice.

The Dockerfile checks a pinned sha512 for each architecture. A version bump
needs `--opencode-version V` (or `OPENCODE_VERSION=V`) and both
`OPENCODE_SHA512_*` values; see
[`opencode-oss/README.md`](../../../opencode-oss/README.md#1-build-the-image).
Without the matching checksums the build fails rather than skipping the check.

### Verify

Expected: `opencode-oss image build` prints
`Built image 'opencode-agent:local'.`; `docker run --rm opencode-agent:local
opencode --version` prints `opencode v2.1.4`; and
`opencode-oss doctor` reports the image as `ok` (the provider and model
checks are completed in Phase 2).

### Stop if

The build fails, the printed version is not `opencode v2.1.4`, or a checksum
fails. Report the build output and the pinned version instead of tagging the
image as current.

## Phase 2 — Load the provider profile and create the provider

### Run

Decision point A — choose the credential source. The helper reads an exported
host variable, an OpenCode or Maki credential store, a JSON file, or a hidden
prompt, and maps the result to the curated `opencode-*` profile:

```sh
./bin/opencode-oss provider setup --from opencode --credential synthetic --yes
# or, with the key already exported on the host:
./bin/opencode-oss provider setup --env SYNTHETIC_API_KEY --yes
```

The wizard lints and imports the profile, creates or reuses the provider, and
prints the profile's example model. Make that model the default, or pass it per
session:

```sh
mkdir -p "${XDG_CONFIG_HOME:-$HOME/.config}/opencode-oss"
# model = "synthetic/hf:zai-org/GLM-5.3" in .../opencode-oss/config.toml
PROVIDER=opencode-synthetic
MODEL=synthetic/hf:zai-org/GLM-5.3
```

Without a terminal, the non-interactive forms are `--from STORE --credential
SLUG --yes`, `--env VAR`, and `--file PATH`; the full table is in
[`docs/providers.md`](../../providers.md).

Raw fallback for the Synthetic profile:

```sh
openshell profile lint -f opencode-oss/providers/opencode-synthetic.yaml
openshell profile import -f opencode-oss/providers/opencode-synthetic.yaml --global
# SYNTHETIC_API_KEY is already exported in the host environment; the key is
# never placed on the command line.
openshell provider create --name opencode-synthetic \
  --type opencode-synthetic --from-existing --global-profile
```

Substitute the profile file, provider name, and type chosen in Decision point
A. Every `opencode-*` profile binds only `/usr/local/bin/opencode`, and an
OpenCode sandbox attaches `opencode-<name>`, not `maki-<name>`. A slug with no
curated profile falls through to a generated custom profile; keep the
`opencode-` prefix.

### Verify

```sh
openshell profile describe opencode-synthetic
openshell provider list
```

Expected: the profile shows `api.synthetic.new:443` and
`/usr/local/bin/opencode`; the provider list names `opencode-synthetic` and
exposes credential key names only, never values.

### Stop if

`provider create` fails, the profile is missing, or the provider list shows a
credential value. Report the command and output; do not retry with a key on
the command line, and do not set a provider base-URL override in the sandbox.

## Phase 3 — Choose the sandbox policy

### Run

Default: `opencode-oss/policies/minimal.yaml`. It grants read-write access only
to `/sandbox`, `/tmp`, and the `/dev/null` sink, keeps system paths read-only,
requires Landlock, runs as uid/gid 1500, and grants no network egress of its
own. The provider from Phase 2 contributes the model endpoint.

Decision point B — does the task need an endpoint outside the attached
provider profile? If yes, add the narrowest explicit policy rule and a
provider for its credential; never widen the policy to a wildcard, `tls:
skip`, or `access: full`. Policy choice is fixed into the sandbox at creation;
later changes use `openshell policy set`.

There is no shipped `opencode-git-push` policy. A task that needs `git push`
can copy `examples/policies/maki-git-push.yaml` to a scratch file, replace its
`<org>`/`<repo>` placeholders, and attach a GitHub provider for credentials, as
in [`docs/setup-guide.md`](../../setup-guide.md) §5, or stop and report.

### Verify

```sh
test -f opencode-oss/policies/minimal.yaml
! grep -q '^network_policies:' opencode-oss/policies/minimal.yaml
```

Expected: the default policy exists and contains no `network_policies` block
of its own.

### Stop if

The policy is missing, it already contains network rules, or the task needs an
endpoint that neither the policy nor the provider covers. Report the missing
endpoint and decision instead of creating the sandbox with a broader policy.

## Phase 4 — Create the sandbox

### Run

Helper path, from the project directory:

```sh
cd "$PROJECT_PATH"
opencode-oss up
```

`opencode-oss up` creates or starts the project sandbox with the configured
image, policy, and provider. The first session uploads the workspace; `up`
does not. With no project, run the same command from an empty directory you
own.

Raw fallback. Make the project a git repository with its dependency
directories gitignored before uploading; `openshell sandbox upload` applies
`.gitignore` filtering only inside a git work tree:

```sh
cd "$PROJECT_PATH"
git init
printf '.venv/\nnode_modules/\ntarget/\n__pycache__/\n' >>.gitignore
git add -A && git commit -qm init
```

```sh
SANDBOX=opencode
WORKDIR=/sandbox/project/$(basename "$PROJECT_PATH")
openshell sandbox create --name "$SANDBOX" \
  --from "$IMAGE" \
  --policy opencode-oss/policies/minimal.yaml \
  --provider "$PROVIDER" \
  --upload "$PROJECT_PATH:/sandbox/project"
```

`--upload "$PROJECT_PATH:/sandbox/project"` lands the directory at
`/sandbox/project/<basename>`, which is why `WORKDIR` includes the basename.
Without a project, omit `--upload` and set `WORKDIR=/sandbox/project`.

The helper names its sandbox `oc-<project>-<hash>`; the raw example uses
`opencode`. A provider is normally attached at creation; if it is missing,
`opencode-oss provider attach` can attach it later. A missing provider rule in
the effective policy means the attachment failed; the command is in
[`docs/helper.md`](../../helper.md#provider-add--attach--list).

### Verify

```sh
openshell sandbox list
openshell policy get "$SANDBOX" --full
```

Expected: the sandbox reaches `Ready`; the effective policy contains a
provider rule for `api.synthetic.new:443` bound to `/usr/local/bin/opencode`
and no other egress. Under the helper, `opencode-oss status` also reports
`Exists: yes`.

### Stop if

The sandbox does not reach `Ready`, the effective policy lacks the provider
rule, or it contains an endpoint you did not choose. Report both outputs; do
not attach a broader policy to fix it.

## Phase 5 — Run the isolation checks

### Run

Execute every check in
[`docs/ai/verification/opencode.md`](../verification/opencode.md) with the
OpenCode substitutions: sandbox `"$SANDBOX"` (under the helper, take the name
from `opencode-oss status`), provider `opencode-synthetic`, the profile's
credential variable (`SYNTHETIC_API_KEY`), and the agent binary
`/usr/local/bin/opencode`. Then, from the project directory, check MCP
readiness:

```sh
opencode-oss mcp status
```

`mcp status` compares the servers enabled under the host's `mcp` key with the
sandbox's `/sandbox/.config/opencode/opencode.json`. The base image declares
no MCP server, so a server present only on the host is reported
`sandbox=missing` with the `FROM opencode-agent:local` fix, and the command
exits 3; that is an environment-store task, not an isolation failure. Details
are in [`docs/ai/reference/opencode.md`](../reference/opencode.md#mcp)
and [`docs/mcp-migration.md`](../../mcp-migration.md).

### Verify

Expected: every check in
[`docs/ai/verification/opencode.md`](../verification/opencode.md) reports its
stated result (uid 1500, a denied non-profile host, no host paths, the
provider-only effective policy, and no credential value); `opencode-oss mcp
status` exits 0 when the host declares no MCP server, or reports each missing
server without changing the sandbox.

### Stop if

Any isolation check fails or reports an unexpected value. Report the command
and output; do not weaken isolation to continue, and do not install a missing
MCP runtime into the running sandbox.

## Phase 6 — Run OpenCode

### Run

Helper path, smoke test first:

```sh
cd "$PROJECT_PATH"
opencode-oss run "Reply with OK."
opencode-oss run --continue "and now?"   # resumes the same session
```

Then run the real task the same way: pass the user's task text in place of the
smoke-test string. The helper prints OpenCode's JSON events unchanged and
closes stdin, so a run cannot wait forever. Bare `opencode-oss` starts the TUI
on the configured model. Session options are `--continue`, `--resume ID`, and
`--session-id ID`; model selection is `--model provider/model`, the
`OPENCODE_OSS_MODEL` variable, or the config file's `model`.

Raw fallback, headless:

```sh
openshell sandbox exec -n "$SANDBOX" --workdir "$WORKDIR" --no-login-shell \
  --env OPENCODE_DISABLE_MODELS_FETCH=1 -- \
  opencode run --standalone --auto --format json \
  --model "$MODEL" "Reply with OK." </dev/null
```

Raw fallback, TUI:

```sh
openshell sandbox exec -n "$SANDBOX" --tty --workdir "$WORKDIR" --no-login-shell \
  --env OPENCODE_DISABLE_MODELS_FETCH=1 -- \
  opencode --standalone
```

OpenCode's traps are part of the command, not optional style:

- **`--standalone` on every exec.** Without it OpenCode starts a long-lived
  background service in the sandbox and writes a `service.json` with that
  service's password under `/sandbox`.
- **`</dev/null` for headless runs.** `opencode run` reads stdin when it is
  not a terminal, and `sandbox exec` leaves stdin open; without the redirect
  the run waits forever.
- **`--auto` on `run` only.** It approves tool calls the baked config does not
  deny. The TUI asks instead; automatic approval there is a `permissions`
  preference in a derived environment image.
- **TUI model selection.** The TUI has no model flag. Pick a model the
  profile covers with `/models`, or put it in the project's own
  `opencode.json`; the helper instead passes a one-exec
  `OPENCODE_CONFIG_CONTENT` overlay. With no model, OpenCode uses its free
  tier, which the sandbox denies.
- **`OPENCODE_DISABLE_MODELS_FETCH=1` on every exec.** `sandbox exec` does not
  pass image `ENV` through, so the switch must travel per exec; then OpenCode
  does not try `models.opencode.ai`.
- **No in-sandbox authentication.** Do not run `opencode auth login`, and do
  not set a provider base-URL override. OAuth-only logins have no path here.

### Verify

Expected: the smoke-test JSON contains a `text` event with the reply `OK` and
exits 0; a continued run reuses the same session ID; the real task exits 0 and
its JSON contains a result rather than an error; the TUI renders and answers
with the configured model.

### Stop if

The smoke test fails or reports a network or policy denial. Report the JSON and
the policy decision; do not retry with a broader rule or an in-sandbox login.

## Phase 7 — Collect results and clean up

### Run

Helper path, from the project directory:

```sh
cd "$PROJECT_PATH"
opencode-oss status
opencode-oss rm --yes
```

Bare `opencode-oss` and `opencode-oss run` collect the sandbox changes as a
patch on exit and apply it only when the sandbox baseline still matches the
host; `--no-sync` opts out. A retained patch never blocks the next session.
`opencode-oss rm` asks for confirmation unless `--yes` is passed.

Raw fallback:

```sh
openshell sandbox download "$SANDBOX" "$WORKDIR" ./project-out
openshell sandbox delete "$SANDBOX"
```

Downloads are limited to paths inside the sandbox working directory. There is
no bind mount and no automatic sync on the raw path; only what you download
leaves the sandbox.

### Verify

```sh
ls ./project-out
openshell sandbox list
```

Expected: `./project-out` contains the downloaded project files, and the
sandbox list no longer names `"$SANDBOX"`. Under the helper, `opencode-oss
status` reports `Exists: no`.

### Stop if

The download fails or the sandbox still exists after deletion. Report the
command and output; do not delete or overwrite host files to force a clean
state.

## Handoff

The path ends with the sandbox deleted and results on the host. The verification
record for the pinned OpenCode and OpenShell versions is
[`docs/ai/verification/opencode.md`](../verification/opencode.md).
Report the commands that ran, the verification results, any retained patch, and
the next action; do not start a new sandbox to fix a report.

## Invariants

Never relax these to make a command work:

- No host bind mounts. Move files with `sandbox upload` / `sandbox download`.
- No secrets via `openshell sandbox create --env`/`--env-from` or
  `sandbox exec --env`/`--env-from`. Credentials come from provider profiles
  only; non-secret switches such as `OPENCODE_DISABLE_MODELS_FETCH=1` are the
  exception.
- Egress stays deny-by-default. Add the narrowest missing rule, never `tls:
  skip`, `access: full`, or a wildcard host.
- The sandbox process stays non-root (uid/gid 1500).
- Never run `opencode auth login` inside a sandbox, and never set a provider
  base-URL override there. OAuth-only credentials have no path here.
- Never mount or upload the host's `~/.config/opencode/` or
  `~/.local/share/opencode/auth.json`. Global config belongs in an environment
  store; the project's own `opencode.json` and `.opencode/` upload with the
  project.
- Do not edit `opencode-oss/` or `examples/` to match a failing local state;
  fix the local state or report the drift.

## See also

- [`docs/ai/host-playbook.md`](../host-playbook.md) — shared host prerequisites
  P0-P2, preceding this path.
- [`docs/ai/reference/opencode.md`](../reference/opencode.md) — OpenCode
  configuration, profiles, sessions, MCP, and store shape.
- [`docs/ai/environment-playbook.md`](../environment-playbook.md) — personal
  runtimes, MCP servers, and preferences on top of the base image.
- [`docs/ai/verification/opencode.md`](../verification/opencode.md) — isolation
  checklist used by Phase 5.
- [`docs/helper.md`](../../helper.md) — `opencode-oss` and shared helper
  command reference.
- [`docs/providers.md`](../../providers.md) — provider profile catalog and
  setup flags.
- [`docs/mcp-migration.md`](../../mcp-migration.md) — MCP definitions and
  status.
- [`opencode-oss/README.md`](../../../opencode-oss/README.md) — the
  subproject, raw path, and verification summary.
- [`docs/ai/references.md`](../references.md) — upstream documentation index.
- [`docs/ai/document-contract.md`](../document-contract.md) — page shape used
  by this playbook.
