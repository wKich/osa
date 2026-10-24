import { checkpoint, journey, type, waitFor } from "../harness/journey.ts";

const settled = waitFor(/^[\s\S]*$/, { idleMs: 1500, name: "settled" });

export default journey("manage-plugins", {
  turns: [],
  steps: [
    waitFor(/Ask anything[\s\S]*Build ·/, { name: "composer" }),
    type("/plugins"),
    settled,
    type("\r"),
    settled,
    checkpoint("plugins", waitFor(/[Pp]lugin/)),
    type("\x01"),
    settled,
    checkpoint("internal", waitFor(/[Pp]lugin/)),
  ],
});
