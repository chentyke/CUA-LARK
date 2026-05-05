import { beforeEach, describe, expect, it, vi } from "vitest";
import { LarkAgent } from "../src/agent.js";
import type { AgentEvent, AppConfig, PlannedCase, StepResult, VerificationResult } from "../src/types.js";

const mocks = vi.hoisted(() => ({
  guiRun: vi.fn(),
  runDeterministicStandardCase: vi.fn(),
  verify: vi.fn()
}));

vi.mock("../src/standardGuard.js", () => ({
  runDeterministicStandardCase: mocks.runDeterministicStandardCase
}));

vi.mock("../src/verifier.js", () => ({
  Verifier: class {
    verify = mocks.verify;
  }
}));

vi.mock("../src/operator.js", () => ({
  LarkOperator: class {
    private readonly events: AgentEvent[] = [];
    private readonly screenshots: string[] = [];

    async focusApp(): Promise<void> {
      this.recordSystemEvent("Focused Lark.");
    }

    async screenshot(): Promise<unknown> {
      const screenshot = `/tmp/lark-cua-agent-retry-${this.screenshots.length + 1}.png`;
      this.screenshots.push(screenshot);
      this.recordSystemEvent("Captured screenshot.", { screenshot });
      return {};
    }

    getEvents(): AgentEvent[] {
      return [...this.events];
    }

    getScreenshots(): string[] {
      return [...this.screenshots];
    }

    recordSystemEvent(message: string, data?: unknown): void {
      this.events.push({
        timestamp: "2026-05-04T00:00:00.000Z",
        type: "system",
        message,
        data
      });
    }
  }
}));

vi.mock("@ui-tars/sdk", () => ({
  GUIAgent: class {
    async run(instruction: string): Promise<void> {
      mocks.guiRun(instruction);
    }
  }
}));

describe("agent retry policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.guiRun.mockResolvedValue(undefined);
  });

  it("continues with a corrective retry after deterministic standard execution fails", async () => {
    mocks.runDeterministicStandardCase.mockResolvedValue(deterministicStep("failed", "coordinate miss"));
    mocks.verify.mockResolvedValue(verification(true));

    const result = await new LarkAgent(config()).runCase(plannedCase(), { dryRun: false, runDir: "/tmp/lark-cua-agent-retry" });

    expect(result.status).toBe("passed");
    expect(result.steps[0]).toMatchObject({ status: "failed", failureReason: "coordinate miss" });
    expect(mocks.guiRun).toHaveBeenCalledTimes(1);
    expect(mocks.guiRun.mock.calls[0]?.[0]).toContain("retry attempt 2");
  });

  it("continues with a corrective retry when deterministic execution passes but final verification fails", async () => {
    mocks.runDeterministicStandardCase.mockResolvedValue(deterministicStep("passed"));
    mocks.verify.mockResolvedValueOnce(verification(false, "The target message is missing.")).mockResolvedValueOnce(verification(true));

    const result = await new LarkAgent(config()).runCase(plannedCase(), { dryRun: false, runDir: "/tmp/lark-cua-agent-retry" });

    expect(result.status).toBe("passed");
    expect(result.steps.some((step) => step.objective.includes("corrective attempt 2"))).toBe(true);
    expect(mocks.guiRun).toHaveBeenCalledTimes(1);
    expect(mocks.guiRun.mock.calls[0]?.[0]).toContain("Previous verification/error reason: The target message is missing.");
  });
});

function config(): AppConfig {
  return {
    vlm: {
      baseURL: "https://example.com/v1",
      apiKey: "test-key",
      model: "test-model"
    },
    lark: {
      appName: "Lark",
      appPath: "/Applications/Lark.app",
      testChat: "Test Chat",
      testAttendee: ""
    },
    agent: {
      maxSteps: 5,
      defaultTimeoutMs: 180000,
      retryOnVerificationFailure: true,
      maxAttempts: 2,
      retryDelayMs: 0
    },
    artifacts: {
      runsDir: "/tmp"
    },
    configPath: "cua.config.json"
  };
}

function plannedCase(): PlannedCase {
  return {
    id: "im-send-text",
    product: "im",
    description: "Send a test message.",
    instruction: "Open Lark IM, search for 'Test Chat', send the message 'Hello', and confirm it is visible.",
    successCriteria: ["The target chat is open.", "The latest message contains Hello."],
    preconditions: ["Lark is logged in."],
    maxSteps: 5,
    timeoutMs: 180000,
    tags: ["standard"],
    steps: [
      {
        index: 1,
        objective: "Run the IM standard case.",
        successCriteria: ["The latest message contains Hello."]
      }
    ]
  };
}

function deterministicStep(status: StepResult["status"], failureReason?: string): StepResult {
  return {
    index: 1,
    objective: "Deterministic standard execution.",
    status,
    startedAt: "2026-05-04T00:00:00.000Z",
    finishedAt: "2026-05-04T00:00:00.000Z",
    durationMs: 0,
    screenshots: [],
    modelCalls: 0,
    events: [],
    failureReason
  };
}

function verification(passed: boolean, reason = "Verified."): VerificationResult {
  return {
    passed,
    confidence: passed ? 1 : 0,
    reason,
    evidence: []
  };
}
