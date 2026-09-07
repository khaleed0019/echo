import { db } from "./db";
import { createMessage, MODEL } from "./llm";
import type { TextBlock } from "./llm";
import { getPersonByName, getPersonById, threadsForPerson } from "./people";
import type { Watch } from "./types";


export type RegisterWatchResult =
  | { ok: true; watch: Watch; threadTitle: string }
  | { ok: false; reason: "person_not_found" | "no_shared_thread" };

/**
 * "When <name> replies, <instruction>" only works for threads ECHO actually
 * shares with both people — it can't watch a private 1:1 it isn't part of.
 * That's a real constraint (see README), not a simplification: it picks the
 * most recently active thread the requester and the target both belong to.
 */
export function registerWatch(requesterPersonId: string, targetName: string, instruction: string): RegisterWatchResult {
  const target = getPersonByName(targetName);
  if (!target) return { ok: false, reason: "person_not_found" };

  const requesterThreads = new Set(threadsForPerson(requesterPersonId).map((t) => t.id));
  const shared = threadsForPerson(target.id).find((t) => requesterThreads.has(t.id));
  if (!shared) return { ok: false, reason: "no_shared_thread" };

  db.run(
    `INSERT INTO watches (requester_person_id, target_thread_id, target_person_id, instruction)
     VALUES (?, ?, ?, ?)`,
    [requesterPersonId, shared.id, target.id, instruction],
  );
  const watch = db.query<Watch, []>("SELECT * FROM watches ORDER BY id DESC LIMIT 1").get()!;
  return { ok: true, watch, threadTitle: shared.title };
}

export interface FiredWatch {
  requesterAddress: string;
  briefing: string;
}

/**
 * Call after ingesting any inbound message. Fires (and marks fired) every
 * pending watch whose target person just spoke in the watched thread —
 * this is what makes ECHO proactively message the requester from a
 * completely different conversation than the one the reply arrived in.
 */
export async function checkAndFireWatches(params: {
  threadId: string;
  senderPersonId: string | null;
  messageText: string;
  threadTitle: string;
}): Promise<FiredWatch[]> {
  if (!params.senderPersonId) return [];

  const pending = db
    .query<Watch, [string, string]>(
      `SELECT * FROM watches WHERE status = 'pending' AND target_thread_id = ?
         AND (target_person_id IS NULL OR target_person_id = ?)`,
    )
    .all(params.threadId, params.senderPersonId);

  const fired: FiredWatch[] = [];

  for (const watch of pending) {
    const sender = getPersonById(params.senderPersonId);
    const requester = getPersonById(watch.requester_person_id);
    if (!requester) continue;

    const summary = await summarizeReply({
      senderName: sender?.name ?? "Someone",
      threadTitle: params.threadTitle,
      message: params.messageText,
      instruction: watch.instruction,
    });

    db.run("UPDATE watches SET status = 'fired', fired_at = datetime('now') WHERE id = ?", [watch.id]);
    fired.push({ requesterAddress: requester.address, briefing: summary });
  }

  return fired;
}

async function summarizeReply(params: {
  senderName: string;
  threadTitle: string;
  message: string;
  instruction: string;
}): Promise<string> {
  const response = await createMessage({
    model: MODEL,
    max_tokens: 300,
    system:
      "You are ECHO, a personal assistant. The user asked you to watch a conversation and, when " +
      "the other person replied, summarize it and tell them what to do next. Be concise — 2-4 short " +
      `lines, formatted for an iMessage bubble: a one-line summary of what ${params.senderName} said, then a clear "Next: <action>" line.`,
    messages: [
      {
        role: "user",
        content:
          `Thread: ${params.threadTitle}\nYour instruction: "${params.instruction}"\n\n` +
          `${params.senderName} just replied: "${params.message}"`,
      },
    ],
  });

  const text = response.content.find((b): b is TextBlock => b.type === "text")?.text;
  return text ?? `${params.senderName} replied in ${params.threadTitle}: "${params.message}"`;
}
