import { CARD_HEAD } from "./theme";
import type { CatchMeUp } from "../queries";
import { getPersonById } from "../people";

const ICONS = {
  alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  calendar: '<rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/>',
  check: '<path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
};

function icon(path: string, color: string): string {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

function whoOwns(owner: string): string {
  if (owner === "me") return "You";
  return getPersonById(owner)?.name ?? "Someone";
}

function fmtShort(iso: string | null): string {
  if (!iso) return "no date";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
}

/** A score is never shown as a bare number — the reason is always one tap/hover away via the title attribute. */
function urgencyChip(urgency: number | null, reason: string | null): string {
  if (!urgency) return "";
  const color = urgency >= 4 ? "#EF4444" : urgency >= 3 ? "#F59E0B" : "#94A3B8";
  return `<span class="chip" style="color:${color};border-color:${color}55" title="${(reason ?? "").replace(/"/g, "&quot;")}">${urgency}/5</span>`;
}

function section(opts: { title: string; color: string; iconPath: string; delay: number; rows: string[]; empty: string }): string {
  return `
  <section class="card glass" style="animation-delay:${opts.delay}ms">
    <div class="card-head">
      <span class="badge" style="background:${opts.color}1a;color:${opts.color}">${icon(opts.iconPath, opts.color)}</span>
      <h2>${opts.title}</h2>
    </div>
    ${
      opts.rows.length
        ? `<ul>${opts.rows.map((r) => `<li>${r}</li>`).join("")}</ul>`
        : `<p class="empty">${opts.empty}</p>`
    }
  </section>`;
}

export function renderBriefCard(c: CatchMeUp): string {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const body = [
    section({
      title: "Urgent",
      color: "#EF4444",
      iconPath: ICONS.alert,
      delay: 0,
      rows: c.urgent.map((x) => `${x.description} <span class="meta">${fmtShort(x.due_at)}</span> ${urgencyChip(x.urgency, x.urgency_reason)}`),
      empty: "Nothing on fire.",
    }),
    section({
      title: "Important",
      color: "#F59E0B",
      iconPath: ICONS.star,
      delay: 60,
      rows: [
        ...c.important.decisions.map((d) => `Decided: ${d.decision_text}`),
        ...c.important.questions.map((q) => `Open: ${q.question_text}`),
      ],
      empty: "Nothing pressing.",
    }),
    section({
      title: "Upcoming",
      color: "#6366F1",
      iconPath: ICONS.calendar,
      delay: 120,
      rows: c.upcoming.map((e) => `${e.title} <span class="meta">${fmtShort(e.starts_at)}</span>`),
      empty: "Calendar's clear.",
    }),
    section({
      title: "Commitments",
      color: "#0891B2",
      iconPath: ICONS.check,
      delay: 180,
      rows: [...c.commitments.mine, ...c.commitments.theirs].map((x) => `${whoOwns(x.owner)}: ${x.description}`),
      empty: "All caught up.",
    }),
    section({
      title: "Follow-ups",
      color: "#EC4899",
      iconPath: ICONS.chat,
      delay: 240,
      rows: c.followUps.map((q) => q.question_text),
      empty: "No loose threads.",
    }),
  ].join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>ECHO — Daily Brief</title>
${CARD_HEAD}
<style>
  body { padding: 18px 16px 28px; }
  header { margin-bottom: 14px; }
  header .eyebrow { font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--accent); font-weight: 600; }
  header h1 { margin: 4px 0 0; font-size: 21px; }
  .card {
    padding: 14px 16px;
    margin-bottom: 10px;
    opacity: 0;
    animation: rise 0.5s cubic-bezier(0.16,1,0.3,1) forwards;
  }
  @keyframes rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
  .card-head { display: flex; align-items: center; gap: 9px; margin-bottom: 8px; }
  .badge { width: 28px; height: 28px; border-radius: 9px; display: inline-flex; align-items: center; justify-content: center; }
  .card-head h2 { margin: 0; font-size: 13px; font-weight: 700; letter-spacing: 0.02em; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  li { font-size: 13.5px; line-height: 1.4; padding-left: 14px; position: relative; }
  li::before { content: ""; position: absolute; left: 0; top: 7px; width: 4px; height: 4px; border-radius: 50%; background: var(--muted-foreground); }
  .meta { color: var(--muted-foreground); font-size: 11.5px; }
  .chip {
    display: inline-block; font-size: 10px; font-weight: 700; line-height: 1;
    padding: 2px 6px; border-radius: 999px; border: 1px solid; margin-left: 4px;
    font-family: "Space Grotesk", sans-serif; vertical-align: middle;
  }
  .empty { margin: 0; font-size: 12.5px; color: var(--muted-foreground); font-style: italic; }
  @media (prefers-reduced-motion: reduce) {
    .card { opacity: 1; animation: none; }
  }
</style>
</head>
<body>
  <header>
    <div class="eyebrow">Echo &middot; Daily Brief</div>
    <h1>${greeting}. Here's where things stand.</h1>
  </header>
  ${body}
</body>
</html>`;
}
