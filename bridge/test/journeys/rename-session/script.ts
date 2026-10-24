import { checkpoint, journey, type, waitFor } from "../harness/journey.ts";

const settled = waitFor(/^[\s\S]*$/, { idleMs: 1500, name: "settled" });

export default journey("rename-session", {
  turns: [{ text: "PONG", stream: ["PO", "NG"] }],
  steps: [
    waitFor(/Ask anything[\s\S]*Build ·/, { name: "composer" }),
    type("Reply with the word PONG only.\r"),
    waitFor(/^\s*PONG\s*$/m, { idleMs: 100 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "turn-finished" }),
    settled,
    type("\x12"),
    checkpoint("rename-dialog", waitFor(/Rename [Ss]ession/)),
    type("\x15Renamed by journey\r"),
    waitFor(/Renamed by journey/, { name: "renamed-title" }),
    settled,
    checkpoint("renamed", waitFor(/Renamed by journey/)),
  ],
});
