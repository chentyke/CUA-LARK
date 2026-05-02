# CUA-Lark Evaluation Report

This document is the competition-facing report template. Generated run reports are stored under `artifacts/runs/<run-id>/`.

## Standard Suite

| Case | Product | Goal | Primary Metric |
| --- | --- | --- | --- |
| `im-send-text` | IM | Send a timestamped message to a test chat | Message visible |
| `docs-create-edit` | Docs | Create and edit a document | Title/body visible |
| `calendar-create-event` | Calendar | Create tomorrow 14:00 event | Event visible |

## Metrics

- Success rate: passed cases divided by executed cases.
- Duration: total wall-clock time and per-case time.
- Model calls: estimated UI-TARS model turns plus verifier calls.
- Step count: number of planned objectives executed.
- Failure reason: verifier or runtime reason for the first failed case.

## Baseline

Run the dry-run baseline:

```bash
npm run cua -- eval --suite standard --dry-run
```

Expected baseline result: 100% pass because the dry-run path validates orchestration, reporting, and verification plumbing without desktop control.

## Real Evaluation Procedure

1. Log into Lark with a safe test account.
2. Configure `.env` with VLM endpoint, model, API key, test chat, and optional attendee.
3. Grant macOS Accessibility and Screen Recording permissions.
4. Run:

```bash
npm run cua -- eval --suite standard
```

5. Inspect `report.html`, screenshots, and failure reasons.

## Analysis Template

- IM result:
- Docs result:
- Calendar result:
- Common failures:
- Recovery behavior:
- Next optimization:
