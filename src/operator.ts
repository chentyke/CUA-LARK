import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Jimp } from "jimp";
import { NutJSOperator } from "@ui-tars/operator-nut-js";
import type { AgentEvent } from "./types.js";
import { nowIso, timestampForId } from "./time.js";

const execFileAsync = promisify(execFile);

type ScreenshotOutput = {
  base64: string;
  scaleFactor?: number;
};

type ExecuteParams = {
  parsedPrediction?: {
    action_type?: string;
    action_inputs?: Record<string, unknown>;
  };
  prediction?: string;
};

export class LarkOperator {
  static MANUAL = (NutJSOperator as unknown as { MANUAL?: unknown }).MANUAL;

  private readonly inner: InstanceType<typeof NutJSOperator>;
  private readonly events: AgentEvent[] = [];
  private readonly screenshots: string[] = [];
  private originalScreenSize: { width: number; height: number } | undefined;

  constructor(
    private readonly options: {
      appName: string;
      screenshotDir: string;
      dryRun?: boolean;
    }
  ) {
    this.inner = new NutJSOperator();
  }

  async focusApp(): Promise<void> {
    if (this.options.dryRun) return;
    await execFileAsync("open", ["-a", this.options.appName]);
    this.events.push({
      timestamp: nowIso(),
      type: "system",
      message: `Focused application ${this.options.appName}.`
    });
  }

  async screenshot(): Promise<ScreenshotOutput> {
    if (this.options.dryRun) {
      const fake = Buffer.from("dry-run-screenshot").toString("base64");
      return { base64: fake, scaleFactor: 1 };
    }

    const output = (await this.inner.screenshot()) as ScreenshotOutput;
    const resized = await this.resizeScreenshot(output.base64);
    await this.archiveScreenshot(output.base64);
    return { ...output, base64: resized.base64 };
  }

  async execute(params: ExecuteParams): Promise<unknown> {
    const actionType = params.parsedPrediction?.action_type ?? "unknown";
    this.events.push({
      timestamp: nowIso(),
      type: "operator-action",
      message: `Executing ${actionType}.`,
      data: params.parsedPrediction ?? params.prediction
    });
    if (this.options.dryRun) return { status: "END" };
    const remappedParams =
      this.originalScreenSize && "screenWidth" in params && "screenHeight" in params
        ? {
            ...params,
            screenWidth: this.originalScreenSize.width,
            screenHeight: this.originalScreenSize.height
          }
        : params;
    return this.inner.execute(remappedParams as never);
  }

  getEvents(): AgentEvent[] {
    return [...this.events];
  }

  getScreenshots(): string[] {
    return [...this.screenshots];
  }

  recordSystemEvent(message: string, data?: unknown): void {
    this.events.push({
      timestamp: nowIso(),
      type: "system",
      message,
      data
    });
  }

  private async archiveScreenshot(base64: string): Promise<void> {
    await fs.mkdir(this.options.screenshotDir, { recursive: true });
    const filename = `screenshot-${timestampForId()}-${String(this.screenshots.length + 1).padStart(3, "0")}.png`;
    const fullPath = path.join(this.options.screenshotDir, filename);
    await fs.writeFile(fullPath, Buffer.from(base64, "base64"));
    this.screenshots.push(fullPath);
    this.events.push({
      timestamp: nowIso(),
      type: "screenshot",
      message: `Captured screenshot ${filename}.`,
      data: { path: fullPath }
    });
  }

  private async resizeScreenshot(base64: string): Promise<{ base64: string; width: number; height: number }> {
    const maxPixels = Number(process.env.CUA_MAX_SCREENSHOT_PIXELS ?? 360000);
    const image = await Jimp.read(Buffer.from(base64, "base64"));
    const { width, height } = image.bitmap;
    this.originalScreenSize = { width, height };
    if (!Number.isFinite(maxPixels) || maxPixels <= 0 || width * height <= maxPixels) {
      return { base64, width, height };
    }

    const factor = Math.sqrt(maxPixels / (width * height));
    const resizedWidth = Math.max(1, Math.floor(width * factor));
    const resizedHeight = Math.max(1, Math.floor(height * factor));
    const resizedBuffer = await image.resize({ w: resizedWidth, h: resizedHeight }).getBuffer("image/png", {
      quality: 60
    });
    this.events.push({
      timestamp: nowIso(),
      type: "system",
      message: `Downscaled screenshot from ${width}x${height} to ${resizedWidth}x${resizedHeight} for VLM token budget.`
    });
    return { base64: resizedBuffer.toString("base64"), width: resizedWidth, height: resizedHeight };
  }
}
