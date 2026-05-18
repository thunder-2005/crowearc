const express = require('express');
const pool = require('../database/db');

const router = express.Router();

function parseJsonField(row, fields) {
  for (const f of fields) {
    if (row[f]) {
      try { row[f] = JSON.parse(row[f]); } catch (_e) { /* keep raw */ }
    } else {
      row[f] = null;
    }
  }
  return row;
}

router.get('/', async (req, res, next) => {
  try {
    const { q, customer_risk_rating, cdd_level, kyc_review_status, pep_match, sanctions_match } = req.query;
    let sql = `
      SELECT c.*, (
        SELECT COUNT(*) FROM alerts a
         WHERE a.customer_id = c.customer_id
           AND a.alert_status NOT IN ('Completed', 'Closed', 'Filed', 'Closed — False Positive')
      ) AS open_alerts
      FROM customers c WHERE 1=1
    `;
    const params = [];
    let n = 0;
    if (q) {
      params.push(`%${q}%`, `%${q}%`);
      sql += ` AND (c.customer_id LIKE $${++n} OR c.customer_name LIKE $${++n})`;
    }
    if (customer_risk_rating) { params.push(customer_risk_rating); sql += ` AND c.customer_risk_rating = $${++n}`; }
    if (cdd_level)            { params.push(cdd_level);            sql += ` AND c.cdd_level = $${++n}`; }
    if (kyc_review_status)    { params.push(kyc_review_status);    sql += ` AND c.kyc_review_status = $${++n}`; }
    if (pep_match !== undefined && pep_match !== '') {
      params.push(Number(pep_match)); sql += ` AND c.pep_match = $${++n}`;
    }
    if (sanctions_match !== undefined && sanctions_match !== '') {
      params.push(Number(sanctions_match)); sql += ` AND c.sanctions_match = $${++n}`;
    }
    sql += ' ORDER BY c.customer_name ASC';
    const result = await pool.query(sql, params);
    res.json(result.rows);
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const idParam = req.params.id;
    const idAsInt = /^\d+$/.test(idParam) ? Number(idParam) : -1;
    const result = await pool.query(
      'SELECT * FROM customers WHERE customer_id = $1 OR id = $2',
      [idParam, idAsInt]
    );
    const row = result.rows[0];
    if (!row) return res.status(404).json({ error: 'Customer not found' });
    const accounts = (await pool.query(
      'SELECT * FROM accounts WHERE customer_id = $1 ORDER BY opened_date ASC',
      [row.customer_id]
    )).rows;
    parseJsonField(row, ['beneficial_owners', 'directors', 'expected_transaction_types', 'primary_countries']);
    res.json({ ...row, accounts });
  } catch (err) { next(err); }
});

router.get('/:id/transactions', async (req, res, next) => {
  try {
    const { from, to, txn_type, min_amount, max_amount, alerted_only } = req.query;
    let sql = 'SELECT * FROM transactions WHERE customer_id = $1';
    const params = [req.params.id];
    let n = 1;
    if (from)       { params.push(from);              sql += ` AND txn_date >= $${++n}`; }
    if (to)         { params.push(to);                sql += ` AND txn_date <= $${++n}`; }
    if (txn_type)   { params.push(txn_type);          sql += ` AND txn_type = $${++n}`; }
    if (min_amount) { params.push(Number(min_amount));sql += ` AND amount >= $${++n}`; }
    if (max_amount) { params.push(Number(max_amount));sql += ` AND amount <= $${++n}`; }
    if (alerted_only === '1') { sql += ' AND is_alerted = 1'; }
    sql += ' ORDER BY txn_date DESC, txn_time DESC';
    const result = await pool.query(sql, params);
    res.json(result.rows);
  } catch (err) { next(err); }
});

router.get('/:id/alerts', async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT * FROM alerts WHERE customer_id = $1 ORDER BY created_date DESC',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

router.get('/:id/sars', async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT * FROM sar_filings WHERE customer_id = $1 ORDER BY detection_date DESC',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

// ─── Cross-Case Profile (Phase 4 prototype) ─────────────────────────────
// Surface for the Linked tab on the investigation workspace. Returns the
// customer's institution-wide footprint in ONE round-trip:
//   - total prior alerts
//   - alerts that resulted in a SAR
//   - first / last alert dates
//   - top N counterparties by transaction count
//
// This is the "Entity Intelligence Panel" surface from the CCEG spec
// (§7.1) wired to the existing customers/alerts/transactions tables.
// It does NOT read from the entity_golden_registry — the real CCEG
// graph backing is a later phase. Don't treat the output as the real
// graph; the structure is correct, the source is not.
router.get('/:id/cross-case-profile', async (req, res, next) => {
  try {
    const customerId = req.params.id;
    const limit = Math.min(Number(req.query.limit) || 5, 20);

    // Pull three aggregates concurrently — keeps the round-trip under
    // ~50ms on the demo dataset (~700 alerts, ~3.5k transactions).
    const [alertStats, sarCount, counterparties] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*)::int                                          AS total_alerts,
          COUNT(*) FILTER (WHERE linked_sar_id IS NOT NULL)::int AS alerts_with_sar,
          MIN(created_date)                                      AS first_seen,
          MAX(COALESCE(last_activity_date, created_date))        AS last_seen
        FROM alerts
        WHERE customer_id = $1
      `, [customerId]),
      pool.query(`
        SELECT COUNT(*)::int AS sar_count
        FROM sar_filings
        WHERE customer_id = $1
      `, [customerId]),
      pool.query(`
        SELECT
          counterparty                                             AS name,
          COUNT(*)::int                                            AS txn_count,
          COUNT(*) FILTER (WHERE is_alerted = 1)::int              AS alerted_txn_count,
          ROUND(SUM(amount)::numeric, 2)::float                    AS total_amount,
          COALESCE(MAX(counterparty_country), '')                  AS country
        FROM transactions
        WHERE customer_id = $1
          AND counterparty IS NOT NULL
          AND TRIM(counterparty) <> ''
        GROUP BY counterparty
        ORDER BY COUNT(*) DESC, SUM(amount) DESC
        LIMIT $2
      `, [customerId, limit])
    ]);

    const stats = alertStats.rows[0] || {};
    res.json({
      customer_id: customerId,
      total_alerts: stats.total_alerts || 0,
      alerts_with_sar: stats.alerts_with_sar || 0,
      sar_count: sarCount.rows[0]?.sar_count || 0,
      first_seen: stats.first_seen || null,
      last_seen: stats.last_seen || null,
      top_counterparties: counterparties.rows
    });
  } catch (err) { next(err); }
});

// ─── Cross-Case Entity Graph — graph payload (Phase 4 prototype) ────────
// Returns nodes + links for a force-directed visualisation rooted at the
// given customer. Mirrors the spec's "Surface 2 — Full-screen graph
// explorer" (CCEG §7.2) but reads from the existing customers / alerts /
// transactions / sar_filings tables, NOT from entity_golden_registry —
// the real graph backing is gated on Phase 2 + the §3.1 architectural
// decision. Same disclaimer as the cross-case-profile endpoint applies:
// the structure is correct, the source is a stopgap.
//
// Node id conventions (stable across calls so the client can dedupe):
//   c-<customer_id>      → Person/Company (focus or hop)
//   cp-<counterparty>    → Company (counterparty name as key — yes, this
//                                   is the free-text problem the audit
//                                   flagged; Phase 2 swaps to canonical
//                                   counterparty_id)
//   alert-<alert_id>     → Case
//   sar-<sar_id>         → SAR (omitted for L1 to match tipping-off
//                                posture; gated by the x-user-role header)
//
// Edge types match the spec's edge taxonomy (§4.3): TRANSACTS_WITH,
// APPEARS_IN, FILED_BY, CO_OCCURS_WITH (computed).
// FATF & sanctioned jurisdictions surfaced with an extra ring on the entity
// graph nodes. Match is case-insensitive on the raw country string from the
// transactions / customers tables.
const HIGH_RISK_COUNTRIES = new Set([
  'myanmar', 'syria', 'yemen', 'iran', 'russia', 'pakistan',
  'haiti', 'north korea', 'cuba', 'libya', 'sudan', 'somalia'
]);
function isHighRiskCountry(country) {
  if (!country) return false;
  return HIGH_RISK_COUNTRIES.has(String(country).trim().toLowerCase());
}

router.get('/:id/graph', async (req, res, next) => {
  try {
    const customerId = req.params.id;
    const role = req.headers['x-user-role'];
    const includeSars = role !== 'analyst_l1';

    // Caps balance legibility vs. completeness. Bumped from the original
    // tighter values once the layout proved to handle ~40 nodes well.
    const COUNTERPARTY_LIMIT = 12;
    const CASE_LIMIT = 8;
    const NEIGHBOUR_LIMIT = 6;

    // ── 1. Focus customer (one node, always present)
    // Extra columns (customer_since_date, cdd_level, job_title, industry)
    // power the redesigned right-side detail panel. The real schema uses
    // job_title for individuals + industry for businesses; there is no
    // generic `occupation` column.
    const focusRes = await pool.query(
      `SELECT customer_id, customer_name, customer_type,
              customer_risk_rating, pep_match, sanctions_match,
              country_of_residence, country_of_incorporation,
              customer_since_date, cdd_level, job_title, industry
         FROM customers WHERE customer_id = $1`,
      [customerId]
    );
    if (focusRes.rowCount === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    const focus = focusRes.rows[0];

    // ── 2. Top counterparties (by transaction count)
    const cpRes = await pool.query(
      `SELECT counterparty,
              COUNT(*)::int AS txn_count,
              COUNT(*) FILTER (WHERE is_alerted = 1)::int AS alerted_txn_count,
              ROUND(SUM(amount)::numeric, 2)::float AS total_amount,
              MAX(counterparty_country) AS country
         FROM transactions
        WHERE customer_id = $1
          AND counterparty IS NOT NULL
          AND TRIM(counterparty) <> ''
        GROUP BY counterparty
        ORDER BY COUNT(*) DESC, SUM(amount) DESC
        LIMIT $2`,
      [customerId, COUNTERPARTY_LIMIT]
    );

    // ── 3. Recent alerts (cases in graph terms) — keep recent + open ones.
    // rule_explanation is selected so the alert detail panel can show a
    // short rule summary without a second round-trip.
    const alertRes = await pool.query(
      `SELECT alert_id, scenario, alert_status, priority,
              created_date, linked_sar_id, amount_flagged_inr,
              rule_explanation
         FROM alerts
        WHERE customer_id = $1
        ORDER BY created_date DESC
        LIMIT $2`,
      [customerId, CASE_LIMIT]
    );

    // ── 4. SARs (only for non-L1 callers — tipping-off posture).
    // filing_type + amount_involved_inr selected for the SAR detail panel.
    let sarRows = [];
    if (includeSars) {
      const sarRes = await pool.query(
        `SELECT sar_id, sar_status, filed_date, source_alert_id,
                filing_type, amount_involved_inr
           FROM sar_filings
          WHERE customer_id = $1
          ORDER BY COALESCE(filed_date::text, detection_date) DESC
          LIMIT 10`,
        [customerId]
      );
      sarRows = sarRes.rows;
    }

    // ── 5. Other customers who share a counterparty (cross-case neighbours).
    // Country pulled in so the FATF/sanctioned-jurisdiction ring can render
    // on neighbour nodes too — not just focus + counterparties.
    // Extra customer columns mirror the focus payload so neighbour detail
    // panels can show the same profile fields.
    const neighbourRes = await pool.query(
      `SELECT DISTINCT ON (t2.customer_id)
              t2.customer_id, c.customer_name, c.customer_type,
              c.customer_risk_rating, c.pep_match, c.sanctions_match,
              c.country_of_residence, c.country_of_incorporation,
              c.customer_since_date, c.cdd_level, c.job_title, c.industry,
              t2.counterparty AS via_counterparty
         FROM transactions t1
         JOIN transactions t2
           ON LOWER(TRIM(t1.counterparty)) = LOWER(TRIM(t2.counterparty))
          AND t1.counterparty IS NOT NULL
          AND TRIM(t1.counterparty) <> ''
         JOIN customers c ON c.customer_id = t2.customer_id
        WHERE t1.customer_id = $1
          AND t2.customer_id <> $1
        ORDER BY t2.customer_id
        LIMIT $2`,
      [customerId, NEIGHBOUR_LIMIT]
    );

    // ── Build nodes + links ────────────────────────────────────────────
    const nodes = [];
    const links = [];
    const seenNodes = new Set();

    const addNode = (n) => {
      if (seenNodes.has(n.id)) return;
      seenNodes.add(n.id);
      nodes.push(n);
    };

    // Focus
    const focusCountry = focus.country_of_residence || focus.country_of_incorporation;
    addNode({
      id: `c-${focus.customer_id}`,
      type: focus.customer_type === 'Business' ? 'COMPANY' : 'PERSON',
      label: focus.customer_name,
      customer_id: focus.customer_id,
      customer_type: focus.customer_type,
      risk: focus.customer_risk_rating,
      pep: !!focus.pep_match,
      sanctions: !!focus.sanctions_match,
      country: focusCountry,
      is_high_risk_country: isHighRiskCountry(focusCountry),
      customer_since: focus.customer_since_date || null,
      cdd_level: focus.cdd_level || null,
      occupation: focus.job_title || null,
      industry: focus.industry || null,
      is_focus: true
    });

    // Counterparties + their TRANSACTS_WITH edges. The link payload now
    // carries `alerted_count` (not just the boolean flag) so the edge-hover
    // tooltip can render "N alerted" without a second round-trip.
    for (const cp of cpRes.rows) {
      const cpId = `cp-${cp.counterparty}`;
      addNode({
        id: cpId,
        type: 'COMPANY',
        label: cp.counterparty,
        country: cp.country || null,
        is_high_risk_country: isHighRiskCountry(cp.country),
        is_counterparty: true,
        alerted_txn_count: cp.alerted_txn_count
      });
      links.push({
        source: `c-${focus.customer_id}`,
        target: cpId,
        type: 'TRANSACTS_WITH',
        txn_count: cp.txn_count,
        total_amount: cp.total_amount,
        alerted_count: cp.alerted_txn_count,
        alerted: cp.alerted_txn_count > 0
      });
    }

    // Alerts (cases) + APPEARS_IN edges
    // Parse rule_explanation JSON once on the server so the client gets a
    // ready-to-render object (the column is JSONB in practice but TEXT in
    // some seed paths — both shapes are handled).
    for (const a of alertRes.rows) {
      const alertId = `alert-${a.alert_id}`;
      let ruleExplanation = a.rule_explanation || null;
      if (typeof ruleExplanation === 'string') {
        try { ruleExplanation = JSON.parse(ruleExplanation); } catch (_e) { /* keep string */ }
      }
      addNode({
        id: alertId,
        type: 'CASE',
        label: a.alert_id,
        alert_id: a.alert_id,
        customer_name: focus.customer_name,
        scenario: a.scenario,
        priority: a.priority,
        status: a.alert_status,
        amount: a.amount_flagged_inr,
        created_date: a.created_date,
        rule_explanation: ruleExplanation
      });
      links.push({
        source: `c-${focus.customer_id}`,
        target: alertId,
        type: 'APPEARS_IN'
      });

      // FILED_BY edge: alert → SAR (only if SAR included).
      // If the SAR isn't already in seenNodes from sarRows, we hydrate from
      // the matching row in sarRows when available so the detail panel still
      // gets filing_type / amount / filed_date; otherwise we add a stub node.
      if (includeSars && a.linked_sar_id) {
        const sarId = `sar-${a.linked_sar_id}`;
        if (!seenNodes.has(sarId)) {
          const matchingSar = sarRows.find(s => s.sar_id === a.linked_sar_id);
          addNode({
            id: sarId,
            type: 'SAR',
            label: a.linked_sar_id,
            sar_id: a.linked_sar_id,
            status: matchingSar?.sar_status || 'Filed',
            filed_date: matchingSar?.filed_date || null,
            filing_type: matchingSar?.filing_type || null,
            amount: matchingSar?.amount_involved_inr != null ? Number(matchingSar.amount_involved_inr) : null
          });
        }
        links.push({
          source: alertId,
          target: sarId,
          type: 'FILED_BY'
        });
      }
    }

    // SARs that didn't come through an alert linkage above
    for (const s of sarRows) {
      const sarId = `sar-${s.sar_id}`;
      if (!seenNodes.has(sarId)) {
        addNode({
          id: sarId,
          type: 'SAR',
          label: s.sar_id,
          sar_id: s.sar_id,
          status: s.sar_status,
          filed_date: s.filed_date,
          filing_type: s.filing_type || null,
          amount: s.amount_involved_inr != null ? Number(s.amount_involved_inr) : null
        });
        // Connect to the focus customer directly (SUBJECT_OF in spec terms)
        links.push({
          source: `c-${focus.customer_id}`,
          target: sarId,
          type: 'SUBJECT_OF'
        });
      }
    }

    // Cross-case neighbours (customers who share a counterparty with focus)
    for (const n of neighbourRes.rows) {
      const nId = `c-${n.customer_id}`;
      const neighbourCountry = n.country_of_residence || n.country_of_incorporation;
      addNode({
        id: nId,
        type: n.customer_type === 'Business' ? 'COMPANY' : 'PERSON',
        label: n.customer_name,
        customer_id: n.customer_id,
        customer_type: n.customer_type,
        risk: n.customer_risk_rating,
        pep: !!n.pep_match,
        sanctions: !!n.sanctions_match,
        country: neighbourCountry,
        is_high_risk_country: isHighRiskCountry(neighbourCountry),
        customer_since: n.customer_since_date || null,
        cdd_level: n.cdd_level || null,
        occupation: n.job_title || null,
        industry: n.industry || null,
        via_counterparty: n.via_counterparty || null,
        is_neighbour: true
      });
      // Hub-via-counterparty edge (computed). The counterparty node may
      // not be in the limit; we connect through it if it is, otherwise
      // we draw the direct neighbour→focus edge.
      const cpHubId = `cp-${n.via_counterparty}`;
      if (seenNodes.has(cpHubId)) {
        links.push({
          source: nId,
          target: cpHubId,
          type: 'TRANSACTS_WITH',
          computed: true
        });
      } else {
        links.push({
          source: `c-${focus.customer_id}`,
          target: nId,
          type: 'CO_OCCURS_WITH',
          via: n.via_counterparty,
          computed: true
        });
      }
    }

    res.json({
      focus_id: `c-${focus.customer_id}`,
      nodes,
      links,
      meta: {
        counterparty_count: cpRes.rowCount,
        alert_count: alertRes.rowCount,
        sar_count: sarRows.length,
        neighbour_count: neighbourRes.rowCount,
        sars_included: includeSars
      }
    });
  } catch (err) { next(err); }
});

module.exports = router;
