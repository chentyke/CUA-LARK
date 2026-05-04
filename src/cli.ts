#!/usr/bin/env node
import { Command } from "commander";
import path from "node:path";
import { LarkAgent } from "./agent.js";
import { getCaseById, casesForSuite, listCases, materializeCase, validateCaseInputs } from "./cases.js";
import { loadConfig, validateRuntimeConfig } from "./config.js";
import { formatDoctor, runDoctor } from "./doctor.js";
import { describeGuiAction, parseGuiActions, runGuiActions } from "./guiActions.js";
import { Planner } from "./planner.js";
import { buildRunReport, createRunDirectory, writeReports } from "./reporter.js";
import { writeSubmissionPackage } from "./submission.js";
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
  .command("ops")
  .description("Run a JSON sequence of primitive GUI actions against the Lark desktop client.")
  .requiredOption("--actions <json>", "JSON array: click, doubleClick, rightClick, drag, scroll, typeText, hotkey, wait")
  .option("--dry-run", "Validate and print actions without controlling Lark", false)
  .action(async (options: { actions: string; dryRun: boolean }) => {
    const globalOptions = program.opts<{ config: string }>();
    const config = loadConfig(globalOptions.config);
    const actions = parseGuiActions(options.actions);
    const events = await runGuiActions(actions, { appName: config.lark.appName, dryRun: options.dryRun });
    for (const event of events) {
      console.log(`[${event.status.toUpperCase()}] ${event.index}. ${describeGuiAction(event.action)}`);
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
    if (options.case) {
      const testCase = getCaseById(options.case);
      if (testCase) validateCaseInputsOrExit(config, options.dryRun, [testCase]);
    }

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
    const suiteCases = casesForSuite(options.suite);
    validateCaseInputsOrExit(config, options.dryRun, suiteCases);

    const startedAt = nowIso();
    const runId = `run-${options.suite}-${timestampForId()}`;
    const runDir = await createRunDirectory(config.artifacts.runsDir, runId);
    const planner = new Planner();
    const agent = new LarkAgent(config);
    const results: CaseRunResult[] = [];

    for (const testCase of suiteCases) {
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

program
  .command("submit")
  .description("Run a suite and generate a competition submission package with PNG evidence.")
  .option("--suite <name>", "Suite name", "standard")
  .option("--dry-run", "Use mock execution without controlling Lark", false)
  .option("--project-name <name>", "Project name for the submission report", "CUA-Lark")
  .option("--members <names>", "Comma-separated team member names", "陈正洋,刘俊熙")
  .action(async (options: { suite: string; dryRun: boolean; projectName: string; members: string }) => {
    const globalOptions = program.opts<{ config: string }>();
    const config = loadConfig(globalOptions.config);
    validateOrExit(config, options.dryRun);
    const suiteCases = casesForSuite(options.suite);
    validateCaseInputsOrExit(config, options.dryRun, suiteCases);

    const startedAt = nowIso();
    const runId = `run-submit-${options.suite}-${timestampForId()}`;
    const runDir = await createRunDirectory(config.artifacts.runsDir, runId);
    const planner = new Planner();
    const agent = new LarkAgent(config);
    const results: CaseRunResult[] = [];

    for (const testCase of suiteCases) {
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
    const submissionPaths = await writeSubmissionPackage(report, runDir, {
      projectName: options.projectName,
      members: parseMembers(options.members)
    });

    printRunSummary(report.status, paths.markdown, paths.html);
    console.log(`Submission Markdown: ${path.resolve(submissionPaths.markdown)}`);
    console.log(`Submission HTML: ${path.resolve(submissionPaths.html)}`);
    console.log(`Evidence images: ${submissionPaths.evidenceImages.length}`);
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

function validateCaseInputsOrExit(
  config: ReturnType<typeof loadConfig>,
  dryRun: boolean,
  testCases: ReturnType<typeof casesForSuite>
): void {
  const issues = validateCaseInputs(testCases, config, dryRun);
  if (issues.length === 0) return;
  throw new Error(`Case inputs are not ready:\n${issues.map((issue) => `- ${issue}`).join("\n")}`);
}

function printRunSummary(status: string, markdownPath: string, htmlPath: string): void {
  console.log(`Status: ${status}`);
  console.log(`Markdown report: ${path.resolve(markdownPath)}`);
  console.log(`HTML report: ${path.resolve(htmlPath)}`);
}

function parseMembers(input: string): string[] {
  return input
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
