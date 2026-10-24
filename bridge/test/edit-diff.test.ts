// A Maki edit's diff for the TUI (edit-diff.ts): the replacement undone from
// the edited file, as a jsdiff-shaped unified patch.
import { expect, test } from "bun:test";
import { fileDiff, undoEdit } from "../src/edit-diff.ts";

test("one located replacement is undone; an ambiguous one is not", () => {
  expect(undoEdit("beta\n", { old_string: "alpha", new_string: "beta" })).toBe("alpha\n");
  expect(undoEdit("beta beta\n", { old_string: "alpha", new_string: "beta" })).toBeUndefined();
  expect(undoEdit("x\n", { old_string: "alpha", new_string: "" })).toBeUndefined();
  expect(undoEdit("x\n", { old_string: "alpha" })).toBeUndefined();
});

test("the patch matches createTwoFilesPatch for a contiguous change", () => {
  expect(fileDiff("notes.txt", "alpha\n", "beta\n")).toEqual({
    file: "notes.txt",
    status: "modified",
    additions: 1,
    deletions: 1,
    patch: "Index: notes.txt\n===================================================================\n--- notes.txt\n+++ notes.txt\n@@ -1,1 +1,1 @@\n-alpha\n+beta\n",
  });
  const before = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].join("\n") + "\n";
  const after = before.replace("f\n", "F\nF2\n");
  const d = fileDiff("x", before, after);
  expect(d.patch.split("\n").slice(4)).toEqual(["@@ -2,9 +2,10 @@", " b", " c", " d", " e", "-f", "+F", "+F2", " g", " h", " i", " j", ""]);
  expect([d.additions, d.deletions]).toEqual([2, 1]);
});

// over the spawned bridge: the scripted child edits a workdir file, and the
// success frame carries the diff the TUI renders
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { startBridge, waitFor } from "./lib/bridge.ts";
import { validateBody } from "./lib/contract.ts";

test("an edit's success reports the file diff; an ambiguous one reports none", async () => {
  const bridge = await startBridge({
    FAKE_MAKI_SCRIPT: JSON.stringify([
      { call: { opencode: { name: "edit", input: {} }, maki: { name: "edit", input: { path: "notes.txt", old_string: "alpha", new_string: "beta" }, result: "edited notes.txt" } } },
      { call: { opencode: { name: "edit", input: {} }, maki: { name: "edit", input: { path: "twice.txt", old_string: "x", new_string: "y", replace_all: true }, result: "edited twice.txt" } } },
      { text: "EDITED" },
    ]),
  });
  try {
    writeFileSync(join(bridge.workdir, "notes.txt"), "alpha\n");
    writeFileSync(join(bridge.workdir, "twice.txt"), "x x\n");
    const post = (path: string, body: unknown) => fetch(bridge.base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const sid = (await (await post("/api/session", { location: { directory: bridge.workdir } })).json()).data.id;
    await post(`/api/session/${sid}/prompt`, { text: "edit" });
    expect(await waitFor(() => bridge.frames.some((f) => f.type === "session.execution.succeeded" && f.data?.sessionID === sid), 15_000)).toBe(true);
    const successes = bridge.frames.filter((f) => f.type === "session.tool.success" && f.data?.sessionID === sid);
    expect(successes[0]!.data!.metadata).toEqual({
      files: [{ file: "notes.txt", status: "modified", additions: 1, deletions: 1, patch: "Index: notes.txt\n===================================================================\n--- notes.txt\n+++ notes.txt\n@@ -1,1 +1,1 @@\n-alpha\n+beta\n" }],
    });
    expect(successes[1]!.data!.metadata).toBeUndefined();
    const path = `/api/session/${sid}/message`;
    const history = await (await fetch(`${bridge.base}${path}`)).json();
    expect(validateBody(path, "GET", 200, history)).toBeNull();
  } finally {
    await bridge.stop();
  }
}, 60_000);
