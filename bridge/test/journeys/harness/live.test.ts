import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { diffCheckpoints, type CheckpointInput, type Verdict } from "./diff.ts";
import { liveEvidence } from "./live.ts";

const JOURNEYS = fileURLToPath(new URL("..", import.meta.url));
const CATALOG = fileURLToPath(new URL("../../../compat/journeys.json", import.meta.url));
const journeys = JSON.parse(readFileSync(CATALOG, "utf8")).journeys as Array<{
  slug: string;
  status: Verdict;
  acceptedDiffs?: Array<{ checkpoint: string; reason: string }>;
  scenario?: { checkpoints: Array<{ id: string }> };
}>;

describe("live evidence", () => {
  test("records the verdict, committed paths, and both versions", () => {
    expect(liveEvidence("send-prompt-stream-reply", "diverges", { maki: "0.6.4", image: "sha256:abc" })).toEqual({
      snapshots: "bridge/test/journeys/send-prompt-stream-reply/live/",
      diff: "bridge/test/journeys/send-prompt-stream-reply/live-diff.json",
      maki: "0.6.4",
      image: "sha256:abc",
      verdict: "diverges",
    });
  });

  test("the offline rule reproduces each recorded pilot's verdict", () => {
    for (const slug of ["send-prompt-stream-reply", "allow-permission-once", "resume-session-history"]) {
      const journey = journeys.find((j) => j.slug === slug)!;
      const dir = join(JOURNEYS, slug);
      const inputs: CheckpointInput[] = journey.scenario!.checkpoints.map((checkpoint) => ({
        id: checkpoint.id,
        reference: readFileSync(join(dir, "reference", `${checkpoint.id}.txt`), "utf8"),
        maki: existsSync(join(dir, "maki", `${checkpoint.id}.txt`))
          ? readFileSync(join(dir, "maki", `${checkpoint.id}.txt`), "utf8")
          : undefined,
        acceptedReason: journey.acceptedDiffs?.find((d) => d.checkpoint === checkpoint.id)?.reason,
      }));
      expect(diffCheckpoints(inputs).status).toBe(journey.status);
    }
  });
});
