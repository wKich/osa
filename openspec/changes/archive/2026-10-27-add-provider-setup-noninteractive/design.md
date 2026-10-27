# Design

## Context

`cmd_provider_setup` in `lib/oss-core.sh` already does everything the browser needs: it lints and imports a profile, creates or updates the provider with the credential only in the `openshell` child's environment (`run_credential_env`), remembers the provider, and offers an attach. Three things stop a program from using it:

1. The credential sources are a store, a file, an env var, or a hidden prompt.
2. The profile and the follow-up choices are interactive when no flag gives them, and `is_interactive` treats `<PREFIX>_INTERACTIVE=1` as a terminal.
3. Its output is prose.

Codex's `agent_provider_setup` is a browser login on the host (`codex login`) and has no single secret to pass.

The dashboard only spawns `osa`, through one argv gate (`isAllowedOsaArgv`). M2 set the pattern for writes: `osa` validates, the front-end's internal command does the work and prints JSON, and exit codes are 0/1/2/3.

## Goals / Non-Goals

**Goals:**

- A non-interactive setup whose secret arrives on stdin and never touches argv, files, logs, or output.
- One `osa` entry for listing what can be set up and for running setup, so the dashboard needs no new spawn target and no copy of profile logic.
- The terminal wizard keeps its behavior.

**Non-Goals:**

- Generating a custom profile without a terminal.
- Codex login without a terminal.
- Setting the default model.
- Provider removal or detach.
- A stdin source for the store-based flow (`--from`).

## Decisions

### D1: `--stdin` is a public credential source on the front-end

`provider setup --stdin --profile ID|FILE` joins `--from`, `--file`, and `--env`.

- It reads with `cred_value=$(head -c 65537)`. The substitution strips trailing newlines; any newline still in the value means more than one line, which is refused. A value longer than 65536 bytes is refused. No temp file is used, so the secret is never written to disk.
- The setup runs with a local `setup_noninteractive=1`, which `is_interactive` respects ahead of `<PREFIX>_INTERACTIVE`. Every `confirm` then takes its default:
  - provider exists: refused unless `--yes`;
  - attach: only with an explicit attach option;
  - default model: skipped.
- The custom-profile branch is unreachable, because `--stdin` requires `--profile`.

Making it public costs nothing, and it gives scripts a safe source: `pass show x | maki-oss provider setup --stdin --profile maki-x`.

Alternatives:
- A file descriptor option (`--secret-fd 3`): harder to use from Bun and from shells.
- Only an internal command: the helper would then lack the capability that the dashboard relies on.

### D2: `--profile` accepts an id, confined to two directories

If the value names an existing file, today's behavior is kept. Otherwise it must match `valid_kebab`, and it resolves to `$profiles_dir/ID.yaml` first and then `$helper_profiles_dir/ID.yaml`. The kebab check rules out `/`, `.`, and `..`, so an id cannot escape those directories. The result is `profile_file` and `profile_id`, exactly as the catalog path sets them today, so the rest of the flow is unchanged.

### D3: `osa providers` dispatches per agent to `__providers-json`

`osa` loops over the four tags, or only `--agent`, and runs `<front-end> __providers-json` for each. The front-end prints one object:

- **`setup`**: `stdin`, or `login` when `agent_provider_setup` is defined, with `command` set to `$PROGRAM provider setup`.
- **`profiles`**: every `*.yaml` under `$profiles_dir` except `template.yaml`, plus every `*.yaml` under `$helper_profiles_dir`.
  - Each profile carries its `id`, its env var (`profile_env_var`), its `source`, and its `note`.
  - The note comes from the catalog row whose profile-id column matches. The column layouts differ per agent, so the front-end supplies the column, defaulting to the Maki layout.
  - A profile whose env var cannot be read gets `note: "unreadable profile"` and `env: null`.
- **`gateway`**: from `os provider list --names`; on failure, `{error:{message}}`.
- **`remembered`**: from `split_csv "$config_providers"`.

`osa` joins the objects into an array. One spawn per agent mirrors how `osa status` already works and keeps catalog and profile parsing in the shell.

Alternatives: have the dashboard read profile directories and catalogs. Rejected, because it duplicates helper logic and its per-agent file layouts.

### D4: `osa provider setup` validates, then execs with stdin inherited

`bin/osa` parses `provider setup TAG --profile ID [--name NAME] [--attach SANDBOX] [--yes] [--json]`.

- **Checks before any work:**
  - the tag is known;
  - the id and the name are kebab-case;
  - `--attach` names a registry file whose `agent` is `TAG`.
- **Login agents:** `osa` first runs `<front-end> __provider-setup --probe`, which reads no stdin and exits 2 with the terminal command when the front-end defines `agent_provider_setup`. The knowledge stays in the front-end, and nothing is consumed from stdin before a refusal. A static `cx` entry in `osa` was rejected because it duplicates that knowledge.
- **The exec:** `exec "$front" --name "$SANDBOX" __provider-setup --profile ID [--name-provider NAME] [--attach] [--yes] --json`. With no attach, `--name` is omitted and `__provider-setup` never calls `resolved_name`. `osa` uses `exec`, so stdin passes through untouched and `osa` holds no copy.
- **Provider name:** passed as an internal `--provider-name`, because `--name` already means the sandbox name in the front-ends.

### D5: `__provider-setup` reports outcome as JSON with step tracking

It sets `opt_stdin=1`, runs the same function body as `provider setup`, and records which steps finished in `ps_steps`: `linted`, `imported`, `created` or `updated`, `remembered`, `attached`.

- **Failures:** `die_*` exits are wrapped through a trap on EXIT, mirroring how `__resolve` reports. A failure before the first mutation exits 2 with outcome `refused`; a failure after it exits 3 with outcome `failed` and `steps`.
- **Output:** all prose goes to stderr, so stdout holds only the JSON. The message names what happened in plain words, for example `"created maki-deepseek and remembered it; attach to mk-demo-1a2b failed: <gateway text>"`.
- **Gateway text:** it is included as-is. `openshell` never echoes the credential, because the credential is only in its environment, and a test asserts that.
- **Clearing the secret:** `cred_value` is unset before the JSON is printed.

### D6: Spec ordering with other `osa entry point` edits

`dashboard-health` (pending) and `dashboard-image-build` (pending) also MODIFY "osa entry point". This delta assumes `dashboard-health` is archived first, so its text includes `health`. `dashboard-image-build` assumes this change is archived before it. Archive order: `dashboard-health`, then this change, then `dashboard-image-build`. If the order changes, the later delta must be rebased so that no command list drops an entry.

## Risks / Trade-offs

- **[A secret in a shell variable]** `cred_value` lives in the front-end's memory for the duration of the run, just as today's sources do. Mitigation: unset it after use; never `export` it outside `run_credential_env`'s subshell.
- **[`openshell` might echo env values in an error]** Mitigation: a test runs the stub in a failure mode that prints its environment names (not values), and every output is scanned for the fixture secret. The dashboard change adds a second redaction layer.
- **[Probe and exec are two spawns]** They are cheap and avoid consuming stdin before a refusal. The probe reads no stdin.
- **[Catalog layouts differ per agent]** Mitigation: the front-end declares its note column; a missing note is `null`, not an error.

## Migration Plan

Additive. No state or config format changes. Existing `provider setup` invocations behave the same.

## Open Questions

None.
