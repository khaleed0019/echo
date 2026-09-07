// Shared design tokens for ECHO's live iMessage App cards (the knowledge graph
// and the daily-brief dashboard). From ui-ux-pro-max --design-system searches:
// palette = the "Photo Editor & Filters" AI-dark match (violet/indigo primary,
// cyan accent, navy surfaces); type pairing = "Tech Startup" (Space Grotesk /
// DM Sans, explicitly tagged for AI products).
export const CARD_HEAD = `
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
<style>
  :root {
    color-scheme: dark;
    --primary: #7C3AED;
    --secondary: #6366F1;
    --accent: #0891B2;
    --background: #0F172A;
    --card: #192134;
    --muted: #171939;
    --muted-foreground: #94A3B8;
    --border: rgba(255,255,255,0.08);
    --destructive: #DC2626;
    --success: #22C55E;
  }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html, body { height: 100%; }
  body {
    margin: 0;
    background:
      radial-gradient(circle at 15% 0%, rgba(124,58,237,0.25), transparent 55%),
      radial-gradient(circle at 85% 100%, rgba(8,145,178,0.2), transparent 55%),
      var(--background);
    color: #F8FAFC;
    font-family: "DM Sans", -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  h1, h2, h3, .display { font-family: "Space Grotesk", sans-serif; }
  .glass {
    background: rgba(25, 33, 52, 0.72);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid var(--border);
    border-radius: 20px;
  }
  ::selection { background: rgba(124,58,237,0.35); }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: 0.001ms !important; transition-duration: 0.001ms !important; }
  }
</style>
`;
