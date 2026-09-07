// Populates ~10 days of realistic multi-thread history so every demo beat has
// real content on first run, instead of a cold, empty database.
//
// IMPORTANT — this is explicitly DEMO functionality, not REAL functionality:
// Spectrum has no API to retroactively pull a phone's actual past iMessage
// history (there's no backfill endpoint), so there is no way to honestly
// populate "the last 10 days" from a real account. This script inserts rows
// directly rather than routing them through src/extract.ts's LLM call —
// a live demo can't depend on an LLM's extraction being byte-for-byte
// deterministic run to run. The REAL extraction pipeline is exercised by
// src/ingest.ts on every actual inbound message ECHO receives once deployed
// — text the number yourself and watch a commitment get captured live to see
// the real path, not this one.

import "./db";
import { db } from "./db";
import { upsertPerson, upsertThread, addThreadMember } from "./people";
import { recordMessage } from "./ingest";

// Phone number or Apple ID email — whichever your iMessage uses (see .env).
const PRIMARY_USER_ADDRESS = process.env.PRIMARY_USER_ADDRESS ?? process.env.PRIMARY_USER_PHONE ?? "+15551234567";

function daysAgo(n: number, hour = 12): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}
function daysFromNow(n: number, hour = 12): string {
  return daysAgo(-n, hour);
}

function seededMessage(id: string, threadId: string, senderId: string, text: string, at: string) {
  recordMessage({ id, threadId, senderPersonId: senderId, direction: "inbound", contentType: "text", text, createdAt: at });
}

export async function seedDemoData() {
  console.log("Seeding ECHO demo data...");

  const you = upsertPerson(PRIMARY_USER_ADDRESS, "You");
  const james = upsertPerson("+15550001", "James");
  const priya = upsertPerson("+15550002", "Priya");
  const alex = upsertPerson("+15550003", "Alex");
  const morgan = upsertPerson("+15550004", "Morgan");

  const skiTrip = upsertThread("seed-thread-ski-trip", "group", "Ski Trip 🏔️");
  const apartment = upsertThread("seed-thread-apartment", "group", "Apartment 4B");
  const projectNova = upsertThread("seed-thread-project-nova", "group", "Project Nova");

  for (const p of [you.id, james.id, priya.id]) addThreadMember(skiTrip.id, p);
  for (const p of [you.id, alex.id]) addThreadMember(apartment.id, p);
  for (const p of [you.id, morgan.id]) addThreadMember(projectNova.id, p);

  // ---- messages (for a realistic-looking timeline / context packets) ----
  seededMessage("seed-1", projectNova.id, morgan.id, "Quick call notes — should we go with Supabase or Firebase for the backend?", daysAgo(9));
  seededMessage("seed-2", projectNova.id, you.id, "Let's do Supabase — better Postgres support, and row-level security is way cheaper at our scale than Firebase's tiers", daysAgo(9));
  seededMessage("seed-3", projectNova.id, morgan.id, "Sounds good, going with Supabase then", daysAgo(9));

  seededMessage("seed-4", apartment.id, alex.id, "hey I'll pay the wifi bill this week, remind me if I forget lol", daysAgo(8));

  seededMessage("seed-5", skiTrip.id, priya.id, "so is everyone in for the ski trip jan 24-26?", daysAgo(7));
  seededMessage("seed-6", skiTrip.id, you.id, "I'm in! Let me book the airbnb", daysAgo(7));
  seededMessage("seed-7", skiTrip.id, james.id, "let me check my schedule and get back to you", daysAgo(7));

  seededMessage("seed-8", projectNova.id, morgan.id, "should we ship the auth flow before or after the payments module?", daysAgo(6));

  seededMessage("seed-9", projectNova.id, you.id, "sent you the initial project brief", daysAgo(6));

  seededMessage("seed-10", apartment.id, you.id, "can you also grab paper towels next time you're at the store", daysAgo(5));

  seededMessage("seed-11", projectNova.id, you.id, "I'll send you the deck by tomorrow", daysAgo(4));

  seededMessage("seed-12", skiTrip.id, priya.id, "reminder — need headcount by end of week for the cabin booking", daysAgo(2));

  seededMessage("seed-13", projectNova.id, morgan.id, "given the timeline, let's launch without the payments module first and add it in v1.1", daysAgo(1));
  seededMessage("seed-14", projectNova.id, you.id, "agreed, ship auth-only for v1 launch", daysAgo(1));

  seededMessage("seed-15", skiTrip.id, priya.id, "also does anyone know if the cabin has wifi? need to know if I can work remote that week", daysAgo(1));

  // ---- structured ground truth (bypasses the LLM — see file header) ----

  db.run(
    `INSERT INTO decisions (topic, decision_text, rationale, thread_id, created_at) VALUES (?, ?, ?, ?, ?)`,
    ["Backend: Supabase vs Firebase", "Chose Supabase over Firebase for the backend", "Better Postgres support and cheaper row-level security at our scale", projectNova.id, daysAgo(9)],
  );
  db.run(
    `INSERT INTO decisions (topic, decision_text, rationale, thread_id, created_at) VALUES (?, ?, ?, ?, ?)`,
    ["V1 launch scope", "Launch without the payments module — ship auth-only for v1, payments in v1.1", "Timeline pressure meant payments had to be cut from v1", projectNova.id, daysAgo(1)],
  );

  db.run(
    `INSERT INTO open_questions (question_text, thread_id, asked_by, status, created_at, answered_at) VALUES (?, ?, ?, 'answered', ?, ?)`,
    ["Ship auth flow before or after the payments module?", projectNova.id, morgan.id, daysAgo(6), daysAgo(1)],
  );
  db.run(
    `INSERT INTO open_questions (question_text, thread_id, asked_by, status, created_at) VALUES (?, ?, ?, 'open', ?)`,
    ["Does the cabin have wifi? (Priya needs to work remote that week)", skiTrip.id, priya.id, daysAgo(1)],
  );

  db.run(
    `INSERT INTO commitments (thread_id, owner, description, due_at, status, urgency, urgency_reason, confidence, created_at) VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
    [apartment.id, alex.id, "Pay the wifi bill", daysAgo(1), 4, "Overdue by about a week — shared utility, affects the whole apartment", 5, daysAgo(8)],
  );
  db.run(
    `INSERT INTO commitments (thread_id, owner, description, due_at, status, urgency, urgency_reason, confidence, created_at) VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
    [skiTrip.id, "me", "Book the Airbnb for the ski trip", daysAgo(3), 4, "Overdue — good listings for the trip dates fill up the longer this waits", 5, daysAgo(7)],
  );
  db.run(
    `INSERT INTO commitments (thread_id, owner, description, due_at, status, urgency, urgency_reason, confidence, created_at) VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
    [skiTrip.id, james.id, "Confirm ski trip dates", daysAgo(5), 5, "Most overdue item — it's blocking the Airbnb booking decision", 4, daysAgo(7)],
  );
  db.run(
    `INSERT INTO commitments (thread_id, owner, description, due_at, status, urgency, urgency_reason, confidence, created_at) VALUES (?, ?, ?, NULL, 'open', ?, ?, ?, ?)`,
    [apartment.id, alex.id, "Grab paper towels from the store", 1, "Minor errand, no deadline attached", 3, daysAgo(5)],
  );
  db.run(
    `INSERT INTO commitments (thread_id, owner, description, due_at, status, urgency, urgency_reason, confidence, created_at) VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
    [projectNova.id, "me", "Send Morgan the deck", daysFromNow(1), 4, "Due tomorrow — blocks Morgan's next step on the project", 5, daysAgo(4)],
  );
  db.run(
    `INSERT INTO commitments (thread_id, owner, description, due_at, status, urgency, urgency_reason, confidence, created_at, resolved_at) VALUES (?, ?, ?, NULL, 'done', ?, ?, ?, ?, ?)`,
    [projectNova.id, "me", "Send Morgan the initial project brief", 3, "Needed to kick off the project", 5, daysAgo(6), daysAgo(6)],
  );

  db.run(`INSERT INTO events (thread_id, title, starts_at, location, source, importance, importance_reason, created_at) VALUES (?, ?, ?, ?, 'text', ?, ?, ?)`, [
    skiTrip.id,
    "Ski Trip",
    daysFromNow(16, 9),
    "Tahoe",
    3,
    "Personal trip, meaningful but not work-critical",
    daysAgo(7),
  ]);
  db.run(`INSERT INTO events (thread_id, title, starts_at, location, source, importance, importance_reason, created_at) VALUES (?, ?, ?, NULL, 'text', ?, ?, ?)`, [
    skiTrip.id,
    "Cabin booking headcount deadline",
    daysFromNow(1, 17),
    4,
    "Blocks the group's cabin booking — due tomorrow",
    daysAgo(2),
  ]);

  console.log("Seeded:");
  console.log("  people:", db.query("SELECT COUNT(*) as n FROM people").get());
  console.log("  threads:", db.query("SELECT COUNT(*) as n FROM threads").get());
  console.log("  messages:", db.query("SELECT COUNT(*) as n FROM messages").get());
  console.log("  commitments:", db.query("SELECT COUNT(*) as n FROM commitments").get());
  console.log("  events:", db.query("SELECT COUNT(*) as n FROM events").get());
  console.log("  decisions:", db.query("SELECT COUNT(*) as n FROM decisions").get());
  console.log("  open_questions:", db.query("SELECT COUNT(*) as n FROM open_questions").get());
  console.log("\nTry: \"echo, catch me up\" from", PRIMARY_USER_ADDRESS, "once the server is running.");
}

/** Rows already present? Used by the boot-time auto-seed so a restart on an
 *  ephemeral filesystem (Render's free disk resets) doesn't come back empty,
 *  but a warm database is never double-seeded. */
export function isSeeded(): boolean {
  const row = db.query<{ n: number }, []>("SELECT COUNT(*) as n FROM threads").get();
  return (row?.n ?? 0) > 0;
}

// Running this file directly still seeds, exactly as before. Windows paths
// use backslashes, so normalise before matching.
const entry = process.argv[1]?.split("\\").join("/") ?? "";
if (entry.endsWith("src/seed.ts")) void seedDemoData();
