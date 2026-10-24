import { checkpoint, journey, type, waitFor } from "../harness/journey.ts";

const settled = waitFor(/^[\s\S]*$/, { idleMs: 1500, name: "settled" });

export default journey("new-session", {
  turns: [{ text: "PONG", stream: ["PO", "NG"] }, { text: "PANG", stream: ["PA", "NG"] }],
  steps: [
    waitFor(/Ask anything[\s\S]*Build ·/, { name: "composer" }),
    type("Reply with the word PONG only.\r"),
    waitFor(/^\s*PONG\s*$/m, { idleMs: 100 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "first-turn-finished" }),
    settled,
    type("\x18n"),
    waitFor(/█▀▀█[\s\S]*Ask anything/, { name: "fresh-composer" }),
    settled,
    checkpoint("session-created", waitFor(/Ask anything/)),
    type("Reply with the word PANG only.\r"),
    waitFor(/^\s*PANG\s*$/m, { idleMs: 100 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "turn-finished" }),
    settled,
    checkpoint("first-prompt", waitFor(/^\s*PANG\s*$/m)),
  ],
});
