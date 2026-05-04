import fs from "node:fs/promises";
import path from "node:path";
import { Jimp, loadFont } from "jimp";
import { SANS_16_BLACK, SANS_16_WHITE, SANS_32_BLACK, SANS_32_WHITE } from "jimp/fonts";
import {
  advancedCapabilityRows,
  coreCapabilityRows,
  milestoneRows,
  productCoverageRows,
  renderCapabilityMarkdownTable
} from "./capabilities.js";
import type { CaseRunResult, RunReport } from "./types.js";

export interface SubmissionOptions {
  projectName?: string;
  members?: string[];
}

export interface SubmissionPackagePaths {
  markdown: string;
  html: string;
  evidenceImages: string[];
}

interface EvidenceFonts {
  titleDark: Awaited<ReturnType<typeof loadFont>>;
  titleLight: Awaited<ReturnType<typeof loadFont>>;
  bodyDark: Awaited<ReturnType<typeof loadFont>>;
  bodyLight: Awaited<ReturnType<typeof loadFont>>;
}

const defaultMembers = ["陈正洋", "刘俊熙"];

export async function writeSubmissionPackage(
  report: RunReport,
  runDir: string,
  options: SubmissionOptions = {}
): Promise<SubmissionPackagePaths> {
  const submissionDir = path.join(runDir, "submission");
  const evidenceDir = path.join(submissionDir, "evidence");
  await fs.mkdir(evidenceDir, { recursive: true });

  const projectName = options.projectName ?? "CUA-Lark";
  const members = options.members?.length ? options.members : defaultMembers;
  const evidenceImages = await generateEvidenceImages(report, evidenceDir, projectName);

  const markdownPath = path.join(submissionDir, "submission.md");
  const htmlPath = path.join(submissionDir, "submission.html");
  await fs.writeFile(markdownPath, renderSubmissionMarkdown(report, { projectName, members, markdownPath, evidenceImages }));
  await fs.writeFile(htmlPath, renderSubmissionHtml(report, { projectName, members, htmlPath, evidenceImages }));

  return {
    markdown: markdownPath,
    html: htmlPath,
    evidenceImages
  };
}

async function generateEvidenceImages(report: RunReport, evidenceDir: string, projectName: string): Promise<string[]> {
  const fonts = await loadEvidenceFonts();
  const images: string[] = [];
  const summaryPath = path.join(evidenceDir, "summary.png");
  await writeSummaryImage(report, summaryPath, fonts, projectName);
  images.push(summaryPath);

  const innovationPath = path.join(evidenceDir, "innovation-flow.png");
  await writeInnovationImage(innovationPath, fonts, projectName);
  images.push(innovationPath);

  for (const testCase of report.cases) {
    const casePath = path.join(evidenceDir, `${safeFilename(testCase.id)}.png`);
    await writeCaseImage(testCase, report, casePath, fonts, projectName);
    images.push(casePath);
  }

  return images;
}

async function loadEvidenceFonts(): Promise<EvidenceFonts> {
  const [titleDark, titleLight, bodyDark, bodyLight] = await Promise.all([
    loadFont(SANS_32_BLACK),
    loadFont(SANS_32_WHITE),
    loadFont(SANS_16_BLACK),
    loadFont(SANS_16_WHITE)
  ]);
  return { titleDark, titleLight, bodyDark, bodyLight };
}

async function writeSummaryImage(report: RunReport, filePath: string, fonts: EvidenceFonts, projectName: string): Promise<void> {
  const image = new Jimp({ width: 1280, height: 720, color: 0xf8fafcff });
  await fillRect(image, 0, 0, 1280, 132, 0x0f172aff);
  print(image, fonts.titleLight, 48, 32, `${projectName} Evidence Summary`);
  print(image, fonts.bodyLight, 50, 82, `Run ${report.runId} / suite ${report.suite}`);

  const cards = [
    ["Status", report.status.toUpperCase(), statusColor(report.status)],
    ["Success Rate", `${(report.successRate * 100).toFixed(1)}%`, 0x2563ebff],
    ["Cases", `${report.cases.length}`, 0x0f766eff],
    ["Model Calls", `${report.modelCalls}`, 0x7c3aedff]
  ] as const;

  let x = 48;
  for (const [label, value, color] of cards) {
    await metricCard(image, fonts, x, 176, label, value, color);
    x += 296;
  }

  print(image, fonts.titleDark, 48, 420, "Submission-ready test evidence");
  const notes = [
    `Mode: ${report.dryRun ? "dry-run orchestration validation" : "real desktop execution"}`,
    `Duration: ${report.durationMs} ms`,
    `Screenshots captured: ${report.screenshots.length}`,
    "Artifacts: JSON + Markdown + HTML + PNG evidence cards"
  ];
  printLines(image, fonts.bodyDark, 52, 472, notes, 34);

  await image.write(asPngPath(filePath));
}

async function writeInnovationImage(filePath: string, fonts: EvidenceFonts, projectName: string): Promise<void> {
  const image = new Jimp({ width: 1280, height: 720, color: 0xffffffff });
  await fillRect(image, 0, 0, 1280, 110, 0x1e293bff);
  print(image, fonts.titleLight, 48, 28, `${projectName} Innovation Flow`);

  const nodes = [
    ["Planner", "NL task to objectives"],
    ["UI-TARS", "Screenshot reasoning"],
    ["NutJS", "Mouse and keyboard"],
    ["Lark", "Real desktop state"],
    ["VLM Verifier", "Semantic validation"],
    ["Reporter", "Evidence package"]
  ];

  let x = 48;
  for (let index = 0; index < nodes.length; index += 1) {
    const [title, detail] = nodes[index];
    await fillRect(image, x, 240, 166, 116, 0xf1f5f9ff);
    await fillRect(image, x, 240, 166, 8, index % 2 ? 0x0f766eff : 0x2563ebff);
    print(image, fonts.bodyDark, x + 16, 268, title);
    printWrapped(image, fonts.bodyDark, x + 16, 300, detail, 17, 22);
    if (index < nodes.length - 1) {
      print(image, fonts.titleDark, x + 178, 276, ">");
    }
    x += 200;
  }

  print(image, fonts.titleDark, 48, 474, "Differentiation");
  printLines(
    image,
    fonts.bodyDark,
    52,
    526,
    [
      "Primitive GUI actions plus natural-language visual execution.",
      "Hybrid visual agent and deterministic guards for critical flows.",
      "Recipient pre-check prevents IM tests from targeting wrong chats.",
      "Reports map requirements, metrics, and visual proof for review."
    ],
    32
  );

  await image.write(asPngPath(filePath));
}

async function writeCaseImage(
  testCase: CaseRunResult,
  report: RunReport,
  filePath: string,
  fonts: EvidenceFonts,
  projectName: string
): Promise<void> {
  const image = new Jimp({ width: 1280, height: 720, color: 0xf8fafcff });
  const color = statusColor(testCase.status);
  await fillRect(image, 0, 0, 1280, 122, color);
  print(image, fonts.titleLight, 48, 28, `${projectName} Test Case`);
  print(image, fonts.bodyLight, 50, 78, `${testCase.id} / ${testCase.product} / ${testCase.status}`);

  await fillRect(image, 48, 168, 560, 120, 0xffffffff);
  print(image, fonts.bodyDark, 74, 194, "Objective");
  printWrapped(image, fonts.bodyDark, 74, 226, asciiOnly(testCase.description), 54, 24);

  await fillRect(image, 672, 168, 560, 120, 0xffffffff);
  print(image, fonts.bodyDark, 698, 194, "Verification");
  printWrapped(image, fonts.bodyDark, 698, 226, asciiOnly(testCase.verification?.reason ?? "No verifier reason."), 54, 24);

  const stats = [
    `Suite: ${report.suite}`,
    `Duration: ${testCase.durationMs} ms`,
    `Steps: ${testCase.steps.length}`,
    `Model calls: ${testCase.modelCalls}`,
    `Screenshots: ${testCase.screenshots.length}`,
    `Confidence: ${testCase.verification?.confidence ?? 0}`
  ];
  print(image, fonts.titleDark, 48, 352, "Run Metrics");
  printLines(image, fonts.bodyDark, 52, 404, stats, 30);

  print(image, fonts.titleDark, 672, 352, "Success Criteria");
  printWrapped(
    image,
    fonts.bodyDark,
    676,
    404,
    asciiOnly(testCase.successCriteria.join(" / ") || "Visible state satisfies the instruction."),
    56,
    28
  );

  await image.write(asPngPath(filePath));
}

async function metricCard(
  image: InstanceType<typeof Jimp>,
  fonts: EvidenceFonts,
  x: number,
  y: number,
  label: string,
  value: string,
  color: number
): Promise<void> {
  await fillRect(image, x, y, 248, 148, 0xffffffff);
  await fillRect(image, x, y, 248, 8, color);
  print(image, fonts.bodyDark, x + 22, y + 28, label);
  print(image, fonts.titleDark, x + 22, y + 72, value);
}

async function fillRect(image: InstanceType<typeof Jimp>, x: number, y: number, width: number, height: number, color: number): Promise<void> {
  for (let yy = y; yy < y + height; yy += 1) {
    for (let xx = x; xx < x + width; xx += 1) {
      image.setPixelColor(color, xx, yy);
    }
  }
}

function renderSubmissionMarkdown(
  report: RunReport,
  params: { projectName: string; members: string[]; markdownPath: string; evidenceImages: string[] }
): string {
  const baseDir = path.dirname(params.markdownPath);
  const evidenceLinks = params.evidenceImages
    .map((image) => `![${path.basename(image, ".png")}](${toMarkdownPath(baseDir, image)})`)
    .join("\n\n");
  const screenshotLinks = report.screenshots
    .slice(-6)
    .map((image) => `![real screenshot](${toMarkdownPath(baseDir, image)})`)
    .join("\n\n");

  return `# 飞书 AI 校园挑战赛复赛作品提交报告

## 一、个人信息 / 小组信息

- 作品名称：${params.projectName}：面向飞书桌面端的多模态智能测试 Agent
- 小组成员：${params.members.join("、")}
- 项目方向：AI + 桌面端自动化测试 + 飞书多产品协同场景验证

## 二、项目结果展示

${params.projectName} 使用 UI-TARS、视觉语言模型和桌面鼠标键盘控制能力，像真实用户一样操作飞书桌面端，完成 IM、Docs、Calendar 以及跨产品联动流程。项目支持 CLI 与 Web 控制台两种入口，并在每次运行后生成 JSON、Markdown、HTML 和 PNG 证据图。

本次提交包来自运行：\`${report.runId}\`。测试套件为 \`${report.suite}\`，运行模式为 ${report.dryRun ? "dry-run 编排验证" : "真实桌面执行"}，整体状态为 **${report.status}**，成功率为 **${(report.successRate * 100).toFixed(1)}%**。

| 用例 | 产品 | 状态 | 步骤数 | 模型调用 | 截图数 | 置信度 | 失败原因 |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- |
${report.cases.map(renderCaseMarkdownRow).join("\n")}

${renderRunReviewMarkdown(report)}

## 三、核心功能实现对照

${renderCapabilityMarkdownTable(coreCapabilityRows)}

### 飞书功能覆盖

${renderCapabilityMarkdownTable(productCoverageRows)}

### 自然语言测试示例

- \`npm run cua -- run --instruction "在飞书中创建一个名为项目周报的新文档，并输入标题2026年Q2项目进展"\`
- \`npm run cua -- run --instruction "打开日历，创建一个明天下午2点的会议，邀请张三参加"\`
- \`npm run cua -- run --instruction "在IM中搜索测试群，发送一条消息Hello World，并确认发送成功"\`

## 四、进阶能力

${renderCapabilityMarkdownTable(advancedCapabilityRows)}

## 五、渐进式实现路径

${renderCapabilityMarkdownTable(milestoneRows)}

## 六、测试图片 / 证据图

${evidenceLinks}

${screenshotLinks ? `## 七、真实运行截图\n\n${screenshotLinks}\n\n` : ""}## ${screenshotLinks ? "八" : "七"}、项目亮点与创新点

1. 视觉 Agent + 确定性护栏混合执行：开放任务继续由 UI-TARS 根据截图推理，IM / Docs / Calendar 的复赛标准路径加入关键入口锚点，避免模型在高风险点击上漂移。
2. 发送前收件人语义校验：IM 用例在真正发送前先截图并由 VLM 判断当前会话是否为目标对象，校验失败会拒绝发送，解决真实测试中误发群聊的问题。
3. 原子 GUI 动作可复用：新增 \`ops\` JSON 动作序列，显式覆盖单击、双击、右键、拖拽、滚动、文本输入和快捷键组合，既能做调试也能沉淀录制回放的底层动作格式。
4. VLM 验收稳定性优化：验证前统一读取、重编码并按像素上限压缩截图，降低大图或异常 PNG 导致的多模态 400 错误。
5. 语义化闭环验收：最终截图交给 VLM 按成功标准判断真实飞书状态，不只看脚本是否执行完，能发现错页面、错对象、内容未落地等问题。
6. 可提交证据链：每次运行自动生成结构化报告、HTML 展示和 PNG 证据图，便于复赛评审直接查看结果。
7. 模型兼容适配：支持 OpenAI-compatible VLM，并对 MiMo 等模型接口的参数和动作输出进行兼容修复。

## ${screenshotLinks ? "九" : "八"}、技术实现说明

核心模块：

- \`src/guiActions.ts\`：提供基础 GUI 原子动作执行器，支持 JSON 序列驱动单步或复合桌面操作。
- \`src/planner.ts\`：将标准用例或自然语言指令转为可执行目标。
- \`src/agent.ts\`：负责执行循环、失败重试、超时边界和事件记录。
- \`src/standardGuard.ts\`：为复赛标准 IM / Docs / Calendar 场景提供确定性护栏、发送前校验和关键路径稳定执行。
- \`src/operator.ts\`：封装 NutJS 和 UI-TARS Operator，完成飞书聚焦、截图归档和桌面操作。
- \`src/verifier.ts\`：调用视觉语言模型做最终状态验收，并在请求前重编码 / 压缩截图。
- \`src/reporter.ts\`：生成 JSON、Markdown、HTML 运行报告。
- \`src/submission.ts\`：生成复赛提交报告和 PNG 证据图。

## ${screenshotLinks ? "十" : "九"}、参考资源吸收

- UI-TARS / UI-TARS-desktop：复用视觉-语言-动作范式和桌面 Operator 思路，形成截图推理到鼠标键盘动作的闭环。
- TuriX-CUA：借鉴 Planner / Executor / Evaluator 的职责拆分，本项目落地为 Planner、Agent、Verifier、Reporter 模块。
- OSWorld：参考 GUI Agent 评测方法，报告中统计成功率、耗时、步骤数、模型调用和截图证据。
- opencli：吸收“把复杂应用操作 CLI 化”的思路，新增 \`ops\` 原子动作入口和自然语言 \`run --instruction\` 入口。

## ${screenshotLinks ? "十一" : "十"}、项目分工

- 陈正洋：整体方案设计、Agent 执行链路、UI-TARS 接入、VLM 验证、CLI、测试和提交报告生成。
- 刘俊熙：飞书业务场景梳理、IM / Docs / Calendar / 跨产品 Demo 设计、演示脚本、材料表达和环境验证。

## ${screenshotLinks ? "十二" : "十一"}、补充说明

项目已经具备从测试目标输入、桌面操作执行、截图留痕、VLM 验收、失败定位到报告输出的闭环。后续可以继续扩展飞书 Base、会议、邮箱等模块，并引入人工录制轨迹生成更多可复用测试数据。
`;
}

function renderSubmissionHtml(
  report: RunReport,
  params: { projectName: string; members: string[]; htmlPath: string; evidenceImages: string[] }
): string {
  const baseDir = path.dirname(params.htmlPath);
  const evidenceImages = params.evidenceImages
    .map((image) => `<img src="${escapeHtml(toMarkdownPath(baseDir, image))}" alt="${escapeHtml(path.basename(image))}" />`)
    .join("\n");
  const screenshots = report.screenshots
    .slice(-6)
    .map((image) => `<img src="${escapeHtml(toMarkdownPath(baseDir, image))}" alt="real screenshot" />`)
    .join("\n");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(params.projectName)} 复赛提交报告</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #17202a; background: #f8fafc; }
    main { max-width: 1080px; margin: 0 auto; padding: 36px 24px 64px; }
    header { background: #0f172a; color: white; padding: 30px 34px; border-radius: 8px; }
    h1 { margin: 0 0 10px; font-size: 30px; }
    h2 { margin-top: 34px; font-size: 22px; }
    p, li { line-height: 1.72; }
    .meta { color: #cbd5e1; }
    .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin: 22px 0; }
    .metric { background: white; border: 1px solid #dbe3ef; border-radius: 8px; padding: 14px 16px; }
    .metric span { display: block; color: #64748b; font-size: 12px; }
    .metric strong { display: block; margin-top: 6px; font-size: 22px; }
    table { width: 100%; border-collapse: collapse; background: white; }
    th, td { padding: 10px 12px; border-bottom: 1px solid #e2e8f0; text-align: left; }
    img { width: 100%; border: 1px solid #dbe3ef; border-radius: 8px; margin: 10px 0 18px; background: white; }
    code { background: #e2e8f0; padding: 2px 5px; border-radius: 4px; }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>${escapeHtml(params.projectName)}：面向飞书桌面端的多模态智能测试 Agent</h1>
      <div class="meta">小组成员：${escapeHtml(params.members.join("、"))} · Run ID：${escapeHtml(report.runId)}</div>
    </header>
    <section class="metrics">
      <div class="metric"><span>Status</span><strong>${escapeHtml(report.status)}</strong></div>
      <div class="metric"><span>Success Rate</span><strong>${(report.successRate * 100).toFixed(1)}%</strong></div>
      <div class="metric"><span>Suite</span><strong>${escapeHtml(report.suite)}</strong></div>
      <div class="metric"><span>Mode</span><strong>${report.dryRun ? "dry-run" : "real"}</strong></div>
    </section>
    <h2>项目结果展示</h2>
    <p>${escapeHtml(params.projectName)} 使用 UI-TARS、视觉语言模型和桌面鼠标键盘控制能力，完成飞书 IM、Docs、Calendar 和跨产品联动测试，并自动沉淀报告与图片证据。</p>
    <table>
      <thead><tr><th>用例</th><th>产品</th><th>状态</th><th>步骤</th><th>模型调用</th><th>截图</th><th>置信度</th><th>失败原因</th></tr></thead>
      <tbody>${report.cases.map(renderCaseHtmlRow).join("\n")}</tbody>
    </table>
    ${renderRunReviewHtml(report)}
    <h2>核心功能实现对照</h2>
    ${renderCapabilityHtmlTable(coreCapabilityRows)}
    <h2>飞书功能覆盖</h2>
    ${renderCapabilityHtmlTable(productCoverageRows)}
    <h2>自然语言测试示例</h2>
    <ul>
      <li><code>npm run cua -- run --instruction "在飞书中创建一个名为项目周报的新文档，并输入标题2026年Q2项目进展"</code></li>
      <li><code>npm run cua -- run --instruction "打开日历，创建一个明天下午2点的会议，邀请张三参加"</code></li>
      <li><code>npm run cua -- run --instruction "在IM中搜索测试群，发送一条消息Hello World，并确认发送成功"</code></li>
    </ul>
    <h2>进阶能力</h2>
    ${renderCapabilityHtmlTable(advancedCapabilityRows)}
    <h2>渐进式实现路径</h2>
    ${renderCapabilityHtmlTable(milestoneRows)}
    <h2>测试图片 / 证据图</h2>
    ${evidenceImages}
    ${screenshots ? `<h2>真实运行截图</h2>${screenshots}` : ""}
    <h2>创新点</h2>
    <ol>
      <li>视觉 Agent 与确定性护栏混合执行，标准高风险路径更稳定，开放任务仍保留截图推理能力。</li>
      <li>IM 发送前增加 VLM 收件人语义校验，避免真实桌面测试误发到错误会话。</li>
      <li>新增 <code>ops</code> JSON 动作序列，显式覆盖单击、双击、右键、拖拽、滚动、文本输入和快捷键组合。</li>
      <li>验证截图统一重编码和压缩，降低多模态模型因异常图片返回 400 的概率。</li>
      <li>VLM 对最终截图做语义化验收，判断真实飞书状态是否达成目标。</li>
      <li>运行后直接生成 JSON、Markdown、HTML 和 PNG 证据图，适合比赛评审和工程复盘。</li>
    </ol>
    <h2>参考资源吸收</h2>
    <p>项目吸收 UI-TARS / UI-TARS-desktop 的视觉动作范式，借鉴 TuriX-CUA 的 Planner / Executor / Evaluator 分工，并参考 OSWorld 的评测指标组织方式；同时通过 <code>ops</code> 命令把复杂桌面操作 CLI 化。</p>
    <h2>分工</h2>
    <p>陈正洋负责核心工程链路、模型接入、验证、报告与测试；刘俊熙负责飞书业务场景、Demo 流程、演示脚本和材料表达。</p>
  </main>
</body>
</html>`;
}

function renderCapabilityHtmlTable(rows: typeof coreCapabilityRows): string {
  return `<table>
      <thead><tr><th>模块</th><th>能力</th><th>实现</th><th>证据</th></tr></thead>
      <tbody>${rows
        .map(
          (row) =>
            `<tr><td>${escapeHtml(row.area)}</td><td>${escapeHtml(row.capability)}</td><td>${inlineCodeToHtml(
              row.implementation
            )}</td><td>${inlineCodeToHtml(row.evidence)}</td></tr>`
        )
        .join("\n")}</tbody>
    </table>`;
}

function renderCaseMarkdownRow(testCase: CaseRunResult): string {
  return `| ${testCase.id} | ${testCase.product} | ${testCase.status} | ${testCase.steps.length} | ${testCase.modelCalls} | ${testCase.screenshots.length} | ${
    testCase.verification?.confidence ?? 0
  } | ${escapeMarkdownTable(caseFailureReason(testCase))} |`;
}

function renderCaseHtmlRow(testCase: CaseRunResult): string {
  return `<tr><td>${escapeHtml(testCase.id)}</td><td>${escapeHtml(testCase.product)}</td><td>${escapeHtml(testCase.status)}</td><td>${
    testCase.steps.length
  }</td><td>${testCase.modelCalls}</td><td>${testCase.screenshots.length}</td><td>${testCase.verification?.confidence ?? 0}</td><td>${escapeHtml(
    caseFailureReason(testCase)
  )}</td></tr>`;
}

function renderRunReviewMarkdown(report: RunReport): string {
  const failed = report.cases.filter((testCase) => testCase.status !== "passed");
  const passed = report.cases.length - failed.length;
  if (report.dryRun) {
    return [
      "### 测试结论",
      "",
      `本次 dry-run 验证通过 ${passed}/${report.cases.length} 个用例，主要验证用例编排、报告生成、提交包生成和确定性验收链路。`,
      "真实桌面执行需要飞书账号、测试聊天对象、macOS Accessibility / Screen Recording 权限和可用 VLM 配置。"
    ].join("\n");
  }

  const lines = [
    "### 真实桌面测试复盘",
    "",
    `本次真实桌面执行覆盖 IM、Docs、Calendar 三个产品，用时 ${report.durationMs} ms，采集 ${report.screenshots.length} 张截图，成功率 ${(report.successRate * 100).toFixed(
      1
    )}%。`,
    `通过用例：${passed}/${report.cases.length}。失败用例：${failed.length}/${report.cases.length}。`
  ];

  if (failed.length) {
    lines.push("", "失败原因摘要：");
    for (const testCase of failed) {
      lines.push(`- ${testCase.id}：${caseFailureReason(testCase) || "未提供失败原因"}`);
    }
    lines.push(
      "",
      "复盘结论：真实桌面链路已经能启动飞书、采集截图并进入多产品流程，但 Docs / Calendar 这类复杂导航仍需要更强的页面定位策略，例如结合快捷入口、飞书开放接口或可访问性树辅助视觉定位。"
    );
  }

  return lines.join("\n");
}

function renderRunReviewHtml(report: RunReport): string {
  const failed = report.cases.filter((testCase) => testCase.status !== "passed");
  const passed = report.cases.length - failed.length;
  if (report.dryRun) {
    return `<h2>测试结论</h2><p>本次 dry-run 验证通过 ${passed}/${report.cases.length} 个用例，主要验证用例编排、报告生成、提交包生成和确定性验收链路。</p>`;
  }
  const failureList = failed.length
    ? `<ul>${failed.map((testCase) => `<li>${escapeHtml(testCase.id)}：${escapeHtml(caseFailureReason(testCase) || "未提供失败原因")}</li>`).join("")}</ul>`
    : "";
  return `<h2>真实桌面测试复盘</h2>
    <p>本次真实桌面执行覆盖 IM、Docs、Calendar 三个产品，用时 ${report.durationMs} ms，采集 ${report.screenshots.length} 张截图，成功率 ${(
      report.successRate * 100
    ).toFixed(1)}%。通过用例：${passed}/${report.cases.length}。</p>
    ${failureList}
    ${
      failed.length
        ? "<p>复盘结论：真实桌面链路已经能启动飞书、采集截图并进入多产品流程，但复杂导航仍需要结合快捷入口、飞书开放接口或可访问性树辅助视觉定位。</p>"
        : ""
    }`;
}

function caseFailureReason(testCase: CaseRunResult): string {
  if (testCase.failureReason) return testCase.failureReason;
  if (testCase.verification && !testCase.verification.passed) return testCase.verification.reason;
  return "";
}

function print(image: InstanceType<typeof Jimp>, font: EvidenceFonts["bodyDark"], x: number, y: number, text: string): void {
  image.print({ font, x, y, text: asciiOnly(text) });
}

function printLines(
  image: InstanceType<typeof Jimp>,
  font: EvidenceFonts["bodyDark"],
  x: number,
  y: number,
  lines: string[],
  lineHeight: number
): void {
  lines.forEach((line, index) => print(image, font, x, y + index * lineHeight, line));
}

function printWrapped(
  image: InstanceType<typeof Jimp>,
  font: EvidenceFonts["bodyDark"],
  x: number,
  y: number,
  text: string,
  maxChars: number,
  lineHeight: number
): void {
  wrapAscii(text, maxChars)
    .slice(0, 5)
    .forEach((line, index) => print(image, font, x, y + index * lineHeight, line));
}

function wrapAscii(text: string, maxChars: number): string[] {
  const words = asciiOnly(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function asciiOnly(input: string): string {
  return input
    .replace(/[\u3400-\u9fff]+/g, "[CN text]")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function statusColor(status: string): number {
  if (status === "passed") return 0x15803dff;
  if (status === "failed") return 0xb42318ff;
  return 0x475569ff;
}

function safeFilename(input: string): string {
  return input.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "case";
}

function toMarkdownPath(fromFileDir: string, target: string): string {
  const relative = path.relative(fromFileDir, path.resolve(target));
  return relative.split(path.sep).join("/");
}

function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (char) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return map[char] ?? char;
  });
}

function inlineCodeToHtml(input: string): string {
  return escapeHtml(input).replace(/`([^`]+)`/g, "<code>$1</code>");
}

function escapeMarkdownTable(input: string): string {
  return input.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function asPngPath(filePath: string): `${string}.png` {
  if (!filePath.endsWith(".png")) {
    throw new Error(`Evidence image path must end with .png: ${filePath}`);
  }
  return filePath as `${string}.png`;
}
