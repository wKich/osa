# Proposal

## Why

M4 lets the dashboard set up a provider, so a new user never has to leave the browser to give a sandbox its model credential. Today `provider setup` can only take a secret from a credential store, a JSON file, a host environment variable, or a hidden terminal prompt. None of these fits a browser: the dashboard cannot type into a prompt, and writing the secret to a file or the dashboard's own environment would leave it behind. Setup also chooses profiles and asks follow-up questions interactively, and its text output is not meant for a program to read. The dashboard would have to copy profile resolution, provider create-or-update, and attach to work around that, which the roadmap rules out. This change gives the project layer a non-interactive setup that takes the secret on stdin and reports a JSON result. M4's dashboard wizard (`dashboard-provider-wizard`) is its first client.

## What Changes

- Add **`--stdin`** as a fourth credential source for `<front-end> provider setup`. The secret is read from stdin up to EOF, never prompted, echoed, or written anywhere. It needs `--profile`, which now also accepts a profile **id** (a curated profile or one the user generated earlier) besides a file.
- Add **`osa providers [--agent TAG] --json`**, a read-only command. For each agent it reports how setup works (`stdin` or `login`), the profiles setup can use (id, credential env var, curated or custom, the catalog note), the providers on the gateway, and the providers remembered in that agent's config.
- Add **`osa provider setup TAG --profile ID [--name NAME] [--attach SANDBOX] [--yes] --json`**. It validates the arguments and hands stdin, unread, to the front-end's internal `__provider-setup`. That runs the existing lint, import, create or update, remember, and attach steps with no prompts and prints one JSON object. Exit codes match `osa resolve`: 0 done, 1 usage, 2 refused before any change, 3 failed during setup.
  - An existing provider is refused unless `--yes` is given, which then updates its credential.
  - `--attach SANDBOX` must name a registered sandbox of the same agent and waits for the attach.
  - An agent whose setup is a browser login (Codex) is refused with the terminal command to run instead.
- Update the `osa entry point` requirement: `provider setup` becomes the second `osa` command that changes things, and the only one that may attach a provider to a sandbox.

Out of scope: generating a new custom profile without a terminal (it stays in the interactive wizard), choosing a default model, detaching or deleting providers, and Codex's login flow.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `helper-cli`: MODIFIED "Generic credential sources" (adds stdin). MODIFIED "Profile resolution and generation" (`--profile` accepts an id).
- `osa-project-layer`: MODIFIED "osa entry point" (adds `providers` and `provider setup`). ADDED "osa lists providers and setup profiles" and "osa sets up a provider from stdin".

## Impact

- `lib/oss-core.sh`: the stdin source and `--profile ID` resolution in `cmd_provider_setup`; `__providers-json` and `__provider-setup`; option parsing for `--stdin`.
- `bin/osa`: `providers` and `provider setup` parsing, registry checks for `--attach`, dispatch with stdin passed through; `usage()`.
- `bin/maki-oss`, `bin/opencode-oss`, `bin/claude-oss`, `bin/codex-oss`: route the internal commands; Codex reports setup kind `login`.
- `fish/completions/osa.fish`, `docs/helper.md`, `docs/providers.md`.
- Tests: `tests/run-tests.sh` with the `openshell` stub.
- Security: the secret travels only on a pipe into `osa`, then the front-end, then the `openshell` child's environment, as today's sources do. `osa` itself never reads it. No new network endpoint, bind mount, or `--env` path.
- Depends on nothing pending. It edits the same "osa entry point" block as `dashboard-health`; see design D6 for the order.
