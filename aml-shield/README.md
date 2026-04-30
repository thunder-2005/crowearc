# AML Shield

Full-stack AML compliance tool built around the day-to-day work of a Compliance Manager and her team of analysts.

**What it covers**

- **Suspicious Activity Monitoring** — alerts Kanban with live SLA countdown, investigation workspace, escalation paths
- **SAR lifecycle** — 6-step SAR Filing wizard, manager Approval Queue + Review workspace, SAR Repository with retention monitoring, audit trail
- **KYC Periodic Reviews** — auto-scheduled by risk rating, auto-triggered by SARs/alerts, manager queue, analyst workspace, manager approval flow
- **Real-time SLA breach alerts** — bottom-right popup toasts with live countdown, plays a sound on breach
- **Live notifications** — bell icon badge + dropdown for both manager and analyst (SAR pending / approved / rejected, KYC review assigned, SLA warnings)
- **Two independent views on separate URLs** — Manager view at `/manager/*`, Employee view at `/employee/*`, so you can open both in side-by-side Chrome tabs

---

## Tech stack

| Layer    | Tech                                                       |
| -------- | ---------------------------------------------------------- |
| Frontend | React 18 + Vite 5 + Tailwind CSS + React Router 6 + Recharts + Axios |
| Backend  | Node.js + Express + `node:sqlite` (built-in, Node ≥ 22.5)  |
| Storage  | SQLite file (`backend/database/aml.db`) + local `uploads/` |
| Jobs     | `setInterval` background workers (SLA monitor every 5 min, KYC monitor daily) |

No native build step. No Docker. No external DB server. Everything runs on your machine with `npm start`.

---

## Prerequisites

- **Node.js ≥ 22.5** (the backend uses the built-in `node:sqlite` module — Node 22.5+ required, Node 24.x recommended).
  Verify with:
  ```bash
  node --version
  ```
- **npm ≥ 10**
- A modern Chromium-based browser (Chrome / Edge) — the SLA popup uses WebAudio for the breach tone.

---

## Quick start (3 commands)

From the repository root (`aml-shield/`):

```bash
# 1. Install dependencies for root, backend, and frontend in one go
npm run install:all

# 2. Seed the SQLite database (creates schema + loads CSV reference data)
npm run seed

# 3. Start backend (port 4000) and frontend (port 3000) together
npm start
```

Then open **two browser tabs side-by-side**:

- **Manager view** → http://localhost:3000/manager/dashboard
- **Employee view** → http://localhost:3000/employee/dashboard

Each tab is fully independent — the URL is the source of truth for the role.

---

## What the seed produces

The seed script reads the two CSVs in `backend/database/seed_data/` and populates:

- **50 alerts** across all statuses (Unassigned / Not Started / Work in Progress / Escalated / Completed)
- **20 SAR filings** (Draft / Under Review / Filed / Acknowledged)
- **20 cases** (derived from the alert ⇄ SAR relationship; new cases get `CASE-XXXXX` IDs)
- **26 customers** + **43 accounts** + **~1,700 transactions** (~280 alerted, deterministically linked to alerts)
- **260 SAR supporting documents** (mock PDFs written to `backend/uploads/`)
- **~90 audit-trail events** + **~25 retrieval-log entries**
- **22 KYC reviews** auto-created on first boot (overdue + SAR-triggered + alert-triggered)
- **10 user / analyst profiles** + manager + employee settings (defaults)

You should see something like:

```
[seed] counts = { alerts: 50, sar_filings: 20, cases: 20, customers: 26, accounts: 43, transactions: 1726, ... }
[kycReviewMonitor] +0 scheduled, +2 overdue, +14 SAR-triggered, +6 alert-triggered
```

Currency is **USD** throughout (a one-time migration on first boot converts existing values from the old INR seed).

---

## Running the app

### Both servers at once (recommended)

From the repository root:

```bash
npm start
```

This uses `concurrently` to run:

- **Backend** on `http://localhost:4000`
- **Frontend** on `http://localhost:3000`

Output is colour-coded: cyan = backend, magenta = frontend. Press `Ctrl+C` once to stop both.

### Running them separately (two terminals)

```bash
# Terminal 1 — backend (port 4000)
npm run start:backend
```

```bash
# Terminal 2 — frontend (port 3000)
npm run start:frontend
```

### Development mode (alias)

```bash
npm run dev      # same as `npm start` but uses each app's `dev` script
```

---

## Useful URLs once running

| URL                                              | What it is                                |
| ------------------------------------------------ | ----------------------------------------- |
| http://localhost:3000/manager/dashboard          | Manager landing                           |
| http://localhost:3000/employee/dashboard         | Employee landing                          |
| http://localhost:3000                            | Redirects to manager dashboard            |
| http://localhost:4000/api/health                 | Backend health check                      |
| http://localhost:4000/api/dashboard/stats        | Dashboard KPIs / charts payload           |
| http://localhost:4000/api/alerts                 | All alerts (with live JOIN to customer)   |
| http://localhost:4000/api/cases                  | All cases (with live JOIN to alert + SAR) |
| http://localhost:4000/api/sars                   | All SAR filings                           |
| http://localhost:4000/api/customers              | Customer KYC directory                    |
| http://localhost:4000/api/kyc-reviews            | KYC review queue                          |
| http://localhost:4000/api/sar-approvals          | Pending SAR approvals (manager)           |
| http://localhost:4000/api/notifications/manager  | Manager notification feed                 |
| http://localhost:4000/api/sla/status             | All open alerts with live `remaining_hours` |

---

## How to use it

### Two-tab workflow (recommended)

Open two Chrome tabs:

1. **Manager tab:** http://localhost:3000/manager/dashboard
   - Top-right shows a blue **"Manager View"** badge.
   - Bell icon for SAR-pending / SLA notifications.
   - Sidebar: MONITORING / CUSTOMERS / SAR MANAGEMENT / REPORTS / ADMIN.

2. **Employee tab:** http://localhost:3000/employee/dashboard
   - Top-right shows a green **"Employee View"** badge.
   - Click "Logged in as: …" to pick which analyst this tab represents (Olivia Brown, Robert Wright, Priya Nair, etc.). The selection persists in `localStorage` per browser-profile.
   - Sidebar: MY WORK / CUSTOMERS / SAR MANAGEMENT / REPORTS / ADMIN.

Both tabs read the same database. Changes made in one tab show up in the other within the next polling cycle (badges every 30 s, notification list on bell open).

### A typical end-to-end flow

1. **Employee tab** — go to **My Alerts**, click an unassigned alert, **Assign to Me**, **Start Investigation**.
2. The alert opens a workspace tab. Review transactions / customer KYC / case info on the split panel. Add notes and upload evidence.
3. **Case Info** tab → pick a disposition:
   - *False Positive — Close* → confirm with reason → alert closes.
   - *Escalate to Level 2* → confirmation modal → alert moves to L2 queue.
   - *Escalate to SAR Filing* → a `CASE-XXXXX` is created and you're redirected straight to the SAR Filing wizard.
4. Walk through the **SAR Filing wizard** (6 steps, auto-saves every 30 s). Submit when done.
5. **Manager tab** — bell shows a new "SAR pending approval" notification. Click → opens **SAR Review** workspace with read-only tabs, review checklist, and approve / reject actions.
6. **Approve** → SAR moves to *Filed*, a SAR-triggered KYC review is auto-created, the analyst gets a notification.
7. The analyst's **My KYC Reviews** sidebar entry shows the new assignment. They open the KYC review workspace (Customer Profile / Checklist / Documents / Findings) and submit for approval.
8. **Manager tab** approves the KYC review → the customer's risk rating updates, every alert for that customer immediately reflects the new rating (live JOIN), the next-review date auto-recalculates.

Throughout, the bottom-right **SLA popup** fires automatically when an alert hits its 24-hour warning window or breaches.

---

## Project structure

```
aml-shield/
├── package.json                        # root — `npm start`, `npm run seed`, etc.
├── README.md                           # this file
├── backend/
│   ├── package.json
│   ├── server.js                       # Express app + router mounting + job startup
│   ├── database/
│   │   ├── db.js                       # node:sqlite + schema + INR→USD + KYC link migrations
│   │   ├── admin_defaults.js           # manager/employee setting defaults + analyst names
│   │   ├── seed.js                     # reads CSVs → populates DB
│   │   ├── seed_data/                  # aml_shield_alerts.csv, aml_shield_sar_filings.csv
│   │   └── aml.db                      # SQLite file (created on seed, git-ignored)
│   ├── jobs/
│   │   ├── slaMonitor.js               # every 5 min: SLA warning / breach notifications
│   │   └── kycReviewMonitor.js         # daily: auto-create overdue/triggered KYC reviews
│   ├── middleware/upload.js            # multer file-upload config
│   ├── routes/
│   │   ├── alerts.js                   # /api/alerts  (live JOIN with customers + cases)
│   │   ├── cases.js                    # /api/cases   (live JOIN with alerts + sars + customers)
│   │   ├── sars.js                     # /api/sars    (+ /:id/export zip)
│   │   ├── sarFilings.js               # /api/sar-filings  (wizard CRUD + submit)
│   │   ├── sarApprovals.js             # /api/sar-approvals  (manager review/approve/reject)
│   │   ├── kycReviews.js               # /api/kyc-reviews
│   │   ├── notifications.js            # /api/notifications  (manager + per-user)
│   │   ├── sla.js                      # /api/sla/status
│   │   ├── documents.js                # /api/documents  (SAR supporting docs)
│   │   ├── caseNotes.js                # /api/case-notes
│   │   ├── caseDocuments.js            # /api/case-documents  (investigation evidence)
│   │   ├── auditTrail.js               # /api/audit-trail
│   │   ├── retrievalLog.js             # /api/retrieval-log
│   │   ├── dashboard.js                # /api/dashboard/stats
│   │   ├── customers.js                # /api/customers  (+ alerts/sars history per customer)
│   │   ├── users.js                    # /api/users
│   │   └── settings.js                 # /api/settings/manager + /employee/:id
│   └── uploads/                        # stored PDFs / evidence files (git-ignored)
└── frontend/
    ├── package.json
    ├── vite.config.js                  # Vite dev server (port 3000) + /api proxy → :4000
    ├── tailwind.config.js
    ├── postcss.config.js
    ├── index.html
    └── src/
        ├── main.jsx                    # React root + providers (BrowserRouter, RoleProvider, ToastProvider, ...)
        ├── index.css                   # Tailwind entry
        ├── App.jsx                     # Two route groups: /manager/* and /employee/*
        ├── api/client.js               # Axios — auto-injects ?analyst_id= for /employee/* URLs
        ├── state/
        │   ├── RoleContext.jsx                # role derived from URL prefix
        │   ├── useRoleNavigate.js             # goTo('alerts') → /manager/alerts or /employee/alerts
        │   ├── InvestigationTabsContext.jsx   # open-tabs state, sessionStorage-backed
        │   └── ToastContext.jsx               # global toast notifications
        ├── components/
        │   ├── Sidebar.jsx                    # role-aware sections, prefixed links
        │   ├── Topbar.jsx                     # role badge + bell + analyst selector (employee only)
        │   ├── SLAPopup.jsx                   # global bottom-right SLA toast (warns/breach)
        │   ├── shared/                        # Badge, Card, KpiCard, Table
        │   └── investigation/
        │       └── InvestigationWorkspace.jsx # split-panel investigation workspace
        └── pages/
            ├── Dashboard.jsx                  # KPIs, charts, SLA Watch widget (manager)
            ├── Alerts.jsx                     # 5-column Kanban + investigation tab host
            ├── Cases.jsx                      # case Kanban with File SAR / Open Case actions
            ├── CustomerKYC.jsx                # directory + full profile + Initiate Review
            ├── SARRepository.jsx              # manager filings repo + employee SAR-cases view
            ├── SARFiling.jsx                  # 6-step SAR Filing wizard
            ├── SARApprovalQueue.jsx           # manager queue
            ├── SARApprovalReview.jsx          # full SAR review workspace (manager)
            ├── KYCReviewQueue.jsx             # manager queue + employee "My Reviews" via scope prop
            ├── KYCReviewWorkspace.jsx         # KYC review workspace + manager approval
            ├── RetentionMonitor.jsx
            ├── AuditLog.jsx
            ├── Users.jsx                      # team directory + per-analyst profile panel
            ├── Settings.jsx                   # manager + employee settings (60+ keys)
            └── Placeholder.jsx                # for /reports, /analytics, /investigations
```

---

## Re-seeding / resetting the database

To wipe and regenerate all data:

```bash
npm run seed
```

The script deletes everything from every table and re-inserts from the CSVs. SAR evidence PDFs in `backend/uploads/` are regenerated.

> ⚠️ This also deletes any case notes, KYC reviews, notifications, and investigation evidence you added through the UI.

To nuke the DB file entirely before reseeding (useful if the schema changed):

```bash
# Bash / Git Bash
rm backend/database/aml.db backend/database/aml.db-shm backend/database/aml.db-wal
npm run seed
```

```powershell
# PowerShell
Remove-Item backend\database\aml.db*
npm run seed
```

After reseed, `npm start` again — on first boot the backend runs:

- **INR → USD migration** (only on databases seeded before the currency switch — gated by `pragma user_version >= 1`)
- **KYC trigger backfill** (links existing triggered reviews to their source SAR/alert — gated by `pragma user_version >= 2`)

Both migrations are idempotent and only run once.

---

## Common commands

| Command                           | What it does                                        |
| --------------------------------- | --------------------------------------------------- |
| `npm run install:all`             | Install root + backend + frontend dependencies      |
| `npm run seed`                    | Wipe + re-seed the SQLite database from CSVs        |
| `npm start`                       | Run backend (:4000) + frontend (:3000) together     |
| `npm run dev`                     | Same as `npm start`, alias                          |
| `npm run start:backend`           | Backend only (port 4000)                            |
| `npm run start:frontend`          | Frontend only (port 3000)                           |
| `npm --prefix frontend run build` | Build frontend for production → `frontend/dist/`    |

---

## Background jobs

The backend starts two workers automatically on `app.listen`:

- **`backend/jobs/slaMonitor.js`** — runs every **5 min**. Scans every open alert, computes time-remaining vs `sla_deadline`, and:
  - sends a `sla_warning` notification (analyst + manager) when ≤ 24 h remain
  - sends a `sla_breached` notification + flips `sla_breached = 1` when the deadline passes
  - de-duplicates within a 24-hour window so it doesn't spam
- **`backend/jobs/kycReviewMonitor.js`** — runs **daily** (and once on first boot). For every customer:
  - auto-creates a `scheduled` review when due ≤ 30 days, marks `overdue` when past due
  - auto-creates a `triggered_sar` review if a SAR was filed in the last 30 days (with `triggered_by_sar_id`)
  - auto-creates a `triggered_alerts` review if 3+ alerts in the last 90 days (with `triggered_by_alert_id`)
  - sends manager notifications for each new triggered/overdue review

These run inside the same Node process — no extra setup or service.

---

## Troubleshooting

**"Cannot find module `node:sqlite`"**
Your Node version is too old. Install Node ≥ 22.5 (Node 24 recommended).

**Port already in use (EADDRINUSE on 4000 or 3000)**
Something else is running on that port. On Windows:

```powershell
# Free port 4000 (backend)
Get-NetTCPConnection -LocalPort 4000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
# Free port 3000 (frontend)
Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

```bash
# macOS / Linux
lsof -ti:4000 | xargs kill -9
lsof -ti:3000 | xargs kill -9
```

Then `npm start` again.

**Frontend opens at the wrong port**
`vite.config.js` uses `strictPort: true` — if 3000 is taken, Vite refuses to start instead of silently picking 3001. Free the port (above) and retry.

**Manager tab shows employee sidebar (or vice-versa)**
The role is derived from the URL prefix. Make sure the URL begins with `/manager/...` or `/employee/...` exactly. The root `/` redirects to `/manager/dashboard` by default.

**Both tabs show the same analyst's data**
The active analyst is stored in `localStorage` under the key `aml_active_analyst`. It is shared between same-origin tabs. If you need two different analysts simultaneously, open one tab in a normal window and the other in an Incognito window (Chrome treats them as separate `localStorage` scopes).

**Frontend shows a blank page after a config change**
Vite occasionally loses its entry point after `vite.config.js` changes. Stop both servers (`Ctrl+C`) and restart with `npm start`.

**Seeded numbers don't match expected checkpoints**
You may have edited the CSVs. Revert them, delete `backend/database/aml.db*`, and re-seed.

**SLA popup doesn't make a sound**
The popup uses WebAudio, which requires a user gesture before the first AudioContext starts. Click anywhere on the page once and the next breach popup will play.

**I uploaded documents and they're not showing**
Uploaded files live in `backend/uploads/`. They're git-ignored but persist on disk. Re-seeding wipes them. The file metadata is stored in `documents`, `case_documents`, and `kyc_review_documents` tables.

---

## Data reference dates

The CSVs are pinned to **reference date `2026-04-23`**. All "days overdue" / "days left" / retention-countdown values are computed relative to *today*, so the further you go past 2026-04-23 the more alerts will appear overdue. That's expected demo behaviour.

---

## API conventions

- Currency values in API responses are **whole-dollar integers** (no cents), e.g. `amount_flagged_inr: 120360`. The frontend formats them as `$120,360.00`. The legacy `_inr` column suffix is retained as an internal name only — values are USD.
- Employee-tab API calls automatically receive `?analyst_id=<active analyst>` injected by an Axios interceptor. Existing scoping params (`assigned_to`) still work.
- The bank/institution defaults are: **First National Bank - US** (FEIN: 12-3456789), 200 Park Avenue, New York, NY 10166, USA, Compliance Department / 212-555-0100.
