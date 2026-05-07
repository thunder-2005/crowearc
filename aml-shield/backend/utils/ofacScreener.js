// Fuzzy-matches an entity name (customer or counterparty) against the
// OFAC SDN list and persists results in ofac_screening_results.
//
// Matching uses Jaro-Winkler distance from the `natural` package; default
// threshold is 0.85 (i.e. 85% similarity). Anything below that is filtered
// out per spec — analysts only see high-confidence matches. Both the
// primary sdn_name and any aka_names are tested.

const natural = require('natural');
const pool = require('../database/db');

const JaroWinklerDistance = natural.JaroWinklerDistance;
const DEFAULT_THRESHOLD = 0.85;

function normalize(s) {
  return String(s || '').toUpperCase().trim();
}

// Score one input name against one SDN entry, returning the best match
// (primary or AKA) or null.
function scoreEntry(nameUpper, entry, threshold) {
  let best = null;

  const primaryScore = JaroWinklerDistance(nameUpper, normalize(entry.sdn_name), { ignoreCase: true });
  if (primaryScore >= threshold) {
    best = {
      sdn_entry_id: entry.id,
      sdn_name: entry.sdn_name,
      match_score: Math.round(primaryScore * 100),
      match_type: 'Primary Name',
      program: entry.program
    };
  }

  for (const aka of (entry.aka_names || [])) {
    const akaScore = JaroWinklerDistance(nameUpper, normalize(aka), { ignoreCase: true });
    if (akaScore >= threshold) {
      const candidate = {
        sdn_entry_id: entry.id,
        sdn_name: entry.sdn_name,
        match_score: Math.round(akaScore * 100),
        match_type: 'AKA Match',
        program: entry.program,
        aka_matched: aka
      };
      if (!best || candidate.match_score > best.match_score) best = candidate;
    }
  }

  return best;
}

async function screenName(entityName, entityId, entityType, threshold = DEFAULT_THRESHOLD) {
  if (!entityName || !entityId || !entityType) {
    throw new Error('entityName, entityId and entityType are required');
  }
  const nameUpper = normalize(entityName);

  // Pull the full SDN list once. ~15k rows × ~200 bytes each is well
  // within memory and a single round-trip beats per-row queries.
  const sdnEntries = (await pool.query(
    'SELECT id, sdn_name, aka_names, program FROM ofac_sdn_entries'
  )).rows;

  const matches = [];
  for (const entry of sdnEntries) {
    const m = scoreEntry(nameUpper, entry, threshold);
    if (m) matches.push(m);
  }

  matches.sort((a, b) => b.match_score - a.match_score);

  // Replace any prior screening results for this entity in one transaction
  // so the UI never sees a half-updated state.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'DELETE FROM ofac_screening_results WHERE entity_id = $1 AND entity_type = $2',
      [entityId, entityType]
    );
    if (matches.length === 0) {
      await client.query(`
        INSERT INTO ofac_screening_results
          (entity_type, entity_id, entity_name, match_score, status, screened_at)
        VALUES ($1, $2, $3, 0, 'clear', NOW())
      `, [entityType, entityId, entityName]);
    } else {
      for (const m of matches) {
        await client.query(`
          INSERT INTO ofac_screening_results
            (entity_type, entity_id, entity_name, sdn_entry_id, sdn_name,
             match_score, match_type, program, status, screened_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', NOW())
        `, [entityType, entityId, entityName, m.sdn_entry_id, m.sdn_name,
            m.match_score, m.match_type, m.program]);
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_e) { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }

  return matches;
}

async function getScreeningResults(entityId, entityType) {
  const r = await pool.query(`
    SELECT * FROM ofac_screening_results
     WHERE entity_id = $1 AND entity_type = $2
     ORDER BY match_score DESC, id ASC
  `, [entityId, entityType]);
  return r.rows;
}

module.exports = { screenName, getScreeningResults, scoreEntry, DEFAULT_THRESHOLD };
