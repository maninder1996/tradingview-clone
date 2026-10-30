"""Indian market candles via Yahoo Finance (NSE/BSE). No API key."""
import json
import ssl
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

_ctx = ssl.create_default_context()

# Major indices + Nifty 50 + Nifty Next 50 (Yahoo suffixes)
INDICES = [
    ("^NSEI", "Nifty 50"),
    ("^NSEBANK", "Bank Nifty"),
    ("^BSESN", "Sensex"),
    ("^CNXIT", "Nifty IT"),
    ("^CNXPHARMA", "Nifty Pharma"),
    ("^CNXAUTO", "Nifty Auto"),
    ("^CNXMETAL", "Nifty Metal"),
    ("^CNXFMCG", "Nifty FMCG"),
    ("^CNXENERGY", "Nifty Energy"),
    ("^INDIAVIX", "India VIX"),
]

NIFTY50 = [
    ("RELIANCE.NS", "Reliance"),
    ("TCS.NS", "TCS"),
    ("HDFCBANK.NS", "HDFC Bank"),
    ("ICICIBANK.NS", "ICICI Bank"),
    ("INFY.NS", "Infosys"),
    ("BHARTIARTL.NS", "Bharti Airtel"),
    ("ITC.NS", "ITC"),
    ("SBIN.NS", "SBI"),
    ("LT.NS", "Larsen & Toubro"),
    ("AXISBANK.NS", "Axis Bank"),
    ("KOTAKBANK.NS", "Kotak Bank"),
    ("BAJFINANCE.NS", "Bajaj Finance"),
    ("HINDUNILVR.NS", "Hindustan Unilever"),
    ("SUNPHARMA.NS", "Sun Pharma"),
    ("MARUTI.NS", "Maruti Suzuki"),
    ("TITAN.NS", "Titan"),
    ("NTPC.NS", "NTPC"),
    ("ONGC.NS", "ONGC"),
    ("POWERGRID.NS", "Power Grid"),
    ("ULTRACEMCO.NS", "UltraTech Cement"),
    ("M&M.NS", "Mahindra & Mahindra"),
    ("TATAMOTORS.NS", "Tata Motors"),
    ("TATASTEEL.NS", "Tata Steel"),
    ("ADANIENT.NS", "Adani Enterprises"),
    ("ADANIPORTS.NS", "Adani Ports"),
    ("WIPRO.NS", "Wipro"),
    ("HCLTECH.NS", "HCL Tech"),
    ("TECHM.NS", "Tech Mahindra"),
    ("ASIANPAINT.NS", "Asian Paints"),
    ("NESTLEIND.NS", "Nestlé India"),
    ("COALINDIA.NS", "Coal India"),
    ("JSWSTEEL.NS", "JSW Steel"),
    ("BAJAJFINSV.NS", "Bajaj Finserv"),
    ("BAJAJ-AUTO.NS", "Bajaj Auto"),
    ("HDFCLIFE.NS", "HDFC Life"),
    ("SBILIFE.NS", "SBI Life"),
    ("GRASIM.NS", "Grasim"),
    ("CIPLA.NS", "Cipla"),
    ("DRREDDY.NS", "Dr Reddy's"),
    ("APOLLOHOSP.NS", "Apollo Hospitals"),
    ("EICHERMOT.NS", "Eicher Motors"),
    ("HEROMOTOCO.NS", "Hero MotoCorp"),
    ("BPCL.NS", "BPCL"),
    ("BRITANNIA.NS", "Britannia"),
    ("HINDALCO.NS", "Hindalco"),
    ("INDUSINDBK.NS", "IndusInd Bank"),
    ("TATACONSUM.NS", "Tata Consumer"),
    ("TRENT.NS", "Trent"),
    ("BEL.NS", "Bharat Electronics"),
    ("SHRIRAMFIN.NS", "Shriram Finance"),
]

NIFTY_NEXT50 = [
    ("ABB.NS", "ABB India"),
    ("AMBUJACEM.NS", "Ambuja Cements"),
    ("AUROPHARMA.NS", "Aurobindo Pharma"),
    ("BANKBARODA.NS", "Bank of Baroda"),
    ("BOSCHLTD.NS", "Bosch"),
    ("CANBK.NS", "Canara Bank"),
    ("CHOLAFIN.NS", "Cholamandalam"),
    ("COLPAL.NS", "Colgate-Palmolive"),
    ("DABUR.NS", "Dabur"),
    ("DIVISLAB.NS", "Divi's Labs"),
    ("DLF.NS", "DLF"),
    ("GAIL.NS", "GAIL"),
    ("GODREJCP.NS", "Godrej Consumer"),
    ("HAVELLS.NS", "Havells"),
    ("ICICIGI.NS", "ICICI Lombard"),
    ("ICICIPRULI.NS", "ICICI Prudential"),
    ("INDIGO.NS", "InterGlobe (IndiGo)"),
    ("IOC.NS", "Indian Oil"),
    ("IRCTC.NS", "IRCTC"),
    ("JINDALSTEL.NS", "Jindal Steel"),
    ("LICI.NS", "LIC India"),
    ("LODHA.NS", "Macrotech (Lodha)"),
    ("LUPIN.NS", "Lupin"),
    ("MUTHOOTFIN.NS", "Muthoot Finance"),
    ("NAUKRI.NS", "Info Edge"),
    ("NHPC.NS", "NHPC"),
    ("NMDC.NS", "NMDC"),
    ("OFSS.NS", "Oracle Fin Serv"),
    ("PAGEIND.NS", "Page Industries"),
    ("PEL.NS", "Piramal Enterprises"),
    ("PFC.NS", "Power Finance"),
    ("PIDILITIND.NS", "Pidilite"),
    ("PNB.NS", "Punjab National Bank"),
    ("POLYCAB.NS", "Polycab"),
    ("RECLTD.NS", "REC"),
    ("SAIL.NS", "SAIL"),
    ("SIEMENS.NS", "Siemens"),
    ("SRF.NS", "SRF"),
    ("TORNTPHARM.NS", "Torrent Pharma"),
    ("TVSMOTOR.NS", "TVS Motor"),
    ("UNITDSPR.NS", "United Spirits"),
    ("VBL.NS", "Varun Beverages"),
    ("VEDL.NS", "Vedanta"),
    ("VOLTAS.NS", "Voltas"),
    ("YESBANK.NS", "Yes Bank"),
    ("ZOMATO.NS", "Zomato"),
    ("ZYDUSLIFE.NS", "Zydus Lifesciences"),
    ("ATGL.NS", "Adani Total Gas"),
    ("HAL.NS", "Hindustan Aeronautics"),
    ("MAXHEALTH.NS", "Max Healthcare"),
]

# NOTE: Yahoo's range=max with interval=1d silently returns MONTHLY bars — never use max for daily.
YAHOO_INTERVAL = {
    "1m": ("1m", "7d"),
    "5m": ("5m", "60d"),
    "15m": ("15m", "60d"),
    "30m": ("30m", "60d"),
    "1h": ("60m", "730d"),
    "4h": ("60m", "730d"),
    "1d": ("1d", "5y"),
    "1w": ("1wk", "10y"),
}


def catalog():
    out = []
    for s, n in INDICES:
        out.append({"id": s, "name": n, "group": "India · Indices", "yahoo": s})
    for s, n in NIFTY50:
        out.append({"id": s, "name": n, "group": "India · Nifty 50", "yahoo": s})
    for s, n in NIFTY_NEXT50:
        out.append({"id": s, "name": n, "group": "India · Nifty Next 50", "yahoo": s})
    return out


def is_india(symbol: str) -> bool:
    s = (symbol or "").upper()
    if s.endswith(".NS") or s.endswith(".BO"):
        return True
    if s.startswith("^NSE") or s.startswith("^BSE") or s.startswith("^CNX") or s.startswith("^INDIA"):
        return True
    return any(s == x[0].upper() for x in INDICES)


def _http(url, timeout=20):
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, context=_ctx, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode() or "null")
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        try:
            body = json.loads(raw) if raw else {"error": str(e)}
        except Exception:
            body = {"error": raw or str(e)}
        return e.code, body


def aggregate(bars, bucket_sec):
    if not bars:
        return []
    out, cur = [], None
    for b in bars:
        slot = (b["time"] // bucket_sec) * bucket_sec
        if not cur or cur["time"] != slot:
            if cur:
                out.append(cur)
            cur = dict(b)
            cur["time"] = slot
        else:
            cur["high"] = max(cur["high"], b["high"])
            cur["low"] = min(cur["low"], b["low"])
            cur["close"] = b["close"]
            cur["vol"] += b["vol"]
    if cur:
        out.append(cur)
    return out


def yahoo_symbol(sym: str) -> str:
    s = (sym or "").strip()
    if not s:
        raise ValueError("empty symbol")
    # bare NSE ticker → .NS
    if "." not in s and not s.startswith("^"):
        s = s.upper() + ".NS"
    return s


def klines(symbol, interval, limit=1000, end_time_ms=None):
    if interval not in YAHOO_INTERVAL:
        raise ValueError("unsupported interval")
    ysym = yahoo_symbol(symbol)
    yint, yrange = YAHOO_INTERVAL[interval]
    enc = urllib.parse.quote(ysym, safe="^")
    if end_time_ms:
        end = int(end_time_ms / 1000)
        span = {"1m": 7, "5m": 60, "15m": 60, "30m": 60, "1h": 730, "4h": 730, "1d": 3650, "1w": 7300}.get(interval, 60)
        url = (
            f"https://query1.finance.yahoo.com/v8/finance/chart/{enc}"
            f"?interval={yint}&period1={end - span * 86400}&period2={end}"
        )
    else:
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{enc}?interval={yint}&range={yrange}"
    status, body = _http(url)
    if status >= 400:
        raise RuntimeError(f"Yahoo HTTP {status}")
    result = ((body.get("chart") or {}).get("result") or [None])[0]
    if not result:
        err = ((body.get("chart") or {}).get("error") or {}).get("description") or "no data"
        raise RuntimeError(err)
    ts = result.get("timestamp") or []
    q0 = ((result.get("indicators") or {}).get("quote") or [{}])[0]
    opens, highs, lows, closes = q0.get("open") or [], q0.get("high") or [], q0.get("low") or [], q0.get("close") or []
    vols = q0.get("volume") or []
    out = []
    for i, t in enumerate(ts):
        o = opens[i] if i < len(opens) else None
        h = highs[i] if i < len(highs) else None
        l = lows[i] if i < len(lows) else None
        c = closes[i] if i < len(closes) else None
        if None in (o, h, l, c):
            continue
        out.append({
            "time": int(t),
            "open": float(o),
            "high": float(h),
            "low": float(l),
            "close": float(c),
            "vol": float(vols[i] if i < len(vols) and vols[i] is not None else 0),
        })
    if interval == "4h":
        out = aggregate(out, 4 * 3600)
    limit = max(1, min(int(limit or 1000), 1000))
    if end_time_ms:
        end = end_time_ms / 1000.0
        out = [b for b in out if b["time"] < end]
    meta = result.get("meta") or {}
    return out[-limit:], {
        "symbol": meta.get("symbol") or ysym,
        "name": meta.get("shortName") or meta.get("longName") or ysym,
        "price": meta.get("regularMarketPrice"),
        "currency": meta.get("currency") or "INR",
        "exchange": meta.get("fullExchangeName") or meta.get("exchangeName"),
    }


def search(q, limit=25):
    q = (q or "").strip()
    if not q:
        return []
    # local catalog first
    ql = q.lower()
    local = []
    for row in catalog():
        if ql in row["id"].lower() or ql in row["name"].lower():
            local.append({**row, "source": "catalog"})
    url = (
        "https://query1.finance.yahoo.com/v1/finance/search?"
        + urllib.parse.urlencode({
            "q": q,
            "quotesCount": limit,
            "newsCount": 0,
            "listsCount": 0,
            "enableFuzzyQuery": "true",
        })
    )
    status, body = _http(url)
    remote = []
    if status < 400:
        for quote in body.get("quotes") or []:
            exch = (quote.get("exchange") or quote.get("exchDisp") or "").upper()
            sym = quote.get("symbol") or ""
            if exch in ("NSI", "NSE", "BSE", "BOM") or sym.endswith(".NS") or sym.endswith(".BO"):
                remote.append({
                    "id": sym,
                    "name": quote.get("shortname") or quote.get("longname") or sym,
                    "group": "India · Search",
                    "yahoo": sym,
                    "source": "yahoo",
                })
            # bare Indian tickers sometimes come back without suffix
            elif quote.get("quoteType") in ("EQUITY", "ETF", "INDEX") and exch in ("NSI", "BSE"):
                suffix = ".NS" if exch == "NSI" else ".BO"
                sid = sym if "." in sym else sym + suffix
                remote.append({
                    "id": sid,
                    "name": quote.get("shortname") or quote.get("longname") or sid,
                    "group": "India · Search",
                    "yahoo": sid,
                    "source": "yahoo",
                })
    # merge unique by id
    seen, out = set(), []
    for row in local + remote:
        if row["id"] in seen:
            continue
        seen.add(row["id"])
        out.append(row)
        if len(out) >= limit:
            break
    return out
