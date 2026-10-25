import { checkpoint, journey, type, waitFor } from "../harness/journey.ts";

const settled = waitFor(/^[\s\S]*$/, { idleMs: 1500, name: "settled" });
const todos = [
  { content: "Map the tool names", status: "completed" },
  { content: "Render the transcript list", status: "in_progress" },
  { content: "Check the sidebar", status: "pending" },
];

export default journey("see-agent-todos", {
  turns: [
    {
      call: {
        opencode: { name: "todowrite", input: { todos } },
        maki: { name: "todo_write", input: { todos }, result: "" },
      },
    },
    { text: "DONE", stream: ["DO", "NE"] },
  ],
  steps: [
    waitFor(/Ask anything[\s\S]*Build ·/, { name: "composer" }),
    type("Use your todo tool to write exactly these three tasks: \"Map the tool names\" (completed), \"Render the transcript list\" (in_progress), \"Check the sidebar\" (pending). Then reply with the single word DONE.\r"),
    waitFor(/^\s*DONE\s*$/m, { idleMs: 100, timeoutMs: 30_000 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "turn-finished" }),
    settled,
    checkpoint("transcript", waitFor(/Map the tool names[\s\S]*Render the transcript list[\s\S]*Check the sidebar/)),
    type("\x18b"),
    settled,
    checkpoint("sidebar", waitFor(/Todo[\s\S]*Map the tool names/)),
  ],
});
