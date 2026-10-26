# Spec Delta

## MODIFIED Requirements

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
| default sandbox name `mk-{project}-{hash}` | `oc-{project}-{hash}` |
| registry agent tag `mk` | `oc` |
| curated profiles `examples/providers/` and its catalog | `opencode-oss/providers/` and `stores.tsv` |
| `maki-oss maki` and bare `maki-oss` | `opencode-oss opencode` and bare `opencode-oss` |
| "Maki" as the launched agent | OpenCode |

The state root `${XDG_STATE_HOME:-$HOME/.local/state}/osa/` is shared and is
not substituted. The Maki-only requirement is the `tui = "opencode"` bridge
mode. The parity covers:

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
- **THEN** they use different sandboxes (`mk-<project>-<hash>` and `oc-<project>-<hash>` with the same hash), different config files, and different session directories, and both register under the one `osa` state root
