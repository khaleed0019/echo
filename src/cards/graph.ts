import { CARD_HEAD } from "./theme";
import type { GraphEdge, GraphNode } from "../queries";

const TYPE_STYLE: Record<GraphNode["type"], { color: string; radius: number; label: string }> = {
  person: { color: "#6366F1", radius: 16, label: "Person" },
  thread: { color: "#7C3AED", radius: 13, label: "Conversation" },
  commitment: { color: "#0891B2", radius: 7, label: "Commitment" },
  event: { color: "#F59E0B", radius: 8, label: "Event" },
  decision: { color: "#EC4899", radius: 8, label: "Decision" },
};

export function renderGraphCard(nodes: GraphNode[], edges: GraphEdge[]): string {
  const payload = JSON.stringify({ nodes, edges });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>ECHO — Your Knowledge Graph</title>
${CARD_HEAD}
<style>
  body { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
  header { padding: 16px 18px 10px; flex-shrink: 0; }
  header h1 { margin: 0; font-size: 17px; font-weight: 700; }
  header p { margin: 3px 0 0; font-size: 12px; color: var(--muted-foreground); }
  #wrap { position: relative; flex: 1; min-height: 0; }
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; }
  .legend {
    position: absolute; left: 12px; bottom: 12px;
    display: flex; flex-wrap: wrap; gap: 6px;
    max-width: calc(100% - 24px);
  }
  .legend span {
    display: inline-flex; align-items: center; gap: 5px;
    font-size: 10px; color: var(--muted-foreground);
    background: rgba(15,23,42,0.6); border: 1px solid var(--border);
    border-radius: 999px; padding: 4px 9px;
  }
  .legend i { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
  #detail {
    position: absolute; right: 12px; top: 12px; max-width: 220px;
    padding: 12px 14px; font-size: 12px; line-height: 1.4;
    opacity: 0; transform: translateY(-6px);
    transition: opacity 0.2s ease, transform 0.2s ease;
    pointer-events: none;
  }
  #detail.show { opacity: 1; transform: translateY(0); }
  #detail .kind { color: var(--muted-foreground); text-transform: uppercase; font-size: 9px; letter-spacing: 0.08em; margin-bottom: 3px; }
  #hint { position: absolute; left: 12px; top: 12px; font-size: 11px; color: var(--muted-foreground); }
</style>
</head>
<body>
  <header>
    <h1>Your Knowledge Graph</h1>
    <p>People, conversations, commitments, events &amp; decisions — drag to explore</p>
  </header>
  <div id="wrap">
    <canvas id="c"></canvas>
    <div id="hint">Drag nodes &middot; tap for details</div>
    <div id="detail" class="glass"></div>
    <div class="legend">
      ${Object.entries(TYPE_STYLE)
        .map(([, s]) => `<span><i style="background:${s.color}"></i>${s.label}</span>`)
        .join("")}
    </div>
  </div>

<script>
(function () {
  var DATA = ${payload};
  var STYLE = ${JSON.stringify(TYPE_STYLE)};
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var canvas = document.getElementById("c");
  var ctx = canvas.getContext("2d");
  var wrap = document.getElementById("wrap");
  var detailEl = document.getElementById("detail");
  var dpr = Math.min(window.devicePixelRatio || 1, 2);

  function resize() {
    var r = wrap.getBoundingClientRect();
    canvas.width = r.width * dpr;
    canvas.height = r.height * dpr;
    canvas.style.width = r.width + "px";
    canvas.style.height = r.height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w: r.width, h: r.height };
  }
  var size = resize();
  addEventListener("resize", function () { size = resize(); });

  var idIndex = {};
  var nodes = DATA.nodes.map(function (n, i) {
    var angle = (i / DATA.nodes.length) * Math.PI * 2;
    var node = {
      id: n.id, label: n.label, type: n.type,
      x: size.w / 2 + Math.cos(angle) * 80, y: size.h / 2 + Math.sin(angle) * 80,
      vx: 0, vy: 0,
    };
    idIndex[n.id] = node;
    return node;
  });
  var edges = DATA.edges
    .map(function (e) { return { a: idIndex[e.source], b: idIndex[e.target] }; })
    .filter(function (e) { return e.a && e.b; });

  function step() {
    var centerX = size.w / 2, centerY = size.h / 2;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.dragging) continue;
      for (var j = i + 1; j < nodes.length; j++) {
        var m = nodes[j];
        if (m.dragging) continue;
        var dx = n.x - m.x, dy = n.y - m.y;
        var distSq = Math.max(dx * dx + dy * dy, 25);
        var force = 900 / distSq;
        var dist = Math.sqrt(distSq);
        var fx = (dx / dist) * force, fy = (dy / dist) * force;
        n.vx += fx; n.vy += fy;
        m.vx -= fx; m.vy -= fy;
      }
      n.vx += (centerX - n.x) * 0.001;
      n.vy += (centerY - n.y) * 0.001;
    }
    edges.forEach(function (e) {
      var dx = e.b.x - e.a.x, dy = e.b.y - e.a.y;
      var dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      var rest = 70;
      var force = (dist - rest) * 0.02;
      var fx = (dx / dist) * force, fy = (dy / dist) * force;
      if (!e.a.dragging) { e.a.vx += fx; e.a.vy += fy; }
      if (!e.b.dragging) { e.b.vx -= fx; e.b.vy -= fy; }
    });
    nodes.forEach(function (n) {
      if (n.dragging) return;
      n.vx *= 0.82; n.vy *= 0.82;
      n.x += n.vx; n.y += n.vy;
      n.x = Math.max(14, Math.min(size.w - 14, n.x));
      n.y = Math.max(14, Math.min(size.h - 14, n.y));
    });
  }

  function draw() {
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.lineWidth = 1;
    edges.forEach(function (e) {
      ctx.strokeStyle = "rgba(148,163,184,0.18)";
      ctx.beginPath();
      ctx.moveTo(e.a.x, e.a.y);
      ctx.lineTo(e.b.x, e.b.y);
      ctx.stroke();
    });
    nodes.forEach(function (n) {
      var s = STYLE[n.type];
      ctx.beginPath();
      ctx.arc(n.x, n.y, s.radius, 0, Math.PI * 2);
      ctx.fillStyle = s.color;
      ctx.globalAlpha = n.type === "person" || n.type === "thread" ? 1 : 0.85;
      ctx.fill();
      ctx.globalAlpha = 1;
      if (n === selected) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#F8FAFC";
        ctx.stroke();
      }
    });
  }

  var settleFrames = reduceMotion ? 400 : 0;
  function loop() {
    step();
    draw();
    if (reduceMotion) {
      if (settleFrames-- > 0) requestAnimationFrame(loop);
    } else {
      requestAnimationFrame(loop);
    }
  }
  loop();

  // --- pointer interaction: drag + tap-for-details ---
  var selected = null;
  var dragging = null;

  function pos(evt) {
    var r = canvas.getBoundingClientRect();
    var t = evt.touches ? evt.touches[0] : evt;
    return { x: t.clientX - r.left, y: t.clientY - r.top };
  }
  function hitTest(p) {
    for (var i = nodes.length - 1; i >= 0; i--) {
      var n = nodes[i];
      var s = STYLE[n.type];
      var dx = p.x - n.x, dy = p.y - n.y;
      if (dx * dx + dy * dy <= (s.radius + 6) * (s.radius + 6)) return n;
    }
    return null;
  }
  function showDetail(n) {
    selected = n;
    if (!n) { detailEl.classList.remove("show"); return; }
    var s = STYLE[n.type];
    detailEl.innerHTML = '<div class="kind" style="color:' + s.color + '">' + s.label + '</div>' + n.label;
    detailEl.classList.add("show");
  }

  function start(evt) {
    var p = pos(evt);
    var n = hitTest(p);
    if (n) { n.dragging = true; dragging = n; showDetail(n); evt.preventDefault(); }
    else showDetail(null);
  }
  function move(evt) {
    if (!dragging) return;
    var p = pos(evt);
    dragging.x = p.x; dragging.y = p.y; dragging.vx = 0; dragging.vy = 0;
    if (reduceMotion) draw();
    evt.preventDefault();
  }
  function end() {
    if (dragging) dragging.dragging = false;
    dragging = null;
  }

  canvas.addEventListener("mousedown", start);
  canvas.addEventListener("mousemove", move);
  addEventListener("mouseup", end);
  canvas.addEventListener("touchstart", start, { passive: false });
  canvas.addEventListener("touchmove", move, { passive: false });
  canvas.addEventListener("touchend", end);
})();
</script>
</body>
</html>`;
}
