# Spec Delta

## MODIFIED Requirements

### Requirement: Shared state root

Every agent front-end (`maki-oss`, `opencode-oss`, `claude-oss`, `codex-oss`) SHALL keep its sync state and its project registry entries under one state root, `${XDG_STATE_HOME:-$HOME/.local/state}/osa/`. Session state SHALL live in `sessions/<sandbox-name>/` and registry entries in `projects/`. The front-ends MUST NOT read or write the former per-tool roots `${XDG_STATE_HOME:-$HOME/.local/state}/maki-oss/` and `…/opencode-oss/`, and `claude-oss` and `codex-oss` MUST NOT create a per-tool root `…/claude-oss/` or `…/codex-oss/`. Configuration files stay per front-end and do not move.

#### Scenario: Both front-ends write to one root
- **WHEN** `maki-oss up` and `opencode-oss up` run in the same project folder
- **THEN** both register under `osa/projects/`, each sandbox keeps its own `osa/sessions/<sandbox-name>/` directory, and nothing is written under `maki-oss/` or `opencode-oss/` in the state home

#### Scenario: Claude front-end writes to the same root
- **WHEN** `claude-oss up` runs in a project folder already registered for `mk`
- **THEN** a second entry with agent `cc` is written under `osa/projects/`, its session state lives in `osa/sessions/<cc-sandbox-name>/`, and nothing is written under `claude-oss/` in the state home

#### Scenario: Codex front-end writes to the same root
- **WHEN** `codex-oss up` runs in a project folder already registered for `cc`
- **THEN** a second entry with agent `cx` is written under `osa/projects/`, its session state lives in `osa/sessions/<cx-sandbox-name>/`, and nothing is written under `codex-oss/` in the state home

#### Scenario: A former per-tool root is ignored
- **WHEN** `${XDG_STATE_HOME}/maki-oss/sessions/<name>/pending` exists from an older helper and the user starts a session for that sandbox
- **THEN** the helper neither reads that marker nor modifies it
