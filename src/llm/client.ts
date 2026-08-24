import Anthropic from "@anthropic-ai/sdk";

/**
 * Model tiering.
 *
 * Narration and chapter synthesis are the quality-critical calls and run on the
 * strongest model. The auditor is a high-volume classification pass over text
 * that has already been written, so it runs cheap and fast — it never writes
 * prose, it only checks it.
 */
export const MODELS = {
  narrator: process.env.NARRATOR_MODEL ?? "claude-opus-5",
  auditor: process.env.AUDITOR_MODEL ?? "claude-haiku-4-5",
  synthesist: process.env.SYNTHESIST_MODEL ?? "claude-opus-5",
} as const;

let client: Anthropic | null = null;

export function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

/** Test hook — inject a stub client. */
export function setClient(c: Anthropic | null): void {
  client = c;
}

export class NarrationError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "NarrationError";
  }
}

/** Map SDK errors onto something a route handler can act on. */
export function describeApiError(err: unknown): { status: number; message: string } {
  // Unwrap our own wrapper first, or every API failure reports as the generic
  // "Narrator call failed" and a missing API key looks like a server bug.
  if (err instanceof NarrationError && err.cause !== undefined) {
    return describeApiError(err.cause);
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return { status: 401, message: "ANTHROPIC_API_KEY is missing or invalid." };
  }
  if (err instanceof Anthropic.RateLimitError) {
    return { status: 429, message: "Rate limited by the Claude API. Try again shortly." };
  }
  if (err instanceof Anthropic.BadRequestError) {
    return { status: 400, message: `Rejected by the Claude API: ${err.message}` };
  }
  if (err instanceof Anthropic.APIError) {
    return { status: err.status ?? 502, message: `Claude API error: ${err.message}` };
  }
  return { status: 500, message: (err as Error)?.message ?? "Unknown error" };
}
