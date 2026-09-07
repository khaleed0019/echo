import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DB_PATH = process.env.DATABASE_PATH ?? "./data/echo.sqlite";
mkdirSync(dirname(DB_PATH), { recursive: true });

/**
 * Runtime-portable SQLite.
 *
 * ECHO was written against `bun:sqlite`, but Render (and most PaaS) have no
 * Bun runtime — so this picks the right driver at startup and exposes the
 * single small API surface the rest of the app already uses:
 *
 *     db.query<Row, Params>(sql).get(...params) / .all(...params)
 *     db.run(sql, [params])   -> { changes }
 *     db.exec(sql)
 *
 * Bun and node:sqlite have genuinely different shapes (`.query()` vs
 * `.prepare()`, array vs spread params, different run() return), so this is a
 * real adapter rather than a re-export. Keeping the API identical is what
 * stopped the Node port from touching all 12 call-site files.
 */
const isBun = typeof (globalThis as any).Bun !== "undefined";

interface RawStatement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): { changes?: number | bigint };
}
interface RawDatabase {
  prepare(sql: string): RawStatement;
  exec(sql: string): void;
}

let raw: RawDatabase;

if (isBun) {
  const { Database } = await import("bun:sqlite");
  const bunDb = new Database(DB_PATH);
  raw = {
    prepare: (sql: string) => bunDb.query(sql) as unknown as RawStatement,
    exec: (sql: string) => bunDb.exec(sql),
  };
} else {
  // node:sqlite landed in Node 22.5 but stayed behind --experimental-sqlite
  // until 23.4, so this needs Node >= 23.4 to import unflagged (see
  // package.json engines). On Render, pin NODE_VERSION accordingly — 22.x
  // fails at import with ERR_UNKNOWN_BUILTIN_MODULE.
  const { DatabaseSync } = await import("node:sqlite");
  const nodeDb = new DatabaseSync(DB_PATH);
  raw = {
    prepare: (sql: string) => nodeDb.prepare(sql) as unknown as RawStatement,
    exec: (sql: string) => nodeDb.exec(sql),
  };
}

/** Prepared statements are reused — re-preparing identical SQL on every call
 *  is the easy way to make a hot ingest path slow. */
const stmtCache = new Map<string, RawStatement>();
function prepare(sql: string): RawStatement {
  let s = stmtCache.get(sql);
  if (!s) {
    s = raw.prepare(sql);
    stmtCache.set(sql, s);
  }
  return s;
}

export const db = {
  query<Row = unknown, Params extends unknown[] = unknown[]>(sql: string) {
    return {
      get: (...params: Params) => prepare(sql).get(...params) as Row | undefined,
      all: (...params: Params) => prepare(sql).all(...params) as Row[],
    };
  },
  run(sql: string, params: unknown[] = []): { changes: number } {
    const result = prepare(sql).run(...params);
    return { changes: Number(result?.changes ?? 0) };
  },
  exec(sql: string) {
    raw.exec(sql);
  },
};

db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

// One schema powers every demo/bonus feature as a different query over the
// same rows — see README "Data model" for how each view maps here.
db.exec(`
  CREATE TABLE IF NOT EXISTS people (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT NOT NULL UNIQUE,   -- phone number OR email (iMessage supports both)
    first_seen TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS threads (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('dm','group')),
    title TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS thread_members (
    thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    PRIMARY KEY (thread_id, person_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    sender_person_id TEXT REFERENCES people(id),
    direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
    content_type TEXT NOT NULL,
    text TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, created_at);

  CREATE TABLE IF NOT EXISTS commitments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT REFERENCES messages(id),
    thread_id TEXT NOT NULL REFERENCES threads(id),
    owner TEXT NOT NULL,
    description TEXT NOT NULL,
    due_at TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','overdue')),
    source_excerpt TEXT,
    urgency INTEGER,          -- 1-5, explainable via urgency_reason — never shown as a bare number
    urgency_reason TEXT,
    confidence INTEGER,       -- 1-5, how sure the extractor was this is a real commitment
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT REFERENCES messages(id),
    thread_id TEXT REFERENCES threads(id),
    title TEXT NOT NULL,
    starts_at TEXT,
    location TEXT,
    source TEXT NOT NULL DEFAULT 'text' CHECK (source IN ('text','screenshot')),
    importance INTEGER,       -- 1-5, explainable via importance_reason
    importance_reason TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic TEXT NOT NULL,
    decision_text TEXT NOT NULL,
    rationale TEXT,
    thread_id TEXT NOT NULL REFERENCES threads(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS opportunities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT REFERENCES messages(id),
    thread_id TEXT NOT NULL REFERENCES threads(id),
    description TEXT NOT NULL,
    confidence INTEGER,       -- 1-5, see confidence_reason
    confidence_reason TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS open_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_text TEXT NOT NULL,
    asked_by TEXT REFERENCES people(id),
    thread_id TEXT NOT NULL REFERENCES threads(id),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    answered_at TEXT
  );

  CREATE TABLE IF NOT EXISTS watches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_person_id TEXT NOT NULL REFERENCES people(id),
    target_thread_id TEXT NOT NULL REFERENCES threads(id),
    target_person_id TEXT REFERENCES people(id),
    instruction TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','fired','cancelled')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    fired_at TEXT
  );

  -- Idempotency ledger, keyed by Spectrum's message.id (see docs.photon.codes
  -- "Events" — the same delivery can retry with the same id).
  CREATE TABLE IF NOT EXISTS processed_message_ids (
    message_id TEXT PRIMARY KEY,
    processed_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- A poll_option reply carries the poll's title/options back, but not a
  -- handle to whatever server-side state prompted it — these two tables hold
  -- that state between "poll sent" and "poll answered". Only one of each kind
  -- is expected pending per requester at a time (a hackathon-scope
  -- simplification, noted in the README).
  CREATE TABLE IF NOT EXISTS pending_cleanup_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_person_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('commitment','question')),
    entity_id INTEGER NOT NULL,
    option_title TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS pending_screenshot_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_person_id TEXT NOT NULL,
    title TEXT NOT NULL,
    starts_at TEXT,
    location TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Explicit "remember that ..." memory, distinct from the passively-extracted
  -- commitments/events/decisions above: this is only ever written when the
  -- user directly asks ECHO to remember something, and only ever read back
  -- to the person who owns it.
  CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_person_id TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'general',
    content TEXT NOT NULL,
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Every autonomous action ECHO takes gets one row here — the transparency
  -- mechanism: "what have you done" reads straight off this table, nothing
  -- happens invisibly.
  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_person_id TEXT,
    agent TEXT NOT NULL DEFAULT 'Orchestrator',
    action TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Per-person settings: autonomy level (see src/settings.ts for the three
  -- tiers' actual meaning) and a pause switch for the Privacy Center.
  CREATE TABLE IF NOT EXISTS settings (
    person_id TEXT PRIMARY KEY,
    autonomy_level INTEGER NOT NULL DEFAULT 2 CHECK (autonomy_level IN (1,2,3)),
    paused INTEGER NOT NULL DEFAULT 0
  );
`);
