import path from "node:path";
import type { AppConfig, CaseRunResult, PlannedCase, StepResult, VerificationResult } from "./types.js";
import { durationMs, nowIso } from "./time.js";
import { PopupGuard } from "./popupGuard.js";
import { Verifier } from "./verifier.js";

interface RuntimeOperator {
  focusApp(): Promise<void>;
  screenshot(): Promise<unknown>;
  getEvents(): Array<unknown>;
  getScreenshots(): string[];
}

export class LarkAgent {
  private readonly popupGuard = new PopupGuard();
  private readonly verifier: Verifier;

  constructor(private readonly config: AppConfig) {
    this.verifier = new Verifier(config);
  }

  async runCase(plannedCase: PlannedCase, options: { dryRun: boolean; runDir: string }): Promise<CaseRunResult> {
    if (options.dryRun) {
      return this.runDryCase(plannedCase);
    }

    const startedAt = nowIso();
    const steps: StepResult[] = [];
    const screenshotDir = path.join(options.runDir, "screenshots", plannedCase.id);
    const { LarkOperator } = await import("./operator.js");
    const operator = new LarkOperator({
      appName: this.config.lark.appName,
      screenshotDir
    });

    try {
      await operator.focusApp();
      for (const step of plannedCase.steps) {
        const stepResult = await this.runStep(plannedCase, step.objective, step.index, operator);
        steps.push(stepResult);
        if (stepResult.status === "failed") break;
      }

      const verification = await this.verifyWithRetry(plannedCase, operator, steps, false);
      const finishedAt = nowIso();
      const status = steps.every((step) => step.status === "passed") && verification.passed ? "passed" : "failed";

      return {
        id: plannedCase.id,
        product: plannedCase.product,
        description: plannedCase.description,
        instruction: plannedCase.instruction,
        status,
        startedAt,
        finishedAt,
        durationMs: durationMs(startedAt, finishedAt),
        steps,
        successCriteria: plannedCase.successCriteria,
        screenshots: operator.getScreenshots(),
        modelCalls: steps.reduce((total, step) => total + step.modelCalls, 0),
        verification,
        failureReason: status === "failed" ? verification.reason : undefined
      };
    } catch (error) {
      const finishedAt = nowIso();
      return {
        id: plannedCase.id,
        product: plannedCase.product,
        description: plannedCase.description,
        instruction: plannedCase.instruction,
        status: "failed",
        startedAt,
        finishedAt,
        durationMs: durationMs(startedAt, finishedAt),
        steps,
        successCriteria: plannedCase.successCriteria,
        screenshots: operator.getScreenshots(),
        modelCalls: steps.reduce((total, step) => total + step.modelCalls, 0),
        failureReason: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async runStep(plannedCase: PlannedCase, objective: string, index: number, operator: RuntimeOperator): Promise<StepResult> {
    const startedAt = nowIso();

    const eventsBefore = operator.getEvents().length;
    let modelCalls = 0;
    const { GUIAgent } = await import("@ui-tars/sdk");
    const agent = new GUIAgent({
      model: {
        baseURL: this.config.vlm.baseURL,
        apiKey: this.config.vlm.apiKey,
        model: this.config.vlm.model
      },
      operator: operator as never,
      maxLoopCount: Math.min(plannedCase.maxSteps, this.config.agent.maxSteps),
      logger: silentLogger,
      onData: ({ data }: { data: unknown }) => {
        modelCalls += estimateModelCalls(data);
      },
      onError: ({ error }: { error: unknown }) => {
        throw error;
      }
    } as never);

    const instruction = this.popupGuard.augmentInstruction(objective);
    await agent.run(instruction);
    const finishedAt = nowIso();
    const events = operator.getEvents().slice(eventsBefore);

    return {
      index,
      objective,
      status: "passed",
      startedAt,
      finishedAt,
      durationMs: durationMs(startedAt, finishedAt),
      screenshots: operator.getScreenshots(),
      modelCalls,
      events: events as never
    };
  }

  private async verifyWithRetry(
    plannedCase: PlannedCase,
    operator: RuntimeOperator,
    steps: StepResult[],
    dryRun: boolean
  ): Promise<VerificationResult> {
    let verification = await this.verifier.verify({
      instruction: plannedCase.instruction,
      successCriteria: plannedCase.successCriteria,
      screenshots: operator.getScreenshots(),
      dryRun
    });

    if (verification.passed || dryRun || !this.config.agent.retryOnVerificationFailure) return verification;

    const retryStart = nowIso();
    try {
      await operator.screenshot();
      verification = await this.verifier.verify({
        instruction: `${plannedCase.instruction}\n\nRetry verification after fresh screenshot.`,
        successCriteria: plannedCase.successCriteria,
        screenshots: operator.getScreenshots(),
        dryRun
      });
    } catch (error) {
      const retryEnd = nowIso();
      steps.push({
        index: steps.length + 1,
        objective: "Self-healing verification retry",
        status: "failed",
        startedAt: retryStart,
        finishedAt: retryEnd,
        durationMs: durationMs(retryStart, retryEnd),
        screenshots: operator.getScreenshots(),
        modelCalls: 0,
        events: operator.getEvents() as never,
        failureReason: error instanceof Error ? error.message : String(error)
      });
    }
    return verification;
  }

  private async runDryCase(plannedCase: PlannedCase): Promise<CaseRunResult> {
    const startedAt = nowIso();
    const steps = plannedCase.steps.map<StepResult>((step) => {
      const stepStartedAt = nowIso();
      const stepFinishedAt = nowIso();
      return {
        index: step.index,
        objective: step.objective,
        status: "passed",
        startedAt: stepStartedAt,
        finishedAt: stepFinishedAt,
        durationMs: durationMs(stepStartedAt, stepFinishedAt),
        screenshots: [],
        modelCalls: 0,
        events: [
          {
            timestamp: stepFinishedAt,
            type: "system",
            message: `Dry-run completed step ${step.index}.`
          }
        ]
      };
    });
    const verification = await this.verifier.verify({
      instruction: plannedCase.instruction,
      successCriteria: plannedCase.successCriteria,
      screenshots: [],
      dryRun: true
    });
    const finishedAt = nowIso();
    return {
      id: plannedCase.id,
      product: plannedCase.product,
      description: plannedCase.description,
      instruction: plannedCase.instruction,
      status: verification.passed ? "passed" : "failed",
      startedAt,
      finishedAt,
      durationMs: durationMs(startedAt, finishedAt),
      steps,
      successCriteria: plannedCase.successCriteria,
      screenshots: [],
      modelCalls: 0,
      verification,
      failureReason: verification.passed ? undefined : verification.reason
    };
  }
}

const silentLogger = {
  log: () => undefined,
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined
};

function estimateModelCalls(data: unknown): number {
  if (!data || typeof data !== "object") return 0;
  const maybeData = data as { conversations?: Array<{ from?: string }> };
  return maybeData.conversations?.some((entry) => entry.from === "gpt") ? 1 : 0;
}
