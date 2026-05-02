import { describe, expect, it } from "vitest";
import { buildRunReport, renderMarkdown } from "../src/reporter.js";
import type { CaseRunResult } from "../src/types.js";

describe("reporter", () => {
  it("computes success rate and renders markdown", () => {
    const cases: CaseRunResult[] = [
      {
        id: "a",
        product: "im",
        description: "a",
        instruction: "a",
        status: "passed",
        startedAt: "2026-05-02T00:00:00.000Z",
        finishedAt: "2026-05-02T00:00:01.000Z",
        durationMs: 1000,
        steps: [],
        successCriteria: [],
        screenshots: [],
        modelCalls: 1
      },
      {
        id: "b",
        product: "docs",
        description: "b",
        instruction: "b",
        status: "failed",
        startedAt: "2026-05-02T00:00:00.000Z",
        finishedAt: "2026-05-02T00:00:01.000Z",
        durationMs: 1000,
        steps: [],
        successCriteria: [],
        screenshots: [],
        modelCalls: 2,
        failureReason: "not visible"
      }
    ];
    const report = buildRunReport({
      runId: "run-test",
      suite: "standard",
      dryRun: true,
      startedAt: "2026-05-02T00:00:00.000Z",
      cases
    });
    expect(report.status).toBe("failed");
    expect(report.successRate).toBe(0.5);
    expect(report.modelCalls).toBe(3);
    expect(renderMarkdown(report)).toContain("| b | docs | failed |");
  });
});
