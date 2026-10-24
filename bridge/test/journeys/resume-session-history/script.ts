import { checkpoint, journey, restart, type, waitFor } from "../harness/journey.ts";

export default journey("resume-session-history", {
  turns: [{ text: "ALPHA", stream: ["AL", "PHA"] }],
  steps: [
    waitFor(/Ask anything[\s\S]*Build ·/, { name: "composer" }),
    type("Reply with the word ALPHA only.\r"),
    waitFor(/^\s*ALPHA\s*$/m, { idleMs: 100 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "first-turn-finished" }),
    restart(),
    waitFor(/Ask anything[\s\S]*Build ·/, { name: "reopened-composer" }),
    type("\x18l"),
    checkpoint("session-list", waitFor(/Sessions for journey-work/)),
    type("\r"),
    checkpoint("history-visible", waitFor(/^\s*ALPHA\s*$/m)),
  ],
});
