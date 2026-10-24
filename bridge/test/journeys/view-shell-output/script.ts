import { checkpoint, journey, type, waitFor } from "../harness/journey.ts";

const settled = waitFor(/^[\s\S]*$/, { idleMs: 1500, name: "settled" });

export default journey("view-shell-output", {
  turns: [{ text: "PONG", stream: ["PO", "NG"] }, { text: "SEEN", stream: ["SE", "EN"] }],
  steps: [
    waitFor(/Ask anything[\s\S]*Build ·/, { name: "composer" }),
    type("Reply with the word PONG only.\r"),
    waitFor(/^\s*PONG\s*$/m, { idleMs: 100 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "turn-finished" }),
    settled,
    type("!"),
    checkpoint("shell-mode", waitFor(/Ask anything|\$|shell/i)),
    type("echo journey-shell-output; echo to-stderr 1>&2\r"),
    waitFor(/to-stderr/, { name: "ran" }),
    settled,
    checkpoint("shell-output", waitFor(/journey-shell-output/)),
    type("Reply with the word SEEN only.\r"),
    waitFor(/^\s*SEEN\s*$/m, { idleMs: 100 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "next-turn-finished" }),
    settled,
    checkpoint("next-turn", waitFor(/^\s*SEEN\s*$/m)),
  ],
});
