#!/usr/bin/env bash
# One-time setup of finance.starkpeople.in on an existing nginx VPS.
#
# Run as root (e.g. in hPanel → VPS → Browser terminal):
#   curl -fsSL https://raw.githubusercontent.com/starktvm-hrms/finance/main/deploy/vps-setup.sh | sudo bash
#
# What it ADDS (nothing existing is edited or removed):
#   /var/www/finance.starkpeople.in/              the built app (a checkout of the `deploy` branch)
#   nginx site file for finance.starkpeople.in    sites-available + symlink, or conf.d
#   /etc/nginx/finance.starkpeople.in.htpasswd    login for the app (HTTP basic auth)
#   /etc/cron.d/finance-starkpeople               pulls new builds every 5 minutes
#   a Let's Encrypt certificate for this subdomain only (if certbot is installed)
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

say()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "run as root (use sudo)."
command -v nginx >/dev/null || fail "nginx is not installed on this server."
command -v git >/dev/null || fail "git is not installed. Install it with: apt-get install -y git"
command -v openssl >/dev/null || fail "openssl is not installed."

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

# 2. Login (financial data should not be public)
if [ ! -s "$HTPASSWD" ]; then
  say "Create a login for ${DOMAIN}"
  read -rp "  Username: " AUTH_USER </dev/tty
  while :; do
    read -rsp "  Password (min 10 chars): " AUTH_PASS </dev/tty; echo
    [ "${#AUTH_PASS}" -ge 10 ] && break
    echo "  Too short, try again."
  done
  printf '%s:%s\n' "$AUTH_USER" "$(openssl passwd -apr1 "$AUTH_PASS")" > "$HTPASSWD"
  unset AUTH_PASS
  chmod 640 "$HTPASSWD"
  NGINX_USER=$(awk '$1=="user"{gsub(";","",$2); print $2; exit}' /etc/nginx/nginx.conf)
  chown root:"${NGINX_USER:-www-data}" "$HTPASSWD" 2>/dev/null || chmod 644 "$HTPASSWD"
else
  say "Keeping existing login file ${HTPASSWD}"
fi

# 3. nginx site (HTTP first; certbot adds HTTPS below)
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

    auth_basic "Agency Finance";
    auth_basic_user_file ${HTPASSWD};

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "same-origin" always;
    add_header X-Robots-Tag "noindex, nofollow" always;

    # Let's Encrypt validation must bypass the login
    location ^~ /.well-known/acme-challenge/ {
        auth_basic off;
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

if ! nginx -t 2>/tmp/finance-nginx-test.log; then
  cat /tmp/finance-nginx-test.log >&2
  if [ "$HAD_SITE_FILE" -eq 0 ]; then rm -f "$SITE_FILE"; [ -n "$SITE_LINK" ] && rm -f "$SITE_LINK"; fi
  fail "nginx rejected the configuration; the new site file was removed and nginx was not reloaded."
fi
systemctl reload nginx
say "nginx reloaded"

# 4. HTTPS for this subdomain only
if command -v certbot >/dev/null; then
  say "Requesting an SSL certificate for ${DOMAIN}"
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect \
    --keep-until-expiring --register-unsafely-without-email \
    || echo "  certbot failed (DNS may still be propagating). Re-run this script in a few minutes."
else
  echo "  certbot is not installed, so the site is HTTP only for now."
  echo "  To add HTTPS:  apt-get install -y certbot python3-certbot-nginx && re-run this script"
fi

# 5. Auto-update: pull new builds published by GitHub Actions
cat > "$CRON_FILE" <<CRON
# Agency Finance: pull the latest build every 5 minutes (added by deploy/vps-setup.sh)
*/5 * * * * root git -C ${WEBROOT} fetch -q --depth 1 origin ${BRANCH} && git -C ${WEBROOT} reset -q --hard origin/${BRANCH}
CRON
chmod 644 "$CRON_FILE"

say "Done. Open https://${DOMAIN} (or http:// if certbot was skipped)."
