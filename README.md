# osa

**Your AI coding agent, locked in a sandbox.**

`osa` is the project and repository. Its four agent front-ends keep their
command names: `maki-oss` runs Maki, `opencode-oss` runs OpenCode,
`claude-oss` runs Claude Code, and `codex-oss` runs Codex; the read-only `osa`
command reports on the projects they register. Earlier
releases used the names `maki-openshell` and `maki-oss`, and historical
records keep them.

Run [Maki](https://maki.sh), [OpenCode](https://opencode.ai),
[Claude Code](https://code.claude.com), or
[Codex](https://github.com/openai/codex) inside NVIDIA OpenShell sandboxes —
fully isolated from your machine. The agent gets a real shell, your project
files, and nothing else: filesystem access is confined with Landlock, egress is
deny-by-default, and your model credentials never enter the sandbox. The agent
sees opaque placeholders that OpenShell's proxy resolves only at approved
endpoints.

The commands below show the Maki path. `opencode-oss`, `claude-oss`, and
`codex-oss` follow the same helper pattern; the one-page
[quickstart](docs/ai/quickstart.md) has a row per agent, and the
[onboarding guide](docs/ai/onboarding.md) routes the full setup.

## Choose your agent

| You run | Helper | Build | Provider setup | Host CLI |
|---|---|---|---|---|
| Maki | `maki-oss` | `maki-oss image build` | `maki-oss provider setup` | optional |
| OpenCode | `opencode-oss` | `opencode-oss image build` | `opencode-oss provider setup` | none |
| Claude Code | `claude-oss` | `claude-oss image build` | `claude-oss provider setup` | `claude` for a subscription token |
| Codex | `codex-oss` | `codex-oss image build` | `codex-oss provider setup` | `codex` for the ChatGPT login |

New here? Start with the [quickstart](docs/ai/quickstart.md). It covers the
host prerequisites, the first run, and the verification page.

## Let your agent set it up

Send this to the coding agent you already run:

```text
Set up osa for the coding agent I already run. Do not switch to a different
agent.

If this host already has an osa clone, ask me for its path. Otherwise clone
https://github.com/wKich/osa.git into a directory I choose (ask me before
writing), then work from that repository root. Read AGENTS.md and
docs/ai/onboarding.md there, audit my host and configuration first, show me the
plan, and ask before changing anything. Complete the setup through the
verification page and finish with the report. Never ask me to paste a secret.
```

The full prompt, with the phase map, migration matrix, and report format, is in
[`docs/ai/onboarding.md`](docs/ai/onboarding.md).

## Install (Maki path)

If you prefer to do it yourself, the commands below build the Maki base. Use
the [quickstart](docs/ai/quickstart.md) for OpenCode, Claude Code, or Codex.

Prerequisites: OpenShell CLI v0.1.5 with a running gateway (`openshell status`),
Docker Engine 28+, `git`, `curl`, and optionally `jq` and `fish`. On a bare
host, start with the [host playbook](docs/ai/host-playbook.md).

```sh
git clone https://github.com/wKich/osa.git
cd osa
./bin/maki-oss image build  # build the sandbox image
./bin/maki-oss doctor       # verify the built image and host
export PATH="$PWD/bin:$PATH"  # add to ~/.zshrc or config.fish
```

`image build` builds the generic base: the agent runtime and safety baseline,
with no MCP servers and no personal UI preferences. Maki starts every session
in YOLO mode because the sandbox is the permission boundary; the baked deny
rules still apply. To add MCP servers or a runtime they need, compose an
environment image on top of it — see
[`docs/ai/environment-playbook.md`](docs/ai/environment-playbook.md) and the
[reference store](examples/environments/reference/README.md).

Maki and OpenCode users can install the fish plugin with
[fisher](https://github.com/jorgebucaran/fisher) instead — it bundles the
function and completions. Claude Code and Codex have no fish plugin.

## Quick start (Maki)

```sh
maki-oss provider setup     # once per machine: wizard for any provider
cd ~/code/myproject
maki-oss                    # ensure the sandbox, run Maki, sync safely
```

That's it. Bare `maki-oss` creates or reuses the project's sandbox, refreshes
its disposable workspace when the host tree moved, attaches remembered
providers, launches Maki, and on exit collects the sandbox changes as a patch.
The patch is applied only when the project's safety check passes — a host edit
is never overwritten by a whole-workdir overlay, and conflicts leave your files
untouched with the patch kept for review. A retained patch never blocks the
next session; a parked workspace (collection failed or `--no-sync`) refuses it
until you download or discard the changes. After the one-time `provider
setup`, a project needs no further setup.

Each project folder gets its own sandbox: `mk-<project>-<hash>` for Maki, and
`oc-`, `cc-`, or `cx-` in place of `mk-` for OpenCode, Claude Code, and Codex
(the `origin` repository name, or the folder name, plus a short hash of the
folder's path), so git worktrees never share one. Host state for every
project lives in `~/.local/state/osa/`; `osa projects` lists them all, and
`osa status --json` reports one project for scripts and the dashboard. See
[Shared state and the project registry](docs/helper.md#shared-state-and-the-project-registry).

## What do I send the agent?

Anything you'd ask a coding agent — `maki-oss` just makes sure it runs inside
the sandbox. Interactively, type your request at Maki's prompt as usual.
Headless, pass it as an argument:

```sh
maki-oss run "explain this project and fix the failing tests"
maki-oss run "review the last commit for bugs"
maki-oss run --model deepseek/deepseek-chat "check the changelog"
```

Pick up where you left off:

```sh
maki-oss --continue              # resume the most recent session
maki-oss --resume <ID>           # resume a specific session
maki-oss run --resume <ID> "continue where the previous run stopped"
```

When the session ends, the sandbox's changes are collected as a patch and
applied to the project only when it is safe: a clean repository is
fast-forwarded, a dirty or moved host keeps a review branch, and a plain
directory uses `git apply --check`. Conflicts keep the patch and leave the host
unchanged. Your local files stay the source of truth. An hour after the last
session closes, the sandbox is stopped; the next session starts it again with
your work intact (`idle_stop = "0"` turns this off). Full command reference:
[`docs/helper.md`](docs/helper.md).

## Why?

Because giving an AI agent full run of your laptop is a bad idea, and running
sandboxes by hand is a chore. osa gives you:

- 🔒 **Real isolation** — Landlock-confined filesystem, non-root sandbox user,
  deny-by-default egress. Break-ins stay inside the box.
- 🔑 **Zero credential exposure** — keys live in OpenShell provider profiles
  on the host; the sandbox only ever sees placeholders.
- 🧩 **Any provider for Maki and OpenCode** — a `provider setup` wizard plus a
  curated profile catalog, with a migration guide for keys currently stored in
  Maki or OpenCode. Claude Code uses an Anthropic API key or a subscription
  token; Codex uses a ChatGPT plan login.
- 🔄 **Safe file sync** — refresh a disposable workspace from the host when it
  moved, then collect a patch on exit and apply it only when the baseline still
  matches. Your project directory stays the source of truth; conflicts keep a
  patch for review, and uncollected sandbox output parks the workspace instead
  of being overwritten.
- 🐟 **Fish-native for Maki and OpenCode** — a fisher-compatible plugin with
  completions, plus a plain POSIX `sh` helper for everyone else. Claude Code
  and Codex have no fish plugin.
- 📊 **Dashboard** — a minimal [Bun](https://bun.sh) web UI
  ([`dashboard/`](dashboard/)) to monitor and manage your OpenShell sandboxes.

## Guides

- [`docs/ai/quickstart.md`](docs/ai/quickstart.md) — the one-page setup path:
  choose your agent, prepare the host, build, run, and verify.
- [`docs/ai/onboarding.md`](docs/ai/onboarding.md) — keep your coding agent
  (Maki, OpenCode, Claude Code, or Codex) and move it into an OpenShell
  sandbox.
- [`docs/ai/host-playbook.md`](docs/ai/host-playbook.md) — provision the shared
  host tooling (engine, OpenShell, repository, shell) for any agent, then
  follow the agent playbook.
- [`docs/ai/environment-playbook.md`](docs/ai/environment-playbook.md) — compose
  a personal environment (MCP servers, runtimes, preferences) on the base image.
- [`docs/setup-guide.md`](docs/setup-guide.md) — clean machine to a running
  sandboxed Maki, step by step.
- [`docs/providers.md`](docs/providers.md) — the Maki provider catalog, the
  `provider setup` wizard, and custom profiles; provider setup for the other
  agents is in the [OpenCode](docs/ai/playbooks/opencode.md),
  [Claude Code](docs/ai/playbooks/claude.md), and
  [Codex](docs/ai/playbooks/codex.md) playbooks.
- [`docs/migrating-providers.md`](docs/migrating-providers.md) — move keys out
  of Maki and OpenCode stores, and the OAuth limitation.
- [`docs/ai/verification/maki.md`](docs/ai/verification/maki.md) — the Maki
  isolation checklist with exact commands and expected output; the OpenCode,
  Claude, and Codex records sit beside it.
- [`docs/glossary.md`](docs/glossary.md) — shared vocabulary for these docs.
- [`docs/helper.md`](docs/helper.md) — `maki-oss`, `opencode-oss`,
  `claude-oss`, and `codex-oss` commands, sync states, and the project
  registry.
- [`opencode-oss/README.md`](opencode-oss/README.md) — run OpenCode itself
  natively in a sandbox (image, profiles, policy, verification summary).
- [`claude-oss/README.md`](claude-oss/README.md) — run Claude Code natively in
  a sandbox with an API key or a Claude subscription token (image, managed
  settings, profiles, verification summary).
- [`codex-oss/README.md`](codex-oss/README.md) — run OpenAI's Codex CLI
  natively in a sandbox with a ChatGPT plan login refreshed by the gateway
  (image, managed config, profile, verification record).

## Security invariants

The OpenShell sandbox is the security boundary:

- no host bind mounts — project files move in and out through upload/download;
- no secrets through `--env` — model credentials go through OpenShell provider
  profiles (placeholder + proxy substitution);
- egress stays deny-by-default — every endpoint is an explicit policy or
  provider-profile decision;
- sandbox processes run as a non-root user with a minimal filesystem policy.
