/**
 * AML Shield — Full US-based seed dataset
 *
 *   ─── NOT YET MIGRATED TO POSTGRESQL ───
 *
 * This script was a manual, one-off SQLite-based seeder that produced an
 * extended US dataset (25 customers + richer alerts/SAR/KYC/notification
 * volumes than the CSV-driven seed.js).
 *
 * As part of the SQLite → PostgreSQL migration, only `seed.js` (wired to
 * `npm run seed`) has been ported to pg. To regenerate the full extended
 * dataset on Postgres, this file needs a pg rewrite analogous to seed.js:
 * convert every `db.prepare(...).run(...)` to `client.query(...)` with
 * numbered placeholders, run inside a single transaction, drop the
 * `initSchema` import (schema is now created by `migrate.js`), and
 * inline any logic that previously came from `db.js` helpers.
 *
 * Run instead:
 *   1. node backend/database/migrate.js   # create schema in Supabase
 *   2. npm run seed                       # populate via seed.js
 *
 * If you bring this script back to life on Postgres, follow seed.js as
 * the template — same patterns, same transaction wrapper.
 */

console.error(
  '[seed_full] This script has NOT been migrated to PostgreSQL.\n' +
  '            Use `npm run seed` (seed.js) for the standard dataset.\n' +
  '            See the comment at the top of this file for next steps.'
);
process.exit(1);
