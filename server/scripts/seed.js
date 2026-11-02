// Creates the initial admin from ADMIN_EMAIL / ADMIN_PASSWORD (env only). Idempotent.
const bcrypt = require('bcryptjs');
const { pool } = require('../src/db');

(async () => {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  if (!email || !password) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD in server/.env first.');
  const [rows] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
  if (rows.length) { console.log('Admin already exists; nothing changed.'); return; }
  const hash = await bcrypt.hash(password, 12);
  await pool.query(
    "INSERT INTO users (first_name,last_name,email,phone,password_hash,role,must_change_password) VALUES ('Vision','Tax',?,'0000000000',?,'admin',1)",
    [email, hash]
  );
  console.log(`Admin ${email} created. Password change is required at first login.`);
})().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => pool.end());
