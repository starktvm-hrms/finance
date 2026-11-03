#!/usr/bin/env bash
# One-time setup of finance.starkpeople.in on an existing nginx VPS.
#
# Run as root (e.g. in hPanel → VPS → Browser terminal):
#   curl -fsSL https://raw.githubusercontent.com/starktvm-hrms/finance/main/deploy/vps-setup.sh -o /tmp/finance-setup.sh && sudo bash /tmp/finance-setup.sh
#
# Non-interactive: FINANCE_USER=admin FINANCE_PASS='...' bash vps-setup.sh
#
# What it ADDS (nothing existing is edited or removed):
#   /var/www/finance.starkpeople.in/              the built app (a checkout of the `deploy` branch)
#   nginx site file for finance.starkpeople.in    sites-available + symlink, or conf.d
#   /etc/cron.d/finance-starkpeople               pulls new builds every 5 minutes
#   /etc/systemd/system/agency-finance.service    storage API (python3, 127.0.0.1 only)
#   /var/lib/agency-finance/                      the data, 30 days of daily backups, and the
#                                                 app's sign-in users (users.json)
#   system user `agency-finance`                  runs the API with no other access
#   a Let's Encrypt certificate for this subdomain only (if certbot is installed)
#
# Sign-in happens on the app's own login page (checked by the API). Installs
# that used the older browser pop-up login (nginx basic auth) are upgraded:
# that username/password is imported, and basic auth is removed from this
# site's nginx file only.
#
# Safe to re-run: it only rewrites its own files. If nginx rejects the new
# config, the new site file is removed again and nginx is left untouched.
set -euo pipefail

DOMAIN="finance.starkpeople.in"
REPO="${REPO:-https://github.com/starktvm-hrms/finance.git}"
BRANCH="${BRANCH:-deploy}"
WEBROOT="/var/www/${DOMAIN}"
HTPASSWD="/etc/nginx/${DOMAIN}.htpasswd"
CRON_FILE="/etc/cron.d/finance-starkpeople"
SERVICE="agency-finance"
SERVICE_FILE="/etc/systemd/system/${SERVICE}.service"
DATA_DIR="/var/lib/agency-finance"
API_PORT="${FINANCE_PORT:-8791}"

say()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "run as root (use sudo)."
command -v nginx >/dev/null || fail "nginx is not installed on this server."
command -v git >/dev/null || fail "git is not installed. Install it with: apt-get install -y git"
command -v openssl >/dev/null || fail "openssl is not installed."
command -v python3 >/dev/null || fail "python3 is not installed. Install it with: apt-get install -y python3"
command -v systemctl >/dev/null || fail "systemd is required."

# Where this server keeps its nginx sites.
if [ -d /etc/nginx/sites-enabled ] && grep -Rqs "sites-enabled" /etc/nginx/nginx.conf; then
  SITE_FILE="/etc/nginx/sites-available/${DOMAIN}"
  SITE_LINK="/etc/nginx/sites-enabled/${DOMAIN}"
else
  SITE_FILE="/etc/nginx/conf.d/${DOMAIN}.conf"
  SITE_LINK=""
fi

# Never take over a domain that another config already serves.
OTHER=$(grep -RlsE "server_name[^;]*\b${DOMAIN//./\\.}\b" /etc/nginx 2>/dev/null \
  | grep -vxF "$SITE_FILE" | grep -vxF "${SITE_LINK:-/nonexistent}" || true)
[ -z "$OTHER" ] || fail "${DOMAIN} is already configured in: ${OTHER}. Nothing was changed."

# 1. App files
say "Fetching the latest build into ${WEBROOT}"
if [ -d "${WEBROOT}/.git" ]; then
  git -C "$WEBROOT" fetch -q --depth 1 origin "$BRANCH"
  git -C "$WEBROOT" reset -q --hard "origin/${BRANCH}"
else
  [ ! -e "$WEBROOT" ] || fail "${WEBROOT} exists and is not ours. Nothing was changed."
  git clone -q --depth 1 --branch "$BRANCH" "$REPO" "$WEBROOT" \
    || fail "could not clone the '${BRANCH}' branch. Has the GitHub Action finished its first build?"
fi
[ -f "${WEBROOT}/index.html" ] || fail "build output not found in ${WEBROOT}."

# 3. Storage API (runs as its own unprivileged user, listens on localhost only)
[ -f "${WEBROOT}/_api/api.py" ] || fail "storage API missing from the build (${WEBROOT}/_api/api.py)."
if ss -ltnH "sport = :${API_PORT}" 2>/dev/null | grep -q . && ! systemctl is-active -q "$SERVICE"; then
  fail "port ${API_PORT} is already used by another program. Re-run with FINANCE_PORT=<free port>."
fi
id -u "$SERVICE" >/dev/null 2>&1 || useradd --system --no-create-home --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$SERVICE"
install -d -m 750 -o "$SERVICE" -g "$SERVICE" "$DATA_DIR"

# 2. Sign-in users (financial data should not be public)
api_cli() { runuser -u "$SERVICE" -- env FINANCE_DATA_DIR="$DATA_DIR" python3 "${WEBROOT}/_api/api.py" "$@"; }
if [ -s "${DATA_DIR}/users.json" ]; then
  say "Keeping existing sign-in users: $(api_cli list-users | paste -sd ' ')"
elif [ -s "$HTPASSWD" ]; then
  # Same username/password as the old browser pop-up login.
  TMP_HT=$(mktemp)
  cp "$HTPASSWD" "$TMP_HT"
  chown "$SERVICE" "$TMP_HT"
  chmod 600 "$TMP_HT"
  say "Importing the existing login: $(api_cli import-htpasswd "$TMP_HT")"
  rm -f "$TMP_HT"
else
  # Credentials can come from FINANCE_USER / FINANCE_PASS, or are asked for.
  # Some web terminals (e.g. hPanel's) have no usable /dev/tty when the script
  # is piped from curl, so fall back to stdin when it is a terminal.
  AUTH_USER="${FINANCE_USER:-}"
  AUTH_PASS="${FINANCE_PASS:-}"
  if [ -z "$AUTH_USER" ] || [ -z "$AUTH_PASS" ]; then
    if [ -t 0 ]; then TTY=/dev/stdin
    elif ( : </dev/tty ) 2>/dev/null && [ -t 1 ]; then TTY=/dev/tty
    else
      fail "no terminal to ask for a login. Download and run the script instead:
    curl -fsSL https://raw.githubusercontent.com/starktvm-hrms/finance/main/deploy/vps-setup.sh -o /tmp/finance-setup.sh && sudo bash /tmp/finance-setup.sh"
    fi
    say "Create the first sign-in for ${DOMAIN}"
    read -rp "  Username: " AUTH_USER <"$TTY" || fail "could not read input."
    while :; do
      read -rsp "  Password (min 10 chars): " AUTH_PASS <"$TTY" || fail "could not read input."
      echo
      [ "${#AUTH_PASS}" -ge 10 ] && break
      echo "  Too short, try again."
    done
  fi
  [ -n "$AUTH_USER" ] || fail "username must not be empty."
  FINANCE_PASSWORD="$AUTH_PASS" api_cli add-user "$AUTH_USER" >/dev/null || fail "could not create the user."
  unset AUTH_PASS
  say "Created sign-in user ${AUTH_USER}"
fi
[ -s "${DATA_DIR}/users.json" ] || fail "no sign-in users were created; nothing else was changed."
# From now on the API refuses everything if the users file ever goes missing.
touch "${DATA_DIR}/auth-required"
say "Writing ${SERVICE_FILE}"
cat > "$SERVICE_FILE" <<UNIT
# Agency Finance storage API, added by deploy/vps-setup.sh
[Unit]
Description=Agency Finance storage API (${DOMAIN})
After=network.target

[Service]
User=${SERVICE}
Group=${SERVICE}
Environment=FINANCE_DATA_DIR=${DATA_DIR}
Environment=FINANCE_PORT=${API_PORT}
ExecStart=/usr/bin/env python3 ${WEBROOT}/_api/api.py
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ReadWritePaths=${DATA_DIR}

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable -q "$SERVICE"
systemctl restart "$SERVICE"
for _ in 1 2 3 4 5 6 7 8 9 10; do
  curl -fsS "http://127.0.0.1:${API_PORT}/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS "http://127.0.0.1:${API_PORT}/health" >/dev/null 2>&1 \
  || fail "the storage API did not start. See: journalctl -u ${SERVICE} -n 50"
say "Storage API running (data in ${DATA_DIR})"

# 4. nginx site (HTTP first; certbot adds HTTPS below)
say "Writing ${SITE_FILE}"
HAD_SITE_FILE=0; [ -f "$SITE_FILE" ] && HAD_SITE_FILE=1
[ "$HAD_SITE_FILE" -eq 1 ] && grep -q "managed by Certbot" "$SITE_FILE" && SKIP_WRITE=1 || SKIP_WRITE=0
if [ "$SKIP_WRITE" -eq 0 ]; then
  cat > "$SITE_FILE" <<NGINX
# Agency Finance — added by deploy/vps-setup.sh (github.com/starktvm-hrms/finance)
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    root ${WEBROOT};
    index index.html;

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "same-origin" always;
    add_header X-Robots-Tag "noindex, nofollow" always;

    # Let's Encrypt validation
    location ^~ /.well-known/acme-challenge/ {
        try_files \$uri =404;
    }

    # Never serve the git checkout metadata or other dotfiles
    location ~ /\\. { return 404; }

    # Hashed build assets can be cached for a long time
    location /assets/ {
        expires 1y;
        try_files \$uri =404;
    }

    location / {
        expires -1;
        try_files \$uri \$uri/ /index.html;
    }
}
NGINX
else
  say "Site file already has HTTPS from certbot; leaving it as is"
fi
[ -n "$SITE_LINK" ] && ln -sfn "$SITE_FILE" "$SITE_LINK"

# 5. Route /api/ to the storage API (inserted into OUR site file only, once)
SITE_BACKUP=""
if ! grep -q "# finance-api" "$SITE_FILE"; then
  SITE_BACKUP=$(mktemp)
  cp "$SITE_FILE" "$SITE_BACKUP"
  python3 - "$SITE_FILE" "$API_PORT" <<'PY'
import sys
path, port = sys.argv[1], sys.argv[2]
block = f"""    # finance-api: storage API (server/api.py), behind the same login
    location ^~ /_api/ {{ return 404; }}
    location /api/ {{
        proxy_pass http://127.0.0.1:{port}/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 10m;
        proxy_read_timeout 30s;
    }}

"""
src = open(path).read()
anchor = "    location / {"
if anchor not in src:
    sys.exit("could not find 'location / {' in " + path)
open(path, "w").write(src.replace(anchor, block + anchor))
PY
  say "Added /api/ route to ${SITE_FILE}"
fi

# 5b. Upgrade older installs of OUR site file: sign-in moved into the app, so
#     drop the browser pop-up login, and pass client IP + scheme to the API.
if grep -q 'auth_basic "Agency Finance"' "$SITE_FILE" || ! grep -q "X-Real-IP" "$SITE_FILE"; then
  [ -n "$SITE_BACKUP" ] || { SITE_BACKUP=$(mktemp); cp "$SITE_FILE" "$SITE_BACKUP"; }
  sed -i -E '/^\s*auth_basic "Agency Finance";\s*$/d; \#^\s*auth_basic_user_file '"${HTPASSWD//\//\\/}"';\s*$#d' "$SITE_FILE"
  if ! grep -q "X-Real-IP" "$SITE_FILE"; then
    sed -i -E 's#^(\s*)proxy_set_header Host \$host;#&\n\1proxy_set_header X-Real-IP $remote_addr;\n\1proxy_set_header X-Forwarded-Proto $scheme;#' "$SITE_FILE"
  fi
  say "Switched ${SITE_FILE} to the app's own sign-in page"
fi

if ! nginx -t 2>/tmp/finance-nginx-test.log; then
  cat /tmp/finance-nginx-test.log >&2
  if [ "$HAD_SITE_FILE" -eq 0 ]; then rm -f "$SITE_FILE"; [ -n "$SITE_LINK" ] && rm -f "$SITE_LINK"
  elif [ -n "$SITE_BACKUP" ]; then cp "$SITE_BACKUP" "$SITE_FILE"; fi
  fail "nginx rejected the configuration; the new site file was removed and nginx was not reloaded."
fi
systemctl reload nginx
say "nginx reloaded"

# 6. HTTPS for this subdomain only
if command -v certbot >/dev/null; then
  say "Requesting an SSL certificate for ${DOMAIN}"
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect \
    --keep-until-expiring --register-unsafely-without-email \
    || echo "  certbot failed (DNS may still be propagating). Re-run this script in a few minutes."
else
  echo "  certbot is not installed, so the site is HTTP only for now."
  echo "  To add HTTPS:  apt-get install -y certbot python3-certbot-nginx && re-run this script"
fi

# 7. Auto-update: pull new builds published by GitHub Actions
cat > "$CRON_FILE" <<CRON
# Agency Finance: pull the latest build every 5 minutes and restart the API if it changed (added by deploy/vps-setup.sh)
*/5 * * * * root cd ${WEBROOT} && old=\$(git rev-parse HEAD) && git fetch -q --depth 1 origin ${BRANCH} && git reset -q --hard origin/${BRANCH} && new=\$(git rev-parse HEAD) && if [ "\$old" != "\$new" ] && ! git diff --quiet "\$old" "\$new" -- _api; then systemctl restart ${SERVICE}; fi
CRON
chmod 644 "$CRON_FILE"

say "Done. Open https://${DOMAIN} (or http:// if certbot was skipped)."
