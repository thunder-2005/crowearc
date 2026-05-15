-- ═══════════════════════════════════════════════════════════════════════════
-- Cross-Case Entity Graph (CCEG) — Phase 1 schema
--
-- Source spec: CroweARC_CCEG_Feature_Spec_v1.0 §4.4
--
-- Tables in this file underpin the CCEG's "golden identity" layer — the
-- canonical-entity surface that the dedup pipeline writes into and that
-- every other Phase (graph writer, API, UI) reads from.
--
-- Deviations from spec (full list in CCEG_PHASE_1_DESIGN.md):
--   * Storage stays in PostgreSQL only. The spec calls for Neo4j for the
--     topology layer; that decision is deferred until the architectural
--     review (see CCEG_PHASE_1_DESIGN.md §3 "Open architectural decisions").
--   * `decision` column relaxed from VARCHAR(10) to VARCHAR(20) — the spec
--     table sample lists 'AUTO_MERGE | ANALYST_MERGE | REJECTED' but
--     ANALYST_MERGE is 13 chars and we also need PENDING_REVIEW / NEW_ENTITY,
--     so VARCHAR(10) is impossible.
--   * `decision` CHECK constraint includes NEW_ENTITY and PENDING_REVIEW
--     in addition to the three merge outcomes. The audit requirement in
--     §5.3 says every merge decision is logged — NEW_ENTITY (no match
--     found) is a decision, and PENDING_REVIEW is a transient state we
--     write before the analyst resolves it.
--   * `pgcrypto` extension required for sha256() and (eventually) for
--     pgp_sym_encrypt of id_value_enc. Encryption itself is wired in the
--     goldenRegistry helper, not at the DDL layer.
--
-- This file is applied by backend/database/migrate.js immediately after
-- the base schema.sql. CREATE TABLE IF NOT EXISTS makes it safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── entity_golden_registry ────────────────────────────────────────────────
-- One row per canonical entity. The golden_id is the surrogate key that
-- every other CCEG table joins on. `canonical_name` is display-only — the
-- regulated PII (full name, DOB, address) lives in the existing customers
-- and counterparties tables; the registry holds the bridge.
CREATE TABLE IF NOT EXISTS entity_golden_registry (
  golden_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type      VARCHAR(20) NOT NULL,
  canonical_name   TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT entity_golden_registry_type_check
    CHECK (entity_type IN ('PERSON', 'COMPANY', 'ACCOUNT'))
);

CREATE INDEX IF NOT EXISTS idx_entity_golden_registry_type
  ON entity_golden_registry(entity_type);

-- ── entity_identifiers ────────────────────────────────────────────────────
-- A many-to-one row per identifier-an-entity-carries (passport, IBAN, CRN,
-- LEI, etc). UNIQUE(id_type, id_value_hash) is the spec's deterministic-
-- merge primitive: trying to insert the same identifier twice resolves to
-- a hard-identifier match and routes to the dedup decision logger.
CREATE TABLE IF NOT EXISTS entity_identifiers (
  id              BIGSERIAL PRIMARY KEY,
  golden_id       UUID NOT NULL REFERENCES entity_golden_registry(golden_id)
                       ON DELETE CASCADE,
  id_type         VARCHAR(30) NOT NULL,
  id_value_hash   VARCHAR(64) NOT NULL,
  id_value_enc    BYTEA NOT NULL,
  source          VARCHAR(30),
  confidence      NUMERIC(4, 3),
  added_by        UUID,
  added_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT entity_identifiers_source_check
    CHECK (source IS NULL OR source IN ('manual', 'extracted', 'imported')),
  CONSTRAINT entity_identifiers_unique_hash
    UNIQUE (id_type, id_value_hash)
);

CREATE INDEX IF NOT EXISTS idx_entity_identifiers_golden
  ON entity_identifiers(golden_id);
CREATE INDEX IF NOT EXISTS idx_entity_identifiers_type_hash
  ON entity_identifiers(id_type, id_value_hash);

-- ── dedup_decisions ───────────────────────────────────────────────────────
-- Audit log of every dedup outcome. The pipeline writes a row for each
-- candidate processed regardless of the decision (NEW_ENTITY too, so the
-- log is the complete history of entity creation). This table is
-- expected to be append-only — INSERT only. The hash-chain / immutable
-- enforcement is Phase 2+ work (tracked under CCEG_PHASE_1_DESIGN.md
-- §3 "Audit trail tamper resistance").
CREATE TABLE IF NOT EXISTS dedup_decisions (
  id                BIGSERIAL PRIMARY KEY,
  candidate_id      UUID,
  matched_to        UUID,
  decision          VARCHAR(20) NOT NULL,
  confidence_score  NUMERIC(4, 3),
  signals           JSONB,
  decided_by        UUID,
  decided_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT dedup_decisions_decision_check
    CHECK (decision IN (
      'AUTO_MERGE',
      'ANALYST_MERGE',
      'REJECTED',
      'NEW_ENTITY',
      'PENDING_REVIEW'
    ))
);

CREATE INDEX IF NOT EXISTS idx_dedup_decisions_matched_to
  ON dedup_decisions(matched_to);
CREATE INDEX IF NOT EXISTS idx_dedup_decisions_decided_at
  ON dedup_decisions(decided_at DESC);
