import { checkpoint, journey, type, waitFor } from "../harness/journey.ts";

const settled = waitFor(/^[\s\S]*$/, { idleMs: 1500, name: "settled" });
const TASK = { description: "Echo a marker", prompt: "Reply with the word MARK only." };

export default journey("open-subagent-session", {
  turns: [
    {
      call: {
        opencode: { name: "subagent", input: { agent: "general", ...TASK } },
        maki: { name: "task", input: { ...TASK, subagent_type: "general" }, result: "MARK" },
        subagent: true,
      },
    },
    { text: "MARK", stream: ["MA", "RK"] },
    { text: "DONE", stream: ["DO", "NE"] },
  ],
  steps: [
    waitFor(/Ask anything[\s\S]*Build ·/, { name: "composer" }),
    type("Use a subagent to get the word MARK, then reply DONE.\r"),
    waitFor(/^\s*DONE\s*$/m, { idleMs: 100, timeoutMs: 30_000 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "turn-finished" }),
    settled,
    checkpoint("subagent-row", waitFor(/DONE/)),
    type("\x1b[B"),
    settled,
    waitFor(/Subagents/, { name: "picker" }),
    type("\x01"),
    settled,
    checkpoint("subagent-picker", waitFor(/Echo a marker[\s\S]*Echo a marker/)),
    type("\r"),
    settled,
    checkpoint("child", waitFor(/MARK/)),
    type("\x1b[A"),
    settled,
    checkpoint("parent", waitFor(/DONE/)),
  ],
});
