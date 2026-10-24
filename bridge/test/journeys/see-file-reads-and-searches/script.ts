import { checkpoint, journey, type, waitFor } from "../harness/journey.ts";

const settled = waitFor(/^[\s\S]*$/, { idleMs: 1500, name: "settled" });
const MAKE = "printf 'hello journey\\n' > README.md";

export default journey("see-file-reads-and-searches", {
  turns: [
    { tool: { command: MAKE, needsPermission: true } },
    { text: "MADE", stream: ["MA", "DE"] },
    {
      call: {
        opencode: { name: "read", input: { path: "README.md" } },
        maki: { name: "read", input: { path: "README.md", offset: 1, limit: 0 }, result: "1: hello journey" },
      },
    },
    {
      call: {
        opencode: { name: "grep", input: { pattern: "journey" } },
        maki: { name: "grep", input: { pattern: "journey" }, result: "README.md:1: hello journey" },
      },
    },
    { text: "FOUND", stream: ["FOU", "ND"] },
  ],
  steps: [
    waitFor(/Ask anything[\s\S]*Build ·/, { name: "composer" }),
    type(`Use your shell tool to run exactly: ${MAKE} . Then reply with the single word MADE.\r`),
    waitFor(/Permission required/, { name: "permission" }),
    type("\r"),
    waitFor(/^\s*MADE\s*$/m, { idleMs: 100 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "turn-finished" }),
    settled,
    type("Read README.md, then grep for journey, then reply FOUND.\r"),
    waitFor(/^\s*FOUND\s*$/m, { idleMs: 100, timeoutMs: 30_000 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "second-turn-finished" }),
    settled,
    checkpoint("tools", waitFor(/FOUND/)),
  ],
});
