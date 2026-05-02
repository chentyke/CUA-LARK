import type { VlmConfig } from "./types.js";
import { SYSTEM_PROMPT } from "@ui-tars/sdk/constants";

type FetchLike = typeof fetch;
type FetchInput = Parameters<FetchLike>[0];

export function modelConfigWithCompat(config: VlmConfig): VlmConfig & { fetch?: FetchLike } {
  const compatibleFetch = createModelCompatibleFetch(config.baseURL, { repairActionOutput: true });
  return compatibleFetch
    ? {
        ...config,
        fetch: compatibleFetch
      }
    : config;
}

export function openAIClientCompatOptions(baseURL: string): { fetch?: FetchLike } {
  const compatibleFetch = createModelCompatibleFetch(baseURL);
  return compatibleFetch ? { fetch: compatibleFetch } : {};
}

export function compatibleSystemPrompt(baseURL: string): string | undefined {
  if (!isXiaomiMiMoBaseURL(baseURL)) return undefined;
  return SYSTEM_PROMPT.replace("\n## User Instruction\n", `\n${MIMO_ACTION_FORMAT_RULES}\n## User Instruction\n`);
}

export function createModelCompatibleFetch(
  baseURL: string,
  options: { repairActionOutput?: boolean } = {}
): FetchLike | undefined {
  if (!isXiaomiMiMoBaseURL(baseURL)) return undefined;
  return async (input, init) => {
    const nextInit = sanitizeFetchInit(input, init);
    const response = await globalThis.fetch(input, nextInit);
    if (!options.repairActionOutput || !isChatCompletionsURL(input)) return response;
    return repairChatCompletionResponse(response);
  };
}

export function isXiaomiMiMoBaseURL(baseURL: string): boolean {
  try {
    return new URL(baseURL).hostname.endsWith("xiaomimimo.com");
  } catch {
    return false;
  }
}

export function sanitizeMiMoChatBody(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const next = { ...(body as Record<string, unknown>) };

  if (next.frequency_penalty === null) next.frequency_penalty = 0;
  if (next.presence_penalty === null) next.presence_penalty = 0;
  if (next.seed === null) delete next.seed;
  if (next.max_tokens !== undefined && next.max_completion_tokens === undefined) {
    next.max_completion_tokens = next.max_tokens;
    delete next.max_tokens;
  }

  return next;
}

export function repairMiMoActionPrediction(prediction: string): string {
  const existingAction = extractExistingFunctionAction(prediction);
  if (existingAction) return prediction;

  const actionCalls = extractJsonActionCalls(prediction);
  if (!actionCalls.length) return prediction;

  const thought = extractThought(prediction) ?? "Use the next UI-TARS action converted from the model response.";
  return `Thought: ${thought}\nAction: ${actionCalls.join("\n\n")}`;
}

function sanitizeFetchInit(input: FetchInput, init?: RequestInit): RequestInit | undefined {
  if (!isChatCompletionsURL(input) || !init?.body || typeof init.body !== "string") return init;

  try {
    const body = JSON.parse(init.body) as unknown;
    return {
      ...init,
      body: JSON.stringify(sanitizeMiMoChatBody(body))
    };
  } catch {
    return init;
  }
}

function isChatCompletionsURL(input: FetchInput): boolean {
  const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
  return url.includes("/chat/completions");
}

async function repairChatCompletionResponse(response: Response): Promise<Response> {
  if (!response.ok) return response;

  let body: unknown;
  try {
    body = JSON.parse(await response.clone().text()) as unknown;
  } catch {
    return response;
  }

  const changed = repairChatCompletionBody(body);
  if (!changed) return response;

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(body), {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function repairChatCompletionBody(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return false;

  let changed = false;
  for (const choice of choices) {
    if (!choice || typeof choice !== "object") continue;
    const message = (choice as { message?: unknown }).message;
    if (!message || typeof message !== "object") continue;
    const content = (message as { content?: unknown }).content;
    if (typeof content !== "string") continue;

    const repaired = repairMiMoActionPrediction(content);
    if (repaired !== content) {
      (message as { content: string }).content = repaired;
      changed = true;
    }
  }
  return changed;
}

function extractExistingFunctionAction(prediction: string): string | undefined {
  const actionText = prediction.split(/Action[:：]/).pop()?.trim() ?? prediction.trim();
  return /^(click|left_double|right_single|drag|hotkey|type|scroll|wait|finished|call_user)\s*\(/m.test(actionText)
    ? actionText
    : undefined;
}

function extractThought(prediction: string): string | undefined {
  const match = prediction.match(/Thought[:：]\s*([\s\S]+?)(?=\s*Action[:：]|```|\[|\{|$)/);
  const thought = match?.[1]?.trim();
  return thought || undefined;
}

function extractJsonActionCalls(prediction: string): string[] {
  const actions: string[] = [];
  for (const candidate of jsonCandidates(prediction)) {
    const value = parseJson(candidate);
    const items = Array.isArray(value) ? value : value && typeof value === "object" ? [value] : [];
    for (const item of items) {
      const call = item && typeof item === "object" ? actionObjectToFunctionCall(item as Record<string, unknown>) : undefined;
      if (call) actions.push(call);
    }
    if (actions.length) break;
  }
  return actions;
}

function jsonCandidates(text: string): string[] {
  const candidates: string[] = [];
  const fencePattern = /```(?:json)?\s*([\s\S]*?)```/gi;
  for (const match of text.matchAll(fencePattern)) {
    if (match[1]) candidates.push(match[1].trim());
  }

  const trimmed = text.trim();
  candidates.push(trimmed);

  const arrayStart = text.indexOf("[");
  const arrayEnd = text.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) candidates.push(text.slice(arrayStart, arrayEnd + 1));

  const objectStart = text.indexOf("{");
  const objectEnd = text.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) candidates.push(text.slice(objectStart, objectEnd + 1));

  return [...new Set(candidates.filter(Boolean))];
}

function parseJson(candidate: string): unknown {
  try {
    return JSON.parse(candidate);
  } catch {
    return undefined;
  }
}

function actionObjectToFunctionCall(action: Record<string, unknown>): string | undefined {
  const name = normalizeActionName(stringValue(action.action ?? action.type ?? action.name));
  if (!name) return undefined;

  if (name === "wait" || name === "finished" || name === "call_user") return `${name}()`;
  if (name === "hotkey") {
    const key = stringValue(action.key ?? action.hotkey ?? action.keys);
    return key ? `hotkey(key='${escapeActionString(key)}')` : undefined;
  }
  if (name === "type") {
    const content = stringValue(action.content ?? action.text ?? action.value);
    return content !== undefined ? `type(content='${escapeActionString(content)}')` : undefined;
  }
  if (name === "scroll") {
    const box = pointOrBox(action, "start") ?? "[500,500,500,500]";
    const direction = stringValue(action.direction) ?? "down";
    return `scroll(start_box='${box}', direction='${escapeActionString(direction)}')`;
  }
  if (name === "drag") {
    const start = pointOrBox(action, "start");
    const end = pointOrBox(action, "end");
    return start && end ? `drag(start_box='${start}', end_box='${end}')` : undefined;
  }

  const box = pointOrBox(action, "start");
  return box ? `${name}(start_box='${box}')` : undefined;
}

function normalizeActionName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const normalized = name.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (["click", "left_single"].includes(normalized)) return "click";
  if (["left_double", "double_click", "double"].includes(normalized)) return "left_double";
  if (["right_single", "right_click", "context_click"].includes(normalized)) return "right_single";
  if (["drag", "drag_to"].includes(normalized)) return "drag";
  if (["hotkey", "key", "key_press", "press"].includes(normalized)) return "hotkey";
  if (["type", "input", "text"].includes(normalized)) return "type";
  if (normalized === "scroll") return "scroll";
  if (normalized === "wait") return "wait";
  if (["finish", "finished", "done"].includes(normalized)) return "finished";
  if (["call_user", "ask_user"].includes(normalized)) return "call_user";
  return undefined;
}

function pointOrBox(action: Record<string, unknown>, prefix: "start" | "end"): string | undefined {
  const directKeys =
    prefix === "start"
      ? ["start_box", "box", "bbox", "start_point", "point", "coordinate", "coordinates"]
      : ["end_box", "end_point", "target_point", "target"];
  for (const key of directKeys) {
    const box = normalizeBox(action[key]);
    if (box) return box;
  }
  return undefined;
}

function normalizeBox(value: unknown): string | undefined {
  const numbers = numberList(value);
  if (numbers.length !== 2 && numbers.length !== 4) return undefined;
  const uiTarsNumbers = numbers.map((number) => (Math.abs(number) <= 1 ? number * 1000 : number));
  const [x1, y1, x2 = x1, y2 = y1] = uiTarsNumbers;
  return `[${[x1, y1, x2, y2].map(formatCoordinate).join(",")}]`;
}

function numberList(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => (typeof item === "number" && Number.isFinite(item) ? [item] : []));
  }
  if (typeof value === "string") {
    return value
      .replace(/[()[\]]/g, "")
      .split(",")
      .map((item) => Number(item.trim()))
      .filter(Number.isFinite);
  }
  return [];
}

function formatCoordinate(value: number): string {
  const clamped = Math.min(1000, Math.max(0, value));
  return Number.isInteger(clamped) ? String(clamped) : clamped.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.join("+");
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function escapeActionString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/'/g, "’");
}

const MIMO_ACTION_FORMAT_RULES = `## Provider Compatibility Rules
- Return exactly one UI-TARS action block. Do not return Markdown fences, JSON, bullet lists, explanations, or multiple alternative formats.
- The response must match this shape:
Thought: one concise sentence about the next target.
Action: one function call from the action space.
- Coordinates use the UI-TARS 0-1000 screen coordinate scale. For a click point, repeat the same point as a box: click(start_box='[x,y,x,y]').
- Valid examples:
Thought: Click the Cloud Documents entry in the left sidebar.
Action: click(start_box='[54,225,54,225]')

Thought: Type the test message and submit it.
Action: type(content='测试消息\\n')

Thought: Wait for the page to finish loading.
Action: wait()
`;
