import { checkpoint, journey, type, waitFor } from "../harness/journey.ts";

export default journey("allow-permission-once", {
  turns: [{ tool: { command: "rm -f probe.txt", needsPermission: true } }, { text: "DONE", stream: ["DO", "NE"] }],
  steps: [
    waitFor(/Ask anything[\s\S]*Build ·/, { name: "composer" }),
    type("Use your shell tool to run exactly: rm -f probe.txt . Then reply with the single word DONE.\r"),
    checkpoint("permission-prompt", waitFor(/Permission required/)),
    type("\r"),
    waitFor(/^\s*DONE\s*$/m, { idleMs: 100 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "turn-finished" }),
    waitFor(/^[\s\S]*$/, { idleMs: 1500, name: "settled" }),
    checkpoint("allowed", waitFor(/^\s*DONE\s*$/m)),
  ],
});
