import { checkpoint, journey, type, waitFor } from "../harness/journey.ts";

const settled = waitFor(/^[\s\S]*$/, { idleMs: 1500, name: "settled" });

// Maki starts its MCP servers with its session's child, so the dialog is
// opened from inside the session, once the server's tool has run
export default journey("manage-mcp-servers", {
  mcp: true,
  turns: [
    {
      call: {
        opencode: { name: "journey_marker", input: {} },
        maki: { name: "journey__marker", input: {}, result: "MCP-MARKER" },
        needsPermission: true,
      },
    },
    { text: "MARKED", stream: ["MAR", "KED"] },
  ],
  steps: [
    waitFor(/Ask anything[\s\S]*Build ·/, { name: "composer" }),
    type("Use the journey marker tool, then reply MARKED.\r"),
    waitFor(/Permission required/, { name: "permission" }),
    checkpoint("permission", waitFor(/Permission required[\s\S]*Reject/)),
    type("\r"),
    waitFor(/^\s*MARKED\s*$/m, { idleMs: 100, timeoutMs: 30_000 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "turn-finished" }),
    settled,
    checkpoint("tool-used", waitFor(/MARKED/)),
    type("/mcps"),
    settled,
    type("\r"),
    waitFor(/MCP servers/, { name: "mcp-dialog" }),
    settled,
    checkpoint("servers", waitFor(/journey/)),
    // space toggles the focused server (disconnect / connect)
    type(" "),
    settled,
    checkpoint("toggled", waitFor(/journey/)),
  ],
});
