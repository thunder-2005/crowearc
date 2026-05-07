// Downloads the OFAC Specially Designated Nationals (SDN) XML list and
// stores the parsed entries in ofac_sdn_entries. The list is the public
// US Treasury sanctions feed — no auth required, follows redirects, and
// can be re-downloaded daily.

const axios = require('axios');
const xml2js = require('xml2js');
const pool = require('../database/db');

const OFAC_SDN_URL = process.env.OFAC_SDN_URL || 'https://www.treasury.gov/ofac/downloads/sdn.xml';
const HTTP_TIMEOUT_MS = 60_000;
const INSERT_BATCH_SIZE = 100;

// Convert anything xml2js may return for a "list of one or many" into an
// always-array. xml2js with explicitArray:false collapses single-item
// lists to an object instead of a single-element array.
function arr(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

// Programs may be a single program string or an array. Spec stores TEXT,
// so multiple programs join with commas (per Q5).
function joinPrograms(p) {
  const list = arr(p).map(x => String(x).trim()).filter(Boolean);
  return list.length === 0 ? null : list.join(', ');
}

// Pull the primary searchable name. Per spec: lastName || firstName ||
// 'Unknown'. For individuals lastName is the surname; for entities the
// org name lands in lastName too.
function primaryName(entry) {
  return entry.lastName || entry.firstName || 'Unknown';
}

// Collect AKA names. Each AKA has its own lastName/firstName. Combine
// when both present so fuzzy matching has the full string.
function collectAkaNames(entry) {
  const out = [];
  for (const a of arr(entry.akaList?.aka)) {
    const last = (a.lastName || '').trim();
    const first = (a.firstName || '').trim();
    const combined = [first, last].filter(Boolean).join(' ').trim();
    if (combined) out.push(combined);
  }
  return out;
}

function collectNationalities(entry) {
  const out = [];
  for (const n of arr(entry.nationalityList?.nationality)) {
    if (n.country) out.push(String(n.country).trim());
  }
  return out;
}

function firstDob(entry) {
  const item = arr(entry.dateOfBirthList?.dateOfBirthItem)[0];
  return item?.dateOfBirth || null;
}

// Map a single sdnEntry XML object → row tuple (matches the column order
// of the batched INSERT below).
function projectRow(entry) {
  return [
    primaryName(entry),
    entry.sdnType || null,
    joinPrograms(entry.programList?.program),
    entry.title || null,
    collectAkaNames(entry),
    firstDob(entry),
    collectNationalities(entry)
  ];
}

async function batchInsert(rows) {
  if (rows.length === 0) return 0;
  const cols = ['sdn_name', 'sdn_type', 'program', 'title', 'aka_names', 'date_of_birth', 'nationalities'];
  let inserted = 0;
  for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + INSERT_BATCH_SIZE);
    const placeholders = batch.map((_, ri) => {
      const start = ri * cols.length;
      return '(' + cols.map((_, ci) => `$${start + ci + 1}`).join(', ') + ')';
    }).join(', ');
    const values = [];
    for (const row of batch) for (const v of row) values.push(v);
    await pool.query(
      `INSERT INTO ofac_sdn_entries (${cols.join(', ')}) VALUES ${placeholders}`,
      values
    );
    inserted += batch.length;
  }
  return inserted;
}

// Internal: parse a raw XML string into projected row tuples. Exported
// for unit tests (called directly with a fixture).
async function parseSdnXml(xmlText) {
  const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: false });
  const result = await parser.parseStringPromise(xmlText);
  const entries = arr(result?.sdnList?.sdnEntry);
  return entries.map(projectRow);
}

async function downloadAndStoreSdnList() {
  console.log('[ofac] Downloading OFAC SDN list from', OFAC_SDN_URL);
  try {
    const response = await axios.get(OFAC_SDN_URL, {
      timeout: HTTP_TIMEOUT_MS,
      responseType: 'text',
      // OFAC redirects through TLS; accept any 2xx + 3xx (axios follows by default)
      maxRedirects: 5
    });

    const rows = await parseSdnXml(response.data);
    console.log(`[ofac] Parsed ${rows.length} SDN entries from XML`);

    // Replace-all: clear prior list before inserting the fresh snapshot.
    // Existing screening_results retain their sdn_entry_id FK — we set it
    // to NULL via ON DELETE so historical analyst decisions survive a
    // refresh. (FK is "REFERENCES … ON DELETE NO ACTION" by default in
    // the spec; if a delete fails the catch logs it but we keep going.)
    await pool.query('UPDATE ofac_screening_results SET sdn_entry_id = NULL WHERE sdn_entry_id IS NOT NULL');
    await pool.query('DELETE FROM ofac_sdn_entries');

    const inserted = await batchInsert(rows);

    await pool.query(
      `INSERT INTO ofac_download_log (entry_count, status) VALUES ($1, 'success')`,
      [inserted]
    );

    console.log(`[ofac] ✅ Downloaded and stored ${inserted} SDN entries`);
    return inserted;
  } catch (err) {
    try {
      await pool.query(
        `INSERT INTO ofac_download_log (entry_count, status, error_message) VALUES (0, 'failed', $1)`,
        [String(err.message || err).slice(0, 1000)]
      );
    } catch (_e) { /* logging failure is not fatal */ }
    console.error('[ofac] ❌ Download failed:', err.message);
    throw err;
  }
}

module.exports = { downloadAndStoreSdnList, parseSdnXml, OFAC_SDN_URL };
