import type { PlannedCase, PlannedStep, Product, TestCase } from "./types.js";

export class Planner {
  fromCase(testCase: TestCase): PlannedCase {
    const steps = testCase.logicalSteps.map<PlannedStep>((objective, index) => ({
      index: index + 1,
      objective,
      successCriteria: index === testCase.logicalSteps.length - 1 ? testCase.successCriteria : []
    }));

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
      steps
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
  if (lower.includes("im") || instruction.includes("聊天") || instruction.includes("消息")) return "im";
  return "custom";
}
