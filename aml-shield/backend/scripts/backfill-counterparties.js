// ═══════════════════════════════════════════════════════════════════════════
// One-shot counterparty dedup backfill (C-10 / audit B-7).
//
//   $ node aml-shield/backend/scripts/backfill-counterparties.js           # dry run
//   $ node aml-shield/backend/scripts/backfill-counterparties.js --commit  # commits
//
// Always runs a dry pass first so the operator sees the projected
// auto-resolve / new-entity / needs-review breakdown BEFORE any data
// changes. Requires the --commit flag to actually write.
// ═══════════════════════════════════════════════════════════════════════════

require('dotenv').config();
const pool = require('../database/db');
const { runBackfill } = require('../utils/counterpartyDedup');

const COMMIT = process.argv.includes('--commit');
const BATCH_SIZE = 100;
const FUZZY_THRESHOLD = 0.88;

function fmt(s) {
  return Object.entries(s)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
}

async function main() {
  console.log('[backfill] counterparty dedup pipeline');
  console.log(`[backfill] mode: ${COMMIT ? 'COMMIT' : 'DRY RUN'}`);
  console.log(`[backfill] batchSize=${BATCH_SIZE} fuzzyThreshold=${FUZZY_THRESHOLD}`);

  try {
    console.log('[backfill] running dry pass…');
    const dry = await runBackfill(pool, {
      batchSize: BATCH_SIZE,
      fuzzyThreshold: FUZZY_THRESHOLD,
      dryRun: true
    });
    console.log(`[backfill] dry summary: ${fmt(dry)}`);

    if (!COMMIT) {
      console.log('[backfill] Dry run complete. Run with --commit flag to apply.');
      return;
    }

    console.log('[backfill] committing…');
    const wet = await runBackfill(pool, {
      batchSize: BATCH_SIZE,
      fuzzyThreshold: FUZZY_THRESHOLD,
      dryRun: false
    });
    console.log(`[backfill] commit summary: ${fmt(wet)}`);

    if (wet.needsReview > 0) {
      console.log(`[backfill] ${wet.needsReview} counterparty entries require manual review in the BSA Officer Counterparty Merge UI at /bsa/counterparty-merge.`);
    }
  } catch (err) {
    console.error('[backfill] failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
}

main();
