import { checkpoint, journey, type, waitFor } from "../harness/journey.ts";

const settled = waitFor(/^[\s\S]*$/, { idleMs: 1500, name: "settled" });
const pong = [
  waitFor(/Ask anything[\s\S]*Build ·/, { name: "composer" }),
  type("Reply with the word PONG only.\r"),
  waitFor(/^\s*PONG\s*$/m, { idleMs: 100 }),
  waitFor(/^(?![\s\S]*esc interrupt)/, { name: "turn-finished" }),
  settled,
];

const LONG = Array.from({ length: 60 }, (_, i) => `line ${String(i + 1).padStart(2, "0")}`).join("\n");

export default journey("scroll-transcript", {
  turns: [{ text: LONG, stream: [LONG] }],
  steps: [
    waitFor(/Ask anything[\s\S]*Build ·/, { name: "composer" }),
    type("Reply with sixty numbered lines.\r"),
    waitFor(/line 60/, { idleMs: 100 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "turn-finished" }),
    settled,
    checkpoint("bottom", waitFor(/line 60/)),
    type("\x1b[5~"),
    settled,
    checkpoint("page-up", waitFor(/line/)),
    type("\x1b[H"),
    settled,
    checkpoint("first", waitFor(/sixty numbered lines/)),
    type("\x1b[F"),
    settled,
    checkpoint("last", waitFor(/line 60/)),
  ],
});
