import fs from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";
import type { AppConfig } from "./types.js";
import { validateRuntimeConfig } from "./config.js";
import { advancedCapabilityRows, coreCapabilityRows, productCoverageRows } from "./capabilities.js";

export interface DoctorCheck {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

export function runDoctor(config: AppConfig): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  checks.push(checkNode());
  checks.push({
    name: "Platform",
    status: os.platform() === "darwin" ? "ok" : "warn",
    detail: `${os.type()} ${os.release()} ${os.arch()}`
  });
  checks.push({
    name: "Lark app",
    status: fs.existsSync(config.lark.appPath) ? "ok" : "warn",
    detail: fs.existsSync(config.lark.appPath)
      ? `Found ${config.lark.appPath}`
      : `Configured app path not found: ${config.lark.appPath}`
  });
  checks.push(checkCommand("open", "macOS open command"));
  checks.push(checkVlm(config));
  checks.push({
    name: "Lark test chat",
    status: config.lark.testChat ? "ok" : "warn",
    detail: config.lark.testChat
      ? "Configured. Use a disposable chat for real IM and cross-product runs."
      : "Not configured. Set LARK_TEST_CHAT before real IM and standard suite runs."
  });
  checks.push({
    name: "macOS permissions",
    status: "warn",
    detail:
      "Verify Terminal or your Node runner has Accessibility and Screen Recording permissions in System Settings."
  });
  checks.push({
    name: "Core capability coverage",
    status: "ok",
    detail: `${coreCapabilityRows.length} core requirement groups, ${productCoverageRows.length} product/demo rows, ${advancedCapabilityRows.length} advanced rows documented.`
  });
  return checks;
}

export function formatDoctor(checks: DoctorCheck[]): string {
  return checks.map((check) => `[${check.status.toUpperCase()}] ${check.name}: ${check.detail}`).join("\n");
}

function checkNode(): DoctorCheck {
  const major = Number(process.versions.node.split(".")[0]);
  return {
    name: "Node.js",
    status: major >= 22 ? "ok" : "fail",
    detail: process.versions.node
  };
}

function checkCommand(command: string, label: string): DoctorCheck {
  try {
    execFileSync("which", [command], { stdio: "ignore" });
    return { name: label, status: "ok", detail: command };
  } catch {
    return { name: label, status: "fail", detail: `${command} not found in PATH` };
  }
}

function checkVlm(config: AppConfig): DoctorCheck {
  const issues = validateRuntimeConfig(config, false).filter((issue) => issue.startsWith("VLM_"));
  return {
    name: "VLM config",
    status: issues.length === 0 ? "ok" : "warn",
    detail: issues.length === 0 ? `Using model ${config.vlm.model} at ${config.vlm.baseURL}` : issues.join(" ")
  };
}
