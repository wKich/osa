// Two live sessions behind one bridge (spec: "Maintain one Maki session
// behind one OpenCode session"): the registry must keep each session's child
// and transcript apart. Every other session test drives a single session, so
// cross-talk — a prompt rendering into the wrong transcript, or a delete
// killing the wrong child — would pass the suite.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sleep, startBridge, waitFor, type BridgeHandle } from "./lib/bridge.ts";

/** direct scripted maki children of the bridge process, one per session; the
 * bridge's short-lived sandbox reads (skills, git) are its children too */
async function children(pid: number): Promise<number[]> {
  const proc = Bun.spawn(["pgrep", "-P", String(pid), "-f", "fake-maki"], { stdout: "pipe", stderr: "ignore" });
  await proc.exited;
  const out = await new Response(proc.stdout).text();
  return out.split("\n").map((l) => Number(l.trim())).filter(Boolean);
}

async function waitChildren(pid: number, n: number): Promise<number[]> {
  let found: number[] = [];
  for (let i = 0; i < 80; i++) {
    found = await children(pid);
    if (found.length >= n) break;
    await sleep(250);
  }
  return found;
}

function alive(pid: number): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function post(b: BridgeHandle, path: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(b.base + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: res.status === 204 ? null : await res.json().catch(() => null) };
}

const promptBody = (text: string) => ({ text, files: [], agents: [], delivery: "steer" });

describe("two sessions behind one bridge", () => {
  let bridge: BridgeHandle;
  let a = "";
  let b = "";
  let pidA = 0;
  let pidB = 0;

  /** frames emitted for one session only (the SSE subscriber sees both) */
  const inSession = (sid: string, type?: string) =>
    bridge.frames.filter((f) => f.data?.sessionID === sid && (!type || f.type === type));

  beforeAll(async () => {
    bridge = await startBridge();
    const first = await post(bridge, "/api/session", { location: { directory: bridge.workdir } });
    expect(first.status).toBe(200);
    a = first.json.data.id;
    pidA = (await waitChildren(bridge.pid, 1))[0] ?? 0;
    expect(pidA).toBeGreaterThan(0);

    const second = await post(bridge, "/api/session", { location: { directory: bridge.workdir } });
    expect(second.status).toBe(200);
    b = second.json.data.id;
    expect(b).not.toBe(a);
    const kids = await waitChildren(bridge.pid, 2);
    pidB = kids.find((p) => p !== pidA) ?? 0;
    expect(pidB).toBeGreaterThan(0);
  });

  afterAll(async () => {
    await bridge?.stop();
    for (let i = 0; i < 40 && (alive(pidA) || alive(pidB)); i++) await sleep(250);
    expect(alive(pidA)).toBe(false);
    expect(alive(pidB)).toBe(false);
  });

  test("concurrent turns render only into their own session", async () => {
    const doneA = inSession(a, "session.execution.succeeded").length;
    const doneB = inSession(b, "session.execution.succeeded").length;
    // both prompts in flight at once: two children, two translators
    const [sentA, sentB] = await Promise.all([
      post(bridge, `/api/session/${a}/prompt`, { id: "msg_isolation0000000001", ...promptBody("Reply with the word PONG only.") }),
      post(bridge, `/api/session/${b}/prompt`, { id: "msg_isolation0000000002", ...promptBody("Reply with the word PONG only.") }),
    ]);
    expect(sentA.status).toBe(200);
    expect(sentB.status).toBe(200);
    expect(
      await waitFor(
        () =>
          inSession(a, "session.execution.succeeded").length > doneA &&
          inSession(b, "session.execution.succeeded").length > doneB,
        30_000,
      ),
    ).toBe(true);

    // each user prompt appears once, in its own transcript
    expect(inSession(a, "session.inbox.enqueued").map((f) => f.data?.inboxID)).toEqual(["msg_isolation0000000001"]);
    expect(inSession(b, "session.inbox.enqueued").map((f) => f.data?.inboxID)).toEqual(["msg_isolation0000000002"]);
    // and each transcript carries exactly its own response
    expect(inSession(a, "session.text.ended").map((f) => f.data?.text)).toEqual(["PONG"]);
    expect(inSession(b, "session.text.ended").map((f) => f.data?.text)).toEqual(["PONG"]);
    // no frame is scoped to a session the bridge does not know
    const scoped = bridge.frames.filter((f) => typeof f.data?.sessionID === "string");
    expect(scoped.every((f) => f.data.sessionID === a || f.data.sessionID === b)).toBe(true);
  }, 60_000);

  test("deleting one session kills only its own child and spares the other", async () => {
    const del = await fetch(`${bridge.base}/api/session/${a}`, { method: "DELETE" });
    expect(del.status).toBe(204);
    expect(await waitFor(() => !alive(pidA), 10_000)).toBe(true);
    expect(alive(pidB)).toBe(true);

    const gone = await fetch(`${bridge.base}/api/session/${a}`);
    expect(gone.status).toBe(404);
    expect((await gone.json())._tag).toBe("SessionNotFoundError");

    const doneB = inSession(b, "session.execution.succeeded").length;
    const sent = await post(bridge, `/api/session/${b}/prompt`, { id: "msg_isolation0000000003", ...promptBody("Reply with the word PONG only.") });
    expect(sent.status).toBe(200);
    expect(await waitFor(() => inSession(b, "session.execution.succeeded").length > doneB, 30_000)).toBe(true);
  }, 60_000);
});
