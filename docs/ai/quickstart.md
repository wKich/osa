# Quickstart: choose your agent, then set up osa

The one-page setup path. The router, host playbook, agent playbooks, and
verification pages remain authoritative; this page gives the shortest working
sequence and links to them for detail.

## Choose the agent you already run

Keep the agent you already use. osa moves that agent into its own sandbox; it
does not ask you to switch.

| You run | Helper | Base image | Provider setup | Host CLI |
|---|---|---|---|---|
| Maki | `maki-oss` | `maki-oss image build` → `maki-agent:local` | `maki-oss provider setup` | optional |
| OpenCode | `opencode-oss` | `opencode-oss image build` → `opencode-agent:local` | `opencode-oss provider setup` | none |
| Claude Code | `claude-oss` | `claude-oss image build` → `claude-agent:local` | `claude-oss provider setup` | `claude` only to create a subscription token |
| Codex | `codex-oss` | `codex-oss image build` → `codex-agent:local` | `codex-oss provider setup` (host-only ChatGPT login) | `codex` once for the login |

The agent runs inside the image. Only the host-only login or token step uses a
host CLI.

## Fast path: let your agent do it

Send this to the coding agent you already run. It is self-contained: the agent
clones the repository if it is missing, then reads the instructions there.

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

The full prompt, with the migration matrix and report format, is in
[`onboarding.md`](onboarding.md).

## Manual path

### 1. Prepare the host

macOS: install Homebrew, then Docker Desktop or OrbStack. Docker Desktop needs
**host networking** on and **Enhanced Container Isolation** off.

Linux: install Docker Engine 28+ and make it runnable without root (docker
group or rootless). Landlock ABI v3 needs Linux 6.2 or newer.

You need `git` and `curl` for the clone and the installer.

Install OpenShell v0.1.5 and confirm the gateway:

```sh
curl -LsSf https://raw.githubusercontent.com/NVIDIA/OpenShell/main/install.sh \
  | OPENSHELL_VERSION=v0.1.5 sh
openshell status        # Status: Connected
```

Details and install fallbacks: [`host-playbook.md`](host-playbook.md).

### 2. Clone and put `bin/` on `PATH`

```sh
git clone https://github.com/wKich/osa.git
cd osa
export PATH="$PWD/bin:$PATH"        # add to ~/.zshrc or config.fish
command -v maki-oss                  # or opencode-oss, claude-oss, codex-oss
```

The export lasts for the current terminal; persist it in your shell profile.

### 3. Build the base image

```sh
./bin/maki-oss image build
```

Substitute your helper: `opencode-oss`, `claude-oss`, or `codex-oss`. The base
is agent-only; personal MCP servers and runtimes belong in an environment store
built on top of it ([`environment-playbook.md`](environment-playbook.md)).

### 4. Set up the provider once

```sh
./bin/maki-oss provider setup    # substitute your helper
./bin/maki-oss doctor
```

The wizard remembers the provider for later sessions. Claude Code accepts an
Anthropic API key or a host-created subscription token; Codex performs the
host-only ChatGPT login in `provider setup`. Never paste a credential into the
chat, and never authenticate inside the sandbox. A model warning from `doctor`
is acceptable until you choose a default model.

### 5. Run in a project

```sh
cd ~/code/myproject
maki-oss
```

The first session uploads the project; on exit the helper collects a patch and
applies it only when the project's safety check passes. A clean repository is
fast-forwarded; a dirty or moved host keeps a review branch or a patch.

### 6. Verify once

Run the helper checks in your agent's playbook Phase 5 and compare the
observations with the verification page:

- [`playbooks/maki.md`](playbooks/maki.md) + [`verification/maki.md`](verification/maki.md)
- [`playbooks/opencode.md`](playbooks/opencode.md) + [`verification/opencode.md`](verification/opencode.md)
- [`playbooks/claude.md`](playbooks/claude.md) + [`verification/claude.md`](verification/claude.md)
- [`playbooks/codex.md`](playbooks/codex.md) + [`verification/codex.md`](verification/codex.md)

### 7. Daily use

```sh
maki-oss                            # interactive session
maki-oss run "fix the failing tests" # headless
maki-oss status                     # sandbox and sync state
maki-oss stop                       # park it
osa projects                        # every registered project
```

Full command reference: [`docs/helper.md`](../helper.md).

## Where to go next

- [`onboarding.md`](onboarding.md) — the router and full agent prompt.
- [`host-playbook.md`](host-playbook.md) — bare host to a working repository.
- [`playbooks/maki.md`](playbooks/maki.md), [`playbooks/opencode.md`](playbooks/opencode.md),
  [`playbooks/claude.md`](playbooks/claude.md), or
  [`playbooks/codex.md`](playbooks/codex.md) — the ordered path for your agent.
- [`environment-playbook.md`](environment-playbook.md) — MCP servers, runtimes,
  skills, and personal preferences.
- [`docs/helper.md`](../helper.md) — shared commands, sync states, and the
  project registry.
