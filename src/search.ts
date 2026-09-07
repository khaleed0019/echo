// "ECHO Search" — natural-language questions answered from the same tables
// every other feature reads. This is deliberately NOT vector/semantic
// search (no embeddings pipeline, no vector DB — out of scope for a SQLite
// hackathon build, see README). Instead it's a real multi-turn tool-use
// loop: Claude gets a keyword-search tool over each table, decides what to
// look up (possibly several times), and synthesizes an answer with the
// actual rows as its source — genuinely agentic retrieval, just not
// semantic embedding similarity.
import { db } from "./db";
import { createMessage, MODEL } from "./llm";
import type { LLMMessage, ToolDefinition, TextBlock, ToolUseBlock } from "./llm";

const SEARCH_TOOL: ToolDefinition = {
  name: "search_life_context",
  description: "Keyword-search over the user's captured life context. Call it as many times as needed with different keywords/tables before answering.",
  input_schema: {
    type: "object",
    properties: {
      table: { type: "string", enum: ["messages", "commitments", "events", "decisions", "open_questions"] },
      keyword: { type: "string" },
    },
    required: ["table", "keyword"],
  },
};

function runSearch(table: string, keyword: string): unknown[] {
  const like = `%${keyword}%`;
  switch (table) {
    case "messages":
      return db
        .query<{ text: string; created_at: string; sender: string | null }, [string]>(
          `SELECT m.text, m.created_at, p.name as sender FROM messages m LEFT JOIN people p ON p.id = m.sender_person_id
           WHERE m.text LIKE ? ORDER BY m.created_at DESC LIMIT 8`,
        )
        .all(like);
    case "commitments":
      return db.query("SELECT description, due_at, status, created_at FROM commitments WHERE description LIKE ? ORDER BY created_at DESC LIMIT 8").all(like);
    case "events":
      return db.query("SELECT title, starts_at, location, created_at FROM events WHERE title LIKE ? ORDER BY created_at DESC LIMIT 8").all(like);
    case "decisions":
      return db.query("SELECT topic, decision_text, rationale, created_at FROM decisions WHERE topic LIKE ? OR decision_text LIKE ? ORDER BY created_at DESC LIMIT 8").all(like, like);
    case "open_questions":
      return db.query("SELECT question_text, status, created_at FROM open_questions WHERE question_text LIKE ? ORDER BY created_at DESC LIMIT 8").all(like);
    default:
      return [];
  }
}

export async function echoSearch(question: string): Promise<string> {
  const messages: LLMMessage[] = [{ role: "user", content: question }];

  for (let turn = 0; turn < 4; turn++) {
    const response = await createMessage({
      model: MODEL,
      max_tokens: 500,
      system:
        "You answer questions about the user's captured commitments, events, decisions, questions, and " +
        "messages using search_life_context — call it with a few different keywords before answering if the " +
        "first search comes up empty. When you have enough to answer, respond with plain text: a direct " +
        "answer, then a short 'Source:' line pointing at what you found. If nothing relevant turns up after " +
        "a couple of tries, say so plainly rather than guessing.",
      tools: [SEARCH_TOOL],
      messages,
    });

    const toolUses = response.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
    if (!toolUses.length) {
      return response.content.find((b): b is TextBlock => b.type === "text")?.text ?? "I couldn't find anything relevant.";
    }

    messages.push({ role: "assistant", content: response.content });
    messages.push({
      role: "user",
      content: toolUses.map((t) => ({
        type: "tool_result" as const,
        tool_use_id: t.id,
        content: JSON.stringify(runSearch((t.input as any).table, (t.input as any).keyword)),
      })),
    });
  }

  return "I searched but couldn't pin down a clear answer — try rephrasing.";
}
