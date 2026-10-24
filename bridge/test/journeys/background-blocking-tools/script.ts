import { checkpoint, journey, type, waitFor } from "../harness/journey.ts";

const settled = waitFor(/^[\s\S]*$/, { idleMs: 1500, name: "settled" });

export default journey("background-blocking-tools", {
  turns: [
    { tool: { command: "sleep 8; echo slow-done", needsPermission: true } },
    { text: "DONE", stream: ["DO", "NE"] },
    { text: "NOTED" },
    { text: "NOTED" },
  ],
  steps: [
    waitFor(/Ask anything[\s\S]*Build ·/, { name: "composer" }),
    type("Use your shell tool to run exactly: sleep 8; echo slow-done . Then reply with the single word DONE.\r"),
    waitFor(/Permission required/, { name: "permission" }),
    type("\r"),
    waitFor(/sleep 8/, { name: "running" }),
    type("\x02"),
    checkpoint("backgrounded", waitFor(/background/i, { timeoutMs: 5_000 })),
    waitFor(/^\s*DONE\s*$/m, { idleMs: 100, timeoutMs: 30_000 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "turn-finished", timeoutMs: 30_000 }),
    settled,
    checkpoint("badge", waitFor(/Shell finished/, { timeoutMs: 30_000 })),
  ],
});
