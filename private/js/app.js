// Main Application Controller: Multi-chart workspace, Topbar, Left Drawing Toolbar, Right Sidebar, Bottom Dock & Modals
import { $, $$, h, clamp, uid, debounce, fmtPrice, fmtPct, fmtVol, fmtINRShort, fmtClock, fmtDateShort, signCls, INTERVALS, ivInfo, TIMEZONES, setTimezone, getTimezone, nseStatus, store, download } from './utils.js';
import { SYMBOLS, CATEGORIES, NIFTY50, getSymbol, fromYahoo, searchLocal, shortName, DEFAULT_WATCHLIST } from './symbols.js';
import { quotes, searchRemote } from './data.js';
import { INDICATORS, CATEGORY_ORDER, createIndicator, indicatorLabel } from './indicators.js';
import { TOOLS, TOOL_GROUPS, toolName } from './drawings.js';
import { Chart, CHART_TYPES } from './chart.js';
import { ICON } from './icons.js';
import { TradingEngine, AlertsManager, DEFAULT_SCRIPT, runCustomScript, getScreenerRows, getIndiaConversionRates } from './features.js';

const THEMES = {
  aurora: {
    name: 'Cyber Aurora', badge: '✨ AURORA',
    bg: '#070812', panel: '#0d1021', border: 'rgba(124, 58, 237, 0.28)', grid: 'rgba(56, 189, 248, 0.065)',
    text: '#94a3b8', textStrong: '#f8fafc', textDim: '#64748b',
    cross: '#00f5d4', crossLabel: '#7c3aed', watermark: 'rgba(0, 245, 212, 0.045)',
    glow1: 'rgba(0, 245, 212, 0.08)', glow2: 'rgba(168, 85, 247, 0.09)',
    up: '#00f5a0', down: '#ff2a85', line: '#00e5ff',
  },
  synthwave: {
    name: 'Synthwave Sunset', badge: '🌆 SYNTH',
    bg: '#0c0517', panel: '#160a29', border: 'rgba(255, 42, 133, 0.3)', grid: 'rgba(255, 0, 128, 0.07)',
    text: '#cbb2e8', textStrong: '#fff0fb', textDim: '#7e5ea0',
    cross: '#ffbe0b', crossLabel: '#ff007f', watermark: 'rgba(255, 0, 128, 0.05)',
    glow1: 'rgba(255, 0, 127, 0.1)', glow2: 'rgba(255, 190, 11, 0.08)',
    up: '#00f5d4', down: '#ff2a85', line: '#ffbe0b',
  },
  emerald: {
    name: 'Emerald Matrix', badge: '🟢 MATRIX',
    bg: '#040d0a', panel: '#081a14', border: 'rgba(16, 185, 129, 0.28)', grid: 'rgba(16, 185, 129, 0.07)',
    text: '#86efac', textStrong: '#ecfdf5', textDim: '#478569',
    cross: '#10b981', crossLabel: '#059669', watermark: 'rgba(16, 185, 129, 0.05)',
    glow1: 'rgba(16, 185, 129, 0.1)', glow2: 'rgba(6, 182, 212, 0.08)',
    up: '#10f587', down: '#ff5252', line: '#10f587',
  },
  goldlux: {
    name: 'Solar Bullion', badge: '👑 GOLD',
    bg: '#0c0905', panel: '#17120a', border: 'rgba(245, 158, 11, 0.3)', grid: 'rgba(245, 158, 11, 0.065)',
    text: '#d6c7b2', textStrong: '#fffbeb', textDim: '#85735c',
    cross: '#fbbf24', crossLabel: '#d97706', watermark: 'rgba(251, 191, 36, 0.045)',
    glow1: 'rgba(245, 158, 11, 0.1)', glow2: 'rgba(234, 88, 12, 0.08)',
    up: '#fbbf24', down: '#f43f5e', line: '#fbbf24',
  },
  dark: {
    name: 'Classic Slate', badge: '🌙 SLATE',
    bg: '#131722', panel: '#1e222d', border: '#2a2e39', grid: 'rgba(42, 46, 57, 0.55)',
    text: '#9598a1', textStrong: '#d1d4dc', textDim: '#5d606b',
    cross: '#787b86', crossLabel: '#363a45', watermark: 'rgba(209, 212, 220, 0.045)',
    up: '#089981', down: '#f23645', line: '#2962ff',
  },
  light: {
    name: 'Daylight Frost', badge: '☀️ LIGHT',
    bg: '#f8fafc', panel: '#ffffff', border: '#e2e8f0', grid: 'rgba(148, 163, 184, 0.25)',
    text: '#475569', textStrong: '#0f172a', textDim: '#94a3b8',
    cross: '#64748b', crossLabel: '#0f172a', watermark: 'rgba(15, 23, 42, 0.045)',
    up: '#059669', down: '#e11d48', line: '#2563eb',
  },
};

const LAYOUTS = [
  { id: '1', n: 1, label: 'Single chart', icon: 'l_1', cls: 'grid-1' },
  { id: '2v', n: 2, label: '2 charts (vertical split)', icon: 'l_2v', cls: 'grid-2v' },
  { id: '2h', n: 2, label: '2 charts (horizontal split)', icon: 'l_2h', cls: 'grid-2h' },
  { id: '3v', n: 3, label: '3 columns', icon: 'l_3v', cls: 'grid-3v' },
  { id: '3h', n: 3, label: '3 rows', icon: 'l_3h', cls: 'grid-3h' },
  { id: '3l', n: 3, label: '1 left + 2 right', icon: 'l_3l', cls: 'grid-3l' },
  { id: '3t', n: 3, label: '1 top + 2 bottom', icon: 'l_3t', cls: 'grid-3t' },
  { id: '4', n: 4, label: '4 charts (2×2)', icon: 'l_4', cls: 'grid-4' },
  { id: '6', n: 6, label: '6 charts (3×2)', icon: 'l_6', cls: 'grid-6' },
  { id: '8', n: 8, label: '8 charts (4×2)', icon: 'l_8', cls: 'grid-8' },
];

const DEFAULT_PRESET_CHARTS = [
  { symbol: 'NSE:NIFTY', interval: '1D', type: 'candles', indicators: [createIndicator('vol'), createIndicator('ema', { inputs: { length: 20 } })] },
  { symbol: 'BINANCE:BTCUSDT', interval: '1h', type: 'candles', indicators: [createIndicator('vol'), createIndicator('bb')] },
  { symbol: 'BINANCE:XAUUSDT', interval: '1h', type: 'candles', indicators: [createIndicator('vol'), createIndicator('supertrend')] },
  { symbol: 'NSE:RELIANCE', interval: '1D', type: 'candles', indicators: [createIndicator('vol'), createIndicator('rsi')] },
  { symbol: 'NSE:BANKNIFTY', interval: '15m', type: 'candles', indicators: [createIndicator('vol'), createIndicator('vwap')] },
  { symbol: 'INR:GOLD10G', interval: '4h', type: 'candles', indicators: [createIndicator('vol')] },
  { symbol: 'NSE:HDFCBANK', interval: '1D', type: 'candles', indicators: [createIndicator('vol')] },
  { symbol: 'FX:USDINR', interval: '1D', type: 'area', indicators: [] },
];

const TEMPLATES = [
  { name: 'Price Action Clean', inds: [{ t: 'vol' }] },
  { name: 'Intraday Scalper (VWAP + EMA 9/21 + RSI)', inds: [{ t: 'vol' }, { t: 'vwap' }, { t: 'ema', i: { length: 9 } }, { t: 'ema', i: { length: 21 } }, { t: 'rsi' }] },
  { name: 'Swing Trend (Supertrend + EMA 50/200 + MACD)', inds: [{ t: 'vol' }, { t: 'supertrend' }, { t: 'ema', i: { length: 50 } }, { t: 'sma', i: { length: 200 } }, { t: 'macd' }] },
  { name: 'Bollinger Squeeze + Stochastic RSI', inds: [{ t: 'vol' }, { t: 'bb' }, { t: 'kc' }, { t: 'stochrsi' }] },
  { name: 'Ichimoku Cloud + ADX', inds: [{ t: 'vol' }, { t: 'ichimoku' }, { t: 'adx' }] },
  { name: 'Volume Profile + Pivot Points', inds: [{ t: 'vol' }, { t: 'vpvr' }, { t: 'pivots' }] },
];

export class App {
  constructor() {
    const savedSettings = store.get('settings', {});
    if (!savedSettings.neonUpgraded) {
      delete savedSettings.theme;
      delete savedSettings.upColor;
      delete savedSettings.downColor;
      delete savedSettings.wickUp;
      delete savedSettings.wickDown;
      delete savedSettings.lineColor;
    }
    this.settings = {
      theme: 'aurora', upColor: '#00f5a0', downColor: '#ff2a85', wickUp: '#00f5a0', wickDown: '#ff2a85',
      lineColor: '#00e5ff', glowEffects: true, gridV: true, gridH: true, watermark: true, lastPriceLine: true,
      countdown: true, indicatorLabels: true, showVolLegend: true, crossStyle: 'dashed',
      rightMargin: 10, barSpacing: 8, timezone: 'Asia/Kolkata', neonUpgraded: true,
      ...savedSettings,
    };
    setTimezone(this.settings.timezone);
    document.documentElement.dataset.theme = this.settings.theme;

    this.state = {
      layout: '1',
      syncSymbol: false,
      syncInterval: false,
      syncCrosshair: true,
      syncTime: false,
      tool: 'cross',
      magnet: 'off', // 'off' | 'weak' | 'strong'
      stayDrawing: false,
      drawingsLocked: false,
      drawingsHidden: false,
      rightTab: 'watchlist', // 'watchlist' | 'alerts' | 'tree' | 'calc' | null
      bottomTab: null, // 'trading' | 'screener' | 'pine' | null
      favIntervals: ['1m', '3m', '5m', '15m', '1h', '4h', '1D', '1W'],
      ...store.get('state', {}),
    };
    this.state.tool = 'cross';
    // Ensure 3m is in the quick timeframe strip (even for older saved settings)
    if (!this.state.favIntervals.includes('3m')) {
      const i = this.state.favIntervals.indexOf('1m');
      this.state.favIntervals.splice(i >= 0 ? i + 1 : 0, 0, '3m');
    }

    // Named workspaces (MyTV-style): each has its own charts + drawings
    const migratedDrawings = store.get('drawings', {});
    const migratedCharts = store.get('charts', null);
    this.workspaces = store.get('workspaces', null) || [{
      id: 'default',
      name: 'Default',
      layout: this.state.layout || '1',
      charts: migratedCharts,
      drawings: migratedDrawings,
    }];
    this.activeWorkspaceId = store.get('activeWorkspace', this.workspaces[0].id);
    if (!this.workspaces.find((w) => w.id === this.activeWorkspaceId)) this.activeWorkspaceId = this.workspaces[0].id;
    const ws = this.workspaces.find((w) => w.id === this.activeWorkspaceId) || this.workspaces[0];
    this.drawingsMap = ws.drawings || {}; // symbol -> Array<drawing>
    this.state.layout = ws.layout || this.state.layout || '1';
    this.favTools = store.get('favTools', ['long', 'short', 'trend', 'hline', 'measure', 'fib']);
    this.favPos = store.get('favPos', { top: 48, left: 12 });

    this.undoStack = {};
    this.redoStack = {};
    this.toolStyles = store.get('toolStyles', {});
    this.watchlist = store.get('watchlist', DEFAULT_WATCHLIST);
    this.customScripts = store.get('customScripts', { code: DEFAULT_SCRIPT });

    this.trading = new TradingEngine();
    this.alertsMgr = new AlertsManager();

    this.charts = [];
    this.active = null;
    this.saveSoon = debounce(() => this.saveState(), 400);
    this._saveFlash = null;

    this.buildUI();
    this.applyLayout(this.state.layout, ws.charts || migratedCharts);
    this.bindGlobalEvents();
    this.startClocks();
  }

  get theme() { return THEMES[this.settings.theme] || THEMES.dark; }

  saveState() {
    this.persistActiveWorkspace();
    store.set('settings', this.settings);
    store.set('state', {
      layout: this.state.layout, syncSymbol: this.state.syncSymbol, syncInterval: this.state.syncInterval,
      syncCrosshair: this.state.syncCrosshair, syncTime: this.state.syncTime, magnet: this.state.magnet,
      stayDrawing: this.state.stayDrawing, drawingsLocked: this.state.drawingsLocked, drawingsHidden: this.state.drawingsHidden,
      rightTab: this.state.rightTab, bottomTab: this.state.bottomTab, favIntervals: this.state.favIntervals,
    });
    store.set('workspaces', this.workspaces);
    store.set('activeWorkspace', this.activeWorkspaceId);
    store.set('charts', this.charts.map((c) => c.serialize()));
    store.set('drawings', this.drawingsMap);
    store.set('favTools', this.favTools);
    store.set('favPos', this.favPos || { top: 48, left: 12 });
    store.set('watchlist', this.watchlist);
    this.flashSaved();
  }

  persistActiveWorkspace() {
    const ws = this.workspaces.find((w) => w.id === this.activeWorkspaceId);
    if (!ws) return;
    ws.layout = this.state.layout;
    ws.charts = this.charts.map((c) => c.serialize());
    ws.drawings = this.drawingsMap;
  }

  flashSaved() {
    this._saveFlash = Date.now();
    const el = this.topbar && this.topbar.querySelector('.tb-saved');
    if (el) { el.textContent = 'Saved'; el.classList.add('on'); setTimeout(() => el.classList.remove('on'), 1200); }
  }

  activeWorkspace() {
    return this.workspaces.find((w) => w.id === this.activeWorkspaceId) || this.workspaces[0];
  }

  switchWorkspace(id) {
    if (id === this.activeWorkspaceId) return;
    this.persistActiveWorkspace();
    const ws = this.workspaces.find((w) => w.id === id);
    if (!ws) return;
    this.activeWorkspaceId = id;
    this.drawingsMap = ws.drawings || (ws.drawings = {});
    this.undoStack = {};
    this.redoStack = {};
    this.applyLayout(ws.layout || '1', ws.charts || null);
    this.renderTopbar();
    this.renderLeftbar();
    this.saveSoon();
    this.toast(`Layout “${ws.name}” — drawings isolated to this layout`);
  }

  createWorkspace() {
    this.persistActiveWorkspace();
    const name = (prompt('New layout name', `Layout ${this.workspaces.length + 1}`) || '').trim();
    if (!name) return;
    const id = uid();
    this.workspaces.push({
      id, name, layout: '2h',
      charts: [
        { symbol: 'BINANCE:BTCUSDT', interval: '1h', type: 'candles', indicators: [createIndicator('vol')] },
        { symbol: 'BINANCE:XAUUSDT', interval: '1h', type: 'candles', indicators: [createIndicator('vol')] },
      ],
      drawings: {},
    });
    this.switchWorkspace(id);
  }

  renameWorkspace() {
    const ws = this.activeWorkspace();
    if (!ws) return;
    const name = (prompt('Rename layout', ws.name) || '').trim();
    if (!name) return;
    ws.name = name.slice(0, 80);
    this.renderTopbar();
    this.saveSoon();
  }

  deleteWorkspace() {
    if (this.workspaces.length <= 1) { this.toast('Keep at least one layout', 'warn'); return; }
    const ws = this.activeWorkspace();
    if (!ws || !confirm(`Delete layout “${ws.name}”? Drawings on it will be removed.`)) return;
    this.workspaces = this.workspaces.filter((w) => w.id !== ws.id);
    this.activeWorkspaceId = this.workspaces[0].id;
    const next = this.workspaces[0];
    this.drawingsMap = next.drawings || (next.drawings = {});
    this.applyLayout(next.layout || '1', next.charts || null);
    this.renderTopbar();
    this.saveSoon();
  }

  // ================================================================ UI Skeleton
  buildUI() {
    const app = $('#app');
    app.innerHTML = '';

    this.topbar = h('header', { class: 'topbar' });
    this.replayBar = h('div', { class: 'replay-bar hidden' });
    this.leftbar = h('aside', { class: 'leftbar' });
    this.gridEl = h('main', { class: 'chart-grid' });
    this.bottomPanel = h('section', { class: 'bottom-panel hidden' });
    this.bottomBar = h('footer', { class: 'bottom-bar' });
    this.rightPanel = h('aside', { class: 'right-panel' });
    this.rightRail = h('nav', { class: 'right-rail' });
    this.toastBox = h('div', { class: 'toast-container' });
    this.modalRoot = h('div', { class: 'modal-root hidden' });
    this.popRoot = h('div', { class: 'pop-root' });

    const centerCol = h('div', { class: 'center-col' }, this.replayBar, this.gridEl, this.bottomPanel, this.bottomBar);
    const body = h('div', { class: 'workspace' }, this.leftbar, centerCol, this.rightPanel, this.rightRail);
    app.append(this.topbar, body, this.toastBox, this.modalRoot, this.popRoot);

    this.renderTopbar();
    this.renderLeftbar();
    this.renderRightRail();
    this.renderRightPanel();
    this.renderBottomBar();
    this.renderBottomPanel();

    quotes.on('quote', (id, q, prev) => this.onQuoteUpdate(id, q, prev));
    this.trading.on('change', () => { this.renderBottomPanel(); this.charts.forEach((c) => c.requestRender()); });
    this.trading.on('tick', () => this.updateTradingLive());
    this.trading.on('fill', (ord, px) => this.toast(`${ord.side.toUpperCase()} ${ord.qty} ${shortName(ord.symbol)} @ ${fmtPrice(px)}`, 'success'));
    this.alertsMgr.on('change', () => { if (this.state.rightTab === 'alerts') this.renderRightPanel(); this.charts.forEach((c) => c.requestRender()); });
    this.alertsMgr.on('trigger', (a, log) => {
      this.toast(`🔔 Alert Triggered: ${shortName(a.symbol)} ${a.condition.replace('_', ' ')} ${fmtPrice(a.price)}`, 'warn');
      if (this.state.rightTab === 'alerts') this.renderRightPanel();
    });
  }

  // ================================================================ Top Toolbar
  renderTopbar() {
    const c = this.active;
    const sym = c ? c.sym : getSymbol('NSE:NIFTY');
    const iv = c ? c.state.interval : '1D';
    const ct = c ? c.state.type : 'candles';
    const ctInfo = CHART_TYPES.find((x) => x.id === ct) || CHART_TYPES[0];
    const lay = LAYOUTS.find((x) => x.id === this.state.layout) || LAYOUTS[0];

    this.topbar.innerHTML = '';
    const symBtn = h('button', { class: 'tb-btn tb-sym', title: 'Symbol Search (Ctrl+K or start typing)', onclick: () => this.openSymbolSearch() },
      h('span', { class: 'tb-logo', html: ICON.logo }),
      h('span', { class: 'tb-sym-name' }, shortName(sym.id)),
      h('span', { class: 'tb-sym-ex' }, sym.ex),
    );
    const compareBtn = h('button', { class: 'tb-btn icon-only', title: 'Compare or Add Symbol', html: ICON.plus, onclick: () => this.openCompareModal() });

    const marketsBtn = h('button', { class: 'tb-btn', title: 'Markets — quick symbols', onclick: (e) => this.openMarketsDropdown(e.currentTarget) },
      h('span', {}, 'Markets'), h('span', { class: 'chev', html: ICON.chevDown }));

    // Intervals
    const ivBtns = INTERVALS.filter((x) => this.state.favIntervals.includes(x.id)).map((x) =>
      h('button', {
        class: 'tb-btn tb-iv' + (x.id === iv ? ' active' : ''),
        title: x.label,
        onclick: () => this.setIntervalOnActive(x.id),
      }, x.short)
    );
    const ivMore = h('button', { class: 'tb-btn icon-only', title: 'All Timeframes', html: ICON.chevDown, onclick: (e) => this.openIntervalDropdown(e.currentTarget) });

    // Chart Type
    const ctBtn = h('button', { class: 'tb-btn', title: `Chart Style: ${ctInfo.label}`, onclick: (e) => this.openChartTypeDropdown(e.currentTarget) },
      h('span', { html: ICON['ct_' + ct] || ICON.ct_candles }),
      h('span', { class: 'tb-hide-md' }, ctInfo.label),
      h('span', { class: 'chev', html: ICON.chevDown }),
    );

    // NoGap toggle (MyTV feature — open = previous close)
    const nogapOn = ct === 'nogap';
    const nogapBtn = h('button', {
      class: 'tb-btn' + (nogapOn ? ' active' : ''),
      title: 'No gaps candles — each open = previous close (hide overnight gaps)',
      onclick: () => {
        if (!this.active) return;
        this.active.setType(nogapOn ? 'candles' : 'nogap');
        this.renderTopbar();
        this.toast(nogapOn ? 'NoGap OFF' : 'NoGap ON — opens glued to prior close');
      },
    }, h('span', { html: ICON.ct_nogap }), h('span', { class: 'tb-hide-md' }, 'NoGap'));

    // Indicators & Templates
    const indBtn = h('button', { class: 'tb-btn', title: 'Indicators, Metrics & Strategies (/)', onclick: () => this.openIndicatorsModal() },
      h('span', { html: ICON.indicator }),
      h('span', { class: 'tb-hide-sm' }, 'Indicators'),
    );
    const tplBtn = h('button', { class: 'tb-btn', title: 'Indicator Templates', onclick: (e) => this.openTemplatesDropdown(e.currentTarget) },
      h('span', { html: ICON.template }),
      h('span', { class: 'tb-hide-lg' }, 'Templates'),
    );

    // Alert & Replay
    const alertBtn = h('button', { class: 'tb-btn', title: 'Create Price Alert (Alt+A)', onclick: () => this.openAlertModal() },
      h('span', { html: ICON.alert }),
      h('span', { class: 'tb-hide-md' }, 'Alert'),
    );
    const replayBtn = h('button', { class: 'tb-btn' + (c && c.replay ? ' active' : ''), title: 'Bar Replay', onclick: () => this.toggleReplay() },
      h('span', { html: ICON.replay }),
      h('span', { class: 'tb-hide-md' }, 'Replay'),
    );

    // Undo / Redo
    const undoBtn = h('button', { class: 'tb-btn icon-only', title: 'Undo Drawing (Ctrl+Z)', html: ICON.undo, onclick: () => this.undoDrawing() });
    const redoBtn = h('button', { class: 'tb-btn icon-only', title: 'Redo Drawing (Ctrl+Y)', html: ICON.redo, onclick: () => this.redoDrawing() });

    // Named workspaces (create / rename / delete) + grid panel count
    const ws = this.activeWorkspace();
    const wsPick = h('button', {
      class: 'tb-btn tb-ws-pick',
      title: 'Named layouts — each keeps its own drawings',
      onclick: (e) => this.openWorkspaceDropdown(e.currentTarget),
    }, h('span', {}, ws.name), h('span', { class: 'chev', html: ICON.chevDown }));

    // Right side: Layout grid, Settings, Theme, Screenshot, Fullscreen, Trade button
    const layBtn = h('button', { class: 'tb-btn', title: `Panel grid (${lay.label})`, onclick: (e) => this.openLayoutDropdown(e.currentTarget) },
      h('span', { html: ICON[lay.icon] }),
      h('span', { class: 'tb-lay-num' }, String(lay.n)),
      h('span', { class: 'chev', html: ICON.chevDown }),
    );
    const curTh = THEMES[this.settings.theme] || THEMES.aurora;
    const themeBtn = h('button', {
      class: 'tb-btn tb-theme-pill',
      title: 'Switch Neon Glow Theme',
      onclick: (e) => this.openThemeDropdown(e.currentTarget),
    }, h('span', {}, curTh.badge));
    const setBtn = h('button', { class: 'tb-btn icon-only', title: 'Chart Settings', html: ICON.gear, onclick: () => this.openSettingsModal() });
    const snapBtn = h('button', { class: 'tb-btn icon-only', title: 'Download Chart Snapshot (PNG)', html: ICON.camera, onclick: () => this.takeScreenshot() });
    const fsBtn = h('button', { class: 'tb-btn icon-only', title: 'Fullscreen (F11)', html: ICON.fullscreen, onclick: () => this.toggleFullscreen() });
    const logoutBtn = h('button', { class: 'tb-btn icon-only', title: 'Log out', html: ICON.logout, onclick: async () => { try { await fetch('/api/logout'); } catch (e) { /* */ } location.href = '/login.html'; } });
    const savedBadge = h('span', { class: 'tb-saved', title: 'Drawings & layouts auto-save to this browser' }, '●');

    const tradeQuick = h('div', { class: 'tb-trade' },
      h('button', { class: 'btn-sell-sm', title: 'Quick Market Sell 1 Qty', onclick: () => this.quickTrade('sell') }, 'SELL'),
      h('button', { class: 'btn-buy-sm', title: 'Quick Market Buy 1 Qty', onclick: () => this.quickTrade('buy') }, 'BUY'),
    );

    const sep = () => h('div', { class: 'tb-sep' });
    this.topbar.append(
      symBtn, compareBtn, marketsBtn, sep(),
      h('div', { class: 'tb-group tb-ws' },
        h('span', { class: 'tb-ws-lbl', title: `Active: ${ws.name}` }, 'Layout'),
        wsPick,
      ), sep(),
      h('div', { class: 'tb-group' }, ...ivBtns, ivMore), sep(),
      ctBtn, nogapBtn, sep(),
      indBtn, tplBtn, sep(),
      alertBtn, replayBtn, sep(),
      undoBtn, redoBtn,
      h('div', { class: 'tb-spacer' }),
      savedBadge, sep(),
      tradeQuick, sep(),
      layBtn, setBtn, themeBtn, snapBtn, fsBtn, logoutBtn
    );
  }

  // ================================================================ Left Drawing Toolbar
  renderLeftbar() {
    this.leftbar.innerHTML = '';
    this.groupCurrentTool ||= {};

    for (const grp of TOOL_GROUPS) {
      const prefer = grp.id === 'projection' ? 'long' : grp.items[0];
      const curId = grp.items.includes(this.state.tool) ? this.state.tool : (this.groupCurrentTool[grp.id] || prefer);
      this.groupCurrentTool[grp.id] = curId;
      const isAct = this.state.tool === curId;
      const row = h('div', { class: 'lb-row' },
        h('button', {
          class: 'lb-btn' + (isAct ? ' active' : ''),
          title: toolName(curId) + ' — right-click to pin on chart ★ bar',
          html: ICON['t_' + curId] || ICON.pencil,
          onclick: () => this.setTool(curId),
          oncontextmenu: (e) => { e.preventDefault(); this.pinFavTool(curId); },
        }),
        grp.items.length > 1
          ? h('button', {
              class: 'lb-fly',
              title: 'More tools',
              html: ICON.chevRight,
              onclick: (e) => { e.stopPropagation(); this.openToolGroupFlyout(grp, row); },
            })
          : null
      );
      this.leftbar.append(row);
    }

    this.leftbar.append(h('div', { class: 'lb-sep' }));

    // Magnet, Stay in drawing mode, Lock, Hide, Clear
    this.leftbar.append(
      h('button', {
        class: 'lb-btn' + (this.state.magnet !== 'off' ? ' active' : ''),
        title: `Magnet Mode: ${this.state.magnet.toUpperCase()} (click to cycle Off / Weak / Strong)`,
        html: ICON.magnet,
        onclick: () => {
          this.state.magnet = this.state.magnet === 'off' ? 'weak' : this.state.magnet === 'weak' ? 'strong' : 'off';
          this.renderLeftbar();
          this.toast(`Magnet: ${this.state.magnet.toUpperCase()}`);
          this.saveSoon();
        },
      }),
      h('button', {
        class: 'lb-btn' + (this.state.stayDrawing ? ' active' : ''),
        title: 'Stay in Drawing Mode',
        html: ICON.pencil,
        onclick: () => { this.state.stayDrawing = !this.state.stayDrawing; this.renderLeftbar(); this.saveSoon(); },
      }),
      h('button', {
        class: 'lb-btn' + (this.state.drawingsLocked ? ' active' : ''),
        title: 'Lock All Drawings',
        html: this.state.drawingsLocked ? ICON.lock : ICON.unlock,
        onclick: () => { this.state.drawingsLocked = !this.state.drawingsLocked; this.renderLeftbar(); this.saveSoon(); },
      }),
      h('button', {
        class: 'lb-btn' + (this.state.drawingsHidden ? ' active' : ''),
        title: 'Hide All Drawings',
        html: this.state.drawingsHidden ? ICON.eyeOff : ICON.eye,
        onclick: () => { this.state.drawingsHidden = !this.state.drawingsHidden; this.renderLeftbar(); this.charts.forEach((c) => c.requestRender()); this.saveSoon(); },
      }),
      h('button', {
        class: 'lb-btn danger',
        title: 'Remove All Drawings on Active Symbol',
        html: ICON.trash,
        onclick: () => {
          if (!this.active) return;
          const sym = this.active.state.symbol;
          if (!this.drawingsFor(sym).length) return;
          const before = this.snapshot(sym);
          this.drawingsMap[sym] = [];
          this.active.selected = null;
          this.commitDrawings(sym, before);
          this.charts.forEach((c) => c.requestRender());
          if (this.state.rightTab === 'tree') this.renderRightPanel();
        },
      })
    );
  }

  openToolGroupFlyout(grp, anchorEl) {
    const r = anchorEl.getBoundingClientRect();
    const menu = h('div', { class: 'pop-menu', style: { left: r.right + 6 + 'px', top: Math.min(r.top, window.innerHeight - 320) + 'px' } },
      ...grp.items.map((id) =>
        h('div', {
          class: 'pop-item' + (this.state.tool === id ? ' active' : ''),
          onclick: () => { this.groupCurrentTool[grp.id] = id; this.setTool(id); this.closePop(); },
          oncontextmenu: (e) => { e.preventDefault(); this.pinFavTool(id); this.closePop(); },
        },
        h('span', { class: 'pop-ico', html: ICON['t_' + id] || ICON.pencil }),
        h('span', {}, toolName(id)),
        h('span', { class: 'pop-hint' }, '★ pin'))
      )
    );
    this.showPop(menu);
  }

  pinFavTool(id) {
    if (!id || ['cross', 'dot', 'arrow', 'eraser'].includes(id)) {
      this.toast('Pick a drawing tool to pin on the chart bar', 'warn');
      return;
    }
    if (this.favTools.includes(id)) { this.toast(`${toolName(id)} already on chart ★ bar`); return; }
    this.favTools = [...this.favTools, id].slice(0, 12);
    this.refreshChartFavBars();
    this.saveSoon();
    this.toast(`Pinned ${toolName(id)} on chart ★ bar`);
  }

  unpinFavTool(id) {
    this.favTools = this.favTools.filter((x) => x !== id);
    this.refreshChartFavBars();
    this.saveSoon();
  }

  refreshChartFavBars() {
    for (const c of this.charts) c.buildFavBar && c.buildFavBar();
  }

  setTool(t) {
    this.state.tool = t;
    if (this.active && this.active.creating) this.active.cancelCreate();
    this.renderLeftbar();
    this.refreshChartFavBars();
  }

  // ================================================================ Multi-Chart Layout Manager
  applyLayout(layoutId, savedCharts = null) {
    const lay = LAYOUTS.find((x) => x.id === layoutId) || LAYOUTS[0];
    this.state.layout = lay.id;
    const prevStates = savedCharts || this.charts.map((c) => c.serialize());
    for (const c of this.charts) c.destroy();
    this.charts = [];
    this.gridEl.innerHTML = '';
    this.gridEl.className = `chart-grid ${lay.cls}`;

    for (let i = 0; i < lay.n; i++) {
      const st = prevStates[i] || DEFAULT_PRESET_CHARTS[i % DEFAULT_PRESET_CHARTS.length];
      const chart = new Chart(this, this.gridEl, st);
      chart.on('change', () => { if (this.active === chart) { this.renderTopbar(); this.renderRightPanel(); } });
      chart.on('indicators', () => { if (this.state.rightTab === 'tree') this.renderRightPanel(); });
      chart.on('replay', () => this.renderReplayBar());
      this.charts.push(chart);
    }
    this.setActive(this.charts[0]);
    this.refreshChartFavBars();
    this.updateQuoteSubscriptions();
    this.saveSoon();
  }

  setActive(chart) {
    if (this.active === chart) return;
    this.active = chart;
    for (const c of this.charts) c.root.classList.toggle('active-cell', c === chart);
    this.renderTopbar();
    this.renderReplayBar();
    this.renderRightPanel();
    if (this.state.bottomTab === 'trading') this.renderBottomPanel();
  }

  setSymbolOnActive(symId) {
    if (!this.active) return;
    if (this.state.syncSymbol) {
      for (const c of this.charts) c.setSymbol(symId);
    } else {
      this.active.setSymbol(symId);
    }
    this.updateQuoteSubscriptions();
    this.renderTopbar();
    this.renderRightPanel();
    if (this.state.bottomTab === 'trading') this.renderBottomPanel();
  }

  setIntervalOnActive(iv) {
    if (!this.active) return;
    if (this.state.syncInterval) {
      for (const c of this.charts) c.setInterval(iv);
    } else {
      this.active.setInterval(iv);
    }
    this.renderTopbar();
  }

  syncCrosshair(srcChart, t) {
    if (!this.state.syncCrosshair || this.charts.length < 2) return;
    for (const c of this.charts) {
      if (c === srcChart) continue;
      c.syncT = t;
      c.requestRender();
    }
  }

  syncTime(srcChart) {
    if (!this.state.syncTime || this.charts.length < 2) return;
    const centerT = srcChart.idxToTime(srcChart.x2i(srcChart.plotW / 2));
    for (const c of this.charts) {
      if (c === srcChart) continue;
      c.goToTime(centerT);
    }
  }

  onChartLoaded(chart) {
    if (chart === this.active) {
      this.renderTopbar();
      if (this.state.rightTab === 'watchlist') this.updateDetailsPane();
    }
  }

  onPrice(symId, price, bar) {
    this.trading.onTick(symId, price);
    this.alertsMgr.check(symId, price);
    void bar;
  }

  onReplayBar(chart, bar) {
    this.trading.onTick(chart.state.symbol, bar.c);
  }

  // ================================================================ Drawings Store & Undo/Redo
  drawingsFor(sym) { return (this.drawingsMap[sym] ||= []); }
  snapshot(sym) { return JSON.stringify(this.drawingsFor(sym)); }
  addDrawing(sym, d, beforeSnap) {
    const arr = this.drawingsFor(sym);
    arr.push(d);
    this.commitDrawings(sym, beforeSnap);
  }
  cloneDrawing(chart, d) {
    if (!d) return;
    const sym = chart.state.symbol;
    const before = this.snapshot(sym);
    const copy = JSON.parse(JSON.stringify(d));
    copy.id = uid();
    copy.locked = false;
    // offset the clone slightly so it is visible next to the original
    const bars = chart.bars || [];
    const dt = bars.length > 1 ? (bars[bars.length - 1].t - bars[bars.length - 2].t) : 60000;
    const ref = (copy.pts || []).find((p) => p.p != null)?.p || 0;
    (copy.pts || []).forEach((p) => {
      if (p.t != null) p.t += dt * 5;
      if (p.p != null) p.p -= Math.abs(ref) * 0.002;
    });
    this.drawingsFor(sym).push(copy);
    this.commitDrawings(sym, before);
    chart.selected = copy;
    this.onSelectDrawing(chart, copy);
    chart.requestRender();
    this.toast(`${toolName(copy.type)} cloned`);
  }
  removeDrawing(sym, d) {
    const before = this.snapshot(sym);
    this.drawingsMap[sym] = this.drawingsFor(sym).filter((x) => x !== d && x.id !== d.id);
    this.commitDrawings(sym, before);
    this.charts.forEach((c) => { if (c.selected === d) c.selected = null; c.requestRender(); });
  }
  commitDrawings(sym, beforeSnap) {
    if (beforeSnap != null) {
      (this.undoStack[sym] ||= []).push(beforeSnap);
      this.redoStack[sym] = [];
    }
    this.saveSoon();
    this.charts.forEach((c) => { if (c.state.symbol === sym) c.requestRender(); });
    if (this.state.rightTab === 'tree') this.renderRightPanel();
  }
  undoDrawing() {
    if (!this.active) return;
    const sym = this.active.state.symbol;
    const st = this.undoStack[sym];
    if (!st || !st.length) return;
    (this.redoStack[sym] ||= []).push(this.snapshot(sym));
    this.drawingsMap[sym] = JSON.parse(st.pop());
    this.active.selected = null;
    this.saveSoon();
    this.charts.forEach((c) => c.requestRender());
    if (this.state.rightTab === 'tree') this.renderRightPanel();
  }
  redoDrawing() {
    if (!this.active) return;
    const sym = this.active.state.symbol;
    const st = this.redoStack[sym];
    if (!st || !st.length) return;
    (this.undoStack[sym] ||= []).push(this.snapshot(sym));
    this.drawingsMap[sym] = JSON.parse(st.pop());
    this.active.selected = null;
    this.saveSoon();
    this.charts.forEach((c) => c.requestRender());
    if (this.state.rightTab === 'tree') this.renderRightPanel();
  }
  toolStyle(type) { return this.toolStyles[type]; }
  onSelectDrawing(chart, d) {
    if (this.state.rightTab === 'tree') this.renderRightPanel();
    void chart; void d;
  }

  buildSelectionToolbar(chart, d, el) {
    el.innerHTML = '';
    const COLORS = ['#2962ff', '#089981', '#f23645', '#ff9800', '#9c27b0', '#00bcd4', '#fbc02d', '#e91e63', '#d1d4dc'];
    const colorInput = h('input', {
      type: 'color', value: (d.style.color || '#2962ff').slice(0, 7), title: 'Color',
      oninput: (e) => {
        d.style.color = e.target.value;
        (this.toolStyles[d.type] ||= {}).color = e.target.value;
        chart.requestRender();
        this.saveSoon();
      },
    });
    const swatches = COLORS.map((c) => h('span', {
      class: 'swatch', style: { background: c },
      onclick: () => { d.style.color = c; colorInput.value = c; chart.requestRender(); this.saveSoon(); },
    }));
    const widthSel = h('select', {
      title: 'Line Width',
      onchange: (e) => { d.style.width = +e.target.value; chart.requestRender(); this.saveSoon(); },
    }, ...[1, 2, 3, 4].map((w) => h('option', { value: w, selected: (d.style.width || 2) === w }, `${w}px`)));

    const dashSel = h('select', {
      title: 'Line Style',
      onchange: (e) => { d.style.dash = e.target.value; chart.requestRender(); this.saveSoon(); },
    }, ...['solid', 'dashed', 'dotted'].map((ds) => h('option', { value: ds, selected: (d.style.dash || 'solid') === ds }, ds)));

    el.append(
      h('span', { class: 'sel-title' }, toolName(d.type)),
      colorInput, ...swatches, widthSel, dashSel,
      h('button', { title: 'Settings / Text', html: ICON.gear, onclick: () => this.openDrawingProps(chart, d) }),
      h('button', {
        title: d.locked ? 'Unlock' : 'Lock',
        html: d.locked ? ICON.lock : ICON.unlock,
        onclick: () => { d.locked = !d.locked; chart.updateSelToolbar(); this.saveSoon(); },
      }),
      h('button', { title: 'Clone (Ctrl+D)', html: ICON.copy, onclick: () => this.cloneDrawing(chart, d) }),
      h('button', { title: 'Delete (Del)', class: 'danger', html: ICON.trash, onclick: () => this.removeDrawing(chart.state.symbol, d) }),
    );
  }

  // ================================================================ Bar Replay Toolbar
  toggleReplay() {
    if (!this.active) return;
    if (this.active.replay) this.active.replayStop();
    else this.active.replayStart();
    this.renderTopbar();
    this.renderReplayBar();
  }
  renderReplayBar() {
    const c = this.active;
    if (!c || !c.replay) { this.replayBar.classList.add('hidden'); return; }
    this.replayBar.classList.remove('hidden');
    const r = c.replay;
    this.replayBar.innerHTML = '';
    if (r.selecting) {
      this.replayBar.append(
        h('span', { class: 'rp-msg' }, '✂️ Click anywhere on the chart to choose the Replay starting bar'),
        h('button', { class: 'tb-btn', onclick: () => c.replaySelect(Math.max(10, c.bars.length - 100)) }, 'Jump 100 bars back'),
        h('button', { class: 'tb-btn danger', html: ICON.close, onclick: () => { c.replayStop(); this.renderTopbar(); } })
      );
      return;
    }
    const bar = c.bars[r.idx];
    this.replayBar.append(
      h('button', { class: 'tb-btn', title: 'Reselect cut point', onclick: () => c.replayStart() }, 'Cut bar'),
      h('button', { class: 'tb-btn icon-only', title: 'Step Back', html: ICON.stepBack, onclick: () => c.replayStepBack() }),
      h('button', {
        class: 'tb-btn primary', title: r.playing ? 'Pause' : 'Play',
        html: r.playing ? ICON.pause : ICON.play,
        onclick: () => (r.playing ? c.replayPause() : c.replayPlay()),
      }),
      h('button', { class: 'tb-btn icon-only', title: 'Step Forward 1 Bar', html: ICON.stepFwd, onclick: () => c.replayStep(1) }),
      h('select', {
        class: 'rp-speed',
        onchange: (e) => c.replaySpeed(+e.target.value),
      }, ...[0.5, 1, 2, 5, 10].map((sp) => h('option', { value: sp, selected: r.speed === sp }, `${sp}x speed`))),
      h('span', { class: 'rp-info' }, bar ? `${fmtDateShort(bar.t)}  ·  Bar ${r.idx + 1}/${c.bars.length}` : ''),
      h('button', { class: 'tb-btn danger', onclick: () => { c.replayStop(); this.renderTopbar(); } }, 'Exit Replay')
    );
  }

  // ================================================================ Right Sidebar & Rail
  renderRightRail() {
    const items = [
      { id: 'watchlist', title: 'Watchlist & Symbol Details', icon: ICON.watchlist },
      { id: 'alerts', title: 'Price Alerts & Alert Log', icon: ICON.alert },
      { id: 'tree', title: 'Object Tree (Indicators & Drawings)', icon: ICON.tree },
      { id: 'calc', title: 'India Gold / BTC / INR Calculator', icon: ICON.calc },
      { id: 'help', title: 'Keyboard Shortcuts & Guide', icon: ICON.help, modal: true },
    ];
    this.rightRail.innerHTML = '';
    for (const it of items) {
      this.rightRail.append(
        h('button', {
          class: 'rr-btn' + (this.state.rightTab === it.id ? ' active' : ''),
          title: it.title,
          html: it.icon,
          onclick: () => {
            if (it.modal) { this.openShortcutsModal(); return; }
            this.state.rightTab = this.state.rightTab === it.id ? null : it.id;
            this.renderRightRail();
            this.renderRightPanel();
            this.saveSoon();
          },
        })
      );
    }
  }

  renderRightPanel() {
    const tab = this.state.rightTab;
    this.rightPanel.classList.toggle('collapsed', !tab);
    this.rightPanel.innerHTML = '';
    if (!tab) return;
    if (tab === 'watchlist') this.renderWatchlistTab();
    else if (tab === 'alerts') this.renderAlertsTab();
    else if (tab === 'tree') this.renderObjectTreeTab();
    else if (tab === 'calc') this.renderCalcTab();
  }

  updateQuoteSubscriptions() {
    const wlSyms = this.watchlist.filter((x) => typeof x === 'string');
    const chartSyms = this.charts.map((c) => c.state.symbol);
    const posSyms = this.trading.positions.map((p) => p.symbol);
    const alertSyms = this.alertsMgr.alerts.filter((a) => a.active).map((a) => a.symbol);
    const calcSyms = ['FX:USDINR', 'COMEX:GC1!', 'COMEX:SI1!', 'BINANCE:BTCUSDT', 'INR:GOLD10G', 'INR:SILVER1KG'];
    quotes.setInterest('main', [...new Set([...wlSyms, ...chartSyms, ...posSyms, ...alertSyms, ...calcSyms])]);
  }

  renderWatchlistTab() {
    const head = h('div', { class: 'rp-header' },
      h('span', { class: 'rp-title' }, 'Watchlist'),
      h('div', { class: 'rp-actions' },
        h('button', { class: 'icon-btn', title: 'Add Symbol to Watchlist', html: ICON.plusSm, onclick: () => this.openSymbolSearch(null, (id) => this.addToWatchlist(id)) }),
      )
    );
    const cols = h('div', { class: 'wl-cols' },
      h('span', {}, 'Symbol'),
      h('span', { class: 'r' }, 'Last'),
      h('span', { class: 'r' }, 'Chg'),
      h('span', { class: 'r' }, 'Chg%'),
    );
    this.wlList = h('div', { class: 'wl-list' });
    this.wlRowMap = new Map();

    for (const item of this.watchlist) {
      if (item && item.section) {
        this.wlList.append(h('div', { class: 'wl-sec' }, item.section));
        continue;
      }
      const id = item;
      const sym = getSymbol(id);
      const isAct = this.active && this.active.state.symbol === id;
      const lastEl = h('span', { class: 'wl-last r' }, '—');
      const chgEl = h('span', { class: 'wl-chg r' }, '—');
      const pctEl = h('span', { class: 'wl-pct r' }, '—');
      const row = h('div', {
        class: 'wl-row' + (isAct ? ' active' : ''),
        onclick: () => this.setSymbolOnActive(id),
      },
      h('div', { class: 'wl-sym' },
        h('span', { class: 'wl-dot ' + sym.type }),
        h('div', { class: 'wl-names' },
          h('span', { class: 'wl-t' }, shortName(id)),
          h('span', { class: 'wl-n' }, sym.name),
        ),
      ),
      lastEl, chgEl, pctEl,
      h('button', {
        class: 'wl-del', title: 'Remove', html: ICON.close,
        onclick: (e) => { e.stopPropagation(); this.watchlist = this.watchlist.filter((x) => x !== id); this.renderRightPanel(); this.saveSoon(); },
      }));
      this.wlRowMap.set(id, { row, lastEl, chgEl, pctEl });
      this.wlList.append(row);
      const q = quotes.get(id);
      if (q) this.paintWlRow(id, q);
    }

    this.detailsBox = h('div', { class: 'sym-details' });
    this.rightPanel.append(head, cols, this.wlList, this.detailsBox);
    this.updateDetailsPane();
    this.updateQuoteSubscriptions();
  }

  addToWatchlist(id) {
    if (!this.watchlist.includes(id)) {
      this.watchlist.push(id);
      this.saveSoon();
      this.updateQuoteSubscriptions();
      if (this.state.rightTab === 'watchlist') this.renderRightPanel();
      this.toast(`Added ${shortName(id)} to Watchlist`);
    }
  }

  paintWlRow(id, q, prev) {
    const r = this.wlRowMap && this.wlRowMap.get(id);
    if (!r || !q || q.price == null) return;
    const cls = signCls(q.change);
    r.lastEl.textContent = fmtPrice(q.price);
    r.chgEl.textContent = (q.change >= 0 ? '+' : '') + fmtPrice(q.change);
    r.chgEl.className = 'wl-chg r ' + cls;
    r.pctEl.textContent = fmtPct(q.changePct);
    r.pctEl.className = 'wl-pct r ' + cls;
    if (prev && prev.price != null && prev.price !== q.price) {
      const flash = q.price > prev.price ? 'flash-up' : 'flash-down';
      r.row.classList.remove('flash-up', 'flash-down');
      void r.row.offsetWidth;
      r.row.classList.add(flash);
    }
  }

  onQuoteUpdate(id, q, prev) {
    this.paintWlRow(id, q, prev);
    if (this.active && this.active.state.symbol === id && this.detailsBox) this.updateDetailsPane();
    if (this.state.rightTab === 'calc') this.updateCalcLive();
  }

  updateDetailsPane() {
    if (!this.detailsBox || !this.active) return;
    const id = this.active.state.symbol;
    const sym = getSymbol(id);
    const q = quotes.get(id) || {};
    const bars = this.active.bars;
    const lastBar = bars[bars.length - 1];
    const price = q.price ?? lastBar?.c ?? sym.approx;
    const prev = q.prevClose ?? bars[bars.length - 2]?.c ?? price;
    const chg = q.change ?? (price - prev);
    const pct = q.changePct ?? (prev ? (chg / prev) * 100 : 0);
    const lo = q.low ?? lastBar?.l ?? price;
    const hi = q.high ?? lastBar?.h ?? price;
    const lo52 = q.low52 ?? (bars.length ? Math.min(...bars.slice(-252).map((b) => b.l)) : lo * 0.85);
    const hi52 = q.high52 ?? (bars.length ? Math.max(...bars.slice(-252).map((b) => b.h)) : hi * 1.15);
    const dayPos = hi > lo ? clamp(((price - lo) / (hi - lo)) * 100, 0, 100) : 50;
    const yrPos = hi52 > lo52 ? clamp(((price - lo52) / (hi52 - lo52)) * 100, 0, 100) : 50;
    const cls = signCls(chg);

    // Performance returns from loaded bars
    const perf = (days) => {
      if (bars.length < 2) return null;
      const targetT = bars[bars.length - 1].t - days * 86400e3;
      let b = bars[0];
      for (let i = bars.length - 1; i >= 0; i--) { if (bars[i].t <= targetT) { b = bars[i]; break; } }
      return ((price - b.c) / b.c) * 100;
    };
    const p1W = perf(7), p1M = perf(30), p3M = perf(90), p6M = perf(180), p1Y = perf(365);

    this.detailsBox.innerHTML = `
      <div class="sd-top">
        <div class="sd-sym">${shortName(id)} <span class="sd-badge">${sym.ex}</span> <span class="sd-badge">${sym.type.toUpperCase()}</span></div>
        <div class="sd-name">${sym.name}</div>
        <div class="sd-price-row">
          <span class="sd-price">${sym.cur || ''}${fmtPrice(price)}</span>
          <span class="sd-chg ${cls}">${chg >= 0 ? '+' : ''}${fmtPrice(chg)} (${fmtPct(pct)})</span>
        </div>
      </div>
      <div class="sd-range">
        <div class="sd-range-lbl"><span>Day's Low: ${fmtPrice(lo)}</span><span>Day's High: ${fmtPrice(hi)}</span></div>
        <div class="sd-bar"><div class="sd-bar-fill" style="width:${dayPos}%"></div><span class="sd-bar-dot" style="left:${dayPos}%"></span></div>
      </div>
      <div class="sd-range">
        <div class="sd-range-lbl"><span>52W Low: ${fmtPrice(lo52)}</span><span>52W High: ${fmtPrice(hi52)}</span></div>
        <div class="sd-bar"><div class="sd-bar-fill" style="width:${yrPos}%"></div><span class="sd-bar-dot" style="left:${yrPos}%"></span></div>
      </div>
      <div class="sd-grid">
        <div><span>Open</span><b>${fmtPrice(q.open ?? lastBar?.o)}</b></div>
        <div><span>Prev Close</span><b>${fmtPrice(prev)}</b></div>
        <div><span>Volume</span><b>${fmtVol(q.volume ?? lastBar?.v)}</b></div>
        <div><span>Sector</span><b>${sym.sector || sym.type}</b></div>
      </div>
      <div class="sd-perf">
        ${[['1W', p1W], ['1M', p1M], ['3M', p3M], ['6M', p6M], ['1Y', p1Y]].map(([lbl, v]) => `
          <div class="sd-pbox ${signCls(v)}"><span>${lbl}</span><b>${fmtPct(v)}</b></div>
        `).join('')}
      </div>
    `;
  }

  renderAlertsTab() {
    const head = h('div', { class: 'rp-header' },
      h('span', { class: 'rp-title' }, 'Price Alerts'),
      h('button', { class: 'tb-btn primary', onclick: () => this.openAlertModal() }, '+ New Alert')
    );
    const list = h('div', { class: 'rp-body' });
    if (!this.alertsMgr.alerts.length) {
      list.append(h('div', { class: 'empty-hint' }, 'No price alerts yet. Click "+ New Alert" or right-click on any chart level to set an alert.'));
    } else {
      for (const a of this.alertsMgr.alerts) {
        list.append(h('div', { class: 'al-card' + (a.active ? '' : ' off') },
          h('div', { class: 'al-top' },
            h('b', { class: 'link', onclick: () => this.setSymbolOnActive(a.symbol) }, shortName(a.symbol)),
            h('span', { class: 'al-cond' }, `${a.condition.replace('_', ' ')} ${fmtPrice(a.price)}`),
            h('span', { class: 'al-status ' + (a.active ? 'live' : 'done') }, a.active ? 'Active' : 'Triggered'),
          ),
          a.note ? h('div', { class: 'al-note' }, a.note) : null,
          h('div', { class: 'al-actions' },
            h('button', { class: 'tb-btn', onclick: () => this.alertsMgr.toggle(a.id) }, a.active ? 'Pause' : 'Reactivate'),
            h('button', { class: 'tb-btn danger', onclick: () => this.alertsMgr.remove(a.id) }, 'Delete'),
          )
        ));
      }
    }
    if (this.alertsMgr.logs.length) {
      list.append(h('div', { class: 'wl-sec' }, 'Triggered Log'));
      for (const l of this.alertsMgr.logs.slice(0, 20)) {
        list.append(h('div', { class: 'al-log' },
          h('b', {}, `${shortName(l.symbol)} @ ${fmtPrice(l.triggerPrice)}`),
          h('span', {}, fmtDateShort(l.time))
        ));
      }
    }
    this.rightPanel.append(head, list);
  }

  renderObjectTreeTab() {
    const c = this.active;
    const head = h('div', { class: 'rp-header' }, h('span', { class: 'rp-title' }, 'Object Tree'));
    const body = h('div', { class: 'rp-body' });
    if (!c) { this.rightPanel.append(head, body); return; }

    body.append(h('div', { class: 'wl-sec' }, `Indicators (${c.indicators.length})`));
    for (const ind of c.indicators) {
      body.append(h('div', { class: 'tree-row' },
        h('span', { class: 'tree-lbl' }, indicatorLabel(ind)),
        h('div', { class: 'tree-btns' },
          h('button', { html: ind.visible === false ? ICON.eyeOff : ICON.eye, onclick: () => { ind.visible = ind.visible === false; c.updateIndicator(ind); this.renderObjectTreeTab(); } }),
          h('button', { html: ICON.gear, onclick: () => this.openIndicatorSettings(c, ind) }),
          h('button', { html: ICON.trash, onclick: () => { c.removeIndicator(ind.uid); this.renderObjectTreeTab(); } }),
        )
      ));
    }

    const drs = c.drawings;
    body.append(h('div', { class: 'wl-sec' }, `Drawings on ${shortName(c.state.symbol)} (${drs.length})`));
    if (!drs.length) body.append(h('div', { class: 'empty-hint' }, 'No drawings on this symbol. Pick a tool from the left toolbar.'));
    for (const d of drs) {
      body.append(h('div', {
        class: 'tree-row' + (c.selected === d ? ' active' : ''),
        onclick: () => { c.selected = d; c.requestRender(); this.renderObjectTreeTab(); },
      },
      h('span', { class: 'swatch', style: { background: d.style.color || '#2962ff' } }),
      h('span', { class: 'tree-lbl' }, toolName(d.type) + (d.style.text ? ` (${d.style.text})` : '')),
      h('div', { class: 'tree-btns', onclick: (e) => e.stopPropagation() },
        h('button', { html: d.hidden ? ICON.eyeOff : ICON.eye, onclick: () => { d.hidden = !d.hidden; c.requestRender(); this.renderObjectTreeTab(); this.saveSoon(); } }),
        h('button', { html: d.locked ? ICON.lock : ICON.unlock, onclick: () => { d.locked = !d.locked; c.requestRender(); this.renderObjectTreeTab(); this.saveSoon(); } }),
        h('button', { html: ICON.trash, onclick: () => { this.removeDrawing(c.state.symbol, d); this.renderObjectTreeTab(); } }),
      )));
    }
    this.rightPanel.append(head, body);
  }

  renderCalcTab() {
    const head = h('div', { class: 'rp-header' }, h('span', { class: 'rp-title' }, 'India Gold / BTC / FX Hub'));
    this.calcBody = h('div', { class: 'rp-body calc-body' });
    this.calcState ||= { grams: 10, purity: 24, dutyPct: 6, gstPct: 3, btcQty: 0.1 };
    this.rightPanel.append(head, this.calcBody);
    this.updateCalcLive();
  }

  updateCalcLive() {
    if (!this.calcBody) return;
    const r = getIndiaConversionRates();
    const st = this.calcState;
    const parityPerGram = (r.gold24k10g / 10) * (st.purity / 24);
    const landedPerGram = parityPerGram * (1 + st.dutyPct / 100) * (1 + st.gstPct / 100);
    const totalGoldInr = landedPerGram * st.grams;

    if (!this.calcBody.children.length) {
      this.calcBody.innerHTML = `
        <div class="calc-card">
          <div class="calc-h">Live Bullion & Crypto Parity (INR)</div>
          <div class="calc-kv" id="calc-live-kv"></div>
        </div>
        <div class="calc-card">
          <div class="calc-h">Indian Gold Jewellery / Bullion Calculator</div>
          <label class="calc-row"><span>Weight (grams)</span><input type="number" id="cg-grams" value="${st.grams}" min="0.1" step="1"></label>
          <label class="calc-row"><span>Purity</span>
            <select id="cg-purity">
              <option value="24" ${st.purity === 24 ? 'selected' : ''}>24K (99.9% Pure)</option>
              <option value="22" ${st.purity === 22 ? 'selected' : ''}>22K (91.6% Hallmark)</option>
              <option value="18" ${st.purity === 18 ? 'selected' : ''}>18K (75.0%)</option>
            </select>
          </label>
          <label class="calc-row"><span>Import Duty / MCX Prem %</span><input type="number" id="cg-duty" value="${st.dutyPct}" step="0.5"></label>
          <label class="calc-row"><span>GST %</span><input type="number" id="cg-gst" value="${st.gstPct}" step="0.5"></label>
          <div class="calc-res" id="cg-res"></div>
        </div>
        <div class="calc-card">
          <div class="calc-h">Bitcoin (BTC ↔ USD ↔ INR)</div>
          <label class="calc-row"><span>BTC Amount</span><input type="number" id="cb-qty" value="${st.btcQty}" step="0.01"></label>
          <div class="calc-res" id="cb-res"></div>
        </div>
      `;
      const bind = (sel, key) => {
        const el = $(sel, this.calcBody);
        el.addEventListener('input', () => { st[key] = +el.value || 0; this.updateCalcLive(); });
      };
      bind('#cg-grams', 'grams'); bind('#cg-purity', 'purity'); bind('#cg-duty', 'dutyPct'); bind('#cg-gst', 'gstPct'); bind('#cb-qty', 'btcQty');
    }

    $('#calc-live-kv', this.calcBody).innerHTML = `
      <div><span>USD / INR</span><b>₹${fmtPrice(r.usdInr, 2)}</b></div>
      <div><span>COMEX Gold (1 oz)</span><b>$${fmtPrice(r.goldOzUsd, 2)}</b></div>
      <div><span>24K Gold / 10g (Parity)</span><b>₹${fmtPrice(r.gold24k10g, 0)}</b></div>
      <div><span>22K Gold / 10g (Parity)</span><b>₹${fmtPrice(r.gold22k10g, 0)}</b></div>
      <div><span>Silver / 1 kg (Parity)</span><b>₹${fmtPrice(r.silver1kgInr, 0)}</b></div>
      <div><span>BTC / INR</span><b>₹${fmtPrice(r.btcInr, 0)}</b></div>
    `;
    $('#cg-res', this.calcBody).innerHTML = `
      <div><span>Intl. Parity (${st.grams}g ${st.purity}K):</span><b>₹${fmtPrice(parityPerGram * st.grams, 0)}</b></div>
      <div><span>Est. Retail in India (incl. Duty & GST):</span><b class="up">₹${fmtPrice(totalGoldInr, 0)}</b></div>
    `;
    $('#cb-res', this.calcBody).innerHTML = `
      <div><span>Value in USDT:</span><b>$${fmtPrice(st.btcQty * r.btcUsd, 2)}</b></div>
      <div><span>Value in INR:</span><b class="up">₹${fmtPrice(st.btcQty * r.btcInr, 0)} (${fmtINRShort(st.btcQty * r.btcInr)})</b></div>
    `;
  }

  // ================================================================ Bottom Status Bar & Dock
  renderBottomBar() {
    this.bottomBar.innerHTML = '';
    const ranges = [
      { lbl: '1D', iv: '5m', bars: 78 },
      { lbl: '5D', iv: '15m', bars: 130 },
      { lbl: '1M', iv: '1h', bars: 180 },
      { lbl: '3M', iv: '1D', bars: 65 },
      { lbl: '6M', iv: '1D', bars: 130 },
      { lbl: '1Y', iv: '1D', bars: 252 },
      { lbl: '5Y', iv: '1W', bars: 260 },
      { lbl: 'All', iv: '1M', bars: 300 },
    ];
    const rangeGroup = h('div', { class: 'bb-ranges' },
      ...ranges.map((r) => h('button', {
        class: 'bb-btn',
        title: `Switch to ${r.lbl} view`,
        onclick: () => this.applyQuickRange(r),
      }, r.lbl))
    );

    const tabs = [
      { id: 'trading', label: 'Paper Trading' },
      { id: 'screener', label: 'Stock / Crypto Screener' },
      { id: 'pine', label: 'Pine Script Editor' },
    ];
    const tabGroup = h('div', { class: 'bb-tabs' },
      ...tabs.map((t) => h('button', {
        class: 'bb-tab' + (this.state.bottomTab === t.id ? ' active' : ''),
        onclick: () => {
          this.state.bottomTab = this.state.bottomTab === t.id ? null : t.id;
          this.renderBottomBar();
          this.renderBottomPanel();
          this.saveSoon();
        },
      }, t.label))
    );

    this.nseBadge = h('span', { class: 'bb-market' });
    this.clockEl = h('button', { class: 'bb-btn bb-clock', title: 'Change Timezone', onclick: (e) => this.openTimezoneMenu(e.currentTarget) });
    const logBtn = h('button', {
      class: 'bb-btn' + (this.active?.state.logScale ? ' active' : ''),
      title: 'Toggle Logarithmic Price Scale (Alt+L)',
      onclick: () => { if (this.active) { this.active.toggleLog(); this.renderBottomBar(); } },
    }, 'log');
    const autoBtn = h('button', {
      class: 'bb-btn active',
      title: 'Reset / Auto Fit Scale (Alt+R)',
      onclick: () => { if (this.active) this.active.resetView(); },
    }, 'auto');

    this.bottomBar.append(rangeGroup, h('div', { class: 'bb-sep' }), tabGroup, h('div', { class: 'tb-spacer' }), this.nseBadge, this.clockEl, logBtn, autoBtn);
    this.updateClock();
  }

  async applyQuickRange(r) {
    const c = this.active;
    if (!c) return;
    if (c.state.interval !== r.iv) {
      c.state.interval = r.iv;
      this.renderTopbar();
      await c.load();
    }
    const n = c.data.length;
    if (!n) return;
    c.view.spacing = clamp(c.plotW / Math.min(n, r.bars), 1, 40);
    c.view.right = n - 1 + this.settings.rightMargin;
    c.scales.main = { auto: true };
    c.requestRender();
  }

  startClocks() {
    setInterval(() => this.updateClock(), 1000);
  }
  updateClock() {
    if (!this.clockEl) return;
    const now = Date.now();
    const tz = getTimezone();
    const tzShort = tz === 'Asia/Kolkata' ? 'IST (UTC+5:30)' : tz;
    this.clockEl.textContent = `${fmtClock(now)} ${tzShort}`;
    const st = nseStatus(now);
    this.nseBadge.innerHTML = `<span class="mkt-dot ${st.open ? 'open' : st.pre ? 'pre' : 'closed'}"></span> NSE ${st.label}`;
  }

  openTimezoneMenu(btn) {
    const r = btn.getBoundingClientRect();
    const menu = h('div', { class: 'pop-menu', style: { right: window.innerWidth - r.right + 'px', bottom: window.innerHeight - r.top + 6 + 'px' } },
      ...TIMEZONES.map((z) => h('div', {
        class: 'pop-item' + (getTimezone() === z.id ? ' active' : ''),
        onclick: () => {
          this.settings.timezone = z.id;
          setTimezone(z.id);
          this.updateClock();
          this.charts.forEach((c) => c.requestRender());
          this.saveSoon();
          this.closePop();
        },
      }, z.label))
    );
    this.showPop(menu);
  }

  // ================================================================ Bottom Panel (Paper Trading / Screener / Pine Editor)
  renderBottomPanel() {
    const tab = this.state.bottomTab;
    this.bottomPanel.classList.toggle('hidden', !tab);
    this.bottomPanel.innerHTML = '';
    if (!tab) return;
    if (tab === 'trading') this.renderTradingDock();
    else if (tab === 'screener') this.renderScreenerDock();
    else if (tab === 'pine') this.renderPineDock();
  }

  renderTradingDock() {
    const c = this.active;
    const symId = c ? c.state.symbol : 'NSE:NIFTY';
    const sym = getSymbol(symId);
    const curPrice = quotes.get(symId)?.price || c?.bars[c.bars.length - 1]?.c || sym.approx || 100;
    const sum = this.trading.summary();
    this.trSubTab ||= 'positions';

    const header = h('div', { class: 'bp-header' },
      h('div', { class: 'bp-tabs' },
        h('button', { class: 'bp-sub' + (this.trSubTab === 'positions' ? ' active' : ''), onclick: () => { this.trSubTab = 'positions'; this.renderBottomPanel(); } }, `Positions (${this.trading.positions.length})`),
        h('button', { class: 'bp-sub' + (this.trSubTab === 'orders' ? ' active' : ''), onclick: () => { this.trSubTab = 'orders'; this.renderBottomPanel(); } }, `Working Orders (${this.trading.orders.filter((o) => o.status === 'working').length})`),
        h('button', { class: 'bp-sub' + (this.trSubTab === 'history' ? ' active' : ''), onclick: () => { this.trSubTab = 'history'; this.renderBottomPanel(); } }, `Trade History (${this.trading.history.length})`),
      ),
      h('div', { class: 'bp-metrics', id: 'tr-metrics' },
        h('span', {}, 'Balance: ', h('b', {}, `₹${fmtPrice(sum.balance, 2)}`)),
        h('span', {}, 'Open P&L: ', h('b', { class: signCls(sum.openPnl) }, `${sum.openPnl >= 0 ? '+' : ''}₹${fmtPrice(sum.openPnl, 2)}`)),
        h('span', {}, 'Account Equity: ', h('b', {}, `₹${fmtPrice(sum.equity, 2)}`)),
      ),
      h('div', { class: 'bp-actions' },
        h('button', { class: 'tb-btn', onclick: () => { this.trading.reset(1000000); this.toast('Paper account reset to ₹10,00,000'); } }, 'Reset ₹10L'),
        h('button', { class: 'icon-btn', html: ICON.close, onclick: () => { this.state.bottomTab = null; this.renderBottomBar(); this.renderBottomPanel(); } }),
      )
    );

    // Order ticket + Table split
    const ticket = h('div', { class: 'tr-ticket' });
    this.orderForm ||= { type: 'market', qty: 10, price: curPrice, tp: '', sl: '' };
    const f = this.orderForm;
    ticket.innerHTML = `
      <div class="tk-title">Order Ticket · <b>${shortName(symId)}</b> <span class="tk-px">${sym.cur}${fmtPrice(curPrice)}</span></div>
      <div class="tk-row">
        <label>Type
          <select id="tk-type">
            <option value="market" ${f.type === 'market' ? 'selected' : ''}>Market</option>
            <option value="limit" ${f.type === 'limit' ? 'selected' : ''}>Limit</option>
            <option value="stop" ${f.type === 'stop' ? 'selected' : ''}>Stop</option>
          </select>
        </label>
        <label>Quantity <input type="number" id="tk-qty" min="1" value="${f.qty}"></label>
        <label id="tk-price-wrap" style="${f.type === 'market' ? 'opacity:0.45' : ''}">Price <input type="number" id="tk-price" step="any" value="${fmtPrice(curPrice).replace(/,/g, '')}" ${f.type === 'market' ? 'disabled' : ''}></label>
        <label>Take Profit <input type="number" id="tk-tp" step="any" placeholder="Optional" value="${f.tp}"></label>
        <label>Stop Loss <input type="number" id="tk-sl" step="any" placeholder="Optional" value="${f.sl}"></label>
      </div>
      <div class="tk-btns">
        <button class="btn-buy" id="tk-buy">BUY / LONG ${shortName(symId)}</button>
        <button class="btn-sell" id="tk-sell">SELL / SHORT ${shortName(symId)}</button>
      </div>
    `;

    $('#tk-type', ticket).onchange = (e) => { f.type = e.target.value; this.renderBottomPanel(); };
    $('#tk-qty', ticket).oninput = (e) => { f.qty = +e.target.value || 1; };
    const submit = (side) => {
      const px = quotes.get(symId)?.price || c?.bars[c.bars.length - 1]?.c || curPrice;
      this.trading.placeOrder({
        symbol: symId, side, type: $('#tk-type', ticket).value,
        qty: +$('#tk-qty', ticket).value || 1,
        price: +$('#tk-price', ticket).value || px,
        tp: $('#tk-tp', ticket).value, sl: $('#tk-sl', ticket).value,
        currentPrice: px,
      });
    };
    $('#tk-buy', ticket).onclick = () => submit('buy');
    $('#tk-sell', ticket).onclick = () => submit('sell');

    const tableWrap = h('div', { class: 'tr-table-wrap', id: 'tr-table-wrap' });
    this.bottomPanel.append(header, h('div', { class: 'tr-body' }, ticket, tableWrap));
    this.paintTradingTable();
  }

  paintTradingTable() {
    const wrap = $('#tr-table-wrap', this.bottomPanel);
    if (!wrap) return;
    if (this.trSubTab === 'positions') {
      if (!this.trading.positions.length) { wrap.innerHTML = `<div class="empty-hint">No open positions. Use the Order Ticket on the left or BUY/SELL buttons in the top bar.</div>`; return; }
      wrap.innerHTML = `
        <table class="data-table">
          <thead><tr><th>Symbol</th><th>Side</th><th class="r">Qty</th><th class="r">Avg Price</th><th class="r">LTP</th><th class="r">TP / SL</th><th class="r">Unrealized P&L</th><th class="r">Action</th></tr></thead>
          <tbody>
            ${this.trading.positions.map((p) => `
              <tr>
                <td><b class="link" data-sym="${p.symbol}">${shortName(p.symbol)}</b></td>
                <td><span class="badge ${p.side === 'long' ? 'up' : 'down'}">${p.side.toUpperCase()}</span></td>
                <td class="r">${p.qty}</td>
                <td class="r">${fmtPrice(p.avg)}</td>
                <td class="r">${fmtPrice(p.last ?? p.avg)}</td>
                <td class="r">${p.tp ? fmtPrice(p.tp) : '—'} / ${p.sl ? fmtPrice(p.sl) : '—'}</td>
                <td class="r ${signCls(p.pnl)}"><b>${(p.pnl || 0) >= 0 ? '+' : ''}${fmtPrice(p.pnl || 0, 2)}</b> (${fmtPct(p.pnlPct || 0)})</td>
                <td class="r"><button class="tb-btn danger" data-close="${p.id}">Close</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>`;
      $$('[data-sym]', wrap).forEach((el) => (el.onclick = () => this.setSymbolOnActive(el.dataset.sym)));
      $$('[data-close]', wrap).forEach((el) => (el.onclick = () => this.trading.closePosition(el.dataset.close)));
    } else if (this.trSubTab === 'orders') {
      const ords = this.trading.orders;
      if (!ords.length) { wrap.innerHTML = `<div class="empty-hint">No orders placed yet.</div>`; return; }
      wrap.innerHTML = `
        <table class="data-table">
          <thead><tr><th>Time</th><th>Symbol</th><th>Side</th><th>Type</th><th class="r">Qty</th><th class="r">Order Price</th><th>Status</th><th class="r">Action</th></tr></thead>
          <tbody>
            ${ords.map((o) => `
              <tr>
                <td>${fmtDateShort(o.time)}</td>
                <td><b>${shortName(o.symbol)}</b></td>
                <td class="${o.side === 'buy' ? 'up' : 'down'}"><b>${o.side.toUpperCase()}</b></td>
                <td>${o.type.toUpperCase()}</td>
                <td class="r">${o.qty}</td>
                <td class="r">${fmtPrice(o.price)}</td>
                <td>${o.status.toUpperCase()}</td>
                <td class="r">${o.status === 'working' ? `<button class="tb-btn danger" data-cancel="${o.id}">Cancel</button>` : '—'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>`;
      $$('[data-cancel]', wrap).forEach((el) => (el.onclick = () => this.trading.cancelOrder(el.dataset.cancel)));
    } else {
      const hist = this.trading.history;
      if (!hist.length) { wrap.innerHTML = `<div class="empty-hint">No executed trades yet.</div>`; return; }
      wrap.innerHTML = `
        <table class="data-table">
          <thead><tr><th>Time</th><th>Symbol</th><th>Side</th><th>Type</th><th class="r">Qty</th><th class="r">Fill Price</th><th class="r">Realized P&L</th></tr></thead>
          <tbody>
            ${hist.map((t) => `
              <tr>
                <td>${fmtDateShort(t.time)}</td>
                <td><b>${shortName(t.symbol)}</b></td>
                <td class="${t.side === 'buy' ? 'up' : 'down'}"><b>${t.side.toUpperCase()}</b></td>
                <td>${(t.type || 'market').toUpperCase()}</td>
                <td class="r">${t.qty}</td>
                <td class="r">${fmtPrice(t.price)}</td>
                <td class="r ${signCls(t.realizedPnl)}">${t.realizedPnl ? (t.realizedPnl >= 0 ? '+' : '') + fmtPrice(t.realizedPnl, 2) : '—'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>`;
    }
  }

  updateTradingLive() {
    if (this.state.bottomTab !== 'trading') return;
    const m = $('#tr-metrics', this.bottomPanel);
    if (m) {
      const sum = this.trading.summary();
      m.innerHTML = `
        <span>Balance: <b>₹${fmtPrice(sum.balance, 2)}</b></span>
        <span>Open P&L: <b class="${signCls(sum.openPnl)}">${sum.openPnl >= 0 ? '+' : ''}₹${fmtPrice(sum.openPnl, 2)}</b></span>
        <span>Account Equity: <b>₹${fmtPrice(sum.equity, 2)}</b></span>
      `;
    }
    if (this.trSubTab === 'positions') this.paintTradingTable();
  }

  quickTrade(side) {
    if (!this.active) return;
    const symId = this.active.state.symbol;
    const last = this.active.bars[this.active.bars.length - 1];
    const px = quotes.get(symId)?.price || last?.c;
    this.trading.placeOrder({ symbol: symId, side, type: 'market', qty: 1, currentPrice: px });
  }

  // ---- Screener Dock
  renderScreenerDock() {
    this.scrState ||= { group: 'nifty50', sector: 'all', q: '', sort: 'changePct', dir: -1 };
    const st = this.scrState;
    quotes.setInterest('screener', SYMBOLS.map((s) => s.id));

    const sectors = ['all', ...new Set(SYMBOLS.map((s) => s.sector).filter(Boolean))];
    const header = h('div', { class: 'bp-header' },
      h('div', { class: 'bp-tabs' },
        ...[['nifty50', 'NIFTY 50'], ['indices', 'Indian & Global Indices'], ['crypto', 'Crypto (BTC/ETH)'], ['commodity', 'Gold, Silver & Commodities'], ['all', 'All Universe']].map(([id, lbl]) =>
          h('button', { class: 'bp-sub' + (st.group === id ? ' active' : ''), onclick: () => { st.group = id; this.renderScreenerDock(); } }, lbl)
        )
      ),
      h('div', { class: 'bp-actions' },
        h('select', { class: 'scr-sel', onchange: (e) => { st.sector = e.target.value; this.paintScreenerTable(); } },
          ...sectors.map((s) => h('option', { value: s, selected: st.sector === s }, s === 'all' ? 'All Sectors' : s))
        ),
        h('input', { class: 'scr-inp', placeholder: 'Filter symbol or company…', value: st.q, oninput: (e) => { st.q = e.target.value; this.paintScreenerTable(); } }),
        h('button', { class: 'icon-btn', html: ICON.close, onclick: () => { this.state.bottomTab = null; this.renderBottomBar(); this.renderBottomPanel(); } }),
      )
    );
    const wrap = h('div', { class: 'scr-wrap', id: 'scr-wrap' });
    this.bottomPanel.append(header, wrap);
    this.paintScreenerTable();
  }

  paintScreenerTable() {
    const wrap = $('#scr-wrap', this.bottomPanel);
    if (!wrap) return;
    const st = this.scrState;
    const rows = getScreenerRows(st.group, st.sector, st.q);
    rows.sort((a, b) => ((a[st.sort] > b[st.sort] ? 1 : -1) * st.dir));

    wrap.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th data-sort="short">Symbol</th>
            <th>Sector</th>
            <th class="r" data-sort="price">Last Price</th>
            <th class="r" data-sort="change">Change</th>
            <th class="r" data-sort="changePct">Chg %</th>
            <th class="r">Day Range</th>
            <th class="r" data-sort="pos52">52W Position</th>
            <th class="r" data-sort="volume">Volume</th>
            <th>Technical Rating</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r) => `
            <tr data-sym="${r.id}">
              <td><b>${r.short}</b> <span class="muted">${r.name}</span></td>
              <td><span class="sd-badge">${r.sector}</span></td>
              <td class="r"><b>${r.cur}${fmtPrice(r.price)}</b></td>
              <td class="r ${signCls(r.change)}">${r.change >= 0 ? '+' : ''}${fmtPrice(r.change)}</td>
              <td class="r ${signCls(r.changePct)}"><b>${fmtPct(r.changePct)}</b></td>
              <td class="r">${fmtPrice(r.low)} – ${fmtPrice(r.high)}</td>
              <td class="r">${r.pos52.toFixed(0)}%</td>
              <td class="r">${fmtVol(r.volume)}</td>
              <td><span class="rating-pill ${r.signal.includes('Buy') ? 'up' : r.signal.includes('Sell') ? 'down' : ''}">${r.signal}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    $$('th[data-sort]', wrap).forEach((th) => (th.onclick = () => {
      const k = th.dataset.sort;
      if (st.sort === k) st.dir *= -1; else { st.sort = k; st.dir = -1; }
      this.paintScreenerTable();
    }));
    $$('tr[data-sym]', wrap).forEach((tr) => (tr.onclick = () => this.setSymbolOnActive(tr.dataset.sym)));
  }

  // ---- Pine Script Editor Dock
  renderPineDock() {
    const header = h('div', { class: 'bp-header' },
      h('span', { class: 'rp-title' }, 'Pine Script™ Custom Indicator Editor'),
      h('div', { class: 'bp-actions' },
        h('button', { class: 'tb-btn', onclick: () => { $('#pine-code').value = DEFAULT_SCRIPT; } }, 'Reset Template'),
        h('button', { class: 'tb-btn primary', onclick: () => this.applyPineToChart() }, '▶ Add / Update on Chart'),
        h('button', { class: 'icon-btn', html: ICON.close, onclick: () => { this.state.bottomTab = null; this.renderBottomBar(); this.renderBottomPanel(); } }),
      )
    );
    const editor = h('textarea', { id: 'pine-code', class: 'pine-textarea', spellcheck: 'false' }, this.customScripts.code || DEFAULT_SCRIPT);
    this.pineStatus = h('div', { class: 'pine-status' }, 'Ready. Click "▶ Add / Update on Chart" to compile and plot on the active chart.');
    this.bottomPanel.append(header, editor, this.pineStatus);
  }

  applyPineToChart() {
    if (!this.active) return;
    const code = $('#pine-code')?.value || this.customScripts.code;
    this.customScripts.code = code;
    store.set('customScripts', this.customScripts);
    try {
      const plots = runCustomScript(code, this.active.srcBars);
      let existing = this.active.indicators.find((i) => i.type === 'customscript');
      if (!existing) existing = this.active.addIndicator('customscript');
      this.active.updateIndicator(existing);
      if (this.pineStatus) {
        this.pineStatus.textContent = `Compiled successfully (${plots.length} plot${plots.length === 1 ? '' : 's'} active on ${shortName(this.active.state.symbol)}).`;
        this.pineStatus.className = 'pine-status ok';
      }
      this.toast('Custom Pine Script applied to chart', 'success');
    } catch (e) {
      if (this.pineStatus) {
        this.pineStatus.textContent = `Script Error: ${e.message}`;
        this.pineStatus.className = 'pine-status err';
      }
    }
  }

  evalCustomScript(ind, bars) {
    const plots = runCustomScript(this.customScripts.code || DEFAULT_SCRIPT, bars);
    const out = {};
    plots.forEach((p, idx) => {
      const key = 'p' + idx;
      out[key] = p.series;
      if (ind.styles[key]) { ind.styles[key].color = p.color; ind.styles[key].width = p.width; }
    });
    return out;
  }

  // ================================================================ Popover Menus & Context Menu
  showPop(el) {
    this.popRoot.innerHTML = '';
    const backdrop = h('div', { class: 'pop-backdrop', onclick: () => this.closePop() });
    this.popRoot.append(backdrop, el);
  }
  closePop() { this.popRoot.innerHTML = ''; }

  openIntervalDropdown(btn) {
    // the top bar may have been re-rendered (e.g. after pinning a star) — re-anchor to the live chevron
    if (!btn.isConnected) btn = this.topbar.querySelector('[title="All Timeframes"]') || this.topbar;
    const r = btn.getBoundingClientRect();
    const cur = this.active?.state.interval;
    const menu = h('div', { class: 'pop-menu', style: { left: r.left + 'px', top: r.bottom + 4 + 'px' } },
      ...INTERVALS.map((iv) => {
        const fav = this.state.favIntervals.includes(iv.id);
        return h('div', {
          class: 'pop-item' + (cur === iv.id ? ' active' : ''),
          onclick: () => { this.setIntervalOnActive(iv.id); this.closePop(); },
        },
        h('span', { style: { flex: 1 } }, iv.label),
        h('span', { class: 'muted' }, iv.short),
        h('button', {
          class: 'fav-star' + (fav ? ' on' : ''),
          title: 'Pin to top toolbar',
          onclick: (e) => {
            e.stopPropagation();
            if (fav) this.state.favIntervals = this.state.favIntervals.filter((x) => x !== iv.id);
            else this.state.favIntervals.push(iv.id);
            this.renderTopbar();
            this.saveSoon();
            this.openIntervalDropdown(btn);
          },
        }, '★'));
      })
    );
    this.showPop(menu);
  }

  openIntervalMenu(chart) {
    this.setActive(chart);
    this.openIntervalDropdown($('.tb-iv', this.topbar) || this.topbar);
  }

  openChartTypeDropdown(btn) {
    const r = btn.getBoundingClientRect();
    const cur = this.active?.state.type;
    const menu = h('div', { class: 'pop-menu', style: { left: r.left + 'px', top: r.bottom + 4 + 'px' } },
      ...CHART_TYPES.map((t) => h('div', {
        class: 'pop-item' + (cur === t.id ? ' active' : ''),
        onclick: () => { if (this.active) this.active.setType(t.id); this.closePop(); },
      },
      h('span', { class: 'pop-ico', html: ICON['ct_' + t.id] || ICON.ct_candles }),
      h('span', {}, t.label)))
    );
    this.showPop(menu);
  }

  openMarketsDropdown(btn) {
    const r = btn.getBoundingClientRect();
    const cur = this.active?.state.symbol;
    const groups = [
      ['Indian Indices', ['NSE:NIFTY', 'NSE:BANKNIFTY', 'BSE:SENSEX', 'NSE:FINNIFTY', 'NSE:INDIAVIX']],
      ['Crypto', ['BINANCE:BTCUSDT']],
      ['Gold & Commodities', ['BINANCE:XAUUSDT', 'INR:GOLD10G', 'COMEX:GC1!']],
      ['Stocks', ['NSE:RELIANCE']],
      ['Forex & Global', ['FX:USDINR', 'SP:SPX']],
    ];
    const items = [];
    for (const [title, ids] of groups) {
      const rows = ids.filter((id) => getSymbol(id));
      if (!rows.length) continue;
      items.push(h('div', { class: 'pop-sec' }, title));
      for (const id of rows) {
        const s = getSymbol(id);
        items.push(h('div', {
          class: 'pop-item' + (cur === id ? ' active' : ''),
          onclick: () => { this.setSymbolOnActive(id); this.closePop(); },
        }, h('span', { style: { flex: 1 } }, shortName(id)), h('span', { class: 'muted' }, s.name || s.ex)));
      }
    }
    this.showPop(h('div', { class: 'pop-menu', style: { left: r.left + 'px', top: r.bottom + 4 + 'px', minWidth: '280px', maxHeight: '70vh', overflowY: 'auto' } }, ...items));
  }

  openTemplatesDropdown(btn) {
    const r = btn.getBoundingClientRect();
    const menu = h('div', { class: 'pop-menu', style: { left: r.left + 'px', top: r.bottom + 4 + 'px', minWidth: '260px' } },
      h('div', { class: 'pop-sec' }, 'Preset Indicator Templates'),
      ...TEMPLATES.map((tpl) => h('div', {
        class: 'pop-item',
        onclick: () => {
          if (!this.active) return;
          this.active.state.indicators = tpl.inds.map((x) => createIndicator(x.t, { inputs: x.i || {} }));
          this.active.indCache.clear();
          this.active.buildLegend();
          this.active.requestRender();
          this.saveSoon();
          this.closePop();
          this.toast(`Applied "${tpl.name}"`);
        },
      }, tpl.name))
    );
    this.showPop(menu);
  }

  openWorkspaceDropdown(btn) {
    const r = btn.getBoundingClientRect();
    const item = (icon, text, fn, cls = '') => h('div', { class: 'pop-item ' + cls, style: { display: 'flex', alignItems: 'center', gap: '8px' }, onclick: () => { this.closePop(); fn(); } },
      h('span', { html: icon, style: { display: 'inline-flex', width: '16px', height: '16px' } }), h('span', {}, text));
    const menu = h('div', { class: 'pop-menu', style: { left: r.left + 'px', top: r.bottom + 4 + 'px', minWidth: '220px' } },
      h('div', { class: 'pop-sec' }, 'Layouts'),
      ...this.workspaces.map((w) => h('div', {
        class: 'pop-item' + (w.id === this.activeWorkspaceId ? ' active' : ''),
        onclick: () => { this.closePop(); this.switchWorkspace(w.id); },
      }, `${w.id === this.activeWorkspaceId ? '✓ ' : ''}${w.name}`)),
      h('div', { class: 'pop-sep' }),
      item(ICON.plus, 'New layout…', () => this.createWorkspace()),
      item(ICON.pencil, 'Rename layout…', () => this.renameWorkspace()),
      item(ICON.trash, 'Delete layout', () => this.deleteWorkspace(), 'danger'),
    );
    this.showPop(menu);
  }

  openLayoutDropdown(btn) {
    const r = btn.getBoundingClientRect();
    const menu = h('div', { class: 'pop-menu lay-menu', style: { right: window.innerWidth - r.right + 'px', top: r.bottom + 4 + 'px' } },
      h('div', { class: 'pop-sec' }, 'Number of Charts & Grid Layout'),
      h('div', { class: 'lay-grid' },
        ...LAYOUTS.map((l) => h('button', {
          class: 'lay-btn' + (this.state.layout === l.id ? ' active' : ''),
          title: l.label,
          onclick: () => { this.applyLayout(l.id); this.renderTopbar(); this.saveSoon(); this.closePop(); },
        }, h('span', { html: ICON[l.icon] }), h('small', {}, l.label)))
      ),
      h('div', { class: 'pop-sec' }, 'Sync Across All Charts in Layout'),
      ...[
        ['syncSymbol', 'Sync Symbol across charts'],
        ['syncInterval', 'Sync Interval / Timeframe'],
        ['syncCrosshair', 'Sync Crosshair cursor'],
        ['syncTime', 'Sync Scroll / Time range'],
      ].map(([k, lbl]) => h('label', { class: 'pop-check' },
        h('input', {
          type: 'checkbox', checked: !!this.state[k],
          onchange: (e) => { this.state[k] = e.target.checked; this.saveSoon(); },
        }),
        h('span', {}, lbl)
      ))
    );
    this.showPop(menu);
  }

  toggleScaleMenu(chart, e) {
    const menu = h('div', { class: 'pop-menu', style: { left: e.clientX - 140 + 'px', top: e.clientY - 120 + 'px' } },
      h('div', { class: 'pop-item', onclick: () => { chart.scales.main = { auto: true }; chart.requestRender(); this.closePop(); } }, 'Auto (Fits Data to Screen)'),
      h('div', { class: 'pop-item', onclick: () => { chart.toggleLog(); this.renderBottomBar(); this.closePop(); } }, `${chart.state.logScale ? '✓ ' : ''}Logarithmic Scale`),
      h('div', { class: 'pop-item', onclick: () => { chart.resetView(); this.closePop(); } }, 'Reset Chart View')
    );
    this.showPop(menu);
  }

  showChartContextMenu(chart, e, { price, drawing }) {
    this.setActive(chart);
    const sym = chart.state.symbol;
    const fpx = fmtPrice(price);
    const items = [];
    if (drawing) {
      items.push(
        h('div', { class: 'pop-item', onclick: () => { this.closePop(); this.openDrawingProps(chart, drawing); } }, `Edit ${toolName(drawing.type)} Settings…`),
        h('div', { class: 'pop-item', onclick: () => { this.closePop(); this.cloneDrawing(chart, drawing); } }, `Clone ${toolName(drawing.type)} (Ctrl+D)`),
        h('div', { class: 'pop-item danger', onclick: () => { this.closePop(); this.removeDrawing(sym, drawing); } }, `Remove ${toolName(drawing.type)}`),
        h('div', { class: 'pop-sep' })
      );
    }
    items.push(
      h('div', { class: 'pop-item', onclick: () => { this.closePop(); chart.resetView(); } }, 'Reset Chart View (Alt+R)'),
      h('div', { class: 'pop-sep' }),
      h('div', { class: 'pop-item', onclick: () => { this.closePop(); this.openAlertModal(sym, price); } }, `🔔 Add Alert on ${shortName(sym)} at ${fpx}…`),
      h('div', { class: 'pop-item', onclick: () => { this.closePop(); this.trading.placeOrder({ symbol: sym, side: 'buy', type: 'limit', qty: 1, price, currentPrice: chart.bars[chart.bars.length - 1]?.c }); this.toast(`Buy Limit placed @ ${fpx}`); } }, `Buy 1 ${shortName(sym)} @ ${fpx} Limit`),
      h('div', { class: 'pop-item', onclick: () => { this.closePop(); this.trading.placeOrder({ symbol: sym, side: 'sell', type: 'limit', qty: 1, price, currentPrice: chart.bars[chart.bars.length - 1]?.c }); this.toast(`Sell Limit placed @ ${fpx}`); } }, `Sell 1 ${shortName(sym)} @ ${fpx} Limit`),
      h('div', { class: 'pop-item', onclick: () => { this.closePop(); this.addDrawing(sym, { id: uid(), type: 'hline', pts: [{ t: Date.now(), p: price }], style: { color: '#2962ff', width: 1, dash: 'solid', text: '' } }, this.snapshot(sym)); } }, `Draw Horizontal Line at ${fpx}`),
      h('div', { class: 'pop-item', onclick: () => { this.closePop(); navigator.clipboard?.writeText(String(price.toFixed(2))); this.toast(`Copied ${fpx}`); } }, `Copy Price (${fpx})`),
      h('div', { class: 'pop-sep' }),
      h('div', { class: 'pop-item', onclick: () => { this.closePop(); this.openIndicatorsModal(); } }, 'Insert Indicator…'),
      h('div', { class: 'pop-item', onclick: () => { this.closePop(); this.openSettingsModal(); } }, 'Chart Settings…')
    );

    const x = Math.min(e.clientX, window.innerWidth - 250);
    const y = Math.min(e.clientY, window.innerHeight - 310);
    this.showPop(h('div', { class: 'pop-menu', style: { left: x + 'px', top: y + 'px' } }, ...items));
  }

  // ================================================================ Modals
  showModal(title, contentEl, width = '560px') {
    this.modalRoot.innerHTML = '';
    this.modalRoot.classList.remove('hidden');
    const card = h('div', { class: 'modal-card', style: { maxWidth: width }, onclick: (e) => e.stopPropagation() },
      h('div', { class: 'modal-header' },
        h('h3', {}, title),
        h('button', { class: 'icon-btn', html: ICON.close, onclick: () => this.closeModal() }),
      ),
      contentEl
    );
    this.modalRoot.onclick = () => this.closeModal();
    this.modalRoot.append(card);
  }
  closeModal() { this.modalRoot.classList.add('hidden'); this.modalRoot.innerHTML = ''; }

  // ---- Symbol Search Modal (Local catalogue + Live Yahoo Finance Search)
  openSymbolSearch(targetChart = null, onPick = null, initialQuery = '') {
    let cat = 'all';
    let q = initialQuery;
    const inp = h('input', { class: 'modal-search', placeholder: 'Search NSE/BSE stocks (e.g. RELIANCE, TCS, ZOMATO), NIFTY, BTC, GOLD…', value: q });
    const catsEl = h('div', { class: 'cat-pills' });
    const listEl = h('div', { class: 'sym-results' });

    const pick = (id) => {
      this.closeModal();
      if (onPick) onPick(id);
      else if (targetChart) { targetChart.setSymbol(id); this.updateQuoteSubscriptions(); }
      else this.setSymbolOnActive(id);
    };

    const renderList = (items, remoteItems = []) => {
      listEl.innerHTML = '';
      const seen = new Set();
      const all = [...items];
      for (const r of remoteItems) {
        const s = fromYahoo(r);
        if (!seen.has(s.id) && !all.some((x) => x.id === s.id)) all.push(s);
      }
      if (!all.length) { listEl.append(h('div', { class: 'empty-hint' }, 'No matching symbols found.')); return; }
      for (const s of all.slice(0, 60)) {
        seen.add(s.id);
        listEl.append(h('div', { class: 'sym-row', onclick: () => pick(s.id) },
          h('span', { class: 'wl-dot ' + s.type }),
          h('b', { class: 'sym-code' }, shortName(s.id)),
          h('span', { class: 'sym-desc' }, s.name),
          h('span', { class: 'sd-badge' }, s.type.toUpperCase()),
          h('span', { class: 'sym-ex' }, s.ex),
          h('button', {
            class: 'tb-btn', title: 'Add to Watchlist',
            onclick: (e) => { e.stopPropagation(); this.addToWatchlist(s.id); },
          }, '+ WL')
        ));
      }
    };

    const refresh = debounce(async () => {
      const loc = searchLocal(q, cat);
      renderList(loc);
      if (q.trim().length >= 2) {
        const rem = await searchRemote(q.trim());
        renderList(loc, rem);
      }
    }, 150);

    const paintCats = () => {
      catsEl.innerHTML = '';
      for (const c of CATEGORIES) {
        catsEl.append(h('button', {
          class: 'tb-pill' + (cat === c.id ? ' active' : ''),
          onclick: () => { cat = c.id; paintCats(); refresh(); },
        }, c.label));
      }
    };

    inp.oninput = () => { q = inp.value; refresh(); };
    inp.onkeydown = (e) => { if (e.key === 'Enter') { const first = $('.sym-row', listEl); if (first) first.click(); } };

    paintCats();
    renderList(searchLocal(q, cat));
    this.showModal('Symbol Search', h('div', { class: 'modal-body' }, inp, catsEl, listEl), '680px');
    setTimeout(() => inp.focus(), 20);
  }

  // ---- Compare Symbol Modal
  openCompareModal() {
    const c = this.active;
    if (!c) return;
    const popular = ['NSE:NIFTY', 'NSE:BANKNIFTY', 'BINANCE:BTCUSDT', 'INR:GOLD10G', 'COMEX:GC1!', 'FX:USDINR', 'NSE:RELIANCE', 'SP:SPX'];
    const body = h('div', { class: 'modal-body' },
      h('p', { class: 'muted' }, 'Overlay another asset on the main chart to compare relative movement:'),
      h('div', { class: 'sym-results' },
        ...popular.map((id) => {
          const s = getSymbol(id);
          return h('div', {
            class: 'sym-row',
            onclick: () => { c.addIndicator('compare', { inputs: { symbol: id } }); this.closeModal(); },
          }, h('b', { class: 'sym-code' }, shortName(id)), h('span', { class: 'sym-desc' }, s.name), h('span', { class: 'sym-ex' }, s.ex));
        })
      ),
      h('button', { class: 'tb-btn primary', style: { marginTop: '10px' }, onclick: () => this.openSymbolSearch(null, (id) => c.addIndicator('compare', { inputs: { symbol: id } })) }, 'Search Any Symbol to Compare…')
    );
    this.showModal('Compare Symbol', body, '520px');
  }

  // ---- Indicators Modal
  openIndicatorsModal() {
    const c = this.active;
    if (!c) return;
    let q = '', cat = 'All';
    const inp = h('input', { class: 'modal-search', placeholder: 'Search indicators (e.g. EMA, RSI, Supertrend, Bollinger, VWAP, Ichimoku)…' });
    const cats = ['All', ...CATEGORY_ORDER];
    const catsEl = h('div', { class: 'cat-pills' });
    const listEl = h('div', { class: 'sym-results' });

    const paint = () => {
      catsEl.innerHTML = '';
      for (const ct of cats) {
        catsEl.append(h('button', { class: 'tb-pill' + (cat === ct ? ' active' : ''), onclick: () => { cat = ct; paint(); } }, ct));
      }
      listEl.innerHTML = '';
      const entries = Object.entries(INDICATORS).filter(([, d]) => !d.hidden && (cat === 'All' || d.category === cat) && (!q || d.name.toLowerCase().includes(q) || d.short.toLowerCase().includes(q)));
      for (const [id, def] of entries) {
        const count = c.indicators.filter((i) => i.type === id).length;
        listEl.append(h('div', {
          class: 'sym-row',
          onclick: () => { c.addIndicator(id); paint(); this.toast(`Added ${def.name}`); },
        },
        h('b', { class: 'sym-code' }, def.short),
        h('span', { class: 'sym-desc' }, def.name),
        h('span', { class: 'sd-badge' }, def.overlay ? 'Overlay' : 'Pane'),
        h('span', { class: 'sym-ex' }, def.category),
        count ? h('span', { class: 'ind-count' }, `${count} active`) : null));
      }
    };
    inp.oninput = () => { q = inp.value.trim().toLowerCase(); paint(); };
    paint();
    this.showModal('Indicators, Metrics & Strategies', h('div', { class: 'modal-body' }, inp, catsEl, listEl), '660px');
    setTimeout(() => inp.focus(), 20);
  }

  // ---- Indicator Settings Modal
  openIndicatorSettings(chart, ind) {
    const def = INDICATORS[ind.type];
    const body = h('div', { class: 'modal-body form-grid' });
    for (const [k, spec] of Object.entries(def.inputs)) {
      const lbl = spec.label || k;
      let ctrl;
      if (spec.options) {
        ctrl = h('select', { onchange: (e) => { ind.inputs[k] = e.target.value; chart.updateIndicator(ind); } },
          ...spec.options.map((o) => h('option', { value: o, selected: ind.inputs[k] === o }, o))
        );
      } else if (typeof spec.v === 'boolean') {
        ctrl = h('input', { type: 'checkbox', checked: !!ind.inputs[k], onchange: (e) => { ind.inputs[k] = e.target.checked; chart.updateIndicator(ind); } });
      } else if (typeof spec.v === 'string') {
        ctrl = h('input', { type: 'text', value: ind.inputs[k], oninput: (e) => { ind.inputs[k] = e.target.value; chart.updateIndicator(ind); } });
      } else {
        ctrl = h('input', { type: 'number', value: ind.inputs[k], min: spec.min, max: spec.max, step: spec.step || 1, oninput: (e) => { ind.inputs[k] = +e.target.value; chart.updateIndicator(ind); } });
      }
      body.append(h('label', { class: 'form-row' }, h('span', {}, lbl), ctrl));
    }
    body.append(h('div', { class: 'wl-sec' }, 'Plot Styles'));
    for (const p of def.plots) {
      const s = ind.styles[p.key];
      if (!s) continue;
      body.append(h('div', { class: 'form-row' },
        h('label', {},
          h('input', { type: 'checkbox', checked: s.visible !== false, onchange: (e) => { s.visible = e.target.checked; chart.updateIndicator(ind); } }),
          ' ' + p.title
        ),
        h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
          h('input', { type: 'color', value: (s.color || '#2962ff').slice(0, 7), oninput: (e) => { s.color = e.target.value; chart.updateIndicator(ind); } }),
          h('select', { onchange: (e) => { s.width = +e.target.value; chart.updateIndicator(ind); } },
            ...[1, 1.5, 2, 3, 4].map((w) => h('option', { value: w, selected: s.width === w }, `${w}px`))
          )
        )
      ));
    }
    body.append(h('div', { class: 'modal-footer' },
      h('button', { class: 'tb-btn primary', onclick: () => this.closeModal() }, 'Done')
    ));
    this.showModal(`${def.name} Settings`, body, '440px');
  }

  // ---- Drawing Properties Modal
  openDrawingProps(chart, d, focusText = false) {
    const txtInp = h('textarea', { rows: 3, value: d.style.text || '', placeholder: 'Optional label or note text…', oninput: (e) => { d.style.text = e.target.value; chart.requestRender(); this.saveSoon(); } });
    const body = h('div', { class: 'modal-body form-grid' },
      h('label', { class: 'form-row' }, h('span', {}, 'Color'), h('input', { type: 'color', value: (d.style.color || '#2962ff').slice(0, 7), oninput: (e) => { d.style.color = e.target.value; chart.requestRender(); this.saveSoon(); } })),
      h('label', { class: 'form-row' }, h('span', {}, 'Line Width'), h('input', { type: 'number', min: 1, max: 10, value: d.style.width || 2, oninput: (e) => { d.style.width = +e.target.value; chart.requestRender(); this.saveSoon(); } })),
      d.type === 'long' || d.type === 'short'
        ? h('label', { class: 'form-row' }, h('span', {}, 'Position Quantity'), h('input', { type: 'number', min: 1, value: d.style.qty || 1, oninput: (e) => { d.style.qty = +e.target.value || 1; chart.requestRender(); this.saveSoon(); } }))
        : null,
      d.type === 'trend'
        ? h('label', { class: 'form-row' }, h('span', {}, 'Show Price/Bar Stats'), h('input', { type: 'checkbox', checked: !!d.style.showStats, onchange: (e) => { d.style.showStats = e.target.checked; chart.requestRender(); this.saveSoon(); } }))
        : null,
      h('label', { class: 'form-col' }, h('span', {}, 'Label / Annotation Text'), txtInp),
      h('div', { class: 'modal-footer' },
        h('button', { class: 'tb-btn danger', onclick: () => { this.removeDrawing(chart.state.symbol, d); this.closeModal(); } }, 'Delete Drawing'),
        h('button', { class: 'tb-btn primary', onclick: () => this.closeModal() }, 'OK')
      )
    );
    this.showModal(`${toolName(d.type)} Properties`, body, '420px');
    if (focusText) setTimeout(() => { txtInp.focus(); txtInp.select(); }, 20);
  }

  // ---- Create Alert Modal
  openAlertModal(symId, defaultPrice) {
    const c = this.active;
    const symbol = symId || (c ? c.state.symbol : 'NSE:NIFTY');
    const curPrice = quotes.get(symbol)?.price || c?.bars[c.bars.length - 1]?.c || getSymbol(symbol).approx || 100;
    const priceVal = defaultPrice != null ? defaultPrice : curPrice;

    const condSel = h('select', {},
      h('option', { value: 'crossing' }, 'Crossing'),
      h('option', { value: 'crossing_up' }, 'Crossing Up'),
      h('option', { value: 'crossing_down' }, 'Crossing Down'),
      h('option', { value: 'greater' }, 'Greater Than'),
      h('option', { value: 'less' }, 'Less Than'),
    );
    const pxInp = h('input', { type: 'number', step: 'any', value: Number(priceVal).toFixed(2) });
    const noteInp = h('input', { type: 'text', placeholder: 'Alert message (e.g. Breakout above resistance)…' });

    const body = h('div', { class: 'modal-body form-grid' },
      h('div', { class: 'form-row' }, h('span', {}, 'Symbol'), h('b', {}, `${shortName(symbol)} (LTP: ${fmtPrice(curPrice)})`)),
      h('label', { class: 'form-row' }, h('span', {}, 'Condition'), condSel),
      h('label', { class: 'form-row' }, h('span', {}, 'Trigger Price'), pxInp),
      h('label', { class: 'form-row' }, h('span', {}, 'Note'), noteInp),
      h('div', { class: 'modal-footer' },
        h('button', {
          class: 'tb-btn primary',
          onclick: () => {
            this.alertsMgr.add({ symbol, condition: condSel.value, price: +pxInp.value, note: noteInp.value, currentPrice: curPrice });
            this.updateQuoteSubscriptions();
            this.closeModal();
            this.toast(`Alert set on ${shortName(symbol)} @ ${fmtPrice(+pxInp.value)}`, 'success');
          },
        }, 'Create Alert')
      )
    );
    this.showModal(`Create Alert on ${shortName(symbol)}`, body, '420px');
  }

  // ---- Chart Settings Modal
  openSettingsModal() {
    const st = this.settings;
    const upd = () => { this.charts.forEach((c) => { c.buildLegend(); c.requestRender(); }); this.saveSoon(); };
    const body = h('div', { class: 'modal-body form-grid' },
      h('div', { class: 'wl-sec' }, 'Candle & Series Appearance'),
      h('label', { class: 'form-row' }, h('span', {}, 'Bullish (Up) Color'), h('input', { type: 'color', value: st.upColor, oninput: (e) => { st.upColor = st.wickUp = e.target.value; upd(); } })),
      h('label', { class: 'form-row' }, h('span', {}, 'Bearish (Down) Color'), h('input', { type: 'color', value: st.downColor, oninput: (e) => { st.downColor = st.wickDown = e.target.value; upd(); } })),
      h('label', { class: 'form-row' }, h('span', {}, 'Line / Area Color'), h('input', { type: 'color', value: st.lineColor, oninput: (e) => { st.lineColor = e.target.value; upd(); } })),
      h('div', { class: 'wl-sec' }, 'Grid, Scales & Watermark'),
      ...[
        ['glowEffects', '✨ Neon Candle & Line Glow Effects'],
        ['gridV', 'Vertical Grid Lines'],
        ['gridH', 'Horizontal Grid Lines'],
        ['watermark', 'Symbol Background Watermark'],
        ['lastPriceLine', 'Last Price Line & Axis Label'],
        ['countdown', 'Countdown to Bar Close'],
        ['indicatorLabels', 'Indicator Last-Value Labels on Scale'],
        ['showVolLegend', 'Show Volume in OHLC Legend'],
      ].map(([k, lbl]) => h('label', { class: 'form-row' },
        h('span', {}, lbl),
        h('input', { type: 'checkbox', checked: !!st[k], onchange: (e) => { st[k] = e.target.checked; upd(); } })
      )),
      h('label', { class: 'form-row' }, h('span', {}, 'Right Offset (bars)'), h('input', { type: 'number', min: 0, max: 50, value: st.rightMargin, oninput: (e) => { st.rightMargin = +e.target.value; upd(); } })),
      h('div', { class: 'modal-footer' },
        h('button', { class: 'tb-btn primary', onclick: () => this.closeModal() }, 'Close')
      )
    );
    this.showModal('Chart Settings', body, '460px');
  }

  openShortcutsModal() {
    const rows = [
      ['Start typing (A–Z)', 'Open Symbol Search immediately'],
      ['Ctrl + K / Cmd + K', 'Open Symbol Search'],
      ['/', 'Open Indicators & Strategies'],
      ['Alt + A', 'Create Price Alert on Active Symbol'],
      ['Alt + L', 'Toggle Logarithmic Scale'],
      ['Alt + R', 'Reset Chart View (Auto-Fit)'],
      ['Ctrl + Z / Ctrl + Y', 'Undo / Redo Drawing'],
      ['Delete / Backspace', 'Delete Selected Drawing'],
      ['Escape', 'Cancel Active Drawing / Return to Crosshair'],
      ['← / → Arrow Keys', 'Scroll Chart Left / Right'],
      ['↑ / ↓ or + / -', 'Zoom In / Out on Chart'],
      ['Scroll Wheel on Price Axis', 'Zoom Vertical Price Scale'],
      ['Double-click Price / Time Axis', 'Reset Scale to Auto'],
    ];
    const body = h('div', { class: 'modal-body' },
      h('table', { class: 'data-table' },
        h('tbody', {}, ...rows.map(([k, d]) => h('tr', {}, h('td', {}, h('kbd', {}, k)), h('td', {}, d))))
      )
    );
    this.showModal('Keyboard Shortcuts & Pro Tips', body, '540px');
  }

  // ================================================================ Utilities & Global Shortcuts
  openThemeDropdown(btn) {
    const r = btn.getBoundingClientRect();
    const menu = h('div', { class: 'pop-menu', style: { right: window.innerWidth - r.right + 'px', top: r.bottom + 6 + 'px', minWidth: '220px' } },
      h('div', { class: 'pop-sec' }, 'Glowing Visual Themes'),
      ...Object.entries(THEMES).map(([id, th]) => h('div', {
        class: 'pop-item' + (this.settings.theme === id ? ' active' : ''),
        onclick: () => {
          this.applyTheme(id);
          this.closePop();
        },
      },
      h('span', { class: 'swatch', style: { background: th.up, boxShadow: `0 0 8px ${th.up}` } }),
      h('span', { style: { flex: 1 } }, th.name),
      h('small', { class: 'muted' }, th.badge.split(' ')[0])))
    );
    this.showPop(menu);
  }

  applyTheme(id) {
    const th = THEMES[id] || THEMES.aurora;
    this.settings.theme = id;
    this.settings.upColor = this.settings.wickUp = th.up;
    this.settings.downColor = this.settings.wickDown = th.down;
    this.settings.lineColor = th.line;
    document.documentElement.dataset.theme = id;
    this.renderTopbar();
    this.charts.forEach((c) => c.requestRender());
    this.saveSoon();
    this.toast(`Theme switched to ${th.name}`);
  }

  toggleTheme() {
    const keys = Object.keys(THEMES);
    const next = keys[(keys.indexOf(this.settings.theme) + 1) % keys.length];
    this.applyTheme(next);
  }

  takeScreenshot() {
    if (!this.active) return;
    const url = this.active.snapshot();
    download(`ChartVista_${shortName(this.active.state.symbol)}_${this.active.state.interval}.png`, url);
    this.toast('Snapshot downloaded as PNG', 'success');
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  }

  toast(msg, kind = 'info') {
    const el = h('div', { class: `toast ${kind}` }, msg);
    this.toastBox.append(el);
    setTimeout(() => { el.classList.add('hide'); setTimeout(() => el.remove(), 300); }, 3500);
  }

  bindGlobalEvents() {
    window.addEventListener('keydown', (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        if (e.key === 'Escape') { this.closeModal(); this.closePop(); document.activeElement.blur(); }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); this.openSymbolSearch(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && this.active?.selected) { e.preventDefault(); this.cloneDrawing(this.active, this.active.selected); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); this.undoDrawing(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); this.redoDrawing(); return; }
      if (e.altKey && e.key.toLowerCase() === 'a') { e.preventDefault(); this.openAlertModal(); return; }
      if (e.altKey && e.key.toLowerCase() === 'l') { e.preventDefault(); if (this.active) { this.active.toggleLog(); this.renderBottomBar(); } return; }
      if (e.altKey && e.key.toLowerCase() === 'r') { e.preventDefault(); if (this.active) this.active.resetView(); return; }
      if (e.key === '/') { e.preventDefault(); this.openIndicatorsModal(); return; }
      if (this.active && this.active.keyDown(e)) { e.preventDefault(); return; }
      // Type-to-search symbol (TradingView style)
      if (!e.ctrlKey && !e.metaKey && !e.altKey && /^[a-zA-Z]$/.test(e.key) && this.modalRoot.classList.contains('hidden')) {
        e.preventDefault();
        this.openSymbolSearch(null, null, e.key.toUpperCase());
      }
    });
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.chartVista = new App();
});
