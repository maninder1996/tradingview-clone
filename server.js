/**
 * ChartVista server
 * - Serves the static front-end from /public
 * - Proxies market data from Yahoo Finance (NSE / BSE / indices / commodities / forex)
 * - Builds synthetic INR gold & silver series (international parity)
 * Zero external dependencies: requires Node 18+ (global fetch).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// tiny .env loader for local runs (on Vercel use Project Settings -> Environment Variables)
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch (e) { /* no .env */ }

const PORT = process.env.PORT || 8787;
const PUB = path.join(__dirname, 'public');    // public: login page only
const PRIV = path.join(__dirname, 'private');  // the app, served only after login
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};

// interval -> yahoo params
const IV = {
  '1m': { y: '1m', range: '7d', latest: '1d', ms: 60e3 },
  // Yahoo has no native 3m — fetch 1m and bucket into 3-minute bars
  '3m': { y: '1m', range: '7d', latest: '1d', ms: 180e3, aggMs: 180e3 },
  '5m': { y: '5m', range: '60d', latest: '1d', ms: 300e3 },
  '15m': { y: '15m', range: '60d', latest: '1d', ms: 900e3 },
  '30m': { y: '30m', range: '60d', latest: '1d', ms: 1800e3 },
  '1h': { y: '60m', range: '730d', latest: '5d', ms: 3600e3 },
  '2h': { y: '60m', range: '730d', latest: '5d', agg: 2, ms: 7200e3 },
  '4h': { y: '60m', range: '730d', latest: '5d', agg: 4, ms: 14400e3 },
  '1D': { y: '1d', range: '10y', latest: '5d', ms: 86400e3, daily: true },
  '1W': { y: '1wk', range: 'max', latest: '3mo', ms: 7 * 86400e3, daily: true },
  '1M': { y: '1mo', range: 'max', latest: '1y', ms: 30 * 86400e3, daily: true },
};

// Synthetic INR commodity series (international parity, excl. duties/GST)
const SYN = {
  GOLDINR: { base: 'GC=F', fx: 'INR=X', mult: 10 / 31.1034768, name: 'Gold (INR / 10g, intl. parity)' },
  SILVERINR: { base: 'SI=F', fx: 'INR=X', mult: 1000 / 31.1034768, name: 'Silver (INR / kg, intl. parity)' },
};

// ---------------------------------------------------------------- cache
const cache = new Map();
const pending = new Map();
async function cached(key, ttl, fn) {
  const c = cache.get(key);
  if (c && Date.now() - c.t < ttl) return c.v;
  if (pending.has(key)) return pending.get(key);
  const p = (async () => {
    try {
      const v = await fn();
      cache.set(key, { t: Date.now(), v });
      return v;
    } catch (e) {
      if (c) return c.v; // serve stale on error
      throw e;
    } finally { pending.delete(key); }
  })();
  pending.set(key, p);
  return p;
}
setInterval(() => { // trim cache
  const now = Date.now();
  for (const [k, v] of cache) if (now - v.t > 30 * 60e3) cache.delete(k);
}, 60e3).unref();

async function yfetch(pq) {
  let err;
  for (const host of ['query1', 'query2']) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 12000);
      const r = await fetch(`https://${host}.finance.yahoo.com${pq}`, {
        headers: { 'User-Agent': UA, Accept: 'application/json,text/plain,*/*' }, signal: ctrl.signal,
      });
      clearTimeout(to);
      if (!r.ok) throw new Error('Yahoo HTTP ' + r.status);
      return await r.json();
    } catch (e) { err = e; }
  }
  throw err;
}

// ---------------------------------------------------------------- parsing
function parseChart(j) {
  const r = j && j.chart && j.chart.result && j.chart.result[0];
  if (!r) throw new Error((j && j.chart && j.chart.error && j.chart.error.description) || 'No data');
  const ts = r.timestamp || [];
  const q = (r.indicators && r.indicators.quote && r.indicators.quote[0]) || {};
  const bars = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open && q.open[i], h = q.high && q.high[i], l = q.low && q.low[i], c = q.close && q.close[i];
    if (o == null || h == null || l == null || c == null) continue;
    bars.push({ t: ts[i] * 1000, o, h, l, c, v: (q.volume && q.volume[i]) || 0 });
  }
  return { meta: r.meta || {}, bars };
}

function normalizeDaily(bars, iv, gmtoff) {
  if (!bars.length) return bars;
  const off = (gmtoff || 0) * 1000;
  if (iv === '1D') {
    for (const b of bars) b.t = Math.floor((b.t + off) / 86400e3) * 86400e3 - off;
  }
  // merge trailing "live" bar that belongs to the same period
  const out = [];
  for (const b of bars) {
    const prev = out[out.length - 1];
    const span = iv === '1D' ? 86400e3 - 1 : iv === '1W' ? 7 * 86400e3 - 1 : 28 * 86400e3;
    if (prev && b.t - prev.t <= span && b.t >= prev.t) {
      if (b.t === prev.t || iv !== '1D') {
        prev.h = Math.max(prev.h, b.h); prev.l = Math.min(prev.l, b.l); prev.c = b.c; prev.v = Math.max(prev.v, b.v);
        continue;
      }
    }
    out.push(b);
  }
  return out;
}

function aggregate(bars, n, gmtoff) {
  const out = [];
  let cur = null, curKey = null, dayKey = null, dayFirst = 0;
  for (const b of bars) {
    const d = Math.floor((b.t / 1000 + (gmtoff || 0)) / 86400);
    if (d !== dayKey) { dayKey = d; dayFirst = gmtoff === 0 ? d * 86400e3 : b.t; }
    const k = d + ':' + Math.floor((b.t - dayFirst) / (n * 3600e3));
    if (k !== curKey) {
      cur = { t: dayFirst + Math.floor((b.t - dayFirst) / (n * 3600e3)) * n * 3600e3, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v };
      out.push(cur); curKey = k;
    } else {
      cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; cur.v += b.v;
    }
  }
  return out;
}

function aggregateMs(bars, ms) {
  const out = [];
  let cur = null;
  for (const b of bars) {
    const t = Math.floor(b.t / ms) * ms;
    if (!cur || cur.t !== t) {
      cur = { t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0 };
      out.push(cur);
    } else {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      cur.v += b.v || 0;
    }
  }
  return out;
}

// Yahoo's trailing "live" bar can carry an off-grid timestamp (last trade time). Each poll then looked like a brand-new
// flat o=h=l=c candle (1px dash). Fold any bar that starts inside the previous bar's period into that bar.
function foldOffGrid(bars, ms) {
  const out = [];
  for (const b of bars) {
    const prev = out[out.length - 1];
    if (prev && b.t - prev.t < ms) {
      prev.h = Math.max(prev.h, b.h); prev.l = Math.min(prev.l, b.l); prev.c = b.c; prev.v = Math.max(prev.v || 0, b.v || 0);
    } else out.push({ ...b });
  }
  return out;
}

async function yahooHistory(symbol, iv, latest) {
  const cfg = IV[iv] || IV['1D'];
  const range = latest ? cfg.latest : cfg.range;
  const ttl = latest ? 8e3 : (cfg.daily ? 5 * 60e3 : 30e3);
  return cached(`h:${symbol}:${iv}:${range}`, ttl, async () => {
    const j = await yfetch(`/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${cfg.y}&range=${range}&includePrePost=false&events=div%2Csplit`);
    const { meta, bars } = parseChart(j);
    let out = bars;
    if (cfg.aggMs) out = aggregateMs(bars, cfg.aggMs);
    if (cfg.agg) out = aggregate(bars, cfg.agg, meta.gmtoffset || 0);
    if (cfg.daily) out = normalizeDaily(out, iv, meta.gmtoffset || 0);
    else if (!cfg.agg) out = foldOffGrid(out, cfg.aggMs || cfg.ms);
    return {
      symbol, interval: iv, bars: out,
      meta: {
        currency: meta.currency, exchange: meta.exchangeName, fullExchange: meta.fullExchangeName, tz: meta.exchangeTimezoneName,
        gmtoffset: meta.gmtoffset, name: meta.longName || meta.shortName, type: meta.instrumentType,
        price: meta.regularMarketPrice, prevClose: meta.chartPreviousClose,
      },
    };
  });
}

async function synHistory(id, iv, latest) {
  const s = SYN[id];
  const [base, fx] = await Promise.all([yahooHistory(s.base, iv, latest), yahooHistory(s.fx, iv === '1m' ? '5m' : iv, latest).catch(() => null)]);
  const fxb = fx ? fx.bars : [];
  let fallbackFx = 83.5;
  try { const q = await yahooQuote(s.fx); if (q && q.price) fallbackFx = q.price; } catch (e) { /* ignore */ }
  let j = 0, lastFx = fxb.length ? fxb[0].c : fallbackFx;
  const bars = base.bars.map((b) => {
    while (j < fxb.length && fxb[j].t <= b.t) { lastFx = fxb[j].c; j++; }
    const m = lastFx * s.mult;
    return { t: b.t, o: b.o * m, h: b.h * m, l: b.l * m, c: b.c * m, v: b.v };
  });
  return { symbol: id, interval: iv, bars, meta: { currency: 'INR', exchange: 'SYN', name: s.name, gmtoffset: 19800 } };
}

async function yahooQuote(symbol) {
  return cached(`q:${symbol}`, 10e3, async () => {
    const j = await yfetch(`/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`);
    const r = j && j.chart && j.chart.result && j.chart.result[0];
    if (!r) throw new Error('No quote');
    const m = r.meta || {};
    const price = m.regularMarketPrice;
    const prev = m.regularMarketPreviousClose != null ? m.regularMarketPreviousClose : (m.previousClose != null ? m.previousClose : m.chartPreviousClose);
    const q = r.indicators && r.indicators.quote && r.indicators.quote[0];
    const open = q && q.open && q.open.filter((x) => x != null)[0];
    return {
      symbol, price, prevClose: prev, change: price - prev, changePct: prev ? ((price - prev) / prev) * 100 : 0,
      open: open != null ? open : null,
      high: m.regularMarketDayHigh, low: m.regularMarketDayLow, volume: m.regularMarketVolume,
      high52: m.fiftyTwoWeekHigh, low52: m.fiftyTwoWeekLow, currency: m.currency, name: m.longName || m.shortName,
      exchange: m.fullExchangeName || m.exchangeName, time: (m.regularMarketTime || 0) * 1000,
    };
  });
}

async function synQuote(id) {
  const s = SYN[id];
  const [b, f] = await Promise.all([yahooQuote(s.base), yahooQuote(s.fx)]);
  const k = s.mult;
  const price = b.price * f.price * k;
  const prev = b.prevClose * f.prevClose * k;
  return {
    symbol: id, price, prevClose: prev, change: price - prev, changePct: ((price - prev) / prev) * 100,
    open: b.open ? b.open * f.price * k : null,
    high: b.high ? b.high * f.price * k : null, low: b.low ? b.low * f.price * k : null, volume: b.volume,
    high52: b.high52 ? b.high52 * f.price * k : null, low52: b.low52 ? b.low52 * f.price * k : null,
    currency: 'INR', name: s.name, exchange: 'Synthetic', time: b.time,
  };
}

async function quote(sym) { return SYN[sym] ? synQuote(sym) : yahooQuote(sym); }

async function search(q) {
  return cached(`s:${q.toLowerCase()}`, 10 * 60e3, async () => {
    const j = await yfetch(`/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=25&newsCount=0&listsCount=0`);
    return (j.quotes || []).filter((x) => x.symbol).map((x) => ({
      symbol: x.symbol, name: x.longname || x.shortname || x.symbol, exchange: x.exchange, exchDisp: x.exchDisp, type: x.quoteType,
    }));
  });
}

// ---------------------------------------------------------------- limiter (avoid hammering yahoo)
async function mapLimit(arr, n, fn) {
  const out = new Array(arr.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, arr.length) }, async () => {
    while (i < arr.length) { const k = i++; try { out[k] = await fn(arr[k]); } catch (e) { out[k] = { symbol: arr[k], error: String(e.message || e) }; } }
  }));
  return out;
}

// ---------------------------------------------------------------- cloud state (drawings, layouts, settings)
// Per-user JSON blob. Turso (free, cloud SQLite) when TURSO_URL + TURSO_TOKEN are set; local file otherwise.
const TURSO_URL = (process.env.TURSO_URL || '').replace(/^libsql:/, 'https:').replace(/\/+$/, '');
const TURSO_TOKEN = process.env.TURSO_TOKEN || '';
const STATE_FILE = path.join(__dirname, 'user-state.json');
let tursoReady = false;
async function turso(sql, args = []) {
  const r = await fetch(TURSO_URL + '/v2/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TURSO_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ type: 'execute', stmt: { sql, args: args.map((v) => (typeof v === 'number' ? { type: 'integer', value: String(v) } : { type: 'text', value: String(v) })) } }, { type: 'close' }] }),
  });
  const j = await r.json();
  const e = j.results && j.results[0];
  if (!r.ok || !e || e.type === 'error') throw new Error((e && e.error && e.error.message) || 'turso error ' + r.status);
  return e.response.result.rows;
}
async function stateGet(user) {
  if (TURSO_URL && TURSO_TOKEN) {
    if (!tursoReady) { await turso('CREATE TABLE IF NOT EXISTS user_state (user TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL)'); tursoReady = true; }
    const rows = await turso('SELECT data, updated_at FROM user_state WHERE user = ?', [user]);
    return rows.length ? { data: JSON.parse(rows[0][0].value), updatedAt: Number(rows[0][1].value) } : { data: null, updatedAt: 0 };
  }
  try { const all = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); return all[user] || { data: null, updatedAt: 0 }; } catch (e) { return { data: null, updatedAt: 0 }; }
}
async function statePut(user, data) {
  const updatedAt = Date.now();
  if (TURSO_URL && TURSO_TOKEN) {
    await stateGet(user); // ensures table exists
    await turso('INSERT INTO user_state (user, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(user) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at', [user, JSON.stringify(data), updatedAt]);
  } else {
    let all = {}; try { all = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) { /* new */ }
    all[user] = { data, updatedAt };
    fs.writeFileSync(STATE_FILE, JSON.stringify(all));
  }
  return updatedAt;
}
function readRaw(req, max = 4e6) {
  return new Promise((resolve, reject) => {
    if (req.body !== undefined) return resolve(typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString() : JSON.stringify(req.body));
    let t = '';
    req.on('data', (c) => { t += c; if (t.length > max) { req.destroy(); reject(new Error('too large')); } });
    req.on('end', () => resolve(t));
    req.on('error', reject);
  });
}
async function stateApi(req, res, user) {
  try {
    if (req.method === 'GET') return send(res, 200, await stateGet(user));
    if (req.method === 'PUT') {
      const body = JSON.parse(await readRaw(req) || '{}');
      if (!body.data || typeof body.data !== 'object') return send(res, 400, { error: 'bad body' });
      return send(res, 200, { ok: true, updatedAt: await statePut(user, body.data) });
    }
    return send(res, 405, { error: 'method not allowed' });
  } catch (e) { return send(res, 500, { error: String(e.message || e) }); }
}

// ---------------------------------------------------------------- http
function send(res, code, body, type = 'application/json', extra = {}) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function api(url, res) {
  const p = url.searchParams;
  try {
    if (url.pathname === '/api/history') {
      const sym = p.get('symbol'); const iv = p.get('interval') || '1D'; const latest = p.get('latest') === '1';
      if (!sym) return send(res, 400, { error: 'symbol required' });
      const data = SYN[sym] ? await synHistory(sym, iv, latest) : await yahooHistory(sym, iv, latest);
      return send(res, 200, data);
    }
    if (url.pathname === '/api/quote') {
      const syms = (p.get('symbols') || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 80);
      const out = await mapLimit(syms, 8, quote);
      return send(res, 200, out);
    }
    if (url.pathname === '/api/search') {
      const q = (p.get('q') || '').trim();
      if (!q) return send(res, 200, []);
      return send(res, 200, await search(q));
    }
    if (url.pathname === '/api/health') return send(res, 200, { ok: true, time: Date.now() });
    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 502, { error: String(e.message || e) });
  }
}

// ---------------------------------------------------------------- auth (personal logins, no database)
// AUTH_USERS="alice:password1,bob:password2"   (set in .env locally, or Vercel Environment Variables)
const USERS = new Map();
for (const pair of (process.env.AUTH_USERS || '').split(',')) {
  const i = pair.indexOf(':');
  if (i > 0 && i < pair.length - 1) USERS.set(pair.slice(0, i).trim(), pair.slice(i + 1));
}
const SECRET = process.env.AUTH_SECRET || crypto.createHash('sha256').update('cv|' + (process.env.AUTH_USERS || '')).digest('hex');
const SESSION_MS = 30 * 24 * 3600e3;
const sha = (v) => crypto.createHash('sha256').update(String(v)).digest();
const sign = (v) => crypto.createHmac('sha256', SECRET).update(v).digest('base64url');
const safeEq = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

function makeToken(user) {
  const body = Buffer.from(JSON.stringify({ u: user, e: Date.now() + SESSION_MS })).toString('base64url');
  return `${body}.${sign(body)}`;
}
function sessionUser(req) {
  const m = /(?:^|;\s*)cv_session=([^;]+)/.exec(req.headers.cookie || '');
  if (!m) return null;
  const [body, sig] = m[1].split('.');
  if (!body || !sig || !safeEq(sig, sign(body))) return null;
  try {
    const { u, e } = JSON.parse(Buffer.from(body, 'base64url').toString());
    return e > Date.now() && USERS.has(u) ? u : null;
  } catch (e) { return null; }
}
const cookie = (req, val, maxAge) =>
  `cv_session=${val}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}`;

async function readBody(req) {
  const j = (t) => { try { return JSON.parse(t || '{}'); } catch (e) { return {}; } };
  if (req.body !== undefined) return typeof req.body === 'string' ? j(req.body) : Buffer.isBuffer(req.body) ? j(req.body.toString()) : (req.body || {});
  return new Promise((resolve) => {
    let t = '';
    req.on('data', (c) => { t += c; if (t.length > 1e4) req.destroy(); });
    req.on('end', () => resolve(j(t)));
    req.on('error', () => resolve({}));
  });
}

// best-effort brute-force throttle (per instance memory)
const fails = new Map();
async function login(req, res) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  const f = fails.get(ip);
  const recent = f && Date.now() - f.t < 10 * 60e3;
  if (recent && f.n >= 8) return send(res, 429, { error: 'Too many attempts. Try again in a few minutes.' });
  const { username = '', password = '' } = await readBody(req);
  const name = String(username).trim();
  const stored = USERS.get(name);
  if (stored !== undefined && safeEq(password, stored)) {
    fails.delete(ip);
    return send(res, 200, { ok: true }, 'application/json', { 'Set-Cookie': cookie(req, makeToken(name), SESSION_MS / 1000) });
  }
  fails.set(ip, { n: (recent ? f.n : 0) + 1, t: Date.now() });
  await new Promise((r) => setTimeout(r, 600));
  send(res, 401, { error: USERS.size ? 'Wrong username or password' : 'No users configured on the server (set AUTH_USERS)' });
}

function serveFile(res, dir, file) {
  const fp = path.normalize(path.join(dir, file));
  if (!fp.startsWith(dir)) return send(res, 403, 'Forbidden', 'text/plain');
  fs.readFile(fp, (err, buf) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  // Vercel rewrites every request to /api and passes the real path in ?__path=
  if (url.pathname === '/api' && url.searchParams.has('__path')) {
    url.pathname = '/' + url.searchParams.get('__path').replace(/^\/+/, '');
    url.searchParams.delete('__path');
  }
  const p = url.pathname;
  if (p === '/api/health') return send(res, 200, { ok: true, time: Date.now() });
  if (p === '/api/login' && req.method === 'POST') return login(req, res);
  if (p === '/api/logout') return send(res, 200, { ok: true }, 'application/json', { 'Set-Cookie': cookie(req, '', 0) });
  // PWA files must be reachable without a session (the browser fetches them before/while logging in)
  if (['/manifest.webmanifest', '/sw.js', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'].includes(p)) return serveFile(res, PUB, p);
  const user = sessionUser(req);
  if (p === '/api/me') return user ? send(res, 200, { user }) : send(res, 401, { error: 'login required' });
  if (p === '/api/state') return user ? stateApi(req, res, user) : send(res, 401, { error: 'login required' });
  if (p.startsWith('/api/')) return user ? api(url, res) : send(res, 401, { error: 'login required' });
  if (p === '/login' || p === '/login.html') {
    if (user) return send(res, 302, '', 'text/plain', { Location: '/' });
    return serveFile(res, PUB, '/login.html');
  }
  if (!user) return send(res, 302, '', 'text/plain', { Location: '/login.html' });
  let file = decodeURIComponent(p);
  if (file === '/') file = '/index.html';
  return serveFile(res, PRIV, file);
}

const server = http.createServer(handle);

if (require.main === module) {
  if (!USERS.size) console.warn('WARNING: AUTH_USERS is not set - nobody can log in. Create .env with AUTH_USERS=name:password');
  server.listen(PORT, () => console.log(`ChartVista running at http://localhost:${PORT}`));
}

module.exports = server; // Vercel needs the default export to be a server/function
module.exports.api = api;
module.exports.handle = handle;
