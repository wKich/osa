// The spec scenario "Exec carries no environment values" names the flags the
// child argv must carry; this asserts them on the exported builder without
// spawning (the export exists for exactly that).
import { describe, expect, test } from "bun:test";
import { childArgv, type MakiOptions } from "../src/maki.ts";

const opts: MakiOptions = { cwd: "/sandbox/project", model: "synthetic/fake", onFrame: () => {}, onExit: () => {} };
const sandboxEnv = { OPENMAKI_SANDBOX: "maki-oss-test", OPENSHELL_BIN: "openshell" };

// one string per flag/value pair the spec spells, in the argv's own words
const SPEC_FLAGS = [
  "--input-format stream-json",
  "--output-format stream-json",
  "--include-partial-messages",
  "--no-login-shell",
  `--workdir ${opts.cwd}`,
];

function expectSpecFlags(argv: string[]): void {
  const joined = argv.join(" ");
  for (const flag of SPEC_FLAGS) expect(joined).toContain(flag);
  // security invariant: credentials never ride the argv
  expect(argv.filter((a) => a === "--env" || a.startsWith("--env="))).toEqual([]);
}

describe("childArgv", () => {
  test("the sandbox transport passes every spec flag and no --env", () => {
    const argv = childArgv(opts, sandboxEnv);
    expect(argv.slice(0, 4)).toEqual(["openshell", "sandbox", "exec", "-n"]);
    expectSpecFlags(argv);
  });

  test("a scripted child override gets the same SDK flags", () => {
    const argv = childArgv(opts, { MAKI_CHILD_CMD: "/tmp/fake-maki.ts" });
    expect(argv[0]).toBe("/tmp/fake-maki.ts");
    const joined = argv.join(" ");
    for (const flag of ["--input-format stream-json", "--output-format stream-json", "--include-partial-messages"]) {
      expect(joined).toContain(flag);
    }
  });
});

test("a fork continues the stored Maki session under a new id", () => {
  const argv = childArgv({ cwd: "/sandbox/w", fork: "maki-sess-1", onFrame: () => {}, onExit: () => {} }, { OPENMAKI_SANDBOX: "box" });
  expect(argv.slice(-3)).toEqual(["-r", "maki-sess-1", "--fork-session"]);
});
