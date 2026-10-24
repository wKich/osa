import { checkpoint, journey, type, waitFor } from "../harness/journey.ts";

const settled = waitFor(/^[\s\S]*$/, { idleMs: 1500, name: "settled" });

export default journey("close-reopen-session-tab", {
  turns: [{ text: "PONG", stream: ["PO", "NG"] }],
  steps: [
    waitFor(/Ask anything[\s\S]*Build ·/, { name: "composer" }),
    type("Reply with the word PONG only.\r"),
    waitFor(/^\s*PONG\s*$/m, { idleMs: 100 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "turn-finished" }),
    settled,
    type("\x18w"),
    waitFor(/█▀▀█[\s\S]*Ask anything/, { name: "home" }),
    settled,
    checkpoint("tab-closed", waitFor(/Ask anything/)),
    type("\x1b[84;6u"),
    settled,
    checkpoint("tab-reopened", waitFor(/^\s*PONG\s*$/m)),
  ],
});
