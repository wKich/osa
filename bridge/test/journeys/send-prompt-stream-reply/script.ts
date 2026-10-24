import { checkpoint, journey, type, waitFor } from "../harness/journey.ts";

export default journey("send-prompt-stream-reply", {
  turns: [{ text: "PONG", stream: ["PO", "NG"] }],
  steps: [
    waitFor(/Ask anything[\s\S]*Build ·/, { name: "composer" }),
    type("Reply with the word PONG only.\r"),
    waitFor(/^(?![\s\S]*█▀▀█)/, { name: "session-route" }),
    checkpoint("user-message", waitFor(/Reply with the word PONG only\./)),
    waitFor(/^\s*PONG\s*$/m, { idleMs: 100 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "turn-finished" }),
    checkpoint("streamed", waitFor(/^\s*PONG\s*$/m)),
  ],
});
