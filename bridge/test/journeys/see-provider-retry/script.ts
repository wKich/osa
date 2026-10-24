import { checkpoint, journey, type, waitFor } from "../harness/journey.ts";

const settled = waitFor(/^[\s\S]*$/, { idleMs: 1500, name: "settled" });

export default journey("see-provider-retry", {
  turns: [{ fail: { status: 503, message: "journey provider overloaded" } }, { text: "PONG", stream: ["PO", "NG"] }],
  steps: [
    waitFor(/Ask anything[\s\S]*Build ·/, { name: "composer" }),
    type("Reply with the word PONG only.\r"),
    checkpoint("retrying", waitFor(/Retrying in/)),
    waitFor(/^\s*PONG\s*$/m, { idleMs: 100, timeoutMs: 60_000 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "turn-finished" }),
    settled,
    checkpoint("recovered", waitFor(/^\s*PONG\s*$/m)),
  ],
});
