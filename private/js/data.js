// Datafeed: historical bars + realtime updates + quotes for all symbol sources.
import { getSymbol } from './symbols.js';
import { Emitter, ivInfo, isIntraday, seeded } from './utils.js';

const BINANCE = 'https://api.binance.com/api/v3';
const BINANCE_F = 'https://fapi.binance.com/fapi/v1';
const BWS = 'wss://stream.binance.com:9443';
const BWS_F = 'wss://fstream.binance.com/market'; // futures streams moved to /market (the old /ws path connects but sends nothing)
const BIV = { '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1h', '2h': '2h', '4h': '4h', '1D': '1d', '1W': '1w', '1M': '1M' };
let binanceDown = false;

function binanceRest(sym) { return sym.futures ? BINANCE_F : BINANCE; }
function binanceWs(sym) { return sym.futures ? BWS_F : BWS; }

async function getJSON(url, timeout = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (r.status === 401 && url.startsWith('/api/')) { location.href = '/login.html'; throw new Error('Session expired — please log in'); }
    if (!r.ok) { let m = 'HTTP ' + r.status; try { m = (await r.json()).error || m; } catch (e) { /* */ } throw new Error(m); }
    return await r.json();
  } finally { clearTimeout(t); }
}

const parseKlines = (arr) => arr.map((k) => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));

// ---------------------------------------------------------------- demo data (offline fallback)
function demoBars(sym, iv, n = 1500) {
  const rnd = seeded(sym.id + iv);
  const ms = ivInfo(iv).ms;
  let price = (sym.approx || 100) * (0.7 + rnd() * 0.3);
  const vol = isIntraday(iv) ? 0.004 * Math.sqrt(ms / 300e3) : 0.018 * Math.sqrt(ms / 86400e3);
  const out = [];
  let t = Math.floor(Date.now() / ms) * ms - (n - 1) * ms;
  let drift = 0;
  for (let i = 0; i < n; i++, t += ms) {
    if (i % 80 === 0) drift = (rnd() - 0.48) * vol * 0.3;
    const o = price;
    const c = Math.max(o * (1 + drift + (rnd() - 0.5) * 2 * vol), 0.0001);
    const h = Math.max(o, c) * (1 + rnd() * vol * 0.7);
    const l = Math.min(o, c) * (1 - rnd() * vol * 0.7);
    out.push({ t, o, h, l, c, v: Math.round((0.5 + rnd()) * 1e5 * (sym.type === 'crypto' ? 0.01 : 10)) });
    price = c;
  }
  // rescale so the last close ~ approx
  const k = (sym.approx || 100) / out[out.length - 1].c;
  for (const b of out) { b.o *= k; b.h *= k; b.l *= k; b.c *= k; }
  return out;
}

// ---------------------------------------------------------------- history
export async function getBars(symId, iv) {
  const sym = getSymbol(symId);
  try {
    if (sym.src === 'binance' && !binanceDown) {
      try {
        const arr = await getJSON(`${binanceRest(sym)}/klines?symbol=${sym.ticker}&interval=${BIV[iv]}&limit=1000`);
        return { bars: parseKlines(arr), source: sym.futures ? 'Binance Futures' : 'Binance', live: true };
      } catch (e) {
        if (!sym.futures) binanceDown = true;
        console.warn('Binance unavailable, falling back to Yahoo', e);
      }
    }
    const ticker = sym.src === 'binance' ? sym.fb : sym.ticker;
    const d = await getJSON(`/api/history?symbol=${encodeURIComponent(ticker)}&interval=${iv}`);
    if (!d.bars || !d.bars.length) throw new Error('No data');
    if (d.meta && d.meta.name && sym.name === sym.id.split(':')[1]) sym.name = d.meta.name;
    return { bars: d.bars, source: sym.src === 'syn' ? 'Synthetic (Yahoo)' : 'Yahoo Finance', meta: d.meta, live: true };
  } catch (e) {
    console.warn('History failed, using demo data:', symId, e.message);
    return { bars: demoBars(sym, iv), source: 'DEMO DATA', demo: true, error: e.message };
  }
}

/** Load older bars (Binance only supports deep pagination) */
export async function loadMore(symId, iv, beforeT) {
  const sym = getSymbol(symId);
  if (sym.src !== 'binance' || binanceDown) return [];
  try {
    const arr = await getJSON(`${binanceRest(sym)}/klines?symbol=${sym.ticker}&interval=${BIV[iv]}&limit=1000&endTime=${beforeT - 1}`);
    const bars = parseKlines(arr);
    if (bars.length) return bars;
  } catch (e) { /* fall through to Yahoo */ }
  // Binance has no older data (e.g. XAUUSDT futures only started Dec 2025) -> backfill from Yahoo proxy (GC=F)
  if (!sym.fb) return [];
  try {
    const d = await getJSON(`/api/history?symbol=${encodeURIComponent(sym.fb)}&interval=${iv}`);
    return (d.bars || []).filter((b) => b.t < beforeT);
  } catch (e) { return []; }
}

// ---------------------------------------------------------------- realtime
/** subscribe(symId, iv, onBar, demo) -> unsubscribe. onBar receives bars to merge (by timestamp). */
export function subscribe(symId, iv, onBar, demo = false) {
  const sym = getSymbol(symId);
  let closed = false, ws = null, timer = null;

  if (demo) {
    const ms = ivInfo(iv).ms;
    const rnd = seeded(symId + Date.now());
    let last = null;
    timer = setInterval(() => {
      if (!last) return;
      const now = Date.now();
      const bt = Math.floor(now / ms) * ms;
      const move = last.c * (rnd() - 0.5) * 0.0015;
      if (bt > last.t && isIntraday(iv)) {
        last = { t: bt, o: last.c, h: last.c, l: last.c, c: last.c, v: 0 };
      }
      const c = Math.max(last.c + move, 0.0001);
      last = { ...last, c, h: Math.max(last.h, c), l: Math.min(last.l, c), v: last.v + Math.round(rnd() * 500) };
      onBar([last]);
    }, 1000);
    return { stop: () => clearInterval(timer), seed: (b) => { last = { ...b }; } };
  }

  if (sym.src === 'binance' && !binanceDown) {
    let lastMsg = Date.now(), watchdog = null;
    const connect = () => {
      if (closed) return;
      ws = new WebSocket(`${binanceWs(sym)}/ws/${sym.ticker.toLowerCase()}@kline_${BIV[iv]}`);
      ws.onmessage = (ev) => {
        if (closed) return;
        lastMsg = Date.now();
        try {
          const k = JSON.parse(ev.data).k;
          onBar([{ t: k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v }]);
        } catch (e) { /* ignore */ }
      };
      ws.onclose = () => { if (!closed) setTimeout(connect, 3000); };
      ws.onerror = () => { try { ws.close(); } catch (e) { /* */ } };
    };
    connect();
    // safety net: if the stream goes quiet, pull the latest candles over REST so the chart never freezes
    watchdog = setInterval(async () => {
      if (closed || Date.now() - lastMsg < 8000) return;
      try {
        const arr = await getJSON(`${binanceRest(sym)}/klines?symbol=${sym.ticker}&interval=${BIV[iv]}&limit=2`, 8000);
        if (!closed) onBar(parseKlines(arr));
      } catch (e) { /* ignore */ }
    }, 3000);
    return { stop: () => { closed = true; clearInterval(watchdog); try { ws && ws.close(); } catch (e) { /* */ } }, seed() {} };
  }

  // Yahoo / synthetic: poll recent bars
  const ticker = sym.src === 'binance' ? sym.fb : sym.ticker;
  const period = sym.type === 'crypto' || sym.src === 'binance' ? 10e3 : 15e3;
  const poll = async () => {
    if (closed) return;
    try {
      const d = await getJSON(`/api/history?symbol=${encodeURIComponent(ticker)}&interval=${iv}&latest=1`);
      if (!closed && d.bars && d.bars.length) onBar(d.bars.slice(-5));
    } catch (e) { /* ignore */ }
  };
  timer = setInterval(poll, period);
  setTimeout(poll, 2500);
  return { stop: () => { closed = true; clearInterval(timer); }, seed() {} };
}

// ---------------------------------------------------------------- quotes hub
class QuoteHub extends Emitter {
  constructor() {
    super();
    this.quotes = new Map();
    this.interest = new Map(); // key -> Set(symIds)
    this.timerY = null; this.timerB = null;
  }
  setInterest(key, ids) { this.interest.set(key, new Set(ids)); this.kick(); }
  all() { const s = new Set(); for (const v of this.interest.values()) for (const x of v) s.add(x); return [...s]; }
  get(id) { return this.quotes.get(id); }
  kick() {
    clearTimeout(this._k);
    this._k = setTimeout(() => { this.pollYahoo(); this.pollBinance(); }, 50);
    if (!this.timerY) {
      this.timerY = setInterval(() => this.pollYahoo(), 15000);
      this.timerB = setInterval(() => this.pollBinance(), 5000);
    }
  }
  set(id, q) {
    const prev = this.quotes.get(id) || {};
    const nq = { ...prev, ...q, id, ts: Date.now() };
    this.quotes.set(id, nq);
    this.emit('quote', id, nq, prev);
  }
  /** Push a realtime last price (from chart streams) */
  push(id, price) {
    const q = this.quotes.get(id);
    if (!q || !q.prevClose) { if (q) this.set(id, { price }); return; }
    if (q.price === price) return;
    this.set(id, { price, change: price - q.prevClose, changePct: ((price - q.prevClose) / q.prevClose) * 100, high: Math.max(q.high ?? price, price), low: Math.min(q.low ?? price, price) });
  }
  async pollYahoo() {
    const ids = this.all().filter((id) => { const s = getSymbol(id); return s.src !== 'binance' || binanceDown; });
    if (!ids.length) return;
    const map = new Map(ids.map((id) => { const s = getSymbol(id); return [s.src === 'binance' ? s.fb : s.ticker, id]; }));
    const keys = [...map.keys()];
    for (let i = 0; i < keys.length; i += 40) {
      try {
        const arr = await getJSON(`/api/quote?symbols=${encodeURIComponent(keys.slice(i, i + 40).join(','))}`, 20000);
        for (const q of arr) {
          const id = map.get(q.symbol);
          if (!id || q.error || q.price == null) continue;
          this.set(id, q);
        }
      } catch (e) { this.demoQuotes(ids); }
    }
  }
  async pollBinance() {
    if (binanceDown) return;
    const ids = this.all().filter((id) => getSymbol(id).src === 'binance');
    if (!ids.length) return;
    const spot = ids.filter((id) => !getSymbol(id).futures);
    const fut = ids.filter((id) => getSymbol(id).futures);
    const apply = (arr, idList, exchange) => {
      for (const r of arr) {
        const id = idList.find((x) => getSymbol(x).ticker === r.symbol);
        if (!id) continue;
        const price = +r.lastPrice, prev = +r.openPrice;
        this.set(id, {
          price, prevClose: prev, change: +r.priceChange, changePct: +r.priceChangePercent,
          open: prev, high: +r.highPrice, low: +r.lowPrice, volume: +r.volume, quoteVolume: +r.quoteVolume,
          currency: 'USDT', exchange, time: r.closeTime,
        });
      }
    };
    try {
      if (spot.length) {
        const tick = spot.map((id) => getSymbol(id).ticker);
        apply(await getJSON(`${BINANCE}/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(tick))}`), spot, 'Binance');
      }
      for (const id of fut) {
        const t = getSymbol(id).ticker;
        const r = await getJSON(`${BINANCE_F}/ticker/24hr?symbol=${t}`);
        apply([r], [id], 'Binance Futures');
      }
    } catch (e) { binanceDown = true; this.pollYahoo(); }
  }
  demoQuotes(ids) {
    for (const id of ids) {
      if (this.quotes.has(id) && !this.quotes.get(id).demo) continue;
      const s = getSymbol(id);
      const rnd = seeded(id + Math.floor(Date.now() / 15000));
      const prev = s.approx || 100;
      const price = prev * (1 + (rnd() - 0.5) * 0.04);
      this.set(id, { price, prevClose: prev, change: price - prev, changePct: ((price - prev) / prev) * 100, high: Math.max(price, prev) * 1.005, low: Math.min(price, prev) * 0.995, volume: Math.round(rnd() * 1e7), demo: true });
    }
  }
}
export const quotes = new QuoteHub();

export async function searchRemote(q) {
  try { return await getJSON(`/api/search?q=${encodeURIComponent(q)}`, 8000); } catch (e) { return []; }
}
