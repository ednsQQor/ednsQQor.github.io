(function () {
  "use strict";

  var dataEl = document.getElementById("graph-data");
  var canvas = document.getElementById("graph-canvas");
  var tooltip = document.getElementById("graph-tooltip");
  var emptyMsg = document.getElementById("graph-empty");
  if (!dataEl || !canvas) return;

  var data;
  try {
    data = JSON.parse(dataEl.textContent);
  } catch (e) {
    return;
  }

  var nodes = data.nodes || [];
  var edges = data.edges || [];

  if (nodes.length < 2) {
    canvas.hidden = true;
    if (emptyMsg) emptyMsg.hidden = false;
    return;
  }

  // ------------------------------------------------------------------
  // Theme colors, read from CSS custom properties (single source of truth).
  // ------------------------------------------------------------------
  var css = getComputedStyle(document.documentElement);
  var COLOR = {
    text: css.getPropertyValue("--text").trim() || "#e8e8e8",
    textMuted: css.getPropertyValue("--text-muted").trim() || "#8a8a8a",
    hairline: css.getPropertyValue("--hairline-strong").trim() || "#343434",
    accent: css.getPropertyValue("--accent").trim() || "#e03e3e",
    surface: css.getPropertyValue("--surface").trim() || "#161616",
    bg: css.getPropertyValue("--bg").trim() || "#0f0f0f"
  };
  // Canvas's `font` property can't parse CSS var() — resolve the real stack.
  var FONT_FAMILY = css.getPropertyValue("--font-body").trim() || "sans-serif";

  // ------------------------------------------------------------------
  // Build adjacency + degree (drives node size and hover highlighting).
  // ------------------------------------------------------------------
  var byId = {};
  nodes.forEach(function (n) {
    n.degree = 0;
    n.neighbors = [];
    byId[n.id] = n;
  });
  var validEdges = [];
  edges.forEach(function (e) {
    var a = byId[e.source];
    var b = byId[e.target];
    if (!a || !b) return;
    a.degree++;
    b.degree++;
    a.neighbors.push(b.id);
    b.neighbors.push(a.id);
    validEdges.push(e);
  });

  // ------------------------------------------------------------------
  // Canvas setup (device-pixel-ratio aware).
  // ------------------------------------------------------------------
  var ctx = canvas.getContext("2d");
  var dpr = window.devicePixelRatio || 1;
  var width = 0;
  var height = 0;

  function resize() {
    var rect = canvas.parentElement.getBoundingClientRect();
    width = rect.width;
    height = Math.max(420, Math.min(680, window.innerHeight * 0.65));
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ------------------------------------------------------------------
  // Initial positions: spread out on a circle so the simulation doesn't
  // start from a degenerate single point.
  // ------------------------------------------------------------------
  resize();
  nodes.forEach(function (n, i) {
    var angle = (i / nodes.length) * Math.PI * 2;
    var r = Math.min(width, height) * 0.32;
    n.x = width / 2 + Math.cos(angle) * r + (Math.random() - 0.5) * 20;
    n.y = height / 2 + Math.sin(angle) * r + (Math.random() - 0.5) * 20;
    n.vx = 0;
    n.vy = 0;
    n.radius = n.type === "writeup" ? 9 + Math.min(n.degree, 6) * 1.3 : 5 + Math.min(n.degree, 8);
  });

  // ------------------------------------------------------------------
  // Force-directed simulation step (Fruchterman-Reingold-ish).
  // ------------------------------------------------------------------
  var AREA_K = Math.sqrt((width * height) / Math.max(nodes.length, 1)) * 0.9;

  function step() {
    // repulsion between every pair
    for (var i = 0; i < nodes.length; i++) {
      for (var j = i + 1; j < nodes.length; j++) {
        var a = nodes[i], b = nodes[j];
        var dx = a.x - b.x, dy = a.y - b.y;
        var dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        var force = (AREA_K * AREA_K) / dist;
        var fx = (dx / dist) * force;
        var fy = (dy / dist) * force;
        a.vx += fx * 0.02;
        a.vy += fy * 0.02;
        b.vx -= fx * 0.02;
        b.vy -= fy * 0.02;
      }
    }
    // attraction along edges
    validEdges.forEach(function (e) {
      var a = byId[e.source], b = byId[e.target];
      var dx = a.x - b.x, dy = a.y - b.y;
      var dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      var force = (dist * dist) / AREA_K;
      var fx = (dx / dist) * force;
      var fy = (dy / dist) * force;
      a.vx -= fx * 0.02;
      a.vy -= fy * 0.02;
      b.vx += fx * 0.02;
      b.vy += fy * 0.02;
    });
    // gentle centering + integrate + damping
    nodes.forEach(function (n) {
      if (n.fixed) return;
      n.vx += (width / 2 - n.x) * 0.0006;
      n.vy += (height / 2 - n.y) * 0.0006;
      n.vx *= 0.82;
      n.vy *= 0.82;
      n.x += n.vx;
      n.y += n.vy;
      var pad = n.radius + 16;
      n.x = Math.max(pad, Math.min(width - pad, n.x));
      n.y = Math.max(pad, Math.min(height - pad, n.y));
    });
  }

  // Pre-settle synchronously so there's no jarring reveal animation.
  for (var s = 0; s < 220; s++) step();

  // ------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------
  var hovered = null;

  function draw() {
    ctx.clearRect(0, 0, width, height);

    var activeSet = null;
    if (hovered) {
      activeSet = {};
      activeSet[hovered.id] = true;
      hovered.neighbors.forEach(function (id) { activeSet[id] = true; });
    }

    // edges
    validEdges.forEach(function (e) {
      var a = byId[e.source], b = byId[e.target];
      var dim = activeSet && !(activeSet[a.id] && activeSet[b.id]);
      ctx.strokeStyle = COLOR.hairline;
      ctx.globalAlpha = dim ? 0.15 : 0.55;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;

    // nodes
    nodes.forEach(function (n) {
      var dim = activeSet && !activeSet[n.id];
      var isWriteup = n.type === "writeup";
      var isActive = n === hovered;
      ctx.globalAlpha = dim ? 0.3 : 1;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
      ctx.fillStyle = isWriteup ? COLOR.surface : COLOR.bg;
      ctx.fill();
      ctx.lineWidth = isActive ? 2.5 : (isWriteup ? 2 : 1.5);
      ctx.strokeStyle = isActive ? COLOR.accent : (isWriteup ? COLOR.accent : COLOR.hairline);
      ctx.stroke();

      ctx.font = (isWriteup ? "600 13px " : "12px ") + FONT_FAMILY;
      ctx.fillStyle = isActive ? COLOR.accent : (isWriteup ? COLOR.text : COLOR.textMuted);
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(n.label, n.x, n.y + n.radius + 4);
      ctx.globalAlpha = 1;
    });
  }

  draw();

  // ------------------------------------------------------------------
  // Interaction: hover highlight + tooltip, drag to reposition,
  // click a writeup node to navigate. Motion only happens in direct
  // response to user action (drag), never auto-plays.
  // ------------------------------------------------------------------
  var dragging = null;
  var dragMoved = false;
  var rafPending = false;

  function nodeAt(px, py) {
    for (var i = nodes.length - 1; i >= 0; i--) {
      var n = nodes[i];
      var dx = px - n.x, dy = py - n.y;
      if (dx * dx + dy * dy <= (n.radius + 4) * (n.radius + 4)) return n;
    }
    return null;
  }

  function pointerPos(evt) {
    var rect = canvas.getBoundingClientRect();
    var clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
    var clientY = evt.touches ? evt.touches[0].clientY : evt.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function runDragFrame() {
    if (!dragging) { rafPending = false; return; }
    for (var i = 0; i < 3; i++) step();
    draw();
    rafPending = true;
    requestAnimationFrame(runDragFrame);
  }

  canvas.addEventListener("mousedown", function (evt) {
    var p = pointerPos(evt);
    var n = nodeAt(p.x, p.y);
    if (!n) return;
    dragging = n;
    dragMoved = false;
    n.fixed = true;
    if (!rafPending) requestAnimationFrame(runDragFrame);
  });

  window.addEventListener("mousemove", function (evt) {
    var p = pointerPos(evt);

    if (dragging) {
      dragging.x = p.x;
      dragging.y = p.y;
      dragging.vx = 0;
      dragging.vy = 0;
      dragMoved = true;
      return;
    }

    if (p.x < 0 || p.y < 0 || p.x > width || p.y > height) {
      if (hovered) { hovered = null; draw(); }
      if (tooltip) tooltip.hidden = true;
      canvas.style.cursor = "default";
      return;
    }

    var n = nodeAt(p.x, p.y);
    if (n !== hovered) {
      hovered = n;
      draw();
    }
    canvas.style.cursor = n ? "pointer" : "default";

    if (n && tooltip) {
      tooltip.hidden = false;
      tooltip.textContent = n.type === "writeup" ? n.label + " (" + n.kind + ")" : n.label;
      tooltip.style.left = p.x + 14 + "px";
      tooltip.style.top = p.y + 10 + "px";
    } else if (tooltip) {
      tooltip.hidden = true;
    }
  });

  window.addEventListener("mouseup", function () {
    if (!dragging) return;
    var n = dragging;
    var moved = dragMoved;
    n.fixed = false;
    dragging = null;
    for (var i = 0; i < 40; i++) step();
    draw();
    if (!moved && n.type === "writeup" && n.url) {
      window.location.href = n.url;
    }
  });

  window.addEventListener("resize", function () {
    var prevW = width, prevH = height;
    resize();
    var sx = width / prevW, sy = height / prevH;
    nodes.forEach(function (n) { n.x *= sx; n.y *= sy; });
    draw();
  });
})();
