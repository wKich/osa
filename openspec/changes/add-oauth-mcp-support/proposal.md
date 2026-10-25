# Proposal

## Why

The `add-mcp-sandbox-support` change proved the OAuth-in-sandbox mechanism end
to end *up to the token mint*: the profile shape lints, the provider is created
with `--runtime-credentials`, refresh is configured with secret material read
from the environment (never argv), the provider attaches, and
`maki-oss mcp status` reports every gate satisfied. What it could not prove is
the live tool call, because the v0.1.4 gateway's refresh exchange is rejected
by Linear's token endpoint: Linear accepts only a body `client_id` for its
dynamically registered public clients and rejects the gateway's client
authentication (401 `invalid_client` / 400 "multiple authentication methods"),
reproducibly, while the identical body-only exchange returns HTTP 200. The
full isolation is recorded in `docs/verification-log.md` §5.2.

OAuth support therefore moved out of the HTTP/API-key change and is owned here,
so the verified part ships and the blocked part is tracked rather than
hand-waved. The upstream gateway behavior is the only blocker between the
current state and a working OAuth-gated MCP server in the sandbox.

## What Changes

- Re-add the OAuth exemplar profile `examples/providers/mcp-linear.yaml`
  (`refresh: oauth2_refresh_token`, `token_url` spelled for the pinned
  gateway) and the `[mcp.linear]` entry in
  `examples/environments/reference/config/mcp.toml`, with the discovered Linear
  limitation documented in the profile header until the gateway-side fix
  lands.
- Document the full host-side flow: declare the server in the host's
  `~/.config/maki/mcp.toml` (url only — `maki mcp auth` resolves names
  there), run `maki mcp auth <server>` on the host, then
  `openshell provider refresh configure` with `--secret-material-env` so the
  refresh token never appears in argv.
- Verify one OAuth-gated server with a real tool call from a sandbox session:
  either Linear after an upstream fix, or another server whose token endpoint
  accepts the gateway's client-authentication method (the upstream Microsoft
  Graph walkthrough is the documented working case).
- Report the gateway client-authentication mismatch upstream (public clients
  per RFC 6749 §2.3.1 may authenticate with body parameters only), and track
  the issue reference here.

## Capabilities

### Modified Capabilities

- `mcp-integration`: re-adds the requirement that OAuth-gated MCP servers
  authenticate outside the sandbox (login on the host, gateway-brokered
  refresh, placeholder-only in the sandbox, no OAuth flow inside the
  sandbox), carrying it to completion once the client-authentication blocker
  is resolved.

## Impact

- `examples/providers/mcp-linear.yaml`,
  `examples/environments/reference/config/mcp.toml` (+ environment-image
  rebuild), `docs/mcp-migration.md` §4 (OAuth point restored),
  `docs/verification-log.md` (§5.2 follow-up).
- No helper code changes expected: `maki-oss mcp status` already reports the
  attachment and endpoint gates; the OAuth flow reuses `provider setup`,
  `provider attach`, and the OpenShell refresh CLI.
- Security invariants hold throughout: no bind mounts, no secrets via
  `--env` or argv, egress deny-by-default through the profile endpoint,
  OAuth material stays at the gateway, sandbox user stays non-root.
- Known limitations carried in: RFC 8707 `resource`-parameter token
  endpoints stay inexpressible in a profile; the Linear client-auth mismatch
  stays documented until fixed upstream.
