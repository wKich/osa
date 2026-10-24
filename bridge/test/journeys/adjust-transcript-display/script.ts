import { checkpoint, journey, type, waitFor } from "../harness/journey.ts";

const settled = waitFor(/^[\s\S]*$/, { idleMs: 1500, name: "settled" });
const cycleVerbosity = (n: number) => [
  type("\x10"),
  waitFor(/Commands/, { name: `palette-${n}` }),
  type("Verbosity"),
  settled,
  type("\r"),
  waitFor(/^(?![\s\S]*Commands)/, { name: `palette-closed-${n}` }),
  settled,
];

export default journey("adjust-transcript-display", {
  turns: [{ tool: { command: "rm -f probe.txt", needsPermission: true } }, { text: "DONE", stream: ["DO", "NE"] }],
  steps: [
    waitFor(/Ask anything[\s\S]*Build ·/, { name: "composer" }),
    type("Use your shell tool to run exactly: rm -f probe.txt . Then reply with the single word DONE.\r"),
    waitFor(/Permission required/, { name: "permission" }),
    type("\r"),
    waitFor(/^\s*DONE\s*$/m, { idleMs: 100 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "turn-finished" }),
    settled,
    ...cycleVerbosity(1),
    checkpoint("verbosity", waitFor(/DONE/)),
    ...cycleVerbosity(2),
    checkpoint("display", waitFor(/DONE/)),
  ],
});
