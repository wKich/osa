import { checkpoint, journey, type, waitFor } from "../harness/journey.ts";

const settled = waitFor(/^[\s\S]*$/, { idleMs: 1500, name: "settled" });

export default journey("interrupt-running-turn", {
  turns: [{ text: "ONE TWO THREE FOUR FIVE SIX", stream: ["ONE ", "TWO ", "THREE ", "FOUR ", "FIVE ", "SIX"], delayMs: 1500 }],
  steps: [
    waitFor(/Ask anything[\s\S]*Build ·/, { name: "composer" }),
    type("Count to six slowly.\r"),
    waitFor(/ONE TWO/, { name: "streaming" }),
    checkpoint("running", waitFor(/esc interrupt/)),
    type("\x1b"),
    waitFor(/again to interrupt/, { name: "armed" }),
    type("\x1b"),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "turn-stopped", timeoutMs: 15_000 }),
    settled,
    checkpoint("interrupted", waitFor(/ONE TWO/)),
  ],
});
