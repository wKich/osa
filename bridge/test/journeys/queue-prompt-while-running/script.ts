import { checkpoint, journey, type, waitFor } from "../harness/journey.ts";

const settled = waitFor(/^[\s\S]*$/, { idleMs: 1500, name: "settled" });

export default journey("queue-prompt-while-running", {
  turns: [
    { text: "ONE TWO THREE FOUR", stream: ["ONE ", "TWO ", "THREE ", "FOUR"], delayMs: 2500 },
    { text: "PANG", stream: ["PA", "NG"] },
  ],
  steps: [
    waitFor(/Ask anything[\s\S]*Build ·/, { name: "composer" }),
    type("Count to four slowly.\r"),
    waitFor(/ONE TWO/, { name: "streaming" }),
    type("Reply with the word PANG only."),
    waitFor(/Reply with the word PANG only\./, { name: "typed" }),
    type("\x18\r"),
    checkpoint("queued", waitFor(/ONE TWO[\s\S]*Reply with the word PANG only\./)),
    waitFor(/^\s*PANG\s*$/m, { idleMs: 100, timeoutMs: 30_000 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "turns-finished" }),
    settled,
    checkpoint("runs-next", waitFor(/^\s*PANG\s*$/m)),
  ],
});
