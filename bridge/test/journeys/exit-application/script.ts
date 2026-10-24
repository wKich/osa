import { checkpoint, journey, type, waitFor } from "../harness/journey.ts";

const settled = waitFor(/^[\s\S]*$/, { idleMs: 1500, name: "settled" });
const pong = [
  waitFor(/Ask anything[\s\S]*Build ·/, { name: "composer" }),
  type("Reply with the word PONG only.\r"),
  waitFor(/^\s*PONG\s*$/m, { idleMs: 100 }),
  waitFor(/^(?![\s\S]*esc interrupt)/, { name: "turn-finished" }),
  settled,
];

export default journey("exit-application", {
  turns: [{ text: "PONG", stream: ["PO", "NG"] }],
  steps: [
    ...pong,
    type("\x03"),
    settled,
    checkpoint("exit-prompted", waitFor(/[\s\S]*/)),
  ],
});
