// Maki's session title rule (maki-storage/src/sessions.rs v0.6.5 L672–L695):
// the first user text, whitespace collapsed, kept whole up to 60 bytes, else
// cut at a word boundary past the midpoint (or the last char boundary) + "…".
const MAX_TITLE_LEN = 60;

export function makiTitle(text: string): string | undefined {
  const normalized = text.trim().split(/\s+/).filter(Boolean).join(" ");
  if (!normalized) return undefined;
  const bytes = Buffer.from(normalized, "utf8");
  if (bytes.length <= MAX_TITLE_LEN) return normalized;
  // floor_char_boundary: back off continuation bytes (10xxxxxx)
  let boundary = MAX_TITLE_LEN;
  while (boundary > 0 && (bytes[boundary]! & 0xc0) === 0x80) boundary--;
  const truncated = bytes.subarray(0, boundary).toString("utf8");
  const pos = Buffer.from(truncated, "utf8").lastIndexOf(0x20);
  if (pos > MAX_TITLE_LEN / 2) return `${Buffer.from(truncated, "utf8").subarray(0, pos).toString("utf8")}…`;
  return `${truncated}…`;
}
