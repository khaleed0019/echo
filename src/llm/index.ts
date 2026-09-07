import { createAnthropicBackend } from "./anthropic";
import { createGeminiBackend } from "./gemini";
import type { CreateMessageParams, LLMBackend, LLMResponse } from "./types";

export type { ContentBlock, TextBlock, ToolUseBlock, ToolDefinition, LLMMessage } from "./types";

/**
 * One place the LLM backend is chosen, so the whole app can be repointed with
 * env vars alone. ECHO's four call sites (extract / agents / search / watches)
 * all go through createMessage() below and don't know which provider is live.
 *
 * Provider selection:
 *   LLM_PROVIDER=gemini     -> Google AI Studio (free tier: Flash models,
 *                              function calling + vision, ~15-30 RPM)
 *   LLM_PROVIDER=anthropic  -> Anthropic API, or any Anthropic-compatible
 *                              gateway via ANTHROPIC_BASE_URL
 *   (unset)                 -> inferred: gemini if GEMINI_API_KEY is set,
 *                              otherwise anthropic
 *
 * Whichever is chosen must support **tool use** and **vision** — the
 * extraction engine is built on forced tool calls and screenshot->event sends
 * image blocks. `bun run doctor` verifies both against the live backend.
 */

const explicitProvider = process.env.LLM_PROVIDER?.trim().toLowerCase();
const geminiKey = process.env.GEMINI_API_KEY?.trim() || undefined;
const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim() || undefined;
const anthropicToken = process.env.ANTHROPIC_AUTH_TOKEN?.trim() || undefined;
const anthropicBaseURL = process.env.ANTHROPIC_BASE_URL?.trim() || undefined;

export const PROVIDER: "anthropic" | "gemini" =
  explicitProvider === "gemini" ? "gemini" : explicitProvider === "anthropic" ? "anthropic" : geminiKey ? "gemini" : "anthropic";

const DEFAULT_MODELS = {
  // Flash model with function calling + vision. Override with GEMINI_MODEL;
  // run `bun run models` to see what your key can actually reach — Google
  // renames these often and a wrong name 404s rather than falling back.
  gemini: "gemini-3.5-flash",
  anthropic: "claude-sonnet-5",
} as const;

export const MODEL =
  (PROVIDER === "gemini" ? process.env.GEMINI_MODEL : process.env.ANTHROPIC_MODEL)?.trim() || DEFAULT_MODELS[PROVIDER];

/**
 * The high-volume path: extraction runs on EVERY inbound message, so it can
 * be pointed at a cheaper/faster model than the user-facing agents. Falls
 * back to MODEL when unset.
 */
export const EXTRACTION_MODEL = process.env.LLM_EXTRACTION_MODEL?.trim() || MODEL;

let backend: LLMBackend | null = null;

function getBackend(): LLMBackend {
  if (backend) return backend;
  backend =
    PROVIDER === "gemini"
      ? createGeminiBackend({ apiKey: geminiKey ?? "" })
      : createAnthropicBackend({ apiKey: anthropicKey, authToken: anthropicToken, baseURL: anthropicBaseURL });
  return backend;
}

export function createMessage(params: CreateMessageParams): Promise<LLMResponse> {
  return getBackend().createMessage(params);
}

export function hasCredentials(): boolean {
  return PROVIDER === "gemini" ? Boolean(geminiKey) : Boolean(anthropicKey || anthropicToken);
}

export function llmBackendLabel(): string {
  if (PROVIDER === "gemini") return "Google AI Studio (Gemini)";
  if (!anthropicBaseURL) return "https://api.anthropic.com (official)";
  try {
    const official = new URL(anthropicBaseURL).hostname.endsWith("api.anthropic.com");
    return `${anthropicBaseURL} (${official ? "official" : "third-party gateway"})`;
  } catch {
    return `${anthropicBaseURL} (unparseable URL)`;
  }
}

export function authStyle(): string {
  if (PROVIDER === "gemini") return "x-goog-api-key (GEMINI_API_KEY)";
  return anthropicToken ? "Authorization: Bearer (ANTHROPIC_AUTH_TOKEN)" : "x-api-key (ANTHROPIC_API_KEY)";
}

export function credentialHint(): string {
  return PROVIDER === "gemini"
    ? "Set GEMINI_API_KEY (free key from https://aistudio.google.com/apikey)."
    : "Set ANTHROPIC_API_KEY (official API) or ANTHROPIC_AUTH_TOKEN (gateways, Bearer auth).";
}

/** A shell-exported ANTHROPIC_BASE_URL overrides a blank one in .env — surfaced by doctor. */
export function baseUrlCameFromShell(): boolean {
  return PROVIDER === "anthropic" && Boolean(anthropicBaseURL);
}
