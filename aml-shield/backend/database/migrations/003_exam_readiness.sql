-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 003 — Examination Readiness Mode (C-11)
--
-- Net-new module: BSA Officer self-assessment runs against FFIEC procedures,
-- structured findings, lightweight MRA tracker, and PDF report metadata.
--
-- Idempotent: CREATE TABLE / CREATE INDEX with IF NOT EXISTS. Re-running on
-- a populated DB is a no-op.
--
-- Schema reality notes:
--   - user_profiles.id is SERIAL (INTEGER), not UUID. The C-11 spec assumed
--     UUID; FK columns here use INTEGER to match. Documented in route code.
--   - institution_id columns are placeholders for M-5 multi-tenant; left
--     NULLable and unindexed for now.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()

-- ── exam_readiness_runs ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS exam_readiness_runs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id      UUID,
  run_by              INTEGER REFERENCES user_profiles(id) ON DELETE SET NULL,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at        TIMESTAMPTZ,
  status              TEXT NOT NULL DEFAULT 'running',
  config              JSONB NOT NULL DEFAULT '{}',
  overall_score       INTEGER,
  overall_status      TEXT,
  checks_run          INTEGER,
  checks_passed       INTEGER,
  checks_concern      INTEGER,
  checks_failed       INTEGER,
  report_generated_at TIMESTAMPTZ,
  notes               TEXT
);

ALTER TABLE exam_readiness_runs DROP CONSTRAINT IF EXISTS exam_readiness_runs_status_check;
ALTER TABLE exam_readiness_runs
  ADD CONSTRAINT exam_readiness_runs_status_check
  CHECK (status IN ('running','completed','failed','cancelled'));

ALTER TABLE exam_readiness_runs DROP CONSTRAINT IF EXISTS exam_readiness_runs_overall_status_check;
ALTER TABLE exam_readiness_runs
  ADD CONSTRAINT exam_readiness_runs_overall_status_check
  CHECK (overall_status IS NULL OR overall_status IN ('pass','concern','fail'));

CREATE INDEX IF NOT EXISTS idx_exam_runs_run_by     ON exam_readiness_runs (run_by);
CREATE INDEX IF NOT EXISTS idx_exam_runs_started_at ON exam_readiness_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_exam_runs_status     ON exam_readiness_runs (status);

-- ── exam_readiness_findings ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS exam_readiness_findings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            UUID NOT NULL REFERENCES exam_readiness_runs(id) ON DELETE CASCADE,
  check_id          TEXT NOT NULL,
  check_name        TEXT NOT NULL,
  ffiec_reference   TEXT NOT NULL,
  cfr_reference     TEXT,
  status            TEXT NOT NULL,
  score             INTEGER,
  sample_size       INTEGER,
  sample_passed     INTEGER,
  sample_failed     INTEGER,
  failure_rate      NUMERIC(5,2),
  finding_summary   TEXT,
  finding_detail    JSONB,
  remediation_items JSONB,
  computed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE exam_readiness_findings DROP CONSTRAINT IF EXISTS exam_readiness_findings_status_check;
ALTER TABLE exam_readiness_findings
  ADD CONSTRAINT exam_readiness_findings_status_check
  CHECK (status IN ('pass','concern','fail','skipped'));

CREATE INDEX IF NOT EXISTS idx_exam_findings_run_id   ON exam_readiness_findings (run_id);
CREATE INDEX IF NOT EXISTS idx_exam_findings_check_id ON exam_readiness_findings (check_id);
CREATE INDEX IF NOT EXISTS idx_exam_findings_status   ON exam_readiness_findings (status);

-- ── exam_mra_items ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS exam_mra_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id    UUID,
  created_by        INTEGER REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  exam_date         DATE NOT NULL,
  examiner_agency   TEXT NOT NULL,
  mra_reference     TEXT,
  category          TEXT NOT NULL,
  title             TEXT NOT NULL,
  description       TEXT NOT NULL,
  severity          TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'open',
  target_date       DATE,
  remediated_date   DATE,
  remediation_notes TEXT,
  verified_by       INTEGER REFERENCES user_profiles(id) ON DELETE SET NULL,
  verified_at       TIMESTAMPTZ,
  attachments       JSONB DEFAULT '[]'
);

ALTER TABLE exam_mra_items DROP CONSTRAINT IF EXISTS exam_mra_items_category_check;
ALTER TABLE exam_mra_items
  ADD CONSTRAINT exam_mra_items_category_check
  CHECK (category IN (
    'SAR_FILING','CDD_KYC','OFAC_SANCTIONS','AUDIT_TRAIL',
    'INTERNAL_CONTROLS','BSA_OFFICER','TRAINING',
    'INDEPENDENT_TESTING','OTHER'
  ));

ALTER TABLE exam_mra_items DROP CONSTRAINT IF EXISTS exam_mra_items_severity_check;
ALTER TABLE exam_mra_items
  ADD CONSTRAINT exam_mra_items_severity_check
  CHECK (severity IN ('mra','mria','violation','recommendation'));

ALTER TABLE exam_mra_items DROP CONSTRAINT IF EXISTS exam_mra_items_status_check;
ALTER TABLE exam_mra_items
  ADD CONSTRAINT exam_mra_items_status_check
  CHECK (status IN ('open','in_progress','remediated','verified_closed'));

CREATE INDEX IF NOT EXISTS idx_mra_status    ON exam_mra_items (status);
CREATE INDEX IF NOT EXISTS idx_mra_category  ON exam_mra_items (category);
CREATE INDEX IF NOT EXISTS idx_mra_exam_date ON exam_mra_items (exam_date DESC);

-- ── Manager settings seeds ────────────────────────────────────────────────
-- ON CONFLICT DO NOTHING so re-running this migration doesn't overwrite
-- values that a compliance manager has tuned for their institution.
INSERT INTO manager_settings (setting_key, setting_value, updated_at) VALUES
  ('exam.sar_sample_size',             '25',  NOW()),
  ('exam.cdd_sample_size',             '50',  NOW()),
  ('exam.lookback_days',               '365', NOW()),
  ('exam.sar_timeliness_threshold_days','30', NOW()),
  ('exam.ofac_screening_staleness_days','365',NOW()),
  ('exam.kyc_review_overdue_days',     '30',  NOW()),
  ('institution.name',                 '"[Institution Name]"', NOW())
ON CONFLICT (setting_key) DO NOTHING;
