import fs from "node:fs/promises";
import path from "node:path";
import type { CaseRunResult, CaseStatus, RunReport } from "./types.js";
import { durationMs, nowIso, timestampForId } from "./time.js";

export async function createRunDirectory(baseDir: string, runId = `run-${timestampForId()}`): Promise<string> {
  const runDir = path.resolve(baseDir, runId);
  await fs.mkdir(runDir, { recursive: true });
  await fs.mkdir(path.join(runDir, "screenshots"), { recursive: true });
  return runDir;
}

export function buildRunReport(params: {
  runId: string;
  suite: string;
  dryRun: boolean;
  startedAt: string;
  cases: CaseRunResult[];
}): RunReport {
  const finishedAt = nowIso();
  const passed = params.cases.filter((testCase) => testCase.status === "passed").length;
  const status: CaseStatus = params.cases.length > 0 && passed === params.cases.length ? "passed" : "failed";
  const screenshots = params.cases.flatMap((testCase) => testCase.screenshots);
  const modelCalls = params.cases.reduce((total, testCase) => total + testCase.modelCalls, 0);

  return {
    runId: params.runId,
    suite: params.suite,
    dryRun: params.dryRun,
    startedAt: params.startedAt,
    finishedAt,
    durationMs: durationMs(params.startedAt, finishedAt),
    status,
    successRate: params.cases.length === 0 ? 0 : passed / params.cases.length,
    modelCalls,
    screenshots,
    cases: params.cases,
    failureReason: status === "failed" ? firstFailure(params.cases) : undefined
  };
}

export async function writeReports(report: RunReport, runDir: string): Promise<{ json: string; markdown: string; html: string }> {
  const jsonPath = path.join(runDir, "report.json");
  const markdownPath = path.join(runDir, "report.md");
  const htmlPath = path.join(runDir, "report.html");
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2));
  await fs.writeFile(markdownPath, renderMarkdown(report));
  await fs.writeFile(htmlPath, renderHtml(report));
  return { json: jsonPath, markdown: markdownPath, html: htmlPath };
}

export function renderMarkdown(report: RunReport): string {
  const caseRows = report.cases
    .map(
      (testCase) =>
        `| ${testCase.id} | ${testCase.product} | ${testCase.status} | ${testCase.durationMs} | ${
          testCase.verification?.confidence ?? 0
        } | ${testCase.failureReason ?? ""} |`
    )
    .join("\n");

  return `# CUA-Lark Run Report

- Run ID: ${report.runId}
- Suite: ${report.suite}
- Dry run: ${report.dryRun ? "yes" : "no"}
- Status: ${report.status}
- Success rate: ${(report.successRate * 100).toFixed(1)}%
- Duration: ${report.durationMs} ms
- Model calls: ${report.modelCalls}

| Case | Product | Status | Duration ms | Confidence | Failure |
| --- | --- | --- | ---: | ---: | --- |
${caseRows || "| n/a | n/a | failed | 0 | 0 | no cases executed |"}

## Screenshots

${report.screenshots.map((screenshot) => `- ${screenshot}`).join("\n") || "- none"}
`;
}

function renderHtml(report: RunReport): string {
  const rows = report.cases
    .map(
      (testCase) => `<tr>
  <td>${escapeHtml(testCase.id)}</td>
  <td>${escapeHtml(testCase.product)}</td>
  <td><span class="badge ${testCase.status}">${escapeHtml(testCase.status)}</span></td>
  <td>${testCase.durationMs}</td>
  <td>${testCase.verification?.confidence ?? 0}</td>
  <td>${escapeHtml(testCase.failureReason ?? "")}</td>
</tr>`
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CUA-Lark Report ${escapeHtml(report.runId)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 32px; color: #17202a; }
    h1 { font-size: 28px; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin: 24px 0; }
    .metric { border: 1px solid #d7dee8; border-radius: 8px; padding: 14px; background: #fbfcfe; }
    .label { color: #617083; font-size: 12px; text-transform: uppercase; }
    .value { font-size: 22px; margin-top: 6px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border-bottom: 1px solid #d7dee8; padding: 10px; text-align: left; }
    .badge { border-radius: 999px; padding: 4px 8px; font-size: 12px; }
    .passed { background: #e7f7ed; color: #16713a; }
    .failed { background: #fdebea; color: #b42318; }
    .skipped { background: #eef2f6; color: #4b5563; }
  </style>
</head>
<body>
  <h1>CUA-Lark Run Report</h1>
  <section class="summary">
    <div class="metric"><div class="label">Status</div><div class="value">${escapeHtml(report.status)}</div></div>
    <div class="metric"><div class="label">Success Rate</div><div class="value">${(report.successRate * 100).toFixed(1)}%</div></div>
    <div class="metric"><div class="label">Duration</div><div class="value">${report.durationMs} ms</div></div>
    <div class="metric"><div class="label">Model Calls</div><div class="value">${report.modelCalls}</div></div>
  </section>
  <table>
    <thead><tr><th>Case</th><th>Product</th><th>Status</th><th>Duration ms</th><th>Confidence</th><th>Failure</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
}

function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (char) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return map[char] ?? char;
  });
}

function firstFailure(cases: CaseRunResult[]): string | undefined {
  return cases.find((testCase) => testCase.status === "failed")?.failureReason;
}
