import { db } from "./db";
import type { Commitment, Decision, LifeEvent, OpenQuestion, Opportunity } from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

// ---------- Catch Me Up ----------

export interface CatchMeUp {
  urgent: Commitment[];
  important: { decisions: Decision[]; questions: OpenQuestion[] };
  upcoming: LifeEvent[];
  commitments: { mine: Commitment[]; theirs: Commitment[] };
  followUps: OpenQuestion[];
}

export function catchMeUp(): CatchMeUp {
  const urgent = db
    .query<Commitment, []>(
      `SELECT * FROM commitments
       WHERE status = 'open' AND owner = 'me'
         AND (due_at IS NOT NULL AND due_at <= datetime('now', '+1 day'))
       ORDER BY due_at ASC`,
    )
    .all();

  const decisions = db
    .query<Decision, []>(`SELECT * FROM decisions WHERE created_at >= datetime('now','-3 days') ORDER BY created_at DESC`)
    .all();

  const questions = db
    .query<OpenQuestion, []>(`SELECT * FROM open_questions WHERE status = 'open' ORDER BY created_at DESC LIMIT 5`)
    .all();

  const upcoming = db
    .query<LifeEvent, []>(
      `SELECT * FROM events WHERE starts_at IS NOT NULL AND starts_at >= datetime('now') ORDER BY starts_at ASC LIMIT 5`,
    )
    .all();

  const mine = db
    .query<Commitment, []>(`SELECT * FROM commitments WHERE status = 'open' AND owner = 'me' ORDER BY due_at IS NULL, due_at ASC`)
    .all();
  const theirs = db
    .query<Commitment, []>(`SELECT * FROM commitments WHERE status = 'open' AND owner != 'me' ORDER BY due_at IS NULL, due_at ASC`)
    .all();

  const followUps = db
    .query<OpenQuestion, []>(`SELECT * FROM open_questions WHERE status = 'open' ORDER BY created_at ASC`)
    .all();

  return { urgent, important: { decisions, questions }, upcoming, commitments: { mine, theirs }, followUps };
}

// ---------- Prioritize My Day ----------

export function prioritizeMyDay() {
  const todayEvents = db
    .query<LifeEvent, []>(
      `SELECT * FROM events WHERE starts_at IS NOT NULL
         AND date(starts_at) = date('now') ORDER BY starts_at ASC`,
    )
    .all();

  const dueToday = db
    .query<Commitment, []>(
      `SELECT * FROM commitments WHERE status = 'open' AND owner = 'me'
         AND due_at IS NOT NULL AND date(due_at) <= date('now')
       ORDER BY due_at ASC`,
    )
    .all();

  return { todayEvents, dueToday };
}

// ---------- What Am I Forgetting ----------

export function whatAmIForgetting() {
  const staleCommitments = db
    .query<Commitment, []>(
      `SELECT * FROM commitments WHERE status = 'open'
         AND (
           (due_at IS NOT NULL AND due_at < datetime('now'))
           OR (due_at IS NULL AND created_at < datetime('now', '-3 days'))
         )
       ORDER BY due_at IS NULL, due_at ASC`,
    )
    .all();

  const staleQuestions = db
    .query<OpenQuestion, []>(
      `SELECT * FROM open_questions WHERE status = 'open' AND created_at < datetime('now', '-2 days')
       ORDER BY created_at ASC`,
    )
    .all();

  return { staleCommitments, staleQuestions };
}

// ---------- Life Timeline ----------

export interface TimelineItem {
  kind: "commitment" | "event" | "decision" | "question";
  label: string;
  at: string;
  threadId: string | null;
}

export function lifeTimeline(limit = 20): TimelineItem[] {
  const items: TimelineItem[] = [];

  for (const c of db.query<Commitment, []>("SELECT * FROM commitments ORDER BY created_at DESC LIMIT 50").all()) {
    items.push({ kind: "commitment", label: `${c.owner === "me" ? "You" : "They"} committed: ${c.description}`, at: c.created_at, threadId: c.thread_id });
  }
  for (const e of db.query<LifeEvent, []>("SELECT * FROM events ORDER BY created_at DESC LIMIT 50").all()) {
    // Sorted by when it was *captured*, not when it happens — this is a
    // retrospective journal ("what did I learn/commit to and when"), not a
    // schedule. Upcoming events belong in Catch Me Up / Prioritize My Day.
    const when = e.starts_at ? ` (scheduled ${e.starts_at.slice(0, 10)})` : "";
    items.push({ kind: "event", label: `Event: ${e.title}${when}`, at: e.created_at, threadId: e.thread_id });
  }
  for (const d of db.query<Decision, []>("SELECT * FROM decisions ORDER BY created_at DESC LIMIT 50").all()) {
    items.push({ kind: "decision", label: `Decided: ${d.decision_text}`, at: d.created_at, threadId: d.thread_id });
  }
  for (const q of db.query<OpenQuestion, []>("SELECT * FROM open_questions ORDER BY created_at DESC LIMIT 50").all()) {
    items.push({ kind: "question", label: `Asked: ${q.question_text}`, at: q.created_at, threadId: q.thread_id });
  }

  return items.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit);
}

// ---------- Open Loops ----------

export function openLoops() {
  const commitments = db.query<Commitment, []>("SELECT * FROM commitments WHERE status = 'open' ORDER BY due_at IS NULL, due_at ASC").all();
  const questions = db.query<OpenQuestion, []>("SELECT * FROM open_questions WHERE status = 'open' ORDER BY created_at ASC").all();
  return { commitments, questions };
}

// ---------- What Changed ----------

export function whatChangedSince(sinceIso: string) {
  const newCommitments = db.query<Commitment, [string]>("SELECT * FROM commitments WHERE created_at >= ?").all(sinceIso);
  const resolvedCommitments = db.query<Commitment, [string]>("SELECT * FROM commitments WHERE resolved_at >= ?").all(sinceIso);
  const newEvents = db.query<LifeEvent, [string]>("SELECT * FROM events WHERE created_at >= ?").all(sinceIso);
  const newDecisions = db.query<Decision, [string]>("SELECT * FROM decisions WHERE created_at >= ?").all(sinceIso);
  const answeredQuestions = db.query<OpenQuestion, [string]>("SELECT * FROM open_questions WHERE answered_at >= ?").all(sinceIso);
  return { newCommitments, resolvedCommitments, newEvents, newDecisions, answeredQuestions };
}

// ---------- Decision Memory ----------

export function decisionMemory(keyword: string): Decision[] {
  const like = `%${keyword}%`;
  return db
    .query<Decision, [string, string]>(
      `SELECT * FROM decisions WHERE topic LIKE ? OR decision_text LIKE ? ORDER BY created_at DESC`,
    )
    .all(like, like);
}

// ---------- Weekly Review ----------

export function weeklyReview() {
  const completed = db.query<Commitment, []>("SELECT * FROM commitments WHERE status = 'done' AND resolved_at >= datetime('now','-7 days')").all();
  const stillOpen = db.query<Commitment, []>("SELECT * FROM commitments WHERE status = 'open'").all();
  const overdue = db.query<Commitment, []>("SELECT * FROM commitments WHERE status = 'open' AND due_at IS NOT NULL AND due_at < datetime('now')").all();
  const decisionsMade = db.query<Decision, []>("SELECT * FROM decisions WHERE created_at >= datetime('now','-7 days')").all();
  const nextWeekEvents = db
    .query<LifeEvent, []>("SELECT * FROM events WHERE starts_at BETWEEN datetime('now') AND datetime('now','+7 days') ORDER BY starts_at ASC")
    .all();

  const needsAttention = db
    .query<{ name: string; count: number }, []>(
      `SELECT p.name as name, COUNT(*) as count FROM commitments c
       JOIN people p ON p.id = c.owner
       WHERE c.status = 'open' AND c.owner != 'me'
       GROUP BY c.owner ORDER BY count DESC`,
    )
    .all();

  return { completed, stillOpen, overdue, decisionsMade, nextWeekEvents, needsAttention };
}

// ---------- Context Packet ----------

export function contextPacket(personId: string) {
  const commitments = db
    .query<Commitment, [string, string]>(
      `SELECT * FROM commitments WHERE thread_id IN (SELECT thread_id FROM thread_members WHERE person_id = ?) OR owner = ?`,
    )
    .all(personId, personId);
  const decisions = db
    .query<Decision, [string]>(`SELECT * FROM decisions WHERE thread_id IN (SELECT thread_id FROM thread_members WHERE person_id = ?)`)
    .all(personId);
  const events = db
    .query<LifeEvent, [string]>(`SELECT * FROM events WHERE thread_id IN (SELECT thread_id FROM thread_members WHERE person_id = ?)`)
    .all(personId);
  const recentMessages = db
    .query<{ text: string | null; created_at: string; name: string | null }, [string]>(
      `SELECT m.text, m.created_at, p.name FROM messages m
       LEFT JOIN people p ON p.id = m.sender_person_id
       WHERE m.thread_id IN (SELECT thread_id FROM thread_members WHERE person_id = ?)
       ORDER BY m.created_at DESC LIMIT 8`,
    )
    .all(personId);

  return { commitments, decisions, events, recentMessages };
}

// ---------- One-Tap Cleanup ----------

export function cleanupCandidates() {
  const overdueCommitments = db
    .query<Commitment, []>(
      `SELECT * FROM commitments WHERE status = 'open' AND due_at IS NOT NULL AND due_at < datetime('now', '-2 days')`,
    )
    .all();
  const staleQuestions = db
    .query<OpenQuestion, []>(`SELECT * FROM open_questions WHERE status = 'open' AND created_at < datetime('now', '-5 days')`)
    .all();
  return { overdueCommitments, staleQuestions };
}

// ---------- Knowledge Graph ----------

export interface GraphNode {
  id: string;
  label: string;
  type: "person" | "thread" | "commitment" | "event" | "decision";
}
export interface GraphEdge {
  source: string;
  target: string;
}

export function knowledgeGraph(): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  for (const p of db.query<{ id: string; name: string }, []>("SELECT id, name FROM people").all()) {
    nodes.push({ id: p.id, label: p.name, type: "person" });
  }
  for (const t of db.query<{ id: string; title: string }, []>("SELECT id, title FROM threads").all()) {
    nodes.push({ id: t.id, label: t.title, type: "thread" });
  }
  for (const m of db.query<{ thread_id: string; person_id: string }, []>("SELECT thread_id, person_id FROM thread_members").all()) {
    edges.push({ source: m.person_id, target: m.thread_id });
  }
  for (const c of db.query<{ id: number; thread_id: string; description: string; status: string }, []>("SELECT id, thread_id, description, status FROM commitments WHERE status = 'open' LIMIT 25").all()) {
    const id = `commitment_${c.id}`;
    nodes.push({ id, label: c.description.slice(0, 40), type: "commitment" });
    edges.push({ source: c.thread_id, target: id });
  }
  for (const e of db.query<{ id: number; thread_id: string | null; title: string }, []>("SELECT id, thread_id, title FROM events LIMIT 25").all()) {
    const id = `event_${e.id}`;
    nodes.push({ id, label: e.title.slice(0, 40), type: "event" });
    if (e.thread_id) edges.push({ source: e.thread_id, target: id });
  }
  for (const d of db.query<{ id: number; thread_id: string; topic: string }, []>("SELECT id, thread_id, topic FROM decisions LIMIT 25").all()) {
    const id = `decision_${d.id}`;
    nodes.push({ id, label: d.topic.slice(0, 40), type: "decision" });
    edges.push({ source: d.thread_id, target: id });
  }

  return { nodes, edges };
}

// ---------- Pending poll confirmations ----------
// See db.ts for why these exist: a poll_option reply doesn't carry back a
// handle to what prompted it, so we stash it here between "poll sent" and
// "poll answered".

export function stagePendingCleanup(requesterPersonId: string, candidates: ReturnType<typeof cleanupCandidates>) {
  db.run("DELETE FROM pending_cleanup_items WHERE requester_person_id = ?", [requesterPersonId]);
  for (const c of candidates.overdueCommitments) {
    db.run(
      "INSERT INTO pending_cleanup_items (requester_person_id, kind, entity_id, option_title) VALUES (?, 'commitment', ?, ?)",
      [requesterPersonId, c.id, c.description.slice(0, 60)],
    );
  }
  for (const q of candidates.staleQuestions) {
    db.run(
      "INSERT INTO pending_cleanup_items (requester_person_id, kind, entity_id, option_title) VALUES (?, 'question', ?, ?)",
      [requesterPersonId, q.id, q.question_text.slice(0, 60)],
    );
  }
}

export function resolvePendingCleanup(requesterPersonId: string, optionTitle: string): boolean {
  const row = db
    .query<{ id: number; kind: "commitment" | "question"; entity_id: number }, [string, string]>(
      "SELECT id, kind, entity_id FROM pending_cleanup_items WHERE requester_person_id = ? AND option_title = ?",
    )
    .get(requesterPersonId, optionTitle);
  if (!row) return false;

  if (row.kind === "commitment") {
    db.run("UPDATE commitments SET status = 'done', resolved_at = datetime('now') WHERE id = ?", [row.entity_id]);
  } else {
    db.run("UPDATE open_questions SET status = 'answered', answered_at = datetime('now') WHERE id = ?", [row.entity_id]);
  }
  db.run("DELETE FROM pending_cleanup_items WHERE requester_person_id = ?", [requesterPersonId]);
  return true;
}

/**
 * Resolves every pending cleanup item at once (autonomy level 3, where the
 * user has opted out of per-item confirmation). Separate from
 * resolvePendingCleanup because that one intentionally clears the whole
 * pending set after a single poll answer — calling it in a loop would only
 * ever resolve the first item.
 */
export function resolveAllPendingCleanup(requesterPersonId: string): number {
  const rows = db
    .query<{ kind: "commitment" | "question"; entity_id: number }, [string]>(
      "SELECT kind, entity_id FROM pending_cleanup_items WHERE requester_person_id = ?",
    )
    .all(requesterPersonId);

  for (const row of rows) {
    if (row.kind === "commitment") {
      db.run("UPDATE commitments SET status = 'done', resolved_at = datetime('now') WHERE id = ?", [row.entity_id]);
    } else {
      db.run("UPDATE open_questions SET status = 'answered', answered_at = datetime('now') WHERE id = ?", [row.entity_id]);
    }
  }
  db.run("DELETE FROM pending_cleanup_items WHERE requester_person_id = ?", [requesterPersonId]);
  return rows.length;
}

export function stagePendingScreenshotEvent(requesterPersonId: string, event: { title: string; starts_at: string | null; location: string | null }) {
  db.run("DELETE FROM pending_screenshot_events WHERE requester_person_id = ?", [requesterPersonId]);
  db.run("INSERT INTO pending_screenshot_events (requester_person_id, title, starts_at, location) VALUES (?, ?, ?, ?)", [
    requesterPersonId,
    event.title,
    event.starts_at,
    event.location,
  ]);
}

export function confirmPendingScreenshotEvent(requesterPersonId: string): boolean {
  const row = db
    .query<{ title: string; starts_at: string | null; location: string | null }, [string]>(
      "SELECT title, starts_at, location FROM pending_screenshot_events WHERE requester_person_id = ? ORDER BY id DESC LIMIT 1",
    )
    .get(requesterPersonId);
  if (!row) return false;
  db.run("INSERT INTO events (title, starts_at, location, source) VALUES (?, ?, ?, 'screenshot')", [row.title, row.starts_at, row.location]);
  db.run("DELETE FROM pending_screenshot_events WHERE requester_person_id = ?", [requesterPersonId]);
  return true;
}

export function allDecisions(limit = 30): Decision[] {
  return db.query<Decision, [number]>("SELECT * FROM decisions ORDER BY created_at DESC LIMIT ?").all(limit);
}

export function allPeopleWithStats() {
  return db
    .query<{ id: string; name: string; address: string; thread_count: number; open_commitments: number }, []>(
      `SELECT p.id, p.name, p.address,
         (SELECT COUNT(*) FROM thread_members tm WHERE tm.person_id = p.id) as thread_count,
         (SELECT COUNT(*) FROM commitments c WHERE c.owner = p.id AND c.status = 'open') as open_commitments
       FROM people p ORDER BY p.last_seen DESC`,
    )
    .all();
}

export function allThreads() {
  return db.query<{ id: string; kind: string; title: string; message_count: number }, []>(
    `SELECT t.id, t.kind, t.title, (SELECT COUNT(*) FROM messages m WHERE m.thread_id = t.id) as message_count FROM threads t`,
  ).all();
}

export function exportDataFor(personId: string) {
  const memoriesRaw = db.query("SELECT category, content, pinned, created_at FROM memories WHERE owner_person_id = ?").all(personId);
  const commitmentsOwned = db.query("SELECT description, due_at, status, created_at FROM commitments WHERE owner = ?").all(personId);
  const watches = db.query("SELECT instruction, status, created_at FROM watches WHERE requester_person_id = ?").all(personId);
  return { exportedAt: new Date().toISOString(), memories: memoriesRaw, commitmentsYouOwn: commitmentsOwned, watches };
}

export function recentOpportunities(limit = 20): Opportunity[] {
  return db.query<Opportunity, [number]>("SELECT * FROM opportunities ORDER BY created_at DESC LIMIT ?").all(limit);
}

export function lastInboundText(threadId: string): string | null {
  const row = db
    .query<{ text: string | null }, [string]>(
      "SELECT text FROM messages WHERE thread_id = ? AND content_type = 'text' AND direction = 'inbound' ORDER BY created_at DESC LIMIT 1",
    )
    .get(threadId);
  return row?.text ?? null;
}

export { nowIso };
