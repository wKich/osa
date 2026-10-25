// The Maki-side drift check's parsing (scripts/maki-drift.ts): the pin, the
// release tags, and their order. The network half is exercised by
// `make maki-drift`, never by `make test`.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { compareVersions, pinnedVersion, releaseVersions } from "../../scripts/maki-drift.ts";

test("the pin comes from the Dockerfile", () => {
  expect(pinnedVersion("FROM x\nARG MAKI_VERSION=0.6.4\n")).toBe("0.6.4");
  expect(pinnedVersion("ARG MAKI_VERSION\n")).toBeUndefined();
  expect(pinnedVersion(readFileSync(new URL("../../examples/maki-image/Dockerfile", import.meta.url), "utf8"))).toMatch(/^\d+\.\d+\.\d+$/);
});

test("release tags are versions in semver order, other refs ignored", () => {
  const ls = ["abc\trefs/tags/v0.6.10", "def\trefs/tags/v0.6.4", "aaa\trefs/tags/v0.6.5", "bbb\trefs/tags/nightly", "ccc\trefs/tags/v0.7.0-rc1"].join("\n");
  expect(releaseVersions(ls)).toEqual(["0.6.4", "0.6.5", "0.6.10"]);
  expect(compareVersions("0.6.10", "0.6.9")).toBeGreaterThan(0);
});
