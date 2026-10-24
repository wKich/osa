import { checkpoint, journey, type, waitFor } from "../harness/journey.ts";

const settled = waitFor(/^[\s\S]*$/, { idleMs: 1500, name: "settled" });
const MAKE = "mkdir -p sub";

export default journey("change-working-directory", {
  turns: [
    { tool: { command: MAKE, needsPermission: true } },
    { text: "MADE", stream: ["MA", "DE"] },
    { tool: { command: "pwd", needsPermission: true } },
    { text: "THERE", stream: ["THE", "RE"] },
  ],
  steps: [
    waitFor(/Ask anything[\s\S]*Build ·/, { name: "composer" }),
    type(`Use your shell tool to run exactly: ${MAKE} . Then reply with the single word MADE.\r`),
    waitFor(/Permission required/, { name: "permission" }),
    type("\r"),
    waitFor(/^\s*MADE\s*$/m, { idleMs: 100 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "turn-finished" }),
    settled,
    type("/cd"),
    settled,
    type("\r"),
    settled,
    checkpoint("cd-dialog", waitFor(/[\s\S]*/)),
    type("sub"),
    settled,
    checkpoint("cd-typed", waitFor(/sub/)),
    // the first enter completes `sub/`, the second runs the command
    type("\r"),
    settled,
    type("\r"),
    settled,
    checkpoint("moved", waitFor(/[\s\S]*/)),
    type("Use your shell tool to run exactly: pwd . Then reply with the single word THERE.\r"),
    waitFor(/Permission required/, { name: "permission-2" }),
    type("\r"),
    waitFor(/^\s*THERE\s*$/m, { idleMs: 100 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "second-turn-finished" }),
    settled,
    checkpoint("pwd", waitFor(/THERE/)),
  ],
});
