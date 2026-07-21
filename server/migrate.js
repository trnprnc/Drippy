// Applies schema.sql to DATABASE_URL. Run once per database:
//   node migrate.js        (reads server/.env.local if present)
require('./env');
const fs = require('fs');
const path = require('path');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set (put it in server/.env.local or the environment)');
  process.exit(1);
}

const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

pool
  .query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'))
  .then(async () => {
    const { rows } = await pool.query(
      "select table_name from information_schema.tables where table_schema = 'public' order by table_name"
    );
    console.log('schema applied; tables:', rows.map((r) => r.table_name).join(', '));
    await pool.end();
  })
  .catch((err) => {
    console.error('migration failed:', err.message);
    process.exit(1);
  });
