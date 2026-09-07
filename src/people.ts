import { createHash } from "node:crypto";
import { db } from "./db";
import type { Person, Thread, ThreadKind } from "./types";

/**
 * iMessage addresses a user by phone number OR email (confirmed in
 * docs.photon.codes "iMessage connection and routing" — `im.user()` accepts
 * either, and the user's `address` field is documented as "phone number or
 * email address"). Everything below treats the address as an opaque string
 * for exactly that reason.
 */
export function normalizeAddress(address: string): string {
  const trimmed = address.trim();
  // Emails are case-insensitive in practice; phone numbers are unaffected by
  // lowercasing. Without this, "Me@X.com" and "me@x.com" become two people.
  return trimmed.includes("@") ? trimmed.toLowerCase() : trimmed;
}

/** Stable id from a hash — a naive strip-non-alphanumerics would collide
 *  ("a.b@x.com" and "ab@x.com" both → "abxcom"). */
function personIdFor(address: string): string {
  return `person_${createHash("sha256").update(address).digest("hex").slice(0, 16)}`;
}

export function upsertPerson(address: string, name?: string): Person {
  const addr = normalizeAddress(address);
  const existing = db.query<Person, [string]>("SELECT * FROM people WHERE address = ?").get(addr);
  if (existing) {
    if (name && name !== existing.name) {
      db.run("UPDATE people SET name = ?, last_seen = datetime('now') WHERE id = ?", [name, existing.id]);
      return { ...existing, name };
    }
    db.run("UPDATE people SET last_seen = datetime('now') WHERE id = ?", [existing.id]);
    return existing;
  }

  db.run(
    "INSERT INTO people (id, name, address) VALUES (?, ?, ?) ON CONFLICT(address) DO NOTHING",
    [personIdFor(addr), name ?? addr, addr],
  );
  return db.query<Person, [string]>("SELECT * FROM people WHERE address = ?").get(addr)!;
}

export function getPersonByName(name: string): Person | null {
  return (
    db
      .query<Person, [string]>("SELECT * FROM people WHERE lower(name) = lower(?) LIMIT 1")
      .get(name) ?? null
  );
}

export function getPersonById(id: string): Person | null {
  return db.query<Person, [string]>("SELECT * FROM people WHERE id = ?").get(id) ?? null;
}

export function upsertThread(id: string, kind: ThreadKind, title: string): Thread {
  db.run(
    `INSERT INTO threads (id, kind, title) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET title = excluded.title`,
    [id, kind, title],
  );
  return db.query<Thread, [string]>("SELECT * FROM threads WHERE id = ?").get(id)!;
}

export function addThreadMember(threadId: string, personId: string) {
  db.run("INSERT OR IGNORE INTO thread_members (thread_id, person_id) VALUES (?, ?)", [threadId, personId]);
}

export function threadMembers(threadId: string): Person[] {
  return db
    .query<Person, [string]>(
      `SELECT p.* FROM people p
       JOIN thread_members tm ON tm.person_id = p.id
       WHERE tm.thread_id = ?`,
    )
    .all(threadId);
}

/** Threads a given person_id shares with the ECHO line, most-recently-active first. */
export function threadsForPerson(personId: string): Thread[] {
  return db
    .query<Thread, [string]>(
      `SELECT DISTINCT t.* FROM threads t
       JOIN thread_members tm ON tm.thread_id = t.id
       WHERE tm.person_id = ?
       ORDER BY (SELECT MAX(created_at) FROM messages m WHERE m.thread_id = t.id) DESC`,
    )
    .all(personId);
}
