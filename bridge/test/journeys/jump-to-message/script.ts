import { checkpoint, journey, type, waitFor } from "../harness/journey.ts";

const settled = waitFor(/^[\s\S]*$/, { idleMs: 1500, name: "settled" });

export default journey("jump-to-message", {
  turns: [{ text: "PONG", stream: ["PO", "NG"] }, { text: "PANG", stream: ["PA", "NG"] }],
  steps: [
    waitFor(/Ask anything[\s\S]*Build ·/, { name: "composer" }),
    type("Reply with the word PONG only.\r"),
    waitFor(/^\s*PONG\s*$/m, { idleMs: 100 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "first-turn-finished" }),
    type("Reply with the word PANG only.\r"),
    waitFor(/^\s*PANG\s*$/m, { idleMs: 100 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "second-turn-finished" }),
    settled,
    type("\x18g"),
    settled,
    checkpoint("timeline", waitFor(/Timeline/)),
    type("\x1b[B"),
    settled,
    type("\r"),
    waitFor(/Message Actions/, { name: "actions" }),
    settled,
    type("\r"),
    waitFor(/^(?![\s\S]*Message Actions)/, { name: "actions-closed" }),
    settled,
    checkpoint("jumped", waitFor(/PONG/)),
  ],
});
