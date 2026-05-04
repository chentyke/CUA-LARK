import type { AppConfig, TestCase } from "./types.js";
import { timestampForId, tomorrowAtTwo } from "./time.js";

const baseCases: TestCase[] = [
  {
    id: "im-send-text",
    product: "im",
    description: "Search a test chat in IM, send a timestamped text message, and verify it appears.",
    instruction:
      "Open Lark IM, search for '{testChat}', send the message 'CUA-Lark IM smoke {timestamp}', and confirm the latest message is visible.",
    successCriteria: [
      "The target chat named '{testChat}' is open.",
      "The latest visible message contains 'CUA-Lark IM smoke {timestamp}'."
    ],
    preconditions: ["Lark is logged in.", "A safe test chat or contact exists."],
    maxSteps: 18,
    timeoutMs: 180000,
    tags: ["standard", "im", "smoke"],
    logicalSteps: [
      "Focus or open the Lark desktop app.",
      "Navigate to IM or the message list.",
      "Search for the configured test chat.",
      "Open the matching chat.",
      "Type and send the timestamped smoke-test message.",
      "Verify the latest message contains the expected text."
    ]
  },
  {
    id: "docs-create-edit",
    product: "docs",
    description: "Create a new Lark document, enter a title and body, and verify the content.",
    instruction:
      "Open Lark Docs, create a new document, add heading '2026年Q2项目进展', add body text '自动化桌面测试记录 {timestamp}', and confirm both texts are visible.",
    successCriteria: [
      "The new document content contains the heading '2026年Q2项目进展'.",
      "The document body contains '自动化桌面测试记录 {timestamp}'."
    ],
    preconditions: ["Lark is logged in.", "The account can create Docs."],
    maxSteps: 25,
    timeoutMs: 240000,
    tags: ["standard", "docs", "smoke"],
    logicalSteps: [
      "Focus or open the Lark desktop app.",
      "Navigate to Docs.",
      "Create a new document.",
      "Set the document title and body content.",
      "Verify the title and body are visible."
    ]
  },
  {
    id: "calendar-create-event",
    product: "calendar",
    description: "Create a tomorrow 2 PM calendar event and verify it is present.",
    instruction:
      "Open Lark Calendar, create an event titled 'CUA-Lark 测试会议 {timestamp}' at {tomorrowDisplay}, invite '{testAttendee}' if possible, and confirm the event appears on the calendar.",
    successCriteria: [
      "A calendar event titled 'CUA-Lark 测试会议 {timestamp}' is visible.",
      "The event time is tomorrow at 14:00 or the closest visible equivalent."
    ],
    preconditions: ["Lark is logged in.", "The account can create calendar events."],
    maxSteps: 25,
    timeoutMs: 240000,
    tags: ["standard", "calendar", "smoke"],
    logicalSteps: [
      "Focus or open the Lark desktop app.",
      "Navigate to Calendar.",
      "Create a new event for tomorrow at 14:00.",
      "Set the event title and optional attendee.",
      "Save the event.",
      "Verify the event appears on the calendar."
    ]
  },
  {
    id: "cross-docs-im-calendar",
    product: "cross-product",
    description: "Create Docs content, share the result in IM, and create a calendar reminder.",
    instruction:
      "Create a Lark Doc titled 'CUA-Lark 跨产品联动 {timestamp}' with summary text, send a message about that doc to '{testChat}', then create a Calendar event titled 'Review CUA-Lark Doc {timestamp}' at {tomorrowDisplay}. Verify all three product states.",
    successCriteria: [
      "The Docs content for 'CUA-Lark 跨产品联动 {timestamp}' was created or is visible.",
      "The IM chat '{testChat}' contains a message referencing the cross-product doc.",
      "The Calendar contains 'Review CUA-Lark Doc {timestamp}'."
    ],
    preconditions: ["Lark is logged in.", "Test chat and calendar creation are available."],
    maxSteps: 35,
    timeoutMs: 360000,
    tags: ["demo", "cross-product", "advanced"],
    logicalSteps: [
      "Create the cross-product Lark Doc.",
      "Send a reference message to the configured IM chat.",
      "Create a calendar event that references the doc.",
      "Verify visible evidence in Docs, IM, and Calendar."
    ]
  }
];

export function listCases(): TestCase[] {
  return baseCases.map((testCase) => ({ ...testCase, successCriteria: [...testCase.successCriteria] }));
}

export function getCaseById(id: string): TestCase | undefined {
  return listCases().find((testCase) => testCase.id === id);
}

export function casesForSuite(suite: string): TestCase[] {
  const cases = listCases();
  if (suite === "standard") return cases.filter((testCase) => testCase.tags.includes("standard"));
  if (suite === "demo") return cases.filter((testCase) => testCase.tags.includes("demo"));
  return cases.filter((testCase) => testCase.tags.includes(suite));
}

export function validateCaseInputs(testCases: TestCase[], config: AppConfig, dryRun: boolean): string[] {
  if (dryRun) return [];
  const issues: string[] = [];
  if (testCases.some((testCase) => caseUsesVariable(testCase, "testChat")) && !config.lark.testChat.trim()) {
    issues.push("LARK_TEST_CHAT is required for real IM or cross-product runs. Set it to a safe test chat before running.");
  }
  return issues;
}

export function materializeCase(testCase: TestCase, config: AppConfig, timestamp = timestampForId()): TestCase {
  const tomorrow = tomorrowAtTwo();
  const vars: Record<string, string> = {
    timestamp,
    testChat: config.lark.testChat || "测试群",
    testAttendee: config.lark.testAttendee || "测试参会人",
    tomorrowDate: tomorrow.isoDate,
    tomorrowDisplay: tomorrow.display
  };
  return {
    ...testCase,
    instruction: interpolate(testCase.instruction, vars),
    successCriteria: testCase.successCriteria.map((criterion) => interpolate(criterion, vars)),
    preconditions: testCase.preconditions.map((criterion) => interpolate(criterion, vars)),
    logicalSteps: testCase.logicalSteps.map((step) => interpolate(step, vars))
  };
}

function interpolate(input: string, vars: Record<string, string>): string {
  return input.replace(/\{(\w+)\}/g, (_match, key: string) => vars[key] ?? "");
}

function caseUsesVariable(testCase: TestCase, variable: string): boolean {
  const needle = `{${variable}}`;
  return [testCase.instruction, ...testCase.successCriteria, ...testCase.preconditions, ...testCase.logicalSteps].some((item) =>
    item.includes(needle)
  );
}
