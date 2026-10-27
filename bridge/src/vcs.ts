// Review diffs and the review base of the sandbox checkout (vcs.diff,
// vcs.base, vcs.status), ported from OpenCode's git provider
// (core/src/plugin/vcs/git.ts v2.1.4) and run in the sandbox over the exec
// transport. Each request batches its git commands into a few execs: the
// transport costs a round trip per exec, not per command. A batch is bounded
// by command count and script size, so a large repository runs several execs
// in order instead of one that exceeds the transport's argument limit.
import { sandboxRun } from "./sandbox.ts";

// the provider's fixed git configuration (git.ts L164–L176)
const CFG = ["--no-optional-locks", "-c", "core.autocrlf=false", "-c", "core.fsmonitor=false", "-c", "core.longpaths=true", "-c", "core.symlinks=true", "-c", "core.quotepath=false"];
// whole-file context unless the client asks otherwise, and the patch budgets
// (core/src/vcs/patch.ts L6–L8)
const PATCH_CONTEXT_LINES = 2_147_483_647;
const MAX_PATCH_BYTES = 10_000_000;
const MAX_TOTAL_PATCH_BYTES = 10_000_000;
// one exec carries at most this many commands and this many script bytes
// (well under the 128 KiB a single argument may take); patches run in smaller
// groups, since each can answer megabytes and the total budget ends the work
export const MAX_BATCH_COMMANDS = 100;
export const MAX_BATCH_BYTES = 64 * 1024;
export const MAX_PATCH_COMMANDS = 16;

export type Mode = "working" | "branch" | "committed";
export type Kind = "added" | "deleted" | "modified";
export interface FileDiff { file: string; patch: string; additions: number; deletions: number; status: Kind }
export interface FileStatus { file: string; additions: number; deletions: number; status: Kind }
export interface Base { name: string; ref: string; source: "reflog" | "default" }
export class VcsError extends Error {}

interface Result { code: number; out: string }
interface Item { file: string; code: string; status: Kind }
interface Stat { file: string; additions: number; deletions: number }

const quote = (arg: string) => `'${arg.replace(/'/g, `'\\''`)}'`;

/** one command's script line: its exit code follows its output, \037 then \036 */
const line = (args: string[]) => `git ${[...CFG, ...args].map(quote).join(" ")} 2>/dev/null; printf '\\037%d\\036' $?`;

/** splits a command list, keeping its order, into groups that each fit one
 * exec: at most `max` commands and MAX_BATCH_BYTES of script (a single command
 * larger than that still runs, alone) */
export function chunkCommands(cmds: string[][], max = MAX_BATCH_COMMANDS): string[][][] {
  const groups: string[][][] = [];
  let group: string[][] = [];
  let bytes = 0;
  for (const cmd of cmds) {
    const size = Buffer.byteLength(line(cmd)) + 1;
    if (group.length && (group.length >= max || bytes + size > MAX_BATCH_BYTES)) {
      groups.push(group);
      group = [];
      bytes = 0;
    }
    group.push(cmd);
    bytes += size;
  }
  if (group.length) groups.push(group);
  return groups;
}

/** runs git commands in order, one bounded exec per chunk; a missing sandbox reads as all failed */
async function batch(cmds: string[][], workdir: string): Promise<Result[]> {
  const results: Result[] = [];
  for (const group of chunkCommands(cmds)) results.push(...(await exec(group, workdir)));
  return results;
}

async function exec(cmds: string[][], workdir: string): Promise<Result[]> {
  const res = await sandboxRun(["sh", "-c", cmds.map(line).join("\n")], workdir);
  if (!res) return cmds.map(() => ({ code: 1, out: "" }));
  const parts = res.stdout.split("\x1e");
  return cmds.map((_, i) => {
    const part = parts[i] ?? "";
    const cut = part.lastIndexOf("\x1f");
    return cut < 0 ? { code: 1, out: "" } : { code: Number(part.slice(cut + 1)) || 0, out: part.slice(0, cut) };
  });
}

const nuls = (text: string) => text.split("\0").filter(Boolean);
const lines = (text: string) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

// git.ts L178–L184
const kind = (code: string): Kind => {
  if (code === "??") return "added";
  if (code.includes("U")) return "modified";
  if (code.includes("A") && !code.includes("D")) return "added";
  if (code.includes("D") && !code.includes("A")) return "deleted";
  return "modified";
};

// git.ts L188–L206
const numstat = (text: string): Stat[] =>
  nuls(text).flatMap((item) => {
    const a = item.indexOf("\t");
    const b = item.indexOf("\t", a + 1);
    if (a === -1 || b === -1) return [];
    const file = item.slice(b + 1);
    if (!file) return [];
    const add = item.slice(0, a);
    const del = item.slice(a + 1, b);
    const additions = add === "-" ? 0 : Number.parseInt(add || "0", 10);
    const deletions = del === "-" ? 0 : Number.parseInt(del || "0", 10);
    return [{ file, additions: Number.isFinite(additions) ? additions : 0, deletions: Number.isFinite(deletions) ? deletions : 0 }];
  });

// git.ts L366–L375
const statusItems = (text: string): Item[] =>
  nuls(text).flatMap((item) => {
    const file = item.slice(3);
    if (!file) return [];
    const code = item.slice(0, 2);
    return [{ file, code, status: kind(code) }];
  });

// git.ts L377–L392
const nameItems = (text: string): Item[] => {
  const list = nuls(text);
  return list.flatMap((code, idx) => {
    if (idx % 2 !== 0) return [];
    const file = list[idx + 1];
    if (!code || !file) return [];
    return [{ file, code, status: kind(code) }];
  });
};

// jsdiff formatPatch(structuredPatch(file, file, "", "", "", "", { context: 0 }))
// (core/src/vcs/patch.ts L15), the placeholder for a capped patch
const emptyPatch = (file: string) => `Index: ${file}\n===================================================================\n--- ${file}\n+++ ${file}\n`;

interface Repo {
  hasHead: boolean;
  branch?: string;
  remotes: string[];
  remoteHead?: string; // symbolic-ref of the primary remote's HEAD, when set
  configured?: string; // init.defaultBranch
  heads: string[];
}

const REPO = [
  ["rev-parse", "--verify", "HEAD"],
  ["symbolic-ref", "--quiet", "--short", "HEAD"],
  ["remote"],
  ["config", "init.defaultBranch"],
  ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
];

async function readRepo(workdir: string): Promise<Repo> {
  const [head, branch, remote, configured, heads] = await batch(REPO, workdir);
  const remotes = lines(remote!.out);
  // git.ts L242–L249
  const primary = remotes.includes("origin") ? "origin" : remotes.length === 1 ? remotes[0] : remotes.includes("upstream") ? "upstream" : remotes[0];
  let remoteHead: string | undefined;
  if (primary) {
    const [ref] = await batch([["symbolic-ref", `refs/remotes/${primary}/HEAD`]], workdir);
    if (ref!.code === 0) remoteHead = ref!.out.trim().replace(/^refs\/remotes\//, "");
  }
  return {
    hasHead: head!.code === 0,
    branch: branch!.code === 0 ? branch!.out.trim() || undefined : undefined,
    remotes: primary ? [primary, ...remotes.filter((r) => r !== primary)] : remotes,
    remoteHead,
    configured: configured!.out.trim() || undefined,
    heads: lines(heads!.out),
  };
}

// git.ts L276–L297
function defaultBranch(repo: Repo): { name: string; ref: string } | undefined {
  const remote = repo.remotes[0];
  if (remote && repo.remoteHead) {
    const name = repo.remoteHead.startsWith(`${remote}/`) ? repo.remoteHead.slice(`${remote}/`.length) : "";
    if (name) return { name, ref: repo.remoteHead };
  }
  if (repo.configured && repo.heads.includes(repo.configured)) return { name: repo.configured, ref: repo.configured };
  if (repo.heads.includes("main")) return { name: "main", ref: "main" };
  if (repo.heads.includes("master")) return { name: "master", ref: "master" };
  return undefined;
}

/** vcs.base (git.ts L319–L351); null without a commit, VcsError when no base can be chosen */
export async function reviewBase(workdir: string): Promise<Base | null> {
  const repo = await readRepo(workdir);
  if (!repo.hasHead) return null;
  const current = repo.branch;
  if (!current) throw new VcsError("Choose a review base");
  const [reflog] = await batch([["reflog", "show", "--max-count=256", "--format=%H%x00%gs", `refs/heads/${current}`]], workdir);
  const history = lines(reflog!.out).flatMap((line) => {
    const match = /^([a-f0-9]+)\0(.+)$/.exec(line);
    return match ? [{ commit: match[1]!, message: match[2]! }] : [];
  });
  const renamed = history.some((e) => e.message.startsWith("Branch: renamed "));
  const creation = renamed ? undefined : history.find((e) => e.message.startsWith("branch: Created from "));
  const origin = creation?.message.slice("branch: Created from ".length);
  if (creation && origin) {
    const candidate = await namedRef(workdir, origin);
    if (candidate && candidate.name !== current && /^[a-f0-9]{40,64}$/.test(creation.commit)) {
      const [toHead, toRef] = await batch(
        [["merge-base", "--is-ancestor", creation.commit, "HEAD"], ["merge-base", "--is-ancestor", creation.commit, candidate.ref]],
        workdir,
      );
      if (toHead!.code === 0 && toRef!.code === 0) return { ...candidate, source: "reflog" };
    }
  }
  const root = defaultBranch(repo);
  if (!root || current !== root.name) throw new VcsError("Choose a review base");
  const candidate = await namedRef(workdir, root.ref);
  if (!candidate) throw new VcsError("The default review base is unavailable");
  return { name: root.name, ref: candidate.ref, source: "default" };
}

// git.ts L309–L317
async function namedRef(workdir: string, input: string): Promise<{ name: string; ref: string } | undefined> {
  if (input === "HEAD" || input.endsWith("/HEAD") || /[~^:@{}\s]/.test(input)) return undefined;
  const [sym] = await batch([["rev-parse", "--symbolic-full-name", "--verify", "--end-of-options", input]], workdir);
  const ref = sym!.out.trim();
  if (!/^refs\/(heads|remotes)\/.+/.test(ref) || ref.endsWith("/HEAD")) return undefined;
  const [resolved] = await batch([["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]], workdir);
  if (resolved!.code !== 0 || !resolved!.out.trim()) return undefined;
  return { name: ref.replace(/^refs\/heads\//, "").replace(/^refs\/remotes\/[^/]+\//, ""), ref };
}

/** vcs.diff (git.ts L112–L129, L677–L745) */
export async function reviewDiff(workdir: string, mode: Mode, options: { base?: string; context?: number } = {}): Promise<FileDiff[]> {
  const repo = await readRepo(workdir);
  const context = options.context ?? PATCH_CONTEXT_LINES;
  if (mode === "working") return track(workdir, repo.hasHead ? "HEAD" : undefined, context);
  if (!repo.hasHead) return mode === "committed" ? [] : track(workdir, undefined, context);
  const base = options.base ?? defaultBranch(repo)?.ref;
  let ref: string | undefined;
  if (base) {
    const [resolved] = await batch([["rev-parse", "--verify", "--end-of-options", `${base}^{commit}`]], workdir);
    const commit = resolved!.code === 0 ? resolved!.out.trim() : "";
    if (commit) {
      const [merge] = await batch([["merge-base", commit, "HEAD"]], workdir);
      ref = merge!.code === 0 ? merge!.out.trim() || undefined : undefined;
    }
  }
  if (!ref) throw new VcsError(base ? `No merge base available for ${base}` : "No review base available");
  return againstRef(workdir, ref, context, mode === "committed" ? "HEAD" : undefined);
}

/** vcs.status (git.ts L81–L109) */
export async function reviewStatus(workdir: string): Promise<FileStatus[]> {
  const repo = await readRepo(workdir);
  const [status, stats] = await batch(
    [["status", "--porcelain=v1", "--untracked-files=all", "--no-renames", "-z", "--", "."], ...(repo.hasHead ? [["diff", "--no-ext-diff", "--no-renames", "--numstat", "-z", "HEAD", "--", "."]] : [])],
    workdir,
  );
  const list = statusItems(status!.out);
  const map = new Map(numstat(stats?.out ?? "").map((s) => [s.file, s]));
  const untracked = await untrackedStats(workdir, list.filter((i) => i.status === "added" && !map.has(i.file)).map((i) => i.file));
  return list
    .toSorted((a, b) => a.file.localeCompare(b.file))
    .map((item) => {
      const stat = map.get(item.file) ?? (item.status === "added" ? untracked.get(item.file) : undefined);
      return { file: item.file, additions: stat?.additions ?? 0, deletions: stat?.deletions ?? 0, status: item.status };
    });
}

async function untrackedStats(workdir: string, files: string[]): Promise<Map<string, Stat>> {
  if (!files.length) return new Map();
  const results = await batch(files.map((f) => ["diff", "--no-index", "--numstat", "--", "/dev/null", f]), workdir);
  const out = new Map<string, Stat>();
  results.forEach((r, i) => {
    const parts = r.out.split("\t");
    if (parts.length < 2) return;
    const additions = parts[0] === "-" ? 0 : Number.parseInt(parts[0] || "0", 10);
    const deletions = parts[1] === "-" ? 0 : Number.parseInt(parts[1] || "0", 10);
    out.set(files[i]!, { file: files[i]!, additions: Number.isFinite(additions) ? additions : 0, deletions: Number.isFinite(deletions) ? deletions : 0 });
  });
  return out;
}

// git.ts L747–L750
async function track(workdir: string, ref: string | undefined, context: number): Promise<FileDiff[]> {
  if (ref) return againstRef(workdir, ref, context);
  const [status] = await batch([["status", "--porcelain=v1", "--untracked-files=all", "--no-renames", "-z", "--", "."]], workdir);
  return files(workdir, undefined, statusItems(status!.out), new Map(), context);
}

// git.ts L728–L745
async function againstRef(workdir: string, ref: string, context: number, target?: "HEAD"): Promise<FileDiff[]> {
  const [names, stats, status] = await batch(
    [
      ["diff", "--no-ext-diff", "--no-renames", "--name-status", "-z", ref, ...(target ? [target] : []), "--", "."],
      ["diff", "--no-ext-diff", "--no-renames", "--numstat", "-z", ref, ...(target ? [target] : []), "--", "."],
      ...(target ? [] : [["status", "--porcelain=v1", "--untracked-files=all", "--no-renames", "-z", "--", "."]]),
    ],
    workdir,
  );
  if (names!.code !== 0) throw new VcsError("Unable to list Git changes");
  const merged = new Map<string, Item>();
  for (const item of [...nameItems(names!.out), ...statusItems(status?.out ?? "").filter((i) => i.code === "??")]) {
    if (!merged.has(item.file)) merged.set(item.file, item);
  }
  return files(workdir, ref, [...merged.values()], new Map(numstat(stats!.out).map((s) => [s.file, s])), context, target);
}

// git.ts L677–L725: per-file patches under the per-file and total budgets
async function files(workdir: string, ref: string | undefined, list: Item[], map: Map<string, Stat>, context: number, target?: "HEAD"): Promise<FileDiff[]> {
  const sorted = list.toSorted((a, b) => a.file.localeCompare(b.file));
  const untracked = sorted.filter((i) => i.code === "??" || !ref || (!target && i.status === "added" && !map.has(i.file)));
  const stats = await untrackedStats(workdir, untracked.filter((i) => !target && i.status === "added").map((i) => i.file));
  const cmds = sorted.map((item) =>
    item.code === "??" || !ref
      ? ["diff", "--no-index", "--patch", "--no-ext-diff", "--no-renames", `--unified=${context}`, "--", "/dev/null", item.file]
      : ["diff", "--patch", "--no-ext-diff", "--no-renames", `--unified=${context}`, ref, ...(target ? [target] : []), "--", item.file],
  );
  // patches are generated group by group, in order, until the total budget is
  // reached; the files after that are capped without running their diffs
  const patches: string[] = [];
  let total = 0;
  let capped = false;
  for (const group of chunkCommands(cmds, MAX_PATCH_COMMANDS)) {
    if (capped) break;
    for (const result of await exec(group, workdir)) {
      const file = sorted[patches.length]!.file;
      let patch = result.out;
      if (!patch || Buffer.byteLength(patch) > MAX_PATCH_BYTES || capped) patch = emptyPatch(file);
      if (!capped && total + Buffer.byteLength(patch) > MAX_TOTAL_PATCH_BYTES) {
        patch = emptyPatch(file);
        capped = true;
      }
      if (!capped) {
        total += Buffer.byteLength(patch);
        capped = total >= MAX_TOTAL_PATCH_BYTES;
      }
      patches.push(patch);
    }
  }
  return sorted.map((item, i) => {
    const stat = map.get(item.file) ?? (!target && item.status === "added" ? stats.get(item.file) : undefined);
    return { file: item.file, patch: patches[i] ?? emptyPatch(item.file), additions: stat?.additions ?? 0, deletions: stat?.deletions ?? 0, status: item.status };
  });
}
