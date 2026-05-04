export interface CapabilityRow {
  area: string;
  capability: string;
  implementation: string;
  evidence: string;
}

export const coreCapabilityRows: CapabilityRow[] = [
  {
    area: "基础 GUI 操作",
    capability: "单击、双击、右键、拖拽、滚动、文本输入、快捷键组合",
    implementation: "`src/guiActions.ts` 提供 JSON 动作序列执行器；UI-TARS 执行链路继续使用 `src/operator.ts`。",
    evidence: "`ops` CLI 支持原子动作 dry-run / real-run，标准用例真实运行采集截图。"
  },
  {
    area: "多步骤复合操作",
    capability: "打开聊天 -> 搜索联系人 -> 发送消息 -> 验证发送成功",
    implementation: "`src/planner.ts` 将自然语言或内置用例编排为端到端目标；`src/agent.ts` 负责执行、截图、验证和重试。",
    evidence: "`im-send-text` 真实标准用例已通过。"
  },
  {
    area: "飞书子产品覆盖",
    capability: "IM、Calendar、Docs 三个子产品",
    implementation: "`src/cases.ts` 内置标准套件覆盖 IM 发消息、Docs 新建编辑、Calendar 创建日程。",
    evidence: "`standard` 套件 3/3 真实通过。"
  },
  {
    area: "自然语言驱动测试",
    capability: "支持中文自然语言描述测试目标",
    implementation: "`lark-cua run --instruction <text>` 会推断子产品并交给 UI-TARS + VLM 闭环执行。",
    evidence: "CLI 示例覆盖文档创建、日程创建、IM 发送消息。"
  }
];

export const productCoverageRows: CapabilityRow[] = [
  {
    area: "IM 即时通讯",
    capability: "搜索联系人、发送文本消息、发送前收件人校验、验证最新消息",
    implementation: "`im-send-text` + `src/standardGuard.ts`",
    evidence: "真实标准套件 passed，VLM 置信度 0.99。"
  },
  {
    area: "云文档 Docs",
    capability: "创建新文档、写入标题式内容、编辑正文、验证文本可见",
    implementation: "`docs-create-edit` + Docs 确定性关键路径",
    evidence: "真实标准套件 passed，VLM 置信度 1。"
  },
  {
    area: "日历 Calendar",
    capability: "创建明天下午 2 点会议、保存日程、验证日历网格出现事件",
    implementation: "`calendar-create-event` + Calendar 周视图槽位护栏",
    evidence: "真实标准套件 passed，VLM 置信度 1。"
  },
  {
    area: "跨产品 Demo",
    capability: "Docs 内容 -> IM 通知 -> Calendar 提醒",
    implementation: "`cross-docs-im-calendar` demo 用例",
    evidence: "已纳入 demo 套件，可作为后续真实演示路径。"
  }
];

export const advancedCapabilityRows: CapabilityRow[] = [
  {
    area: "异常场景处理",
    capability: "弹窗、权限、加载超时提示处理",
    implementation: "`src/popupGuard.ts` 将异常处理规则注入每次 UI-TARS 执行；fatal error 分类提前停止危险重试。",
    evidence: "报告中保留失败原因和截图，便于复盘。"
  },
  {
    area: "自愈式执行",
    capability: "验收失败后分析原因并从当前界面继续修复",
    implementation: "`src/agent.ts` 根据 VLM 验收失败原因构造 corrective retry。",
    evidence: "支持 `CUA_MAX_ATTEMPTS` 和 `CUA_RETRY_DELAY_MS` 配置。"
  },
  {
    area: "混合定位策略",
    capability: "视觉识别 + 确定性 GUI 锚点融合",
    implementation: "开放任务由 UI-TARS 视觉推理，标准高风险路径由 `src/standardGuard.ts` 加护栏。",
    evidence: "修复了误发群聊、Docs 标题漂移、Calendar 保存误点等真实问题。"
  },
  {
    area: "多轮对话编排",
    capability: "根据中间执行和验收结果动态调整后续步骤",
    implementation: "Planner 生成目标，Agent 在每轮验证后决定结束或追加补救步骤。",
    evidence: "Run report 记录步骤、事件、截图、模型调用和最终判定。"
  },
  {
    area: "评估体系",
    capability: "自动统计成功率、耗时、步骤数、模型调用、截图证据",
    implementation: "`src/reporter.ts` + `src/submission.ts`",
    evidence: "每次提交生成 JSON、Markdown、HTML、PNG 证据图。"
  }
];

export const milestoneRows: CapabilityRow[] = [
  {
    area: "M1 · 单步操作",
    capability: "截图 -> VLM 识别 -> 单步点击/输入",
    implementation: "UI-TARS Operator + `src/guiActions.ts` 原子动作执行器",
    evidence: "已完成"
  },
  {
    area: "M2 · 流程串联",
    capability: "多步操作串联 + 状态验证",
    implementation: "Planner + Agent + Verifier 闭环",
    evidence: "已完成"
  },
  {
    area: "M3 · 多产品覆盖",
    capability: "覆盖 3 个以上子产品",
    implementation: "IM / Docs / Calendar 标准套件，跨产品 demo 扩展",
    evidence: "已完成"
  },
  {
    area: "M4 · 评估体系",
    capability: "结构化报告和核心指标",
    implementation: "JSON / Markdown / HTML / PNG 输出",
    evidence: "已完成"
  },
  {
    area: "M5 · 进阶优化",
    capability: "异常处理、自愈、跨产品联动、混合定位",
    implementation: "PopupGuard、corrective retry、standardGuard、demo case",
    evidence: "已完成 3 项以上"
  }
];

export function renderCapabilityMarkdownTable(rows: CapabilityRow[]): string {
  return [
    "| 模块 | 能力 | 实现 | 证据 |",
    "| --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row.area} | ${row.capability} | ${row.implementation} | ${row.evidence} |`)
  ].join("\n");
}
