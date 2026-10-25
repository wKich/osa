// A Maki edit's file diff, for the TUI's `← Edit` block (tui routes/session/
// index.tsx v2.1.4 L3443–L3494, which renders `metadata.files[].patch`).
// Maki computes its own before/after but the pinned SDK drops it with the
// ToolDone event (sdk_mode.rs v0.6.5 L1052–L1054; plugins/edit/init.lua
// L224–L230), so the bridge reads the edited file back from the sandbox and
// undoes the one replacement it can locate exactly. The patch has the shape
// OpenCode's edit tool reports (core tool/plugin/file-diff.ts v2.1.4 L4–L22,
// jsdiff createTwoFilesPatch with 4 context lines).
import type { AnyObj } from "./spec-answers.ts";

/** the file before a single replacement, when `after` holds the new text
 * exactly once; undefined when the edit cannot be undone unambiguously */
export function undoEdit(after: string, input: AnyObj): string | undefined {
  const oldText = input?.old_string;
  const newText = input?.new_string;
  if (typeof oldText !== "string" || typeof newText !== "string" || !newText || oldText === newText) return undefined;
  const at = after.indexOf(newText);
  if (at < 0 || after.indexOf(newText, at + 1) >= 0) return undefined;
  return after.slice(0, at) + oldText + after.slice(at + newText.length);
}

const CONTEXT = 4;

function lines(text: string): { lines: string[]; eol: boolean } {
  const eol = text.endsWith("\n");
  const body = eol ? text.slice(0, -1) : text;
  return { lines: body === "" && !eol ? [] : body.split("\n"), eol };
}

/** a unified patch of one contiguous change, with counts, as FileDiff.Info */
export function fileDiff(file: string, before: string, after: string): { file: string; patch: string; additions: number; deletions: number; status: "modified" } {
  const a = lines(before);
  const b = lines(after);
  let head = 0;
  while (head < a.lines.length && head < b.lines.length && a.lines[head] === b.lines[head]) head++;
  let tail = 0;
  while (
    tail < a.lines.length - head && tail < b.lines.length - head &&
    a.lines[a.lines.length - 1 - tail] === b.lines[b.lines.length - 1 - tail]
  ) tail++;
  // a changed final newline is a change to the last line
  if (a.eol !== b.eol && tail > 0) tail--;
  const removed = a.lines.slice(head, a.lines.length - tail);
  const added = b.lines.slice(head, b.lines.length - tail);
  const header = `Index: ${file}\n===================================================================\n--- ${file}\n+++ ${file}\n`;
  if (removed.length === 0 && added.length === 0) return { file, patch: header, additions: 0, deletions: 0, status: "modified" };
  const start = Math.max(0, head - CONTEXT);
  const before0 = a.lines.slice(start, head);
  const afterCtx = a.lines.slice(a.lines.length - tail, Math.min(a.lines.length, a.lines.length - tail + CONTEXT));
  const oldCount = before0.length + removed.length + afterCtx.length;
  const newCount = before0.length + added.length + afterCtx.length;
  const range = (from: number, count: number) => `${count === 0 ? from : from + 1},${count}`;
  const body: string[] = [];
  const noEol = "\\ No newline at end of file";
  before0.forEach((l) => body.push(` ${l}`));
  removed.forEach((l, i) => {
    body.push(`-${l}`);
    if (!a.eol && head + i === a.lines.length - 1) body.push(noEol);
  });
  added.forEach((l, i) => {
    body.push(`+${l}`);
    if (!b.eol && head + i === b.lines.length - 1) body.push(noEol);
  });
  afterCtx.forEach((l, i) => {
    body.push(` ${l}`);
    if (!a.eol && a.lines.length - tail + i === a.lines.length - 1) body.push(noEol);
  });
  const patch = `${header}@@ -${range(start, oldCount)} +${range(start, newCount)} @@\n${body.join("\n")}\n`;
  return { file, patch, additions: added.length, deletions: removed.length, status: "modified" };
}
