# Spec Delta

## MODIFIED Requirements

### Requirement: Generic credential sources
For credentials not present in a supported store, the helper SHALL accept a JSON file with a field path, a host environment variable name, a hidden interactive prompt, or standard input (`--stdin`), and SHALL use the resulting value only in the provider creation flow.

With `--stdin` the helper SHALL read the value from standard input up to end of file, remove one trailing newline, and use it without prompting. It SHALL refuse an empty value, a value that still contains a newline, and a value larger than 64 KiB, before any gateway mutation and without printing the value. `--stdin` SHALL require `--profile` and SHALL be refused together with `--from`, `--file`, or `--env`. With `--stdin` the run is non-interactive even when `<PREFIX>_INTERACTIVE` is set: every question SHALL be answered by a flag or by its non-interactive default, and a step that would need an answer it does not have SHALL fail before any gateway mutation.

#### Scenario: JSON file with field path
- **WHEN** the user selects a file source with a field path
- **THEN** the value at that path is used for provider creation

#### Scenario: Environment variable source
- **WHEN** the user selects an environment variable source and the variable is set on the host
- **THEN** the helper uses it without reading from stdin

#### Scenario: Hidden prompt source
- **WHEN** the user selects the hidden prompt source in an interactive session
- **THEN** the helper reads the value with terminal echo disabled and does not echo it

#### Scenario: Standard input source
- **WHEN** a script runs `printf 'sk-test\n' | maki-oss provider setup --stdin --profile maki-deepseek`
- **THEN** the provider is created with `--from-existing`, the credential reaches `openshell` only through the child environment, and no prompt is printed

#### Scenario: Empty or multi-line stdin is refused
- **WHEN** `--stdin` receives an empty value, or a value with two non-empty lines
- **THEN** the command exits as a usage error, no `openshell` mutation is recorded, and the error does not contain the value

#### Scenario: Stdin requires a profile
- **WHEN** the user runs `maki-oss provider setup --stdin` without `--profile`
- **THEN** the command exits as a usage error before reading stdin

### Requirement: Profile resolution and generation
Given a selected credential, the helper SHALL resolve a provider profile from: a curated profile file under `examples/providers/` matched through the catalog mapping, an explicit `--profile` file, an explicit `--profile` id, or a generated custom profile for an unknown provider. A `--profile` value that is not a path to an existing file SHALL be read as an id: it MUST be kebab-case, and it SHALL resolve to the front-end's curated profile with that id, or else to a generated profile with that id in the helper's profiles directory; an id that matches neither SHALL be a usage error before any gateway call. Custom profiles SHALL be generated only after validating the provider id (kebab-case), credential environment variable name, host, and API path, and SHALL be written under `${XDG_CONFIG_HOME:-$HOME/.config}/maki-oss/profiles/`. Profiles SHALL be linted before import, imported at global scope, and an existing generated profile SHALL NOT be overwritten without confirmation.

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

#### Scenario: Profile id resolves to a curated profile
- **WHEN** the user passes `--profile maki-deepseek` and no file of that name exists in the current directory
- **THEN** `examples/providers/maki-deepseek.yaml` is linted and imported

#### Scenario: Unknown or unsafe profile id is refused
- **WHEN** the user passes `--profile ../secrets` or `--profile no-such-profile`
- **THEN** the command exits as a usage error and no `openshell` command runs
