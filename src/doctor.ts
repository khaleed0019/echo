// `bun run doctor` — checks that whatever LLM backend you configured actually
// supports the three things ECHO depends on, before you find out mid-demo.
//
// Tool use and vision support vary a lot between providers and gateways, and
// ECHO is built on both. A backend that silently drops tool calls doesn't
// error — it just captures nothing from your messages, which looks like ECHO
// being broken rather than the backend being wrong.
import {
  createMessage,
  MODEL,
  EXTRACTION_MODEL,
  PROVIDER,
  llmBackendLabel,
  baseUrlCameFromShell,
  hasCredentials,
  authStyle,
  credentialHint,
} from "./llm";
import type { TextBlock, ToolUseBlock } from "./llm";

const PASS = "  PASS";
const FAIL = "  FAIL";
let lastError = "";

function report(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? PASS : FAIL}  ${name}${detail ? ` — ${detail}` : ""}`);
}

// A 1x1 red PNG. Enough to prove the vision path accepts image blocks; the
// model isn't expected to find an event in it.
const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function checkText(): Promise<boolean> {
  try {
    const r = await createMessage({
      model: MODEL,
      max_tokens: 20,
      messages: [{ role: "user", content: "Reply with exactly: OK" }],
    });
    const text = r.content.find((b): b is TextBlock => b.type === "text")?.text ?? "";
    report("Text completion", text.length > 0, `got "${text.trim().slice(0, 30)}"`);
    return text.length > 0;
  } catch (err) {
    lastError = (err as Error).message;
    report("Text completion", false, lastError.slice(0, 140));
    return false;
  }
}

/** Uses the same forced-tool pattern and the same union-typed / bounded schema
 *  shapes ECHO's real extraction tools use, so a provider that chokes on those
 *  fails here rather than silently in production. */
async function checkToolUse(): Promise<boolean> {
  try {
    const r = await createMessage({
      model: EXTRACTION_MODEL,
      max_tokens: 300,
      tools: [
        {
          name: "record_test",
          description: "Record a test value.",
          input_schema: {
            type: "object",
            properties: {
              value: { type: "string" },
              score: { type: "integer", minimum: 1, maximum: 5, description: "any number 1-5" },
              optional_date: { type: ["string", "null"], description: "ISO 8601 or null" },
            },
            required: ["value", "score", "optional_date"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "record_test" },
      messages: [{ role: "user", content: "Call record_test with value 'hello', score 3, optional_date null." }],
    });
    const block = r.content.find((b): b is ToolUseBlock => b.type === "tool_use");
    report(
      "Tool use (forced, ECHO-shaped schema)",
      Boolean(block),
      block ? `input=${JSON.stringify(block.input)}` : "no tool_use block returned",
    );
    return Boolean(block);
  } catch (err) {
    report("Tool use (forced, ECHO-shaped schema)", false, (err as Error).message.slice(0, 140));
    return false;
  }
}

async function checkVision(): Promise<boolean> {
  try {
    const r = await createMessage({
      model: MODEL,
      max_tokens: 50,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/png", data: TINY_PNG } },
            { type: "text", text: "What colour is this image? One word." },
          ],
        },
      ],
    });
    const text = r.content.find((b): b is TextBlock => b.type === "text")?.text ?? "";
    report("Vision (image input)", text.length > 0, `got "${text.trim().slice(0, 30)}"`);
    return text.length > 0;
  } catch (err) {
    report("Vision (image input)", false, (err as Error).message.slice(0, 140));
    return false;
  }
}

async function main() {
  console.log(`\nECHO doctor`);
  console.log(`  provider: ${PROVIDER}`);
  console.log(`  backend:  ${llmBackendLabel()}`);
  console.log(`  model:    ${MODEL}${EXTRACTION_MODEL !== MODEL ? `  (extraction: ${EXTRACTION_MODEL})` : ""}`);
  console.log(`  auth:     ${authStyle()}`);
  if (baseUrlCameFromShell()) {
    console.log(`\n  Note: ANTHROPIC_BASE_URL is set in your shell environment, which`);
    console.log(`  overrides a blank value in .env. If that's not what you want, unset it`);
    console.log(`  in the shell — editing .env alone won't clear it.`);
  }
  console.log("");

  if (!hasCredentials()) {
    console.error(`  No credentials for provider "${PROVIDER}".`);
    console.error(`  ${credentialHint()}\n`);
    process.exit(1);
  }

  const textOk = await checkText();
  const toolsOk = await checkToolUse();
  const visionOk = await checkVision();

  console.log("");
  if (textOk && toolsOk && visionOk) {
    console.log("  All good — every ECHO feature will work on this backend.\n");
    process.exit(0);
  }

  console.log("  What breaks with these results:");
  if (!textOk) {
    // If plain text fails, the other two failures are the same root cause —
    // don't pad the output with three restatements of one problem. Capacity
    // errors get their own message: blaming the model name for a 503 sent me
    // chasing the wrong thing once already.
    if (lastError.includes("503") || lastError.includes("high demand") || lastError.includes("overloaded")) {
      console.log(`    - Nothing is misconfigured. "${MODEL}" is temporarily overloaded`);
      console.log("      on the provider's side. Retry, or switch to a less popular model.");
    } else if (lastError.includes("429") || lastError.toLowerCase().includes("quota")) {
      console.log("    - Rate limit / quota exhausted. Wait, or use a -lite model (higher RPM).");
    } else {
      console.log("    - Everything. The backend is unreachable, the key is rejected, or the");
      console.log(`      model name "${MODEL}" isn't recognised by this backend.`);
    }
  } else {
    if (!toolsOk) {
      console.log("    - The extraction engine: no commitments, events, decisions, questions or");
      console.log("      opportunities will be captured from any message. Also breaks risk checks");
      console.log("      and search. This is the one that makes ECHO look broken rather than error.");
    }
    if (!visionOk) console.log("    - Screenshot -> event only. Everything else still works.");
  }
  console.log("\n  Next steps: try a different model name (providers rename models often),");
  console.log("  or switch provider with LLM_PROVIDER=gemini | anthropic.");
  process.exit(1);
}

main();
