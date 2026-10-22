# Spec Delta

## MODIFIED Requirements

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
