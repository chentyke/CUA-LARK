import { describe, expect, it } from "vitest";
import { quotedValueAfter, tomorrowDayIndex, weekGridSlot } from "../src/standardGuard.js";

describe("standard guard helpers", () => {
  it("extracts quoted values after an instruction marker", () => {
    const instruction =
      "Open Lark IM, search for '刘俊熙', send the message 'CUA-Lark IM smoke 20260504T120000Z', and confirm it is visible.";

    expect(quotedValueAfter(instruction, "send the message")).toBe("CUA-Lark IM smoke 20260504T120000Z");
    expect(quotedValueAfter(instruction, "missing marker")).toBeUndefined();
  });

  it("computes the next visible day and calendar grid slot", () => {
    const monday = new Date("2026-05-04T08:00:00+08:00");
    expect(tomorrowDayIndex(monday)).toBe(2);
    expect(weekGridSlot(2, 14)).toEqual({ x: 968, y: 560 });
  });
});
