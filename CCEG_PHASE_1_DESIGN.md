# CCEG Phase 1 — Design Note + Deviations + Open Decisions

**Source spec:** `CroweARC_CCEG_Feature_Spec_v1.0.pdf` (Cross-Case Entity Graph, v1.0, May 2026)
**This PR implements:** the Postgres half of Phase 1 — the three CCEG tables, a Node.js helper that exercises them, a smoke script. Nothing else. Kafka, Neo4j, the FastAPI graph API, the Sigma.js explorer, the spaCy NER pipeline, and the risk scorer are all out of scope and **none are starts I'm sneaking in unfinished**.

This document exists so a reviewer can answer three questions in five minutes:

1. What did this PR build, exactly?
2. Where does it deviate from the spec, and why?
3. What architectural questions block Phase 2, and who owns the decision?

---

## 1. Scope of this PR

**Built**

- `aml-shield/backend/database/cceg_schema.sql` — three new tables: `entity_golden_registry`, `entity_identifiers`, `dedup_decisions`. Exactly the columns from spec §4.4, with a few honest deviations (Section 2 below).
- `aml-shield/backend/database/migrate.js` — applies the CCEG schema after the base schema. Idempotent.
- `aml-shield/backend/utils/goldenRegistry.js` — Node.js helper for the deterministic find-or-create path. Hard-identifier match only; multi-signal fuzzy matching is Phase 2 (spec §5.3). All inserts run inside a transaction so a partial failure can't leave the registry inconsistent.
- `aml-shield/backend/scripts/cceg-smoke.js` — six assertions exercising the helper end-to-end. Run with `DATABASE_URL=… node scripts/cceg-smoke.js`. Cleans up after itself.

**Explicitly NOT built (deferred — see §3)**

- Kafka event bus + Avro schema registry
- Neo4j provisioning, tenant database separation, Cypher write paths
- Entity extractor (NLP)
- Graph writer (Neo4j upserts)
- Graph API (FastAPI / GraphQL / 9 REST endpoints)
- Entity intelligence panel (UI)
- Graph explorer (Sigma.js)
- Risk scorer (batch job)
- Multi-signal deduplicator (phonetic / edit distance / structural)
- Tenant isolation enforcement (CroweARC is single-tenant today — see §3.3)

---

## 2. Deviations from spec

### 2.1 Storage — Postgres only for Phase 1

**Spec:** §5.1 specifies Neo4j 5.x Enterprise for the graph database, with one logical database per tenant. The Cypher patterns in §5.4 are written against Neo4j.

**This PR:** PostgreSQL only. The CCEG registry tables live alongside the existing `customers`, `cases`, and `sar_filings` tables in the same Supabase database.

**Why:** CroweARC's current production stack is a single PostgreSQL database (Supabase) plus Express + React. Standing up Neo4j Aura — or any other managed Neo4j — is an infrastructure decision that affects:
- Production cost (Neo4j Aura starts ~$65/mo for the smallest tier; per-tenant DBs multiply it)
- Operational footprint (a second datastore to back up, monitor, secure)
- Local dev environment (developers would need Docker Compose with Neo4j running)
- Deployment topology (currently single-process on Railway/Vercel)

That decision needs engineering leadership sign-off before code lands. **This PR ships the canonical-identity layer in Postgres** — which is required either way — and defers the graph store choice to Phase 2 kickoff.

**What this means for Phase 2:** Either (a) Neo4j gets provisioned and `goldenRegistry` becomes the source-of-truth for golden_ids that Neo4j references, or (b) we keep everything in Postgres and use recursive CTEs for traversal. See §3.1 for the open question.

### 2.2 `decision` column relaxed from VARCHAR(10) to VARCHAR(20)

**Spec:** §4.4 sample `dedup_decisions` table uses `decision VARCHAR(10)`.

**This PR:** `VARCHAR(20)` with a CHECK constraint pinning the set.

**Why:** The spec's prose lists `AUTO_MERGE | ANALYST_MERGE | REJECTED`. The longest of those (`ANALYST_MERGE`) is 13 characters. VARCHAR(10) would reject every value the column is meant to hold — it's a typo in the spec.

### 2.3 `decision` enum includes `NEW_ENTITY` and `PENDING_REVIEW`

**Spec:** §5.3 audit requirement: *"Every merge decision — automatic or manual — is logged in dedup_decisions with the full signal breakdown."*

**This PR:** The CHECK includes `AUTO_MERGE`, `ANALYST_MERGE`, `REJECTED`, plus `NEW_ENTITY` and `PENDING_REVIEW`.

**Why:** A "no match found, create a new entity" event is also a decision the audit log needs to reproduce. Without `NEW_ENTITY` in the enum, the dedup_decisions table can only describe merges and rejections — not the most common case (a never-before-seen identifier). `PENDING_REVIEW` mirrors the §5.3 threshold logic (score 0.70–0.94) so the analyst review queue has a state to live in until the analyst resolves it.

### 2.4 `entity_type` CHECK constraint

**Spec:** §4.4 specifies `entity_type VARCHAR(20) NOT NULL` and lists `PERSON | COMPANY | ACCOUNT` in the comment.

**This PR:** Same column, plus an explicit CHECK constraint pinning the enum.

**Why:** Same reasoning as the BSA Officer role taxonomy work earlier this week — typos and out-of-taxonomy strings need to be rejected at the DB layer, not silently accepted.

### 2.5 `entity_identifiers.golden_id` is `NOT NULL` and `ON DELETE CASCADE`

**Spec:** §4.4 has `golden_id UUID REFERENCES entity_golden_registry(golden_id)` with no NOT NULL or cascade behaviour stated.

**This PR:** `NOT NULL`, `ON DELETE CASCADE`.

**Why:** An identifier row without a golden_id is malformed by construction — the whole point is the relationship. ON DELETE CASCADE matches the spec's GDPR right-to-erasure flow (§4.1): deleting an entity should clean up its identifiers, not leave orphans.

### 2.6 `id_value_enc` encryption sourcing

**Spec:** §4.4 says `id_value_enc BYTEA NOT NULL -- AES-256 encrypted value` but doesn't specify the encryption mechanism.

**This PR:** Uses `pgcrypto.pgp_sym_encrypt` with a key from the `CCEG_ENCRYPTION_KEY` env var. A dev-only fallback key is accepted when `NODE_ENV !== 'production'` so the smoke script runs out of the box; production deploys without the env var fail closed.

**Why:** Symmetric encryption inside the database is the minimum bar. Field-level KMS-managed envelope encryption (e.g. via Supabase Vault) is a step up and tracked under §3.5.

### 2.7 Timestamp column type

**Spec:** TIMESTAMPTZ.

**This PR:** TIMESTAMPTZ.

**Existing codebase pattern:** The rest of the CroweARC schema uses `TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')` — a formatted string. That's a pattern this codebase already pays the price of in several places (sortable lexically only because of the format, brittle for date math, no timezone safety).

**Why no carry-over:** The spec says TIMESTAMPTZ and it's correct. CCEG tables intentionally use TIMESTAMPTZ; we're not propagating the legacy TEXT-string pattern into the new layer. The existing tables aren't being changed.

---

## 3. Open architectural decisions — block Phase 2 kickoff

These are decisions the spec assumes but doesn't make. Phase 2 cannot start until each has an owner and a resolution. **I am not going to silently pick one.**

### 3.1 Graph store: Neo4j or Postgres recursive CTEs?

**The choice:**
- **Option A — Neo4j (spec position).** Provision Neo4j Aura, one logical DB per tenant, Cypher write paths in a new Python service. Cost: ~$65/mo per tier × tenants, plus operational surface.
- **Option B — Postgres + recursive CTEs.** Keep all CCEG storage in the existing database; implement neighbourhood traversal as parameterised recursive CTEs. Cost: no new infra; lower ceiling on graph size (millions of edges is fine; tens of millions starts to hurt).

**Why it matters:** Phase 2's graph writer is the wrong shape for one if we picked the other. The Cypher patterns in spec §5.4 don't translate 1:1 to SQL; the SQL recursive CTE shape doesn't translate 1:1 to Cypher. We must commit before writing the graph writer.

**My recommendation if pressed:** **Option B for V1.** The single-tenant demo doesn't need Neo4j's scale, the operational complexity is real, and the recursive-CTE path lets the rest of CroweARC use one database. Migrate to Neo4j later if and when scale demands it. But this is a leadership call, not mine.

**Owner:** Engineering leadership.

### 3.2 Event bus: Kafka or in-process dispatch?

**The choice:**
- **Option A — Kafka (spec position).** Provision Confluent Cloud / Redpanda / similar. New consumer process. Avro schemas registered. ~$50–100/mo for a small dev tier.
- **Option B — In-process synchronous dispatch.** Existing CroweARC routes call a `cceg.recordEntity()` helper inline after a successful DB write. Same process. Same Postgres transaction (or near it). No new infra.
- **Option C — Postgres LISTEN/NOTIFY.** A poor man's event bus using Postgres's pub/sub. Free, single-process, but limited replay and no exactly-once.

**Why it matters:** Spec §5.2 says case operations *"must never block on graph updates."* Option A satisfies that strictly. Option B doesn't — but if graph updates are fast and idempotent, blocking is fine in practice and recoverable. Option C is in between.

**My recommendation if pressed:** **Option B for V1.** Existing CroweARC routes already do background work (logAudit, notifications) inline. The graph writer is a few INSERT statements; inline is fine. Promote to Kafka when we have a real second consumer (e.g. an analytics pipeline). But this is a sequencing call.

**Owner:** Engineering leadership.

### 3.3 Tenant isolation: now or later?

**Spec:** §8.2 marks multi-tenancy isolation a "critical requirement" — separate Neo4j databases per tenant, never property-based filtering.

**Reality:** CroweARC is single-tenant today. Per the audit reports earlier in this codebase (`CROWE_ARC_AUDIT_REPORT.md` §M-5), multi-tenancy is "out of scope for the foreseeable future." Adding tenant isolation infrastructure for a feature in a single-tenant product is premature optimisation.

**This PR's posture:** The helper takes a `tenant_id` parameter shape ready to be added in the same signature change, but doesn't enforce it. The CCEG tables don't yet have a `tenant_id` column.

**Decision needed:** Do we add `tenant_id` columns + an `institutions` table now (cheap insurance, ~half-day's work) or wait until the multi-tenant decision is actually made (cheaper now, expensive later)?

**My recommendation:** Add `tenant_id NOT NULL DEFAULT 'fnb_us'` on every CCEG table in Phase 2. Single-tenant deployments default to a constant; the schema is ready when the business case for multi-tenancy lands. But this is a strategy call.

**Owner:** Product + engineering jointly.

### 3.4 Where do `cases` and `sar_filings` join the graph?

**Spec:** §4.2 lists `Case` and `SAR` as graph node types — they're nodes in the entity graph, not just storage tables. CroweARC already has `cases` and `sar_filings` tables.

**Decision needed:** Are the existing tables the source of truth (CCEG references them by `case_id` / `sar_id`), or do we mirror their state into the graph (CCEG owns its own Case / SAR node table)?

**My recommendation:** Reference, don't mirror. Adds latency on every read but keeps a single source of truth and avoids sync bugs. Phase 2 graph writer joins `entity_golden_registry` to the existing `cases` and `sar_filings` tables.

**Owner:** Tech lead.

### 3.5 KMS-managed encryption for `id_value_enc`?

**This PR:** Symmetric `pgp_sym_encrypt` with an env-var key.

**Better posture:** Envelope encryption — a per-row data key wrapped by a master key held in KMS (AWS KMS / Supabase Vault / GCP KMS). The DB never sees the master key; rotation is online; an analyst with read access to `entity_identifiers` can't decrypt without also having KMS Decrypt permission.

**Decision needed:** When does CCEG cross the "real PII at rest" line, and what's the encryption posture at that line?

**Owner:** CISO + engineering leadership.

### 3.6 Audit-trail tamper resistance

**Spec:** §5.3 — *"Every merge decision is logged in `dedup_decisions` … this log is immutable and is available for regulatory examination."*

**This PR:** Append-only by convention. No DB-level enforcement (no triggers blocking UPDATE/DELETE; no hash chain; no signed entries).

**Why deferred:** Same problem CroweARC's main `audit_trail` table has (per the earlier audit report). Solving it once for both tables is the right move — it's a Phase 2+ item that benefits more than just CCEG.

**Owner:** Tech lead.

---

## 4. Verification

After applying this PR:

```bash
# Backend → run the migration
cd aml-shield/backend
DATABASE_URL=postgres://… npm run migrate

# Expected log lines:
#   Schema applied
#   Credentials applied to N/11 users
#   Role-taxonomy CHECK constraint applied
#   ... (other migration steps) ...
#   CCEG Phase 1 schema applied
#   Migration successful

# Then → run the smoke script
DATABASE_URL=postgres://… node scripts/cceg-smoke.js

# Expected:
#   ✓ first call returns created=true
#   ✓ second call returns created=true
#   ✓ distinct passports yield distinct golden_ids
#   ✓ re-submit returns created=false
#   ✓ re-submit returns the same golden_id
#   ✓ two NEW_ENTITY rows (one per distinct passport)
#   ✓ one AUTO_MERGE row for the re-submit
#   ✓ decrypted value matches original (X1234567)
#   ✓ findEntityByIdentifier returns the correct golden_id
#   ✓ duplicate (id_type, id_value_hash) is rejected
#   ✓ smoke rows removed
#   CCEG Phase 1 smoke — PASS
```

If any assertion fails, the script exits non-zero and prints which assertion broke. The smoke run is idempotent — re-running cleans up its own rows before re-asserting.

---

## 5. What Phase 2 looks like, contingent on §3 decisions

Phase 2 in the spec is "Pipeline MVP" — the entity extractor, hard-identifier deduplicator, graph writer. Under the recommendations above (Postgres-native, in-process dispatch), the Phase 2 shopping list becomes:

1. **`cceg.recordEntity(client, …)` helper** — called inline from `routes/alerts.js`, `routes/cases.js`, `routes/sarFilings.js` whenever an entity is attached to a case. Writes `entity_golden_registry` and `entity_identifiers` (already done in this PR) **plus** a new `entity_case_appearances` table that mirrors the spec's `APPEARS_IN` edge.
2. **`entity_case_appearances` table** — many-to-many bridge between `entity_golden_registry` and the existing `cases` table. Columns: `golden_id`, `case_id`, `role`, `added_by`, `added_at`, `source`, `confidence`.
3. **`entity_relationships` table** — pairwise edges (CONTROLS, TRANSACTS_WITH, CO_DIRECTOR, etc). Columns: `from_golden_id`, `to_golden_id`, `rel_type`, properties JSONB, `computed` boolean.
4. **Recursive CTE traversal** — the Cypher 2-degree neighbourhood query in spec §5.4 becomes a `WITH RECURSIVE` query against `entity_relationships` and `entity_case_appearances`.
5. **An integration test** that walks the same end-to-end shape as the spec's *"entity added → node in graph → dedup decision logged"* assertion, but in Postgres.

Phase 2 cannot start until §3.1 and §3.2 are resolved.

---

## 6. Maintenance pointer

This document and the PR are pinned to spec v1.0. If the spec moves (new node types, changed edge cardinalities, additional decision states), update Section 2 to track new deviations and Section 3 to track new open decisions. Don't silently edit the schema to match a new spec version — the audit trail of "what we deviated from, and why" is the load-bearing part.
