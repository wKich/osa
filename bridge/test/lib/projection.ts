// Golden harness (design decision 2/3): replay a recorded maki jsonl fixture
// through the shipped Translator and project the emitted frames to a stable
// shape — ids and timestamps stripped, event types / part order / text kept —
// because minted `evt_`/`msg_` ids are deliberately random and raw frames
// cannot be diffed against a committed golden.
//
//   UPDATE_GOLDENS=1 bun test    rewrite the committed goldens from current output
//
// The replay mirrors the live bridge's ordering: maki's `system.init` lands
// when the child starts (before the first prompt), the first part-bearing
// frame (`assistant` or `stream_event`) opens a turn the way a prompt
// admission does, `result` closes it.
import { dirname } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Translator } from "../../src/translator.ts";
import { synthesize } from "../../src/spec-answers.ts";

export interface Projected {
  type: string;
  [key: string]: unknown;
}

export interface SinkEvent {
  type: string;
  data: Record<string, any>;
}

export const UPDATE_GOLDENS = process.env.UPDATE_GOLDENS === "1";

// fixed canonical dir: the boot answers may embed it, and a golden must not
// depend on the host machine's checkout path
const CANONICAL = "/tmp/maki-oss-golden";

// same defaults bridge.ts derives from the pinned spec, so the goldens track
// what the shipped bridge actually puts on the wire (the synthesized-model
// defect lives exactly here)
function defaultAgent(): string {
  const { payload } = synthesize("GET", "/api/agent", new URL("http://bridge.local/api/agent"), null, CANONICAL);
  return String(payload?.data?.[0]?.id ?? "primary");
}

function defaultModel(): { providerID: string; id: string } {
  const { payload } = synthesize("GET", "/api/model", new URL("http://bridge.local/api/model"), null, CANONICAL);
  const first = payload?.data?.[0];
  return {
    providerID: String(first?.providerID ?? "sample"),
    id: String(first?.id ?? first?.modelID ?? "sample"),
  };
}

/** fixture lines: the permission trace wraps frames in {ts,dir} — keep maki→stdout only */
export function loadFixture(name: string): Record<string, any>[] {
  const raw = readFileSync(fileURLToPath(new URL(`../fixtures/${name}.jsonl`, import.meta.url)), "utf8");
  const frames: Record<string, any>[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const frame = JSON.parse(line);
    if ("dir" in frame) {
      if (frame.dir !== "out") continue;
      delete frame.dir;
      delete frame.ts;
    }
    frames.push(frame);
  }
  return frames;
}

/** replay one fixture through the translator; returns the raw sink events */
export function runFixture(name: string): SinkEvent[] {
  const events: SinkEvent[] = [];
  const translator = new Translator({
    sink: { emit: (type, data) => void events.push({ type, data }) },
    sessionID: "ses_goldenfixture",
    agent: defaultAgent,
    model: defaultModel,
  });
  let turn = 0;
  let turnOpen = false;
  // live, the turn opens at prompt admission — before the child is written
  // anything — so streamed part frames follow the turn boundary frames
  const admit = () => {
    if (turnOpen) return;
    // mirror live prompt admission: the user frame is emitted at admission
    // (bridge.ts prompt handler), before the child is written to
    translator.beginTurn(`msg_golden${String(++turn).padStart(4, "0")}`, {
      text: `golden prompt ${turn}`,
      id: `msg_goldenprompt${turn}`,
      delivery: "steer",
    });
    turnOpen = true;
  };
  for (const frame of loadFixture(name)) {
    if (frame.type === "assistant" || frame.type === "stream_event") {
      admit();
      translator.onFrame(frame);
    } else if (frame.type === "result") {
      translator.onFrame(frame);
      turnOpen = false;
    } else if (frame.type === "system" || frame.type === "user") {
      translator.onFrame(frame);
    }
    // control_* and unknown types (driver.exit) are the bridge's business,
    // not the translator's — same as the shipped onFrame default
  }
  return events;
}

const STRIP = new Set(["sessionID", "assistantMessageID", "id", "inboxID", "started", "created"]);

/** reduce sink events to {type, part order, text, …} with ids/timestamps removed */
export function project(events: SinkEvent[]): Projected[] {
  return events.map(({ type, data }) => {
    const out: Projected = { type };
    for (const [key, value] of Object.entries(data)) {
      if (!STRIP.has(key)) out[key] = value;
    }
    return out;
  });
}

/** first divergence between actual and expected, or null — names the frame */
export function firstDiff(actual: Projected[], expected: Projected[]): string | null {
  const len = Math.max(actual.length, expected.length);
  for (let i = 0; i < len; i++) {
    const a = actual[i];
    const e = expected[i];
    if (!a) return `frame ${i}: missing, expected ${JSON.stringify(e)}`;
    if (!e) return `frame ${i}: unexpected extra frame ${JSON.stringify(a)}`;
    if (JSON.stringify(a) !== JSON.stringify(e)) {
      return `frame ${i}: expected ${JSON.stringify(e)}\n      got      ${JSON.stringify(a)}`;
    }
  }
  return null;
}

/** golden files live under bridge/test/; `rel` is like `golden/maki-plain.json` */
export function goldenPath(rel: string): string {
  return fileURLToPath(new URL(`../${rel}`, import.meta.url));
}

export function readGolden(rel: string): Projected[] {
  return JSON.parse(readFileSync(goldenPath(rel), "utf8"));
}

export function writeGolden(rel: string, value: unknown): void {
  const path = goldenPath(rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

export function goldenExists(rel: string): boolean {
  return existsSync(goldenPath(rel));
}
