import { CARD_HEAD } from "./cards/theme";
import type { Commitment, Decision, LifeEvent, OpenQuestion, Opportunity } from "./types";
import type { ActivityEntry } from "./activity";
import type { Memory } from "./memory";
import { getPersonById } from "./people";

/**
 * The "ECHO Command Center" web dashboard — real, not a mockup: every
 * section below reads live from the same SQLite DB every iMessage command
 * reads from (src/queries.ts), served by the same Bun/Hono process
 * (GET /dashboard in index.ts). This deliberately reuses the existing
 * server/DB rather than standing up the separately-suggested Next.js +
 * Supabase stack — see README for why. No auth: this is a single-owner
 * personal agent, not a multi-tenant product, so it shows PRIMARY_USER's
 * data directly rather than gating behind a login that would need its own
 * infrastructure to be real.
 */
export interface DashboardData {
  greeting: string;
  today: { todayEvents: LifeEvent[]; dueToday: Commitment[] };
  memories: Memory[];
  openCommitments: Commitment[];
  openQuestions: OpenQuestion[];
  people: { id: string; name: string; address: string; thread_count: number; open_commitments: number }[];
  threads: { id: string; kind: string; title: string; message_count: number }[];
  opportunities: Opportunity[];
  decisions: Decision[];
  activity: ActivityEntry[];
  stats: { completed: number; stillOpen: number; overdue: number; decisionsMade: number };
}

function whoOwns(owner: string): string {
  if (owner === "me") return "You";
  return getPersonById(owner)?.name ?? "Someone";
}

function fmt(iso: string | null): string {
  if (!iso) return "no date";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function statTile(label: string, value: number, color: string): string {
  return `<div class="stat"><div class="stat-value" style="color:${color}">${value}</div><div class="stat-label">${label}</div></div>`;
}

function panel(title: string, iconColor: string, rows: string[], empty: string): string {
  return `
  <section class="panel glass">
    <h2><span class="dot" style="background:${iconColor}"></span>${title}</h2>
    ${rows.length ? `<ul>${rows.join("")}</ul>` : `<p class="empty">${empty}</p>`}
  </section>`;
}

export function renderDashboard(d: DashboardData): string {
  const todayRows = [
    ...d.today.todayEvents.map((e) => `<li>${e.title}${e.location ? ` @ ${e.location}` : ""} <span class="meta">${fmt(e.starts_at)}</span></li>`),
    ...d.today.dueToday.map((c) => `<li>Due: ${c.description} <span class="meta">${fmt(c.due_at)}</span></li>`),
  ];

  const memoryRows = d.memories.slice(0, 8).map((m) => `<li>${m.pinned ? "📌 " : ""}${m.content} <span class="meta">${m.category}</span></li>`);
  const commitmentRows = d.openCommitments.slice(0, 10).map((c) => `<li>${whoOwns(c.owner)}: ${c.description} <span class="meta">${fmt(c.due_at)}</span></li>`);
  const questionRows = d.openQuestions.slice(0, 8).map((q) => `<li>${q.question_text}</li>`);
  const peopleRows = d.people.map((p) => `<li>${p.name} <span class="meta">${p.thread_count} thread${p.thread_count === 1 ? "" : "s"}${p.open_commitments ? ` · ${p.open_commitments} open` : ""}</span></li>`);
  const threadRows = d.threads.map((t) => `<li>${t.title} <span class="meta">${t.kind} · ${t.message_count} msgs</span></li>`);
  const opportunityRows = d.opportunities.slice(0, 8).map((o) => `<li>${o.description}${o.confidence ? ` <span class="meta">confidence ${o.confidence}/5</span>` : ""}</li>`);
  const decisionRows = d.decisions.slice(0, 8).map((dec) => `<li>${dec.decision_text}${dec.rationale ? `<div class="sub">${dec.rationale}</div>` : ""}</li>`);
  const activityRows = d.activity.slice(0, 10).map((a) => `<li><span class="meta">${fmt(a.created_at)} · ${a.agent}</span><br/>${a.action}</li>`);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ECHO — Command Center</title>
${CARD_HEAD}
<style>
  body { padding: 24px 20px 60px; max-width: 1100px; margin: 0 auto; }
  header { margin-bottom: 20px; }
  header .eyebrow { font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent); font-weight: 600; }
  header h1 { margin: 6px 0 0; font-size: 26px; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 10px; margin: 20px 0 24px; }
  .stat { padding: 14px; border-radius: 14px; }
  .stat-value { font-family: "Space Grotesk", sans-serif; font-size: 26px; font-weight: 700; }
  .stat-label { font-size: 11px; color: var(--muted-foreground); margin-top: 2px; text-transform: uppercase; letter-spacing: 0.06em; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; }
  .panel { padding: 16px 18px; }
  .panel h2 { margin: 0 0 10px; font-size: 14px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  li { font-size: 13px; line-height: 1.45; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
  li:last-child { border-bottom: none; padding-bottom: 0; }
  .meta { color: var(--muted-foreground); font-size: 11px; }
  .sub { color: var(--muted-foreground); font-size: 11.5px; margin-top: 2px; }
  .empty { margin: 0; font-size: 12.5px; color: var(--muted-foreground); font-style: italic; }
  @media (max-width: 600px) { .grid { grid-template-columns: 1fr; } }
</style>
</head>
<body>
  <header>
    <div class="eyebrow">Echo &middot; Command Center</div>
    <h1>${d.greeting}</h1>
  </header>

  <div class="stats">
    ${statTile("Open", d.stats.stillOpen, "#0891B2")}
    ${statTile("Overdue", d.stats.overdue, "#EF4444")}
    ${statTile("Completed", d.stats.completed, "#22C55E")}
    ${statTile("Decisions (7d)", d.stats.decisionsMade, "#EC4899")}
  </div>

  <div class="grid">
    ${panel("Today", "#6366F1", todayRows, "Nothing scheduled today.")}
    ${panel("Memory", "#EC4899", memoryRows, "Nothing remembered yet.")}
    ${panel("Commitments", "#0891B2", commitmentRows, "All caught up.")}
    ${panel("Follow-ups", "#F59E0B", questionRows, "No open questions.")}
    ${panel("People", "#6366F1", peopleRows, "No one yet.")}
    ${panel("Conversations", "#7C3AED", threadRows, "No threads yet.")}
    ${panel("Opportunities", "#22C55E", opportunityRows, "None flagged yet.")}
    ${panel("Decisions", "#EC4899", decisionRows, "No decisions logged yet.")}
    ${panel("Activity", "#94A3B8", activityRows, "Nothing logged yet.")}
  </div>
</body>
</html>`;
}
