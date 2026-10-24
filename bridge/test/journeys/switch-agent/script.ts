import { checkpoint, journey, type, waitFor } from "../harness/journey.ts";

const settled = waitFor(/^[\s\S]*$/, { idleMs: 1500, name: "settled" });

export default journey("switch-agent", {
  turns: [{ text: "PONG", stream: ["PO", "NG"] }],
  steps: [
    waitFor(/Ask anything[\s\S]*Build ·/, { name: "composer" }),
    type("\x18a"),
    waitFor(/Select agent/, { name: "dialog" }),
    settled,
    checkpoint("agent-dialog", waitFor(/Select agent/)),
    type("\x1b[B"),
    settled,
    type("\r"),
    waitFor(/^(?![\s\S]*Select agent)/, { name: "dialog-closed" }),
    settled,
    type("Reply with the word PONG only.\r"),
    waitFor(/^\s*PONG\s*$/m, { idleMs: 100 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "turn-finished" }),
    settled,
    checkpoint("agent-switched", waitFor(/^\s*PONG\s*$/m)),
  ],
});
