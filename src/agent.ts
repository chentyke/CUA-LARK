import path from "node:path";
import type { AppConfig, CaseRunResult, PlannedCase, PlannedStep, StepResult, VerificationResult } from "./types.js";
import { durationMs, nowIso } from "./time.js";
import { compatibleSystemPrompt, modelConfigWithCompat } from "./modelCompat.js";
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
      const maxAttempts = this.config.agent.retryOnVerificationFailure ? this.config.agent.maxAttempts : 1;
      let verification: VerificationResult | undefined;
      let failureReason: string | undefined;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const attemptSteps = attempt === 1 ? plannedCase.steps : buildRetrySteps(plannedCase, attempt, failureReason);
        try {
          for (const step of attemptSteps) {
            const stepResult = await this.runStep(plannedCase, step.objective, steps.length + 1, operator);
            steps.push(stepResult);
            if (stepResult.status === "failed") break;
          }
        } catch (error) {
          const retryable = !isClearlyFatalError(error);
          failureReason = error instanceof Error ? error.message : String(error);
          steps.push(buildFailedStep(steps.length + 1, attempt, failureReason, operator));
          if (!retryable || attempt >= maxAttempts) throw error;
          await waitForRetry(this.config.agent.retryDelayMs, attempt, error);
          continue;
        }

        await operator.screenshot();
        verification = await this.verifier.verify({
          instruction: plannedCase.instruction,
          successCriteria: plannedCase.successCriteria,
          screenshots: operator.getScreenshots(),
          dryRun: false
        });
        if (verification.passed) break;

        failureReason = verification.reason;
        if (attempt < maxAttempts) {
          steps.push(buildRetryMarkerStep(steps.length + 1, attempt + 1, verification, operator));
          await waitForRetry(this.config.agent.retryDelayMs, attempt);
          continue;
        }
      }

      const finishedAt = nowIso();
      const status = verification?.passed ? "passed" : "failed";

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
        failureReason: status === "failed" ? verification?.reason ?? failureReason : undefined
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
    const systemPrompt = compatibleSystemPrompt(this.config.vlm.baseURL);
    const agent = new GUIAgent({
      model: modelConfigWithCompat(this.config.vlm),
      operator: operator as never,
      ...(systemPrompt ? { systemPrompt } : {}),
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

function buildRetrySteps(plannedCase: PlannedCase, attempt: number, previousFailure?: string): PlannedStep[] {
  return [
    {
      index: attempt,
      objective: [
        `Continue the Lark desktop task from the current screen. This is retry attempt ${attempt}.`,
        `Original instruction: ${plannedCase.instruction}`,
        previousFailure ? `Previous verification/error reason: ${previousFailure}` : undefined,
        `Success criteria:\n${plannedCase.successCriteria.map((item) => `- ${item}`).join("\n")}`,
        "Do not redo work that is already visibly complete.",
        "Focus only on missing requirements, especially permissions, recipients, formatting, final submit buttons, and visible confirmation state.",
        "Before finishing, leave the strongest available success evidence visible on screen, such as the sent message, share dialog recipient with edit permission, success toast, or final created item."
      ]
        .filter(Boolean)
        .join("\n\n"),
      successCriteria: plannedCase.successCriteria
    }
  ];
}

function buildFailedStep(index: number, attempt: number, reason: string, operator: RuntimeOperator): StepResult {
  const finishedAt = nowIso();
  return {
    index,
    objective: `Attempt ${attempt} hit a retryable execution error.`,
    status: "skipped",
    startedAt: finishedAt,
    finishedAt,
    durationMs: 0,
    screenshots: operator.getScreenshots(),
    modelCalls: 0,
    events: operator.getEvents() as never,
    failureReason: reason
  };
}

function buildRetryMarkerStep(
  index: number,
  nextAttempt: number,
  verification: VerificationResult,
  operator: RuntimeOperator
): StepResult {
  const finishedAt = nowIso();
  return {
    index,
    objective: `Verification failed; retrying with corrective attempt ${nextAttempt}.`,
    status: "skipped",
    startedAt: finishedAt,
    finishedAt,
    durationMs: 0,
    screenshots: operator.getScreenshots(),
    modelCalls: 0,
    events: [
      ...operator.getEvents(),
      {
        timestamp: finishedAt,
        type: "verification",
        message: verification.reason,
        data: verification
      }
    ] as never,
    failureReason: verification.reason
  };
}

async function waitForRetry(baseDelayMs: number, attempt: number, error?: unknown): Promise<void> {
  const retryAfterMs = retryAfterFromError(error);
  const delayMs = retryAfterMs ?? Math.min(Math.max(baseDelayMs, 0) * attempt, 60000);
  if (delayMs <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

function retryAfterFromError(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const maybe = error as { headers?: { get?: (name: string) => string | null }; response?: { headers?: { get?: (name: string) => string | null } } };
  const value = maybe.headers?.get?.("retry-after") ?? maybe.response?.headers?.get?.("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : undefined;
}

export function isClearlyFatalError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const lower = message.toLowerCase();
  if (/\b429\b/.test(lower) || lower.includes("rate limit") || lower.includes("tpm")) return false;
  if (lower.includes("float_type") || lower.includes("frequency_penalty") || lower.includes("presence_penalty")) {
    return true;
  }
  return [
    "401",
    "403",
    "api key",
    "unauthorized",
    "forbidden",
    "invalid model",
    "model not found",
    "vlm_base_url",
    "vlm_api_key",
    "vlm_model",
    "accessibility permission",
    "screen recording",
    "not permitted",
    "not authorized",
    "application is not found"
  ].some((needle) => lower.includes(needle));
}
