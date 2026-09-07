// The Risk Agent and Reply Agent — kept separate from extract.ts (the
// Conversation/Extraction Agent) because they're invoked on-demand by an
// explicit command rather than run passively on every message.
import { createMessage, MODEL } from "./llm";
import type { ToolDefinition, TextBlock, ToolUseBlock } from "./llm";

// ---------------- Risk Agent ----------------

export interface RiskAssessment {
  risk_level: "low" | "medium" | "high";
  reasons: string[];
  what_to_verify: string[];
}

const RISK_TOOL: ToolDefinition = {
  name: "assess_risk",
  description: "Assess whether a forwarded message shows signs of being a scam, phishing attempt, or manipulation.",
  input_schema: {
    type: "object",
    properties: {
      risk_level: { type: "string", enum: ["low", "medium", "high"] },
      reasons: { type: "array", items: { type: "string" }, description: "Specific signals found — urgency manipulation, impersonation, suspicious payment requests, fake links, unusual language, etc. Empty if low risk." },
      what_to_verify: { type: "array", items: { type: "string" }, description: "Concrete things the user should check before acting." },
    },
    required: ["risk_level", "reasons", "what_to_verify"],
  },
};

/** Never claims certainty when evidence is thin — the tool schema forces an explainable, graded assessment rather than a bare "scam"/"safe" verdict. */
export async function assessRisk(messageText: string): Promise<RiskAssessment> {
  const response = await createMessage({
    model: MODEL,
    max_tokens: 500,
    system:
      "You help someone assess whether a message they received might be a scam, phishing, or manipulation " +
      "attempt. Be calibrated — most forwarded messages are low risk. Only flag medium/high risk with " +
      "concrete signals (urgency pressure, requests for payment/gift cards/crypto, impersonation of a known " +
      "contact or institution, suspicious links, generic greetings claiming personal knowledge). Never claim " +
      "certainty; frame findings as signals to verify, not proof.",
    tools: [RISK_TOOL],
    tool_choice: { type: "tool", name: "assess_risk" },
    messages: [{ role: "user", content: `Assess this message:\n\n"${messageText}"` }],
  });

  const block = response.content.find((b): b is ToolUseBlock => b.type === "tool_use" && b.name === "assess_risk");
  return (block?.input as RiskAssessment) ?? { risk_level: "low", reasons: [], what_to_verify: [] };
}

export function formatRiskAssessment(r: RiskAssessment): string {
  const badge = { low: "🟢 LOW", medium: "🟡 MEDIUM", high: "🔴 HIGH" }[r.risk_level];
  const lines = [`**Risk assessment: ${badge}**`];
  if (r.reasons.length) lines.push("\n**Signals found:**\n" + r.reasons.map((x) => `• ${x}`).join("\n"));
  if (r.what_to_verify.length) lines.push("\n**Verify before acting:**\n" + r.what_to_verify.map((x) => `• ${x}`).join("\n"));
  if (r.risk_level === "low" && !r.reasons.length) lines.push("\nNothing suspicious jumped out, but that's not a guarantee — stay cautious with money or personal info regardless.");
  return lines.join("\n");
}

// ---------------- Reply Agent ----------------

export type ReplyTone = "professional" | "casual" | "friendly" | "short" | "confident" | "apologetic";

/**
 * ECHO has no way to send a message FROM your personal number — it only has
 * its own line. This drafts options; you copy the one you like into your
 * own conversation. That's a real constraint, stated plainly rather than
 * implied away.
 */
export async function draftReplies(params: { context: string; tone: ReplyTone; instruction?: string }): Promise<string[]> {
  const response = await createMessage({
    model: MODEL,
    max_tokens: 400,
    system:
      `Draft exactly 3 short reply options in a ${params.tone} tone for the message/context given. ` +
      `${params.instruction ? `Additional instruction: ${params.instruction}. ` : ""}` +
      `Each option on its own line, prefixed "1. ", "2. ", "3. ". No preamble, just the three drafts.`,
    messages: [{ role: "user", content: params.context }],
  });

  const text = response.content.find((b): b is TextBlock => b.type === "text")?.text ?? "";
  const drafts = text
    .split(/\n(?=\d+\.\s)/)
    .map((l) => l.replace(/^\d+\.\s*/, "").trim())
    .filter(Boolean);
  return drafts.length ? drafts : [text.trim()];
}

export function formatDrafts(drafts: string[], tone: ReplyTone): string {
  return [
    `**Reply drafts (${tone}):**`,
    ...drafts.map((d, i) => `${i + 1}. ${d}`),
    "\n_I can only draft these — send from your own number, I don't have access to it._",
  ].join("\n");
}
