import { describe, expect, it } from "vitest";
import { getCaseById, casesForSuite, materializeCase, validateCaseInputs } from "../src/cases.js";
import { loadConfig } from "../src/config.js";
import { Planner } from "../src/planner.js";

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

  it("plans built-in cases as one end-to-end UI-TARS objective", () => {
    const config = loadConfig("cua.config.json");
    const testCase = materializeCase(getCaseById("im-send-text")!, config, "20260502T120000Z");
    const planned = new Planner().fromCase(testCase);

    expect(planned.steps).toHaveLength(1);
    expect(planned.steps[0]?.objective).toContain("Use this checklist as guidance");
    expect(planned.steps[0]?.successCriteria).toEqual(testCase.successCriteria);
  });

  it("infers Feishu sub-products from natural-language instructions", () => {
    const planner = new Planner();

    expect(planner.fromInstruction("打开日历，创建一个明天下午2点的会议").product).toBe("calendar");
    expect(planner.fromInstruction("创建一个多维表格并添加字段").product).toBe("base");
    expect(planner.fromInstruction("发起视频会议并关闭麦克风").product).toBe("vc");
    expect(planner.fromInstruction("撰写邮件并添加附件").product).toBe("mail");
  });

  it("requires an explicit safe chat for real IM cases", () => {
    const config = loadConfig("cua.config.json");
    const testCase = getCaseById("im-send-text")!;

    expect(validateCaseInputs([testCase], { ...config, lark: { ...config.lark, testChat: "" } }, false)).toContain(
      "LARK_TEST_CHAT is required for real IM or cross-product runs. Set it to a safe test chat before running."
    );
    expect(validateCaseInputs([testCase], { ...config, lark: { ...config.lark, testChat: "" } }, true)).toEqual([]);
  });
});
