import { describe, expect, it } from "vitest";
import { describeGuiAction, parseGuiActions, runGuiActions } from "../src/guiActions.js";

describe("gui actions", () => {
  it("parses all primitive GUI action types", () => {
    const actions = parseGuiActions(
      JSON.stringify([
        { type: "click", x: 1, y: 2 },
        { type: "doubleClick", x: 3, y: 4 },
        { type: "rightClick", x: 5, y: 6 },
        { type: "drag", from: { x: 1, y: 2 }, to: { x: 3, y: 4 } },
        { type: "scroll", deltaY: 3 },
        { type: "typeText", text: "Hello" },
        { type: "hotkey", keys: ["cmd", "v"] },
        { type: "wait", ms: 10 }
      ])
    );

    expect(actions.map((action) => action.type)).toEqual([
      "click",
      "doubleClick",
      "rightClick",
      "drag",
      "scroll",
      "typeText",
      "hotkey",
      "wait"
    ]);
    expect(describeGuiAction(actions[6]!)).toBe("hotkey cmd+v");
  });

  it("supports dry-run sequences without controlling the desktop", async () => {
    const actions = parseGuiActions('[{"type":"click","x":10,"y":20},{"type":"typeText","text":"Hello World"}]');
    const events = await runGuiActions(actions, { dryRun: true, appName: "Lark" });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ index: 1, status: "skipped", detail: "click (10, 20)" });
    expect(events[1]?.detail).toBe("type text length=11");
  });

  it("rejects malformed action payloads", () => {
    expect(() => parseGuiActions('{"type":"click"}')).toThrow("JSON array");
    expect(() => parseGuiActions('[{"type":"click","x":"1","y":2}]')).toThrow("finite number");
  });
});
