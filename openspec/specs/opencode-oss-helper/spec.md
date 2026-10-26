# opencode-oss-helper Specification

## Purpose

`opencode-oss` is the OpenCode counterpart of `maki-oss`: a thin, safe
workflow helper that creates and manages a per-project OpenShell sandbox
running OpenCode natively. It has the same lifecycle, sync, policy, and
provider features, specialized for OpenCode's CLI and configuration.

## Requirements

### Requirement: Feature parity with maki-oss

`opencode-oss` SHALL satisfy every `helper-cli` requirement with these
substitutions, and SHALL NOT satisfy the requirements that are Maki-only:

| `helper-cli` term | `opencode-oss` term |
|---|---|
| `maki-oss` | `opencode-oss` |
| `MAKI_OSS_*` env vars | `OPENCODE_OSS_*` |
| `${XDG_CONFIG_HOME:-$HOME/.config}/maki-oss/config.toml` | `…/opencode-oss/config.toml` |
| default image `maki-agent:local` | `opencode-agent:local` |
| default policy `examples/policies/maki-minimal.yaml` | `opencode-oss/policies/minimal.yaml` |
| default sandbox name `maki-{project}` | `oc-{project}` |
| curated profiles `examples/providers/` and its catalog | `opencode-oss/providers/` and `stores.tsv` |
| `maki-oss maki` and bare `maki-oss` | `opencode-oss opencode` and bare `opencode-oss` |
| "Maki" as the launched agent | OpenCode |

The Maki-only requirement is the `tui = "opencode"` bridge mode. The parity
covers:

- settings resolution
- up/status/start/stop/rm
- run with `--timeout`
- `--continue`/`--resume`/`--session-id`
- upload/download and safe patch sync (baseline, worktree, plain-directory,
  and no-git paths, failure handling, and patch contents)
- the `--env` credential-name guard
- doctor
- confirmation on `rm`
- provider setup, credential handling, and remembering providers
- the shared session ensure routine and the no-provider behavior
- policy proposals enablement and the post-session proposal check
- SIGINT/SIGTERM handling
- `mcp status`

#### Scenario: Same command surface
- **WHEN** a user runs `opencode-oss help`
- **THEN** it lists `doctor`, `image build`, `init`/`up`, `opencode`, `run`, `upload`, `download`, `status`, `list`, `logs`, `start`/`stop`, `rm`, `policy show|edit|apply|review|approve|reject`, `provider add|attach|list|setup`, `mcp status`, `fish install`/`uninstall`, and `help`, and it does not list `maki`

#### Scenario: Settings resolve with the OpenCode prefix
- **WHEN** `OPENCODE_OSS_IMAGE=custom:tag` is exported and `opencode-oss up` creates a sandbox
- **THEN** the sandbox is created from `custom:tag`, and `MAKI_OSS_IMAGE` has no effect on `opencode-oss`

#### Scenario: Safe sync after a session
- **WHEN** an `opencode-oss run` session changes files in a git project whose host tree still matches the uploaded baseline
- **THEN** the helper collects a patch on exit and applies it to the host by the same rules as `maki-oss`, keeping its sync state under `.opencode-oss`

#### Scenario: Credential guard
- **WHEN** a user passes `--env OPENAI_API_KEY=x` to `opencode-oss up`
- **THEN** the helper refuses it, exactly as `maki-oss` does, unless `--allow-env OPENAI_API_KEY` is given

#### Scenario: Products do not share state
- **WHEN** `maki-oss` and `opencode-oss` run in the same project directory
- **THEN** they use different sandboxes (`maki-<project>` and `oc-<project>`), different config files, and different sync-state directories

### Requirement: OpenCode launch contract

Every OpenCode process the helper starts in a sandbox SHALL run with
`--standalone`.

- **Headless:** `opencode-oss run "<prompt>"` SHALL execute
  `opencode run --standalone --auto --format json`, followed by the
  resolved `--model` and session flags and the prompt. Its stdin SHALL be
  closed, so the run cannot wait on input. It SHALL stream OpenCode's
  stdout unchanged and exit with OpenCode's exit code. With `--timeout`, it
  uses the same in-sandbox wrapper as `maki-oss`.
- **Interactive:** bare `opencode-oss` and `opencode-oss opencode` SHALL
  attach `opencode --standalone` on a TTY, followed by the resolved session
  flags. They SHALL NOT pass `--auto`. Auto-approval for interactive use is
  a personal preference that belongs in an environment image's
  `permissions`, as Maki's `always_yolo` does.

#### Scenario: Headless run does not hang on stdin
- **WHEN** a user runs `opencode-oss run "reply OK"` from a terminal
- **THEN** the in-sandbox command is `opencode run --standalone --auto --format json … "reply OK"` with stdin closed, it exits 0, and stdout carries OpenCode's JSON events unchanged

#### Scenario: Interactive session uses the native TUI
- **WHEN** a user runs bare `opencode-oss` in a project with a remembered provider
- **THEN** the helper ensures the sandbox and attaches `opencode --standalone` over a TTY, and on exit runs the same sync and proposal check as a `maki-oss` session

### Requirement: Model selection without editing the project

The resolved model (from `--model`, `OPENCODE_OSS_MODEL`, or the config
file's `model`) SHALL reach OpenCode as follows:

- **Headless:** as `--model <provider/model>`.
- **Interactive:** as a non-secret config overlay passed only to that
  `sandbox exec`.

The helper MUST NOT write the model into the project tree or into the
sandbox's global OpenCode config. With no resolved model, OpenCode's own
default applies, and `doctor` SHALL warn that the default may be a model
the attached profiles do not cover.

#### Scenario: TUI starts on the configured model
- **WHEN** `model = "synthetic/hf:zai-org/GLM-5.3"` is set in the config file and the user runs bare `opencode-oss`
- **THEN** the TUI opens on that model, and the sandbox project directory contains no `opencode.json` written by the helper

#### Scenario: Overlay keeps the baked deny rules
- **WHEN** an interactive or headless session runs with the model overlay
- **THEN** the image's deny rules (`shell` sudo/su/ssh/scp/`opencode auth`, `edit` under `/sandbox/.config/**`) still deny those calls

### Requirement: Session flag mapping

The helper SHALL map the shared session options onto OpenCode's flags:

- `--continue` → `--continue`
- `--resume ID` → `--session ID`
- `--session-id ID` → `--session ID` (OpenCode creates the session when it
  does not exist)

Combining `--resume` with `--session-id`, or either with `--continue`,
SHALL be a usage error, raised before any sandbox work.

#### Scenario: Resume maps to session
- **WHEN** a user runs `opencode-oss run --resume ses_123 "next"`
- **THEN** the in-sandbox argv contains `--session ses_123` and does not contain `--resume`

#### Scenario: Conflicting session flags
- **WHEN** a user runs `opencode-oss run --continue --resume ses_123 "x"`
- **THEN** the helper exits with the usage exit code and creates or starts no sandbox

### Requirement: No catalog fetch from sessions

Every OpenCode process the helper starts SHALL run with OpenCode's
models-fetch switch disabled, passed as a non-secret `sandbox exec`
environment value, so a session makes no request to the model-catalog
host.

#### Scenario: No denied catalog request
- **WHEN** an `opencode-oss run` session completes in a sandbox with one attached profile
- **THEN** the sandbox logs show no denied connection to `models.opencode.ai` from `/usr/local/bin/opencode`

### Requirement: OpenCode MCP status

`opencode-oss mcp status` SHALL compare the servers enabled under the `mcp`
key of the host's `~/.config/opencode/opencode.json` with the servers in
the sandbox's `/sandbox/.config/opencode/opencode.json`. It SHALL report one
line per server name with the same gate vocabulary as `maki-oss mcp status`.
`opencode-oss doctor` SHALL include the same table. When a file cannot be
parsed as JSON, the helper SHALL report that file as unreadable rather than
guessing.

#### Scenario: Server missing from the base image
- **WHEN** the host config enables an MCP server `context7` and the sandbox runs the base image
- **THEN** `opencode-oss mcp status` reports `context7` as missing in the sandbox and points to an environment image built `FROM opencode-agent:local`

### Requirement: OpenCode provider setup

`opencode-oss provider setup` SHALL resolve stored credentials (from the
Maki and OpenCode stores, a JSON file, a host env var, or a hidden prompt)
to the `opencode-*` profiles through `opencode-oss/providers/stores.tsv`.
Credential values SHALL be handled exactly as `helper-cli` requires: only
in the child process environment, never in arguments, files, or output.
Custom profiles it generates SHALL use the `opencode-` id prefix and bind
`/usr/local/bin/opencode`. On success, it SHALL print the provider's
example model from `opencode-oss/providers/catalog.tsv`, along with how to
set it as the default `model`.

#### Scenario: OpenCode store key maps to the OpenCode profile
- **WHEN** the OpenCode store holds an API key under `synthetic` and the user runs `opencode-oss provider setup --from opencode --credential synthetic --yes`
- **THEN** the helper imports `opencode-oss/providers/opencode-synthetic.yaml`, creates provider `opencode-synthetic` from the key without printing it, records it in the config file, and prints `synthetic/hf:zai-org/GLM-5.3` as the example model

#### Scenario: Every store row resolves
- **WHEN** `stores.tsv` is checked against `opencode-oss/providers/`
- **THEN** every row names an existing `opencode-*.yaml` profile

### Requirement: OpenCode image build

`opencode-oss image build` SHALL build `opencode-oss/image` with the
configured engine and tag the result with the resolved image (default
`opencode-agent:local`). `--opencode-version V` SHALL pass
`OPENCODE_VERSION=V` as a build argument. Because the Dockerfile pins
per-architecture checksums, the helper SHALL fail the build rather than
skip verification when the version has no matching checksums.

#### Scenario: Default build
- **WHEN** a user runs `opencode-oss image build`
- **THEN** the engine builds `opencode-oss/image` tagged `opencode-agent:local`, and `opencode --version` in the result prints the Dockerfile's pinned version
