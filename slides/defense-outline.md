# CUA-Lark Defense Outline

## 1. Problem

- GUI tests for Electron desktop products are fragile when tied to selectors.
- Lark is a realistic target because IM, Docs, Calendar, and other products have rich cross-product workflows.

## 2. Core Idea

- Treat Lark desktop as a visual environment.
- Use UI-TARS to convert screenshots and goals into grounded actions.
- Verify outcomes through screenshots and semantic VLM judgment.

## 3. Architecture

- Planner: natural language to objectives.
- LarkAgent: execution loop and self-healing retry.
- LarkOperator: Lark focus, NutJS action execution, screenshot audit.
- Verifier: success criteria to visual judgment.
- Reporter: evaluation data and HTML report.

## 4. Demo Cases

- IM text send.
- Docs creation and editing.
- Calendar event creation.
- Cross-product Docs -> IM -> Calendar workflow.

## 5. Evaluation

- Metrics: success rate, duration, steps, model calls, failure reasons.
- Reports: JSON for machine analysis, Markdown for review, HTML for presentation.

## 6. Innovation

- UI-TARS SDK as reusable Lark-specific test harness.
- Mixed deterministic case planning plus VLM visual execution.
- Built-in report schema for competition evaluation.
- PopupGuard and one-shot verification retry.

## 7. Roadmap

- Accessibility tree fusion for better grounding.
- Operation recording and replay.
- Larger Lark product coverage: Base, VC, Mail.
- Dataset generation from human demos.
