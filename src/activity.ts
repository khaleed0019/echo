import { db } from "./db";

export interface ActivityEntry {
  id: number;
  actor_person_id: string | null;
  agent: string;
  action: string;
  created_at: string;
}

export type AgentName =
  | "Orchestrator"
  | "Extraction Agent"
  | "Commitment Agent"
  | "Memory Agent"
  | "Follow-up Agent"
  | "Risk Agent"
  | "Reply Agent"
  | "Screenshot Agent";

/**
 * Call this at every point ECHO takes an autonomous action (fires a watch,
 * auto-captures a commitment worth flagging, stages a poll, etc). This is
 * the entire "transparency" mechanism — nothing ECHO does is invisible,
 * because everything it does writes one line here, tagged with which of
 * ECHO's agents (see README's agent table) did it.
 */
export function logActivity(action: string, actorPersonId: string | null = null, agent: AgentName = "Orchestrator") {
  db.run("INSERT INTO activity_log (actor_person_id, agent, action) VALUES (?, ?, ?)", [actorPersonId, agent, action]);
}

export function recentActivity(limit = 15): ActivityEntry[] {
  return db.query<ActivityEntry, [number]>("SELECT * FROM activity_log ORDER BY created_at DESC LIMIT ?").all(limit);
}

export function formatActivity(entries: ActivityEntry[]): string {
  if (!entries.length) return "No activity logged yet.";
  return [
    "**What I've done:**",
    ...entries.map(
      (e) =>
        `${new Date(e.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} — _${e.agent}_ ${e.action}`,
    ),
  ].join("\n");
}
