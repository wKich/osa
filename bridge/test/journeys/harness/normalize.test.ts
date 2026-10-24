import { describe, expect, test } from "bun:test";
import { modelLabels, normalize } from "./normalize.ts";

describe("normalize", () => {
  const opts = { workdir: "/tmp/run-abc/work", home: "/tmp/run-abc/home", models: ["Mock Model", "mock-model"] };

  test("OpenCode ids", () => {
    expect(normalize("ses_abc123 per_9 evt_x msg_1 prt_42", opts)).toBe("<ID> <ID> <ID> <ID> <ID>");
  });

  test("clock times and dates", () => {
    expect(normalize("10:42 10:42:09 2026-10-24", opts)).toBe("<TIME> <TIME> <TIME>");
    expect(normalize("2026-10-24T08:20:50.619Z", opts)).toBe("<TIME>");
    // a run that crosses noon or midnight reads the same
    expect(normalize("Reply.  11:59 PM", opts)).toBe(normalize("Reply.  12:01 AM", opts));
  });

  test("durations", () => {
    expect(normalize("1.2s 350ms", opts)).toBe("<DUR> <DUR>");
  });

  test("token rate is wall-clock derived", () => {
    expect(normalize("Build · mock-model · 1.2s · 3.2 tok/s", opts)).toBe("Build · <MODEL> · <DUR>");
    // a right-aligned clock's gap depends on the hour's width
    expect(normalize("Reply.          9:59 PM", opts)).toBe(normalize("Reply.         10:05 PM", opts));
    // the footer pads a workdir with its branch by the path's length
    expect(normalize("  /tmp/x/journey-work:main            2  ctrl+p", { ...opts, workdir: "/tmp/x/journey-work" })).toBe("  <WORKDIR>:main 2  ctrl+p");
    // the second journey model stays distinct from the first
    expect(normalize("Build · Mock Model Two Mock · mock/mock-model-2", { models: ["Mock Model", "Mock", "mock-model", "mock/mock-model"] })).toBe("Build · <MODEL-2> <MODEL> · <MODEL-2>");
    // a subdirectory footer is padded by the path's length too
    expect(normalize("  /tmp/x/journey-work/sub            2  ctrl+p", { ...opts, workdir: "/tmp/x/journey-work" })).toBe("  <WORKDIR>/sub 2  ctrl+p");
    // a narrow pane elides the workdir's middle and cuts its end
    const wd = { ...opts, workdir: "/private/var/folders/bb/4_lkm/T/maki-journey-ref-toggle-sidebar-Ab12/journey-work" };
    expect(normalize("  /…/fold…/bb/4_lkm/T/maki-journey-ref-toggle-sidebar  x", wd)).toBe("  <WORKDIR> x");
    expect(normalize("  /…/4_lkm/T/maki-journey-ref-toggle-sidebar-A  x", wd)).toBe("  <WORKDIR> x");
    // an elided path elsewhere is left alone
    expect(normalize("  /…/usr/lib/thing  x", wd)).toBe("  /…/usr/lib/thing  x");
    // a live sandbox's prompt names its container
    expect(normalize("sandbox@f328cbd028b1:/tmp$ ", opts)).toBe("sandbox@<HOST>:/tmp$ ");
    // a dialog cut the duration mid-unit
    expect(normalize("     Build · mock-model · 700m    Last turn", opts)).toBe("     Build · <MODEL> · <DUR>    Last turn");
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

  test("footer padding after the workdir is a layout artifact", () => {
    const trunc = { ...opts, workdir: "/tmp/run-xyz/journey-work" };
    expect(normalize("  /tmp/run-xyz/journey-work      2  ctrl+p commands", trunc)).toBe(
      "  <WORKDIR> 2  ctrl+p commands",
    );
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

  test("model labels derive from the model and provider responses", () => {
    const models = { data: [{ id: "fake", modelID: "fake", providerID: "synthetic", name: "fake" }] };
    const providers = { data: [{ id: "synthetic", name: "Synthetic" }] };
    const labels = modelLabels(models, providers);
    expect(normalize("Build · synthetic/fake · Synthetic", { models: labels })).toBe("Build · <MODEL> · <MODEL>");
    expect(normalize("Build · synthetic/other", { models: labels })).not.toBe("Build · <MODEL>");
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
