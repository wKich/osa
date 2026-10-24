import { checkpoint, journey, type, waitFor } from "../harness/journey.ts";

const settled = waitFor(/^[\s\S]*$/, { idleMs: 1500, name: "settled" });

export default journey("delete-session", {
  turns: [{ text: "PONG", stream: ["PO", "NG"] }],
  steps: [
    waitFor(/Ask anything[\s\S]*Build ·/, { name: "composer" }),
    type("Reply with the word PONG only.\r"),
    waitFor(/^\s*PONG\s*$/m, { idleMs: 100 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "turn-finished" }),
    settled,
    type("\x18l"),
    waitFor(/Sessions for journey-work/, { name: "session-list" }),
    settled,
    type("\x04"),
    settled,
    checkpoint("delete-confirm", waitFor(/Sessions for journey-work/)),
    type("\x04"),
    settled,
    checkpoint("deleted", waitFor(/No sessions available/)),
  ],
});
