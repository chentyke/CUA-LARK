import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LarkAgent } from "../src/agent.js";
import { getCaseById, materializeCase } from "../src/cases.js";
import { loadConfig } from "../src/config.js";
import { Planner } from "../src/planner.js";

describe("dry-run integration", () => {
  it("runs a standard case without desktop side effects", async () => {
    const runDir = await fs.mkdtemp(path.join(os.tmpdir(), "lark-cua-test-"));
    const config = loadConfig("cua.config.json");
    const baseCase = getCaseById("im-send-text");
    expect(baseCase).toBeDefined();
    const plannedCase = new Planner().fromCase(materializeCase(baseCase!, config, "20260502T120000Z"));
    const result = await new LarkAgent(config).runCase(plannedCase, { dryRun: true, runDir });
    expect(result.status).toBe("passed");
    expect(result.verification?.passed).toBe(true);
    expect(result.steps.length).toBeGreaterThan(0);
  });
});
