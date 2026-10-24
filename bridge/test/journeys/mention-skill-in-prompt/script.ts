import { checkpoint, journey, type, waitFor } from "../harness/journey.ts";

const settled = waitFor(/^[\s\S]*$/, { idleMs: 1500, name: "settled" });
// a project skill both servers discover (.opencode/skills/<name>/SKILL.md)
const MAKE =
  "mkdir -p .opencode/skills/journey-greet && printf -- '---\\nname: journey-greet\\ndescription: Greets the journey.\\n---\\nSay hello.\\n' > .opencode/skills/journey-greet/SKILL.md";

export default journey("mention-skill-in-prompt", {
  turns: [
    { tool: { command: MAKE, needsPermission: true } },
    { text: "READY", stream: ["REA", "DY"] },
    { text: "HELLO", stream: ["HEL", "LO"] },
  ],
  steps: [
    waitFor(/Ask anything[\s\S]*Build ·/, { name: "composer" }),
    type(`Use your shell tool to run exactly: ${MAKE} . Then reply with the single word READY.\r`),
    waitFor(/Permission required/, { name: "permission" }),
    type("\r"),
    waitFor(/^\s*READY\s*$/m, { idleMs: 100 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "turn-finished" }),
    settled,
    type("/skills"),
    settled,
    type("\r"),
    waitFor(/journey-greet/, { name: "skill-dialog" }),
    settled,
    checkpoint("skill-list", waitFor(/journey-greet/)),
    type("journey-greet"),
    settled,
    type("\r"),
    settled,
    checkpoint("skill-mention", waitFor(/journey-greet/)),
    type("Use it.\r"),
    waitFor(/^\s*HELLO\s*$/m, { idleMs: 100 }),
    waitFor(/^(?![\s\S]*esc interrupt)/, { name: "second-turn-finished" }),
    settled,
    checkpoint("sent", waitFor(/^\s*HELLO\s*$/m)),
  ],
});
