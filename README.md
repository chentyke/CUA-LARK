# CUA-Lark

CUA-Lark is a UI-TARS based desktop testing agent for Lark. It uses screenshots, a vision-language model, and desktop mouse/keyboard control to execute GUI test cases like a real user.

The first release targets macOS and `/Applications/Lark.app`. It includes IM, Docs, Calendar, and cross-product demo cases, plus JSON/Markdown/HTML reports.

## Quick Start

```bash
npm install
npm run build
npm run cua -- doctor
npm run cua -- list
npm run cua -- eval --suite standard --dry-run
```

For real desktop execution, create a local `.env` file from `.env.example` and fill:

```bash
VLM_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
VLM_API_KEY=<your-key>
VLM_MODEL=<your-ark-endpoint-id>
LARK_TEST_CHAT=<safe-test-chat>
LARK_TEST_ATTENDEE=<safe-test-attendee>
```

Do not commit `.env`. It is ignored by Git.

## Commands

```bash
npm run cua -- doctor
npm run cua -- list
npm run cua -- run --case im-send-text --dry-run
npm run cua -- run --instruction "在IM中搜索测试群并发送Hello World" --dry-run
npm run cua -- eval --suite standard --dry-run
```

Remove `--dry-run` only after Lark is logged in, the VLM config is set, and macOS permissions are ready.

## macOS Permissions

Grant the terminal app or Node runner:

- Accessibility
- Screen Recording

Open System Settings, search each permission name, and add your terminal application. Restart the terminal after changing permissions.

## Standard Cases

- `im-send-text`: search a test chat, send timestamped text, verify latest message.
- `docs-create-edit`: create a document, write title/body, verify content.
- `calendar-create-event`: create a tomorrow 2 PM event, optionally invite an attendee, verify event.
- `cross-docs-im-calendar`: create Docs content, send IM reference, create Calendar reminder.

## Artifacts

Each run writes to `artifacts/runs/<run-id>/`:

- `report.json`
- `report.md`
- `report.html`
- `screenshots/`

## Notes

This project intentionally uses `@ui-tars/sdk` directly instead of Agent TARS CLI because the local Node version is compatible with the SDK route and avoids a CLI version constraint. The implementation keeps real credentials out of source-controlled files.
