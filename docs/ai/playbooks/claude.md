| Field | Value |
|---|---|
| Doc | `playbook-claude` |
| Kind | `playbook` |
| Agent | `Claude` |
| Covers | `P3-P8` |
| Preconditions | `docs/ai/host-playbook.md` `P0-P2` |
| Handoff | `docs/ai/verification/claude.md` |
| Verification | `docs/ai/verification/claude.md` |
| Reference | `docs/ai/reference/claude.md` |
| Verified | OpenShell v0.1.5, Claude Code v2.1.308, 2026-10-26 |

# Playbook: Claude Code

> **Claude Code path; return to onboarding for Maki or OpenCode** — [open the
> onboarding guide](../onboarding.md).

## Scope

Ordered, executable steps for running Claude Code in a per-project OpenShell
sandbox. This page starts at P3 and ends at P8; the shared host prerequisites
(engine, OpenShell CLI and gateway, repository, and `bin/` on `PATH`) are in
[`docs/ai/host-playbook.md`](../host-playbook.md). The Claude Code CLI is baked
into the image, so there is no host agent install.

The `claude-oss` helper is the primary path. The image, provider, sandbox,
run, and cleanup phases show the raw `docker` and `openshell` commands for
scripting or boundary debugging; the policy and isolation phases are checks
and decisions. Run every command from the repository root unless a phase says
otherwise. After each phase, run its verification and stop on a mismatch — do
not work around a failed check by weakening isolation.

Claude-specific configuration, credentials, sessions, MCP, and store details
are in [`docs/ai/reference/claude.md`](../reference/claude.md). Shared helper
behavior is in [`docs/helper.md`](../../helper.md), provider profiles in
[`docs/providers.md`](../../providers.md), and the environment store in
[`docs/ai/environment-playbook.md`](../environment-playbook.md).

## Inputs

- A credential from the host, one of:
  - an Anthropic API key exported in the host environment or stored in a Maki
    or OpenCode credential store, which `provider setup` maps to
    `claude-anthropic`;
  - a Claude Pro/Max subscription token created on the host with
    `claude setup-token` and exported as `CLAUDE_CODE_OAUTH_TOKEN`, which maps
    to `claude-anthropic-oauth`.
- The project path to upload (optional; skip the upload steps to work in an
  empty sandbox workspace).
- The pinned Claude Code version is `2.1.308` from
  [`claude-oss/image/Dockerfile`](../../../claude-oss/image/Dockerfile). The
  image carries the CLI; the API-key path needs no host CLI. The
  subscription-token path uses the host `claude` CLI once to create the token.

Never ask for a credential value in the conversation, and never put one on a
command line. Never run `claude setup-token` in a sandbox.

## Phase 1 — Build the image

### Run

Helper path:

```sh
./bin/claude-oss image build
docker run --rm claude-agent:local claude --version
IMAGE=claude-agent:local
REPO_ROOT=$(pwd)
```

Raw fallback:

```sh
docker build -t claude-agent:local claude-oss/image
docker run --rm claude-agent:local claude --version
IMAGE=claude-agent:local
REPO_ROOT=$(pwd)
```

The base image is agent-only: pinned Claude Code `2.1.308`, uid/gid 1500, no
Node/Bun runtime, no MCP server, no plugin, no credential, and no Claude Code
login state. A personal setting, MCP server, or skill belongs in an
environment image built `FROM claude-agent:local`; follow
[`docs/ai/environment-playbook.md`](../environment-playbook.md) and select the
derived tag through the helper's `image` setting. Never edit
`claude-oss/image/` for a personal choice.

The Dockerfile checks a pinned SHA-256 for each architecture. A version bump
needs `--claude-version V` (or the `CLAUDE_VERSION` build argument) and both
`CLAUDE_SHA256_ARM64` and `CLAUDE_SHA256_AMD64` values; see
[`claude-oss/README.md`](../../../claude-oss/README.md#build-the-image).
Without the matching checksums the build fails rather than skipping the check.

### Verify

Expected: `claude-oss image build` prints `Built image 'claude-agent:local'.`;
`docker run --rm claude-agent:local claude --version` prints
`2.1.308 (Claude Code)`; and `claude-oss doctor` reports the image as `ok` (the
provider and model checks are completed in Phase 2).

### Stop if

The build fails, the printed version is not `2.1.308 (Claude Code)`, or a
checksum fails. Report the build output and the pinned version instead of
tagging the image as current.

## Phase 2 — Load the provider profile and create the provider

### Run

Decision point A — choose the credential source. For a subscription, create
the token on the host first; it is stored only in the OpenShell provider record
on the gateway, never in the sandbox:

```sh
claude setup-token                 # on the host, never in a sandbox
export CLAUDE_CODE_OAUTH_TOKEN=…
./bin/claude-oss provider setup --env CLAUDE_CODE_OAUTH_TOKEN --yes
```

For an API key already exported or in a Maki or OpenCode store:

```sh
./bin/claude-oss provider setup --from maki --credential anthropic --yes
# or: ./bin/claude-oss provider setup --env ANTHROPIC_API_KEY --yes
```

The wizard lints and imports the curated profile, creates or reuses the
provider, and prints the profile's example model. Make that model the default,
or pass it per session:

```sh
mkdir -p "${XDG_CONFIG_HOME:-$HOME/.config}/claude-oss"
# model = "sonnet" in .../claude-oss/config.toml
PROVIDER=claude-anthropic-oauth        # or claude-anthropic
MODEL=sonnet
```

Without a terminal, the non-interactive forms are `--from STORE --credential
SLUG --yes`, `--env VAR`, and `--file PATH`; the full table is in
[`docs/providers.md`](../../providers.md). With `--env`, the variable name picks
the profile; with `--file` or the hidden prompt, the wizard asks whether the
value is an API key or a subscription token. The value is exported only into
the environment of the `openshell` child process.

Raw fallback for the subscription profile:

```sh
openshell profile lint -f claude-oss/providers/claude-anthropic-oauth.yaml
openshell profile import -f claude-oss/providers/claude-anthropic-oauth.yaml --global
# CLAUDE_CODE_OAUTH_TOKEN is already exported in the host environment; the
# token is never placed on the command line.
openshell provider create --name claude-anthropic-oauth \
  --type claude-anthropic-oauth --from-existing --global-profile
```

Substitute the profile file, provider name, and type chosen in Decision point
A. Every curated `claude-*` profile binds only `api.anthropic.com:443` and
`/usr/local/bin/claude`, and a Claude sandbox attaches `claude-<name>`, not
`maki-<name>`. A slug with no curated profile falls through to a generated
custom profile; keep the `claude-` prefix.

### Verify

```sh
openshell profile describe claude-anthropic-oauth
openshell provider list
```

Expected: the profile shows `api.anthropic.com:443` and
`/usr/local/bin/claude`; the provider list names `claude-anthropic-oauth` and
exposes credential key names only, never values.

### Stop if

`provider create` fails, the profile is missing, or the provider list shows a
credential value. Report the command and output; do not retry with a key on
the command line, and do not set `ANTHROPIC_BASE_URL` or an `apiKeyHelper` in
the sandbox.

## Phase 3 — Choose the sandbox policy

### Run

Default: `claude-oss/policies/minimal.yaml`. It grants read-write access only
to `/sandbox`, `/tmp`, and the `/dev/null` sink, keeps system paths read-only,
requires Landlock, runs as uid/gid 1500, and grants no network egress of its
own. The provider from Phase 2 contributes the model endpoint.

Decision point B — does the task need an endpoint outside the attached
provider profile? If yes, add the narrowest explicit policy rule and a
provider for its credential; never widen the policy to a wildcard, `tls:
skip`, or `access: full`. Policy choice is fixed into the sandbox at creation;
later changes use `openshell policy set`.

There is no shipped `claude-git-push` policy. A task that needs `git push` can
copy `examples/policies/maki-git-push.yaml` to a scratch file, replace its
`<org>`/`<repo>` placeholders, and attach a GitHub provider for credentials, as
in [`docs/setup-guide.md`](../../setup-guide.md) §5, or stop and report.

### Verify

```sh
test -f claude-oss/policies/minimal.yaml
! grep -q '^network_policies:' claude-oss/policies/minimal.yaml
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
claude-oss up
```

`claude-oss up` creates or starts the project sandbox with the configured
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
SANDBOX=claude
WORKDIR=/sandbox/project/$(basename "$PROJECT_PATH")
openshell sandbox create --name "$SANDBOX" \
  --from "$IMAGE" \
  --policy "$REPO_ROOT/claude-oss/policies/minimal.yaml" \
  --provider "$PROVIDER" \
  --upload "$PROJECT_PATH:/sandbox/project"
```

`--upload "$PROJECT_PATH:/sandbox/project"` lands the directory at
`/sandbox/project/<basename>`, which is why `WORKDIR` includes the basename.
The seed trusts `/sandbox/project`, so a deeper working directory asks for
trust once in the TUI. Without a project, omit `--upload` and set
`WORKDIR=/sandbox/project`.

The helper names its sandbox `cc-<project>-<hash>`; the raw example uses
`claude`. A provider is normally attached at creation; if it is missing,
`claude-oss provider attach` can attach it later. A missing provider rule in
the effective policy means the attachment failed; the command is in
[`docs/helper.md`](../../helper.md#provider-add--attach--list).

### Verify

```sh
openshell sandbox list
openshell policy get "$SANDBOX" --full
```

Expected: the sandbox reaches `Ready`; the effective policy contains a
provider rule for `api.anthropic.com:443` bound to `/usr/local/bin/claude` and
no other egress. Under the helper, `claude-oss status` also reports
`Exists: yes`.

### Stop if

The sandbox does not reach `Ready`, the effective policy lacks the provider
rule, or it contains an endpoint you did not choose. Report both outputs; do
not attach a broader policy to fix it.

## Phase 5 — Run the isolation checks

### Run

Execute the boundary checks in
[`docs/ai/verification/claude.md`](../verification/claude.md) with the Claude
substitutions: sandbox `"$SANDBOX"` (under the helper, take the name from
`claude-oss status`), provider `claude-anthropic` or
`claude-anthropic-oauth`, the profile's credential variable
(`ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`), and the agent binary
`/usr/local/bin/claude`. Also run `id -u` and `id -g` in the sandbox and expect
`1500`. Then, from the project directory, check MCP readiness:

```sh
claude-oss mcp status
```

`mcp status` compares the servers under `mcpServers` in the host's Claude Code
user config (`$CLAUDE_CONFIG_DIR/.claude.json` when that is set, else
`~/.claude.json`) with those in the sandbox's `/sandbox/.claude.json`, using
the same gate vocabulary as `maki-oss mcp status` (see
[`docs/helper.md`](../../helper.md#mcp-status)). The base image declares no MCP
server, so a server present only on the host is reported `sandbox=missing`
with the `FROM claude-agent:local` fix, and the command exits 3; that is an
environment-store task, not an isolation failure. Details are in
[`docs/ai/reference/claude.md`](../reference/claude.md#mcp).

### Verify

Expected: every boundary check in
[`docs/ai/verification/claude.md`](../verification/claude.md) reports its
stated result (uid 1500, a denied non-profile host, no host paths, the
provider-only effective policy, and no credential value); `claude-oss mcp
status` exits 0 when the host declares no MCP server, or reports each missing
server without changing the sandbox.

### Stop if

Any isolation check fails or reports an unexpected value. Report the command
and output; do not weaken isolation to continue, and do not install a missing
MCP runtime into the running sandbox.

## Phase 6 — Run Claude Code

### Run

Helper path, smoke test first:

```sh
cd "$PROJECT_PATH"
claude-oss run "Reply with OK."
claude-oss run --continue "and now?"   # continues the latest headless session
```

Then run the real task the same way: pass the user's task text in place of the
smoke-test string. The helper prints Claude Code's stream-json events unchanged
and closes stdin, so a run cannot wait forever; the exit code is Claude Code's,
and `--timeout` uses the same in-sandbox wrapper as `maki-oss`. Bare
`claude-oss` starts the TUI on the configured model, after the image's API key
approval step. Session options are `--continue`, `--resume ID`, and
`--session-id ID`; model selection is `--model`, the `CLAUDE_OSS_MODEL`
variable, or the config file's `model`.

Raw fallback, headless:

```sh
openshell sandbox exec -n "$SANDBOX" --workdir "$WORKDIR" --no-login-shell -- \
  claude -p --output-format stream-json --verbose --dangerously-skip-permissions \
  --model "$MODEL" "Reply with OK." </dev/null
```

Raw fallback, TUI. With an API key attached, run the approval step first:

```sh
openshell sandbox exec -n "$SANDBOX" --tty --workdir "$WORKDIR" --no-login-shell -- \
  sh -c '/usr/local/libexec/claude-oss/approve-api-key; exec "$@"' sh \
  claude --dangerously-skip-permissions
```

Claude Code's traps are part of the command, not optional style:

- **`</dev/null` for headless runs.** `claude -p` reads stdin when it is not a
  terminal, and `sandbox exec` leaves stdin open; without the redirect the run
  waits forever.
- **The approval step for an interactive API key.** Claude Code asks once
  whether to use an `ANTHROPIC_API_KEY` it finds, and its default answer (No)
  disables the key. The root-owned step records the attached placeholder as
  approved, inside the sandbox; it does nothing when only the subscription
  profile is attached.
- **Default config locations.** Use `/sandbox/.claude/` and
  `/sandbox/.claude.json`. `sandbox exec` does not pass image `ENV` through, so
  a `CLAUDE_CONFIG_DIR` set in the image never reaches the agent. A custom
  `--workdir` is trusted once in the TUI.
- **`--dangerously-skip-permissions` in both modes.** The guardrails are the
  root-owned `/etc/claude-code/managed-settings.json` deny rules (they hold in
  every permission mode), not a permission prompt. They deny `sudo`, `su`,
  `ssh`, `scp`, in-sandbox `claude` authentication, and edits to Claude Code's
  own config and the guardrail files.
- **`--continue` splits headless and interactive sessions.** An interactive
  `claude-oss --continue` after a `claude-oss run` opens the last interactive
  session, not the run; use `--resume` with the run's `session_id` to pick the
  run up.
- **No traffic outside the model endpoint.** The managed settings turn off
  auto-update, telemetry, error reporting, and marketplace auto-install, so a
  session reaches only `api.anthropic.com`.
- **No in-sandbox authentication.** Do not run `/login`, `claude auth`, or
  `claude setup-token` there, and do not set `ANTHROPIC_BASE_URL` or an
  `apiKeyHelper`. The subscription token is created on the host. Bedrock and
  Vertex are unsupported because a different base URL leaves the credential
  unbound.

### Verify

Expected: the smoke-test JSON contains a result event with the reply `OK` and
exits 0; a continued run reuses the same session ID; the real task exits 0 and
its JSON contains a result rather than an error; the TUI renders and answers —
the helper starts it on the configured model, while the raw command uses Claude
Code's default, so select a profile-covered model with `/model` if needed.

### Stop if

The smoke test fails or reports a network or policy denial. Report the JSON and
the policy decision; do not retry with a broader rule or an in-sandbox login.

## Phase 7 — Collect results and clean up

### Run

Helper path, from the project directory:

```sh
cd "$PROJECT_PATH"
claude-oss status
claude-oss rm --yes
```

Bare `claude-oss` and `claude-oss run` collect the sandbox changes as a patch
on exit and apply it only when the sandbox baseline still matches the host;
`--no-sync` opts out. A retained patch never blocks the next session. On exit
both session kinds also run the same network-proposal check as `maki-oss`.
`claude-oss rm` asks for confirmation unless `--yes` is passed.

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
sandbox list no longer names `"$SANDBOX"`. Under the helper, `claude-oss
status` reports `Exists: no`.

### Stop if

The download fails or the sandbox still exists after deletion. Report the
command and output; do not delete or overwrite host files to force a clean
state.

## Handoff

The path ends with the sandbox deleted and results on the host. The verification
record for the pinned Claude Code and OpenShell versions is
[`docs/ai/verification/claude.md`](../verification/claude.md).
Report the commands that ran, the verification results, any retained patch, and
the next action; do not start a new sandbox to fix a report.

## Invariants

Never relax these to make a command work:

- No host bind mounts. Move files with `sandbox upload` / `sandbox download`.
- No secrets via `openshell sandbox create --env`/`--env-from` or
  `sandbox exec --env`/`--env-from`. Credentials come from provider profiles
  only; a genuinely non-secret switch is the only exception.
- Egress stays deny-by-default. Add the narrowest missing rule, never `tls:
  skip`, `access: full`, or a wildcard host.
- The sandbox process stays non-root (uid/gid 1500).
- Claude Code never authenticates inside the sandbox. Do not run `/login`,
  `claude auth`, or `claude setup-token` there; create a subscription token on
  the host only. Do not set `ANTHROPIC_BASE_URL` or an `apiKeyHelper`, and
  never mount or upload the host's `~/.claude`, `~/.claude.json`, or
  `~/.config/anthropic`.
- Never mount or upload a host agent config or credential store. Global Claude
  config belongs in an environment store; the project's own `.claude/`,
  `.mcp.json`, `CLAUDE.md`, and `AGENTS.md` upload with the project. Keep
  secrets out of `.mcp.json`.
- Provider profiles bind `/usr/local/bin/claude`; do not move, rename, or wrap
  the binary.
- Do not edit `claude-oss/` or `examples/` to match a failing local state; fix
  the local state or report the drift.

## See also

- [`docs/ai/host-playbook.md`](../host-playbook.md) — shared host prerequisites
  P0-P2, preceding this path.
- [`docs/ai/reference/claude.md`](../reference/claude.md) — Claude
  configuration, credentials, profiles, sessions, MCP, and store shape.
- [`docs/ai/environment-playbook.md`](../environment-playbook.md) — personal
  runtimes, MCP servers, and settings on top of the base image.
- [`docs/ai/verification/claude.md`](../verification/claude.md) — isolation
  checklist used by Phase 5.
- [`docs/helper.md`](../../helper.md) — `claude-oss` and shared helper command
  reference.
- [`docs/providers.md`](../../providers.md) — provider profile catalog and
  setup flags.
- [`claude-oss/README.md`](../../../claude-oss/README.md) — the subproject, raw
  path, and verification summary.
- [`docs/ai/references.md`](../references.md) — upstream documentation index.
- [`docs/ai/document-contract.md`](../document-contract.md) — page shape used
  by this playbook.
