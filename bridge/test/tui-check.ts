#!/usr/bin/env bun
// Invariants + inventory comparison for the TUI-level capture (design
// decision 6), invoked by tui-discovery.sh after the run:
//   1. a transcript was recorded,
//   2. boot answered without unhandled 404s,
//   3. the composer accepted prompts and a turn rendered,
//   4. the permission dialog round-tripped (ask -> reply 204 -> the gated
//      command actually ran),
//   5. every OPEN inventory entry still reproduces in this capture — while an
//      entry is open the pass records the reproduction instead of failing on
//      it; an entry that no longer reproduces fails so the inventory flips.
//   bun bridge/test/tui-check.ts <transcript> <requests.jsonl> <frames.jsonl> <probe>
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";

const [transcript, requestsPath, framesPath, probe] = process.argv.slice(2);
const failures: string[] = [];
const ok = (msg: string) => console.log(`ok      ${msg}`);
const fail = (msg: string) => {
  failures.push(msg);
  console.log(`FAIL    ${msg}`);
};

interface FrameLine {
  event?: string;
  data?: Record<string, any>;
}
interface RequestLine {
  method: string;
  path: string;
  status: number;
}

const readJsonl = <T>(path: string): T[] => {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T);
};

const frames: FrameLine[] = readJsonl<FrameLine>(framesPath);
const requests = readJsonl<RequestLine>(requestsPath);
// BRIDGE_SSE_LOG lines carry {ts, id, event, data: envelope}; the payload the
// TUI renders is envelope.data
const eventName = (f: FrameLine) => f.event ?? f.data?.type ?? "";
const payload = (f: FrameLine) => f.data?.data ?? {};

// --- 1. transcript recorded -------------------------------------------------
if (!existsSync(transcript)) {
  fail(`no transcript at ${transcript}`);
} else {
  const bytes = statSync(transcript).size;
  if (bytes < 1000) fail(`transcript is implausibly small: ${bytes} bytes`);
  else ok(`transcript recorded (${bytes} bytes)`);
}

// --- 2. no unhandled route during boot --------------------------------------
if (requests.length === 0) {
  fail(`no request log at ${requestsPath}`);
} else {
  const unhandled = requests.filter((r) => r.status === 404);
  if (unhandled.length) fail(`unhandled 404s: ${unhandled.map((r) => `${r.method} ${r.path}`).join(", ")}`);
  else ok(`boot and turn requests served without 404 (${requests.length} requests)`);
}

// --- 3. composer accepted prompts; a turn rendered --------------------------
const starts = frames.filter((f) => eventName(f) === "session.execution.started");
const pong = frames.find(
  (f) => eventName(f) === "session.text.ended" && payload(f).text === "PONG",
);
if (starts.length < 2) fail(`expected >=2 prompt turns, saw ${starts.length} session.execution.started`);
else if (!pong) fail("no PONG text frame: the first prompt did not render");
else ok(`composer accepted ${starts.length} prompts; PONG rendered`);

// --- 4. permission dialog round trip ----------------------------------------
const ask = frames.find((f) => eventName(f) === "permission.asked");
const reply = requests.find((r) => /\/permission\/[^/]+\/reply$/.test(r.path));
if (!ask) fail("no permission.asked frame: the gated prompt never asked");
if (!reply || reply.status !== 204) fail(`no 204 permission reply in the log (got ${reply ? reply.status : "none"})`);
if (existsSync(probe)) fail(`probe still exists: the accepted command did not run (${probe})`);
if (ask && reply?.status === 204 && !existsSync(probe)) {
  ok("permission dialog round-tripped: ask -> 204 reply -> gated command ran");
  rmSync(probe, { force: true });
}

// --- 5. every open inventory entry still reproduces -------------------------
interface Defect {
  id: string;
  status: string;
}
const defects: Defect[] = JSON.parse(readFileSync(new URL("../defects.json", import.meta.url), "utf8"));
const open = defects.filter((d) => d.status === "known");

const reproduces: Record<string, () => { reproduced: boolean; detail: string }> = {
  // cause as measured: the frame stream carried assistant-side frames only,
  // so no frame represented the user's submitted prompt (the real server
  // emits session.inbox.enqueued; see fix-bridge-transcript-defects evidence)
  "message-order-inversion": () => {
    const userFrames = frames.filter(
      (f) => eventName(f) === "session.inbox.enqueued" && payload(f).item?.type === "user",
    );
    return {
      reproduced: userFrames.length === 0,
      detail:
        userFrames.length === 0
          ? "no user-prompt frame in the capture (transcript renders A-A-A-Q-Q-Q)"
          : `${userFrames.length} user-prompt frame(s) present`,
    };
  },
  // cause as measured: session events carry the spec-synthesized model
  "synthesized-model-name": () => {
    const steps = frames.filter((f) => eventName(f) === "session.step.started");
    const synthesized = steps.filter((f) => payload(f).model?.id === "sample");
    return {
      reproduced: steps.length > 0 && synthesized.length > 0,
      detail:
        synthesized.length > 0
          ? `step.started reports the synthesized model "sample" (${synthesized.length}/${steps.length} turns)`
          : `no step.started carries the synthesized model (${steps.length} turns)`,
    };
  },
};

let recorded = 0;
for (const defect of open) {
  const check = reproduces[defect.id];
  if (!check) {
    console.log(`note    ${defect.id}: no TUI-level expectation — recorded, not compared`);
    continue;
  }
  const { reproduced, detail } = check();
  if (reproduced) {
    recorded++;
    console.log(`known   ${defect.id} reproduces: ${detail}`);
  } else {
    fail(
      `${defect.id} no longer reproduces — flip its status to "fixed" in bridge/defects.json, ` +
        `drop the expected-failure marker, and run make compat (bridge/test/README.md); saw: ${detail}`,
    );
  }
}

if (failures.length) {
  console.log(`tui-check: FAILED (${failures.length})`);
  process.exit(1);
}
console.log(`tui-check: PASS — invariants hold, ${recorded} open defect(s) recorded from this capture`);
