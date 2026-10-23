// Offline coverage for the model catalog (add-model-catalog): the model,
// provider and integration lists describe what Maki can run in the sandbox —
// `maki models` and `maki auth status`, read over the exec transport — with
// the configured, then the announced, model first. A scripted `maki` on the
// scripted sandbox's PATH (FAKE_SANDBOX_BIN) prints the pinned output shapes.
import { describe, expect, test, setDefaultTimeout } from "bun:test";
import { fileURLToPath } from "node:url";
import { startBridge, waitFor, type BridgeHandle } from "./lib/bridge.ts";
import { validateBody } from "./lib/contract.ts";

// tests here boot their own bridges; the default 5s budget is too tight on a
// loaded host
setDefaultTimeout(20_000);


describe("model catalog", () => {
  // `maki models` / `maki auth status` in their pinned output shapes
  const bin = fileURLToPath(new URL("./sandbox-bin", import.meta.url));

  const read = async (bridge: BridgeHandle, path: string) => {
    const res = await fetch(`${bridge.base}${path}?location%5Bdirectory%5D=${encodeURIComponent(bridge.workdir)}`);
    const body = await res.json();
    expect(validateBody(path, "GET", res.status, body)).toBeNull();
    return body.data;
  };
  const ids = (models: any[]) => models.map((m) => `${m.providerID}/${m.id}`);

  test("the configured model leads the sandbox catalog before any child", async () => {
    const bridge = await startBridge({ FAKE_SANDBOX_BIN: bin, MAKI_MODEL: "anthropic/claude-sonnet-5-5" });
    try {
      const models = await read(bridge, "/api/model");
      expect(ids(models)).toEqual(["anthropic/claude-sonnet-5-5", "synthetic/hf:zai-org/GLM-4.7", "synthetic/fake"]);
      expect(models[0]).toMatchObject({ modelID: "claude-sonnet-5-5", name: "claude-sonnet-5-5", status: "active", enabled: true, cost: [] });

      expect(await read(bridge, "/api/provider")).toEqual([
        { id: "anthropic", name: "Anthropic", activation: "enabled", package: "maki", integrationID: "anthropic" },
        { id: "synthetic", name: "Synthetic", activation: "enabled", package: "maki", integrationID: "synthetic" },
      ]);
      // the unauthenticated provider is not connected and offers no login
      expect(await read(bridge, "/api/integration")).toEqual([
        { id: "synthetic", name: "Synthetic", methods: [{ type: "env", names: ["SYNTHETIC_API_KEY"] }], connections: [{ type: "env", name: "SYNTHETIC_API_KEY" }] },
        { id: "anthropic", name: "Anthropic", methods: [{ type: "env", names: ["ANTHROPIC_API_KEY"] }], connections: [{ type: "env", name: "ANTHROPIC_API_KEY" }] },
      ]);
    } finally {
      await bridge.stop();
    }
  });

  test("the announced model moves to the front once a child names it", async () => {
    const bridge = await startBridge({ FAKE_SANDBOX_BIN: bin, MAKI_MODEL: "anthropic/claude-sonnet-5-5" });
    try {
      await fetch(`${bridge.base}/api/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ location: { directory: bridge.workdir } }),
      });
      expect(await waitFor(() => bridge.frames.some((f) => f.type === "model.updated"), 10_000)).toBe(true);
      expect(ids(await read(bridge, "/api/model"))).toEqual([
        "synthetic/fake",
        "synthetic/hf:zai-org/GLM-4.7",
        "anthropic/claude-sonnet-5-5",
      ]);
    } finally {
      await bridge.stop();
    }
  });

  test("without a sandbox only the configured model is known", async () => {
    const bridge = await startBridge({ FAKE_SANDBOX_BIN: bin, MAKI_MODEL: "anthropic/claude-sonnet-5-5", OPENMAKI_SANDBOX: "" });
    try {
      expect(ids(await read(bridge, "/api/model"))).toEqual(["anthropic/claude-sonnet-5-5"]);
      expect(await read(bridge, "/api/integration")).toEqual([]);
    } finally {
      await bridge.stop();
    }
  });
});
