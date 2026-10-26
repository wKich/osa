# helper-cli Specification

## Purpose
`maki-oss` is a thin, safe workflow layer over the OpenShell CLI: it creates, starts, and manages a per-project Maki sandbox with encoded defaults, and it refuses the unsafe shortcuts (host bind mounts, plaintext secrets, unconfirmed deletion) that the raw commands allow.

## Requirements

### Requirement: Configuration resolution
The helper SHALL resolve settings from command-line flags, `MAKI_OSS_*` environment variables, the config file at `${XDG_CONFIG_HOME:-$HOME/.config}/maki-oss/config.toml`, and built-in defaults, in that order of precedence. The config file SHALL be parsed as data without executing its contents, and an unknown key SHALL cause a non-zero exit that names the file and the key.

#### Scenario: Flag overrides config and environment
- **WHEN** the config file sets `sandbox_name = "a"`, the environment sets `MAKI_OSS_SANDBOX_NAME=b`, and the user passes `--name c`
- **THEN** the helper uses `c`

#### Scenario: Unknown config key fails loudly
- **WHEN** the config file contains `opennshell_path = "/x"` (a misspelling)
- **THEN** the command exits non-zero and the error names both the config file and the unknown key

### Requirement: Sandbox names fit the gateway

The helper SHALL derive `{project}` from the name of the project's git `origin` remote (the last path segment of its URL, without a trailing `.git`), and SHALL fall back to the current directory name when the folder is not a git repository, has no `origin` remote, or the host has no `git`. It SHALL clean the name by lowercasing it, replacing every character outside `[a-z0-9-]` with a hyphen, collapsing repeated hyphens, and trimming leading and trailing hyphens. `{hash}` SHALL be a stable four-character lowercase hex hash of the project folder's absolute physical path. The default sandbox name SHALL be `mk-{project}-{hash}`. When the expanded name would exceed OpenShell's 19-character limit, the helper SHALL shorten the `{project}` part and drop any trailing hyphen. A pattern without `{hash}` that still has to be shortened SHALL keep today's fitting: the shortened project part is suffixed with a four-character hash of the full project name. When the current folder already has a registry entry for this agent, the helper SHALL use that entry's recorded sandbox name instead of the default. Creating a sandbox whose name is registered to a different host path SHALL fail before any gateway call, and the error SHALL suggest `--name`. A name supplied with `--name`, `MAKI_OSS_SANDBOX_NAME`, or `sandbox_name` SHALL take precedence over the registry and the default, and SHALL be validated against the same lowercase, hyphen, and length rules before any gateway call; an invalid name SHALL exit as a usage error.

#### Scenario: Default name uses the remote name and a path hash
- **WHEN** the user runs `maki-oss up` in a git repository whose `origin` is `git@github.com:acme/app.git`
- **THEN** the sandbox name is `mk-app-` followed by four lowercase hex characters

#### Scenario: A folder without git uses its directory name
- **WHEN** the user runs `maki-oss up` in a folder named `My App` that is not a git repository
- **THEN** the sandbox name starts with `mk-my-app-`

#### Scenario: Two worktrees get different sandboxes
- **WHEN** the user runs `maki-oss up` in two git worktrees of the same repository
- **THEN** the two sandbox names differ only in the hash part

#### Scenario: A long project name is fitted
- **WHEN** the user runs `maki-oss up` in a project whose cleaned name is longer than 11 characters
- **THEN** the sandbox name is at most 19 lowercase letters, digits, or hyphens, and two projects that share a prefix receive different names

#### Scenario: A registered project keeps its sandbox name
- **WHEN** the registry records sandbox `maki-myproject` for the current folder and agent, and the user runs `maki-oss up`
- **THEN** the helper uses `maki-myproject`, not the default name

#### Scenario: A name bound to another folder is refused
- **WHEN** the registry records sandbox `mk-app-1a2b` for `/home/u/a`, and the user runs `maki-oss up --name mk-app-1a2b` in `/home/u/b`
- **THEN** the command exits non-zero without contacting the gateway, and the error suggests `--name`

#### Scenario: An invalid explicit name fails before the gateway
- **WHEN** the user runs `maki-oss up --name My_Project`
- **THEN** the command exits non-zero without contacting the gateway, and the error names the lowercase and hyphen rule

### Requirement: Idempotent sandbox lifecycle

`maki-oss up` SHALL start the project's sandbox when it exists and is stopped, and SHALL create it when absent, never creating a second sandbox with the same name. `maki-oss up` SHALL remain create/start-only and SHALL NOT upload the project. `maki-oss status` SHALL report existence, phase, image, attached providers, sync state (`clean`, `behind`, `retained`, or `parked`), any retained patch path, and the next command for that state. `maki-oss rm` SHALL refuse to delete a parked workspace unless the user passes `--discard`, and SHALL archive instance-scoped sync state when it deletes a sandbox. Sandbox phase and provider lookups MUST give the same result whatever the gateway's JSON layout is (pretty-printed, compact, or a single line listing several sandboxes), with or without `jq` installed.

#### Scenario: First run creates the sandbox
- **WHEN** no sandbox exists for `~/code/myproject` and the user runs `maki-oss up` there
- **THEN** a sandbox with the default name `mk-myproject-` plus four hex characters is created from the configured image, policy, and providers

#### Scenario: Second run starts the same sandbox
- **WHEN** the sandbox exists in `Stopped` phase and the user runs `maki-oss up` again
- **THEN** the existing sandbox is started and no new sandbox is created

#### Scenario: Status reports sync state
- **WHEN** the user runs `maki-oss status` for a project sandbox
- **THEN** the output names one of `clean`, `behind`, `retained`, or `parked` and the next command for that state

#### Scenario: Rm refuses a parked workspace
- **WHEN** the workspace is parked and the user runs `maki-oss rm --yes`
- **THEN** no delete request is sent and the error names the `--discard` command

#### Scenario: Rm archives state for a disposable sandbox
- **WHEN** the workspace is not parked and the user confirms `maki-oss rm`
- **THEN** the sandbox is deleted and its instance-scoped sync state is archived

#### Scenario: Compact JSON without jq still resolves the phase
- **WHEN** `jq` is not installed and `openshell sandbox list --output json` returns compact JSON such as `{"sandboxes":[{"name":"maki-a","phase":"Stopped"}]}`
- **THEN** `maki-oss status` reports phase `Stopped` for `maki-a` and `maki-oss up` does not attempt a second create

#### Scenario: Single-line JSON never yields another sandbox's phase
- **WHEN** `jq` is not installed and the sandbox list is one line containing several sandboxes, where `maki-a` is `Stopped` and a later sandbox is `Ready`
- **THEN** the reported phase for `maki-a` is `Stopped`, not `Ready`

#### Scenario: Concurrent create race resolves to reuse
- **WHEN** two `maki-oss` runs race to create the same project sandbox and the second create reports that the name already exists
- **THEN** the second run re-checks the sandbox and continues by reusing it instead of exiting with a gateway error

### Requirement: Headless and interactive execution
`maki-oss run "<prompt>"` SHALL execute Maki headless with `--print --yolo --trust --output-format json`, stream Maki's stdout unchanged, and exit with Maki's exit code. `maki-oss run` SHALL accept `--model <provider/model>` and pass it to Maki as its model selection. `maki-oss maki` SHALL attach an interactive TTY session running Maki in the sandbox workspace. When the `tui` setting resolves to `opencode` (config key or `MAKI_OSS_TUI`), bare `maki-oss` and `maki-oss maki` SHALL instead run the OpenCode TUI against the local `opencode-tui-bridge`, which drives Maki in the same project sandbox; this mode SHALL share the same ensure routine, model setting, and exit sync as the Maki TUI session, and the session flags `--continue`, `--resume`, and `--session-id` SHALL be refused in this mode with a usage error that names it (bridge session resume is not yet supported). Any other `tui` value SHALL be a non-zero usage error naming the key and the accepted values, and an unset `tui` SHALL keep the Maki TUI session unchanged. `maki-oss run` is unaffected by the `tui` setting.

#### Scenario: Headless JSON passthrough
- **WHEN** the user runs `maki-oss run "fix the tests"` and Maki exits 0
- **THEN** stdout contains Maki's JSON result and the helper exits 0

#### Scenario: Non-zero Maki exit propagates
- **WHEN** Maki exits 1 in a headless run
- **THEN** the helper exits 1 without rewriting or swallowing Maki's output

#### Scenario: Model selection is passed through
- **WHEN** the user runs `maki-oss run --model opencode-go/deepseek-v4.1-flash "check"`
- **THEN** the sandbox exec invocation passes that model to Maki's `--model` option

#### Scenario: Default session stays the Maki TUI
- **WHEN** `tui` is unset and the user runs bare `maki-oss`
- **THEN** the helper attaches the interactive Maki TTY session exactly as before, and no bridge process is started

#### Scenario: OpenCode mode runs the TUI against the bridge
- **WHEN** `tui = "opencode"` is set and the user runs bare `maki-oss` in a Ready project sandbox
- **THEN** the helper starts the bridge bound to loopback, launches the OpenCode TUI pointed at it, and the bridge's Maki child runs inside the project sandbox workspace

#### Scenario: OpenCode mode keeps the shared lifecycle
- **WHEN** `tui = "opencode"` and the session ends (including Ctrl-C)
- **THEN** the bridge and TUI are torn down, the exit sync collects a patch as the Maki TUI session does, and no host-side bind mount or `--env` value was used

#### Scenario: Unknown tui value is refused
- **WHEN** the config file contains `tui = "vim"`
- **THEN** the interactive session exits non-zero with an error naming the `tui` key and the accepted values, and no sandbox exec is recorded

#### Scenario: Resume flags are refused in OpenCode mode
- **WHEN** `tui = "opencode"` and the user runs bare `maki-oss --continue`
- **THEN** the helper exits non-zero with an error stating that session resume is unsupported in OpenCode TUI mode, and no bridge or sandbox exec is started

### Requirement: Session resume flag pass-through
The helper SHALL accept `--continue`, `--resume <ID>`, and `--session-id <ID>` on bare `maki-oss`, `maki-oss maki`, and `maki-oss run "<prompt>"`, and SHALL forward them to the Maki process it execs inside the sandbox as Maki's `--continue`, `--resume <ID>`, and `--session-id <ID>` respectively. `--continue` together with `--resume` SHALL be a usage error (exit 1) that names both flags and MUST NOT launch Maki; `--session-id` SHALL be accepted alongside either of them. A missing or empty value for `--resume` or `--session-id` SHALL be a usage error. When the `tui` setting resolves to `opencode`, bare `maki-oss` and `maki-oss maki` SHALL refuse all three flags with a usage error that names OpenCode TUI mode and starts no bridge, while `maki-oss run` keeps them unchanged. On commands that do not launch Maki the flags SHALL be accepted and have no effect, exactly as `--model` behaves today. Passing resume flags SHALL NOT change what the helper syncs: the exit sync SHALL still collect only the sandbox workspace, never the sandbox's session or state directory, and the helper MUST NOT add any host-side session transcript storage.

#### Scenario: Interactive session resumes the most recent conversation
- **WHEN** the user runs `maki-oss maki --continue` against a `Ready` sandbox
- **THEN** the sandbox exec launches `maki` with `--continue` after it, and the session still syncs workspace changes back to the host on exit

#### Scenario: Headless run resumes a session by id
- **WHEN** the user runs `maki-oss run --resume CgADMGeR7WnHDw7NJRUfN "keep going"`
- **THEN** the sandbox exec launches `maki --print --yolo --trust --output-format json --resume CgADMGeR7WnHDw7NJRUfN "keep going"` and stdout still carries only Maki's output

#### Scenario: Session flags are separated from the prompt
- **WHEN** the user runs `maki-oss run --continue "fix the tests"`
- **THEN** the prompt passed to Maki is exactly `fix the tests` and `--continue` appears only as an option, not inside the prompt

#### Scenario: Chosen session id is forwarded
- **WHEN** the user runs `maki-oss run --session-id ci-run-42 "start the migration"`
- **THEN** the sandbox exec passes `--session-id ci-run-42` to Maki and the exit sync behavior is unchanged

#### Scenario: Conflicting resume flags are refused
- **WHEN** the user runs `maki-oss maki --continue --resume CgADMGeR7WnHDw7NJRUfN`
- **THEN** the helper exits 1 with an error naming both flags and no sandbox exec is recorded

#### Scenario: Missing resume value is refused
- **WHEN** the user runs `maki-oss maki --resume` with no following argument, or passes an empty `--resume ""`
- **THEN** the helper exits 1 with a usage error that names `--resume` and launches no Maki process

#### Scenario: Flags on a non-session command have no effect
- **WHEN** the user runs `maki-oss status --continue`
- **THEN** the command runs as `status`, exits the way it would without the flag, and launches no Maki process

#### Scenario: Session state never crosses the boundary
- **WHEN** any session command with resume flags exits and the helper performs its sync
- **THEN** the patch source is the sandbox workspace only, and no session transcript is written to the project directory or to the helper's sync state by the helper

#### Scenario: Resume flags refused in OpenCode TUI mode
- **WHEN** `tui = "opencode"` and the user runs `maki-oss run --continue "keep going"`
- **THEN** the headless run resumes as usual, and the same flag on bare `maki-oss` exits 1 naming OpenCode TUI mode without starting a bridge

### Requirement: Project transfer in and out

`maki-oss upload [path] [dest]` SHALL copy local files into the sandbox using `openshell sandbox upload` and SHALL NOT create a bind mount or any other host filesystem exposure. When the destination is the project workspace, upload SHALL refresh the tracked tree: it SHALL upload the current host tree and SHALL remove tracked files that the previous refresh placed in the workspace but the current host tree no longer contains, while preserving gitignored sandbox-local artifacts. Upload SHALL refuse when the workspace is parked unless `--discard` is passed; `maki-oss upload --discard` SHALL discard the parked output and refresh, while keeping patch files on disk. Upload SHALL warn, without refusing, when a retained patch is unapplied. On success it SHALL record the new baseline and synced pair and SHALL keep the retained patch available for review. `maki-oss download [path] [dest]` SHALL copy files from the sandbox workspace to an explicit host destination.

#### Scenario: Upload never mounts
- **WHEN** the user runs `maki-oss upload .`
- **THEN** the helper invokes `openshell sandbox upload` and its argv contains no mount or bind option

#### Scenario: Upload mirrors a tracked deletion
- **WHEN** the host deletes a tracked file that the previous refresh placed in the workspace and the user runs `maki-oss upload`
- **THEN** the file is absent from the sandbox workspace after the upload

#### Scenario: Upload preserves gitignored artifacts
- **WHEN** the sandbox workspace contains a gitignored dependency directory such as `node_modules` or `.venv` and the user runs `maki-oss upload`
- **THEN** that directory is preserved

#### Scenario: Upload refuses a parked workspace
- **WHEN** the workspace is parked and the user runs `maki-oss upload` without `--discard`
- **THEN** no upload is recorded and the error names the `--discard` and download commands

#### Scenario: Upload discards a parked workspace
- **WHEN** the workspace is parked and the user runs `maki-oss upload --discard`
- **THEN** the refresh proceeds, the parked state is cleared, and existing patch files remain on disk

#### Scenario: Upload warns about a retained patch
- **WHEN** a retained patch is unapplied and the user runs `maki-oss upload`
- **THEN** the refresh proceeds, the retained patch remains available, and the output names its path

#### Scenario: Subpath upload keeps copy-in semantics
- **WHEN** the user runs `maki-oss upload ./dist /sandbox/project/dist`
- **THEN** only that path is copied and no tracked-file pruning is attempted

### Requirement: Secret hygiene
The helper SHALL refuse to pass sandbox environment variables whose names contain a credential-like underscore-separated segment (`TOKEN`, `SECRET`, `PASSWORD`, `CREDENTIAL`, `API_KEY`, `ACCESS_KEY`, or `SECRET_KEY`) on every command that can create a sandbox, including `up`, bare `maki-oss`, `maki-oss maki`, and `maki-oss run`, and SHALL direct the user to `maki-oss provider add`. The check MUST run before any gateway mutation. Passing `--allow-env KEY` SHALL override the refusal for that key only.

The guard SHALL cover every way the helper can write a sandbox environment variable, including `--env-from KEY[=ENVVAR]`. For a value sourced from the caller's environment, the guard SHALL check both names: the name the sandbox will hold (`KEY`) and the name the value is read from (`ENVVAR`, or `KEY` when no source name is given), because a credential-shaped value under a neutral sandbox name is the same exposure. A refusal SHALL name the flag the user actually passed, so the message matches the command rather than pointing at a flag that was not used.

#### Scenario: API key through --env is refused
- **WHEN** the user runs `maki-oss init --env ANTHROPIC_API_KEY=test`
- **THEN** the command exits non-zero before creating the sandbox and the error explains the provider-based alternative

#### Scenario: Session path refuses credential-like env
- **WHEN** the user runs `maki-oss run --env ANTHROPIC_API_KEY=sk-secret "hello"` with no sandbox yet
- **THEN** the command exits non-zero before any `sandbox create` invocation and the error explains the provider-based alternative

#### Scenario: Explicit override is honored
- **WHEN** the user runs `maki-oss init --env MY_TOKEN=x --allow-env MY_TOKEN`
- **THEN** the variable is passed through to the sandbox

#### Scenario: Non-segment lookalikes pass
- **WHEN** the user passes `--env TOKENIZERS_PARALLELISM=false`
- **THEN** the variable is passed through without a refusal

#### Scenario: API key sourced through --env-from is refused
- **WHEN** the user runs `maki-oss init --env-from ANTHROPIC_API_KEY`
- **THEN** the command exits non-zero before creating the sandbox, and the error names `--env-from` and explains the provider-based alternative

#### Scenario: A neutral sandbox name does not launder a credential source
- **WHEN** the user runs `maki-oss init --env-from HARMLESS_NAME=ANTHROPIC_API_KEY`
- **THEN** the command exits non-zero before creating the sandbox, because the value is read from a credential-shaped source name

#### Scenario: A non-secret variable is passed through
- **WHEN** the user runs `maki-oss init --env-from EDITOR` with a non-credential-like `EDITOR` in the environment
- **THEN** the sandbox receives `EDITOR` with the caller's value and no refusal is raised

### Requirement: Prerequisite diagnostics
`maki-oss doctor` SHALL check at least: the `openshell` CLI exists, the gateway is reachable, the configured container engine is available, the configured image exists locally or is pullable, and configured policy and provider names resolve. When the `tui` setting resolves to `opencode`, it SHALL additionally check that `bun`, the `opencode` binary, and the bridge entrypoint exist, and it MUST NOT fail those checks when the setting is unset. It SHALL print one line per check and exit non-zero when any check fails.

#### Scenario: Missing OpenShell reported
- **WHEN** `doctor` runs with no `openshell` on `PATH`
- **THEN** the output names that failure first and exits non-zero without attempting sandbox operations

#### Scenario: TUI prerequisites checked only when configured
- **WHEN** `doctor` runs with `tui = "opencode"` and `bun` is absent from `PATH`
- **THEN** the output names the missing `bun` and exits non-zero

#### Scenario: TUI prerequisites skipped when unset
- **WHEN** `doctor` runs with `tui` unset on a host without `bun` or `opencode`
- **THEN** the TUI checks are not attempted and their absence alone does not fail the run

### Requirement: Destructive commands require confirmation
`maki-oss rm` SHALL print the exact sandbox name and require interactive confirmation or an explicit `--yes` flag before deleting. When stdin is not a TTY it SHALL require `--yes` and otherwise exit non-zero without deleting.

#### Scenario: rm without --yes prompts
- **WHEN** the user runs `maki-oss rm` interactively
- **THEN** the helper prints the sandbox name and waits for confirmation before deleting

#### Scenario: Non-interactive rm without --yes fails
- **WHEN** stdin is not a TTY and `--yes` is not passed
- **THEN** the command exits non-zero and no delete request is sent

### Requirement: Provider setup wizard
`maki-oss provider setup` SHALL provide an interactive flow that discovers stored credentials, resolves a provider profile, ensures the profile is known to the gateway, creates or updates the provider, and offers to attach it to the project sandbox. Every step SHALL be available non-interactively through flags (at least `--from`, `--credential`, `--profile`, and `--yes`) for scripted use. When stdin is not a TTY and the flags needed to complete the flow are absent, the command SHALL exit non-zero before performing any gateway mutation.

#### Scenario: Interactive setup from a stored credential
- **WHEN** a supported store contains an API-key credential and the user selects it in `maki-oss provider setup`
- **THEN** the helper lints and imports the resolved profile, creates the provider from the stored key, and prints next-step guidance

#### Scenario: Non-TTY without flags makes no changes
- **WHEN** stdin is not a TTY and the required flags are absent
- **THEN** the command exits non-zero and no `openshell profile import`, `provider create`, or `provider update` invocation is recorded

### Requirement: Credential store scanning
The helper SHALL detect API-key credentials in the Maki store (`~/.local/state/maki/auth/*.json` and `~/.local/state/maki/auth/plugins/*.json`) and the OpenCode store (`~/.local/share/opencode/auth.json`), and SHALL present each credential's store, provider id, and auth type. OAuth credentials SHALL be presented as unsupported and SHALL NOT be usable for provider creation. Storage scanning SHALL NOT display or log credential values.

#### Scenario: API-key credentials are listed
- **WHEN** the Maki store holds an `opencode-go` key and the OpenCode store holds a `deepseek` key
- **THEN** both are listed with their store and provider id, and neither value appears in the output

#### Scenario: OAuth credentials are not selectable
- **WHEN** the OpenCode store holds an `openai` credential of type `oauth`
- **THEN** it is listed as unsupported, and selecting it exits non-zero with guidance without creating or updating any provider

#### Scenario: No supported store present
- **WHEN** neither store exists on the host
- **THEN** the helper reports no detected credentials and offers the generic credential sources instead of failing

### Requirement: Generic credential sources
For credentials not present in a supported store, the helper SHALL accept a JSON file with a field path, a host environment variable name, or a hidden interactive prompt, and SHALL use the resulting value only in the provider creation flow.

#### Scenario: JSON file with field path
- **WHEN** the user selects a file source with a field path
- **THEN** the value at that path is used for provider creation

#### Scenario: Environment variable source
- **WHEN** the user selects an environment variable source and the variable is set on the host
- **THEN** the helper uses it without reading from stdin

#### Scenario: Hidden prompt source
- **WHEN** the user selects the hidden prompt source in an interactive session
- **THEN** the helper reads the value with terminal echo disabled and does not echo it

### Requirement: Profile resolution and generation
Given a selected credential, the helper SHALL resolve a provider profile from: a curated profile file under `examples/providers/` matched through the catalog mapping, an explicit `--profile` file, or a generated custom profile for an unknown provider. Custom profiles SHALL be generated only after validating the provider id (kebab-case), credential environment variable name, host, and API path, and SHALL be written under `${XDG_CONFIG_HOME:-$HOME/.config}/maki-oss/profiles/`. Profiles SHALL be linted before import, imported at global scope, and an existing generated profile SHALL NOT be overwritten without confirmation.

#### Scenario: Curated provider resolves to a shipped profile
- **WHEN** the selected credential matches a catalog entry
- **THEN** the matching file under `examples/providers/` is used and no generated file is written

#### Scenario: Custom provider generates a profile
- **WHEN** an unknown provider is configured with an env var, host, and API path
- **THEN** a profile file is generated in the helper's profiles directory, linted, and imported

#### Scenario: Invalid custom input is rejected
- **WHEN** a custom provider would be generated with an invalid id or without a host
- **THEN** the helper exits non-zero without writing a profile or importing anything

#### Scenario: Existing generated profile is preserved
- **WHEN** the target generated profile already exists and the user declines overwriting
- **THEN** the existing file is left unchanged

### Requirement: Credential non-exposure
The helper SHALL supply credential values to the OpenShell CLI only through the environment of the invoked child process. It SHALL NOT place values in command arguments, write them to any file, or print them to stdout or stderr, including error messages and logs, and its output SHALL be safe to capture in a shared log.

#### Scenario: Credential absent from argv
- **WHEN** the wizard creates a provider from a stored key
- **THEN** the recorded `openshell` invocation contains `--from-existing` and no credential value

#### Scenario: Credential absent from output
- **WHEN** a store-sourced setup flow completes or fails
- **THEN** stdout and stderr contain no credential value

#### Scenario: Credential absent from generated files
- **WHEN** a custom profile is generated
- **THEN** the file contains profile configuration only and no credential value

### Requirement: Provider create or update
The helper SHALL create the provider when its name does not exist, and SHALL offer to update an existing provider through the gateway's discovery flow instead of failing. When a provider is created or updated and a sandbox is selected, the helper SHALL offer to attach it and SHALL wait for the attachment to be applied when confirmed.

#### Scenario: New provider is created
- **WHEN** no provider with the target name exists
- **THEN** the helper runs `provider create --from-existing`

#### Scenario: Existing provider is updated
- **WHEN** the provider name already exists and the user confirms
- **THEN** the helper runs `provider update --from-existing` and creates no duplicate

#### Scenario: Optional attach waits for apply
- **WHEN** the user confirms attaching the provider to a sandbox
- **THEN** the helper runs `sandbox provider attach` with `--wait`

### Requirement: One-command project session

Bare `maki-oss` (no subcommand), `maki-oss maki`, and `maki-oss run "<prompt>"` SHALL share an idempotent ensure routine before launching Maki: resolve remembered providers from configuration, create the project sandbox when absent using the configured image, policy, resources, and remembered providers, start it when stopped, attach any remembered provider that is not currently attached, and make the workspace match the host under the disposable-workspace rules. The routine SHALL refresh the tracked project tree from the host when the host tree differs from the last synced host tree and the workspace has no output without a durable patch. It SHALL refresh a `retained` workspace before launching Maki even when the host tree matches. It SHALL skip the upload when the host and sandbox trees match and no retained patch is pending, and it MUST NOT upload over a parked workspace. It SHALL refuse to launch Maki while the workspace is parked and SHALL print the download or discard command. It SHALL announce whether it reused without uploading, refreshed the workspace, or refused. The explicit `maki-oss up` command SHALL remain create/start-only, and explicit `upload`, `download`, and `provider attach` SHALL keep their manual semantics.

#### Scenario: Fresh project starts in one command
- **WHEN** no sandbox exists for the project and the user runs `maki-oss` (or `maki-oss run "<prompt>"`) in the project directory with providers remembered
- **THEN** the sandbox is created with those providers, the project is uploaded once, and Maki runs in the sandbox workspace

#### Scenario: Existing sandbox is reused without upload
- **WHEN** the project sandbox exists in `Ready` phase, the host tree matches the last synced host tree, and the user runs bare `maki-oss`
- **THEN** the existing sandbox is reused and no upload invocation is recorded

#### Scenario: Reuse without upload is announced
- **WHEN** a session reuses an existing sandbox without an upload
- **THEN** stderr states that the workspace is already current and no refresh was needed

#### Scenario: Changed host refreshes on reuse
- **WHEN** the project sandbox exists, the host tree differs from the last synced host tree, the workspace has no output without a durable patch, and the user runs bare `maki-oss`
- **THEN** the helper uploads the current host tree before Maki runs and records the new baseline

#### Scenario: Reuse refresh is announced
- **WHEN** a session reuses an existing sandbox and refreshes the workspace
- **THEN** stderr carries a note that the workspace was refreshed from the host

#### Scenario: Uncollected sandbox output is not overwritten
- **WHEN** the sandbox workspace contains output without a durable patch
- **THEN** the helper does not upload over it, treats the workspace as parked, and refuses to launch Maki until the output is downloaded or discarded

#### Scenario: Parked workspace refuses to launch
- **WHEN** a session is requested for a parked workspace
- **THEN** the helper starts no Maki process and prints the download or discard command

#### Scenario: Stopped sandbox is started
- **WHEN** the project sandbox exists in `Stopped` phase
- **THEN** the helper starts the existing sandbox and no second sandbox is created

#### Scenario: Missing provider attachment is repaired
- **WHEN** a remembered provider is not attached to the project sandbox
- **THEN** the helper attaches it with `--wait` before launching Maki

#### Scenario: Explicit up stays create-only
- **WHEN** the user runs `maki-oss up`
- **THEN** only create/start behavior runs: no upload and no Maki launch

### Requirement: Inline provider bootstrap
When no provider is remembered, the helper SHALL NOT create or start a sandbox or launch Maki. On a TTY it SHALL offer to run the provider setup flow inline and continue the session after success. When stdin is not a TTY it SHALL exit non-zero with the exact `maki-oss provider setup` command to run, before any gateway mutation. When a remembered provider name does not exist on the gateway, the helper SHALL exit non-zero naming it and pointing at `maki-oss provider setup`.

#### Scenario: TTY bootstrap continues the session
- **WHEN** bare `maki-oss` runs on a TTY with no provider remembered
- **THEN** the provider setup flow runs, the provider is remembered, and the session continues without a second invocation

#### Scenario: Non-TTY bootstrap makes no changes
- **WHEN** stdin is not a TTY and no provider is remembered
- **THEN** the helper exits non-zero with the setup command and no sandbox create, start, or exec invocation is recorded

#### Scenario: Missing gateway provider fails actionably
- **WHEN** a remembered provider is absent from the gateway
- **THEN** the command exits non-zero naming that provider and suggesting `maki-oss provider setup`, before creating a sandbox

### Requirement: Provider and model memory
On successful completion, `maki-oss provider setup` and `maki-oss provider add` SHALL record the provider instance name in the config file's `providers` list, deduplicated and comma-separated, creating the config file when absent, without altering comments or unrelated lines and without ever writing credential values. The helper SHALL accept an optional `model` config key; a `--model` flag SHALL take precedence over it, and when neither is set Maki's own selection applies. The interactive setup flow SHALL offer to set the model.

#### Scenario: Wizard remembers the provider
- **WHEN** a provider setup flow completes successfully
- **THEN** its instance name appears in the config `providers` list, and recording it again does not duplicate the name

#### Scenario: Config rewrite preserves unrelated content
- **WHEN** the config file contains comments and other keys and a provider is remembered
- **THEN** only the providers list changes and all other lines are preserved

#### Scenario: Model precedence
- **WHEN** the config sets `model = "opencode-go/deepseek-v4.1-flash"` and no flag is passed
- **THEN** that model is passed to Maki; when `--model other/model` is passed, the flag wins

#### Scenario: No credentials in config
- **WHEN** any provider is remembered
- **THEN** the config contains provider names and model ids only, never a credential value

### Requirement: Session sync-back

When a Maki session launched by bare `maki-oss`, `maki-oss maki`, or `maki-oss run` ends, including non-zero exits and interrupts, the helper SHALL collect the sandbox workspace changes as a patch relative to the baseline the sandbox session started from, unless `--no-sync` is set. The helper SHALL apply that patch to the local project only when the safety check for the project's mode passes; otherwise it SHALL leave every local file unchanged and retain the patch for review. A retained patch SHALL NOT freeze the workspace: the next session SHALL refresh a retained workspace before launching Maki while the patch waits for the user. When collection fails, the helper SHALL park the workspace because no durable patch exists. When `--no-sync` is passed, the helper SHALL park the workspace and SHALL print the explicit download command. The helper MUST NOT overwrite the project with an automatic overlay of the sandbox workdir. A failed collection, application, or safety check SHALL warn on stderr without replacing Maki's exit code. In `maki-oss run`, helper output SHALL go to stderr so stdout carries Maki's output unchanged.

#### Scenario: Interactive exit syncs changes back
- **WHEN** the user exits an interactive session after Maki changed files and the project's safety check passes
- **THEN** the agent's changes are applied to the project, and files the agent did not change are left as they were on the host

#### Scenario: Conflicting host changes leave the project unchanged
- **WHEN** the user changed a file during the session and the sandbox also changed that file
- **THEN** no local file is overwritten, the patch is retained, and the helper reports how to review the conflict

#### Scenario: Retained patch does not freeze the workspace
- **WHEN** a previous session retained a patch because it could not be applied and the user starts a new session
- **THEN** the helper refreshes the workspace before Maki launches, and the retained patch remains available for review

#### Scenario: Headless run syncs without polluting stdout
- **WHEN** `maki-oss run "<prompt>"` finishes
- **THEN** the patch is applied or retained according to the safety check, stdout contains only Maki's output, and the exit code is Maki's

#### Scenario: Interrupt still syncs
- **WHEN** the interactive session is interrupted with SIGINT
- **THEN** the helper attempts the same patch collection before exiting

#### Scenario: No-sync opt-out
- **WHEN** `--no-sync` is passed
- **THEN** no patch is collected, the workspace is parked, and the helper prints the manual download command

#### Scenario: Collection failure parks the workspace
- **WHEN** patch collection fails and no durable patch exists
- **THEN** the workspace is parked and the recovery commands are printed

#### Scenario: Sync failure preserves Maki's status
- **WHEN** patch collection or application fails
- **THEN** a warning goes to stderr and the helper exits with Maki's code, not the failure's

### Requirement: Session baseline and freshness

Before Maki runs, the helper SHALL record a baseline that identifies the sandbox instance by its OpenShell sandbox ID, the host commit and branch when the project is a git repository and the host `git` binary is available, the baseline tree hash, whether the working tree was clean, dirty, or had untracked non-ignored files, the sandbox tree, and the host/sandbox tree pair recorded at the last refresh or clean apply. At session start the helper SHALL classify the workspace as one of:

- `clean`: the host and sandbox trees match the recorded pair.
- `behind`: the host tree differs from the recorded host tree and the sandbox tree matches the recorded sandbox tree.
- `retained`: a collected patch for sandbox output exists on the host, its recorded result tree matches the sandbox tree, and it has not been applied.
- `parked`: the sandbox contains output that no retained patch covers, because collection failed, `--no-sync` was used, the sandbox was edited outside the helper, or the sandbox changed after collection.

A retained patch whose result tree no longer matches the sandbox is an advisory notice; it does not change a `clean` or `behind` classification.

The helper MUST NOT upload over a parked workspace. It SHALL refresh a `behind` workspace. It SHALL refresh a `retained` workspace before the next session, even when the host tree matches the recorded host tree. It MAY refresh a `clean` workspace; it SHALL skip the upload when the host and sandbox trees already match. A retained patch that is only a notice does not force an upload. Before using the automatic apply path, the helper SHALL compare the host baseline tree with the sandbox baseline tree. If they differ, the helper MUST NOT fast-forward or silently apply changes from a workspace the host has not accepted. When the recorded sandbox ID differs from the current sandbox ID, the helper SHALL treat the recorded state as belonging to a previous instance and MUST NOT let it park or block the new sandbox.

#### Scenario: Clean baseline is recorded
- **WHEN** a session starts in a clean git repository whose working tree matches the uploaded tree
- **THEN** the helper records the sandbox ID, the current commit, branch, and tree, and the automatic apply path is eligible after a successful patch check

#### Scenario: Dirty or untracked baseline is recorded
- **WHEN** a session starts with uncommitted changes or untracked non-ignored files
- **THEN** the recorded baseline includes those files, and the helper does not treat the commit alone as the baseline

#### Scenario: Host changed only is behind and refreshable
- **WHEN** the host tree differs from the recorded host tree and the sandbox tree matches the recorded sandbox tree
- **THEN** the helper classifies the workspace as `behind` and refreshes it from the host

#### Scenario: Sandbox output without a durable patch is parked
- **WHEN** the sandbox tree differs from the recorded sandbox tree and no retained patch covers that output
- **THEN** the helper classifies the workspace as `parked` and does not upload over it

#### Scenario: Retained patch allows a refresh
- **WHEN** the sandbox tree differs from the recorded sandbox tree and a retained patch covers that output
- **THEN** the helper refreshes the workspace before the next session and keeps the retained patch available

#### Scenario: Matching trees skip the upload
- **WHEN** the host tree and sandbox tree already match the recorded pair
- **THEN** the helper records the session baseline and does not upload

#### Scenario: State from a previous sandbox instance is ignored
- **WHEN** the recorded sandbox ID differs from the current sandbox ID
- **THEN** the helper does not inherit `parked` or `retained` state from the previous instance

#### Scenario: Stale sandbox blocks the automatic path
- **WHEN** the sandbox baseline tree differs from the host baseline tree
- **THEN** the helper does not fast-forward or silently apply the patch, and it reports whether the patch was retained or the workspace was parked

### Requirement: Git repository apply path
The helper SHALL use a temporary git worktree when the project is a git
repository, the upload used the default `.gitignore` filtering, and the host
`git` binary is available. For a clean baseline at `HEAD`, the worktree SHALL
be created at that commit. For a dirty
or untracked baseline, the helper SHALL create a synthetic baseline commit
whose tree is the current working tree and whose parent is `HEAD`, and SHALL
create the worktree at that commit. The helper SHALL apply the patch in the
worktree and commit the result on a temporary branch. The helper SHALL
fast-forward the host branch only when the host is still on the recorded branch
at the recorded commit with no tracked changes, and SHALL then remove the
temporary worktree and branch. When the host moved, is dirty, or the patch
conflicts, the helper SHALL keep the branch and worktree and report how to
review, cherry-pick, or merge it. A dirty or untracked baseline MUST NOT be
fast-forwarded automatically, because that would commit the user's uncommitted
work. When the upload used `--no-git-ignore`, the helper SHALL NOT create the
worktree and SHALL use the plain-directory patch check instead.

#### Scenario: Clean host fast-forwards
- **WHEN** the host is still on the recorded branch at the recorded commit with no tracked changes and the patch applies cleanly in the temporary worktree
- **THEN** the helper fast-forwards the host branch, removes the temporary worktree, and deletes the temporary branch

#### Scenario: Host moved during the session
- **WHEN** the host branch has a new commit or a different checked-out branch at session end
- **THEN** the helper does not fast-forward, retains the temporary branch and worktree, and prints the review and merge commands

#### Scenario: Dirty baseline keeps the result branch
- **WHEN** the session started with uncommitted or untracked work and the patch applies in the synthetic-baseline worktree
- **THEN** the helper keeps the temporary branch and worktree, does not fast-forward, and identifies the result commit for cherry-pick

#### Scenario: Patch conflict keeps the review surface
- **WHEN** the patch does not apply cleanly in the temporary worktree
- **THEN** the helper leaves the host unchanged, retains the patch and worktree, and reports the conflict for manual resolution

#### Scenario: Untracked files changed by Maki
- **WHEN** Maki changed a file that was untracked on the host
- **THEN** the helper reports that cherry-pick may require the path to be added first, or that the patch may be applied directly, and the changes remain available in the review worktree

#### Scenario: Unfiltered upload uses the patch check
- **WHEN** the session uploaded the project with `--no-git-ignore`
- **THEN** the helper does not create a worktree or fast-forward, and it applies the patch through the plain-directory check

### Requirement: Plain directory apply path
When the project is not a git repository, or the host `git` binary is
unavailable, the helper SHALL NOT require a repository. When the `git` binary
is available, it SHALL apply the patch with `git apply --check` followed by
`git apply`; when the check fails, it MUST
leave the project unchanged and retain the patch. When `git` is not available,
the helper SHALL use `patch` or `diff3` for text changes, a hash-manifest
selective export for binary changes, or fail closed when neither is available.
The helper MUST NOT download the sandbox workdir over the project
automatically.

#### Scenario: Plain directory applies a clean patch
- **WHEN** the project is a plain directory and `git apply --check` succeeds
- **THEN** the helper applies the patch, and host-only files remain untouched

#### Scenario: Plain directory conflict keeps the project
- **WHEN** the project is a plain directory and `git apply --check` fails
- **THEN** no local file is changed, the patch is retained, and the helper reports the path for review

#### Scenario: Plain directory without git handles text changes
- **WHEN** the `git` binary is unavailable and the patch contains only text changes
- **THEN** the helper uses `patch` or `diff3` and reports any conflicts without overwriting unrelated files

#### Scenario: Plain directory without an apply tool fails closed
- **WHEN** the project is a plain directory, `git` is unavailable, and no text merge tool is available
- **THEN** the helper writes nothing to the project and leaves the changes in the sandbox for explicit recovery

### Requirement: Fail-closed recovery

When patch collection fails, the helper SHALL write nothing to the project, SHALL park the workspace because no durable patch exists, SHALL leave the changes in the sandbox, and SHALL print recovery commands that include the sandbox name, the workspace path, how to inspect the sandbox, how to copy a specific path with `maki-oss download`, and the `osa resolve <sandbox> rescue` and `osa resolve <sandbox> discard --yes` commands. When baseline verification or application fails and the collected patch exists, the helper SHALL write nothing to the project, SHALL retain the patch, SHALL NOT park the workspace, and SHALL print review commands, including `osa resolve <sandbox> apply`, `branch`, and `drop --yes`. A retained patch SHALL remain available until the user applies, branches, or drops it; the helper MAY clear the notice when it detects the patch is already applied. The helper MUST NOT automatically download the whole sandbox workspace to the host as a fallback. A full copy SHALL occur only when the user explicitly runs `maki-oss download` or `osa resolve <sandbox> rescue`. `maki-oss upload` MUST refuse a parked workspace unless `--discard` is passed, and `maki-oss rm` MUST refuse a parked workspace unless `--discard` is passed. When a sandbox is recreated, state recorded for the previous instance MUST NOT block the new sandbox; the helper SHALL archive or clear it. The helper SHALL record whether the workspace is `retained` or `parked` and SHALL use that classification in later sessions.

#### Scenario: Collection failure leaves the project untouched
- **WHEN** the helper cannot collect a patch because of a sandbox, git, or baseline error
- **THEN** no local file is changed, the workspace is parked, and the recovery commands are printed

#### Scenario: Application failure leaves the project untouched
- **WHEN** the patch cannot be applied safely
- **THEN** no local file is changed, the patch is retained, the workspace is not parked, and the patch path is printed

#### Scenario: Recovery names the sandbox and path
- **WHEN** the helper fails closed
- **THEN** the message names the sandbox, the workspace path, an inspection command, and a path-copy command

#### Scenario: Recovery names the osa resolve commands
- **WHEN** the helper retains a patch at session exit
- **THEN** the message includes `osa resolve <sandbox> apply`, `osa resolve <sandbox> branch`, and `osa resolve <sandbox> drop --yes` with the real sandbox name

#### Scenario: Full copy is explicit only
- **WHEN** the helper fails closed
- **THEN** it does not run a full workspace download, and a full copy occurs only when the user invokes `maki-oss download` or `osa resolve <sandbox> rescue`

#### Scenario: Retained patch does not block automatic refresh
- **WHEN** a previous session retained a patch and the user starts a new session for the same sandbox
- **THEN** the helper refreshes the retained workspace and reports the retained patch for review

#### Scenario: Pending patch blocks automatic refresh
- **WHEN** a previous session parked the workspace and the user starts a new session for the same sandbox
- **THEN** the helper does not upload over the workspace or automatically apply a new patch, and it reports the download or `--discard` command

#### Scenario: Recreated sandbox ignores a dead instance's marker
- **WHEN** a sandbox is recreated under the same name and the recorded sandbox ID belongs to the previous instance
- **THEN** the new sandbox is not parked by that marker and its first session refreshes normally

#### Scenario: No-sync parks the workspace
- **WHEN** a session ends with `--no-sync`
- **THEN** the workspace is parked and the next session refuses to refresh it until the user downloads or discards the output

#### Scenario: Rm refuses a parked workspace
- **WHEN** the workspace is parked and the user runs `maki-oss rm --yes`
- **THEN** no delete request is sent and the error names the `--discard` command

### Requirement: Patch content and git isolation
The collected patch SHALL carry additions, modifications, deletions, renames,
and binary changes that Maki made inside the sandbox workspace, and SHALL NOT
carry the sandbox's `.git` directory or any host `.git` metadata. The helper
MUST NOT upload the host `.git` directory to the sandbox or download a
sandbox `.git` directory into the host project. Applying a patch SHALL
preserve host-only files and ignored host files unless the patch explicitly
changes a path.

#### Scenario: Deletion travels back
- **WHEN** Maki deletes a file inside the sandbox workspace and the patch applies
- **THEN** the corresponding host file is deleted

#### Scenario: Rename travels back
- **WHEN** Maki renames a file inside the sandbox workspace and the patch applies
- **THEN** the host file is renamed rather than duplicated

#### Scenario: Host-only file is preserved
- **WHEN** a host file does not exist in the sandbox and the patch applies
- **THEN** the host file remains unchanged

#### Scenario: Agent-created git metadata stays in the sandbox
- **WHEN** Maki creates a `.git` directory inside the sandbox workspace
- **THEN** the host `.git` directory is not modified and the sandbox `.git` is not part of the applied patch

#### Scenario: Binary change travels back
- **WHEN** Maki changes a binary file and the patch applies
- **THEN** the host file contains the sandbox version

### Requirement: Wizard terminates on interrupt
The provider setup wizard and every other `maki-oss` command SHALL terminate when the helper process receives SIGINT or SIGTERM, after removing its temporary files. The commands MUST NOT continue to the next step after handling the signal.

#### Scenario: SIGINT stops the wizard
- **WHEN** the user presses Ctrl-C while `maki-oss provider setup` is prompting or waiting on the gateway
- **THEN** the helper removes its temporary directory and exits with the interrupt status, without issuing further gateway commands

#### Scenario: SIGTERM stops the helper
- **WHEN** the helper receives SIGTERM during `maki-oss provider setup`
- **THEN** the process exits and does not continue to the next setup step

### Requirement: Agent policy proposal loop is enabled per sandbox
Session ensure (bare `maki-oss`, `maki-oss maki`, `maki-oss run`) SHALL set
the sandbox setting `agent_policy_proposals_enabled=true` on the project
sandbox before Maki attaches, so an agent that hits a denied network request
can submit a network-rule proposal and wait for the human decision. The
enable SHALL happen on fresh creation and on reuse of an existing sandbox,
SHALL be idempotent, and SHALL NOT set any approval mode (proposals stay in
manual review). `maki-oss up` SHALL NOT set the setting. A failure to set
the setting SHALL warn on stderr and continue the session rather than
aborting it.

#### Scenario: Fresh sandbox gets the advisor before Maki starts
- **WHEN** session ensure creates the project sandbox and launches Maki
- **THEN** `openshell settings set <name> --key agent_policy_proposals_enabled --value true` is invoked before the Maki exec, and no `--approval-mode` or `proposal_approval_mode` change is recorded

#### Scenario: Reused sandbox is enabled too
- **WHEN** session ensure reuses an existing sandbox that predates this behavior
- **THEN** the setting is set before Maki attaches, without recreating the sandbox

#### Scenario: Setting failure does not kill the session
- **WHEN** the settings command fails (for example, an older gateway)
- **THEN** a warning goes to stderr and the session proceeds as before

#### Scenario: Explicit up stays settings-free
- **WHEN** the user runs `maki-oss up`
- **THEN** no `openshell settings set` invocation is recorded

### Requirement: Pending proposals surfaced at session exit
When a Maki session launched by bare `maki-oss`, `maki-oss maki`, or
`maki-oss run` ends — including non-zero exits and interrupts, alongside the
existing sync-back — the helper SHALL check the project sandbox for pending
network-rule proposals and, when any exist, print to stderr the count and
the `maki-oss policy review` command. The check SHALL NOT mutate proposals
and SHALL fail soft (a warning at most) when the gateway is unreachable or
the `openshell rule` subcommand is unavailable. The note SHALL NOT appear on
the `--no-sync` path or on commands that did not launch Maki.

#### Scenario: Exit with pending proposals warns
- **WHEN** a session ends and the sandbox has two pending proposals
- **THEN** stderr carries a count of pending proposals and the review command, before or after the sync note

#### Scenario: Empty inbox prints nothing extra
- **WHEN** a session ends and no proposals are pending
- **THEN** no policy note is printed

#### Scenario: Interrupted session still surfaces
- **WHEN** the interactive session is interrupted with SIGINT
- **THEN** the pending-proposal check still runs on the exit path

#### Scenario: Gateway trouble never masks Maki's exit code
- **WHEN** the pending check itself fails (gateway down, command missing)
- **THEN** at most a warning is printed and the helper exits with Maki's exit code unchanged

### Requirement: MCP readiness command
`maki-oss mcp status` SHALL compare the servers enabled in the host's
`~/.config/maki/mcp.toml` against the servers present in the project sandbox's
MCP config, and SHALL report one line per server naming each gate that decides
whether the server works in the sandbox. For an HTTP server those gates are:
present in the sandbox config, provider attached to the project sandbox,
endpoint present in the effective policy, and transport supported. For a stdio server they are: present in the sandbox
config, the command named by its
`command` array present in the sandbox (the runtime gate), and provider
attached — the endpoint gate is carried by the attached profile, because a
stdio server's config names no URL. A server enabled on the host but absent
from the sandbox SHALL be reported by name as missing from the sandbox,
together with the environment-image build guidance and the environment
playbook. It SHALL exit non-zero when any server fails a gate, and SHALL print
the command or guidance that fixes each failing gate — for a missing runtime,
the environment-image build guidance, not a base-image rebuild. When no sandbox
exists for the project, or neither the host config nor the sandbox config
declares an enabled server, it SHALL report that and exit zero. It SHALL NOT
mutate the sandbox, gateway, profiles, or policy, and MUST NOT print any
credential value.

#### Scenario: All gates satisfied exits zero
- **WHEN** a server's gates for its transport all hold and the user runs `maki-oss mcp status`
- **THEN** the output names the server with every gate satisfied and the command exits 0

#### Scenario: A failing gate names its fix
- **WHEN** a server's provider is not attached and the user runs `maki-oss mcp status`
- **THEN** the output names the attachment as the failing gate, prints the `maki-oss provider attach` command, and the command exits non-zero

#### Scenario: A stdio server missing its runtime names the image-build fix
- **WHEN** a stdio server is present in both configs but its command is absent from the sandbox, and the user runs `maki-oss mcp status`
- **THEN** the output names the runtime gate as failing with the missing command and the environment-image build guidance as the fix, the command exits non-zero, and no install or image change is attempted

#### Scenario: A host server missing from the sandbox is named
- **WHEN** the host's `~/.config/maki/mcp.toml` enables a server that the sandbox's MCP config does not contain, and the user runs `maki-oss mcp status`
- **THEN** that server is reported by name as missing from the sandbox with the environment-image build guidance, and the command exits non-zero

#### Scenario: A zero-MCP base points at the environment layer
- **WHEN** the sandbox is built from the base image and the host enables a server the base does not declare
- **THEN** the output names the server as missing and directs the user to the environment image and playbook rather than `maki-oss image build`

#### Scenario: No sandbox reports cleanly
- **WHEN** the user runs `maki-oss mcp status` with no project sandbox
- **THEN** the command reports no sandbox and exits 0 without attempting sandbox operations

#### Scenario: Report performs no mutation
- **WHEN** `maki-oss mcp status` runs against a `Ready` sandbox
- **THEN** no `sandbox create`, `provider attach`, `profile import`, or policy update invocation is recorded, and no credential value appears in the output

### Requirement: Doctor reports MCP readiness
`maki-oss doctor` SHALL include the MCP readiness table after its existing
prerequisite checks, reusing the same per-server gate output as
`maki-oss mcp status`. MCP readiness is not a prerequisite for running Maki, so
the doctor exit code SHALL be decided only by its prerequisite checks: an MCP
gate failure SHALL be reported but MUST NOT make doctor exit non-zero.

#### Scenario: Doctor reports an MCP failure without failing
- **WHEN** a configured MCP server's provider is not attached and the user runs `maki-oss doctor`
- **THEN** the doctor output includes that server's failing gate, and the doctor exit code is decided by its prerequisite checks alone

#### Scenario: No MCP servers is not a doctor failure
- **WHEN** the user runs `maki-oss doctor` with no MCP servers configured
- **THEN** the MCP section reports none configured and the doctor run's exit code is decided by its other checks

### Requirement: Headless run timeout
`maki-oss run` SHALL accept `--timeout SECS` (a positive integer, also
`MAKI_OSS_TIMEOUT`). When set, the sandbox exec SHALL run Maki under
`timeout --kill-after=10 SECS` inside an in-sandbox wrapper that exports a
per-run tag and, when `timeout` returns, kills every process that inherited
the tag, so the time limit is enforced inside the sandbox and ends Maki and
its tool processes there, including ones in their own session; the helper
SHALL then exit with `timeout`'s status (124 when the limit was hit). The tag
SHALL be exported inside the sandbox, never passed with `--env`; a caller MAY
choose it with `MAKI_OSS_RUN_TAG` (letters, digits, `.`, `_`, `-`), and the
wrapper SHALL stop the run early — Maki stopped, tagged processes swept, exit
status of the stopped `timeout` — within a few seconds of a file
`/tmp/maki-oss-stop/<tag>` appearing in the sandbox. An invalid value of either
SHALL be a usage error before any sandbox call. Without `--timeout` the exec
argv SHALL be unchanged.

#### Scenario: Timeout wraps the in-sandbox command
- **WHEN** the user runs `maki-oss run --timeout 600 "check"`
- **THEN** the exec argv after `--` is the tag wrapper (`sh -c`) running `timeout --kill-after=10 600 maki --print …`, with no `--env` flag

#### Scenario: Tool processes do not outlive the limit
- **WHEN** a run with `--timeout 8` makes Maki start a shell command that sleeps for two minutes
- **THEN** the helper exits 124 within a few seconds of the limit and no `maki` or `sleep` process from that run remains in the sandbox

#### Scenario: Invalid timeout is refused
- **WHEN** the user runs `maki-oss run --timeout soon "check"`
- **THEN** the helper exits 1 with a usage error and records no sandbox call

#### Scenario: No timeout keeps the argv
- **WHEN** the user runs `maki-oss run "check"` without `--timeout`
- **THEN** the exec argv after `--` starts with `maki --print`

#### Scenario: Stop file ends the run
- **WHEN** a run with `MAKI_OSS_RUN_TAG=t1` has made Maki start a two-minute shell command and another `sandbox exec` creates `/tmp/maki-oss-stop/t1`
- **THEN** the helper returns within a few seconds and no `maki` or tool process from that run remains

#### Scenario: Caller-chosen run tag
- **WHEN** `MAKI_OSS_RUN_TAG=oskhs-t1 maki-oss run --timeout 30 "check"` runs
- **THEN** the wrapper exports `oskhs-t1`, and a tag with a space is refused as a usage error before any sandbox call

### Requirement: Session idle stop
When a session launched by bare `maki-oss`, `maki-oss maki`, `maki-oss run`,
or the OpenCode TUI mode ends, for any reason (including a non-zero exit, an
interrupt, SIGHUP from a closed terminal, or the helper being killed), the
helper SHALL stop the project sandbox with `openshell sandbox stop` once the
idle period has passed since that session ended. The stop SHALL NOT happen
when, at that moment:
- a later session of the same sandbox has started through the helper, or
- a `maki` process is running inside the sandbox.

The stop SHALL run without the user's terminal, so closing the terminal
neither cancels nor speeds it up. A sandbox that never had a session (one
started only by `maki-oss up` or `maki-oss start`) SHALL NOT be stopped by this
mechanism. A failed stop or in-sandbox check SHALL leave the sandbox as it
is, SHALL print nothing to the terminal the session used, and SHALL NOT retry.

#### Scenario: Sandbox stops after the idle period
- **WHEN** `idle_stop` is `2s`, the user's only session exits, and no other session starts
- **THEN** within a few seconds after the 2 seconds pass, the helper calls `openshell sandbox stop maki-myproject` exactly once

#### Scenario: Closing the terminal still arms the stop
- **WHEN** `idle_stop` is `2s` and the helper process running the session receives SIGHUP and dies without running its exit hook
- **THEN** the sandbox is still stopped after the idle period

#### Scenario: A newer session cancels the pending stop
- **WHEN** `idle_stop` is `5s`, a session exits, and a new session for the same sandbox starts 2 seconds later and is still running
- **THEN** no stop is issued at the first session's deadline, and the stop happens only after the new session exits and its own idle period passes

#### Scenario: A running Maki keeps the sandbox up
- **WHEN** the idle period passes but a `maki` process is running in the sandbox (for example, started from another host or through `openshell sandbox connect`)
- **THEN** the helper does not stop the sandbox

#### Scenario: Concurrent sessions stop only after the last one
- **WHEN** two sessions share the sandbox, the first exits, and the second is still running when the first session's idle period passes
- **THEN** the sandbox stays up until the second session exits and its idle period passes

#### Scenario: up alone does not arm the stop
- **WHEN** the user runs `maki-oss up` and starts no session
- **THEN** the helper never stops the sandbox automatically

### Requirement: Idle stop setting
The idle period SHALL come from `--idle-stop`, `MAKI_OSS_IDLE_STOP`, or the
config key `idle_stop`, using the standard configuration precedence. The
default is `1h`. The value SHALL be a non-negative integer of seconds,
optionally followed by `s`, `m`, or `h`. `0` SHALL disable the idle stop, so
the session starts no watcher. Any other value SHALL be a usage error before
any sandbox call.

#### Scenario: Default is one hour
- **WHEN** no flag, environment variable, or config key sets the idle period
- **THEN** the idle period is 3600 seconds

#### Scenario: Suffix forms resolve to seconds
- **WHEN** `idle_stop = "90m"` is set in the config file
- **THEN** the idle period is 5400 seconds

#### Scenario: Zero disables the idle stop
- **WHEN** the user runs `maki-oss maki --idle-stop 0` and the session exits
- **THEN** the helper never calls `openshell sandbox stop` for that session

#### Scenario: Invalid value is a usage error
- **WHEN** the user runs `maki-oss maki --idle-stop soon`
- **THEN** the helper exits with status 1 before any `openshell` sandbox call and the error names the `idle_stop` setting
