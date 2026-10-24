import { checkpoint, journey, type, waitFor } from "../harness/journey.ts";

const settled = waitFor(/^[\s\S]*$/, { idleMs: 1500, name: "settled" });

export default journey("compact-session", {
  turns: [{ text: "PONG", stream: ["PO", "NG"] }, { text: "## Objective\n- Get the word PONG.\n\n## Work State\n### Completed\n- Replied PONG." }],
  steps: [
    waitFor(/Ask anything[\s\S]*Build ·/, { name: "composer" }),
    type("Reply with the word PONG only.\r"),
    waitFor(/^\s*PONG\s*$/m, { idleMs: 100 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "turn-finished" }),
    settled,
    type("/compact"),
    waitFor(/\/compact/, { name: "typed" }),
    type("\r"),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "compact-finished", timeoutMs: 30_000 }),
    settled,
    checkpoint("compacted", waitFor(/PONG/)),
  ],
});
