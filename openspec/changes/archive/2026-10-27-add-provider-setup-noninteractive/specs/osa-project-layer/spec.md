# Spec Delta

## MODIFIED Requirements

### Requirement: osa entry point

The repository SHALL provide an `osa` command that works across every agent front-end. `osa` SHALL offer `projects`, `status`, `health`, `providers`, `resolve`, `provider setup`, and `help`, and every other command SHALL be a usage error. `resolve` and `provider setup` are the only `osa` commands that change anything; they are defined by the requirements "osa resolves retained patches", "osa resolves parked workspaces", and "osa sets up a provider from stdin". `projects`, `status`, `health`, `providers`, and `help` MUST NOT create, start, stop, delete, upload to, or download from a sandbox, MUST NOT launch an agent, MUST NOT create, update, or attach a provider, and MUST NOT write any file under the state root. No `osa` command MUST create, stop, or delete a sandbox or launch an agent, only `osa resolve <sandbox> rescue` MAY start a stopped one, and only `osa provider setup` MAY attach a provider to one. The full `osa status`, `osa health`, and `osa providers` MAY query the gateway read-only and MAY run the same read-only probes that the front-end's `status`, `mcp status`, and `doctor` run; they MUST NOT run anything else in a sandbox. `osa projects` and `osa status --quick` MUST NOT contact the gateway.

#### Scenario: osa never changes a sandbox
- **WHEN** the user runs `osa projects`, `osa status`, `osa status --quick`, `osa health <sandbox>`, and `osa providers --json` while a registered sandbox is `Ready`
- **THEN** the gateway receives no create, start, stop, delete, upload, download, provider create, provider update, or attach call and no agent launch, and no file under the state root changes

#### Scenario: Projects and quick status stay off the gateway
- **WHEN** the user runs `osa projects` and `osa status --quick`
- **THEN** the gateway receives no call at all

#### Scenario: Unknown command is a usage error
- **WHEN** the user runs `osa up`
- **THEN** the command exits as a usage error that lists `projects`, `status`, `health`, `providers`, `resolve`, `provider setup`, and `help`

## ADDED Requirements

### Requirement: osa lists providers and setup profiles

`osa providers [--agent TAG] --json` SHALL print one JSON array with one object per known agent tag (or only `TAG`), each carrying: `agent`; `setup`, either `stdin` when `osa provider setup` can configure that agent or `login` when its setup needs a terminal login, with the terminal command to run; `profiles`, each with `id`, the credential environment variable name, `source` (`curated` or `custom`), and the catalog note when there is one; `gateway`, the provider names the gateway lists, or an `error` object when the gateway cannot be reached; and `remembered`, the providers in that agent's config. Profiles SHALL come from the front-end's curated profile directory and the helper's generated profiles directory; a profile file that cannot be read SHALL be listed by id with a note instead of failing the list. The output MUST NOT contain a credential value. An unknown `TAG` SHALL be a usage error.

#### Scenario: Profiles for a stdin agent
- **WHEN** the user runs `osa providers --agent mk --json`
- **THEN** the single object has `setup` `stdin` and lists `maki-deepseek` as a `curated` profile with env var `DEEPSEEK_API_KEY`

#### Scenario: Login agent is marked
- **WHEN** the user runs `osa providers --agent cx --json`
- **THEN** the object has `setup` `login` and names `codex-oss provider setup` as the command to run

#### Scenario: Gateway down
- **WHEN** the gateway is unreachable and the user runs `osa providers --json`
- **THEN** the command exits 0, every object has its profiles and remembered providers, and `gateway` is an error object

### Requirement: osa sets up a provider from stdin

`osa provider setup TAG --profile ID [--name NAME] [--attach SANDBOX] [--yes] [--json]` SHALL configure a provider for agent `TAG` from a credential read on standard input, without any prompt. `osa` SHALL validate the tag, the profile id (kebab-case), the name, and the sandbox before it starts the front-end, and SHALL pass standard input to the front-end without reading or buffering it. The front-end SHALL resolve the profile id, read the credential as `--stdin` does, lint the profile and import it at global scope when the gateway lacks it, create the provider (`NAME`, default the profile id) or, with `--yes`, update an existing one, remember the provider in that agent's config, and with `--attach` attach it to `SANDBOX` and wait. Without `--attach` it SHALL NOT attach anything.

- An existing provider without `--yes` SHALL be refused before any mutation.
- `--attach SANDBOX` MUST name a registry entry whose agent is `TAG`; the sandbox must exist on the gateway, and an attach to a missing sandbox SHALL be refused before any mutation.
- For an agent whose setup is `login`, the command SHALL be refused and SHALL name the terminal command.
- Exit codes SHALL be 0 done, 1 usage error, 2 refused before any change, and 3 failed after a change started. With `--json` stdout SHALL hold exactly one JSON object with `ok`, `agent`, `provider`, `profile`, `outcome` (`created`, `updated`, `refused`, or `failed`), `attached` (the sandbox name or `null`), `remembered`, and a `message`; on exit 3 it SHALL name the steps that completed.
- The credential MUST NOT appear in any argument, file, stdout, stderr, or the JSON result, on success or failure, and MUST reach `openshell` only through the environment of the `provider create` or `provider update` child.

#### Scenario: Create and attach from stdin
- **WHEN** `printf 'sk-test' | osa provider setup mk --profile maki-deepseek --attach mk-demo-1a2b --json` runs with `mk-demo-1a2b` registered for `mk` and `Ready`
- **THEN** it exits 0, the stub records `profile lint`, `provider create --name maki-deepseek --type maki-deepseek --from-existing --global-profile`, and `sandbox provider attach mk-demo-1a2b maki-deepseek --wait`, the result has outcome `created` and attached `mk-demo-1a2b`, and `sk-test` appears in no recorded argv and no output

#### Scenario: Existing provider needs --yes
- **WHEN** `maki-deepseek` already exists and the command runs without `--yes`
- **THEN** it exits 2 with outcome `refused`, and no `provider update` or attach is recorded

#### Scenario: Attach to another agent's sandbox is refused
- **WHEN** `--attach` names a sandbox registered for `oc` while `TAG` is `mk`
- **THEN** it exits 1 before starting the front-end, and nothing is recorded

#### Scenario: Login agent is refused
- **WHEN** the user runs `osa provider setup cx --profile codex-chatgpt`
- **THEN** it exits 2, names `codex-oss provider setup`, and records no `openshell` mutation

#### Scenario: Failure after create keeps the secret out
- **WHEN** the provider is created but the attach fails
- **THEN** it exits 3 with outcome `failed`, the message says the provider was created and remembered but not attached, and the credential appears in no output
