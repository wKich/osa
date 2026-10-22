# Spec Delta

## ADDED Requirements

### Requirement: Project model from kiss's ModelProvider
For each sandbox round the worker SHALL derive the model and its credential
from the task's `modelProvider`: a custom OpenShell profile per provider
protocol and base URL with `protocol: rest`, enforced inference-only rules
(OpenAI: `POST <base>/chat/completions`, `GET <base>/models`; Anthropic:
`POST <base>/v1/messages`, `GET <base>/v1/models`) and `/usr/local/bin/maki`
as the only binary; a provider instance per project created or updated with
`--credential OSKHS_MODEL_API_KEY` so the key never appears in a command
line; that provider as the only one attached to `repo-<project>`; and a Maki
custom provider `kiss` with the same base URL, so Maki runs with `--model
kiss/<model id>`. A changed key, type, or base URL SHALL be re-synced before
the next round.

#### Scenario: Two projects, two models
- **WHEN** two marked projects whose providers differ in protocol, base URL, and model each get a question
- **THEN** each answers in its own sandbox through its own provider instance and model

#### Scenario: Only placeholders in the sandbox
- **WHEN** a round has run
- **THEN** the sandbox environment's credential variable holds the gateway's stand-in, not the key, and no other credential variable exists

#### Scenario: Non-inference path refused
- **WHEN** a request carrying the stand-in goes from the sandbox to a non-inference path of the provider API
- **THEN** OpenShell refuses it with a policy denial

#### Scenario: Key rotation
- **WHEN** the provider's key changes in kiss between two rounds
- **THEN** the next round updates the provider instance before Maki starts, and no command line carries the key

### Requirement: Internal models stay on internal gateways
A task whose model provider is internal (`isExternal: false`) SHALL run only
on a worker started with `--internal-models`; any other worker SHALL fail
the round before contacting the sandbox, with a message naming the model.

#### Scenario: Internal model on an external gateway
- **WHEN** a worker without `--internal-models` claims a task with an internal model
- **THEN** the task is closed with an error naming the model and the flag, and no provider or sandbox call is made
