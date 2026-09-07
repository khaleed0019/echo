import type { ExtractionResult, Person } from "./types";
import { getPersonByName } from "./people";
import { registerWatch } from "./watches";
import {
  prioritizeMyDay,
  whatAmIForgetting,
  lifeTimeline,
  openLoops,
  whatChangedSince,
  decisionMemory,
  weeklyReview,
  contextPacket,
  cleanupCandidates,
} from "./queries";
import {
  formatPrioritizeMyDay,
  formatWhatAmIForgetting,
  formatTimeline,
  formatOpenLoops,
  formatWhatChanged,
  formatDecisionMemory,
  formatWeeklyReview,
  formatCleanup,
} from "./format";

export type Action =
  | { kind: "markdown"; markdown: string }
  | { kind: "card"; path: string }
  | { kind: "poll"; title: string; options: string[] }
  /** Sends `markdown` as text AND as a spoken voice note (see src/voice.ts).
   *  Falls back to text-only when voice mode isn't configured. */
  | { kind: "spoken"; markdown: string };

/**
 * The command surface: only text sent by the primary user, in their own DM
 * with ECHO, is treated as a command (see PRIMARY_USER_ADDRESS in .env). Every
 * other message ECHO sees — group chats it's in — is silently ingested as
 * context (src/ingest.ts) but never replied to live; that's the difference
 * between "personal agent" and "spammy bot in every group it's added to."
 */
/** Handled specially in index.ts (orb → edit()-in-place reveal), not through the generic dispatch below. */
export function isCatchMeUpCommand(text: string): boolean {
  return /^(echo,?\s*)?catch me up/i.test(text.trim());
}

export async function routeCommand(text: string): Promise<Action[] | null> {
  const t = text.trim();
  const strip = (m: RegExpMatchArray, i: number) => m[i]?.trim();

  if (/^(echo,?\s*)?prioritize my day/i.test(t)) {
    return [{ kind: "markdown", markdown: formatPrioritizeMyDay(prioritizeMyDay()) }];
  }

  if (/^(echo,?\s*)?what am i forgetting\??/i.test(t)) {
    return [{ kind: "markdown", markdown: formatWhatAmIForgetting(whatAmIForgetting()) }];
  }

  if (/^(echo,?\s*)?life\s*timeline/i.test(t)) {
    return [{ kind: "markdown", markdown: formatTimeline(lifeTimeline()) }];
  }

  if (/^(echo,?\s*)?open loops/i.test(t)) {
    return [{ kind: "markdown", markdown: formatOpenLoops(openLoops()) }];
  }

  const changedMatch = t.match(/^(?:echo,?\s*)?what changed(?:\s+since\s+(.+))?\??$/i);
  if (changedMatch) {
    const since = strip(changedMatch, 1);
    const sinceIso = since ? parseRoughDate(since) : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    return [{ kind: "markdown", markdown: formatWhatChanged(whatChangedSince(sinceIso)) }];
  }

  const decisionMatch = t.match(/^(?:echo,?\s*)?why did (?:we|you|i) decide (.+)\??$/i) ?? t.match(/^(?:echo,?\s*)?decisions? (?:about|on) (.+)$/i);
  if (decisionMatch) {
    const topic = strip(decisionMatch, 1);
    return [{ kind: "markdown", markdown: formatDecisionMemory(decisionMemory(topic), topic) }];
  }

  if (/^(echo,?\s*)?weekly review/i.test(t)) {
    return [{ kind: "markdown", markdown: formatWeeklyReview(weeklyReview()) }];
  }

  if (/^(echo,?\s*)?(clean ?up|one[- ]tap cleanup)/i.test(t)) {
    const candidates = cleanupCandidates();
    const total = candidates.overdueCommitments.length + candidates.staleQuestions.length;
    const actions: Action[] = [{ kind: "markdown", markdown: formatCleanup(candidates) }];
    if (total > 0) {
      actions.push({
        kind: "poll",
        title: "Mark these resolved?",
        options: [...candidates.overdueCommitments.map((c) => c.description.slice(0, 60)), ...candidates.staleQuestions.map((q) => q.question_text.slice(0, 60)), "None of these"].slice(0, 10),
      });
    }
    return actions;
  }

  if (/^(echo,?\s*)?(show( me)? the )?(knowledge )?graph/i.test(t)) {
    return [{ kind: "card", path: "/card/graph" }];
  }

  const contextMatch = t.match(/^(?:echo,?\s*)?context(?: packet)?(?: on| for)? (.+)$/i);
  if (contextMatch) {
    const name = strip(contextMatch, 1);
    const person = getPersonByName(name);
    if (!person) return [{ kind: "markdown", markdown: `I don't know anyone named "${name}" yet.` }];
    return [{ kind: "markdown", markdown: formatContextPacket(person, contextPacket(person.id)) }];
  }

  const watchMatch = t.match(/^(?:echo,?\s*)?when (\w+) replies?,?\s*(.+)$/i);
  if (watchMatch) {
    return null; // handled by index.ts with the requester's person_id — see handleWatchRegistration
  }

  return null;
}

export function isWatchRegistration(text: string): { name: string; instruction: string } | null {
  const m = text.trim().match(/^(?:echo,?\s*)?when (\w+) replies?,?\s*(.+)$/i);
  if (!m) return null;
  return { name: m[1]!, instruction: m[2]!.trim() };
}

// ---- Memory / privacy commands (need the resolved sender's person_id, so
// index.ts handles these directly rather than through routeCommand's pure
// dispatch — same reason watch registration is handled the same way) ----

export function isRememberCommand(text: string): string | null {
  const m = text.trim().match(/^(?:echo,?\s*)?remember that\s+(.+)$/i);
  return m ? m[1]!.trim() : null;
}

export function isWhatDoYouRememberCommand(text: string): boolean {
  return /^(?:echo,?\s*)?what do you remember(?: about me)?\??$/i.test(text.trim());
}

export function isPinMemoryCommand(text: string): string | null {
  const m = text.trim().match(/^(?:echo,?\s*)?pin (?:that\s+)?(.+)$/i);
  return m ? m[1]!.trim() : null;
}

export function isForgetConversationCommand(text: string): boolean {
  return /^(?:echo,?\s*)?forget this conversation\.?$/i.test(text.trim());
}

export function isForgetMemoryCommand(text: string): string | null {
  const m = text.trim().match(/^(?:echo,?\s*)?forget(?: that)?\s+(.+)$/i);
  return m ? m[1]!.trim() : null;
}

export function isDeleteEverythingCommand(text: string): boolean {
  return /^(?:echo,?\s*)?delete everything\.?$/i.test(text.trim());
}

export function isWhatHaveYouDoneCommand(text: string): boolean {
  return /^(?:echo,?\s*)?(what have you done\??|activity log)$/i.test(text.trim());
}

export function isRiskCheckCommand(text: string): string | null {
  // returns inline text if given ("is this a scam: <text>"), or "" to signal
  // "check the last message in this thread" — index.ts resolves the fallback.
  const m = text.trim().match(/^(?:echo,?\s*)?(?:is this (?:a )?scam|check this)\s*:?\s*(.*)$/i);
  return m ? m[1]!.trim() : null;
}

const REPLY_TONES = ["professional", "casual", "friendly", "short", "confident", "apologetic"] as const;
export function isReplyDraftCommand(text: string): { tone: (typeof REPLY_TONES)[number] } | null {
  const m = text.trim().match(/^(?:echo,?\s*)?(?:draft a |write a )?reply(?:\s+(professional|casual|friendly|short|confident|apologetic))?(?:\s+(?:tone|to this|to that))?\.?$/i);
  if (!m) return null;
  return { tone: (m[1] as (typeof REPLY_TONES)[number]) ?? "friendly" };
}

// ---- Search, autonomy, and privacy-center commands ----

export function isSearchCommand(text: string): string | null {
  const m = text.trim().match(/^(?:echo,?\s*)?search(?: for)?\s+(.+)$/i) ?? text.trim().match(/^(?:echo,?\s*)?when did (.+)$/i);
  return m ? m[0]! : null; // pass the whole question through — echoSearch wants the natural-language phrasing, not a stripped keyword
}

export function isSetAutonomyCommand(text: string): 1 | 2 | 3 | null {
  const m = text.trim().match(/^(?:echo,?\s*)?(?:set )?autonomy(?: level)?\s*(?:to)?\s*([123])\.?$/i);
  if (m) return Number(m[1]) as 1 | 2 | 3;
  if (/^(?:echo,?\s*)?(suggest only|be less autonomous)\.?$/i.test(text.trim())) return 1;
  if (/^(?:echo,?\s*)?ask before acting\.?$/i.test(text.trim())) return 2;
  if (/^(?:echo,?\s*)?(act automatically|be more autonomous)\.?$/i.test(text.trim())) return 3;
  return null;
}

export function isPauseCommand(text: string): boolean {
  return /^(?:echo,?\s*)?pause\.?$/i.test(text.trim());
}

export function isResumeCommand(text: string): boolean {
  return /^(?:echo,?\s*)?resume\.?$/i.test(text.trim());
}

export function isExportCommand(text: string): boolean {
  return /^(?:echo,?\s*)?export my data\.?$/i.test(text.trim());
}

/**
 * "speak <command>" / "say <command>" — runs any command but answers aloud,
 * so voice replies are reachable without recording a memo first (useful when
 * you're typing but want to listen, e.g. driving).
 */
export function isSpeakCommand(text: string): string | null {
  const m = text.trim().match(/^(?:echo,?\s*)?(?:speak|say)\s+(.+)$/i);
  return m ? m[1]!.trim() : null;
}

function parseRoughDate(input: string): string {
  const lower = input.toLowerCase();
  const now = Date.now();
  if (lower.includes("yesterday")) return new Date(now - 24 * 60 * 60 * 1000).toISOString();
  if (lower.includes("week")) return new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const parsed = Date.parse(input);
  return Number.isNaN(parsed) ? new Date(now - 24 * 60 * 60 * 1000).toISOString() : new Date(parsed).toISOString();
}

function formatContextPacket(person: Person, packet: ReturnType<typeof contextPacket>): string {
  const lines = [`**Context packet: ${person.name}**`];
  if (packet.commitments.length) {
    lines.push("\n**Commitments**\n" + packet.commitments.map((c) => `• ${c.description}`).join("\n"));
  }
  if (packet.decisions.length) {
    lines.push("\n**Decisions**\n" + packet.decisions.map((d) => `• ${d.decision_text}`).join("\n"));
  }
  if (packet.events.length) {
    lines.push("\n**Events**\n" + packet.events.map((e) => `• ${e.title}`).join("\n"));
  }
  if (packet.recentMessages.length) {
    lines.push(
      "\n**Recent**\n" + packet.recentMessages.slice(0, 5).map((m) => `• ${m.name ?? "?"}: ${m.text}`).join("\n"),
    );
  }
  return lines.join("\n");
}

/**
 * "A conversation is shared" — a pasted/forwarded block of text gets analyzed
 * for promises, deadlines, and opportunities and the finding is reflected
 * back, distinct from the silent background extraction every message gets.
 */
export function looksLikeSharedConversation(text: string): boolean {
  return text.length > 180 || text.split("\n").length >= 3;
}

export function formatConversationAnalysis(result: ExtractionResult): string | null {
  const lines: string[] = [];
  if (result.commitments.length) {
    lines.push("**Promise detected:**\n" + result.commitments.map((c) => `• ${c.owner === "me" ? "You" : "They"} committed: ${c.description}`).join("\n"));
  }
  const withDeadline = result.events.filter((e) => e.starts_at);
  if (withDeadline.length) {
    lines.push("**Deadline detected:**\n" + withDeadline.map((e) => `• ${e.title} — ${e.starts_at}`).join("\n"));
  }
  if (result.opportunities.length) {
    lines.push("**Opportunity detected:**\n" + result.opportunities.map((o) => `• ${o.description}`).join("\n"));
  }
  if (!lines.length) return null;
  return ["**I found something worth flagging:**", ...lines].join("\n\n");
}
