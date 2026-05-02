import { describe, expect, it, vi } from "vitest";
import {
  compatibleSystemPrompt,
  createModelCompatibleFetch,
  isXiaomiMiMoBaseURL,
  modelConfigWithCompat,
  repairMiMoActionPrediction,
  sanitizeMiMoChatBody
} from "../src/modelCompat.js";

describe("model compatibility", () => {
  it("detects Xiaomi MiMo base URLs", () => {
    expect(isXiaomiMiMoBaseURL("https://api.xiaomimimo.com/v1")).toBe(true);
    expect(isXiaomiMiMoBaseURL("https://ark.cn-beijing.volces.com/api/v3")).toBe(false);
  });

  it("normalizes UI-TARS chat parameters for MiMo strict validation", () => {
    const body = sanitizeMiMoChatBody({
      model: "mimo-v2.5-pro",
      messages: [],
      seed: null,
      stop: null,
      frequency_penalty: null,
      presence_penalty: null,
      max_tokens: 1000
    }) as Record<string, unknown>;

    expect(body.frequency_penalty).toBe(0);
    expect(body.presence_penalty).toBe(0);
    expect(body.max_completion_tokens).toBe(1000);
    expect(body).not.toHaveProperty("max_tokens");
    expect(body).not.toHaveProperty("seed");
    expect(body.stop).toBeNull();
  });

  it("adds compatible fetch only for MiMo config", () => {
    expect(
      modelConfigWithCompat({
        baseURL: "https://api.xiaomimimo.com/v1",
        apiKey: "test",
        model: "mimo-v2.5-pro"
      }).fetch
    ).toBeDefined();
    expect(
      modelConfigWithCompat({
        baseURL: "https://ark.cn-beijing.volces.com/api/v3",
        apiKey: "test",
        model: "ep-test"
      }).fetch
    ).toBeUndefined();
  });

  it("adds MiMo-specific system prompt rules", () => {
    const prompt = compatibleSystemPrompt("https://api.xiaomimimo.com/v1");
    expect(prompt).toContain("Provider Compatibility Rules");
    expect(prompt).toContain("Do not return Markdown fences, JSON");
    expect(compatibleSystemPrompt("https://ark.cn-beijing.volces.com/api/v3")).toBeUndefined();
  });

  it("repairs MiMo JSON action output into UI-TARS function calls", () => {
    const repaired = repairMiMoActionPrediction(`Click the Feishu icon.

\`\`\`json
[
  {"action": "click", "start_point": [450, 974]}
]
\`\`\`

**Core change:** Feishu opens.`);

    expect(repaired).toBe(
      "Thought: Use the next UI-TARS action converted from the model response.\nAction: click(start_box='[450,974,450,974]')"
    );
  });

  it("keeps valid UI-TARS action output unchanged", () => {
    const prediction = "Thought: Click send.\nAction: click(start_box='[800,900,800,900]')";
    expect(repairMiMoActionPrediction(prediction)).toBe(prediction);
  });

  it("can repair MiMo action output inside chat completion responses", async () => {
    const originalFetch = globalThis.fetch;
    const mockedFetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '```json\n[{"action":"type","content":"你好\\n"}]\n```'
              }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", mockedFetch);

    try {
      const compatibleFetch = createModelCompatibleFetch("https://api.xiaomimimo.com/v1", {
        repairActionOutput: true
      });
      const response = await compatibleFetch?.("https://api.xiaomimimo.com/v1/chat/completions", {
        method: "POST",
        body: JSON.stringify({ model: "mimo-v2.5-pro", messages: [] })
      });
      const body = (await response?.json()) as { choices: Array<{ message: { content: string } }> };

      expect(body.choices[0]?.message.content).toBe(
        "Thought: Use the next UI-TARS action converted from the model response.\nAction: type(content='你好\\n')"
      );
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });
});
