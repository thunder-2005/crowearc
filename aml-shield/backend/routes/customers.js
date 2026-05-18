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

// ═══════════════════════════════════════════════════════════════════════════
// GRAPH ENDPOINT AUDIT — pre-C-10 refactor
//
// The pre-refactor `/api/customers/:id/graph` (this route) builds the
// CCEG Phase 4 prototype payload from FIVE parallel SQL queries:
//
//   1. focus customer   — SELECT … FROM customers WHERE customer_id = $1
//                         (one row; powers the focus node).
//   2. top counterparties
//      — `SELECT counterparty, COUNT(*) AS txn_count, ... FROM transactions
//          WHERE customer_id = $1 AND counterparty IS NOT NULL AND
//                TRIM(counterparty) <> ''
//          GROUP BY counterparty ORDER BY COUNT(*) DESC LIMIT 12`
//      → GROUPS BY THE RAW FREE-TEXT STRING. That is the audit gap C-10
//        is fixing — "First Capital LLC" and "First Capital, LLC" become
//        two distinct entities in the graph.
//   3. recent alerts    — SELECT … FROM alerts WHERE customer_id = $1 LIMIT 8
//   4. SARs             — SELECT … FROM sar_filings WHERE customer_id = $1
//                         (role-gated; L1 doesn't see this query at all).
//   5. shared-counterparty neighbours
//      — `... FROM transactions t1 JOIN transactions t2
//           ON LOWER(TRIM(t1.counterparty)) = LOWER(TRIM(t2.counterparty))
//          ...`
//      → joins on a LOWER(TRIM(…)) equality of the raw string. Helpful
//        as a first pass but punctuation differences ("First Capital LLC"
//        vs "First Capital, LLC") still partition the same real entity.
//        This is the query most broken by the free-text problem.
//
// Counterparty node IDs are `cp-${counterparty}` — i.e. the literal raw
// string after the prefix. Two graphs of two customers transacting with
// the same entity but with different capitalisation will paint two
// different counterparty nodes, and the shared-counterparty edge that
// SHOULD bind them gets dropped.
//
// Response shape (unchanged across C-10):
//   {
//     focus_id: 'c-<customer_id>',
//     nodes:    [ { id, type, label, ...node-type-specific fields } ],
//     links:    [ { source, target, type, ...edge-type-specific fields } ],
//     meta:     { counterparty_count, alert_count, sar_count,
//                 neighbour_count, sars_included }
//   }
//
// C-10 (Counterparty as First-Class Entity) replaces queries 2 and 5
// with Phase A (counterparty_normalised generated column — interim fix)
// or Phase B (counterparty_id FK to the new counterparties table —
// final state once the dedup backfill has run). Detection is at query
// time. The response shape stays additive: existing fields preserved,
// new fields appended.
// ═══════════════════════════════════════════════════════════════════════════

// ─── Cross-Case Entity Graph — graph payload (Phase 4 prototype) ────────
// Returns nodes + links for a force-directed visualisation rooted at the
// given customer. Mirrors the spec's "Surface 2 — Full-screen graph
// explorer" (CCEG §7.2). Same disclaimer as the cross-case-profile
// endpoint applies: the structure is correct, the source layer is the
// existing customers / alerts / transactions / sar_filings tables until
// CCEG Phase 2 lands.
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

    // ── Phase A vs Phase B detection ────────────────────────────────────
    // Phase B (counterparty_id FK is populated) is preferred. Probe the
    // counterparties table for any row with a non-zero transaction_count
    // — that's the marker the backfill has run. Failure of either query
    // (e.g. migration 004 not yet applied) falls back to Phase A.
    let graphPhase = 'normalised';
    try {
      const probe = await pool.query(
        `SELECT 1 FROM counterparties WHERE transaction_count > 0 LIMIT 1`
      );
      if (probe.rowCount > 0) graphPhase = 'entity_fk';
    } catch (_e) { /* counterparties table missing → Phase A */ }

    // ── 2. Top counterparties (by transaction count) — phase-aware
    // Phase A groups by counterparty_normalised (the STORED generated
    // column from migration 004 — dedups capitalisation / punctuation
    // differences immediately, no backfill required).
    // Phase B groups by the FK and joins counterparties for canonical
    // display + global stats + risk indicators.
    const cpRes = graphPhase === 'entity_fk'
      ? await pool.query(
          `SELECT cp.id                                                 AS counterparty_id,
                  cp.canonical_name                                     AS canonical_name,
                  cp.counterparty_type                                  AS counterparty_type,
                  cp.risk_indicators                                    AS risk_indicators,
                  cp.transaction_count                                  AS global_txn_count,
                  cp.total_volume                                       AS global_total_volume,
                  COUNT(t.*)::int                                       AS txn_count,
                  COUNT(t.*) FILTER (WHERE t.is_alerted = 1)::int       AS alerted_txn_count,
                  ROUND(COALESCE(SUM(t.amount), 0)::numeric, 2)::float  AS total_amount,
                  MAX(t.counterparty_country)                           AS country,
                  (SELECT COUNT(DISTINCT customer_id) FROM transactions
                    WHERE counterparty_id = cp.id)::int                 AS shared_with_customer_count
             FROM transactions t
             JOIN counterparties cp ON cp.id = t.counterparty_id
            WHERE t.customer_id = $1
              AND cp.is_merged_away = FALSE
            GROUP BY cp.id, cp.canonical_name, cp.counterparty_type,
                     cp.risk_indicators, cp.transaction_count, cp.total_volume
            ORDER BY COUNT(t.*) DESC, SUM(t.amount) DESC
            LIMIT $2`,
          [customerId, COUNTERPARTY_LIMIT]
        )
      : await pool.query(
          // Phase A: no MAX(counterparty_id) aggregate — Postgres has no
          // MAX(uuid) aggregate, and Phase A by definition does not trust
          // the FK column. counterparty_id stays NULL on these nodes; the
          // node-construction code handles that path.
          `SELECT counterparty_normalised                                AS normalised_name,
                  MIN(counterparty)                                      AS display_name,
                  COUNT(*)::int                                          AS txn_count,
                  COUNT(*) FILTER (WHERE is_alerted = 1)::int            AS alerted_txn_count,
                  ROUND(SUM(amount)::numeric, 2)::float                  AS total_amount,
                  MAX(counterparty_country)                              AS country
             FROM transactions
            WHERE customer_id = $1
              AND counterparty IS NOT NULL
              AND TRIM(counterparty) <> ''
              AND counterparty_normalised IS NOT NULL
            GROUP BY counterparty_normalised
            ORDER BY COUNT(*) DESC, SUM(amount) DESC
            LIMIT $2`,
          [customerId, COUNTERPARTY_LIMIT]
        );

    // ── 3. Recent alerts (cases in graph terms) — keep recent + open ones.
    // rule_explanation is selected so the alert detail panel can show a
    // short rule summary without a second round-trip. assigned_to and
    // disposition fields feed the right-panel timeline (line 3 + status).
    const alertRes = await pool.query(
      `SELECT alert_id, scenario, alert_status, priority,
              created_date, linked_sar_id, amount_flagged_inr,
              rule_explanation, assigned_to, disposition
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
                filing_type, amount_involved_inr,
                LEFT(COALESCE(narrative_summary, narrative, ''), 120)
                  AS narrative_summary
           FROM sar_filings
          WHERE customer_id = $1
          ORDER BY COALESCE(filed_date::text, detection_date) DESC
          LIMIT 10`,
        [customerId]
      );
      sarRows = sarRes.rows;
    }

    // ── 5. Other customers who share a counterparty (cross-case neighbours).
    // Phase B: join via counterparty_id — the proper entity equality.
    // Phase A: fall back to counterparty_normalised equality — strictly
    // better than the pre-C-10 LOWER(TRIM(...)) join (handles punctuation
    // differences too), but still text-based.
    // Phase B additionally returns the canonical name + the canonical
    // counterparty id so the neighbour edge can hop through the proper
    // counterparty node.
    const neighbourRes = graphPhase === 'entity_fk'
      ? await pool.query(
          `SELECT DISTINCT ON (t2.customer_id)
                  t2.customer_id, c.customer_name, c.customer_type,
                  c.customer_risk_rating, c.pep_match, c.sanctions_match,
                  c.country_of_residence, c.country_of_incorporation,
                  c.customer_since_date, c.cdd_level, c.job_title, c.industry,
                  cp.canonical_name           AS via_counterparty,
                  cp.id                       AS via_counterparty_id
             FROM transactions t1
             JOIN transactions t2 ON t1.counterparty_id = t2.counterparty_id
             JOIN counterparties cp ON cp.id = t1.counterparty_id
             JOIN customers c ON c.customer_id = t2.customer_id
            WHERE t1.customer_id = $1
              AND t2.customer_id <> $1
              AND t1.counterparty_id IS NOT NULL
              AND cp.is_merged_away = FALSE
            ORDER BY t2.customer_id
            LIMIT $2`,
          [customerId, NEIGHBOUR_LIMIT]
        )
      : await pool.query(
          `SELECT DISTINCT ON (t2.customer_id)
                  t2.customer_id, c.customer_name, c.customer_type,
                  c.customer_risk_rating, c.pep_match, c.sanctions_match,
                  c.country_of_residence, c.country_of_incorporation,
                  c.customer_since_date, c.cdd_level, c.job_title, c.industry,
                  t2.counterparty                 AS via_counterparty,
                  t2.counterparty_normalised      AS via_counterparty_normalised
             FROM transactions t1
             JOIN transactions t2
               ON t1.counterparty_normalised = t2.counterparty_normalised
              AND t1.counterparty_normalised IS NOT NULL
              AND TRIM(t1.counterparty_normalised) <> ''
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

    // Counterparties + their TRANSACTS_WITH edges. In Phase B the node id
    // is `cp-<uuid>` (canonical FK); in Phase A it's `cp-<normalised>` so
    // it's stable across calls and dedups capitalisation. Phase B adds
    // the rich entity fields the frontend uses for the diamond visual,
    // hub ring, and details panel.
    for (const cp of cpRes.rows) {
      const isPhaseB = graphPhase === 'entity_fk' && cp.counterparty_id;
      const cpKey = isPhaseB ? cp.counterparty_id : (cp.normalised_name || cp.display_name || 'unknown');
      const cpId = `cp-${cpKey}`;
      const label = isPhaseB ? cp.canonical_name : (cp.display_name || cp.normalised_name || 'Unknown');
      const risk = isPhaseB && cp.risk_indicators
        ? (typeof cp.risk_indicators === 'string' ? JSON.parse(cp.risk_indicators) : cp.risk_indicators)
        : {};
      const isHighRisk = !!(risk.pep || risk.sanctions_hit || risk.high_risk_jurisdiction);

      addNode({
        id: cpId,
        type: 'COMPANY',
        label,
        country: cp.country || null,
        is_high_risk_country: isHighRiskCountry(cp.country),
        is_counterparty: true,
        alerted_txn_count: cp.alerted_txn_count,
        // C-10 first-class entity fields. In Phase A these mostly collapse
        // to the same values as txn_count, but the shape is identical so
        // the frontend doesn't branch on phase.
        counterparty_id: cp.counterparty_id || null,
        counterparty_type: cp.counterparty_type || 'unknown',
        txn_count: isPhaseB ? Number(cp.global_txn_count) || cp.txn_count : cp.txn_count,
        txn_count_with_focus: cp.txn_count,
        total_volume: isPhaseB ? Number(cp.global_total_volume) || cp.total_amount : cp.total_amount,
        risk_indicators: risk,
        is_high_risk_counterparty: isHighRisk,
        // shared_with_customer_count is capped at 99 for display (avoids
        // leaking the institution-wide customer count when the entity is
        // very popular).
        shared_with_customer_count: isPhaseB
          ? Math.min(99, Number(cp.shared_with_customer_count) || 0)
          : 0
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
        rule_explanation: ruleExplanation,
        // Timeline-card fields. assigned_to powers line 3 of the
        // right-panel timeline; disposition surfaces the closure reason.
        assigned_to: a.assigned_to || null,
        disposition: a.disposition || null
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
            amount: matchingSar?.amount_involved_inr != null ? Number(matchingSar.amount_involved_inr) : null,
            // Timeline narrative preview (truncated server-side to 120
            // chars). SARs themselves are gated by `includeSars`, so
            // L1 never reaches this addNode call.
            narrative_summary: matchingSar?.narrative_summary || null
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
          amount: s.amount_involved_inr != null ? Number(s.amount_involved_inr) : null,
          narrative_summary: s.narrative_summary || null
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
      // we draw the direct neighbour→focus edge. Phase B uses the
      // canonical counterparty id; Phase A falls back to the normalised
      // name (matching the addNode call above).
      const hubKey = graphPhase === 'entity_fk' && n.via_counterparty_id
        ? n.via_counterparty_id
        : (n.via_counterparty_normalised || n.via_counterparty || 'unknown');
      const cpHubId = `cp-${hubKey}`;
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
        sars_included: includeSars,
        // C-10: tells the frontend which dedup layer the graph was built
        // from. 'normalised' = interim string-equality on the generated
        // column; 'entity_fk' = proper counterparty_id join.
        graphPhase
      }
    });
  } catch (err) { next(err); }
});

module.exports = router;
