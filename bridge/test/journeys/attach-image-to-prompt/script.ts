import { fileURLToPath } from "node:url";
import { checkpoint, journey, type, waitFor } from "../harness/journey.ts";

const settled = waitFor(/^[\s\S]*$/, { idleMs: 1500, name: "settled" });
// a 4x4 PNG in the journey directory; the TUI reads a pasted path itself
const IMAGE = fileURLToPath(new URL("./marker.png", import.meta.url));

export default journey("attach-image-to-prompt", {
  turns: [{ text: "SEEN", stream: ["SE", "EN"] }],
  steps: [
    waitFor(/Ask anything[\s\S]*Build ·/, { name: "composer" }),
    type("Describe this image in one word. "),
    type(`\x1b[200~${IMAGE}\x1b[201~`),
    settled,
    checkpoint("attached", waitFor(/Image|marker\.png/)),
    type("\r"),
    waitFor(/^\s*SEEN\s*$/m, { idleMs: 100 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "turn-finished" }),
    settled,
    checkpoint("sent", waitFor(/^\s*SEEN\s*$/m)),
  ],
});
