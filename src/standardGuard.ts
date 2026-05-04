import type { AppConfig, AgentEvent, PlannedCase, StepResult, VerificationResult } from "./types.js";
import { durationMs, nowIso } from "./time.js";
import { Verifier } from "./verifier.js";

type NutJs = typeof import("@computer-use/nut-js");
type NutKey = Parameters<NutJs["keyboard"]["pressKey"]>[0];

interface GuardOperator {
  screenshot(): Promise<unknown>;
  getEvents(): AgentEvent[];
  getScreenshots(): string[];
  recordSystemEvent(message: string, data?: unknown): void;
}

interface GuardContext {
  plannedCase: PlannedCase;
  config: AppConfig;
  operator: GuardOperator;
  verifier: Verifier;
}

const handledCases = new Set(["im-send-text", "docs-create-edit", "calendar-create-event"]);
let nutModule: Promise<NutJs> | undefined;

export async function runDeterministicStandardCase({
  plannedCase,
  config,
  operator,
  verifier
}: GuardContext): Promise<StepResult | undefined> {
  if (!handledCases.has(plannedCase.id) || process.env.CUA_DETERMINISTIC_STANDARD === "0") return undefined;

  const startedAt = nowIso();
  const eventsBefore = operator.getEvents().length;
  let modelCalls = 0;
  let failureReason: string | undefined;

  try {
    if (plannedCase.id === "im-send-text") {
      modelCalls += await runImCase(plannedCase, config, operator, verifier);
    } else if (plannedCase.id === "docs-create-edit") {
      await runDocsCase(plannedCase, operator);
    } else if (plannedCase.id === "calendar-create-event") {
      await runCalendarCase(plannedCase, operator);
    }
  } catch (error) {
    failureReason = error instanceof Error ? error.message : String(error);
    operator.recordSystemEvent(`Deterministic standard guard failed: ${failureReason}`);
  }

  const finishedAt = nowIso();
  return {
    index: 1,
    objective: `Deterministic standard execution for ${plannedCase.id}.`,
    status: failureReason ? "failed" : "passed",
    startedAt,
    finishedAt,
    durationMs: durationMs(startedAt, finishedAt),
    screenshots: operator.getScreenshots(),
    modelCalls,
    events: operator.getEvents().slice(eventsBefore),
    failureReason
  };
}

async function runImCase(
  plannedCase: PlannedCase,
  config: AppConfig,
  operator: GuardOperator,
  verifier: Verifier
): Promise<number> {
  const targetChat = config.lark.testChat.trim();
  const message = quotedValueAfter(plannedCase.instruction, "send the message") ?? "CUA-Lark IM smoke";
  if (!targetChat) throw new Error("LARK_TEST_CHAT is required for deterministic IM execution.");
  const { Key } = await desktop();

  operator.recordSystemEvent("Deterministic guard is opening the target IM chat before sending.", { targetChat });
  await press(Key.Escape);
  await click(54, 190, "messages nav", operator);
  await wait(800);
  await click(90, 145, "IM search input", operator);
  await selectAll();
  await paste(targetChat);
  await press(Key.Return);
  await wait(1200);
  await capture(operator, "target IM chat candidate");

  const targetCheck = await verifier.verify({
    instruction: `Verify that the active Lark chat is exactly '${targetChat}'. Do not pass if another group or contact is active.`,
    successCriteria: [
      `The active chat header or send box clearly names '${targetChat}'.`,
      "The current screen is an IM chat, not a global search result or another product."
    ],
    screenshots: operator.getScreenshots(),
    dryRun: false
  });
  recordVerification(operator, "Pre-send recipient guard", targetCheck);
  if (!targetCheck.passed) {
    throw new Error(`Refusing to send message because recipient guard failed: ${targetCheck.reason}`);
  }

  await click(760, 986, "IM message input", operator);
  await paste(message);
  await press(Key.Return);
  await wait(1200);
  await capture(operator, "sent IM message");
  return 1;
}

async function runDocsCase(plannedCase: PlannedCase, operator: GuardOperator): Promise<void> {
  const documentTitle =
    quotedValueAfter(plannedCase.instruction, "enter title") ??
    quotedValueAfter(plannedCase.instruction, "add heading") ??
    "2026年Q2项目进展";
  const body = quotedValueAfter(plannedCase.instruction, "body text") ?? "自动化桌面测试记录";
  const { Key } = await desktop();

  operator.recordSystemEvent("Deterministic guard is creating a blank Lark document and filling required content.");
  await press(Key.Escape);
  await wait(300);
  await click(54, 261, "Docs nav", operator);
  await wait(1800);
  await click(268, 61, "Docs editor close/back if present", operator);
  await wait(800);
  await click(54, 261, "Docs nav after close", operator);
  await wait(1200);
  await click(640, 150, "Docs new menu", operator);
  await wait(600);
  await click(585, 249, "Docs new document option", operator);
  await wait(2500);
  await click(707, 340, "Docs blank document card", operator);
  await wait(5000);

  await click(770, 216, "Docs title field", operator);
  await paste(documentTitle);
  await wait(1200);
  await click(770, 326, "Docs body field", operator);
  await paste(`${documentTitle}\n${body}`);
  await wait(800);
  await capture(operator, "created Docs content");
}

async function runCalendarCase(plannedCase: PlannedCase, operator: GuardOperator): Promise<void> {
  const title = quotedValueAfter(plannedCase.instruction, "event titled") ?? "CUA-Lark 测试会议";
  const tomorrowIndex = tomorrowDayIndex();
  const { Key } = await desktop();

  operator.recordSystemEvent("Deterministic guard is creating the calendar event from the week grid.", {
    tomorrowIndex
  });
  await press(Key.Escape);
  await wait(300);
  await click(54, 514, "Calendar nav", operator);
  await wait(2200);
  await click(502, 132, "Calendar today button", operator);
  await wait(700);
  if (tomorrowIndex === 0) {
    await click(580, 118, "Calendar next week button", operator);
    await wait(700);
  }

  const slot = weekGridSlot(tomorrowIndex, 14);
  await click(slot.x, slot.y, "Calendar tomorrow 14:00 slot", operator);
  await wait(1500);
  await paste(title);
  await wait(500);
  await click(1468, 922, "Calendar save button", operator);
  await wait(1800);
  await capture(operator, "created Calendar event");
}

export function quotedValueAfter(input: string, marker: string): string | undefined {
  const index = input.indexOf(marker);
  if (index < 0) return undefined;
  const match = input.slice(index + marker.length).match(/'([^']+)'/);
  return match?.[1];
}

export function tomorrowDayIndex(now = new Date()): number {
  return (now.getDay() + 1) % 7;
}

export function weekGridSlot(dayIndex: number, hour: number): { x: number; y: number } {
  const clampedDay = Math.min(6, Math.max(0, dayIndex));
  const clampedHour = Math.min(23, Math.max(0, hour));
  return {
    x: Math.round(604 + clampedDay * 182),
    y: Math.round(269 + (clampedHour - 8) * 48.5)
  };
}

async function click(x: number, y: number, label: string, operator: GuardOperator): Promise<void> {
  operator.recordSystemEvent(`Deterministic click: ${label}.`, { x, y });
  const { Point, mouse } = await desktop();
  await mouse.setPosition(new Point(x, y));
  await mouse.leftClick();
}

async function paste(text: string): Promise<void> {
  const { Key, clipboard } = await desktop();
  await clipboard.setContent(text);
  await hotkey(Key.LeftCmd, Key.V);
}

async function selectAll(): Promise<void> {
  const { Key } = await desktop();
  await hotkey(Key.LeftCmd, Key.A);
}

async function press(key: NutKey): Promise<void> {
  const { keyboard } = await desktop();
  await keyboard.pressKey(key);
  await keyboard.releaseKey(key);
}

async function hotkey(...keys: NutKey[]): Promise<void> {
  const { keyboard } = await desktop();
  await keyboard.pressKey(...keys);
  await keyboard.releaseKey(...keys);
}

async function capture(operator: GuardOperator, label: string): Promise<void> {
  operator.recordSystemEvent(`Deterministic guard capturing evidence: ${label}.`);
  await operator.screenshot();
}

function recordVerification(operator: GuardOperator, message: string, verification: VerificationResult): void {
  operator.recordSystemEvent(message, verification);
}

async function desktop(): Promise<NutJs> {
  nutModule ??= import("@computer-use/nut-js");
  return nutModule;
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
