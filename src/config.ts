import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import type { AppConfig } from "./types.js";

interface RawConfig {
  lark?: Partial<AppConfig["lark"]>;
  agent?: Partial<AppConfig["agent"]>;
  artifacts?: Partial<AppConfig["artifacts"]>;
}

export function loadConfig(configPath = "cua.config.json"): AppConfig {
  dotenv.config();
  const absoluteConfigPath = path.resolve(configPath);
  const raw = readJsonConfig(absoluteConfigPath);

  return {
    vlm: {
      baseURL: env("VLM_BASE_URL", ""),
      apiKey: env("VLM_API_KEY", ""),
      model: env("VLM_MODEL", "")
    },
    lark: {
      appName: env("LARK_APP_NAME", raw.lark?.appName ?? "Lark"),
      appPath: raw.lark?.appPath ?? "/Applications/Lark.app",
      testChat: env("LARK_TEST_CHAT", raw.lark?.testChat ?? ""),
      testAttendee: env("LARK_TEST_ATTENDEE", raw.lark?.testAttendee ?? "")
    },
    agent: {
      maxSteps: numberEnv("CUA_MAX_STEPS", raw.agent?.maxSteps ?? 25),
      defaultTimeoutMs: raw.agent?.defaultTimeoutMs ?? 180000,
      retryOnVerificationFailure: raw.agent?.retryOnVerificationFailure ?? true,
      maxAttempts: numberEnv("CUA_MAX_ATTEMPTS", raw.agent?.maxAttempts ?? 5),
      retryDelayMs: numberEnv("CUA_RETRY_DELAY_MS", raw.agent?.retryDelayMs ?? 8000)
    },
    artifacts: {
      runsDir: env("CUA_SCREENSHOT_DIR", raw.artifacts?.runsDir ?? "artifacts/runs")
    },
    configPath: absoluteConfigPath
  };
}

export function validateRuntimeConfig(config: AppConfig, dryRun: boolean): string[] {
  const issues: string[] = [];
  if (!dryRun) {
    if (!config.vlm.baseURL) issues.push("VLM_BASE_URL is required for real runs.");
    if (!config.vlm.apiKey) issues.push("VLM_API_KEY is required for real runs.");
    if (!config.vlm.model) issues.push("VLM_MODEL is required for real runs.");
  }
  if (!config.lark.appName) issues.push("LARK_APP_NAME is required.");
  if (config.agent.maxSteps < 1) issues.push("CUA_MAX_STEPS must be at least 1.");
  if (config.agent.maxAttempts < 1) issues.push("CUA_MAX_ATTEMPTS must be at least 1.");
  if (config.agent.retryDelayMs < 0) issues.push("CUA_RETRY_DELAY_MS must not be negative.");
  return issues;
}

function readJsonConfig(configPath: string): RawConfig {
  if (!fs.existsSync(configPath)) return {};
  const raw = fs.readFileSync(configPath, "utf8");
  return JSON.parse(raw) as RawConfig;
}

function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

function numberEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
