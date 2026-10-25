# Proposal

## Why

The base image currently hardcodes one person's working environment: the
`context7` and `synthetic` MCP servers, the `synthetic-search-mcp` package and
its Bun runtime, YOLO and compact-UI preferences, and an Anthropic provider in
the example config. Every user inherits those choices, and changing them means
editing the product's `examples/maki-image/` build context. maki-oss should be
a foundation of mechanics and guidance; a person's MCPs, skills, plugins, and
agent preferences belong in a user-owned environment layer that is composed
with the base at image build time.

## What Changes

- **Zero the base image**: remove the `context7` and `synthetic` MCP entries,
  the `synthetic-search-mcp` package, the Bun runtime installed only for it,
  and the YOLO/compact-UI preferences from `examples/maki-image/`. Keep the
  non-root uid/gid, Landlock/filesystem policy, folder trust, and
  `permissions.toml` deny rules.
- **Add a reference environment store** at
  `examples/environments/reference/`: a Docker build context with `Dockerfile`
  (`FROM maki-agent:local`), `config/mcp.toml`, `config/init.lua`,
  `README.md` that points at the shipped host-side MCP profiles, and
  `.dockerignore`. It demonstrates the relocated MCPs, Bun runtime, and
  UI/YOLO preferences without making them the default.
- **Add the environment recipe** at `docs/ai/environment-playbook.md`: an
  agent-agnostic audit → classify → generate store → build → verify procedure,
  plus a paste-able prompt for any host coding agent. Update the host and
  agent playbooks, setup guide, MCP migration guide, glossary, README, and
  `AGENTS.md` to describe the base/environment split.
- **Make the readiness guidance honest**: `maki-oss mcp status` now points a
  missing server or runtime at the environment image and playbook instead of
  `maki-oss image build`, which only rebuilds the base.
- **Remove the sample provider default** from `examples/config.toml` so a
  copied config does not select one person's provider.
- **Retarget the OAuth MCP example**: `add-oauth-mcp-support` adds
  `[mcp.linear]` to the reference environment store, not the base image.
- **BREAKING**: `maki-agent:local` no longer contains the two MCP servers.
  Users who want them must build the reference (or their own) environment
  image and set `image`. Existing sandboxes keep the old image until they are
  recreated.

## Capabilities

### New Capabilities

- `environment-layer`: The base image is agent-only and contains no personal
  MCP servers or MCP-specific runtimes; a user-owned Docker build context
  composes the environment on top of it; the repository ships only a reference
  store and an agent-agnostic recipe, never a default environment.

### Modified Capabilities

- `mcp-integration`: MCP server definitions and stdio packages come from the
  environment layer, not the base image; readiness guidance names the
  environment build as the fix when the base has no server.
- `helper-cli`: the `mcp status` fix for a server or runtime missing from the
  sandbox points at the environment image and playbook rather than a base
  `image build`.
- `host-setup`: one-time setup builds the generic base and, optionally, an
  environment store; the playbook must explain the base/environment boundary
  and how `image` selects the derived image.

## Impact

- Affected files: `examples/maki-image/Dockerfile`,
  `examples/maki-image/config/{mcp.toml,init.lua}`,
  `examples/environments/reference/*`, `examples/providers/mcp-*.yaml`
  (referenced, not moved), `examples/config.toml`, `bin/maki-oss`,
  `tests/run-tests.sh`, `README.md`, `AGENTS.md`, and the docs listed above.
- Affected specs: new `environment-layer`; deltas to `mcp-integration`,
  `helper-cli`, and `host-setup`; `add-oauth-mcp-support` retargeted.
- User impact: existing `maki-agent:local` users lose the baked MCPs until
  they build and select an environment image. The reference store restores the
  previous behavior.
- Security: unchanged. The base still uses provider-profile placeholders,
  deny-by-default egress, a non-root sandbox user, and no host bind mounts.
  The environment store carries configuration and packages only, never
  credential values; MCP endpoints and credentials still come from provider
  profiles.

## Upstream References

- Maki configuration and `init.lua`:
  <https://maki.sh/docs/configuration/>
- Maki permissions and YOLO/deny rules: <https://maki.sh/docs/permissions/>
- Maki folder trust: <https://maki.sh/docs/folder-trust/>
- OpenShell profiles: <https://docs.nvidia.com/openshell/how-it-works/providers/profiles.md>
- OpenShell sandbox policies: <https://docs.nvidia.com/openshell/how-it-works/policies/overview.md>
- OpenShell security best practices:
  <https://docs.nvidia.com/openshell/security/best-practices.md>
