// Provider-neutral shapes, deliberately mirroring the Anthropic SDK's message
// format because that's what ECHO's four LLM call sites were already written
// against. Keeping this shape means adding Gemini support didn't require
// rewriting extract.ts / agents.ts / search.ts / watches.ts.

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

export type ContentBlock = TextBlock | ToolUseBlock;

export interface ImagePart {
  type: "image";
  source: { type: "base64"; media_type: string; data: string };
}

export interface TextPart {
  type: "text";
  text: string;
}

export interface ToolResultPart {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

export type ContentPart = ImagePart | TextPart | ToolResultPart;

export interface LLMMessage {
  role: "user" | "assistant";
  /** A plain string, an array of parts, or assistant content blocks echoed back. */
  content: string | ContentPart[] | ContentBlock[];
}

/** JSON-Schema-ish; each provider converts to its own dialect. */
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface CreateMessageParams {
  model: string;
  max_tokens: number;
  system?: string;
  tools?: ToolDefinition[];
  /** `{type:"tool", name}` forces that specific tool; omit to let the model choose. */
  tool_choice?: { type: "tool"; name: string } | { type: "auto" };
  messages: LLMMessage[];
}

export interface LLMResponse {
  content: ContentBlock[];
}

export interface LLMBackend {
  readonly name: "anthropic" | "gemini";
  createMessage(params: CreateMessageParams): Promise<LLMResponse>;
}
