// Paper Trading Simulator, Price Alerts Manager, NIFTY Screener, Pine-style Script Runner & India Gold/Currency Converter
import { Emitter, uid, store, fmtPrice, fmtPct, fmtVol, fmtDateShort, beep } from './utils.js';
import { getSymbol, shortName, NIFTY50, SYMBOLS } from './symbols.js';
import { quotes } from './data.js';
import { sma, ema, rma, wma, stdev, highest, lowest, atr, source } from './indicators.js';

// ================================================================ Paper Trading
export class TradingEngine extends Emitter {
  constructor() {
    super();
    const saved = store.get('trading', null);
    this.balance = saved?.balance ?? 1000000; // ₹10,00,000 default
    this.initialBalance = saved?.initialBalance ?? 1000000;
    this.positions = saved?.positions || []; // {id, symbol, side:'long'|'short', qty, avg, tp, sl, time}
    this.orders = saved?.orders || []; // {id, symbol, side:'buy'|'sell', type:'market'|'limit'|'stop', qty, price, status, time}
    this.history = saved?.history || []; // executed trades
    quotes.on('quote', (sym, q) => { if (q && q.price != null) this.onTick(sym, q.price); });
  }
  save() {
    store.set('trading', {
      balance: this.balance,
      initialBalance: this.initialBalance,
      positions: this.positions,
      orders: this.orders,
      history: this.history.slice(-200),
    });
    this.emit('change');
  }
  reset(amount = 1000000) {
    this.balance = amount;
    this.initialBalance = amount;
    this.positions = [];
    this.orders = [];
    this.history = [];
    this.save();
  }
  positionsFor(sym) { return this.positions.filter((p) => p.symbol === sym); }
  ordersFor(sym) { return this.orders.filter((o) => o.symbol === sym && o.status === 'working'); }

  placeOrder({ symbol, side, type = 'market', qty, price, tp, sl, currentPrice }) {
    qty = Math.max(1, +qty || 1);
    const fillPrice = currentPrice || quotes.get(symbol)?.price || getSymbol(symbol).approx || 100;
    if (type === 'market') {
      return this.executeOrder({ id: uid(), symbol, side, type, qty, price: fillPrice, tp: +tp || null, sl: +sl || null, time: Date.now() }, fillPrice);
    }
    const ord = { id: uid(), symbol, side, type, qty, price: +price || fillPrice, tp: +tp || null, sl: +sl || null, status: 'working', time: Date.now() };
    this.orders.unshift(ord);
    this.save();
    return ord;
  }

  cancelOrder(id) {
    const o = this.orders.find((x) => x.id === id);
    if (o && o.status === 'working') { o.status = 'cancelled'; this.save(); }
  }

  executeOrder(ord, execPrice) {
    const { symbol, side, qty, tp, sl } = ord;
    ord.status = 'filled';
    ord.fillPrice = execPrice;
    ord.fillTime = Date.now();

    let pos = this.positions.find((p) => p.symbol === symbol);
    const dir = side === 'buy' ? 'long' : 'short';
    let realizedPnl = 0;

    if (!pos) {
      pos = { id: uid(), symbol, side: dir, qty, avg: execPrice, last: execPrice, pnl: 0, tp: tp || null, sl: sl || null, time: Date.now() };
      this.positions.push(pos);
      this.emit('opened', pos);
    } else if (pos.side === dir) {
      const totalCost = pos.avg * pos.qty + execPrice * qty;
      pos.qty += qty;
      pos.avg = totalCost / pos.qty;
      if (tp) pos.tp = tp;
      if (sl) pos.sl = sl;
    } else {
      // reducing, closing or flipping
      const closeQty = Math.min(pos.qty, qty);
      realizedPnl = (pos.side === 'long' ? execPrice - pos.avg : pos.avg - execPrice) * closeQty;
      this.balance += realizedPnl;
      pos.qty -= closeQty;
      const rem = qty - closeQty;
      if (pos.qty <= 0) {
        this.positions = this.positions.filter((p) => p !== pos);
        this.emit('closed', pos, execPrice, realizedPnl);
        if (rem > 0) {
          const np = { id: uid(), symbol, side: dir, qty: rem, avg: execPrice, last: execPrice, pnl: 0, tp: tp || null, sl: sl || null, time: Date.now() };
          this.positions.push(np);
          this.emit('opened', np);
        }
      }
    }

    this.history.unshift({
      id: uid(), symbol, side, type: ord.type, qty, price: execPrice, realizedPnl, time: Date.now(),
    });
    this.updatePnl(symbol, execPrice);
    this.save();
    this.emit('fill', ord, execPrice, realizedPnl);
    return ord;
  }

  closePosition(id, currentPrice) {
    const pos = this.positions.find((p) => p.id === id);
    if (!pos) return;
    const px = currentPrice || pos.last || quotes.get(pos.symbol)?.price || pos.avg;
    const side = pos.side === 'long' ? 'sell' : 'buy';
    this.executeOrder({ id: uid(), symbol: pos.symbol, side, type: 'market', qty: pos.qty, price: px, time: Date.now() }, px);
  }

  updatePnl(symbol, price) {
    for (const p of this.positions) {
      if (p.symbol === symbol && isFinite(price)) {
        p.last = price;
        p.pnl = (p.side === 'long' ? price - p.avg : p.avg - price) * p.qty;
        p.pnlPct = ((price - p.avg) / p.avg) * 100 * (p.side === 'long' ? 1 : -1);
      }
    }
  }

  onTick(symbol, price) {
    if (!isFinite(price)) return;
    let changed = false;
    this.updatePnl(symbol, price);
    // Check working orders
    for (const o of [...this.orders]) {
      if (o.status !== 'working' || o.symbol !== symbol) continue;
      const hitLimit = o.type === 'limit' && ((o.side === 'buy' && price <= o.price) || (o.side === 'sell' && price >= o.price));
      const hitStop = o.type === 'stop' && ((o.side === 'buy' && price >= o.price) || (o.side === 'sell' && price <= o.price));
      if (hitLimit || hitStop) {
        this.executeOrder(o, o.price);
        changed = true;
      }
    }
    // Check TP / SL on open positions
    for (const p of [...this.positions]) {
      if (p.symbol !== symbol) continue;
      if (p.tp && ((p.side === 'long' && price >= p.tp) || (p.side === 'short' && price <= p.tp))) {
        this.closePosition(p.id, p.tp);
        changed = true;
      } else if (p.sl && ((p.side === 'long' && price <= p.sl) || (p.side === 'short' && price >= p.sl))) {
        this.closePosition(p.id, p.sl);
        changed = true;
      }
    }
    if (changed) this.save();
    else this.emit('tick');
  }

  summary() {
    const openPnl = this.positions.reduce((s, p) => s + (p.pnl || 0), 0);
    const equity = this.balance + openPnl;
    return { balance: this.balance, openPnl, equity, totalPnl: equity - this.initialBalance };
  }
}

// ================================================================ Price Alerts
export class AlertsManager extends Emitter {
  constructor() {
    super();
    const saved = store.get('alerts', null);
    this.alerts = saved?.alerts || []; // {id, symbol, condition:'crossing'|'crossing_up'|'crossing_down'|'greater'|'less', price, note, active, triggeredAt, lastPrice}
    this.logs = saved?.logs || [];
    quotes.on('quote', (sym, q) => { if (q && q.price != null) this.check(sym, q.price); });
  }
  save() {
    store.set('alerts', { alerts: this.alerts, logs: this.logs.slice(-100) });
    this.emit('change');
  }
  forSymbol(sym) { return this.alerts.filter((a) => a.symbol === sym && a.active); }
  add({ symbol, condition = 'crossing', price, note = '', currentPrice }) {
    const a = {
      id: uid(), symbol, condition, price: +price, note, active: true,
      createdAt: Date.now(), lastPrice: currentPrice ?? quotes.get(symbol)?.price ?? null,
    };
    this.alerts.unshift(a);
    this.save();
    return a;
  }
  remove(id) {
    this.alerts = this.alerts.filter((a) => a.id !== id);
    this.save();
  }
  toggle(id) {
    const a = this.alerts.find((x) => x.id === id);
    if (a) { a.active = !a.active; this.save(); }
  }
  check(symbol, price) {
    if (!isFinite(price)) return;
    let changed = false;
    for (const a of this.alerts) {
      if (!a.active || a.symbol !== symbol) continue;
      const prev = a.lastPrice;
      a.lastPrice = price;
      if (prev == null) continue;
      let hit = false;
      if (a.condition === 'crossing') hit = (prev < a.price && price >= a.price) || (prev > a.price && price <= a.price);
      else if (a.condition === 'crossing_up') hit = prev < a.price && price >= a.price;
      else if (a.condition === 'crossing_down') hit = prev > a.price && price <= a.price;
      else if (a.condition === 'greater') hit = price >= a.price;
      else if (a.condition === 'less') hit = price <= a.price;
      if (hit) {
        a.active = false;
        a.triggeredAt = Date.now();
        const log = { id: uid(), symbol, price: a.price, triggerPrice: price, condition: a.condition, note: a.note, time: Date.now() };
        this.logs.unshift(log);
        beep(940, 0.22);
        this.emit('trigger', a, log);
        changed = true;
      }
    }
    if (changed) this.save();
  }
}

// ================================================================ Pine-style Custom Script Engine
export const DEFAULT_SCRIPT = `// @version=5
// Custom Pine-style Indicator (runs on active chart)
// Available helpers: sma(src, len), ema(src, len), rma(src, len), wma(src, len),
// stdev(src, len), highest(src, len), lowest(src, len), atr(len)
// Series: close, open, high, low, hl2, hlc3, volume

fast = ema(close, 9)
slow = ema(close, 21)
trend = sma(close, 50)

plot(fast, "Fast EMA 9", "#089981", 2)
plot(slow, "Slow EMA 21", "#f23645", 2)
plot(trend, "SMA 50", "#2962ff", 1.5)
`;

export function runCustomScript(code, bars) {
  const n = bars.length;
  const close = source(bars, 'close');
  const open = source(bars, 'open');
  const high = source(bars, 'high');
  const low = source(bars, 'low');
  const hl2 = source(bars, 'hl2');
  const hlc3 = source(bars, 'hlc3');
  const volume = source(bars, 'volume');

  const plots = [];
  const plot = (arr, title = 'Plot', color = '#2962ff', width = 1.5) => {
    const series = Array.isArray(arr) ? arr : new Array(n).fill(+arr);
    plots.push({ key: 'p' + plots.length, title, color, width, series });
  };

  // Transform simple Pine-like syntax (e.g. ta.sma -> sma, strip indicator() declarations)
  const jsLines = [];
  for (const raw of code.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;
    if (/^(indicator|study)\s*\(/.test(line)) continue;
    const cleaned = line
      .replace(/\bta\.(sma|ema|rma|wma|stdev|highest|lowest|atr)\b/g, '$1')
      .replace(/\bcolor\.(\w+)\b/g, '"$1"');
    jsLines.push(cleaned);
  }

  const fn = new Function(
    'close', 'open', 'high', 'low', 'hl2', 'hlc3', 'volume',
    'sma', 'ema', 'rma', 'wma', 'stdev', 'highest', 'lowest', 'atr', 'plot', 'bars',
    jsLines.join('\n')
  );
  fn(
    close, open, high, low, hl2, hlc3, volume,
    sma, ema, rma, wma, stdev, highest, lowest, (len) => atr(bars, len), plot, bars
  );
  return plots;
}

// ================================================================ NIFTY 50 & Multi-Asset Screener
export function getScreenerRows(filter = 'nifty50', sector = 'all', search = '') {
  let ids;
  if (filter === 'nifty50') ids = NIFTY50;
  else if (filter === 'crypto') ids = SYMBOLS.filter((s) => s.type === 'crypto').map((s) => s.id);
  else if (filter === 'commodity') ids = SYMBOLS.filter((s) => s.type === 'commodity').map((s) => s.id);
  else if (filter === 'indices') ids = SYMBOLS.filter((s) => s.type === 'index').map((s) => s.id);
  else ids = SYMBOLS.map((s) => s.id);

  const q = search.trim().toUpperCase();
  return ids
    .map((id) => {
      const sym = getSymbol(id);
      const qt = quotes.get(id) || {};
      const price = qt.price ?? sym.approx ?? 0;
      const changePct = qt.changePct ?? 0;
      const change = qt.change ?? 0;
      const high = qt.high ?? price;
      const low = qt.low ?? price;
      const high52 = qt.high52 ?? price * 1.18;
      const low52 = qt.low52 ?? price * 0.82;
      const pos52 = high52 > low52 ? ((price - low52) / (high52 - low52)) * 100 : 50;
      const signal = changePct > 1.2 ? 'Strong Buy' : changePct > 0.25 ? 'Buy' : changePct < -1.2 ? 'Strong Sell' : changePct < -0.25 ? 'Sell' : 'Neutral';
      return {
        id, short: shortName(id), name: sym.name, sector: sym.sector || sym.type, cur: sym.cur || '₹',
        price, change, changePct, high, low, volume: qt.volume ?? 0, high52, low52, pos52, signal,
      };
    })
    .filter((r) => (sector === 'all' || r.sector === sector) && (!q || r.short.includes(q) || r.name.toUpperCase().includes(q)));
}

// ================================================================ Gold / BTC / INR Calculator Helper
export function getIndiaConversionRates() {
  const usdInr = quotes.get('FX:USDINR')?.price || 84.5;
  const goldOzUsd = quotes.get('COMEX:GC1!')?.price || 3350;
  const silverOzUsd = quotes.get('COMEX:SI1!')?.price || 36;
  const btcUsd = quotes.get('BINANCE:BTCUSDT')?.price || 85000;
  const gold10gInr = quotes.get('INR:GOLD10G')?.price || (goldOzUsd * usdInr * 10) / 31.1034768;
  const silver1kgInr = quotes.get('INR:SILVER1KG')?.price || (silverOzUsd * usdInr * 1000) / 31.1034768;
  return {
    usdInr,
    goldOzUsd,
    silverOzUsd,
    btcUsd,
    btcInr: btcUsd * usdInr,
    gold24k10g: gold10gInr,
    gold22k10g: gold10gInr * (22 / 24),
    gold18k10g: gold10gInr * (18 / 24),
    silver1kgInr,
  };
}
