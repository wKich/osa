import { describe, expect, test } from "bun:test";
import { referenceConfig, referenceEnv } from "./record.ts";

const paths = {
  home: "/tmp/journey-home",
  config: "/tmp/journey-home/.config/opencode",
  data: "/tmp/journey-home/.local/share",
  state: "/tmp/journey-home/.local/state",
  cache: "/tmp/journey-home/.cache",
  work: "/tmp/journey-work",
};

describe("reference isolation", () => {
  test("the spawned env carries no provider credential or OPENCODE_* variable", () => {
    const env = referenceEnv(paths, {
      ...process.env,
      ANTHROPIC_API_KEY: "secret",
      OPENAI_API_KEY: "secret",
      OPENCODE_CONFIG_DIR: "/host/config",
      OPENCODE_AUTO_SHARE: "1",
    });
    const leaked = Object.keys(env).filter((key) => key.endsWith("_API_KEY") || key.startsWith("OPENCODE_"));
    expect(leaked).toEqual([]);
    expect(env.HOME).toBe(paths.home);
    expect(env.XDG_CONFIG_HOME).toBe(paths.home + "/.config");
  });

  test("the config names only the loopback provider", () => {
    const config = referenceConfig("http://127.0.0.1:47832/v1");
    expect(Object.keys(config.providers)).toEqual(["mock"]);
    const settings = config.providers.mock.settings;
    expect(new URL(settings.baseURL).hostname).toBe("127.0.0.1");
    expect(config.providers.mock.models["mock-model"].capabilities.tools).toBe(true);
  });
});
