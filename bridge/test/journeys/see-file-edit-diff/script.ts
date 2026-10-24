import { checkpoint, journey, type, waitFor } from "../harness/journey.ts";

const settled = waitFor(/^[\s\S]*$/, { idleMs: 1500, name: "settled" });
const MAKE = "printf 'alpha\\n' > notes.txt";

export default journey("see-file-edit-diff", {
  turns: [
    { tool: { command: MAKE, needsPermission: true } },
    { text: "MADE", stream: ["MA", "DE"] },
    {
      call: {
        opencode: { name: "edit", input: { path: "notes.txt", oldString: "alpha", newString: "beta" } },
        maki: { name: "edit", input: { path: "notes.txt", old_string: "alpha", new_string: "beta" }, result: "Edited notes.txt" },
      },
    },
    { text: "EDITED", stream: ["EDI", "TED"] },
  ],
  steps: [
    waitFor(/Ask anything[\s\S]*Build ·/, { name: "composer" }),
    type(`Use your shell tool to run exactly: ${MAKE} . Then reply with the single word MADE.\r`),
    waitFor(/Permission required/, { name: "permission" }),
    type("\r"),
    waitFor(/^\s*MADE\s*$/m, { idleMs: 100 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "turn-finished" }),
    settled,
    type("Replace alpha with beta in notes.txt, then reply EDITED.\r"),
    waitFor(/^\s*EDITED\s*$/m, { idleMs: 100, timeoutMs: 30_000 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "second-turn-finished" }),
    settled,
    checkpoint("diff", waitFor(/EDITED/)),
  ],
});
