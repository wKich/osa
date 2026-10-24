// Offline coverage for the skill list (add-skill-list): `GET /api/skill`
// lists what Maki's skill plugin would discover in the sandbox — the config
// dir, the home dirs, then the workdir and its ancestors up to the git root —
// with a later skill of the same name replacing an earlier one and empty
// skills skipped. The scripted openshell runs the scan with FAKE_SANDBOX_HOME
// as the sandbox user's home.
import { afterAll, beforeAll, describe, expect, test, setDefaultTimeout } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUILTIN_SKILL } from "../src/sandbox.ts";
import { startBridge, waitFor, type BridgeHandle } from "./lib/bridge.ts";
import { validateBody } from "./lib/contract.ts";

// tests here boot their own bridges; the default 5s budget is too tight on a
// loaded host
setDefaultTimeout(20_000);

const skill = (dir: string, name: string, text: string) => {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(join(dir, name, "SKILL.md"), text);
  return join(dir, name, "SKILL.md");
};

describe("skill list", () => {
  let tmp: string;
  let home: string;
  let repo: string;
  let workdir: string;
  let bridge: BridgeHandle;
  const paths: Record<string, string> = {};

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), "skill-list-"));
    home = join(tmp, "home");
    repo = join(tmp, "repo");
    workdir = join(repo, "packages", "app");
    mkdirSync(join(repo, ".git"), { recursive: true });
    mkdirSync(workdir, { recursive: true });
    paths.config = skill(join(home, ".config", "maki", "skills"), "release", "---\nname: release\ndescription: global release steps\n---\nglobal body\n");
    paths.home = skill(join(home, ".claude", "skills"), "review", "---\nname: review\ndescription: 'code review'\n---\nreview body\n");
    // the repository root overrides the config dir's `release`
    paths.root = skill(join(repo, ".maki", "skills"), "release", "---\nname: release\ndescription: project release steps\n---\nproject body\n");
    // no frontmatter: the directory names it
    paths.plain = skill(join(workdir, ".agents", "skills"), "plain-notes", "just a body\n");
    // an empty body is skipped
    skill(join(workdir, ".claude", "skills"), "empty", "---\nname: empty\n---\n\n");
    // above the git root: never scanned
    skill(join(tmp, ".maki", "skills"), "outside", "---\nname: outside\n---\nbody\n");
    bridge = await startBridge({ OPENMAKI_CWD: workdir, FAKE_SANDBOX_HOME: home });
  });

  afterAll(async () => {
    await bridge?.stop();
    rmSync(tmp, { recursive: true, force: true });
  });

  test("lists the discovered skills with Maki's precedence", async () => {
    const res = await fetch(`${bridge.base}/api/skill?location%5Bdirectory%5D=${encodeURIComponent(workdir)}`);
    const body = await res.json();
    expect(validateBody("/api/skill", "GET", res.status, body)).toBeNull();
    expect(body.data).toEqual([
      BUILTIN_SKILL,
      { id: "plain-notes", name: "plain-notes", path: paths.plain, content: "just a body\n" },
      { id: "release", name: "release", description: "project release steps", path: paths.root, content: "project body\n" },
      { id: "review", name: "review", description: "code review", path: paths.home, content: "review body\n" },
    ]);
  });

  test("a skill a turn writes is announced with skill.updated", async () => {
    const sid = (await (await fetch(`${bridge.base}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ location: { directory: workdir } }) })).json()).data.id;
    await fetch(`${bridge.base}/api/skill`);
    skill(join(workdir, ".opencode", "skills"), "fresh", "---\nname: fresh\n---\nnew body\n");
    const before = bridge.frames.filter((f) => f.type === "skill.updated").length;
    await fetch(`${bridge.base}/api/session/${sid}/prompt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "hi" }) });
    expect(await waitFor(() => bridge.frames.filter((f) => f.type === "skill.updated").length > before, 15_000)).toBe(true);
    const frame = bridge.frames.filter((f) => f.type === "skill.updated").at(-1)!;
    expect(frame.location).toEqual({ directory: workdir });
    expect((await (await fetch(`${bridge.base}/api/skill`)).json()).data.map((k: any) => k.name)).toContain("fresh");
  });

  test("without a sandbox the list is empty", async () => {
    const none = await startBridge({ OPENMAKI_CWD: workdir, FAKE_SANDBOX_HOME: home, OPENMAKI_SANDBOX: "" });
    try {
      const body = await (await fetch(`${none.base}/api/skill`)).json();
      expect(body.data).toEqual([]);
    } finally {
      await none.stop();
    }
  });
});
