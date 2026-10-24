import { checkpoint, journey, type, waitFor } from "../harness/journey.ts";

const settled = waitFor(/^[\s\S]*$/, { idleMs: 1500, name: "settled" });

export default journey("switch-model", {
  turns: [{ text: "PONG", stream: ["PO", "NG"] }],
  steps: [
    waitFor(/Ask anything[\s\S]*Build ·/, { name: "composer" }),
    type("\x18m"),
    waitFor(/Select model/, { name: "dialog" }),
    settled,
    checkpoint("model-dialog", waitFor(/Select model/)),
    type("\x1b[B"),
    settled,
    type("\r"),
    settled,
    // OpenCode follows a model choice with its reasoning variants; Maki has
    // none to offer, and escape leaves either side on the chosen model
    checkpoint("model-picked", waitFor(/Build ·/)),
    type("\x1b"),
    waitFor(/^(?![\s\S]*Select (?:model|variant))/, { name: "dialog-closed" }),
    settled,
    type("Reply with the word PONG only.\r"),
    waitFor(/^\s*PONG\s*$/m, { idleMs: 100 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "turn-finished" }),
    settled,
    checkpoint("switched", waitFor(/^\s*PONG\s*$/m)),
  ],
});
