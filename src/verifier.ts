import fs from "node:fs/promises";
import { Jimp } from "jimp";
import OpenAI from "openai";
import { openAIClientCompatOptions } from "./modelCompat.js";
import type { AppConfig, VerificationResult } from "./types.js";

export interface VerificationImage {
  base64: string;
  mimeType: "image/png";
  width: number;
  height: number;
}

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

    const image = await prepareVerificationImage(latestScreenshot);
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
                url: `data:${image.mimeType};base64,${image.base64}`
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

export async function prepareVerificationImage(filePath: string): Promise<VerificationImage> {
  const maxPixels = Number(process.env.CUA_VERIFIER_MAX_IMAGE_PIXELS ?? 900000);
  const input = await fs.readFile(filePath);
  const image = await Jimp.read(input);
  const { width, height } = image.bitmap;
  let output = image;

  if (Number.isFinite(maxPixels) && maxPixels > 0 && width * height > maxPixels) {
    const factor = Math.sqrt(maxPixels / (width * height));
    const resized = image.clone() as typeof image;
    resized.resize({
      w: Math.max(1, Math.floor(width * factor)),
      h: Math.max(1, Math.floor(height * factor))
    });
    output = resized;
  }

  const buffer = await output.getBuffer("image/png", { quality: 80 });
  return {
    base64: buffer.toString("base64"),
    mimeType: "image/png",
    width: output.bitmap.width,
    height: output.bitmap.height
  };
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
  const parsedJson = parseVerifierJson(raw);
  if (parsedJson) {
    return verificationFromParsedJson(parsedJson, raw);
  }

  const explicitBoolean = raw.match(/\bpassed\b\s*[:=]\s*(true|false)\b/i)?.[1];
  if (explicitBoolean) {
    const passed = explicitBoolean.toLowerCase() === "true";
    return {
      passed,
      confidence: passed ? 0.5 : 0,
      reason: raw.trim() || "Verifier response was empty or not valid JSON.",
      evidence: [],
      raw
    };
  }

  const passed = /\b(pass|passed|success|true|通过|成功)\b/i.test(raw);
  return {
    passed,
    confidence: passed ? 0.5 : 0,
    reason: raw.trim() || "Verifier response was empty or not valid JSON.",
    evidence: [],
    raw
  };
}

function parseVerifierJson(raw: string): Partial<VerificationResult> | undefined {
  for (const candidate of verifierJsonCandidates(raw)) {
    try {
      const parsed = JSON.parse(candidate) as Partial<VerificationResult>;
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // Try the next candidate.
    }
  }
  return undefined;
}

function verifierJsonCandidates(raw: string): string[] {
  const candidates: string[] = [raw.trim()];
  for (const match of raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    if (match[1]) candidates.push(match[1].trim());
  }
  const objectStart = raw.indexOf("{");
  const objectEnd = raw.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) candidates.push(raw.slice(objectStart, objectEnd + 1));
  return [...new Set(candidates.filter(Boolean))];
}

function verificationFromParsedJson(parsed: Partial<VerificationResult>, raw: string): VerificationResult {
  return {
    passed: parsed.passed === true,
    confidence: normalizeConfidence(parsed.confidence),
    reason: typeof parsed.reason === "string" ? parsed.reason : "No verifier reason was provided.",
    evidence: Array.isArray(parsed.evidence) ? parsed.evidence.map(String) : [],
    raw
  };
}

function normalizeConfidence(value: unknown): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return 0;
  return Math.min(1, Math.max(0, numberValue));
}
