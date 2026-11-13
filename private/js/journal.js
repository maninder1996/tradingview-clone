// Trade Journal + Setup Advisor (demand/supply zone strategy).
// - Stores every trade with a chart snapshot (candles, YOUR hand-drawn zone rectangle, entry/SL/TP, outcome).
// - Advisor scores a new setup: rules first, then blends in what your own past trades say (k-nearest-neighbour).
// Data lives in store 'journal' so it syncs to the cloud like drawings do.
import { h, store, uid, fmtPrice, fmtDateShort, Emitter } from './utils.js';
import { shortName } from './symbols.js';

export const MILESTONES = [
  { n: 20, label: 'Rules calibrated — advisor starts blending your data' },
  { n: 50, label: 'First reliable patterns (fresh vs tested zone, with/against trend)' },
  { n: 100, label: 'Per-market view (~30+ each: BTC, Gold, Stocks)' },
  { n: 200, label: 'Robust — edge estimates stable' },
];
const KEY = 'journal';
const MIN_DATA = 20;           // below this the advisor uses rules only
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const marketClass = (sym) => {
  const s = String(sym).toUpperCase();
  if (/BTC/.test(s)) return 'btc';
  if (/XAU|GOLD/.test(s)) return 'gold';
  if (/XAG|SILVER/.test(s)) return 'silver';
  return 'stock';
};

// ---------------------------------------------------------------- candle helpers
function idxAt(bars, t) { // last bar with bar.t <= t
  let lo = 0, hi = bars.length - 1, r = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (bars[m].t <= t) { r = m; lo = m + 1; } else hi = m - 1; }
  return r;
}
function atrAt(bars, i, n = 14) {
  let s = 0, c = 0;
  for (let k = Math.max(1, i - n + 1); k <= i; k++) {
    const b = bars[k], p = bars[k - 1];
    s += Math.max(b.h - b.l, Math.abs(b.h - p.c), Math.abs(b.l - p.c)); c++;
  }
  return c ? s / c : ((bars[i] && bars[i].h - bars[i].l) || 1);
}
function emaAt(bars, i, n) {
  const k = 2 / (n + 1); let e = bars[Math.max(0, i - n * 3)].c;
  for (let j = Math.max(0, i - n * 3) + 1; j <= i; j++) e = bars[j].c * k + e * (1 - k);
  return e;
}

// ---------------------------------------------------------------- zone + features
// Your manually measured zone = a rectangle drawing. Long ⇒ demand zone, Short ⇒ supply zone.
export function findZone(rects, side, entry, t, a) {
  // Zones you draw are often extended to the right, so several boxes can "cover" an entry.
  // Rule: among boxes that still span the entry time and sit within ~1 ATR (or 0.2%) of the entry price,
  // take the MOST RECENTLY STARTED one (the box drawn for this trade); tie -> nearest in price.
  // Boxes that ended before the entry are only a fallback and must be tight (0.5 ATR).
  const tolIn = Math.max(a, entry * 0.002), tolOut = 0.5 * a;
  let best = null;
  for (const d of rects) {
    if (!d.pts || d.pts.length < 2) continue;
    const top = Math.max(d.pts[0].p, d.pts[1].p), bot = Math.min(d.pts[0].p, d.pts[1].p);
    const t0 = Math.min(d.pts[0].t, d.pts[1].t), t1 = Math.max(d.pts[0].t, d.pts[1].t);
    if (t0 > t) continue; // zone must exist before entry
    const dist = entry > top ? entry - top : entry < bot ? bot - entry : 0;
    const inTime = t <= t1;
    if (dist > (inTime ? tolIn : tolOut)) continue;
    const c = { top, bot, t0, t1, dist, inTime };
    let better;
    if (!best) better = true;
    else if (c.inTime !== best.inTime) better = c.inTime;
    else if (c.inTime) better = c.t0 !== best.t0 ? c.t0 > best.t0 : c.dist < best.dist;
    else better = c.dist !== best.dist ? c.dist < best.dist : c.top - c.bot < best.top - best.bot;
    if (better) best = c;
  }
  if (!best) return null;
  return { top: best.top, bot: best.bot, t0: best.t0, t1: best.t1, kind: side === 'long' ? 'demand' : 'supply' };
}

export function computeFeatures(bars, i, s) {
  // i = index of the bar containing the entry; context uses only COMPLETED bars before it (no look-ahead)
  const j = Math.max(1, i - 1);
  const a = atrAt(bars, j);
  const long = s.side === 'long';
  const risk = s.sl != null ? Math.abs(s.entry - s.sl) : null;
  const f = { atr: a, rr: risk ? Math.abs(s.tp - s.entry) / risk : null, slAtr: risk != null ? risk / a : null };
  const z = s.zone;
  if (z) {
    const hgt = Math.max(z.top - z.bot, 1e-9);
    f.zoneAtr = hgt / a;
    f.depth = clamp(long ? (z.top - s.entry) / hgt : (s.entry - z.bot) / hgt, -0.5, 1.5); // 0 = at proximal edge
    f.slBeyond = s.sl == null ? null : long ? s.sl <= z.bot : s.sl >= z.top;
    const zi = Math.max(0, idxAt(bars, z.t0));
    f.age = j - zi;
    let touches = 0, inside = false;
    for (let k = zi + 1; k <= j; k++) {
      const hit = bars[k].l <= z.top && bars[k].h >= z.bot;
      if (hit && !inside) touches++;
      inside = hit;
    }
    f.touches = touches; // times price already revisited the zone since you drew it (0 = fresh)
    let ext = 0;
    for (let k = zi; k <= j; k++) ext = Math.max(ext, long ? bars[k].h - z.top : z.bot - bars[k].l);
    f.legOut = ext / a; // how far price left the zone (strength of the imbalance), in ATR
  }
  if (j >= 20) {
    const e = emaAt(bars, j, Math.min(50, j)), c = bars[j].c;
    f.withTrend = long ? c > e : c < e;
  } else f.withTrend = null;
  if (j >= 6) f.approach = (long ? bars[j - 5].c - bars[j].c : bars[j].c - bars[j - 5].c) / a;
  f.hour = new Date(s.t).getUTCHours();
  return f;
}

// first of SL / TP hit after entry; same-bar double hit counts as a loss (conservative)
export function resolveTrade(bars, i, s) {
  if (s.sl == null || s.tp == null) return null;
  const long = s.side === 'long', risk = Math.abs(s.entry - s.sl) || 1e-9;
  let mfe = 0, mae = 0;
  for (let k = i + 1; k < bars.length; k++) {
    const b = bars[k];
    const hitSL = long ? b.l <= s.sl : b.h >= s.sl, hitTP = long ? b.h >= s.tp : b.l <= s.tp;
    mfe = Math.max(mfe, (long ? b.h - s.entry : s.entry - b.l) / risk);
    mae = Math.max(mae, (long ? s.entry - b.l : b.h - s.entry) / risk);
    if (hitSL || hitTP) {
      const win = hitTP && !hitSL;
      return { t: b.t, price: win ? s.tp : s.sl, r: win ? Math.abs(s.tp - s.entry) / risk : -1, result: win ? 'win' : 'loss', mfe, mae, k };
    }
  }
  return null;
}

// ---------------------------------------------------------------- advisor
function wilsonLow(w, n, z = 1.28) { // ~80% one-sided lower bound of the true win rate
  if (!n) return 0; const p = w / n, d = 1 + z * z / n;
  return (p + z * z / (2 * n) - z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
}
const vec = (f) => [
  clamp((f.zoneAtr ?? 1.5) / 3, 0, 1.5), clamp(f.depth ?? 0.5, 0, 1.2), clamp((f.slAtr ?? 1) / 3, 0, 1.5),
  clamp((f.touches ?? 1) / 3, 0, 1), clamp((f.legOut ?? 1) / 5, 0, 1), f.withTrend == null ? 0.5 : f.withTrend ? 1 : 0,
  clamp((f.rr ?? 2) / 5, 0, 1.2),
];

export function evaluate(setup, trades) {
  const f = setup.f, reasons = [];
  const add = (ok, text) => reasons.push({ ok, text });
  let score = 50;
  if (!setup.zone) {
    add(false, `No ${setup.side === 'long' ? 'demand' : 'supply'} zone (rectangle) found near this entry — draw your zone first.`);
    return { verdict: 'SKIP', score: 15, reasons, stage: 'rules', n: 0, neighbors: [] };
  }
  add(true, `${setup.zone.kind === 'demand' ? 'Demand' : 'Supply'} zone found (${fmtPrice(setup.zone.bot)} – ${fmtPrice(setup.zone.top)}), box starts ${fmtDateShort(setup.zone.t0)}.`);
  if (setup.sl == null || setup.tp == null) { score -= 15; add(false, 'Set both Stop Loss and Take Profit so risk:reward can be judged.'); }
  if (f.rr != null) {
    if (f.rr >= 3) { score += 15; add(true, `R:R ${f.rr.toFixed(1)} — excellent.`); }
    else if (f.rr >= 2) { score += 10; add(true, `R:R ${f.rr.toFixed(1)} — good.`); }
    else if (f.rr >= 1.5) add(null, `R:R ${f.rr.toFixed(1)} — acceptable, not great.`);
    else { score -= 20; add(false, `R:R ${f.rr.toFixed(1)} — too low for a zone trade (aim ≥ 2).`); }
  }
  const range = setup.style !== 'base'; // 'range' = wide box showing earlier market behaviour; 'base' = tight base-candle zone
  if (range) add(null, `Entry is ${(f.depth * 100).toFixed(0)}% of the way across the box from its near edge (learned from your results).`);
  else if (f.depth <= 0.35) { score += 10; add(true, 'Entry near the proximal edge of the zone — tight risk.'); }
  else if (f.depth > 0.7) { score -= 10; add(false, 'Entry deep inside / far edge of the zone — poor location.'); }
  if (f.slBeyond === true) { score += 5; add(true, 'Stop loss sits beyond the far edge of the zone.'); }
  else if (f.slBeyond === false) { score -= 10; add(false, 'Stop loss is inside the zone — zone can be tagged and still hold, you get stopped early.'); }
  if (range) { /* box already contains earlier candles by design: no freshness / leg-out / width rules */ }
  else if (f.touches === 0) { score += 15; add(true, 'Fresh zone — price has not returned to it since it formed.'); }
  else if (f.touches === 1) add(null, 'Zone already retested once.');
  else { score -= 15; add(false, `Zone already retested ${f.touches}× — weakened.`); }
  if (f.withTrend === true) { score += 10; add(true, 'Trade is with the short-term trend (EMA50).'); }
  else if (f.withTrend === false) { score -= 5; add(false, 'Trade is against the short-term trend (EMA50).'); }
  if (range) { /* skipped */ }
  else if (f.legOut >= 2) { score += 10; add(true, `Strong move away from the zone (${f.legOut.toFixed(1)} ATR) — real imbalance.`); }
  else if (f.legOut < 1) { score -= 10; add(false, `Weak move away from the zone (${f.legOut.toFixed(1)} ATR) — little imbalance.`); }
  if (!range && f.zoneAtr > 3) { score -= 8; add(false, `Zone is very wide (${f.zoneAtr.toFixed(1)} ATR) — large risk.`); }
  if (f.slAtr != null && f.slAtr < 0.5) { score -= 8; add(false, 'Stop is under 0.5 ATR — easily taken out by noise.'); }
  score = clamp(score, 0, 100);

  // ---- your own history
  const closed = trades.filter((t) => t.exit && (t.exit.result === 'win' || t.exit.result === 'loss') && t.f && t.f.zoneAtr != null);
  const n = closed.length;
  let stage = 'rules', data = null, neighbors = [], suggest = null;
  if (n >= MIN_DATA) {
    const v = vec(f), cls = marketClass(setup.symbol);
    const ranked = closed.map((t) => {
      const u = vec(t.f); let d = 0;
      for (let k = 0; k < v.length; k++) d += (v[k] - u[k]) ** 2;
      d = Math.sqrt(d) + (marketClass(t.symbol) === cls ? 0 : 0.5) + (t.tf === setup.tf ? 0 : 0.25) + (t.side === setup.side ? 0 : 0.5);
      return { t, d };
    }).sort((x, y) => x.d - y.d);
    const k = Math.min(12, Math.max(5, Math.round(n / 3)));
    const near = ranked.slice(0, k);
    let sw = 0, sWin = 0, sR = 0, wins = 0;
    for (const { t, d } of near) { const w = 1 / (0.1 + d); sw += w; sWin += w * (t.exit.result === 'win'); sR += w * (t.exit.r ?? (t.exit.result === 'win' ? 1 : -1)); wins += t.exit.result === 'win'; }
    data = { k, winRate: sWin / sw, expR: sR / sw, low: wilsonLow(wins, k) };
    const dataScore = clamp(50 + data.expR * 35 + (data.winRate - 0.5) * 40, 0, 100);
    const wd = n >= 50 ? 0.75 : 0.5;
    score = Math.round(score * (1 - wd) + dataScore * wd);
    stage = n >= 50 ? 'data-led' : 'blended';
    neighbors = near.slice(0, 3).map((x) => x.t);
    // ---- path check: how far did similar trades run in your favour before turning, and how far against you first?
    const ex = near.map((x) => x.t).filter((t) => t.exit.mfe != null && t.f.slAtr != null);
    if (ex.length >= 5 && f.slAtr != null && f.atr) {
      const q = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * (a.length - 1) + 0.5))]; };
      const sign = setup.side === 'long' ? 1 : -1;
      const mfe = ex.map((t) => t.exit.mfe * t.f.slAtr), med = q(mfe, 0.5), p75 = q(mfe, 0.75);
      const tpAtr = f.rr != null ? f.rr * f.slAtr : null;
      suggest = { tp: setup.entry + sign * q(mfe, 0.6) * f.atr };
      if (tpAtr != null && tpAtr > 2 && tpAtr > p75 * 1.5) {
        score -= 10;
        add(false, `Target is ${tpAtr.toFixed(1)} ATR away, but similar past trades usually turned after ~${med.toFixed(1)} ATR (75% turned before ${p75.toFixed(1)}). This trade will likely NOT complete — consider a nearer target (~${fmtPrice(suggest.tp)}).`);
      }
      const win = ex.filter((t) => t.exit.result === 'win');
      if (win.length >= 3) {
        const w75 = q(win.map((t) => t.exit.mae * t.f.slAtr), 0.75);
        suggest.sl = setup.entry - sign * w75 * f.atr;
        if (f.slAtr < w75) { score -= 8; add(false, `Your winning similar trades pulled back up to ${w75.toFixed(1)} ATR against you first; this stop is only ${f.slAtr.toFixed(1)} ATR — likely stopped out before the move (stop ≈ ${fmtPrice(suggest.sl)} would have survived).`); }
      }
    }
    add(data.expR > 0 ? true : false, `Your ${k} most similar past trades: ${(data.winRate * 100).toFixed(0)}% wins, avg ${data.expR >= 0 ? '+' : ''}${data.expR.toFixed(2)}R (worst-case win rate ≈ ${(data.low * 100).toFixed(0)}%).`);
  } else {
    add(null, `Only ${n} closed trades stored — advisor is rules-only until ${MIN_DATA}.`);
  }
  score = clamp(Math.round(score), 0, 100);
  const verdict = score >= 65 ? 'TAKE' : score >= 45 ? 'CAUTION' : 'SKIP';
  return { verdict, score, reasons, stage, n, data, neighbors, suggest };
}

// which of your habits actually win (needs enough trades)
export function insights(trades) {
  const closed = trades.filter((t) => t.exit && (t.exit.result === 'win' || t.exit.result === 'loss') && t.f && t.f.zoneAtr != null);
  if (closed.length < 30) return [];
  const tests = [
    ['Fresh zone (never retested)', (f) => f.touches === 0], ['With EMA50 trend', (f) => f.withTrend === true],
    ['Entry at proximal edge', (f) => f.depth <= 0.35], ['Strong leg-out (≥2 ATR)', (f) => f.legOut >= 2],
    ['R:R ≥ 2', (f) => f.rr >= 2], ['SL beyond zone', (f) => f.slBeyond === true],
  ];
  const out = [];
  for (const [name, fn] of tests) {
    const a = closed.filter((t) => fn(t.f)), b = closed.filter((t) => !fn(t.f));
    if (a.length < 8 || b.length < 8) continue;
    const wr = (x) => x.filter((t) => t.exit.result === 'win').length / x.length;
    out.push({ name, yes: wr(a), no: wr(b), ny: a.length, nn: b.length, diff: wr(a) - wr(b) });
  }
  return out.sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff));
}

// ---------------------------------------------------------------- store
export class Journal extends Emitter {
  constructor(app) {
    super(); this.app = app;
    this.trades = (store.get(KEY, null) || {}).trades || [];
    this.cfg = { gate: true, zoneStyle: 'range', ...store.get('journalCfg', {}) };
  }
  save() { store.set(KEY, { v: 1, trades: this.trades }); this.emit('change'); }
  saveCfg() { store.set('journalCfg', this.cfg); }
  remove(id) {
    const t = this.trades.find((x) => x.id === id);
    if (t && t.paperId) { (this.cfg.deleted ||= []).push(t.paperId); this.saveCfg(); } // stay deleted even if the position is still open
    this.trades = this.trades.filter((x) => x.id !== id); this.save();
  }
  // every open paper position should have a journal record (e.g. if state was reset or lost)
  reconcile() {
    for (const p of this.app.trading.positions) {
      if (this.trades.some((t) => t.paperId === p.id) || (this.cfg.deleted || []).includes(p.id)) continue;
      this.paperOpen(p);
    }
  }
  // boxes you label DEMAND / SUPPLY / ORDER BLOCK are the zones; unlabelled boxes (e.g. measuring boxes) are ignored once any label exists
  rects(symbol) {
    const all = (this.app.drawingsFor(symbol) || []).filter((d) => d.type === 'rect' && !d.hidden);
    const tagged = all.filter((d) => /demand|supply|order\s*block|zone/i.test(d.style.text || ''));
    return tagged.length ? tagged : all;
  }

  // setup = {symbol, tf, side, entry, sl, tp, t}; chart supplies candles + zones
  analyse(chart, setup) {
    const bars = chart && chart.bars && chart.bars.length > 30 ? chart.bars : null;
    if (!bars) return { ...setup, zone: null, f: {}, bars: null, i: -1 };
    const i = Math.max(1, idxAt(bars, setup.t));
    const a = atrAt(bars, Math.max(1, i - 1));
    const zone = findZone(this.rects(setup.symbol), setup.side, setup.entry, setup.t, a);
    const full = { ...setup, zone, style: this.cfg.zoneStyle || 'range' };
    return { ...full, f: computeFeatures(bars, i, full), bars, i };
  }
  check(chart, setup) { const a = this.analyse(chart, setup); return { setup: a, ev: evaluate(a, this.trades) }; }

  snapshot(bars, i, exitK) {
    const from = Math.max(0, i - 79), to = Math.min(bars.length - 1, exitK != null ? exitK + 10 : i + 10);
    return bars.slice(from, to + 1).map((b) => [b.t, b.o, b.h, b.l, b.c]);
  }
  makeTrade(chart, setup, extra = {}) {
    const a = this.analyse(chart, setup);
    const t = {
      id: uid(), symbol: setup.symbol, tf: setup.tf, side: setup.side, t: setup.t, entry: setup.entry, sl: setup.sl ?? null, tp: setup.tp ?? null,
      zone: a.zone, f: a.f, bars: a.bars ? this.snapshot(a.bars, a.i) : null, exit: null, note: '', ...extra,
    };
    if (a.bars) this.settle(t, a.bars, a.i);
    return t;
  }
  settle(t, bars, i) {
    const r = resolveTrade(bars, i, t);
    if (r) { t.exit = r; if (t.bars) t.bars = this.snapshot(bars, i, r.k); }
  }

  // --- paper trading hooks
  chartFor(symbol) { const cs = this.app.charts || []; return (this.app.active && this.app.active.state.symbol === symbol && this.app.active) || cs.find((c) => c.state.symbol === symbol); }
  paperOpen(pos) {
    const c = this.chartFor(pos.symbol);
    const t = this.makeTrade(c, { symbol: pos.symbol, tf: c ? c.state.interval : '?', side: pos.side, t: pos.time, entry: pos.avg, sl: pos.sl, tp: pos.tp }, { src: 'paper', paperId: pos.id });
    t.exit = null; // paper trades are closed by the engine, not by candle replay
    this.trades.push(t); this.save();
  }
  paperClose(pos, px) {
    const t = this.trades.find((x) => x.paperId === pos.id && !x.exit);
    if (!t) return;
    const risk = t.sl != null ? Math.abs(t.entry - t.sl) : null, dir = t.side === 'long' ? 1 : -1;
    const move = (px - t.entry) * dir;
    t.exit = { t: Date.now(), price: px, r: risk ? move / risk : null, result: Math.abs(move) < (risk || t.entry) * 0.02 ? 'be' : move > 0 ? 'win' : 'loss' };
    this.save();
  }

  // --- from chart drawings (Long/Short position tools): pts[0]=entry, [1]=TP, [2]=SL
  setupFromDrawing(chart, d) {
    const [e, tp, sl] = d.pts;
    return { symbol: chart.state.symbol, tf: chart.state.interval, side: d.type, t: e.t, entry: e.p, tp: tp.p, sl: sl.p };
  }
  positionDrawings(chart) { return (chart.drawings || []).filter((d) => (d.type === 'long' || d.type === 'short') && d.pts && d.pts.length >= 3); }
  importFromChart(chart) {
    let added = 0, open = 0;
    for (const d of this.positionDrawings(chart)) {
      if (this.trades.some((t) => t.drawingId === d.id)) continue;
      const t = this.makeTrade(chart, this.setupFromDrawing(chart, d), { src: 'drawn', drawingId: d.id });
      if (!t.exit) open++;
      this.trades.push(t); added++;
    }
    this.resolveOpen(chart);
    if (added) this.save();
    return { added, open };
  }
  resolveOpen(chart) { // settle unresolved drawn trades once their candles have played out
    let changed = false;
    for (const t of this.trades) {
      if (t.exit || t.src !== 'drawn' || t.symbol !== chart.state.symbol) continue;
      const i = idxAt(chart.bars, t.t); if (i < 0) continue;
      this.settle(t, chart.bars, i); if (t.exit) changed = true;
    }
    if (changed) this.save();
  }

  stats() {
    const closed = this.trades.filter((t) => t.exit && t.exit.result !== 'be');
    const wins = closed.filter((t) => t.exit.result === 'win').length;
    const rs = closed.map((t) => t.exit.r).filter((r) => r != null);
    const byClass = {}; for (const t of this.trades) if (t.exit) byClass[marketClass(t.symbol)] = (byClass[marketClass(t.symbol)] || 0) + 1;
    const total = this.trades.filter((t) => t.exit).length;
    return { total, all: this.trades.length, wins, winRate: closed.length ? wins / closed.length : null, expR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null, byClass };
  }
}

// ---------------------------------------------------------------- UI
export function verdictCard(ev, setup) {
  const cls = ev.verdict === 'TAKE' ? 'up' : ev.verdict === 'SKIP' ? 'down' : 'mid';
  return h('div', { class: 'jr-card' },
    h('div', { class: 'jr-head' },
      h('span', { class: `jr-verdict ${cls}` }, ev.verdict === 'TAKE' ? '✔ GOOD PLACE' : ev.verdict === 'SKIP' ? '✖ REJECT' : '⚠ CAUTION'),
      h('span', { class: 'jr-score' }, `${ev.score}/100 · ${ev.stage}`)),
    h('div', { class: 'jr-sub' }, `${shortName(setup.symbol)} ${setup.tf || ''} · ${setup.side.toUpperCase()} @ ${fmtPrice(setup.entry)}`),
    h('ul', { class: 'jr-list' }, ...ev.reasons.map((r) => h('li', { class: r.ok === true ? 'ok' : r.ok === false ? 'bad' : '' }, (r.ok === true ? '✔ ' : r.ok === false ? '✖ ' : '• ') + r.text))),
    ev.suggest ? h('div', { class: 'jr-sub' }, 'From similar trades — ' + [ev.suggest.tp != null ? `TP ≈ ${fmtPrice(ev.suggest.tp)}` : '', ev.suggest.sl != null ? `SL ≈ ${fmtPrice(ev.suggest.sl)}` : ''].filter(Boolean).join(' · ')) : null,
    ev.neighbors.length ? h('div', { class: 'jr-sub' }, 'Closest past trades: ' + ev.neighbors.map((t) => `${shortName(t.symbol)} ${t.side} ${t.exit.result === 'win' ? '✔' : '✖'} ${t.exit.r != null ? t.exit.r.toFixed(1) + 'R' : ''}`).join(' · ')) : null);
}

// Pre-trade gate: shows the advisor verdict, user decides.
export function askBeforeTrade(app, setup, go) {
  const chart = app.journal.chartFor(setup.symbol);
  const { setup: a, ev } = app.journal.check(chart, setup);
  const close = () => ov.remove();
  const ov = h('div', { class: 'jr-overlay', onclick: (e) => { if (e.target === ov) close(); } },
    h('div', { class: 'jr-modal' },
      h('div', { class: 'jr-title' }, 'Trade Advisor'),
      verdictCard(ev, a),
      h('div', { class: 'jr-btns' },
        h('button', { class: 'btn-sell', onclick: close }, 'Reject trade'),
        h('button', { class: ev.verdict === 'SKIP' ? 'btn-sell' : 'btn-buy', onclick: () => { close(); go(); } }, ev.verdict === 'SKIP' ? 'Place anyway' : 'Place order'))));
  document.body.append(ov);
}

export function renderJournalDock(app) {
  const J = app.journal, panel = app.bottomPanel, st = J.stats(), c = app.active;
  const rerender = () => app.renderBottomPanel();
  const next = MILESTONES.find((m) => st.total < m.n);
  const header = h('div', { class: 'bp-header' },
    h('div', { class: 'bp-tabs' }, h('span', { class: 'bp-sub active' }, `Journal & Advisor (${st.total} closed / ${st.all} logged)`)),
    h('div', { class: 'bp-actions' },
      h('select', { class: 'scr-sel', title: 'How you draw zones', onchange: (e) => { J.cfg.zoneStyle = e.target.value; J.saveCfg(); } },
        h('option', { value: 'range', selected: J.cfg.zoneStyle !== 'base' }, 'Zone style: wide box (market history)'),
        h('option', { value: 'base', selected: J.cfg.zoneStyle === 'base' }, 'Zone style: tight base candles')),
      h('label', { class: 'jr-gate' }, h('input', { type: 'checkbox', checked: J.cfg.gate, onchange: (e) => { J.cfg.gate = e.target.checked; J.saveCfg(); } }), 'Ask advisor before orders'),
      h('button', { class: 'icon-btn', html: '✕', onclick: () => { app.state.bottomTab = null; app.renderBottomBar(); app.renderBottomPanel(); } })));

  const left = h('div', { class: 'tr-ticket jr-left' });
  left.append(h('div', { class: 'tk-title' }, 'Learning progress'),
    h('div', { class: 'jr-bar' }, h('i', { style: { width: Math.min(100, st.total / 2) + '%' } })),
    h('div', { class: 'jr-sub' }, next ? `${st.total}/${next.n} → ${next.label}` : 'All milestones reached — keep logging, include losers & skipped zones.'),
    h('div', { class: 'jr-sub' }, `Win rate ${st.winRate == null ? '—' : (st.winRate * 100).toFixed(0) + '%'} · avg ${st.expR == null ? '—' : st.expR.toFixed(2) + 'R'} · ` +
      (Object.entries(st.byClass).map(([k, v]) => `${k} ${v}`).join(' · ') || 'no trades yet')));

  const out = h('div', { class: 'jr-out' });
  const pos = c ? J.positionDrawings(c) : [];
  app._jrN = pos.length; // lets the app refresh this panel when drawings/chart change
  left.append(
    h('button', { class: 'btn-buy jr-btn', onclick: () => {
      const ch = app.active; if (!ch) return; const r = J.importFromChart(ch);
      app.toast(r.added ? `Imported ${r.added} trade(s) from chart drawings (${r.open} still open)` : 'No new Long/Short position drawings on this chart', r.added ? 'success' : 'warn'); rerender();
    } }, `Import ${pos.length} Long/Short drawing(s) on this chart`),
    h('button', { class: 'bb-btn jr-btn', onclick: () => {
      out.innerHTML = '';
      const ch = app.active, ps = ch ? J.positionDrawings(ch) : []; // read fresh: the panel may have been drawn before the chart/drawing existed
      if (!ch || !ps.length) { out.append(h('div', { class: 'empty-hint' }, 'Draw a Long/Short position tool (entry, TP, SL) plus your zone rectangle, then press this.')); return; }
      const d = (ch.selected && ps.includes(ch.selected)) ? ch.selected : ps[ps.length - 1];
      const s = J.setupFromDrawing(ch, d); const { setup: a, ev } = J.check(ch, s);
      out.append(verdictCard(ev, a));
    } }, 'Evaluate selected / latest Long-Short drawing'),
    out,
    h('button', { class: 'bb-btn jr-btn', onclick: () => {
      const blob = new Blob([JSON.stringify(J.trades, null, 1)], { type: 'application/json' }), a = h('a', { href: URL.createObjectURL(blob), download: 'trade-journal.json' }); a.click();
    } }, 'Export journal (JSON)'));
  const ins = insights(J.trades);
  if (ins.length) left.append(h('div', { class: 'tk-title' }, 'What wins for you'), ...ins.slice(0, 4).map((x) =>
    h('div', { class: 'jr-sub' }, `${x.name}: ${(x.yes * 100).toFixed(0)}% (${x.ny}) vs ${(x.no * 100).toFixed(0)}% (${x.nn})`)));

  const rows = [...J.trades].sort((x, y) => y.t - x.t);
  const table = h('div', { class: 'tr-table-wrap' }, rows.length ? h('table', { class: 'data-table' },
    h('thead', {}, h('tr', {}, ...['Date', 'Symbol', 'TF', 'Side', 'Entry', 'SL', 'TP', 'Zone', 'Result', 'Src', ''].map((x) => h('th', {}, x)))),
    h('tbody', {}, ...rows.map((t) => h('tr', {},
      h('td', {}, fmtDateShort(t.t)), h('td', {}, shortName(t.symbol)), h('td', {}, t.tf), h('td', {}, h('span', { class: 'badge ' + (t.side === 'long' ? 'up' : 'down') }, t.side.toUpperCase())),
      h('td', {}, fmtPrice(t.entry)), h('td', {}, t.sl == null ? '—' : fmtPrice(t.sl)), h('td', {}, t.tp == null ? '—' : fmtPrice(t.tp)),
      h('td', {}, t.zone ? (t.zone.kind === 'demand' ? 'D' : 'S') + (t.f.touches != null ? ` · ${t.f.touches}×` : '') : '—'),
      h('td', { class: t.exit ? (t.exit.result === 'win' ? 'up' : t.exit.result === 'loss' ? 'down' : '') : '' }, t.exit ? `${t.exit.result.toUpperCase()}${t.exit.r != null ? ' ' + t.exit.r.toFixed(2) + 'R' : ''}` : 'open'),
      h('td', {}, t.src), h('td', {}, h('button', { class: 'icon-btn', title: 'Delete', html: '🗑', onclick: () => { J.remove(t.id); rerender(); } })))))) :
    h('div', { class: 'empty-hint' }, 'No trades logged yet. Paper trades log automatically. For real BTC / Gold / stock trades: draw the Long/Short tool + your zone rectangle on the chart where the trade started, then press “Import”.'));
  panel.append(header, h('div', { class: 'tr-body' }, left, table));
}
