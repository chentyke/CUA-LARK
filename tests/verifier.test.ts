import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Jimp } from "jimp";
import { describe, expect, it } from "vitest";
import { buildVerificationPrompt, parseVerificationResponse, prepareVerificationImage } from "../src/verifier.js";

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

  it("parses fenced JSON verifier responses without falling back to keyword matching", () => {
    const result = parseVerificationResponse(`\`\`\`json
{
  "passed": false,
  "confidence": 1,
  "reason": "Wrong chat.",
  "evidence": ["The target chat is absent."]
}
\`\`\``);

    expect(result.passed).toBe(false);
    expect(result.confidence).toBe(1);
    expect(result.reason).toBe("Wrong chat.");
    expect(result.evidence).toEqual(["The target chat is absent."]);
  });

  it("falls back for non-JSON positive responses", () => {
    const result = parseVerificationResponse("passed: the expected event is visible");
    expect(result.passed).toBe(true);
    expect(result.confidence).toBe(0.5);
  });

  it("honors explicit false boolean fallback responses", () => {
    const result = parseVerificationResponse("passed: false, the expected event is not visible");
    expect(result.passed).toBe(false);
    expect(result.confidence).toBe(0);
  });

  it("re-encodes and downsizes verifier screenshots to a valid PNG payload", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "lark-cua-verifier-"));
    const screenshotPath = path.join(tempDir, "large.png");
    const previousMaxPixels = process.env.CUA_VERIFIER_MAX_IMAGE_PIXELS;
    process.env.CUA_VERIFIER_MAX_IMAGE_PIXELS = "10000";

    try {
      const image = new Jimp({ width: 240, height: 120, color: 0x336699ff });
      await image.write(screenshotPath);

      const prepared = await prepareVerificationImage(screenshotPath);
      const decoded = await Jimp.read(Buffer.from(prepared.base64, "base64"));

      expect(prepared.mimeType).toBe("image/png");
      expect(prepared.width * prepared.height).toBeLessThanOrEqual(10000);
      expect(decoded.bitmap.width).toBe(prepared.width);
      expect(decoded.bitmap.height).toBe(prepared.height);
    } finally {
      if (previousMaxPixels === undefined) {
        delete process.env.CUA_VERIFIER_MAX_IMAGE_PIXELS;
      } else {
        process.env.CUA_VERIFIER_MAX_IMAGE_PIXELS = previousMaxPixels;
      }
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
