# Crowe ARC — Project Brief

**Crowe ARC — Alert Review & Casework**
A purpose-built workbench for AML compliance teams in US banking.

---

## 1. Executive Summary

Crowe ARC (Alert Review & Casework) is a single, integrated application that gives a bank's anti-money-laundering (AML) compliance team everything it needs to investigate suspicious activity, decide what to do about it, and prove the work to a regulator. Today, an analyst chasing a single alert has to log into a transaction-monitoring system, a separate customer-database, a shared drive of PDFs, a spreadsheet of KYC reviews, and a regulatory filing portal — switching tools five times to make one decision. Crowe ARC pulls all of that into one screen: the alert, the customer, the transactions, the case file, the documents, the audit trail, and the regulatory Suspicious Activity Report (SAR) it eventually becomes. Frontline analysts work the queue, senior investigators take over the harder cases, and a compliance manager watches the whole team's workload, SLA health, and SAR pipeline from a live dashboard. The result is faster decisions, fewer dropped balls, and a clean record that holds up in an exam.

---

## 2. The Problem We Are Solving

Every AML team in every bank is working around the same handful of pain points. They are not glamorous problems, but they consume thousands of analyst-hours a year and create real regulatory risk.

- **Tool sprawl on every alert.** An analyst investigating one alert routinely jumps between five or six systems — the transaction monitor that fired the alert, the core banking system for transactions, the CRM for customer data, the watchlist tool, the SAR drafting system, and shared drives full of evidence files. Context is rebuilt from scratch every time.
- **No single picture of the customer.** Customer KYC, recent transactions, prior alerts, prior SARs, and case history live in different places. The analyst's "investigation" is half spent assembling the picture rather than judging it.
- **Manual SAR filing is slow and error-prone.** SARs are typed into long forms with dozens of fields, often re-keyed from PDFs and spreadsheets. Mistakes get caught only after the manager rejects the draft, sending the analyst back to start over.
- **Managers fly blind on workload.** Most compliance managers see their team's status through a Monday-morning email. They don't know in real time who is overloaded, which alerts are about to breach SLA, or how the SAR queue is building.
- **Alert assignment is manual and lopsided.** Senior analysts get the easy ones, junior analysts get buried, and the team lead spends an hour every day reshuffling.
- **SAR documents end up on shared drives.** A SAR has a 5-year retention requirement under US BSA rules. When evidence is scattered across folders nobody owns, regulators ask for it and the team scrambles.
- **No usable audit trail.** When an examiner asks "show me everything that happened on this case," compliance staff stitch the answer together from emails, spreadsheets, and screenshots.
- **L1 → L2 handoff is fuzzy.** When a junior analyst (L1) thinks an alert needs a deeper look, the escalation to a senior investigator (L2) often happens by email, with no formal record of what L1 already did or why they escalated.
- **KYC reviews fall through the cracks.** Periodic KYC re-reviews are tracked in spreadsheets. High-risk customers due for a review are missed, customers exit without an exit review, and SAR-triggered reviews don't fire.
- **False-positive rate is invisible.** Nobody can answer "which monitoring scenario produces 80% noise?" because nobody is measuring scenario performance against actual SAR outcomes.

Crowe ARC was built specifically to remove every one of those pain points.

---

## 3. What We Built

Crowe ARC is a web application that runs in any modern browser. It is structured as a set of integrated modules — each one solves one of the pain points above, and all of them share a single underlying database, audit log, and notification stream.

### 3.1 Transaction Monitoring Alert Management

The starting point for every investigation. Alerts that come out of the bank's monitoring system land in a queue and flow through a defined lifecycle.

- **Employee Kanban view.** Analysts work from a 5-column board: *Unassigned → Not Started → Work in Progress → Escalated → Completed*. Each card shows the alert ID, customer, scenario (e.g., "Structuring", "High Risk Country"), priority, dollar amount flagged, transaction count, counterparty country, and a live SLA indicator. Critical alerts (under 24 hours to deadline) pulse red.
- **Manager table view.** The manager sees the same alerts as a sortable, filterable table — 12 columns including SLA status, age, team assignment. Filters cover scenario, priority, status, assignee, team, SLA bucket, and date range.
- **Bulk operations.** Managers can select many alerts at once and either bulk-assign them to an analyst (with current workload visible inline) or bulk-close them as False Positive with a captured reason.
- **Live SLA tracking.** Every alert has an SLA deadline calculated from priority. A background job recomputes time-remaining every five minutes and tags each alert as *OK*, *Warning* (≤ 24h left), or *Breached*.
- **Priority and risk levels.** Each alert carries a priority (Low / Medium / High / Critical) and a risk score (0–100) that drive sort order and SLA window.

### 3.2 Investigation Workspace

The split-panel screen where actual investigations happen — the heart of the tool.

- **Left panel (65%):** four tabs covering the *what*.
  - **Transactions** — the customer's full transaction list with the alerted rows visually highlighted, filters by date / type / amount, running balance.
  - **Case Notes** — analyst-written notes with timestamps, owner-only edit/delete.
  - **Documents** — supporting evidence files (screenshots, statements, IDs) uploaded to the case.
  - **Activity Log** — a system-generated trail of every status change, assignment, and escalation on this alert.
- **Right panel (35%):** four tabs covering the *who*.
  - **Customer KYC** — risk rating, KYC status, next-review date, PEP/sanctions flags.
  - **Business Profile** — for corporate customers: industry, beneficial owners, directors, expected activity profile.
  - **Case Info** — linked case ID, case status, and the disposition action buttons (False Positive — Close, Escalate to L2, Escalate to SAR Filing).
  - **Linked Cases** — every other case the same customer has open or recently closed.
- **One-screen rule.** Every piece of context the analyst needs to make a disposition decision is visible without leaving the screen — no more tab-hopping.

### 3.3 L1 and L2 Escalation Workflow

A formal two-tier investigation system that mirrors how real compliance teams are structured.

- **L1 (Tier 1 Monitoring)** is the front line — six analysts who triage every incoming alert. Their decision is binary: *false positive* (close it) or *escalate to L2* (somebody senior needs to look harder).
- **L2 (Tier 2 Investigations)** is the senior tier — four investigators who only see escalated cases. They run a deeper analysis: counterparty pattern detection, risk scoring (10 factors × 10 points = 0–100), structuring/velocity/concentration/geography pattern checks, and a written L2 narrative.
- **Clean handoff.** When L1 escalates, the L2 workspace opens with a *L1 Summary* tab showing every transaction L1 reviewed, every note L1 wrote, every document L1 uploaded, and how long L1 spent on it. Nothing is lost.
- **L2 has three exits.**
  1. **Return to L1** — with a reason and instructions; the alert lands back in L1's queue with a yellow banner.
  2. **Close** — L2 concludes there's no suspicious activity; the alert closes without a SAR.
  3. **Escalate to SAR** — L2 promotes the case to SAR filing; a `CASE-XXXXX` is created, the L1 analyst is notified, and the SAR Filing wizard opens.

### 3.4 SAR Filing and Approval

When a case crosses the threshold of "report to FinCEN", Crowe ARC walks the analyst through a 6-step wizard that mirrors the FinCEN BSA E-Filing form fields exactly.

- **Step 1 — Filing Details.** Institution, filing type, filing method, regulatory agency, BSA SAR type. Pre-filled from defaults.
- **Step 2 — Subject Information.** Customer name, DOB, address, government ID, account numbers — pre-filled from KYC.
- **Step 3 — Suspicious Activity.** Activity types, transaction details, amounts, date range, suspicious activity indicators (structuring, layering, etc.), prior SAR history.
- **Step 4 — Narrative.** Free-text 5W+H narrative with case notes available in a sidebar for reference.
- **Step 5 — Attachments.** Supporting documents; documents already attached to the source alert auto-include.
- **Step 6 — Review & Submit.** Validation summary, certification sign-off checkbox.
- **Auto-save every 30 seconds.** No analyst loses work to a closed tab.
- **Manager Approval Queue.** Submitted SARs land in the manager's queue. The manager opens an approval workspace with the full SAR rendered as 6 read-only tabs, an inline-comments panel for highlighted feedback on the narrative, and a 7-item review checklist that must be complete before approval is allowed.
- **Approve → Filed.** Approval generates a regulator reference number, marks the SAR Filed, and triggers a *SAR-triggered KYC review* on the customer automatically.
- **Reject → Returned.** Rejection captures a reason category, comments, and a checklist of what needs fixing; the SAR returns to the analyst's queue with that feedback attached.
- **After filing.** The SAR enters a 5-year retention window (BSA requirement), tracked in the Retention Monitor.

### 3.5 Customer KYC and Periodic Review

A complete customer-360 directory plus a structured periodic-review system.

- **Customer Directory.** Searchable, filterable list of all bank customers — risk rating, CDD level, KYC status, PEP/sanctions match, days to next review (color-coded red/orange/green for urgency).
- **Customer Profile Page.** Full KYC profile (basics, residential/mailing addresses, IDs, employment, source of funds), business details for corporates (beneficial owners, directors, expected activity), KYC review timeline, linked alerts, linked SARs, account list.
- **KYC Review Queue.** A separate queue (manager-only) with KPI cards for Overdue, Due Soon, In Progress, Completed, and Triggered reviews. Filters by review type and assigned analyst. Manager assigns a review to an analyst with a due date and priority.
- **KYC Review Workspace.** Split-panel screen for the analyst:
  - Left: Customer Profile, a structured 4-group / 13+ item checklist, supporting documents, and a Findings tab (narrative ≥ 100 chars, new risk rating, new CDD level, recommendation dropdown).
  - Right: KYC Summary, Alert History, SAR History, Review History.
  - Auto-save every 30 seconds; submit blocked until checklist complete and findings signed off.
- **Manager approval flow.** Completed reviews go to the manager for approval. On approval, the customer's risk rating updates everywhere in the system in real time, the next-review date auto-recalculates based on the new rating, and the customer can be flagged for exit if appropriate.
- **Three trigger types**, all auto-created by a daily background job:
  1. **Scheduled** — driven by risk rating (Very High: 180d / High: 365d / Medium: 730d / Low: 1095d).
  2. **Triggered by SAR** — fires when a SAR is filed in the last 30 days.
  3. **Triggered by alerts** — fires when a customer has 3+ alerts in the last 90 days.

### 3.6 Manager Dashboard and Oversight

The manager's command center — visibility the manager has never had before.

- **9 KPI cards** with clickable drawers: Total Alerts, In Progress, Completed, SLA Breaches, Average Aging, Cases Converted, Unassigned Queue, False Positive Rate, Team Capacity. Each card opens a drill-down drawer showing the underlying records.
- **Date range filter** (Last 7 / 30 / 90 days, YTD) refreshes every card and every drawer in sync.
- **SLA Watch widget** lists the most-overdue alerts in real time so the manager can intervene before a breach.
- **Analyst Workload table** shows each analyst's open alerts, in-progress count, breaches, completions, and a capacity utilization bar.
- **Charts.** Alert Volume trend (line), Alert Status (donut), SLA Breaches by aging bucket (bar), Alerts by scenario (donut).
- **L2 Oversight.** Manager sees L2 queue depth, average L2 review time, decisions this month.
- **Cases Converted card** uniquely surfaces alert → case → SAR conversion percentage as the headline metric, with a 3-line sub showing alerts / cases / SARs counts.

### 3.7 Analytics and Reports

Two distinct surfaces — Analytics for trend exploration, Reports for scheduled compliance output.

- **Analytics (5 tabs).**
  1. **Alert Trends** — volume (new vs. closed), backlog growth, by scenario, by priority, conversion rate.
  2. **SAR Trends** — monthly filings, alert-to-SAR conversion, 30-day filing timeliness, dollar amounts, rejection rates.
  3. **Team Performance** — average resolution days, SLA breach rate by priority, productivity per analyst, workload balance, activity heatmaps.
  4. **Rule Effectiveness** — true / false positive rates by scenario, SAR conversion by scenario, resolution time by scenario.
  5. **Customer Risk** — risk distribution, KYC compliance % over time, high-risk concentration, industry × risk matrix.
- **Reports.** Eight pre-built compliance reports for the manager (SAR Summary, SLA Breach, Team Performance, KYC Status, False Positive Rate, Audit Trail Export, Regulatory Compliance, Alert Aging) and four for the analyst (My Alerts, My SLA, My SARs, My KYC Reviews). Each is generated for a date range and exported to PDF or Excel. Managers can schedule any report to recur (weekly, monthly, quarterly) and email to a recipient list.

### 3.8 Notifications and SLA Alerts

Two parallel notification surfaces.

- **Bell notifications** (top-right of every screen). A poll runs every 30 seconds and updates the unread badge. Triggers include: new SAR pending approval, SAR approved, SAR rejected, KYC review assigned, KYC review pending approval, SLA warning, SLA breach, L2 case assigned, L1 case returned from L2.
- **SLA popup toasts** (bottom-right). When the SLA monitor flags an alert as Warning or Breach, a toast pops up with the alert ID, customer name, time remaining, and a progress bar. Breaches play a sound. Toasts stack (max 3 visible, the rest collapse) and persist until dismissed.

### 3.9 Settings

Two distinct settings surfaces.

- **Manager settings (32+ keys across 6 sections).** SLA configuration (per-priority days, warning threshold %, auto-escalate days), scenario thresholds (which scenarios are active, risk weight, auto-assign team, priority overrides), team & workload (capacity warning %, round-robin, workload-based assignment), SAR & retention (5-year retention, dual approval requirement, mandatory fields), reporting (refresh interval, recipient lists, default export format), audit & compliance (require FP reason, minimum note length, session timeout).
- **Employee settings (per-analyst).** Workspace preferences (landing page, alert sort order, default transaction date range), investigation workspace (default left/right tab, auto-expand alerted rows, auto-save interval), notifications (per-event toggles, sound, banner style), display (date format, time format, currency format, row density, theme), documents & notes (default doc type, spellcheck, note template).

### 3.10 Global Search

A keyboard-first search palette accessible anywhere in the app via **Ctrl+K**.

- Searches across alerts, customers, cases, and SARs.
- Results group by type — up to 4 alerts, 3 customers, 3 cases, 3 SARs — and indicate when more results exist.
- Result rows navigate directly to the relevant page on click.
- Employee scope is restricted to records the active analyst is involved in; manager scope is unrestricted.

### 3.11 Data Import Pipeline

For getting fresh alert data into the system without code changes.

- The seed data lives in CSVs (`backend/database/seed_data/aml_shield_alerts.csv` and `aml_shield_sar_filings.csv`).
- A managed import flow (upload → preview → validate → confirm) lets the manager bring new alert batches into the database. Reference data populates customers, accounts, transactions, and the alert-to-transaction linkage automatically.
- A SQLite migration system handles schema upgrades without losing existing data — the database has built-in migrations for INR-to-USD conversion and KYC trigger backfill.

---

## 4. Who Uses It and How

Crowe ARC has three distinct user roles. The role is derived from the URL — `/manager/*` for manager screens, `/employee/*` for analyst screens — so a single browser can have both views open in side-by-side tabs.

### Compliance Manager — Henry Morgan
**What they see:** the full team dashboard, the alert table across the entire bank, the SAR approval queue, the KYC review queue, the retention monitor, the audit log, all analytics, all reports, the user directory, and full settings.
**What they do:** assign and reassign alerts, set SLA / scenario / workload policies, approve or reject SARs, approve or reject KYC reviews, monitor SLA breaches in real time, run regulatory and operational reports, schedule recurring reports, and respond to SAR-pending notifications.
**Decisions they make:** workload balancing, SAR approval, KYC review approval, scenario tuning, escalation policy.

### AML Analyst L1 — Tier 1 Monitoring (6 analysts)
**Roster:** Robert Wright, Arjun Sharma, Priya Nair, Rohit Mehta, Neha Iyer, Vikram Sinha.
**Daily workflow from open to close:**
1. Open Crowe ARC → land on My Dashboard. Bell shows any overnight assignments.
2. Click *My Alerts* → see personal Kanban with everything assigned to them.
3. Click an unassigned alert → click *Assign to Me* → click *Start Investigation*.
4. Investigation Workspace opens. Read transactions, check customer KYC, look at linked cases, look at counterparty country.
5. Add case notes and upload supporting documents as the investigation progresses.
6. Click the *Case Info* tab → pick a disposition.
   - *False Positive — Close* → pick a reason → alert closes.
   - *Escalate to L2* → fill an escalation reason → alert moves to the L2 queue.
7. Move on to the next alert. SLA timer is always visible.

### AML Analyst L2 — Tier 2 Investigations (4 analysts)
**Roster:** Olivia Brown, Cassian Jude, Marie Davis, Hannah Louise.
**What escalated cases look like:** an L2 case lands in the L2 queue with the L1 analyst's full work history attached. The L2 case shows priority, scenario, escalated-by, escalated-at, and the original L1 disposition narrative.
**How deep analysis works:** the L2 analyst opens the L2 Investigation Workspace (purple-themed split panel). They review the L1 Summary tab first (every transaction, note, and document L1 produced). They then run the *Deep Analysis* tab — checking 10 risk factors at 10 points each (PEP exposure, sanctions adjacency, jurisdictional risk, structuring pattern, velocity anomaly, concentration risk, counterparty network, source-of-funds gaps, KYC gaps, prior SAR history) for a 0–100 risk score. They write the L2 narrative. They use the counterparty analysis tool to identify linked entities and patterns.
**How they decide.** The Decision tab shows the calculated risk score in a color-coded band (Low / Medium / High / Critical). Three buttons:
1. *Return to L1* — with reason and instructions.
2. *Close* — no SAR needed.
3. *File SAR* — promotes to SAR filing wizard, marks the L2 case decided.

---

## 5. End-to-End Workflow

The complete alert lifecycle, step by step.

**Step 1 — Alert arrives.** The bank's transaction monitoring engine fires an alert. It lands in Crowe ARC's *Unassigned* column with a calculated SLA deadline based on its priority.

**Step 2 — Manager assigns.** The manager opens the alerts table, sees the unassigned alert, and either assigns it manually or bulk-assigns a batch to an L1 analyst.

**Step 3 — L1 opens the investigation.** The L1 analyst clicks the alert in *My Alerts*, hits *Assign to Me* (if not already assigned), then *Start Investigation*. The Investigation Workspace opens.

**Step 4 — L1 reviews context.** Left panel: read the alerted transactions and surrounding history. Right panel: read the customer's KYC profile, business profile, and any linked cases.

**Step 5 — L1 documents the work.** Add case notes describing what was checked. Upload supporting documents — screenshots of transactions, IDs, statements.

**Step 6 — L1 makes a disposition decision.** Switch to the Case Info tab. Pick one:

**Step 7a — False Positive path.** Click *False Positive — Close* → confirm with reason → alert closes, audit log records the disposition, alert leaves the queue.

**Step 7b — L2 Escalation path.** Click *Escalate to Level 2* → write an escalation reason → alert moves to the L2 queue with status *Escalated* (read-only for L1).

**Step 8 — L2 deep analysis.** L2 analyst picks up the case from the L2 queue, reviews the L1 Summary tab, runs the Deep Analysis with 10-factor risk scoring, performs counterparty analysis to look for linked entities and patterns, writes the L2 narrative.

**Step 9 — L2 decides.** Three exits — return to L1, close, or escalate to SAR. If escalating to SAR, a `CASE-XXXXX` is created and the L1 analyst is notified.

**Step 10 — SAR Filing wizard.** The analyst (L1 or L2 depending on workflow) walks through the 6-step SAR wizard. Auto-save runs every 30 seconds. On submit, the SAR moves to *Pending Approval*.

**Step 11 — Manager review.** The bell on the manager's screen lights up — *SAR pending approval*. Manager clicks → opens the SAR Approval Review workspace with all 6 SAR sections in read-only tabs, inline comments panel for narrative feedback, and a 7-item review checklist.

**Step 12 — Manager approves.** All checklist items complete → click *Approve*. The system generates a regulator reference number, marks the SAR *Filed*, automatically creates a SAR-triggered KYC review on the customer, and notifies the analyst.

**Step 13 — Retention.** The filed SAR enters a 5-year retention window, tracked daily in the Retention Monitor with color-coded urgency. Legal hold can override the retention clock.

**Step 14 — KYC review triggered.** The auto-created KYC review lands in the analyst's *My KYC Reviews* queue. The analyst opens the KYC Review Workspace, completes the 13+ item checklist, writes findings, recommends a new risk rating and CDD level, submits for approval. The manager approves. The customer's risk rating updates everywhere in real time, and the next-review date auto-recalculates.

The full lifecycle, from alert arriving to KYC review closing, is captured in a single audit trail visible to any examiner.

---

## 6. Regulatory Alignment

Crowe ARC was designed against the US Bank Secrecy Act (BSA) framework administered by FinCEN.

- **Bank Secrecy Act (BSA).** Core record-keeping and reporting requirements are met by the audit trail (every action on every record is logged with timestamp, actor, and details), the structured SAR filing workflow, and the 5-year retention enforcement.
- **FinCEN SAR filing — 30-day deadline.** The system tracks the detection date and surfaces filing-deadline urgency in the SAR Repository and the Regulatory Compliance report. Analytics shows 30-day timeliness as a tracked KPI.
- **5-year SAR retention.** The Retention Monitor tracks every filed SAR's expiry date, surfaces SARs expiring in ≤ 90 days and ≤ 30 days, supports legal hold to override the clock, and reports retention compliance as a regulatory KPI.
- **CTR threshold awareness ($10,000).** The Currency Transaction Report threshold is recognized in the structuring detection logic and surfaces in the suspicious-activity-types pick list during SAR filing.
- **OFAC / Sanctions screening support.** Each customer record carries a `sanctions_match` flag and a `pep_match` flag, both surfaced on the alert card, the customer profile, and in the alert/customer filters.
- **KYC / CDD periodic review.** The kycReviewMonitor background job auto-creates scheduled reviews based on risk rating intervals (180/365/730/1095 days), auto-creates SAR-triggered reviews when a SAR is filed, and auto-creates alert-triggered reviews when a customer accumulates 3+ alerts in 90 days. Overdue and due-soon reviews are tracked daily.
- **Audit trail for examiners.** The Audit Log page filters by SAR ID, action type (14 categories: Detection Logged, Draft Created, Submitted, Filed, Acknowledged, Legal Hold, Updated, Doc Upload/Download/Delete, Export, Retrieval, etc.), and timestamp range. The Audit Trail Export report produces a regulator-ready document covering SAR actions, approvals, and case notes.

---

## 7. Tech Stack

### Frontend
| Tech | Purpose |
| --- | --- |
| **React 18** | UI framework — component-based rendering |
| **Vite 5** | Dev server and production bundler — instant hot-reload, fast builds |
| **Tailwind CSS** | Utility-first styling — consistent design system without separate CSS files |
| **React Router 6** | Client-side routing — `/manager/*` and `/employee/*` route groups |
| **Recharts** | Charts on the dashboard and analytics pages — line, bar, donut, area |
| **Lucide React** | Icon library used across the sidebar, topbar, and cards |
| **jsPDF + jsPDF-AutoTable** | Client-side PDF generation for report exports |
| **SheetJS (xlsx)** | Client-side Excel generation for report exports |
| **Axios** | HTTP client — auto-injects `analyst_id` for `/employee/*` URLs via an interceptor |
| **date-fns** | Date arithmetic and formatting |

### Backend
| Tech | Purpose |
| --- | --- |
| **Node.js 22.5+** | Server runtime — required for the built-in `node:sqlite` module |
| **Express 4** | HTTP server and routing layer |
| **node:sqlite** | Native, zero-dependency SQLite driver shipped inside Node 22.5+ |
| **Multer** | File upload middleware for SAR documents, case documents, and KYC review documents |
| **Morgan** | HTTP request logger |
| **Archiver** | Builds SAR export ZIP packages |
| **CORS** | Cross-origin support between frontend (port 3000) and backend (port 4000) |

### Architecture
- **REST API.** All backend functionality is exposed under `/api/*` — 21 route modules covering alerts, cases, SARs, KYC, customers, dashboard, analytics, reports, search, and admin.
- **Single-page application.** Frontend is one bundled SPA served by Vite in dev or any static host in production.
- **URL-based role routing.** The user's role is derived from the URL prefix (`/manager` vs `/employee`). No login wall — designed for demo and pilot environments where role separation lives at the URL.
- **Active analyst session via localStorage.** The active analyst (for `/employee/*`) is stored in `localStorage` under `aml_active_analyst`. An Axios interceptor auto-injects it as `?analyst_id=` on every API call.
- **SQLite WAL mode.** The database uses Write-Ahead Logging for concurrent reads during writes — no separate database server required.
- **Background jobs in-process.** SLA monitor (every 5 min) and KYC review monitor (daily) run as `setInterval` workers inside the same Node process — no separate scheduler or worker tier.
- **Local file storage.** Uploaded SAR documents, case documents, and KYC review documents live in `backend/uploads/`.

---

## 8. Current Limitations

Crowe ARC is a complete demo/pilot environment. It is honest about what it is not yet.

- **No real authentication system.** There is no login wall. The role is derived from the URL (`/manager/*` vs `/employee/*`). The active analyst is selected from a dropdown and stored in `localStorage`. This is suitable for demo, walkthrough, and pilot — not production.
- **Not connected to real FinCEN systems.** SAR filing references and BSA E-Filing fields are simulated. There is no live integration to the FinCEN BSA E-Filing portal — the regulator reference number is generated locally.
- **Not a real transaction monitoring engine.** Alerts are pre-loaded from CSVs at seed time. The application investigates and dispositions alerts; it does not detect them. A real bank would feed alerts in from its existing monitoring engine.
- **Single bank environment.** The institution is hard-coded as **First National Bank — US** (FEIN: 12-3456789, 200 Park Avenue, New York, NY 10166). No multi-tenant or multi-bank support.
- **Runs on localhost.** Designed for local execution (`npm start` brings up backend on :4000 and frontend on :3000). Not yet deployed to a cloud environment.
- **Local file uploads.** Uploaded files are stored in the backend's `uploads/` directory on local disk. No cloud object storage (S3, Azure Blob).
- **No email notifications.** All notifications are in-app (bell icon and SLA popup toasts). No SMTP email or SMS escalation.

---

## 9. Scope for Further Development

A roadmap of what could be built next, organized by horizon.

### Near-term (next phase)
- **Real authentication.** JWT-based login with role-based access control replacing URL-based roles. Single sign-on (SSO) integration via SAML or OIDC.
- **Cloud deployment.** Frontend on Vercel, backend on Railway or Render, database migrated to managed Postgres or Supabase. CI/CD pipeline.
- **Email notifications.** SMTP integration for bell-event delivery to analysts and managers; daily digest emails.
- **SAR narrative AI assistant.** LLM-backed assistant inside Step 4 of the SAR wizard that drafts narratives from case notes, transactions, and customer context.
- **Customer 360 view.** A unified single-page customer view combining KYC, transactions, alerts, SARs, cases, and reviews on one screen.
- **Case linking.** Multiple alerts linked to a single customer case with case-level disposition.
- **Alert auto-routing rules.** Manager-defined rules that auto-assign incoming alerts based on scenario, priority, customer segment, and analyst workload.
- **Real-time updates.** WebSocket or Server-Sent Events to push alert assignments, SAR approvals, and notifications without polling.

### Medium-term
- **Integration with real transaction monitoring engines.** Webhook or message-queue ingestion from Actimize, Verafin, Featurespace, etc.
- **Direct FinCEN BSA E-Filing integration.** API-based SAR submission to FinCEN with status callbacks.
- **Multi-bank / multi-tenant support.** Schema and UI changes for a single Crowe ARC instance to serve multiple institutions.
- **Mobile-responsive layout.** Phone and tablet layouts for L1 triage and manager monitoring on the go.
- **Advanced watchlist screening.** Real-time OFAC, UN, and PEP list screening with fuzzy matching and false-positive handling.
- **Bulk alert operations expansion.** Bulk escalate, bulk reassign, bulk priority change, bulk SLA extension.

### Long-term
- **Machine learning for false-positive reduction.** Models trained on historical disposition data that pre-score new alerts and surface the most-likely-suspicious first.
- **Predictive risk scoring.** Customer risk ratings driven by behavioral models rather than static rule-based intervals.
- **Network analysis.** Graph view of customers and counterparties to surface ring structures, mule networks, and shell-company patterns.
- **Regulator portal access.** A separate, audit-only portal for examiners with read access to SARs, the audit trail, and the retention monitor.
- **Audit examination package auto-generation.** One-click export of every artifact a regulator might ask for during an exam — SAR PDFs, audit trails, retention status, KYC review history — bundled with chain-of-custody.

---

## 10. Data Model Summary

All data lives in a single SQLite database (`backend/database/aml.db`). Below is every table, what it stores, and current row counts.

| Table | Purpose | Rows |
| --- | --- | --- |
| **alerts** | The transaction monitoring alerts that drive the entire workflow. Includes scenario, priority, risk score, dollar amount, SLA deadlines, disposition, L2 escalation linkage, FP close reason. | 250 |
| **transactions** | Individual financial transactions tied to customers and accounts; flagged-vs-not flag links transactions to their alerts. | 1,784 |
| **accounts** | Customer accounts (checking, savings, etc.) with balance, currency, status. | 61 |
| **customers** | The bank's customer directory — KYC profile, business profile, risk rating, PEP/sanctions match, KYC due dates. | 25 |
| **cases** | Investigation cases (`CASE-XXXXX`) created when an alert is escalated to SAR or formal investigation. | 56 |
| **case_notes** | Free-text notes analysts write during an investigation, tied to an alert. | 223 |
| **case_documents** | Supporting evidence files uploaded to an alert investigation. | 1 |
| **sar_filings** | Suspicious Activity Reports — drafts, under review, filed, acknowledged. The 6-step wizard writes here. | 36 |
| **documents** | Supporting documents attached to SAR filings. | 205 |
| **sar_review_comments** | Inline highlighted comments managers leave on SAR narratives during review. | 0 |
| **sar_approval_log** | Approve / reject decisions on SARs with reason categories and checklist completion. | 29 |
| **audit_trail** | Immutable log of every action on every SAR — detection, drafting, submission, filing, document operations, retrieval. | 287 |
| **retrieval_log** | Records when a SAR is retrieved or exported (e.g., for law enforcement requests) with purpose and requester. | 0 |
| **kyc_reviews** | Periodic KYC reviews — scheduled, triggered_sar, triggered_alerts, manual; status, checklist, findings, recommendation. | 39 |
| **kyc_review_documents** | Documents attached to KYC reviews. | 1 |
| **l2_cases** | L2 escalation cases — the deeper investigation tier with risk scoring, counterparty analysis, decision. | 9 |
| **l2_notes** | L2-specific investigation notes. | 1 |
| **l2_documents** | Documents attached to L2 cases. | 0 |
| **notifications** | Bell notifications for managers and analysts — SAR pending, KYC assigned, SLA warning, etc. | 86 |
| **user_profiles** | The 11 team members (1 manager, 6 L1, 4 L2) with role, team, status, avatar color, email. | 11 |
| **manager_settings** | Manager-level configuration keys (SLA, scenarios, team, SAR, reporting, audit) — 32 keys. | 32 |
| **employee_settings** | Per-analyst preferences (workspace, investigation, notifications, display, documents). | 0 |
| **report_schedules** | Recurring scheduled reports the manager has set up (frequency, format, recipients). | 0 |
| **sqlite_sequence** | Internal SQLite autoincrement bookkeeping. | 21 |

The CSV seed data is pinned to reference date **2026-04-23**. All "days overdue", "days remaining", and retention countdowns are computed relative to *today*, so demo behaviour evolves naturally over time.

---

## 11. Team

| | |
| --- | --- |
| **Organization** | Crowe |
| **Tool Name** | Crowe ARC — Alert Review & Casework |
| **Environment** | US Banking — First National Bank — US (FEIN 12-3456789, 200 Park Avenue, New York, NY 10166) |
| **Regulatory Framework** | FinCEN / BSA (Bank Secrecy Act) |
| **Roster** | **Compliance Manager:** Henry Morgan **L2 Investigators (T2):** Olivia Brown, Cassian Jude, Marie Davis, Hannah Louise **L1 Analysts (T1):** Robert Wright, Arjun Sharma, Priya Nair, Rohit Mehta, Neha Iyer, Vikram Sinha |
