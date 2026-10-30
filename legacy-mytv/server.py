#!/usr/bin/env python3
"""
MyTV server - serves the chart page and stores drawings + layouts in SQLite.

No dependencies (Python standard library only).

  python server.py

Environment (optional):
  TV_HOST   (default 127.0.0.1)
  TV_PORT   (default 8787)
  TV_DB     (default ./tradingview.db)
  TV_TOKEN  if set, API requires X-Token header
"""
import json
import os
import sqlite3
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import india_feed

BASE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("TV_DB", os.path.join(BASE, "tradingview.db"))
HOST = os.environ.get("TV_HOST", "127.0.0.1")
PORT = int(os.environ.get("TV_PORT", "8787"))
TOKEN = os.environ.get("TV_TOKEN", "")
INDEX = os.path.join(BASE, "index.html")

DEFAULT_PANELS = [
    {"s": "BTCUSDT", "tf": "1h"},
    {"s": "XAUUSDT", "tf": "1h"},
    {"s": "BTCUSDT", "tf": "15m"},
    {"s": "XAUUSDT", "tf": "4h"},
]
# Binance USD-M futures XAUUSDT ≈ Capital.com Gold Spot (~same $ level)
GOLD_TARGET = "XAUUSDT"
GOLD_ALIASES = ("GOLD", "XAUUSD", "PAXGUSDT")

lock = threading.Lock()


def connect():
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def cols(c, table):
    return {r["name"] for r in c.execute(f"PRAGMA table_info({table})")}


def init_db():
    with lock, connect() as c:
        c.executescript(
            """
            CREATE TABLE IF NOT EXISTS layouts(
                id         TEXT PRIMARY KEY,
                name       TEXT NOT NULL,
                grid       TEXT NOT NULL,
                panels     TEXT NOT NULL,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL,
                deleted_at REAL
            );
            CREATE TABLE IF NOT EXISTS drawings(
                id         TEXT PRIMARY KEY,
                layout_id  TEXT NOT NULL DEFAULT 'default',
                symbol     TEXT NOT NULL,
                data       TEXT NOT NULL,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL,
                deleted_at REAL
            );
            CREATE INDEX IF NOT EXISTS idx_drawings_layout ON drawings(layout_id, symbol, deleted_at);
            CREATE TABLE IF NOT EXISTS history(
                seq        INTEGER PRIMARY KEY AUTOINCREMENT,
                drawing_id TEXT NOT NULL,
                layout_id  TEXT,
                symbol     TEXT NOT NULL,
                action     TEXT NOT NULL,
                data       TEXT,
                ts         REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS settings(
                key        TEXT PRIMARY KEY,
                value      TEXT NOT NULL,
                updated_at REAL NOT NULL
            );
            """
        )
        # migrate older DBs that had drawings without layout_id
        dcols = cols(c, "drawings")
        if "layout_id" not in dcols:
            c.execute("ALTER TABLE drawings ADD COLUMN layout_id TEXT NOT NULL DEFAULT 'default'")
        hcols = cols(c, "history")
        if "layout_id" not in hcols:
            c.execute("ALTER TABLE history ADD COLUMN layout_id TEXT")

        n = c.execute("SELECT COUNT(*) AS n FROM layouts WHERE deleted_at IS NULL").fetchone()["n"]
        if n == 0:
            now = time.time()
            lid = "default"
            grid, panels = "2h", DEFAULT_PANELS
            row = c.execute("SELECT value FROM settings WHERE key='layout'").fetchone()
            if row:
                try:
                    old = json.loads(row["value"])
                    grid = old.get("layout") or grid
                    panels = old.get("panels") or panels
                except Exception:
                    pass
            c.execute(
                "INSERT INTO layouts(id,name,grid,panels,created_at,updated_at) VALUES(?,?,?,?,?,?)",
                (lid, "Default", grid, json.dumps(panels), now, now),
            )
            c.execute("UPDATE drawings SET layout_id=? WHERE layout_id IS NULL OR layout_id=''", (lid,))
            set_setting(c, "active_layout", lid)
        migrate_gold_symbol(c)


def migrate_gold_symbol(c):
    """Use Binance futures XAUUSDT (closest free match to Capital.com GOLD)."""
    for old in GOLD_ALIASES:
        c.execute(
            "UPDATE drawings SET symbol=?, updated_at=? WHERE symbol=? AND deleted_at IS NULL",
            (GOLD_TARGET, time.time(), old),
        )
        c.execute("UPDATE history SET symbol=? WHERE symbol=?", (GOLD_TARGET, old))
    for r in c.execute("SELECT id,panels FROM layouts WHERE deleted_at IS NULL"):
        try:
            panels = json.loads(r["panels"])
        except Exception:
            continue
        changed = False
        for p in panels:
            if p.get("s") in GOLD_ALIASES:
                p["s"] = GOLD_TARGET
                changed = True
        if changed:
            c.execute(
                "UPDATE layouts SET panels=?, updated_at=? WHERE id=?",
                (json.dumps(panels), time.time(), r["id"]),
            )
    row = c.execute("SELECT value FROM settings WHERE key='layout'").fetchone()
    if row:
        try:
            old = json.loads(row["value"])
            for p in old.get("panels") or []:
                if p.get("s") in GOLD_ALIASES:
                    p["s"] = GOLD_TARGET
            set_setting(c, "layout", old)
        except Exception:
            pass


def set_setting(c, key, value):
    c.execute(
        "INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
        (key, json.dumps(value), time.time()),
    )


def get_setting(c, key, default=None):
    row = c.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    if not row:
        return default
    try:
        return json.loads(row["value"])
    except Exception:
        return default


def rev(c):
    r = c.execute("SELECT COALESCE(MAX(seq),0) AS r FROM history").fetchone()["r"]
    s = c.execute("SELECT COALESCE(MAX(updated_at),0) AS s FROM settings").fetchone()["s"]
    l = c.execute("SELECT COALESCE(MAX(updated_at),0) AS l FROM layouts").fetchone()["l"]
    return f"{r}-{int(max(s, l) * 1000)}"


def list_layouts(c):
    out = []
    for r in c.execute(
        "SELECT id,name,grid,panels,created_at,updated_at FROM layouts "
        "WHERE deleted_at IS NULL ORDER BY created_at, rowid"
    ):
        out.append({
            "id": r["id"],
            "name": r["name"],
            "grid": r["grid"],
            "panels": json.loads(r["panels"]),
            "created_at": r["created_at"],
            "updated_at": r["updated_at"],
        })
    return out


def ensure_active(c):
    active = get_setting(c, "active_layout")
    ids = {L["id"] for L in list_layouts(c)}
    if active in ids:
        return active
    if ids:
        active = next(iter(ids))
        set_setting(c, "active_layout", active)
        return active
    now = time.time()
    lid = "default"
    c.execute(
        "INSERT INTO layouts(id,name,grid,panels,created_at,updated_at) VALUES(?,?,?,?,?,?)",
        (lid, "Default", "2h", json.dumps(DEFAULT_PANELS), now, now),
    )
    set_setting(c, "active_layout", lid)
    return lid


def drawings_for(c, layout_id):
    out = {}
    for r in c.execute(
        "SELECT symbol,data FROM drawings WHERE layout_id=? AND deleted_at IS NULL "
        "ORDER BY created_at, rowid",
        (layout_id,),
    ):
        out.setdefault(r["symbol"], []).append(json.loads(r["data"]))
    return out


def replace_symbol(c, layout_id, symbol, items):
    now = time.time()
    live = {
        r["id"]: r["data"]
        for r in c.execute(
            "SELECT id,data FROM drawings WHERE layout_id=? AND symbol=? AND deleted_at IS NULL",
            (layout_id, symbol),
        )
    }
    seen = set()
    for d in items:
        if not isinstance(d, dict):
            continue
        did = str(d.get("id") or uuid.uuid4().hex)
        d["id"] = did
        data = json.dumps(d, separators=(",", ":"))
        seen.add(did)
        row = c.execute(
            "SELECT data,deleted_at,symbol,layout_id FROM drawings WHERE id=?", (did,)
        ).fetchone()
        if row is None:
            c.execute(
                "INSERT INTO drawings(id,layout_id,symbol,data,created_at,updated_at) VALUES(?,?,?,?,?,?)",
                (did, layout_id, symbol, data, now, now),
            )
            c.execute(
                "INSERT INTO history(drawing_id,layout_id,symbol,action,data,ts) VALUES(?,?,?,?,?,?)",
                (did, layout_id, symbol, "create", data, now),
            )
        elif (
            row["data"] != data
            or row["deleted_at"] is not None
            or row["symbol"] != symbol
            or row["layout_id"] != layout_id
        ):
            action = "restore" if row["deleted_at"] is not None else "update"
            c.execute(
                "UPDATE drawings SET data=?,symbol=?,layout_id=?,updated_at=?,deleted_at=NULL WHERE id=?",
                (data, symbol, layout_id, now, did),
            )
            c.execute(
                "INSERT INTO history(drawing_id,layout_id,symbol,action,data,ts) VALUES(?,?,?,?,?,?)",
                (did, layout_id, symbol, action, data, now),
            )
    for did, data in live.items():
        if did not in seen:
            c.execute(
                "UPDATE drawings SET deleted_at=?,updated_at=? WHERE id=?", (now, now, did)
            )
            c.execute(
                "INSERT INTO history(drawing_id,layout_id,symbol,action,data,ts) VALUES(?,?,?,?,?,?)",
                (did, layout_id, symbol, "delete", data, now),
            )
    c.execute("UPDATE layouts SET updated_at=? WHERE id=?", (now, layout_id))


class Handler(BaseHTTPRequestHandler):
    server_version = "MyTV/1.1"

    def log_message(self, fmt, *args):
        if "/api/rev" not in (args[0] if args else ""):
            super().log_message(fmt, *args)

    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Token")
        self.send_header("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def send_json(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def authorized(self):
        if not TOKEN:
            return True
        return self.headers.get("X-Token", "") == TOKEN

    def read_json(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > 20 * 1024 * 1024:
            raise ValueError("too large")
        return json.loads(self.rfile.read(n) or b"null")

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.end_headers()

    def do_GET(self):
        u = urlparse(self.path)
        if u.path in ("/", "/index.html"):
            try:
                with open(INDEX, "rb") as f:
                    body = f.read()
            except OSError:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        if not u.path.startswith("/api/"):
            self.send_error(404)
            return
        if not self.authorized():
            return self.send_json({"error": "unauthorized"}, 401)
        q = parse_qs(u.query)
        try:
            with lock, connect() as c:
                active = ensure_active(c)
                if u.path == "/api/rev":
                    return self.send_json({"rev": rev(c), "active": active})
                if u.path == "/api/india/symbols":
                    return self.send_json({"symbols": india_feed.catalog()})
                if u.path == "/api/india/search":
                    q = (q.get("q") or [""])[0]
                    return self.send_json({"results": india_feed.search(q)})
                if u.path == "/api/klines":
                    sym = (q.get("symbol") or [""])[0]
                    interval = (q.get("interval") or ["1d"])[0]
                    limit = int((q.get("limit") or ["1000"])[0])
                    end = q.get("endTime")
                    end_ms = int(end[0]) if end and end[0] else None
                    bars, meta = india_feed.klines(sym, interval, limit, end_ms)
                    return self.send_json({
                        "symbol": meta.get("symbol") or sym,
                        "meta": meta,
                        "source": "yahoo",
                        "candles": bars,
                    })
                if u.path == "/api/bootstrap":
                    lid = (q.get("layout") or [active])[0]
                    if lid not in {L["id"] for L in list_layouts(c)}:
                        lid = active
                    return self.send_json({
                        "layouts": list_layouts(c),
                        "active": lid,
                        "drawings": drawings_for(c, lid),
                        "settings": all_settings(c),
                        "rev": rev(c),
                    })
                if u.path == "/api/layouts":
                    return self.send_json({"layouts": list_layouts(c), "active": active, "rev": rev(c)})
                if u.path == "/api/drawings":
                    lid = (q.get("layout") or [active])[0]
                    return self.send_json({"drawings": drawings_for(c, lid), "layout": lid, "rev": rev(c)})
                if u.path == "/api/history":
                    limit = min(int((q.get("limit") or ["100"])[0]), 1000)
                    lid = (q.get("layout") or [active])[0]
                    rows = [
                        dict(r)
                        for r in c.execute(
                            "SELECT seq,drawing_id,layout_id,symbol,action,data,ts FROM history "
                            "WHERE layout_id=? OR layout_id IS NULL ORDER BY seq DESC LIMIT ?",
                            (lid, limit),
                        )
                    ]
                    for r in rows:
                        try:
                            r["type"] = json.loads(r["data"] or "{}").get("type")
                        except Exception:
                            r["type"] = None
                        r.pop("data", None)
                    return self.send_json({"history": rows, "layout": lid})
        except Exception as e:  # noqa: BLE001
            return self.send_json({"error": str(e)}, 500)
        self.send_error(404)

    def do_PUT(self):
        u = urlparse(self.path)
        if not self.authorized():
            return self.send_json({"error": "unauthorized"}, 401)
        parts = [p for p in u.path.split("/") if p]
        try:
            body = self.read_json() if self.headers.get("Content-Length") else {}
            with lock, connect() as c:
                # PUT /api/drawings/<layout_id>/<symbol>
                if len(parts) == 4 and parts[:2] == ["api", "drawings"]:
                    items = body.get("drawings") if isinstance(body, dict) else None
                    if not isinstance(items, list):
                        return self.send_json({"error": "expected {drawings:[...]}"}, 400)
                    if not c.execute(
                        "SELECT 1 FROM layouts WHERE id=? AND deleted_at IS NULL", (parts[2],)
                    ).fetchone():
                        return self.send_json({"error": "layout not found"}, 404)
                    replace_symbol(c, parts[2], parts[3], items)
                    return self.send_json({"ok": True, "rev": rev(c)})
                # legacy PUT /api/drawings/<symbol> → active layout
                if len(parts) == 3 and parts[:2] == ["api", "drawings"]:
                    items = body.get("drawings") if isinstance(body, dict) else None
                    if not isinstance(items, list):
                        return self.send_json({"error": "expected {drawings:[...]}"}, 400)
                    lid = ensure_active(c)
                    replace_symbol(c, lid, parts[2], items)
                    return self.send_json({"ok": True, "rev": rev(c), "layout": lid})
                # PUT /api/layouts/<id>
                if len(parts) == 3 and parts[:2] == ["api", "layouts"]:
                    row = c.execute(
                        "SELECT id FROM layouts WHERE id=? AND deleted_at IS NULL", (parts[2],)
                    ).fetchone()
                    if not row:
                        return self.send_json({"error": "layout not found"}, 404)
                    now = time.time()
                    name = body.get("name")
                    grid = body.get("grid")
                    panels = body.get("panels")
                    if name is not None:
                        c.execute("UPDATE layouts SET name=?, updated_at=? WHERE id=?", (str(name)[:80], now, parts[2]))
                    if grid is not None:
                        c.execute("UPDATE layouts SET grid=?, updated_at=? WHERE id=?", (str(grid), now, parts[2]))
                    if panels is not None:
                        c.execute(
                            "UPDATE layouts SET panels=?, updated_at=? WHERE id=?",
                            (json.dumps(panels), now, parts[2]),
                        )
                    if body.get("activate"):
                        set_setting(c, "active_layout", parts[2])
                    return self.send_json({"ok": True, "layouts": list_layouts(c), "active": ensure_active(c), "rev": rev(c)})
                if len(parts) == 3 and parts[:2] == ["api", "settings"]:
                    set_setting(c, parts[2], body)
                    return self.send_json({"ok": True, "rev": rev(c)})
        except Exception as e:  # noqa: BLE001
            return self.send_json({"error": str(e)}, 500)
        self.send_error(404)

    def do_POST(self):
        u = urlparse(self.path)
        if not self.authorized():
            return self.send_json({"error": "unauthorized"}, 401)
        parts = [p for p in u.path.split("/") if p]
        try:
            body = self.read_json() if self.headers.get("Content-Length") else {}
            with lock, connect() as c:
                # POST /api/layouts  {name, copyFrom?, grid?, panels?}
                if parts == ["api", "layouts"]:
                    now = time.time()
                    lid = uuid.uuid4().hex[:12]
                    name = (body.get("name") or "Untitled").strip()[:80] or "Untitled"
                    src = body.get("copyFrom")
                    grid, panels = "2h", list(DEFAULT_PANELS)
                    if src:
                        row = c.execute(
                            "SELECT grid,panels FROM layouts WHERE id=? AND deleted_at IS NULL", (src,)
                        ).fetchone()
                        if row:
                            grid, panels = row["grid"], json.loads(row["panels"])
                    if body.get("grid"):
                        grid = body["grid"]
                    if body.get("panels"):
                        panels = body["panels"]
                    c.execute(
                        "INSERT INTO layouts(id,name,grid,panels,created_at,updated_at) VALUES(?,?,?,?,?,?)",
                        (lid, name, grid, json.dumps(panels), now, now),
                    )
                    # empty drawings by default; optional copyDrawings
                    if body.get("copyDrawings") and src:
                        for r in c.execute(
                            "SELECT symbol,data FROM drawings WHERE layout_id=? AND deleted_at IS NULL",
                            (src,),
                        ):
                            did = uuid.uuid4().hex
                            data = r["data"]
                            try:
                                d = json.loads(data)
                                d["id"] = did
                                data = json.dumps(d, separators=(",", ":"))
                            except Exception:
                                pass
                            c.execute(
                                "INSERT INTO drawings(id,layout_id,symbol,data,created_at,updated_at) VALUES(?,?,?,?,?,?)",
                                (did, lid, r["symbol"], data, now, now),
                            )
                            c.execute(
                                "INSERT INTO history(drawing_id,layout_id,symbol,action,data,ts) VALUES(?,?,?,?,?,?)",
                                (did, lid, r["symbol"], "create", data, now),
                            )
                    set_setting(c, "active_layout", lid)
                    return self.send_json({
                        "ok": True,
                        "layout": {"id": lid, "name": name, "grid": grid, "panels": panels},
                        "layouts": list_layouts(c),
                        "active": lid,
                        "drawings": drawings_for(c, lid),
                        "rev": rev(c),
                    })
                if len(parts) == 3 and parts[:2] == ["api", "restore"]:
                    did = parts[2]
                    row = c.execute(
                        "SELECT layout_id,symbol,data FROM drawings WHERE id=?", (did,)
                    ).fetchone()
                    if not row:
                        return self.send_json({"error": "not found"}, 404)
                    now = time.time()
                    c.execute(
                        "UPDATE drawings SET deleted_at=NULL, updated_at=? WHERE id=?", (now, did)
                    )
                    c.execute(
                        "INSERT INTO history(drawing_id,layout_id,symbol,action,data,ts) VALUES(?,?,?,?,?,?)",
                        (did, row["layout_id"], row["symbol"], "restore", row["data"], now),
                    )
                    return self.send_json({"ok": True, "rev": rev(c), "layout": row["layout_id"]})
        except Exception as e:  # noqa: BLE001
            return self.send_json({"error": str(e)}, 500)
        self.send_error(404)

    def do_DELETE(self):
        u = urlparse(self.path)
        if not self.authorized():
            return self.send_json({"error": "unauthorized"}, 401)
        parts = [p for p in u.path.split("/") if p]
        try:
            with lock, connect() as c:
                if len(parts) == 3 and parts[:2] == ["api", "layouts"]:
                    lid = parts[2]
                    live = [L for L in list_layouts(c) if L["id"] != lid]
                    if not live:
                        return self.send_json({"error": "cannot delete the last layout"}, 400)
                    now = time.time()
                    c.execute(
                        "UPDATE layouts SET deleted_at=?, updated_at=? WHERE id=?", (now, now, lid)
                    )
                    # soft-delete drawings belonging to this layout
                    for r in c.execute(
                        "SELECT id,symbol,data FROM drawings WHERE layout_id=? AND deleted_at IS NULL",
                        (lid,),
                    ):
                        c.execute(
                            "UPDATE drawings SET deleted_at=?, updated_at=? WHERE id=?",
                            (now, now, r["id"]),
                        )
                        c.execute(
                            "INSERT INTO history(drawing_id,layout_id,symbol,action,data,ts) VALUES(?,?,?,?,?,?)",
                            (r["id"], lid, r["symbol"], "delete", r["data"], now),
                        )
                    active = ensure_active(c)
                    if get_setting(c, "active_layout") == lid:
                        set_setting(c, "active_layout", live[0]["id"])
                        active = live[0]["id"]
                    return self.send_json({
                        "ok": True,
                        "layouts": list_layouts(c),
                        "active": active,
                        "drawings": drawings_for(c, active),
                        "rev": rev(c),
                    })
        except Exception as e:  # noqa: BLE001
            return self.send_json({"error": str(e)}, 500)
        self.send_error(404)


def all_settings(c):
    return {r["key"]: json.loads(r["value"]) for r in c.execute("SELECT key,value FROM settings")}


def main():
    init_db()
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    where = "this PC only" if HOST in ("127.0.0.1", "localhost") else "all network interfaces"
    print(f"MyTV running:  http://{'localhost' if HOST == '127.0.0.1' else HOST}:{PORT}   ({where})")
    print(f"Database:      {DB_PATH}")
    print("API password:  " + ("ON (TV_TOKEN)" if TOKEN else "off (set TV_TOKEN before exposing to the internet)"))
    print("Press Ctrl+C to stop.")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
