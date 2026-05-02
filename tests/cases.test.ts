import { describe, expect, it } from "vitest";
import { getCaseById, casesForSuite, materializeCase } from "../src/cases.js";
import { loadConfig } from "../src/config.js";

describe("cases", () => {
  it("contains the standard IM, Docs, and Calendar cases", () => {
    const standard = casesForSuite("standard");
    expect(standard.map((testCase) => testCase.id)).toEqual([
      "im-send-text",
      "docs-create-edit",
      "calendar-create-event"
    ]);
  });

  it("materializes variables in instructions and criteria", () => {
    const config = loadConfig("cua.config.json");
    const testCase = getCaseById("im-send-text");
    expect(testCase).toBeDefined();
    const materialized = materializeCase(testCase!, config, "20260502T120000Z");
    expect(materialized.instruction).toContain("20260502T120000Z");
    expect(materialized.successCriteria.join("\n")).toContain("20260502T120000Z");
  });
});
