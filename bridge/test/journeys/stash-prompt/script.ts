import { checkpoint, journey, type, waitFor } from "../harness/journey.ts";

const settled = waitFor(/^[\s\S]*$/, { idleMs: 1500, name: "settled" });
const palette = (command: string, n: number) => [
  type("\x10"),
  waitFor(/Commands/, { name: `palette-${n}` }),
  type(command),
  settled,
  type("\r"),
  waitFor(/^(?![\s\S]*Commands)/, { name: `palette-closed-${n}` }),
  settled,
];

export default journey("stash-prompt", {
  turns: [],
  steps: [
    waitFor(/Ask anything[\s\S]*Build ·/, { name: "composer" }),
    type("Draft prompt to keep for later"),
    waitFor(/Draft prompt to keep for later/, { name: "typed" }),
    ...palette("Stash prompt", 1),
    checkpoint("stashed", waitFor(/Ask anything/)),
    ...palette("Stash pop", 2),
    checkpoint("popped", waitFor(/Draft prompt to keep for later/)),
  ],
});
