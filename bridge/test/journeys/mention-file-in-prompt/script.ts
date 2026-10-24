import { checkpoint, journey, type, waitFor } from "../harness/journey.ts";

const settled = waitFor(/^[\s\S]*$/, { idleMs: 1500, name: "settled" });
const MAKE = "printf 'alpha\\n' > notes.txt";

export default journey("mention-file-in-prompt", {
  turns: [
    { tool: { command: MAKE, needsPermission: true } },
    { text: "READY", stream: ["REA", "DY"] },
    { text: "SEEN", stream: ["SE", "EN"] },
  ],
  steps: [
    waitFor(/Ask anything[\s\S]*Build ·/, { name: "composer" }),
    type(`Use your shell tool to run exactly: ${MAKE} . Then reply with the single word READY.\r`),
    waitFor(/Permission required/, { name: "permission" }),
    type("\r"),
    waitFor(/^\s*READY\s*$/m, { idleMs: 100 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "turn-finished" }),
    settled,
    type("Summarize @note"),
    waitFor(/notes\.txt/, { name: "suggested" }),
    settled,
    checkpoint("suggestions", waitFor(/notes\.txt/)),
    type("\t"),
    settled,
    checkpoint("mentioned", waitFor(/@notes\.txt/)),
    type("\r"),
    waitFor(/^\s*SEEN\s*$/m, { idleMs: 100 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "second-turn-finished" }),
    settled,
    checkpoint("sent", waitFor(/^\s*SEEN\s*$/m)),
  ],
});
