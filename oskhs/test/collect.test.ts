import { describe, expect, test } from "bun:test";
import { renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseNameStatus } from "../src/collect.ts";
import { runRound, type RoundSpec } from "../src/round.ts";
import { fixture, git, localSandbox, type LocalSandbox } from "./local-sandbox.ts";

const answer = { code: 0, stdout: '{"type":"result","is_error":false,"result":"done","session_id":"S"}\n' };

async function setup(agent: (wt: string, sb: LocalSandbox) => Promise<void>, over: Partial<RoundSpec> = {}) {
  const repo = await fixture();
  const sb = localSandbox();
  let tree = "";
  sb.onRun = async (_argv, opts) => {
    const wt = sb.path(opts.env!.MAKI_OSS_WORKDIR!);
    await agent(wt, sb);
    return answer;
  };
  // capture the worktree's final tree as the sandbox reports it
  const log = sb.ctx.log;
  sb.ctx.log = (m) => {
    const t = m.match(/ tree ([0-9a-f]{12})/);
    if (t) tree = t[1]!;
    log(m);
  };
  const spec: RoundSpec = { repo, sandbox: "repo-fx", providers: [], taskId: "c1", base: "main", branches: [], allBranches: false, collect: true, prompt: "q", timeoutSec: 5, ...over };
  const outcome = await runRound(sb.ctx, spec);
  return { repo, sb, outcome, tree: () => tree };
}

describe("changes back", () => {
  test("edits, deletions, and renames arrive intact", async () => {
    const { repo, sb, outcome, tree } = await setup(async (wt) => {
      writeFileSync(join(wt, "calc.py"), "def add(a, b):\n    return b + a\n");
      rmSync(join(wt, "data.txt"));
      renameSync(join(wt, "README.md"), join(wt, "README.txt"));
    });
    expect(outcome.result.kind).toBe("answer");
    const c = outcome.changes!;
    expect(c.branch).toBe("oskhs/c1");
    expect(c.commits).toBe(1);
    expect(c.files).toEqual({ added: [], modified: ["calc.py"], deleted: ["data.txt"], renamed: [{ from: "README.md", to: "README.txt" }] });
    const hostTree = await git(repo, "rev-parse", "oskhs/c1^{tree}");
    expect(hostTree.startsWith(tree())).toBe(true);
    expect(await git(repo, "log", "-1", "--format=%an <%ae> %s", "oskhs/c1")).toBe("Maki (oskhs) <maki@oskhs.invalid> oskhs: uncommitted changes from task c1");
    // nothing lingers in the sandbox
    expect(await git(sb.path("/sandbox/repo"), "for-each-ref", "--format=%(refname)", "refs/heads")).toBe("");
    expect(await Bun.file(sb.path("/sandbox/.oskhs/out/c1.bundle")).exists()).toBe(false);
  });

  test("the agent's own commits are kept, no oskhs commit added", async () => {
    const { repo, outcome } = await setup(async (wt) => {
      writeFileSync(join(wt, "one.txt"), "1\n");
      await git(wt, "add", "-A");
      await git(wt, "commit", "-qm", "one");
      writeFileSync(join(wt, "two.txt"), "2\n");
      await git(wt, "add", "-A");
      await git(wt, "commit", "-qm", "two");
    });
    expect(outcome.changes).toMatchObject({ commits: 2, files: { added: ["one.txt", "two.txt"] } });
    expect(await git(repo, "log", "--format=%s", "main..oskhs/c1")).toBe("two\none");
  });

  test("no changes, no branch", async () => {
    const { repo, outcome } = await setup(async () => {});
    expect(outcome.result.kind).toBe("answer");
    expect(outcome.changes).toBeNull();
    expect(await git(repo, "for-each-ref", "refs/heads/oskhs")).toBe("");
  });

  test("a head the host already has needs no bundle", async () => {
    const { repo, outcome } = await setup(async (wt) => {
      await git(wt, "checkout", "-q", "--detach", "refs/remotes/origin/feature");
    }, { branches: ["feature"] });
    expect(outcome.changes).toMatchObject({ commits: 1, bundleBytes: 0, files: { added: ["notes.txt"] } });
    expect(await git(repo, "rev-parse", "oskhs/c1")).toBe(await git(repo, "rev-parse", "feature"));
  });

  test("a bundle with unexpected refs is refused", async () => {
    const repo = await fixture();
    const sb = localSandbox();
    sb.onRun = async (_argv, opts) => {
      writeFileSync(join(sb.path(opts.env!.MAKI_OSS_WORKDIR!), "x.txt"), "x\n");
      return answer;
    };
    sb.intercept = async (argv) => {
      if (!argv.includes("download")) return undefined;
      // the sandbox hands back a bundle that also carries another ref
      const dir = argv.at(-1)!;
      const sbRepo = sb.path("/sandbox/repo");
      await git(sbRepo, "update-ref", "refs/heads/sneaky", "refs/heads/task-c2");
      await git(sbRepo, "bundle", "create", "-q", join(dir, "c2.bundle"), "refs/heads/task-c2", "refs/heads/sneaky", "^refs/remotes/origin/main");
      return { code: 0 };
    };
    const spec: RoundSpec = { repo, sandbox: "repo-fx", providers: [], taskId: "c2", base: "main", branches: [], allBranches: false, collect: true, prompt: "q", timeoutSec: 5 };
    const { result, changes } = await runRound(sb.ctx, spec);
    expect(result).toMatchObject({ kind: "failed", stage: "collect" });
    expect(changes).toBeNull();
    expect(await git(repo, "for-each-ref", "--format=%(refname)", "refs/heads")).toBe("refs/heads/feature\nrefs/heads/main");
  });

  test("read-only rounds skip collection", async () => {
    const { repo, sb, outcome } = await setup(async (wt) => writeFileSync(join(wt, "calc.py"), "changed\n"), { collect: false });
    expect(outcome.changes).toBeNull();
    expect(await git(repo, "for-each-ref", "refs/heads/oskhs")).toBe("");
    expect(sb.calls.some((c) => c.argv.includes("download"))).toBe(false);
  });

  test("non-answer rounds collect nothing", async () => {
    const repo = await fixture();
    const sb = localSandbox();
    sb.onRun = async (_argv, opts) => {
      writeFileSync(join(sb.path(opts.env!.MAKI_OSS_WORKDIR!), "calc.py"), "changed\n");
      return { code: 124 };
    };
    const spec: RoundSpec = { repo, sandbox: "repo-fx", providers: [], taskId: "c3", base: "main", branches: [], allBranches: false, collect: true, prompt: "q", timeoutSec: 5 };
    const { result, changes } = await runRound(sb.ctx, spec);
    expect(result.kind).toBe("timeout");
    expect(changes).toBeNull();
    expect(await git(repo, "for-each-ref", "refs/heads/oskhs")).toBe("");
  });
});

test("name-status parsing", () => {
  expect(parseNameStatus("M\ta\nD\tb\nR087\tc\td\nA\te\n")).toEqual({ added: ["e"], modified: ["a"], deleted: ["b"], renamed: [{ from: "c", to: "d" }] });
});
