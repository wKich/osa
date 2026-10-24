import { describe, expect, test } from "bun:test";
import { compare, diffCheckpoints } from "./diff.ts";

const ref = "same\nreference only";

describe("diff", () => {
  test("equal checkpoints make parity", () => {
    expect(diffCheckpoints([{ id: "a", reference: "x", maki: "x" }]).status).toBe("parity");
  });

  test("a difference makes diverges and carries a hunk", () => {
    const result = diffCheckpoints([{ id: "a", reference: ref, maki: "same\nmaki only" }]);
    expect(result.status).toBe("diverges");
    expect(result.checkpoints[0].verdict).toBe("differs");
    expect(result.checkpoints[0].hunk).toContain("-reference only");
    expect(result.checkpoints[0].hunk).toContain("+maki only");
  });

  test("an accepted difference stays parity", () => {
    const result = diffCheckpoints([{ id: "a", reference: "x", maki: "y", acceptedReason: "pinned wording" }]);
    expect(result.status).toBe("parity");
    expect(result.checkpoints[0].verdict).toBe("differs");
  });

  test("an accepted difference without a reason still diverges", () => {
    const result = diffCheckpoints([{ id: "a", reference: "x", maki: "y", acceptedReason: "  " }]);
    expect(result.status).toBe("diverges");
  });

  test("an unreached checkpoint makes broken", () => {
    const result = diffCheckpoints([{ id: "a", reference: "x" }]);
    expect(result.status).toBe("broken");
    expect(result.checkpoints[0].verdict).toBe("unreached");
  });

  test("broken cannot be accepted", () => {
    const result = diffCheckpoints([{ id: "a", reference: "x", acceptedReason: "not a difference" }]);
    expect(result.status).toBe("broken");
  });

  test("compare is undefined only when the text is equal", () => {
    expect(compare("a\nb", "a\nb")).toBeUndefined();
    expect(compare("a", "b")).toContain("@@");
  });

  test("a committed trailing newline is storage, not a difference", () => {
    expect(compare("a\nb\n", "a\nb")).toBeUndefined();
    expect(compare("a\nb\n\n", "a\nb")).toBeUndefined();
  });
});
