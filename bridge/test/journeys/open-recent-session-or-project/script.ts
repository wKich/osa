import { checkpoint, journey, type, waitFor } from "../harness/journey.ts";

const settled = waitFor(/^[\s\S]*$/, { idleMs: 1500, name: "settled" });
const pong = [
  waitFor(/Ask anything[\s\S]*Build ·/, { name: "composer" }),
  type("Reply with the word PONG only.\r"),
  waitFor(/^\s*PONG\s*$/m, { idleMs: 100 }),
  waitFor(/^(?![\s\S]*esc interrupt)/, { name: "turn-finished" }),
  settled,
];

export default journey("open-recent-session-or-project", {
  turns: [{ text: "PONG", stream: ["PO", "NG"] }],
  steps: [
    ...pong,
    type("\x18n"),
    waitFor(/Ask anything/, { name: "new-session" }),
    settled,
    type("\x0f"),
    waitFor(/Open/, { name: "open-dialog" }),
    settled,
    checkpoint("open-dialog", waitFor(/Open/)),
    // both sides' session titles contain an "e"
    type("e"),
    waitFor(/Sessions/, { name: "sessions-listed" }),
    settled,
    checkpoint("search", waitFor(/Sessions/)),
    type("\r"),
    waitFor(/PONG/, { name: "reopened" }),
    settled,
    checkpoint("reopened", waitFor(/PONG/)),
  ],
});
