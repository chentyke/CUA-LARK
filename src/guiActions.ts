import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type GuiAction =
  | { type: "click"; x: number; y: number }
  | { type: "doubleClick"; x: number; y: number }
  | { type: "rightClick"; x: number; y: number }
  | { type: "drag"; from: PointSpec; to: PointSpec }
  | { type: "scroll"; x?: number; y?: number; deltaX?: number; deltaY?: number }
  | { type: "typeText"; text: string }
  | { type: "hotkey"; keys: string[] }
  | { type: "wait"; ms: number };

export interface PointSpec {
  x: number;
  y: number;
}

export interface GuiActionEvent {
  index: number;
  action: GuiAction;
  status: "passed" | "skipped";
  detail: string;
}

export interface RunGuiActionsOptions {
  appName?: string;
  dryRun?: boolean;
}

type NutJs = typeof import("@computer-use/nut-js");
type NutKey = Parameters<NutJs["keyboard"]["pressKey"]>[0];

let nutModule: Promise<NutJs> | undefined;

export function parseGuiActions(input: string): GuiAction[] {
  const parsed = JSON.parse(input) as unknown;
  if (!Array.isArray(parsed)) throw new Error("GUI actions must be a JSON array.");
  return parsed.map((item, index) => normalizeGuiAction(item, index));
}

export async function runGuiActions(actions: GuiAction[], options: RunGuiActionsOptions = {}): Promise<GuiActionEvent[]> {
  if (!options.dryRun && options.appName) {
    await execFileAsync("open", ["-a", options.appName]);
    await wait(600);
  }

  const events: GuiActionEvent[] = [];
  for (const [offset, action] of actions.entries()) {
    if (!options.dryRun) {
      await executeGuiAction(action);
    }
    events.push({
      index: offset + 1,
      action,
      status: options.dryRun ? "skipped" : "passed",
      detail: describeGuiAction(action)
    });
  }
  return events;
}

export function describeGuiAction(action: GuiAction): string {
  switch (action.type) {
    case "click":
      return `click (${action.x}, ${action.y})`;
    case "doubleClick":
      return `double-click (${action.x}, ${action.y})`;
    case "rightClick":
      return `right-click (${action.x}, ${action.y})`;
    case "drag":
      return `drag (${action.from.x}, ${action.from.y}) -> (${action.to.x}, ${action.to.y})`;
    case "scroll":
      return `scroll deltaX=${action.deltaX ?? 0} deltaY=${action.deltaY ?? 0}`;
    case "typeText":
      return `type text length=${action.text.length}`;
    case "hotkey":
      return `hotkey ${action.keys.join("+")}`;
    case "wait":
      return `wait ${action.ms}ms`;
  }
}

async function executeGuiAction(action: GuiAction): Promise<void> {
  const { Button, Point, clipboard, keyboard, mouse } = await desktop();
  switch (action.type) {
    case "click":
      await mouse.setPosition(new Point(action.x, action.y));
      await mouse.leftClick();
      return;
    case "doubleClick":
      await mouse.setPosition(new Point(action.x, action.y));
      await mouse.doubleClick(Button.LEFT);
      return;
    case "rightClick":
      await mouse.setPosition(new Point(action.x, action.y));
      await mouse.rightClick();
      return;
    case "drag":
      await mouse.drag([new Point(action.from.x, action.from.y), new Point(action.to.x, action.to.y)]);
      return;
    case "scroll":
      if (typeof action.x === "number" && typeof action.y === "number") {
        await mouse.setPosition(new Point(action.x, action.y));
      }
      await scrollBy(action.deltaX ?? 0, action.deltaY ?? 0);
      return;
    case "typeText":
      await clipboard.setContent(action.text);
      await keyboard.pressKey(...(await resolveKeys(["cmd", "v"])));
      await keyboard.releaseKey(...(await resolveKeys(["cmd", "v"])));
      return;
    case "hotkey": {
      const keys = await resolveKeys(action.keys);
      await keyboard.pressKey(...keys);
      await keyboard.releaseKey(...keys);
      return;
    }
    case "wait":
      await wait(action.ms);
      return;
  }
}

async function scrollBy(deltaX: number, deltaY: number): Promise<void> {
  const { mouse } = await desktop();
  if (deltaY > 0) await mouse.scrollDown(Math.abs(deltaY));
  if (deltaY < 0) await mouse.scrollUp(Math.abs(deltaY));
  if (deltaX > 0) await mouse.scrollRight(Math.abs(deltaX));
  if (deltaX < 0) await mouse.scrollLeft(Math.abs(deltaX));
}

async function resolveKeys(names: string[]): Promise<NutKey[]> {
  const { Key } = await desktop();
  return names.map((name) => resolveKey(name, Key as unknown as Record<string, unknown>));
}

function resolveKey(name: string, keyEnum: Record<string, unknown>): NutKey {
  const keyName = keyAlias(name);
  const value = keyEnum[keyName];
  if (typeof value !== "number") throw new Error(`Unsupported hotkey key: ${name}`);
  return value as NutKey;
}

function keyAlias(input: string): string {
  const lower = input.trim().toLowerCase();
  const aliases: Record<string, string> = {
    cmd: "LeftCmd",
    command: "LeftCmd",
    meta: "LeftCmd",
    ctrl: "LeftControl",
    control: "LeftControl",
    alt: "LeftAlt",
    option: "LeftAlt",
    shift: "LeftShift",
    enter: "Return",
    return: "Return",
    esc: "Escape",
    escape: "Escape",
    backspace: "Backspace",
    delete: "Delete",
    tab: "Tab",
    space: "Space",
    up: "Up",
    down: "Down",
    left: "Left",
    right: "Right"
  };
  if (aliases[lower]) return aliases[lower];
  if (/^[a-z0-9]$/.test(lower)) return lower.toUpperCase();
  return input.trim();
}

function normalizeGuiAction(value: unknown, index: number): GuiAction {
  if (!value || typeof value !== "object") throw new Error(`Action ${index + 1} must be an object.`);
  const raw = value as Record<string, unknown>;
  const type = stringField(raw, "type", index);
  switch (type) {
    case "click":
    case "doubleClick":
    case "rightClick":
      return { type, x: numberField(raw, "x", index), y: numberField(raw, "y", index) };
    case "drag":
      return {
        type,
        from: pointField(raw, "from", index),
        to: pointField(raw, "to", index)
      };
    case "scroll":
      return {
        type,
        x: optionalNumberField(raw, "x", index),
        y: optionalNumberField(raw, "y", index),
        deltaX: optionalNumberField(raw, "deltaX", index),
        deltaY: optionalNumberField(raw, "deltaY", index)
      };
    case "typeText":
      return { type, text: stringField(raw, "text", index) };
    case "hotkey": {
      const keys = raw.keys;
      if (!Array.isArray(keys) || !keys.every((key) => typeof key === "string")) {
        throw new Error(`Action ${index + 1} field keys must be a string array.`);
      }
      return { type, keys };
    }
    case "wait":
      return { type, ms: numberField(raw, "ms", index) };
    default:
      throw new Error(`Action ${index + 1} has unsupported type: ${type}`);
  }
}

function pointField(raw: Record<string, unknown>, field: string, index: number): PointSpec {
  const point = raw[field];
  if (!point || typeof point !== "object") throw new Error(`Action ${index + 1} field ${field} must be a point.`);
  const record = point as Record<string, unknown>;
  return {
    x: numberField(record, "x", index),
    y: numberField(record, "y", index)
  };
}

function stringField(raw: Record<string, unknown>, field: string, index: number): string {
  const value = raw[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Action ${index + 1} field ${field} must be a non-empty string.`);
  }
  return value;
}

function numberField(raw: Record<string, unknown>, field: string, index: number): number {
  const value = raw[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Action ${index + 1} field ${field} must be a finite number.`);
  }
  return value;
}

function optionalNumberField(raw: Record<string, unknown>, field: string, index: number): number | undefined {
  if (raw[field] === undefined) return undefined;
  return numberField(raw, field, index);
}

async function desktop(): Promise<NutJs> {
  nutModule ??= import("@computer-use/nut-js");
  return nutModule;
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}
