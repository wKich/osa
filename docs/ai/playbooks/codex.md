| Field | Value |
|---|---|
| Doc | `playbook-codex` |
| Kind | `playbook` |
| Agent | `Codex` |
| Covers | `P0-P8` |
| Preconditions | `docs/ai/host-playbook.md` `P0-P2` |
| Handoff | `docs/ai/verification/codex.md` |
| Verification | `docs/ai/verification/codex.md` |
| Reference | `docs/ai/reference/codex.md` |
| Verified | OpenShell v0.1.5, Codex v0.164.0, 2026-10-26 |

# Playbook: Codex

> **Codex path; return to onboarding for Maki, OpenCode, or Claude** — [open
> the onboarding guide](../onboarding.md).

## Scope

Ordered, executable steps for running Codex in a per-project OpenShell
sandbox. This page starts at P0 and ends at P8. The shared host prerequisites
(engine, OpenShell CLI and gateway, repository, and `bin/` on `PATH`) are in
[`docs/ai/host-playbook.md`](../host-playbook.md); Phase 0 below covers the one
Codex-specific host tool, the `codex` CLI used for the one-time ChatGPT login.
The sandbox binary is pinned by the image, not by the host CLI.

The `codex-oss` helper is the primary path. The image, provider, sandbox, run,
and cleanup phases show the raw `docker` and `openshell` commands for scripting
or boundary debugging; the policy and isolation phases are checks and
decisions. Run every command from the repository root unless a phase says
otherwise. After each phase, run its verification and stop on a mismatch — do
not work around a failed check by weakening isolation.

Codex-specific configuration, credentials, sessions, MCP, and store details
are in [`docs/ai/reference/codex.md`](../reference/codex.md). Shared helper
behavior is in [`docs/helper.md`](../../helper.md), provider profiles in
[`docs/providers.md`](../../providers.md), and the environment store in
[`docs/ai/environment-playbook.md`](../environment-playbook.md).

## Inputs

- A ChatGPT plan login made on the host. `provider setup` opens a browser by
  default; `--device-auth` uses a device code and needs device-code login
  enabled first in ChatGPT settings.
- The project path to upload (optional; skip the upload steps to work in an
  empty sandbox workspace).
- The Codex CLI on the host for the one-time login, installed from the
  upstream Codex documentation indexed by
  [`docs/ai/references.md`](../references.md). The sandbox version is pinned
  at `0.164.0` by [`codex-oss/image/Dockerfile`](../../../codex-oss/image/Dockerfile);
  the host CLI version is not pinned.

Never ask for a credential value in the conversation, and never put one on a
command line. Never run `codex login` in a sandbox.

## Phase 0 — Host Codex CLI and preflight

### Run

```sh
docker version --format '{{.Server.Version}}'
openshell status
codex --version
uname -m
```

The host `codex` CLI is used only for the one-time ChatGPT login in Phase 2.
If `codex --version` is missing, install the CLI from the upstream Codex
documentation indexed by [`docs/ai/references.md`](../references.md), then
re-check. The image pin remains authoritative for sandbox runs.

### Verify

Expected: the engine prints `28.0` or later, `openshell status` shows
`Status: Connected`, `codex --version` prints a usable host version, and
`uname -m` is `arm64` or `x86_64`.

### Stop if

An engine, gateway, or architecture check fails, or `codex` is still missing
after the install step. Report the command and output; do not continue into
the image or provider phase on a disconnected gateway or an unsupported host.

## Phase 1 — Build the image

### Run

Helper path:

```sh
./bin/codex-oss image build
docker run --rm codex-agent:local codex --version
IMAGE=codex-agent:local
REPO_ROOT=$(pwd)
```

Raw fallback:

```sh
docker build -t codex-agent:local codex-oss/image
docker run --rm codex-agent:local codex --version
IMAGE=codex-agent:local
REPO_ROOT=$(pwd)
```

The base image is agent-only: pinned Codex `0.164.0` and its companion
`codex-code-mode-host`, uid/gid 1500, no Node or Bun, no MCP server, no
plugin, no credential, and no Codex login state. Each binary is checked
against its own SHA-256. A personal MCP server or preference belongs in an
environment image built `FROM codex-agent:local`; follow
[`docs/ai/environment-playbook.md`](../environment-playbook.md) and select the
derived tag through the helper's `image` setting. Never edit
`codex-oss/image/` for a personal choice.

A version bump needs `--codex-version V` (or the `CODEX_VERSION` build
argument) and all four checksum values, or the build fails. See
[`codex-oss/README.md`](../../../codex-oss/README.md#build-the-image).

### Verify

Expected: `codex-oss image build` builds `codex-agent:local`;
`docker run --rm codex-agent:local codex --version` prints
`codex-cli 0.164.0`; and `codex-oss doctor` reports the image as `ok` (the
provider checks are completed in Phase 2).

### Stop if

The build fails, the printed version is not `codex-cli 0.164.0`, or a checksum
fails. Report the build output and the pinned version instead of tagging the
image as current.

## Phase 2 — Host-only ChatGPT login and provider

### Run

Helper path, on the host, never in a sandbox:

```sh
./bin/codex-oss provider setup
# or, with device-code login enabled first:
./bin/codex-oss provider setup --device-auth
```

The browser callback is on `localhost:1455`. Without a terminal, add `--yes`.
`provider setup` runs `codex login` in a new, private, throwaway `CODEX_HOME`,
never in `~/.codex`; it reads the access token, refresh token, and account ID,
takes the OAuth client ID and expiry from the claims, imports
`codex-chatgpt`, creates the provider, configures gateway refresh, writes
`providers` and `account_id`, and deletes the throwaway home on success,
failure, or interrupt.

Raw fallback:

```sh
openshell profile lint -f codex-oss/providers/codex-chatgpt.yaml
openshell profile import -f codex-oss/providers/codex-chatgpt.yaml --global
# CODEX_CHATGPT_TOKEN is read from the throwaway login's auth.json in the
# openshell child environment; it is never placed on the command line.
openshell provider create --name codex-chatgpt --type codex-chatgpt \
  --credential CODEX_CHATGPT_TOKEN --global-profile
openshell provider refresh configure codex-chatgpt \
  --credential-key CODEX_CHATGPT_TOKEN --strategy oauth2-refresh-token \
  --material client_id=<client_id claim> \
  --secret-material-env refresh_token=CODEX_RT \
  --credential-expires-at <exp claim in epoch ms>
```

The exact token extraction is in
[`codex-oss/README.md`](../../../codex-oss/README.md#load-the-provider);
every token travels only in an `openshell` child process environment. The
gateway keeps the refresh token as secret material and refreshes the access
token. The sandbox sees only a stand-in in `CODEX_CHATGPT_TOKEN`; the
non-secret account ID travels per exec as `CODEX_CHATGPT_ACCOUNT_ID` and the
`ChatGPT-Account-Id` header. Without an account ID, session commands fail
before any sandbox work and name `provider setup`.

`--from`, `--file`, `--field`, and `--env` are refused because no credential
store holds a ChatGPT login. There is no API-key or Enterprise-token path:
`--with-api-key` and `--with-access-token` are unsupported. Never set a
provider base-URL override in the sandbox.

### Verify

```sh
openshell profile describe codex-chatgpt
openshell provider list
./bin/codex-oss doctor
```

Expected: the profile shows `chatgpt.com/backend-api/codex/**` bound to
`/usr/local/bin/codex`; the provider list names `codex-chatgpt` and exposes
credential key names only; `doctor` reports refresh `ok` or `configured` with
an expiry about 240 hours ahead.

### Stop if

`provider create` or refresh configuration fails, the profile is missing, the
provider list shows a credential value, or `doctor` reports a refresh failure.
Report the command and output; do not retry with a token on the command line
and do not log in inside the sandbox.

## Phase 3 — Choose the sandbox policy

### Run

Default: `codex-oss/policies/minimal.yaml`. It grants read-write access only
to `/sandbox`, `/tmp`, and the `/dev/null` sink, keeps system paths read-only,
requires Landlock, runs as uid/gid 1500, and grants no network egress of its
own. The `codex-chatgpt` profile from Phase 2 contributes the model endpoint.

Decision point A — does the task need an endpoint outside the attached
provider profile? If yes, add the narrowest explicit policy rule and a
provider for its credential; never widen the policy to a wildcard, `tls:
skip`, or `access: full`. Policy choice is fixed into the sandbox at creation;
later changes use `openshell policy set`.

There is no shipped `codex-git-push` policy. A task that needs `git push` can
copy `examples/policies/maki-git-push.yaml` to a scratch file, replace its
`<org>`/`<repo>` placeholders, and attach a GitHub provider for credentials, as
in [`docs/setup-guide.md`](../../setup-guide.md) §5, or stop and report.

### Verify

```sh
test -f codex-oss/policies/minimal.yaml
! grep -q '^network_policies:' codex-oss/policies/minimal.yaml
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
codex-oss up
```

`codex-oss up` creates or starts the project sandbox with the configured
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
SANDBOX=codex
WORKDIR=/sandbox/project/$(basename "$PROJECT_PATH")
openshell sandbox create --name "$SANDBOX" \
  --from codex-agent:local \
  --policy "$REPO_ROOT/codex-oss/policies/minimal.yaml" \
  --provider codex-chatgpt \
  --upload "$PROJECT_PATH:/sandbox/project"
```

`--upload "$PROJECT_PATH:/sandbox/project"` lands the directory at
`/sandbox/project/<basename>`, which is why `WORKDIR` includes the basename.
The seed trusts `/sandbox/project`, so a deeper working directory asks for
trust once in the TUI. Without a project, omit `--upload` and set
`WORKDIR=/sandbox/project`.

The helper names its sandbox `cx-<project>-<hash>`; the raw example uses
`codex`. A provider is normally attached at creation; if it is missing,
`codex-oss provider attach` can attach it later. A missing provider rule in
the effective policy means the attachment failed.

### Verify

```sh
openshell sandbox list
openshell policy get "$SANDBOX" --full
```

Expected: the sandbox reaches `Ready`; the effective policy contains a
provider rule for `chatgpt.com/backend-api/codex/**` bound to
`/usr/local/bin/codex` and no other egress. Under the helper, `codex-oss
status` also reports `Exists: yes`.

### Stop if

The sandbox does not reach `Ready`, the effective policy lacks the provider
rule, or it contains an endpoint you did not choose. Report both outputs; do
not attach a broader policy to fix it.

## Phase 5 — Run the isolation checks

### Run

Execute the boundary checks in
[`docs/ai/verification/codex.md`](../verification/codex.md) with the Codex
substitutions: sandbox `"$SANDBOX"` (under the helper, take the name from
`codex-oss status`), provider `codex-chatgpt`, the profile's credential
variable `CODEX_CHATGPT_TOKEN`, and the agent binary `/usr/local/bin/codex`.
Also run `id -u` and `id -g` in the sandbox and expect `1500`. Then, from the
project directory, check MCP readiness:

```sh
codex-oss mcp status
```

`mcp status` compares the `[mcp_servers.<name>]` tables in the host's Codex
config (`$CODEX_HOME/config.toml`, else `~/.codex/config.toml`) with those in
`/sandbox/.codex/config.toml`, using the same gate vocabulary as `maki-oss mcp
status`. The provider for server `<name>` is expected to be named
`codex-mcp-<name>`. The base image declares no MCP server, so a server present
only on the host is reported `sandbox=missing` with the `FROM codex-agent:local`
fix, and the command exits 3; that is an environment-store task, not an
isolation failure. Details are in
[`docs/ai/reference/codex.md`](../reference/codex.md#mcp).

### Verify

Expected: every boundary check in
[`docs/ai/verification/codex.md`](../verification/codex.md) reports its stated
result (uid 1500, a denied non-profile host, no host paths, the provider-only
effective policy, and no credential value); `codex-oss mcp status` exits 0
when the host declares no MCP server, or reports each missing server without
changing the sandbox.

### Stop if

Any isolation check fails or reports an unexpected value. Report the command
and output; do not weaken isolation to continue, and do not install a missing
MCP runtime into the running sandbox.

## Phase 6 — Run Codex

### Run

Helper path, smoke test first:

```sh
cd "$PROJECT_PATH"
codex-oss run "Reply with the single word: ok"
codex-oss run --resume <thread_id> "What single word did you reply last time?"
```

Then run the real task the same way: pass the user's task text in place of the
smoke-test string. The helper prints Codex's JSONL events unchanged and closes
stdin, so a run cannot wait forever; the exit code is Codex's, and `--timeout`
uses the same in-sandbox wrapper as `maki-oss`. Bare `codex-oss` starts the
TUI on the configured model and trusts `/sandbox/project` once.

Raw fallback, headless:

```sh
ACCOUNT_ID=<account id>
openshell sandbox exec -n "$SANDBOX" --workdir "$WORKDIR" --no-tty \
  --env CODEX_CHATGPT_ACCOUNT_ID="$ACCOUNT_ID" -- \
  codex exec --json --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox \
  "Reply with the single word: ok" </dev/null
```

Raw fallback, TUI:

```sh
openshell sandbox exec -n "$SANDBOX" --workdir "$WORKDIR" --tty \
  --env CODEX_CHATGPT_ACCOUNT_ID="$ACCOUNT_ID" -- \
  codex --dangerously-bypass-approvals-and-sandbox
```

Codex's traps are part of the command, not optional style:

- **`</dev/null` for headless runs.** `codex exec` reads stdin when it is not
  a terminal, and `sandbox exec` leaves stdin open; without the redirect the
  run waits forever.
- **`--dangerously-bypass-approvals-and-sandbox` in both modes.** Codex's own
  bubblewrap sandbox is bypassed because the OpenShell sandbox is the
  boundary. The root-owned `/etc/codex/managed_config.toml` pins the provider,
  the base URL, and the traffic switches, and `/etc/codex/rules/default.rules`
  denies `sudo`, `su`, `ssh`, `scp`, `codex login`, and `codex logout`; the
  rules hold under bypass mode.
- **Default config locations.** Use `/sandbox/.codex/`. `sandbox exec` does
  not pass image `ENV` through, so an image-level `CODEX_HOME` never reaches
  the agent. A custom `--workdir` is trusted once in the TUI.
- **The account ID is not a secret, but it is required.** Pass
  `CODEX_CHATGPT_ACCOUNT_ID` on every exec, or Codex sends no
  `ChatGPT-Account-Id` header and the session fails; the helper raises the
  missing account ID before any sandbox work.
- **`--continue` and `--resume` differ.** `--resume ID` uses the `thread_id`
  of the run's first event. `--continue` alone resumes the latest run; in the
  TUI it includes headless runs. `--session-id` is refused, and `--continue`
  together with `--resume` is a usage error, both before sandbox work.
- **No traffic outside the model endpoint.** A session reaches only
  `chatgpt.com/backend-api/codex/**`. The TUI still makes one fetch of
  `raw.githubusercontent.com` that no setting turns off; the sandbox denies
  it, and the TUI works without it.

The model resolves from `--model`, then `CODEX_OSS_MODEL`, then the config
file's `model`; with no model set, Codex picks its own default, which at
0.164.0 is `GPT-6.1-Sol`. A ChatGPT account accepts Codex models and rejects
API-only ones such as `gpt-5.5`.

Never run `codex login`, `--with-api-key`, or `--with-access-token` in the
sandbox, never create or upload an `auth.json` or the host's `~/.codex`, and
never set a provider base-URL override.

### Verify

Expected: the smoke-test JSON contains an `agent_message` with `ok` and exits
0; a resumed run reuses the same `thread_id` and answers `ok`; the real task
exits 0 and its JSON contains a completed turn; the TUI renders on the
configured model with `permissions: YOLO mode` and no login or trust screen.

### Stop if

The smoke test fails or reports a network or policy denial. Report the JSON and
the policy decision; do not retry with a broader rule or an in-sandbox login.

## Phase 7 — Collect results and clean up

### Run

Helper path, from the project directory:

```sh
cd "$PROJECT_PATH"
codex-oss status
codex-oss rm --yes
```

Bare `codex-oss` and `codex-oss run` collect the sandbox changes as a patch on
exit and apply it only when the sandbox baseline still matches the host;
`--no-sync` opts out. A retained patch never blocks the next session. On exit
both session kinds also run the same network-proposal check as `maki-oss`.
`codex-oss rm` asks for confirmation unless `--yes` is passed.

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
sandbox list no longer names `"$SANDBOX"`. Under the helper, `codex-oss
status` reports `Exists: no`.

### Stop if

The download fails or the sandbox still exists after deletion. Report the
command and output; do not delete or overwrite host files to force a clean
state.

## Handoff

The path ends with the sandbox deleted and results on the host. The
verification record for the pinned Codex and OpenShell versions is
[`docs/ai/verification/codex.md`](../verification/codex.md). Report the
commands that ran, the verification results, any retained patch, and the next
action; do not start a new sandbox to fix a report.

## Invariants

Never relax these to make a command work:

- No host bind mounts. Move files with `sandbox upload` / `sandbox download`.
- No secrets via `openshell sandbox create --env`/`--env-from` or
  `sandbox exec --env`/`--env-from`. Credentials come from provider profiles
  only; a genuinely non-secret switch is the only exception.
- Egress stays deny-by-default. Add the narrowest missing rule, never `tls:
  skip`, `access: full`, or a wildcard host.
- The sandbox process stays non-root (uid/gid 1500).
- Codex never authenticates inside the sandbox. Do not run `codex login`
  there; create the login on the host in a throwaway `CODEX_HOME` through
  `codex-oss provider setup`. Never mount or upload an `auth.json` or the
  host's `~/.codex`, and never override the provider's base URL.
- Do not use the API-key or Enterprise-token path (`--with-api-key`,
  `--with-access-token`); the credential is the ChatGPT plan login.
- `codex-oss` has no fish plugin, and the shared `tui` key is accepted but
  ignored.
- Provider profiles bind `/usr/local/bin/codex`; do not move, rename, or wrap
  the binary.
- Do not edit `codex-oss/` or `examples/` to match a failing local state; fix
  the local state or report the drift.

## See also

- [`docs/ai/host-playbook.md`](../host-playbook.md) — shared host prerequisites
  P0-P2, preceding this path.
- [`docs/ai/reference/codex.md`](../reference/codex.md) — Codex configuration,
  credentials, profiles, sessions, MCP, and store shape.
- [`docs/ai/environment-playbook.md`](../environment-playbook.md) — personal
  runtimes, MCP servers, and settings on top of the base image.
- [`docs/ai/verification/codex.md`](../verification/codex.md) — the isolation
  checklist and canonical verification record.
- [`docs/helper.md`](../../helper.md) — `codex-oss` and shared helper command
  reference.
- [`docs/providers.md`](../../providers.md) — provider profile catalog and
  setup flags.
- [`codex-oss/README.md`](../../../codex-oss/README.md) — the subproject, raw
  path, and verification summary.
- [`docs/ai/references.md`](../references.md) — upstream documentation index.
- [`docs/ai/document-contract.md`](../document-contract.md) — page shape used
  by this playbook.
