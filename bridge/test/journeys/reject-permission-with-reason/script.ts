import { checkpoint, journey, type, waitFor } from "../harness/journey.ts";

const TASK = { description: "Remove a probe", prompt: "Use your shell tool to run exactly: rm -f probe.txt . Then reply with the word GONE." };

// a subagent's ask: rejecting a child session's permission asks for a reason
// (tui routes/session/permission.tsx v2.0.32 L248–L251)
export default journey("reject-permission-with-reason", {
  turns: [
    {
      call: {
        opencode: { name: "subagent", input: { agent: "general", ...TASK } },
        maki: { name: "task", input: { ...TASK, subagent_type: "general" }, result: "GONE" },
        subagent: true,
      },
    },
    { tool: { command: "rm -f probe.txt", needsPermission: true } },
    { text: "SKIPPED", stream: ["SKIP", "PED"] },
    { text: "DONE", stream: ["DO", "NE"] },
  ],
  steps: [
    waitFor(/Ask anything[\s\S]*Build ·/, { name: "composer" }),
    type("Use a subagent to remove probe.txt, then reply DONE.\r"),
    waitFor(/Permission required/, { name: "permission", timeoutMs: 30_000 }),
    // the running tool's spinner never settles while the ask is open
    checkpoint("permission-prompt", waitFor(/Permission required[\s\S]*Reject/)),
    type("\x1b[C\x1b[C"),
    type("\r"),
    waitFor(/Reject permission/, { name: "reject-stage" }),
    type("Keep the probe file"),
    checkpoint("reason", waitFor(/Keep the probe file/)),
    type("\r"),
    waitFor(/^\s*DONE\s*$/m, { idleMs: 100, timeoutMs: 30_000 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "turn-finished" }),
    waitFor(/^[\s\S]*$/, { idleMs: 1500, name: "settled" }),
    checkpoint("rejected", waitFor(/DONE/)),
  ],
});
