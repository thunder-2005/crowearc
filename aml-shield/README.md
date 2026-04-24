# AML Shield

Full-stack AML compliance tool covering:
- **Control #2** — Suspicious Activity Monitoring Dashboard (alerts, SLA, analyst workload)
- **Control #3** — SAR Documentation, Retention & Retrieval (repository, docs, audit trail, retention monitor)
- **Actimize-style Investigation Workspace** — tabbed workspace with split left / right panels for transactions, case notes, documents, activity log, KYC, business, case info, and linked cases
- **Customer KYC directory** — searchable customer database with full profiles
- **Role switcher** — Manager View (full oversight) / Employee View (per-analyst queue)

---

## Tech stack

| Layer     | Tech                                                         |
|-----------|--------------------------------------------------------------|
| Frontend  | React 18 + Vite + Tailwind CSS + React Router + Recharts     |
| Backend   | Node.js + Express + `node:sqlite` (built-in, Node ≥ 22.5)    |
| Storage   | SQLite file (`backend/database/aml.db`) + local `uploads/`   |

No native build step. No Docker. No external DB server.

---

## Prerequisites

- **Node.js ≥ 22.5** (the backend uses the built-in `node:sqlite` module, which needs Node 22.5 or newer — Node 24.x recommended).
  Verify with:
  ```bash
  node --version
  ```
- **npm ≥ 10**
- Optional: `curl` for smoke-testing API endpoints.

---

## First-time setup

From the repository root (`aml-shield/`):

```bash
# 1. Install dependencies for root, backend, and frontend
npm run install:all

# 2. Seed the SQLite database (creates schema + loads the CSV reference data)
npm run seed
```

The seed script reads the two CSVs in `backend/database/seed_data/` and populates:
- **50 alerts** (13 Unassigned / 7 Not Started / 15 Work in Progress / 15 Completed)
- **20 SAR filings** (3 Draft / 4 Under Review / 8 Filed / 5 Acknowledged)
- **20 cases** (derived from the alert ⇄ SAR relationship)
- **26 customers**, **43 accounts**, **~1,700 transactions** (including ~280 alerted transactions deterministically linked to the alerts)
- **260 SAR supporting documents** (mock PDFs written to `backend/uploads/`)
- **~90 audit-trail events** and **~25 retrieval-log entries**

You should see something like:
```
[seed] counts = { alerts: 50, sar_filings: 20, cases: 20, customers: 26, accounts: 43, transactions: 1726, ... }
```

---

## Running the app

### Both servers at once (recommended)

From the repository root:

```bash
npm start
```

This uses `concurrently` to run:
- **Backend** on `http://localhost:4000`
- **Frontend** on `http://localhost:5173`

Open **http://localhost:5173** in your browser.

### Running them separately

Two terminals:

```bash
# Terminal 1 — backend
npm run start:backend
```
```bash
# Terminal 2 — frontend
npm run start:frontend
```

---

## Useful URLs once running

| URL                                           | What it is                         |
|-----------------------------------------------|------------------------------------|
| http://localhost:5173                         | Main app (React)                   |
| http://localhost:4000/api/health              | Backend health check               |
| http://localhost:4000/api/dashboard/stats     | Dashboard KPIs / charts payload    |
| http://localhost:4000/api/alerts              | All alerts                         |
| http://localhost:4000/api/sars                | All SAR filings                    |
| http://localhost:4000/api/customers           | Customer directory                 |

---

## How to use it

1. Open http://localhost:5173
2. Top-right, click the user avatar/name to switch **Manager View ↔ Employee View**.
   - In Employee View, pick an analyst from the dropdown (e.g. *Amit Verma*) — the whole app scopes to their queue.
3. Go to **TM Alerts** → click any alert card → **Start Investigation** in the side panel.
4. The Kanban collapses into a tab bar, the **Investigation Workspace** opens:
   - **Left panel:** Transactions (alerted rows highlighted red) / Case Notes / Documents / Activity Log
   - **Right panel:** Customer KYC / Business / Case Info (disposition) / Linked Cases
5. Multiple alerts can be open as tabs simultaneously; click the × on any tab to close it.
6. **Customer KYC** in the sidebar opens a searchable directory — click any customer for their full profile.

---

## Project structure

```
aml-shield/
├── package.json                    # root — `npm start`, `npm run seed`, etc.
├── backend/
│   ├── package.json
│   ├── server.js                   # Express app + router mounting
│   ├── database/
│   │   ├── db.js                   # node:sqlite connection + schema
│   │   ├── seed.js                 # reads CSVs → populates DB
│   │   ├── seed_data/              # aml_shield_alerts.csv, aml_shield_sar_filings.csv
│   │   └── aml.db                  # SQLite file (created on seed, git-ignored)
│   ├── middleware/upload.js        # multer file-upload config
│   ├── routes/
│   │   ├── alerts.js               # /api/alerts  (+ /:id/transactions, disposition, assign)
│   │   ├── cases.js                # /api/cases
│   │   ├── sars.js                 # /api/sars  (+ /:id/export zip)
│   │   ├── documents.js            # /api/documents  (SAR supporting docs)
│   │   ├── auditTrail.js           # /api/audit-trail
│   │   ├── retrievalLog.js         # /api/retrieval-log
│   │   ├── dashboard.js            # /api/dashboard/stats
│   │   ├── customers.js            # /api/customers  (+ /:id/transactions, alerts, sars)
│   │   ├── caseNotes.js            # /api/case-notes
│   │   └── caseDocuments.js        # /api/case-documents  (investigation evidence)
│   └── uploads/                    # stored PDFs / evidence files (git-ignored)
└── frontend/
    ├── package.json
    ├── vite.config.js              # Vite dev server + /api proxy to :4000
    ├── tailwind.config.js
    ├── postcss.config.js
    ├── index.html
    └── src/
        ├── main.jsx                # React root + providers
        ├── index.css               # Tailwind entry
        ├── App.jsx                 # Routes
        ├── api/client.js           # Axios instance (baseURL /api)
        ├── state/
        │   ├── RoleContext.jsx            # Manager / Employee toggle + analyst selector
        │   └── InvestigationTabsContext.jsx  # open-tabs state, sessionStorage-backed
        ├── components/
        │   ├── Sidebar.jsx         # role-filtered nav
        │   ├── Topbar.jsx          # role switcher popover
        │   ├── shared/             # Badge, Card, Table, KpiCard
        │   └── investigation/
        │       └── InvestigationWorkspace.jsx   # split-panel workspace + all 8 internal tabs
        └── pages/
            ├── Dashboard.jsx
            ├── Alerts.jsx          # Kanban + tab-bar host for investigations
            ├── Cases.jsx           # 6-column SAR case Kanban
            ├── SARRepository.jsx
            ├── RetentionMonitor.jsx
            ├── AuditLog.jsx
            ├── CustomerKYC.jsx     # directory + full profile
            └── Placeholder.jsx
```

---

## Re-seeding / resetting the database

To wipe and regenerate all data:

```bash
npm run seed
```

The script deletes everything from every table and re-inserts from the CSVs. All SAR evidence PDFs in `backend/uploads/` are also regenerated.

> ⚠️ This also deletes any case notes and investigation evidence you added through the UI.

To nuke the DB file entirely before reseeding (useful if the schema changed):

```bash
rm backend/database/aml.db backend/database/aml.db-shm backend/database/aml.db-wal
npm run seed
```

---

## Common commands

| Command                        | What it does                                     |
|--------------------------------|--------------------------------------------------|
| `npm run install:all`          | Install root + backend + frontend dependencies   |
| `npm run seed`                 | Wipe + re-seed the SQLite database from CSVs     |
| `npm start`                    | Run backend (:4000) + frontend (:5173) together  |
| `npm run start:backend`        | Backend only                                     |
| `npm run start:frontend`       | Frontend only                                    |
| `npm --prefix frontend run build` | Build frontend for production → `frontend/dist/` |

---

## Troubleshooting

**"Cannot find module `node:sqlite`"**
Your Node version is too old. Install Node ≥ 22.5 (Node 24 recommended).

**Port already in use (EADDRINUSE on 4000 or 5173)**
Something else is running on that port. On Windows:
```powershell
Get-Process node | Stop-Process -Force
```
Then `npm start` again.

**Frontend shows a blank page / HTTP 404 on `/`**
Vite occasionally loses its entry point after a config file change. Stop both servers and restart with `npm start`.

**Seeded numbers don't match expected checkpoints (50/20/12/22/20)**
You edited the CSVs. Revert them, delete `backend/database/aml.db*`, and re-seed.

**I uploaded documents and they're not showing**
Uploaded files live in `backend/uploads/`. They are git-ignored but persist on disk. Re-seeding wipes them. The file metadata is stored in the `documents` and `case_documents` tables.

---

## Data reference dates

The CSVs are pinned to **reference date `2026-04-23`**. All "days overdue" / "days left" / retention-countdown values in the UI are computed relative to *today*, so the further you go past 2026-04-23 the more alerts will show as overdue. That's expected demo behaviour.
