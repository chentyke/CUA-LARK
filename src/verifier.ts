import fs from "node:fs/promises";
import OpenAI from "openai";
import { openAIClientCompatOptions } from "./modelCompat.js";
import type { AppConfig, VerificationResult } from "./types.js";

export class Verifier {
  constructor(private readonly config: AppConfig) {}

  async verify(params: {
    instruction: string;
    successCriteria: string[];
    screenshots: string[];
    dryRun: boolean;
  }): Promise<VerificationResult> {
    if (params.dryRun) {
      return {
        passed: true,
        confidence: 1,
        reason: "Dry run uses deterministic mock verification.",
        evidence: params.successCriteria
      };
    }

    const latestScreenshot = params.screenshots.at(-1);
    if (!latestScreenshot) {
      return {
        passed: false,
        confidence: 0,
        reason: "No screenshot was captured for verification.",
        evidence: []
      };
    }

    const imageBase64 = await fs.readFile(latestScreenshot, "base64");
    const client = new OpenAI({
      baseURL: this.config.vlm.baseURL,
      apiKey: this.config.vlm.apiKey,
      ...openAIClientCompatOptions(this.config.vlm.baseURL)
    });

    const completion = await client.chat.completions.create({
      model: this.config.vlm.model,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: buildVerificationPrompt({
                instruction: params.instruction,
                successCriteria: params.successCriteria
              })
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/png;base64,${imageBase64}`
              }
            }
          ]
        }
      ]
    } as never);

    const raw = completion.choices[0]?.message?.content ?? "";
    return parseVerificationResponse(raw);
  }
}

export function buildVerificationPrompt(params: { instruction: string; successCriteria: string[] }): string {
  return [
    "You are verifying a desktop GUI test result for Lark.",
    "Return strict JSON with keys: passed:boolean, confidence:number, reason:string, evidence:string[].",
    "Judge the final visible application state, not whether a draft remains in the input box.",
    "For IM send-message tasks, verify the sent message bubbles in the chat history. After a message is sent, an empty input box is normal and is not evidence of failure.",
    "For text-formatting tasks such as bold, inspect the visible sent message itself. Bold may appear as visibly heavier strokes inside the message bubble.",
    "Only fail when the requested recipient, content, or required formatting/action is clearly absent.",
    `Instruction: ${params.instruction}`,
    `Success criteria:\n${params.successCriteria.map((item) => `- ${item}`).join("\n")}`
  ].join("\n\n");
}

export function parseVerificationResponse(raw: string): VerificationResult {
  try {
    const parsed = JSON.parse(raw) as Partial<VerificationResult>;
    return {
      passed: Boolean(parsed.passed),
      confidence: normalizeConfidence(parsed.confidence),
      reason: typeof parsed.reason === "string" ? parsed.reason : "No verifier reason was provided.",
      evidence: Array.isArray(parsed.evidence) ? parsed.evidence.map(String) : [],
      raw
    };
  } catch {
    const passed = /\b(pass|passed|success|true|通过|成功)\b/i.test(raw);
    return {
      passed,
      confidence: passed ? 0.5 : 0,
      reason: raw.trim() || "Verifier response was empty or not valid JSON.",
      evidence: [],
      raw
    };
  }
}

function normalizeConfidence(value: unknown): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return 0;
  return Math.min(1, Math.max(0, numberValue));
}
