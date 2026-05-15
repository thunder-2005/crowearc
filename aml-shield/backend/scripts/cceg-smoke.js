// ═══════════════════════════════════════════════════════════════════════════
// CCEG Phase 1 — smoke verification
//
// Exercises the goldenRegistry helper end-to-end against the live
// PostgreSQL database. Run with:
//
//   DATABASE_URL=... node scripts/cceg-smoke.js
//
// What it asserts:
//   1. Two distinct passport numbers create two distinct golden_ids
//      (each producing a NEW_ENTITY dedup_decisions row).
//   2. Re-inserting the same passport for the same person returns
//      the same golden_id (and produces an AUTO_MERGE dedup_decisions
//      row keyed on weight=1.0 hard identifier match).
//   3. The encrypted id_value is round-trip decryptable via
//      decryptIdentifierValue().
//   4. UNIQUE(id_type, id_value_hash) is enforced at the DB layer.
//
// This script cleans up after itself — every entity it creates is
// scoped under a synthetic id_type 'SMOKE_TEST_PASSPORT' so the
// teardown can DELETE just those rows. Safe to re-run.
// ═══════════════════════════════════════════════════════════════════════════

require('dotenv').config();
const pool = require('../database/db');
const {
  findOrCreateEntityByIdentifier,
  findEntityByIdentifier,
  decryptIdentifierValue
} = require('../utils/goldenRegistry');

const SMOKE_ID_TYPE = 'SMOKE_TEST_PASSPORT';
const PASSPORT_A = 'X1234567';
const PASSPORT_B = 'Y9876543';

let failed = 0;
function assert(cond, label) {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    console.log(`  ✗ ${label}`);
    failed++;
  }
}

async function cleanup() {
  // Delete in dependency order: dedup rows first, then identifiers, then registry.
  // We can target only the rows this smoke produced because the synthetic
  // id_type is unique to this script.
  const { rows: identRows } = await pool.query(
    `SELECT id, golden_id FROM entity_identifiers WHERE id_type = $1`,
    [SMOKE_ID_TYPE]
  );
  const goldenIds = [...new Set(identRows.map(r => r.golden_id))];

  if (goldenIds.length > 0) {
    await pool.query(
      `DELETE FROM dedup_decisions
        WHERE matched_to = ANY($1::uuid[]) OR candidate_id = ANY($1::uuid[])`,
      [goldenIds]
    );
    // entity_identifiers FK has ON DELETE CASCADE, so deleting the
    // registry rows is enough.
    await pool.query(
      `DELETE FROM entity_golden_registry WHERE golden_id = ANY($1::uuid[])`,
      [goldenIds]
    );
  }
}

async function main() {
  console.log('CCEG Phase 1 smoke — start');
  console.log('─────────────────────────────────────────────');

  // Start from a known-clean state.
  await cleanup();

  // ── Test 1: two distinct passports → two distinct golden_ids ──
  console.log('\nTest 1: distinct identifiers → distinct golden_ids');
  const a = await findOrCreateEntityByIdentifier({
    entity_type: 'PERSON',
    canonical_name: 'Smoke Alpha',
    identifier: {
      id_type: SMOKE_ID_TYPE,
      id_value: PASSPORT_A,
      source: 'manual',
      confidence: 1.0
    }
  });
  const b = await findOrCreateEntityByIdentifier({
    entity_type: 'PERSON',
    canonical_name: 'Smoke Bravo',
    identifier: {
      id_type: SMOKE_ID_TYPE,
      id_value: PASSPORT_B,
      source: 'manual',
      confidence: 1.0
    }
  });
  assert(a.created === true, 'first call returns created=true');
  assert(b.created === true, 'second call returns created=true');
  assert(a.golden_id !== b.golden_id, 'distinct passports yield distinct golden_ids');

  // ── Test 2: re-inserting passport A returns the same golden_id ──
  console.log('\nTest 2: same identifier → AUTO_MERGE to existing golden_id');
  const aAgain = await findOrCreateEntityByIdentifier({
    entity_type: 'PERSON',
    canonical_name: 'Smoke Alpha (resubmit)',
    identifier: {
      id_type: SMOKE_ID_TYPE,
      id_value: PASSPORT_A,
      source: 'extracted',
      confidence: 1.0
    }
  });
  assert(aAgain.created === false, 're-submit returns created=false');
  assert(aAgain.golden_id === a.golden_id, 're-submit returns the same golden_id');

  // ── Test 3: dedup_decisions log has the expected rows ──
  console.log('\nTest 3: dedup_decisions log contains the right rows');
  const decisions = await pool.query(
    `SELECT decision, candidate_id, matched_to
       FROM dedup_decisions
      WHERE candidate_id = ANY($1::uuid[]) OR matched_to = ANY($1::uuid[])
      ORDER BY decided_at ASC`,
    [[a.golden_id, b.golden_id]]
  );
  const decisionList = decisions.rows.map(r => r.decision);
  assert(
    decisionList.filter(d => d === 'NEW_ENTITY').length === 2,
    'two NEW_ENTITY rows (one per distinct passport)'
  );
  assert(
    decisionList.filter(d => d === 'AUTO_MERGE').length === 1,
    'one AUTO_MERGE row for the re-submit'
  );

  // ── Test 4: encrypted id_value round-trips ──
  console.log('\nTest 4: id_value_enc round-trips via pgp_sym_decrypt');
  const idRow = await pool.query(
    `SELECT id FROM entity_identifiers
      WHERE golden_id = $1 AND id_type = $2
      LIMIT 1`,
    [a.golden_id, SMOKE_ID_TYPE]
  );
  const plain = await decryptIdentifierValue(pool, idRow.rows[0].id);
  assert(plain === PASSPORT_A, `decrypted value matches original (${plain})`);

  // ── Test 5: lookup-by-identifier resolves quickly ──
  console.log('\nTest 5: findEntityByIdentifier resolves by hash');
  const found = await findEntityByIdentifier(pool, {
    id_type: SMOKE_ID_TYPE,
    id_value: PASSPORT_A
  });
  assert(found === a.golden_id, 'findEntityByIdentifier returns the correct golden_id');

  // ── Test 6: UNIQUE(id_type, id_value_hash) enforced by DB ──
  console.log('\nTest 6: UNIQUE(id_type, id_value_hash) is enforced');
  let constraintFired = false;
  try {
    await pool.query(
      `INSERT INTO entity_identifiers
         (golden_id, id_type, id_value_hash, id_value_enc, source, confidence)
       VALUES ($1, $2, $3, pgp_sym_encrypt('duplicate', 'cceg-dev-key-DO-NOT-USE-IN-PROD'),
               'manual', 1.0)`,
      [
        a.golden_id,
        SMOKE_ID_TYPE,
        // Reuse hash of passport A — the unique constraint must reject.
        require('crypto').createHash('sha256').update(PASSPORT_A.toLowerCase()).digest('hex')
      ]
    );
  } catch (err) {
    constraintFired = /duplicate key|unique constraint/i.test(err.message);
  }
  assert(constraintFired, 'duplicate (id_type, id_value_hash) is rejected');

  // ── Cleanup ──
  console.log('\nTeardown');
  await cleanup();
  console.log('  ✓ smoke rows removed');

  console.log('\n─────────────────────────────────────────────');
  if (failed === 0) {
    console.log('CCEG Phase 1 smoke — PASS');
    process.exit(0);
  } else {
    console.log(`CCEG Phase 1 smoke — ${failed} assertion(s) FAILED`);
    process.exit(1);
  }
}

main()
  .catch(err => {
    console.error('Smoke crashed:', err);
    process.exit(1);
  })
  .finally(async () => {
    try { await pool.end(); } catch (_) { /* ignore */ }
  });
