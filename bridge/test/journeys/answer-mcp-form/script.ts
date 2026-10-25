import { checkpoint, journey, pause, type, waitFor } from "../harness/journey.ts";

// The journey server's ask_color sends an MCP form (elicitation) only to a
// client that advertised elicitation (harness/mcp-server.ts). OpenCode 2.0.32
// creates the form on its server but its TUI does not present it in a
// session, so the call stays pending; Maki advertises no elicitation, so its
// call returns at once. A pause compares both at the same point, and an
// interrupt ends whatever is still running.
export default journey("answer-mcp-form", {
  mcp: true,
  turns: [
    {
      call: {
        opencode: { name: "journey_ask_color", input: {} },
        maki: { name: "journey__ask_color", input: {}, result: "Could not ask: this client accepts no forms (no elicitation capability)." },
        needsPermission: true,
      },
    },
    { text: "ANSWERED", stream: ["ANSWER", "ED"] },
  ],
  steps: [
    waitFor(/Ask anything[\s\S]*Build ·/, { name: "composer" }),
    type("Use the journey ask_color tool, then reply ANSWERED.\r"),
    waitFor(/Permission required/, { name: "permission" }),
    type("\r"),
    waitFor(/journey_+ask_color/, { name: "tool-called" }),
    pause(6000),
    checkpoint("form", waitFor(/journey_+ask_color/)),
    // the TUI interrupts on a second escape (a no-op on an idle composer)
    type("\x1b"),
    type("\x1b"),
    waitFor(/^(?![\s\S]*esc (?:again to )?interrupt)/, { name: "turn-finished", timeoutMs: 30_000 }),
    pause(3000),
    checkpoint("answered", waitFor(/journey_+ask_color/)),
  ],
});
