import { checkpoint, journey, type, waitFor } from "../harness/journey.ts";

const settled = waitFor(/^[\s\S]*$/, { idleMs: 1500, name: "settled" });
const QUESTION = {
  question: "Which color should the journey use?",
  header: "Color",
  options: [
    { label: "Red", description: "The first option" },
    { label: "Blue", description: "The second option" },
  ],
};

export default journey("answer-agent-question", {
  turns: [
    {
      call: {
        opencode: { name: "question", input: { questions: [QUESTION] } },
        // the pinned SDK runs Maki's question tool with no UI, which
        // dismisses it (plugins/question/question_form.lua v0.6.4 L598–L628)
        maki: { name: "question", input: { questions: [QUESTION] }, result: "(question dismissed by user)" },
      },
    },
    { text: "CHOSEN", stream: ["CHO", "SEN"] },
  ],
  steps: [
    waitFor(/Ask anything[\s\S]*Build ·/, { name: "composer" }),
    type("Ask me which color to use with your question tool, then reply CHOSEN.\r"),
    waitFor(/Which color should the journey use\?|CHOSEN/, { name: "asked", timeoutMs: 30_000 }),
    settled,
    checkpoint("question", waitFor(/Which color|CHOSEN/)),
    type("\r"),
    waitFor(/^\s*CHOSEN\s*$/m, { idleMs: 100, timeoutMs: 30_000 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "turn-finished" }),
    settled,
    checkpoint("answered", waitFor(/CHOSEN/)),
  ],
});
