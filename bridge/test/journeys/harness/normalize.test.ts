import { describe, expect, test } from "bun:test";
import { normalize } from "./normalize.ts";

describe("normalize", () => {
  const opts = { workdir: "/tmp/run-abc/work", home: "/tmp/run-abc/home", models: ["Mock Model", "mock-model"] };

  test("OpenCode ids", () => {
    expect(normalize("ses_abc123 per_9 evt_x msg_1 prt_42", opts)).toBe("<ID> <ID> <ID> <ID> <ID>");
  });

  test("clock times and dates", () => {
    expect(normalize("10:42 10:42:09 2026-10-24", opts)).toBe("<TIME> <TIME> <TIME>");
    expect(normalize("2026-10-24T08:20:50.619Z", opts)).toBe("<TIME>");
  });

  test("durations", () => {
    expect(normalize("1.2s 350ms", opts)).toBe("<DUR> <DUR>");
  });

  test("ports", () => {
    expect(normalize("http://127.0.0.1:45999/v1", opts)).toBe("http://127.0.0.1:<PORT>/v1");
  });

  test("run paths", () => {
    expect(normalize("/tmp/run-abc/work and /tmp/run-abc/home", opts)).toBe("<WORKDIR> and <HOME>");
  });

  test("truncated run paths keep the last segment and normalize", () => {
    const trunc = { ...opts, workdir: "/tmp/run-xyz/journey-work" };
    expect(normalize("/…/fold…/T/run-xyz/journey-work", trunc)).toBe("<WORKDIR>");
  });

  test("animated spinners", () => {
    expect(normalize("⠦ working", opts)).toBe("<SPINNER> working");
  });

  test("progress bars", () => {
    expect(normalize("■■■⬝⬝⬝⬝⬝", opts)).toBe("<BAR>");
  });

  test("explicit model labels", () => {
    expect(normalize("Mock Model mock-model", opts)).toBe("<MODEL> <MODEL>");
  });

  test("token and cost counters", () => {
    expect(normalize("1,234 input tokens 7 tokens $0.04 $1", opts)).toBe("<N> tokens <N> tokens $<N> $<N>");
  });

  test("composer hint rotation", () => {
    expect(normalize('Ask anything… "Fix broken tests"', opts)).toBe('Ask anything… "<HINT>"');
  });

  test("a real difference survives", () => {
    expect(normalize("alpha line", opts)).not.toBe(normalize("beta line", opts));
  });
});
