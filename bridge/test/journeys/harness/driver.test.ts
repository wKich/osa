import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSteps, startPty } from "./driver.ts";
import { checkpoint, pause, restart, type, waitFor } from "./journey.ts";

const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", TERM: "xterm-256color" };

describe("driver", () => {
  test("drives a shell through a scripted wait and snapshots the screen", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "maki-driver-"));
    const pty = await startPty({
      command: ["/bin/sh", "-c", "printf 'ready\\n'; read x; printf 'got %s\\n' \"$x\""],
      cwd,
      env,
    });
    try {
      const snapshots = new Map<string, string>();
      await runSteps(
        {
          slug: "driver-test",
          side: "reference",
          pty,
          onCheckpoint: (id, text) => snapshots.set(id, text),
        },
        [waitFor(/ready/), type("hello\n"), checkpoint("answer", waitFor(/got hello/))],
      );
      expect(snapshots.get("answer")).toContain("got hello");
    } finally {
      await pty.close();
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("a pause waits its time while the screen keeps changing", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "maki-driver-"));
    // a ticking screen never settles, as a pending call's spinner does not
    const pty = await startPty({ command: ["/bin/sh", "-c", "i=0; while :; do i=$((i+1)); printf 'tick %s\\r' $i; sleep 0.05; done"], cwd, env });
    try {
      const snapshots = new Map<string, string>();
      const started = Date.now();
      await runSteps(
        { slug: "driver-test", side: "reference", pty, onCheckpoint: (id, text) => snapshots.set(id, text) },
        [waitFor(/tick/), pause(600), checkpoint("after", waitFor(/tick/))],
      );
      expect(Date.now() - started).toBeGreaterThanOrEqual(600);
      expect(snapshots.get("after")).toContain("tick");
    } finally {
      await pty.close();
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("restart swaps the PTY and later steps read the new screen", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "maki-driver-"));
    let pty = await startPty({ command: ["/bin/sh", "-c", "printf 'one\\n'; sleep 5"], cwd, env });
    const first = pty;
    try {
      const snapshots = new Map<string, string>();
      await runSteps(
        {
          slug: "restart-test",
          side: "maki",
          pty,
          restart: async () => {
            await pty.close();
            pty = await startPty({ command: ["/bin/sh", "-c", "printf 'two\\n'; sleep 5"], cwd, env });
            return pty;
          },
          onCheckpoint: (id, text) => snapshots.set(id, text),
        },
        [waitFor(/one/), restart(), checkpoint("after", waitFor(/two/))],
      );
      expect(snapshots.get("after")).toContain("two");
      expect(snapshots.get("after")).not.toContain("one");
      expect(pty).not.toBe(first);
    } finally {
      await pty.close();
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("missing screen text fails with the journey, side, and step name", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "maki-driver-"));
    const pty = await startPty({ command: ["/bin/sh", "-c", "printf 'ready\\n'; sleep 5"], cwd, env });
    try {
      await expect(
        runSteps(
          {
            slug: "driver-test",
            side: "maki",
            pty,
            onCheckpoint: () => undefined,
          },
          [waitFor(/ready/), checkpoint("never", waitFor(/does-not-exist/, { timeoutMs: 300 }))],
        ),
      ).rejects.toThrow(/driver-test.*maki.*never.*300ms/);
    } finally {
      await pty.close();
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
