# Crowe ARC — System Health Check

Date: 2026-05-13 · Branch: `main` · Last commit at audit: `5e518774`

This is a **read-only diagnostic**. No source files were modified. Two temporary node scripts (`db-diagnostics.js`, `db-q9-retry.js`, `db-syntax-test.js`) were created at the repo root to drive Supabase queries and have not been committed.

---

## SECTION 1 — DATABASE HEALTH

### Schema (Q1 — 30 tables)

All expected tables present. Notable column counts:

| Table | Cols | Notes |
|---|---|---|
| `alerts` | 52 | core entity |
| `sar_filings` | 86 | wizard-driven; many optional fields |
| `customers` | 46 | KYC profile |
| `kyc_reviews` | 30 | review workflow |
| `l2_cases` | 25 | L2 escalation entity |
| `alert_reopen_requests` | 24 | reopen workflow (new) |
| `ofac_sdn_entries` | 18 | sanctions list |
| `transactions` | 18 | activity data |
| `notifications` | 11 | event fanout |
| `user_profiles` | 11 | identity |
| `audit_trail` | 7 | small — flagged in §3 |

### Alert status distribution (Q2 — 1000 alerts)

| Status | Count |
|---|---|
| Closed — False Positive | 441 |
| In Progress | 179 |
| Not Started | 110 |
| Escalated - L2 | 80 |
| Escalated - SAR | 80 |
| Completed | 50 |
| Unassigned | 50 |
| Work in Progress | 10 |

Healthy distribution. Note dual "In Progress" / "Work in Progress" — see §3.

### SAR status distribution (Q3 — 37 SARs)

| Status | Count |
|---|---|
| Filed | 28 |
| Draft | 5 |
| Returned for Revision | 4 |

### Open SLA breaches (Q4)

**0 breaches.** All open alerts are inside SLA.

### Orphan checks (Q5, Q6, Q12)

| Check | Count |
|---|---|
| Cases without matching alert | 0 |
| SARs without matching case | 0 |
| Alerts missing customer_id | 0 |
| Alerts missing scenario | 0 |
| SARs missing case_id | 0 |
| Cases missing source_alert_id | 0 |

Referential integrity is clean.

### KYC review queue (Q7 — 14 active)

| Status | Count |
|---|---|
| pending | 7 |
| overdue | 6 |
| assigned | 1 |

6 overdue reviews — operationally significant, not a code defect.

### OFAC sync (Q8 — last 5 runs)

| Run | Status | Entries |
|---|---|---|
| 2026-05-12 06:36Z | success | 18 959 |
| 2026-05-11 05:37Z | success | 18 947 |
| 2026-05-10 08:39Z | success | 18 947 |
| 2026-05-10 05:48Z | success | 18 947 |
| 2026-05-09 05:48Z | success | 18 947 |

Daily sync is running. Last update 27 hours before audit — within tolerance.

### Notifications backlog (Q9 — 59 total)

| Type | Count | Unread |
|---|---|---|
| sla_warning_48hr_manager | 14 | 0 |
| sla_warning_48hr | 11 | **7** |
| sar_approved | 8 | **8** |
| kyc_triggered_sar | 7 | 0 |
| ofac_confirmed | 6 | 0 |
| ofac_match | 5 | 0 |
| kyc_overdue | 4 | 0 |
| kyc_triggered_alerts | 2 | 0 |
| sar_bsa_signed_off | 1 | 1 |
| kyc_review_assigned | 1 | 1 |

⚠️ Every `sar_approved` notification is unread — the L2 preparer has never seen them. Either UI does not render this type or recipient routing is dropping them. Worth investigating (see §3 H6).

### Users (Q10 — 12 active)

| Role | Count | Names |
|---|---|---|
| analyst_l1 | 6 | Arjun Sharma, Neha Iyer, Priya Nair, Robert Wright, Rohit Mehta, Vikram Sinha |
| analyst_l2 | 4 | Cassian Jude, Hannah Louise, Marie Davis, Olivia Brown |
| bsa_officer | 1 | James Carter |
| compliance_manager | 1 | Henry Morgan |

All `Active`. Roster matches `DEMO_USERS` in `Login.jsx`.

### Reopen requests (Q11)

**0 requests** — feature shipped, no usage yet.

---

## SECTION 2 — BROKEN ROUTES ❌

### Frontend → backend wire-up

Comprehensive scan of `api.get/post/patch/delete` against every router mount in `backend/server.js`. **Zero broken-link API calls** were found — every frontend endpoint hits an existing backend route.

### Dead backend routes (no caller)

| Route | File | Notes |
|---|---|---|
| `POST /api/documents/upload` | [documents.js](aml-shield/backend/routes/documents.js) | Frontend uploads via `/case-documents/upload` instead. Legacy SAR doc path. |
| `GET /api/documents/:id`, `DELETE /api/documents/:id` | documents.js | Same — frontend uses case-documents |
| `GET /api/l2/stats/manager` | l2.js | Endpoint present but no Manager-side fetch consumes it |

These are not "broken" — they return correct responses if called — but they have no consumer. Safe to leave or remove on cleanup.

### Routes mounted but server.js path mismatch

None detected. All 26 routers mount at `/api/<name>` and the frontend `api` client correctly prefixes `/api`.

---

## SECTION 3 — ROLE ACCESS ISSUES ⚠️

### Verified-clean access paths

| Role | Routes | Sidebar items | Mismatch |
|---|---|---|---|
| `analyst_l1` | 8 | 8 (across MY WORK / CUSTOMERS / REPORTS / ADMIN) | ✅ none |
| `analyst_l2` | 11 | 11 | ✅ none |
| `compliance_manager` | 18 | 18 | ✅ none |
| `bsa_officer` | 11 | 10 (+1 informational "Legal Holds · Coming soon") | ✅ none |

`landingFor()` in [ProtectedRoute.jsx:15-19](aml-shield/frontend/src/components/ProtectedRoute.jsx#L15-L19) maps all four roles. `useRoleNavigate.js` `rolePrefix` covers `/manager`, `/bsa`, `/employee`. `DEMO_USERS` in [Login.jsx](aml-shield/frontend/src/pages/Login.jsx#L13-L26) includes one entry per role.

### Cross-layer mismatches — backend allows what frontend blocks

These are routes where the **backend has no role guard** but the frontend page is gated. An attacker who guesses the URL or scripts a direct API call can bypass the UI.

| Severity | Route | File:line | Issue |
|---|---|---|---|
| **HIGH** | `PATCH /api/sars/:id` | [sars.js:89](aml-shield/backend/routes/sars.js#L89) | No role guard. Frontend SAR repository read-only for Manager/BSA, but anyone with a session can mutate `sar_status`, `narrative_summary`, `approved_by`, etc. |
| **HIGH** | `POST /api/audit-trail` | [auditTrail.js](aml-shield/backend/routes/auditTrail.js) | No role guard on audit-row creation. Any logged-in user can forge audit entries. |
| **HIGH** | `POST/DELETE /api/settings/manager`, `POST/DELETE /api/settings/employee/:id` | [settings.js](aml-shield/backend/routes/settings.js) | No role guard. L1 could overwrite manager-wide settings. |
| **MEDIUM** | `POST /api/notifications`, `PATCH /api/notifications/...` | [notifications.js](aml-shield/backend/routes/notifications.js) | No guards. Any user can mark another user's notifications read, or fabricate notifications. |
| **MEDIUM** | `POST /api/case-notes` | [caseNotes.js](aml-shield/backend/routes/caseNotes.js) | No guard. Any role can add notes to any alert. |
| **MEDIUM** | `POST /api/sar-approvals/:id/approve` and `/reject` | [sarApprovals.js](aml-shield/backend/routes/sarApprovals.js) | No `requireManager` — only frontend hides the button. L1 could approve a SAR via curl. |

### Authentication

- **Plaintext password compare** at [auth.js:13-17](aml-shield/backend/routes/auth.js#L13-L17) — comment acknowledges "demo-grade login." No JWT/session, only a client-stamped `x-user-role` header. Role headers are entirely client-controlled — any axios interceptor edit would impersonate another role. Acceptable for current demo posture; flagged as Critical for any production pilot (already documented in repo's enterprise gap analysis).

### Cosmetic

- Inner `<ProtectedRoute>` guards on `/employee/cases`, `/employee/sars`, `/employee/sar-filing/:caseId` list `['analyst_l2', 'compliance_manager', 'bsa_officer']` even though the outer gate already excludes manager/BSA from `/employee/*`. Manager/BSA entries in the inner list are dead code. Functionally correct; could simplify to `['analyst_l2']`.

---

## SECTION 4 — GLITCH SOURCES 🐛

### CRITICAL

**G1 — `bulk-close` UPDATE is broken (PG syntax error).**
[alerts.js:458-469](aml-shield/backend/routes/alerts.js#L458-L469)
JS-style `//` comments live **inside** a SQL template literal. Verified by running an EXPLAIN against the same shape on Supabase:

> PG rejected `//` comments. Error: `syntax error at or near "a"` (position 105).

Manager's "Bulk Close as False Positive" button will 500 every time. The comment was *intended* to be a code comment but ended up sent to Postgres as literal SQL.

```js
await client.query(`
  UPDATE alerts SET ... WHERE alert_id = $5
  // Match the canonical seed-data status string ...   ← shipped to PG
  // Bulk-close was previously writing 'Completed' ... ← shipped to PG
  `, [...]);
```

Fix: move the `//` lines outside the backtick OR change them to `--` PG line comments.

### HIGH

**G2 — Alert status canonicalization is split.**
`alerts.alert_status` has both `'In Progress'` (179) and `'Work in Progress'` (10) values. Frontend `alertScoring.js` uses `{'Not Started','In Progress','Work in Progress'}` to keep both alive. The 10 rows of `Work in Progress` look like a legacy seed that needs canonicalising — eats KPI accuracy.

**G3 — `sar_approved` notifications all unread (Q9).**
8 of 8 unread. Either the L2 recipient never opens the bell, the recipient address is wrong, or the UI doesn't render this notification type. Worth a single-component check in [Topbar.jsx](aml-shield/frontend/src/components/Topbar.jsx) — the `handleNotificationClick` dispatches `sar_pending`, `sar_rejected`, `sar_approved` but only Manager-side `sar_pending` is routed.

### MEDIUM

**G4 — Z-index hierarchy is intentional but tight.**
Inventory of every z value:

| Layer | z | Components |
|---|---|---|
| Sticky topbar | `z-20` | Topbar.jsx:258 |
| Dropdowns / sticky table headers | `z-30` | Alerts.jsx:336/374, ManagerAlertsTable.jsx:377/584, SARApprovalReview.jsx:582, SARFiling.jsx:1009, KYCReviewQueue.jsx:233 |
| Floating bottom-right widgets | `z-40` | NextUpFloat.jsx:63, Investigations.jsx:519, Dashboard.jsx:933 |
| Standard modals | `z-50` | ~15 modal locations, all body overlays |
| Dashboard secondary modal | `z-[60]` | Dashboard.jsx:2038 |
| CompletionPrompt overlay | `z-80` | CompletionPrompt.jsx:104 — intentionally above modals |
| Topbar bell / user / search dropdowns | `z-[100]` | Topbar.jsx:342/427/632 — top of stack |

No accidental overlap detected after the prior `z-[100]` fix. CompletionPrompt at z-80 will, however, sit above any `z-50` modal — if a SAR-filing modal is open and a disposition fires, the prompt will cover it. Low-impact today (L1-only) but worth a comment.

**G5 — `sarApprovals.js:431-436` defines a local `requireBsa` middleware** instead of importing `requireBsaOfficer` from `middleware/roleGuard.js`. Inconsistent, harder to audit. Functionally equivalent.

**G6 — `Dashboard.jsx:884` setTimeout** assigned to `const t` but the cleanup path is unclear. Probably benign (inside an async handler, not useEffect) but worth a glance.

### LOW

**G7 — Polling cadences vary.**
- Sidebar / Topbar notif refresh: 30s
- BsaActionQueue, WorklistBand: 60s
- SLAPopup: depends on `POLL_MS` constant
- KYC stats: 60s

Not a bug — but four independent timers per page running on the same data sources is more SQL than required. Centralising into one `useNotificationStream`-style hook would reduce DB load by ~3×.

**G8 — `sla.js`, `analytics.js`, `reports.js` — heavy queries with no `LIMIT`** in some endpoints. Will get slower as the dataset grows past today's 1 000 alerts. Not a bug today; will become one at 10×.

---

## SECTION 5 — DEAD CODE 💀

### Console statements

**None found** in `frontend/src/`. Production-clean.

### TODO / FIXME / XXX

- Frontend: zero actionable. (One false positive in `Sidebar.jsx:303` from a base64-embedded PNG.)
- Backend: zero actionable. References in `cases.js:15`, `kycReviews.js:510`, `l2.js:464-467` are documentation comments about ID-naming, not pending work.

### Unused / orphaned routes

See §2 — three legacy `/documents/*` endpoints and one `/l2/stats/manager` endpoint have no frontend caller.

### Dead inner-route allowedRoles

`compliance_manager` and `bsa_officer` listed in inner `<ProtectedRoute>` on `/employee/cases`, `/employee/sars`, `/employee/sar-filing/:caseId` are dead — the outer gate already excludes them. Code clarity only.

### Temporary diagnostic scripts (not committed)

Three node scripts at the repo root were created for this audit and should be deleted: `db-diagnostics.js`, `db-q9-retry.js`, `db-syntax-test.js`.

---

## SECTION 6 — QUICK FIXES ✅

Top 10 issues fixable in under 30 minutes each, ordered by impact:

| # | Fix | File:line | Est | Impact |
|---|---|---|---|---|
| 1 | Move `//` comments out of the SQL template at bulk-close | [alerts.js:458-469](aml-shield/backend/routes/alerts.js#L458-L469) | 5 min | Restores manager bulk-close (currently 500s on every call) |
| 2 | Add `requireL2OrManager` to `PATCH /api/sars/:id` | [sars.js:89](aml-shield/backend/routes/sars.js#L89) | 5 min | Closes a SAR-mutation hole |
| 3 | Add `requireManager` to `POST /api/audit-trail` | [auditTrail.js](aml-shield/backend/routes/auditTrail.js) | 5 min | Prevents audit forgery |
| 4 | Add `requireManager` to all write routes on `settings.js` | [settings.js](aml-shield/backend/routes/settings.js) | 10 min | Closes settings tampering hole |
| 5 | Replace local `requireBsa` in `sarApprovals.js` with imported `requireBsaOfficer` | [sarApprovals.js:431-436](aml-shield/backend/routes/sarApprovals.js#L431-L436) | 5 min | Consistency, audit clarity |
| 6 | Canonicalise the 10 `Work in Progress` alerts to `In Progress` (or vice versa) and drop the alias from `alertScoring.js` | DB + [alertScoring.js](aml-shield/frontend/src/utils/alertScoring.js) | 10 min | KPI accuracy |
| 7 | Add `requireManager` to `POST /api/sar-approvals/:id/approve` and `/reject` | [sarApprovals.js](aml-shield/backend/routes/sarApprovals.js) | 5 min | Approval cannot be forged |
| 8 | Add `requireAnyAnalyst` to `POST /api/case-notes` | [caseNotes.js](aml-shield/backend/routes/caseNotes.js) | 3 min | Notes can't be posted by unauthenticated calls |
| 9 | Delete dead legacy `/documents/*` endpoints | [documents.js](aml-shield/backend/routes/documents.js) | 10 min | Reduces attack surface |
| 10 | Simplify inner `<ProtectedRoute allowedRoles>` on `/employee` SAR/cases routes to `['analyst_l2']` | [App.jsx:121-135](aml-shield/frontend/src/App.jsx#L121) | 5 min | Code clarity |

Total: ~1 hour of focused work to clear the critical and high-severity items.

---

## SECTION 7 — SUMMARY SCORECARD

| Severity | Count | Examples |
|---|---|---|
| **Critical** | 1 | Bulk-close SQL is broken (G1) |
| **High** | 5 | sars.js PATCH unguarded; audit-trail forgeable; settings unguarded; sar-approvals approve/reject unguarded; status duplication (`In Progress` vs `Work in Progress`) |
| **Medium** | 6 | notifications routes unguarded; case-notes unguarded; `sar_approved` notifications all unread; local `requireBsa` not centralised; dead inner allowedRoles; tight z-index between CompletionPrompt and modals |
| **Low** | 5 | Polling cadences not centralised; no `LIMIT` on heavy reports; dead `/documents/*` endpoints; informational sidebar item; demo-grade auth (already known) |
| **Informational** | 6 | All schema integrity checks clean; 0 SLA breaches; 0 orphans; OFAC sync healthy; clean console; no dead `console.log`s |

**Total issues found: 17 actionable**
- Critical: 1
- High: 5
- Medium: 6
- Low: 5

**Estimated fix time for Critical + High: ~1 hour.**
**Estimated fix time for full backlog (1 + 5 + 6 + 5): ~4 hours.**

---

## Audit notes

- All findings cross-checked against actual source. Two prior agent-flagged issues were verified false-positive and removed:
  - `SLAPopup.jsx:145` array of setTimeouts **does** have cleanup at line 146 (`timers.forEach(clearTimeout)`).
  - `DEMO_USERS` **does** include the BSA Officer entry at [Login.jsx:15](aml-shield/frontend/src/pages/Login.jsx#L15).
- The bulk-close SQL bug (G1) was verified by running an EXPLAIN with the same `//`-inside-template-literal pattern against Supabase; Postgres returned `syntax error at or near "a"` confirming the bug fires at execution time, not just statically.

End of report.
