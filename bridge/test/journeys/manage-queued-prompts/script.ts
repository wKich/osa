import { checkpoint, journey, type, waitFor } from "../harness/journey.ts";

const settled = waitFor(/^[\s\S]*$/, { idleMs: 1500, name: "settled" });

export default journey("manage-queued-prompts", {
  turns: [
    { text: "ONE TWO THREE FOUR", stream: ["ONE ", "TWO ", "THREE ", "FOUR"], delayMs: 5000 },
    { text: "PANG", stream: ["PA", "NG"] },
  ],
  steps: [
    waitFor(/Ask anything[\s\S]*Build ·/, { name: "composer" }),
    type("Count to four slowly.\r"),
    waitFor(/ONE TWO/, { name: "streaming" }),
    type("Reply with the word PANG only."),
    waitFor(/Reply with the word PANG only\./, { name: "typed-1" }),
    type("\x18\r"),
    waitFor(/1 queued/, { name: "queued-1" }),
    type("Reply with the word PUNG only."),
    waitFor(/Reply with the word PUNG only\./, { name: "typed-2" }),
    type("\x18\r"),
    waitFor(/2 queued/, { name: "queued-2" }),
    type("\x18q"),
    checkpoint("queue-list", waitFor(/PUNG[\s\S]*PANG|PANG[\s\S]*PUNG/)),
    type("\x04"),
    waitFor(/1 of 1/, { name: "deleted" }),
    checkpoint("removed", waitFor(/1 queued/)),
    type("\x1b"),
    waitFor(/^\s*PANG\s*$/m, { idleMs: 100, timeoutMs: 40_000 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "turns-finished" }),
    settled,
    checkpoint("ran-remaining", waitFor(/^\s*PANG\s*$/m)),
  ],
});
