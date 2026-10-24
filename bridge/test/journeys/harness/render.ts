// Headless terminal renderer (design decision 5): consume the PTY byte stream
// at the requested size and read back the visible screen as plain text.
import { Terminal } from "@xterm/headless";

export interface Screen {
  feed(data: Uint8Array): void;
  text(): Promise<string>;
  reset(): void;
}

export function createScreen(cols = 120, rows = 40): Screen {
  const term = new Terminal({ cols, rows, allowProposedApi: true });
  let pending: Promise<void> = Promise.resolve();

  const write = (data: Uint8Array | string): Promise<void> =>
    new Promise((resolve) => term.write(data, resolve));

  return {
    feed(data) {
      pending = pending.then(() => write(data));
    },
    async text() {
      await pending;
      // An empty write drains everything queued before it.
      await write("");
      const lines: string[] = [];
      for (let row = 0; row < rows; row++) {
        lines.push((term.buffer.active.getLine(row)?.translateToString(true) ?? "").trimEnd());
      }
      while (lines.length && lines[lines.length - 1] === "") lines.pop();
      return lines.join("\n");
    },
    reset() {
      term.reset();
    },
  };
}
