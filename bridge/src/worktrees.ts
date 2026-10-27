// The project's worktrees (tui component/dialog-workspaces.tsx v2.1.4): the
// TUI lists, refreshes, creates and removes them, then opens or moves a
// session into one. OpenCode keeps them under its data directory and runs
// `git worktree` on the checkout (core worktree.ts v2.1.4 L204–L330, its git
// strategy worktree/git.ts L8–L37, git.ts L1251–L1291). The checkout here is
// the sandbox workdir, so every git call runs there over the exec transport,
// and a worktree lives under the sandbox user's data directory, in the same
// layout (`<data>/opencode/worktree/<projectID[0..6]>/<name>`, worktree/
// strategies.ts L49–L51).
import { posix } from "node:path";
import { randomBytes } from "node:crypto";
import { sandboxRun } from "./sandbox.ts";

export interface WorktreeEntry {
  directory: string;
  strategy?: string;
  created: number;
}

export class WorktreeError extends Error {}

const run = async (script: string, args: string[], workdir: string) =>
  sandboxRun(["sh", "-c", script, "sh", ...args], workdir);

export class ProjectWorktrees {
  private entries = new Map<string, WorktreeEntry>();
  private seq = 0;

  constructor(private readonly checkout: string) {}

  /** newest first, then by directory (core worktree.ts L134–L143) */
  list(): { directory: string; strategy?: string }[] {
    return [...this.entries.values()]
      .sort((a, b) => b.created - a.created || a.directory.localeCompare(b.directory))
      .map(({ directory, strategy }) => (strategy ? { directory, strategy } : { directory }));
  }

  /** a directory a session may live in: the checkout or one of its worktrees, or below them */
  contains(directory: string): boolean {
    const roots = [this.checkout, ...this.entries.keys()];
    return roots.some((root) => directory === root || directory.startsWith(`${root}/`));
  }

  /** the most specific known root (the checkout or a linked worktree) holding a
   * sandbox directory; undefined for a host directory or any unknown path */
  rootOf(directory: string): string | undefined {
    let best: string | undefined;
    for (const root of [this.checkout, ...this.entries.keys()]) {
      if ((directory === root || directory.startsWith(`${root}/`)) && (best === undefined || root.length > best.length)) best = root;
    }
    return best;
  }

  /** the checkout a session-scoped read of `directory` runs in: its root, else the main checkout */
  checkoutFor(directory: string): string {
    return this.rootOf(directory) ?? this.checkout;
  }

  /** rediscover the checkout and its linked worktrees (`git worktree list --porcelain`);
   * true when the set changed */
  async refresh(): Promise<boolean> {
    const res = await run('git -C "$1" worktree list --porcelain 2>/dev/null', [this.checkout], this.checkout);
    const found = (res?.code === 0 ? res.stdout : "")
      .split("\n")
      .filter((l) => l.startsWith("worktree "))
      // the first entry is the checkout itself, under the name the bridge serves it by
      .map((l, i) => (i === 0 ? { directory: this.checkout, strategy: undefined } : { directory: l.slice("worktree ".length).trim(), strategy: "git" }));
    const before = JSON.stringify(this.list());
    // the checkout itself is always an unowned root (core worktree.ts L287–L291)
    const roots = found.length ? found : [{ directory: this.checkout, strategy: undefined }];
    const live = new Set(roots.map((r) => r.directory));
    for (const dir of [...this.entries.keys()]) if (!live.has(dir)) this.entries.delete(dir);
    for (const r of roots) {
      const existing = this.entries.get(r.directory);
      if (existing) existing.strategy = r.strategy ?? existing.strategy;
      else this.entries.set(r.directory, { directory: r.directory, strategy: r.strategy, created: Date.now() + this.seq++ });
    }
    return JSON.stringify(this.list()) !== before;
  }

  /** `git worktree add --detach` under the data directory, suffixing a taken name */
  async create(input: { projectID: string; name?: string; branch?: string; from?: string }): Promise<{ directory: string }> {
    const name = (input.name ?? "").trim() || `worktree-${randomBytes(3).toString("hex")}`;
    if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new WorktreeError(`Invalid worktree name: ${name}`);
    const source = input.from ?? this.checkout;
    if (!this.contains(source)) throw new WorktreeError(`Worktree source not found: ${source}`);
    const script = `
base="\${XDG_DATA_HOME:-$HOME/.local/share}/opencode/worktree/$2"
mkdir -p "$base" || exit 3
dir="$base/$3"; n=1
while [ -e "$dir" ]; do n=$((n+1)); [ $n -gt 10 ] && exit 4; dir="$base/$3-$n"; done
git -C "$1" rev-parse --verify --quiet HEAD >/dev/null || exit 5
git -C "$1" worktree add -q --detach -- "$dir" "$4" >&2 || exit 6
cd "$dir" && pwd -P`;
    const res = await run(script, [source, input.projectID.slice(0, 6), name, input.branch ?? "HEAD"], this.checkout);
    if (!res) throw new WorktreeError("no sandbox to create a worktree in");
    if (res.code === 4) throw new WorktreeError(`Worktree destination exists: ${name}`);
    if (res.code === 5) throw new WorktreeError(`Worktree source not found: ${source}`);
    if (res.code !== 0) throw new WorktreeError(`Worktree strategy git failed to create: exit ${res.code}`);
    const directory = posix.normalize(res.stdout.trim());
    this.entries.set(directory, { directory, strategy: "git", created: Date.now() + this.seq++ });
    return { directory };
  }

  async remove(directory: string, force: boolean): Promise<void> {
    const entry = this.entries.get(directory);
    if (!entry?.strategy) throw new WorktreeError(`Not a managed worktree: ${directory}`);
    const res = await run(`git -C "$1" worktree remove ${force ? "--force " : ""}"$1"`, [directory], this.checkout);
    if (res?.code !== 0) throw new WorktreeError(`Worktree strategy git failed to remove: ${directory}`);
    this.entries.delete(directory);
  }
}
