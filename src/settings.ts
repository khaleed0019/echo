import { db } from "./db";

export interface Settings {
  person_id: string;
  autonomy_level: 1 | 2 | 3;
  paused: number;
}

/**
 * Autonomy levels, the real (not just labeled) difference each one makes:
 *   1 — Suggest only. ECHO never writes anything on its own; every command
 *       that would normally write (cleanup, screenshot→event) instead just
 *       describes what it *would* do.
 *   2 — Ask before acting (the default). Writes go through a real Spectrum
 *       poll first — see the cleanup and screenshot flows in index.ts.
 *   3 — Act automatically on approved workflows. Low-risk, reversible
 *       writes (staging a cleanup item as done, adding a screenshot event)
 *       happen immediately; the activity log is how the user still sees it.
 */
export function getSettings(personId: string): Settings {
  db.run("INSERT OR IGNORE INTO settings (person_id) VALUES (?)", [personId]);
  return db.query<Settings, [string]>("SELECT * FROM settings WHERE person_id = ?").get(personId)!;
}

export function setAutonomyLevel(personId: string, level: 1 | 2 | 3) {
  getSettings(personId); // ensure row exists
  db.run("UPDATE settings SET autonomy_level = ? WHERE person_id = ?", [level, personId]);
}

export function setPaused(personId: string, paused: boolean) {
  getSettings(personId);
  db.run("UPDATE settings SET paused = ? WHERE person_id = ?", [paused ? 1 : 0, personId]);
}

export function isPaused(personId: string): boolean {
  return getSettings(personId).paused === 1;
}
