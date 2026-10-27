// Git work for a large repository (fix-audit-findings 4.3): the review's git
// commands run in bounded execs, in order, and patch generation stops once the
// total patch budget is reached instead of building a patch for every file.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chunkCommands, MAX_BATCH_BYTES, MAX_BATCH_COMMANDS, MAX_PATCH_COMMANDS } from "../src/vcs.ts";
import { startBridge, type BridgeHandle } from "./lib/bridge.ts";
import { validateBody } from "./lib/contract.ts";

setDefaultTimeout(120_000);

test("a command list is split in order into groups bounded by count and script bytes", () => {
  const cmds = Array.from({ length: 1000 }, (_, i) => ["diff", "--no-index", "--numstat", "--", "/dev/null", `file-${i}.txt`]);
  const groups = chunkCommands(cmds);
  expect(groups.length).toBeGreaterThan(1);
  expect(groups.flat()).toEqual(cmds);
  for (const g of groups) expect(g.length).toBeLessThanOrEqual(MAX_BATCH_COMMANDS);
  expect(chunkCommands(cmds, MAX_PATCH_COMMANDS).every((g) => g.length <= MAX_PATCH_COMMANDS)).toBe(true);
  // few long arguments fill a group by bytes before they reach the count
  const long = Array.from({ length: 10 }, (_, i) => ["diff", "--", `${i}-${"n".repeat(20_000)}`]);
  const byBytes = chunkCommands(long);
  expect(byBytes.length).toBeGreaterThan(1);
  expect(byBytes.flat()).toEqual(long);
  // one command over the byte bound still runs, alone
  const huge = [["diff", "x".repeat(MAX_BATCH_BYTES * 2)]];
  expect(chunkCommands([["a"], ...huge, ["b"]]).map((g) => g.length)).toEqual([1, 1, 1]);
  expect(chunkCommands([])).toEqual([]);
});

let bridge: BridgeHandle;
let trace: string;
const FILES = 1000;
const BIG = 3; // a-big-N.txt, each over a third of the total patch budget
beforeAll(async () => {
  trace = join(mkdtempSync(join(tmpdir(), "vcs-large-trace-")), "openshell.jsonl");
  bridge = await startBridge({ FAKE_OPENSHELL_TRACE: trace });
  const run = (...args: string[]) => {
    const r = Bun.spawnSync(["git", "-c", "init.defaultBranch=main", ...args], { cwd: bridge.workdir });
    if (r.exitCode !== 0) throw new Error(r.stderr.toString());
  };
  run("init", "-q");
  // the test bridge logs its requests into the workdir
  writeFileSync(join(bridge.workdir, ".gitignore"), "requests.jsonl\n");
  const line = `${"x".repeat(79)}\n`;
  for (let i = 1; i <= BIG; i++) writeFileSync(join(bridge.workdir, `a-big-${i}.txt`), line.repeat(52_000));
  for (let i = 0; i < FILES - BIG; i++) writeFileSync(join(bridge.workdir, `f-${String(i).padStart(4, "0")}.txt`), `small ${i}\n`);
});
afterAll(async () => {
  await bridge?.stop();
  rmSync(join(trace, ".."), { recursive: true, force: true });
});

/** the git scripts the bridge ran in the sandbox, one per exec */
const gitExecs = () =>
  readFileSync(trace, "utf8").trim().split("\n").map((l) => JSON.parse(l) as string[])
    .map((argv) => argv[argv.indexOf("--") + 1] === "sh" ? argv.at(-1)! : "")
    .filter((script) => script.includes("--no-optional-locks"));
const commandsIn = (script: string) => script.split("\n").length;

const get = async (path: string) => {
  const res = await fetch(bridge.base + path);
  const body = await res.json();
  expect(validateBody(path.split("?")[0]!, "GET", res.status, body)).toBeNull();
  return { status: res.status, body };
};

test("a thousand untracked files answer status through several bounded execs", async () => {
  rmSync(trace, { force: true });
  const { status, body } = await get("/api/vcs/status");
  expect(status).toBe(200);
  // every file (the thousand and the .gitignore) has a status and its counts
  expect(body.data).toHaveLength(FILES + 1);
  expect(body.data.every((f: any) => f.status === "added")).toBe(true);
  expect(body.data.find((f: any) => f.file === "f-0042.txt")).toEqual({ file: "f-0042.txt", additions: 1, deletions: 0, status: "added" });
  expect(body.data.find((f: any) => f.file === "a-big-1.txt").additions).toBe(52_000);
  const execs = gitExecs();
  expect(execs.filter((s) => s.includes("--numstat")).length).toBeGreaterThan(1);
  for (const script of execs) {
    expect(Buffer.byteLength(script)).toBeLessThanOrEqual(MAX_BATCH_BYTES);
    expect(commandsIn(script)).toBeLessThanOrEqual(MAX_BATCH_COMMANDS);
  }
});

test("patches stop at the total budget: the later files are capped and their diffs never run", async () => {
  rmSync(trace, { force: true });
  const { status, body } = await get("/api/vcs/diff?mode=working");
  expect(status).toBe(200);
  expect(body.data).toHaveLength(FILES + 1);
  const hasPatch = (file: string) => body.data.find((d: any) => d.file === file).patch.includes("\n@@");
  expect(hasPatch("a-big-1.txt")).toBe(true);
  expect(hasPatch("a-big-2.txt")).toBe(true);
  // the third big patch would pass the budget; it and everything after are placeholders
  for (const file of ["a-big-3.txt", "f-0000.txt", "f-0500.txt", "f-0996.txt"]) expect(hasPatch(file)).toBe(false);
  // statuses and counts are still reported for them
  expect(body.data.find((d: any) => d.file === "f-0996.txt")).toMatchObject({ additions: 1, status: "added" });
  // only the first group of patch commands ran
  const patchExecs = gitExecs().filter((s) => s.includes("--patch"));
  expect(patchExecs).toHaveLength(1);
  expect(commandsIn(patchExecs[0]!)).toBeLessThanOrEqual(MAX_PATCH_COMMANDS);
  expect(patchExecs.some((s) => s.includes("f-0500.txt") || s.includes("f-0996.txt"))).toBe(false);
});
