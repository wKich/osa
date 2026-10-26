# maki-oss

**Your AI coding agent, locked in a sandbox.**

Run [Maki](https://maki.sh) coding agents inside NVIDIA OpenShell sandboxes —
fully isolated from your machine. The agent gets a real shell, your project
files, and nothing else: filesystem access is confined with Landlock, egress is
deny-by-default, and your model credentials never enter the sandbox. The agent
sees opaque placeholders that OpenShell's proxy resolves only at approved
endpoints.

## Install

Prerequisites: OpenShell CLI with a running gateway (`openshell status`),
Docker Engine 28+ (or Podman), and optionally `jq` and `fish`.

```sh
git clone https://github.com/wKich/maki-oss.git
cd maki-oss
./bin/maki-oss doctor       # verify prerequisites
./bin/maki-oss image build  # build the sandbox image
export PATH="$PWD/bin:$PATH"
```

`image build` builds the generic base: the agent runtime and safety baseline,
with no MCP servers and no personal UI preferences. Maki starts every session
in YOLO mode because the sandbox is the permission boundary; the baked deny
rules still apply. To add MCP servers or a runtime they need, compose an
environment image on top of it — see
[`docs/ai/environment-playbook.md`](docs/ai/environment-playbook.md) and the
[reference store](examples/environments/reference/README.md).

Fish users can install the plugin with [fisher](https://github.com/jorgebucaran/fisher)
instead — it bundles the function and completions.

## Quick start

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
sandboxes by hand is a chore. maki-oss gives you:

- 🔒 **Real isolation** — Landlock-confined filesystem, non-root sandbox user,
  deny-by-default egress. Break-ins stay inside the box.
- 🔑 **Zero credential exposure** — keys live in OpenShell provider profiles
  on the host; the sandbox only ever sees placeholders.
- 🧩 **Any provider** — a `provider setup` wizard plus a curated profile
  catalog, with a migration guide for keys currently stored in Maki or
  OpenCode.
- 🔄 **Safe file sync** — refresh a disposable workspace from the host when it
  moved, then collect a patch on exit and apply it only when the baseline still
  matches. Your project directory stays the source of truth; conflicts keep a
  patch for review, and uncollected sandbox output parks the workspace instead
  of being overwritten.
- 🐟 **Fish-native** — a fisher-compatible plugin with completions, plus a
  plain POSIX `sh` helper for everyone else.
- 📊 **Dashboard** — a minimal [Bun](https://bun.sh) web UI
  ([`dashboard/`](dashboard/)) to monitor and manage your OpenShell sandboxes.

## Guides

- [`docs/ai/host-playbook.md`](docs/ai/host-playbook.md) — provision a bare
  macOS or Linux host (engine, OpenShell, Maki, shell) before running Maki.
- [`docs/ai/environment-playbook.md`](docs/ai/environment-playbook.md) — compose
  a personal environment (MCP servers, runtimes, preferences) on the base image.
- [`docs/setup-guide.md`](docs/setup-guide.md) — clean machine to a running
  sandboxed Maki, step by step.
- [`docs/providers.md`](docs/providers.md) — any-provider catalog, the
  `provider setup` wizard, and custom profiles.
- [`docs/migrating-providers.md`](docs/migrating-providers.md) — move keys out
  of Maki and OpenCode stores, and the OAuth limitation.
- [`docs/verification.md`](docs/verification.md) — isolation checklist with
  exact commands and expected output.
- [`docs/glossary.md`](docs/glossary.md) — shared vocabulary for these docs.
- [`opencode-oss/README.md`](opencode-oss/README.md) — run OpenCode itself
  natively in a sandbox (image, profiles, policy, verification record).

## Security invariants

The OpenShell sandbox is the security boundary:

- no host bind mounts — project files move in and out through upload/download;
- no secrets through `--env` — model credentials go through OpenShell provider
  profiles (placeholder + proxy substitution);
- egress stays deny-by-default — every endpoint is an explicit policy or
  provider-profile decision;
- sandbox processes run as a non-root user with a minimal filesystem policy.
