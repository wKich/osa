import { describe, expect, test } from "bun:test";
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { planSync, syncRefs, type SyncSpec } from "../src/sync.ts";
import { runRound, type RoundSpec } from "../src/round.ts";
import { fixture, git, localSandbox } from "./local-sandbox.ts";

const m = (o: Record<string, string>) => new Map(Object.entries(o));

describe("planSync", () => {
  const host = m({ "refs/heads/main": "a2", "refs/heads/feature": "f1", "refs/heads/other": "o1", "refs/tags/v1": "t1" });
  test("only wanted refs whose tip differs", () => {
    const sb = m({ "refs/remotes/origin/main": "a1", "refs/remotes/origin/feature": "f1" });
    expect(planSync(host, sb, { branches: ["main", "feature"], allBranches: false })).toEqual({
      wanted: ["refs/heads/feature", "refs/heads/main"],
      changed: ["refs/heads/main"],
      prune: [],
      candidates: ["a1", "f1"],
    });
  });
  test("all-branches mode wants every branch and tag", () => {
    const p = planSync(host, m({}), { branches: ["main"], allBranches: true });
    expect(p.changed).toEqual(["refs/heads/feature", "refs/heads/main", "refs/heads/other", "refs/tags/v1"]);
  });
  test("deleted branches are pruned, unwanted ones kept", () => {
    const sb = m({ "refs/remotes/origin/main": "a2", "refs/remotes/origin/gone": "g1", "refs/remotes/origin/other": "o0", "refs/tags/old": "t0" });
    const p = planSync(host, sb, { branches: ["main"], allBranches: false });
    expect(p.prune).toEqual(["refs/remotes/origin/gone"]); // tags untouched outside all mode
    expect(p.changed).toEqual([]); // `other` differs but is not wanted
    expect(planSync(host, sb, { branches: ["main"], allBranches: true }).prune).toEqual(["refs/remotes/origin/gone", "refs/tags/old"]);
  });
  test("a wanted branch missing on the host is a sync failure", () => {
    expect(() => planSync(host, m({}), { branches: ["nope"], allBranches: false })).toThrow("branch not found on the host: nope");
  });
});

describe("syncRefs against real git", () => {
  const spec = (repo: string, over: Partial<SyncSpec> = {}): SyncSpec => ({ repo, sandbox: "repo-fx", taskId: "t1", branches: ["main"], allBranches: false, ...over });

  test("first sync is full, second only the delta, third nothing", async () => {
    const repo = await fixture();
    const sb = localSandbox();
    const first = await syncRefs(sb.ctx, spec(repo));
    expect(first).toMatchObject({ updated: ["refs/remotes/origin/main"], prerequisites: 0, full: false });
    expect(first.bundleBytes).toBeGreaterThan(0);
    writeFileSync(join(repo, "new.txt"), "new\n");
    await git(repo, "add", "-A");
    await git(repo, "commit", "-qm", "new");
    const second = await syncRefs(sb.ctx, spec(repo));
    expect(second.prerequisites).toBe(1);
    expect(second.bundleBytes).toBeLessThan(first.bundleBytes);
    expect(await git(sb.path("/sandbox/repo"), "rev-parse", "refs/remotes/origin/main")).toBe(await git(repo, "rev-parse", "main"));
    const uploads = sb.calls.filter((c) => c.argv.includes("upload")).length;
    const third = await syncRefs(sb.ctx, spec(repo));
    expect(third).toMatchObject({ bundleBytes: 0, updated: [], pruned: [], prerequisites: 0, full: false });
    expect(third.tips).toEqual({ "refs/heads/main": await git(repo, "rev-parse", "main") });
    expect(sb.calls.filter((c) => c.argv.includes("upload")).length).toBe(uploads);
    // uploaded bundles do not linger
    expect(readdirSync(sb.path("/sandbox/.oskhs/in"))).toEqual([]);
  });

  test("offline origin: checkout DWIM works, fetch fails", async () => {
    const repo = await fixture();
    const sb = localSandbox();
    await syncRefs(sb.ctx, spec(repo, { branches: ["main", "feature"] }));
    const wt = sb.path("/sandbox/tasks/w");
    await git(sb.path("/sandbox/repo"), "worktree", "add", "-q", "--detach", wt, "refs/remotes/origin/main");
    await git(wt, "checkout", "-q", "feature");
    expect(await Bun.file(join(wt, "notes.txt")).text()).toContain("HERON");
    expect(await git(sb.path("/sandbox/repo"), "config", "remote.origin.url")).toBe("/oskhs-offline");
    await expect(git(wt, "fetch")).rejects.toThrow();
  });

  test("deleted upstream branch is pruned", async () => {
    const repo = await fixture();
    const sb = localSandbox();
    await syncRefs(sb.ctx, spec(repo, { branches: ["main", "feature"] }));
    await git(repo, "branch", "-D", "feature");
    const s = await syncRefs(sb.ctx, spec(repo));
    expect(s.pruned).toEqual(["refs/remotes/origin/feature"]);
    expect(await git(sb.path("/sandbox/repo"), "for-each-ref", "--format=%(refname)", "refs/remotes/origin")).toBe("refs/remotes/origin/main");
  });

  test("an agent-moved tip is reset and never used as a prerequisite", async () => {
    const repo = await fixture();
    const sb = localSandbox();
    await syncRefs(sb.ctx, spec(repo));
    // the agent commits in a worktree and points origin/main at it
    const wt = sb.path("/sandbox/tasks/a");
    await git(sb.path("/sandbox/repo"), "worktree", "add", "-q", "--detach", wt, "refs/remotes/origin/main");
    writeFileSync(join(wt, "evil.txt"), "x\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-qm", "agent");
    await git(wt, "update-ref", "refs/remotes/origin/main", "HEAD");
    writeFileSync(join(repo, "up.txt"), "up\n");
    await git(repo, "add", "-A");
    await git(repo, "commit", "-qm", "upstream");
    const s = await syncRefs(sb.ctx, spec(repo));
    expect(s.prerequisites).toBe(0); // the host lacks the agent's commit
    expect(s.full).toBe(false);
    expect(await git(sb.path("/sandbox/repo"), "rev-parse", "refs/remotes/origin/main")).toBe(await git(repo, "rev-parse", "main"));
  });

  test("a rewind moves the ref without a bundle", async () => {
    const repo = await fixture();
    const sb = localSandbox();
    writeFileSync(join(repo, "n.txt"), "n\n");
    await git(repo, "add", "-A");
    await git(repo, "commit", "-qm", "n");
    await syncRefs(sb.ctx, spec(repo));
    await git(repo, "reset", "-q", "--hard", "HEAD~1");
    const s = await syncRefs(sb.ctx, spec(repo));
    expect(s).toMatchObject({ bundleBytes: 0, updated: ["refs/remotes/origin/main"] });
    expect(await git(sb.path("/sandbox/repo"), "rev-parse", "refs/remotes/origin/main")).toBe(await git(repo, "rev-parse", "main"));
  });

  test("missing objects fall back to a full bundle", async () => {
    const repo = await fixture();
    const sb = localSandbox();
    await syncRefs(sb.ctx, spec(repo));
    const tip = await git(repo, "rev-parse", "main");
    writeFileSync(join(repo, "m.txt"), "m\n");
    await git(repo, "add", "-A");
    await git(repo, "commit", "-qm", "m");
    // the sandbox claims a tip whose objects it no longer has
    const sbRepo = sb.path("/sandbox/repo");
    await sb.sh(`rm -rf ${sbRepo}/objects/* && mkdir -p ${sbRepo}/objects/info ${sbRepo}/objects/pack && git -C ${sbRepo} update-ref --no-deref refs/remotes/origin/main ${tip} 2>/dev/null || printf '${tip}\\n' > ${sbRepo}/refs/remotes/origin/main`);
    const s = await syncRefs(sb.ctx, spec(repo));
    expect(s.full).toBe(true);
    expect(await git(sbRepo, "rev-parse", "refs/remotes/origin/main")).toBe(await git(repo, "rev-parse", "main"));
  });

  test("tags travel only in all-branches mode", async () => {
    const repo = await fixture();
    await git(repo, "tag", "v1");
    const sb = localSandbox();
    await syncRefs(sb.ctx, spec(repo));
    expect(await git(sb.path("/sandbox/repo"), "tag")).toBe("");
    await syncRefs(sb.ctx, spec(repo, { allBranches: true }));
    expect(await git(sb.path("/sandbox/repo"), "tag")).toBe("v1");
  });
});

describe("round over the local sandbox", () => {
  test("a round syncs, runs in its worktree, and removes it", async () => {
    const repo = await fixture();
    const sb = localSandbox();
    let sawWorktree = false;
    sb.onRun = async (_argv, opts) => {
      sawWorktree = (await Bun.file(join(sb.path(opts.env!.MAKI_OSS_WORKDIR!), "README.md")).exists());
      return { code: 0, stdout: '{"type":"result","is_error":false,"result":"ok","session_id":"S"}\n' };
    };
    const spec: RoundSpec = { repo, sandbox: "repo-fx", providers: [], taskId: "r1", base: "main", branches: ["feature"], allBranches: false, collect: false, prompt: "q", timeoutSec: 5 };
    const { result, sync } = await runRound(sb.ctx, spec);
    expect(result.kind).toBe("answer");
    expect(sawWorktree).toBe(true);
    expect(sync!.updated).toEqual(["refs/remotes/origin/feature", "refs/remotes/origin/main"]);
    expect(await Bun.file(join(sb.path("/sandbox/tasks/r1"), "README.md")).exists()).toBe(false);
  });

  test("branches the agent checked out do not outlive its worktree", async () => {
    const repo = await fixture();
    const sb = localSandbox();
    const sbRepo = sb.path("/sandbox/repo");
    // another live task holds `main` checked out; it must keep it
    await syncRefs(sb.ctx, { repo, sandbox: "repo-fx", taskId: "x", branches: ["main"], allBranches: false });
    await git(sbRepo, "worktree", "add", "-q", "-b", "main", sb.path("/sandbox/tasks/other"), "refs/remotes/origin/main");
    sb.onRun = async (_argv, opts) => {
      await git(sb.path(opts.env!.MAKI_OSS_WORKDIR!), "checkout", "-q", "feature");
      return { code: 0, stdout: '{"type":"result","is_error":false,"result":"ok","session_id":"S"}\n' };
    };
    const spec: RoundSpec = { repo, sandbox: "repo-fx", providers: [], taskId: "r3", base: "main", branches: ["feature"], allBranches: false, collect: false, prompt: "q", timeoutSec: 5 };
    expect((await runRound(sb.ctx, spec)).result.kind).toBe("answer");
    expect(await git(sbRepo, "for-each-ref", "--format=%(refname)", "refs/heads")).toBe("refs/heads/main");
  });

  test("an unknown branch fails the round at the sync stage", async () => {
    const repo = await fixture();
    const sb = localSandbox();
    const spec: RoundSpec = { repo, sandbox: "repo-fx", providers: [], taskId: "r2", base: "main", branches: ["nope"], allBranches: false, collect: false, prompt: "q", timeoutSec: 5 };
    const { result } = await runRound(sb.ctx, spec);
    expect(result).toMatchObject({ kind: "failed", stage: "sync" });
  });
});
