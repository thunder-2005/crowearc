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

    console.log('Migration successful');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

migrate();
