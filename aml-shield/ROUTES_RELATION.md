# Crowe ARC — Routes & Relations Map

Date: 2026-05-14 · Branch: `main` · Last commit at audit: `1f02a0c2`

This is a **read-only survey**. No code has been changed. One temporary diagnostic script (`db-schema-dump.js`) was created at the repo root and has already been deleted.

---

## Section 0 — Path Corrections vs. Spec

The task spec referenced directories that don't exist in this repo. Actual layout:

| Spec path | Actual path |
|---|---|
| `src/pages/Investigation/InvestigationWorkspace.jsx` | `frontend/src/components/investigation/InvestigationWorkspace.jsx` |
| `src/pages/L2/L2Workspace.jsx` | `frontend/src/components/investigation/L2InvestigationWorkspace.jsx` |
| `src/pages/SAR/SARFiling.jsx` | `frontend/src/pages/SARFiling.jsx` |
| `src/pages/BSA/BSADashboard.jsx` | `frontend/src/pages/BsaDashboard.jsx` |
| `src/contexts/RoleContext.jsx` | `frontend/src/state/RoleContext.jsx` |
| `backend/middleware/auth.js` | `backend/middleware/roleGuard.js` (no JWT/session — header-based) |
| Frontend root `src/` | `aml-shield/frontend/src/` |
| Backend root | `aml-shield/backend/` |

---

## Section 1 — Stack & Topology

| Layer | Tech | Hosting |
|---|---|---|
| Frontend | React 18 + Vite + Tailwind | Vercel — `crowearc.vercel.app` |
| Backend | Node.js 18+ + Express 4 + pg 8 | Railway — `crowearc-production.up.railway.app` |
| Database | Supabase PostgreSQL | Project `oupgsfkvrzbqutygslvl` |
| Storage | Supabase Storage | Bucket `crowe-arc-documents` |
| Background jobs | `slaMonitor`, `kycReviewMonitor`, `ofacSync` (in-process, started in `server.js`) |

**Auth model:** demo-grade — `POST /api/auth/login` does a plaintext password compare against `user_profiles`. No JWT. Frontend stamps `x-user-role`, `x-user-id`, `x-user-name` on every request via the axios interceptor in [api/client.js](aml-shield/frontend/src/api/client.js). Backend `roleGuard.js` reads only the role header.

**Role enum (DB `user_profiles.role` + `x-user-role` header):**
- `analyst_l1` — 6 users (Arjun, Neha, Priya, Robert, Rohit, Vikram) on T1 Monitoring
- `analyst_l2` — 4 users (Cassian, Hannah, Marie, Olivia) on T2 Investigations
- `compliance_manager` — 1 (Henry Morgan)
- `bsa_officer` — 1 (James Carter)

---

## Section 2 — Backend Route Map

Each row: `METHOD /path → file:line → guard → tables → notable behavior`.

Guard names refer to exports from [middleware/roleGuard.js](aml-shield/backend/middleware/roleGuard.js):
- `requireManager` — `['compliance_manager']`
- `requireL2OrManager` — `['analyst_l2', 'compliance_manager']`
- `requireAnyAnalyst` — `['analyst_l1', 'analyst_l2', 'compliance_manager']`
- `requireBsaOfficer` — `['bsa_officer']`
- `requireBsaOrManager` — `['bsa_officer', 'compliance_manager']`
- `requireL1Only` — `['analyst_l1']` (exported but no consumer yet)

### `/api/alerts` → [alerts.js](aml-shield/backend/routes/alerts.js)

| METHOD | Path | Line | Guard | Tables | Notes |
|---|---|---|---|---|---|
| GET | `/analysts` | 27 | none | alerts | open count per analyst |
| GET | `/` | 58 | none | alerts, customers, cases, sar_filings | filters + `priority_bucket_sort` mode |
| GET | `/:id` | 107 | none | alerts | single alert |
| GET | `/:id/transactions` | 118 | none | transactions | BIGINT cast to float |
| PATCH | `/:id/disposition` | 172 | requireAnyAnalyst | alerts, case_notes, audit_trail | writes `'Closed — False Positive'` (em dash) |
| PATCH | `/:id/status` | 213 | requireAnyAnalyst | alerts, audit_trail, manager_settings | logs `'Investigation started'` on Not Started → In Progress |
| PATCH | `/:id/assign` | 266 | requireManager | alerts, audit_trail, notifications, manager_settings | quota check; fires notif |
| PATCH | `/bulk-assign` | 332 | requireManager | alerts, audit_trail, notifications, manager_settings | one consolidated notif |
| PATCH | `/bulk-close` | 422 | requireManager | alerts, case_notes, audit_trail | writes `'Closed — False Positive'`; `'False Positive'` disposition |

### `/api/analytics` → [analytics.js](aml-shield/backend/routes/analytics.js)

| METHOD | Path | Line | Guard | Tables | Notes |
|---|---|---|---|---|---|
| GET | `/alert-trends` | 75 | none | alerts | volume/FP/age/disposition/scenario rollups |
| GET | `/sar-trends` | 189 | none | sar_filings, alerts | filing volume, timeliness, rejection |
| GET | `/team-performance` | 319 | none | alerts, manager_settings, kyc_reviews, case_notes, user_profiles | per-analyst metrics |
| GET | `/rule-effectiveness` | 462 | none | alerts | per-scenario FP/SAR rate |
| GET | `/customer-risk` | 502 | none | customers, kyc_reviews, alerts | risk distribution, industry matrix |

### `/api/audit-trail` → [auditTrail.js](aml-shield/backend/routes/auditTrail.js)

| METHOD | Path | Line | Guard | Tables | Notes |
|---|---|---|---|---|---|
| GET | `/sar/:id` | 16 | none | audit_trail | scoped to entity_type='sar' or NULL |
| GET | `/alert/:id` | 29 | none | audit_trail | entity_type IN ('alert','case') |
| GET | `/kyc/:id` | 41 | none | audit_trail | entity_type='kyc_review' |
| GET | `/:sar_id` | 54 | none | audit_trail | legacy SAR endpoint |
| POST | `/` | 67 | requireAnyAnalyst | audit_trail | inserts arbitrary entry |

### `/api/auth` → [auth.js](aml-shield/backend/routes/auth.js)

| METHOD | Path | Line | Guard | Tables | Notes |
|---|---|---|---|---|---|
| POST | `/login` | 7 | none | user_profiles | **plaintext password compare** (demo-grade) |
| POST | `/logout` | 39 | none | — | stateless |
| GET | `/me` | 43 | none | user_profiles | |

### `/api/bsa` → [bsa.js](aml-shield/backend/routes/bsa.js)

**Router-level:** `router.use(requireBsaOrManager)` (lines 16-17)

| METHOD | Path | Line | Guard | Tables | Notes |
|---|---|---|---|---|---|
| GET | `/program-metrics` | 24 | router-level | sar_filings, cases, alerts | YTD filings, retention expiring |
| GET | `/reopen-requests` | 73 | router-level | alert_reopen_requests | pending_bsa count |
| GET | `/awaiting-signoff` | 94 | router-level | sar_filings | Filed SARs missing `bsa_approved_at` |

### `/api/case-documents` → [caseDocuments.js](aml-shield/backend/routes/caseDocuments.js)

| METHOD | Path | Line | Guard | Tables | Notes |
|---|---|---|---|---|---|
| POST | `/upload` | 10 | requireAnyAnalyst | case_documents, case_notes, audit_trail | Supabase Storage upload |
| GET | `/:alert_id` | 44 | none | case_documents | list per alert |
| GET | `/file/:id` | 54 | none | case_documents | signed URL redirect |
| DELETE | `/:id` | 65 | requireAnyAnalyst | case_documents, case_notes | uploader-or-manager check |

### `/api/case-notes` → [caseNotes.js](aml-shield/backend/routes/caseNotes.js)

| METHOD | Path | Line | Guard | Tables | Notes |
|---|---|---|---|---|---|
| POST | `/` | 8 | requireAnyAnalyst | case_notes, audit_trail | preview-truncated audit |
| GET | `/:alert_id` | 31 | none | case_notes | DESC by timestamp |

### `/api/cases` → [cases.js](aml-shield/backend/routes/cases.js)

| METHOD | Path | Line | Guard | Tables | Notes |
|---|---|---|---|---|---|
| POST | `/` | 8 | requireL2OrManager | cases, alerts, audit_trail | writes case_status `'Not Started'` |
| GET | `/` | 76 | none | cases, alerts, sar_filings, customers | |
| GET | `/:id` | 102 | none | cases, alerts, sar_filings, customers | |
| PATCH | `/:id/assign` | 119 | requireManager | cases | Unassigned → Not Started |
| PATCH | `/:id/status` | 140 | requireAnyAnalyst | cases | |

### `/api/customers` → [customers.js](aml-shield/backend/routes/customers.js)

| METHOD | Path | Line | Guard | Tables | Notes |
|---|---|---|---|---|---|
| GET | `/` | 17 | none | customers, alerts | open_alerts rollup |
| GET | `/:id` | 49 | none | customers, accounts | parses JSON fields |
| GET | `/:id/transactions` | 68 | none | transactions | alerted_only flag |
| GET | `/:id/alerts` | 86 | none | alerts | |
| GET | `/:id/sars` | 96 | none | sar_filings | |

### `/api/dashboard` → [dashboard.js](aml-shield/backend/routes/dashboard.js)

| METHOD | Path | Line | Guard | Tables | Notes |
|---|---|---|---|---|---|
| GET | `/stats` | 95 | none | alerts, cases, sar_filings, notifications, user_profiles, kyc_reviews, manager_settings, ofac_download_log | operational KPIs, workload, OFAC freshness, health block |
| GET | `/drawer/total-alerts` | 469 | none | alerts | |
| GET | `/drawer/in-progress` | 523 | none | alerts, user_profiles | |
| GET | `/drawer/completed` | 581 | none | alerts | |
| GET | `/drawer/sla-breaches` | 632 | none | alerts, user_profiles, manager_settings | |
| GET | `/drawer/avg-aging` | 690 | none | alerts | |
| GET | `/drawer/cases-converted` | 746 | none | alerts, cases, sar_filings | |
| GET | `/drawer/team-capacity` | 780 | none | alerts, user_profiles | |
| GET | `/drawer/false-positive` | 836 | none | alerts | |
| GET | `/drawer/unassigned` | 889 | none | alerts, user_profiles | recommendation engine |
| GET | `/worklist` | 980 | none | sar_filings, kyc_reviews, ofac_screening_results, alerts, (legal_holds graceful) | manager "Queue Today" |
| GET | `/sar-clock` | 1087 | none | sar_filings, cases, alerts, customers | FinCEN 30-day window |

### `/api/documents` → [documents.js](aml-shield/backend/routes/documents.js)

**Consumed by:** [SARRepository.jsx:238, 248, 369](aml-shield/frontend/src/pages/SARRepository.jsx#L238) — NOT dead.

| METHOD | Path | Line | Guard | Tables | Notes |
|---|---|---|---|---|---|
| POST | `/upload` | 9 | requireAnyAnalyst | documents, sar_filings, audit_trail | SAR attachments |
| GET | `/:id` | 44 | none | documents | signed URL redirect |
| DELETE | `/:id` | 61 | requireAnyAnalyst | documents, sar_filings, audit_trail | uploader-or-manager check |

### `/api/investigations` → [investigations.js](aml-shield/backend/routes/investigations.js)

**Router-level:** local `function requireManager` + `router.use(requireManager)` at line 17 (NOT imported from middleware — see Risks §1).

| METHOD | Path | Line | Guard | Tables | Notes |
|---|---|---|---|---|---|
| GET | `/counterparty-links` | 19 | router-level | transactions, customers, alerts, sar_filings, cases | network analysis |
| GET | `/beneficial-owner-links` | 73 | router-level | customers, alerts | JSON expansion |
| GET | `/link-detail` | 146 | router-level | customers, transactions, alerts, sar_filings, cases | pair detail |
| GET | `/summary` | 271 | router-level | transactions, customers | |
| POST | `/note` | 368 | router-level | audit_trail | logs connection note |

### `/api/kyc-reviews` → [kycReviews.js](aml-shield/backend/routes/kycReviews.js)

| METHOD | Path | Line | Guard | Tables | Notes |
|---|---|---|---|---|---|
| GET | `/stats` | 37 | none | kyc_reviews | |
| GET | `/` | 55 | none | kyc_reviews, customers | filters |
| GET | `/customer/:id/history` | 95 | none | kyc_reviews | |
| GET | `/:id` | 104 | none | kyc_reviews + many joins | full detail |
| POST | `/` | 176 | requireManager | kyc_reviews, audit_trail, notifications | |
| PATCH | `/bulk-assign` | 224 | requireManager | kyc_reviews, audit_trail, notifications | |
| PATCH | `/:id/assign` | 298 | requireManager | kyc_reviews, notifications, audit_trail | |
| PATCH | `/:id/start` | 334 | requireAnyAnalyst | kyc_reviews, audit_trail | status='in_progress' |
| PATCH | `/:id/save` | 352 | requireAnyAnalyst | kyc_reviews | draft save |
| PATCH | `/:id/complete` | 374 | requireAnyAnalyst | kyc_reviews, audit_trail, notifications | status='pending_approval'; ≥100-char findings |
| PATCH | `/:id/approve` | 462 | requireManager | kyc_reviews, customers, cases, notifications, audit_trail | creates case `'Work In Progress'` if escalate_sar |
| PATCH | `/:id/reject` | 552 | requireManager | kyc_reviews, audit_trail, notifications | status='returned' |
| POST | `/:id/documents` | 589 | requireAnyAnalyst | kyc_review_documents, audit_trail | |
| DELETE | `/:id/documents/:docId` | 617 | requireAnyAnalyst | kyc_review_documents | |
| GET | `/:id/documents/:docId/file` | 632 | none | kyc_review_documents | signed URL |

### `/api/l2` → [l2.js](aml-shield/backend/routes/l2.js)

| METHOD | Path | Line | Guard | Tables | Notes |
|---|---|---|---|---|---|
| GET | `/queue` | 55 | none | l2_cases, alerts | |
| GET | `/queue/:analystId` | 62 | none | l2_cases, alerts | own + unassigned |
| GET | `/:id` | 77 | none | l2_cases, alerts | |
| POST | `/` | 95 | requireAnyAnalyst | l2_cases, alerts, audit_trail, notifications | creates `L2-YYYY-NNNN` |
| PATCH | `/:id/accept` | 169 | requireL2OrManager | l2_cases, alerts, notifications, audit_trail | |
| PATCH | `/:id/reassign` | 200 | requireL2OrManager | l2_cases, alerts, notifications | |
| PATCH | `/:id/risk-score` | 228 | requireL2OrManager | l2_cases | |
| GET | `/:id/notes` | 255 | none | l2_notes | |
| POST | `/:id/notes` | 264 | requireL2OrManager | l2_notes, audit_trail | |
| GET | `/:id/documents` | 282 | none | l2_documents | |
| POST | `/:id/documents` | 292 | requireL2OrManager | l2_documents, audit_trail | |
| GET | `/:id/documents/:docId/file` | 317 | none | l2_documents | signed URL |
| DELETE | `/:id/documents/:docId` | 330 | requireL2OrManager | l2_documents | |
| PATCH | `/:id/return` | 354 | requireL2OrManager | l2_cases, alerts, audit_trail, notifications | writes alert `'In Progress'` |
| PATCH | `/:id/close` | 409 | requireL2OrManager | l2_cases, alerts, notifications, audit_trail | ≥150-char narrative |
| PATCH | `/:id/escalate-sar` | 488 | requireL2OrManager | l2_cases, alerts, cases, audit_trail, notifications | creates case `'Work In Progress'` |
| GET | `/l1-summary/:alertId` | 556 | none | alerts, customers, case_notes, case_documents, l2_cases | prep checklist |
| GET | `/:id/counterparties` | 615 | none | l2_cases, transactions | |
| GET | `/:id/linked-entities` | 638 | none | l2_cases, transactions, customers, alerts, sar_filings | |
| GET | `/:id/patterns` | 660 | none | l2_cases, transactions | structuring/velocity/geo |
| GET | `/stats/manager` | 751 | none | l2_cases, alerts | manager summary (no frontend caller) |

### `/api/notifications` → [notifications.js](aml-shield/backend/routes/notifications.js)

| METHOD | Path | Line | Guard | Tables | Notes |
|---|---|---|---|---|---|
| GET | `/manager` | 26 | none | notifications | |
| GET | `/unread/manager` | 31 | none | notifications | |
| GET | `/unread/user/:userId` | 43 | none | notifications | |
| GET | `/user/:userId` | 55 | none | notifications | |
| GET | `/unread-count/manager` | 60 | none | notifications | |
| GET | `/unread-count/user/:userId` | 70 | none | notifications | |
| PATCH | `/:id/read` | 80 | none | notifications | |
| PATCH | `/read-all/manager` | 89 | none | notifications | |
| PATCH | `/read-all/user/:userId` | 96 | none | notifications | |
| POST | `/` | 103 | **none** | notifications | **⚠️ no guard on insert** — see Risks §1 |

### `/api/ofac` → [ofac.js](aml-shield/backend/routes/ofac.js)

| METHOD | Path | Line | Guard | Tables | Notes |
|---|---|---|---|---|---|
| GET | `/status` | 36 | none | ofac_sdn_entries, ofac_screening_results, ofac_download_log | SDN count + freshness |
| POST | `/screen/:entityType/:entityId` | 75 | none | ofac_screening_results, audit_trail, notifications | match scan |
| GET | `/results/:entityType/:entityId` | 126 | none | ofac_screening_results, ofac_download_log | |
| PATCH | `/results/:resultId` | 166 | none | ofac_screening_results, customers, audit_trail, notifications | sets `customers.sanctions_match=1` on confirm |
| POST | `/sync` | 228 | requireManager | ofac_sdn_entries, ofac_download_log | manual sync |

### `/api/reopen-requests` → [reopenRequests.js](aml-shield/backend/routes/reopenRequests.js)

| METHOD | Path | Line | Guard | Tables | Notes |
|---|---|---|---|---|---|
| POST | `/` | 31 | requireAnyAnalyst | alert_reopen_requests, alerts, audit_trail, notifications | ≥100-char detail; alert must be closed |
| PATCH | `/:id/manager` | 102 | requireManager | alert_reopen_requests, audit_trail, notifications | → `pending_bsa` or `manager_rejected` |
| PATCH | `/:id/bsa` | 186 | requireBsaOfficer | alert_reopen_requests, alerts, audit_trail, notifications | flips alert back to `'In Progress'`; stamps `reopened_at/by/request_id` |
| GET | `/` | 300 | none | alert_reopen_requests | |
| GET | `/:id` | 317 | none | alert_reopen_requests | |

### `/api/reports` → [reports.js](aml-shield/backend/routes/reports.js)

All routes ungated GET (no privileged data leak beyond what's in dashboard.js):

| METHOD | Path | Line | Tables |
|---|---|---|---|
| GET | `/sar-summary` | 22 | sar_filings |
| GET | `/sla-breach` | 70 | alerts |
| GET | `/team-performance` | 134 | alerts, sar_filings |
| GET | `/kyc-status` | 221 | customers, kyc_reviews |
| GET | `/false-positive` | 292 | alerts |
| GET | `/audit-trail` | 368 | audit_trail, sar_approval_log, case_notes |
| GET | `/regulatory` | 434 | sar_filings, kyc_reviews, alerts |
| GET | `/alert-aging` | 539 | alerts |
| GET | `/my-alerts` | 605 | alerts |
| GET | `/my-sla` | 658 | alerts |
| GET | `/my-sars` | 713 | sar_filings |
| GET | `/my-kyc` | 764 | kyc_reviews, customers |
| GET | `/schedules` | 820 | report_schedules |
| POST | `/schedules` | 827 | **none** | report_schedules |
| DELETE | `/schedules/:id` | 847 | **none** | report_schedules |

### `/api/retrieval-log` → [retrievalLog.js](aml-shield/backend/routes/retrievalLog.js)

| METHOD | Path | Line | Guard | Tables | Notes |
|---|---|---|---|---|---|
| GET | `/` | 6 | none | retrieval_log, audit_trail | |
| POST | `/` | 33 | **none** | retrieval_log, audit_trail | **⚠️ no guard on insert** |

### `/api/sar-approvals` → [sarApprovals.js](aml-shield/backend/routes/sarApprovals.js)

| METHOD | Path | Line | Guard | Tables | Notes |
|---|---|---|---|---|---|
| GET | `/` | 23 | none | sar_filings, alerts | filters to pending/under review/returned |
| GET | `/stats` | 53 | none | sar_filings, sar_approval_log | |
| GET | `/:id` | 81 | none | sar_filings + many joins | |
| POST | `/:id/start-review` | 165 | **none** | sar_filings, audit_trail | sets `'Under Manager Review'` |
| POST | `/:id/approve` | 192 | requireManager | sar_filings, sar_approval_log, cases, customers, kyc_reviews, notifications, audit_trail | sets `'Filed'`; generates `FIU-YYYYMMDD-NNNNN` ref |
| POST | `/:id/reject` | 315 | requireManager | sar_filings, sar_approval_log, cases, notifications, audit_trail | ≥50-char comments; case → `'Work In Progress'` |
| GET | `/:id/comments` | 383 | none | sar_review_comments | |
| POST | `/comments` | 392 | **none** | sar_review_comments, audit_trail | **⚠️ no guard** |
| DELETE | `/comments/:id` | 413 | **none** | sar_review_comments | **⚠️ no guard** |
| POST | `/:id/bsa-sign-off` | 432 | requireBsaOfficer | sar_filings, audit_trail, notifications | stamps `bsa_approved_at` |
| POST | `/:id/bsa-return` | 486 | requireBsaOfficer | sar_filings, audit_trail, notifications | sar → `'Returned for Revision'` |

### `/api/sar-filings` → [sarFilings.js](aml-shield/backend/routes/sarFilings.js)

**Router-level:** blocks `analyst_l1` from ALL routes (lines 13-18) — `403 SAR access requires L2 analyst or above`.

| METHOD | Path | Line | Guard | Tables | Notes |
|---|---|---|---|---|---|
| POST | `/` | 114 | requireL2OrManager | sar_filings, audit_trail | sar_id `SAR-NNNNN`; sets `'Draft'` |
| GET | `/by-case/:id` | 188 | router-only | sar_filings, customers, kyc_reviews | |
| GET | `/:id` | 197 | router-only | sar_filings, customers, kyc_reviews | |
| PATCH | `/:id` | 210 | requireL2OrManager | sar_filings, audit_trail | wizard step audit |
| POST | `/:id/submit` | 239 | requireL2OrManager | sar_filings, cases, alerts, notifications, audit_trail | dual-approval branch |
| POST | `/:id/approve` | 323 | requireL2OrManager | sar_filings, cases | sets `'Filed'` |
| GET | `/:id/generate-narrative` | 371 | router-only | sar_filings, alerts, customers, transactions, case_notes, l2_cases | template-driven draft |
| GET | `/:id/preview` | 459 | router-only | sar_filings, audit_trail | |

### `/api/sars` → [sars.js](aml-shield/backend/routes/sars.js)

Largely **duplicates** `/api/sar-approvals` — both routers expose `/`, `/:id`, `/:id/approve`, `/:id/reject`, `/:id/start-review`, `/:id/bsa-sign-off`, `/:id/bsa-return`, `/comments`, `/comments/:id`. Two valid paths to the same operations.

| METHOD | Path | Line | Guard | Tables |
|---|---|---|---|---|
| GET | `/` | 24 | none | sar_filings, alerts |
| GET | `/stats` | 54 | none | sar_filings, sar_approval_log |
| GET | `/:id` | 82 | none | sar_filings, alerts, customers, case_documents, case_notes, sar_review_comments, sar_approval_log |
| POST | `/:id/start-review` | 166 | **none** | sar_filings, audit_trail |
| POST | `/:id/approve` | 193 | requireManager | sar_filings, sar_approval_log, cases, customers, kyc_reviews, notifications, audit_trail |
| POST | `/:id/reject` | 316 | requireManager | sar_filings, sar_approval_log, cases, notifications, audit_trail |
| PATCH | `/:id` | (see sars.js:89) | requireL2OrManager | sar_filings, audit_trail |
| GET | `/:id/comments` | 384 | none | sar_review_comments |
| POST | `/comments` | 393 | **none** | sar_review_comments, audit_trail |
| DELETE | `/comments/:id` | 414 | **none** | sar_review_comments |
| POST | `/:id/bsa-sign-off` | 432 | requireBsaOfficer | sar_filings, audit_trail, notifications |
| POST | `/:id/bsa-return` | 486 | requireBsaOfficer | sar_filings, audit_trail, notifications |

### `/api/search` → [search.js](aml-shield/backend/routes/search.js)

| METHOD | Path | Line | Guard | Tables | Notes |
|---|---|---|---|---|---|
| GET | `/` | 10 | none | alerts, customers, cases, sar_filings, accounts | L1 callers skip `sar_filings` block (line 15-16) |

### `/api/settings` → [settings.js](aml-shield/backend/routes/settings.js)

| METHOD | Path | Line | Guard | Tables | Notes |
|---|---|---|---|---|---|
| GET | `/defaults` | 27 | none | — | inline JSON |
| GET | `/manager` | 31 | none | manager_settings | |
| POST | `/manager` | 37 | requireManager | manager_settings | UPSERT |
| GET | `/employee/:id` | 55 | none | employee_settings | |
| POST | `/employee/:id` | 61 | requireManager | employee_settings | UPSERT |
| DELETE | `/manager` | 79 | requireManager | manager_settings | |
| DELETE | `/employee/:id` | 86 | requireManager | employee_settings | |

### `/api/sla` → [sla.js](aml-shield/backend/routes/sla.js)

| METHOD | Path | Line | Guard | Tables |
|---|---|---|---|---|
| GET | `/status` | 19 | none | alerts |

### `/api/users` → [users.js](aml-shield/backend/routes/users.js)

| METHOD | Path | Line | Guard | Tables |
|---|---|---|---|---|
| GET | `/` | 45 | none | user_profiles, alerts, cases, case_notes |
| GET | `/:id` | 65 | none | user_profiles, alerts, cases, case_notes |

### Background jobs ([jobs/](aml-shield/backend/jobs/))

| Job | File | Interval | Writes |
|---|---|---|---|
| slaMonitor | `slaMonitor.js` | 5 min | notifications |
| kycReviewMonitor | `kycReviewMonitor.js` | 24 hr | kyc_reviews, notifications |
| ofacSync | `ofacSync.js` | 24 hr | ofac_sdn_entries, ofac_download_log |

All started in [server.js:97-99](aml-shield/backend/server.js#L97-L99).

---

## Section 3 — Frontend Route Map

From [App.jsx](aml-shield/frontend/src/App.jsx) and [components/ProtectedRoute.jsx](aml-shield/frontend/src/components/ProtectedRoute.jsx).

### `/manager/*` — outer gate `['compliance_manager', 'bsa_officer']`

| Path | Component | Inner gate |
|---|---|---|
| `dashboard` | Dashboard | — |
| `alerts` | Alerts | — |
| `cases` | Cases | — |
| `investigations` | Investigations | — |
| `customers`, `customers/:id` | CustomerKYC | — |
| `sars` | SARRepository | — |
| `sar-approvals` | SARApprovalQueue | — |
| `sar-approval/:sarId` | SARApprovalReview | — |
| `kyc-reviews` (scope=manager) | KYCReviewQueue | — |
| `reopen-requests` (mode=manager) | ReopenRequestsQueue | — |
| `kyc-review/:reviewId` | KYCReviewWorkspace | — |
| `retention` | RetentionMonitor | — |
| `audit` | AuditLog | — |
| `reports` | Reports | — |
| `analytics` | Analytics | — |
| `users` | Users | — |
| `settings` | Settings | — |

### `/bsa/*` — outer gate `['bsa_officer']`

| Path | Component |
|---|---|
| `dashboard` | BsaDashboard |
| `alerts` | Alerts |
| `cases` | Cases |
| `customers`, `customers/:id` | CustomerKYC |
| `sar-repository` | SARRepository |
| `sar-approvals` | SARApprovalQueue |
| `sar-approval/:sarId` | SARApprovalReview |
| `retention` | RetentionMonitor |
| `audit-trail` | AuditLog |
| `reopen-requests` | BsaReopenQueue |

### `/employee/*` — outer gate `['analyst_l1', 'analyst_l2']`

| Path | Component | Inner gate |
|---|---|---|
| `dashboard` | Dashboard | — |
| `alerts` | Alerts | — |
| `cases` | Cases | **`['analyst_l2']`** |
| `customers`, `customers/:id` | CustomerKYC | — |
| `sars` | SARRepository | **`['analyst_l2']`** |
| `sar-filing/:caseId` | SARFiling | **`['analyst_l2']`** |
| `kyc-reviews/mine` (scope=mine) | KYCReviewQueue | — |
| `kyc-review/:reviewId` | KYCReviewWorkspace | — |
| `reports` | Reports | — |
| `settings` | Settings | — |

### Role → URL matrix

| Role | Can reach |
|---|---|
| **analyst_l1** | `/employee/{dashboard, alerts, customers, customers/:id, kyc-reviews/mine, kyc-review/:id, reports, settings}` |
| **analyst_l2** | All L1 routes plus `/employee/{cases, sars, sar-filing/:caseId}` |
| **compliance_manager** | All `/manager/*` |
| **bsa_officer** | All `/bsa/*` AND all `/manager/*` (outer gate includes bsa_officer) |

> Note: `bsa_officer` is intentionally allowed into `/manager/*` for read-only oversight ([App.jsx:56](aml-shield/frontend/src/App.jsx#L56)). Sidebar for BSA never links there, but URL access is permitted.

### Sidebar sections by role

From [Sidebar.jsx](aml-shield/frontend/src/components/Sidebar.jsx):

| Role | Sections |
|---|---|
| **manager** | MONITORING (dashboard, alerts, cases, investigations) · CUSTOMERS (customers, kyc-reviews) · APPROVALS (reopen-requests) · SAR MANAGEMENT (sars, sar-approvals, retention) · REPORTS (analytics, reports) · ADMIN (users, settings) |
| **bsa** | COMMAND CENTER (dashboard, reopen-requests) · OVERSIGHT (alerts, cases, customers) · SAR MANAGEMENT (sar-approvals, sar-repository, retention) · REGULATORY (Legal Holds informational, audit-trail) |
| **analyst_l2** | MY WORK (dashboard, alerts, my cases, kyc-reviews/mine) · CUSTOMERS · SAR MANAGEMENT (sars, File SAR → cases) · REPORTS · ADMIN |
| **analyst_l1** | MY WORK (dashboard, alerts, kyc-reviews/mine) · CUSTOMERS · REPORTS · ADMIN (no SAR section) |

---

## Section 4 — DB Schema Summary

30 public tables in Supabase. Column counts and key fields:

| Table | Cols | Key columns |
|---|---|---|
| accounts | 8 | account_number, customer_id, opened_date |
| alert_reopen_requests | 24 | request_id (RRQ-…), alert_id, status, manager_decision, bsa_decision |
| alert_transactions | 5 | alert_id, transaction_id, role |
| **alerts** | 52 | alert_id (ALERT-YYYY-NNNNN), customer_id, alert_status, sla_deadline (TEXT), assigned_to (full name), reopened_at/by/request_id |
| audit_trail | 7 | sar_id (reused as entity_id), action, entity_type, timestamp |
| case_documents | 9 | alert_id, file_path |
| case_notes | 5 | alert_id, note_text, analyst, timestamp |
| **cases** | 11 | case_id, source_alert_id (FK), linked_sar_id, case_status |
| counterparties | 9 | counterparty_id, country, risk_score |
| **customers** | 46 | customer_id, customer_risk_rating, pep_match (int), sanctions_match (int), exit_status |
| documents | 8 | sar_id, file_path (SAR attachments) |
| employee_settings | 5 | analyst_id, setting_key, setting_value |
| kyc_review_documents | 8 | review_id (int), file_path |
| **kyc_reviews** | 30 | customer_id, status (pending/assigned/in_progress/pending_approval/completed/returned), recommendation |
| **l2_cases** | 25 | l2_case_id (L2-YYYY-NNNN), alert_id, status, decision |
| l2_documents | 8 | l2_case_id |
| l2_notes | 5 | l2_case_id |
| manager_settings | 4 | setting_key, setting_value |
| **notifications** | 11 | recipient_id, recipient_role, type, related_id, related_type, is_read (int), tone |
| ofac_download_log | 5 | downloaded_at, entry_count |
| ofac_screening_results | 15 | entity_type, entity_id, sdn_entry_id, status |
| ofac_sdn_entries | 18 | sdn_name, program, aka_names (ARRAY), nationalities (ARRAY) |
| report_schedules | 8 | report_key, frequency, recipients |
| retrieval_log | 6 | sar_id, requested_by, exported_at |
| sar_approval_log | 8 | sar_id, action, actioned_by |
| **sar_filings** | 86 | sar_id (SAR-NNNNN), case_id, sar_status, regulator_reference (FIU-…), bsa_officer_id, bsa_approved_at, retention_expiry_date |
| sar_review_comments | 8 | sar_id, comment_text, highlighted_text, position_start/end |
| scenario_versions | 11 | scenario_code, parameters_json (jsonb) |
| **transactions** | 18 | transaction_id, customer_id, txn_date, amount (bigint), is_alerted |
| **user_profiles** | 11 | user_id, name, role, team, status, **password (plaintext)**, email, username |

### Status string conventions

| Entity | Open states | Terminal states |
|---|---|---|
| `alerts.alert_status` | `'Unassigned'`, `'Not Started'`, `'In Progress'`, `'Escalated - L2'`, `'Escalated - SAR'` | `'Completed'`, `'Closed'`, `'Closed — False Positive'` (em dash) |
| `cases.case_status` | `'Unassigned'`, `'Not Started'`, **`'Work In Progress'`** (capital I), `'Pending Review'`, `'Filed'` | `'Closed'` |
| `sar_filings.sar_status` | `'Draft'`, `'Pending Approval'`, `'Under Manager Review'`, `'Returned for Revision'` | `'Filed'` |
| `l2_cases.status` | `'Pending Assignment'`, `'Under L2 Review'`, `'Assigned'`, `'Returned to L1'` | `'Decision Made — Closed'`, `'Decision Made — SAR Filed'` |
| `kyc_reviews.status` | `'pending'`, `'assigned'`, `'in_progress'`, `'pending_approval'` | `'completed'`, `'returned'`, `'rejected'` |
| `alert_reopen_requests.status` | `'pending_manager'`, `'pending_bsa'` | `'manager_rejected'`, `'bsa_rejected'`, `'bsa_approved'` |

---

## Section 5 — Risks & Inconsistencies

### Critical / High

1. **Unguarded write routes** — These mutate state with no role check:
   - `POST /api/notifications/` ([notifications.js:103](aml-shield/backend/routes/notifications.js#L103)) — any client can fabricate notifications.
   - `POST /api/retrieval-log/` ([retrievalLog.js:33](aml-shield/backend/routes/retrievalLog.js#L33)) — any client can log fake SAR retrievals.
   - `POST /api/sar-approvals/:id/start-review` ([sarApprovals.js:165](aml-shield/backend/routes/sarApprovals.js#L165)) — mutates `sar_status` to `'Under Manager Review'` with no guard.
   - `POST /api/sar-approvals/comments` + `DELETE /api/sar-approvals/comments/:id` ([sarApprovals.js:392, 413](aml-shield/backend/routes/sarApprovals.js#L392)).
   - Same duplicates in `/api/sars/*` ([sars.js:166, 393, 414](aml-shield/backend/routes/sars.js#L166)) — `start-review`, comments POST/DELETE.
   - `POST /api/reports/schedules` and `DELETE /api/reports/schedules/:id` ([reports.js:827, 847](aml-shield/backend/routes/reports.js#L827)).

2. **Local `requireManager` in investigations.js** instead of importing from middleware. [investigations.js:9-14](aml-shield/backend/routes/investigations.js#L9-L14) defines a private function rather than `const { requireManager } = require('../middleware/roleGuard')`. Works, but inconsistent — same pattern was already cleaned up for `requireBsa` in `sarApprovals.js`.

3. **Duplicate router surfaces** — `/api/sars/*` and `/api/sar-approvals/*` expose the same approve/reject/comment/bsa-sign-off operations against the same tables. Frontend uses both: most calls go to `/api/sar-approvals` but some legacy `/api/sars/*` calls remain (SARRepository, SAR detail page). One could probably be removed.

4. **`case_status` uses `'Work In Progress'`** (capital W, capital I) while `alert_status` was canonicalized to `'In Progress'` in the previous round. Six writes use `'Work In Progress'`:
   - [sarApprovals.js:363](aml-shield/backend/routes/sarApprovals.js#L363) (rejection)
   - [sarFilings.js:505](aml-shield/backend/routes/sarFilings.js#L505)
   - [kycReviews.js:528](aml-shield/backend/routes/kycReviews.js#L528) (KYC escalation case)
   - [l2.js:521-ish](aml-shield/backend/routes/l2.js) (SAR-escalation case)
   - Frontend [Cases.jsx:16](aml-shield/frontend/src/pages/Cases.jsx#L16) Kanban column
   - Frontend [Topbar.jsx:481](aml-shield/frontend/src/components/Topbar.jsx#L481) STATUS_TONE map
   
   This is **a different string from the `'Work in Progress'`** (lowercase 'in') that was canonicalized last round. The CRITICAL RULE in the spec says "NEVER use 'Work in Progress'" — the case-status variant uses different capitalisation, so it technically doesn't violate the rule, but it's confusing. Worth normalising `cases.case_status` to `'In Progress'` for consistency with `alerts`.

### Medium

5. **`alerts.js:94` priority-bucket sort omits `'Closed — False Positive'`.** The `CASE` statement only buckets `'Completed'`, `'Closed'`, and `'False Positive'` as THEN 5; the canonical `'Closed — False Positive'` (em dash) falls through to `ELSE 6`, placing all 441 FP-closed rows last instead of with the rest of the closed group. Visible only when `priority_bucket_sort=1` is requested.

6. **`/api/sars/:id/start-review`** has `none` for guard while its identical sibling in `/api/sar-approvals` also has `none` — both mutate. Inconsistent with the rest of the SAR approval surface where approve/reject got `requireManager`.

7. **`/api/sar-filings/:id/approve`** ([sarFilings.js:323](aml-shield/backend/routes/sarFilings.js#L323)) uses `requireL2OrManager` while the more authoritative `/api/sar-approvals/:id/approve` uses `requireManager`. Two valid approval paths with different permission models — L2 can approve via the L2 draft path but not the manager-approval path. Probably intentional dual-approval semantics, but worth a comment.

8. **`POST /api/auth/login` is plaintext-compare** ([auth.js:13-17](aml-shield/backend/routes/auth.js#L13-L17)). Acceptable for demo; non-negotiable to fix before any pilot. Already documented.

9. **Header-only role auth** — every request is `x-user-role: ...`. Anyone who can edit the axios interceptor can impersonate any role. Same caveat as #8.

### Low

10. **`/api/l2/stats/manager`** has no frontend caller. Either wire it into a manager L2 widget or remove.

11. **Naming inconsistency `/manager/sars` vs `/bsa/sar-repository`** — same SARRepository component at different paths. Likewise `/manager/audit` vs `/bsa/audit-trail`. No functional bug, just inconsistent.

12. **Sidebar item ambiguity for L2**: two entries with `to: 'cases'` — one labeled "My Cases" (RESOURCES section), one labeled "File SAR" (SAR FILING section). Both reach the same route. Could be confusing.

13. **Dead-but-correct sidebar item:** BSA sidebar has a "Legal Holds · Coming soon" entry with `match: []`. Intentional placeholder, no harm.

14. **L1 SAR isolation enforced at three layers** (router-level middleware on `/api/sar-filings`, frontend route gates on `/employee/sars` etc., search.js filter). Defense-in-depth — no issue, just worth noting.

---

## Section 6 — Inconsistencies Between Frontend and Backend

| Surface | Frontend expects | Backend serves | Status |
|---|---|---|---|
| `/api/alerts/*` write guards | gated by sidebar visibility | `requireAnyAnalyst` / `requireManager` | ✅ aligned |
| `/api/sar-filings/*` | L1 routes hidden + inner gate | router-level L1 block + `requireL2OrManager` writes | ✅ aligned (defense-in-depth) |
| `/api/notifications/` (POST) | only fired server-side by app code | **no guard** | ⚠️ frontend assumption broken |
| `/api/documents/*` | called by SARRepository | guards in place | ✅ |
| `/api/sars` vs `/api/sar-approvals` | both used | both exist (duplicated) | ⚠️ redundant — pick one |
| `/api/auth/login` body | `{username, password}` | matches | ✅ |
| `x-user-role` header | sent by axios interceptor | read by `roleGuard.js` | ✅ |
| `analyst_id` query param | injected on `/employee/*` calls | consumed by `/search`, `/reports/my-*`, `/kyc-reviews?assigned_to=` | ✅ |

---

## Section 7 — What I want to confirm before any code change

Per the task instruction: **I am NOT writing any code yet.** Here are the changes that would follow from the findings above. Please confirm which to action:

### A. High-value security fixes
1. Add `requireManager` to `POST /api/notifications/`, `POST /api/retrieval-log/`, `POST /api/reports/schedules`, `DELETE /api/reports/schedules/:id`.
2. Add `requireManager` to `POST /api/sar-approvals/:id/start-review`, `POST /api/sar-approvals/comments`, `DELETE /api/sar-approvals/comments/:id` (and the duplicates in `/api/sars/*`).
3. Replace local `requireManager` in `investigations.js:9-14` with `const { requireManager } = require('../middleware/roleGuard')` for consistency.

### B. Status canonicalisation (DB UPDATE + code)
4. Decide: canonicalise `cases.case_status` from `'Work In Progress'` to `'In Progress'`, or leave it (intentional divergence from alerts)?
5. Fix `alerts.js:94` sort to include `'Closed — False Positive'` so the 441 FP-closed rows sort with the closed bucket.

### C. Cleanup
6. Decide whether to delete `/api/sars/*` (duplicate of `/api/sar-approvals/*`) or vice versa.
7. Either wire up `/api/l2/stats/manager` to the manager L2 widget or remove the dead route.
8. Standardise `/manager/sars` vs `/bsa/sar-repository` (and `/manager/audit` vs `/bsa/audit-trail`) — pick one URL scheme per role group.

### D. Not recommended now
- Replacing plaintext auth with real session/JWT — known issue, demo-scope. Defer.
- Adding guards to GETs — they leak data but not in a way that breaks the demo. Defer unless asked.

**Awaiting your green-light on which of A/B/C to action, in what order. Won't touch code until you confirm.**
