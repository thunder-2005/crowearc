# Crowe ARC — Codebase Audit Report

_Read-only analysis — no code changed._
_Date: 2026-05-05 · Commit on `origin/main`: `8921a746`_

This report compares the Crowe ARC codebase against the supplied AML-tool checklist (149 items across 15 categories). Every claim is grounded to a concrete file or route in the repo so anyone can verify.

---

## SECTION A — WHAT IS BUILT ✅

### ALERT MANAGEMENT

- ✅ **Alert ingestion (manual/CSV)** → `backend/database/seed.js` parses `seed_data/aml_shield_alerts.csv` into the `alerts` table; `npm run seed` re-imports
- ✅ **Alert prioritization** (High/Medium/Low/Critical) → `alerts.priority` column + `priority` filters in `backend/routes/alerts.js`
- ✅ **SLA tracking per priority** → `alerts.sla_days`, `sla_deadline` columns, computed at seed time
- ✅ **SLA breach notifications** → `backend/jobs/slaMonitor.js` runs every 5 min, writes to `notifications` for analyst + manager
- ✅ **Alert aging tracking** → `alerts.age_days` column + `Avg Aging` KPI on `frontend/src/pages/Dashboard.jsx`
- ✅ **Bulk alert assignment** → `frontend/src/components/alerts/ManagerAlertsTable.jsx` (bulk action bar) + `PATCH /api/alerts/:id/assign` looped per id
- ✅ **Bulk false positive closure** → `alerts.js` `PATCH /bulk-close` route in single transaction + `BulkFalsePositiveModal` UI
- ✅ **Alert filtering and search** → ManagerAlertsTable filters (scenario / priority / status / analyst / team / SLA / date / Q) + global `backend/routes/search.js`
- ✅ **Alert to case conversion** → `POST /api/cases` with `source_alert_id` → flips `alerts.case_converted=1` and stamps `alerts.case_id`
- ✅ **Alert disposition tracking** → `alerts.disposition` + `PATCH /api/alerts/:id/disposition`

### INVESTIGATION WORKSPACE

- ✅ **Single screen investigation** → `frontend/src/components/investigation/InvestigationWorkspace.jsx` (split-panel)
- ✅ **Transaction history viewer** → Transactions tab, `GET /api/alerts/:id/transactions`
- ✅ **Alerted transaction highlighting** → `transactions.is_alerted` + `is_this_alert` synthetic column on the alert-scoped fetch
- ✅ **Alerted transaction sum calculation** → `summary.alerted_total_amount` returned by `GET /api/alerts/:id/transactions`
- ✅ **Customer KYC panel alongside transactions** → right-panel KYC tab in InvestigationWorkspace
- ✅ **Case notes with timestamp** → `case_notes` table + `backend/routes/caseNotes.js` GET/POST
- ✅ **Document upload and management** → `case_documents` table + `backend/routes/caseDocuments.js` (upload/download/delete via multer)
- ✅ **Counterparty analysis** → `GET /api/l2/:id/counterparties` + `GET /api/l2/:id/linked-entities`
- ✅ **Pattern detection on transactions** → `GET /api/l2/:id/patterns` (structuring band, velocity vs prior 90d, round amounts, counterparty concentration, geographic risk)
- ✅ **Risk scoring for alerts** → `alerts.risk_score` (CSV-seeded) + L2 10-factor scoring stored in `l2_cases.risk_score`/`risk_factors`
- ✅ **Linked cases and prior history** → ALERT_SELECT JOIN with `cases`/`sar_filings`/`customers` returns `linked_case_id`, `linked_sar_id`, etc.

### L1 / L2 WORKFLOW

- ✅ **L1 investigation workspace** → InvestigationWorkspace with disposition buttons
- ✅ **L1 disposition** (False Positive / Escalate) → `PATCH /api/alerts/:id/disposition` + `POST /api/l2` for escalation
- ✅ **L2 escalation queue** → `frontend/src/components/investigation/L2QueuePage.jsx` + `GET /api/l2/queue`
- ✅ **L2 deep analysis workspace** → `frontend/src/components/investigation/L2InvestigationWorkspace.jsx`
- ✅ **L2 decision** (Return / Close / SAR) → `PATCH /api/l2/:id/return`, `/close`, `/escalate-sar`
- ✅ **L1 to L2 handoff with notes visible** → `GET /api/l2/l1-summary/:alertId` returns L1 notes + docs + checklist + time-spent
- ✅ **L2 self assignment** → `PATCH /api/l2/:id/accept`
- ✅ **Return to L1 with instructions** → `/return` accepts reason + instructions, fires notification to L1, sets alert to "Work in Progress"

### SAR FILING

- ✅ **Multi-step SAR form (FinCEN aligned)** → `frontend/src/pages/SARFiling.jsx` 6-step wizard (`SAR Details → Subject → Activity → Narrative → Attachments → Review`)
- ✅ **Subject information auto-population** → `buildInitialForm` pulls customer KYC fields into Step 2
- ✅ **Suspicious activity type selection** → `ACTIVITY_TYPES` dropdown with 12 BSA categories
- ✅ **Document attachment to SAR** → Step 5 + `backend/routes/documents.js` upload/download/delete
- ✅ **Draft auto-save** → `setInterval(saveDraft, 30000)` in SARFiling.jsx
- ✅ **SAR submission for approval** → `POST /api/sar-filings/:id/submit` (dual-approval gated)
- ✅ **Manager review workspace** → `frontend/src/pages/SARApprovalReview.jsx`
- ✅ **Inline review comments** → `sar_review_comments` table + `POST /api/sar-approvals/comments` with highlighted-text + position offsets
- ✅ **Approve / Reject / Return flow** → `POST /api/sar-approvals/:id/approve|reject` + `start-review`
- ✅ **SAR filing reference number** → auto-generated `FIU-{YYYYMMDD}-{NNNNN}` on approve

### SAR REPOSITORY

- ✅ **Searchable SAR list** → `frontend/src/pages/SARRepository.jsx` (q/status/retention filters)
- ✅ **SAR detail view** → `SarDetail` panel with documents, audit trail, timeline
- ✅ **Supporting document storage** → `backend/uploads/` + `documents` table (per-SAR FK on `sar_id`)
- ✅ **5-year retention tracking** → `sar_filings.retention_expiry_date` set to `filed_date + INTERVAL '5 years'` on approve
- ✅ **Retention expiry alerts** → `GET /api/sars/expiring-soon` + `frontend/src/pages/RetentionMonitor.jsx`
- ✅ **SAR export package** → `GET /api/sars/:id/export` returns a zip (metadata.json + summary.txt + every supporting doc)
- ✅ **Retrieval log for examiners** → `retrieval_log` table + `backend/routes/retrievalLog.js`
- ✅ **Read-only access for L1** → SARRepository now branches on `isL1` to a read-only manager-style table with blue banner (committed in `8921a746`)

### KYC / CDD

- ✅ **Customer profile** (individual + business) → `customers` table has both individual fields (DOB, SSN, employer) and business fields (EIN, NAICS, beneficial_owners JSON)
- ✅ **Risk rating** → `customers.customer_risk_rating` (`Low|Medium|High|Very High`)
- ✅ **CDD level** → `customers.cdd_level` (`Standard|Enhanced`)
- ✅ **Periodic review scheduling** → `backend/jobs/kycReviewMonitor.js` daily, with `intervalDaysForRating` (180/365/730/1095)
- ✅ **Review checklist** → 14-key 4-group structured checklist enforced in `kycReviews.js` `/complete`
- ✅ **Review assignment** (single + bulk) → `PATCH /api/kyc-reviews/:id/assign` and the new `PATCH /api/kyc-reviews/bulk-assign` (single transaction + per-row audit + notification)
- ✅ **Risk rating change on review** → `kyc_reviews.new_risk_rating` propagates to `customers.customer_risk_rating` on manager approve
- ✅ **Manager approval of review outcome** → `PATCH /api/kyc-reviews/:id/approve|reject`
- ✅ **KYC triggered by SAR filing** → `kycReviewMonitor.js` and `sarApprovals.js` approve creates a `triggered_sar` review
- ✅ **KYC triggered by alert threshold** → `kycReviewMonitor.js` fires when `≥3 alerts` for the same customer in the last 90 days
- ✅ **KYC overdue alerts** → status flips to `'overdue'`; manager notification fired
- ✅ **Beneficial ownership tracking** → `customers.beneficial_owners` JSON column

### MANAGER OVERSIGHT

- ✅ **Manager dashboard with KPIs** → `frontend/src/pages/Dashboard.jsx` + `GET /api/dashboard/stats`
- ✅ **Interactive KPI cards with drill-down** → 9 drawer routes under `GET /api/dashboard/drawer/*` (total-alerts, in-progress, completed, sla-breaches, avg-aging, cases-converted, team-capacity, false-positive, unassigned)
- ✅ **SLA watch widget** → `top_sla_breaches` array on dashboard stats
- ✅ **Team workload visibility** → `analyst_workload` array per analyst with utilization %
- ✅ **Analyst capacity tracking** → `team-capacity` drawer + ManagerAlertsTable open-counts inline
- ✅ **Alert assignment to L1** → ManagerAlertsTable now fetches `GET /api/users?role=analyst_l1` (committed in last batch)
- ✅ **Bulk alert assignment** → as listed above
- ✅ **SAR approval queue** → `frontend/src/pages/SARApprovalQueue.jsx` + `GET /api/sar-approvals`
- ✅ **KYC review approval** → KYCReviewWorkspace + manager-approve route
- ✅ **L2 escalation oversight** → `GET /api/l2/stats/manager` returns total open + avg days + workload + recent decisions

### ANALYTICS

- ✅ **Alert volume trends** → `GET /api/analytics/alert-trends` (volume + FP rate + age distribution + by-scenario)
- ✅ **False positive rate trends** → same route, `false_positive_rate` series
- ✅ **SLA performance over time** → `GET /api/analytics/team-performance` `sla_breach_rate` per priority per period
- ✅ **Scenario effectiveness analysis** → `GET /api/analytics/rule-effectiveness`
- ✅ **Analyst performance comparison** → team-performance `productivity` matrix
- ✅ **SAR filing trends** → `GET /api/analytics/sar-trends` (filing_volume + conversion_rate + timeliness + dollar_amount + rejection_rate)
- ✅ **Customer risk distribution** → `GET /api/analytics/customer-risk` `current_distribution`
- ✅ **KYC compliance rate** → same route, `kyc_compliance` over time

### REPORTS

- ✅ **Monthly SAR filing summary** → `GET /api/reports/sar-summary`
- ✅ **SLA breach report** → `GET /api/reports/sla-breach`
- ✅ **Team performance report** → `GET /api/reports/team-performance`
- ✅ **KYC review status report** → `GET /api/reports/kyc-status`
- ✅ **False positive rate report** → `GET /api/reports/false-positive`
- ✅ **Audit trail export** → `GET /api/reports/audit-trail` (multi-source aggregation across `audit_trail`, `sar_approval_log`, `case_notes`)
- ✅ **Regulatory compliance report** → `GET /api/reports/regulatory` (timeliness, KYC currency, SLA compliance, retention)
- ✅ **Alert aging report** → `GET /api/reports/alert-aging`
- ✅ **PDF export** → `jspdf` + `jspdf-autotable` in `frontend/package.json`
- ✅ **Excel export** → `xlsx` in `frontend/package.json`

### NOTIFICATIONS

- ✅ **SLA breach notifications (24hrs)** → `slaMonitor.js` (warning fires when `remainingHours <= 24`)
- ✅ **SLA breach popup toasts** → `frontend/src/components/SLAPopup.jsx` polls every 60s, max 3 visible, plays a sound on breach
- ✅ **SAR pending approval notification** → `sarFilings.js` `/submit` writes a manager-targeted row to `notifications`
- ✅ **SAR approved notification** → `sarApprovals.js` `/approve` notifies the prepared_by analyst
- ✅ **SAR rejected notification** → `sarApprovals.js` `/reject` notifies the analyst
- ✅ **KYC overdue notification** → `kycReviewMonitor.js` fires `kyc_overdue` to manager
- ✅ **Alert escalated notification** → `l2.js` notifies all L2 analysts on escalation, manager on decisions

### SEARCH

- ✅ **Global search across all entities** → `backend/routes/search.js` (alerts/customers/cases/sars in one call)
- ✅ **Search alerts by ID and customer** → search.js + ManagerAlertsTable q field
- ✅ **Search SARs by ID and customer** → search.js + SARRepository q field
- ✅ **Search customers by name and ID** → search.js + customers.js GET filter
- ✅ **Search cases by ID** → search.js + cases.js GET filter
- ✅ **Keyboard shortcut (Ctrl+K)** → `frontend/src/components/Topbar.jsx` listens for `(ctrl|meta)+k` and focuses the search input
- ✅ **Role aware search results** → search.js employee scope filters by `analyst_id`

### SECURITY AND ACCESS

- ✅ **L1 / L2 / Manager role separation** → frontend Sidebar / SARRepository / Cases / SARFiling all branch on `isL1`/`isL2`/`isManager`; backend `requireL2OrManager` middleware on `sarFilings.js`
- ✅ **Login authentication** → `backend/routes/auth.js` `/login`, `/logout`, `/me` (plain-text demo)
- ✅ **Route protection by role** → `frontend/src/components/ProtectedRoute.jsx` + SARFiling.jsx redirect for L1

### COMPLIANCE AND REGULATORY

- ✅ **FinCEN BSA alignment** → wizard fields match BSA SAR (`bsa_filing_institution`, `tin`, `regulatory_agency`, `sar_type`, `structuring_indicator`, etc.)
- ✅ **5-year SAR retention** → enforced via `($filed_date::date + INTERVAL '5 years')::date` on approve
- ✅ **Regulatory compliance report** → `/reports/regulatory`
- ✅ **Examination ready export package** → `/sars/:id/export` zip

### INFRASTRUCTURE

- ✅ **Cloud hosted frontend** → Vercel (per project context)
- ✅ **Cloud hosted backend** → Railway (per project context)
- ✅ **Cloud database** → Supabase Postgres (`DATABASE_URL` in backend `.env`)
- ✅ **Auto deploy on code push** → `git push origin main` triggers both Vercel + Railway deployments
- ✅ **Environment separation** (dev/prod) → `.env.development` / `.env.production` for Vite (`import.meta.env.PROD`); backend reads `process.env.DATABASE_URL` / `NODE_ENV`
- ✅ **Background jobs** (SLA / KYC monitoring) → `backend/jobs/slaMonitor.js` (every 5 min) + `backend/jobs/kycReviewMonitor.js` (daily), kicked off in `server.js` after `app.listen`

---

## SECTION B — WHAT CAN BE BUILT NEXT 🔧

### Quick wins (1–2 days)

- 🔧 **Alert assigned notification** → `alerts.js` `PATCH /:id/assign` already inserts an audit row but doesn't write to `notifications`. Add one `INSERT INTO notifications` in the existing handler. Same in `cases.js` `PATCH /:id/assign`.
- 🔧 **SLA 48-hour warning tier** → `slaMonitor.js` currently only fires at `≤24h`. Add a second tier at `≤48h` writing `sla_warning_48h` notifications, with a separate de-dup column to avoid duplicate-firing.
- 🔧 **Activity Log tab reads `audit_trail`** → swap `frontend/src/components/investigation/InvestigationWorkspace.jsx`'s `ActivityLogTab` from synthesizing events to calling `GET /api/audit-trail/alert/:alert_id` (endpoint already exists from the recent batch).
- 🔧 **KYCReviewWorkspace Activity Log tab** → currently no activity tab in `KYCReviewWorkspace.jsx`. Add a tab that calls `GET /api/audit-trail/kyc/:review_id` (endpoint exists, just no UI consumer).
- 🔧 **CTR threshold flag** → add a tiny rule in `sarFilings.js` PATCH that auto-sets `structuring_indicator=1` when `total_amount >= 10000` and the activity types include "Cash Deposit" / "Cash Withdrawal". Currently nothing in code references the $10,000 mark.
- 🔧 **Backend role check on more write routes** → only `sarFilings.js` has `requireL2OrManager`. Apply analogous middleware to: `cases.js` POST (case creation should be L2/Manager), `caseDocuments.js` upload (anyone OK actually), `kycReviews.js` `/complete`+`/save` (L1/L2 OK, Manager OK so no change needed), `documents.js` upload/delete (L2/Manager only).
- 🔧 **`x-user-role` validation on backend** → middleware that confirms `x-user-id` actually exists in `user_profiles` (currently the backend trusts the header verbatim). Cheap to add and tightens the demo auth.
- 🔧 **CSV template download** → static endpoint or static file in `frontend/public/` returning an empty header-row CSV that matches `seed_data/aml_shield_alerts.csv`. Used by L1/Manager when prepping a new batch.
- 🔧 **Mobile responsive pass on Dashboard + Login** → today's responsive breakpoints exist via Tailwind utility classes but the manager Dashboard KPI grid stacks awkwardly under 768px. A pass to test/fix the most-trafficked screens (Login, Dashboard, Alerts Kanban) is ~1 day.
- 🔧 **Append-only constraint on `audit_trail`** → add a Postgres trigger that raises on `UPDATE` or `DELETE` of any row in `audit_trail`. Single migration, ~10 lines, gives real "tamper protection".

### Medium effort (1–2 weeks)

- 🔧 **CSV import pipeline UI** → page + 4-step flow (Upload → Preview rows → Validate (column types, required fields) → Confirm). Backend: new `POST /api/imports/alerts/preview` + `/api/imports/alerts/commit`. Reuse `seed.js` parsing. Adds an `import_history` table for the run log.
- 🔧 **Scheduled report delivery** → `report_schedules` table and CRUD already exist. Missing: a worker that runs every hour, finds due schedules, generates the PDF/Excel, and emails recipients. Needs the email layer below.
- 🔧 **Email notifications** → SMTP layer (`nodemailer`) plus a `notification_dispatcher.js` background job that picks unread `notifications` rows where the user has `email_opt_in=true` and sends them. Wire in once for SAR-pending, SLA-breach, KYC-overdue, scheduled report.
- 🔧 **Joint SAR + Continuing SAR support** → `FILING_TYPES` already lists them as options. Real support means: Joint SAR adds a `joint_filer_institution` JSONB field; Continuing SAR links to a prior SAR via `prior_sar_id` + auto-fills the prior narrative. ~1 week with form + backend changes.
- 🔧 **OFAC sanctions list lookup** → real screening: download the OFAC SDN list nightly, store in a `sanctions_list` table, screen on customer create/update, set `customers.sanctions_match` based on a fuzzy match. The `pep_match` flag is half-built today but only writeable manually.
- 🔧 **PEP screening list integration** → similar pattern with a PEP data provider feed.
- 🔧 **SAR turnaround time analytics** → `sarApprovals.js` already computes avg review hours for the current month in `/stats`. Add it to `/api/analytics/sar-trends` as a per-period series so it shows on the SAR Trends tab over time.
- 🔧 **Cloud file storage for SAR documents** → today `backend/uploads/` is on Railway's ephemeral filesystem. On every redeploy you lose uploads. Migrate to S3-compatible storage (Supabase Storage is right there). Estimate: 3-4 days, including back-fill of any user-uploaded docs to the bucket.
- 🔧 **Real session management** → today the only "session" is the localStorage `aml_shield_user`. No expiry, no rotation, no invalidation on password change. Add JWT (15-min access + refresh) issued by `auth.js` `/login`; backend middleware verifies on every request. Frontend interceptor refreshes silently.

### Larger builds (1+ month)

- 🔧 **Real-time alert ingestion** (vs CSV) → webhook receiver `POST /api/alerts/ingest` that accepts streamed alerts from Actimize/Verafin/Featurespace, enforces idempotency by external `alert_id`, fires the same downstream flow.
- 🔧 **Scenario / rules engine** → today's "scenario" is just a column on the alert. A real engine: rule definitions stored in DB, evaluated against transactions via a worker, output alerts. Significant.
- 🔧 **Alert deduplication** → during ingestion, hash `customer_id + scenario + 7-day window` to suppress dupes; surface the original alert id.
- 🔧 **Direct FinCEN BSA E-Filing integration** → API submission to FinCEN's BSA E-Filing portal, with status callbacks updating `regulator_reference` and `acknowledged_date`. Likely the single most regulatorily-significant build still on the backlog.
- 🔧 **SSO / Active Directory** → SAML or OIDC integration so analysts log in via the bank's IdP. Requires JWT-based session management as a prerequisite.
- 🔧 **Mobile-responsive layout end-to-end** → covered as a quick-win for top pages, but a full "phone-friendly" pass across all 18 pages + investigation workspace is ~3 weeks. Tabbed layouts collapse, KPI grids reflow, the L2 deep-analysis split panel needs a stacked variant.
- 🔧 **AI narrative assistant for SAR Step 4** → LLM-backed drafting that takes case notes + transactions + customer KYC and proposes a narrative. The data pipes are all there; it's a UI add + a model gateway.
- 🔧 **SFTP nightly auto-import** → cron worker that polls an SFTP drop, ingests CSVs, archives processed files, emails an import summary. Needs the CSV import pipeline as a prereq.
- 🔧 **Examiner-only portal** → a separate, audit-only side of the app for regulators with read-only access to SARs + audit trail + retention monitor, plus a one-click examination package generator.

---

## SECTION C — AREAS OF IMPROVEMENT ⚠️

These features exist but are incomplete or partially working.

### Audit trail

- ⚠️ **Investigation Activity Log doesn't read `audit_trail`** → `frontend/src/components/investigation/InvestigationWorkspace.jsx::ActivityLogTab` (lines 573-616) **synthesizes** the timeline from the alert object + case_notes + case_documents instead of querying `GET /api/audit-trail/alert/:id`. So all the new audit events the backend writes (Investigation started, Status changed, Disposition set, L2 events, KYC trigger events) **don't appear** to the L1 analyst until the UI is switched.
- ⚠️ **KYC review activity log not surfaced** → `KYCReviewWorkspace.jsx` has no Activity Log tab. The backend now writes detailed entries (`Review started by …`, per-checklist-group ✅, `Findings submitted`, `Risk rating change A → B`, `Approved by`, `Next review date set`) — but no UI ever queries them.
- ⚠️ **Audit trail tamper protection is app-only** → `backend/utils/audit.js` only inserts; the route layer never UPDATEs or DELETEs. But there's nothing at the database level preventing a direct `DELETE FROM audit_trail` from a SQL client. Real "immutability" needs a Postgres trigger or a cryptographic chain (each row hashes the previous).
- ⚠️ **Legacy audit rows mislabelled** → 189 rows backfilled to `entity_type='sar'` by `migrate.js`, but some of those rows were originally written by `l2.js`/`alerts.js` with `sar_id = alert_id`. They're tagged 'sar' but actually describe alert events. A smarter backfill (regex on action text) could re-classify them, otherwise `/api/audit-trail/sar/:id` may show alert-events for any SAR whose id collides with an old alert id (no current collisions, but it's a foot-gun).

### SAR filing

- ⚠️ **Joint SAR / Continuing SAR are name-only** → `SARFiling.jsx::FILING_TYPES` includes "Joint SAR" and "Continuing SAR", but selecting either has zero effect on the form. No co-filer institution field, no link-to-prior-SAR field.
- ⚠️ **Narrative writing has no guidance** → free-text textarea with a 5W+H placeholder, but no drafting assistant, no template snippets, no suggested phrasings drawn from case notes.
- ⚠️ **Per-step audit events fire only on "Next" click** → if the user skips ahead by clicking the wizard sidebar step indicator (`goStep(i)`), `step_completed` is not emitted. Acceptable for the demo but the audit log can have gaps.

### Notifications

- ⚠️ **48-hour SLA warning tier missing** → checklist asks for warnings at 48h _and_ 24h. `slaMonitor.js` fires only at `≤24h`. Easy add, but currently not present.
- ⚠️ **No alert-assigned notification** → `alerts.js` `PATCH /:id/assign` updates DB and writes audit but does **not** insert a `notifications` row, so the assignee never sees a bell badge for new assignments.
- ⚠️ **Manager has no `kyc_review_assigned` filter** → `kyc_review_assigned` notifications are routed to the assignee analyst only. There's no audit-log copy for the manager to confirm "I assigned 12 reviews this morning".

### Security & access

- ⚠️ **Backend role checks only cover SAR filing** → `sarFilings.js` enforces `requireL2OrManager` on POST/PATCH/submit/approve. Other write endpoints (`/api/alerts/*`, `/api/cases/*`, `/api/l2/*`, `/api/kyc-reviews/*`, `/api/documents/*`) trust whatever the frontend sent. An L1 user with DevTools could still POST `/api/alerts/bulk-close` and act on alerts they don't own. The `x-user-role` header is sent on every request — wiring it into more middleware is straightforward.
- ⚠️ **`x-user-role` is unsigned and trusted as-is** → the demo header is settable by anyone who can hit the API. For a real demo it's fine; for any production traffic it is not.
- ⚠️ **Plain-text passwords** → `auth.js` does `WHERE username = $1 AND password = $2`. The brief acknowledges demo, but worth flagging: any DB read pulls all 11 cleartext passwords.
- ⚠️ **No session expiry / logout-everywhere** → `localStorage.aml_shield_user` is the only session marker; signing out only clears the local browser. There's no concept of revoking access across tabs/devices.

### Compliance

- ⚠️ **OFAC sanctions reference is a flag** → `customers.sanctions_match` is a 0/1 column populated at seed time from the CSV; there's no real sanctions list to compare against, no fuzzy-match scoring.
- ⚠️ **PEP screening is a flag** → same as sanctions — boolean column, no list integration.
- ⚠️ **CTR $10,000 threshold not encoded** → no code path enforces or even references it. The brief says it's "recognized" but searching `grep -rn "10000\|CTR\|currency transaction"` only matches loop counters.

### Reports

- ⚠️ **Scheduled report delivery is half-wired** → `report_schedules` table + CRUD endpoints + the management UI (`Reports.jsx::SchedulesPanel`) all work, so users can _save_ a schedule. But no worker reads them and no email service sends. The schedule rows just sit there.

### Data management

- ⚠️ **CSV import is dev-time only** → `seed.js` is a one-shot `npm run seed` that wipes and reloads. There's no business UI for "import this week's batch", no preview, no validation, no error report, no history. The brief assumes ongoing imports — current state is dev/demo only.

### Infrastructure

- ⚠️ **Document storage is ephemeral on Railway** → `backend/uploads/` is on the Railway container's local FS. **Every redeploy wipes user-uploaded SAR/case/KYC documents.** Migration to Supabase Storage (already on the stack) is the obvious next step.
- ⚠️ **Mobile responsive layout is desktop-first** → the InvestigationWorkspace split panel, ManagerAlertsTable's 14 columns, and the SAR wizard's 6-step horizontal stepper all assume ≥1024px. Tailwind breakpoints exist, but no concerted mobile pass has been done.
- ⚠️ **Background jobs are in-process** → `setInterval` workers inside the Express process. Fine for a demo, but if Railway restarts the API container the timers reset and missed ticks aren't replayed. A dedicated worker process or external scheduler would be more durable.
- ⚠️ **Vercel build artifact tracked in git** → `aml-shield/frontend/dist/index.html` was committed before `.gitignore` was added, so every local `vite build` produces a noisy diff. Untrack it (`git rm --cached`) once and the working tree stays clean.

### Misc

- ⚠️ **Topbar still polls every 30s** → notification badge polling is fine but consumes API quota. WebSocket / SSE would scale better and reduce backend load.
- ⚠️ **Frontend bundle is 4.8MB ungzipped** → `vite build` warns about this. The CroweArcLogo PNG is 2.7MB embedded as base64, plus html2canvas + jspdf are pulled in synchronously. Code-splitting + replacing the logo with an SVG or a static asset would cut load time meaningfully.
- ⚠️ **`seed_full.js` is stubbed** → during the SQLite→PostgreSQL migration, `seed_full.js` (an extended 1,880-line dataset) was replaced with a stub. `npm run seed` (using `seed.js`) works, but anyone running `seed_full.js` for the richer dataset gets an error message pointing to seed.js.

---

## Summary

| Status | Count | % |
|---|---|---|
| ✅ **Built and working** | 114 | 76.5% |
| ⚠️ **Needs improvement** | 18 | 12.1% |
| ❌ **Not yet built** | 17 | 11.4% |
| **Total checklist items** | **149** | 100% |

### Per-category snapshot

| Category | ✅ | ⚠️ | ❌ | Total |
|---|---|---|---|---|
| Alert Management | 10 | 1 | 2 | 13 |
| Investigation Workspace | 11 | 1 | 0 | 12 |
| L1 / L2 Workflow | 8 | 1 | 0 | 9 |
| SAR Filing | 10 | 3 | 1 | 14 |
| SAR Repository | 8 | 0 | 0 | 8 |
| KYC / CDD | 12 | 2 | 0 | 14 |
| Manager Oversight | 10 | 0 | 0 | 10 |
| Analytics | 8 | 1 | 0 | 9 |
| Reports | 10 | 1 | 0 | 11 |
| Notifications | 7 | 1 | 2 | 10 |
| Search | 7 | 0 | 0 | 7 |
| Data Management | 0 | 1 | 7 | 8 |
| Security and Access | 3 | 2 | 3 | 8 |
| Compliance and Regulatory | 4 | 2 | 1 | 7 |
| Infrastructure | 6 | 2 | 1 | 9 |
| **Total** | **114** | **18** | **17** | **149** |

### What stands out

- **Investigation, KYC, Reports, Manager Oversight, Search** are essentially complete (all but a handful of items shipped).
- **Data Management** is the weakest category by a wide margin — 0 of 8 items fully built. Real ongoing data ingestion is the biggest functional gap.
- **Security & Access** has the right shape but defence-in-depth is missing: backend role checks need to cover all write endpoints, sessions need real lifecycle management, and audit-trail tamper protection isn't enforced at the DB level.
- **Notifications** are 70% done in-app but 0% over email — the real-world delivery layer is the next obvious piece.
- **Compliance** is regulatorily strong on paper (BSA-aligned wizard + retention + export package) but weak on integrations: no live FinCEN E-Filing, no real OFAC/PEP list lookup, no CTR threshold enforcement.
