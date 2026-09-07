import type { ExtractionResult } from "./types";
import { createMessage, EXTRACTION_MODEL, MODEL } from "./llm";
import type { ContentBlock, ToolDefinition, ToolUseBlock } from "./llm";

const RECORD_TOOL: ToolDefinition = {
  name: "record_life_events",
  description:
    "Record structured life-context items found in a message: commitments (promises), " +
    "events (things with a date/time), decisions (with rationale), and open questions. " +
    "Only record what is explicitly present — never invent dates or details. Omit an " +
    "array entirely (empty array) if nothing of that kind is present.",
  input_schema: {
    type: "object",
    properties: {
      commitments: {
        type: "array",
        items: {
          type: "object",
          properties: {
            owner: { type: "string", enum: ["me", "them"], description: "'me' = the primary user promised this; 'them' = the other person promised it" },
            description: { type: "string" },
            due_at: { type: ["string", "null"], description: "ISO 8601 if a date/time is stated or clearly implied (e.g. 'Friday'), else null" },
            urgency: { type: "integer", minimum: 1, maximum: 5, description: "1=no time pressure, 5=due very soon / high stakes" },
            urgency_reason: { type: "string", description: "One short clause explaining the urgency score — never show a bare number without this" },
            confidence: { type: "integer", minimum: 1, maximum: 5, description: "How sure you are this is a genuine commitment, not just conversational filler" },
          },
          required: ["owner", "description", "due_at", "urgency", "urgency_reason", "confidence"],
        },
      },
      events: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            starts_at: { type: ["string", "null"] },
            location: { type: ["string", "null"] },
            importance: { type: "integer", minimum: 1, maximum: 5 },
            importance_reason: { type: "string" },
          },
          required: ["title", "starts_at", "location", "importance", "importance_reason"],
        },
      },
      decisions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            topic: { type: "string" },
            decision_text: { type: "string" },
            rationale: { type: ["string", "null"] },
          },
          required: ["topic", "decision_text", "rationale"],
        },
      },
      open_questions: {
        type: "array",
        items: {
          type: "object",
          properties: { question_text: { type: "string" } },
          required: ["question_text"],
        },
      },
      opportunities: {
        type: "array",
        description: "Things worth acting on that aren't a commitment or event — an opening, an offer, a lead.",
        items: {
          type: "object",
          properties: {
            description: { type: "string" },
            confidence: { type: "integer", minimum: 1, maximum: 5, description: "How likely this is a genuine opportunity worth the user's attention, not a stretch" },
            confidence_reason: { type: "string" },
          },
          required: ["description", "confidence", "confidence_reason"],
        },
      },
    },
    required: ["commitments", "events", "decisions", "open_questions", "opportunities"],
  },
};

const EMPTY: ExtractionResult = { commitments: [], events: [], decisions: [], open_questions: [], opportunities: [] };

function parseToolResult(message: { content: ContentBlock[] }): ExtractionResult {
  const block = message.content.find(
    (b): b is ToolUseBlock => b.type === "tool_use" && b.name === "record_life_events",
  );
  if (!block) return EMPTY;
  return block.input as ExtractionResult;
}

/**
 * Extracts commitments/events/decisions/open questions from one text message,
 * given a little surrounding context (sender name, recent thread history).
 * Runs identically whether the message is a real inbound webhook delivery or
 * seeded demo data — this is the "real" part of ECHO, not a demo-only path.
 */
export async function extractFromText(params: {
  senderName: string;
  threadTitle: string;
  text: string;
  recentContext?: string;
  now: string; // ISO timestamp to resolve relative dates ("Friday", "tomorrow") against
}): Promise<ExtractionResult> {
  const message = await createMessage({
    model: EXTRACTION_MODEL,
    max_tokens: 1024,
    system:
      `You extract structured life-context from one message in a conversation called "${params.threadTitle}". ` +
      `The current date/time is ${params.now} — resolve relative dates against it. ` +
      `Call record_life_events with what you find. If the message is small talk with nothing ` +
      `extractable, call it with all-empty arrays.`,
    tools: [RECORD_TOOL],
    tool_choice: { type: "tool", name: "record_life_events" },
    messages: [
      {
        role: "user",
        content:
          (params.recentContext ? `Recent context:\n${params.recentContext}\n\n` : "") +
          `New message from ${params.senderName}: "${params.text}"`,
      },
    ],
  });

  return parseToolResult(message);
}

export interface ScreenshotEvent {
  title: string;
  starts_at: string | null;
  location: string | null;
  found: boolean;
}

/** Vision extraction for the "screenshot → event" demo beat. */
export async function extractEventFromImage(params: {
  imageBase64: string;
  mimeType: string;
  now: string;
}): Promise<ScreenshotEvent> {
  const tool: ToolDefinition = {
    name: "record_screenshot_event",
    description: "Record the single event shown in this image (a flyer, invite, or calendar screenshot).",
    input_schema: {
      type: "object",
      properties: {
        found: { type: "boolean", description: "true if the image clearly depicts an event with a date/time" },
        title: { type: "string" },
        starts_at: { type: ["string", "null"], description: "ISO 8601" },
        location: { type: ["string", "null"] },
      },
      required: ["found", "title", "starts_at", "location"],
    },
  };

  const message = await createMessage({
    model: MODEL,
    max_tokens: 512,
    system: `The current date/time is ${params.now} — resolve relative dates against it.`,
    tools: [tool],
    tool_choice: { type: "tool", name: "record_screenshot_event" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64" as const, media_type: params.mimeType, data: params.imageBase64 },
          },
          { type: "text", text: "Extract the event shown, if any." },
        ],
      },
    ],
  });

  const block = message.content.find(
    (b): b is ToolUseBlock => b.type === "tool_use" && b.name === "record_screenshot_event",
  );
  if (!block) return { found: false, title: "", starts_at: null, location: null };
  return block.input as ScreenshotEvent;
}
