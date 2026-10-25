// Review diffs of the sandbox checkout (add-vcs-review): vcs.diff, vcs.base
// and vcs.status follow OpenCode's git provider (core plugin/vcs/git.ts
// v2.1.4) over the exec transport; a repository created mid-run is picked up
// by the next project read.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { startBridge, type BridgeHandle } from "./lib/bridge.ts";
import { validateBody } from "./lib/contract.ts";

let bridge: BridgeHandle;
beforeAll(async () => {
  bridge = await startBridge();
});
afterAll(async () => {
  await bridge?.stop();
});

const git = (...args: string[]) => {
  const r = Bun.spawnSync(["git", "-c", "user.email=t@example.invalid", "-c", "user.name=t", "-c", "init.defaultBranch=main", ...args], { cwd: bridge.workdir });
  if (r.exitCode !== 0) throw new Error(r.stderr.toString());
};
const get = async (path: string) => {
  const res = await fetch(bridge.base + path);
  const body = await res.json();
  expect(validateBody(path.split("?")[0]!, "GET", res.status, body)).toBeNull();
  return { status: res.status, body };
};

test("a repository made mid-run is reviewed against main, untracked files included", async () => {
  expect((await get("/api/vcs/base")).body.data).toBeNull();
  git("init", "-q");
  writeFileSync(join(bridge.workdir, "notes.txt"), "alpha\n");
  // the test bridge logs its requests into the workdir
  writeFileSync(join(bridge.workdir, ".gitignore"), "requests.jsonl\n");
  git("add", "notes.txt", ".gitignore");
  git("commit", "-qm", "init");
  writeFileSync(join(bridge.workdir, "notes.txt"), "alpha\nbeta\n");
  writeFileSync(join(bridge.workdir, "added.txt"), "new\n");

  const projects = (await (await fetch(`${bridge.base}/api/project`)).json()) as any[];
  expect(projects[0].vcs).toBe("git");
  expect((await get("/api/vcs/base")).body.data).toEqual({ name: "main", ref: "refs/heads/main", source: "default" });

  const diff = (await get("/api/vcs/diff?mode=branch")).body.data;
  expect(diff.map((d: any) => [d.file, d.status, d.additions, d.deletions])).toEqual([
    ["added.txt", "added", 1, 0],
    ["notes.txt", "modified", 1, 0],
  ]);
  // whole-file context by default: the unchanged line stays in the hunk
  expect(diff[1].patch).toContain(" alpha\n+beta\n");
  expect(diff[0].patch).toContain("+new\n");

  const working = (await get("/api/vcs/diff?mode=working&context=0")).body.data;
  expect(working.find((d: any) => d.file === "notes.txt").patch).not.toContain("\n alpha\n");
  expect((await get("/api/vcs/diff?mode=committed")).body.data).toEqual([]);
  expect((await get("/api/vcs/status")).body.data).toEqual([
    { file: "added.txt", additions: 1, deletions: 0, status: "added" },
    { file: "notes.txt", additions: 1, deletions: 0, status: "modified" },
  ]);
  expect((await fetch(`${bridge.base}/api/vcs/diff`)).status).toBe(400);
  const missing = await get("/api/vcs/diff?mode=branch&base=nope");
  expect(missing.status).toBe(503);
});
