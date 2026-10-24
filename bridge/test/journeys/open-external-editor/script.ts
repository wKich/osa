import { checkpoint, journey, type, waitFor } from "../harness/journey.ts";

const settled = waitFor(/^[\s\S]*$/, { idleMs: 1500, name: "settled" });

export default journey("open-external-editor", {
  turns: [{ text: "EDITED", stream: ["EDI", "TED"] }],
  steps: [
    waitFor(/Ask anything[\s\S]*Build ·/, { name: "composer" }),
    type("A draft to rewrite"),
    waitFor(/A draft to rewrite/, { name: "typed" }),
    type("\x18e"),
    waitFor(/Reply with the word EDITED only\./, { name: "edited" }),
    settled,
    checkpoint("edited", waitFor(/Reply with the word EDITED only\./)),
    type("\r"),
    waitFor(/^\s*EDITED\s*$/m, { idleMs: 100 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "turn-finished" }),
    settled,
    checkpoint("sent", waitFor(/^\s*EDITED\s*$/m)),
  ],
});
