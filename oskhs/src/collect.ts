// Changes back as a git bundle (B1.2, design in add-oskhs-commits-back).
// The task's result is its worktree's final HEAD: leftovers are committed,
// task-<id> points at HEAD, and only that ref travels back. The bundle comes
// from an untrusted sandbox, so the host verifies it, accepts exactly one
// ref, and fetches with object checking before writing oskhs/<id>.
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tail } from "./exec.ts";
import { OUT_DIR, checkTaskId, worktreePath } from "./names.ts";
import { download, sandboxSh, type Ctx } from "./openshell.ts";
import { StageError } from "./result.ts";

export interface FileChanges {
  added: string[];
  modified: string[];
  deleted: string[];
  renamed: { from: string; to: string }[];
}

export interface Changes {
  branch: string; // host branch name, without refs/heads/
  head: string;
  base: string;
  commits: number;
  bundleBytes: number;
  files: FileChanges;
}

export interface CollectSpec {
  repo: string; // host repository the branch lands in
  sandbox: string;
  taskId: string;
  baseTip: string; // host object id the worktree started from
  prerequisites: string[]; // host object ids synced this round
}

export const hostBranch = (taskId: string) => `oskhs/${checkTaskId(taskId)}`;

// $1 worktree, $2 task id, $3 bundle path, $4 base tip; prerequisite ids on
// stdin. Prints `head <id>`, `tree <id>`, then `none`, `known` (the head is
// already reachable from a prerequisite), or `bundle`.
const COLLECT_SCRIPT = `wt=$1 id=$2 out=$3 base=$4
cd "$wt" || exit 1
git add -A || exit 1
if ! git diff --cached --quiet; then
    git commit -q -m "oskhs: uncommitted changes from task $id" || exit 1
fi
head=$(git rev-parse HEAD) || exit 1
git update-ref "refs/heads/task-$id" "$head" || exit 1
echo "head $head"
echo "tree $(git rev-parse 'HEAD^{tree}')"
if [ "$head" = "$base" ]; then echo none; exit 0; fi
mkdir -p "$(dirname "$out")" || exit 1
{ echo "refs/heads/task-$id"; sed 's/^/^/'; } > "$out.revs"
if git bundle create -q "$out" --stdin < "$out.revs" 2> "$out.err"; then
    echo bundle
elif grep -q 'empty bundle' "$out.err"; then
    echo known
else
    cat "$out.err" >&2; rm -f "$out" "$out.revs" "$out.err"; exit 1
fi
rm -f "$out.revs" "$out.err"`;

export function parseCollectOutput(stdout: string): { head: string; tree: string; mode: "none" | "known" | "bundle" } {
  const lines = stdout.trim().split("\n");
  const field = (k: string) => lines.find((l) => l.startsWith(`${k} `))?.slice(k.length + 1);
  const head = field("head");
  const tree = field("tree");
  const mode = lines.at(-1);
  if (!head || !tree || (mode !== "none" && mode !== "known" && mode !== "bundle")) throw new StageError("collect", 0, `unexpected collect output: ${tail(stdout, 5)}`);
  return { head, tree, mode };
}

export function parseNameStatus(text: string): FileChanges {
  const files: FileChanges = { added: [], modified: [], deleted: [], renamed: [] };
  for (const line of text.split("\n")) {
    const [status, a, b] = line.split("\t");
    if (!status || !a) continue;
    if (status.startsWith("R") && b) files.renamed.push({ from: a, to: b });
    else if (status === "A" || status.startsWith("C")) files.added.push(b ?? a);
    else if (status === "D") files.deleted.push(a);
    else files.modified.push(a);
  }
  return files;
}

async function git(ctx: Ctx, repo: string, args: string[], stdin?: string) {
  const out = await ctx.run(["git", "-C", repo, ...args], stdin === undefined ? {} : { stdin });
  if (out.code !== 0) throw new StageError("collect", out.code, tail(out.stderr));
  return out.stdout.trim();
}

export async function collectChanges(ctx: Ctx, spec: CollectSpec): Promise<Changes | null> {
  const id = checkTaskId(spec.taskId);
  const out = `${OUT_DIR}/${id}.bundle`;
  const ran = await sandboxSh(ctx, spec.sandbox, COLLECT_SCRIPT, [worktreePath(id), id, out, spec.baseTip], {
    stdin: spec.prerequisites.join("\n") + "\n",
  });
  if (ran.code !== 0) throw new StageError("collect", ran.code, tail(ran.stderr));
  const { head, tree, mode } = parseCollectOutput(ran.stdout);
  ctx.log(`collect ${id}: head ${head.slice(0, 12)} tree ${tree.slice(0, 12)} (${mode})`);
  if (mode === "none") return null;

  const ref = `refs/heads/${hostBranch(id)}`;
  let bundleBytes = 0;
  if (mode === "known") {
    // the head is an ancestor of something the host sent; it must exist here
    const type = await git(ctx, spec.repo, ["cat-file", "-t", head]).catch(() => "");
    if (type !== "commit") throw new StageError("collect", 1, `head ${head} is not a commit the host has`);
    await git(ctx, spec.repo, ["update-ref", ref, head]);
  } else {
    const dir = await mkdtemp(join(tmpdir(), "oskhs-collect-"));
    try {
      const got = await download(ctx, spec.sandbox, out, dir);
      if (got.code !== 0) throw new StageError("collect", got.code, tail(got.stderr + got.stdout));
      const file = join(dir, `${id}.bundle`);
      bundleBytes = (await stat(file)).size;
      await git(ctx, spec.repo, ["bundle", "verify", "-q", file]);
      const heads = (await git(ctx, spec.repo, ["bundle", "list-heads", file])).split("\n").filter(Boolean);
      if (heads.length !== 1 || heads[0] !== `${head} refs/heads/task-${id}`) {
        throw new StageError("collect", 1, `bundle advertises unexpected refs: ${heads.join(", ")}`);
      }
      await git(ctx, spec.repo, ["-c", "fetch.fsckObjects=true", "fetch", "-q", "--no-tags", file, `+refs/heads/task-${id}:${ref}`]);
    } finally {
      await rm(dir, { recursive: true, force: true });
      await sandboxSh(ctx, spec.sandbox, 'rm -f "$1"', [out]);
    }
  }
  const commits = Number(await git(ctx, spec.repo, ["rev-list", "--count", `${spec.baseTip}..${head}`]));
  const files = parseNameStatus(await git(ctx, spec.repo, ["diff", "--name-status", "-M", spec.baseTip, head]));
  return { branch: hostBranch(id), head, base: spec.baseTip, commits, bundleBytes, files };
}
