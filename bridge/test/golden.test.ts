// Golden translation tests (spec scenario "A translation regression fails the
// gate"): each recorded maki fixture must project to its committed golden —
// event types, part order, and text, with ids/timestamps stripped. Defect
// cases assert against the *desired* golden from the spec while their
// bridge/defects.json entry carries the expected-failure marker, so the suite
// stays green with the defects open and flips the moment a fix lands.
import { readFileSync } from "node:fs";
import { expect, test } from "bun:test";
import {
  UPDATE_GOLDENS,
  firstDiff,
  goldenExists,
  goldenPath,
  project,
  readGolden,
  runFixture,
  writeGolden,
} from "./lib/projection.ts";

interface Defect {
  id: string;
  title: string;
  status: string;
  capture: string;
  golden?: { fixture: string; want: string };
  expectedFailure?: boolean;
}

const defects: Defect[] = JSON.parse(readFileSync(new URL("../defects.json", import.meta.url), "utf8"));
// The stream fixture's `stream_event` envelope spelling is sdk_mode-string-
// derived, never captured from a live streaming provider (shortcut comment
// in translator.ts) — this golden pins the translation behavior, not the
// wire shape, which is why the stream-deltas row is `degraded`.
const FIXTURES = ["maki-plain", "maki-tool", "maki-precheck", "maki-permission", "maki-stream"];

for (const name of FIXTURES) {
  test(`golden translation: ${name}`, () => {
    const actual = project(runFixture(name));
    const rel = `golden/${name}.json`;
    if (UPDATE_GOLDENS) {
      writeGolden(rel, actual);
      return;
    }
    if (!goldenExists(rel)) {
      throw new Error(`missing golden ${rel}: run UPDATE_GOLDENS=1 bun test and review the result`);
    }
    const diff = firstDiff(actual, readGolden(rel));
    if (diff) throw new Error(`golden mismatch for fixture "${name}":\n      ${diff}`);
    expect(diff).toBeNull();
  });
}

// desired-order goldens, one per open defect entry that has one
for (const defect of defects.filter((d) => d.golden)) {
  const { fixture, want } = defect.golden!;
  test(`defect ${defect.id} (expected failure): ${defect.title}`, () => {
    const actual = project(runFixture(fixture));
    if (UPDATE_GOLDENS) {
      if (!goldenExists(want)) writeGolden(want, actual); // seed only: edit in the desired shape
      return;
    }
    if (!goldenExists(want)) throw new Error(`missing desired golden ${want} (defect ${defect.id})`);
    const diff = firstDiff(actual, readGolden(want));
    if (defect.expectedFailure) {
      if (!diff) {
        throw new Error(
          `${defect.id}: fixture "${fixture}" now matches the desired golden — the defect is fixed. ` +
            `Set its status to "fixed" in bridge/defects.json, drop expectedFailure, and run make compat ` +
            "(bridge/test/README.md)",
        );
      }
      // expected while the entry is open; the test name carries the entry id
    } else if (diff) {
      throw new Error(`defect ${defect.id} is marked fixed but fixture "${fixture}" still differs:\n      ${diff}`);
    }
  });
}

test("every defect expected-failure marker has a golden file", () => {
  for (const defect of defects) {
    if (defect.expectedFailure && defect.golden) {
      expect(goldenExists(defect.golden.want)).toBe(true);
      expect(goldenPath(defect.golden.want)).toContain("golden/");
    }
  }
});

// spec scenario "A mid-turn api_retry leaves the transcript undisturbed":
// the retry fixture's projection must equal the plain-turn golden literally,
// so the fixture is deliberately NOT in FIXTURES (which would mint its own golden).
test("golden translation: maki-retry equals the plain-turn golden", () => {
  const actual = project(runFixture("maki-retry"));
  const diff = firstDiff(actual, readGolden("golden/maki-plain.json"));
  if (diff) throw new Error(`api_retry frames disturbed the transcript:\n      ${diff}`);
  expect(diff).toBeNull();
});
