import { checkpoint, journey, type, waitFor } from "../harness/journey.ts";

const settled = waitFor(/^[\s\S]*$/, { idleMs: 1500, name: "settled" });
const RUN = (n: number) => `Use your shell tool to run exactly: rm -f probe${n}.txt . Then reply with the single word DONE${n}.\r`;

export default journey("allow-permission-always", {
  turns: [
    { tool: { command: "rm -f probe1.txt", needsPermission: true } },
    { text: "DONE1", stream: ["DO", "NE1"] },
    // the second command is allowed for the session: no prompt
    { tool: { command: "rm -f probe2.txt" } },
    { text: "DONE2", stream: ["DO", "NE2"] },
  ],
  steps: [
    waitFor(/Ask anything[\s\S]*Build ·/, { name: "composer" }),
    type(RUN(1)),
    waitFor(/Permission required/, { name: "permission" }),
    type("\x1b[C"),
    // the running tool's spinner never settles; the always body is the cue
    checkpoint("always-selected", waitFor(/always allow the following patterns[\s\S]*rm \*/, { idleMs: 500 })),
    type("\r"),
    waitFor(/^\s*DONE1\s*$/m, { idleMs: 100 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "turn-finished" }),
    settled,
    type(RUN(2)),
    waitFor(/^\s*DONE2\s*$/m, { idleMs: 100 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "second-turn-finished" }),
    settled,
    checkpoint("not-asked-again", waitFor(/DONE2/)),
  ],
});
