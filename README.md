# Agency Finance

A finance management web app for agencies: clients, projects, invoices, expenses and a
profit dashboard. Built with React + TypeScript + Vite. Runs entirely in the browser by
default, and can sync to your website's backend when you're ready.

## Features

- **Dashboard** — revenue, expenses, net profit & margin, outstanding/overdue amounts,
  monthly income-vs-expense chart, expenses by category, revenue by client.
  Period: this month / 3 / 6 / 12 months. Cash basis (revenue counted when paid, tax excluded).
- **Invoices** — line items, discount, tax (GST/VAT), auto-numbering, payment terms,
  draft → sent → paid workflow, automatic *overdue* detection, print / save as PDF, CSV export.
- **Expenses** — categories, link to a project or mark as overhead, recurring flag,
  one-click "repeat", filters by month/category, CSV export.
- **Projects** — budget, status, invoiced vs. budget, project costs and profit.
- **Clients** — contact & tax details, revenue and outstanding per client.
- **Settings** — agency details for invoices, currency (INR default), tax rate,
  invoice prefix, JSON backup/restore, sample data.
- Responsive (works on phones) and supports light/dark mode.

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/
npm run preview    # serve the production build
```

The first launch loads sample data so you can explore. Go to **Settings → Clear all data**
to start fresh, and fill in your agency details.

## Data storage

- **Live site (finance.starkpeople.in):** data is stored **on the server** in
  `/var/lib/agency-finance/data.json`, served by a small Python API (`server/api.py`,
  standard library only) behind the site's login. Everyone who signs in sees the same
  data; other people's changes show up within about 20 seconds. A dated backup is kept
  for each day the data changes (last 30 days) in `/var/lib/agency-finance/backups/`.
- **Local development (`npm run dev`):** data is stored in the browser, with sample data.

The app sends small change operations (`src/lib/ops.ts`, mirrored in `server/api.py`)
instead of the whole dataset, so two people editing at once don't overwrite each other.
When the server is empty, the first browser to open the app uploads whatever it had
saved locally; **Settings → Use data saved in this browser** does the same later.

Restore a server backup:

```bash
sudo systemctl stop agency-finance
sudo cp /var/lib/agency-finance/backups/data-YYYY-MM-DD.json /var/lib/agency-finance/data.json
sudo systemctl start agency-finance
```

## Connecting to your website

### 1. Host the app on your site

`npm run build` produces static files in `dist/`. Upload them anywhere that serves
static files (your web host, Netlify, Vercel, GitHub Pages, Hostinger…).

To serve it from a sub-path such as `https://youragency.com/finance/`:

```bash
VITE_BASE_PATH=/finance/ npm run build
```

and upload `dist/` into the `finance/` folder of your site. Because the app uses
hash-based routing (`#/invoices`), no server rewrite rules are needed.

> ⚠️ This is internal financial data. Put the app behind a login — e.g. your website's
> admin area, HTTP basic auth, or Cloudflare Access — rather than a public URL.

### 2. Storage API

Build with `VITE_API_URL=/api` and proxy `/api/` to `server/api.py`
(`FINANCE_DATA_DIR`, `FINANCE_PORT` env vars; default port 8791). Put the API behind the
same login as the app: it has no authentication of its own and listens on 127.0.0.1 only.

| Request | Response |
| ------- | -------- |
| `GET /data[?since=REV]` | `{"rev": n, "data": AppData \| null}` or `{"unchanged": true}` |
| `POST /ops` `{"ops": [...]}` (JSON) | `{"rev": n}`; ops are `upsert`, `remove`, `settings`, `replace` |
| `GET /health` | `{"ok": true, "rev": n}` |

To develop against it locally:

```bash
FINANCE_DATA_DIR=./.data python3 server/api.py
VITE_API_URL=/api npm run dev     # vite proxies /api to 127.0.0.1:8791
```

## Live deployment (finance.starkpeople.in)

The app runs on the existing nginx VPS next to the other starkpeople.in sites.

1. Every push to `main` runs `.github/workflows/build-deploy.yml`, which builds the app
   and publishes `dist/` (plus the storage API) to the `deploy` branch.
2. One-time server setup — run as root in hPanel → VPS → Browser terminal:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/starktvm-hrms/finance/main/deploy/vps-setup.sh -o /tmp/finance-setup.sh && sudo bash /tmp/finance-setup.sh
   ```

   If a terminal can't prompt, create the login yourself first and re-run the script:

   ```bash
   read -rp "Username: " U; read -rsp "Password: " P; echo; printf '%s:%s\n' "$U" "$(openssl passwd -apr1 "$P")" > /etc/nginx/finance.starkpeople.in.htpasswd; unset P
   ```

   It only adds things for this subdomain (web root, nginx site file, login file, cron
   entry, SSL certificate, the `agency-finance` storage service and its data folder);
   existing sites and configs are not edited. It asks for a username and password that
   protect the app. Re-running it is safe and is how server-side changes are applied.
3. After that the server pulls new builds every 5 minutes — just push to `main`.

DNS: `finance` is a CNAME to `starkpeople.in` (same as `meet`).

## Project structure

```
src/
  types.ts            data model
  lib/adapter.ts      storage adapters (localStorage, REST)
  lib/store.tsx       React state + autosave
  lib/metrics.ts      dashboard & project calculations
  lib/util.ts         money/date formatting, invoice totals, CSV
  lib/seed.ts         defaults and sample data
  pages/              Dashboard, Invoices, Expenses, Projects, Clients, Settings
  components/ui.tsx   modal, fields, badges, stat cards
server/api.py         storage API (Python standard library)
deploy/vps-setup.sh   one-time VPS setup for finance.starkpeople.in
```
