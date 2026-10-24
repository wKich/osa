import { checkpoint, journey, type, waitFor } from "../harness/journey.ts";

const settled = waitFor(/^[\s\S]*$/, { idleMs: 1500, name: "settled" });

export default journey("fork-session-from-message", {
  turns: [{ text: "PONG", stream: ["PO", "NG"] }, { text: "PANG", stream: ["PA", "NG"] }, { text: "PUNG", stream: ["PU", "NG"] }],
  steps: [
    waitFor(/Ask anything[\s\S]*Build ·/, { name: "composer" }),
    type("Reply with the word PONG only.\r"),
    waitFor(/^\s*PONG\s*$/m, { idleMs: 100 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "first-turn-finished" }),
    type("Reply with the word PANG only.\r"),
    waitFor(/^\s*PANG\s*$/m, { idleMs: 100 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "second-turn-finished" }),
    settled,
    type("/fork"),
    waitFor(/\/fork/, { name: "typed" }),
    type("\r"),
    settled,
    checkpoint("fork-picker", waitFor(/PANG/)),
    type("\r"),
    settled,
    checkpoint("forked", waitFor(/Forked session/)),
    type("Reply with the word PUNG only.\r"),
    waitFor(/^\s*PUNG\s*$/m, { idleMs: 100 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "fork-turn-finished" }),
    settled,
    checkpoint("fork-continues", waitFor(/^\s*PUNG\s*$/m)),
  ],
});
