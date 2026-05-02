# CUA-Lark Demo Video Script

Target length: 3-5 minutes.

## 0:00-0:30 Opening

Show the repository and explain that CUA-Lark uses UI-TARS to operate Lark desktop through vision, reasoning, and real mouse/keyboard actions.

## 0:30-1:00 Environment Check

Run:

```bash
npm run cua -- doctor
npm run cua -- list
```

Point out Lark detection, VLM config, and permission reminders.

## 1:00-2:00 IM Case

Run `im-send-text`. Show Lark opening, searching the test chat, sending a timestamped message, and the report entry.

## 2:00-3:00 Docs Case

Run `docs-create-edit`. Show document creation, title/body entry, screenshot capture, and VLM verification.

## 3:00-4:00 Calendar Case

Run `calendar-create-event`. Show the tomorrow 14:00 event creation and final verification screenshot.

## 4:00-4:45 Report

Open `report.html`, show success rate, duration, model calls, and failure details if any.

## 4:45-5:00 Closing

Summarize architecture: Planner, LarkAgent, LarkOperator, Verifier, Reporter, PopupGuard.
