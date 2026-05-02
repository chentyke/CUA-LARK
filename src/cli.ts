#!/usr/bin/env node
import { Command } from "commander";
import path from "node:path";
import { LarkAgent } from "./agent.js";
import { getCaseById, casesForSuite, listCases, materializeCase } from "./cases.js";
import { loadConfig, validateRuntimeConfig } from "./config.js";
import { formatDoctor, runDoctor } from "./doctor.js";
import { Planner } from "./planner.js";
import { buildRunReport, createRunDirectory, writeReports } from "./reporter.js";
import type { CaseRunResult, PlannedCase } from "./types.js";
import { nowIso, timestampForId } from "./time.js";

const program = new Command();

program
  .name("lark-cua")
  .description("CUA-Lark intelligent desktop testing agent powered by UI-TARS.")
  .option("-c, --config <path>", "Path to cua.config.json", "cua.config.json");

program.command("doctor").description("Check local runtime, Lark, permissions, and VLM config.").action(() => {
  const options = program.opts<{ config: string }>();
  const config = loadConfig(options.config);
  console.log(formatDoctor(runDoctor(config)));
});

program.command("list").description("List built-in CUA-Lark test cases.").action(() => {
  for (const testCase of listCases()) {
    console.log(`${testCase.id}\t${testCase.product}\t${testCase.description}`);
  }
});

program
  .command("run")
  .description("Run a built-in case or an ad hoc natural-language instruction.")
  .option("--case <id>", "Built-in case id")
  .option("--instruction <text>", "Ad hoc natural-language instruction")
  .option("--dry-run", "Use mock execution without controlling Lark", false)
  .action(async (options: { case?: string; instruction?: string; dryRun: boolean }) => {
    const globalOptions = program.opts<{ config: string }>();
    const config = loadConfig(globalOptions.config);
    validateOrExit(config, options.dryRun);

    const planner = new Planner();
    const plannedCase = buildPlannedCase(planner, config, options);
    const runId = `run-${plannedCase.id}-${timestampForId()}`;
    const runDir = await createRunDirectory(config.artifacts.runsDir, runId);
    const result = await new LarkAgent(config).runCase(plannedCase, { dryRun: options.dryRun, runDir });
    const report = buildRunReport({
      runId,
      suite: plannedCase.id,
      dryRun: options.dryRun,
      startedAt: result.startedAt,
      cases: [result]
    });
    const paths = await writeReports(report, runDir);
    printRunSummary(report.status, paths.markdown, paths.html);
    process.exitCode = report.status === "passed" ? 0 : 1;
  });

program
  .command("eval")
  .description("Run a case suite and generate JSON, Markdown, and HTML reports.")
  .option("--suite <name>", "Suite name", "standard")
  .option("--dry-run", "Use mock execution without controlling Lark", false)
  .action(async (options: { suite: string; dryRun: boolean }) => {
    const globalOptions = program.opts<{ config: string }>();
    const config = loadConfig(globalOptions.config);
    validateOrExit(config, options.dryRun);

    const startedAt = nowIso();
    const runId = `run-${options.suite}-${timestampForId()}`;
    const runDir = await createRunDirectory(config.artifacts.runsDir, runId);
    const planner = new Planner();
    const agent = new LarkAgent(config);
    const cases = casesForSuite(options.suite);
    const results: CaseRunResult[] = [];

    for (const testCase of cases) {
      const materialized = materializeCase(testCase, config);
      const plannedCase = planner.fromCase(materialized);
      results.push(await agent.runCase(plannedCase, { dryRun: options.dryRun, runDir }));
    }

    const report = buildRunReport({
      runId,
      suite: options.suite,
      dryRun: options.dryRun,
      startedAt,
      cases: results
    });
    const paths = await writeReports(report, runDir);
    printRunSummary(report.status, paths.markdown, paths.html);
    process.exitCode = report.status === "passed" ? 0 : 1;
  });

program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

function buildPlannedCase(
  planner: Planner,
  config: ReturnType<typeof loadConfig>,
  options: { case?: string; instruction?: string }
): PlannedCase {
  if (options.case) {
    const testCase = getCaseById(options.case);
    if (!testCase) {
      throw new Error(`Unknown case id: ${options.case}`);
    }
    return planner.fromCase(materializeCase(testCase, config));
  }
  if (options.instruction) {
    return planner.fromInstruction(options.instruction);
  }
  throw new Error("Provide either --case <id> or --instruction <text>.");
}

function validateOrExit(config: ReturnType<typeof loadConfig>, dryRun: boolean): void {
  const issues = validateRuntimeConfig(config, dryRun);
  if (issues.length === 0) return;
  throw new Error(`Configuration is not ready:\n${issues.map((issue) => `- ${issue}`).join("\n")}`);
}

function printRunSummary(status: string, markdownPath: string, htmlPath: string): void {
  console.log(`Status: ${status}`);
  console.log(`Markdown report: ${path.resolve(markdownPath)}`);
  console.log(`HTML report: ${path.resolve(htmlPath)}`);
}
