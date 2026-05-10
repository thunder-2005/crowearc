# Crowe ARC — Enterprise AML Capability Gap Analysis

**Date:** 2026-05-07
**Scope:** read-only audit of the current main branch against eight
enterprise-grade AML capabilities. No code changes were made.

| # | Capability | Status |
|---|---|---|
| 1 | Large-scale alert ingestion from core TM platforms | ❌ Not built |
| 2 | Rules / scenario management and tuning | ❌ Not built |
| 3 | Model governance | ❌ Not built |
| 4 | Feed reconciliation / completeness controls | ❌ Not built |
| 5 | Enterprise IAM / SSO / entitlement model | ⚠️ Partially exists (demo-grade) |
| 6 | Stronger evidence-grade audit identity | ⚠️ Partially exists |
| 7 | Configurable workflow designer | ❌ Not built |
| 8 | Production-scale resiliency and controls | ⚠️ Partially exists |

Three ⚠️, five ❌, zero ✅ at full-enterprise bar. The current build is a
demo / SaaS-prototype level platform.

---

## 1. Large-scale alert ingestion from core TM platforms

**Status:** ❌ Not built

**What exists:**
- `backend/database/seed_csv.js` — one-shot CSV loader run via `npm run seed:csv`. Reads the seven CSVs in `backend/seed_data/`, transforms them, batches at 100 rows, replaces all data inside a single transaction. Designed for demo seeding, not for repeated production intake.
- `backend/routes/alerts.js` — has GET / PATCH endpoints (status, disposition, assign, bulk-assign, bulk-close) but **no POST endpoint to create new alerts**. Alerts only enter the system via the seed script.

**What is missing:**
- No SFTP listener, no `chokidar` file watcher, no incoming webhook endpoint, no Kafka / RabbitMQ consumer, no scheduled puller.
- No "Data Import" page in the frontend (the Sidebar lists Dashboard, Alerts, Cases, KYC, SARs, Reports, Analytics, Settings, Users — nothing for ingestion).
- No POST `/api/alerts` route. No bulk-create endpoint. No duplicate-detection on intake. No quarantine queue for malformed records.
- No connectors for Actimize, Oracle FCCM, Verafin, NetReveal, or similar core TM platforms.
- No mapping layer between external schemas and the internal `alerts` table.

**Effort to close:** **Large (months)** — true enterprise ingestion requires connector framework, schema-mapped intake, dedup, retry/error queue, audit on every batch, and ops dashboards. Months of work.

---

## 2. Rules / scenario management and tuning

**Status:** ❌ Not built

**What exists:**
- The `alerts.scenario` column is a free-text string populated from seed data. Six scenario names recur ("Structuring", "High Risk Country", "Watchlist Hit", "Cash Intensive", "Rapid Movement", "Trade Based ML") but there is **no rule logic anywhere in the codebase that produced them** — they're decorative seed values.
- `backend/utils/narrativeTemplates.js` has six scenario-aware **narrative templates** (regulatory text per scenario), but these only apply during SAR drafting — they do not detect or tune rules.
- `backend/jobs/slaMonitor.js` and `kycReviewMonitor.js` enforce time-based SLAs, but those are operational, not detection rules.
- `frontend/src/pages/Settings.jsx` (661 lines) configures **SLA defaults by priority, SLA breach warning thresholds, retention policies, mandatory SAR-filing fields, and display preferences**. None of this is scenario or threshold management for AML rules.
- `frontend/src/pages/Analytics.jsx` shows an aggregate False Positive % across all alerts — not per-scenario, no drill-down to tune.

**What is missing:**
- No scenario configuration page where managers can create / edit / activate AML rules.
- No threshold UI (e.g. structuring threshold, velocity windows, geography watchlists).
- No scenario performance dashboard showing FP rate, productivity, and aging by rule.
- No A/B testing / champion-challenger between scenario versions.
- No rule versioning, no audit of who changed what threshold and when.
- No rule-execution engine — there is no service that runs scenarios over transactions to produce the alerts in the first place.

**Effort to close:** **Large (months)** — needs both a rule-execution engine and the management UI/API around it. This is a core platform capability and typically a 6–12 month build for one team.

---

## 3. Model governance

**Status:** ❌ Not built

**What exists:**
- `alerts.risk_score` is an INTEGER column populated with static seed values (no model produced them).
- `customers.customer_risk_rating` is a TEXT column ("Low", "Medium", "High", "Very High") populated from the seed CSV, manually maintained via KYC review approve flow.
- `l2_cases.risk_score` is computed by ticking checkboxes in the L2 workspace (each ticked factor = +10 — pure rules, not a model).
- `backend/utils/ofacScreener.js` uses an inline Jaro-Winkler similarity score — that's an algorithm, not a governed ML model.

**What is missing:**
- No ML model files (no `.pkl`, `.onnx`, `.h5`, `.joblib`).
- No Python or model-serving runtime in the stack (Node-only backend).
- No model registry table or page.
- No model versioning, no champion / challenger setup.
- No drift monitoring, no input-distribution dashboards.
- No model-risk documentation page (validation reports, sensitivity analysis, fair-lending review etc.).
- No SR 11-7 / OCC 2011-12 alignment.

**Effort to close:** **Large (months)** — model governance is itself a discipline (registry, lineage, validation evidence, monitoring) that wraps an ML platform. Typically a multi-quarter program even when the models exist; here the models don't exist either.

---

## 4. Feed reconciliation / completeness controls

**Status:** ❌ Not built

**What exists:**
- `backend/database/seed_csv.js` does light validation: FK resolution maps (customer_id → customer_name, account_id → account_number, case_id → alert_id), per-table try/catch with rollback on failure, and a final "X / 1209 rows" progress log per batch.
- `backend/utils/ofacDownloader.js` writes a `ofac_download_log` row on each download (status, entry_count, error_message) — that's a per-feed log but only for OFAC.
- `documents` and `kyc_review_documents` tables persist file metadata and are referenced in audit on upload.

**What is missing:**
- No source-to-target mapping configuration page.
- No daily reconciliation report comparing source row counts to landed counts.
- No "feed health" dashboard.
- No duplicate-detection on import beyond the implicit primary-key constraint (would silently fail mid-batch with no surfacing UX).
- No data-quality rules (null %, range checks, format validation per field).
- No SLA on feed arrival times, no missed-feed alerts.
- No batch-processing audit table (separate from `audit_trail` which is action-level, not feed-level).

**Effort to close:** **Medium (weeks)** for a basic reconciliation dashboard + feed-health page over the existing CSV mechanism. **Large (months)** for full enterprise data-quality framework with per-field rules, lineage, and cross-source reconciliation.

---

## 5. Enterprise IAM / SSO / entitlement model

**Status:** ⚠️ Partially exists — demo-grade only

**What exists:**
- `backend/routes/auth.js` (60 lines): POST `/login` does a **plaintext password compare** against `user_profiles.password`. POST `/logout` returns `{success: true}` with no server state. GET `/me` looks up user by id.
- `backend/middleware/roleGuard.js` (36 lines): centralized whitelist guards (`requireManager`, `requireL2OrManager`, `requireAnyAnalyst`, `requireL1Only`) that read `x-user-role` from the request header. Missing/unknown role → 401/403.
- `frontend/src/api/client.js` axios interceptor stamps `x-user-role`, `x-user-id`, `x-user-name` headers from `localStorage.aml_shield_user` on every request.
- `frontend/src/components/ProtectedRoute.jsx` gates routes by allowedRoles, redirects to /login if no localStorage user.
- 11 demo users are seeded in `user_profiles` with credentials applied via `migrate.js`.

**What is missing:**
- **No password hashing** — plaintext compare. `bcrypt`, `argon2`, etc. are not present.
- **No JWT, no session token** — server has no signed credential to verify the user. The `x-user-role` header is set client-side from localStorage and fully spoofable. A motivated user can call any endpoint as "compliance_manager" by editing one localStorage key.
- No SAML, no OIDC, no Entra ID integration. No `passport`, `@azure/msal`, or `openid-client` dependencies.
- No API-key management, no API-key tables.
- No server-side session enforcement (no Redis session store, no DB session table). Logout is a no-op.
- No MFA, no SCIM provisioning, no entitlement matrix beyond the four hardcoded role groups.
- No password policy, no rotation, no lockout.

**Effort to close:** **Medium (weeks)** for OIDC + Entra integration replacing the demo flow (using `openid-client` + Azure AD app registration). **Large (months)** for full enterprise IAM with SCIM, fine-grained entitlements, MFA, audit of access changes, and break-glass workflows.

---

## 6. Stronger evidence-grade audit identity

**Status:** ⚠️ Partially exists

**What exists:**
- `audit_trail` table at `backend/database/schema.sql:163`:
  ```
  id           SERIAL PRIMARY KEY
  entity_type  TEXT             -- 'alert' | 'sar' | 'kyc_review' | 'case'
  sar_id       TEXT NOT NULL    -- polymorphic natural id of the entity
  action       TEXT NOT NULL
  performed_by TEXT             -- free-text name string
  timestamp    TEXT NOT NULL DEFAULT TO_CHAR(NOW() ...)
  details      TEXT
  ```
- Indexes: `idx_audit_sar` on `sar_id`, `idx_audit_entity` on `(entity_type, sar_id)`.
- `backend/utils/audit.js` exports `logAudit({entity_type, entity_id, action, performed_by, details, client})`. Called from alerts.js, sarFilings.js, l2.js, kycReviews.js, sarApprovals.js, caseDocuments.js, documents.js, ofac.js, cases.js (creation only).
- Audit covers all major entity types: ✅ alerts, ✅ SARs, ✅ KYC reviews, ✅ L2 cases, ✅ documents up/download/delete. ⚠️ Cases are audited on creation but case status changes go to alerts (correct intent: alerts are the polymorphic root).

**What is missing:**
- **`performed_by` is a free-text name string**, not a verified user identity. The string comes from the `x-user-name` header (spoofable, see Capability #5) or a body field. There is no FK to `user_profiles.id`, no signature, no token witness.
- **Audit rows are mutable** — the table has no `BEFORE UPDATE` or `BEFORE DELETE` trigger, no REVOKE on UPDATE/DELETE for the app role, no constraint preventing modification. Anyone with DB write access (including the app's own service-role connection) can edit history.
- **No cryptographic chaining** — no `previous_hash` / `entry_hash` columns, no Merkle tree, no anchoring to an external ledger.
- **No tamper-detection** — no scheduled job comparing row counts or hashes against a snapshot.
- No WORM (write-once-read-many) storage for audit.
- No audit retention policy / archival.
- No segregation-of-duties: app's database role can both write and modify the audit table.

**Effort to close:** **Medium (weeks)** for the foundational hardening:
1. Add `performed_by_user_id INTEGER REFERENCES user_profiles(id)` and resolve it server-side from the verified session (depends on Capability #5 being upgraded first).
2. PostgreSQL trigger `BEFORE UPDATE OR DELETE ... RAISE EXCEPTION` to make rows immutable from SQL.
3. REVOKE UPDATE, DELETE on `audit_trail` from the app role; create a separate audit-admin role for retention sweeps.
4. Add `prev_hash`, `entry_hash` columns and a hash-chain trigger on insert.
**Large (months)** for full evidence-grade with external anchor (e.g. Azure Confidential Ledger, AWS QLDB, or notary service).

---

## 7. Configurable workflow designer

**Status:** ❌ Not built

**What exists:**
- Settings page configures only static defaults: SLA days per priority, warning thresholds, retention years, mandatory fields. No flow logic, no routing rules, no conditional steps.
- Routing happens in code paths only:
  - L1 → L2 escalation: hardcoded in `InvestigationWorkspace.jsx` finishEscalateL2 → `POST /api/l2`.
  - L2 → SAR escalation: hardcoded in `L2InvestigationWorkspace.jsx` → `PATCH /l2/:id/escalate-sar`.
  - SAR approval: hardcoded dual-approval check via `manager_settings.sar.dual_approval_required` boolean.
- Manager assigns alerts manually (single or bulk) via `PATCH /api/alerts/:id/assign` or `/bulk-assign`. There is no auto-assignment rule based on workload, expertise, or priority.

**What is missing:**
- No drag-and-drop workflow canvas. No `reactflow`, `react-flow-renderer`, `xyflow` or similar in dependencies.
- No conditional branching configuration (e.g. "if scenario=Structuring AND amount>$50k → auto-route to L2").
- No SLA-based escalation rules ("if 24h before due AND status=Not Started → reassign to floor manager").
- No round-robin or skill-based assignment.
- No workflow versioning, no test/preview, no rollback.

**Effort to close:** **Large (months)** — workflow designers are substantial features (canvas UI, JSON-DSL, runtime executor, version control, simulation). Typically 2–4 quarters for a real one. A simpler "if-this-then-that" rule editor is achievable in **medium (weeks)** but is not what enterprise customers usually mean by "workflow designer".

---

## 8. Production-scale resiliency and controls

**Status:** ⚠️ Partially exists

**What exists:**
- ✅ **Health endpoint**: `GET /api/health` at `server.js:56` returns `{ok: true, service, time}`.
- ✅ **Connection pooling**: `pg.Pool` in `database/db.js` with `connectionString` and `ssl: {rejectUnauthorized: false}`. Default pool size (10). Pool error handler logs but does not crash.
- ✅ **Background jobs survive errors**: all three jobs (`slaMonitor`, `kycReviewMonitor`, `ofacSync`) wrap their main loop in try/catch and log without throwing past the `setInterval` boundary.
- ✅ **Express error middleware**: `server.js:81` catches unhandled route errors and returns 500.
- ✅ **OFAC download failure isolation**: `ofacDownloader.js` records failures to `ofac_download_log` and never crashes the server.
- ✅ Railway provides platform-level auto-restart on container crash and TLS termination.
- ✅ CORS is configured for known origins (Vercel + localhost).

**What is missing:**
- ❌ **No rate limiting** — no `express-rate-limit`, no `express-slow-down`, no nginx in the stack. `/api/auth/login` is unprotected against brute-force.
- ❌ **No circuit breaker** — no `opossum` or equivalent. If Supabase pooler stalls, requests pile up.
- ❌ **No retry / exponential backoff** on failed DB calls. Transient errors (Supabase connection drop, pooler restart) bubble straight to 500.
- ❌ **No caching layer** — no Redis, no `node-cache`, no in-memory LRU. Hot endpoints (`GET /api/dashboard/...`, `GET /api/customers/...`) hit Postgres on every call.
- ❌ **No graceful shutdown** — no `SIGTERM` handler. On Railway redeploy, in-flight requests are dropped.
- ❌ **No request queuing** — Express handles requests serially per connection.
- ❌ **No load balancer config** beyond what Railway provides automatically.
- ❌ **No background-job state persistence** — if `ofacSync.js` crashes mid-download, the partial state is in `ofac_download_log` but no resume logic.
- ❌ **No connection pool tuning** in code (defaults only). Supabase pooler in transaction mode has known prepared-statement caveats not addressed in `db.js`.
- ❌ **No structured observability** — only `morgan('dev')` request logs. No metrics, no traces, no APM (DataDog, New Relic, Sentry).

**Effort to close:** **Medium (weeks)** for the high-impact basics:
1. `express-rate-limit` on auth + bulk endpoints.
2. SIGTERM handler + `server.close()` + `pool.end()` for graceful shutdown.
3. `node-cache` or Redis for read-heavy endpoints.
4. Sentry or equivalent for error tracking.
5. Tune `pg.Pool` for the Supabase pooler (max, idleTimeoutMillis, statement_timeout).

**Large (months)** for fully production-grade with horizontal scaling, zero-downtime deploys, multi-region, observability stack, chaos testing.

---

## Summary of gaps and prioritization

If the goal is to move this build toward a true enterprise AML platform, the
sequence with the best risk/reward is:

| Priority | Capability | Why first |
|---|---|---|
| 1 | **#5 IAM upgrade (OIDC + Entra)** | Unblocks #6 (verified audit identity) and gates everything else from a security perspective. Medium effort, high impact. |
| 2 | **#6 Audit immutability + identity binding** | Cheap once #5 is in place; turns the existing `audit_trail` from advisory to defensible. |
| 3 | **#8 Resiliency basics** | Rate limit, graceful shutdown, error tracking. Low effort, immediate production-readiness wins. |
| 4 | **#1 Real ingestion** | Blocks every customer pilot — there's no story for getting alerts in from a real TM today. |
| 5 | **#4 Feed reconciliation** | Pairs naturally with #1; do them together. |
| 6 | **#2 Rules/scenario management** | Largest scope; the "AML platform" headline feature. |
| 7 | **#7 Workflow designer** | Differentiator, but customers will tolerate hardcoded routing initially. |
| 8 | **#3 Model governance** | Only relevant once there are actual models — likely after #2 produces detection logic. |

Items 1–3 are achievable in **a single quarter** by a small team and would
move the platform from "demo" to "deployable in a controlled pilot".
Items 4–8 are multi-quarter platform investments.
