# Live verification — environment layer

Recorded 2026-10-25 on macOS (Apple Silicon), Docker Engine 29.4.0 (OrbStack),
and a connected OpenShell gateway. Only placeholder shapes and public endpoint
names are recorded; no credential value and no literal placeholder prefix
appears in this file.

## 1. Base image is zero-MCP

Commands:

```sh
docker build -t maki-agent:local examples/maki-image
docker run --rm maki-agent:local maki --version
docker run --rm maki-agent:local ls /sandbox/.config/maki
docker run --rm --entrypoint sh maki-agent:local -c '! command -v bun && ! command -v synthetic-search-mcp'
docker run --rm maki-agent:local maki prompt --tools >/dev/null
```

Observed:

```text
maki 0.6.4
init.lua
mcp.toml
permissions.toml
(no output; exit 0 — neither Bun nor synthetic-search-mcp resolves)
(no output; exit 0 — Maki loads the comments-only mcp.toml)
```

The base `mcp.toml` has no `[mcp.*]` table, and the base Dockerfile has no Bun
install or `synthetic-search-mcp` step.

## 2. Reference environment image

Commands:

```sh
docker build -t maki-agent:reference examples/environments/reference
docker run --rm maki-agent:reference maki --version
docker run --rm --entrypoint sh maki-agent:reference -c 'command -v bun && command -v synthetic-search-mcp'
docker run --rm maki-agent:reference cat /sandbox/.config/maki/mcp.toml
```

Observed:

```text
maki 0.6.4
/usr/local/bin/bun
/sandbox/.bun/bin/synthetic-search-mcp
[mcp.context7]
[mcp.synthetic]
```

The printed config showed both servers with `${VAR}` names only; no credential
value was printed.

## 3. Scratch sandbox selected the derived tag

Commands (scratch project outside the repository):

```sh
MAKI_OSS_IMAGE=maki-agent:reference \
MAKI_OSS_SANDBOX_NAME=maki-env-verify \
MAKI_OSS_PROVIDERS=' ' \
  maki-oss up
```

Observed:

```text
Creating sandbox 'maki-env-verify' from maki-agent:reference...
Created sandbox: maki-env-verify
Sandbox 'maki-env-verify' is ready. Next: maki-oss upload .
```

## 4. Status reports the configured image

Command:

```sh
MAKI_OSS_IMAGE=maki-agent:reference MAKI_OSS_SANDBOX_NAME=maki-env-verify \
MAKI_OSS_PROVIDERS=' ' maki-oss status
```

Observed:

```text
Sandbox:   maki-env-verify
Exists:    yes
Phase:     Ready
Image:     maki-agent:reference (configured)
Providers: none
```

## 5. Readiness gates

Command:

```sh
MAKI_OSS_IMAGE=maki-agent:reference MAKI_OSS_SANDBOX_NAME=maki-env-verify \
MAKI_OSS_PROVIDERS=' ' maki-oss mcp status
```

Observed:

```text
MCP readiness for sandbox 'maki-env-verify':
  context7: sandbox=ok provider=missing endpoint=missing transport=http
    fix: maki-oss provider attach mcp-context7
    fix: the endpoint for 'mcp.context7.com' comes from the provider profile; run 'maki-oss provider attach mcp-context7' or import a profile that declares it
  synthetic: sandbox=ok runtime=ok provider=missing transport=stdio
    fix: maki-oss provider attach mcp-synthetic
exit=3
```

The config gate (`sandbox=ok`) and the stdio runtime gate (`runtime=ok`) held for
both relocated servers. The provider gates stayed missing because no profiles
were attached to the scratch sandbox; the task allows that. The command printed
no credential value.

## 6. Cleanup

Command:

```sh
MAKI_OSS_IMAGE=maki-agent:reference MAKI_OSS_SANDBOX_NAME=maki-env-verify \
MAKI_OSS_PROVIDERS=' ' maki-oss rm --yes
```

Observed:

```text
Deleting sandbox 'maki-env-verify'...
✓ Sandbox maki-env-verify deletion accepted; cleanup is pending
```

A follow-up `openshell sandbox list` no longer listed `maki-env-verify`.
