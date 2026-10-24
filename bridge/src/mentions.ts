// A prompt's file attachments (tui component/prompt/autocomplete.tsx v2.0.32
// L243–L272 mentions a project file as a `file://` URI; a paste of an image
// is a data URI). OpenCode reads a mentioned path itself (core
// session/prompt.ts v2.0.32 L151–L203) and hands the model a text file as
// "Attached file: <name>" text, a directory as its listing, and an image as a
// media block (session/runner/to-llm-message.ts L37–L83). The project lives in
// the sandbox workdir, so a mentioned path under the client's directory is
// read there, over the exec transport — never on the host — and reaches the
// pinned child as the text and image blocks its inbound `user` decodes
// (sdk_mode.rs v0.6.4 L786–L816; text blocks join with a newline).
import { posix } from "node:path";
import type { ContentBlock } from "./maki.ts";
import { sandboxRun } from "./sandbox.ts";

type AnyObj = Record<string, any>;

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const IMAGE_DATA_URI = /^data:(image\/(?:png|jpeg|gif|webp));base64,((?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)$/;

// prints `D` and the entries of a directory, or `F` and a file's bytes in
// base64; nothing for a missing or oversized path
const READ_SCRIPT = `p=$1
if [ -d "$p" ]; then echo D; ls -1Ap -- "$p"
elif [ -f "$p" ] && [ "$(wc -c < "$p")" -le ${MAX_ATTACHMENT_BYTES} ]; then echo F; base64 < "$p"
fi`;

/** a mention's sandbox path and line range, or null when the URI is not a
 * `file://` path under the client's directory */
export function mentionTarget(uri: string, clientDir: string, workdir: string): { path: string; start?: number; end?: number } | null {
  const url = URL.parse(uri);
  if (url?.protocol !== "file:") return null;
  const line = (v: string | null) => (v !== null && /^[1-9][0-9]*$/.test(v) ? Number(v) : undefined);
  const start = line(url.searchParams.get("start"));
  const end = line(url.searchParams.get("end"));
  let abs: string;
  try {
    abs = posix.normalize(decodeURIComponent(url.pathname));
  } catch {
    return null;
  }
  const base = posix.normalize(clientDir);
  const inside = abs === base || abs.startsWith(base === "/" ? "/" : `${base}/`);
  if (!inside) return null;
  return { path: posix.join(workdir, abs.slice(base.length)), start, end };
}

/** the pinned Mime.detect (core mime.ts v2.0.32 L3–L33) for the kinds a
 * mention can deliver */
export function detectMime(bytes: Uint8Array): string {
  const starts = (prefix: number[], at = 0) => prefix.every((v, i) => bytes[at + i] === v);
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts([0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (starts([0x42, 0x4d])) return "image/bmp";
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  if (bytes.length === 0) return "text/plain";
  if (bytes.includes(0)) return "application/octet-stream";
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return "application/octet-stream";
  }
  const controls = bytes.reduce((n, b) => n + Number(b < 9 || (b > 13 && b < 32)), 0);
  return controls / bytes.length <= 0.3 ? "text/plain" : "application/octet-stream";
}

/** the delivered attachment (the pinned Prompt.FileAttachment) and what the
 * child is sent for it */
export interface Attachment {
  delivered: AnyObj;
  blocks: ContentBlock[];
}

const named = (file: AnyObj, extra: AnyObj = {}): AnyObj => ({
  ...extra,
  ...(typeof file.name === "string" ? { name: file.name } : {}),
  ...(typeof file.description === "string" ? { description: file.description } : {}),
  ...(file.mention && typeof file.mention === "object" ? { mention: file.mention } : {}),
});

function textBlock(kind: "file" | "directory", label: string, file: AnyObj, body: string): ContentBlock {
  const lines = [`Attached ${kind}: ${label}`];
  if (typeof file.description === "string") lines.push(`Description: ${file.description}`);
  if (kind === "file" || body) lines.push("", body);
  return { type: "text", text: `\n\n${lines.join("\n")}` };
}

export async function readAttachment(file: AnyObj, clientDir: string, workdir: string): Promise<Attachment | null> {
  const uri = typeof file?.uri === "string" ? file.uri : "";
  const image = IMAGE_DATA_URI.exec(uri);
  if (image && image[2]) {
    return {
      delivered: named(file, { data: image[2], mime: image[1], source: { type: "inline" } }),
      blocks: [{ type: "image", source: { type: "base64", media_type: image[1]!, data: image[2] } }],
    };
  }
  const target = mentionTarget(uri, clientDir, workdir);
  if (!target) return null;
  const res = await sandboxRun(["sh", "-c", READ_SCRIPT, "sh", target.path], workdir);
  if (res?.code !== 0) return null;
  const [kind, ...rest] = res.stdout.split("\n");
  const source = { type: "uri", uri };
  const name = typeof file.name === "string" ? file.name : posix.basename(target.path);
  if (kind === "D") {
    const entries = rest.filter(Boolean).sort((a, b) => {
      const da = a.endsWith("/"), db = b.endsWith("/");
      return da === db ? a.replace(/\/$/, "").localeCompare(b.replace(/\/$/, "")) : da ? -1 : 1;
    });
    const listing = entries.join("\n");
    return {
      delivered: named(file, { data: Buffer.from(listing).toString("base64"), mime: "application/x-directory", source, name }),
      blocks: [textBlock("directory", target.path, file, listing)],
    };
  }
  if (kind !== "F") return null;
  let bytes: Uint8Array = Buffer.from(rest.join(""), "base64");
  const mime = detectMime(bytes);
  if (mime === "text/plain" && target.start !== undefined) {
    bytes = Buffer.from(Buffer.from(bytes).toString("utf8").split("\n").slice(target.start - 1, target.end).join("\n"));
  }
  const data = Buffer.from(bytes).toString("base64");
  const delivered = named(file, { data, mime, source, name });
  if (mime === "text/plain") return { delivered, blocks: [textBlock("file", name, file, Buffer.from(bytes).toString("utf8"))] };
  if (IMAGE_MIMES.has(mime)) {
    return { delivered, blocks: [{ type: "text", text: `Attached file: ${target.path}` }, { type: "image", source: { type: "base64", media_type: mime, data } }] };
  }
  // a PDF or other binary has no block on the pinned inbound wire
  return null;
}
