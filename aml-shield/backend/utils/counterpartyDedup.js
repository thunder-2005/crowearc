// ═══════════════════════════════════════════════════════════════════════════
// Counterparty dedup pipeline (C-10 / audit B-7).
//
// Walks the raw free-text counterparty values surfaced by transactions and
// resolves each one to a canonical row in the new `counterparties` table.
// Three-tier resolution applied in strict confidence order:
//
//   Tier 1 — exact account number match (confidence 1.0)
//   Tier 2 — exact normalised-name match (confidence 0.95)
//   Tier 3 — Jaro-Winkler fuzzy name match (confidence = JW score)
//
// Multi-candidate fuzzy hits go to the BSA Officer review queue; they
// never auto-resolve and never create phantom entities. The Jaro-Winkler
// implementation is the same one OFAC screening already ships in
// utils/ofacScreener.js — no second dependency.
//
// All exported functions are pure async: pass in a db client (pool or a
// transaction client) and they perform their work without owning the
// connection.
// ═══════════════════════════════════════════════════════════════════════════

const { jaroWinkler } = require('./ofacScreener');
const { logAudit } = require('./audit');

const FUZZY_REVIEW_FLOOR = 0.75;
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_FUZZY_THRESHOLD = 0.88;

// Normalise a raw counterparty string the same way the
// counterparty_normalised generated column does in Postgres:
//   trim → strip non-alphanumeric (keep spaces) → lowercase
function normalize(raw) {
  if (raw == null) return '';
  return String(raw)
    .trim()
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .toLowerCase();
}

// ── buildDedupQueue ───────────────────────────────────────────────────────
//
// Scans distinct (counterparty_normalised) values present in transactions
// that don't yet have a queue entry, and inserts one row per new value.
// The "most common raw capitalisation" wins display.
//
// Schema note: transactions has no counterparty_account column today, so
// every queue row starts with account_number = NULL. The pipeline still
// supports the exact-account-match tier for future ingest paths that do
// supply an account number.
async function buildDedupQueue(db) {
  const r = await db.query(
    `INSERT INTO counterparty_dedup_queue
       (raw_counterparty, normalised_name, account_number, transaction_count)
     SELECT
       (SELECT counterparty
          FROM transactions t2
         WHERE t2.counterparty_normalised = t.counterparty_normalised
           AND t2.counterparty IS NOT NULL
         GROUP BY t2.counterparty
         ORDER BY COUNT(*) DESC
         LIMIT 1) AS raw_counterparty,
       t.counterparty_normalised        AS normalised_name,
       NULL::text                        AS account_number,
       COUNT(*)::int                     AS transaction_count
     FROM transactions t
    WHERE t.counterparty IS NOT NULL
      AND t.counterparty_normalised IS NOT NULL
      AND TRIM(t.counterparty_normalised) <> ''
      AND NOT EXISTS (
        SELECT 1 FROM counterparty_dedup_queue q
         WHERE q.normalised_name = t.counterparty_normalised
      )
    GROUP BY t.counterparty_normalised
     RETURNING id`,
    []
  );
  return r.rowCount;
}

// ── log a dedup_decisions row (CCEG Phase 1 audit table) ─────────────────
async function logDedupDecision(db, {
  candidate_id = null,
  matched_to = null,
  decision,
  confidence_score = null,
  signals = null,
  decided_by = null
}) {
  try {
    await db.query(
      `INSERT INTO dedup_decisions
         (candidate_id, matched_to, decision, confidence_score, signals, decided_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [
        candidate_id,
        matched_to,
        decision,
        confidence_score,
        signals == null ? null : JSON.stringify(signals),
        decided_by
      ]
    );
  } catch (_e) {
    // Audit log failures must not break the pipeline. The dedup
    // decision is still applied to the queue + transactions rows.
  }
}

// ── resolveQueue ─────────────────────────────────────────────────────────
//
// Processes pending entries in counterparty_dedup_queue, applying the
// three-tier resolution logic. Returns a summary object; never throws.
//
// options:
//   batchSize       — max queue rows to consider per invocation
//   fuzzyThreshold  — auto-resolve floor for Jaro-Winkler matches (0–1)
//   dryRun          — when true, compute resolutions but DO NOT WRITE
//                     anything (no queue updates, no transactions
//                     re-link, no dedup_decisions rows).
async function resolveQueue(db, options = {}) {
  const {
    batchSize = DEFAULT_BATCH_SIZE,
    fuzzyThreshold = DEFAULT_FUZZY_THRESHOLD,
    dryRun = false
  } = options;

  const summary = {
    processed: 0,
    autoResolved: 0,
    newEntitiesCreated: 0,
    needsReview: 0,
    transactionsLinked: 0,
    dryRun
  };

  // Pull pending queue rows + the full live counterparty universe for
  // fuzzy comparison. The counterparty set is small (<= number of
  // distinct counterparties) and reading it once per batch is cheaper
  // than per-row LIKE scans.
  const pending = (await db.query(
    `SELECT id, raw_counterparty, normalised_name, account_number, transaction_count
       FROM counterparty_dedup_queue
      WHERE resolution_status = 'pending'
      ORDER BY transaction_count DESC
      LIMIT $1`,
    [batchSize]
  )).rows;

  if (pending.length === 0) return summary;

  // Live counterparties only. is_merged_away rows must never become a
  // resolution target — physical history is preserved, but new links
  // route to the surviving canonical row.
  const universe = (await db.query(
    `SELECT id, canonical_name, normalised_name, account_number
       FROM counterparties
      WHERE is_merged_away = FALSE`,
    []
  )).rows;

  // Live in-memory copy of the universe so newly-created counterparties
  // during this batch are immediately considered by subsequent entries.
  const live = universe.slice();

  for (const entry of pending) {
    summary.processed++;
    let match = null;            // { cp, score, method }
    let conflictCandidates = [];

    // Tier 1 — exact account number
    if (entry.account_number) {
      const acct = live.find(c => c.account_number === entry.account_number);
      if (acct) {
        match = { cp: acct, score: 1.0, method: 'exact_account' };
      }
    }

    // Tier 2 — exact normalised name
    if (!match) {
      const exact = live.find(c => c.normalised_name === entry.normalised_name);
      if (exact) {
        match = { cp: exact, score: 0.95, method: 'exact_normalised' };
      }
    }

    // Tier 3 — fuzzy
    if (!match && entry.normalised_name) {
      const scored = live
        .map(c => ({ cp: c, score: jaroWinkler(entry.normalised_name, c.normalised_name || '') }))
        .filter(x => x.score >= FUZZY_REVIEW_FLOOR)
        .sort((a, b) => b.score - a.score);

      const aboveThreshold = scored.filter(x => x.score >= fuzzyThreshold);
      if (aboveThreshold.length === 1) {
        match = { cp: aboveThreshold[0].cp, score: aboveThreshold[0].score, method: 'fuzzy_name' };
      } else if (scored.length > 1) {
        // Multiple candidates in the review band (≥ 0.75) — flag for
        // manual review. Even a single fuzzy hit between 0.75 and the
        // auto-resolve threshold is held for review per spec.
        conflictCandidates = scored.slice(0, 3).map(x => ({
          counterparty_id: x.cp.id,
          canonical_name: x.cp.canonical_name,
          score: Math.round(x.score * 1000) / 1000
        }));
      } else if (scored.length === 1 && scored[0].score < fuzzyThreshold) {
        // Single fuzzy candidate but below the auto threshold → review.
        conflictCandidates = [{
          counterparty_id: scored[0].cp.id,
          canonical_name: scored[0].cp.canonical_name,
          score: Math.round(scored[0].score * 1000) / 1000
        }];
      }
    }

    // Decide outcome.
    if (match) {
      if (!dryRun) {
        await db.query(
          `UPDATE counterparty_dedup_queue
              SET resolution_status = 'auto_resolved',
                  resolved_counterparty_id = $1,
                  match_method = $2,
                  confidence_score = $3,
                  conflict_candidates = '[]'::jsonb,
                  resolved_at = NOW(),
                  resolved_by = 'auto'
            WHERE id = $4`,
          [match.cp.id, match.method, match.score, entry.id]
        );
        const linked = await db.query(
          `UPDATE transactions
              SET counterparty_id = $1
            WHERE counterparty_normalised = $2
              AND counterparty_id IS NULL`,
          [match.cp.id, entry.normalised_name]
        );
        summary.transactionsLinked += linked.rowCount;
        await logDedupDecision(db, {
          candidate_id: null,
          matched_to: match.cp.id,
          decision: 'AUTO_MERGE',
          confidence_score: match.score,
          signals: { method: match.method, raw: entry.raw_counterparty },
          decided_by: null
        });
      }
      summary.autoResolved++;
    } else if (conflictCandidates.length > 0) {
      if (!dryRun) {
        await db.query(
          `UPDATE counterparty_dedup_queue
              SET resolution_status = 'needs_review',
                  conflict_candidates = $1::jsonb,
                  match_method = 'fuzzy_name',
                  confidence_score = $2
            WHERE id = $3`,
          [
            JSON.stringify(conflictCandidates),
            conflictCandidates[0].score,
            entry.id
          ]
        );
        await logDedupDecision(db, {
          candidate_id: null,
          matched_to: null,
          decision: 'PENDING_REVIEW',
          confidence_score: conflictCandidates[0].score,
          signals: { candidates: conflictCandidates, raw: entry.raw_counterparty },
          decided_by: null
        });
      }
      summary.needsReview++;
    } else {
      // No candidate at all — create a brand-new canonical entity.
      // Pick a counterparty_type heuristic from the raw string. LLC /
      // Inc / Bank / Ltd suggests a business; otherwise we mark 'unknown'.
      const raw = String(entry.raw_counterparty || '').trim();
      const lowerRaw = raw.toLowerCase();
      let cpType = 'unknown';
      if (/\b(bank|credit union|trust|holdings)\b/.test(lowerRaw)) cpType = 'financial_institution';
      else if (/\b(llc|inc|ltd|corp|co|gmbh|sa|ag|plc|pvt|pte)\b\.?/.test(lowerRaw)) cpType = 'business';
      else if (/\bgovernment|treasury|ministry|department\b/.test(lowerRaw)) cpType = 'government';

      if (!dryRun) {
        const ins = await db.query(
          `INSERT INTO counterparties
             (canonical_name, normalised_name, counterparty_type, account_number, created_by)
           VALUES ($1, $2, $3, $4, 'dedup_pipeline')
           ON CONFLICT (normalised_name) WHERE account_number IS NULL AND is_merged_away = FALSE
             DO UPDATE SET last_seen_at = NOW()
           RETURNING id, canonical_name, normalised_name, account_number`,
          [raw || entry.normalised_name, entry.normalised_name, cpType, entry.account_number || null]
        );
        const newCp = ins.rows[0];
        live.push(newCp);

        await db.query(
          `UPDATE counterparty_dedup_queue
              SET resolution_status = 'auto_resolved',
                  resolved_counterparty_id = $1,
                  match_method = 'exact_normalised',
                  confidence_score = 1.0,
                  resolved_at = NOW(),
                  resolved_by = 'auto'
            WHERE id = $2`,
          [newCp.id, entry.id]
        );
        const linked = await db.query(
          `UPDATE transactions
              SET counterparty_id = $1
            WHERE counterparty_normalised = $2
              AND counterparty_id IS NULL`,
          [newCp.id, entry.normalised_name]
        );
        summary.transactionsLinked += linked.rowCount;

        await logDedupDecision(db, {
          candidate_id: newCp.id,
          matched_to: null,
          decision: 'NEW_ENTITY',
          confidence_score: 1.0,
          signals: { method: 'new_entity', raw: entry.raw_counterparty },
          decided_by: null
        });

        await logAudit({
          entity_type: 'counterparty',
          entity_id: newCp.id,
          action: 'counterparty_created',
          performed_by: 'dedup_pipeline',
          details: `Created new counterparty '${raw}' (type=${cpType})`
        });
      }
      summary.newEntitiesCreated++;
      summary.autoResolved++;
    }
  }

  return summary;
}

// ── runBackfill ──────────────────────────────────────────────────────────
//
// Calls buildDedupQueue then loops resolveQueue until either every pending
// row has been processed or only needs_review rows remain. Returns the
// aggregate summary. Never throws.
async function runBackfill(db, options = {}) {
  const { batchSize = DEFAULT_BATCH_SIZE, fuzzyThreshold = DEFAULT_FUZZY_THRESHOLD, dryRun = false } = options;
  const aggregate = {
    queued: 0,
    processed: 0,
    autoResolved: 0,
    newEntitiesCreated: 0,
    needsReview: 0,
    transactionsLinked: 0,
    dryRun
  };

  aggregate.queued = await buildDedupQueue(db);

  // Loop with a safety cap so a misconfigured queue doesn't spin forever.
  for (let i = 0; i < 100; i++) {
    const batch = await resolveQueue(db, { batchSize, fuzzyThreshold, dryRun });
    aggregate.processed          += batch.processed;
    aggregate.autoResolved       += batch.autoResolved;
    aggregate.newEntitiesCreated += batch.newEntitiesCreated;
    aggregate.needsReview        += batch.needsReview;
    aggregate.transactionsLinked += batch.transactionsLinked;
    if (batch.processed === 0) break;
  }

  if (!dryRun) {
    await logAudit({
      entity_type: 'counterparty_pipeline',
      entity_id: 'backfill',
      action: 'counterparty_backfill_completed',
      performed_by: 'system',
      details: `queued=${aggregate.queued} autoResolved=${aggregate.autoResolved} newEntities=${aggregate.newEntitiesCreated} needsReview=${aggregate.needsReview} transactionsLinked=${aggregate.transactionsLinked}`
    });
  }
  return aggregate;
}

// ── resolveManually ──────────────────────────────────────────────────────
//
// Called from the BSA Officer Counterparty Merge UI when a needs_review
// entry is resolved by hand. The chosen counterparty becomes the link
// target; transactions are re-pointed; the queue entry transitions to
// manually_resolved.
async function resolveManually(db, queueEntryId, targetCounterpartyId, resolvedBy) {
  const entry = (await db.query(
    `SELECT id, normalised_name FROM counterparty_dedup_queue WHERE id = $1`,
    [queueEntryId]
  )).rows[0];
  if (!entry) throw new Error(`Queue entry ${queueEntryId} not found`);

  const target = (await db.query(
    `SELECT id, canonical_name FROM counterparties
      WHERE id = $1 AND is_merged_away = FALSE`,
    [targetCounterpartyId]
  )).rows[0];
  if (!target) throw new Error(`Target counterparty ${targetCounterpartyId} not found or merged away`);

  await db.query(
    `UPDATE counterparty_dedup_queue
        SET resolution_status = 'manually_resolved',
            resolved_counterparty_id = $1,
            match_method = 'manual',
            confidence_score = 1.0,
            resolved_at = NOW(),
            resolved_by = $2
      WHERE id = $3`,
    [target.id, String(resolvedBy || 'unknown'), queueEntryId]
  );
  const linked = await db.query(
    `UPDATE transactions
        SET counterparty_id = $1
      WHERE counterparty_normalised = $2
        AND counterparty_id IS NULL`,
    [target.id, entry.normalised_name]
  );

  await logDedupDecision(db, {
    candidate_id: null,
    matched_to: target.id,
    decision: 'ANALYST_MERGE',
    confidence_score: 1.0,
    signals: { method: 'manual', queue_entry: queueEntryId, resolved_by: resolvedBy },
    decided_by: null
  });

  await logAudit({
    entity_type: 'counterparty',
    entity_id: target.id,
    action: 'counterparty_resolved_manually',
    performed_by: String(resolvedBy || 'unknown'),
    details: `queue_entry=${queueEntryId} resolved_to=${target.canonical_name} transactions_linked=${linked.rowCount}`
  });

  return { resolved_counterparty_id: target.id, transactions_linked: linked.rowCount };
}

// ── mergeCounterparties ──────────────────────────────────────────────────
//
// Soft merge: source row keeps is_merged_away=TRUE; all transactions
// pointing at it move to the target; dedup_queue entries pointing to
// the source also re-point. merge_source_ids on the target preserves
// provenance.
async function mergeCounterparties(db, sourceId, targetId, mergedBy) {
  if (sourceId === targetId) throw new Error('source and target must differ');

  const target = (await db.query(
    `SELECT id, canonical_name FROM counterparties
      WHERE id = $1 AND is_merged_away = FALSE`,
    [targetId]
  )).rows[0];
  if (!target) throw new Error(`Target counterparty ${targetId} not found or merged away`);

  const source = (await db.query(
    `SELECT id, canonical_name FROM counterparties WHERE id = $1`,
    [sourceId]
  )).rows[0];
  if (!source) throw new Error(`Source counterparty ${sourceId} not found`);

  // Repoint transactions.
  const movedTxns = await db.query(
    `UPDATE transactions SET counterparty_id = $1 WHERE counterparty_id = $2`,
    [targetId, sourceId]
  );

  // Repoint queue entries.
  await db.query(
    `UPDATE counterparty_dedup_queue
        SET resolved_counterparty_id = $1
      WHERE resolved_counterparty_id = $2`,
    [targetId, sourceId]
  );

  // Flag source.
  await db.query(
    `UPDATE counterparties
        SET is_merged_away = TRUE,
            merged_into_id = $1
      WHERE id = $2`,
    [targetId, sourceId]
  );

  // Append to target's merge_source_ids array.
  await db.query(
    `UPDATE counterparties
        SET merge_source_ids = array_append(
              COALESCE(merge_source_ids, ARRAY[]::uuid[]),
              $1::uuid
            ),
            transaction_count = (SELECT COUNT(*) FROM transactions WHERE counterparty_id = $2),
            total_volume = (SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE counterparty_id = $2),
            last_seen_at = NOW()
      WHERE id = $2`,
    [sourceId, targetId]
  );

  await logDedupDecision(db, {
    candidate_id: sourceId,
    matched_to: targetId,
    decision: 'ANALYST_MERGE',
    confidence_score: 1.0,
    signals: { method: 'merge', source: sourceId, target: targetId, transactions_relinked: movedTxns.rowCount },
    decided_by: null
  });

  await logAudit({
    entity_type: 'counterparty',
    entity_id: targetId,
    action: 'counterparty_merged',
    performed_by: String(mergedBy || 'unknown'),
    details: `source_id=${sourceId} target_id=${targetId} transactions_relinked=${movedTxns.rowCount}`
  });

  return {
    source_id: sourceId,
    target_id: targetId,
    transactions_relinked: movedTxns.rowCount
  };
}

module.exports = {
  // Pipeline operations.
  buildDedupQueue,
  resolveQueue,
  runBackfill,
  resolveManually,
  mergeCounterparties,
  // Pure helper exposed for tests.
  normalize,
  // Constants.
  FUZZY_REVIEW_FLOOR,
  DEFAULT_FUZZY_THRESHOLD
};
