// ═══════════════════════════════════════════════════════════════════════════
// Cross-Case Entity Graph — Phase 1 helper
//
// Single, parameterised entry point into the entity_golden_registry +
// entity_identifiers + dedup_decisions tables. The Phase 2 deduplicator
// will own the multi-signal scoring logic; this module ships the hard-
// identifier deterministic path so the registry has somewhere to write.
//
// All queries are parameterised. No template strings into SQL. Ever.
//
// PII handling: id_value is encrypted before writing (pgp_sym_encrypt
// via pgcrypto) and never logged. The hash column stores SHA-256 of the
// normalized id_value and is the dedup primitive.
//
// See CCEG_PHASE_1_DESIGN.md for deviations and what's still open.
// ═══════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const pool = require('../database/db');

const VALID_ENTITY_TYPES = new Set(['PERSON', 'COMPANY', 'ACCOUNT']);
const VALID_SOURCES = new Set(['manual', 'extracted', 'imported']);
const VALID_DECISIONS = new Set([
  'AUTO_MERGE',
  'ANALYST_MERGE',
  'REJECTED',
  'NEW_ENTITY',
  'PENDING_REVIEW'
]);

// Encryption key for id_value_enc. Sourced from CCEG_ENCRYPTION_KEY so the
// production deployment can rotate independently of any other secret.
// In dev / smoke-test runs we accept a default ONLY when NODE_ENV !== 'production'
// so the test script runs out of the box — fail closed in prod.
function encryptionKey() {
  const key = process.env.CCEG_ENCRYPTION_KEY;
  if (key && key.length > 0) return key;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('CCEG_ENCRYPTION_KEY must be set in production');
  }
  // Dev fallback — value is not security-bearing in dev/test.
  return 'cceg-dev-key-DO-NOT-USE-IN-PROD';
}

// SHA-256 of the normalized identifier value (lowercased + trimmed).
// Normalization is deliberately conservative — for IBANs we strip spaces;
// for passports we just trim. The aim is a single canonical form per
// identifier type so the unique(id_type, id_value_hash) constraint
// detects all duplicates of the same identifier without mistakenly
// merging unrelated values.
function normalizeIdValue(idType, raw) {
  if (raw == null) throw new Error('id_value is required');
  let s = String(raw).trim();
  if (idType === 'IBAN' || idType === 'SWIFT') s = s.replace(/\s+/g, '');
  return s.toLowerCase();
}

function hashIdValue(idType, raw) {
  const normalized = normalizeIdValue(idType, raw);
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function assertValidEntityType(t) {
  if (!VALID_ENTITY_TYPES.has(t)) {
    throw new Error(`entity_type must be one of ${[...VALID_ENTITY_TYPES].join(', ')}; got ${t}`);
  }
}
function assertValidSource(s) {
  if (s != null && !VALID_SOURCES.has(s)) {
    throw new Error(`source must be one of ${[...VALID_SOURCES].join(', ')} or null; got ${s}`);
  }
}
function assertValidDecision(d) {
  if (!VALID_DECISIONS.has(d)) {
    throw new Error(`decision must be one of ${[...VALID_DECISIONS].join(', ')}; got ${d}`);
  }
}

// Log a row into dedup_decisions. Caller passes the runner (a pool or
// a client inside a transaction) so the decision row commits atomically
// with the merge/insert it describes.
async function logDedupDecision(runner, {
  candidate_id = null,
  matched_to = null,
  decision,
  confidence_score = null,
  signals = null,
  decided_by = null
}) {
  assertValidDecision(decision);
  await runner.query(
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
}

// Look up an existing golden_id by (id_type, id_value). Returns the
// uuid if found, otherwise null. Hash-only lookup — never touches the
// encrypted value.
async function findEntityByIdentifier(runner, { id_type, id_value }) {
  const hash = hashIdValue(id_type, id_value);
  const r = await runner.query(
    `SELECT golden_id FROM entity_identifiers
      WHERE id_type = $1 AND id_value_hash = $2
      LIMIT 1`,
    [id_type, hash]
  );
  return r.rows[0]?.golden_id || null;
}

// Phase 1 core operation: deterministic find-or-create on a hard
// identifier. This is the path the Phase 2 deduplicator takes when
// the candidate carries an identifier whose hash already exists
// (Section 5.3 "Hard identifier match" — weight 1.0).
//
// Behaviour:
//   1. If the (id_type, id_value) is already on file → return the
//      existing golden_id, write an AUTO_MERGE dedup_decisions row.
//   2. If not → create a new entity_golden_registry row, insert the
//      identifier, write a NEW_ENTITY dedup_decisions row, and return
//      the new golden_id.
//
// The whole thing runs inside a transaction so a partial failure
// can't leave the registry inconsistent (e.g. entity row inserted
// but identifier insert lost).
async function findOrCreateEntityByIdentifier({
  entity_type,
  canonical_name,
  identifier,     // { id_type, id_value, source, confidence, added_by }
  decided_by = null
}) {
  assertValidEntityType(entity_type);
  if (!identifier || !identifier.id_type || identifier.id_value == null) {
    throw new Error('identifier with id_type + id_value is required');
  }
  assertValidSource(identifier.source);

  const hash = hashIdValue(identifier.id_type, identifier.id_value);
  const key = encryptionKey();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Existing identifier?
    const existing = await client.query(
      `SELECT golden_id FROM entity_identifiers
        WHERE id_type = $1 AND id_value_hash = $2
        LIMIT 1`,
      [identifier.id_type, hash]
    );
    if (existing.rowCount > 0) {
      const golden_id = existing.rows[0].golden_id;
      // Touch last_updated_at on the matched entity.
      await client.query(
        `UPDATE entity_golden_registry
            SET last_updated_at = NOW()
          WHERE golden_id = $1`,
        [golden_id]
      );
      await logDedupDecision(client, {
        candidate_id: null,
        matched_to: golden_id,
        decision: 'AUTO_MERGE',
        confidence_score: 1.0,
        signals: { hard_identifier_match: { id_type: identifier.id_type, weight: 1.0 } },
        decided_by
      });
      await client.query('COMMIT');
      return { golden_id, created: false };
    }

    // 2. Brand new entity.
    const ins = await client.query(
      `INSERT INTO entity_golden_registry (entity_type, canonical_name)
       VALUES ($1, $2)
       RETURNING golden_id`,
      [entity_type, canonical_name || null]
    );
    const golden_id = ins.rows[0].golden_id;

    await client.query(
      `INSERT INTO entity_identifiers
         (golden_id, id_type, id_value_hash, id_value_enc, source, confidence, added_by)
       VALUES ($1, $2, $3, pgp_sym_encrypt($4, $5), $6, $7, $8)`,
      [
        golden_id,
        identifier.id_type,
        hash,
        String(identifier.id_value),
        key,
        identifier.source || null,
        identifier.confidence == null ? null : Number(identifier.confidence),
        identifier.added_by || null
      ]
    );

    await logDedupDecision(client, {
      candidate_id: golden_id,
      matched_to: null,
      decision: 'NEW_ENTITY',
      confidence_score: null,
      signals: { hard_identifier_match: { id_type: identifier.id_type, found: false } },
      decided_by
    });

    await client.query('COMMIT');
    return { golden_id, created: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Decrypt a stored identifier value. Only the goldenRegistry helper or
// a privileged operator (compliance officer) should ever call this.
// Application logs MUST NOT include the result.
async function decryptIdentifierValue(runner, identifier_id) {
  const key = encryptionKey();
  const r = await runner.query(
    `SELECT pgp_sym_decrypt(id_value_enc, $1)::text AS plain
       FROM entity_identifiers
      WHERE id = $2`,
    [key, identifier_id]
  );
  return r.rows[0]?.plain || null;
}

module.exports = {
  // Pure helpers (exported for test reuse and Phase 2 fuzzy matcher).
  hashIdValue,
  normalizeIdValue,

  // Persistence operations.
  findEntityByIdentifier,
  findOrCreateEntityByIdentifier,
  logDedupDecision,
  decryptIdentifierValue,

  // Constants — useful for downstream type-checking.
  VALID_ENTITY_TYPES,
  VALID_SOURCES,
  VALID_DECISIONS
};
