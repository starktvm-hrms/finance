#!/usr/bin/env python3
"""Agency Finance storage API. Python 3 standard library only.

Keeps the whole dataset in one JSON file and applies small change operations
("ops") sent by the app, so two people editing at the same time don't overwrite
each other. Writes are atomic (temp file + rename) and a dated backup is kept
for each day the data changes (last 30 days).

Runs on 127.0.0.1 only; nginx proxies /api/ to it behind the site's login.

    GET  /data[?since=REV]  -> {"rev": n, "data": {...} | null}  or {"unchanged": true}
    POST /ops   {"ops":[...]} -> {"rev": n}
    GET  /health            -> {"ok": true, "rev": n}

Environment: FINANCE_DATA_DIR (default /var/lib/agency-finance),
             FINANCE_PORT (default 8791).
"""
import json
import os
import shutil
import sys
import threading
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DATA_DIR = Path(os.environ.get("FINANCE_DATA_DIR", "/var/lib/agency-finance"))
PORT = int(os.environ.get("FINANCE_PORT", "8791"))
DATA_FILE = DATA_DIR / "data.json"
BACKUP_DIR = DATA_DIR / "backups"
KEEP_BACKUPS = 30
MAX_BODY = 10 * 1024 * 1024
COLLECTIONS = {"clients", "projects", "estimates", "invoices", "expenses"}

lock = threading.Lock()
state = {"rev": 0, "data": None}


class BadRequest(Exception):
    pass


def load():
    if DATA_FILE.exists():
        doc = json.loads(DATA_FILE.read_text("utf-8"))
        state["rev"], state["data"] = int(doc.get("rev", 0)), doc.get("data")


def save():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    BACKUP_DIR.mkdir(exist_ok=True)
    today = BACKUP_DIR / f"data-{date.today().isoformat()}.json"
    if DATA_FILE.exists() and not today.exists():
        shutil.copy2(DATA_FILE, today)  # snapshot of the day's first state
        for old in sorted(BACKUP_DIR.glob("data-*.json"))[:-KEEP_BACKUPS]:
            old.unlink()
    tmp = DATA_FILE.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"rev": state["rev"], "data": state["data"]}, f, ensure_ascii=False)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, DATA_FILE)


def valid_dataset(d):
    # Collections added in later versions (e.g. estimates) may be missing in
    # older backups; any that are present must be lists.
    return isinstance(d, dict) and isinstance(d.get("settings"), dict) and all(
        isinstance(d.get(c, []), list) for c in COLLECTIONS
    )


def apply_op(d, o):
    """Mirror of applyOp() in src/lib/ops.ts."""
    if not isinstance(o, dict):
        raise BadRequest("op must be an object")
    kind = o.get("op")
    if kind == "replace":
        if not valid_dataset(o.get("data")):
            raise BadRequest("replace: invalid dataset")
        return o["data"]
    if d is None:
        raise BadRequest("no data yet; send a replace op first")
    if kind == "settings":
        if not isinstance(o.get("patch"), dict):
            raise BadRequest("settings: patch must be an object")
        return {**d, "settings": {**d["settings"], **o["patch"]}}
    col = o.get("col")
    if col not in COLLECTIONS:
        raise BadRequest(f"unknown collection {col!r}")
    items = d.get(col, [])
    if kind == "upsert":
        item = o.get("item")
        if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not item["id"]:
            raise BadRequest("upsert: item needs a string id")
        if any(x.get("id") == item["id"] for x in items):
            items = [item if x.get("id") == item["id"] else x for x in items]
        else:
            items = [item] + items
        return {**d, col: items}
    if kind == "remove":
        return {**d, col: [x for x in items if x.get("id") != o.get("id")]}
    raise BadRequest(f"unknown op {kind!r}")


class Handler(BaseHTTPRequestHandler):
    server_version = "AgencyFinance/1"

    def log_message(self, fmt, *args):  # journald gets method/path/status only
        sys.stderr.write("%s\n" % (fmt % args))

    def send(self, status, body):
        raw = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def route(self):
        return self.path.split("?", 1)[0].rstrip("/").removeprefix("/api") or "/"

    def do_GET(self):
        path, query = self.route(), self.path.partition("?")[2]
        with lock:
            rev, data = state["rev"], state["data"]
        if path == "/health":
            return self.send(200, {"ok": True, "rev": rev})
        if path == "/data":
            since = dict(p.split("=", 1) for p in query.split("&") if "=" in p).get("since")
            if since and since.isdigit() and int(since) == rev:
                return self.send(200, {"unchanged": True, "rev": rev})
            return self.send(200, {"rev": rev, "data": data})
        self.send(404, {"error": "not found"})

    def do_POST(self):
        if self.route() != "/ops":
            return self.send(404, {"error": "not found"})
        # JSON-only: a cross-site form can't send this content type without a
        # CORS preflight, which this server never approves (CSRF protection).
        if not self.headers.get("Content-Type", "").startswith("application/json"):
            return self.send(415, {"error": "expected application/json"})
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            return self.send(413, {"error": "body missing or too large"})
        try:
            ops = json.loads(self.rfile.read(length)).get("ops")
            if not isinstance(ops, list) or not ops:
                raise BadRequest("ops must be a non-empty list")
            with lock:
                prev = (state["rev"], state["data"])
                d = state["data"]
                for o in ops:
                    d = apply_op(d, o)
                state["data"], state["rev"] = d, state["rev"] + 1
                try:
                    save()
                except OSError:
                    state["rev"], state["data"] = prev  # keep memory == disk
                    raise
                rev = state["rev"]
        except (BadRequest, ValueError, AttributeError) as e:
            return self.send(400, {"error": str(e)})
        except OSError as e:
            return self.send(500, {"error": f"could not save: {e.strerror or e}"})
        self.send(200, {"rev": rev})


def main():
    load()
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Agency Finance API on 127.0.0.1:{PORT}, data in {DATA_DIR}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
