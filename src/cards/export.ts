import { CARD_HEAD } from "./theme";

/**
 * Spectrum has no outbound file-attachment API (verified against
 * docs.photon.codes "Events": attachments are metadata-only and there's no
 * documented way to *send* a file, only receive one) — so "export my data"
 * can't literally deliver a downloadable file over iMessage. This renders
 * the same export as a live card instead: a real, complete JSON dump of
 * everything ECHO holds for you, viewable and copyable from the card.
 */
export function renderExportCard(data: unknown): string {
  const json = JSON.stringify(data, null, 2).replace(/</g, "&lt;");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>ECHO — Your Data Export</title>
${CARD_HEAD}
<style>
  body { padding: 18px 16px; }
  h1 { font-size: 17px; margin: 0 0 4px; }
  p { margin: 0 0 14px; font-size: 12px; color: var(--muted-foreground); }
  pre {
    background: var(--card); border: 1px solid var(--border); border-radius: 14px;
    padding: 14px; font-size: 11px; line-height: 1.5; overflow-x: auto;
    font-family: "JetBrains Mono", ui-monospace, monospace; color: #E2E8F0;
    white-space: pre-wrap; word-break: break-word;
  }
  button {
    margin-top: 12px; width: 100%; min-height: 44px; border-radius: 12px; border: none;
    background: var(--primary); color: white; font-family: "Space Grotesk", sans-serif;
    font-weight: 700; font-size: 14px; cursor: pointer;
  }
  #status { margin-top: 8px; font-size: 12px; color: var(--accent); min-height: 16px; }
</style>
</head>
<body>
  <h1>Your data export</h1>
  <p>Everything ECHO currently holds for you — memories, commitments, events, decisions, watches.</p>
  <pre id="dump">${json}</pre>
  <button id="copy">Copy JSON</button>
  <div id="status"></div>
  <script>
    document.getElementById("copy").addEventListener("click", function () {
      navigator.clipboard.writeText(document.getElementById("dump").textContent).then(function () {
        document.getElementById("status").textContent = "Copied to clipboard.";
      });
    });
  </script>
</body>
</html>`;
}
