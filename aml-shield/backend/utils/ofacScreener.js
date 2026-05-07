// Fuzzy-matches an entity name (customer or counterparty) against the
// OFAC SDN list and persists results in ofac_screening_results.
//
// Matching uses an inline Jaro-Winkler implementation (no `natural`
// dependency — that package ships ESM-only modules that crash on
// require() under CommonJS / Node 18). Default threshold is 0.85
// (85% similarity). Anything below that is filtered out per spec —
// analysts only see high-confidence matches. Both the primary
// sdn_name and any aka_names are tested.

const pool = require('../database/db');

const DEFAULT_THRESHOLD = 0.85;

// Jaro-Winkler similarity in the range [0, 1]. Inputs are uppercased
// internally so callers don't need to normalize first.
function jaroWinkler(s1, s2) {
  s1 = String(s1 || '').toUpperCase();
  s2 = String(s2 || '').toUpperCase();
  if (s1 === s2) return 1.0;
  const len1 = s1.length;
  const len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0.0;
  const matchDist = Math.max(Math.floor(Math.max(len1, len2) / 2) - 1, 0);
  const s1Matches = new Array(len1).fill(false);
  const s2Matches = new Array(len2).fill(false);
  let matches = 0;
  let transpositions = 0;
  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchDist);
    const end = Math.min(i + matchDist + 1, len2);
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0.0;
  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }
  const jaro = (matches / len1 + matches / len2 +
    (matches - transpositions / 2) / matches) / 3;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, Math.min(len1, len2)); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

function normalize(s) {
  return String(s || '').toUpperCase().trim();
}

// Score one input name against one SDN entry, returning the best match
// (primary or AKA) or null.
function scoreEntry(nameUpper, entry, threshold) {
  let best = null;

  const primaryScore = jaroWinkler(nameUpper, normalize(entry.sdn_name));
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
    const akaScore = jaroWinkler(nameUpper, normalize(aka));
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

module.exports = { screenName, getScreeningResults, scoreEntry, jaroWinkler, DEFAULT_THRESHOLD };
