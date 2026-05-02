import { describe, expect, it } from "vitest";
import { buildVerificationPrompt, parseVerificationResponse } from "../src/verifier.js";

describe("verifier", () => {
  it("guides IM verification to inspect sent chat history instead of the draft box", () => {
    const prompt = buildVerificationPrompt({
      instruction: "给测试联系人发个加粗的消息",
      successCriteria: ["The visible Lark state satisfies the user instruction."]
    });

    expect(prompt).toContain("sent message bubbles in the chat history");
    expect(prompt).toContain("empty input box is normal");
    expect(prompt).toContain("Bold may appear as visibly heavier strokes");
  });

  it("parses strict JSON verifier responses", () => {
    const result = parseVerificationResponse(
      JSON.stringify({
        passed: true,
        confidence: 0.92,
        reason: "Text is visible.",
        evidence: ["message found"]
      })
    );
    expect(result.passed).toBe(true);
    expect(result.confidence).toBe(0.92);
    expect(result.evidence).toEqual(["message found"]);
  });

  it("falls back for non-JSON positive responses", () => {
    const result = parseVerificationResponse("passed: the expected event is visible");
    expect(result.passed).toBe(true);
    expect(result.confidence).toBe(0.5);
  });
});
