// Creates the database if needed and applies database/migrations/*.sql in order.
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { config } = require('../src/config');

(async () => {
  const { database, ...conn } = config.db;
  const root = await mysql.createConnection({ ...conn, multipleStatements: true });
  await root.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4`);
  await root.query(`USE \`${database}\``);
  await root.query('CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(100) PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');
  const dir = path.resolve(__dirname, '../../database/migrations');
  const [done] = await root.query('SELECT name FROM schema_migrations');
  const applied = new Set(done.map((r) => r.name));
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    if (applied.has(f)) continue;
    await root.query(fs.readFileSync(path.join(dir, f), 'utf8'));
    await root.query('INSERT INTO schema_migrations (name) VALUES (?)', [f]);
    console.log('applied', f);
  }
  console.log('Database up to date.');
  await root.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
