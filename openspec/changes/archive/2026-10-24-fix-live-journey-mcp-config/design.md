# Design

The live runner already uploads a journey-only `init.lua` and
`providers.toml` into `/sandbox/.config/maki/` (add-journey-live-run design
decision 3) so the live Maki side asks for permission and talks only to the
loopback mock, as the reference does. MCP is the third config surface that
reaches the screen (the failure toast, `tui/src/app.tsx` v2.0.32 L545, and
the home footer count, `feature-plugins/home/footer.tsx` L29). The reference config declares
none, so the journey config writes an `mcp.toml` with no `[mcp.*]` table.
Maki reads the global file first and then the workdir's `.maki/mcp.toml`
(`bridge/src/sandbox.ts` MCP_SCRIPT mirrors that order); the journey workdir
is reset empty per journey, so the global file alone decides the set.

A journey that is about MCP servers (`manage-mcp-servers`) will declare its
own servers on both sides through its script, not through the baked image
file.
