// ---------------------------------------------------------------- DOM helpers
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

export function h(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
}

export class Emitter {
  constructor() { this._ev = {}; }
  on(n, f) { (this._ev[n] ||= []).push(f); return () => this.off(n, f); }
  off(n, f) { this._ev[n] = (this._ev[n] || []).filter((x) => x !== f); }
  emit(n, ...a) { for (const f of this._ev[n] || []) { try { f(...a); } catch (e) { console.error(e); } } }
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const uid = () => Math.random().toString(36).slice(2, 10);
export function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
export function throttleRaf(fn) { let q = false; return () => { if (q) return; q = true; requestAnimationFrame(() => { q = false; fn(); }); }; }

// ---------------------------------------------------------------- number formatting
export function precisionFor(p) {
  const a = Math.abs(p);
  if (!isFinite(a) || a === 0) return 2;
  if (a >= 1) return 2;
  if (a >= 0.01) return 4;
  return 6;
}
export function fmtPrice(p, prec) {
  if (p == null || !isFinite(p)) return '—';
  return Number(p).toLocaleString('en-IN', { minimumFractionDigits: prec ?? precisionFor(p), maximumFractionDigits: prec ?? precisionFor(p) });
}
export function fmtPlain(p, prec) {
  if (p == null || !isFinite(p)) return '—';
  return Number(p).toFixed(prec ?? precisionFor(p));
}
export function fmtVol(v) {
  if (v == null || !isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return (v / 1e3).toFixed(2) + 'K';
  return a < 10 ? v.toFixed(2) : Math.round(v).toString();
}
export function fmtINRShort(v) {
  if (v == null || !isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e7) return (v / 1e7).toFixed(2) + ' Cr';
  if (a >= 1e5) return (v / 1e5).toFixed(2) + ' L';
  return fmtPrice(v, 2);
}
export const fmtPct = (v) => (v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%');
export const signCls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : '');

export function niceStep(range, target) {
  const raw = range / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  const s = n < 1.5 ? 1 : n < 2.25 ? 2 : n < 3.5 ? 2.5 : n < 7.5 ? 5 : 10;
  return s * mag;
}

// ---------------------------------------------------------------- intervals
export const INTERVALS = [
  { id: '1m', label: '1 minute', short: '1m', ms: 60e3 },
  { id: '3m', label: '3 minutes', short: '3m', ms: 180e3 },
  { id: '5m', label: '5 minutes', short: '5m', ms: 300e3 },
  { id: '15m', label: '15 minutes', short: '15m', ms: 900e3 },
  { id: '30m', label: '30 minutes', short: '30m', ms: 1800e3 },
  { id: '1h', label: '1 hour', short: '1h', ms: 3600e3 },
  { id: '2h', label: '2 hours', short: '2h', ms: 7200e3 },
  { id: '4h', label: '4 hours', short: '4h', ms: 14400e3 },
  { id: '1D', label: '1 day', short: 'D', ms: 86400e3 },
  { id: '1W', label: '1 week', short: 'W', ms: 7 * 86400e3 },
  { id: '1M', label: '1 month', short: 'M', ms: 30 * 86400e3 },
];
export const ivInfo = (id) => INTERVALS.find((x) => x.id === id) || INTERVALS[7];
export const isIntraday = (id) => ivInfo(id).ms < 86400e3;

// ---------------------------------------------------------------- time zones
export const TIMEZONES = [
  { id: 'Asia/Kolkata', label: '(UTC+5:30) Kolkata / Mumbai' },
  { id: 'UTC', label: 'UTC' },
  { id: 'local', label: 'Local (browser)' },
  { id: 'America/New_York', label: '(UTC-5) New York' },
  { id: 'Europe/London', label: '(UTC) London' },
  { id: 'Asia/Dubai', label: '(UTC+4) Dubai' },
  { id: 'Asia/Singapore', label: '(UTC+8) Singapore' },
  { id: 'Asia/Tokyo', label: '(UTC+9) Tokyo' },
];
let TZ = 'Asia/Kolkata';
const offCache = new Map();
export function setTimezone(tz) { TZ = tz; offCache.clear(); }
export function getTimezone() { return TZ; }
export function tzOffset(t) {
  if (TZ === 'Asia/Kolkata') return 19800e3;
  if (TZ === 'UTC') return 0;
  if (TZ === 'local') return -new Date(t).getTimezoneOffset() * 60e3;
  const k = Math.floor(t / 3600e3);
  let o = offCache.get(k);
  if (o == null) {
    const d = new Date(t);
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(d);
    const g = (n) => +parts.find((p) => p.type === n).value;
    const asUTC = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second'));
    o = asUTC - Math.floor(t / 1000) * 1000;
    offCache.set(k, o);
  }
  return o;
}
export function tparts(t) {
  const d = new Date(t + tzOffset(t));
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(), wd: d.getUTCDay() };
}
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const p2 = (n) => String(n).padStart(2, '0');
export function fmtTime(t, iv, withDay = true) {
  const p = tparts(t);
  const date = `${DAYS[p.wd]} ${p2(p.d)} ${MONTHS[p.mo]} '${String(p.y).slice(2)}`;
  if (iv && !isIntraday(iv)) return withDay ? date : `${p2(p.d)} ${MONTHS[p.mo]} ${p.y}`;
  return `${withDay ? date + '  ' : ''}${p2(p.h)}:${p2(p.mi)}`;
}
export function fmtClock(t) { const p = tparts(t); return `${p2(p.h)}:${p2(p.mi)}:${p2(p.s)}`; }
export function fmtDateShort(t) { const p = tparts(t); return `${p2(p.d)} ${MONTHS[p.mo]} ${p.y} ${p2(p.h)}:${p2(p.mi)}`; }
export function fmtDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400), hh = Math.floor((s % 86400) / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  if (d > 0) return `${d}d ${hh}h`;
  if (hh > 0) return `${p2(hh)}:${p2(mm)}:${p2(ss)}`;
  return `${p2(mm)}:${p2(ss)}`;
}

// NSE market session (Mon-Fri 09:15-15:30 IST, holidays not considered)
export function nseStatus(now = Date.now()) {
  const d = new Date(now + 19800e3);
  const wd = d.getUTCDay();
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  if (wd === 0 || wd === 6) return { open: false, label: 'Market closed (weekend)' };
  if (mins >= 9 * 60 && mins < 9 * 60 + 15) return { open: false, pre: true, label: 'Pre-open session' };
  if (mins >= 9 * 60 + 15 && mins < 15 * 60 + 30) return { open: true, label: 'Market open' };
  return { open: false, label: mins < 9 * 60 ? 'Opens 09:15 IST' : 'Market closed' };
}

// ---------------------------------------------------------------- storage
const KEY = 'chartvista.v1.';
export const store = {
  get(k, d) { try { const v = localStorage.getItem(KEY + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch (e) { /* quota */ } },
  del(k) { localStorage.removeItem(KEY + k); },
};

// seeded RNG for demo data
export function seeded(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
}

export function download(name, dataUrlOrBlob) {
  const a = document.createElement('a');
  a.download = name;
  a.href = typeof dataUrlOrBlob === 'string' ? dataUrlOrBlob : URL.createObjectURL(dataUrlOrBlob);
  document.body.append(a); a.click(); a.remove();
}

// beep for alerts
let actx;
export function beep(freq = 880, dur = 0.15) {
  try {
    actx ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain();
    o.frequency.value = freq; o.type = 'sine';
    g.gain.setValueAtTime(0.15, actx.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
    o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + dur);
  } catch (e) { /* ignore */ }
}
