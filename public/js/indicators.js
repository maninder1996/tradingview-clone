// Technical indicators: math helpers + definitions consumed by the chart engine.
const NaNArr = (n) => new Array(n).fill(NaN);

export function source(bars, s = 'close') {
  switch (s) {
    case 'open': return bars.map((b) => b.o);
    case 'high': return bars.map((b) => b.h);
    case 'low': return bars.map((b) => b.l);
    case 'hl2': return bars.map((b) => (b.h + b.l) / 2);
    case 'hlc3': return bars.map((b) => (b.h + b.l + b.c) / 3);
    case 'ohlc4': return bars.map((b) => (b.o + b.h + b.l + b.c) / 4);
    case 'volume': return bars.map((b) => b.v);
    default: return bars.map((b) => b.c);
  }
}
export function sma(a, n) {
  const out = NaNArr(a.length); let s = 0, valid = 0;
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    if (!isNaN(v)) { s += v; valid++; }
    if (i >= n) { const o = a[i - n]; if (!isNaN(o)) { s -= o; valid--; } }
    if (valid === n) out[i] = s / n;
  }
  return out;
}
export function ema(a, n) {
  const out = NaNArr(a.length); const k = 2 / (n + 1); let prev = NaN, cnt = 0, s = 0;
  for (let i = 0; i < a.length; i++) {
    const v = a[i]; if (isNaN(v)) continue;
    if (isNaN(prev)) { s += v; cnt++; if (cnt === n) { prev = s / n; out[i] = prev; } continue; }
    prev = v * k + prev * (1 - k); out[i] = prev;
  }
  return out;
}
export function rma(a, n) {
  const out = NaNArr(a.length); let prev = NaN, cnt = 0, s = 0;
  for (let i = 0; i < a.length; i++) {
    const v = a[i]; if (isNaN(v)) continue;
    if (isNaN(prev)) { s += v; cnt++; if (cnt === n) { prev = s / n; out[i] = prev; } continue; }
    prev = (prev * (n - 1) + v) / n; out[i] = prev;
  }
  return out;
}
export function wma(a, n) {
  const out = NaNArr(a.length); const d = (n * (n + 1)) / 2;
  for (let i = n - 1; i < a.length; i++) {
    let s = 0, ok = true;
    for (let j = 0; j < n; j++) { const v = a[i - j]; if (isNaN(v)) { ok = false; break; } s += v * (n - j); }
    if (ok) out[i] = s / d;
  }
  return out;
}
export function stdev(a, n) {
  const m = sma(a, n); const out = NaNArr(a.length);
  for (let i = n - 1; i < a.length; i++) {
    if (isNaN(m[i])) continue; let s = 0;
    for (let j = 0; j < n; j++) s += (a[i - j] - m[i]) ** 2;
    out[i] = Math.sqrt(s / n);
  }
  return out;
}
export function highest(a, n) { const out = NaNArr(a.length); for (let i = n - 1; i < a.length; i++) { let m = -Infinity; for (let j = 0; j < n; j++) m = Math.max(m, a[i - j]); out[i] = m; } return out; }
export function lowest(a, n) { const out = NaNArr(a.length); for (let i = n - 1; i < a.length; i++) { let m = Infinity; for (let j = 0; j < n; j++) m = Math.min(m, a[i - j]); out[i] = m; } return out; }
export function trueRange(bars) { return bars.map((b, i) => (i === 0 ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c)))); }
export const atr = (bars, n) => rma(trueRange(bars), n);
const maBy = (type, a, n) => (type === 'EMA' ? ema(a, n) : type === 'WMA' ? wma(a, n) : type === 'RMA' ? rma(a, n) : sma(a, n));
const change = (a) => a.map((v, i) => (i ? v - a[i - 1] : NaN));

function rsiCalc(a, n) {
  const ch = change(a);
  const up = rma(ch.map((x) => (isNaN(x) ? NaN : Math.max(x, 0))), n);
  const dn = rma(ch.map((x) => (isNaN(x) ? NaN : Math.max(-x, 0))), n);
  return up.map((u, i) => (isNaN(u) ? NaN : dn[i] === 0 ? 100 : 100 - 100 / (1 + u / dn[i])));
}
function dmi(bars, n) {
  const pdm = [NaN], mdm = [NaN];
  for (let i = 1; i < bars.length; i++) {
    const up = bars[i].h - bars[i - 1].h, dn = bars[i - 1].l - bars[i].l;
    pdm.push(up > dn && up > 0 ? up : 0); mdm.push(dn > up && dn > 0 ? dn : 0);
  }
  const tr = rma(trueRange(bars).map((x, i) => (i ? x : NaN)), n);
  const p = rma(pdm, n).map((v, i) => (100 * v) / tr[i]);
  const m = rma(mdm, n).map((v, i) => (100 * v) / tr[i]);
  const dx = p.map((v, i) => (100 * Math.abs(v - m[i])) / (v + m[i] || 1));
  return { p, m, adx: rma(dx, n) };
}
function dayKey(t, off) { return Math.floor((t + off) / 86400e3); }

const C = { blue: '#2962ff', orange: '#ff9800', purple: '#9c27b0', red: '#f23645', green: '#089981', teal: '#00bcd4', yellow: '#fbc02d', gray: '#787b86', pink: '#e91e63' };
const SRC = ['close', 'open', 'high', 'low', 'hl2', 'hlc3', 'ohlc4'];

// ------------------------------------------------------------------------------------- definitions
export const INDICATORS = {
  vol: {
    name: 'Volume', short: 'Vol', overlay: true, special: 'volume', scale: false, category: 'Volume',
    inputs: { maLength: { v: 20, min: 1, label: 'MA length' }, showMA: { v: false, label: 'Show MA' } },
    plots: [{ key: 'vol', title: 'Volume', type: 'hist', color: '#26a69a80', color2: '#ef535080' }, { key: 'ma', title: 'Volume MA', color: C.blue, width: 1 }],
    calc(bars, i) { const v = bars.map((b) => b.v); return { vol: v, ma: i.showMA ? sma(v, i.maLength) : NaNArr(v.length) }; },
  },
  sma: {
    name: 'Moving Average Simple', short: 'SMA', overlay: true, category: 'Moving averages',
    inputs: { length: { v: 20, min: 1 }, source: { v: 'close', options: SRC }, offset: { v: 0 } },
    plots: [{ key: 'ma', title: 'MA', color: C.blue, width: 1.5 }],
    calc(b, i) { return { ma: sma(source(b, i.source), i.length) }; }, offsetInput: 'offset',
  },
  ema: {
    name: 'Moving Average Exponential', short: 'EMA', overlay: true, category: 'Moving averages',
    inputs: { length: { v: 50, min: 1 }, source: { v: 'close', options: SRC }, offset: { v: 0 } },
    plots: [{ key: 'ma', title: 'EMA', color: C.orange, width: 1.5 }],
    calc(b, i) { return { ma: ema(source(b, i.source), i.length) }; }, offsetInput: 'offset',
  },
  wma: {
    name: 'Moving Average Weighted', short: 'WMA', overlay: true, category: 'Moving averages',
    inputs: { length: { v: 9, min: 1 }, source: { v: 'close', options: SRC } },
    plots: [{ key: 'ma', title: 'WMA', color: C.purple, width: 1.5 }],
    calc(b, i) { return { ma: wma(source(b, i.source), i.length) }; },
  },
  hma: {
    name: 'Hull Moving Average', short: 'HMA', overlay: true, category: 'Moving averages',
    inputs: { length: { v: 9, min: 2 }, source: { v: 'close', options: SRC } },
    plots: [{ key: 'ma', title: 'HMA', color: C.teal, width: 1.5 }],
    calc(b, i) {
      const s = source(b, i.source), n = i.length;
      const full = wma(s, n);
      const raw = wma(s, Math.floor(n / 2)).map((v, k) => 2 * v - full[k]);
      return { ma: wma(raw, Math.round(Math.sqrt(n))) };
    },
  },
  maribbon: {
    name: 'EMA Cross (9/21/200)', short: 'EMA x3', overlay: true, category: 'Moving averages',
    inputs: { fast: { v: 9, min: 1 }, slow: { v: 21, min: 1 }, trend: { v: 200, min: 1 } },
    plots: [{ key: 'f', title: 'Fast', color: C.green, width: 1 }, { key: 's', title: 'Slow', color: C.red, width: 1 }, { key: 't', title: 'Trend', color: C.gray, width: 2 }],
    calc(b, i) { const c = source(b); return { f: ema(c, i.fast), s: ema(c, i.slow), t: ema(c, i.trend) }; },
  },
  vwap: {
    name: 'VWAP (session)', short: 'VWAP', overlay: true, category: 'Volume',
    inputs: { bands: { v: 1, min: 0, step: 0.5, label: 'Band multiplier (0 = off)' } },
    plots: [{ key: 'vwap', title: 'VWAP', color: C.blue, width: 1.5 }, { key: 'up', title: 'Upper', color: C.green, width: 1 }, { key: 'dn', title: 'Lower', color: C.green, width: 1 }],
    fills: [{ a: 'up', b: 'dn', color: 'rgba(8,153,129,0.06)' }],
    calc(bars, i, ctx) {
      const n = bars.length, vw = NaNArr(n), up = NaNArr(n), dn = NaNArr(n);
      let key = null, pv = 0, vv = 0, pv2 = 0;
      for (let k = 0; k < n; k++) {
        const b = bars[k], dk = ctx.intraday ? dayKey(b.t, ctx.sessionOffset) : 0;
        if (dk !== key) { key = dk; pv = vv = pv2 = 0; }
        const tp = (b.h + b.l + b.c) / 3, v = b.v || 1;
        pv += tp * v; vv += v; pv2 += tp * tp * v;
        vw[k] = pv / vv;
        const sd = Math.sqrt(Math.max(pv2 / vv - vw[k] ** 2, 0));
        if (i.bands > 0) { up[k] = vw[k] + sd * i.bands; dn[k] = vw[k] - sd * i.bands; }
      }
      return { vwap: vw, up, dn };
    },
  },
  bb: {
    name: 'Bollinger Bands', short: 'BB', overlay: true, category: 'Volatility',
    inputs: { length: { v: 20, min: 1 }, mult: { v: 2, step: 0.1 }, source: { v: 'close', options: SRC } },
    plots: [{ key: 'basis', title: 'Basis', color: C.orange, width: 1 }, { key: 'upper', title: 'Upper', color: C.blue, width: 1 }, { key: 'lower', title: 'Lower', color: C.blue, width: 1 }],
    fills: [{ a: 'upper', b: 'lower', color: 'rgba(41,98,255,0.06)' }],
    calc(b, i) {
      const s = source(b, i.source), m = sma(s, i.length), sd = stdev(s, i.length);
      return { basis: m, upper: m.map((v, k) => v + i.mult * sd[k]), lower: m.map((v, k) => v - i.mult * sd[k]) };
    },
  },
  kc: {
    name: 'Keltner Channels', short: 'KC', overlay: true, category: 'Volatility',
    inputs: { length: { v: 20, min: 1 }, mult: { v: 2, step: 0.1 }, atrLength: { v: 10, min: 1 } },
    plots: [{ key: 'basis', title: 'Basis', color: C.blue, width: 1 }, { key: 'upper', title: 'Upper', color: C.blue, width: 1 }, { key: 'lower', title: 'Lower', color: C.blue, width: 1 }],
    fills: [{ a: 'upper', b: 'lower', color: 'rgba(41,98,255,0.05)' }],
    calc(b, i) { const m = ema(source(b), i.length), a = atr(b, i.atrLength); return { basis: m, upper: m.map((v, k) => v + i.mult * a[k]), lower: m.map((v, k) => v - i.mult * a[k]) }; },
  },
  dc: {
    name: 'Donchian Channels', short: 'DC', overlay: true, category: 'Volatility',
    inputs: { length: { v: 20, min: 1 } },
    plots: [{ key: 'upper', title: 'Upper', color: C.blue, width: 1 }, { key: 'basis', title: 'Basis', color: C.orange, width: 1 }, { key: 'lower', title: 'Lower', color: C.blue, width: 1 }],
    fills: [{ a: 'upper', b: 'lower', color: 'rgba(41,98,255,0.05)' }],
    calc(b, i) { const hi = highest(source(b, 'high'), i.length), lo = lowest(source(b, 'low'), i.length); return { upper: hi, lower: lo, basis: hi.map((v, k) => (v + lo[k]) / 2) }; },
  },
  supertrend: {
    name: 'Supertrend', short: 'Supertrend', overlay: true, category: 'Trend',
    inputs: { atrLength: { v: 10, min: 1 }, factor: { v: 3, step: 0.1 } },
    plots: [{ key: 'up', title: 'Up trend', color: C.green, width: 1.5 }, { key: 'dn', title: 'Down trend', color: C.red, width: 1.5 }],
    calc(bars, i) {
      const n = bars.length, a = atr(bars, i.atrLength), up = NaNArr(n), dn = NaNArr(n);
      let fu = NaN, fl = NaN, dir = 1;
      for (let k = 0; k < n; k++) {
        if (isNaN(a[k])) continue;
        const hl2 = (bars[k].h + bars[k].l) / 2;
        let bu = hl2 + i.factor * a[k], bl = hl2 - i.factor * a[k];
        const pc = k ? bars[k - 1].c : bars[k].c;
        bl = !isNaN(fl) && (bl > fl || pc < fl) ? bl : isNaN(fl) ? bl : fl;
        bu = !isNaN(fu) && (bu < fu || pc > fu) ? bu : isNaN(fu) ? bu : fu;
        if (!isNaN(fu)) {
          if (dir === -1 && bars[k].c > fu) dir = 1;
          else if (dir === 1 && bars[k].c < fl) dir = -1;
        }
        fu = bu; fl = bl;
        if (dir === 1) up[k] = fl; else dn[k] = fu;
      }
      return { up, dn };
    },
  },
  psar: {
    name: 'Parabolic SAR', short: 'SAR', overlay: true, category: 'Trend',
    inputs: { start: { v: 0.02, step: 0.01 }, inc: { v: 0.02, step: 0.01 }, max: { v: 0.2, step: 0.01 } },
    plots: [{ key: 'sar', title: 'SAR', type: 'dots', color: C.blue, width: 2 }],
    calc(b, i) {
      const n = b.length, out = NaNArr(n); if (n < 2) return { sar: out };
      let up = b[1].c >= b[0].c, af = i.start, ep = up ? b[0].h : b[0].l, sar = up ? b[0].l : b[0].h;
      for (let k = 1; k < n; k++) {
        sar = sar + af * (ep - sar);
        if (up) {
          sar = Math.min(sar, b[k - 1].l, k > 1 ? b[k - 2].l : b[k - 1].l);
          if (b[k].l < sar) { up = false; sar = ep; ep = b[k].l; af = i.start; }
          else if (b[k].h > ep) { ep = b[k].h; af = Math.min(af + i.inc, i.max); }
        } else {
          sar = Math.max(sar, b[k - 1].h, k > 1 ? b[k - 2].h : b[k - 1].h);
          if (b[k].h > sar) { up = true; sar = ep; ep = b[k].h; af = i.start; }
          else if (b[k].l < ep) { ep = b[k].l; af = Math.min(af + i.inc, i.max); }
        }
        out[k] = sar;
      }
      return { sar: out };
    },
  },
  ichimoku: {
    name: 'Ichimoku Cloud', short: 'Ichimoku', overlay: true, category: 'Trend',
    inputs: { conv: { v: 9, min: 1, label: 'Conversion' }, base: { v: 26, min: 1, label: 'Base' }, spanB: { v: 52, min: 1, label: 'Leading span B' }, disp: { v: 26, min: 1, label: 'Displacement' } },
    plots: [
      { key: 'conv', title: 'Conversion', color: C.blue, width: 1 }, { key: 'base', title: 'Base', color: '#b71c1c', width: 1 },
      { key: 'lag', title: 'Lagging', color: '#43a047', width: 1, offsetFn: (i) => -(i.disp - 1) },
      { key: 'a', title: 'Lead A', color: '#a5d6a7', width: 1, offsetFn: (i) => i.disp - 1 }, { key: 'b', title: 'Lead B', color: '#ef9a9a', width: 1, offsetFn: (i) => i.disp - 1 },
    ],
    fills: [{ a: 'a', b: 'b', up: 'rgba(67,160,71,0.12)', down: 'rgba(244,67,54,0.12)' }],
    calc(b, i) {
      const H = source(b, 'high'), L = source(b, 'low');
      const mid = (n) => { const lo = lowest(L, n); return highest(H, n).map((v, k) => (v + lo[k]) / 2); };
      const conv = mid(i.conv), base = mid(i.base);
      return { conv, base, lag: source(b), a: conv.map((v, k) => (v + base[k]) / 2), b: mid(i.spanB) };
    },
  },
  pivots: {
    name: 'Pivot Points Standard', short: 'Pivots', overlay: true, category: 'Support/Resistance',
    inputs: {},
    plots: ['P', 'R1', 'S1', 'R2', 'S2', 'R3', 'S3'].map((k) => ({ key: k, title: k, color: k === 'P' ? C.orange : k[0] === 'R' ? C.red : C.green, width: 1, type: 'step', label: true })),
    calc(bars, i, ctx) {
      const n = bars.length, out = {}; for (const k of ['P', 'R1', 'S1', 'R2', 'S2', 'R3', 'S3']) out[k] = NaNArr(n);
      const period = (t) => {
        const d = new Date(t + ctx.sessionOffset);
        if (ctx.intraday) return Math.floor((t + ctx.sessionOffset) / 86400e3);
        if (ctx.iv === '1D') return d.getUTCFullYear() * 12 + d.getUTCMonth();
        return d.getUTCFullYear();
      };
      let cur = null, ph = -Infinity, pl = Infinity, pc = NaN, prev = null;
      for (let k = 0; k < n; k++) {
        const p = period(bars[k].t);
        if (p !== cur) { if (cur !== null) prev = { h: ph, l: pl, c: pc }; cur = p; ph = -Infinity; pl = Infinity; }
        ph = Math.max(ph, bars[k].h); pl = Math.min(pl, bars[k].l); pc = bars[k].c;
        if (prev) {
          const P = (prev.h + prev.l + prev.c) / 3, r = prev.h - prev.l;
          out.P[k] = P; out.R1[k] = 2 * P - prev.l; out.S1[k] = 2 * P - prev.h; out.R2[k] = P + r; out.S2[k] = P - r; out.R3[k] = prev.h + 2 * (P - prev.l); out.S3[k] = prev.l - 2 * (prev.h - P);
        }
      }
      return out;
    },
  },
  vpvr: {
    name: 'Volume Profile (Visible Range)', short: 'VPVR', overlay: true, scale: false, category: 'Volume', special: 'vpvr',
    inputs: { rows: { v: 24, min: 6, max: 100, label: 'Row count' }, width: { v: 30, min: 5, max: 80, label: 'Width %' }, va: { v: 70, min: 10, max: 100, label: 'Value area %' } },
    plots: [{ key: 'up', title: 'Up volume', color: 'rgba(8,153,129,0.35)' }, { key: 'dn', title: 'Down volume', color: 'rgba(242,54,69,0.35)' }, { key: 'poc', title: 'POC', color: C.yellow, width: 1 }],
    calc() { return {}; },
  },
  compare: {
    name: 'Compare symbol', short: 'Compare', overlay: true, category: 'Compare', special: 'compare', hidden: true,
    inputs: { symbol: { v: 'NSE:NIFTY', label: 'Symbol' } },
    plots: [{ key: 'v', title: 'Compare', color: C.orange, width: 1.5 }],
    calc() { return {}; },
  },
  customscript: {
    name: 'Custom Pine Script', short: 'Pine', overlay: true, category: 'Custom', special: 'customscript', hidden: true,
    inputs: { title: { v: 'My Script', label: 'Script title' } },
    plots: [
      { key: 'p0', title: 'Plot 1', color: '#089981', width: 2 },
      { key: 'p1', title: 'Plot 2', color: '#f23645', width: 2 },
      { key: 'p2', title: 'Plot 3', color: '#2962ff', width: 1.5 },
    ],
    calc() { return {}; },
  },
  // ------------------------------------------------------------------------- oscillators (own pane)
  rsi: {
    name: 'Relative Strength Index', short: 'RSI', category: 'Oscillators',
    inputs: { length: { v: 14, min: 1 }, source: { v: 'close', options: SRC }, maLength: { v: 14, min: 1, label: 'MA length' } },
    plots: [{ key: 'rsi', title: 'RSI', color: '#7e57c2', width: 1.5 }, { key: 'ma', title: 'RSI MA', color: C.yellow, width: 1 }],
    levels: [{ v: 70 }, { v: 50, dash: [1, 3] }, { v: 30 }], levelFill: [70, 30, 'rgba(126,87,194,0.08)'], range: [0, 100],
    calc(b, i) { const r = rsiCalc(source(b, i.source), i.length); return { rsi: r, ma: sma(r, i.maLength) }; },
  },
  macd: {
    name: 'MACD', short: 'MACD', category: 'Oscillators',
    inputs: { fast: { v: 12, min: 1 }, slow: { v: 26, min: 1 }, signal: { v: 9, min: 1 }, source: { v: 'close', options: SRC } },
    plots: [
      { key: 'hist', title: 'Histogram', type: 'hist', color: '#26a69a', colorFn: (v, k, o) => (v >= 0 ? (o.hist[k - 1] < v ? '#26a69a' : '#b2dfdb') : (o.hist[k - 1] > v ? '#ff5252' : '#ffcdd2')) },
      { key: 'macd', title: 'MACD', color: C.blue, width: 1.5 }, { key: 'signal', title: 'Signal', color: C.orange, width: 1.5 },
    ],
    levels: [{ v: 0, dash: [1, 3] }],
    calc(b, i) { const s = source(b, i.source); const sl = ema(s, i.slow); const m = ema(s, i.fast).map((v, k) => v - sl[k]); const sig = ema(m, i.signal); return { macd: m, signal: sig, hist: m.map((v, k) => v - sig[k]) }; },
  },
  stoch: {
    name: 'Stochastic', short: 'Stoch', category: 'Oscillators',
    inputs: { k: { v: 14, min: 1, label: '%K length' }, smooth: { v: 3, min: 1, label: '%K smoothing' }, d: { v: 3, min: 1, label: '%D smoothing' } },
    plots: [{ key: 'k', title: '%K', color: C.blue, width: 1.5 }, { key: 'd', title: '%D', color: C.orange, width: 1 }],
    levels: [{ v: 80 }, { v: 20 }], levelFill: [80, 20, 'rgba(41,98,255,0.06)'], range: [0, 100],
    calc(b, i) {
      const hh = highest(source(b, 'high'), i.k), ll = lowest(source(b, 'low'), i.k);
      const raw = b.map((x, k) => (100 * (x.c - ll[k])) / (hh[k] - ll[k] || 1));
      const k = sma(raw, i.smooth); return { k, d: sma(k, i.d) };
    },
  },
  stochrsi: {
    name: 'Stochastic RSI', short: 'Stoch RSI', category: 'Oscillators',
    inputs: { rsiLength: { v: 14, min: 1 }, stochLength: { v: 14, min: 1 }, k: { v: 3, min: 1 }, d: { v: 3, min: 1 } },
    plots: [{ key: 'k', title: 'K', color: C.blue, width: 1.5 }, { key: 'd', title: 'D', color: C.orange, width: 1 }],
    levels: [{ v: 80 }, { v: 20 }], levelFill: [80, 20, 'rgba(41,98,255,0.06)'], range: [0, 100],
    calc(b, i) {
      const r = rsiCalc(source(b), i.rsiLength), hh = highest(r, i.stochLength), ll = lowest(r, i.stochLength);
      const raw = r.map((v, k) => (100 * (v - ll[k])) / (hh[k] - ll[k] || 1));
      const k = sma(raw, i.k); return { k, d: sma(k, i.d) };
    },
  },
  cci: {
    name: 'Commodity Channel Index', short: 'CCI', category: 'Oscillators',
    inputs: { length: { v: 20, min: 1 } },
    plots: [{ key: 'cci', title: 'CCI', color: C.blue, width: 1.5 }],
    levels: [{ v: 100 }, { v: 0, dash: [1, 3] }, { v: -100 }], levelFill: [100, -100, 'rgba(41,98,255,0.06)'],
    calc(b, i) {
      const tp = source(b, 'hlc3'), m = sma(tp, i.length), out = NaNArr(b.length);
      for (let k = i.length - 1; k < b.length; k++) { let md = 0; for (let j = 0; j < i.length; j++) md += Math.abs(tp[k - j] - m[k]); md /= i.length; out[k] = (tp[k] - m[k]) / (0.015 * md || 1); }
      return { cci: out };
    },
  },
  willr: {
    name: 'Williams %R', short: '%R', category: 'Oscillators', inputs: { length: { v: 14, min: 1 } },
    plots: [{ key: 'r', title: '%R', color: '#7e57c2', width: 1.5 }], levels: [{ v: -20 }, { v: -80 }], levelFill: [-20, -80, 'rgba(126,87,194,0.08)'], range: [-100, 0],
    calc(b, i) { const hh = highest(source(b, 'high'), i.length), ll = lowest(source(b, 'low'), i.length); return { r: b.map((x, k) => (-100 * (hh[k] - x.c)) / (hh[k] - ll[k] || 1)) }; },
  },
  mfi: {
    name: 'Money Flow Index', short: 'MFI', category: 'Volume', inputs: { length: { v: 14, min: 1 } },
    plots: [{ key: 'mfi', title: 'MFI', color: '#7e57c2', width: 1.5 }], levels: [{ v: 80 }, { v: 20 }], levelFill: [80, 20, 'rgba(126,87,194,0.08)'], range: [0, 100],
    calc(b, i) {
      const tp = source(b, 'hlc3'), out = NaNArr(b.length);
      for (let k = i.length; k < b.length; k++) {
        let p = 0, m = 0;
        for (let j = 0; j < i.length; j++) { const x = k - j; const mf = tp[x] * b[x].v; if (tp[x] > tp[x - 1]) p += mf; else if (tp[x] < tp[x - 1]) m += mf; }
        out[k] = m === 0 ? 100 : 100 - 100 / (1 + p / m);
      }
      return { mfi: out };
    },
  },
  atr: {
    name: 'Average True Range', short: 'ATR', category: 'Volatility', inputs: { length: { v: 14, min: 1 } },
    plots: [{ key: 'atr', title: 'ATR', color: C.red, width: 1.5 }], calc(b, i) { return { atr: atr(b, i.length) }; },
  },
  adx: {
    name: 'Directional Movement Index (ADX)', short: 'DMI', category: 'Trend', inputs: { length: { v: 14, min: 1 } },
    plots: [{ key: 'adx', title: 'ADX', color: C.red, width: 1.5 }, { key: 'p', title: '+DI', color: C.blue, width: 1 }, { key: 'm', title: '-DI', color: C.orange, width: 1 }],
    levels: [{ v: 25, dash: [2, 3] }],
    calc(b, i) { return dmi(b, i.length); },
  },
  obv: {
    name: 'On Balance Volume', short: 'OBV', category: 'Volume', inputs: {},
    plots: [{ key: 'obv', title: 'OBV', color: C.blue, width: 1.5 }],
    calc(b) { let s = 0; return { obv: b.map((x, k) => (s += k === 0 ? 0 : x.c > b[k - 1].c ? x.v : x.c < b[k - 1].c ? -x.v : 0)) }; },
  },
  cmf: {
    name: 'Chaikin Money Flow', short: 'CMF', category: 'Volume', inputs: { length: { v: 20, min: 1 } },
    plots: [{ key: 'cmf', title: 'CMF', type: 'hist', color: C.green, colorFn: (v) => (v >= 0 ? '#26a69a' : '#ef5350') }], levels: [{ v: 0 }],
    calc(b, i) {
      const mfv = b.map((x) => (x.h === x.l ? 0 : (((x.c - x.l) - (x.h - x.c)) / (x.h - x.l)) * x.v));
      const a = sma(mfv, i.length), v = sma(b.map((x) => x.v), i.length);
      return { cmf: a.map((x, k) => x / (v[k] || 1)) };
    },
  },
  roc: {
    name: 'Rate Of Change', short: 'ROC', category: 'Momentum', inputs: { length: { v: 9, min: 1 } },
    plots: [{ key: 'roc', title: 'ROC', color: C.blue, width: 1.5 }], levels: [{ v: 0 }],
    calc(b, i) { const c = source(b); return { roc: c.map((v, k) => (k >= i.length ? (100 * (v - c[k - i.length])) / c[k - i.length] : NaN)) }; },
  },
  mom: {
    name: 'Momentum', short: 'Mom', category: 'Momentum', inputs: { length: { v: 10, min: 1 } },
    plots: [{ key: 'mom', title: 'Momentum', color: C.blue, width: 1.5 }], levels: [{ v: 0 }],
    calc(b, i) { const c = source(b); return { mom: c.map((v, k) => (k >= i.length ? v - c[k - i.length] : NaN)) }; },
  },
  aroon: {
    name: 'Aroon', short: 'Aroon', category: 'Trend', inputs: { length: { v: 14, min: 1 } },
    plots: [{ key: 'up', title: 'Aroon Up', color: C.orange, width: 1.5 }, { key: 'dn', title: 'Aroon Down', color: C.blue, width: 1.5 }], range: [0, 100],
    calc(b, i) {
      const n = i.length, up = NaNArr(b.length), dn = NaNArr(b.length);
      for (let k = n; k < b.length; k++) {
        let hi = k, lo = k;
        for (let j = k - n; j <= k; j++) { if (b[j].h >= b[hi].h) hi = j; if (b[j].l <= b[lo].l) lo = j; }
        up[k] = (100 * (n - (k - hi))) / n; dn[k] = (100 * (n - (k - lo))) / n;
      }
      return { up, dn };
    },
  },
  ao: {
    name: 'Awesome Oscillator', short: 'AO', category: 'Momentum', inputs: {},
    plots: [{ key: 'ao', title: 'AO', type: 'hist', color: C.green, colorFn: (v, k, o) => (v >= (o.ao[k - 1] ?? v) ? '#26a69a' : '#ef5350') }],
    calc(b) { const m = source(b, 'hl2'), f = sma(m, 5), s = sma(m, 34); return { ao: f.map((v, k) => v - s[k]) }; },
  },
  volpane: {
    name: 'Volume (separate pane)', short: 'Volume', category: 'Volume', inputs: { maLength: { v: 20, min: 1, label: 'MA length' } },
    plots: [{ key: 'vol', title: 'Volume', type: 'hist', color: '#26a69a80', color2: '#ef535080', barColor: true }, { key: 'ma', title: 'MA', color: C.blue, width: 1 }],
    calc(b, i) { const v = b.map((x) => x.v); return { vol: v, ma: sma(v, i.maLength) }; },
  },
};

export const CATEGORY_ORDER = ['Moving averages', 'Trend', 'Oscillators', 'Momentum', 'Volatility', 'Volume', 'Support/Resistance'];

/** Build a new indicator instance with default inputs & styles */
export function createIndicator(type, overrides = {}) {
  const def = INDICATORS[type];
  const inputs = {}; for (const [k, v] of Object.entries(def.inputs)) inputs[k] = v.v;
  const styles = {}; for (const p of def.plots) styles[p.key] = { color: p.color, width: p.width || 1, visible: true };
  return { uid: Math.random().toString(36).slice(2, 9), type, inputs: { ...inputs, ...(overrides.inputs || {}) }, styles: { ...styles, ...(overrides.styles || {}) }, visible: true };
}

export function indicatorLabel(ind) {
  const def = INDICATORS[ind.type];
  const vals = Object.entries(ind.inputs).filter(([k, v]) => typeof v !== 'boolean' && k !== 'offset' || (k === 'offset' && v)).map(([, v]) => v);
  return def.short + (vals.length ? ' ' + vals.join(' ') : '');
}
