import type { PlannedCase, PlannedStep, Product, TestCase } from "./types.js";

export class Planner {
  fromCase(testCase: TestCase): PlannedCase {
    const objective = [
      testCase.instruction,
      "Use this checklist as guidance, but complete the case as one end-to-end desktop task:",
      ...testCase.logicalSteps.map((step, index) => `${index + 1}. ${step}`),
      "Before finishing, leave the strongest success evidence visible on screen."
    ].join("\n");

    return {
      id: testCase.id,
      product: testCase.product,
      description: testCase.description,
      instruction: testCase.instruction,
      successCriteria: testCase.successCriteria,
      preconditions: testCase.preconditions,
      maxSteps: testCase.maxSteps,
      timeoutMs: testCase.timeoutMs,
      tags: testCase.tags,
      steps: [
        {
          index: 1,
          objective,
          successCriteria: testCase.successCriteria
        }
      ]
    };
  }

  fromInstruction(instruction: string): PlannedCase {
    const product = inferProduct(instruction);
    return {
      id: "custom-instruction",
      product,
      description: "Ad hoc natural-language CUA task.",
      instruction,
      successCriteria: ["The visible Lark state satisfies the user instruction."],
      preconditions: ["Lark is logged in and ready for desktop automation."],
      maxSteps: 25,
      timeoutMs: 180000,
      tags: ["custom"],
      steps: [
        {
          index: 1,
          objective: instruction,
          successCriteria: ["The visible Lark state satisfies the user instruction."]
        }
      ]
    };
  }
}

function inferProduct(instruction: string): Product {
  const lower = instruction.toLowerCase();
  if (lower.includes("calendar") || instruction.includes("日历") || instruction.includes("日程")) return "calendar";
  if (lower.includes("doc") || instruction.includes("文档")) return "docs";
  if (lower.includes("base") || instruction.includes("多维表格")) return "base";
  if (lower.includes("meeting") || lower.includes("vc") || instruction.includes("视频会议") || instruction.includes("会议")) return "vc";
  if (lower.includes("mail") || lower.includes("email") || instruction.includes("邮箱") || instruction.includes("邮件")) return "mail";
  if (lower.includes("im") || instruction.includes("聊天") || instruction.includes("消息")) return "im";
  return "custom";
}
