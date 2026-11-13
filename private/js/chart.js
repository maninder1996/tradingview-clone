// Canvas chart engine: multi-pane price/indicator rendering, scales, crosshair, drawings & interaction.
import { h, Emitter, clamp, uid, niceStep, fmtPrice, fmtPlain, fmtVol, fmtTime, fmtDuration, ivInfo, isIntraday, tparts, tzOffset, MONTHS, precisionFor, store } from './utils.js';
import { INDICATORS, createIndicator, indicatorLabel } from './indicators.js';
import { TOOLS, TOOL_GROUPS, toolName, DEFAULT_STYLE, TOOL_DEFAULTS, label as drawLabel, alpha, roundRect } from './drawings.js';
import { getBars, subscribe, loadMore, quotes } from './data.js';
import { getSymbol, shortName } from './symbols.js';
import { ICON } from './icons.js';

const AXIS_W = 72;
const TIME_H = 28;
const MIN_SPACING = 0.5, MAX_SPACING = 60;
const FONT = '11px Inter, system-ui, -apple-system, Segoe UI, sans-serif';
export const CHART_TYPES = [
  { id: 'candles', label: 'Candles' }, { id: 'hollow', label: 'Hollow candles' }, { id: 'heikin', label: 'Heikin Ashi' },
  { id: 'nogap', label: 'No gaps (open = prev close)' },
  { id: 'bars', label: 'Bars' }, { id: 'line', label: 'Line' }, { id: 'linemarkers', label: 'Line with markers' }, { id: 'step', label: 'Step line' },
  { id: 'area', label: 'Area' }, { id: 'baseline', label: 'Baseline' }, { id: 'columns', label: 'Columns' }, { id: 'hilo', label: 'High-low' },
];

function heikin(bars) {
  const out = []; let po, pc;
  for (const b of bars) {
    const c = (b.o + b.h + b.l + b.c) / 4; const o = po == null ? (b.o + b.c) / 2 : (po + pc) / 2;
    out.push({ t: b.t, o, c, h: Math.max(b.h, o, c), l: Math.min(b.l, o, c), v: b.v }); po = o; pc = c;
  }
  return out;
}

/** TradingView-style “no gaps”: each open = previous close so overnight gaps disappear */
function noGap(bars) {
  const out = [];
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    let o = b.o, h = b.h, l = b.l, c = b.c;
    if (i > 0) {
      o = out[i - 1].c;
      h = Math.max(h, o, c);
      l = Math.min(l, o, c);
    }
    out.push({ t: b.t, o, h, l, c, v: b.v });
  }
  return out;
}

export class Chart extends Emitter {
  constructor(app, mount, state = {}) {
    super();
    this.app = app;
    this.id = uid();
    this.state = { symbol: 'NSE:NIFTY', interval: '1D', type: 'candles', logScale: false, indicators: null, paneRatios: {}, ...state };
    if (!this.state.indicators) this.state.indicators = [createIndicator('vol')];
    this.bars = []; this.ver = 0; this.indCache = new Map(); this.compareData = {};
    this.view = { spacing: 8, right: 0 };
    this.scales = {}; // paneKey -> {auto, min, max}
    this.mouse = { x: -1, y: -1, inside: false };
    this.selected = null; this.creating = null; this.drag = null; this.hoverDrawing = null;
    this.replay = null; this.loading = false; this.source = '';
    this.buildDom(mount);
    this.render = this.render.bind(this);
    this._raf = 0;
    this.load();
    this._tick = setInterval(() => { if (this.bars.length && isIntraday(this.state.interval)) this.requestRender(); }, 1000);
  }

  // ------------------------------------------------------------------ DOM
  buildDom(mount) {
    this.root = h('div', { class: 'chart-cell' });
    this.canvas = h('canvas', { class: 'chart-canvas' });
    this.legend = h('div', { class: 'legend' });
    this.paneLegends = h('div', { class: 'pane-legends' });
    this.status = h('div', { class: 'chart-status hidden' });
    this.toLatest = h('button', { class: 'to-latest hidden', title: 'Scroll to the most recent bar', html: ICON.chevronsRight, onclick: () => this.scrollToLatest() });
    this.selBar = h('div', { class: 'sel-toolbar hidden' });
    this.favBar = h('div', { class: 'chart-favbar on' });
    this.root.append(this.canvas, this.legend, this.paneLegends, this.status, this.toLatest, this.selBar, this.favBar);
    mount.append(this.root);
    this.ctx = this.canvas.getContext('2d');
    this.ro = new ResizeObserver(() => { this.resize(); this.applyFavPos(); });
    // mobile/PWA: when the app returns from background its streams are dead — re-sync candles & scale
    this._onVis = () => { if (document.visibilityState === 'visible' && this.bars && this.bars.length && !this.loading && this.root.isConnected) { this.resize(); this.load(); } };
    document.addEventListener('visibilitychange', this._onVis);
    this.ro.observe(this.root);
    this.bindEvents();
    this.buildFavBar();
  }

  /** Floating ★ favorites toolbar on the chart (draggable) */
  buildFavBar() {
    if (!this.favBar) return;
    const app = this.app;
    const favs = app.favTools || [];
    this.favBar.innerHTML = '';
    this.favBar._dragBound = false;
    const grip = h('div', { class: 'cf-grip', title: 'Drag to move favorites bar' }, '⋮⋮');
    const star = h('span', { class: 'cf-star', title: 'Chart favorites' }, '★');
    this.favBar.append(grip, star);
    for (const id of favs) {
      const btn = h('button', {
        class: 'cf-btn' + (app.state.tool === id ? ' active' : '') + (id === 'long' ? ' long' : id === 'short' ? ' short' : ''),
        title: toolName(id) + ' — click to use · × to remove',
        html: (ICON['t_' + id] || ICON.pencil) + '<span class="cf-x" title="Remove">×</span>',
        onclick: (e) => {
          if (e.target.classList && e.target.classList.contains('cf-x')) return;
          app.setActive(this);
          app.setTool(id);
        },
      });
      const x = btn.querySelector('.cf-x');
      if (x) {
        x.onmousedown = (e) => { e.preventDefault(); e.stopPropagation(); };
        x.onclick = (e) => { e.preventDefault(); e.stopPropagation(); app.unpinFavTool(id); };
      }
      this.favBar.append(btn);
    }
    const add = h('button', {
      class: 'cf-add',
      title: 'Add tool to chart favorites',
      onclick: (e) => {
        e.stopPropagation();
        app.setActive(this);
        const all = TOOL_GROUPS.flatMap((g) => g.items).filter((id) => !['cross', 'dot', 'arrow', 'eraser'].includes(id) && !(app.favTools || []).includes(id));
        if (!all.length) { app.toast('All tools already on the chart bar', 'warn'); return; }
        const pick = prompt('Add to chart ★ bar — type number or name:\n' + all.map((id, i) => `${i + 1}. ${toolName(id)}`).join('\n'), '');
        if (!pick) return;
        const n = +pick;
        let id = all[n - 1];
        if (!id) id = all.find((x) => toolName(x).toLowerCase().includes(pick.toLowerCase()) || x === pick.toLowerCase());
        if (id) app.pinFavTool(id);
      },
    }, '＋');
    this.favBar.append(add);
    this.bindFavDrag(grip);
    this.applyFavPos();
  }

  applyFavPos() {
    if (!this.favBar || !this.root) return;
    const pos = this.app.favPos || { top: 48, left: 12 };
    const maxL = Math.max(4, (this.root.clientWidth || 400) - this.favBar.offsetWidth - 4);
    const maxT = Math.max(4, (this.root.clientHeight || 300) - this.favBar.offsetHeight - 4);
    const left = Math.min(Math.max(4, pos.left ?? 12), maxL);
    const top = Math.min(Math.max(4, pos.top ?? 48), maxT);
    this.favBar.style.left = left + 'px';
    this.favBar.style.top = top + 'px';
  }

  bindFavDrag(grip) {
    if (!grip || this.favBar._dragBound) return;
    this.favBar._dragBound = true;
    grip.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      e.preventDefault();
      e.stopPropagation();
      this.favBar.classList.add('dragging');
      const r = this.favBar.getBoundingClientRect();
      const wr = this.root.getBoundingClientRect();
      const ox = e.clientX - r.left;
      const oy = e.clientY - r.top;
      const mv = (ev) => {
        const left = ev.clientX - wr.left - ox;
        const top = ev.clientY - wr.top - oy;
        const maxL = Math.max(4, this.root.clientWidth - this.favBar.offsetWidth - 4);
        const maxT = Math.max(4, this.root.clientHeight - this.favBar.offsetHeight - 4);
        this.app.favPos = {
          left: Math.min(Math.max(4, left), maxL),
          top: Math.min(Math.max(4, top), maxT),
        };
        this.favBar.style.left = this.app.favPos.left + 'px';
        this.favBar.style.top = this.app.favPos.top + 'px';
        for (const c of this.app.charts) {
          if (c !== this && c.favBar) {
            c.favBar.style.left = this.app.favPos.left + 'px';
            c.favBar.style.top = this.app.favPos.top + 'px';
          }
        }
      };
      const up = () => {
        this.favBar.classList.remove('dragging');
        window.removeEventListener('pointermove', mv);
        window.removeEventListener('pointerup', up);
        store.set('favPos', this.app.favPos);
        this.app.saveSoon();
      };
      window.addEventListener('pointermove', mv);
      window.addEventListener('pointerup', up);
    });
  }
  resize() {
    const r = this.root.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.W = Math.max(50, Math.floor(r.width)); this.H = Math.max(50, Math.floor(r.height));
    this.canvas.width = this.W * dpr; this.canvas.height = this.H * dpr;
    this.canvas.style.width = this.W + 'px'; this.canvas.style.height = this.H + 'px';
    this.dpr = dpr;
    this.render();
  }
  destroy() {
    document.removeEventListener('visibilitychange', this._onVis); this.sub && this.sub.stop(); this.ro.disconnect(); clearInterval(this._tick); clearInterval(this.replayTimer); this.root.remove();
  }

  // ------------------------------------------------------------------ state
  get sym() { return getSymbol(this.state.symbol); }
  get drawings() { return this.app.drawingsFor(this.state.symbol); }
  get indicators() { return this.state.indicators; }
  serialize() { return JSON.parse(JSON.stringify(this.state)); }
  get data() { // display data (respects replay & chart type)
    if (this._dataVer === this.ver && this._dataType === this.state.type) return this._data;
    let b = this.replay && this.replay.idx != null ? this.bars.slice(0, this.replay.idx + 1) : this.bars;
    this._src = b;
    if (this.state.type === 'heikin') b = heikin(b);
    else if (this.state.type === 'nogap') b = noGap(b);
    this._data = b; this._dataVer = this.ver; this._dataType = this.state.type;
    return b;
  }
  get srcBars() { this.data; return this._src; }

  async load() {
    const { symbol, interval } = this.state;
    const token = (this._loadToken = uid());
    this.sub && this.sub.stop(); this.sub = null;
    // drop the previous symbol's candles + price scale right away so they can never be drawn/scaled against the new symbol
    if (this._loadedSymbol !== symbol) { this.bars = []; this.ver++; this.indCache.clear(); this.scales = {}; }
    this.loading = true; this.showStatus(`Loading ${shortName(symbol)} · ${ivInfo(interval).short}…`);
    this.buildLegend();
    const res = await getBars(symbol, interval);
    if (token !== this._loadToken) return;
    this.loading = false;
    this._loadedSymbol = symbol;
    this.bars = res.bars; this.ver++; this.indCache.clear(); this.source = res.source; this.demo = !!res.demo;
    this.noMore = false;
    this.replay = null;
    this.resetView();
    this.hideStatus();
    this.buildLegend();
    this.loadCompares();
    this.sub = subscribe(symbol, interval, (arr) => { if (token === this._loadToken) this.merge(arr); }, this.demo);
    if (this.demo && this.bars.length) this.sub.seed(this.bars[this.bars.length - 1]);
    const last = this.bars[this.bars.length - 1];
    if (last) quotes.push(symbol, last.c);
    this.emit('loaded');
    this.app.onChartLoaded && this.app.onChartLoaded(this);
  }
  showStatus(msg, err) { this.status.textContent = msg; this.status.classList.toggle('error', !!err); this.status.classList.remove('hidden'); }
  hideStatus() { this.status.classList.add('hidden'); }

  merge(arr) {
    if (!this.bars.length) return;
    // ignore malformed / foreign ticks (e.g. another symbol's price) that would blow up the auto-scale and squash candles to 1px
    const ref = this.bars[this.bars.length - 1].c;
    arr = arr.filter((b) => b && [b.o, b.h, b.l, b.c].every((v) => isFinite(v) && v > 0) && Math.abs(b.c / ref - 1) < 0.5);
    if (!arr.length) return;
    const atEnd = this.view.right >= this.bars.length - 2;
    let added = 0;
    for (const b of arr) {
      const last = this.bars[this.bars.length - 1];
      if (b.t === last.t) this.bars[this.bars.length - 1] = b;
      else if (b.t > last.t) { this.bars.push(b); added++; }
      else {
        let lo = 0, hi = this.bars.length - 1;
        while (lo <= hi) { const m = (lo + hi) >> 1; if (this.bars[m].t < b.t) lo = m + 1; else if (this.bars[m].t > b.t) hi = m - 1; else { this.bars[m] = b; break; } }
      }
    }
    if (added && atEnd && !this.replay) this.view.right += added;
    if (!this.replay) { this.ver++; this.requestRender(); }
    const last = this.bars[this.bars.length - 1];
    quotes.push(this.state.symbol, last.c);
    this.app.onPrice && this.app.onPrice(this.state.symbol, last.c, last);
  }

  setSymbol(s) { if (s === this.state.symbol) return; this.state.symbol = s; this.selected = null; this.load(); this.app.saveSoon(); this.emit('change'); }
  setInterval(iv) { if (iv === this.state.interval) return; this.state.interval = iv; this.load(); this.app.saveSoon(); this.emit('change'); }
  setType(t) { this.state.type = t; this.ver++; this.requestRender(); this.app.saveSoon(); this.emit('change'); }
  toggleLog() { this.state.logScale = !this.state.logScale; this.scales.main = { auto: true }; this.requestRender(); this.app.saveSoon(); }

  addIndicator(type, overrides) {
    const ind = createIndicator(type, overrides);
    this.state.indicators.push(ind);
    if (type === 'compare') this.loadCompares();
    this.buildLegend(); this.requestRender(); this.app.saveSoon(); this.emit('indicators');
    return ind;
  }
  removeIndicator(id) {
    this.state.indicators = this.state.indicators.filter((x) => x.uid !== id);
    delete this.state.paneRatios[id]; delete this.scales[id];
    this.indCache.delete(id);
    this.buildLegend(); this.requestRender(); this.app.saveSoon(); this.emit('indicators');
  }
  updateIndicator(ind) { this.indCache.delete(ind.uid); if (ind.type === 'compare') this.loadCompares(); this.buildLegend(); this.requestRender(); this.app.saveSoon(); }
  async loadCompares() {
    for (const ind of this.indicators.filter((i) => i.type === 'compare')) {
      const s = ind.inputs.symbol; const key = s + '|' + this.state.interval;
      if (this.compareData[key]) continue;
      this.compareData[key] = { bars: [] };
      const r = await getBars(s, this.state.interval);
      this.compareData[key] = { bars: r.bars };
      this.indCache.delete(ind.uid); this.requestRender();
    }
  }

  // ------------------------------------------------------------------ view / coordinates
  resetView() {
    const n = this.data.length;
    const plotW = (this.W || 800) - AXIS_W;
    this.view.spacing = clamp(this.app.settings.barSpacing || 8, MIN_SPACING, MAX_SPACING);
    if (n * this.view.spacing < plotW * 0.6 && n > 0) this.view.spacing = clamp((plotW * 0.85) / n, MIN_SPACING, MAX_SPACING);
    this.view.right = n - 1 + this.app.settings.rightMargin;
    this.scales = {};
    this.requestRender();
  }
  scrollToLatest() { this.view.right = this.data.length - 1 + this.app.settings.rightMargin; this.requestRender(); }
  get plotW() { return this.W - AXIS_W; }
  get plotH() { return this.H - TIME_H; }
  i2x(i) { return this.plotW - (this.view.right - i) * this.view.spacing - this.view.spacing / 2; }
  x2i(x) { return this.view.right - (this.plotW - x - this.view.spacing / 2) / this.view.spacing; }
  get ivMs() { return ivInfo(this.state.interval).ms; }
  idxToTime(i) {
    const b = this.bars, n = b.length; if (!n) return 0;
    if (i <= 0) return b[0].t + i * this.ivMs;
    if (i >= n - 1) return b[n - 1].t + (i - (n - 1)) * this.ivMs;
    const f = Math.floor(i), fr = i - f; return b[f].t + (b[f + 1].t - b[f].t) * fr;
  }
  timeToIdx(t) {
    const b = this.bars, n = b.length; if (!n) return 0;
    if (t <= b[0].t) return (t - b[0].t) / this.ivMs;
    if (t >= b[n - 1].t) return n - 1 + (t - b[n - 1].t) / this.ivMs;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (b[m].t <= t) lo = m; else hi = m; }
    return lo + (t - b[lo].t) / (b[hi].t - b[lo].t || 1);
  }
  p2y(pane, p) {
    if (pane.log) { if (p <= 0) return pane.top + pane.h; const v = Math.log(p); return pane.top + (1 - (v - pane.lmin) / (pane.lmax - pane.lmin)) * pane.h; }
    return pane.top + (1 - (p - pane.min) / (pane.max - pane.min)) * pane.h;
  }
  y2p(pane, y) {
    const f = 1 - (y - pane.top) / pane.h;
    if (pane.log) return Math.exp(pane.lmin + f * (pane.lmax - pane.lmin));
    return pane.min + f * (pane.max - pane.min);
  }
  paneAt(y) { return (this.panes || []).find((p) => y >= p.top && y < p.top + p.h + 1); }

  // ------------------------------------------------------------------ indicators compute
  result(ind) {
    const c = this.indCache.get(ind.uid);
    if (c && c.ver === this.ver) return c.res;
    const def = INDICATORS[ind.type]; const bars = this.srcBars;
    let res = {};
    try {
      if (def.special === 'compare') res = this.calcCompare(ind, bars);
      else if (def.special === 'customscript') res = this.app.evalCustomScript ? this.app.evalCustomScript(ind, bars) : {};
      else res = def.calc(bars, ind.inputs, { iv: this.state.interval, intraday: isIntraday(this.state.interval), sessionOffset: this.sym.src === 'binance' ? 0 : 19800e3 });
    } catch (e) { console.error('indicator error', ind.type, e); }
    this.indCache.set(ind.uid, { ver: this.ver, res });
    return res;
  }
  calcCompare(ind, bars) {
    const cd = this.compareData[ind.inputs.symbol + '|' + this.state.interval];
    const out = new Array(bars.length).fill(NaN); if (!cd || !cd.bars.length) return { v: out };
    let j = 0; const ob = cd.bars;
    for (let i = 0; i < bars.length; i++) {
      while (j + 1 < ob.length && ob[j + 1].t <= bars[i].t) j++;
      if (ob[j].t <= bars[i].t || isIntraday(this.state.interval) === false) out[i] = ob[j].c;
    }
    return { v: out };
  }

  // ------------------------------------------------------------------ layout
  layout() {
    const subs = this.indicators.filter((i) => !INDICATORS[i.type].overlay && i.visible !== false);
    const total = this.plotH;
    const ratios = [this.state.paneRatios.main || 3, ...subs.map((s) => this.state.paneRatios[s.uid] || 1)];
    const sum = ratios.reduce((a, b) => a + b, 0);
    let top = 0;
    const panes = [];
    const mk = (key, r, inds) => { const hgt = Math.max(30, Math.round((r / sum) * total)); const p = { key, top, h: hgt, inds }; top += hgt; return p; };
    panes.push(mk('main', ratios[0], this.indicators.filter((i) => INDICATORS[i.type].overlay)));
    subs.forEach((s, k) => panes.push(mk(s.uid, ratios[k + 1], [s])));
    // fix rounding: stretch last pane
    const last = panes[panes.length - 1]; last.h = total - last.top;
    this.panes = panes;
    return panes;
  }

  computeScales(from, to) {
    const data = this.data; const n = data.length;
    for (const pane of this.panes) {
      const sc = (this.scales[pane.key] ||= { auto: true });
      pane.log = pane.key === 'main' && this.state.logScale;
      let lo = Infinity, hi = -Infinity;
      const inc = (v) => { if (v != null && isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } };
      if (pane.key === 'main') {
        const lineType = ['line', 'area', 'baseline', 'step', 'linemarkers'].includes(this.state.type);
        for (let i = Math.max(0, from); i <= Math.min(n - 1, to); i++) { if (lineType) inc(data[i].c); else { inc(data[i].l); inc(data[i].h); } }
      }
      for (const ind of pane.inds) {
        const def = INDICATORS[ind.type]; if (ind.visible === false || def.scale === false) continue;
        const res = this.result(ind);
        if (def.special === 'compare') { const nv = this.compareNorm(ind, res, from, to); for (let i = from; i <= to; i++) inc(nv(i)); continue; }
        for (const p of def.plots) {
          if (ind.styles[p.key] && ind.styles[p.key].visible === false) continue;
          const arr = res[p.key]; if (!arr) continue;
          const off = this.plotOffset(def, p, ind);
          for (let i = from; i <= to; i++) inc(arr[i - off]);
        }
        if (def.levels) for (const l of def.levels) inc(l.v);
        if (def.range && pane.key !== 'main') { inc(def.range[0]); inc(def.range[1]); }
      }
      if (!isFinite(lo)) { lo = 0; hi = 1; }
      if (lo === hi) { const d = Math.abs(lo) * 0.01 || 1; lo -= d; hi += d; }
      if (pane.log && lo > 0) {
        let l0 = Math.log(lo), l1 = Math.log(hi); const pad = (l1 - l0) * 0.08;
        if (sc.auto) { pane.lmin = l0 - pad; pane.lmax = l1 + pad; sc.lmin = pane.lmin; sc.lmax = pane.lmax; }
        else { pane.lmin = sc.lmin ?? l0 - pad; pane.lmax = sc.lmax ?? l1 + pad; }
        pane.min = Math.exp(pane.lmin); pane.max = Math.exp(pane.lmax);
      } else {
        pane.log = false;
        const pad = (hi - lo) * (pane.key === 'main' ? 0.08 : 0.1);
        if (sc.auto || sc.min == null) { pane.min = lo - pad; pane.max = hi + pad; sc.min = pane.min; sc.max = pane.max; }
        else { pane.min = sc.min; pane.max = sc.max; }
      }
    }
  }
  plotOffset(def, p, ind) { return p.offsetFn ? p.offsetFn(ind.inputs) : def.offsetInput ? +ind.inputs[def.offsetInput] || 0 : 0; }
  compareNorm(ind, res, from, to) {
    const data = this.srcBars; const arr = res.v || [];
    let base = -1; for (let i = Math.max(0, from); i <= Math.min(to, data.length - 1); i++) if (isFinite(arr[i])) { base = i; break; }
    if (base < 0) return () => NaN;
    const k = data[base].c / arr[base];
    ind._base = base; ind._k = k;
    return (i) => (i >= 0 && i < arr.length ? arr[i] * k : NaN);
  }

  // ------------------------------------------------------------------ rendering
  requestRender() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this.render(); });
  }
  get theme() { return this.app.theme; }

  render() {
    if (!this.W) return;
    const ctx = this.ctx, th = this.theme, st = this.app.settings;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = th.bg; ctx.fillRect(0, 0, this.W, this.H);
    if (th.glow1) {
      const g1 = ctx.createRadialGradient(this.W * 0.18, this.H * 0.18, 10, this.W * 0.18, this.H * 0.18, Math.max(this.W, this.H) * 0.65);
      g1.addColorStop(0, th.glow1); g1.addColorStop(1, 'transparent');
      ctx.fillStyle = g1; ctx.fillRect(0, 0, this.W, this.H);
      const g2 = ctx.createRadialGradient(this.W * 0.82, this.H * 0.82, 10, this.W * 0.82, this.H * 0.82, Math.max(this.W, this.H) * 0.65);
      g2.addColorStop(0, th.glow2 || th.glow1); g2.addColorStop(1, 'transparent');
      ctx.fillStyle = g2; ctx.fillRect(0, 0, this.W, this.H);
    }
    const data = this.data, n = data.length;
    this.layout();
    const plotW = this.plotW, plotH = this.plotH;
    const from = Math.max(0, Math.floor(this.x2i(0))), to = Math.min(n - 1, Math.ceil(this.x2i(plotW)));
    this.range = { from, to };
    if (!n) { this.drawAxesFrame(); this.updateLegend(); return; }
    this.computeScales(from, to);
    const main = this.panes[0];
    // lazy load older history
    if (from < 30 && !this.replay && !this.loadingMore && !this.noMore && this.sym.src === 'binance') this.fetchOlder();

    // grid
    const tticks = this.timeTicks();
    if (st.gridV) { ctx.strokeStyle = th.grid; ctx.lineWidth = 1; ctx.beginPath(); for (const tk of tticks) { const x = Math.round(tk.x) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, plotH); } ctx.stroke(); }
    for (const pane of this.panes) {
      pane.ticks = this.priceTicks(pane);
      if (st.gridH) { ctx.strokeStyle = th.grid; ctx.beginPath(); for (const tk of pane.ticks) { const y = Math.round(tk.y) + 0.5; ctx.moveTo(0, y); ctx.lineTo(plotW, y); } ctx.stroke(); }
    }
    // watermark
    if (st.watermark) {
      ctx.save(); ctx.fillStyle = th.watermark; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `600 ${Math.min(72, plotW / 8)}px Inter, system-ui, sans-serif`;
      ctx.fillText(shortName(this.state.symbol), plotW / 2, main.top + main.h / 2 - 14);
      ctx.font = `500 ${Math.min(22, plotW / 25)}px Inter, system-ui, sans-serif`;
      ctx.fillText(`${this.sym.name} · ${ivInfo(this.state.interval).label}`, plotW / 2, main.top + main.h / 2 + 30);
      ctx.restore();
    }

    // panes
    for (const pane of this.panes) {
      ctx.save(); ctx.beginPath(); ctx.rect(0, pane.top, plotW, pane.h); ctx.clip();
      if (pane.key === 'main') {
        for (const ind of pane.inds) if (ind.visible !== false && INDICATORS[ind.type].special === 'volume') this.drawVolume(pane, ind, from, to);
        for (const ind of pane.inds) if (ind.visible !== false && INDICATORS[ind.type].special === 'vpvr') this.drawVPVR(pane, ind, from, to);
        this.drawSeries(pane, from, to);
        for (const ind of pane.inds) { const d = INDICATORS[ind.type]; if (ind.visible !== false && !['volume', 'vpvr'].includes(d.special)) this.drawIndicator(pane, ind, from, to); }
        this.drawTradeLines(pane);
        this.drawDrawings(pane);
      } else {
        for (const ind of pane.inds) this.drawIndicator(pane, ind, from, to);
      }
      ctx.restore();
    }
    // separators
    ctx.strokeStyle = th.border; ctx.lineWidth = 1;
    for (let k = 1; k < this.panes.length; k++) { const y = this.panes[k].top + 0.5; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.W, y); ctx.stroke(); }
    // replay selection line
    if (this.replay && this.replay.selecting && this.mouse.inside) {
      ctx.fillStyle = 'rgba(41,98,255,0.08)'; ctx.fillRect(this.mouse.x, 0, plotW - this.mouse.x, plotH);
      ctx.strokeStyle = '#2962ff'; ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(this.mouse.x + 0.5, 0); ctx.lineTo(this.mouse.x + 0.5, plotH); ctx.stroke();
    }
    this.drawAxes(tticks);
    this.drawCrosshair();
    this.updateLegend();
    this.toLatest.classList.toggle('hidden', this.view.right >= n - 1 || !!this.replay);
    this.updateSelToolbar();
  }

  drawAxesFrame() {
    const ctx = this.ctx, th = this.theme;
    ctx.strokeStyle = th.border; ctx.beginPath(); ctx.moveTo(this.plotW + 0.5, 0); ctx.lineTo(this.plotW + 0.5, this.H); ctx.moveTo(0, this.plotH + 0.5); ctx.lineTo(this.W, this.plotH + 0.5); ctx.stroke();
  }

  priceTicks(pane) {
    const out = []; const cnt = Math.max(2, Math.floor(pane.h / 48));
    if (pane.log) {
      const step = niceStep(pane.max - pane.min, cnt);
      for (let v = Math.ceil(pane.min / step) * step; v <= pane.max; v += step) out.push({ v, y: this.p2y(pane, v) });
      // thin overlapping labels in log space
      return out.filter((t, i, a) => i === 0 || Math.abs(a[i - 1].y - t.y) > 18 || (a[i - 1] = t, false));
    }
    const step = niceStep(pane.max - pane.min, cnt);
    for (let v = Math.ceil(pane.min / step) * step; v <= pane.max; v += step) out.push({ v, y: this.p2y(pane, v), step });
    return out;
  }

  timeTicks() {
    const sp = this.view.spacing; const n = this.bars.length; if (!n) return [];
    const raw = Math.ceil(95 / sp);
    const nice = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 24, 30, 40, 50, 60, 75, 100, 120, 150, 200, 250, 300, 400, 500, 750, 1000, 1500, 2000, 3000, 5000];
    const step = nice.find((s) => s >= raw) || raw;
    const from = Math.floor(this.x2i(0) / step) * step, to = Math.ceil(this.x2i(this.plotW));
    const out = []; let prev = null; const intra = isIntraday(this.state.interval); const iv = this.state.interval;
    for (let i = from - step; i <= to; i += step) {
      const t = this.idxToTime(i); const p = tparts(t); let txt, bold = false;
      if (prev) {
        if (intra) {
          if (p.d !== prev.d || p.mo !== prev.mo) { txt = p.mo !== prev.mo && p.d < 3 ? MONTHS[p.mo] : String(p.d) + ' ' + MONTHS[p.mo]; bold = true; }
          else txt = `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`;
        } else if (iv === '1D') {
          if (p.y !== prev.y) { txt = String(p.y); bold = true; } else if (p.mo !== prev.mo) { txt = MONTHS[p.mo]; bold = true; } else txt = String(p.d);
        } else {
          if (p.y !== prev.y) { txt = String(p.y); bold = true; } else txt = MONTHS[p.mo];
        }
      }
      prev = p;
      if (txt && i >= from) out.push({ x: this.i2x(i), txt, bold, i });
    }
    return out;
  }

  // ---- main series
  drawSeries(pane, from, to) {
    const ctx = this.ctx, th = this.theme, st = this.app.settings, data = this.data;
    const sp = this.view.spacing, type = this.state.type;
    const up = st.upColor, dn = st.downColor;
    const y = (p) => this.p2y(pane, p);
    if (['line', 'area', 'baseline', 'step', 'linemarkers'].includes(type)) {
      const pts = []; for (let i = Math.max(0, from - 1); i <= Math.min(data.length - 1, to + 1); i++) pts.push([this.i2x(i), y(data[i].c)]);
      if (!pts.length) return;
      const path = new Path2D();
      pts.forEach(([x, yy], k) => { if (!k) path.moveTo(x, yy); else if (type === 'step') { path.lineTo(x, pts[k - 1][1]); path.lineTo(x, yy); } else path.lineTo(x, yy); });
      if (type === 'area') {
        const g = ctx.createLinearGradient(0, pane.top, 0, pane.top + pane.h); g.addColorStop(0, alpha(st.lineColor, 0.48)); g.addColorStop(0.6, alpha(st.lineColor, 0.15)); g.addColorStop(1, alpha(st.lineColor, 0.01));
        const fp = new Path2D(path); fp.lineTo(pts[pts.length - 1][0], pane.top + pane.h); fp.lineTo(pts[0][0], pane.top + pane.h); fp.closePath();
        ctx.fillStyle = g; ctx.fill(fp);
      }
      if (type === 'baseline') {
        const base = data[Math.max(0, from)].c; const by = y(base);
        const fp = new Path2D(path); fp.lineTo(pts[pts.length - 1][0], by); fp.lineTo(pts[0][0], by); fp.closePath();
        ctx.save(); ctx.beginPath(); ctx.rect(0, pane.top, this.plotW, by - pane.top); ctx.clip(); ctx.fillStyle = alpha(up, 0.25); ctx.fill(fp); ctx.strokeStyle = up; ctx.lineWidth = 2.2; ctx.stroke(path); ctx.restore();
        ctx.save(); ctx.beginPath(); ctx.rect(0, by, this.plotW, pane.top + pane.h - by); ctx.clip(); ctx.fillStyle = alpha(dn, 0.25); ctx.fill(fp); ctx.strokeStyle = dn; ctx.lineWidth = 2.2; ctx.stroke(path); ctx.restore();
        ctx.strokeStyle = th.textDim; ctx.setLineDash([4, 4]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, by); ctx.lineTo(this.plotW, by); ctx.stroke(); ctx.setLineDash([]);
        return;
      }
      ctx.save();
      if (st.glowEffects !== false) { ctx.shadowColor = st.lineColor; ctx.shadowBlur = 12; }
      ctx.strokeStyle = st.lineColor; ctx.lineWidth = 2.4; ctx.lineJoin = 'round'; ctx.stroke(path);
      ctx.restore();
      if (type === 'linemarkers' && sp > 4) { ctx.fillStyle = st.lineColor; for (const [x, yy] of pts) { ctx.beginPath(); ctx.arc(x, yy, 2.8, 0, Math.PI * 2); ctx.fill(); } }
      return;
    }
    const bw = Math.max(1, Math.floor(sp * 0.72) | 1);
    const half = Math.floor(bw / 2);
    const upP = new Path2D(), dnP = new Path2D(), upW = new Path2D(), dnW = new Path2D();
    for (let i = from; i <= to; i++) {
      const b = data[i]; if (!b) continue;
      const x = Math.round(this.i2x(i)); const isUp = b.c >= b.o;
      const yo = y(b.o), yc = y(b.c), yh = y(b.h), yl = y(b.l);
      const wP = isUp ? upW : dnW, bP = isUp ? upP : dnP;
      if (type === 'bars' || type === 'hilo') {
        const w = Math.max(1, Math.round(Math.min(2, sp / 6)));
        wP.rect(x - Math.floor(w / 2), yh, w, Math.max(1, yl - yh));
        if (type === 'bars' && sp > 3) { wP.rect(x - half, Math.round(yo), half, w); wP.rect(x, Math.round(yc), half + 1, w); }
        continue;
      }
      if (type === 'columns') { bP.rect(x - half, yc, bw, pane.top + pane.h - yc); continue; }
      wP.rect(x, yh, 1, Math.max(1, yl - yh));
      if (bw >= 3) bP.rect(x - half, Math.min(yo, yc), bw, Math.max(1, Math.abs(yc - yo)));
    }
    const wUp = st.wickUp || up, wDn = st.wickDown || dn;
    if (type === 'bars' || type === 'hilo') { ctx.fillStyle = up; ctx.fill(upW); ctx.fillStyle = dn; ctx.fill(dnW); return; }
    ctx.fillStyle = wUp; ctx.fill(upW); ctx.fillStyle = wDn; ctx.fill(dnW);
    ctx.save();
    if (st.glowEffects !== false && bw >= 3) { ctx.shadowColor = up; ctx.shadowBlur = Math.min(10, sp * 0.7); }
    if (type === 'hollow') {
      ctx.fillStyle = th.bg; ctx.fill(upP); ctx.strokeStyle = up; ctx.lineWidth = 1.2; ctx.save(); ctx.translate(0.5, 0.5); ctx.stroke(upP); ctx.restore();
    } else { ctx.fillStyle = up; ctx.fill(upP); if (st.borderUp && bw >= 3) { ctx.strokeStyle = st.borderUp; ctx.stroke(upP); } }
    if (st.glowEffects !== false && bw >= 3) { ctx.shadowColor = dn; ctx.shadowBlur = Math.min(10, sp * 0.7); }
    ctx.fillStyle = dn; ctx.fill(dnP);
    ctx.restore();
  }

  drawVolume(pane, ind, from, to) {
    const ctx = this.ctx, st = this.app.settings, data = this.srcBars;
    const res = this.result(ind); const vol = res.vol || [];
    let mx = 0; for (let i = from; i <= to; i++) if (vol[i] > mx) mx = vol[i];
    if (!mx) return;
    const hgt = pane.h * 0.2, base = pane.top + pane.h;
    const bw = Math.max(1, Math.floor(this.view.spacing * 0.72) | 1), half = Math.floor(bw / 2);
    const upP = new Path2D(), dnP = new Path2D();
    for (let i = from; i <= to; i++) {
      const b = data[i]; if (!b) continue; const x = Math.round(this.i2x(i)); const hh = (vol[i] / mx) * hgt;
      (b.c >= b.o ? upP : dnP).rect(x - half, base - hh, bw, hh);
    }
    ctx.fillStyle = alpha(ind.styles.vol.color || st.upColor, 0.45); ctx.fill(upP);
    ctx.fillStyle = alpha(ind.styles.vol.color2 || st.downColor, 0.45); ctx.fill(dnP);
    if (ind.inputs.showMA && ind.styles.ma.visible !== false) {
      ctx.strokeStyle = ind.styles.ma.color; ctx.lineWidth = ind.styles.ma.width; ctx.beginPath(); let started = false;
      for (let i = from; i <= to; i++) { const v = res.ma[i]; if (!isFinite(v)) continue; const xx = this.i2x(i), yy = base - (v / mx) * hgt; if (!started) { ctx.moveTo(xx, yy); started = true; } else ctx.lineTo(xx, yy); }
      ctx.stroke();
    }
  }

  drawVPVR(pane, ind, from, to) {
    const ctx = this.ctx, data = this.srcBars, rows = ind.inputs.rows;
    const lo = pane.min, hi = pane.max, step = (hi - lo) / rows; if (step <= 0) return;
    const upV = new Array(rows).fill(0), dnV = new Array(rows).fill(0);
    for (let i = from; i <= Math.min(to, data.length - 1); i++) {
      const b = data[i]; const r0 = clamp(Math.floor((b.l - lo) / step), 0, rows - 1), r1 = clamp(Math.floor((b.h - lo) / step), 0, rows - 1);
      const share = b.v / (r1 - r0 + 1);
      for (let r = r0; r <= r1; r++) (b.c >= b.o ? upV : dnV)[r] += share;
    }
    const tot = upV.map((v, k) => v + dnV[k]); const mx = Math.max(...tot); if (!mx) return;
    const poc = tot.indexOf(mx);
    // value area
    const target = tot.reduce((a, b) => a + b, 0) * (ind.inputs.va / 100); let acc = tot[poc], a = poc, b = poc;
    while (acc < target && (a > 0 || b < rows - 1)) { const na = a > 0 ? tot[a - 1] : -1, nb = b < rows - 1 ? tot[b + 1] : -1; if (nb >= na) acc += tot[++b]; else acc += tot[--a]; }
    const maxW = this.plotW * (ind.inputs.width / 100); const s = ind.styles;
    for (let r = 0; r < rows; r++) {
      const y0 = this.p2y(pane, lo + (r + 1) * step), y1 = this.p2y(pane, lo + r * step); const hh = Math.max(1, y1 - y0 - 1);
      const wu = (upV[r] / mx) * maxW, wd = (dnV[r] / mx) * maxW; const inVA = r >= a && r <= b;
      ctx.globalAlpha = inVA ? 1 : 0.5;
      ctx.fillStyle = s.up.color; ctx.fillRect(this.plotW - wu - wd, y0, wu, hh);
      ctx.fillStyle = s.dn.color; ctx.fillRect(this.plotW - wd, y0, wd, hh);
    }
    ctx.globalAlpha = 1;
    if (s.poc.visible !== false) { const yp = this.p2y(pane, lo + (poc + 0.5) * step); ctx.strokeStyle = s.poc.color; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, yp); ctx.lineTo(this.plotW, yp); ctx.stroke(); }
  }

  drawIndicator(pane, ind, from, to) {
    if (ind.visible === false) return;
    const ctx = this.ctx, def = INDICATORS[ind.type], res = this.result(ind), n = this.data.length;
    const y = (v) => this.p2y(pane, v);
    if (def.special === 'compare') {
      const nv = this.compareNorm(ind, res, from, to); const s = ind.styles.v;
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width; ctx.beginPath(); let st = false;
      for (let i = from; i <= to; i++) { const v = nv(i); if (!isFinite(v)) { st = false; continue; } const xx = this.i2x(i), yy = y(v); if (!st) { ctx.moveTo(xx, yy); st = true; } else ctx.lineTo(xx, yy); }
      ctx.stroke(); return;
    }
    // level fill + levels
    if (def.levelFill && pane.key !== 'main') {
      const [a, b, c] = def.levelFill; ctx.fillStyle = c; const ya = y(a), yb = y(b); ctx.fillRect(0, Math.min(ya, yb), this.plotW, Math.abs(yb - ya));
    }
    if (def.levels) {
      ctx.strokeStyle = this.theme.textDim; ctx.lineWidth = 1;
      for (const l of def.levels) { ctx.setLineDash(l.dash || [4, 4]); const yy = Math.round(y(l.v)) + 0.5; ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(this.plotW, yy); ctx.stroke(); }
      ctx.setLineDash([]);
    }
    const toExt = Math.ceil(this.x2i(this.plotW));
    const val = (key, i, off) => { const arr = res[key]; if (!arr) return NaN; const j = i - off; return j >= 0 && j < arr.length ? arr[j] : NaN; };
    // fills
    for (const f of def.fills || []) {
      const sa = ind.styles[f.a], sb = ind.styles[f.b]; if ((sa && sa.visible === false) || (sb && sb.visible === false)) continue;
      const pa = def.plots.find((p) => p.key === f.a); const off = this.plotOffset(def, pa, ind);
      const i0 = from - 1, i1 = Math.min(toExt + 1, n - 1 + off);
      if (f.up) {
        for (let i = i0; i < i1; i++) {
          const a0 = val(f.a, i, off), b0 = val(f.b, i, off), a1 = val(f.a, i + 1, off), b1 = val(f.b, i + 1, off);
          if (![a0, b0, a1, b1].every(isFinite)) continue;
          ctx.fillStyle = a0 >= b0 ? f.up : f.down; const x0 = this.i2x(i), x1 = this.i2x(i + 1);
          ctx.beginPath(); ctx.moveTo(x0, y(a0)); ctx.lineTo(x1, y(a1)); ctx.lineTo(x1, y(b1)); ctx.lineTo(x0, y(b0)); ctx.closePath(); ctx.fill();
        }
      } else {
        ctx.fillStyle = f.color; let seg = [];
        const flush = () => { if (seg.length > 1) { ctx.beginPath(); seg.forEach(([x, ya], k) => (k ? ctx.lineTo(x, ya) : ctx.moveTo(x, ya))); for (let k = seg.length - 1; k >= 0; k--) ctx.lineTo(seg[k][0], seg[k][2]); ctx.closePath(); ctx.fill(); } seg = []; };
        for (let i = i0; i <= i1; i++) { const a = val(f.a, i, off), b = val(f.b, i, off); if (!isFinite(a) || !isFinite(b)) { flush(); continue; } seg.push([this.i2x(i), y(a), y(b)]); }
        flush();
      }
    }
    // plots
    const bw = Math.max(1, Math.floor(this.view.spacing * 0.6) | 1), half = Math.floor(bw / 2);
    for (const p of def.plots) {
      const s = ind.styles[p.key]; if (!s || s.visible === false) continue;
      const off = this.plotOffset(def, p, ind); const i0 = Math.max(0, from - 1), i1 = Math.min(toExt + 1, n - 1 + off);
      const type = p.type || 'line';
      if (type === 'hist') {
        const zero = pane.min <= 0 && pane.max >= 0 ? y(0) : pane.top + pane.h;
        const bars = this.srcBars;
        for (let i = i0; i <= i1; i++) {
          const v = val(p.key, i, off); if (!isFinite(v)) continue;
          const x = Math.round(this.i2x(i)); const yy = y(v);
          let c = s.color; if (p.colorFn) c = p.colorFn(v, i - off, res); else if (p.barColor && bars[i]) c = bars[i].c >= bars[i].o ? alpha(this.app.settings.upColor, 0.5) : alpha(this.app.settings.downColor, 0.5);
          ctx.fillStyle = c; ctx.fillRect(x - half, Math.min(yy, zero), bw, Math.max(1, Math.abs(zero - yy)));
        }
      } else if (type === 'dots') {
        ctx.fillStyle = s.color; const r = Math.max(1.2, Math.min(3, this.view.spacing / 4)) * (s.width / 2 || 1);
        for (let i = i0; i <= i1; i++) { const v = val(p.key, i, off); if (!isFinite(v)) continue; ctx.beginPath(); ctx.arc(this.i2x(i), y(v), r, 0, Math.PI * 2); ctx.fill(); }
      } else if (type === 'step') {
        ctx.strokeStyle = s.color; ctx.lineWidth = s.width; ctx.beginPath(); let lastV = NaN, lastX = 0;
        for (let i = i0; i <= i1; i++) {
          const v = val(p.key, i, off), x = this.i2x(i);
          if (isFinite(v)) { const yy = Math.round(y(v)) + 0.5; if (v !== lastV) ctx.moveTo(x - this.view.spacing / 2, yy); ctx.lineTo(x + this.view.spacing / 2, yy); lastX = x; }
          lastV = v;
        }
        ctx.stroke();
        if (p.label && isFinite(lastV)) { ctx.fillStyle = s.color; ctx.font = FONT; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText(p.title, Math.min(lastX, this.plotW - 4), y(lastV) - 2); }
      } else {
        ctx.save();
        if (this.app.settings.glowEffects !== false) { ctx.shadowColor = s.color; ctx.shadowBlur = 7; }
        ctx.strokeStyle = s.color; ctx.lineWidth = s.width; ctx.lineJoin = 'round'; ctx.beginPath(); let st = false;
        for (let i = i0; i <= i1; i++) { const v = val(p.key, i, off); if (!isFinite(v)) { st = false; continue; } const xx = this.i2x(i), yy = y(v); if (!st) { ctx.moveTo(xx, yy); st = true; } else ctx.lineTo(xx, yy); }
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  drawTradeLines(pane) {
    const ctx = this.ctx; const sym = this.state.symbol; const W = this.plotW;
    const lines = [];
    for (const p of this.app.trading.positionsFor(sym)) lines.push({ p: p.avg, color: p.side === 'long' ? '#089981' : '#f23645', text: `${p.side === 'long' ? 'LONG' : 'SHORT'} ${p.qty}  P&L ${fmtPrice(p.pnl, 2)}`, dash: [] });
    for (const o of this.app.trading.ordersFor(sym)) lines.push({ p: o.price, color: '#2962ff', text: `${o.side.toUpperCase()} LMT ${o.qty}`, dash: [5, 4] });
    for (const a of this.app.alertsMgr.forSymbol(sym)) lines.push({ p: a.price, color: '#ff9800', text: `🔔 ${a.condition.replace('_', ' ')}`, dash: [2, 3] });
    for (const l of lines) {
      const y = Math.round(this.p2y(pane, l.p)) + 0.5; if (y < pane.top || y > pane.top + pane.h) continue;
      ctx.strokeStyle = l.color; ctx.setLineDash(l.dash); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); ctx.setLineDash([]);
      drawLabel(ctx, l.text, 8, y, { bg: l.color, align: 'left', pad: 5 });
    }
    this._tradeLines = lines;
  }

  // ---- drawings helper (data <-> px)
  get X() {
    const main = this.panes[0]; const self = this;
    const last = this.srcBars[this.srcBars.length - 1];
    return {
      W: this.plotW, top: main.top, bottom: main.top + main.h,
      px: (pt) => ({ x: self.i2x(self.timeToIdx(pt.t)), y: self.p2y(main, pt.p) }),
      idx: (t) => self.timeToIdx(t), time: (i) => self.idxToTime(i), i2x: (i) => self.i2x(i),
      p2y: (p) => self.p2y(main, p), fmt: (p) => fmtPrice(p, precisionFor(Math.abs(p) > 1 ? 2 : p)),
      span: (t0, t1) => fmtDuration(Math.abs(t1 - t0)), visibleRange: main.max - main.min,
      lastPrice: last ? last.c : null, lastX: last ? self.i2x(this.srcBars.length - 1) : 0,
      volBetween: (t0, t1) => { const a = Math.round(self.timeToIdx(Math.min(t0, t1))), b = Math.round(self.timeToIdx(Math.max(t0, t1))); let s = 0; for (let i = Math.max(0, a); i <= Math.min(b, self.bars.length - 1); i++) s += self.bars[i].v; return fmtVol(s); },
    };
  }
  drawDrawings(pane) {
    if (this.app.state.drawingsHidden) return;
    const ctx = this.ctx; const X = this.X;
    const list = [...this.drawings]; if (this.creating) list.push(this.creating.d);
    for (const d of list) {
      if (d.hidden) continue;
      const tool = TOOLS[d.type]; if (!tool) continue;
      ctx.save();
      try { tool.draw(ctx, X, d); } catch (e) { console.error(e); }
      ctx.restore();
      const sel = d === this.selected || d === (this.creating && this.creating.d) || d === this.hoverDrawing;
      if (sel) {
        const anchors = tool.anchors ? tool.anchors(X, d) : d.pts.map(X.px);
        ctx.setLineDash([]);
        for (const a of anchors) {
          ctx.beginPath(); ctx.arc(a.x, a.y, d === this.selected || this.creating ? 5 : 3.5, 0, Math.PI * 2);
          ctx.fillStyle = this.theme.bg; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#2962ff'; ctx.stroke();
        }
      }
    }
  }

  // ---- axes
  drawAxes(tticks) {
    const ctx = this.ctx, th = this.theme, st = this.app.settings;
    const plotW = this.plotW, plotH = this.plotH;
    ctx.fillStyle = th.bg; ctx.fillRect(plotW, 0, AXIS_W, this.H); ctx.fillRect(0, plotH, this.W, TIME_H);
    this.drawAxesFrame();
    ctx.font = FONT; ctx.fillStyle = th.text; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    for (const pane of this.panes) {
      ctx.save(); ctx.beginPath(); ctx.rect(plotW, pane.top, AXIS_W, pane.h); ctx.clip();
      ctx.fillStyle = th.text;
      for (const tk of pane.ticks) { if (tk.y < pane.top + 6 || tk.y > pane.top + pane.h - 6) continue; ctx.fillText(this.fmtAxis(pane, tk.v), plotW + 8, tk.y); }
      ctx.restore();
    }
    // time labels
    ctx.textAlign = 'center';
    for (const tk of tticks) { if (tk.x < 10 || tk.x > plotW - 10) continue; ctx.font = (tk.bold ? '600 ' : '') + FONT; ctx.fillStyle = th.text; ctx.fillText(tk.txt, tk.x, plotH + TIME_H / 2); }
    ctx.font = FONT;
    const main = this.panes[0]; const data = this.data; const last = data[data.length - 1];
    // indicator last-value labels
    if (st.indicatorLabels) {
      for (const pane of this.panes) {
        for (const ind of pane.inds) {
          const def = INDICATORS[ind.type]; if (ind.visible === false || def.special === 'volume' || def.special === 'vpvr') continue;
          const res = this.result(ind);
          if (def.special === 'compare') { const nv = this.compareNorm(ind, res, this.range.from, this.range.to); const v = nv(Math.min(this.range.to, data.length - 1)); if (isFinite(v)) this.axisLabel(pane, v, ind.styles.v.color); continue; }
          for (const p of def.plots) {
            const s = ind.styles[p.key]; if (!s || s.visible === false || p.type === 'hist' && pane.key === 'main') continue;
            const arr = res[p.key]; if (!arr) continue; const off = this.plotOffset(def, p, ind);
            const i = Math.min(this.range.to, data.length - 1) - off; const v = arr[i]; if (isFinite(v)) this.axisLabel(pane, v, s.color, pane.key !== 'main');
          }
        }
      }
    }
    // drawings axis labels
    if (!this.app.state.drawingsHidden) {
      for (const d of this.drawings) {
        const tool = TOOLS[d.type]; if (d.hidden) continue;
        if (tool && tool.axis) for (const a of tool.axis(d)) { if (a.p != null) this.axisLabel(main, a.p, a.color || d.style.color); else if (d === this.selected) this.timeLabel(a.t, d.style.color); }
        if (d === this.selected && !tool.axis) for (const pt of d.pts) { this.axisLabel(main, pt.p, '#2962ff'); this.timeLabel(pt.t, '#2962ff'); }
      }
    }
    for (const l of this._tradeLines || []) this.axisLabel(main, l.p, l.color);
    // last price
    if (last && st.lastPriceLine) {
      const prev = data[data.length - 2]; const isUp = !prev || last.c >= (this.state.type === 'heikin' ? last.o : prev.c);
      const col = isUp ? st.upColor : st.downColor; const yy = Math.round(this.p2y(main, last.c)) + 0.5;
      if (yy >= main.top && yy <= main.top + main.h) {
        ctx.save(); ctx.beginPath(); ctx.rect(0, main.top, plotW, main.h); ctx.clip();
        ctx.strokeStyle = col; ctx.setLineDash([1, 2]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(plotW, yy); ctx.stroke(); ctx.setLineDash([]); ctx.restore();
      }
      let sub = null;
      const s = this.sym; const nowLive = !this.replay && (isIntraday(this.state.interval) || s.type === 'crypto');
      if (nowLive && st.countdown) { const rem = last.t + this.ivMs - Date.now(); if (rem > 0 && rem <= this.ivMs) sub = fmtDuration(rem); }
      this.axisLabel(main, last.c, col, false, sub);
    }
    // corner: scale mode buttons area
    ctx.fillStyle = th.bg; ctx.fillRect(plotW + 1, plotH + 1, AXIS_W, TIME_H);
    ctx.fillStyle = this.state.logScale ? '#2962ff' : th.textDim; ctx.font = '600 10px Inter, system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(this.state.logScale ? 'LOG' : (this.scales.main && !this.scales.main.auto ? 'MANUAL' : 'AUTO'), plotW + AXIS_W / 2, plotH + TIME_H / 2);
  }
  fmtAxis(pane, v) {
    if (pane.key !== 'main') { const a = Math.abs(v); if (a >= 1e5) return fmtVol(v); return v.toFixed(a < 10 ? 2 : a < 1000 ? 1 : 0); }
    const range = pane.max - pane.min; const prec = range < 0.05 ? 5 : range < 1 ? 4 : range < 20 ? 2 : 2;
    return fmtPlain(v, Math.max(prec, precisionFor(v) === 2 ? 2 : precisionFor(v)));
  }
  axisLabel(pane, v, color, small, sub) {
    const ctx = this.ctx; const y = this.p2y(pane, v); if (y < pane.top - 2 || y > pane.top + pane.h + 2) return;
    const hgt = sub ? 30 : 18; const yy = clamp(y, pane.top + hgt / 2, pane.top + pane.h - hgt / 2);
    ctx.fillStyle = color; roundRect(ctx, this.plotW + 1, yy - (sub ? 9 : hgt / 2), AXIS_W - 2, hgt, 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = (small ? '' : '600 ') + FONT; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(this.fmtAxis(pane, v), this.plotW + 7, sub ? yy : yy);
    if (sub) { ctx.font = '10px Inter, system-ui, sans-serif'; ctx.fillText(sub, this.plotW + 7, yy + 13); }
  }
  timeLabel(t, color) {
    const ctx = this.ctx; const x = this.i2x(this.timeToIdx(t)); if (x < 0 || x > this.plotW) return;
    const txt = fmtTime(t, this.state.interval); ctx.font = FONT; const w = ctx.measureText(txt).width + 14;
    const xx = clamp(x - w / 2, 0, this.plotW - w);
    ctx.fillStyle = color; roundRect(ctx, xx, this.plotH + 2, w, TIME_H - 6, 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(txt, xx + w / 2, this.plotH + TIME_H / 2 - 1);
  }

  drawCrosshair() {
    const ctx = this.ctx, th = this.theme, st = this.app.settings;
    let { x, y, inside } = this.mouse;
    const syncT = this.syncT;
    if (!inside && syncT == null) return;
    if (this.drag && ['pan', 'pscale', 'tscale', 'sep'].includes(this.drag.type)) { if (this.drag.type !== 'pan') return; }
    const tool = this.app.state.tool;
    let idx;
    if (inside) { idx = Math.round(this.x2i(x)); x = this.i2x(idx); } else { idx = Math.round(this.timeToIdx(syncT)); x = this.i2x(idx); }
    this.hoverIdx = inside ? idx : null;
    ctx.strokeStyle = th.cross; ctx.lineWidth = 1; ctx.setLineDash(st.crossStyle === 'solid' ? [] : [4, 4]);
    if (inside && tool === 'dot') {
      ctx.fillStyle = th.cross; ctx.beginPath(); ctx.arc(x, this.snapY(y, idx), 3, 0, Math.PI * 2); ctx.fill();
    } else if (inside && tool === 'arrow') { /* plain cursor */ }
    else {
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, this.plotH); ctx.stroke();
      if (inside && x <= this.plotW && y < this.plotH) { const yy = Math.round(this.snapY(y, idx)) + 0.5; ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(this.plotW, yy); ctx.stroke(); }
    }
    ctx.setLineDash([]);
    // labels
    if (inside && y < this.plotH && this.mouse.x <= this.plotW) {
      const pane = this.paneAt(y); if (pane) { const yy = this.snapY(y, idx); const v = this.y2p(pane, yy); this.axisLabel(pane, v, th.crossLabel); }
    }
    if (x >= 0 && x <= this.plotW) this.timeLabel(this.idxToTime(idx), th.crossLabel);
  }
  snapY(y, idx) {
    const mode = this.app.state.magnet; const main = this.panes && this.panes[0];
    if (!mode || mode === 'off' || !main || y > main.top + main.h) return y;
    const b = this.data[idx]; if (!b) return y;
    const cands = [b.o, b.h, b.l, b.c].map((p) => this.p2y(main, p));
    let best = cands[0]; for (const c of cands) if (Math.abs(c - y) < Math.abs(best - y)) best = c;
    return mode === 'strong' || Math.abs(best - y) < 25 ? best : y;
  }

  // ------------------------------------------------------------------ legend (HTML)
  buildLegend() {
    const s = this.sym; const iv = ivInfo(this.state.interval);
    this.legend.innerHTML = '';
    this.root.classList.toggle('no-info', !this.app.settings.chartInfo);
    const head = h('div', { class: 'lg-main' },
      h('span', { class: 'lg-sym', title: 'Change symbol', onclick: () => this.app.openSymbolSearch(this) }, `${s.name}`),
      h('span', { class: 'lg-dot' }, '·'), h('span', { class: 'lg-iv', onclick: () => this.app.openIntervalMenu(this) }, iv.short),
      h('span', { class: 'lg-dot' }, '·'), h('span', { class: 'lg-ex' }, s.ex),
      h('span', { class: 'lg-src' + (this.demo ? ' demo' : ''), title: 'Data source' }, this.source ? this.source : ''),
      this.replay ? h('span', { class: 'lg-src demo' }, 'REPLAY') : null,
    );
    this.lgOHLC = h('div', { class: 'lg-ohlc' });
    this.legend.append(head, this.lgOHLC);
    this.lgRows = [];
    this.paneLegends.innerHTML = '';
    this.paneLgEls = {};
    for (const ind of this.indicators) {
      const def = INDICATORS[ind.type]; if (!def) continue;
      const vals = h('span', { class: 'lg-vals' });
      const name = def.special === 'compare' ? shortName(ind.inputs.symbol) : indicatorLabel(ind);
      const row = h('div', { class: 'lg-row' + (ind.visible === false ? ' off' : '') },
        h('span', { class: 'lg-name', ondblclick: () => this.app.openIndicatorSettings(this, ind) }, name), vals,
        h('span', { class: 'lg-btns' },
          h('button', { title: ind.visible === false ? 'Show' : 'Hide', html: ind.visible === false ? ICON.eyeOff : ICON.eye, onclick: () => { ind.visible = ind.visible === false; this.updateIndicator(ind); } }),
          h('button', { title: 'Settings', html: ICON.gear, onclick: () => this.app.openIndicatorSettings(this, ind) }),
          h('button', { title: 'Remove', html: ICON.close, onclick: () => this.removeIndicator(ind.uid) }),
        ));
      this.lgRows.push({ ind, vals });
      if (def.overlay) this.legend.append(row);
      else { const box = h('div', { class: 'pane-legend' }, row); this.paneLegends.append(box); this.paneLgEls[ind.uid] = box; }
    }
    this.updateLegend();
  }
  updateLegend() {
    const data = this.data; if (!this.lgOHLC) return;
    if (this.panes) for (const p of this.panes) { const el = this.paneLgEls && this.paneLgEls[p.key]; if (el) el.style.top = p.top + 4 + 'px'; }
    if (!data.length) { this.lgOHLC.innerHTML = ''; return; }
    let i = this.hoverIdx != null && this.mouse.inside ? this.hoverIdx : data.length - 1; i = clamp(i, 0, data.length - 1);
    const b = data[i], p = data[i - 1]; const ch = p ? b.c - p.c : 0; const chp = p ? (ch / p.c) * 100 : 0;
    const cls = b.c >= b.o ? 'up' : 'down'; const f = (v) => fmtPrice(v);
    const key = i + ':' + b.c + ':' + b.h + ':' + b.l;
    if (this._lgKey !== key) {
      this._lgKey = key;
      this.lgOHLC.innerHTML = `<span>O<b class="${cls}">${f(b.o)}</b></span><span>H<b class="${cls}">${f(b.h)}</b></span><span>L<b class="${cls}">${f(b.l)}</b></span><span>C<b class="${cls}">${f(b.c)}</b></span><b class="${ch >= 0 ? 'up' : 'down'}">${ch >= 0 ? '+' : ''}${f(ch)} (${chp >= 0 ? '+' : ''}${chp.toFixed(2)}%)</b>${this.app.settings.showVolLegend ? `<span>Vol<b class="${cls}">${fmtVol(this.srcBars[i] ? this.srcBars[i].v : b.v)}</b></span>` : ''}`;
    }
    for (const { ind, vals } of this.lgRows || []) {
      if (ind.visible === false) { vals.innerHTML = ''; continue; }
      const def = INDICATORS[ind.type]; const res = this.result(ind);
      let html = '';
      if (def.special === 'compare') {
        const arr = res.v || []; const v = arr[i]; const base = ind._base != null ? arr[ind._base] : NaN;
        html = `<b style="color:${ind.styles.v.color}">${fmtPrice(v)}</b>` + (isFinite(base) ? ` <b class="${v >= base ? 'up' : 'down'}">${(((v - base) / base) * 100).toFixed(2)}%</b>` : '');
      } else if (def.special === 'vpvr') html = '';
      else for (const pl of def.plots) {
        const s = ind.styles[pl.key]; if (!s || s.visible === false || !res[pl.key]) continue;
        const off = this.plotOffset(def, pl, ind); const v = res[pl.key][i - off];
        if (ind.type === 'vol' && pl.key === 'ma' && !ind.inputs.showMA) continue;
        html += `<b style="color:${pl.type === 'hist' && pl.colorFn ? pl.colorFn(v, i - off, res) : (s.color.length > 7 && s.color.startsWith('#') ? s.color.slice(0, 7) : s.color)}">${isFinite(v) ? (Math.abs(v) >= 1e5 ? fmtVol(v) : fmtPrice(v, Math.abs(v) < 10 ? 2 : 2)) : '∅'}</b>`;
      }
      vals.innerHTML = html;
    }
  }

  // ------------------------------------------------------------------ selection toolbar
  updateSelToolbar() {
    const d = this.selected;
    if (!d || !this.drawings.includes(d)) { if (!this.selBar.classList.contains('hidden')) this.selBar.classList.add('hidden'); this._selFor = null; return; }
    this.selBar.classList.remove('hidden');
    if (this._selFor === d && this._selVer === JSON.stringify(d.style) + d.locked) return;
    this._selFor = d; this._selVer = JSON.stringify(d.style) + d.locked;
    this.app.buildSelectionToolbar(this, d, this.selBar);
  }

  // ------------------------------------------------------------------ interaction
  bindEvents() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    c.addEventListener('pointermove', (e) => this.onMove(e));
    c.addEventListener('pointerup', (e) => this.onUp(e));
    c.addEventListener('pointercancel', (e) => { this.pinchEnd(e); this.drag = null; });
    c.addEventListener('pointerleave', () => { this.mouse.inside = false; this.hoverIdx = null; this.app.syncCrosshair(this, null); this.requestRender(); });
    c.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    c.addEventListener('dblclick', (e) => this.onDbl(e));
    c.addEventListener('contextmenu', (e) => { e.preventDefault(); this.onContext(e); });
  }
  pos(e) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  region(x, y) { if (y >= this.plotH) return x < this.plotW ? 'time' : 'corner'; if (x >= this.plotW) return 'price'; return 'plot'; }
  ptAt(x, y) {
    const main = this.panes[0]; const i = Math.round(this.x2i(x)); const yy = this.snapY(y, i);
    return { t: this.idxToTime(i), p: this.y2p(main, yy) };
  }
  sepAt(y) { for (let k = 1; k < (this.panes || []).length; k++) if (Math.abs(this.panes[k].top - y) < 4) return k; return 0; }
  hitDrawing(x, y) {
    if (this.app.state.drawingsHidden) return null;
    const main = this.panes[0]; if (y > main.top + main.h) return null;
    const X = this.X; const list = this.drawings;
    for (let k = list.length - 1; k >= 0; k--) { const d = list[k]; if (d.hidden) continue; const t = TOOLS[d.type]; try { if (t && t.hit(X, d, x, y)) return d; } catch (e) { /* */ } }
    return null;
  }
  hitAnchor(d, x, y, r = 8) {
    const tool = TOOLS[d.type]; const X = this.X; const an = tool.anchors ? tool.anchors(X, d) : d.pts.map(X.px);
    let best = -1, bd = r;
    for (let i = 0; i < an.length; i++) { const dist = Math.hypot(an[i].x - x, an[i].y - y); if (dist < bd) { bd = dist; best = i; } }
    return best;
  }
  // any visible, unlocked drawing whose resize handle is under the pointer (selected one wins)
  handleUnder(x, y, r) {
    if (this.app.state.drawingsHidden || this.app.state.drawingsLocked) return null;
    const main = this.panes[0]; if (y > main.top + main.h) return null;
    const list = this.drawings.filter((d) => !d.hidden && !d.locked && TOOLS[d.type]);
    const order = this.selected && list.includes(this.selected) ? [this.selected, ...list.filter((d) => d !== this.selected).reverse()] : list.slice().reverse();
    for (const d of order) { const i = this.hitAnchor(d, x, y, r); if (i >= 0) return { d, i }; }
    return null;
  }

  // two-finger pinch zoom (touch)
  pinchTrack(e, down) {
    if (e.pointerType !== 'touch') return false;
    this._touches ||= new Map();
    const { x, y } = this.pos(e);
    if (down) this._touches.set(e.pointerId, { x, y });
    else if (this._touches.has(e.pointerId)) this._touches.set(e.pointerId, { x, y });
    if (this._touches.size < 2) { return false; }
    const [a, b] = [...this._touches.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const mx = (a.x + b.x) / 2;
    if (!this._pinch) {
      this.drag = null; this.creating = null;
      this._pinch = { dist, sp: this.view.spacing, anchorI: this.x2i(Math.min(mx, this.plotW)) };
      return true;
    }
    const p = this._pinch;
    const ns = clamp(p.sp * (dist / p.dist), MIN_SPACING, MAX_SPACING);
    const ax = Math.min(mx, this.plotW);
    this.view.spacing = ns;
    this.view.right = p.anchorI + (this.plotW - ax - ns / 2) / ns;
    this.requestRender(); this.app.syncTime(this);
    return true;
  }
  pinchEnd(e) {
    if (this._touches) this._touches.delete(e.pointerId);
    if (this._pinch && (!this._touches || this._touches.size < 2)) {
      this._pinch = null; this.drag = null;
      return true;
    }
    return false;
  }

  onDown(e) {
    if (e.button === 2) return;
    if (this.pinchTrack(e, true)) { try { this.canvas.setPointerCapture(e.pointerId); } catch (er) { /* */ } return; }
    this.app.setActive(this);
    const { x, y } = this.pos(e); const reg = this.region(x, y);
    this.canvas.setPointerCapture(e.pointerId);
    this.downAt = { x, y, t: Date.now() };
    if (this.replay && this.replay.selecting && reg === 'plot') {
      const i = clamp(Math.round(this.x2i(x)), 1, this.bars.length - 1);
      this.replaySelect(i); return;
    }
    if (reg === 'price') {
      const pane = this.paneAt(y) || this.panes[0]; const sc = this.scales[pane.key];
      this.drag = { type: 'pscale', pane: pane.key, y0: y, min: pane.min, max: pane.max, lmin: pane.lmin, lmax: pane.lmax, log: pane.log };
      sc.auto = false; return;
    }
    if (reg === 'time') { this.drag = { type: 'tscale', x0: x, sp: this.view.spacing, anchorI: this.x2i(this.plotW) }; return; }
    if (reg === 'corner') { this.app.toggleScaleMenu(this, e); return; }
    const sep = this.sepAt(y);
    if (sep) { this.drag = { type: 'sep', k: sep, y0: y, a: this.panes[sep - 1], b: this.panes[sep] }; return; }
    const tool = this.app.state.tool;
    const main = this.panes[0];
    if (TOOLS[tool] && y <= main.top + main.h) { this.createDown(x, y); return; }
    if (tool === 'eraser') { const d = this.hitDrawing(x, y); if (d) this.app.removeDrawing(this.state.symbol, d); return; }
    // resize handles: grab any drawing's end/side dot directly (no need to select it first); bigger target for touch
    const hu = this.handleUnder(x, y, e.pointerType === 'touch' ? 18 : 11);
    if (hu) {
      if (this.selected !== hu.d) { this.selected = hu.d; this.app.onSelectDrawing(this, hu.d); }
      this.drag = { type: 'anchor', d: hu.d, i: hu.i, before: this.app.snapshot(this.state.symbol) };
      this.requestRender(); return;
    }
    const d = this.hitDrawing(x, y);
    if (d) {
      this.selected = d; this.app.onSelectDrawing(this, d);
      // grab a handle straight away (no need to select the drawing first)
      const hai = !d.locked && !this.app.state.drawingsLocked ? this.hitAnchor(d, x, y) : -1;
      if (hai >= 0) { this.drag = { type: 'anchor', d, i: hai, before: this.app.snapshot(this.state.symbol) }; this.requestRender(); return; }
      if (!d.locked && !this.app.state.drawingsLocked) this.drag = { type: 'move', d, start: this.ptAtRaw(x, y), orig: JSON.parse(JSON.stringify(d.pts)), before: this.app.snapshot(this.state.symbol), moved: false };
      this.requestRender(); return;
    }
    if (this.selected) { this.selected = null; this.app.onSelectDrawing(this, null); }
    const pane = this.paneAt(y) || main;
    this.drag = { type: 'pan', x0: x, y0: y, right: this.view.right, pane: pane.key, min: pane.min, max: pane.max, lmin: pane.lmin, lmax: pane.lmax, log: pane.log, h: pane.h };
    this.canvas.style.cursor = 'grabbing';
    this.requestRender();
  }
  ptAtRaw(x, y) { const main = this.panes[0]; return { i: this.x2i(x), p: this.y2p(main, y) }; }

  createDown(x, y) {
    const tool = TOOLS[this.app.state.tool]; const pt = this.ptAt(x, y);
    if (this.creating) {
      const d = this.creating.d;
      if (tool.npts === 'multi') { d.pts.push({ ...pt }); this.requestRender(); return; }
      if (d.pts.length < tool.npts) { d.pts.push({ ...pt }); this.requestRender(); return; }
      this.finishCreate(); return;
    }
    const type = this.app.state.tool;
    const d = { id: uid(), type, pts: [{ ...pt }], style: { ...DEFAULT_STYLE, ...(TOOL_DEFAULTS[type] || {}), ...(this.app.toolStyle(type) || {}) }, locked: false, hidden: false };
    this.creatingBefore = this.app.snapshot(this.state.symbol);
    if (tool.init) { tool.init(d, pt, this.X); this.creating = { d }; this.finishCreate(); return; }
    if (tool.npts === 1) { this.creating = { d }; this.finishCreate(); if (type === 'text' || type === 'note') this.app.openDrawingProps(this, d, true); return; }
    if (tool.npts === 'brush') { this.creating = { d, brush: true }; return; }
    d.pts.push({ ...pt });
    this.creating = { d, down: { x, y } };
    this.requestRender();
  }
  finishCreate() {
    const d = this.creating.d; this.creating = null;
    const tool = TOOLS[d.type];
    if (tool.npts === 'multi' && d.pts.length > 2) d.pts.pop(); // remove trailing rubber-band point
    this.app.addDrawing(this.state.symbol, d, this.creatingBefore);
    this.selected = d; this.app.onSelectDrawing(this, d);
    if (!this.app.state.stayDrawing) this.app.setTool('cross');
    this.requestRender();
  }

  onMove(e) {
    if (this._touches && this._touches.has(e.pointerId) && this.pinchTrack(e, false)) return;
    const { x, y } = this.pos(e);
    this.mouse = { x, y, inside: x < this.plotW && y < this.plotH };
    const dr = this.drag;
    if (this.creating) {
      const d = this.creating.d;
      if (this.creating.brush) { if (e.buttons & 1) { const pt = this.ptAt(x, y); pt.t = this.idxToTime(this.x2i(x)); pt.p = this.y2p(this.panes[0], y); d.pts.push(pt); } }
      else d.pts[d.pts.length - 1] = this.ptAt(x, y);
      this.requestRender();
    } else if (dr) {
      if (dr.type === 'pan') {
        this.view.right = dr.right - (x - dr.x0) / this.view.spacing;
        const sc = this.scales[dr.pane];
        if (sc && !sc.auto) {
          const dy = (y - dr.y0) / dr.h;
          if (dr.log) { const span = dr.lmax - dr.lmin; sc.lmin = dr.lmin + dy * span; sc.lmax = dr.lmax + dy * span; }
          else { const span = dr.max - dr.min; sc.min = dr.min + dy * span; sc.max = dr.max + dy * span; }
        }
        this.app.syncTime(this);
      } else if (dr.type === 'pscale') {
        const sc = this.scales[dr.pane]; const k = Math.exp((y - dr.y0) / 120);
        if (dr.log) { const mid = (dr.lmin + dr.lmax) / 2, half = ((dr.lmax - dr.lmin) / 2) * k; sc.lmin = mid - half; sc.lmax = mid + half; }
        else { const mid = (dr.min + dr.max) / 2, half = ((dr.max - dr.min) / 2) * k; sc.min = mid - half; sc.max = mid + half; }
      } else if (dr.type === 'tscale') {
        this.view.spacing = clamp(dr.sp * Math.exp((x - dr.x0) / 150), MIN_SPACING, MAX_SPACING);
        this.view.right = dr.anchorI; this.app.syncTime(this);
      } else if (dr.type === 'sep') {
        const dy = y - dr.y0; const a = dr.a.h + dy, b = dr.b.h - dy; if (a < 40 || b < 40) return;
        const unit = (dr.a.h + dr.b.h) / ((this.state.paneRatios[dr.a.key] || (dr.a.key === 'main' ? 3 : 1)) + (this.state.paneRatios[dr.b.key] || 1));
        const tot = (this.state.paneRatios[dr.a.key] || (dr.a.key === 'main' ? 3 : 1)) + (this.state.paneRatios[dr.b.key] || 1);
        this.state.paneRatios[dr.a.key] = (a / (a + b)) * tot; this.state.paneRatios[dr.b.key] = (b / (a + b)) * tot; void unit;
        dr.y0 = y; dr.a = { ...dr.a, h: a }; dr.b = { ...dr.b, h: b };
      } else if (dr.type === 'move') {
        const cur = this.ptAtRaw(x, y); const di = Math.round(cur.i - dr.start.i); const dp = cur.p - dr.start.p;
        dr.d.pts = dr.orig.map((p) => ({ t: this.idxToTime(Math.round(this.timeToIdx(p.t)) + di), p: p.p + dp }));
        dr.moved = true;
      } else if (dr.type === 'anchor') {
        const tool = TOOLS[dr.d.type]; const pt = this.ptAt(x, y);
        if (tool.moveAnchor) tool.moveAnchor(dr.d, dr.i, pt); else dr.d.pts[dr.i] = pt;
        dr.moved = true;
      }
      this.requestRender();
    } else {
      // hover cursor
      const reg = this.region(x, y); let cur = 'crosshair';
      const tool = this.app.state.tool;
      if (reg === 'price') cur = 'ns-resize'; else if (reg === 'time') cur = 'ew-resize'; else if (reg === 'corner') cur = 'pointer';
      else if (this.sepAt(y)) cur = 'row-resize';
      else if (!TOOLS[tool]) {
        const hd = this.hitDrawing(x, y);
        if (hd !== this.hoverDrawing) { this.hoverDrawing = hd; }
        if (hd) cur = tool === 'eraser' ? 'not-allowed' : (this.hitAnchor(hd, x, y, 11) >= 0 ? 'move' : 'pointer');
        else if (tool === 'arrow') cur = 'default'; else if (tool === 'eraser') cur = 'cell';
        else if (tool === 'dot') cur = 'none';
      }
      if (this.replay && this.replay.selecting) cur = 'col-resize';
      this.canvas.style.cursor = cur;
      this.requestRender();
    }
    if (this.mouse.inside) this.app.syncCrosshair(this, this.idxToTime(Math.round(this.x2i(x))));
  }
  onUp(e) {
    if (this.pinchEnd(e)) return;
    const { x, y } = this.pos(e);
    try { this.canvas.releasePointerCapture(e.pointerId); } catch (er) { /* */ }
    if (this.creating) {
      const tool = TOOLS[this.creating.d.type];
      if (this.creating.brush) { this.finishCreate(); return; }
      const dn = this.creating.down;
      if (dn && Math.hypot(x - dn.x, y - dn.y) > 6 && tool.npts !== 'multi') {
        if (this.creating.d.pts.length >= tool.npts) this.finishCreate();
        else this.creating.d.pts.push(this.ptAt(x, y));
        this.creating && (this.creating.down = null);
      } else if (this.creating) this.creating.down = null;
      return;
    }
    const dr = this.drag; this.drag = null;
    this.canvas.style.cursor = 'crosshair';
    if (dr && (dr.type === 'move' || dr.type === 'anchor') && dr.moved) this.app.commitDrawings(this.state.symbol, dr.before);
    if (dr && dr.type === 'sep') this.app.saveSoon();
    this.requestRender();
  }
  onWheel(e) {
    e.preventDefault();
    const { x, y } = this.pos(e); const reg = this.region(x, y);
    if (reg === 'price') {
      const pane = this.paneAt(y) || this.panes[0]; const sc = this.scales[pane.key]; sc.auto = false;
      const k = Math.exp(e.deltaY / 500);
      if (pane.log) { const mid = (pane.lmin + pane.lmax) / 2, half = ((pane.lmax - pane.lmin) / 2) * k; sc.lmin = mid - half; sc.lmax = mid + half; }
      else { const mid = (pane.min + pane.max) / 2, half = ((pane.max - pane.min) / 2) * k; sc.min = mid - half; sc.max = mid + half; }
      this.requestRender(); return;
    }
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
      const d = e.shiftKey ? e.deltaY : e.deltaX;
      this.view.right += d / this.view.spacing; this.requestRender(); this.app.syncTime(this); return;
    }
    const anchorI = this.x2i(reg === 'plot' ? x : this.plotW);
    const k = Math.exp(-e.deltaY / 400);
    const ns = clamp(this.view.spacing * k, MIN_SPACING, MAX_SPACING);
    // keep anchor index under cursor
    const ax = reg === 'plot' ? x : this.plotW;
    this.view.spacing = ns;
    this.view.right = anchorI + (this.plotW - ax - ns / 2) / ns;
    this.requestRender(); this.app.syncTime(this);
  }
  onDbl(e) {
    const { x, y } = this.pos(e); const reg = this.region(x, y);
    if (this.creating && TOOLS[this.creating.d.type].npts === 'multi') { this.finishCreate(); return; }
    if (reg === 'price') { const pane = this.paneAt(y) || this.panes[0]; this.scales[pane.key] = { auto: true }; this.requestRender(); return; }
    if (reg === 'time') { this.resetView(); return; }
    const d = this.hitDrawing(x, y);
    if (d) { this.app.openDrawingProps(this, d); return; }
    const pane = this.paneAt(y); if (pane && pane.key !== 'main') { const ind = this.indicators.find((i) => i.uid === pane.key); if (ind) this.app.openIndicatorSettings(this, ind); }
  }
  onContext(e) {
    const { x, y } = this.pos(e);
    if (this.creating) { this.cancelCreate(); return; }
    const pane = this.paneAt(y) || this.panes[0];
    const price = this.y2p(this.panes[0], Math.min(y, this.panes[0].top + this.panes[0].h));
    const d = this.hitDrawing(x, y);
    this.app.showChartContextMenu(this, e, { price, drawing: d, pane, inMain: pane.key === 'main' });
  }
  cancelCreate() { this.creating = null; this.requestRender(); }
  keyDown(e) {
    if (e.key === 'Escape') { if (this.creating) { if (TOOLS[this.creating.d.type].npts === 'multi' && this.creating.d.pts.length > 2) this.finishCreate(); else this.cancelCreate(); } else if (this.selected) { this.selected = null; this.app.onSelectDrawing(this, null); this.requestRender(); } else this.app.setTool('cross'); return true; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected) { this.app.removeDrawing(this.state.symbol, this.selected); this.selected = null; this.app.onSelectDrawing(this, null); return true; }
    if (e.key === 'ArrowLeft') { this.view.right -= Math.max(1, 20 / this.view.spacing); this.requestRender(); return true; }
    if (e.key === 'ArrowRight') { this.view.right += Math.max(1, 20 / this.view.spacing); this.requestRender(); return true; }
    if (e.key === 'ArrowUp' || e.key === '+' || e.key === '=') { this.zoom(1.2); return true; }
    if (e.key === 'ArrowDown' || e.key === '-') { this.zoom(1 / 1.2); return true; }
    return false;
  }
  zoom(k) { const ri = this.view.right; this.view.spacing = clamp(this.view.spacing * k, MIN_SPACING, MAX_SPACING); this.view.right = ri; this.requestRender(); }
  goToTime(t) { const i = this.timeToIdx(t); const vis = this.plotW / this.view.spacing; this.view.right = i + vis / 2; this.requestRender(); }

  async fetchOlder() {
    this.loadingMore = true;
    const first = this.bars[0];
    const older = await loadMore(this.state.symbol, this.state.interval, first.t);
    const fresh = older.filter((b) => b.t < first.t);
    if (fresh.length) { this.bars = fresh.concat(this.bars); this.view.right += fresh.length; this.ver++; this.indCache.clear(); }
    else this.noMore = true;
    this.loadingMore = false; this.requestRender();
  }

  // ------------------------------------------------------------------ bar replay
  replayStart() { this.replay = { selecting: true, idx: null, playing: false, speed: 1 }; this.buildLegend(); this.requestRender(); }
  replaySelect(i) {
    this.replay.selecting = false; this.replay.idx = i; this.ver++; this.indCache.clear();
    this.view.right = i + this.app.settings.rightMargin + 10; this.buildLegend(); this.requestRender(); this.emit('replay');
  }
  replayStep(n = 1) {
    if (!this.replay || this.replay.idx == null) return;
    if (this.replay.idx >= this.bars.length - 1) { this.replayPause(); return; }
    this.replay.idx = Math.min(this.bars.length - 1, this.replay.idx + n); this.ver++;
    if (this.i2x(this.replay.idx) > this.plotW - 40) this.view.right += n;
    this.requestRender(); this.emit('replay');
    this.app.onReplayBar && this.app.onReplayBar(this, this.bars[this.replay.idx]);
  }
  replayStepBack() { if (!this.replay || this.replay.idx == null || this.replay.idx < 2) return; this.replay.idx--; this.ver++; this.requestRender(); this.emit('replay'); }
  replayPlay() { if (!this.replay || this.replay.idx == null) return; this.replay.playing = true; clearInterval(this.replayTimer); this.replayTimer = setInterval(() => this.replayStep(1), 1000 / this.replay.speed); this.emit('replay'); }
  replayPause() { if (!this.replay) return; this.replay.playing = false; clearInterval(this.replayTimer); this.emit('replay'); }
  replaySpeed(s) { if (!this.replay) return; this.replay.speed = s; if (this.replay.playing) this.replayPlay(); }
  replayStop() { clearInterval(this.replayTimer); this.replay = null; this.ver++; this.indCache.clear(); this.scrollToLatest(); this.buildLegend(); this.emit('replay'); }

  // ------------------------------------------------------------------ screenshot
  snapshot() {
    this.render();
    const c = document.createElement('canvas'); c.width = this.canvas.width; c.height = this.canvas.height + 40 * this.dpr;
    const x = c.getContext('2d'); x.fillStyle = this.theme.bg; x.fillRect(0, 0, c.width, c.height);
    x.drawImage(this.canvas, 0, 40 * this.dpr);
    x.scale(this.dpr, this.dpr); x.fillStyle = this.theme.textStrong; x.font = '600 15px Inter, system-ui, sans-serif'; x.textBaseline = 'middle';
    const last = this.data[this.data.length - 1];
    x.fillText(`${this.sym.name} (${this.state.symbol}) · ${ivInfo(this.state.interval).label}${last ? ' · ' + fmtPrice(last.c) : ''}`, 12, 20);
    x.font = '11px Inter, system-ui, sans-serif'; x.fillStyle = this.theme.textDim; x.textAlign = 'right';
    x.fillText(`ChartVista · ${new Date().toLocaleString('en-IN')}`, this.W - 12, 20);
    return c.toDataURL('image/png');
  }
}
export { AXIS_W, TIME_H };
