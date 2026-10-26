# Setup guide: Maki in an OpenShell sandbox

> **Verified against OpenShell v0.1.5 and Maki v0.6.5 on 2026-10-25 (the
> v0.1.5 upgrade's checks were re-run; the full dry run was not repeated).** Tested on macOS 26.5
> (Apple Silicon) with Docker Engine 29.4.0 (OrbStack). Docker Desktop 28+ is
> the upstream-supported macOS path; Linux hosts work the same way. What the
> dry run covered — and what it did not — is recorded in
> [`docs/verification-log.md`](verification-log.md).

This guide takes a clean macOS/Apple-Silicon (or Linux) machine to a running
Maki agent inside an OpenShell sandbox, with no host files mounted, no
credentials in the sandbox environment, and deny-by-default egress. Every
configuration block points at a canonical file under [`examples/`](../examples/);
this guide never duplicates them.

## 1. The isolation model

Maki runs in an OpenShell sandbox — a Docker container (or MicroVM) whose
isolation does not depend on Maki's own permission system:

- **Filesystem.** Landlock confines the workload to the paths in the sandbox
  policy: `/sandbox`, `/tmp`, and the `/dev/null` sink are writable, system paths are read-only,
  everything else is inaccessible. Host paths such as `/Users` do not exist in
  the sandbox.
- **Network.** Egress is deny-by-default through a proxy. Only endpoints named
  by the policy or an attached provider profile are reachable, and each is
  tied to a binary path (`/usr/local/bin/maki`) and, for REST endpoints, to
  allowed methods and paths.
- **Credentials.** The real API key stays in the gateway. The sandbox process
  sees an opaque placeholder that ends in the variable name (for example
  `..._ANTHROPIC_API_KEY`); the proxy substitutes the real value only at
  endpoints the provider profile authorizes. Maki never holds the key.
- **Process.** The workload runs as uid/gid 1500 (`sandbox`), never root, under
  seccomp filters.
- **File transfer.** There are no host bind mounts. Project files move in and
  out with `openshell sandbox upload` / `download`.

The full vocabulary (gateway, supervisor, base and effective policy, policy
advisor, policy prover, and the rest) is defined in
[`docs/glossary.md`](glossary.md).

## 2. Prerequisites

| Requirement | Check | Expected |
|---|---|---|
| Docker Engine 28+ | `docker version --format '{{.Server.Version}}'` | `28.0` or later |
| OpenShell CLI + gateway | `openshell status` | `Status: Connected`, version `0.1.5` or later |
| Host platform | `uname -m` | `arm64` on Apple Silicon; Linux amd64/arm64 also supported |

**Docker Desktop settings (macOS):** OpenShell needs containers to reach the
host-local gateway.

- Settings → Resources → Network → enable **Enable host networking**.
- Settings → General → leave **Use Enhanced Container Isolation** disabled.

OrbStack works as the container engine when the sandbox can reach the gateway
(verified for this repository; see the verification log). The rest of the guide
uses the `docker` CLI and does not depend on which engine provides it.

**Install OpenShell** (CLI, policy prover, and a local gateway in one step):

```sh
curl -LsSf https://raw.githubusercontent.com/NVIDIA/OpenShell/main/install.sh | sh
openshell status
```

On macOS the installer uses Homebrew and starts a gateway service; on Linux it
installs a package and a systemd user service. If the status is not
`Connected`, restart the service (`brew services restart openshell`, or
`systemctl --user restart openshell-gateway`) and retry.

## 3. Build the Maki image

[`examples/maki-image/Dockerfile`](../examples/maki-image/Dockerfile) pins the
Maki release with `ARG MAKI_VERSION=0.6.5`, installs the static binary to
`/usr/local/bin/maki`, creates the non-root `sandbox` user (uid/gid 1500), and
bakes the global Maki configuration into `/sandbox/.config/maki/`.

```sh
docker build --build-arg MAKI_VERSION=0.6.5 -t maki-agent:local examples/maki-image
```

Verify the build and the baked configuration:

```sh
docker run --rm maki-agent:local maki --version
docker run --rm maki-agent:local ls /sandbox/.config/maki
```

Expected: `maki 0.6.5`, and `init.lua`, `mcp.toml`, and `permissions.toml` in
the config directory. This is the **base image**: the agent runtime and safety
baseline only. `init.lua` pre-answers folder trust for `/sandbox/**` and starts
every session in YOLO mode, because the sandbox is the permission boundary
(the `permissions.toml` deny rules still apply); it sets no personal UI
preference. `mcp.toml` declares zero MCP servers (it is comments-only), and
`permissions.toml` keeps the deny rules (no `sudo`, no `maki auth`, no writes
to the baked config). The image installs no MCP-specific runtime. See
[`examples/maki-image/config/`](../examples/maki-image/config/).

Personal MCP servers, runtimes they need, and personal UI preferences belong in
an **environment image** built on top of the base. The repository ships a
reference store for the previous behavior — the `context7` and `synthetic`
servers, Bun, and the compact-UI preferences:

```sh
docker build -t maki-agent:reference examples/environments/reference
docker run --rm maki-agent:reference maki --version
```

Select it through the helper's existing `image` setting (in
`${XDG_CONFIG_HOME:-$HOME/.config}/maki-oss/config.toml`):

```toml
image = "maki-agent:reference"
```

`maki-oss status`, `maki-oss doctor`, and new sandboxes then use the derived
tag. For a store of your own, follow
[`docs/ai/environment-playbook.md`](ai/environment-playbook.md); never edit
`examples/maki-image/` for a personal choice.

Once a project sandbox exists, check what is ready:

```sh
maki-oss mcp status
```

The gate-by-gate checklist for getting a server ready — and the failures it
reports — lives in [`docs/mcp-migration.md`](mcp-migration.md). A missing server
or runtime points at the environment-image build and the environment playbook,
not at a base `maki-oss image build`.

## 4. Model access through a provider profile

Any provider works: OpenShell binds credentials to endpoint hosts regardless of
vendor, and this repository ships curated profiles for Anthropic, OpenRouter,
DeepSeek, Synthetic, OpenAI, Google Gemini, Mistral, xAI, Z.AI, Kimi, MiniMax,
NanoGPT, Xiaomi, OpenCode Zen, and OpenCode Go — every profile file, its
environment variable, and its endpoint are listed in the curated catalog
below. The catalog, the credential-store mapping, and the wizard reference live
in [`docs/providers.md`](providers.md). MCP server profiles (`mcp-context7`,
`mcp-synthetic`) are set up through the environment-image step in §3 and
[`docs/mcp-migration.md`](mcp-migration.md) instead.

The fastest path takes a key you already hold — including the ones Maki and
OpenCode keep in their own stores — and does the profile lint/import and
provider creation for you:

```sh
maki-oss provider setup                 # interactive picker
maki-oss provider setup --from maki --credential opencode-go --yes
```

The manual equivalent, using Anthropic or OpenRouter as the example. Import the
profile once per gateway (lint first — it validates the schema without
registering):

```sh
# Anthropic
openshell profile lint -f examples/providers/maki-anthropic.yaml
openshell profile import -f examples/providers/maki-anthropic.yaml --global

# or OpenRouter
openshell profile lint -f examples/providers/maki-openrouter.yaml
openshell profile import -f examples/providers/maki-openrouter.yaml --global
```

Create the provider instance from the key in your host environment:

```sh
# Anthropic
ANTHROPIC_API_KEY=<your-key> \
  openshell provider create --name maki-anthropic --type maki-anthropic --from-existing

# or OpenRouter
OPENROUTER_API_KEY=<your-key> \
  openshell provider create --name maki-openrouter --type maki-openrouter --from-existing
```

For any other provider substitute its profile file, type, and environment
variable from the [catalog table](providers.md#curated-catalog); the wizard
rejects OAuth-only credentials, and
[`docs/migrating-providers.md`](migrating-providers.md) explains the options.

Rules that keep the credential boundary intact:

- Never pass the key with `openshell sandbox create --env`; OpenShell warns on
  credential-looking `--env` keys for that reason.
- Never run `maki auth login` inside the sandbox; the provider is the only
  credential path.
- Do not set a provider base-URL override in the sandbox (for example
  `ANTHROPIC_BASE_URL` or `OPENROUTER_BASE_URL`). A different base URL makes the
  profile endpointless, the placeholder stops resolving, and requests fail with
  `credential_endpoint_mismatch`.

Verify what the gateway now serves (no credential values are printed):

```sh
openshell profile describe maki-anthropic
openshell provider list
```

## 5. Sandbox policy

Use [`examples/policies/maki-minimal.yaml`](../examples/policies/maki-minimal.yaml):
system paths read-only, `/sandbox`, `/tmp`, and `/dev/null` read-write, uid/gid 1500, and no
network rules of its own. The attached provider contributes the model endpoint
rules, and the result is the *effective* policy.

Create the sandbox with the policy and provider, running Maki as the main
process:

```sh
openshell sandbox create --name maki \
  --from maki-agent:local \
  --policy examples/policies/maki-minimal.yaml \
  --provider maki-anthropic \
  -- maki
```

For repository-scoped `git push`, use
[`examples/policies/maki-git-push.yaml`](../examples/policies/maki-git-push.yaml)
instead: it adds Git Smart HTTP rules for `github.com` and REST rules for
`api.github.com`, scoped to one repository. Replace the `<org>`/`<repo>`
placeholders and attach a GitHub provider for credentials.

Policy notes:

- Filesystem, Landlock, and process settings are fixed at sandbox creation;
  network rules hot-reload.
- Inspect the base policy (what you wrote) and the effective policy (what the
  sandbox enforces):
  ```sh
  openshell policy get maki --base
  openshell policy get maki --full
  ```
- Denied requests appear in the sandbox log; the policy advisor can draft a
  narrow rule for review if one turns out to be missing (see
  [`docs/ai/references.md`](ai/references.md) for upstream links).

## 6. Run Maki

**Helper shortcut (recommended).** `maki-oss` wraps the whole flow. After the
one-time `maki-oss provider setup` (which remembers the provider) and
`maki-oss image build`, running `maki-oss` inside a project creates or starts
its sandbox, refreshes the disposable project workspace when the host tree
moved, attaches remembered providers, launches Maki, and on exit collects the
sandbox changes as a patch. The patch is applied only when the project's
safety check passes; a clean repository is fast-forwarded, a dirty or moved
host keeps a review branch, and conflicts retain the patch without touching
project files (`--no-sync` opts out). A retained patch does not block the
next session; a parked workspace refuses it until you download or discard the
changes. `maki-oss status` shows the state. `maki-oss run "<prompt>"` is the
headless variant. The raw OpenShell commands below remain the reference for
what the helper does.

**Interactive** (the command in section 5): after creation you are attached to
Maki. To return later, `openshell sandbox connect maki`.

**Headless, in an existing sandbox** — `sandbox exec` starts a new process, so
it always sees the current provider environment:

```sh
openshell sandbox exec -n maki --no-login-shell -- \
  maki -p "List the top-level files and explain the project." --output-format json
```

**One-shot sandbox** (created, run, deleted):

```sh
openshell sandbox create --no-keep \
  --from maki-agent:local \
  --policy examples/policies/maki-minimal.yaml \
  --provider maki-anthropic \
  -- maki -p "Reply with OK."
```

**Project upload / download caveat:** `--upload` cannot be combined with a
trailing main command, because uploads finish after the main process starts.
Create a scratch sandbox with the upload, then execute Maki:

```sh
openshell sandbox create --name maki \
  --from maki-agent:local \
  --policy examples/policies/maki-minimal.yaml \
  --provider maki-anthropic \
  --upload /path/to/project:/sandbox/project

openshell sandbox exec -n maki --workdir /sandbox/project --no-login-shell -- \
  maki -p "Explain this project."

openshell sandbox download maki /sandbox/project ./project-out
```

Downloads are restricted to paths inside the sandbox's canonical working
directory; to copy results out, keep them under `/sandbox`.

## 7. Isolation verification

Run the checklist in [`docs/ai/verification/maki.md`](ai/verification/maki.md):
denied egress, placeholder-only credentials, invisible host paths, effective
policy review, attached provider list, and denial logs — each with its exact
command and expected output.

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `openshell status` shows `Disconnected` | Gateway service stopped | `brew services restart openshell` / `systemctl --user restart openshell-gateway` |
| Sandbox stays in `Provisioning` with `ConfigurationInvalid` | Policy or provider rejected at startup | `openshell sandbox get maki --output json`; repair within 300 s, or `openshell sandbox start maki` after expiry |
| Every request denied | No provider attached, or caller binary not in rules | `openshell policy get maki --full`; confirm `/usr/local/bin/maki` and the endpoint appear; `openshell logs maki --since 5m --source sandbox` |
| `credential_endpoint_mismatch` | Base URL override or wrong profile | Remove `*_BASE_URL`, import the matching profile, recreate the sandbox process |
| Maki reports no API key | Provider attached after the process started | `sandbox exec` a new process (it sees current placeholders) or recreate the sandbox |
| Docker build fails for the architecture | Unsupported `dpkg --print-architecture` value | The Dockerfile supports `amd64` and `arm64`; extend the `case` for other targets |
| Sandbox cannot reach the gateway (macOS) | Docker Desktop host networking off | Enable it (Settings → Resources → Network), restart Docker |

## 9. Terms

The shared vocabulary — gateway, sandbox, supervisor, base and effective
policy, provider, profile, credential placeholder, Landlock, seccomp, network
namespace, OCSF, policy advisor, policy prover, workspace, template — is
defined once in [`docs/glossary.md`](glossary.md).

## 10. Next steps

- Keep the dry-run record current: after changing an example, re-run the checks
  and update [`docs/verification-log.md`](verification-log.md).
- Pick any provider: [`docs/providers.md`](providers.md) covers the catalog,
  the `maki-oss provider setup` wizard, and custom profiles, and
  [`docs/migrating-providers.md`](migrating-providers.md) migrates credentials
  from Maki and OpenCode stores.
- The `add-maki-oss-fish-helper` change builds a `maki-oss` CLI on top of
  these examples; the `add-openshell-bun-dashboard` change visualizes the same
  gateway.
- For agent-driven setup, use
  [`docs/ai/playbooks/maki.md`](ai/playbooks/maki.md).
