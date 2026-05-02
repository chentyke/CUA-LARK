import { describe, expect, it } from "vitest";
import { loadConfig, validateRuntimeConfig } from "../src/config.js";

describe("config", () => {
  it("loads defaults from cua.config.json", () => {
    const config = loadConfig("cua.config.json");
    expect(config.lark.appName).toBe("Lark");
    expect(config.agent.maxSteps).toBeGreaterThan(0);
    expect(config.agent.maxAttempts).toBeGreaterThan(1);
    expect(config.agent.retryDelayMs).toBeGreaterThanOrEqual(0);
  });

  it("allows dry-run without VLM credentials", () => {
    const config = loadConfig("cua.config.json");
    expect(validateRuntimeConfig(config, true)).toEqual([]);
  });

  it("requires VLM credentials for real runs", () => {
    const previousBaseUrl = process.env.VLM_BASE_URL;
    const previousApiKey = process.env.VLM_API_KEY;
    const previousModel = process.env.VLM_MODEL;
    process.env.VLM_BASE_URL = "";
    process.env.VLM_API_KEY = "";
    process.env.VLM_MODEL = "";
    const config = loadConfig("cua.config.json");
    const issues = validateRuntimeConfig(config, false);
    expect(issues).toContain("VLM_BASE_URL is required for real runs.");
    expect(issues).toContain("VLM_API_KEY is required for real runs.");
    expect(issues).toContain("VLM_MODEL is required for real runs.");
    restoreEnv("VLM_BASE_URL", previousBaseUrl);
    restoreEnv("VLM_API_KEY", previousApiKey);
    restoreEnv("VLM_MODEL", previousModel);
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
