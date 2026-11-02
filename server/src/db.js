const mysql = require('mysql2/promise');
const { config } = require('./config');

const pool = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
});

async function audit(actorId, action, entityType, entityId, details, ip, conn = pool) {
  await conn.query(
    'INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details, ip) VALUES (?,?,?,?,?,?)',
    [actorId || null, action, entityType || null, entityId || null, details ? String(details).slice(0, 500) : null, ip || null]
  );
}

module.exports = { pool, audit };
