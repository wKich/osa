import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultLogDir, fileTaskLog } from "../src/tasklog.ts";

test("one JSON line per event, in a file named by the task id", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "oskhs-log-")), "tasks");
  const log = fileTaskLog(dir);
  log("abc12345", "claimed", { state: "processing" });
  log("abc12345", "idle");
  const lines = readFileSync(join(dir, "abc12345.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  expect(lines.map((l) => l.event)).toEqual(["claimed", "idle"]);
  expect(lines[0]).toMatchObject({ state: "processing", ts: expect.any(String) });
  expect(() => log("../x", "claimed")).toThrow();
});

test("state dir follows XDG_STATE_HOME", () => {
  expect(defaultLogDir({ XDG_STATE_HOME: "/s" })).toBe("/s/oskhs/tasks");
  expect(defaultLogDir({ XDG_STATE_HOME: "" }).endsWith(".local/state/oskhs/tasks")).toBe(true);
});
