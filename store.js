// ============================================================
//  Persistenz der Räume
//  - Mit DATABASE_URL (PostgreSQL): Räume überleben Neustarts/Schlafmodus.
//  - Ohne DATABASE_URL: deaktiviert (rein im Speicher) – für lokale Entwicklung.
// ============================================================
let pool = null;
const enabled = !!process.env.DATABASE_URL;

if (enabled) {
  const { Pool } = require('pg'); // nur laden, wenn wirklich eine DB genutzt wird
  const url = process.env.DATABASE_URL;
  const local = url.includes('localhost') || url.includes('127.0.0.1') || process.env.PGSSL === 'false';
  pool = new Pool({
    connectionString: url,
    ssl: local ? false : { rejectUnauthorized: false },
    max: 4,
  });
  pool.on('error', () => {}); // Verbindungsfehler nicht crashen lassen
}

async function init() {
  if (!pool) return;
  await pool.query(
    'CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT now())'
  );
}

async function loadAll() {
  if (!pool) return [];
  const { rows } = await pool.query('SELECT data FROM rooms');
  return rows.map(r => r.data);
}

async function save(code, data) {
  if (!pool) return;
  await pool.query(
    'INSERT INTO rooms (code, data) VALUES ($1, $2) ON CONFLICT (code) DO UPDATE SET data = $2, updated_at = now()',
    [code, data]
  );
}

async function remove(code) {
  if (!pool) return;
  await pool.query('DELETE FROM rooms WHERE code = $1', [code]);
}

module.exports = { enabled, init, loadAll, save, remove };
