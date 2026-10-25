// The project's worktrees (worktrees.ts): listed, created under the sandbox
// user's data directory with `git worktree add --detach`, opened as a
// session's directory, and removed, as OpenCode's git strategy does (core
// worktree.ts v2.1.4 L204–L330; git.ts L1251–L1291).
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startBridge, waitFor, type BridgeHandle } from "./lib/bridge.ts";
import { validateBody } from "./lib/contract.ts";

let bridge: BridgeHandle;
let home: string;
beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "maki-oss-worktrees-home-"));
  bridge = await startBridge({ FAKE_SANDBOX_HOME: home });
  const git = (...args: string[]) => Bun.spawnSync(["git", "-C", bridge.workdir, ...args], { env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  git("init", "-q", "-b", "main");
  git("commit", "-q", "--allow-empty", "-m", "init");
});
afterAll(async () => {
  await bridge?.stop();
  rmSync(home, { recursive: true, force: true });
});

const call = (method: string, path: string, body?: unknown) =>
  fetch(bridge.base + path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

test("worktrees are listed, created, opened and removed in the sandbox", async () => {
  const project = (await (await call("GET", "/api/project")).json())[0];
  const list = async () => {
    const res = await call("GET", `/api/worktree?projectID=${project.id}`);
    const body = await res.json();
    expect(validateBody("/api/worktree", "GET", res.status, body)).toBeNull();
    return body as { directory: string; strategy?: string }[];
  };
  expect(await list()).toEqual([{ directory: bridge.workdir }]);

  const created = await call("POST", "/api/worktree", { projectID: project.id, name: "feature-x" });
  const info = await created.json();
  expect(validateBody("/api/worktree", "POST", created.status, info)).toBeNull();
  expect(info.directory).toMatch(new RegExp(`/opencode/worktree/${project.id.slice(0, 6)}/feature-x$`));
  expect(info.directory.startsWith(realpathSync(home))).toBe(true);
  expect(await waitFor(() => bridge.frames.some((f) => f.type === "worktree.updated"))).toBe(true);
  expect((await list()).map((w) => [w.directory, w.strategy])).toEqual([[info.directory, "git"], [bridge.workdir, undefined]]);
  // a second worktree of the same name is suffixed
  const again = await (await call("POST", "/api/worktree", { projectID: project.id, name: "feature-x" })).json();
  expect(again.directory).toBe(`${info.directory}-2`);

  // a session opens in the worktree; a host directory still maps to the workdir
  const inWorktree = (await (await call("POST", "/api/session", { location: { directory: info.directory } })).json()).data;
  expect(inWorktree.location).toEqual({ directory: info.directory });
  const elsewhere = (await (await call("POST", "/api/session", { location: { directory: "/host/elsewhere" } })).json()).data;
  expect(elsewhere.location).toEqual({ directory: bridge.workdir });
  // and a session can move into it
  expect((await call("POST", `/api/session/${elsewhere.id}/move`, { directory: again.directory })).status).toBe(204);

  expect((await call("DELETE", "/api/worktree", { projectID: project.id, directory: info.directory, force: true })).status).toBe(204);
  expect((await list()).map((w) => w.directory)).not.toContain(info.directory);
  const refresh = await call("POST", "/api/worktree/refresh", { projectID: project.id });
  expect(refresh.status).toBe(204);
  expect((await call("GET", "/api/worktree?projectID=prj_nope")).status).toBe(404);
  const bad = await call("POST", "/api/worktree", { projectID: project.id, name: "../escape" });
  expect(bad.status).toBe(400);
  expect((await bad.json())._tag).toBe("WorktreeError");
}, 60_000);
