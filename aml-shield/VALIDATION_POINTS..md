# Crowe ARC — Validation Points

Read-only assessment against five regulator-grade checks. No code, data, or configuration was changed.

**Scope:** static review of `backend/`, `frontend/`, and live Supabase data as of this audit.

---

## Summary table

| # | Check | Verdict |
|---|---|---|
| 1 | L2 risk score has a documented model behind it | **Partial** — UI is transparent, but documentation, governance, and predictivity validation are missing |
| 2 | Case notes are append-only | **Partial** — L1 + L2 notes are append-only by API contract; KYC review findings are overwritten on every save |
| 3 | KYC review triggers cover the full real-world set | **Gap** — 3 of the 10 expected triggers are implemented |
| 4 | "Linked cases" tells the analyst why two cases are linked | **Gap** — the analyst-facing Linked Cases tab shows only same-customer history with no relationship typing |
| 5 | Scenario coverage extends beyond the current six | **Partial** — analytics schema is open-ended, but live data, scenario registry, and Settings UI are locked at six |

---

## 1. L2 risk score has a documented model behind it

**Verdict: Partial.** The UI is transparent enough that an analyst can see the per-factor contribution, but the model behind the number does not satisfy SR 11-7 expectations.

### What works

- **The 10 factors are visible to the user.** Each factor in the L2 "Deep Analysis" tab renders as a labeled checkbox with its weight (`+10` per factor), and the running total is shown live in a colour-coded band ([L2InvestigationWorkspace.jsx:35-46](aml-shield/frontend/src/components/investigation/L2InvestigationWorkspace.jsx#L35-L46), [L2InvestigationWorkspace.jsx:556-572](aml-shield/frontend/src/components/investigation/L2InvestigationWorkspace.jsx#L556-L572)).
- **Per-factor contribution is exposed**, not just the total. An analyst (or examiner) can see exactly which boxes were ticked to produce the score.
- **Score is persisted** with the list of ticked factors as a JSON array on `l2_cases.risk_factors` — i.e. the score is auditable after the fact.

### What's missing

- **No written model definition.** Each of the 10 factors has only a one-line UI label (e.g., "PEP connection"). There is no separate document — in the repo or anywhere referenced from it — describing:
  - What that factor *means* operationally (when should it be ticked?)
  - What source data the analyst is expected to consult
  - Why the weight is `10` for that specific factor
  - How the 0–30 / 31–60 / 61–80 / 81–100 bands map to recommended next steps
  - The factor list lives only in `RISK_FACTORS` in [L2InvestigationWorkspace.jsx:35](aml-shield/frontend/src/components/investigation/L2InvestigationWorkspace.jsx#L35), and the only markdown reference to the score is a one-paragraph summary in `CROWE_ARC_PROJECT_BRIEF.md` (no factor definitions).
- **All weights are flat (10 each).** `RISK_FACTOR_WEIGHT = 10` ([L2InvestigationWorkspace.jsx:34](aml-shield/frontend/src/components/investigation/L2InvestigationWorkspace.jsx#L34)). There is no differential weighting (e.g., "watchlist match should weigh more than PEP exposure"), no calibration history, and no rationale captured for the equal-weight choice.
- **A factor or weight change is a one-line code edit.** No approval workflow, no `model_versions` table, no audit log row when the configuration changes. Compare to `scenario_versions` (which captures `effective_from`, `effective_to`, `created_by`, `approved_by`, `justification`) — no equivalent table exists for the risk-scoring model.
- **No predictivity check.** Nothing in `analytics.js` correlates `l2_cases.risk_score` against actual SAR outcomes. The "Rule Effectiveness" tab does this for monitoring scenarios but not for the L2 scoring model.

### Specific check-by-check

| Check | Status | Evidence |
|---|---|---|
| Each factor has a one-line definition + source data + weight written down outside the code | **Fail** | Only the UI label is documented. No `MODEL_CARD.md` or equivalent. |
| Case view shows per-factor contribution | **Pass** | Visible as a checkbox grid with `+10` weight tags. |
| Factor / weight change requires logged approval | **Fail** | Constant in source; PR → deploy is the only gate. |
| Team can answer "does a high score correlate with SAR conversion?" using historical data | **Fail** | No analytics route correlates `l2_cases.risk_score` with downstream SAR filings. |

### Recommendation

Add a model card document (kept in the repo so it ships with the code) and a `model_versions` table mirroring `scenario_versions`. Define per-factor source-data expectations and the weighting justification. Add an analytics endpoint `GET /api/analytics/l2-score-correlation` that computes the score-vs-SAR-conversion curve from historical L2 cases. None of these require touching the live score UI.

---

## 2. Case notes are append-only

**Verdict: Partial.** L1 case notes and L2 notes are effectively append-only because the backend exposes only `GET` and `POST`. KYC review findings, however, are stored in a single overwritable column and are *not* append-only.

### What works

- **`/api/case-notes` is GET + POST only** ([caseNotes.js](aml-shield/backend/routes/caseNotes.js)). There is no `PATCH /:id`, no `DELETE /:id`, and the `case_notes` table has no `is_active` or `superseded_by` column — so by API contract the original content cannot be edited or removed. A note is also written to `audit_trail` on insert with a 50-char preview ([caseNotes.js:20-24](aml-shield/backend/routes/caseNotes.js#L20-L24)).
- **L2 notes follow the same pattern.** `GET /api/l2/:id/notes` and `POST /api/l2/:id/notes` ([l2.js:255-278](aml-shield/backend/routes/l2.js#L255-L278)) only. No update or delete route exists.
- **L1 disposition + escalation decisions are audited** with the actor and timestamp via `logAudit({ entity_type: 'alert', ... })` — see `backend/utils/audit.js`. The `audit_trail` row preserves the action taken at the time.

### What's missing

- **No formal supersede mechanism.** "Append-only by absence of an edit endpoint" is fragile. The `case_notes` table has columns `id, alert_id, note_text, analyst, timestamp` — there is no `supersedes_id`, no `superseded_by`, no `superseded_at`, and no `superseded_reason`. If a future PR adds an edit route or a manual SQL `UPDATE` is run, the record changes silently with no link back to the original.
- **A correction or follow-up has no structural relationship to the original note.** "Update at 14:32: per customer call we learned X…" is a free convention an analyst could follow, but the system doesn't enforce or surface that linkage. The UI shows a flat list ordered by timestamp.
- **KYC review findings ARE overwritten.** This is the substantive gap. `kyc_reviews.review_findings` is a single TEXT column. The `PATCH /api/kyc-reviews/:id/save` route ([kycReviews.js:352-372](aml-shield/backend/routes/kycReviews.js#L352-L372)) issues `UPDATE kyc_reviews SET review_findings = COALESCE($2, review_findings) …`. Every save replaces the prior version. There is no `kyc_review_findings` history table. If an analyst writes "no issues observed" at 10:00 and replaces it with "exit recommended due to material change" at 14:00, the 10:00 statement is lost.

### Specific check-by-check

| Check | Status | Evidence |
|---|---|---|
| Once saved, the original cannot be changed or removed (L1 notes) | **Pass by contract** | No PATCH/DELETE on `/api/case-notes`. No supersede column though — vulnerable to future regression. |
| Same for L2 notes | **Pass by contract** | Same; no edit/delete on `/api/l2/:id/notes`. |
| Editing creates a follow-up entry linked to the original | **Fail** | No `supersedes_id` column; corrections are independent rows. |
| Deleting is a supersede action requiring a reason | **Not applicable** | Deletion is not exposed at all. |
| Applies to L1, L2, and KYC review findings | **Fail on KYC** | `kyc_reviews.review_findings` is overwritten on save and on complete. |

### Recommendation

Add a `supersedes_id`, `superseded_by`, `superseded_at`, `superseded_reason` column set to both `case_notes` and `l2_notes` so future correction flows can be wired without breaking historic immutability. For KYC findings, replace the single `review_findings` column with a `kyc_review_finding_revisions` table keyed by `review_id` so each save creates a new row and the original is retrievable.

---

## 3. KYC review triggers cover the full real-world set

**Verdict: Gap.** Three of the ten expected triggers are implemented. Seven CDD-program-critical triggers are missing.

### What works

The daily `kycReviewMonitor` job ([kycReviewMonitor.js](aml-shield/backend/jobs/kycReviewMonitor.js)) implements three trigger paths plus an "overdue" status escalation:

| Trigger | Mechanism | Source-event tracking |
|---|---|---|
| **Scheduled** by risk-rating interval (Very High 180 d / High 365 d / Medium 730 d / Low 1095 d) | `nextDueDate(customer)` in [kycReviewMonitor.js:15-30](aml-shield/backend/jobs/kycReviewMonitor.js#L15-L30) | `due_date` calculated; no source-event id |
| **Triggered by SAR** filed in last 30 days | [kycReviewMonitor.js:97-123](aml-shield/backend/jobs/kycReviewMonitor.js#L97-L123) | `triggered_by_sar_id` populated — good |
| **Triggered by alert cluster** (3+ alerts in last 90 days) | [kycReviewMonitor.js:125-155](aml-shield/backend/jobs/kycReviewMonitor.js#L125-L155) | `triggered_by_alert_id` populated — good |

Live data confirms: `kyc_reviews.review_type` distinct values today are `scheduled` (4), `triggered_alerts` (2), `triggered_sar` (1), `manual` (1). No other types in the table.

### What's missing

Seven triggers required by typical CDD programs are not implemented:

| Expected trigger | Status | Why it matters |
|---|---|---|
| **Onboarding** — initial CDD when a customer first joins | **Missing** | No code path creates a review on customer insert. New customers never get an initial KYC review event. |
| **Exit / offboarding** — required before a high-risk customer leaves | **Missing** | `customers.exit_status` exists in the schema, but no job fires on transition. |
| **Material change in customer information** (address, employer, business activity, new beneficial owner) | **Missing** | No change-detection job. `customers` updates do not generate any review. |
| **Material change in expected activity** (volume / value spikes vs. expected profile) | **Missing** | `customers.expected_monthly_volume` and `expected_monthly_value` exist; nothing monitors actuals against them. |
| **Adverse media hit** | **Missing** | No adverse-media feed or ingestion route. |
| **PEP status change** | **Missing** | `customers.pep_match` is a static flag; transitions don't trigger anything. |
| **OFAC fuzzy match** (even if later dismissed, the screening event should still prompt a refresh) | **Missing** | `ofac_screening_results` is written to on every screen, but no review is created. `ofacScreener.js` does not trigger a KYC review event. |

### Source-event audit

For the three triggers that *are* implemented, source-event linkage is partially good:

- `triggered_by_sar_id` and `triggered_by_alert_id` are populated where applicable.
- `scheduled` reviews carry no source-event reference — only a `due_date`. The reason for the review (which risk-rating interval, what date that interval was last calibrated) is implicit.

### Recommendation

Add four new jobs / hooks: (1) on `customers` insert → onboarding review, (2) on `customers.exit_status` change to a pending state → exit review, (3) on `ofac_screening_results` insert when match_score ≥ threshold → screening review, (4) a scheduled "material change" diff job that detects address/employer/expected-activity changes vs. the last-reviewed snapshot. The schema already supports source-event tracking — extend the `review_type` enum and add columns like `triggered_by_screening_id`, `triggered_by_change_id`, etc.

---

## 4. "Linked cases" tells the analyst why two cases are linked

**Verdict: Gap.** The analyst-facing Linked Cases tab is hard-coded to one relationship (same customer) and does not surface that fact.

### What works

- The **manager-only Linked Cases Network View** at `/manager/investigations` ([Investigations.jsx](aml-shield/frontend/src/pages/Investigations.jsx)) does expose relationship typing — it has separate "Counterparty Links" and "Beneficial Owner Links" tabs, and each row labels the basis for the link (e.g., the shared counterparty name with FATF country badge). This satisfies several of the checklist's specific checks, but only for the manager surface.

### What's missing

The **analyst-facing** Linked Cases tab inside the investigation workspace is a far weaker view:

- Implementation is hard-coded to **same-customer-only**. `LinkedCasesTab` ([InvestigationWorkspace.jsx:1039-1080](aml-shield/frontend/src/components/investigation/InvestigationWorkspace.jsx#L1039-L1080)) calls only:
  ```
  api.get(`/customers/${alert.customer_id}/alerts`)
  api.get(`/customers/${alert.customer_id}/sars`)
  ```
- The UI renders two flat sections — "Alert History" and "SAR History" — both already implicitly same-customer. There is no label saying *why* each row is here.
- No filter chips, no sub-tabs, no surfacing of relationships beyond the customer key:
  - **No "same counterparty"** linkage shown
  - **No "same beneficial owner"** linkage shown
  - **No "same address or device or IP"** linkage shown
  - **No "same scenario over time"** linkage shown
- L2 has a dedicated `Counterparty Analysis` tab in [L2InvestigationWorkspace.jsx:577](aml-shield/frontend/src/components/investigation/L2InvestigationWorkspace.jsx#L577) and a separate `/api/l2/:id/counterparties` endpoint, but it is parallel to (not shared with) the manager Network View, so the same relationship logic is implemented twice and the analyst's investigation workspace gets none of it.

### Specific check-by-check

| Check | Status | Evidence |
|---|---|---|
| Linked Cases panel exposes type of relationship (customer / counterparty / UBO / address / device / scenario) | **Fail** | Analyst tab is single-relationship (customer) and unlabeled. Manager network view is separate. |
| Each entry shows which relation drove the link | **Fail** | Rows show only alert_id + scenario + status. |
| Analyst can filter to one relationship type at a time | **Fail** | No filter UI. |
| L2 counterparty-analysis reuses these relations | **Fail** | L2 reimplements counterparty logic via a separate route (`/api/l2/:id/counterparties`). |

### Recommendation

Extract the manager `Investigations.jsx` relationship-resolver into a shared module, expose `GET /api/investigations/links?for_alert=<id>` returning rows of shape `{ related_alert_id, relation_type, relation_value }`, and rewrite `LinkedCasesTab` to render filter chips by `relation_type` with each row labelled. The L2 counterparty tab should consume the same endpoint.

---

## 5. Scenario coverage extends beyond the current six

**Verdict: Partial.** The data model and analytics chart are open-ended, but the live data, the scenario registry, and the Settings UI are all locked at six. Adding a seventh scenario today would surface in analytics but would not be configurable in Settings.

### What works (open-ended)

- **`alerts.scenario` is a free `TEXT` column** ([schema.sql:13](aml-shield/backend/database/schema.sql#L13)). The DB does not constrain scenario values.
- **The Rule Effectiveness chart is data-driven.** `GET /api/analytics/rule-effectiveness` does `GROUP BY scenario` over whatever values exist in the alerts table ([analytics.js:466-478](aml-shield/backend/routes/analytics.js#L466-L478)). No hardcoded limit. A 7th, 8th, or 50th scenario value would appear automatically.
- **The frontend chart renders any number of rows** from the API ([Analytics.jsx:684-693](aml-shield/frontend/src/pages/Analytics.jsx#L684-L693)). No hardcoded six-category cap.
- **The `scenario_versions` registry is structurally generic** — `scenario_code` is `TEXT` with `UNIQUE(scenario_code, version_number)`. Nothing prevents loading new scenarios.

### What's missing (locked at six)

- **Live scenario registry contains only six codes.** Confirmed against Supabase: `scenario_versions.scenario_code DISTINCT` = `{CASH_INTENSIVE, HIGH_RISK_COUNTRY, RAPID_MOVEMENT, STRUCTURING, TRADE_BASED_ML, WATCHLIST_HIT}`.
- **Live alerts use only six scenario strings.** Confirmed against Supabase: 1,000 alerts across `Structuring, High Risk Country, Watchlist Hit, Cash Intensive, Rapid Movement, Trade Based ML`. No others.
- **The Settings UI is hard-coded to six.** `SCENARIO_LIST` in [Settings.jsx:21-28](aml-shield/frontend/src/pages/Settings.jsx#L21-L28) is a fixed array. The Scenario Configuration page renders one card per element of this constant; adding a 7th scenario in the database would not produce a 7th configuration card unless the source is changed.
- **`rule_explanation` templates are hard-coded to six.** The dispatch function in [generateRuleExplanations.js](aml-shield/backend/scripts/generateRuleExplanations.js) has a switch over the same six keys; unknown scenarios fall back to a stub. This is acceptable but worth noting.

### None of the listed new-typology scenarios exist in code or data

For each of the nine new typologies the checklist names, the search returned zero matches in either the application code or the seed data:

- Round-number anomaly — not present
- Funnel accounts — not present
- Dormant account reactivation — not present
- Cross-border wires inconsistent with stated business — not present
- Cash deposits inconsistent with income profile — not present
- ATM clustering — not present
- New beneficiary surge — not present
- Pre-exit activity surge — not present
- Same device / same IP across multiple unrelated customers — not present

### Specific check-by-check

| Check | Status | Evidence |
|---|---|---|
| System can ingest, represent, and disposition alerts under a broader scenario list | **Pass (data model only)** | `alerts.scenario` is unconstrained TEXT. |
| Scenario code is a first-class field, version-controlled | **Pass** | `scenario_versions` table exists with `effective_from/to`, `status`, `approved_by`, `justification`. |
| Scenario versions feed analytics | **Partial** | Analytics groups on `alerts.scenario` but does not join to `scenario_versions`. Scenario version is not surfaced in the Rule Effectiveness UI. |
| Rule Effectiveness page renders meaningfully with more scenario codes (no hard-coded six-category limit in the chart logic) | **Pass** | Chart is data-driven via `data.scenarios`. |
| Settings UI handles new scenarios | **Fail** | Hard-coded `SCENARIO_LIST` array. |

### Recommendation

Drive Settings.jsx's Scenario Configuration page from `GET /api/scenarios` (a new route that returns the active scenarios from `scenario_versions`) rather than from a hard-coded constant. Seed at least three of the new typologies (round-number anomaly, funnel account, dormant reactivation) into `scenario_versions` and into a small batch of alerts so the Rule Effectiveness page demonstrates >6 scenarios in practice. Also join the analytics result against `scenario_versions` so each row carries its `version_number` — that's the bridge between the analytics surface and the scenario-governance story.

---

## Overall

Three of the five checks are partial. Two are gaps. The system has good *structural* foundations everywhere — open-ended scenario data model, audit-trail logging, manager Network View — but those foundations are inconsistently exposed to the analyst surface (Linked Cases, KYC findings) and underdocumented (L2 risk model, KYC trigger source-of-event). Closing these gaps does not require rewriting any existing feature; each recommendation builds on what is already there.
