// The prompt's @-autocomplete search (fs-find.ts): the bridge ranks the
// sandbox workdir's files, read over the exec transport, never the host
// directory the client names.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { find } from "../src/fs-find.ts";
import { startBridge, type BridgeHandle } from "./lib/bridge.ts";
import { validateBody } from "./lib/contract.ts";

setDefaultTimeout(20_000);

test("fuzzy matches rank by match, then the shorter path; directories end in a slash", () => {
  const files = ["notes.txt", "docs/notes/old.md", "src/main.ts", "nested/deep/notes.txt"];
  expect(find(files, { query: "note" }).map((e) => e.path)).toEqual(["notes.txt", "docs/notes/", "docs/notes/old.md", "nested/deep/notes.txt"]);
  expect(find(files, { query: "note", type: "file", limit: 1 })).toEqual([{ path: "notes.txt", type: "file" }]);
  expect(find(files, { query: "src", type: "directory" })).toEqual([{ path: "src/", type: "directory" }]);
  expect(find(files, { query: "zzz" })).toEqual([]);
});

let bridge: BridgeHandle;
let sandbox: string;
let host: string;
let trace: string;
beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), "fs-find-sandbox-"));
  host = mkdtempSync(join(tmpdir(), "fs-find-host-"));
  trace = `${sandbox}.trace`;
  mkdirSync(join(sandbox, "src"));
  writeFileSync(join(sandbox, "notes.txt"), "");
  writeFileSync(join(sandbox, "src", "main.ts"), "");
  writeFileSync(join(host, "host-notes.txt"), "");
  bridge = await startBridge({ OPENMAKI_CWD: sandbox, FAKE_OPENSHELL_TRACE: trace });
});
afterAll(async () => {
  await bridge?.stop();
  for (const d of [sandbox, host]) rmSync(d, { recursive: true, force: true });
  rmSync(trace, { force: true });
});

test("the search answers from the sandbox workdir", async () => {
  const q = new URLSearchParams({ "location[directory]": host, query: "note", limit: "10" });
  const res = await fetch(`${bridge.base}/api/fs/find?${q}`);
  const body = await res.json();
  expect(validateBody("/api/fs/find", "GET", res.status, body)).toBeNull();
  expect(body.location.directory).toBe(host);
  expect(body.data).toEqual([{ path: "notes.txt", type: "file" }]);
  const calls = readFileSync(trace, "utf8").trim().split("\n").map((l) => JSON.parse(l) as string[]);
  for (const argv of calls) {
    expect(argv[6]).toBe(sandbox);
    expect(argv.filter((a) => a.startsWith("--env"))).toEqual([]);
    expect(argv.some((a) => a.includes(host))).toBe(false);
  }
});
