// ═══════════════════════════════════════════════════════════════════════════
// Examination Readiness Mode (C-11) — route module.
//
// All endpoints under /api/exam-readiness are gated to bsa_officer.
// Computation lives in utils/examChecks.js; this file is the HTTP surface,
// audit-trail / retrieval-log writer, and run-state machine.
//
// Run lifecycle:
//   POST /run         → INSERT 'running' row, return immediately
//                       async path: run each enabled check, INSERT finding
//                       rows, UPDATE run to 'completed' with weighted score.
//   GET  /run/:id     → returns running shape (counts so far) or
//                       completed shape (findings array, ordered by severity).
//   GET  /runs        → paginated list of past runs.
//   GET  /runs/:id/report → logs the export (audit + retrieval_log) and
//                       returns the full run+findings payload. The
//                       frontend builds the actual PDF via jsPDF — see
//                       components/examReadiness/buildReportPdf.js.
//
// MRA endpoints:
//   GET /mras, POST /mras, PATCH /mras/:id
// ═══════════════════════════════════════════════════════════════════════════

const express = require('express');
const pool = require('../database/db');
const { requireBsaOfficer } = require('../middleware/roleGuard');
const { getManagerSetting } = require('../utils/getManagerSetting');
const { logAudit } = require('../utils/audit');
const {
  CHECK_REGISTRY,
  computeRunSummary
} = require('../utils/examChecks');

const router = express.Router();
router.use(requireBsaOfficer);

const VALID_CHECK_IDS = Object.keys(CHECK_REGISTRY);

// Helper — resolve the current user from the x-user-* headers (the existing
// auth posture — header-spoofable, documented gap B-2). Returns null when
// no user is available.
function currentUserId(req) {
  const id = req.headers['x-user-id'];
  if (!id) return null;
  const n = parseInt(id, 10);
  return Number.isFinite(n) ? n : null;
}

function currentUserName(req) {
  return (req.headers['x-user-name'] || 'system').toString();
}

// Build the run config — fill defaults from manager_settings, then accept
// caller overrides. Pure: no DB writes.
async function resolveRunConfig(body = {}) {
  const sarSampleSize         = Number(body.sarSampleSize)         || Number(await getManagerSetting('exam.sar_sample_size',              25))  || 25;
  const cddSampleSize         = Number(body.cddSampleSize)         || Number(await getManagerSetting('exam.cdd_sample_size',              50))  || 50;
  const lookbackDays          = Number(body.lookbackDays)          || Number(await getManagerSetting('exam.lookback_days',               365))  || 365;
  const sarTimelinessDays     = Number(body.sarTimelinessDays)     || Number(await getManagerSetting('exam.sar_timeliness_threshold_days', 30)) || 30;
  const ofacScreeningStaleness= Number(body.ofacScreeningStaleness)|| Number(await getManagerSetting('exam.ofac_screening_staleness_days',365)) || 365;
  const kycOverdueDays        = Number(body.kycOverdueDays)        || Number(await getManagerSetting('exam.kyc_review_overdue_days',       30)) || 30;
  const checksEnabled         = Array.isArray(body.checksEnabled) && body.checksEnabled.length > 0
                                  ? body.checksEnabled.filter(id => VALID_CHECK_IDS.includes(id))
                                  : VALID_CHECK_IDS.slice();
  const targetExamDate        = body.targetExamDate || null;
  return {
    sarSampleSize, cddSampleSize, lookbackDays, sarTimelinessDays,
    ofacScreeningStaleness, kycOverdueDays, checksEnabled, targetExamDate
  };
}

// ── async run executor ────────────────────────────────────────────────────
//
// Runs every enabled check in parallel, writes a finding row per check,
// then UPDATEs the run row with the composite score + counts.
// Never throws — catches every exception and marks the run failed.
async function executeRun(runId, config, performedBy) {
  try {
    const enabled = config.checksEnabled.length > 0 ? config.checksEnabled : VALID_CHECK_IDS;
    const results = await Promise.all(enabled.map(async checkId => {
      const fn = CHECK_REGISTRY[checkId];
      if (!fn) {
        return {
          checkId,
          checkName: checkId,
          ffiecReference: 'unknown',
          cfrReference: null,
          status: 'skipped',
          score: null,
          sampleSize: 0,
          samplePassed: 0,
          sampleFailed: 0,
          failureRate: null,
          findingSummary: `Unknown check id: ${checkId}`,
          findingDetail: [],
          remediationItems: []
        };
      }
      try {
        return await fn(pool, config);
      } catch (err) {
        return {
          checkId,
          checkName: checkId,
          ffiecReference: 'unknown',
          cfrReference: null,
          status: 'fail',
          score: 0,
          sampleSize: 0,
          samplePassed: 0,
          sampleFailed: 0,
          failureRate: 100,
          findingSummary: `Check execution error: ${err.message}`.slice(0, 1000),
          findingDetail: [],
          remediationItems: [{
            priority: 'high',
            action: 'Investigate the backend error for this check in server logs. The check did not produce a usable result.',
            ownerRole: 'compliance_manager'
          }]
        };
      }
    }));

    // Also synthesise a skipped row for any check NOT in the enabled list,
    // so the UI / PDF can show the full taxonomy with a clear status.
    for (const id of VALID_CHECK_IDS) {
      if (enabled.includes(id)) continue;
      results.push({
        checkId: id,
        checkName: id,
        ffiecReference: 'n/a',
        cfrReference: null,
        status: 'skipped',
        score: null,
        sampleSize: 0,
        samplePassed: 0,
        sampleFailed: 0,
        failureRate: null,
        findingSummary: 'Excluded from this run by configuration.',
        findingDetail: [],
        remediationItems: []
      });
    }

    // Persist findings.
    for (const r of results) {
      await pool.query(
        `INSERT INTO exam_readiness_findings
           (run_id, check_id, check_name, ffiec_reference, cfr_reference,
            status, score, sample_size, sample_passed, sample_failed,
            failure_rate, finding_summary, finding_detail, remediation_items)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb)`,
        [
          runId,
          r.checkId,
          r.checkName,
          r.ffiecReference,
          r.cfrReference,
          r.status,
          r.score,
          r.sampleSize,
          r.samplePassed,
          r.sampleFailed,
          r.failureRate,
          r.findingSummary,
          JSON.stringify(r.findingDetail || []),
          JSON.stringify(r.remediationItems || [])
        ]
      );
    }

    const { overallScore, overallStatus, counts } = computeRunSummary(results);
    await pool.query(
      `UPDATE exam_readiness_runs
          SET status = 'completed',
              completed_at = NOW(),
              overall_score = $1,
              overall_status = $2,
              checks_run = $3,
              checks_passed = $4,
              checks_concern = $5,
              checks_failed = $6
        WHERE id = $7`,
      [overallScore, overallStatus, counts.run, counts.passed, counts.concern, counts.failed, runId]
    );

    await logAudit({
      entity_type: 'exam_readiness_run',
      entity_id: runId,
      action: 'exam_readiness_run_completed',
      performed_by: performedBy,
      details: `overall_score=${overallScore} status=${overallStatus} passed=${counts.passed} concern=${counts.concern} failed=${counts.failed} skipped=${counts.skipped}`
    });
  } catch (err) {
    try {
      await pool.query(
        `UPDATE exam_readiness_runs SET status = 'failed', completed_at = NOW() WHERE id = $1`,
        [runId]
      );
    } catch (_e) { /* swallow */ }
    await logAudit({
      entity_type: 'exam_readiness_run',
      entity_id: runId,
      action: 'exam_readiness_run_failed',
      performed_by: performedBy,
      details: String(err.message || err).slice(0, 1000)
    });
  }
}

// ── POST /api/exam-readiness/run ──────────────────────────────────────────
router.post('/run', async (req, res, next) => {
  try {
    const config = await resolveRunConfig(req.body || {});
    if (!config.checksEnabled || config.checksEnabled.length === 0) {
      return res.status(400).json({ error: 'At least one valid check must be enabled.' });
    }
    const userId = currentUserId(req);
    const userName = currentUserName(req);
    const ins = await pool.query(
      `INSERT INTO exam_readiness_runs (run_by, config, status)
       VALUES ($1, $2::jsonb, 'running')
       RETURNING id, started_at`,
      [userId, JSON.stringify(config)]
    );
    const runId = ins.rows[0].id;

    await logAudit({
      entity_type: 'exam_readiness_run',
      entity_id: runId,
      action: 'exam_readiness_run_started',
      performed_by: userName,
      details: `checks=${config.checksEnabled.join(',')} lookback_days=${config.lookbackDays}`
    });

    // Fire-and-forget. The HTTP response returns immediately; the UI polls.
    executeRun(runId, config, userName).catch(() => {});

    res.json({
      runId,
      status: 'running',
      message: 'Self-assessment started. Poll /api/exam-readiness/run/:id for status.',
      startedAt: ins.rows[0].started_at
    });
  } catch (err) { next(err); }
});

// ── GET /api/exam-readiness/run/:id ───────────────────────────────────────
router.get('/run/:id', async (req, res, next) => {
  try {
    const r = (await pool.query(
      `SELECT r.*, u.name AS run_by_name
         FROM exam_readiness_runs r
         LEFT JOIN user_profiles u ON u.id = r.run_by
        WHERE r.id = $1`,
      [req.params.id]
    )).rows[0];
    if (!r) return res.status(404).json({ error: 'Run not found' });

    if (r.status === 'running') {
      const c = await pool.query(
        `SELECT COUNT(*)::int AS c FROM exam_readiness_findings WHERE run_id = $1`,
        [r.id]
      );
      const config = typeof r.config === 'string' ? JSON.parse(r.config) : (r.config || {});
      const checksTotal = (config.checksEnabled || []).length || Object.keys(CHECK_REGISTRY).length;
      return res.json({
        runId: r.id,
        status: 'running',
        startedAt: r.started_at,
        checksCompleted: Number(c.rows[0].c) || 0,
        checksTotal,
        config,
        runByName: r.run_by_name || null
      });
    }

    const findings = (await pool.query(
      `SELECT *
         FROM exam_readiness_findings
        WHERE run_id = $1
        ORDER BY
          CASE status
            WHEN 'fail' THEN 0
            WHEN 'concern' THEN 1
            WHEN 'pass' THEN 2
            ELSE 3
          END ASC,
          check_id ASC`,
      [r.id]
    )).rows;

    const config = typeof r.config === 'string' ? JSON.parse(r.config) : (r.config || {});
    res.json({
      runId: r.id,
      status: r.status,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      overallScore: r.overall_score,
      overallStatus: r.overall_status,
      checksRun: r.checks_run,
      checksPassed: r.checks_passed,
      checksConcern: r.checks_concern,
      checksFailed: r.checks_failed,
      config,
      notes: r.notes,
      runByName: r.run_by_name || null,
      findings: findings.map(f => ({
        id: f.id,
        checkId: f.check_id,
        checkName: f.check_name,
        ffiecReference: f.ffiec_reference,
        cfrReference: f.cfr_reference,
        status: f.status,
        score: f.score,
        sampleSize: f.sample_size,
        samplePassed: f.sample_passed,
        sampleFailed: f.sample_failed,
        failureRate: f.failure_rate == null ? null : Number(f.failure_rate),
        findingSummary: f.finding_summary,
        findingDetail: f.finding_detail || [],
        remediationItems: f.remediation_items || [],
        computedAt: f.computed_at
      }))
    });
  } catch (err) { next(err); }
});

// ── GET /api/exam-readiness/runs ──────────────────────────────────────────
router.get('/runs', async (req, res, next) => {
  try {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const rows = (await pool.query(
      `SELECT r.id, r.started_at, r.completed_at, r.status,
              r.overall_score, r.overall_status,
              r.checks_run, r.checks_passed, r.checks_concern, r.checks_failed,
              r.config, u.name AS run_by_name
         FROM exam_readiness_runs r
         LEFT JOIN user_profiles u ON u.id = r.run_by
        ORDER BY r.started_at DESC
        LIMIT $1 OFFSET $2`,
      [limit, offset]
    )).rows;
    res.json({
      runs: rows.map(r => {
        const config = typeof r.config === 'string' ? JSON.parse(r.config) : (r.config || {});
        return {
          runId: r.id,
          startedAt: r.started_at,
          completedAt: r.completed_at,
          status: r.status,
          overallScore: r.overall_score,
          overallStatus: r.overall_status,
          checksRun: r.checks_run,
          checksPassed: r.checks_passed,
          checksConcern: r.checks_concern,
          checksFailed: r.checks_failed,
          runByName: r.run_by_name || null,
          targetExamDate: config.targetExamDate || null
        };
      }),
      limit,
      offset
    });
  } catch (err) { next(err); }
});

// ── PATCH /api/exam-readiness/run/:id/notes ───────────────────────────────
router.patch('/run/:id/notes', async (req, res, next) => {
  try {
    const notes = (req.body?.notes || '').toString();
    const r = await pool.query(
      `UPDATE exam_readiness_runs SET notes = $1 WHERE id = $2 RETURNING id, notes`,
      [notes, req.params.id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Run not found' });
    await logAudit({
      entity_type: 'exam_readiness_run',
      entity_id: req.params.id,
      action: 'exam_readiness_notes_updated',
      performed_by: currentUserName(req),
      details: `notes length=${notes.length}`
    });
    res.json({ runId: r.rows[0].id, notes: r.rows[0].notes });
  } catch (err) { next(err); }
});

// ── GET /api/exam-readiness/runs/:id/report ───────────────────────────────
//
// The PDF is generated client-side via jsPDF (matches the existing pattern
// in pages/Reports.jsx). This endpoint returns the full run+findings JSON
// payload AND logs the export to both audit_trail and retrieval_log — the
// PDF itself is a confidential compliance document, so the export event
// must be traceable irrespective of how the user rendered the file.
router.get('/runs/:id/report', async (req, res, next) => {
  try {
    const r = (await pool.query(
      `SELECT r.*, u.name AS run_by_name
         FROM exam_readiness_runs r
         LEFT JOIN user_profiles u ON u.id = r.run_by
        WHERE r.id = $1`,
      [req.params.id]
    )).rows[0];
    if (!r) return res.status(404).json({ error: 'Run not found' });
    if (r.status !== 'completed') return res.status(409).json({ error: 'Run is not complete.' });

    const findings = (await pool.query(
      `SELECT * FROM exam_readiness_findings
        WHERE run_id = $1
        ORDER BY
          CASE status WHEN 'fail' THEN 0 WHEN 'concern' THEN 1 WHEN 'pass' THEN 2 ELSE 3 END,
          check_id ASC`,
      [r.id]
    )).rows;

    const openMras = (await pool.query(
      `SELECT category, title, severity, exam_date, examiner_agency, target_date
         FROM exam_mra_items
        WHERE status IN ('open','in_progress')
        ORDER BY exam_date DESC`
    )).rows;

    const institutionName = await getManagerSetting('institution.name', '[Institution Name]');

    await pool.query(
      `UPDATE exam_readiness_runs SET report_generated_at = NOW() WHERE id = $1`,
      [r.id]
    );

    const requester = currentUserName(req);
    const purpose = 'Examination Readiness Report export';
    const nowIso = new Date().toISOString();
    await pool.query(
      `INSERT INTO retrieval_log (sar_id, requested_by, request_purpose, requested_at, exported_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [`EXAM_READINESS:${r.id}`, requester, purpose, nowIso, nowIso]
    );
    await logAudit({
      entity_type: 'exam_readiness_run',
      entity_id: r.id,
      action: 'exam_readiness_report_generated',
      performed_by: requester,
      details: purpose
    });

    const config = typeof r.config === 'string' ? JSON.parse(r.config) : (r.config || {});
    res.json({
      runId: r.id,
      institutionName,
      generatedAt: nowIso,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      runByName: r.run_by_name || null,
      overallScore: r.overall_score,
      overallStatus: r.overall_status,
      checksRun: r.checks_run,
      checksPassed: r.checks_passed,
      checksConcern: r.checks_concern,
      checksFailed: r.checks_failed,
      config,
      notes: r.notes,
      findings: findings.map(f => ({
        checkId: f.check_id,
        checkName: f.check_name,
        ffiecReference: f.ffiec_reference,
        cfrReference: f.cfr_reference,
        status: f.status,
        score: f.score,
        sampleSize: f.sample_size,
        samplePassed: f.sample_passed,
        sampleFailed: f.sample_failed,
        failureRate: f.failure_rate == null ? null : Number(f.failure_rate),
        findingSummary: f.finding_summary,
        findingDetail: f.finding_detail || [],
        remediationItems: f.remediation_items || []
      })),
      openMras
    });
  } catch (err) { next(err); }
});

// ── GET /api/exam-readiness/summary ───────────────────────────────────────
router.get('/summary', async (_req, res, next) => {
  try {
    const last = (await pool.query(
      `SELECT id, completed_at, overall_score, overall_status, config
         FROM exam_readiness_runs
        WHERE status = 'completed'
        ORDER BY completed_at DESC NULLS LAST
        LIMIT 1`
    )).rows[0] || null;

    const open = (await pool.query(
      `SELECT COUNT(*)::int AS c FROM exam_mra_items WHERE status IN ('open','in_progress')`
    )).rows[0]?.c || 0;
    const critical = (await pool.query(
      `SELECT COUNT(*)::int AS c FROM exam_mra_items
        WHERE status IN ('open','in_progress') AND severity IN ('mria','violation')`
    )).rows[0]?.c || 0;

    let targetExamDate = null;
    let daysUntilTargetExam = null;
    if (last) {
      const cfg = typeof last.config === 'string' ? JSON.parse(last.config) : last.config;
      targetExamDate = cfg?.targetExamDate || null;
      if (targetExamDate) {
        const ms = new Date(targetExamDate).getTime() - Date.now();
        daysUntilTargetExam = Math.ceil(ms / 86400000);
      }
    }

    res.json({
      lastRun: last ? {
        runId: last.id,
        completedAt: last.completed_at,
        overallScore: last.overall_score,
        overallStatus: last.overall_status,
        daysAgo: last.completed_at
          ? Math.floor((Date.now() - new Date(last.completed_at).getTime()) / 86400000)
          : null
      } : null,
      openMras: Number(open) || 0,
      criticalMras: Number(critical) || 0,
      daysUntilTargetExam,
      targetExamDate
    });
  } catch (err) { next(err); }
});

// ── MRA CRUD ──────────────────────────────────────────────────────────────

router.get('/mras', async (req, res, next) => {
  try {
    const filters = [];
    const params = [];
    if (req.query.status) {
      params.push(String(req.query.status));
      filters.push(`m.status = $${params.length}`);
    }
    if (req.query.category) {
      params.push(String(req.query.category));
      filters.push(`m.category = $${params.length}`);
    }
    if (req.query.severity) {
      params.push(String(req.query.severity));
      filters.push(`m.severity = $${params.length}`);
    }
    const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
    const rows = (await pool.query(
      `SELECT m.*,
              cu.name AS created_by_name,
              vu.name AS verified_by_name
         FROM exam_mra_items m
         LEFT JOIN user_profiles cu ON cu.id = m.created_by
         LEFT JOIN user_profiles vu ON vu.id = m.verified_by
         ${where}
        ORDER BY m.exam_date DESC, m.created_at DESC`,
      params
    )).rows;
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/mras', async (req, res, next) => {
  try {
    const b = req.body || {};
    const required = ['examDate','examinerAgency','category','title','description','severity'];
    for (const k of required) {
      if (!b[k] || (typeof b[k] === 'string' && !b[k].trim())) {
        return res.status(400).json({ error: `Missing required field: ${k}` });
      }
    }
    const userId = currentUserId(req);
    const r = await pool.query(
      `INSERT INTO exam_mra_items
        (created_by, exam_date, examiner_agency, mra_reference, category,
         title, description, severity, status, target_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'open', $9)
       RETURNING *`,
      [
        userId,
        b.examDate,
        b.examinerAgency,
        b.mraReference || null,
        b.category,
        b.title,
        b.description,
        b.severity,
        b.targetDate || null
      ]
    );
    await logAudit({
      entity_type: 'exam_mra_item',
      entity_id: r.rows[0].id,
      action: 'exam_mra_created',
      performed_by: currentUserName(req),
      details: `${b.severity} — ${b.category} — ${b.title}`.slice(0, 500)
    });
    res.status(201).json(r.rows[0]);
  } catch (err) { next(err); }
});

router.patch('/mras/:id', async (req, res, next) => {
  try {
    const b = req.body || {};
    const sets = [];
    const params = [];
    const allowed = ['status','remediationNotes','remediatedDate','targetDate'];
    const colMap = {
      status: 'status',
      remediationNotes: 'remediation_notes',
      remediatedDate: 'remediated_date',
      targetDate: 'target_date'
    };
    for (const k of allowed) {
      if (Object.prototype.hasOwnProperty.call(b, k)) {
        params.push(b[k] == null ? null : b[k]);
        sets.push(`${colMap[k]} = $${params.length}`);
      }
    }
    if (sets.length === 0) return res.status(400).json({ error: 'No updatable fields provided.' });

    let verifiedClosed = false;
    if (b.status === 'verified_closed') {
      verifiedClosed = true;
      const userId = currentUserId(req);
      params.push(userId);
      sets.push(`verified_by = $${params.length}`);
      sets.push(`verified_at = NOW()`);
    }
    sets.push(`updated_at = NOW()`);
    params.push(req.params.id);
    const r = await pool.query(
      `UPDATE exam_mra_items SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'MRA not found' });

    if (b.status) {
      await logAudit({
        entity_type: 'exam_mra_item',
        entity_id: r.rows[0].id,
        action: verifiedClosed ? 'exam_mra_verified_closed' : 'exam_mra_status_changed',
        performed_by: currentUserName(req),
        details: `status=${b.status}`
      });
    }
    res.json(r.rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
