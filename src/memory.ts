import { db } from "./db";

export interface Memory {
  id: number;
  owner_person_id: string;
  category: string;
  content: string;
  pinned: number;
  created_at: string;
}

const CATEGORIES = [
  "personal", "relationships", "work", "projects", "preferences",
  "important dates", "goals", "commitments", "contacts", "ideas",
] as const;

/**
 * The Memory Agent's write path — only ever called from an explicit
 * "remember that ..." command (see router.ts), never from passive extraction.
 * Category is guessed cheaply by keyword rather than a full LLM call, since
 * getting it slightly wrong is low-stakes and free beats a round trip.
 */
export function rememberFor(ownerPersonId: string, content: string): Memory {
  const category = guessCategory(content);
  db.run("INSERT INTO memories (owner_person_id, category, content) VALUES (?, ?, ?)", [ownerPersonId, category, content]);
  return db.query<Memory, []>("SELECT * FROM memories ORDER BY id DESC LIMIT 1").get()!;
}

// Keyword → category. Ordered most-specific first: a birthday is an
// "important date" even though it also mentions a person. Cheap on purpose —
// a wrong guess here is low-stakes and the alternative is an LLM round trip
// on every "remember that ...".
const CATEGORY_PATTERNS: Array<[RegExp, string]> = [
  [/\b(birthday|anniversary|due date|deadline|due on|expires?)\b/, "important dates"],
  [/\b(prefer|prefers|hate|hates|favou?rite|likes to|allergic)\b/, "preferences"],
  [/\b(is my|my (wife|husband|partner|mom|mother|dad|father|sister|brother|friend|boss|manager|designer|client|colleague|coworker|landlord|doctor))\b/, "relationships"],
  [/\b(project|launch|sprint|repo|codebase|milestone)\b/, "projects"],
  [/\b(goal|want to|aiming to|plan to|hoping to)\b/, "goals"],
  [/\b(rent|salary|invoice|budget|paid|owes?|cost)\b/, "finances"],
  [/\b(flight|hotel|trip|travel|visa|passport)\b/, "travel"],
  [/\b(idea|concept|thinking about building)\b/, "ideas"],
  [/\b(phone|email|address|contact)\b/, "contacts"],
  [/\b(work|job|office|meeting|standup)\b/, "work"],
];

function guessCategory(content: string): string {
  const lower = content.toLowerCase();
  for (const [pattern, category] of CATEGORY_PATTERNS) {
    if (pattern.test(lower)) return category;
  }
  // Fall back to a literal category-name mention ("remember that this is a work thing")
  for (const c of CATEGORIES) {
    if (lower.includes(c)) return c;
  }
  return "general";
}

export function listMemories(ownerPersonId: string): Memory[] {
  return db
    .query<Memory, [string]>("SELECT * FROM memories WHERE owner_person_id = ? ORDER BY pinned DESC, created_at DESC")
    .all(ownerPersonId);
}

export function pinMemory(ownerPersonId: string, matchText: string): boolean {
  const row = db
    .query<{ id: number }, [string, string]>("SELECT id FROM memories WHERE owner_person_id = ? AND content LIKE ? LIMIT 1")
    .get(ownerPersonId, `%${matchText}%`);
  if (!row) return false;
  db.run("UPDATE memories SET pinned = 1 WHERE id = ?", [row.id]);
  return true;
}

export function forgetMemory(ownerPersonId: string, matchText: string): boolean {
  const result = db.run("DELETE FROM memories WHERE owner_person_id = ? AND content LIKE ?", [ownerPersonId, `%${matchText}%`]);
  return result.changes > 0;
}

/** "Forget this conversation" — deletes everything derived from one thread, for the privacy center. */
export function forgetThread(threadId: string) {
  db.run("DELETE FROM commitments WHERE thread_id = ?", [threadId]);
  db.run("DELETE FROM events WHERE thread_id = ?", [threadId]);
  db.run("DELETE FROM decisions WHERE thread_id = ?", [threadId]);
  db.run("DELETE FROM open_questions WHERE thread_id = ?", [threadId]);
  db.run("DELETE FROM messages WHERE thread_id = ?", [threadId]);
}

/** "Delete everything" — wipes one person's memories and everything they own. Does not touch other people's data. */
export function forgetEverythingFor(personId: string) {
  db.run("DELETE FROM memories WHERE owner_person_id = ?", [personId]);
  db.run("DELETE FROM commitments WHERE owner = ?", [personId]);
  db.run("DELETE FROM watches WHERE requester_person_id = ?", [personId]);
}

export function formatMemories(memories: Memory[]): string {
  if (!memories.length) return "I'm not holding onto anything for you yet — try \"remember that ...\"";
  const grouped = new Map<string, Memory[]>();
  for (const m of memories) {
    if (!grouped.has(m.category)) grouped.set(m.category, []);
    grouped.get(m.category)!.push(m);
  }
  const lines = ["**What I remember about you:**"];
  for (const [category, items] of grouped) {
    lines.push(`\n**${category[0]!.toUpperCase()}${category.slice(1)}**`);
    lines.push(items.map((m) => `• ${m.pinned ? "📌 " : ""}${m.content}`).join("\n"));
  }
  return lines.join("\n");
}
