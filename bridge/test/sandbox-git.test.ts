// Offline coverage for the sandbox checkout's git state (add-sandbox-git-state):
// the footer branch (`GET /api/vcs`) and the project identity
// (`GET /api/project`, `GET /api/location`, `session.projectID`) come from the
// sandbox workdir over the exec transport, not from synthesized `sample`
// values. The scripted openshell runs each read in a temp clone standing in
// for the workdir.
import { afterAll, beforeAll, describe, expect, test, setDefaultTimeout } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { startBridge, type BridgeHandle } from "./lib/bridge.ts";
import { validateBody } from "./lib/contract.ts";

// tests here boot their own bridges; the default 5s budget is too tight on a
// loaded host
setDefaultTimeout(20_000);

const git = (cwd: string, ...args: string[]) => {
  const p = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", ...args], { cwd });
  if (p.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${p.stderr.toString()}`);
  return p.stdout.toString().trim();
};

async function get(bridge: BridgeHandle, path: string): Promise<any> {
  const res = await fetch(bridge.base + path);
  const body = await res.json();
  expect(validateBody(path.split("?")[0]!, "GET", res.status, body)).toBeNull();
  return body;
}

describe("sandbox checkout git state", () => {
  let bridge: BridgeHandle;
  let tmp: string;
  let workdir: string;
  let root: string;
  let loc: string;

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), "sandbox-git-"));
    const upstream = join(tmp, "upstream");
    workdir = join(tmp, "project");
    Bun.spawnSync(["mkdir", "-p", upstream]);
    git(upstream, "init", "-q");
    writeFileSync(join(upstream, "a.txt"), "a");
    git(upstream, "add", ".");
    git(upstream, "commit", "-qm", "root");
    git(tmp, "clone", "-q", upstream, workdir);
    git(workdir, "checkout", "-qb", "feature/route-queue");
    root = git(workdir, "rev-list", "--max-parents=0", "HEAD");
    bridge = await startBridge({ OPENMAKI_CWD: workdir });
    loc = `?location%5Bdirectory%5D=${encodeURIComponent(workdir)}`;
  });

  afterAll(async () => {
    await bridge?.stop();
    rmSync(tmp, { recursive: true, force: true });
  });

  test("vcs reports the checked-out and default branch", async () => {
    const body = await get(bridge, `/api/vcs${loc}`);
    expect(body.data).toEqual({ provider: "git", branch: { current: "feature/route-queue", default: "main" } });
  });

  test("a branch switch in the sandbox shows on the next read", async () => {
    git(workdir, "checkout", "-q", "main");
    try {
      const body = await get(bridge, `/api/vcs${loc}`);
      expect(body.data.branch.current).toBe("main");
    } finally {
      git(workdir, "checkout", "-q", "feature/route-queue");
    }
  });

  test("project, location and sessions name the root commit as the project", async () => {
    const projects = await get(bridge, "/api/project");
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({ id: root, canonical: workdir, name: basename(workdir), vcs: "git", sandboxes: [] });
    expect(projects[0].time.active).toBeGreaterThanOrEqual(projects[0].time.created);

    const location = await get(bridge, `/api/location${loc}`);
    expect(location.project.id).toBe(root);

    const created = await fetch(`${bridge.base}/api/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ location: { directory: workdir } }),
    });
    const session = (await created.json()).data;
    expect(session.projectID).toBe(root);
    expect((await get(bridge, `/api/session/${session.id}`)).data.projectID).toBe(root);
  });

  test("a workdir that is not a repository is the global project with no branch", async () => {
    const plain = mkdtempSync(join(tmp, "plain-"));
    const bare = await startBridge({ OPENMAKI_CWD: plain });
    try {
      const vcs = await get(bare, `/api/vcs?location%5Bdirectory%5D=${encodeURIComponent(plain)}`);
      expect(vcs.data).toEqual({ branch: {} });
      const [project] = await get(bare, "/api/project");
      expect(project.id).toBe("global");
      expect(project.vcs).toBeUndefined();
    } finally {
      await bare.stop();
    }
  });
});
