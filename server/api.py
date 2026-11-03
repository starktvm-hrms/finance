#!/usr/bin/env python3
"""Agency Finance storage API. Python 3 standard library only.

Keeps the whole dataset in one JSON file and applies small change operations
("ops") sent by the app, so two people editing at the same time don't overwrite
each other. Writes are atomic (temp file + rename) and a dated backup is kept
for each day the data changes (last 30 days).

Runs on 127.0.0.1 only; nginx proxies /api/ to it.

Sign-in: users live in users.json (PBKDF2-SHA256 hashes; Apache "$apr1$" hashes
imported from the old nginx login are accepted and upgraded on first sign-in).
A session is a random token in an HttpOnly, SameSite=Strict cookie; only its
SHA-256 is stored (sessions.json), so restarts don't sign anyone out.

    GET  /me                 -> {"user": name}   (401 when signed out)
    GET  /branding           -> {"agencyName", "logo"}  (public, for the login page)
    POST /login  {username, password, remember} -> {"user": name} + cookie
    POST /logout             -> {}
    POST /password {current, new}
    GET  /data[?since=REV]   -> {"rev": n, "data": {...} | null}  or {"unchanged": true}
    POST /ops   {"ops":[...]} -> {"rev": n}
    GET  /health             -> {"ok": true, "rev": n}

Until users.json exists (installs set up before sign-in existed, still behind
nginx's own login), the API runs in "legacy" mode and does not ask for a
sign-in. The setup script writes an `auth-required` marker; with it present
and no users, everything except /health and /branding is refused.

Manage users from the server (run as the service user):
    python3 api.py add-user NAME | passwd NAME | del-user NAME | list-users
    python3 api.py import-htpasswd FILE

Environment: FINANCE_DATA_DIR (default /var/lib/agency-finance),
             FINANCE_PORT (default 8791).
"""
import getpass
import hashlib
import hmac
import json
import os
import secrets
import shutil
import sys
import threading
import time
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DATA_DIR = Path(os.environ.get("FINANCE_DATA_DIR", "/var/lib/agency-finance"))
PORT = int(os.environ.get("FINANCE_PORT", "8791"))
DATA_FILE = DATA_DIR / "data.json"
BACKUP_DIR = DATA_DIR / "backups"
KEEP_BACKUPS = 30
MAX_BODY = 10 * 1024 * 1024
COLLECTIONS = {"clients", "vendors", "employees", "departments", "branches", "projects", "estimates", "invoices", "expenses"}

USERS_FILE = DATA_DIR / "users.json"
SESSIONS_FILE = DATA_DIR / "sessions.json"
AUTH_MARKER = DATA_DIR / "auth-required"
COOKIE = "fin_session"
SESSION_SHORT = 12 * 3600  # without "remember me"
SESSION_LONG = 30 * 24 * 3600
MAX_FAILS, FAIL_WINDOW = 5, 15 * 60
PBKDF2_ITERATIONS = 310_000

lock = threading.Lock()
auth_lock = threading.RLock()  # re-entrant: admin actions end sessions while holding it
state = {"rev": 0, "data": None}
fails: dict[str, list[float]] = {}


class BadRequest(Exception):
    pass


class Forbidden(Exception):
    pass


# ---------------------------------------------------------------- access (roles)
# Areas are the app's tabs. An admin has every area plus user management.
AREAS = ["dashboard", "jobs", "estimates", "invoices", "expenses", "directory", "people", "settings"]
# Collections each area may change.
AREA_COLS = {
    "jobs": {"projects"},
    "estimates": {"estimates"},
    "invoices": {"invoices"},
    "expenses": {"expenses"},
    "directory": {"clients", "vendors"},
    "people": {"employees", "departments", "branches"},
}
# Collections that are only sent to users with that area (everything else is
# shared reference data the pages need, e.g. client and job names).
PRIVATE_COLS = {"estimates": "estimates", "invoices": "invoices", "expenses": "expenses"}
# Settings a non-admin may move on, for the numbering of their own documents.
COUNTER_KEYS = {"nextJobNumber": "jobs", "nextEstimateNumber": "estimates", "nextInvoiceNumber": "invoices"}
DEFAULT_ROLES = [
    {"id": "department_head", "name": "Department head", "areas": ["dashboard", "jobs", "estimates", "directory", "people"]},
    {"id": "account_executive", "name": "Account executive", "areas": ["dashboard", "jobs", "estimates", "directory"]},
    {"id": "finance_executive", "name": "Finance executive", "areas": ["dashboard", "estimates", "invoices", "expenses", "directory"]},
]


def check_op(o: dict, admin: bool, areas: set):
    """Raise Forbidden unless this user may make this change."""
    if admin:
        return
    kind = o.get("op") if isinstance(o, dict) else None
    if kind == "replace":
        raise Forbidden("Only an admin can replace all the data.")
    if kind == "settings":
        if "settings" in areas:
            return
        for key in (o.get("patch") or {}):
            if COUNTER_KEYS.get(key) not in areas:
                raise Forbidden("You don't have access to change Settings.")
        return
    col = o.get("col")
    area = next((a for a, cols in AREA_COLS.items() if col in cols), None)
    if area not in areas:
        raise Forbidden(f"You don't have access to change {col or 'this'}.")
    # Clients, vendors and jobs are linked to estimates, invoices and expenses a
    # limited user may not see, so only an admin can delete them.
    if kind == "remove" and col in {"clients", "vendors", "projects"}:
        raise Forbidden("Only an admin can delete clients, vendors or jobs.")


def visible_data(data, admin: bool, areas: set):
    """The dataset as this user may see it (private collections emptied)."""
    if admin or data is None:
        return data
    return {**data, **{col: [] for col, area in PRIVATE_COLS.items() if area not in areas}}


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


# ---------------------------------------------------------------- passwords
_ITOA64 = "./0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"


def apr1(password: str, salt: str) -> str:
    """Apache MD5 crypt ($apr1$), as written by `openssl passwd -apr1` / htpasswd."""
    pw, sl, magic = password.encode(), salt.encode()[:8], b"$apr1$"
    final = hashlib.md5(pw + sl + pw).digest()
    ctx = pw + magic + sl
    n = len(pw)
    while n > 0:
        ctx += final[: min(16, n)]
        n -= 16
    i = len(pw)
    while i:
        ctx += b"\x00" if i & 1 else pw[:1]
        i >>= 1
    final = hashlib.md5(ctx).digest()
    for i in range(1000):
        c = (pw if i & 1 else final) + (sl if i % 3 else b"") + (pw if i % 7 else b"") + (final if i & 1 else pw)
        final = hashlib.md5(c).digest()

    def b64(v: int, n: int) -> str:
        out = ""
        for _ in range(n):
            out += _ITOA64[v & 0x3F]
            v >>= 6
        return out

    f = final
    enc = (b64((f[0] << 16) | (f[6] << 8) | f[12], 4) + b64((f[1] << 16) | (f[7] << 8) | f[13], 4)
           + b64((f[2] << 16) | (f[8] << 8) | f[14], 4) + b64((f[3] << 16) | (f[9] << 8) | f[15], 4)
           + b64((f[4] << 16) | (f[10] << 8) | f[5], 4) + b64(f[11], 2))
    return f"$apr1${sl.decode()}${enc}"


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt}${dk.hex()}"


def check_password(password: str, stored: str) -> bool:
    if stored.startswith("pbkdf2_sha256$"):
        _, it, salt, want = stored.split("$")
        got = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), int(it)).hex()
        return hmac.compare_digest(got, want)
    if stored.startswith("$apr1$"):
        salt = stored.split("$")[2]
        return hmac.compare_digest(apr1(password, salt), stored)
    return False


_DUMMY = hash_password(secrets.token_hex(8))  # equalises timing for unknown users


# ---------------------------------------------------------------- users & sessions
def _read_json(path: Path, default):
    try:
        return json.loads(path.read_text("utf-8"))
    except (FileNotFoundError, ValueError):
        return default


def _write_json(path: Path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(obj, f)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def users() -> dict:
    return _read_json(USERS_FILE, {}).get("users", {})


def save_users(u: dict):
    doc = _read_json(USERS_FILE, {})
    _write_json(USERS_FILE, {**doc, "users": u})


def roles() -> list:
    r = _read_json(USERS_FILE, {}).get("roles")
    return r if isinstance(r, list) and r else DEFAULT_ROLES


def save_roles(r: list):
    doc = _read_json(USERS_FILE, {})
    _write_json(USERS_FILE, {**doc, "roles": r})


def access_of(user: str | None) -> dict:
    """Role and areas of a user. Users without a role (e.g. imported) are admins."""
    if user == "":  # legacy mode: nginx login in front
        return {"admin": True, "role": "admin", "roleName": "Admin", "areas": AREAS}
    info = users().get(user or "", {})
    role = info.get("role") or "admin"
    if role == "admin":
        return {"admin": True, "role": "admin", "roleName": "Admin", "areas": AREAS}
    r = next((x for x in roles() if x.get("id") == role), None)
    areas = [a for a in (r or {}).get("areas", []) if a in AREAS]
    return {"admin": False, "role": role, "roleName": (r or {}).get("name", role), "areas": areas}


def auth_mode() -> str:
    """'on' (sign-in required), 'legacy' (behind nginx login) or 'locked' (marker, no users)."""
    if USERS_FILE.exists():
        return "on" if users() else "locked"
    return "locked" if AUTH_MARKER.exists() else "legacy"


def _token_key(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_session(user: str, remember: bool) -> tuple[str, int]:
    token = secrets.token_urlsafe(32)
    ttl = SESSION_LONG if remember else SESSION_SHORT
    now = time.time()
    with auth_lock:
        sess = {k: v for k, v in _read_json(SESSIONS_FILE, {}).items() if v.get("exp", 0) > now}
        sess[_token_key(token)] = {"user": user, "exp": now + ttl}
        _write_json(SESSIONS_FILE, sess)
    return token, ttl


def session_user(token: str | None) -> str | None:
    if not token:
        return None
    s = _read_json(SESSIONS_FILE, {}).get(_token_key(token))
    if not s or s.get("exp", 0) < time.time() or s.get("user") not in users():
        return None
    return s["user"]


def end_session(token: str | None, user: str | None = None):
    """Remove one session, or every session of `user` (password change / removal)."""
    with auth_lock:
        sess = _read_json(SESSIONS_FILE, {})
        if token:
            sess.pop(_token_key(token), None)
        if user:
            sess = {k: v for k, v in sess.items() if v.get("user") != user}
        _write_json(SESSIONS_FILE, sess)


def too_many(*keys: str) -> int:
    """Seconds to wait if any key has MAX_FAILS recent failures, else 0."""
    now = time.time()
    wait = 0
    for k in keys:
        recent = [t for t in fails.get(k, []) if t > now - FAIL_WINDOW]
        fails[k] = recent
        if len(recent) >= MAX_FAILS:
            wait = max(wait, int(recent[0] + FAIL_WINDOW - now) + 1)
    return wait


class Handler(BaseHTTPRequestHandler):
    server_version = "AgencyFinance/1"

    def log_message(self, fmt, *args):  # journald gets method/path/status only
        sys.stderr.write("%s\n" % (fmt % args))

    def send(self, status, body, cookie: str | None = None):
        raw = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(raw)))
        if cookie is not None:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(raw)

    def token(self) -> str | None:
        for part in self.headers.get("Cookie", "").split(";"):
            k, _, v = part.strip().partition("=")
            if k == COOKIE:
                return v
        return None

    def cookie(self, value: str, max_age: int | None) -> str:
        secure = "; Secure" if self.headers.get("X-Forwarded-Proto") == "https" else ""
        age = f"; Max-Age={max_age}" if max_age is not None else ""
        return f"{COOKIE}={value}; Path=/api; HttpOnly; SameSite=Strict{age}{secure}"

    def client_ip(self) -> str:
        return self.headers.get("X-Real-IP") or self.client_address[0]

    def user(self) -> str | None:
        """Signed-in user; '' in legacy mode (nginx login in front); None = refuse."""
        mode = auth_mode()
        if mode == "legacy":
            return ""
        if mode == "locked":
            return None
        return session_user(self.token())

    def json_body(self) -> dict:
        # JSON-only: a cross-site form can't send this content type without a
        # CORS preflight, which this server never approves (CSRF protection).
        if not self.headers.get("Content-Type", "").startswith("application/json"):
            raise BadRequest("expected application/json")
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            raise BadRequest("body missing or too large")
        body = json.loads(self.rfile.read(length))
        if not isinstance(body, dict):
            raise BadRequest("expected a JSON object")
        return body

    def route(self):
        return self.path.split("?", 1)[0].rstrip("/").removeprefix("/api") or "/"

    def do_GET(self):
        path, query = self.route(), self.path.partition("?")[2]
        with lock:
            rev, data = state["rev"], state["data"]
        if path == "/health":
            return self.send(200, {"ok": True, "rev": rev})
        if path == "/branding":
            st = (data or {}).get("settings", {})
            return self.send(200, {"agencyName": st.get("agencyName", ""), "logo": st.get("logo", ""), "logoIncludesName": st.get("logoIncludesName", True)})
        user = self.user()
        if path == "/me":
            if user is None:
                return self.send(401, {"error": "signed out", "mode": auth_mode()})
            acc = access_of(user)
            info = users().get(user or "", {})
            return self.send(200, {"user": user or None, "mode": auth_mode(), **acc, "employeeId": info.get("employeeId", "")})
        if user is None:
            return self.send(401, {"error": "Please sign in."})
        acc = access_of(user)
        if path == "/data":
            since = dict(p.split("=", 1) for p in query.split("&") if "=" in p).get("since")
            if since and since.isdigit() and int(since) == rev:
                return self.send(200, {"unchanged": True, "rev": rev})
            return self.send(200, {"rev": rev, "data": visible_data(data, acc["admin"], set(acc["areas"]))})
        if path == "/admin/access":
            if not acc["admin"]:
                return self.send(403, {"error": "Only an admin can manage logins."})
            u = users()
            listing = [{"username": n, "role": v.get("role") or "admin", "employeeId": v.get("employeeId", "")} for n, v in sorted(u.items())]
            return self.send(200, {"users": listing, "roles": roles(), "areas": AREAS})
        self.send(404, {"error": "not found"})

    def do_POST(self):
        path = self.route()
        try:
            body = self.json_body()
        except BadRequest as e:
            return self.send(415 if "json" in str(e) else 413 if "large" in str(e) else 400, {"error": str(e)})
        except ValueError:
            return self.send(400, {"error": "invalid JSON"})
        if path == "/login":
            return self.login(body)
        if path == "/logout":
            end_session(self.token())
            return self.send(200, {}, cookie=self.cookie("", 0))
        user = self.user()
        if user is None:
            return self.send(401, {"error": "Please sign in."})
        if path == "/password":
            return self.change_password(user, body)
        acc = access_of(user)
        if path == "/ops":
            return self.apply_ops(body, acc)
        if path.startswith("/admin/"):
            if not acc["admin"]:
                return self.send(403, {"error": "Only an admin can manage logins."})
            return self.admin(path, body, user)
        self.send(404, {"error": "not found"})

    def admin(self, path: str, body: dict, me: str):
        """User and role management (admins only)."""
        try:
            with auth_lock:
                u = users()
                if path == "/admin/roles":
                    rs = body.get("roles")
                    if not isinstance(rs, list):
                        raise BadRequest("roles must be a list")
                    clean = []
                    for r in rs:
                        rid = str(r.get("id", "")).strip()
                        name = str(r.get("name", "")).strip()
                        if not rid or not name or rid == "admin":
                            raise BadRequest("Every role needs a name (and 'admin' is reserved).")
                        clean.append({"id": rid, "name": name, "areas": [a for a in r.get("areas", []) if a in AREAS]})
                    in_use = {v.get("role") for v in u.values()} - {None, "admin"}
                    missing = in_use - {r["id"] for r in clean}
                    if missing:
                        raise BadRequest("A role still has logins; move them to another role first.")
                    save_roles(clean)
                    return self.send(200, {"roles": clean})
                if path == "/admin/users":
                    name = str(body.get("username", "")).strip()
                    if not name or any(c in name for c in ":$ "):
                        raise BadRequest("Usernames cannot be empty or contain spaces, ':' or '$'.")
                    role = str(body.get("role", "")).strip() or "admin"
                    if role != "admin" and role not in {r["id"] for r in roles()}:
                        raise BadRequest("Unknown role.")
                    existing = u.get(name)
                    if body.get("create") and existing:
                        raise BadRequest(f"There is already a login called {name}.")
                    if existing and name == me and role != "admin":
                        raise BadRequest("You can't remove your own admin access.")
                    pw = str(body.get("password") or "")
                    if not existing and len(pw) < 10:
                        raise BadRequest("The password needs at least 10 characters.")
                    if pw and len(pw) < 10:
                        raise BadRequest("The password needs at least 10 characters.")
                    entry = dict(existing or {})
                    entry["role"] = role
                    entry["employeeId"] = str(body.get("employeeId") or "")
                    if pw:
                        entry["hash"] = hash_password(pw)
                    u[name] = entry
                    save_users(u)
                    if pw and existing:
                        end_session(None, name)  # password reset signs them out everywhere
                    return self.send(200, {"ok": True})
                if path == "/admin/users/delete":
                    name = str(body.get("username", ""))
                    if name == me:
                        raise BadRequest("You can't delete your own login.")
                    if name not in u:
                        raise BadRequest("No such login.")
                    u.pop(name)
                    save_users(u)
                    end_session(None, name)
                    return self.send(200, {"ok": True})
        except BadRequest as e:
            return self.send(400, {"error": str(e)})
        self.send(404, {"error": "not found"})

    def login(self, body: dict):
        if auth_mode() == "legacy":
            return self.send(200, {"user": None, "mode": "legacy"})
        name = str(body.get("username", "")).strip()
        password = str(body.get("password", ""))
        keys = ("ip:" + self.client_ip(), "user:" + name.lower())
        with auth_lock:
            wait = too_many(*keys)
        if wait:
            return self.send(429, {"error": f"Too many attempts. Try again in {max(1, wait // 60)} minute(s).", "retryAfter": wait})
        u = users()
        stored = u.get(name, {}).get("hash")
        ok = check_password(password, stored or _DUMMY) and stored is not None
        if not ok:
            with auth_lock:
                for k in keys:
                    fails.setdefault(k, []).append(time.time())
            return self.send(401, {"error": "Wrong username or password."})
        with auth_lock:
            fails.pop(keys[0], None)
            fails.pop(keys[1], None)
            if not stored.startswith("pbkdf2_sha256$"):  # upgrade imported hashes
                u[name]["hash"] = hash_password(password)
                save_users(u)
        token, ttl = new_session(name, bool(body.get("remember")))
        self.send(200, {"user": name}, cookie=self.cookie(token, ttl if body.get("remember") else None))

    def change_password(self, user: str, body: dict):
        if not user:
            return self.send(400, {"error": "Passwords are managed by the server's login in this mode."})
        new = str(body.get("new", ""))
        if len(new) < 10:
            return self.send(400, {"error": "The new password needs at least 10 characters."})
        with auth_lock:
            u = users()
            if not check_password(str(body.get("current", "")), u.get(user, {}).get("hash", _DUMMY)):
                return self.send(400, {"error": "Your current password is not correct."})
            u[user]["hash"] = hash_password(new)
            save_users(u)
        end_session(None, user)  # sign out other devices
        token, ttl = new_session(user, True)
        self.send(200, {"ok": True}, cookie=self.cookie(token, ttl))

    def apply_ops(self, body: dict, acc: dict):
        try:
            ops = body.get("ops")
            if not isinstance(ops, list) or not ops:
                raise BadRequest("ops must be a non-empty list")
            for o in ops:
                check_op(o, acc["admin"], set(acc["areas"]))
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
        except Forbidden as e:
            return self.send(403, {"error": str(e)})
        except (BadRequest, ValueError, AttributeError) as e:
            return self.send(400, {"error": str(e)})
        except OSError as e:
            return self.send(500, {"error": f"could not save: {e.strerror or e}"})
        self.send(200, {"rev": rev})


# ---------------------------------------------------------------- command line
def _ask_password(name: str) -> str:
    pw = os.environ.get("FINANCE_PASSWORD")
    if pw is None:
        pw = getpass.getpass(f"Password for {name} (min 10 characters): ")
        if getpass.getpass("Repeat password: ") != pw:
            sys.exit("Passwords do not match.")
    if len(pw) < 10:
        sys.exit("Password needs at least 10 characters.")
    return pw


def cli(args: list[str]):
    cmd, rest = args[0], args[1:]
    u = users()
    if cmd == "list-users":
        print("\n".join(sorted(u)) or "(no users)")
    elif cmd in ("add-user", "passwd") and len(rest) == 1:
        name = rest[0].strip()
        if not name or any(c in name for c in ":$ "):
            sys.exit("Usernames cannot be empty or contain spaces, ':' or '$'.")
        if cmd == "add-user" and name in u:
            sys.exit(f"{name} already exists (use passwd to change the password).")
        if cmd == "passwd" and name not in u:
            sys.exit(f"No user called {name}.")
        u[name] = {"hash": hash_password(_ask_password(name))}
        save_users(u)
        end_session(None, name)
        print(f"Saved {name}.")
    elif cmd == "del-user" and len(rest) == 1:
        if u.pop(rest[0], None) is None:
            sys.exit(f"No user called {rest[0]}.")
        save_users(u)
        end_session(None, rest[0])
        print(f"Removed {rest[0]}.")
    elif cmd == "import-htpasswd" and len(rest) == 1:
        added = 0
        for line in Path(rest[0]).read_text().splitlines():
            name, _, h = line.strip().partition(":")
            if name and h.startswith("$apr1$") and name not in u:
                u[name] = {"hash": h}
                added += 1
        save_users(u)
        print(f"Imported {added} user(s).")
    else:
        sys.exit(__doc__)


def main():
    if len(sys.argv) > 1:
        return cli(sys.argv[1:])
    load()
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Agency Finance API on 127.0.0.1:{PORT}, data in {DATA_DIR}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
