import { describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { describeApiError, NarrationError } from "@/llm/client";

/**
 * A missing API key is the single most likely first-run failure, and it must
 * say so. These tests exist because it originally reported "Narrator call
 * failed" — the wrapper swallowed the cause and made a config problem look
 * like a server bug.
 */
describe("API error reporting", () => {
  it("unwraps a wrapped error rather than reporting the wrapper", () => {
    const wrapped = new NarrationError("Narrator call failed", new Error("inner"));
    expect(describeApiError(wrapped).message).toBe("inner");
  });

  it("names a missing API key explicitly", () => {
    const auth = new Anthropic.AuthenticationError(401, {}, "unauthorized", new Headers());
    const { status, message } = describeApiError(
      new NarrationError("Narrator call failed", auth),
    );
    expect(status).toBe(401);
    expect(message).toContain("ANTHROPIC_API_KEY");
  });

  it("passes through a rate limit as retryable", () => {
    const limited = new Anthropic.RateLimitError(429, {}, "slow down", new Headers());
    expect(describeApiError(limited).status).toBe(429);
  });

  it("keeps its own message when there is no cause to unwrap", () => {
    expect(describeApiError(new NarrationError("declined to write")).message).toBe(
      "declined to write",
    );
  });
});
