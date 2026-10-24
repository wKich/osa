import { checkpoint, journey, type, waitFor } from "../harness/journey.ts";

const settled = waitFor(/^[\s\S]*$/, { idleMs: 1500, name: "settled" });

export default journey("open-terminal-pane", {
  turns: [{ text: "PONG", stream: ["PO", "NG"] }],
  steps: [
    waitFor(/Ask anything[\s\S]*Build ·/, { name: "composer" }),
    type("Reply with the word PONG only.\r"),
    waitFor(/^\s*PONG\s*$/m, { idleMs: 100 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "turn-finished" }),
    settled,
    type("\x18t"),
    settled,
    checkpoint("terminal-open", waitFor(/PONG/)),
    // the output differs from the typed text, which a long prompt may wrap
    type("echo tmark-$((40+2))\r"),
    waitFor(/tmark-42/, { name: "echoed" }),
    settled,
    checkpoint("terminal-output", waitFor(/tmark-42/)),
  ],
});
