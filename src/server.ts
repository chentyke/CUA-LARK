#!/usr/bin/env node
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { LarkAgent } from "./agent.js";
import { casesForSuite, getCaseById, listCases, materializeCase, validateCaseInputs } from "./cases.js";
import { loadConfig, validateRuntimeConfig } from "./config.js";
import { formatDoctor, runDoctor } from "./doctor.js";
import { Planner } from "./planner.js";
import { buildRunReport, createRunDirectory, writeReports } from "./reporter.js";
import type { CaseRunResult, PlannedCase, RunReport } from "./types.js";
import { nowIso, timestampForId } from "./time.js";

type JobStatus = "queued" | "running" | "passed" | "failed";

interface Job {
  id: string;
  status: JobStatus;
  title: string;
  createdAt: string;
  updatedAt: string;
  logs: string[];
  report?: RunReport;
  reportPaths?: { json: string; markdown: string; html: string };
  error?: string;
}

interface RunRequest {
  mode?: "instruction" | "case" | "suite";
  instruction?: string;
  caseId?: string;
  suite?: string;
  dryRun?: boolean;
}

interface LlmConfigRequest {
  baseURL?: string;
  model?: string;
  apiKey?: string;
  clearApiKey?: boolean;
}

const ROOT = process.cwd();
const PUBLIC_DIR = path.join(ROOT, "web");
const PORT = Number(process.env.PORT ?? 4173);
const jobs = new Map<string, Job>();

const server = http.createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`CUA-Lark frontend: ${url}`);
});

async function route(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", `http://localhost:${PORT}`);
  if (request.method === "GET" && url.pathname === "/api/config") {
    const config = loadConfig();
    sendJson(response, 200, {
      larkAppName: config.lark.appName,
      model: config.vlm.model,
      baseURL: config.vlm.baseURL,
      hasApiKey: Boolean(config.vlm.apiKey),
      runsDir: config.artifacts.runsDir,
      maxAttempts: config.agent.maxAttempts,
      retryDelayMs: config.agent.retryDelayMs
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/config/llm") {
    const body = (await readJson(request)) as LlmConfigRequest;
    await updateLlmConfig(body);
    const config = loadConfig();
    sendJson(response, 200, {
      model: config.vlm.model,
      baseURL: config.vlm.baseURL,
      hasApiKey: Boolean(config.vlm.apiKey)
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/doctor") {
    const checks = runDoctor(loadConfig());
    sendJson(response, 200, { checks, text: formatDoctor(checks) });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/cases") {
    sendJson(response, 200, { cases: listCases() });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/jobs") {
    sendJson(response, 200, { jobs: [...jobs.values()].map(summarizeJob).reverse() });
    return;
  }

  const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
  if (request.method === "GET" && jobMatch) {
    const job = jobs.get(jobMatch[1]);
    if (!job) {
      sendJson(response, 404, { error: "Job not found" });
      return;
    }
    sendJson(response, 200, serializeJob(job));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/run") {
    if ([...jobs.values()].some((job) => job.status === "queued" || job.status === "running")) {
      sendJson(response, 409, { error: "A CUA job is already running. Wait for it to finish before starting another." });
      return;
    }
    const body = (await readJson(request)) as RunRequest;
    const job = createJob(body);
    jobs.set(job.id, job);
    runJob(job, body).catch((error) => {
      job.status = "failed";
      job.updatedAt = nowIso();
      job.error = error instanceof Error ? error.message : String(error);
      job.logs.push(`Failed: ${job.error}`);
    });
    sendJson(response, 202, serializeJob(job));
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/runs/")) {
    await serveRunArtifact(url.pathname, response);
    return;
  }

  if (request.method === "GET") {
    await serveStatic(url.pathname === "/" ? "/index.html" : url.pathname, response);
    return;
  }

  sendJson(response, 405, { error: "Method not allowed" });
}

async function runJob(job: Job, body: RunRequest): Promise<void> {
  job.status = "running";
  job.updatedAt = nowIso();
  job.logs.push("Loading configuration.");

  const config = loadConfig();
  const dryRun = Boolean(body.dryRun);
  const issues = validateRuntimeConfig(config, dryRun);
  if (issues.length) throw new Error(issues.join(" "));
  const inputIssues = validateRunRequestInputs(config, dryRun, body);
  if (inputIssues.length) throw new Error(inputIssues.join(" "));

  const startedAt = nowIso();
  const runDir = await createRunDirectory(config.artifacts.runsDir, job.id);
  const planner = new Planner();
  const agent = new LarkAgent(config);
  const plannedCases = buildPlannedCases(planner, config, body);
  const results: CaseRunResult[] = [];

  for (const plannedCase of plannedCases) {
    job.logs.push(`Running ${plannedCase.id}: ${plannedCase.description}`);
    const result = await agent.runCase(plannedCase, { dryRun, runDir });
    results.push(result);
    job.logs.push(`${plannedCase.id} -> ${result.status}`);
  }

  const report = buildRunReport({
    runId: job.id,
    suite: body.mode === "suite" ? body.suite ?? "standard" : plannedCases[0]?.id ?? "custom",
    dryRun,
    startedAt,
    cases: results
  });
  const reportPaths = await writeReports(report, runDir);

  job.report = report;
  job.reportPaths = reportPaths;
  job.status = report.status === "passed" ? "passed" : "failed";
  job.updatedAt = nowIso();
  job.logs.push(`Report written: ${reportPaths.html}`);
}

function buildPlannedCases(planner: Planner, config: ReturnType<typeof loadConfig>, body: RunRequest): PlannedCase[] {
  if (body.mode === "case") {
    if (!body.caseId) throw new Error("caseId is required.");
    const testCase = getCaseById(body.caseId);
    if (!testCase) throw new Error(`Unknown case id: ${body.caseId}`);
    return [planner.fromCase(materializeCase(testCase, config))];
  }
  if (body.mode === "suite") {
    return casesForSuite(body.suite ?? "standard").map((testCase) => planner.fromCase(materializeCase(testCase, config)));
  }
  const instruction = body.instruction?.trim();
  if (!instruction) throw new Error("instruction is required.");
  return [planner.fromInstruction(instruction)];
}

function validateRunRequestInputs(config: ReturnType<typeof loadConfig>, dryRun: boolean, body: RunRequest): string[] {
  if (body.mode === "case") {
    const testCase = body.caseId ? getCaseById(body.caseId) : undefined;
    return testCase ? validateCaseInputs([testCase], config, dryRun) : [];
  }
  if (body.mode === "suite") {
    return validateCaseInputs(casesForSuite(body.suite ?? "standard"), config, dryRun);
  }
  return [];
}

function createJob(body: RunRequest): Job {
  const mode = body.mode ?? "instruction";
  const title =
    mode === "case"
      ? `case:${body.caseId ?? "unknown"}`
      : mode === "suite"
        ? `suite:${body.suite ?? "standard"}`
        : body.instruction?.slice(0, 48) || "custom instruction";
  const id = `run-web-${timestampForId()}`;
  const now = nowIso();
  return {
    id,
    status: "queued",
    title,
    createdAt: now,
    updatedAt: now,
    logs: ["Queued from web console."]
  };
}

async function updateLlmConfig(body: LlmConfigRequest): Promise<void> {
  const baseURL = normalizeOptionalString(body.baseURL);
  const model = normalizeOptionalString(body.model);
  const apiKey = normalizeOptionalString(body.apiKey);

  if (baseURL !== undefined && baseURL && !isLikelyHttpUrl(baseURL)) {
    throw new Error("VLM_BASE_URL must start with http:// or https://.");
  }

  const updates: Record<string, string> = {};
  if (baseURL !== undefined) updates.VLM_BASE_URL = baseURL;
  if (model !== undefined) updates.VLM_MODEL = model;
  if (body.clearApiKey) {
    updates.VLM_API_KEY = "";
  } else if (apiKey) {
    updates.VLM_API_KEY = apiKey;
  }

  if (Object.keys(updates).length === 0) return;
  await writeDotEnvUpdates(path.resolve(".env"), updates);
  for (const [key, value] of Object.entries(updates)) {
    process.env[key] = value;
  }
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error("LLM config fields must be strings.");
  return value.trim();
}

function isLikelyHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

async function writeDotEnvUpdates(envPath: string, updates: Record<string, string>): Promise<void> {
  const existing = fs.existsSync(envPath) ? await fsp.readFile(envPath, "utf8") : "";
  const lines = existing ? existing.split(/\r?\n/) : [];
  const remaining = new Set(Object.keys(updates));
  const nextLines = lines.map((line) => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!match || !remaining.has(match[1])) return line;
    const key = match[1];
    remaining.delete(key);
    return `${key}=${formatEnvValue(updates[key])}`;
  });

  for (const key of remaining) {
    nextLines.push(`${key}=${formatEnvValue(updates[key])}`);
  }

  const output = `${nextLines.join("\n").replace(/\n*$/, "")}\n`;
  await fsp.writeFile(envPath, output, "utf8");
}

function formatEnvValue(value: string): string {
  if (/^[A-Za-z0-9_./:@-]*$/.test(value)) return value;
  return JSON.stringify(value);
}

function summarizeJob(job: Job): object {
  return {
    id: job.id,
    status: job.status,
    title: job.title,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    successRate: job.report?.successRate,
    reportUrl: job.reportPaths ? `/runs/${job.id}/report.html` : undefined
  };
}

function serializeJob(job: Job): object {
  return {
    ...summarizeJob(job),
    logs: job.logs,
    error: job.error,
    report: job.report,
    reportMarkdownUrl: job.reportPaths ? `/runs/${job.id}/report.md` : undefined,
    reportJsonUrl: job.reportPaths ? `/runs/${job.id}/report.json` : undefined
  };
}

async function readJson(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function sendJson(response: http.ServerResponse, status: number, data: unknown): void {
  const payload = JSON.stringify(data);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload)
  });
  response.end(payload);
}

async function serveStatic(urlPath: string, response: http.ServerResponse): Promise<void> {
  const filePath = safeJoin(PUBLIC_DIR, decodeURIComponent(urlPath));
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  await sendFile(filePath, response);
}

async function serveRunArtifact(urlPath: string, response: http.ServerResponse): Promise<void> {
  const relative = urlPath.replace(/^\/runs\//, "");
  const filePath = safeJoin(path.resolve("artifacts/runs"), relative);
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  await sendFile(filePath, response);
}

async function sendFile(filePath: string, response: http.ServerResponse): Promise<void> {
  const data = await fsp.readFile(filePath);
  response.writeHead(200, { "content-type": contentType(filePath), "content-length": data.length });
  response.end(data);
}

function safeJoin(root: string, urlPath: string): string | undefined {
  const normalized = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  const fullPath = path.resolve(root, `.${path.sep}${normalized}`);
  return fullPath.startsWith(path.resolve(root)) ? fullPath : undefined;
}

function contentType(filePath: string): string {
  const ext = path.extname(filePath);
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".md") return "text/markdown; charset=utf-8";
  if (ext === ".png") return "image/png";
  return "application/octet-stream";
}

process.on("SIGINT", () => {
  console.log("\nStopping CUA-Lark frontend.");
  server.close(() => process.exit(0));
});

console.log(`Serving static assets from ${pathToFileURL(PUBLIC_DIR).href}`);
