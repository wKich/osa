// Incremental ref sync into the warm sandbox (B1.1b, design in
// add-oskhs-incremental-sync). Tips are read from the sandbox per ref, used
// as prerequisites only when the host has them, and everything the sandbox
// lacks travels as one bundle. The sandbox is untrusted: anything it reports
// can at worst make the next bundle bigger.
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tail } from "./exec.ts";
import { IN_DIR, REPO_DIR, checkTaskId } from "./names.ts";
import { sandboxSh, upload, type Ctx } from "./openshell.ts";
import { StageError } from "./result.ts";

export interface SyncSpec {
  repo: string; // host repository: local clone (B1.1) or bare mirror (B1.4)
  sandbox: string;
  taskId: string;
  branches: string[]; // base first, then the task's own branches
  allBranches: boolean; // also every other branch and every tag
}

export interface SyncStats {
  bundleBytes: number;
  updated: string[]; // sandbox refnames moved by bundle or update-ref
  pruned: string[]; // sandbox refnames deleted
  prerequisites: number;
  full: boolean; // the bundle carried no prerequisites after a failed fetch
}

export type RefMap = Map<string, string>; // refname -> object id

// Host refs/heads/<b> lives at refs/remotes/origin/<b> in the sandbox; tags
// keep their name. oskhs owns both namespaces there (design decision 3).
export function toSandboxRef(hostRef: string): string {
  if (hostRef.startsWith("refs/heads/")) return `refs/remotes/origin/${hostRef.slice("refs/heads/".length)}`;
  if (hostRef.startsWith("refs/tags/")) return hostRef;
  throw new Error(`unsupported ref ${hostRef}`);
}

export function toHostRef(sandboxRef: string): string | undefined {
  if (sandboxRef === "refs/remotes/origin/HEAD") return undefined;
  if (sandboxRef.startsWith("refs/remotes/origin/")) return `refs/heads/${sandboxRef.slice("refs/remotes/origin/".length)}`;
  if (sandboxRef.startsWith("refs/tags/")) return sandboxRef;
  return undefined;
}

export interface SyncPlan {
  changed: string[]; // host refnames whose sandbox tip differs
  prune: string[]; // sandbox refnames to delete
  candidates: string[]; // sandbox tips that may serve as prerequisites
}

/** Pure part of the sync: which refs move, which go, which tips may help. */
export function planSync(host: RefMap, sandbox: RefMap, spec: Pick<SyncSpec, "branches" | "allBranches">): SyncPlan {
  const missing = spec.branches.filter((b) => !host.has(`refs/heads/${b}`));
  if (missing.length) throw new StageError("sync", 1, `branch not found on the host: ${missing.join(", ")}`);
  const wanted = new Set(spec.branches.map((b) => `refs/heads/${b}`));
  if (spec.allBranches) for (const ref of host.keys()) wanted.add(ref);
  const changed = [...wanted].filter((ref) => sandbox.get(toSandboxRef(ref)) !== host.get(ref)).sort();
  const prune: string[] = [];
  for (const sref of sandbox.keys()) {
    const href = toHostRef(sref);
    if (!href || host.has(href)) continue;
    // tags are only managed in all-branches mode; branches always
    if (href.startsWith("refs/heads/") || spec.allBranches) prune.push(sref);
  }
  return { changed, prune: prune.sort(), candidates: [...new Set(sandbox.values())].sort() };
}

export function parseRefs(text: string): RefMap {
  const refs: RefMap = new Map();
  for (const line of text.split("\n")) {
    const [sha, name] = line.trim().split(" ");
    if (sha && name) refs.set(name, sha);
  }
  return refs;
}

/** Ids from a `cat-file --batch-check` output that exist. */
export function presentIds(batchCheck: string): Set<string> {
  const present = new Set<string>();
  for (const line of batchCheck.split("\n")) {
    const [sha, type] = line.trim().split(" ");
    if (sha && type && type !== "missing") present.add(sha);
  }
  return present;
}

// $1 repo. Creates the bare repository with the offline origin (design
// decision 7: the URL is an absolute path under the read-only root), then
// prints the tips oskhs manages.
const OPEN_SCRIPT = `repo=$1
if ! git -C "$repo" rev-parse --git-dir >/dev/null 2>&1; then
    rm -rf "$repo"
    git init -q --bare "$repo" || { rm -rf "$repo"; exit 1; }
fi
git -C "$repo" config remote.origin.url /oskhs-offline || exit 1
git -C "$repo" config remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*' || exit 1
git -C "$repo" for-each-ref --format='%(objectname) %(refname)' refs/remotes/origin refs/tags`;

const BATCH_CHECK = `git -C "$1" cat-file --batch-check='%(objectname) %(objecttype)'`;

// $1 repo, $2 bundle, then refspecs. The bundle is removed either way.
const FETCH_SCRIPT = `repo=$1 bundle=$2
shift 2
git -C "$repo" fetch -q --no-tags "$bundle" "$@"
rc=$?
rm -f "$bundle"
exit "$rc"`;

const UPDATE_REFS = `git -C "$1" update-ref --stdin`;

async function hostRefs(ctx: Ctx, repo: string): Promise<RefMap> {
  const out = await ctx.run(["git", "-C", repo, "for-each-ref", "--format=%(objectname) %(refname)", "refs/heads", "refs/tags"]);
  if (out.code !== 0) throw new StageError("sync", out.code, tail(out.stderr));
  return parseRefs(out.stdout);
}

async function hostHas(ctx: Ctx, repo: string, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const out = await ctx.run(["git", "-C", repo, "cat-file", "--batch-check=%(objectname) %(objecttype)"], { stdin: ids.join("\n") + "\n" });
  if (out.code !== 0) throw new StageError("sync", out.code, tail(out.stderr));
  return presentIds(out.stdout);
}

async function sandboxHas(ctx: Ctx, sandbox: string, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const out = await sandboxSh(ctx, sandbox, BATCH_CHECK, [REPO_DIR], { stdin: ids.join("\n") + "\n" });
  if (out.code !== 0) throw new StageError("sync", out.code, tail(out.stderr));
  return presentIds(out.stdout);
}

/** Bundle `refs` minus `prereqs`, upload, fetch. Returns bytes, or throws. */
async function sendBundle(ctx: Ctx, spec: SyncSpec, refs: string[], prereqs: string[]): Promise<{ bytes: number; ok: boolean; stderr: string }> {
  const dir = await mkdtemp(join(tmpdir(), "oskhs-sync-"));
  try {
    const file = join(dir, "sync.bundle");
    const revs = [...refs, ...prereqs.map((id) => `^${id}`)].join("\n") + "\n";
    const made = await ctx.run(["git", "-C", spec.repo, "bundle", "create", "-q", file, "--stdin"], { stdin: revs });
    if (made.code !== 0) throw new StageError("sync", made.code, tail(made.stderr));
    const bytes = (await stat(file)).size;
    const dest = `${IN_DIR}/${checkTaskId(spec.taskId)}.bundle`;
    const up = await upload(ctx, spec.sandbox, file, dest);
    if (up.code !== 0) throw new StageError("sync", up.code, tail(up.stderr + up.stdout));
    const refspecs = refs.map((ref) => `+${ref}:${toSandboxRef(ref)}`);
    const fetched = await sandboxSh(ctx, spec.sandbox, FETCH_SCRIPT, [REPO_DIR, dest, ...refspecs]);
    return { bytes, ok: fetched.code === 0, stderr: tail(fetched.stderr) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function syncRefs(ctx: Ctx, spec: SyncSpec): Promise<SyncStats> {
  const opened = await sandboxSh(ctx, spec.sandbox, OPEN_SCRIPT, [REPO_DIR]);
  if (opened.code !== 0) throw new StageError("seed", opened.code, tail(opened.stderr));
  const sandbox = parseRefs(opened.stdout);
  const host = await hostRefs(ctx, spec.repo);
  const plan = planSync(host, sandbox, spec);
  const stats: SyncStats = { bundleBytes: 0, updated: [], pruned: [], prerequisites: 0, full: false };

  // Rewinds: the new tip is already in the sandbox, so no bundle can carry
  // it (design decision 6); update-ref moves it directly.
  const present = await sandboxHas(ctx, spec.sandbox, [...new Set(plan.changed.map((ref) => host.get(ref)!))]);
  const rewinds = plan.changed.filter((ref) => present.has(host.get(ref)!));
  const send = plan.changed.filter((ref) => !present.has(host.get(ref)!));

  if (send.length) {
    const prereqs = [...(await hostHas(ctx, spec.repo, plan.candidates))].sort();
    let sent = await sendBundle(ctx, spec, send, prereqs);
    stats.bundleBytes = sent.bytes;
    stats.prerequisites = prereqs.length;
    if (!sent.ok && prereqs.length) {
      ctx.log(`incremental fetch failed (${sent.stderr.split("\n")[0]}); retrying with a full bundle`);
      sent = await sendBundle(ctx, spec, send, []);
      stats.bundleBytes += sent.bytes;
      stats.full = true;
    }
    if (!sent.ok) throw new StageError("sync", 1, sent.stderr);
  }

  const commands = [
    ...rewinds.map((ref) => `update ${toSandboxRef(ref)} ${host.get(ref)}`),
    ...plan.prune.map((sref) => `delete ${sref}`),
  ];
  if (commands.length) {
    const out = await sandboxSh(ctx, spec.sandbox, UPDATE_REFS, [REPO_DIR], { stdin: commands.join("\n") + "\n" });
    if (out.code !== 0) throw new StageError("sync", out.code, tail(out.stderr));
  }
  stats.updated = plan.changed.map(toSandboxRef);
  stats.pruned = plan.prune;
  ctx.log(`sync ${spec.sandbox}: ${stats.bundleBytes} bytes, ${stats.updated.length} updated, ${stats.pruned.length} pruned${stats.full ? " (full)" : ""}`);
  return stats;
}
