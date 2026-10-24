# Proposal

## Why

The live `resume-session-history` run shows `MCP server failed: synthetic`
and `2 MCP failed` where the reference shows nothing. The reference OpenCode
config declares no MCP server (`referenceConfig` in
`bridge/test/journeys/harness/record.ts`); the live sandbox keeps the image's
baked `/sandbox/.config/maki/mcp.toml` (context7 and synthetic), which cannot
connect with no provider attached. The bridge reports that state truthfully
(`GET /api/mcp`); the gap is the live harness running Maki with a different
MCP set than the reference. It surfaced only after
`fix-minimal-policy-dev-null`: before it, the bridge's `2>/dev/null` reads
failed and the list was empty.

## What Changes

- The journey-only Maki config gains an `mcp.toml` that declares no server,
  uploaded over the baked file like `init.lua` and `providers.toml`, so the
  live Maki side runs with the reference's MCP set.
- `resume-session-history` is re-run live.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `tui-journey-parity`: the live comparison requirement states that the
  live Maki config mirrors the reference config's provider, permission, and
  MCP sets.

## Impact

`bridge/test/journeys/harness/live-sandbox.ts` and its test, live journey
evidence. No product code, policy, provider, egress, or `--env` change; the
upload replaces a file only inside the throwaway journey sandbox.
