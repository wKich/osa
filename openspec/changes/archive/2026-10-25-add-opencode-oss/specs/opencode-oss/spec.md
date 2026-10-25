# Spec Delta

## Purpose

Runs the OpenCode coding agent natively inside an NVIDIA OpenShell sandbox
with the same isolation guarantees as the Maki path: a pinned agent-only
image, credentials only through provider profiles, deny-by-default egress,
and explicit file transfer.

## ADDED Requirements

### Requirement: Pinned agent-only OpenCode image

The repository SHALL provide a Docker build context under `opencode-oss/`
that builds an image (default tag `opencode-agent:local`) containing the
native OpenCode binary at `/usr/local/bin/opencode`, pinned to an exact
version (initially 2.1.4) by a single build argument. The image MUST run as
uid/gid 1500 with home `/sandbox`, and MUST NOT contain a Node.js or Bun
runtime, any MCP server definition, any OpenCode plugin, any personal UI or
auto-approve preference, or any credential value. It SHALL build on both
arm64 and amd64 hosts.

#### Scenario: Version is pinned
- **WHEN** a user runs `docker run --rm opencode-agent:local opencode --version`
- **THEN** it prints exactly the version named by the Dockerfile's pin argument

#### Scenario: Image runs as the sandbox user
- **WHEN** a user runs `docker run --rm opencode-agent:local id`
- **THEN** it reports uid 1500 and gid 1500

#### Scenario: Image is agent-only
- **WHEN** the built image is inspected for `node`, `bun`, and the baked OpenCode config's `mcp` and `plugin` keys
- **THEN** no `node` or `bun` executable is on `PATH`, and the config declares no MCP server and no plugin

#### Scenario: Image carries no credential
- **WHEN** the image's environment and `/sandbox` tree are searched for API-key environment values and OpenCode's credential store (`auth.json`)
- **THEN** none is present

### Requirement: Offline model catalog

The image SHALL contain a model catalog captured at build time, so that
listing models needs no network access at run time. The catalog SHALL
include every provider the shipped profiles cover.

#### Scenario: Models list with no network
- **WHEN** a user runs `opencode models` in the image with `docker run --rm --network none`, with every credential env var from `opencode-oss/providers/catalog.tsv` set to a non-secret dummy value (OpenCode lists only providers whose credential is present)
- **THEN** the command exits 0 within a bounded time and lists models for every OpenCode provider ID named in the catalog

### Requirement: Baked global configuration with deny rules

The image SHALL ship a global OpenCode configuration at
`/sandbox/.config/opencode/opencode.json` that disables self-update and
session sharing and denies these tool actions: `sudo`, `su`, `ssh`, `scp`,
`opencode auth`, and file edits under `/sandbox/.config/`. The configuration
MUST NOT contain a catch-all allow rule, a `provider`/`providers` block, a
base-URL override, an MCP server, or a plugin. The configuration MUST be
accepted by the pinned OpenCode version without a schema or deprecation
error. The deny rules MUST still apply when a run auto-approves permissions
with `--auto`.

#### Scenario: Config is accepted
- **WHEN** OpenCode starts in the image and loads its configuration
- **THEN** it reports no config validation error and resolves `update` as disabled and `share` as disabled

#### Scenario: Deny wins under auto-approve
- **WHEN** a headless run with `--auto` asks the agent to run `sudo -n true` or to edit a file under `/sandbox/.config/opencode/`
- **THEN** OpenCode's permission rules deny the tool call and the command or edit does not run

### Requirement: OpenCode-bound provider profiles

The repository SHALL provide OpenShell provider profiles under
`opencode-oss/providers/`, one per curated provider. Each profile keeps the
endpoint host, port, and credential env var of its counterpart in
`examples/providers/` and authorizes only the binary
`/usr/local/bin/opencode`. A `catalog.tsv` SHALL map each profile ID to its
OpenCode provider ID and credential env var. The curated set SHALL include
at least openai, anthropic, deepseek, synthetic, nano-gpt, opencode,
opencode-go, zai-coding, kimi-for-coding, minimax-coding-plan, and
xiaomi-token-plan-sgp.

#### Scenario: Every profile lints
- **WHEN** `openshell profile lint -f <file>` runs on every `opencode-oss/providers/*.yaml`
- **THEN** each one passes

#### Scenario: Profiles authorize only OpenCode
- **WHEN** the `binaries` list of every profile is inspected
- **THEN** it is exactly `[/usr/local/bin/opencode]`

#### Scenario: Catalog matches profiles
- **WHEN** `catalog.tsv` is compared with the profile files
- **THEN** every catalog row names an existing profile file and every profile file has exactly one row

### Requirement: Minimal sandbox policy

The repository SHALL provide `opencode-oss/policies/minimal.yaml` that grants
read-write access only to `/sandbox`, `/tmp`, and `/dev/null`, grants
read-only access to system paths, requires Landlock as a hard requirement,
runs processes as uid/gid 1500, and grants no network egress of its own.

#### Scenario: Filesystem floor holds in a sandbox
- **WHEN** a sandbox created with this policy and the OpenCode image runs `id`, writes to `/sandbox/project` and `/tmp`, and attempts to write to `/usr` and `/etc`
- **THEN** `id` reports uid 1500, the first two writes succeed, and the last two fail

### Requirement: Credentials only through provider profiles

An OpenCode sandbox SHALL receive model credentials only from an attached
OpenShell provider profile. The guide MUST NOT instruct passing a credential
through `--env` or `--env-from`, running `opencode auth login` in the
sandbox, or setting a provider base-URL override. No file under
`opencode-oss/` may contain the literal provider-placeholder prefix.

#### Scenario: Sandbox sees only an opaque stand-in
- **WHEN** a sandbox with an attached profile reports whether the profile's env var is set and how long it is, without printing its value
- **THEN** the variable is set and holds an opaque stand-in, not the host key

#### Scenario: No placeholder spelling in the subproject
- **WHEN** `opencode-oss/` is searched for the literal provider-placeholder prefix
- **THEN** there are no matches

### Requirement: Deny-by-default egress

An OpenCode sandbox SHALL reach only the endpoints contributed by its
attached provider profile. OpenCode's update check, catalog refresh,
sharing, and any other outbound call MUST be either disabled by
configuration or denied by the sandbox, and a denial MUST NOT prevent a
headless run from completing.

#### Scenario: Non-profile host is denied
- **WHEN** a sandbox with one attached profile runs `curl` against a host outside that profile (for example `https://example.com`)
- **THEN** the request is denied

#### Scenario: Run completes with egress restricted
- **WHEN** a headless run executes in that sandbox
- **THEN** it returns a model result, and no denied OpenCode-internal request stalls it

### Requirement: Headless and interactive OpenCode sessions

The guide SHALL document, and the verification SHALL demonstrate, a headless
run with `opencode run --standalone --auto --format json --model
<provider>/<model> "<prompt>"` that returns a machine-readable result, a
continued session (`--continue` or `--session <id>`), and an interactive TUI
started with `opencode --standalone` over `openshell sandbox exec --tty`.

#### Scenario: Headless run returns JSON
- **WHEN** the documented headless command runs with prompt `reply OK` in a sandbox with a matching profile attached
- **THEN** it exits 0 and emits JSON events that include the model's reply

#### Scenario: Session continues
- **WHEN** a second headless run uses `--continue` in the same sandbox
- **THEN** it reuses the previous session ID instead of creating a new one

#### Scenario: Interactive TUI attaches
- **WHEN** a user runs the documented `openshell sandbox exec --tty` command
- **THEN** the OpenCode TUI renders in the user's terminal and accepts a prompt

### Requirement: Explicit file transfer

Project files SHALL move into and out of an OpenCode sandbox only through
`openshell sandbox upload` and `openshell sandbox download`. The guide MUST
NOT use host bind mounts or automatic sync.

#### Scenario: File created in the sandbox is downloaded
- **WHEN** the agent creates a file under `/sandbox/project` and the user runs the documented `openshell sandbox download` command
- **THEN** the file appears on the host with the same content

### Requirement: Self-contained subproject with recorded verification

All OpenCode sandbox deliverables SHALL live under `opencode-oss/`, except
one pointer from the root `README.md`. The change MUST NOT modify
`bin/maki-oss`, `bridge/`, `oskhs/`, `dashboard/`, `examples/`, or the
existing specs. `opencode-oss/README.md` SHALL record the verification
commands and their observed results for the pinned version.

#### Scenario: No cross-subproject edits
- **WHEN** `git diff --stat` for this change is inspected
- **THEN** every changed path is under `opencode-oss/` or `openspec/changes/add-opencode-oss/`, or is the root `README.md`

#### Scenario: Verification record exists
- **WHEN** a reader opens `opencode-oss/README.md`
- **THEN** it lists each acceptance check with the command run, the date, the OpenCode and OpenShell versions, and the observed result
