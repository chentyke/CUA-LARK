import { describe, expect, it } from "vitest";
import { isClearlyFatalError } from "../src/agent.js";

describe("retry policy", () => {
  it("treats model rate limits as retryable", () => {
    expect(isClearlyFatalError(new Error("429 Tokens Per Minute limit exceeded"))).toBe(false);
  });

  it("stops on obvious credential and permission errors", () => {
    expect(isClearlyFatalError(new Error("401 unauthorized API key"))).toBe(true);
    expect(isClearlyFatalError(new Error("Screen Recording permission is missing"))).toBe(true);
  });

  it("stops on model request schema errors", () => {
    expect(isClearlyFatalError(new Error("400 frequency_penalty input should be a valid number"))).toBe(true);
    expect(isClearlyFatalError(new Error("presence_penalty float_type validation failed"))).toBe(true);
  });
});
