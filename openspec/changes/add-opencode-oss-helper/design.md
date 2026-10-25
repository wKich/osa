# Design: add-opencode-oss-helper

## Context

See proposal.md for the motivation and specs/ for the requirements. This
change builds on `extract-oss-core`: `lib/oss-core.sh` holds the
agent-neutral helper, and a front-end supplies identity variables (D2 of
that design) and agent hooks (D3). `bin/maki-oss` is the reference
front-end.

Facts from the `add-opencode-oss` live verification (OpenCode 2.1.4,
OpenShell 0.1.5) that shape the hooks:

- `opencode run` reads stdin when it is not a TTY, and
  `openshell sandbox exec` leaves stdin open. Without `</dev/null` a run
  waits forever.
- Without `--standalone`, OpenCode starts a background service in the
  sandbox and writes its password to `service.json`.
- The TUI has no `--model` flag. It defaults to OpenCode's free tier, which
  the sandbox denies.
- Each run tries `models.opencode.ai`. The binary honors
  `OPENCODE_DISABLE_MODELS_FETCH`, but `sandbox exec` does not pass image
  `ENV` through. It does accept per-exec non-secret `--env KEY=VALUE`.
- The binary reads `OPENCODE_CONFIG_CONTENT` (an inline config overlay).
  It has not yet been verified that the overlay merges with the global
  config rather than replacing it (see Risks).
- `opencode run` accepts `--continue` and `--session ID`. `--session`
  resumes an existing session or creates one with that ID.

## Goals / Non-Goals

**Goals:**

- `bin/opencode-oss` is a front-end of a few hundred lines. Any
  duplication of core logic is a missed extraction and gets fixed in the
  core.
- OpenCode's quirks are handled inside the helper, so users never type
  `--standalone` or `</dev/null`.

**Non-Goals:**

- Bridge mode, fish plugin and completions, dashboard, oskhs, playbooks,
  and an OpenCode environment-store reference.
- Changing `maki-oss` behavior. If a core hook gap appears, it is closed
  with no visible change to `maki-oss`.

## Decisions

### D1. Front-end shape

`bin/opencode-oss` mirrors `bin/maki-oss` after the extraction:

1. Shebang, `set -eu`, and repo-root resolution.
2. Identity variables:
   - `PROGRAM=opencode-oss`
   - `OSS_ENV_PREFIX=OPENCODE_OSS`
   - `OSS_CONFIG_NAME=opencode-oss`
   - `OSS_STATE_NAME=.opencode-oss`
   - `OSS_TMP_PREFIX=opencode-oss`
   - `DEFAULT_IMAGE=opencode-agent:local`
   - `DEFAULT_POLICY=$repo_root/opencode-oss/policies/minimal.yaml`
   - `DEFAULT_NAME='opencode-{project}'`
   - `OSS_PROFILES_DIR=$repo_root/opencode-oss/providers`
   - `OSS_CATALOG_FILE=$OSS_PROFILES_DIR/stores.tsv`
   - `OSS_CUSTOM_PROFILE_PREFIX=opencode-`
3. Hooks.
4. Source the core.
5. `oss_main`.

### D2. Launch hooks

The headless argv (`agent_headless_argv`) is:

```text
opencode run --standalone --auto --format json [--model M] [session flags] PROMPT
```

`agent_exec_stdin` returns `null`. The core then runs the headless exec with
`</dev/null`. Maki returns `tty`, so its behavior is unchanged.

The interactive argv (`agent_interactive_argv`) is:

```text
opencode --standalone [session flags]
```

It never adds `--auto` (see spec). Both hooks also return the per-exec
non-secret env through a new optional hook, `agent_exec_env`. The core
appends its output as `--env KEY=VALUE` to `sandbox exec`.

`agent_exec_env` emits these values:

- `OPENCODE_DISABLE_MODELS_FETCH=1`, always.
- `OPENCODE_CONFIG_CONTENT={"model":"<resolved>"}`, only for interactive
  sessions with a resolved model. Headless runs use `--model`, which is
  narrower.

These names pass the core's credential-name guard as they are, since they
contain no `TOKEN`/`SECRET`/`KEY`-style segment. The hook still goes
through the same guard, so a later edit cannot slip a credential through.

- *Alternative for the TUI model:* write `/sandbox/project/opencode.json`.
  This was rejected because patch sync would carry it back into the user's
  project.
- *Alternative:* write the global sandbox config. This was rejected
  because it mutates the baked, deny-protected file, which the agent's own
  `edit` deny would then have to tolerate.

`maki-oss` gets an empty `agent_exec_env` and no `--env` change.

### D3. Session flag mapping

`agent_check_session_flags` rejects these combinations before any sandbox
work:

- `--continue` with `--resume`
- `--continue` with `--session-id`
- `--resume` with `--session-id`

Maki accepts some of these today. Its hook stays as it is, so this is
OpenCode-only. The argv hooks then map:

- `--continue` to `--continue`
- `--resume ID` and `--session-id ID` to `--session ID`

### D4. Provider setup wiring

`opencode-oss/providers/stores.tsv` uses the wizard's existing four-column
format (`store`, `slug`, `profile-id`, `note`), with the same Maki and
OpenCode store slugs as `examples/providers/catalog.tsv`. Each slug maps to
the `opencode-*` profile. Slugs with no OpenCode profile (google, mistral,
xai, zai) are left out, so they fall through to custom-profile generation
with the `opencode-` prefix.

`catalog.tsv` keeps its current columns as the profile-to-model map.
`agent_setup_hint` reads `example-model` from it and prints:

```text
example model: synthetic/hf:zai-org/GLM-5.3
set it as the default: model = "…" in ~/.config/opencode-oss/config.toml
```

- *Alternative:* merge both maps into one file. This was rejected because
  the core reads `store/slug/profile-id` from fixed column positions, and
  the model map is per profile, not per store slug.

### D5. MCP status from JSON

`agent_mcp_servers FILE` prints `name<TAB>enabled<TAB>command0` for each
entry under `.mcp`, using `jq`. The core's existing gate table consumes
that format. The Maki hook keeps its TOML parsing, refactored behind the
same hook only if the extraction did not already split it.

The sandbox file is read with `sandbox exec cat` and parsed on the host.
Without `jq`, `mcp status` exits with the dependency code, and `doctor`
prints "skipped: jq not found" for the MCP section. If a file uses JSONC
comments, `jq` fails on it, and the helper reports it as unreadable.

### D6. Image build

`agent_dispatch image build` builds `$repo_root/opencode-oss/image` with
`--opencode-version` mapped to `--build-arg OPENCODE_VERSION=…`. Changing
the version without matching `OPENCODE_SHA512_*` makes the Dockerfile's
checksum step fail. The helper surfaces that failure and adds a hint
pointing to the README's digest recipe.

### D7. Tests

Extend `tests/run-tests.sh` with an `opencode-oss` group that reuses the
openshell/docker stubs. `tests/stub/opencode` is already present for the
bridge and is extended only if needed. One case per spec scenario that can
run offline:

- argv shape for run and TUI, with `</dev/null` asserted through the stub's
  stdin recording
- the session mapping and the conflicting-flag usage error
- the `--env` values sent for the fetch switch and the model overlay
- prefix and config isolation from `maki-oss`
- stores.tsv/profile resolution and the setup hint
- `mcp status` from JSON fixtures
- `image build` argv
- one sync scenario per path, reusing the Maki fixtures under the
  `.opencode-oss` state name

The Maki tests are not edited.

## Risks / Trade-offs

- [`OPENCODE_CONFIG_CONTENT` replaces the global config instead of merging,
  which would drop the baked deny rules] → The first implementation task is
  a live check: run the TUI and `run` with the overlay and confirm the
  `shell sudo` and `.config` edit denies still fire. If the overlay
  replaces the config, the helper builds the overlay as the baked config
  plus `model` (read from the image at
  `/sandbox/.config/opencode/opencode.json`). The spec's "Overlay keeps the
  baked deny rules" scenario fixes this outcome either way.
- [The `sandbox exec --env` values are visible in `ps` inside the sandbox]
  → They are non-secret by construction (a model ID and a boolean), and the
  credential guard enforces that.
- [Core hook gaps found late (for example, `agent_exec_env` and
  `agent_exec_stdin` are new)] → Add them in `lib/oss-core.sh`, with empty
  or `tty` defaults for Maki. The unchanged Maki suite proves there is no
  regression.
- [Two helpers drift in docs] → `docs/opencode-oss.md` documents only the
  differences and links `docs/helper.md` for the shared behavior.

## Migration Plan

This change is additive and comes after `extract-oss-core` is merged.
Users switch from raw commands by running `opencode-oss provider setup`
once. An already-imported `opencode-*` profile and provider are reused,
because the wizard offers to update existing ones. Rollback is deleting
`bin/opencode-oss` and the docs. The core stays because `maki-oss` uses
it.
