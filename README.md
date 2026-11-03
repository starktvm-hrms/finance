# Agency Finance

A finance management web app for agencies: clients, projects, invoices, expenses and a
profit dashboard. Built with React + TypeScript + Vite. Runs entirely in the browser by
default, and can sync to your website's backend when you're ready.

## Features

- **Dashboard** — revenue, expenses, net profit & margin, outstanding/overdue amounts,
  monthly income-vs-expense chart, expenses by category, revenue by client.
  Period: this month / 3 / 6 / 12 months. Cash basis (revenue counted when paid, tax excluded).
- **Jobs** — numbered (JOB-0001), with contact person, product / sub-product (remembered per
  client), description and optional approval by a department head (set in Settings).
- **Estimates** — one page with a tab per type (All, Creative, Production, Media, Shoot,
  Events, Retainer, Project) and a status filter; approve and convert to an invoice. The
  estimate form is a full page: client (GSTIN, PAN, address), job no., country/currency,
  title, rich-text header and remarks, discount by % or value, tax, round off and grand total.
  Rich text is sanitised with DOMPurify on save and on display.
- **Production estimate print** — A4 portrait, in the agency's format: letterhead (logo, address,
  phone, PAN, GSTIN, state code, CIN, website), Est No. like `PE/26-27/369`, job no./date,
  job type, product, client with GSTIN/PAN, Sl. No./Description/Amount table (first line bold,
  `•` lines as bullets), SGST + CGST (same state) or IGST, round off, grand total, amount in
  words (lakh/crore), signature row, E & OE, terms and bank details (all set in **Settings**).
- **Media estimate print** — A4 landscape in the agency's media format: letterhead repeated on
  every page, MEDIA ESTIMATE with Est No. (`ME/25-26/372`), dates, job no./type, product and the
  client block, then Sl. No. / Platform / Quantity / Unit / Amount with each line's description
  underneath, a Note, totals, signatures, terms and bank details; pages are numbered "1 / 2".
- **Invoices** — line items, discount, tax (GST/VAT), auto-numbering, payment terms,
  draft → sent → paid workflow, automatic *overdue* detection, print / save as PDF, CSV export.
- **Expenses** — categories, link to a project or mark as overhead, recurring flag,
  one-click "repeat", filters by month/category, CSV export.
- **Projects** — budget, status, invoiced vs. budget, project costs and profit.
- **Clients** — contact & tax details, revenue and outstanding per client.
- **Employees** — one page with tabs: Employees (name, email, phone, designation, department,
  branch, department head, active; "Add several" pastes a list of names), Departments (starts
  with Admin, Finance, Production, Media, Social Media, Service(T), Service(NT), Management,
  Human Resources) and Branches. Department heads appear in the job approval list.
- **Clients & Vendors** — one page with a tab per list: Clients, Publications,
  Suppliers, Channels, Radio, Out Of Home, Websites, Digital, Theatres. Each vendor shows
  spend this year and in total; expenses link to a vendor when the payee name matches.
- **Settings** — agency details for invoices, currency (INR default), tax rate,
  invoice prefix, JSON backup/restore, sample data.
- **Logo** — the Stark Communications logo (`public/brand-logo.png`, round mark in
  `public/brand-mark.png`) is the default on the letterhead, estimates, invoices, sign-in page,
  sidebar and browser tab; uploading another in Settings replaces it.
- **Test data & tidy-up** (Settings) — fill valid-format test GSTIN/PAN for clients missing them
  (marked in notes, removable), number jobs without a Job No., set Type on jobs without one.
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

## Signing in

The live site opens on a sign-in page. Usernames and passwords are checked by the
storage API (`server/api.py`), not by nginx:

- Passwords are stored as PBKDF2-SHA256 hashes in `/var/lib/agency-finance/users.json`.
- A session is a random token in an `HttpOnly`, `Secure`, `SameSite=Strict` cookie
  (12 hours, or 30 days with "Keep me signed in"); only its hash is stored on the server.
- 5 wrong passwords from one address, or for one username, lock sign-in for 15 minutes.
- Each person can change their password in **Settings**; that signs out their other devices.

Add, reset or remove people on the server:

```bash
sudo -u agency-finance python3 /var/www/finance.starkpeople.in/_api/api.py add-user NAME
```

```bash
sudo -u agency-finance python3 /var/www/finance.starkpeople.in/_api/api.py passwd NAME
```

```bash
sudo -u agency-finance python3 /var/www/finance.starkpeople.in/_api/api.py del-user NAME
```

Installs set up before the sign-in page existed keep working behind nginx's pop-up login
until `deploy/vps-setup.sh` is run again; it imports that username and password and
switches the site to the sign-in page.

## Roles and access

Each login has a role. **Admin** has every tab plus *Employees → Logins & access*, where an
admin creates logins for employees and ticks which tabs each role can open (Dashboard, Jobs,
Estimates, Invoices, Expenses, Clients & Vendors, Employees, Settings). Three roles exist to
start with (Department head, Account executive, Finance executive); they can be renamed,
changed, added or removed.

The server enforces it (`server/api.py`): estimates, invoices and expenses are only sent to
roles with that tab; changes to a tab's data are refused (403) without access; only admins
can replace all data, delete clients, vendors or jobs, or manage logins. Logins created from
the command line, and the original imported login, are admins. Roles live with the logins in
`/var/lib/agency-finance/users.json`.

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

   It only adds things for this subdomain (web root, nginx site file, cron entry, SSL
   certificate, the `agency-finance` storage service, its data folder and sign-in users);
   existing sites and configs are not edited. It asks for the first username and password
   (or imports the old pop-up login). Re-running it is safe and is how server-side changes are applied.
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
