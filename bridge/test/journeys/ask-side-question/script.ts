import { checkpoint, journey, type, waitFor } from "../harness/journey.ts";

const settled = waitFor(/^[\s\S]*$/, { idleMs: 1500, name: "settled" });

export default journey("ask-side-question", {
  turns: [{ text: "PONG", stream: ["PO", "NG"] }, { text: "ASIDE", stream: ["AS", "IDE"] }],
  steps: [
    waitFor(/Ask anything[\s\S]*Build ·/, { name: "composer" }),
    type("Reply with the word PONG only.\r"),
    waitFor(/^\s*PONG\s*$/m, { idleMs: 100 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "turn-finished" }),
    settled,
    type("/btw What did you reply?"),
    waitFor(/\/btw What did you reply\?/, { name: "typed" }),
    type("\r"),
    waitFor(/ASIDE/, { name: "aside", timeoutMs: 30_000 }),
    settled,
    checkpoint("aside-answer", waitFor(/ASIDE/)),
  ],
});
