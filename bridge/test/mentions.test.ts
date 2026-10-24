// The prompt-attachment readers (mentions.ts): which mention URIs map onto the
// sandbox workdir, and the pinned mime detection.
import { expect, test } from "bun:test";
import { detectMime, mentionTarget } from "../src/mentions.ts";

test("a file:// mention under the client's directory maps onto the workdir", () => {
  expect(mentionTarget("file:///Users/me/proj/src/a%20b.ts?start=3&end=5", "/Users/me/proj", "/sandbox/proj")).toEqual({ path: "/sandbox/proj/src/a b.ts", start: 3, end: 5 });
  expect(mentionTarget("file:///Users/me/proj", "/Users/me/proj", "/sandbox/proj")).toEqual({ path: "/sandbox/proj", start: undefined, end: undefined });
  for (const uri of ["file:///Users/me/proj/../other/x", "file:///Users/me/project2/x", "file:///etc/passwd", "https://example.com/x", "not a uri"]) {
    expect(mentionTarget(uri, "/Users/me/proj", "/sandbox/proj")).toBeNull();
  }
});

test("mime detection follows the pinned detector", () => {
  expect(detectMime(Buffer.from("plain text\n"))).toBe("text/plain");
  expect(detectMime(new Uint8Array())).toBe("text/plain");
  expect(detectMime(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
  expect(detectMime(Buffer.from("%PDF-1.4"))).toBe("application/pdf");
  expect(detectMime(Uint8Array.from([0x61, 0, 0x62]))).toBe("application/octet-stream");
  expect(detectMime(Uint8Array.from([0xc3, 0x28]))).toBe("application/octet-stream");
});
