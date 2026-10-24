import { checkpoint, journey, type, waitFor } from "../harness/journey.ts";

const settled = waitFor(/^[\s\S]*$/, { idleMs: 1500, name: "settled" });

export default journey("see-failed-turn-error", {
  turns: [{ fail: { status: 400, message: "journey model rejected the request" } }],
  steps: [
    waitFor(/Ask anything[\s\S]*Build ·/, { name: "composer" }),
    type("Reply with the word PONG only.\r"),
    waitFor(/Session failed/, { name: "error-shown" }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "turn-finished" }),
    settled,
    // the failure toast lasts 5 s (tui ui/toast.tsx v2.0.32 L160); the
    // settled screen is captured while it is up
    checkpoint("turn-error", waitFor(/Session failed/)),
  ],
});
