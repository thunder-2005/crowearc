// ═══════════════════════════════════════════════════════════════════════════
// Counterparty entity routes (C-10).
//
// Mounted at /api/counterparties. Read endpoints are open to any logged-in
// analyst (so the graph modal's counterparty detail panel can render for
// L2 and managers). Mutating endpoints — resolve queue entries and merge
// counterparties — are BSA Officer only.
// ═══════════════════════════════════════════════════════════════════════════

const express = require('express');
const pool = require('../database/db');
const { requireBsaOfficer } = require('../middleware/roleGuard');
const {
  resolveManually,
  mergeCounterparties
} = require('../utils/counterpartyDedup');

const router = express.Router();

function currentUserId(req) {
  const id = req.headers['x-user-id'];
  if (!id) return null;
  const n = parseInt(id, 10);
  return Number.isFinite(n) ? n : null;
}

function currentUserName(req) {
  return (req.headers['x-user-name'] || 'system').toString();
}

// ── GET /api/counterparties ──────────────────────────────────────────────
//
// Paginated list of counterparties. Query params:
//   limit, offset, search (matches canonical_name ILIKE),
//   status ('needs_review' filters to those with at least one queue
//   entry in needs_review; 'merged_away' filters to is_merged_away=TRUE;
//   otherwise returns all live).
router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const search = (req.query.search || '').toString().trim();
    const status = (req.query.status || '').toString().trim();

    const filters = [];
    const params = [];
    if (status === 'merged_away') {
      filters.push('cp.is_merged_away = TRUE');
    } else if (status === 'needs_review') {
      filters.push(
        `EXISTS (SELECT 1 FROM counterparty_dedup_queue q
                 WHERE q.resolved_counterparty_id = cp.id
                   AND q.resolution_status = 'needs_review')`
      );
    } else {
      filters.push('cp.is_merged_away = FALSE');
    }
    if (search) {
      params.push(`%${search}%`);
      filters.push(`cp.canonical_name ILIKE $${params.length}`);
    }
    params.push(limit);
    params.push(offset);

    const r = await pool.query(
      `SELECT cp.id, cp.canonical_name, cp.normalised_name, cp.counterparty_type,
              cp.transaction_count, cp.total_volume, cp.risk_indicators,
              cp.is_merged_away, cp.first_seen_at, cp.last_seen_at,
              (SELECT COUNT(DISTINCT customer_id)::int FROM transactions
                WHERE counterparty_id = cp.id)            AS customer_count,
              EXISTS (SELECT 1 FROM counterparty_dedup_queue q
                       WHERE q.resolved_counterparty_id = cp.id
                         AND q.resolution_status = 'needs_review') AS has_needs_review
         FROM counterparties cp
        ${filters.length > 0 ? 'WHERE ' + filters.join(' AND ') : ''}
        ORDER BY cp.transaction_count DESC, cp.canonical_name ASC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json({ counterparties: r.rows, limit, offset });
  } catch (err) { next(err); }
});

// ── GET /api/counterparties/review-queue ─────────────────────────────────
router.get('/review-queue', async (_req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT q.id, q.raw_counterparty, q.normalised_name, q.transaction_count,
              q.confidence_score, q.conflict_candidates, q.created_at
         FROM counterparty_dedup_queue q
        WHERE q.resolution_status = 'needs_review'
        ORDER BY q.transaction_count DESC, q.created_at ASC`
    );
    res.json({ queue: r.rows });
  } catch (err) { next(err); }
});

// ── POST /api/counterparties/resolve/:queueEntryId ───────────────────────
router.post('/resolve/:queueEntryId', requireBsaOfficer, async (req, res, next) => {
  try {
    const { targetCounterpartyId } = req.body || {};
    if (!targetCounterpartyId) {
      return res.status(400).json({ error: 'targetCounterpartyId is required' });
    }
    const result = await resolveManually(
      pool,
      req.params.queueEntryId,
      targetCounterpartyId,
      currentUserId(req) || currentUserName(req)
    );
    res.json(result);
  } catch (err) {
    if (/not found/i.test(err.message)) return res.status(404).json({ error: err.message });
    next(err);
  }
});

// ── POST /api/counterparties/merge ───────────────────────────────────────
router.post('/merge', requireBsaOfficer, async (req, res, next) => {
  try {
    const { sourceId, targetId } = req.body || {};
    if (!sourceId || !targetId) {
      return res.status(400).json({ error: 'sourceId and targetId are required' });
    }
    if (sourceId === targetId) {
      return res.status(400).json({ error: 'sourceId and targetId must differ' });
    }
    const result = await mergeCounterparties(
      pool,
      sourceId,
      targetId,
      currentUserId(req) || currentUserName(req)
    );
    res.json(result);
  } catch (err) {
    if (/not found/i.test(err.message)) return res.status(404).json({ error: err.message });
    if (/must differ/i.test(err.message)) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// ── GET /api/counterparties/:id ──────────────────────────────────────────
//
// Full detail for a single counterparty. Customer list is gated to
// non-L1 roles (mirrors the SAR-side tipping-off posture).
router.get('/:id', async (req, res, next) => {
  try {
    const cp = (await pool.query(
      `SELECT * FROM counterparties WHERE id = $1`,
      [req.params.id]
    )).rows[0];
    if (!cp) return res.status(404).json({ error: 'Counterparty not found' });

    const variants = (await pool.query(
      `SELECT raw_counterparty, normalised_name, transaction_count,
              match_method, confidence_score, resolved_at
         FROM counterparty_dedup_queue
        WHERE resolved_counterparty_id = $1
        ORDER BY transaction_count DESC`,
      [req.params.id]
    )).rows;

    const summary = (await pool.query(
      `SELECT COUNT(*)::int                                       AS txn_count,
              COUNT(DISTINCT customer_id)::int                    AS customer_count,
              COALESCE(SUM(amount), 0)::numeric                   AS total_volume,
              MIN(NULLIF(txn_date, ''))                           AS first_txn,
              MAX(NULLIF(txn_date, ''))                           AS last_txn
         FROM transactions
        WHERE counterparty_id = $1`,
      [req.params.id]
    )).rows[0];

    const role = req.headers['x-user-role'];
    let customers = [];
    if (role !== 'analyst_l1') {
      customers = (await pool.query(
        `SELECT t.customer_id, c.customer_name, c.customer_risk_rating,
                COUNT(*)::int                                  AS txn_count,
                COALESCE(SUM(t.amount), 0)::numeric            AS total_amount
           FROM transactions t
           JOIN customers c ON c.customer_id = t.customer_id
          WHERE t.counterparty_id = $1
          GROUP BY t.customer_id, c.customer_name, c.customer_risk_rating
          ORDER BY COUNT(*) DESC
          LIMIT 20`,
        [req.params.id]
      )).rows;
    }

    res.json({
      counterparty: cp,
      variants,
      summary,
      customers,
      merge_history: {
        is_merged_away: cp.is_merged_away,
        merged_into_id: cp.merged_into_id,
        merge_source_ids: cp.merge_source_ids || []
      }
    });
  } catch (err) { next(err); }
});

module.exports = router;
