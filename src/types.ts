export type Product = "im" | "docs" | "calendar" | "cross-product" | "custom";

export type CaseStatus = "passed" | "failed" | "skipped";

export interface VlmConfig {
  baseURL: string;
  apiKey: string;
  model: string;
}

export interface LarkConfig {
  appName: string;
  appPath: string;
  testChat: string;
  testAttendee: string;
}

export interface AgentConfig {
  maxSteps: number;
  defaultTimeoutMs: number;
  retryOnVerificationFailure: boolean;
  maxAttempts: number;
  retryDelayMs: number;
}

export interface ArtifactsConfig {
  runsDir: string;
}

export interface AppConfig {
  vlm: VlmConfig;
  lark: LarkConfig;
  agent: AgentConfig;
  artifacts: ArtifactsConfig;
  configPath: string;
}

export interface TestCase {
  id: string;
  product: Product;
  description: string;
  instruction: string;
  successCriteria: string[];
  preconditions: string[];
  maxSteps: number;
  timeoutMs: number;
  tags: string[];
  logicalSteps: string[];
}

export interface PlannedStep {
  index: number;
  objective: string;
  successCriteria: string[];
}

export interface PlannedCase {
  id: string;
  product: Product;
  description: string;
  instruction: string;
  successCriteria: string[];
  preconditions: string[];
  maxSteps: number;
  timeoutMs: number;
  tags: string[];
  steps: PlannedStep[];
}

export interface AgentEvent {
  timestamp: string;
  type: "agent-data" | "agent-error" | "operator-action" | "screenshot" | "verification" | "system";
  message: string;
  data?: unknown;
}

export interface StepResult {
  index: number;
  objective: string;
  status: CaseStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  screenshots: string[];
  modelCalls: number;
  events: AgentEvent[];
  failureReason?: string;
}

export interface VerificationResult {
  passed: boolean;
  confidence: number;
  reason: string;
  evidence: string[];
  raw?: string;
}

export interface CaseRunResult {
  id: string;
  product: Product;
  description: string;
  instruction: string;
  status: CaseStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  steps: StepResult[];
  successCriteria: string[];
  screenshots: string[];
  modelCalls: number;
  verification?: VerificationResult;
  failureReason?: string;
}

export interface RunReport {
  runId: string;
  suite: string;
  dryRun: boolean;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: CaseStatus;
  successRate: number;
  modelCalls: number;
  screenshots: string[];
  cases: CaseRunResult[];
  failureReason?: string;
}

export interface RunOptions {
  dryRun: boolean;
  runDir: string;
}
