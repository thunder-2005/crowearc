require('dotenv').config();
const pool = require('./db');
const fs = require('fs');
const path = require('path');

// Demo credentials applied on every migrate run, so an existing Supabase
// database picks up username/password without needing a full reseed.
// Keep in sync with seed.js CREDENTIALS_BY_NAME.
const CREDENTIALS = [
  { name: 'Henry Morgan',  username: 'henry.morgan',  password: 'Henry@123'   },
  { name: 'Olivia Brown',  username: 'olivia.brown',  password: 'Olivia@123'  },
  { name: 'Cassian Jude',  username: 'cassian.jude',  password: 'Cassian@123' },
  { name: 'Marie Davis',   username: 'marie.davis',   password: 'Marie@123'   },
  { name: 'Hannah Louise', username: 'hannah.louise', password: 'Hannah@123'  },
  { name: 'Robert Wright', username: 'robert.wright', password: 'Robert@123'  },
  { name: 'Arjun Sharma',  username: 'arjun.sharma',  password: 'Arjun@123'   },
  { name: 'Priya Nair',    username: 'priya.nair',    password: 'Priya@123'   },
  { name: 'Rohit Mehta',   username: 'rohit.mehta',   password: 'Rohit@123'   },
  { name: 'Neha Iyer',     username: 'neha.iyer',     password: 'Neha@123'    },
  { name: 'Vikram Sinha',  username: 'vikram.sinha',  password: 'Vikram@123'  }
];

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  try {
    // Pre-flight ALTERs: schema.sql uses CREATE TABLE IF NOT EXISTS, which
    // skips entirely on legacy databases. New columns referenced later in
    // schema.sql (eg. idx_audit_entity uses entity_type) won't exist on those
    // DBs unless we add them BEFORE running the rest of schema.sql. These
    // ALTERs are idempotent on fresh databases too.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS audit_trail (
        id SERIAL PRIMARY KEY,
        sar_id TEXT NOT NULL,
        action TEXT NOT NULL,
        performed_by TEXT,
        timestamp TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
        details TEXT
      )
    `);
    await pool.query(`ALTER TABLE audit_trail ADD COLUMN IF NOT EXISTS entity_type TEXT`);
    await pool.query(`UPDATE audit_trail SET entity_type = 'sar' WHERE entity_type IS NULL`);

    await pool.query(sql);
    console.log('Schema applied');

    // Idempotent — schema.sql already has these columns; this is the safety
    // net for databases migrated before username/password were added.
    await pool.query(`
      ALTER TABLE user_profiles
        ADD COLUMN IF NOT EXISTS username TEXT,
        ADD COLUMN IF NOT EXISTS password TEXT
    `);

    // Index also created by schema.sql — re-create here in case the legacy
    // path skipped it.
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_trail(entity_type, sar_id)`);

    let updated = 0;
    for (const c of CREDENTIALS) {
      const r = await pool.query(
        'UPDATE user_profiles SET username = $1, password = $2 WHERE name = $3',
        [c.username, c.password, c.name]
      );
      updated += r.rowCount;
    }
    console.log(`Credentials applied to ${updated}/${CREDENTIALS.length} users`);

    // ─── Role taxonomy: add bsa_officer + CHECK constraint ───────────────
    // Pin the valid-role taxonomy on the user_profiles row so a future
    // migration / hand-written INSERT can't introduce e.g. 'bsa-officer'
    // or 'BSAOfficer' typos that the UI silently treats as employee.
    // Idempotent — drop+recreate so re-running migrate adapts to schema
    // edits to the role enum without manual cleanup.
    await pool.query(`
      ALTER TABLE user_profiles
      DROP CONSTRAINT IF EXISTS user_profiles_role_check
    `);
    await pool.query(`
      ALTER TABLE user_profiles
      ADD CONSTRAINT user_profiles_role_check
      CHECK (role IN ('analyst_l1', 'analyst_l2', 'compliance_manager', 'bsa_officer'))
    `);
    console.log('Role-taxonomy CHECK constraint applied');

    // James Carter is the customer's BSA Officer. The one-shot
    // load-bsa-extension.js seeder inserts him with role='bsa_officer'
    // already, but legacy databases (or hand-fixed prod rows) may have
    // him on a generic analyst/manager role. Force-correct here, and
    // log an audit row exactly once so the change is reconstructible.
    const carter = (await pool.query(
      `SELECT user_id, role FROM user_profiles WHERE name = 'James Carter'`
    )).rows[0];
    if (carter && carter.role !== 'bsa_officer') {
      await pool.query(
        `UPDATE user_profiles SET role = 'bsa_officer' WHERE name = 'James Carter'`
      );
      console.log(`James Carter role corrected: ${carter.role} → bsa_officer`);
    } else if (carter) {
      console.log('James Carter already on bsa_officer role');
    } else {
      console.log('James Carter not found — load-bsa-extension.js will insert him');
    }

    // Audit row — once per James-Carter user_id. The (sar_id, action)
    // pair acts as a dedupe key since the polymorphic entity_id column
    // is named sar_id.
    if (carter?.user_id) {
      const ROLE_ACTION = 'Role taxonomy correction — BSA Officer designation';
      const existing = await pool.query(
        `SELECT 1 FROM audit_trail
          WHERE entity_type = 'user' AND sar_id = $1 AND action = $2
          LIMIT 1`,
        [carter.user_id, ROLE_ACTION]
      );
      if (existing.rowCount === 0) {
        await pool.query(
          `INSERT INTO audit_trail (entity_type, sar_id, action, performed_by, details)
           VALUES ('user', $1, $2, 'system',
                   'Added bsa_officer to the valid-role taxonomy and confirmed James Carter''s designation.')`,
          [carter.user_id, ROLE_ACTION]
        );
        console.log('Audit row written for BSA Officer role designation');
      }
    }

    // ─── Cross-Case Entity Graph (CCEG) — Phase 1 schema ─────────────────
    // Applied after the base schema so foreign-key references resolve.
    // Idempotent — every DDL in cceg_schema.sql is CREATE ... IF NOT EXISTS.
    // See CCEG_PHASE_1_DESIGN.md for scope and deviations.
    const ccegSql = fs.readFileSync(path.join(__dirname, 'cceg_schema.sql'), 'utf8');
    await pool.query(ccegSql);
    console.log('CCEG Phase 1 schema applied');

    console.log('Migration successful');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

migrate();
