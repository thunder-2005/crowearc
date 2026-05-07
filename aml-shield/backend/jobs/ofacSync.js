// Daily OFAC SDN sync. Runs once on boot (only if the table is empty)
// and then on a 24-hour interval. All errors are logged but never re-
// thrown — a failed download must not crash the server or affect any
// other route.

const pool = require('../database/db');
const { downloadAndStoreSdnList } = require('../utils/ofacDownloader');

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

async function checkAndInitialDownload() {
  try {
    const r = await pool.query('SELECT COUNT(*)::int AS c FROM ofac_sdn_entries');
    const count = r.rows[0].c;
    if (count === 0) {
      console.log('[ofac] No SDN entries found — running initial download');
      await downloadAndStoreSdnList();
    } else {
      console.log(`[ofac] ${count} SDN entries already loaded; skipping initial download`);
    }
  } catch (err) {
    console.error('[ofac] Initial check failed:', err.message);
  }
}

function start() {
  // Defer the first check so the rest of server startup logs cleanly.
  setTimeout(checkAndInitialDownload, 5_000);

  setInterval(async () => {
    console.log('[ofac] Running scheduled OFAC sync...');
    try {
      await downloadAndStoreSdnList();
    } catch (err) {
      console.error('[ofac] Scheduled sync failed:', err.message);
    }
  }, TWENTY_FOUR_HOURS_MS);

  console.log(`[ofac] OFAC sync job scheduled — runs every ${TWENTY_FOUR_HOURS_MS / 3600_000} hours`);
}

module.exports = { start, checkAndInitialDownload };
