// Drawing tools: rendering + hit testing. Coordinates: drawing points are stored as {t: time(ms), p: price};
// the chart passes a helper `X` that converts between data space and canvas pixels.

const DASH = { solid: [], dashed: [6, 4], dotted: [2, 3] };
const TOL = 6;

export function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay; const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function distRay(px, py, a, b, both) {
  const dx = b.x - a.x, dy = b.y - a.y; const l2 = dx * dx + dy * dy; if (!l2) return Math.hypot(px - a.x, py - a.y);
  let t = ((px - a.x) * dx + (py - a.y) * dy) / l2; if (!both && t < 0) t = 0;
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}
function extend(a, b, k = 4000) {
  const dx = b.x - a.x, dy = b.y - a.y; const len = Math.hypot(dx, dy) || 1;
  return { x: b.x + (dx / len) * k, y: b.y + (dy / len) * k };
}
function alpha(color, a) {
  if (!color) return `rgba(41,98,255,${a})`;
  if (color.startsWith('#')) {
    let c = color.slice(1); if (c.length === 3) c = c.split('').map((x) => x + x).join('');
    const n = parseInt(c.slice(0, 6), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  return color.replace(/rgba?\(([^)]+)\)/, (m, g) => { const p = g.split(',').slice(0, 3); return `rgba(${p.join(',')},${a})`; });
}
function stroke(ctx, d, w) {
  ctx.strokeStyle = d.style.color; ctx.lineWidth = w ?? d.style.width ?? 1; ctx.setLineDash(DASH[d.style.dash] || []);
}
function line(ctx, a, b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
function arrowHead(ctx, a, b, size = 9) {
  const ang = Math.atan2(b.y - a.y, b.x - a.x); ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x - size * Math.cos(ang - 0.4), b.y - size * Math.sin(ang - 0.4));
  ctx.lineTo(b.x - size * Math.cos(ang + 0.4), b.y - size * Math.sin(ang + 0.4));
  ctx.closePath(); ctx.fillStyle = ctx.strokeStyle; ctx.fill();
}
export function label(ctx, text, x, y, { bg, color = '#fff', align = 'center', base = 'middle', pad = 4, font = '11px Inter, system-ui, sans-serif', radius = 3 } = {}) {
  ctx.font = font; ctx.setLineDash([]);
  const lines = String(text).split('\n');
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2; const lh = 15; const hgt = lines.length * lh + pad;
  let bx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  let by = base === 'middle' ? y - hgt / 2 : base === 'bottom' ? y - hgt : y;
  if (bg) { ctx.fillStyle = bg; roundRect(ctx, bx, by, w, hgt, radius); ctx.fill(); }
  ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, bx + pad, by + pad / 2 + lh * i + lh / 2));
  return { x: bx, y: by, w, h: hgt };
}
export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
const inRect = (x, y, r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
const rectOf = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) });

// 8 resize handles (4 corners + 4 edge midpoints) for box-shaped tools (rectangle, ellipse)
const BOX_L = [0, 3, 7], BOX_R = [1, 2, 5], BOX_T = [0, 1, 4], BOX_B = [2, 3, 6];
const boxAnchors = (X, d) => {
  const r = rectOf(...d.pts.map(X.px)); const x1 = r.x + r.w, y1 = r.y + r.h, mx = r.x + r.w / 2, my = r.y + r.h / 2;
  return [{ x: r.x, y: r.y }, { x: x1, y: r.y }, { x: x1, y: y1 }, { x: r.x, y: y1 }, { x: mx, y: r.y }, { x: x1, y: my }, { x: mx, y: y1 }, { x: r.x, y: my }];
};
const boxMoveAnchor = (d, i, pt) => {
  let tMin = Math.min(d.pts[0].t, d.pts[1].t), tMax = Math.max(d.pts[0].t, d.pts[1].t);
  let pMin = Math.min(d.pts[0].p, d.pts[1].p), pMax = Math.max(d.pts[0].p, d.pts[1].p);
  if (BOX_L.includes(i)) tMin = Math.min(pt.t, tMax);
  if (BOX_R.includes(i)) tMax = Math.max(pt.t, tMin);
  if (BOX_T.includes(i)) pMax = Math.max(pt.p, pMin);
  if (BOX_B.includes(i)) pMin = Math.min(pt.p, pMax);
  d.pts = [{ t: tMin, p: pMax }, { t: tMax, p: pMin }];
};
const pct = (a, b) => ((b - a) / a) * 100;

export const FIB_LEVELS = [
  { l: 0, c: '#787b86' }, { l: 0.236, c: '#f23645' }, { l: 0.382, c: '#ff9800' }, { l: 0.5, c: '#4caf50' }, { l: 0.618, c: '#089981' },
  { l: 0.786, c: '#00bcd4' }, { l: 1, c: '#787b86' }, { l: 1.618, c: '#2962ff' }, { l: 2.618, c: '#f23645' }, { l: 3.618, c: '#9c27b0' },
];
const FIB_EXT = [0, 0.382, 0.618, 1, 1.272, 1.618, 2, 2.618];
const FIB_TIME = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89];

// generic two-point line drawer with extension
function drawLineTool(ctx, X, d, extL, extR) {
  const [a, b] = d.pts.map(X.px); stroke(ctx, d);
  const s = extL ? extend(b, a) : a, e = extR ? extend(a, b) : b;
  line(ctx, s, e);
  if (d.style.text) label(ctx, d.style.text, (a.x + b.x) / 2, (a.y + b.y) / 2 - 12, { color: d.style.color, bg: 'rgba(9, 12, 26, 0.78)', font: '700 10px Inter, system-ui, sans-serif' });
  return [a, b];
}
function hitLineTool(X, d, x, y, extL, extR) {
  const [a, b] = d.pts.map(X.px);
  if (extL && extR) return distRay(x, y, a, b, true) < TOL;
  if (extR) return distRay(x, y, a, b, false) < TOL;
  if (extL) return distRay(x, y, b, a, false) < TOL;
  return distSeg(x, y, a.x, a.y, b.x, b.y) < TOL;
}
function textBox(ctx, X, d, p) {
  const fs = d.style.fontSize || 14;
  return label(ctx, d.style.text || 'Text', p.x, p.y, { font: `${d.style.bold ? 'bold ' : ''}${fs}px Inter, system-ui, sans-serif`, color: d.style.color, bg: d.style.bg || null, align: 'left', base: 'bottom', pad: 4 });
}

// ------------------------------------------------------------------------------------- tools
export const TOOLS = {
  trend: {
    name: 'Trend Line', npts: 2,
    draw(ctx, X, d) {
      const [a, b] = drawLineTool(ctx, X, d, d.style.extendLeft, d.style.extendRight);
      if (d.style.showStats) {
        const p0 = d.pts[0].p, p1 = d.pts[1].p, bars = Math.round(X.idx(d.pts[1].t) - X.idx(d.pts[0].t));
        label(ctx, `${X.fmt(p1 - p0)} (${pct(p0, p1).toFixed(2)}%)  ${bars} bars`, b.x, b.y - 14, { bg: alpha(d.style.color, 0.85) });
      }
    },
    hit: (X, d, x, y) => hitLineTool(X, d, x, y, d.style.extendLeft, d.style.extendRight),
  },
  ray: { name: 'Ray', npts: 2, draw: (ctx, X, d) => drawLineTool(ctx, X, d, false, true), hit: (X, d, x, y) => hitLineTool(X, d, x, y, false, true) },
  extended: { name: 'Extended Line', npts: 2, draw: (ctx, X, d) => drawLineTool(ctx, X, d, true, true), hit: (X, d, x, y) => hitLineTool(X, d, x, y, true, true) },
  arrowline: {
    name: 'Arrow', npts: 2,
    draw(ctx, X, d) { const [a, b] = drawLineTool(ctx, X, d, false, false); arrowHead(ctx, a, b, 8 + (d.style.width || 1) * 2); },
    hit: (X, d, x, y) => hitLineTool(X, d, x, y),
  },
  infoline: {
    name: 'Info Line', npts: 2,
    draw(ctx, X, d) {
      const [a, b] = drawLineTool(ctx, X, d, false, false);
      const p0 = d.pts[0].p, p1 = d.pts[1].p, bars = Math.round(X.idx(d.pts[1].t) - X.idx(d.pts[0].t));
      const ang = (Math.atan2(a.y - b.y, b.x - a.x) * 180) / Math.PI;
      label(ctx, `${X.fmt(p1 - p0)} (${pct(p0, p1).toFixed(2)}%)\n${bars} bars, ${X.span(d.pts[0].t, d.pts[1].t)}\n∠ ${ang.toFixed(1)}°`, (a.x + b.x) / 2, Math.min(a.y, b.y) - 30, { bg: 'rgba(30,34,45,0.9)' });
    },
    hit: (X, d, x, y) => hitLineTool(X, d, x, y),
  },
  hline: {
    name: 'Horizontal Line', npts: 1,
    draw(ctx, X, d) {
      const a = X.px(d.pts[0]); stroke(ctx, d); line(ctx, { x: 0, y: a.y }, { x: X.W, y: a.y });
      if (d.style.text) label(ctx, d.style.text, X.W - 8, a.y - 10, { color: d.style.color, align: 'right' });
    },
    hit: (X, d, x, y) => Math.abs(X.px(d.pts[0]).y - y) < TOL,
    axis: (d) => [{ p: d.pts[0].p }],
  },
  hray: {
    name: 'Horizontal Ray', npts: 1,
    draw(ctx, X, d) { const a = X.px(d.pts[0]); stroke(ctx, d); line(ctx, a, { x: X.W, y: a.y }); },
    hit(X, d, x, y) { const a = X.px(d.pts[0]); return x >= a.x - TOL && Math.abs(a.y - y) < TOL; },
    axis: (d) => [{ p: d.pts[0].p }],
  },
  vline: {
    name: 'Vertical Line', npts: 1,
    draw(ctx, X, d) { const a = X.px(d.pts[0]); stroke(ctx, d); line(ctx, { x: a.x, y: X.top }, { x: a.x, y: X.bottom }); },
    hit: (X, d, x) => Math.abs(X.px(d.pts[0]).x - x) < TOL,
    axis: (d) => [{ t: d.pts[0].t }],
  },
  crossline: {
    name: 'Cross Line', npts: 1,
    draw(ctx, X, d) { const a = X.px(d.pts[0]); stroke(ctx, d); line(ctx, { x: a.x, y: X.top }, { x: a.x, y: X.bottom }); line(ctx, { x: 0, y: a.y }, { x: X.W, y: a.y }); },
    hit(X, d, x, y) { const a = X.px(d.pts[0]); return Math.abs(a.x - x) < TOL || Math.abs(a.y - y) < TOL; },
    axis: (d) => [{ p: d.pts[0].p }, { t: d.pts[0].t }],
  },
  channel: {
    name: 'Parallel Channel', npts: 3,
    geom(X, d) {
      const [a, b, c] = d.pts.map(X.px);
      if (!c) return { a, b, a2: a, b2: b };
      const yOn = b.x === a.x ? a.y : a.y + ((c.x - a.x) * (b.y - a.y)) / (b.x - a.x);
      const off = c.y - yOn;
      return { a, b, a2: { x: a.x, y: a.y + off }, b2: { x: b.x, y: b.y + off } };
    },
    draw(ctx, X, d) {
      const g = this.geom(X, d);
      ctx.fillStyle = alpha(d.style.color, 0.1);
      ctx.beginPath(); ctx.moveTo(g.a.x, g.a.y); ctx.lineTo(g.b.x, g.b.y); ctx.lineTo(g.b2.x, g.b2.y); ctx.lineTo(g.a2.x, g.a2.y); ctx.closePath(); ctx.fill();
      stroke(ctx, d); line(ctx, g.a, g.b); line(ctx, g.a2, g.b2);
      ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
      line(ctx, { x: g.a.x, y: (g.a.y + g.a2.y) / 2 }, { x: g.b.x, y: (g.b.y + g.b2.y) / 2 });
    },
    hit(X, d, x, y) {
      const g = this.geom(X, d);
      return distSeg(x, y, g.a.x, g.a.y, g.b.x, g.b.y) < TOL || distSeg(x, y, g.a2.x, g.a2.y, g.b2.x, g.b2.y) < TOL;
    },
  },
  pitchfork: {
    name: 'Pitchfork', npts: 3,
    draw(ctx, X, d) {
      const [a, b, c] = d.pts.map(X.px); stroke(ctx, d);
      if (!c) { line(ctx, a, b); return; }
      const m = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 };
      const dir = { x: m.x - a.x, y: m.y - a.y };
      const far = (p) => ({ x: p.x + dir.x * 50, y: p.y + dir.y * 50 });
      ctx.fillStyle = alpha(d.style.color, 0.08);
      ctx.beginPath(); ctx.moveTo(b.x, b.y); const fb = far(b), fc = far(c); ctx.lineTo(fb.x, fb.y); ctx.lineTo(fc.x, fc.y); ctx.lineTo(c.x, c.y); ctx.closePath(); ctx.fill();
      line(ctx, a, far(m)); line(ctx, b, fb); line(ctx, c, fc); line(ctx, b, c);
    },
    hit(X, d, x, y) {
      const [a, b, c] = d.pts.map(X.px); if (!c) return distSeg(x, y, a.x, a.y, b.x, b.y) < TOL;
      const m = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 };
      const dir = { x: m.x - a.x, y: m.y - a.y };
      return [a, b, c].some((p, i) => distRay(x, y, i ? p : a, i ? { x: p.x + dir.x, y: p.y + dir.y } : m, false) < TOL) || distSeg(x, y, b.x, b.y, c.x, c.y) < TOL;
    },
  },
  fib: {
    name: 'Fib Retracement', npts: 2,
    draw(ctx, X, d) {
      const [a, b] = d.pts.map(X.px); const p0 = d.pts[0].p, p1 = d.pts[1].p;
      const x0 = Math.min(a.x, b.x), x1 = d.style.extendRight ? X.W : Math.max(a.x, b.x);
      const lv = FIB_LEVELS.filter((f) => f.l <= (d.style.fibMax ?? 1.618));
      let prevY = null;
      lv.forEach((f) => {
        const y = X.p2y(p1 + (p0 - p1) * f.l);
        if (prevY != null && d.style.fill !== false) { ctx.fillStyle = alpha(f.c, 0.08); ctx.fillRect(x0, Math.min(y, prevY), x1 - x0, Math.abs(y - prevY)); }
        prevY = y;
        ctx.strokeStyle = f.c; ctx.lineWidth = 1; ctx.setLineDash([]); line(ctx, { x: x0, y }, { x: x1, y });
        ctx.font = '11px Inter, system-ui, sans-serif'; ctx.fillStyle = f.c; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
        ctx.fillText(`${f.l} (${X.fmt(p1 + (p0 - p1) * f.l)})`, x0 - 4, y + 5);
      });
      stroke(ctx, d, 1); ctx.setLineDash([3, 3]); line(ctx, a, b);
    },
    hit(X, d, x, y) {
      const [a, b] = d.pts.map(X.px); const x0 = Math.min(a.x, b.x), x1 = d.style.extendRight ? X.W : Math.max(a.x, b.x);
      if (x < x0 - TOL || x > x1 + TOL) return false;
      return FIB_LEVELS.some((f) => Math.abs(X.p2y(d.pts[1].p + (d.pts[0].p - d.pts[1].p) * f.l) - y) < TOL) || distSeg(x, y, a.x, a.y, b.x, b.y) < TOL;
    },
  },
  fibext: {
    name: 'Trend-Based Fib Extension', npts: 3,
    draw(ctx, X, d) {
      const P = d.pts.map(X.px); stroke(ctx, d, 1); ctx.setLineDash([3, 3]);
      line(ctx, P[0], P[1]); if (P[2]) line(ctx, P[1], P[2]); else return;
      const move = d.pts[1].p - d.pts[0].p, base = d.pts[2].p;
      const x0 = P[2].x, x1 = Math.max(P[2].x + Math.abs(P[1].x - P[0].x), P[2].x + 60);
      FIB_EXT.forEach((l, i) => {
        const y = X.p2y(base + move * l), c = FIB_LEVELS[(i + 1) % FIB_LEVELS.length].c;
        ctx.strokeStyle = c; ctx.lineWidth = 1; ctx.setLineDash([]); line(ctx, { x: x0, y }, { x: x1, y });
        ctx.font = '11px Inter, system-ui, sans-serif'; ctx.fillStyle = c; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        ctx.fillText(`${l} (${X.fmt(base + move * l)})`, x1 + 4, y + 5);
      });
    },
    hit(X, d, x, y) {
      const P = d.pts.map(X.px);
      if (distSeg(x, y, P[0].x, P[0].y, P[1].x, P[1].y) < TOL || (P[2] && distSeg(x, y, P[1].x, P[1].y, P[2].x, P[2].y) < TOL)) return true;
      if (!P[2]) return false;
      const move = d.pts[1].p - d.pts[0].p; const x1 = Math.max(P[2].x + Math.abs(P[1].x - P[0].x), P[2].x + 60);
      return x >= P[2].x && x <= x1 && FIB_EXT.some((l) => Math.abs(X.p2y(d.pts[2].p + move * l) - y) < TOL);
    },
  },
  fibtime: {
    name: 'Fib Time Zone', npts: 2,
    draw(ctx, X, d) {
      const i0 = X.idx(d.pts[0].t), i1 = X.idx(d.pts[1].t), step = i1 - i0;
      FIB_TIME.forEach((k, n) => {
        const x = X.i2x(i0 + step * k); ctx.strokeStyle = n === 0 ? d.style.color : FIB_LEVELS[n % FIB_LEVELS.length].c; ctx.lineWidth = 1; ctx.setLineDash([]);
        line(ctx, { x, y: X.top }, { x, y: X.bottom });
        ctx.font = '11px Inter, system-ui, sans-serif'; ctx.fillStyle = ctx.strokeStyle; ctx.textAlign = 'left'; ctx.fillText(String(k), x + 3, X.bottom - 8);
      });
    },
    hit(X, d, x) { const i0 = X.idx(d.pts[0].t), step = X.idx(d.pts[1].t) - i0; return FIB_TIME.some((k) => Math.abs(X.i2x(i0 + step * k) - x) < TOL); },
  },
  rect: {
    name: 'Rectangle', npts: 2, anchors: boxAnchors, moveAnchor: boxMoveAnchor,
    draw(ctx, X, d) {
      const r = rectOf(...d.pts.map(X.px));
      ctx.fillStyle = d.style.fill || alpha(d.style.color, 0.15); ctx.fillRect(r.x, r.y, r.w, r.h);
      stroke(ctx, d); ctx.strokeRect(r.x, r.y, r.w, r.h);
      // manual label only (right-click → Add label); sits just above the box so thin boxes stay readable
      if (d.style.text) label(ctx, d.style.text, r.x + 2, r.y - 2, { color: d.style.color, bg: 'rgba(9, 12, 26, 0.78)', align: 'left', base: 'bottom', font: '700 10px Inter, system-ui, sans-serif' });
    },
    hit(X, d, x, y) { const r = rectOf(...d.pts.map(X.px)); return inRect(x, y, { x: r.x - TOL, y: r.y - TOL, w: r.w + 2 * TOL, h: r.h + 2 * TOL }); },
  },
  ellipse: {
    name: 'Ellipse', npts: 2, anchors: boxAnchors, moveAnchor: boxMoveAnchor,
    draw(ctx, X, d) {
      const r = rectOf(...d.pts.map(X.px));
      ctx.beginPath(); ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2 || 1, r.h / 2 || 1, 0, 0, Math.PI * 2);
      ctx.fillStyle = d.style.fill || alpha(d.style.color, 0.15); ctx.fill(); stroke(ctx, d); ctx.stroke();
    },
    hit(X, d, x, y) { const r = rectOf(...d.pts.map(X.px)); const nx = (x - r.x - r.w / 2) / (r.w / 2 + TOL), ny = (y - r.y - r.h / 2) / (r.h / 2 + TOL); return nx * nx + ny * ny <= 1; },
  },
  triangle: {
    name: 'Triangle', npts: 3,
    draw(ctx, X, d) {
      const P = d.pts.map(X.px); ctx.beginPath(); ctx.moveTo(P[0].x, P[0].y); P.slice(1).forEach((p) => ctx.lineTo(p.x, p.y)); ctx.closePath();
      ctx.fillStyle = d.style.fill || alpha(d.style.color, 0.15); ctx.fill(); stroke(ctx, d); ctx.stroke();
    },
    hit(X, d, x, y) { const P = d.pts.map(X.px); return P.some((p, i) => { const q = P[(i + 1) % P.length]; return distSeg(x, y, p.x, p.y, q.x, q.y) < TOL; }); },
  },
  path: {
    name: 'Path', npts: 'multi',
    draw(ctx, X, d) {
      const P = d.pts.map(X.px); stroke(ctx, d); ctx.beginPath(); P.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
      if (P.length > 1) arrowHead(ctx, P[P.length - 2], P[P.length - 1]);
    },
    hit(X, d, x, y) { const P = d.pts.map(X.px); return P.some((p, i) => i && distSeg(x, y, P[i - 1].x, P[i - 1].y, p.x, p.y) < TOL); },
  },
  brush: {
    name: 'Brush', npts: 'brush',
    draw(ctx, X, d) {
      const P = d.pts.map(X.px); if (P.length < 2) return; stroke(ctx, d); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(P[0].x, P[0].y);
      for (let i = 1; i < P.length - 1; i++) { const mx = (P[i].x + P[i + 1].x) / 2, my = (P[i].y + P[i + 1].y) / 2; ctx.quadraticCurveTo(P[i].x, P[i].y, mx, my); }
      ctx.lineTo(P[P.length - 1].x, P[P.length - 1].y); ctx.stroke(); ctx.lineCap = 'butt';
    },
    hit(X, d, x, y) { const P = d.pts.map(X.px); return P.some((p, i) => i && distSeg(x, y, P[i - 1].x, P[i - 1].y, p.x, p.y) < TOL + (d.style.width || 1) / 2); },
    anchors: () => [],
  },
  highlighter: {
    name: 'Highlighter', npts: 'brush',
    draw(ctx, X, d) { const c = d.style.color; d.style.color = alpha(c, 0.35); const w = d.style.width; d.style.width = Math.max(10, w * 6); TOOLS.brush.draw(ctx, X, d); d.style.color = c; d.style.width = w; },
    hit: (X, d, x, y) => TOOLS.brush.hit(X, { ...d, style: { ...d.style, width: 12 } }, x, y), anchors: () => [],
  },
  text: {
    name: 'Text', npts: 1,
    draw(ctx, X, d) { d._box = textBox(ctx, X, d, X.px(d.pts[0])); },
    hit: (X, d, x, y) => d._box && inRect(x, y, d._box),
  },
  note: {
    name: 'Note / Callout', npts: 1,
    draw(ctx, X, d) {
      const a = X.px(d.pts[0]); const bx = a.x + 20, by = a.y - 34;
      ctx.strokeStyle = d.style.color; ctx.lineWidth = 1; ctx.setLineDash([]); line(ctx, a, { x: bx + 4, y: by });
      ctx.beginPath(); ctx.arc(a.x, a.y, 3, 0, Math.PI * 2); ctx.fillStyle = d.style.color; ctx.fill();
      d._box = label(ctx, d.style.text || 'Note', bx, by, { bg: d.style.color, color: '#fff', align: 'left', base: 'bottom', font: `${d.style.fontSize || 13}px Inter, system-ui, sans-serif`, pad: 6 });
    },
    hit: (X, d, x, y) => (d._box && inRect(x, y, d._box)) || Math.hypot(X.px(d.pts[0]).x - x, X.px(d.pts[0]).y - y) < TOL,
  },
  pricelabel: {
    name: 'Price Label', npts: 1,
    draw(ctx, X, d) {
      const a = X.px(d.pts[0]);
      d._box = label(ctx, X.fmt(d.pts[0].p), a.x + 8, a.y - 8, { bg: d.style.color, align: 'left', base: 'bottom', pad: 5 });
      ctx.strokeStyle = d.style.color; ctx.setLineDash([]); ctx.lineWidth = 1; line(ctx, a, { x: a.x + 8, y: a.y - 8 });
    },
    hit: (X, d, x, y) => d._box && inRect(x, y, d._box),
  },
  arrowup: {
    name: 'Arrow Mark Up', npts: 1,
    draw(ctx, X, d) {
      const a = X.px(d.pts[0]); ctx.fillStyle = d.style.color || '#089981'; ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(a.x + 10, a.y + 12); ctx.lineTo(a.x + 4, a.y + 12); ctx.lineTo(a.x + 4, a.y + 26); ctx.lineTo(a.x - 4, a.y + 26); ctx.lineTo(a.x - 4, a.y + 12); ctx.lineTo(a.x - 10, a.y + 12); ctx.closePath(); ctx.fill();
      if (d.style.text) label(ctx, d.style.text, a.x, a.y + 38, { color: d.style.color });
    },
    hit(X, d, x, y) { const a = X.px(d.pts[0]); return x > a.x - 11 && x < a.x + 11 && y > a.y - 2 && y < a.y + 28; },
  },
  arrowdown: {
    name: 'Arrow Mark Down', npts: 1,
    draw(ctx, X, d) {
      const a = X.px(d.pts[0]); ctx.fillStyle = d.style.color || '#f23645'; ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(a.x + 10, a.y - 12); ctx.lineTo(a.x + 4, a.y - 12); ctx.lineTo(a.x + 4, a.y - 26); ctx.lineTo(a.x - 4, a.y - 26); ctx.lineTo(a.x - 4, a.y - 12); ctx.lineTo(a.x - 10, a.y - 12); ctx.closePath(); ctx.fill();
      if (d.style.text) label(ctx, d.style.text, a.x, a.y - 38, { color: d.style.color });
    },
    hit(X, d, x, y) { const a = X.px(d.pts[0]); return x > a.x - 11 && x < a.x + 11 && y < a.y + 2 && y > a.y - 28; },
  },
  flag: {
    name: 'Flag Mark', npts: 1,
    draw(ctx, X, d) {
      const a = X.px(d.pts[0]); ctx.strokeStyle = d.style.color; ctx.lineWidth = 2; ctx.setLineDash([]); line(ctx, a, { x: a.x, y: a.y - 28 });
      ctx.fillStyle = d.style.color; ctx.beginPath(); ctx.moveTo(a.x, a.y - 28); ctx.lineTo(a.x + 18, a.y - 22); ctx.lineTo(a.x, a.y - 15); ctx.closePath(); ctx.fill();
    },
    hit(X, d, x, y) { const a = X.px(d.pts[0]); return x > a.x - 4 && x < a.x + 20 && y < a.y + 2 && y > a.y - 30; },
  },
  long: positionTool(true),
  short: positionTool(false),
  pricerange: measureTool('price'),
  daterange: measureTool('date'),
  measure: measureTool('both'),
};
for (const [k, v] of Object.entries(TOOLS)) v.id = k;

function positionTool(isLong) {
  return {
    name: isLong ? 'Long Position' : 'Short Position', npts: 1,
    init(d, pt, X) {
      const r = (X.visibleRange || pt.p * 0.05);
      const tgt = isLong ? pt.p + r * 0.12 : pt.p - r * 0.12, stp = isLong ? pt.p - r * 0.06 : pt.p + r * 0.06;
      const t2 = X.time(X.idx(pt.t) + 25);
      d.pts = [{ ...pt }, { t: t2, p: tgt }, { t: t2, p: stp }];
      d.style.qty = d.style.qty || 1;
    },
    anchors(X, d) {
      const x0 = X.px(d.pts[0]).x, x1 = X.px(d.pts[1]).x;
      return [{ x: x0, y: X.p2y(d.pts[0].p) }, { x: x0, y: X.p2y(d.pts[1].p) }, { x: x0, y: X.p2y(d.pts[2].p) }, { x: x1, y: X.p2y(d.pts[0].p) }];
    },
    moveAnchor(d, i, pt) {
      if (i === 0) { d.pts[0] = { ...pt }; }
      else if (i === 1) d.pts[1].p = pt.p;
      else if (i === 2) d.pts[2].p = pt.p;
      else { d.pts[1].t = pt.t; d.pts[2].t = pt.t; }
    },
    draw(ctx, X, d) {
      const e = d.pts[0].p, t = d.pts[1].p, s = d.pts[2].p;
      const x0 = X.px(d.pts[0]).x, x1 = X.px(d.pts[1]).x;
      const ye = X.p2y(e), yt = X.p2y(t), ys = X.p2y(s), w = x1 - x0;
      ctx.fillStyle = 'rgba(8,153,129,0.2)'; ctx.fillRect(x0, Math.min(ye, yt), w, Math.abs(yt - ye));
      ctx.fillStyle = 'rgba(242,54,69,0.2)'; ctx.fillRect(x0, Math.min(ye, ys), w, Math.abs(ys - ye));
      ctx.strokeStyle = '#787b86'; ctx.lineWidth = 1; ctx.setLineDash([]); line(ctx, { x: x0, y: ye }, { x: x1, y: ye });
      // live progress
      // only while the latest candle is inside the tool's time window (an old drawing must not use today's price)
      const last = X.lastPrice, live = last != null && X.lastX > x0 && X.lastX <= x1 + 1;
      if (live) {
        const lx = Math.min(Math.max(X.lastX, x0), x1);
        {
          const lo = Math.min(yt, ys), hi = Math.max(yt, ys), yl = Math.min(hi, Math.max(lo, X.p2y(last))); ctx.fillStyle = (isLong ? last >= e : last <= e) ? 'rgba(8,153,129,0.25)' : 'rgba(242,54,69,0.25)';
          ctx.fillRect(x0, Math.min(ye, yl), lx - x0, Math.abs(yl - ye));
        }
      }
      const tp = Math.abs(pct(e, t)), sp = Math.abs(pct(e, s)); const rr = Math.abs(t - e) / (Math.abs(s - e) || 1);
      const qty = d.style.qty || 1; const cx = x0 + w / 2;
      label(ctx, `Target: ${X.fmt(t)} (${tp.toFixed(2)}%)  ${X.fmt(Math.abs(t - e) * qty)}`, cx, yt + (yt < ye ? -12 : 12), { bg: '#089981' });
      label(ctx, `Stop: ${X.fmt(s)} (${sp.toFixed(2)}%)  ${X.fmt(Math.abs(s - e) * qty)}`, cx, ys + (ys > ye ? 12 : -12), { bg: '#f23645' });
      const pl = live ? (isLong ? last - e : e - last) * qty : null;
      label(ctx, `${isLong ? 'Long' : 'Short'} · Qty ${qty} · R:R ${rr.toFixed(2)}${pl != null ? `\nOpen P&L: ${X.fmt(pl)}` : ''}`, cx, ye, { bg: (pl ?? 0) >= 0 ? 'rgba(8,153,129,0.95)' : 'rgba(242,54,69,0.95)' });
    },
    hit(X, d, x, y) {
      const x0 = X.px(d.pts[0]).x, x1 = X.px(d.pts[1]).x; const ys = [d.pts[0].p, d.pts[1].p, d.pts[2].p].map(X.p2y);
      return x >= Math.min(x0, x1) && x <= Math.max(x0, x1) && y >= Math.min(...ys) - 2 && y <= Math.max(...ys) + 2;
    },
    axis: (d) => [{ p: d.pts[1].p, color: '#089981' }, { p: d.pts[0].p, color: '#787b86' }, { p: d.pts[2].p, color: '#f23645' }],
  };
}

function measureTool(kind) {
  return {
    name: kind === 'price' ? 'Price Range' : kind === 'date' ? 'Date Range' : 'Date & Price Range', npts: 2,
    draw(ctx, X, d) {
      const [a, b] = d.pts.map(X.px); const up = d.pts[1].p >= d.pts[0].p; const fwd = b.x >= a.x;
      const col = kind === 'date' ? '#2962ff' : up ? '#2962ff' : '#f23645';
      const r = rectOf(a, b);
      ctx.fillStyle = alpha(col, 0.15); ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.setLineDash([]);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (kind !== 'date') { line(ctx, { x: mx, y: a.y }, { x: mx, y: b.y }); arrowHead(ctx, { x: mx, y: a.y }, { x: mx, y: b.y }, 7); line(ctx, { x: r.x, y: a.y }, { x: r.x + r.w, y: a.y }); line(ctx, { x: r.x, y: b.y }, { x: r.x + r.w, y: b.y }); }
      if (kind !== 'price') { line(ctx, { x: a.x, y: my }, { x: b.x, y: my }); arrowHead(ctx, { x: a.x, y: my }, { x: b.x, y: my }, 7); line(ctx, { x: a.x, y: r.y }, { x: a.x, y: r.y + r.h }); line(ctx, { x: b.x, y: r.y }, { x: b.x, y: r.y + r.h }); }
      const p0 = d.pts[0].p, p1 = d.pts[1].p; const bars = Math.round(X.idx(d.pts[1].t) - X.idx(d.pts[0].t));
      const txt = [];
      if (kind !== 'date') txt.push(`${X.fmt(p1 - p0)} (${pct(p0, p1).toFixed(2)}%)`);
      if (kind !== 'price') txt.push(`${bars} bars, ${X.span(d.pts[0].t, d.pts[1].t)}`);
      if (kind === 'both') { const vol = X.volBetween(d.pts[0].t, d.pts[1].t); txt.push(`Vol ${vol}`); }
      label(ctx, txt.join('\n'), mx, up ? r.y - 6 : r.y + r.h + 6, { bg: col, base: up ? 'bottom' : 'top' });
      void fwd;
    },
    hit(X, d, x, y) { const r = rectOf(...d.pts.map(X.px)); return inRect(x, y, { x: r.x - 3, y: r.y - 3, w: r.w + 6, h: r.h + 6 }); },
  };
}

export const TOOL_GROUPS = [
  { id: 'cursor', items: ['cross', 'dot', 'arrow', 'eraser'] },
  { id: 'lines', items: ['trend', 'ray', 'extended', 'infoline', 'arrowline', 'hline', 'hray', 'vline', 'crossline'] },
  { id: 'channels', items: ['channel', 'pitchfork'] },
  { id: 'fib', items: ['fib', 'fibext', 'fibtime'] },
  { id: 'shapes', items: ['rect', 'ellipse', 'triangle', 'path', 'brush', 'highlighter'] },
  { id: 'text', items: ['text', 'note', 'pricelabel', 'arrowup', 'arrowdown', 'flag'] },
  { id: 'projection', items: ['long', 'short', 'pricerange', 'daterange', 'measure'] },
];
export const CURSOR_NAMES = { cross: 'Cross', dot: 'Dot', arrow: 'Arrow', eraser: 'Eraser' };
export const toolName = (id) => CURSOR_NAMES[id] || (TOOLS[id] && TOOLS[id].name) || id;
export const DEFAULT_STYLE = { color: '#2962ff', width: 2, dash: 'solid', text: '', fontSize: 14 };
export const TOOL_DEFAULTS = {
  hline: { color: '#2962ff', width: 1 }, hray: { width: 1 }, vline: { width: 1 }, crossline: { width: 1 },
  text: { color: '#d1d4dc', text: 'Text', width: 1 }, note: { color: '#2962ff', text: 'Note' }, rect: { color: '#9c27b0', width: 1 },
  ellipse: { color: '#ff9800', width: 1 }, triangle: { color: '#00bcd4', width: 1 }, brush: { color: '#f23645', width: 2 }, highlighter: { color: '#fbc02d', width: 2 },
  arrowup: { color: '#089981' }, arrowdown: { color: '#f23645' }, flag: { color: '#f23645' }, pricelabel: { color: '#2962ff' }, fib: { color: '#787b86', width: 1 },
  channel: { color: '#2962ff', width: 1 }, pitchfork: { color: '#e91e63', width: 1 },
};
export { alpha, DASH };
