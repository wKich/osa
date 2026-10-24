import { checkpoint, journey, type, waitFor } from "../harness/journey.ts";

const settled = waitFor(/^[\s\S]*$/, { idleMs: 1500, name: "settled" });

export default journey("recall-prompt-history", {
  turns: [{ text: "PONG", stream: ["PO", "NG"] }, { text: "PONG", stream: ["PO", "NG"] }],
  steps: [
    waitFor(/Ask anything[\s\S]*Build ·/, { name: "composer" }),
    type("Reply with the word PONG only.\r"),
    waitFor(/^\s*PONG\s*$/m, { idleMs: 100 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "turn-finished" }),
    settled,
    type("\x1b[A"),
    settled,
    checkpoint("recalled", waitFor(/PONG only\.[\s\S]*PONG only\./)),
    type("\r"),
    waitFor(/PONG[\s\S]*PONG[\s\S]*PONG[\s\S]*PONG/, { name: "second-reply" }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "second-turn-finished" }),
    settled,
    checkpoint("resent", waitFor(/PONG/)),
  ],
});
