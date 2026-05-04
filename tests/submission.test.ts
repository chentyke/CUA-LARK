import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildRunReport } from "../src/reporter.js";
import { writeSubmissionPackage } from "../src/submission.js";
import type { CaseRunResult } from "../src/types.js";

describe("submission package", () => {
  it("writes submission reports and PNG evidence cards", async () => {
    const runDir = await fs.mkdtemp(path.join(os.tmpdir(), "lark-cua-submission-"));
    const testCase: CaseRunResult = {
      id: "im-send-text",
      product: "im",
      description: "Send a timestamped message.",
      instruction: "Send a message.",
      status: "passed",
      startedAt: "2026-05-04T00:00:00.000Z",
      finishedAt: "2026-05-04T00:00:02.000Z",
      durationMs: 2000,
      steps: [],
      successCriteria: ["The latest message is visible."],
      screenshots: [],
      modelCalls: 0,
      verification: {
        passed: true,
        confidence: 1,
        reason: "Dry run uses deterministic mock verification.",
        evidence: ["The latest message is visible."]
      }
    };
    const report = buildRunReport({
      runId: "run-submit-test",
      suite: "standard",
      dryRun: true,
      startedAt: "2026-05-04T00:00:00.000Z",
      cases: [testCase]
    });

    const paths = await writeSubmissionPackage(report, runDir, {
      projectName: "CUA-Lark",
      members: ["陈正洋", "刘俊熙"]
    });

    await expect(fs.stat(paths.markdown)).resolves.toMatchObject({ size: expect.any(Number) });
    await expect(fs.stat(paths.html)).resolves.toMatchObject({ size: expect.any(Number) });
    expect(paths.evidenceImages).toHaveLength(3);
    for (const image of paths.evidenceImages) {
      const content = await fs.readFile(image);
      expect(content.subarray(1, 4).toString("ascii")).toBe("PNG");
    }

    const markdown = await fs.readFile(paths.markdown, "utf8");
    expect(markdown).toContain("测试图片");
    expect(markdown).toContain("陈正洋、刘俊熙");
    expect(markdown).toContain("核心功能实现对照");
    expect(markdown).toContain("进阶能力");
    expect(markdown).toContain("渐进式实现路径");
    expect(markdown).toContain("src/submission.ts");
  });
});
