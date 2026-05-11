# Crowe ARC — Project Brief

*Alert Review & Casework — A purpose-built workbench for AML compliance teams in US banking.*

---

## 1. What Is Crowe ARC

Crowe ARC is an internal web application that gives a bank's anti-money laundering (AML) team one place to do its job. It is the workspace where a compliance analyst reviews a suspicious-activity alert, investigates the underlying transactions and customer, decides whether to close it or escalate it, prepares the regulatory filing (the Suspicious Activity Report, or SAR), and hands it to a manager for approval — all without leaving the screen. It also gives the compliance manager a live view of the entire team's workload, the alerts that are about to miss their deadlines, the SARs waiting for approval, the KYC reviews coming due, and the connections between customers that might point to a larger money-laundering ring. Crowe ARC is built for the people inside a bank's compliance function — analysts who work alerts every day, senior investigators who take the harder cases, and the manager who is responsible for the whole operation. The problem it solves is simple: today that work happens across five or six disconnected systems, and Crowe ARC puts it back together in one workbench.

---

## 2. The Problem It Solves

AML compliance teams everywhere struggle with the same handful of recurring pain points. They are not glamorous problems, but they consume thousands of analyst hours every year and create real regulatory risk.

- **Analysts switch tools constantly.** Investigating a single alert routinely means jumping between the transaction-monitoring system, the core banking system, the customer-relationship database, a watchlist tool, a SAR drafting application, and shared drives full of evidence. Context is rebuilt from scratch every time.
- **There is no single place for investigation, SAR filing, and KYC review.** Each of these activities is part of the same case file, but they happen in different applications with no shared record.
- **Managers have no real-time visibility into their team.** Most compliance managers see workload through a Monday-morning email. They do not know who is overloaded, which alerts are about to breach the deadline, or how the SAR queue is building.
- **SLA tracking is manual.** Every alert has a regulatory clock attached to it; today, teams track those clocks in spreadsheets, missed reminders, and personal memory.
- **Audit trails are inconsistent.** When an examiner asks "show me everything that happened on this case", staff stitch the answer together from emails, screenshots, and individual recollection.
- **SAR narratives are slow to write.** Each SAR requires a free-text narrative covering the who, what, where, when, why and how of the suspicious activity. Analysts type these from scratch every time, often re-keying facts from PDFs and spreadsheets.
- **Connections between customers are invisible.** Two unrelated-looking customers may be sending money to the same shell company. Today, nobody looks — there is no tool that finds those links.

Crowe ARC was built specifically to remove every one of those pain points.

---

## 3. Who Uses It

Crowe ARC supports three distinct user roles. Every user has a real login account with a username and password; the role determines which screens they see and which actions they can take.

### Compliance Manager (Henry Morgan)

The manager sees the full picture. On login they land on a team-wide dashboard with nine live KPI cards — total alerts, alerts in progress, completed alerts, SLA breaches, average aging, cases converted to SARs, team capacity utilization, false-positive rate, and the unassigned-alert queue. Every card is clickable and drills down to the underlying records. Manager-only screens include the full alert table across the entire bank, the case queue, the new Linked Cases Network View, the SAR Approval Queue, the KYC Review Queue, the Retention Monitor, the Audit Log, the Analytics suite, the Reports library, the user directory, and the full Settings panel.

What the manager can do that nobody else can: assign and reassign alerts to analysts; bulk-assign or bulk-close batches of alerts; approve or reject SARs; approve or reject completed KYC reviews; change SLA, scenario, workload, and SAR retention policies; run scheduled reports; and see the network analysis that surfaces hidden customer connections.

### AML Analyst L1 — Tier 1 Monitoring (six analysts)

L1 analysts are the front line. Their daily workflow is:

1. **Log in.** They land on a personal dashboard showing their own queue, their SLA status, the alerts they are working, and any notifications from overnight.
2. **Open My Alerts.** This is a Kanban board (Unassigned → Not Started → Work in Progress → Escalated → Completed) showing every alert assigned to them. Cards are colour-coded by priority and SLA urgency.
3. **Pick an alert.** They click an unassigned alert, hit *Assign to Me*, then *Start Investigation*. The Investigation Workspace opens — a split screen with the transactions, customer KYC, and case file on the same page.
4. **Investigate.** They read the alerted transactions, check the customer's risk rating and KYC profile, look at the counterparty country, scan prior alerts on the same customer, and upload any supporting documents they have gathered.
5. **Decide.** Three exits: *Close as False Positive* (with a reason captured), *Escalate to Level 2* (the case goes to a senior investigator), or *Escalate directly to SAR Filing* (the case becomes a regulatory report).
6. **Move on.** The SLA timer is always visible. They work through the queue in priority order.

### AML Analyst L2 — Tier 2 Investigations (four analysts)

L2 analysts pick up only escalated cases. The L2 workspace opens with everything the L1 analyst already did attached — every transaction reviewed, every note written, every document uploaded, plus how long L1 spent on it. The L2 analyst then runs a deeper analysis: a 10-factor risk scoring system (0–100 points across factors like PEP exposure, sanctions adjacency, jurisdictional risk, structuring pattern, velocity anomaly, concentration risk, counterparty network, source-of-funds gaps, KYC gaps, and prior SAR history), counterparty pattern detection (structuring, velocity spikes, round-amount usage, wire concentration, high-risk geography), and a written L2 investigation narrative.

L2 has three exits: *Return to L1* (with a reason and remediation instructions; the alert lands back in L1's queue), *Close* (no SAR needed; the alert closes), or *Escalate to SAR* (the SAR Filing wizard opens, a case ID is created with the prefix `CAS-` indicating L2 origin, and the original L1 analyst is notified).

### Current team in the system

| Role | Name | Username | Team |
|---|---|---|---|
| Compliance Manager | Henry Morgan | henry.morgan | Compliance Leadership |
| L2 Investigator | Olivia Brown | olivia.brown | Tier 2 Investigations |
| L2 Investigator | Cassian Jude | cassian.jude | Tier 2 Investigations |
| L2 Investigator | Marie Davis | marie.davis | Tier 2 Investigations |
| L2 Investigator | Hannah Louise | hannah.louise | Tier 2 Investigations |
| L1 Analyst | Robert Wright | robert.wright | Tier 1 Monitoring |
| L1 Analyst | Arjun Sharma | arjun.sharma | Tier 1 Monitoring |
| L1 Analyst | Priya Nair | priya.nair | Tier 1 Monitoring |
| L1 Analyst | Rohit Mehta | rohit.mehta | Tier 1 Monitoring |
| L1 Analyst | Neha Iyer | neha.iyer | Tier 1 Monitoring |
| L1 Analyst | Vikram Sinha | vikram.sinha | Tier 1 Monitoring |

---

## 4. Full Feature List

Every feature below is built, wired, and working in the current deployment.

### Alert Management

| Feature | What it does | Who uses it |
|---|---|---|
| Alert Kanban board | Five-column board (Unassigned, Not Started, Work in Progress, Escalated, Completed) where each card shows the alert ID, customer, scenario, priority, dollar amount flagged, transaction count, counterparty country, and live SLA indicator. | L1, L2 |
| Manager Alerts Table | Full bank-wide alerts table with twelve columns (status, age, SLA, scenario, priority, customer, amount, assignee, team, last activity, days remaining, action). Filterable, sortable, paginated. | Manager |
| Bulk assignment | Manager selects multiple alerts and assigns them to a single analyst in one click; the system enforces the analyst's per-person workload cap and surfaces who is over capacity. | Manager |
| Bulk close as False Positive | Manager selects multiple alerts and closes them all with a single captured reason. | Manager |
| Status workflow with audit | Every status change writes an audit-trail entry showing who did it, when, and why. | All |
| SLA real-time tracking | Each alert has an SLA deadline derived from its priority; the system shows time-remaining, warning state, and breach state live on every card and row. | All |
| Linked cases view | On the investigation screen, every other open or recently closed case for the same customer is shown side-by-side. | L1, L2 |

### Investigation Workspace (L1)

| Feature | What it does | Who uses it |
|---|---|---|
| Split-panel workspace | Left panel (transactions, case notes, documents, activity log) and right panel (customer KYC, business profile, case info, linked cases) on the same screen. | L1 |
| Transactions with alerted-row highlighting | The customer's full transaction list with the rows that triggered the alert visually marked. | L1, L2 |
| Case Notes | Free-text notes with timestamps; the writer can edit or delete their own. | L1, L2 |
| Case Documents | Upload supporting evidence (screenshots, statements, IDs) attached to the alert. | L1, L2 |
| Activity Log | A system-generated trail of every status change, assignment, escalation, and disposition action on this alert. | All |
| Disposition decision | Three buttons in the Case Info tab — False Positive Close, Escalate to L2, Escalate to SAR. | L1, L2 |

### L2 Escalation Workspace

| Feature | What it does | Who uses it |
|---|---|---|
| L2 case queue | A dedicated queue showing only cases escalated from L1, sorted by priority and age. | L2, Manager |
| L1 Summary tab | When L2 opens an escalated case, every transaction reviewed, every note written, and every document uploaded by L1 is right there — no context is lost. | L2 |
| 10-factor risk scoring | A structured scoring tool that produces a 0–100 risk score across ten pre-defined factors. | L2 |
| Pattern detection | Built-in checks for structuring, velocity spikes, round-amount activity, wire concentration, and high-risk-country exposure. | L2 |
| Counterparty analysis | Tool that maps which counterparties this customer has transacted with, broken down by frequency and amount. | L2 |
| L2 narrative | A long-form text field for the senior investigator's written conclusion. | L2 |
| Three-way decision | Return to L1, Close without SAR, or Escalate to SAR Filing. | L2 |

### SAR Filing

| Feature | What it does | Who uses it |
|---|---|---|
| Six-step SAR wizard | Mirrors the FinCEN BSA E-Filing form: Filing Details → Subject Information → Suspicious Activity → Narrative → Attachments → Review & Submit. | L1, L2 |
| Pre-fill from KYC | Step 2 (Subject Information) auto-fills customer name, date of birth, address, government ID, and account numbers from the customer record. | L1, L2 |
| Pre-fill from alert | Step 3 (Suspicious Activity) auto-fills activity types, amounts, date range, and prior SAR history from the alert and case. | L1, L2 |
| Narrative generator | A built-in template engine drafts a starting narrative from the alert scenario, transaction details, case notes, and L2 investigation conclusion. | L1, L2 |
| Joint SAR support | If a related SAR has already been filed, this filing can be linked to it. | L1, L2 |
| Continuing SAR support | A SAR that follows up on a previously filed SAR can reference it directly. | L1, L2 |
| Configurable mandatory fields | Which fields a manager has marked as mandatory can be changed in settings; the wizard enforces them on submit. | Manager (config), L1/L2 (use) |
| Auto-save every 30 seconds | No analyst loses work to a closed browser tab. | L1, L2 |

### SAR Approval Queue

| Feature | What it does | Who uses it |
|---|---|---|
| Manager approval queue | Every submitted SAR lands in the manager's queue with priority, age, and analyst. | Manager |
| Read-only approval workspace | Manager sees all six SAR sections as read-only tabs, the inline comment thread, and a review checklist. | Manager |
| Inline narrative comments | Manager can highlight any portion of the narrative and leave a comment for the analyst. | Manager |
| Seven-item review checklist | A configurable checklist that must be complete before approval is allowed. | Manager |
| Approve | Generates a regulator reference number (format `FIU-YYYYMMDD-XXXXX`), marks the SAR Filed, sets the filed date, and automatically creates a SAR-triggered KYC review on the customer. | Manager |
| Reject with categorized reason | Returns the SAR to the analyst with a reason category, comments, and a checklist of what to fix. | Manager |
| Dual-approval mode | A manager setting that requires two separate manager approvals before a SAR is Filed. | Manager (config) |

### SAR Repository and Retention

| Feature | What it does | Who uses it |
|---|---|---|
| SAR Repository | Searchable, filterable list of every SAR — drafts, under review, filed, acknowledged, rejected. | Manager (full), L1/L2 (own) |
| SAR detail view | Full SAR record with subject, narrative, transactions, documents, audit trail, and retrieval log. | All |
| Export package | One-click ZIP export of a filed SAR (PDF summary, JSON metadata, all attached documents). | Manager |
| Retention Monitor | A separate screen tracking every filed SAR's five-year retention expiry, with red/orange/green urgency bands. | Manager |
| Configurable retention window | The five-year retention is the default, but the window is read from manager settings and can be adjusted. | Manager (config) |
| Legal hold | A SAR can be flagged for legal hold, which pauses the retention clock. | Manager |
| Retrieval log | Every time a SAR is opened or exported, the action is logged with user, timestamp, and purpose. | All |

### KYC Customer Profiles

| Feature | What it does | Who uses it |
|---|---|---|
| Customer Directory | Searchable, filterable list of every customer with risk rating, CDD level, KYC status, PEP/sanctions flags, and days to next review. | All |
| Customer Profile page | Full 360 view — KYC basics, addresses, IDs, employment, source of funds, business details (industry, beneficial owners, directors), accounts, transactions, linked alerts, linked SARs, KYC review timeline. | All |

### KYC Periodic Reviews

| Feature | What it does | Who uses it |
|---|---|---|
| KYC Review Queue | Manager screen showing every open review by status (overdue, due soon, in progress, completed, triggered). Filterable by review type and analyst. | Manager |
| My Reviews | Analyst's personal queue of reviews assigned to them. | L1, L2 |
| KYC Review Workspace | Split-panel screen with the customer profile, a structured 13+ item checklist across four groups, supporting documents, and a Findings tab where the analyst writes the conclusion, recommended new risk rating, and recommended new CDD level. | L1, L2 |
| Auto-save every 30 seconds | The review draft is never lost. | L1, L2 |
| Submit for approval | Sends the completed review to the manager. | L1, L2 |
| Manager approval | On approval, the customer's risk rating updates everywhere in real time, the next-review date auto-recalculates based on the new rating, and the customer can be flagged for exit if the review recommends it. | Manager |
| Three trigger types | (1) Scheduled by risk rating (Very High = 180 days, High = 365 days, Medium = 730 days, Low = 1095 days), (2) Triggered by a SAR filed in the last 30 days, (3) Triggered by 3+ alerts on the customer in the last 90 days. All three are created automatically by a daily background job. | System (automatic) |

### OFAC Sanctions Screening

| Feature | What it does | Who uses it |
|---|---|---|
| OFAC SDN list sync | A daily background job downloads and refreshes the U.S. Treasury OFAC Specially Designated Nationals list into the database. | System (automatic) |
| Customer screening | Any customer can be screened against the SDN list on demand; matches are surfaced with a confidence score. | All |
| Counterparty screening | Any counterparty referenced in transactions can be screened the same way. | All |
| Confirm or dismiss matches | A reviewer marks a match as a confirmed sanctions hit (which updates the customer record) or dismisses it as a false positive with notes. | All |
| OFAC screening panel | Integrated into the Investigation Workspace so an analyst can screen the customer or counterparty without leaving the case. | L1, L2 |

### Manager Dashboard and KPIs

| Feature | What it does | Who uses it |
|---|---|---|
| Nine KPI cards | Total Alerts, In Progress, Completed, SLA Breaches, Average Aging, Cases Converted to SARs, Team Capacity, False Positive Rate, Unassigned Queue. Each is clickable. | Manager |
| Click-to-drill drawers | Clicking any KPI opens a side drawer with the underlying records and a deeper breakdown. | Manager |
| Date range filter | All Time (default), Last 7 days, Last 30 days, Last 90 days, Year-to-date — all KPI cards and drawers refresh in sync. | Manager |
| SLA Watch widget | Lists the most-overdue open alerts in real time so the manager can intervene before a breach. | Manager |
| Analyst Workload table | Shows each analyst's open alerts, in-progress count, breaches, completions, and capacity utilization. | Manager |
| Personal employee dashboard | The same screen scoped to the logged-in analyst — five KPI cards covering their personal queue. | L1, L2 |

### Analytics

| Feature | What it does | Who uses it |
|---|---|---|
| Alert Trends tab | Volume (new vs. closed), backlog growth, breakdown by scenario and priority, conversion to SAR rate, all charted over time. | Manager |
| SAR Trends tab | Monthly filings, alert-to-SAR conversion, 30-day filing timeliness, dollar amounts, rejection rates. | Manager |
| Team Performance tab | Average resolution days, SLA breach rate by priority, productivity per analyst, workload balance, activity heatmaps. | Manager |
| Rule Effectiveness tab | True and false positive rates by scenario, SAR conversion by scenario, average resolution time by scenario. Highlights scenarios exceeding a configured FP threshold. | Manager |
| Customer Risk tab | Risk distribution, KYC compliance percentage over time, high-risk concentration, industry × risk matrix. | Manager |

### Reports

| Feature | What it does | Who uses it |
|---|---|---|
| Eight manager reports | SAR Summary, SLA Breach Analysis, Team Performance, KYC Status, False Positive Analysis, Audit Trail Export, Regulatory Compliance, Alert Aging. Each runs over a date range and exports to PDF or Excel. | Manager |
| Four employee reports | My Alerts, My SLA Performance, My SARs, My KYC Reviews. | L1, L2 |
| Scheduled reports | Manager can schedule any report to recur (weekly, monthly, quarterly) and email it to a recipient list. | Manager |

### Linked Cases Network View

| Feature | What it does | Who uses it |
|---|---|---|
| Summary statistics | Four KPI cards — total connections found, high-risk connections, customers in the network, shared counterparties. | Manager |
| Counterparty Links tab | A table of every pair of customers who have sent money to the same counterparty, sorted by combined risk first. Filterable by risk level, country, whether either customer has open alerts, and whether either has a SAR on file. | Manager |
| Beneficial Owner Links tab | A table of every pair of customers who share a beneficial owner. (Currently shows an empty-state message — UBO data is not yet populated in production.) | Manager |
| FATF high-risk country badges | Any shared counterparty whose country is on the FATF high-risk list (Myanmar, Syria, Yemen, Iran, Russia, Pakistan, Haiti, North Korea) is flagged with a red badge. | Manager |
| High-risk connection highlighting | Rows where both customers carry a High or Very High risk rating are highlighted with a red left border and a "High Risk Connection" badge. | Manager |
| Connection detail drawer | A 480-pixel side panel showing both customer profiles, every shared counterparty with both sides' transaction history, any shared beneficial owners, the combined list of open alerts for both customers, the SAR history of both, and a free-text investigation note. | Manager |
| Investigation note | A textarea where the manager can record a finding about a specific customer-to-customer connection. The note is written into the audit trail. | Manager |

### Global Search

| Feature | What it does | Who uses it |
|---|---|---|
| Keyboard-first search | Press Ctrl+K anywhere in the app to open the search palette. | All |
| Cross-entity results | Searches alerts, customers, cases, and SARs in a single query. Up to four alerts, three customers, three cases, and three SARs are shown grouped by type. | All |
| Click-through to record | Each result navigates directly to the relevant page. | All |
| Role-scoped results | An analyst only sees records they are involved in; the manager sees everything. | All |

### Notifications and SLA Alerts

| Feature | What it does | Who uses it |
|---|---|---|
| Bell notifications | The top-right bell icon shows an unread count that refreshes every 30 seconds. The dropdown lists every event (new SAR pending approval, SAR approved or rejected, KYC review assigned or pending approval, SLA warning, SLA breach, L2 case assigned, L1 case returned from L2). | All |
| SLA popup toasts | Bottom-right pop-up toasts when an open alert hits the warning window (24 hours remaining) or breaches its deadline. Breaches play a sound. Toasts stack and persist until dismissed. | All |
| Per-event email digest preference | An analyst can choose to receive a daily or weekly email digest in their personal settings (email delivery itself is not yet wired). | All |

### Data Import Pipeline

| Feature | What it does | Who uses it |
|---|---|---|
| CSV-based seed | The system is seeded from seven CSV files (alerts, customers, accounts, transactions, cases, case notes, SAR filings). Re-running the seed wipes and reloads. | Engineering |
| Reference-date pinning | All seed data is pinned to a fixed calendar date so SLA countdowns and retention timers evolve naturally as real-world time passes. | System |
| Idempotent migrations | The database migration script can be re-run safely on a populated database without losing data; new columns are added with `IF NOT EXISTS`. | Engineering |

*An end-user-facing import flow (file upload with preview and validation in the UI) is on the roadmap but not yet built — see Section 11.*

### User Management

| Feature | What it does | Who uses it |
|---|---|---|
| User directory | Searchable list of every user with role, team, status, and recent activity. | Manager |
| User profile panel | Detail view showing the user's open alerts, assigned cases, SARs touched, and KYC reviews completed. | Manager |
| Real login with credentials | Username + password authentication backed by a user-profiles table. | All |

### Settings

| Feature | What it does | Who uses it |
|---|---|---|
| Manager Settings panel | Thirty-plus configurable keys across six sections: SLA configuration, scenario configuration, team and workload, SAR and retention, reporting, audit and compliance. About one third of these keys are wired to drive live behavior; the rest are recorded but not yet enforced (see Section 10). | Manager |
| Scenario Configuration | Per-scenario panel showing each of the six monitoring scenarios with Active toggle, Priority selector, and false-positive warning threshold. | Manager |
| SLA configuration | Per-priority SLA days, warning threshold percentage, auto-escalation policy. | Manager |
| SAR and retention | Five-year retention default, dual-approval requirement, mandatory SAR fields. | Manager |
| Employee Settings panel | Per-analyst preferences — workspace landing page, alert sort order, default transaction date range, investigation workspace defaults, notification toggles, date/time/currency formats, theme. | L1, L2 |

### Background Jobs

| Feature | What it does | Who uses it |
|---|---|---|
| SLA Monitor | Runs every five minutes. For every open alert: computes time remaining, sends an early-warning notification at the configured threshold, sends a 24-hour warning, sends a breach notification when the deadline passes. De-duplicates notifications within a 48-hour window. | System (automatic) |
| KYC Review Monitor | Runs daily and once at startup. For every customer: auto-creates a scheduled review when due, auto-creates a SAR-triggered review if a SAR was filed in the last 30 days, auto-creates an alert-triggered review if 3+ alerts in the last 90 days, marks past-due reviews as overdue. | System (automatic) |
| OFAC Sync | Runs daily and once at startup. Downloads the current U.S. Treasury OFAC SDN list and refreshes the local screening database. Failures do not crash the server. | System (automatic) |

---

## 5. The End-to-End Workflow

A complete walk-through of what happens from the moment an alert appears to the day the corresponding KYC review closes.

**Step 1 — Alert arrives.** The bank's transaction-monitoring engine fires an alert and pushes it into Crowe ARC. Today this happens through the seed import; in production it would be an automated feed. The alert lands in the Unassigned column with a calculated SLA deadline based on its priority.

**Step 2 — Manager assigns.** Henry opens the manager alerts table, sees the unassigned alert, and either assigns it to a specific L1 analyst or bulk-assigns a batch of similar alerts at once. The system shows him each analyst's current workload, so he can avoid overloading anyone.

**Step 3 — Analyst opens the alert.** The L1 analyst sees the assignment in their My Alerts queue, hits Assign to Me if it was a self-pick, then Start Investigation. The Investigation Workspace opens.

**Step 4 — Analyst reviews the full picture.** The left panel shows the alerted transactions inside the customer's full transaction list. The right panel shows the customer's KYC profile, business details, and any other cases involving the same customer. The analyst can also screen the customer or counterparty against OFAC sanctions without leaving the screen.

**Step 5 — Analyst documents their work.** They add case notes describing what they checked and what they concluded. They upload supporting evidence — screenshots, bank statements, identification documents. Every action is logged automatically.

**Step 6 — Analyst makes a decision.** Three options:

- **6a (False Positive Close).** The analyst confirms it is a false alarm with a captured reason. The alert closes and an audit-trail entry records the disposition.
- **6b (Escalate to Level 2).** The analyst writes an escalation reason. The alert moves to the L2 queue and the original L1 analyst now has a read-only view.
- **6c (Escalate to SAR Filing).** The analyst pushes the alert directly to a SAR; a case ID is created and the SAR wizard opens.

**Step 7 — L2 investigation.** If the path went through 6b, an L2 analyst now picks up the case from the L2 queue. They open the L2 workspace and start with the L1 Summary tab, which shows everything L1 did. They then run the 10-factor risk-scoring tool, the counterparty analysis, the pattern detection, and write the L2 narrative.

**Step 8 — L2 decides.** Three exits again — return the case to L1 with corrections, close it without a SAR, or escalate it to SAR Filing. If the L2 analyst escalates, a case ID is created with the prefix indicating L2 origin, and the original L1 analyst is notified that their escalated case is now becoming a regulatory filing.

**Step 9 — SAR Filing wizard.** The analyst (L1 if it came directly from 6c, L2 if it came through investigation) walks through the six-step wizard. Steps 2 and 3 pre-fill from KYC and the alert. Step 4 (Narrative) offers an auto-generated draft narrative built from the case facts. Step 5 attaches supporting documents (any document already on the source alert auto-includes). Auto-save runs every 30 seconds. On submit, the SAR moves to Pending Approval.

**Step 10 — Manager review.** Henry sees the bell light up with "SAR pending approval." He opens the SAR Approval Review workspace — all six SAR sections rendered as read-only tabs, an inline-comment panel where he can leave highlighted feedback on the narrative, and a review checklist.

**Step 11 — Manager approves or rejects.** If the checklist is complete and the SAR looks correct, he clicks Approve. The system generates a regulator reference number (`FIU-YYYYMMDD-XXXXX`), marks the SAR Filed, sets the filed date, and notifies the analyst. If he rejects, he picks a rejection category, leaves comments, and the SAR returns to the analyst's queue for rework.

**Step 12 — Retention begins.** On approval, the SAR enters a five-year retention window tracked daily in the Retention Monitor. Expiry urgency is colour-coded; a legal hold can pause the clock.

**Step 13 — SAR-triggered KYC review fires automatically.** As soon as the SAR is approved, the daily KYC monitor next morning will auto-create a triggered KYC review on the same customer. That review lands in the analyst's My Reviews queue.

**Step 14 — KYC review.** The analyst opens the KYC Review Workspace, completes the structured 13+ item checklist across four groups, writes the findings narrative, recommends a new risk rating and CDD level, and submits for approval. Henry approves it. The customer's risk rating updates everywhere in the system in real time, the next-review date auto-recalculates based on the new rating, and if the review recommended an exit, the customer is flagged accordingly.

The full lifecycle — from alert arrival to closed KYC review — is captured end-to-end in a single audit trail visible to any examiner.

---

## 6. Regulatory Alignment

Crowe ARC is designed against the U.S. Bank Secrecy Act (BSA) framework administered by FinCEN.

| Regulatory requirement | What it requires | How Crowe ARC addresses it |
|---|---|---|
| **Bank Secrecy Act (BSA)** | Banks must maintain records of suspicious activity, report it to FinCEN, and retain that record for regulatory inspection. | An end-to-end audit trail logs every action on every alert, case, SAR, and KYC review, with the actor, timestamp, and details. The structured SAR workflow captures every required field. |
| **FinCEN SAR filing — 30-day deadline** | A SAR must be filed within 30 days of detecting suspicious activity. | The system records the detection date on the SAR and tracks days remaining until the 30-day deadline. The SAR Repository surfaces filing-deadline urgency, and the Regulatory Compliance report measures 30-day timeliness as a KPI. |
| **5-year SAR retention** | Banks must retain SAR records and supporting documentation for five years. | The Retention Monitor tracks every filed SAR's expiry date, surfaces those expiring within 90 days and 30 days, supports legal hold to pause the retention clock, and reports retention compliance as a regulatory KPI. The retention window is configurable in manager settings. |
| **CTR threshold ($10,000)** | Cash transactions over $10,000 trigger a Currency Transaction Report; deliberately structuring transactions to stay below the threshold is a federal offence. | The $10,000 threshold drives the Structuring detection scenario. The suspicious activity types in the SAR wizard include structuring. The system tracks "transactions just below the CTR threshold" as a pattern in L2 analysis. |
| **OFAC sanctions screening** | Banks must screen customers and counterparties against the U.S. Treasury OFAC Specially Designated Nationals list. | A daily background job refreshes the OFAC SDN list. Customers and counterparties can be screened on demand from the Investigation Workspace. A confirmed match flips the customer's sanctions flag, which then surfaces on every alert and screen involving that customer. |
| **KYC / CDD periodic review** | Banks must periodically re-verify customer information, with frequency driven by customer risk rating. | The KYC Review Monitor auto-schedules reviews by risk band (Very High 180d / High 365d / Medium 730d / Low 1095d), auto-triggers reviews after a SAR filing, and auto-triggers reviews when alert volume exceeds a threshold. Overdue and due-soon reviews are flagged daily. |
| **Audit trail for examiners** | When a regulator inspects, they must be able to see every action on every case. | The Audit Log page filters by entity (SAR, alert, KYC review, case), action type, and timestamp range. The Audit Trail Export report produces a regulator-ready PDF or Excel covering every action across SAR filings, approvals, KYC reviews, document operations, and retrieval events. |

---

## 7. Deployment and Access

### Hosting

| Layer | Provider | Notes |
|---|---|---|
| Frontend | Vercel | Static site built from the React application; auto-deploys on every push to the `main` branch of the GitHub repository. |
| Backend | Railway | Node.js service exposing the REST API. |
| Database | Supabase (managed PostgreSQL) | Hosted Postgres with backups. |
| File storage | Supabase Storage | SAR documents, case evidence, and KYC review attachments. |

### How to access

- **Application URL:** the active deployment lives on a `*.vercel.app` URL provided by Vercel; the team-shared link should be confirmed in the Vercel dashboard before being circulated. The most recent deployment URL on file is `https://nicecrowearc-q6845hv6v-thunder-2005s-projects.vercel.app`.
- **API URL:** `https://crowearc-production.up.railway.app`
- **Recommended browser:** any current Chromium-based browser (Chrome or Edge). The SLA-breach alert uses the browser's audio API which requires a first user click on the page before sound will play.

### Login credentials

The login page exposes a "Demo Access" panel that lists all eleven users with a one-click "Use" button.

| Role | Name | Username | Password |
|---|---|---|---|
| Compliance Manager | Henry Morgan | henry.morgan | Henry@123 |
| L2 Analyst | Olivia Brown | olivia.brown | Olivia@123 |
| L2 Analyst | Cassian Jude | cassian.jude | Cassian@123 |
| L2 Analyst | Marie Davis | marie.davis | Marie@123 |
| L2 Analyst | Hannah Louise | hannah.louise | Hannah@123 |
| L1 Analyst | Robert Wright | robert.wright | Robert@123 |
| L1 Analyst | Arjun Sharma | arjun.sharma | Arjun@123 |
| L1 Analyst | Priya Nair | priya.nair | Priya@123 |
| L1 Analyst | Rohit Mehta | rohit.mehta | Rohit@123 |
| L1 Analyst | Neha Iyer | neha.iyer | Neha@123 |
| L1 Analyst | Vikram Sinha | vikram.sinha | Vikram@123 |

### Opening multiple views simultaneously for demo

The session is held in the browser's local storage, so two normal tabs in the same browser will share the same login. To run a manager view and an analyst view side by side during a demo:

1. Open a normal browser window and log in as **Henry Morgan** (manager view).
2. Open a separate Incognito or InPrivate window and log in as any L1 or L2 analyst (employee view).

Each window is treated as an independent session. Actions taken in one are visible to the other within the next 30-second polling cycle.

---

## 8. Tech Stack

The tools that power Crowe ARC, explained in plain English.

| Layer | What we use | Why |
|---|---|---|
| **Frontend (what the user sees)** | React with the Vite bundler and Tailwind CSS | React is the industry-standard library for building interactive web interfaces. Vite gives developers near-instant reload times. Tailwind provides a consistent design system without separate stylesheets. |
| **Frontend navigation** | React Router | Lets a single web page behave like a multi-screen application with clean URLs such as `/manager/dashboard` and `/employee/alerts`. |
| **Frontend charts** | Recharts | Renders the line graphs, bar charts, and donut charts on the manager dashboard and the analytics tabs. |
| **Frontend exports** | jsPDF and SheetJS | Generate PDF and Excel files directly in the browser when a user runs a report. |
| **Backend (the engine)** | Node.js with the Express web framework | A widely-used, well-supported server platform. Express handles all of the application's API endpoints — about two dozen logical modules. |
| **Database** | Supabase (managed PostgreSQL) | PostgreSQL is the standard open-source relational database for serious applications. Supabase hosts it for us, handles backups, and gives developers tooling around it. |
| **File storage** | Supabase Storage | Every uploaded document — SAR attachments, case evidence, KYC supporting files — is stored here. The database holds the metadata; the file itself lives in cloud storage. |
| **Background jobs** | Built into the backend process using simple timers | The three scheduled jobs (SLA monitor every 5 minutes, KYC monitor and OFAC sync daily) run inside the same Node process — no separate scheduler or worker tier is needed. |
| **OFAC screening** | A built-in screener that compares names against the downloaded OFAC SDN list | A daily job pulls the latest list from the U.S. Treasury and stores it in the database. Screening then runs in-process. |
| **SAR narrative generation** | A template-based generator that assembles narrative text from the case facts | The alert scenario, transactions, customer KYC, case notes, and L2 conclusion are plugged into a structured template. The analyst can then edit the draft. |
| **CSV ingestion** | The PapaParse library | The seed importer and any future import flow use PapaParse to read CSV files reliably. |
| **Authentication** | Username + password against the user-profiles table in Postgres | A real login with credentials, role lookup, and session in browser storage. Not yet integrated with single-sign-on (see Section 10). |

---

## 9. Data in the System

The current live demo database is populated from CSV seed files. All counts below come directly from those files.

### Record counts

| Data Type | Count | Description |
|---|---|---|
| Customers | 20 | Mix of individuals and businesses; risk ratings spread across Low / Medium / High / Very High. |
| Accounts | 55 | Checking, savings, and business accounts tied to customers. |
| Transactions | 1,209 | Individual financial transactions with counterparty information, channel, and amount. |
| Alerts | 1,000 | Transaction-monitoring alerts spread across six scenarios and seven statuses. |
| Cases | 160 | Investigation cases created from escalated alerts. |
| Case notes | 465 | Free-text analyst notes attached to alerts. |
| SAR filings | 35 | Suspicious Activity Reports across Draft, Under Review, Filed, and Acknowledged statuses. |
| KYC reviews | Auto-generated daily | Scheduled, SAR-triggered, and alert-triggered reviews are created automatically by the daily background job. |
| User profiles | 11 | One Compliance Manager, four L2 Investigators, six L1 Analysts. |
| OFAC SDN entries | Auto-synced daily | The full U.S. Treasury list is downloaded and refreshed each day. |

The CSV seed data is pinned to a fixed reference date; all "days overdue", "days remaining", and retention countdowns are computed relative to today's date, so the demo evolves naturally over calendar time.

### Alert distribution by status

| Status | Count |
|---|---|
| Closed — False Positive | 440 |
| In Progress | 180 |
| Not Started | 120 |
| Escalated to SAR | 80 |
| Escalated to L2 | 80 |
| Unassigned | 50 |
| Completed | 50 |

### The six alert scenarios

| Scenario | Count | What this looks like in real banking activity |
|---|---|---|
| **Structuring** | 300 | A customer who deposits a large sum of money breaks it into several smaller deposits, each just below the $10,000 Currency Transaction Report threshold, to avoid triggering a CTR. A real example would be five $9,500 cash deposits on consecutive days. |
| **High Risk Country** | 220 | A customer is sending or receiving funds with a counterparty in a country known for high money-laundering risk or weak financial regulation (such as the FATF high-risk jurisdictions). The flow itself may be legitimate, but it warrants review. |
| **Watchlist Hit** | 180 | A customer or one of their transaction counterparties matches an entry on a sanctions or watchlist (OFAC, UN, PEP). The match may be exact, partial, or weak — an analyst has to evaluate whether it is the same person or a name collision. |
| **Cash Intensive** | 160 | A business customer (often a corner store, car wash, restaurant) is depositing far more cash than its declared business model would justify, or its cash-to-non-cash ratio is suddenly higher than its history. |
| **Rapid Movement** | 100 | Funds move into an account and out again very quickly — sometimes within hours — usually to a different counterparty. This is the classic pattern of layering: making money trace harder by passing it through accounts in short bursts. |
| **Trade Based ML** | 40 | A trade transaction's invoice value does not match the goods involved — over-invoicing inflates a transfer to disguise the real reason for the funds, under-invoicing shifts value cheaply across borders. Indicators include round-number invoices, repeated identical shipments, and counterparties in unrelated countries. |

---

## 10. Current Limitations

Crowe ARC is at "strong pilot" maturity. It is honest about what it does not yet do.

- **Demo-grade authentication.** Logins use plain-text password comparison against the user-profiles table. There is no token-based session, no password hashing, no multi-factor authentication, and no single sign-on. This is suitable for demo and controlled pilot environments; production deployment will require an authentication upgrade.
- **No direct FinCEN E-Filing integration.** The SAR Filing wizard mirrors the FinCEN BSA E-Filing form, and approved SARs generate a regulator-reference number, but the submission to FinCEN itself is simulated. The next phase will add a real API connection.
- **No real transaction-monitoring engine connection.** Alerts are loaded from CSV files at seed time. The application is the investigation and case-management layer that sits on top of a transaction-monitoring system; it does not yet ingest alerts directly from a vendor system like Actimize, Verafin, or FCCM.
- **No email notifications yet.** All notifications today are in-application (the bell icon and the SLA pop-up toasts). The infrastructure to send email digests is recorded in employee settings but not yet wired to an email provider.
- **No mobile-responsive layout.** The application is designed for desktop and laptop use. A phone or tablet user will see a working but cramped layout.
- **Settings page is partially functional.** About one third of the 30+ manager settings actively drive system behavior today (SLA windows, scenario priority, mandatory SAR fields, retention years, dual-approval mode). The remaining settings are stored but not yet read by the application — closing this gap is on the near-term roadmap.
- **Single bank environment only.** The institution is hard-coded as First National Bank — US. Multi-tenant support, where one deployment serves several banks, is a longer-term capability.
- **Beneficial-owner data is sparse.** The Linked Cases Network View has full support for finding customers who share beneficial owners, but the underlying customer onboarding records in the current seed do not yet include UBO data, so the Beneficial Owner Links tab displays an empty state. Once a real onboarding feed is connected, the tab activates automatically.

---

## 11. What We Are Building Next

The roadmap, organized by time horizon.

### Near term (next several weeks)

- **Scenario governance module.** Build out the read-only registry of every monitoring scenario, with per-scenario performance dashboards (false-positive rate, productivity, aging, SAR conversion). Lets the team manage scenarios upstream of the alerts the system already receives.
- **Feed reconciliation controls.** Build daily reconciliation reports comparing source-system counts to landed counts in Crowe ARC, with a feed-health dashboard surfacing lag, error rate, and missed batches.
- **Alert auto-routing rules.** A manager-defined rule engine that assigns incoming alerts automatically based on scenario, priority, customer segment, and analyst workload — eliminating most of the manual assignment work today.

### Medium term (next several months)

- **Enterprise single sign-on.** Integration with Microsoft Entra ID (formerly Azure AD) replacing the demo-grade login. Multi-factor authentication, role provisioning, and session management are all included.
- **SFTP nightly auto-ingestion.** A scheduled job that pulls alert files from a bank's SFTP target (the standard mechanism real banks use to move data) and feeds them through the existing CSV pipeline.
- **Direct FinCEN BSA E-Filing.** Replace the simulated submission with a real API call to FinCEN, including acknowledgement tracking and rejection handling.
- **Email notifications.** Connect the existing notification system to a transactional email provider so bell events and SLA alerts can also arrive as email.

### Long term (vision)

- **Real-time transaction-monitoring engine connection.** Stream-based alert ingestion from the bank's underlying TM engine, with webhook or message-queue delivery.
- **Machine-learning false-positive reduction.** A model trained on the bank's historical disposition data that pre-scores incoming alerts so analysts work the most-likely-suspicious first.
- **Multi-bank / multi-tenant deployment.** A single Crowe ARC instance serving multiple institutions with full data isolation.
- **Regulator examination portal.** A separate, audit-only portal that lets an examiner read SARs, the audit trail, and the retention monitor directly — eliminating the scramble to assemble exam materials.

---

## 12. Built By

| | |
|---|---|
| **Organization** | Crowe |
| **Tool name** | Crowe ARC — Alert Review & Casework |
| **Environment** | US Banking |
| **Bank** | First National Bank — US |
| **Regulatory framework** | FinCEN / Bank Secrecy Act (BSA) |
| **Built by** | Rakshit and Hridhita |
