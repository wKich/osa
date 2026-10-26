# Host playbook: provision a bare host for osa

| Field | Value |
|---|---|
| Doc | `host-playbook` |
| Kind | `playbook` |
| Agent | `shared` |
| Covers | `P0-P2` |
| Preconditions | none |
| Handoff | `docs/ai/onboarding.md` |
| Verification | `docs/ai/onboarding.md` |
| Reference | `docs/helper.md` |
| Verified | OpenShell v0.1.5, 2026-10-25 |

> **Shared host path; choose your agent in onboarding** — [open the onboarding
> guide](onboarding.md).

> **Verified against OpenShell v0.1.5 on 2026-10-25.** The OpenShell install
> command below pins the version `docs/ai/references.md` verifies; moving that
> pin is the same act as re-verifying, not a separate chore. External
> documentation links live only in [`docs/ai/references.md`](references.md) —
> this playbook restates the commands to type and points there for background.

## Scope

Ordered, executable steps for any coding agent that starts from a bare macOS
(Apple Silicon) or Linux machine. This page covers the shared P0-P2 work —
preflight, host tooling, and a working repository and shell — and ends there.
It is the same for Maki, OpenCode, and Claude Code; choose the agent in
[`docs/ai/onboarding.md`](onboarding.md), whose playbook owns the
agent-specific part of P1-P2 and all of P3-P8.

Work from the repository root once the repository exists (Phase 3). After each
phase, run its `### Verify` block and **stop on a mismatch** — report the
failing command and its output instead of working around it or continuing.

Never relax the security invariants listed at the end.

## Inputs

- A macOS (Apple Silicon) or Linux host with network access.
- The repository URL to clone in Phase 3.
- The shell you use (zsh-family or fish) to choose the agent-specific shell
  integration path there.
- A model API key is not needed on this page. The agent playbook states the
  provider input and the credential source for the agent you chose.

## Phase 1 — Preflight

### Run

Report which tools are already present. On a bare host the engine and OpenShell
checks are absent and `uname -m` still reports the architecture, which is
expected:

```sh
docker version --format '{{.Server.Version}}'
openshell status
uname -m
```

### Verify

Expected: when a tool is present, the engine prints `28.0` or later;
`openshell status` shows `Status: Connected`; `uname -m` is `arm64` or
`x86_64`. An absent command means the matching step in Phase 2 installs it; a
present tool whose version or status does not match is a mismatch — fix it in
Phase 2 rather than skipping ahead.

### Stop if

A present tool still mismatches after Phase 2, or the host architecture is
neither `arm64` nor `x86_64`. Report the command and its output instead of
continuing into agent-specific steps.

## Phase 2 — Host tooling install

### Run

#### Host preconditions

Two things a bare host must supply that no step below installs; check them
first.

**macOS — Homebrew.** The engine step installs through `brew`:

```sh
brew --version
```

If that fails, install Homebrew first (the installer is on the Homebrew
homepage), then re-open the shell and re-check.

**Linux — engine access for your user.** The engine must be runnable without
root: either your user is in the docker group (adding it needs a full logout
and login to take effect) or you use a rootless engine. Check the group:

```sh
id -nG | tr ' ' '\n' | grep -qx docker
```

An empty result means the group is missing — installing the engine package
does not grant it. Rootless-engine users can skip this check.

#### Container engine (Docker Engine 28+ or OrbStack)

macOS (Homebrew):

```sh
brew install --cask orbstack      # or Docker Desktop
```

Linux: install Docker Engine 28+ from your distribution's packages. Engine
background and the Docker Desktop networking toggles OpenShell needs are in
[`docs/setup-guide.md`](../setup-guide.md) §2; supported hosts are listed in
[`docs/ai/references.md`](references.md).

#### OpenShell CLI + gateway

Install via the upstream installer (CLI, policy prover, and local gateway in
one step; details in the OpenShell installation doc indexed by
[`docs/ai/references.md`](references.md)):

```sh
curl -LsSf https://raw.githubusercontent.com/NVIDIA/OpenShell/main/install.sh \
  | OPENSHELL_VERSION=v0.1.5 sh
openshell status
```

If `openshell status` is not `Connected`, restart the gateway service and
re-verify before proceeding — never continue on a disconnected gateway:

```sh
brew services restart openshell             # macOS
systemctl --user restart openshell-gateway  # Linux
```

### Verify

```sh
docker version --format '{{.Server.Version}}'
openshell status
```

Expected: `28.0` or later; `Status: Connected`.

### Stop if

An install still reports a version or status mismatch, or the gateway stays
disconnected after a restart. Report the failing command and its output.

## Phase 3 — Repository and shell

### Run

Clone this repository and work from its root:

```sh
git clone <repository-url> osa
cd osa
```

Put the repository's `bin/` on `PATH` (for example in `~/.zshrc`) so the shared
reporter resolves:

```sh
export PATH="/absolute/path/to/osa/bin:$PATH"
```

Fish users: this page installs nothing into fish. Fish integration and the
helper fallback variables are covered by the shared
[Fish setup](../helper.md#fish-setup) section for both helpers; the Maki
playbook's [`Shell preparation`](playbooks/maki.md) section is the
Maki-specific sequence. Claude Code has no fish plugin.

### Verify

```sh
command -v osa
```

Expected: `command -v osa` resolves to this repository's `bin/osa`.

### Stop if

The shared command resolves to another installation or not at all. Report which
path and shell failed; do not mix shell-specific integration steps into this
shared check.

## Handoff

This playbook ends with a working repository and shell. Choose the agent in
[`docs/ai/onboarding.md`](onboarding.md); the agent's playbook owns the
agent-specific part of P1-P2 and all of P3-P8 — the agent CLI, image,
provider, shell integration, sandbox, and run steps. Do not improvise those
steps from this file.

## Invariants (never relax these to make a command work)

- No host bind mounts — project files move with upload/download.
- No secrets through `--env` or `--env-from`; credentials come from provider
  profiles only.
- Egress stays deny-by-default; add the narrowest missing rule, never a
  wildcard or `tls: skip`, to fix a denial.
- Sandbox processes stay non-root (uid/gid 1500).
- No agent authenticates inside the sandbox — no login, auth, or setup-token
  command, and no provider base-URL override or API-key helper.
- Never mount or upload a host agent's configuration or credential store.

## See also

- [`docs/ai/onboarding.md`](onboarding.md) — choose Maki, OpenCode, or Claude
  Code and continue from this path.
- [`docs/ai/document-contract.md`](document-contract.md) — page shape used by
  this playbook.
- [`docs/ai/playbooks/maki.md`](playbooks/maki.md) — the Maki path,
  continuing P0-P8.
- [`docs/ai/reference/maki.md`](reference/maki.md) — Maki configuration,
  profiles, MCP, and store shape.
- [`docs/ai/playbooks/opencode.md`](playbooks/opencode.md) — the OpenCode
  path, continuing P3-P8.
- [`docs/ai/reference/opencode.md`](reference/opencode.md) — OpenCode
  configuration, profiles, sessions, MCP, and store shape.
- [`docs/claude-oss.md`](../claude-oss.md) — the Claude Code path.
- [`docs/helper.md`](../helper.md) — shared helper commands and sync states.
- [`docs/providers.md`](../providers.md) — provider profiles and setup.
- [`docs/ai/references.md`](references.md) — upstream documentation index.
