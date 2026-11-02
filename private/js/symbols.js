// Symbol catalogue: Indian equities (NSE/BSE), indices, crypto, gold/silver & commodities, forex.
// src: 'yahoo' (via local proxy) | 'binance' (direct REST/WebSocket) | 'syn' (server-side synthetic INR series)

const S = [];
const add = (id, ticker, name, type, ex, src, extra = {}) => S.push({ id, ticker, name, type, ex, src, cur: extra.cur || '₹', ...extra });

// ---- Indices
add('NSE:NIFTY', '^NSEI', 'NIFTY 50 Index', 'index', 'NSE', 'yahoo', { approx: 24000, sector: 'Index' });
add('NSE:BANKNIFTY', '^NSEBANK', 'NIFTY Bank Index', 'index', 'NSE', 'yahoo', { approx: 51000, sector: 'Index' });
add('BSE:SENSEX', '^BSESN', 'S&P BSE SENSEX', 'index', 'BSE', 'yahoo', { approx: 79000, sector: 'Index' });
add('NSE:FINNIFTY', 'NIFTY_FIN_SERVICE.NS', 'NIFTY Financial Services', 'index', 'NSE', 'yahoo', { approx: 23500, sector: 'Index' });
add('NSE:CNXIT', '^CNXIT', 'NIFTY IT Index', 'index', 'NSE', 'yahoo', { approx: 37000, sector: 'Index' });
add('NSE:CNXAUTO', '^CNXAUTO', 'NIFTY Auto Index', 'index', 'NSE', 'yahoo', { approx: 23000, sector: 'Index' });
add('NSE:CNXPHARMA', '^CNXPHARMA', 'NIFTY Pharma Index', 'index', 'NSE', 'yahoo', { approx: 21000, sector: 'Index' });
add('NSE:CNXFMCG', '^CNXFMCG', 'NIFTY FMCG Index', 'index', 'NSE', 'yahoo', { approx: 56000, sector: 'Index' });
add('NSE:CNXMETAL', '^CNXMETAL', 'NIFTY Metal Index', 'index', 'NSE', 'yahoo', { approx: 9000, sector: 'Index' });
add('NSE:MIDCAP', 'NIFTY_MIDCAP_100.NS', 'NIFTY Midcap 100', 'index', 'NSE', 'yahoo', { approx: 55000, sector: 'Index' });
add('NSE:INDIAVIX', '^INDIAVIX', 'India VIX', 'index', 'NSE', 'yahoo', { approx: 14, sector: 'Index' });

// ---- NIFTY 50 (approximate constituents) + popular stocks
const N50 = [
  ['RELIANCE', 'Reliance Industries', 'Energy', 1300], ['TCS', 'Tata Consultancy Services', 'IT', 3500], ['HDFCBANK', 'HDFC Bank', 'Banking', 1700],
  ['ICICIBANK', 'ICICI Bank', 'Banking', 1300], ['INFY', 'Infosys', 'IT', 1600], ['BHARTIARTL', 'Bharti Airtel', 'Telecom', 1700],
  ['ITC', 'ITC Ltd', 'FMCG', 420], ['SBIN', 'State Bank of India', 'Banking', 800], ['LT', 'Larsen & Toubro', 'Infrastructure', 3500],
  ['HINDUNILVR', 'Hindustan Unilever', 'FMCG', 2400], ['KOTAKBANK', 'Kotak Mahindra Bank', 'Banking', 1900], ['AXISBANK', 'Axis Bank', 'Banking', 1150],
  ['BAJFINANCE', 'Bajaj Finance', 'Financials', 900], ['ASIANPAINT', 'Asian Paints', 'Consumer', 2400], ['MARUTI', 'Maruti Suzuki', 'Auto', 12000],
  ['HCLTECH', 'HCL Technologies', 'IT', 1600], ['SUNPHARMA', 'Sun Pharmaceutical', 'Pharma', 1700], ['TITAN', 'Titan Company', 'Consumer', 3400],
  ['ULTRACEMCO', 'UltraTech Cement', 'Cement', 11500], ['WIPRO', 'Wipro', 'IT', 260], ['NTPC', 'NTPC Ltd', 'Power', 340],
  ['POWERGRID', 'Power Grid Corp', 'Power', 300], ['ONGC', 'Oil & Natural Gas Corp', 'Energy', 240], ['NESTLEIND', 'Nestle India', 'FMCG', 1200],
  ['M&M', 'Mahindra & Mahindra', 'Auto', 3000], ['TMPV', 'Tata Motors Passenger Vehicles', 'Auto', 400], ['TATASTEEL', 'Tata Steel', 'Metals', 150],
  ['JSWSTEEL', 'JSW Steel', 'Metals', 1000], ['ADANIENT', 'Adani Enterprises', 'Conglomerate', 2400], ['ADANIPORTS', 'Adani Ports & SEZ', 'Infrastructure', 1400],
  ['COALINDIA', 'Coal India', 'Mining', 390], ['BAJAJFINSV', 'Bajaj Finserv', 'Financials', 1900], ['BAJAJ-AUTO', 'Bajaj Auto', 'Auto', 8500],
  ['HDFCLIFE', 'HDFC Life Insurance', 'Insurance', 750], ['SBILIFE', 'SBI Life Insurance', 'Insurance', 1800], ['TECHM', 'Tech Mahindra', 'IT', 1500],
  ['GRASIM', 'Grasim Industries', 'Cement', 2700], ['CIPLA', 'Cipla', 'Pharma', 1500], ['DRREDDY', "Dr. Reddy's Laboratories", 'Pharma', 1250],
  ['EICHERMOT', 'Eicher Motors', 'Auto', 6500], ['HEROMOTOCO', 'Hero MotoCorp', 'Auto', 5000], ['APOLLOHOSP', 'Apollo Hospitals', 'Healthcare', 7200],
  ['BRITANNIA', 'Britannia Industries', 'FMCG', 5800], ['INDUSINDBK', 'IndusInd Bank', 'Banking', 800], ['SHRIRAMFIN', 'Shriram Finance', 'Financials', 650],
  ['TRENT', 'Trent Ltd', 'Retail', 5000], ['BEL', 'Bharat Electronics', 'Defence', 400], ['HINDALCO', 'Hindalco Industries', 'Metals', 700],
  ['ETERNAL', 'Eternal (Zomato)', 'Consumer Tech', 300], ['JIOFIN', 'Jio Financial Services', 'Financials', 300],
];
export const NIFTY50 = N50.map((x) => 'NSE:' + x[0]);
for (const [t, n, sec, ap] of N50) add('NSE:' + t, t + '.NS', n, 'stock', 'NSE', 'yahoo', { sector: sec, approx: ap });

const OTHERS = [
  ['IRCTC', 'Indian Railway Catering & Tourism', 'Travel', 750], ['HAL', 'Hindustan Aeronautics', 'Defence', 4500], ['DMART', 'Avenue Supermarts', 'Retail', 4000],
  ['IRFC', 'Indian Railway Finance Corp', 'Financials', 130], ['TATAPOWER', 'Tata Power', 'Power', 400], ['VEDL', 'Vedanta', 'Metals', 450],
  ['PNB', 'Punjab National Bank', 'Banking', 105], ['BANKBARODA', 'Bank of Baroda', 'Banking', 240], ['DLF', 'DLF Ltd', 'Realty', 800],
  ['YESBANK', 'Yes Bank', 'Banking', 20], ['SUZLON', 'Suzlon Energy', 'Power', 60], ['IDEA', 'Vodafone Idea', 'Telecom', 8],
  ['PAYTM', 'One 97 Communications', 'Consumer Tech', 1000], ['NYKAA', 'FSN E-Commerce (Nykaa)', 'Consumer Tech', 200], ['ADANIGREEN', 'Adani Green Energy', 'Power', 1000],
  ['LICI', 'Life Insurance Corp of India', 'Insurance', 900], ['ZYDUSLIFE', 'Zydus Lifesciences', 'Pharma', 950], ['PIDILITIND', 'Pidilite Industries', 'Chemicals', 3000],
  ['GOLDBEES', 'Nippon India ETF Gold BeES', 'ETF', 100, 'etf'], ['SILVERBEES', 'Nippon India ETF Silver BeES', 'ETF', 140, 'etf'], ['NIFTYBEES', 'Nippon India ETF Nifty BeES', 'ETF', 280, 'etf'],
];
for (const [t, n, sec, ap, ty] of OTHERS) add('NSE:' + t, t + '.NS', n, ty || 'stock', 'NSE', 'yahoo', { sector: sec, approx: ap });
add('BSE:RELIANCE', 'RELIANCE.BO', 'Reliance Industries (BSE)', 'stock', 'BSE', 'yahoo', { sector: 'Energy', approx: 1300 });
add('BSE:TCS', 'TCS.BO', 'Tata Consultancy Services (BSE)', 'stock', 'BSE', 'yahoo', { sector: 'IT', approx: 3500 });

// ---- Crypto
const CRYPTO = [
  ['BTCUSDT', 'Bitcoin / TetherUS', 'BTC-USD', 85000], ['ETHUSDT', 'Ethereum / TetherUS', 'ETH-USD', 3000], ['SOLUSDT', 'Solana / TetherUS', 'SOL-USD', 150],
  ['BNBUSDT', 'BNB / TetherUS', 'BNB-USD', 600], ['XRPUSDT', 'XRP / TetherUS', 'XRP-USD', 2], ['DOGEUSDT', 'Dogecoin / TetherUS', 'DOGE-USD', 0.15],
  ['ADAUSDT', 'Cardano / TetherUS', 'ADA-USD', 0.6], ['PAXGUSDT', 'PAX Gold (1 oz tokenised gold)', 'PAXG-USD', 4140],
];
for (const [t, n, fb, ap] of CRYPTO) add('BINANCE:' + t, t, n, t === 'PAXGUSDT' ? 'commodity' : 'crypto', 'BINANCE', 'binance', { cur: '$', fb, approx: ap, sector: 'Crypto' });
// Binance USD-M futures — closest free feed to Capital.com Gold Spot (~USD/oz)
add('BINANCE:XAUUSDT', 'XAUUSDT', 'Gold ≈ Capital.com (USD/oz)', 'commodity', 'BINANCE', 'binance', {
  cur: '$', fb: 'GC=F', approx: 4140, sector: 'Metals', futures: true,
});
add('CRYPTO:BTCINR', 'BTC-INR', 'Bitcoin / Indian Rupee', 'crypto', 'CRYPTO', 'yahoo', { approx: 7500000, sector: 'Crypto' });
add('CRYPTO:ETHINR', 'ETH-INR', 'Ethereum / Indian Rupee', 'crypto', 'CRYPTO', 'yahoo', { approx: 260000, sector: 'Crypto' });

// ---- Gold, silver & commodities
add('INR:GOLD10G', 'GOLDINR', 'Gold ₹ / 10 gram (intl. parity)', 'commodity', 'SYN', 'syn', { approx: 120000, sector: 'Metals' });
add('INR:SILVER1KG', 'SILVERINR', 'Silver ₹ / kg (intl. parity)', 'commodity', 'SYN', 'syn', { approx: 140000, sector: 'Metals' });
add('COMEX:GC1!', 'GC=F', 'Gold Futures (COMEX, USD/oz)', 'commodity', 'COMEX', 'yahoo', { cur: '$', approx: 4140, sector: 'Metals' });
add('COMEX:SI1!', 'SI=F', 'Silver Futures (COMEX, USD/oz)', 'commodity', 'COMEX', 'yahoo', { cur: '$', approx: 40, sector: 'Metals' });
add('NYMEX:CL1!', 'CL=F', 'Crude Oil WTI Futures', 'commodity', 'NYMEX', 'yahoo', { cur: '$', approx: 70, sector: 'Energy' });
add('NYMEX:NG1!', 'NG=F', 'Natural Gas Futures', 'commodity', 'NYMEX', 'yahoo', { cur: '$', approx: 3, sector: 'Energy' });
add('COMEX:HG1!', 'HG=F', 'Copper Futures', 'commodity', 'COMEX', 'yahoo', { cur: '$', approx: 4.5, sector: 'Metals' });

// ---- Forex & global
add('FX:USDINR', 'INR=X', 'U.S. Dollar / Indian Rupee', 'forex', 'FX', 'yahoo', { approx: 85, sector: 'Forex' });
add('FX:EURINR', 'EURINR=X', 'Euro / Indian Rupee', 'forex', 'FX', 'yahoo', { approx: 95, sector: 'Forex' });
add('FX:DXY', 'DX-Y.NYB', 'U.S. Dollar Index', 'index', 'ICE', 'yahoo', { cur: '', approx: 100, sector: 'Forex' });
add('SP:SPX', '^GSPC', 'S&P 500 Index', 'index', 'SP', 'yahoo', { cur: '$', approx: 6000, sector: 'Index' });
add('NASDAQ:NDX', '^NDX', 'Nasdaq 100 Index', 'index', 'NASDAQ', 'yahoo', { cur: '$', approx: 21000, sector: 'Index' });

export const SYMBOLS = S;
const byId = new Map(S.map((s) => [s.id, s]));

export const CATEGORIES = [
  { id: 'all', label: 'All' }, { id: 'stock', label: 'Stocks' }, { id: 'index', label: 'Indices' }, { id: 'crypto', label: 'Crypto' },
  { id: 'commodity', label: 'Gold & Commodities' }, { id: 'forex', label: 'Forex' }, { id: 'etf', label: 'ETFs' },
];

/** Resolve a symbol id; unknown ids discovered via search are created on the fly. */
export function getSymbol(id) {
  if (byId.has(id)) return byId.get(id);
  const [ex, t] = id.includes(':') ? id.split(':') : ['NSE', id];
  let s;
  if (ex === 'NSE') s = { id, ticker: t + '.NS', name: t, type: 'stock', ex, src: 'yahoo', cur: '₹' };
  else if (ex === 'BSE') s = { id, ticker: t + '.BO', name: t, type: 'stock', ex, src: 'yahoo', cur: '₹' };
  else if (ex === 'BINANCE') s = { id, ticker: t, name: t, type: 'crypto', ex, src: 'binance', cur: '$', fb: t.replace(/USDT$/, '-USD') };
  else s = { id, ticker: t, name: t, type: 'other', ex, src: 'yahoo', cur: '' };
  byId.set(id, s);
  return s;
}

/** Register a symbol returned by the Yahoo search API */
export function fromYahoo(r) {
  let id, ex, type = (r.type || '').toLowerCase(), cur = '';
  if (r.symbol.endsWith('.NS')) { ex = 'NSE'; id = 'NSE:' + r.symbol.slice(0, -3); cur = '₹'; }
  else if (r.symbol.endsWith('.BO')) { ex = 'BSE'; id = 'BSE:' + r.symbol.slice(0, -3); cur = '₹'; }
  else { ex = r.exchDisp || r.exchange || 'GLOBAL'; id = ex.replace(/\W/g, '').toUpperCase() + ':' + r.symbol; }
  const existing = [...byId.values()].find((s) => s.ticker === r.symbol);
  if (existing) return existing;
  const map = { equity: 'stock', index: 'index', cryptocurrency: 'crypto', future: 'commodity', currency: 'forex', etf: 'etf', mutualfund: 'fund' };
  const s = { id, ticker: r.symbol, name: r.name, type: map[type] || type || 'other', ex, src: 'yahoo', cur };
  byId.set(id, s);
  return s;
}

export function searchLocal(q, cat = 'all') {
  q = q.trim().toUpperCase();
  return S.filter((s) => (cat === 'all' || s.type === cat))
    .map((s) => {
      const short = s.id.split(':')[1].toUpperCase();
      let score = 0;
      if (!q) score = 1;
      else if (short === q) score = 100;
      else if (short.startsWith(q)) score = 60;
      else if (short.includes(q)) score = 30;
      else if (s.name.toUpperCase().includes(q)) score = 20;
      return { s, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.s);
}

export const shortName = (id) => (id.includes(':') ? id.split(':')[1] : id);
export const DEFAULT_WATCHLIST = [
  { section: 'Indices' }, 'NSE:NIFTY', 'NSE:BANKNIFTY', 'BSE:SENSEX', 'NSE:INDIAVIX',
  { section: 'Stocks' }, 'NSE:RELIANCE', 'NSE:HDFCBANK', 'NSE:TCS', 'NSE:INFY', 'NSE:ICICIBANK', 'NSE:SBIN', 'NSE:TMPV', 'NSE:ITC',
  { section: 'Crypto' }, 'BINANCE:BTCUSDT', 'BINANCE:ETHUSDT', 'CRYPTO:BTCINR',
  { section: 'Gold & Commodities' }, 'BINANCE:XAUUSDT', 'INR:GOLD10G', 'COMEX:GC1!', 'INR:SILVER1KG', 'BINANCE:PAXGUSDT', 'NYMEX:CL1!', 'NSE:GOLDBEES',
  { section: 'Forex' }, 'FX:USDINR',
];
