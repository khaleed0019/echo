import type { CatchMeUp, TimelineItem } from "./queries";
import type { Commitment, Decision, LifeEvent, OpenQuestion } from "./types";
import { getPersonById } from "./people";

function whoOwns(owner: string): string {
  if (owner === "me") return "You";
  return getPersonById(owner)?.name ?? "Someone";
}

function fmtDate(iso: string | null): string {
  if (!iso) return "no date set";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function bullet(lines: string[]): string {
  return lines.map((l) => `• ${l}`).join("\n");
}

/** Scores are never shown as a bare number — always with the one-clause reason that earned it. */
function urgencyNote(c: Commitment): string {
  if (!c.urgency) return "";
  return ` _(urgency ${c.urgency}/5 — ${c.urgency_reason})_`;
}

export function formatCatchMeUp(c: CatchMeUp): string {
  const sections: string[] = ["**Here's where things stand:**"];

  if (c.urgent.length) {
    sections.push(
      `\n**🔴 URGENT**\n` + bullet(c.urgent.map((x) => `${x.description} — due ${fmtDate(x.due_at)}${urgencyNote(x)}`)),
    );
  }
  if (c.important.decisions.length || c.important.questions.length) {
    const lines = [
      ...c.important.decisions.map((d) => `Decided: ${d.decision_text}`),
      ...c.important.questions.map((q) => `Open question: ${q.question_text}`),
    ];
    sections.push(`\n**🟠 IMPORTANT**\n` + bullet(lines));
  }
  if (c.upcoming.length) {
    sections.push(`\n**🗓️ UPCOMING**\n` + bullet(c.upcoming.map((e) => `${e.title} — ${fmtDate(e.starts_at)}${e.location ? ` @ ${e.location}` : ""}`)));
  }
  const allCommitments = [...c.commitments.mine, ...c.commitments.theirs];
  if (allCommitments.length) {
    sections.push(
      `\n**✅ COMMITMENTS**\n` +
        bullet(allCommitments.map((x) => `${whoOwns(x.owner)}: ${x.description} (${fmtDate(x.due_at)})`)),
    );
  }
  if (c.followUps.length) {
    sections.push(`\n**💬 FOLLOW-UPS**\n` + bullet(c.followUps.map((q) => q.question_text)));
  }

  if (sections.length === 1) sections.push("\nNothing outstanding — you're clear. 🎉");
  return sections.join("\n");
}

export function formatPrioritizeMyDay(p: { todayEvents: LifeEvent[]; dueToday: Commitment[] }): string {
  if (!p.todayEvents.length && !p.dueToday.length) return "Nothing scheduled or due today — a clean slate.";

  const lines: string[] = ["**Today's plan:**"];
  const combined = [
    ...p.todayEvents.map((e) => ({ at: e.starts_at ?? "", label: `${e.title}${e.location ? ` @ ${e.location}` : ""}` })),
    ...p.dueToday.map((c) => ({ at: c.due_at ?? "", label: `Due: ${c.description}` })),
  ].sort((a, b) => (a.at < b.at ? -1 : 1));

  combined.forEach((item, i) => lines.push(`${i + 1}. ${item.label}${item.at ? ` — ${fmtDate(item.at)}` : ""}`));
  return lines.join("\n");
}

export function formatWhatAmIForgetting(w: { staleCommitments: Commitment[]; staleQuestions: OpenQuestion[] }): string {
  if (!w.staleCommitments.length && !w.staleQuestions.length) return "Nothing's slipping. You're on top of everything.";

  const lines: string[] = ["**You might be forgetting:**"];
  if (w.staleCommitments.length) {
    lines.push(bullet(w.staleCommitments.map((c) => `${whoOwns(c.owner)} still owe${c.owner === "me" ? "" : "s"}: ${c.description} (${fmtDate(c.due_at)})${urgencyNote(c)}`)));
  }
  if (w.staleQuestions.length) {
    lines.push(bullet(w.staleQuestions.map((q) => `Unanswered since ${fmtDate(q.created_at)}: ${q.question_text}`)));
  }
  return lines.join("\n");
}

export function formatTimeline(items: TimelineItem[]): string {
  if (!items.length) return "No timeline yet.";
  const icon: Record<TimelineItem["kind"], string> = { commitment: "✅", event: "🗓️", decision: "🧭", question: "💬" };
  return ["**Life timeline:**", ...items.map((i) => `${icon[i.kind]} ${fmtDate(i.at)} — ${i.label}`)].join("\n");
}

export function formatOpenLoops(l: { commitments: Commitment[]; questions: OpenQuestion[] }): string {
  if (!l.commitments.length && !l.questions.length) return "No open loops — everything's closed out.";
  const lines: string[] = ["**Open loops:**"];
  if (l.commitments.length) lines.push(bullet(l.commitments.map((c) => `${whoOwns(c.owner)}: ${c.description}`)));
  if (l.questions.length) lines.push(bullet(l.questions.map((q) => q.question_text)));
  return lines.join("\n");
}

export function formatWhatChanged(c: {
  newCommitments: Commitment[];
  resolvedCommitments: Commitment[];
  newEvents: LifeEvent[];
  newDecisions: Decision[];
  answeredQuestions: OpenQuestion[];
}): string {
  const lines: string[] = [];
  if (c.newCommitments.length) lines.push(`**New commitments**\n` + bullet(c.newCommitments.map((x) => `${whoOwns(x.owner)}: ${x.description}`)));
  if (c.resolvedCommitments.length) lines.push(`**Resolved**\n` + bullet(c.resolvedCommitments.map((x) => x.description)));
  if (c.newEvents.length) lines.push(`**New events**\n` + bullet(c.newEvents.map((x) => x.title)));
  if (c.newDecisions.length) lines.push(`**Decisions made**\n` + bullet(c.newDecisions.map((x) => x.decision_text)));
  if (c.answeredQuestions.length) lines.push(`**Answered**\n` + bullet(c.answeredQuestions.map((x) => x.question_text)));

  if (!lines.length) return "Nothing's changed.";
  return ["**What changed:**", ...lines].join("\n\n");
}

export function formatDecisionMemory(decisions: Decision[], keyword: string): string {
  if (!decisions.length) return `No decisions found matching "${keyword}".`;
  return [
    `**Decisions about "${keyword}":**`,
    ...decisions.map((d) => `🧭 ${d.decision_text}${d.rationale ? `\n   ↳ ${d.rationale}` : ""}`),
  ].join("\n");
}

export function formatWeeklyReview(w: {
  completed: Commitment[];
  stillOpen: Commitment[];
  overdue: Commitment[];
  decisionsMade: Decision[];
  nextWeekEvents: LifeEvent[];
  needsAttention: { name: string; count: number }[];
}): string {
  return [
    "**Weekly review:**",
    `✅ Completed: ${w.completed.length}`,
    `📌 Still open: ${w.stillOpen.length}`,
    `🔴 Overdue: ${w.overdue.length}`,
    `🧭 Decisions made: ${w.decisionsMade.length}`,
    w.needsAttention.length ? `**Who needs attention:** ${w.needsAttention.map((p) => `${p.name} (${p.count})`).join(", ")}` : "**Who needs attention:** nobody",
    w.nextWeekEvents.length
      ? `**Next week:**\n` + bullet(w.nextWeekEvents.map((e) => `${e.title} — ${fmtDate(e.starts_at)}`))
      : "**Next week:** nothing on the calendar",
  ].join("\n");
}

export function formatCleanup(c: { overdueCommitments: Commitment[]; staleQuestions: OpenQuestion[] }): string {
  const total = c.overdueCommitments.length + c.staleQuestions.length;
  if (!total) return "Nothing to clean up — you're tidy.";
  const lines: string[] = [`**${total} thing${total === 1 ? "" : "s"} could use cleanup:**`];
  if (c.overdueCommitments.length) lines.push(bullet(c.overdueCommitments.map((x) => `Overdue: ${x.description}`)));
  if (c.staleQuestions.length) lines.push(bullet(c.staleQuestions.map((x) => `Stale question: ${x.question_text}`)));
  lines.push("\nReply to the poll to mark them resolved.");
  return lines.join("\n");
}
