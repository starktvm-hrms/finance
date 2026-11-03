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

By default everything is saved in the browser's `localStorage` (per device/browser).
Use **Settings → Download backup** regularly, or connect a backend (below) so the team
shares one dataset.

All reads/writes go through one small interface in `src/lib/adapter.ts`:

```ts
interface DataAdapter {
  load(): Promise<AppData | null>;
  save(data: AppData): Promise<void>;
}
```

so changing where data lives never touches the UI.

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

### 2. Sync data to your backend

Set `VITE_API_URL` (see `.env.example`) to an endpoint that:

| Method | Behaviour |
| ------ | --------- |
| `GET`  | returns the full dataset JSON (`AppData` in `src/types.ts`), or `404` if none yet |
| `PUT`  | receives the full dataset JSON and stores it, returns `2xx` |

Optional `VITE_API_TOKEN` is sent as `Authorization: Bearer <token>`.

A dependency-free reference implementation is in `server/index.mjs`:

```bash
API_TOKEN=change-me node server/index.mjs     # listens on :8787
cp .env.example .env    # then set VITE_API_URL=http://localhost:8787
npm run dev
```

You can implement the same two endpoints in whatever your website already runs
(PHP/WordPress, Node, Django, Laravel, Supabase edge function…). For multi-user setups
with per-user permissions, the next step is moving from one JSON document to proper
tables (`clients`, `projects`, `invoices`, `expenses`) — the types in `src/types.ts`
map 1:1 to those tables.

## Live deployment (finance.starkpeople.in)

The app runs on the existing nginx VPS next to the other starkpeople.in sites.

1. Every push to `main` runs `.github/workflows/build-deploy.yml`, which builds the app
   and publishes `dist/` to the `deploy` branch.
2. One-time server setup — run as root in hPanel → VPS → Browser terminal:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/starktvm-hrms/finance/main/deploy/vps-setup.sh | sudo bash
   ```

   It only adds files for this subdomain (web root, nginx site file, login file, cron
   entry, SSL certificate); existing sites and configs are not edited. It asks for a
   username and password that protect the app.
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
server/index.mjs      optional reference API
deploy/vps-setup.sh   one-time VPS setup for finance.starkpeople.in
```
