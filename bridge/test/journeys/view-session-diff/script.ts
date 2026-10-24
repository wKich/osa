import { checkpoint, journey, restart, type, waitFor } from "../harness/journey.ts";

const settled = waitFor(/^[\s\S]*$/, { idleMs: 1500, name: "settled" });
const INIT = "git init -q -b main && printf 'alpha\\n' > notes.txt && git add notes.txt && git -c user.email=journey@example.invalid -c user.name=journey commit -qm init";
const EDIT = "printf 'beta\\n' >> notes.txt";

export default journey("view-session-diff", {
  turns: [
    { tool: { command: INIT, needsPermission: true } },
    { text: "READY", stream: ["REA", "DY"] },
    { tool: { command: EDIT, needsPermission: true } },
    { text: "DONE", stream: ["DO", "NE"] },
  ],
  steps: [
    waitFor(/Ask anything[\s\S]*Build ·/, { name: "composer" }),
    type(`Use your shell tool to run exactly: ${INIT} . Then reply with the single word READY.\r`),
    waitFor(/Permission required/, { name: "init-permission" }),
    type("\r"),
    waitFor(/^\s*READY\s*$/m, { idleMs: 100 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "init-finished" }),
    restart(),
    waitFor(/Ask anything[\s\S]*Build ·/, { name: "reopened-composer" }),
    type(`Use your shell tool to run exactly: ${EDIT} . Then reply with the single word DONE.\r`),
    waitFor(/Permission required/, { name: "edit-permission" }),
    type("\r"),
    waitFor(/^\s*DONE\s*$/m, { idleMs: 100 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "edit-finished" }),
    settled,
    type("/diff"),
    waitFor(/\/diff/, { name: "typed" }),
    type("\r"),
    settled,
    checkpoint("diff-open", waitFor(/notes\.txt|No changes/)),
  ],
});
