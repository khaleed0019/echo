import { CARD_HEAD } from "./theme";

export type OrbState = "listening" | "thinking" | "working" | "remembering" | "completed" | "alert";

const STATE: Record<OrbState, { label: string; color: string; glow: string; icon: string; speed: string }> = {
  listening: { label: "Listening", color: "#0891B2", glow: "8,145,178", icon: '<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>', speed: "3.4s" },
  thinking: { label: "Thinking", color: "#7C3AED", glow: "124,58,237", icon: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>', speed: "1.6s" },
  working: { label: "Working", color: "#6366F1", glow: "99,102,241", icon: '<path d="M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z"/><path d="M12 8v4l3 2"/>', speed: "1.1s" },
  remembering: { label: "Remembering", color: "#EC4899", glow: "236,72,153", icon: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/>', speed: "2.8s" },
  completed: { label: "Done", color: "#22C55E", glow: "34,197,94", icon: '<path d="M20 6 9 17l-5-5"/>', speed: "0s" },
  alert: { label: "Needs attention", color: "#EF4444", glow: "239,68,68", icon: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/>', speed: "1s" },
};

/**
 * ECHO's signature visual identity, per the product brief. Six states,
 * shared color/animation language across every surface. Beyond a standalone
 * status card, this doubles as the "instant feedback" screen: index.ts sends
 * this immediately (state=thinking), then edit()s the same card in place —
 * a verified Spectrum capability (docs.photon.codes "App" content: an
 * iMessage App card sent through @spectrum-ts/imessage can be updated
 * without a second bubble) — into the real content once it's ready. The
 * card doesn't wait on itself; it's replaced from outside.
 */
export function renderOrbCard(state: OrbState, message?: string): string {
  const s = STATE[state];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>ECHO — ${s.label}</title>
${CARD_HEAD}
<style>
  body { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; gap: 22px; }
  .orb-wrap { position: relative; width: 140px; height: 140px; display: flex; align-items: center; justify-content: center; }
  .ring {
    position: absolute; inset: 0; border-radius: 50%;
    background: radial-gradient(circle, rgba(${s.glow},0.35), transparent 70%);
    animation: pulse ${s.speed} ease-in-out infinite;
  }
  .orb {
    position: relative; width: 84px; height: 84px; border-radius: 50%;
    background: radial-gradient(circle at 35% 30%, ${s.color}, ${s.color}cc 55%, #05070c 130%);
    box-shadow: 0 0 40px rgba(${s.glow},0.55), inset 0 0 20px rgba(255,255,255,0.15);
    display: flex; align-items: center; justify-content: center;
    animation: breathe ${s.speed} ease-in-out infinite;
  }
  .orb svg { width: 30px; height: 30px; color: white; opacity: 0.95; }
  @keyframes pulse { 0%,100% { transform: scale(1); opacity: 0.7; } 50% { transform: scale(1.25); opacity: 1; } }
  @keyframes breathe { 0%,100% { transform: scale(1); } 50% { transform: scale(1.06); } }
  .label { font-family: "Space Grotesk", sans-serif; font-weight: 700; font-size: 15px; letter-spacing: 0.02em; color: ${s.color}; }
  .message { font-size: 13px; color: var(--muted-foreground); text-align: center; max-width: 260px; }
  @media (prefers-reduced-motion: reduce) {
    .ring, .orb { animation: none; }
  }
</style>
</head>
<body>
  <div class="orb-wrap">
    <div class="ring"></div>
    <div class="orb">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${s.icon}</svg>
    </div>
  </div>
  <div class="label">${s.label}${state === "completed" || state === "alert" ? "" : "&hellip;"}</div>
  ${message ? `<div class="message">${message}</div>` : ""}
</body>
</html>`;
}
