import { db } from "./db";
import type { ContentType, ExtractionResult } from "./types";
import { extractFromText } from "./extract";

export function alreadyProcessed(messageId: string): boolean {
  return !!db.query("SELECT 1 FROM processed_message_ids WHERE message_id = ?").get(messageId);
}

export function markProcessed(messageId: string) {
  db.run("INSERT OR IGNORE INTO processed_message_ids (message_id) VALUES (?)", [messageId]);
}

export function recordMessage(params: {
  id: string;
  threadId: string;
  senderPersonId: string | null;
  direction: "inbound" | "outbound";
  contentType: ContentType;
  text: string | null;
  createdAt?: string;
}) {
  db.run(
    `INSERT INTO messages (id, thread_id, sender_person_id, direction, content_type, text, created_at)
     VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))
     ON CONFLICT(id) DO NOTHING`,
    [
      params.id,
      params.threadId,
      params.senderPersonId,
      params.direction,
      params.contentType,
      params.text,
      params.createdAt ?? null,
    ],
  );
}

function recentContextFor(threadId: string, beforeMessageId?: string): string {
  const rows = db
    .query<{ text: string | null; name: string | null }, [string]>(
      `SELECT m.text, p.name FROM messages m
       LEFT JOIN people p ON p.id = m.sender_person_id
       WHERE m.thread_id = ? AND m.content_type = 'text' AND m.text IS NOT NULL
       ORDER BY m.created_at DESC LIMIT 6`,
    )
    .all(threadId);
  return rows
    .reverse()
    .map((r) => `${r.name ?? "?"}: ${r.text}`)
    .join("\n");
}

/**
 * The extraction engine's write side: runs the LLM extraction on a text
 * message and persists whatever it finds. Called for every inbound text
 * message ECHO sees (real or seeded) — this is the continuous ingestion
 * that every "view" (catch me up, life timeline, etc.) reads back from.
 */
export async function ingestTextMessage(params: {
  messageId: string;
  threadId: string;
  threadTitle: string;
  senderName: string;
  senderPersonId: string;
  text: string;
  now?: string;
}): Promise<ExtractionResult> {
  const now = params.now ?? new Date().toISOString();
  const result = await extractFromText({
    senderName: params.senderName,
    threadTitle: params.threadTitle,
    text: params.text,
    recentContext: recentContextFor(params.threadId),
    now,
  });

  for (const c of result.commitments) {
    // "me" is a sentinel meaning "the primary user" (checked as `owner ===
    // 'me'` everywhere — see queries.ts/format.ts), not a person_id, so it's
    // always safe to store literally. "them" resolves to whoever actually
    // sent this message — correct for the common case (someone else
    // messaging, promising something). Known edge case, documented in the
    // README: if the primary user's own message somehow gets tagged "them"
    // (the extractor misfiring), this attributes it back to the primary
    // user rather than leaving it unattributed, since the owner column is
    // NOT NULL and there's no third-party name resolution here yet.
    const owner = c.owner === "me" ? "me" : params.senderPersonId;
    db.run(
      `INSERT INTO commitments (message_id, thread_id, owner, description, due_at, source_excerpt, urgency, urgency_reason, confidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [params.messageId, params.threadId, owner, c.description, c.due_at, params.text, c.urgency, c.urgency_reason, c.confidence],
    );
  }
  for (const e of result.events) {
    db.run(
      `INSERT INTO events (message_id, thread_id, title, starts_at, location, source, importance, importance_reason)
       VALUES (?, ?, ?, ?, ?, 'text', ?, ?)`,
      [params.messageId, params.threadId, e.title, e.starts_at, e.location, e.importance, e.importance_reason],
    );
  }
  for (const d of result.decisions) {
    db.run(
      `INSERT INTO decisions (topic, decision_text, rationale, thread_id) VALUES (?, ?, ?, ?)`,
      [d.topic, d.decision_text, d.rationale, params.threadId],
    );
  }
  for (const q of result.open_questions) {
    db.run(`INSERT INTO open_questions (question_text, thread_id, asked_by) VALUES (?, ?, ?)`, [
      q.question_text,
      params.threadId,
      params.senderPersonId,
    ]);
  }
  for (const o of result.opportunities) {
    db.run(`INSERT INTO opportunities (message_id, thread_id, description, confidence, confidence_reason) VALUES (?, ?, ?, ?, ?)`, [
      params.messageId,
      params.threadId,
      o.description,
      o.confidence,
      o.confidence_reason,
    ]);
  }

  return result;
}
