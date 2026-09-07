import type {
  CreateMessageParams,
  ContentBlock,
  ContentPart,
  LLMBackend,
  LLMResponse,
  ToolDefinition,
} from "./types";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Gemini's function-declaration schema is OpenAPI-flavoured, not full JSON
 * Schema, and it rejects several things ECHO's tool definitions use:
 *
 *   - union types (`type: ["string", "null"]`) -> must be `type: "STRING"`
 *     plus `nullable: true`. ECHO uses these heavily for optional dates.
 *   - lowercase type names -> Gemini wants them uppercased.
 *   - `minimum` / `maximum` -> not supported on the free Flash models; the
 *     constraint is kept in the field description instead so the model still
 *     sees the intent.
 *
 * Silently passing an unconverted schema doesn't error cleanly — it either
 * 400s or the model returns malformed args, which would look like ECHO's
 * extraction being broken. Hence a real converter rather than a cast.
 */
function toGeminiSchema(schema: Record<string, any>): Record<string, any> {
  if (!schema || typeof schema !== "object") return schema;

  const out: Record<string, any> = {};
  let rawType = schema.type;
  let nullable = false;

  if (Array.isArray(rawType)) {
    nullable = rawType.includes("null");
    rawType = rawType.find((t: string) => t !== "null") ?? "string";
  }
  if (rawType) out.type = String(rawType).toUpperCase();
  if (nullable) out.nullable = true;

  // Fold numeric bounds into the description — Gemini drops them, but the
  // model still benefits from being told the range.
  const bounds: string[] = [];
  if (typeof schema.minimum === "number") bounds.push(`min ${schema.minimum}`);
  if (typeof schema.maximum === "number") bounds.push(`max ${schema.maximum}`);
  const desc = [schema.description, bounds.length ? `(${bounds.join(", ")})` : ""].filter(Boolean).join(" ");
  if (desc) out.description = desc;

  if (schema.enum) out.enum = schema.enum.map(String);
  if (schema.properties) {
    out.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([k, v]) => [k, toGeminiSchema(v as Record<string, any>)]),
    );
  }
  if (schema.items) out.items = toGeminiSchema(schema.items);
  if (Array.isArray(schema.required) && schema.required.length) out.required = schema.required;

  return out;
}

function toGeminiTools(tools: ToolDefinition[]) {
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: toGeminiSchema(t.input_schema),
      })),
    },
  ];
}

/** Gemini's functionCall carries no id, but ECHO's search loop needs one to
 *  correlate tool_result parts. Ids encode the function name so the reverse
 *  mapping (tool_result -> functionResponse, which is keyed by *name*) works. */
function synthesizeToolId(name: string, index: number): string {
  return `gemtool_${name}_${index}`;
}
function nameFromToolId(id: string): string {
  const m = id.match(/^gemtool_(.+)_\d+$/);
  return m ? m[1]! : id;
}

function partsFromContent(content: CreateMessageParams["messages"][number]["content"]): any[] {
  if (typeof content === "string") return [{ text: content }];

  const parts: any[] = [];
  for (const part of content as (ContentPart | ContentBlock)[]) {
    switch (part.type) {
      case "text":
        parts.push({ text: part.text });
        break;
      case "image":
        parts.push({ inlineData: { mimeType: part.source.media_type, data: part.source.data } });
        break;
      case "tool_result":
        parts.push({
          functionResponse: {
            name: nameFromToolId(part.tool_use_id),
            // Gemini requires an object here; ECHO's tool results are JSON strings.
            response: { result: safeParse(part.content) },
          },
        });
        break;
      case "tool_use":
        parts.push({ functionCall: { name: part.name, args: part.input } });
        break;
    }
  }
  return parts;
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

export function createGeminiBackend(opts: { apiKey: string }): LLMBackend {
  return {
    name: "gemini",
    async createMessage(params: CreateMessageParams): Promise<LLMResponse> {
      const body: Record<string, any> = {
        contents: params.messages.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: partsFromContent(m.content),
        })),
        generationConfig: {
          maxOutputTokens: params.max_tokens,
          // Gemini 3.x Flash models "think" by default, and thinking tokens
          // are billed against maxOutputTokens. With ECHO's budgets the model
          // can burn the entire allowance on internal reasoning and return
          // `content: {}` with finishReason MAX_TOKENS — a 200 OK with no
          // answer, which reads as ECHO silently failing. ECHO's calls are
          // structured extraction, not open-ended reasoning, so thinking is
          // off by default. Set GEMINI_THINKING_BUDGET to re-enable it
          // (and raise max_tokens accordingly if you do).
          thinkingConfig: { thinkingBudget: Number(process.env.GEMINI_THINKING_BUDGET ?? 0) },
        },
      };

      if (params.system) body.systemInstruction = { parts: [{ text: params.system }] };

      if (params.tools?.length) {
        body.tools = toGeminiTools(params.tools);
        if (params.tool_choice?.type === "tool") {
          // "ANY" + an allow-list is Gemini's equivalent of Anthropic's forced
          // tool_choice — without it the model may answer in prose instead,
          // which would silently break every extraction.
          body.toolConfig = {
            functionCallingConfig: { mode: "ANY", allowedFunctionNames: [params.tool_choice.name] },
          };
        }
      }

      const res = await fetch(`${BASE}/models/${params.model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": opts.apiKey },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`Gemini ${res.status}: ${detail.slice(0, 300)}`);
      }

      const json = (await res.json()) as any;
      const candidate = json?.candidates?.[0];
      const parts = candidate?.content?.parts ?? [];
      const finishReason = candidate?.finishReason;

      // Fail loudly on a truncated/blocked response rather than returning
      // empty content. Silently-empty is the worst failure mode here: callers
      // would record "nothing found" for a message that was never actually
      // processed.
      if (!parts.length) {
        if (finishReason === "MAX_TOKENS") {
          const thoughts = json?.usageMetadata?.thoughtsTokenCount;
          throw new Error(
            `Gemini returned no content (finishReason=MAX_TOKENS${thoughts ? `, ${thoughts} tokens spent on thinking` : ""}). ` +
              `Raise max_tokens or lower GEMINI_THINKING_BUDGET.`,
          );
        }
        if (finishReason && finishReason !== "STOP") {
          throw new Error(`Gemini returned no content (finishReason=${finishReason}).`);
        }
      }

      const content: ContentBlock[] = [];
      let toolIndex = 0;
      for (const part of parts) {
        if (typeof part.text === "string" && part.text.length) {
          content.push({ type: "text", text: part.text });
        } else if (part.functionCall) {
          content.push({
            type: "tool_use",
            id: synthesizeToolId(part.functionCall.name, toolIndex++),
            name: part.functionCall.name,
            input: part.functionCall.args ?? {},
          });
        }
      }

      return { content };
    },
  };
}
