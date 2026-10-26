# codex-oss Specification

## Purpose

Runs OpenAI's Codex CLI natively inside an NVIDIA OpenShell sandbox with the
same isolation guarantees as the other agents: a pinned agent-only image,
a ChatGPT-plan credential that reaches the sandbox only as a placeholder,
deny-by-default egress, and explicit file transfer.

## Requirements

### Requirement: Pinned agent-only Codex image

The repository SHALL provide a Docker build context under `codex-oss/image`
that builds an image (default tag `codex-agent:local`) containing the native
Codex binary at `/usr/local/bin/codex` and its companion
`/usr/local/bin/codex-code-mode-host`, which runs the agent's shell commands.
Both SHALL come from the same release, pinned to an exact version by a
single build argument, and each SHALL be verified against its own
per-architecture SHA-256 before it is installed. The build SHALL fail when
a checksum does not match. The image MUST run as uid/gid 1500 with home
`/sandbox`, and Codex SHALL use its default home `/sandbox/.codex`. The
image MUST NOT contain a Node.js or Bun runtime, an MCP server definition, a
Codex plugin, a skills directory under `/sandbox/.agents/`, a credential
value, or any Codex login state (`auth.json`). It SHALL build on both arm64
and amd64 hosts.

#### Scenario: Version is pinned
- **WHEN** the image is built without build arguments and `codex --version` runs in it
- **THEN** it prints the version that the Dockerfile's version argument pins

#### Scenario: Checksum mismatch fails the build
- **WHEN** the version argument is changed and the SHA-256 arguments are not
- **THEN** the build fails before `/usr/local/bin/codex` is installed

#### Scenario: Agent can run shell commands
- **WHEN** a headless run in a sandbox from the image is asked to run `echo ok`
- **THEN** the run's events include a completed command execution with output `ok` and no code-mode error

#### Scenario: Image runs as the sandbox user
- **WHEN** `id` and `echo $HOME` run in a sandbox created from the image
- **THEN** they report uid and gid 1500 and `/sandbox`

#### Scenario: Image is agent-only
- **WHEN** the image filesystem is searched for `node`, `bun`, MCP server definitions, plugin directories, and `/sandbox/.agents`
- **THEN** none are found

#### Scenario: Image carries no credential
- **WHEN** the image filesystem and environment are searched for `auth.json`, access, refresh, or id tokens, and API keys
- **THEN** none are found

### Requirement: Managed configuration the agent cannot change

The image SHALL ship a root-owned Codex configuration layer under
`/etc/codex/`, not writable by uid 1500, that sets:

- the model provider `chatgpt-oss`: base URL
  `https://chatgpt.com/backend-api/codex`, the Responses wire API, the
  bearer credential read from `CODEX_CHATGPT_TOKEN`, the
  `ChatGPT-Account-Id` header read from `CODEX_CHATGPT_ACCOUNT_ID`, and no
  OpenAI login requirement;
- trust for `/sandbox/project`;
- the update check, analytics, metrics export, and feedback turned off;
- the app, plugin, plugin-sharing, skill-dependency-install, in-app update,
  and startup-tip features turned off, and no background app-server daemon;
- credential storage that never writes `auth.json`.

The layer MUST NOT contain a credential value, an account ID, an MCP server,
or a plugin. The pinned Codex version MUST accept it without a configuration
error. A user-level `/sandbox/.codex/config.toml` or a `-c` override written
by the agent MUST NOT change the provider, its base URL, or the traffic
switches.

#### Scenario: Configuration is accepted
- **WHEN** `codex exec --strict-config` runs in the image
- **THEN** it reports no configuration error

#### Scenario: Configuration cannot be rewritten by the agent
- **WHEN** uid 1500 tries to write any file under `/etc/codex/`
- **THEN** the write fails

#### Scenario: User layer cannot redirect the provider
- **WHEN** `/sandbox/.codex/config.toml` sets a different `model_provider` or base URL and a headless run starts
- **THEN** the run still uses `chatgpt-oss` against `chatgpt.com`, or it fails without contacting any other host

### Requirement: Command rules forbid escalation and in-sandbox login

The image SHALL ship root-owned Codex command rules that forbid `sudo`,
`su`, `ssh`, `scp`, `codex login`, and `codex logout`. The rules MUST still
apply when a run uses `--dangerously-bypass-approvals-and-sandbox`. If the
pinned Codex version does not enforce them in that mode, the guide SHALL say
so, and the OpenShell policy (non-root user, no egress for those tools)
SHALL remain the enforcement.

#### Scenario: Forbidden command under bypass mode
- **WHEN** a headless run with `--dangerously-bypass-approvals-and-sandbox` is asked to run `sudo -n true`
- **THEN** Codex refuses the command, or the README records that it does not and that the command fails under the sandbox policy

### Requirement: ChatGPT-bound provider profile with gateway refresh

The repository SHALL provide `codex-oss/providers/codex-chatgpt.yaml`. The
profile SHALL:

- bind `CODEX_CHATGPT_TOKEN` as a bearer token in the `authorization`
  header;
- carry a credential refresh definition with the OAuth2 refresh-token
  strategy, the token endpoint `https://auth.openai.com/oauth/token`, a
  maximum credential lifetime matching the 240-hour access token, and
  refresh material `client_id` (not secret) and `refresh_token` (secret);
- allow only `chatgpt.com` on port 443, limited to the path
  `/backend-api/codex/**`;
- authorize only the binary `/usr/local/bin/codex`.

A `catalog.tsv` SHALL map the profile ID to its credential env var and an
example model that the ChatGPT backend accepts.

#### Scenario: Profile lints
- **WHEN** `openshell profile lint --from codex-oss/providers` runs on a gateway without a `codex-chatgpt` profile
- **THEN** every profile passes

#### Scenario: Profile authorizes only Codex
- **WHEN** the `binaries` list of every profile under `codex-oss/providers/` is read
- **THEN** each one is exactly `/usr/local/bin/codex`

#### Scenario: Catalog matches profiles
- **WHEN** `catalog.tsv` is compared with the profile files
- **THEN** every catalog row names an existing profile, and every profile has a row

### Requirement: Minimal Codex sandbox policy

The repository SHALL provide `codex-oss/policies/minimal.yaml` that grants
read-write access only to `/sandbox`, `/tmp`, and `/dev/null`, grants
read-only access to system paths, requires Landlock as a hard requirement,
runs processes as uid/gid 1500, and grants no network egress of its own.

#### Scenario: Filesystem floor holds in a sandbox
- **WHEN** a process in a sandbox created with this policy writes to `/sandbox/x`, `/tmp/x`, and `/etc/x`
- **THEN** the first two succeed and the write to `/etc/x` fails

### Requirement: Credentials only through the provider profile

A Codex sandbox SHALL receive its model credential only from the attached
`codex-chatgpt` provider. The refresh token SHALL exist only in the
gateway's secret refresh material, never in the sandbox. The guide MUST NOT
instruct:

- passing a credential through `--env` or `--env-from`;
- logging in inside the sandbox (`codex login`, `--with-api-key`,
  `--with-access-token`, or device auth);
- creating, uploading, or mounting an `auth.json`, or the host's `~/.codex`;
- overriding the provider's base URL.

No file under `codex-oss/` may contain the literal provider-placeholder
prefix.

#### Scenario: Sandbox sees only an opaque stand-in
- **WHEN** `codex-chatgpt` is attached and `printenv CODEX_CHATGPT_TOKEN` runs in the sandbox
- **THEN** the value is not the real access token

#### Scenario: No login state in the sandbox
- **WHEN** a headless run completes and the sandbox is searched for `auth.json`
- **THEN** none is found

#### Scenario: ChatGPT login authenticates through the proxy
- **WHEN** `codex-chatgpt` is the only attached provider and a headless run starts
- **THEN** the run completes with a model reply

#### Scenario: No placeholder spelling in the subproject
- **WHEN** every file under `codex-oss/` is searched for the provider-placeholder prefix
- **THEN** no match is found

### Requirement: Gateway refresh stays within the token lifetime

The gateway SHALL refresh the `codex-chatgpt` access token before it
expires, and SHALL NOT refresh it more often than once an hour. The README
SHALL record the observed refresh interval at the pinned OpenShell version.

#### Scenario: Refresh interval
- **WHEN** a provider configured by `codex-oss provider setup` is watched with `openshell provider refresh status` for two hours
- **THEN** `LAST_REFRESH` advances at most twice, and every refresh succeeds

### Requirement: Egress limited to the Codex backend

A Codex sandbox SHALL reach only the endpoints contributed by its attached
provider profile. Codex's update check, analytics, metrics export, feedback,
connectors, plugin and skill catalogs, and any other outbound call MUST be
either disabled by configuration or denied by the sandbox. A denial MUST NOT
prevent a headless run from completing. The README SHALL record whether the
proxy enforces the profile's path limit for the injected credential, and
where it does not, the guide SHALL state that the `codex` binary can use the
credential on any `chatgpt.com` path.

#### Scenario: No call outside the profile
- **WHEN** a headless run and an interactive session complete and the sandbox logs are read
- **THEN** they show no allowed connection by any process to a host other than `chatgpt.com` or to a `chatgpt.com` path outside `/backend-api/codex/**`, and every denied host or path they show is listed in `codex-oss/README.md` with the feature that requests it

#### Scenario: Run completes with egress restricted
- **WHEN** a headless run starts in a sandbox whose only egress comes from `codex-chatgpt`
- **THEN** it exits 0 with a completed-turn event

### Requirement: Documented and verified workflows

The guide SHALL document, and the verification SHALL demonstrate:

- a headless run with
  `codex exec --json --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox -m <model> "<prompt>"`
  that returns machine-readable events;
- a continued session (`codex exec resume --last` or
  `codex exec resume <id>`);
- an interactive TUI started with `codex` over
  `openshell sandbox exec --tty`;
- the host-side login and provider setup, with the raw OpenShell commands
  as the fallback.

#### Scenario: Headless run returns JSON
- **WHEN** the documented headless command runs with stdin from `/dev/null`
- **THEN** stdout is newline-delimited JSON that includes a completed-turn event, and the exit code is 0

#### Scenario: Session continues
- **WHEN** a second headless run resumes the session ID from the first run's events
- **THEN** the reply shows knowledge of the first run's prompt

#### Scenario: Interactive TUI attaches
- **WHEN** the documented interactive command runs on a TTY
- **THEN** the Codex TUI opens in the project directory with no login or trust prompt

### Requirement: Explicit file transfer

Project files SHALL move into and out of a Codex sandbox only through
`openshell sandbox upload` and `openshell sandbox download`. The guide MUST
NOT use host bind mounts or automatic sync.

#### Scenario: File created in the sandbox is downloaded
- **WHEN** a headless run creates a file in the project and the user downloads it
- **THEN** the file exists on the host with the content Codex wrote

### Requirement: Self-contained subproject with recorded verification

All Codex sandbox deliverables SHALL live under `codex-oss/`, except:

- the `bin/codex-oss` helper front-end
- the `cx` tag in `bin/osa`
- the shared helper core in `lib/`
- `docs/codex-oss.md`
- the Codex rules in `AGENTS.md`
- the `Makefile` lint and test entries and the Codex cases and stubs in
  `tests/`
- one pointer from the root `README.md`

Codex work MUST NOT modify `bridge/`, `oskhs/`, `dashboard/`, `examples/`,
`opencode-oss/`, or `claude-oss/`, or change the observable behavior of
`bin/maki-oss`, `bin/opencode-oss`, or `bin/claude-oss`.
`codex-oss/README.md` SHALL record the verification commands and their
observed results for the pinned version.

#### Scenario: No cross-subproject edits
- **WHEN** the change's diff is listed
- **THEN** no path is under `bridge/`, `oskhs/`, `dashboard/`, `examples/`, `opencode-oss/`, or `claude-oss/`

#### Scenario: Other front-ends unchanged
- **WHEN** `make test` runs after the change
- **THEN** the existing `maki-oss`, `opencode-oss`, and `claude-oss` cases pass unchanged

#### Scenario: Verification record exists
- **WHEN** `codex-oss/README.md` is read
- **THEN** it records the commands and observed output for the image, provider setup, refresh interval, egress, headless, continued, interactive, and file-transfer checks at the pinned version
