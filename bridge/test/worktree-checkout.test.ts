// Session-scoped reads in a worktree (fix-audit-findings 3.1, 3.2): the file
// list and search, prompt mentions, edit-result diffs and VCS review answer
// from the checkout the client names — the main checkout or one of its linked
// worktrees — never from the main checkout alone. The worktree is a real
// `git worktree add` in the scripted sandbox, with files that differ from the
// main checkout's so a read of the wrong one shows in the answer.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { startBridge, waitFor, type BridgeHandle } from "./lib/bridge.ts";
import { validateBody } from "./lib/contract.ts";

setDefaultTimeout(60_000);

const HOST = "/host/projects/demo";

interface Fixture {
  bridge: BridgeHandle;
  /** the main checkout's sandbox directory (the bridge's canonical workdir) */
  main: string;
  /** the linked worktree's sandbox directory */
  wt: string;
  home: string;
  stop: () => Promise<void>;
}

const post = (b: BridgeHandle, path: string, body: unknown) =>
  fetch(b.base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** a bridge over a repository whose main checkout and worktree differ; `env`
 * may depend on the main checkout's path */
async function fixture(env: (main: string) => Record<string, string> = () => ({})): Promise<Fixture> {
  const home = mkdtempSync(join(tmpdir(), "maki-oss-wt-checkout-home-"));
  const main = mkdtempSync(join(tmpdir(), "maki-oss-wt-checkout-main-"));
  const bridge = await startBridge({ OPENMAKI_CWD: main, FAKE_SANDBOX_HOME: home, ...env(main) });
  const git = (cwd: string, ...args: string[]) => {
    const r = Bun.spawnSync(["git", "-c", "user.email=t@example.invalid", "-c", "user.name=t", "-c", "init.defaultBranch=main", ...args], { cwd });
    if (r.exitCode !== 0) throw new Error(r.stderr.toString());
  };
  git(main, "init", "-q");
  writeFileSync(join(main, "shared.txt"), "main shared\n");
  writeFileSync(join(main, "edit-me.txt"), "alpha\n");
  git(main, "add", ".");
  git(main, "commit", "-qm", "init");
  const project = ((await (await fetch(`${bridge.base}/api/project`)).json()) as any[])[0];
  const created = await (await post(bridge, "/api/worktree", { projectID: project.id, name: "feature" })).json();
  const wt = created.directory as string;
  expect(wt).toBeTruthy();
  // uncommitted state that differs between the two checkouts
  writeFileSync(join(main, "main-only.txt"), "only in main\n");
  writeFileSync(join(wt, "wt-only.txt"), "only in worktree\n");
  writeFileSync(join(wt, "shared.txt"), "worktree shared\n");
  return {
    bridge, main, wt, home,
    stop: async () => {
      await bridge.stop();
      for (const dir of [home, main]) rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe("listing, search and VCS review", () => {
  let fx: Fixture;
  beforeAll(async () => {
    fx = await fixture();
  });
  afterAll(async () => {
    await fx?.stop();
  });

  const get = async (route: string, params: Record<string, string>) => {
    const res = await fetch(`${fx.bridge.base}${route}?${new URLSearchParams(params)}`);
    const body = await res.json();
    expect(validateBody(route, "GET", res.status, body)).toBeNull();
    return { status: res.status, body };
  };
  const names = (body: any) => body.data.map((e: any) => e.path ?? e.file).sort();

  test("a worktree lists its own files and not the main checkout's", async () => {
    const { body } = await get("/api/fs/list", { "location[directory]": fx.wt });
    expect(body.location.directory).toBe(fx.wt);
    expect(names(body)).toContain("wt-only.txt");
    expect(names(body)).not.toContain("main-only.txt");
  });

  test("a subpath under a worktree is read in the worktree; a path outside it lists nothing", async () => {
    const { body } = await get("/api/fs/list", { "location[directory]": fx.wt, path: "." });
    expect(names(body)).toContain("wt-only.txt");
    for (const path of ["/etc", "../..", fx.main]) {
      expect((await get("/api/fs/list", { "location[directory]": fx.wt, path })).body.data).toEqual([]);
    }
  });

  test("a host directory and the main checkout still list the main checkout", async () => {
    for (const directory of [HOST, fx.main]) {
      const { body } = await get("/api/fs/list", { "location[directory]": directory });
      expect(body.location.directory).toBe(directory);
      expect(names(body)).toContain("main-only.txt");
      expect(names(body)).not.toContain("wt-only.txt");
    }
  });

  test("a worktree search finds its own files and not the main checkout's", async () => {
    const wt = await get("/api/fs/find", { "location[directory]": fx.wt, query: "only" });
    expect(wt.body.location.directory).toBe(fx.wt);
    expect(names(wt.body)).toEqual(["wt-only.txt"]);
    for (const directory of [HOST, fx.main]) {
      expect(names((await get("/api/fs/find", { "location[directory]": directory, query: "only" })).body)).toEqual(["main-only.txt"]);
    }
  });

  test("a worktree's VCS status and diff review the worktree", async () => {
    const status = await get("/api/vcs/status", { "location[directory]": fx.wt });
    expect(names(status.body)).toEqual(["shared.txt", "wt-only.txt"]);
    const diff = await get("/api/vcs/diff", { "location[directory]": fx.wt, mode: "working" });
    expect(names(diff.body)).toEqual(["shared.txt", "wt-only.txt"]);
    expect(diff.body.data.find((d: any) => d.file === "shared.txt").patch).toContain("+worktree shared\n");
    // the main checkout's change is its own
    for (const directory of [HOST, fx.main]) {
      expect(names((await get("/api/vcs/status", { "location[directory]": directory })).body)).toEqual(["main-only.txt"]);
    }
    expect(names((await get("/api/vcs/status", {})).body)).toEqual(["main-only.txt"]);
  });
});

describe("prompt mentions", () => {
  let fx: Fixture;
  const trace = join(tmpdir(), `maki-oss-wt-checkout-trace-${process.pid}.jsonl`);
  beforeAll(async () => {
    rmSync(trace, { force: true });
    fx = await fixture(() => ({ FAKE_MAKI_TRACE: trace }));
  });
  afterAll(async () => {
    await fx?.stop();
    rmSync(trace, { force: true });
  });

  const userFrames = () =>
    existsSync(trace)
      ? readFileSync(trace, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((f) => f.type === "user" && f.dir !== "out")
      : [];

  async function mention(directory: string | undefined, clientDir: string, file: string, text: string): Promise<string> {
    const sid = (await (await post(fx.bridge, "/api/session", directory ? { location: { directory } } : {})).json()).data.id;
    const query = new URLSearchParams({ "location[directory]": clientDir });
    const res = await post(fx.bridge, `/api/session/${sid}/prompt?${query}`, { text, files: [{ uri: pathToFileURL(file).href, name: "shared.txt" }], delivery: "steer" });
    expect(res.status).toBe(200);
    expect(await waitFor(() => userFrames().some((f) => f.message.content[0].text === text), 15_000)).toBe(true);
    return JSON.stringify(userFrames().find((f) => f.message.content[0].text === text).message.content);
  }

  test("a worktree file is read from the worktree, not the main file at the same relative path", async () => {
    const sent = await mention(fx.wt, fx.wt, join(fx.wt, "shared.txt"), "read the worktree one");
    expect(sent).toContain("worktree shared");
    expect(sent).not.toContain("main shared");
  });

  test("a host path still maps to the main checkout", async () => {
    const sent = await mention(undefined, HOST, join(HOST, "shared.txt"), "read the main one");
    expect(sent).toContain("main shared");
    expect(sent).not.toContain("worktree shared");
  });
});

describe("edit-result diffs", () => {
  let fx: Fixture;
  beforeAll(async () => {
    const edit = (input: Record<string, unknown>) => ({ call: { opencode: { name: "edit", input: {} }, maki: { name: "edit", input, result: "edited" } } });
    fx = await fixture((main) => ({
      FAKE_MAKI_SCRIPT: JSON.stringify([
        edit({ path: "edit-me.txt", old_string: "alpha", new_string: "beta" }),
        edit({ path: join(main, "main-only.txt"), old_string: "only in main", new_string: "edited in main" }),
        { text: "EDITED" },
      ]),
    }));
  });
  afterAll(async () => {
    await fx?.stop();
  });

  test("a relative edit path joins the worktree session's directory; an absolute one stays absolute", async () => {
    const sid = (await (await post(fx.bridge, "/api/session", { location: { directory: fx.wt } })).json()).data.id;
    await post(fx.bridge, `/api/session/${sid}/prompt`, { text: "edit" });
    expect(await waitFor(() => fx.bridge.frames.some((f) => f.type === "session.execution.succeeded" && f.data?.sessionID === sid), 20_000)).toBe(true);
    // the main checkout's copy is not the one edited, so reading it would find no edit to undo
    expect(readFileSync(join(fx.main, "edit-me.txt"), "utf8")).toBe("alpha\n");
    expect(readFileSync(join(fx.wt, "edit-me.txt"), "utf8")).toBe("beta\n");
    const [relative, absolute] = fx.bridge.frames.filter((f) => f.type === "session.tool.success" && f.data?.sessionID === sid);
    expect(relative!.data!.metadata).toEqual({
      files: [{ file: "edit-me.txt", status: "modified", additions: 1, deletions: 1, patch: "Index: edit-me.txt\n===================================================================\n--- edit-me.txt\n+++ edit-me.txt\n@@ -1,1 +1,1 @@\n-alpha\n+beta\n" }],
    });
    // a path outside the session's checkout keeps its absolute name
    const file = join(fx.main, "main-only.txt");
    expect(absolute!.data!.metadata.files[0]).toMatchObject({ file, status: "modified", additions: 1, deletions: 1 });
  });
});
