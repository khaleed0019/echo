import Anthropic from "@anthropic-ai/sdk";
import type { CreateMessageParams, LLMBackend, LLMResponse, ContentBlock } from "./types";

export function createAnthropicBackend(opts: {
  apiKey?: string;
  authToken?: string;
  baseURL?: string;
}): LLMBackend {
  const client = new Anthropic({
    // `apiKey: null` is load-bearing, not tidiness: the SDK falls back to
    // process.env.ANTHROPIC_API_KEY when the option is absent, and a *blank*
    // ANTHROPIC_API_KEY= line in .env then makes auth resolution fail at
    // request time with "Could not resolve authentication method" — even
    // though authToken is set correctly. Passing null suppresses that fallback.
    ...(opts.authToken ? { authToken: opts.authToken, apiKey: null } : { apiKey: opts.apiKey }),
    ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
  });

  return {
    name: "anthropic",
    async createMessage(params: CreateMessageParams): Promise<LLMResponse> {
      const res = await client.messages.create({
        model: params.model,
        max_tokens: params.max_tokens,
        ...(params.system ? { system: params.system } : {}),
        ...(params.tools ? { tools: params.tools as Anthropic.Tool[] } : {}),
        ...(params.tool_choice && params.tool_choice.type === "tool"
          ? { tool_choice: { type: "tool" as const, name: params.tool_choice.name } }
          : {}),
        messages: params.messages as Anthropic.MessageParam[],
      });

      const content: ContentBlock[] = [];
      for (const block of res.content) {
        if (block.type === "text") content.push({ type: "text", text: block.text });
        else if (block.type === "tool_use") {
          content.push({ type: "tool_use", id: block.id, name: block.name, input: block.input });
        }
      }
      return { content };
    },
  };
}
