import { checkpoint, journey, type, waitFor } from "../harness/journey.ts";

const settled = waitFor(/^[\s\S]*$/, { idleMs: 1500, name: "settled" });

export default journey("copy-session-content", {
  turns: [{ text: "PONG", stream: ["PO", "NG"] }],
  steps: [
    waitFor(/Ask anything[\s\S]*Build ·/, { name: "composer" }),
    type("Reply with the word PONG only.\r"),
    waitFor(/^\s*PONG\s*$/m, { idleMs: 100 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "turn-finished" }),
    settled,
    type("\x18y"),
    checkpoint("message-copied", waitFor(/copied to clipboard|Failed to copy/i)),
    settled,
    type("\x10"),
    waitFor(/Commands/, { name: "palette" }),
    type("Copy session transcript"),
    settled,
    type("\r"),
    checkpoint("transcript-copied", waitFor(/transcript copied to clipboard|Failed to copy session transcript/i)),
  ],
});
