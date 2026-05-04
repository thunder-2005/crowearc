require('dotenv').config();
const pool = require('./db');
const fs = require('fs');
const path = require('path');

async function migrate() {
  const sql = fs.readFileSync(
    path.join(__dirname, 'schema.sql'),
    'utf8'
  );
  try {
    await pool.query(sql);
    console.log('Migration successful');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

migrate();
