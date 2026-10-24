import { checkpoint, journey, type, waitFor } from "../harness/journey.ts";

const settled = waitFor(/^[\s\S]*$/, { idleMs: 1500, name: "settled" });
// a worktree needs a commit to branch from
const COMMIT = "git init -q -b main && git -c user.name=journey -c user.email=journey@example.invalid commit -q --allow-empty -m init";

export default journey("manage-workspaces", {
  turns: [
    { tool: { command: COMMIT, needsPermission: true } },
    { text: "COMMITTED", stream: ["COMMIT", "TED"] },
  ],
  steps: [
    waitFor(/Ask anything[\s\S]*Build ·/, { name: "composer" }),
    type(`Use your shell tool to run exactly: ${COMMIT} . Then reply with the single word COMMITTED.\r`),
    waitFor(/Permission required/, { name: "permission" }),
    type("\r"),
    waitFor(/^\s*COMMITTED\s*$/m, { idleMs: 100 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "turn-finished" }),
    settled,
    type("/worktrees"),
    settled,
    type("\r"),
    settled,
    checkpoint("worktrees", waitFor(/Worktrees/)),
    type("\x01"),
    waitFor(/Name worktree/, { name: "name-dialog" }),
    settled,
    checkpoint("new-worktree", waitFor(/Name worktree/)),
    type("feature-x\r"),
    settled,
    checkpoint("created", waitFor(/[\s\S]*/)),
  ],
});
