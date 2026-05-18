-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 002 — OFAC Sync Durability (C-04)
--
-- Replaces the silent in-process setInterval scheduler with a durable,
-- lock-protected, retry-capable job. This migration adds:
--
--   1. ofac_sync_runs       — full lifecycle audit per sync attempt
--                             (running → success | failed | skipped)
--   2. ofac_sdn_entries.sync_run_id — back-reference so every SDN row can be
--                             traced to the exact sync that wrote it (audit H-6:
--                             "SDN list version captured per screening")
--   3. ofac_sync_status     — single-row view answering "is the list stale?"
--
-- Idempotent: every DDL is IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
-- Re-running this migration on a fresh DB or a populated DB produces no
-- errors and no duplicate state.
--
-- The old ofac_download_log table is left untouched for backwards
-- compatibility with any external dashboard/report that may already
-- depend on it. The new job writes both.
-- ═══════════════════════════════════════════════════════════════════════════

-- gen_random_uuid() lives in pgcrypto. Already enabled by cceg_schema.sql
-- but we ensure it here so this migration is self-contained on a fresh DB.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 1. ofac_sync_runs ─────────────────────────────────────────────────────
--
-- One row per sync attempt. The runner INSERTs a 'running' row, then UPDATEs
-- to 'success' or 'failed' as it finishes (or 'skipped' if the advisory
-- lock was held by another instance). On startup, any 'running' row older
-- than 2 hours is force-flipped to 'failed' to clean up after crashed
-- instances.
CREATE TABLE IF NOT EXISTS ofac_sync_runs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at       TIMESTAMPTZ,
  status             TEXT NOT NULL DEFAULT 'running',
  entries_added      INTEGER,
  entries_total      INTEGER,
  list_version       TEXT,
  error_message      TEXT,
  retry_count        INTEGER NOT NULL DEFAULT 0,
  triggered_by       TEXT NOT NULL DEFAULT 'scheduler',
  lock_acquired_at   TIMESTAMPTZ
);

-- ADD COLUMN IF NOT EXISTS guards for the case where an earlier ad-hoc
-- DDL created a partial version of the table.
ALTER TABLE ofac_sync_runs ADD COLUMN IF NOT EXISTS id               UUID;
ALTER TABLE ofac_sync_runs ADD COLUMN IF NOT EXISTS started_at       TIMESTAMPTZ;
ALTER TABLE ofac_sync_runs ADD COLUMN IF NOT EXISTS completed_at     TIMESTAMPTZ;
ALTER TABLE ofac_sync_runs ADD COLUMN IF NOT EXISTS status           TEXT;
ALTER TABLE ofac_sync_runs ADD COLUMN IF NOT EXISTS entries_added    INTEGER;
ALTER TABLE ofac_sync_runs ADD COLUMN IF NOT EXISTS entries_total    INTEGER;
ALTER TABLE ofac_sync_runs ADD COLUMN IF NOT EXISTS list_version     TEXT;
ALTER TABLE ofac_sync_runs ADD COLUMN IF NOT EXISTS error_message    TEXT;
ALTER TABLE ofac_sync_runs ADD COLUMN IF NOT EXISTS retry_count      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ofac_sync_runs ADD COLUMN IF NOT EXISTS triggered_by     TEXT NOT NULL DEFAULT 'scheduler';
ALTER TABLE ofac_sync_runs ADD COLUMN IF NOT EXISTS lock_acquired_at TIMESTAMPTZ;

-- Status whitelist. CHECK is dropped+recreated so re-running the migration
-- can evolve the valid set without manual cleanup.
ALTER TABLE ofac_sync_runs DROP CONSTRAINT IF EXISTS ofac_sync_runs_status_check;
ALTER TABLE ofac_sync_runs
  ADD CONSTRAINT ofac_sync_runs_status_check
  CHECK (status IN ('running', 'success', 'failed', 'skipped'));

-- triggered_by whitelist.
ALTER TABLE ofac_sync_runs DROP CONSTRAINT IF EXISTS ofac_sync_runs_triggered_by_check;
ALTER TABLE ofac_sync_runs
  ADD CONSTRAINT ofac_sync_runs_triggered_by_check
  CHECK (triggered_by IN ('scheduler', 'manual', 'startup_cleanup'));

CREATE INDEX IF NOT EXISTS idx_ofac_sync_runs_started_at ON ofac_sync_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_ofac_sync_runs_status     ON ofac_sync_runs (status);

-- ── 2. Trace SDN entries to the sync run that wrote them (H-6) ────────────
--
-- The screening engine cites the list version it screened against; persisting
-- the sync_run_id lets us answer the regulator's "which list version was this
-- screening run against?" question deterministically.
ALTER TABLE ofac_sdn_entries
  ADD COLUMN IF NOT EXISTS sync_run_id UUID;

-- No FK constraint here on purpose. The existing downloader does a hard
-- DELETE/INSERT cycle on ofac_sdn_entries; an FK with ON DELETE NO ACTION
-- would block the refresh. The runner is responsible for keeping sync_run_id
-- consistent. If a row's sync_run_id is missing from ofac_sync_runs the
-- screening still works — the citation just degrades to "unknown version".

CREATE INDEX IF NOT EXISTS idx_ofac_sdn_sync_run ON ofac_sdn_entries (sync_run_id);

-- ── 3. ofac_sync_status view ──────────────────────────────────────────────
--
-- Single-row SELECT for "is the list stale?". The dashboard and the
-- /api/ofac/sync-status endpoint both consume this view. 26-hour default
-- threshold catches a missed daily sync without false-alerting on minor
-- delays; configurable via manager_settings.ofac.staleness_threshold_hours
-- (the view is hard-coded to 26 for the is_stale flag because views can't
-- read manager_settings cleanly; callers needing the configurable value
-- can compute it themselves from hours_since_last_success).
CREATE OR REPLACE VIEW ofac_sync_status AS
SELECT
  r.id,
  r.started_at,
  r.completed_at,
  r.status,
  r.entries_total,
  r.list_version,
  r.error_message,
  r.retry_count,
  EXTRACT(EPOCH FROM (NOW() - r.completed_at)) / 3600 AS hours_since_last_success,
  CASE
    WHEN r.completed_at IS NULL THEN true
    WHEN EXTRACT(EPOCH FROM (NOW() - r.completed_at)) / 3600 > 26 THEN true
    ELSE false
  END AS is_stale
FROM ofac_sync_runs r
WHERE r.status = 'success'
ORDER BY r.completed_at DESC
LIMIT 1;

-- ── 4. Seed the manager_settings threshold key ────────────────────────────
--
-- Default 26 hours (24-hour cadence + 2-hour grace). Manager Settings UI
-- exposes a number input with a 24h floor and a 168h (one week) ceiling.
INSERT INTO manager_settings (setting_key, setting_value, updated_at)
VALUES ('ofac.staleness_threshold_hours', '26', NOW())
ON CONFLICT (setting_key) DO NOTHING;
