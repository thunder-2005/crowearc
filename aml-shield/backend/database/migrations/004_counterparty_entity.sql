-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 004 — Counterparty as First-Class Entity (C-10 / audit B-7)
--
-- Closes the audit B-7 gap: transactions.counterparty was a free-text string,
-- so "First Capital LLC" and "First Capital, LLC" were two different entities
-- in the CCEG graph. This migration adds:
--
--   1. counterparty_normalised — STORED generated column on transactions;
--      gives GROUP BY queries an immediate dedup primitive without a
--      backfill run (interim "Phase A" fix).
--   2. counterparties           — the first-class entity table.
--   3. counterparty_id FK       — nullable column on transactions, populated
--      by the dedup pipeline; the graph endpoint flips to "Phase B" once
--      this is backfilled.
--   4. counterparty_dedup_queue — pipeline state table tracking which raw
--      strings have been auto-resolved vs need BSA-officer review.
--   5. denormalisation trigger  — keeps counterparties.transaction_count /
--      total_volume / last_seen_at fresh whenever transactions move.
--
-- Idempotent: CREATE TABLE / CREATE INDEX with IF NOT EXISTS; trigger and
-- generated column guarded with explicit existence checks. Safe to re-run.
--
-- Schema reality notes:
--   * transactions has no `counterparty_account` column today, so
--     counterparty_dedup_queue.account_number always starts NULL. The
--     dedup pipeline still supports the "exact account match" tier for
--     future use when ingest paths populate this.
--   * entity_golden_registry uses `golden_id UUID` PK (CCEG Phase 1) —
--     counterparties.golden_registry_id references that column, not `id`.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Step 1: counterparty_normalised on transactions ──────────────────────
-- Generated columns can't be added with IF NOT EXISTS reliably across PG
-- versions when the source column is computed; wrap in a DO block.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'transactions'
       AND column_name = 'counterparty_normalised'
  ) THEN
    ALTER TABLE transactions
      ADD COLUMN counterparty_normalised TEXT
        GENERATED ALWAYS AS (
          lower(
            regexp_replace(
              trim(COALESCE(counterparty, '')),
              '[^a-zA-Z0-9 ]',
              '',
              'g'
            )
          )
        ) STORED;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_transactions_counterparty_normalised
  ON transactions (counterparty_normalised);

-- ── Step 2: counterparties (first-class entity table) ────────────────────
-- Defensive: if an earlier ad-hoc CREATE left a partial table behind,
-- the CREATE TABLE IF NOT EXISTS below silently skips and we'd be stuck
-- with missing columns. Every column is therefore re-applied via ADD
-- COLUMN IF NOT EXISTS afterwards so the migration heals a partial table.
CREATE TABLE IF NOT EXISTS counterparties (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name        TEXT NOT NULL,
  normalised_name       TEXT NOT NULL,
  counterparty_type     TEXT DEFAULT 'unknown',
  account_number        TEXT,
  routing_number        TEXT,
  bank_name             TEXT,
  country_code          CHAR(2),
  risk_indicators       JSONB DEFAULT '{}',
  first_seen_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at          TIMESTAMPTZ,
  transaction_count     INTEGER DEFAULT 0,
  total_volume          NUMERIC(20, 2) DEFAULT 0,
  golden_registry_id    UUID REFERENCES entity_golden_registry(golden_id),
  created_by            TEXT NOT NULL DEFAULT 'dedup_pipeline',
  merge_source_ids      UUID[] DEFAULT '{}',
  is_merged_away        BOOLEAN NOT NULL DEFAULT FALSE,
  merged_into_id        UUID REFERENCES counterparties(id)
);

-- Heal a partial counterparties table — add any missing columns.
ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS canonical_name     TEXT;
ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS normalised_name    TEXT;
ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS counterparty_type  TEXT DEFAULT 'unknown';
ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS account_number     TEXT;
ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS routing_number     TEXT;
ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS bank_name          TEXT;
ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS country_code       CHAR(2);
ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS risk_indicators    JSONB DEFAULT '{}';
ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS first_seen_at      TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS last_seen_at       TIMESTAMPTZ;
ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS transaction_count  INTEGER DEFAULT 0;
ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS total_volume       NUMERIC(20, 2) DEFAULT 0;
ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS golden_registry_id UUID;
ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS created_by         TEXT NOT NULL DEFAULT 'dedup_pipeline';
ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS merge_source_ids   UUID[] DEFAULT '{}';
ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS is_merged_away     BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS merged_into_id     UUID;

ALTER TABLE counterparties DROP CONSTRAINT IF EXISTS counterparties_type_check;
ALTER TABLE counterparties
  ADD CONSTRAINT counterparties_type_check
  CHECK (counterparty_type IN (
    'individual','business','financial_institution','government','unknown'
  ));

-- Unique normalised-name only for live (non-merged-away) rows with no
-- account-number. Account-numbered rows have their own unique key below.
CREATE UNIQUE INDEX IF NOT EXISTS idx_counterparties_normalised_name
  ON counterparties (normalised_name)
  WHERE account_number IS NULL AND is_merged_away = FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_counterparties_account_number
  ON counterparties (account_number)
  WHERE account_number IS NOT NULL AND is_merged_away = FALSE;

CREATE INDEX IF NOT EXISTS idx_counterparties_canonical_name
  ON counterparties (canonical_name);

CREATE INDEX IF NOT EXISTS idx_counterparties_golden_registry
  ON counterparties (golden_registry_id)
  WHERE golden_registry_id IS NOT NULL;

-- ── Step 3: counterparty_id FK on transactions ───────────────────────────
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS counterparty_id UUID REFERENCES counterparties(id);

CREATE INDEX IF NOT EXISTS idx_transactions_counterparty_id
  ON transactions (counterparty_id)
  WHERE counterparty_id IS NOT NULL;

-- ── Step 4: counterparty_dedup_queue ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS counterparty_dedup_queue (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_counterparty         TEXT NOT NULL,
  normalised_name          TEXT NOT NULL,
  account_number           TEXT,
  transaction_count        INTEGER NOT NULL DEFAULT 0,
  resolution_status        TEXT NOT NULL DEFAULT 'pending',
  resolved_counterparty_id UUID REFERENCES counterparties(id),
  confidence_score         NUMERIC(4,3),
  match_method             TEXT,
  conflict_candidates      JSONB DEFAULT '[]',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at              TIMESTAMPTZ,
  resolved_by              TEXT
);

-- Same partial-table healing pattern for the queue table.
ALTER TABLE counterparty_dedup_queue ADD COLUMN IF NOT EXISTS raw_counterparty         TEXT;
ALTER TABLE counterparty_dedup_queue ADD COLUMN IF NOT EXISTS normalised_name          TEXT;
ALTER TABLE counterparty_dedup_queue ADD COLUMN IF NOT EXISTS account_number           TEXT;
ALTER TABLE counterparty_dedup_queue ADD COLUMN IF NOT EXISTS transaction_count        INTEGER NOT NULL DEFAULT 0;
ALTER TABLE counterparty_dedup_queue ADD COLUMN IF NOT EXISTS resolution_status        TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE counterparty_dedup_queue ADD COLUMN IF NOT EXISTS resolved_counterparty_id UUID;
ALTER TABLE counterparty_dedup_queue ADD COLUMN IF NOT EXISTS confidence_score         NUMERIC(4,3);
ALTER TABLE counterparty_dedup_queue ADD COLUMN IF NOT EXISTS match_method             TEXT;
ALTER TABLE counterparty_dedup_queue ADD COLUMN IF NOT EXISTS conflict_candidates      JSONB DEFAULT '[]';
ALTER TABLE counterparty_dedup_queue ADD COLUMN IF NOT EXISTS resolved_at              TIMESTAMPTZ;
ALTER TABLE counterparty_dedup_queue ADD COLUMN IF NOT EXISTS resolved_by              TEXT;

ALTER TABLE counterparty_dedup_queue DROP CONSTRAINT IF EXISTS cp_dedup_queue_status_check;
ALTER TABLE counterparty_dedup_queue
  ADD CONSTRAINT cp_dedup_queue_status_check
  CHECK (resolution_status IN (
    'pending','auto_resolved','needs_review','manually_resolved','skipped'
  ));

ALTER TABLE counterparty_dedup_queue DROP CONSTRAINT IF EXISTS cp_dedup_queue_method_check;
ALTER TABLE counterparty_dedup_queue
  ADD CONSTRAINT cp_dedup_queue_method_check
  CHECK (match_method IS NULL OR match_method IN (
    'exact_account','exact_normalised','fuzzy_name','manual'
  ));

CREATE INDEX IF NOT EXISTS idx_dedup_queue_status
  ON counterparty_dedup_queue (resolution_status);
CREATE INDEX IF NOT EXISTS idx_dedup_queue_normalised
  ON counterparty_dedup_queue (normalised_name);

-- ── Step 5: denormalisation trigger ──────────────────────────────────────
-- CREATE OR REPLACE FUNCTION is idempotent. Trigger is dropped and
-- recreated so re-runs adopt new function bodies cleanly.
CREATE OR REPLACE FUNCTION update_counterparty_stats()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.counterparty_id IS NOT NULL THEN
    UPDATE counterparties SET
      transaction_count = (
        SELECT COUNT(*) FROM transactions WHERE counterparty_id = NEW.counterparty_id
      ),
      total_volume = (
        SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE counterparty_id = NEW.counterparty_id
      ),
      last_seen_at = NOW()
    WHERE id = NEW.counterparty_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_counterparty_stats ON transactions;
CREATE TRIGGER trg_counterparty_stats
  AFTER INSERT OR UPDATE OF counterparty_id ON transactions
  FOR EACH ROW EXECUTE FUNCTION update_counterparty_stats();
