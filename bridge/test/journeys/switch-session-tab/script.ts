import { checkpoint, journey, type, waitFor } from "../harness/journey.ts";

const settled = waitFor(/^[\s\S]*$/, { idleMs: 1500, name: "settled" });

export default journey("switch-session-tab", {
  turns: [{ text: "PONG", stream: ["PO", "NG"] }, { text: "PANG", stream: ["PA", "NG"] }],
  steps: [
    waitFor(/Ask anything[\s\S]*Build ·/, { name: "composer" }),
    type("Reply with the word PONG only.\r"),
    waitFor(/^\s*PONG\s*$/m, { idleMs: 100 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "first-turn-finished" }),
    settled,
    type("\x18n"),
    waitFor(/█▀▀█[\s\S]*Ask anything/, { name: "fresh-composer" }),
    type("Reply with the word PANG only.\r"),
    waitFor(/^\s*PANG\s*$/m, { idleMs: 100 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "second-turn-finished" }),
    settled,
    type("\x1b[1;3B"),
    settled,
    checkpoint("tab-switched", waitFor(/^\s*PONG\s*$/m)),
    type("\x182"),
    settled,
    checkpoint("quick-switched", waitFor(/^\s*PANG\s*$/m)),
  ],
});
