#!/usr/bin/env bun
// Scripted discovery pass (design decision 7): a repeatable API-level
// explorational matrix against the bridge. Each scenario compares what the
// current build does with what it should do; a *new* violation is appended to
// bridge/defects.json — id, title, capture path — and its frames are written
// to bridge/test/captures/ first, so every entry links its evidence. Existing
// entries are never modified: re-running with nothing new is a no-op.
//
//   bun bridge/test/discovery.ts     (from the repository root)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startBridge, sleep, waitFor, type BridgeHandle, type Frame } from "./lib/bridge.ts";

const DEFECTS_PATH = fileURLToPath(new URL("../defects.json", import.meta.url));

interface Defect {
  id: string;
  title: string;
  status: string;
  capture: string;
  [key: string]: unknown;
}

interface Finding {
  id: string;
  title: string;
  /** why the observation violated the expectation (stored in the capture) */
  note: string;
  frames: Frame[];
}

interface ScenarioResult {
  id: string;
  clean: boolean;
  detail: string;
  finding: Finding;
}

const count = (frames: Frame[], type: string) => frames.filter((f) => f.type === type).length;
const lastOfType = (frames: Frame[], type: string) => frames.filter((f) => f.type === type).at(-1);

async function promptTurn(bridge: BridgeHandle, sid: string, seq: number, text: string): Promise<Frame[]> {
  const before = bridge.frames.length;
  const turns = count(bridge.frames, "session.execution.succeeded");
  const res = await fetch(`${bridge.base}/api/session/${sid}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: `msg_discovery${String(seq).padStart(10, "0")}`, text, files: [], agents: [], delivery: "steer" }),
  });
  if (res.status !== 200) throw new Error(`prompt failed: HTTP ${res.status}`);
  const done = await waitFor(() => count(bridge.frames, "session.execution.succeeded") > turns, 30_000);
  if (!done) throw new Error(`turn did not complete: ${text.slice(0, 40)}`);
  return bridge.frames.slice(before);
}

const main = async () => {
  const bridge = await startBridge();
  const results: ScenarioResult[] = [];
  try {
    const created = await fetch(`${bridge.base}/api/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ location: { directory: bridge.workdir } }),
    });
    if (created.status !== 200) throw new Error(`session create failed: HTTP ${created.status}`);
    const sid = (await created.json()).data.id as string;

    // The child announces its model on system.init a few ms after spawn; the
    // real TUI boots long before the composer accepts a prompt, so mirror that
    // here — wait for the announcement, then the turn's expectation is about
    // translation, not scheduling (spec permits synthesis before announcement)
    for (let i = 0; i < 50; i++) {
      const s = (await (await fetch(`${bridge.base}/api/session/${sid}`)).json())?.data;
      if (s?.model?.providerID === "synthetic") break;
      await sleep(100);
    }

    // --- 1. multi-turn Q-A-Q-A ordering -----------------------------------
    // Expectation: a frame represents each user prompt before the assistant
    // output it caused, so the transcript interleaves Q-A-Q-A across turns.
    const turn1 = await promptTurn(bridge, sid, 1, "Reply with the word PONG only.");
    const turn2 = await promptTurn(bridge, sid, 2, "Reply with the word PONG one more time.");
    const bothTurns = [...turn1, ...turn2];
    const userFrames = bothTurns.filter(
      (f) => f.type === "session.inbox.enqueued" && f.data?.item?.type === "user",
    );
    results.push({
      id: "message-order-inversion",
      clean: userFrames.length >= 2,
      detail:
        userFrames.length >= 2
          ? `user prompt frames observed (${userFrames.length})`
          : "no frame represents the user's prompt; the TUI renders A-A-A-Q-Q-Q",
      finding: {
        id: "message-order-inversion",
        title: "User prompts render after assistant responses (A-A-A-Q-Q-Q)",
        note: "expected one session.inbox.enqueued (item type user) per prompt before its assistant frames; none were emitted across two turns",
        frames: bothTurns,
      },
    });

    // --- 2. status-line model name ----------------------------------------
    // Expectation: session events carry the model the maki child announced on
    // its system.init (the scripted child reports `synthetic/fake`, parsed
    // provider/id on the first "/" per design decision 3; a live child reports
    // maki's -m value) — not a synthesized placeholder.
    const stepStarted = bothTurns.filter((f) => f.type === "session.step.started");
    const wrongModel = stepStarted.filter(
      (f) => f.data?.model?.providerID !== "synthetic" || f.data?.model?.id !== "fake",
    );
    results.push({
      id: "synthesized-model-name",
      clean: stepStarted.length > 0 && wrongModel.length === 0,
      detail:
        stepStarted.length === 0
          ? "no session.step.started frames observed"
          : wrongModel.length === 0
            ? `model reported on every step.started (${stepStarted.length})`
            : `model ${JSON.stringify(wrongModel[0].data?.model)} instead of the child's announced {providerID:"synthetic", id:"fake"}`,
      finding: {
        id: "synthesized-model-name",
        title: "Status line shows a synthesized model name instead of Maki's real model",
        note: "expected session.step.started model to be the child's announced model (provider/id split on first '/'); the bridge answers from the pinned spec by synthesis",
        frames: stepStarted,
      },
    });

    // --- 3. tool error rows ------------------------------------------------
    // Expectation: a failing tool call renders a session.tool.failed row with
    // the spec {type, message} error shape.
    const toolFrames = await promptTurn(
      bridge,
      sid,
      3,
      "Use your shell tool to run exactly: false . Then reply with the single word DONE.",
    );
    const failedRows = toolFrames.filter((f) => f.type === "session.tool.failed");
    const rowOk =
      failedRows.length > 0 &&
      failedRows.every((f) => f.data?.error?.type === "Error" && typeof f.data?.error?.message === "string");
    results.push({
      id: "tool-error-rows",
      clean: rowOk,
      detail: rowOk
        ? `${failedRows.length} tool.failed row(s) with the spec error shape`
        : `expected tool.failed rows with {type,message}, got ${JSON.stringify(failedRows.map((f) => f.type))}`,
      finding: {
        id: "tool-error-rows",
        title: "Failing tool call does not render a spec-shaped error row",
        note: 'expected session.tool.failed with error {type: "Error", message: string}',
        frames: toolFrames,
      },
    });

    // --- 4. permission prompts ---------------------------------------------
    // Expectation: a gated call surfaces permission.asked with a minted per_
    // id, and a reject reply denies the call on the child's stdin.
    const asksBefore = count(bridge.frames, "permission.asked");
    const failedBefore = count(bridge.frames, "session.tool.failed");
    const turnsBefore = count(bridge.frames, "session.execution.succeeded");
    const permStart = bridge.frames.length;
    const askSent = await fetch(`${bridge.base}/api/session/${sid}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "msg_discovery0000000004",
        text: `Use your shell tool to run exactly: rm -f ${bridge.workdir}/discovery-probe.txt . Then reply with the single word DONE.`,
        files: [],
        agents: [],
        delivery: "steer",
      }),
    });
    if (askSent.status !== 200) throw new Error(`prompt failed: HTTP ${askSent.status}`);
    const gotAsk = await waitFor(() => count(bridge.frames, "permission.asked") > asksBefore, 20_000);
    const ask = lastOfType(bridge.frames, "permission.asked");
    let permOk = gotAsk && /^per_/.test(String(ask?.data?.id));
    let permDetail = permOk
      ? `permission.asked with minted id ${ask?.data?.id}`
      : `expected permission.asked with a per_ id, got ${gotAsk ? String(ask?.data?.id) : "no ask within 20s"}`;
    if (permOk) {
      const reply = await fetch(`${bridge.base}/api/session/${sid}/permission/${ask!.data.id}/reply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "reject" }),
      });
      const denied = await waitFor(() => count(bridge.frames, "session.tool.failed") > failedBefore, 20_000);
      const denial = lastOfType(bridge.frames, "session.tool.failed");
      const deniedMsg = String(denial?.data?.error?.message ?? "");
      permOk = reply.status === 204 && denied && /denied/i.test(deniedMsg);
      permDetail = `reply ${reply.status}; ${denied ? `denied: ${deniedMsg.slice(0, 60)}` : "no tool.failed after the reject"}`;
    }
    const turnDone = await waitFor(
      () => count(bridge.frames, "session.execution.succeeded") > turnsBefore,
      30_000,
    );
    if (!turnDone) permOk = false;
    results.push({
      id: "permission-prompt-round-trip",
      clean: permOk,
      detail: permDetail,
      finding: {
        id: "permission-prompt-round-trip",
        title: "Permission prompt round trip did not behave as specified",
        note: "expected permission.asked with a minted per_ id, a 204 reject reply, a denied tool row, and a completed turn",
        frames: bridge.frames.slice(permStart),
      },
    });

    // --- 5. session delete/recreate ----------------------------------------
    const del = await fetch(`${bridge.base}/api/session/${sid}`, { method: "DELETE" });
    const gone = await fetch(`${bridge.base}/api/session/${sid}`);
    const recreated = await fetch(`${bridge.base}/api/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ location: { directory: bridge.workdir } }),
    });
    const newId = recreated.status === 200 ? ((await recreated.json()).data.id as string) : "";
    const recreateOk =
      del.status === 204 && gone.status === 404 && /^ses_/.test(newId) && newId !== sid;
    results.push({
      id: "session-delete-recreate",
      clean: recreateOk,
      detail: recreateOk
        ? `delete ${del.status}, read-back ${gone.status}, recreated ${newId}`
        : `delete ${del.status}, read-back ${gone.status}, recreate ${recreated.status} (${newId})`,
      finding: {
        id: "session-delete-recreate",
        title: "Session delete/recreate did not behave as specified",
        note: `expected delete 204, read-back 404, and a fresh ses_ id; got delete ${del.status}, read-back ${gone.status}, recreate ${recreated.status}`,
        frames: [],
      },
    });
  } finally {
    await bridge.stop();
  }

  // --- report: dedupe against the inventory, append only what is new -------
  const current: Defect[] = JSON.parse(readFileSync(DEFECTS_PATH, "utf8"));
  const have = new Set(current.map((d) => d.id));
  let appended = 0;
  let deduped = 0;
  mkdirSync(fileURLToPath(new URL("./captures/", import.meta.url)), { recursive: true });
  for (const r of results) {
    if (r.clean) {
      console.log(`ok      ${r.id} — ${r.detail}`);
      continue;
    }
    if (have.has(r.id)) {
      deduped++;
      console.log(`known   ${r.id} — ${r.detail}`);
      continue;
    }
    const captureName = `defect-${r.id}.jsonl`;
    const lines = [
      JSON.stringify({ scenario: r.id, title: r.finding.title, note: r.finding.note, observed: r.detail }),
      ...r.finding.frames.map((f) => JSON.stringify(f)),
    ];
    writeFileSync(fileURLToPath(new URL(`./captures/${captureName}`, import.meta.url)), lines.join("\n") + "\n");
    current.push({ id: r.id, title: r.finding.title, status: "known", capture: `bridge/test/captures/${captureName}` });
    have.add(r.id);
    appended++;
    console.log(`new     ${r.id} — ${r.detail}`);
  }
  if (appended > 0) {
    writeFileSync(DEFECTS_PATH, JSON.stringify(current, null, 2) + "\n");
  }
  console.log(
    `discovery: ${results.length} scenario(s), ${results.filter((r) => r.clean).length} clean, ` +
      `${deduped} known defect(s) deduped, ${appended} appended`,
  );
};

main().then(
  () => process.exit(0),
  (err) => {
    console.error(`discovery failed: ${err}`);
    process.exit(1);
  },
);
