/**
 * storage/postgres.js — PostgreSQL storage backend for Zerobase
 *
 * Implements the exact same interface as storage/file.js but backed by
 * a real PostgreSQL database. Supports connection via connection string
 * or individual config values.
 *
 * Interface:
 *   isInitialized(), ensureStorageDir(), getStorageDir(),
 *   readSchema(), writeSchema(),
 *   readTable(name), writeTable(name, rows),
 *   createTableFile(name), dropTableFile(name),
 *   listTables()
 */

let pool = null;

function getPool() {
  if (!pool) {
    const { Pool } = require("pg");
    const cfg = getPgConfig();
    pool = new Pool(cfg);
  }
  return pool;
}

function getPgConfig() {
  // Check env first, then module-level config
  return {
    host:     process.env.PGHOST     || "localhost",
    port:     process.env.PGPORT     || 5432,
    database: process.env.PGDATABASE || "zerobase",
    user:     process.env.PGUSER    || "postgres",
    password: process.env.PGPASSWORD || "",
  };
}

function setPgConfig(cfg) {
  process.env.PGHOST     = cfg.host;
  process.env.PGPORT     = cfg.port;
  process.env.PGDATABASE = cfg.database;
  process.env.PGUSER     = cfg.user;
  process.env.PGPASSWORD = cfg.password;
  // Reset pool so next call creates with new config
  if (pool) { pool.end().catch(() => {}); pool = null; }
}

// ── Map JS type → PostgreSQL type ──
const TYPE_MAP = {
  number:  "INTEGER",
  string:  "TEXT",
  boolean: "BOOLEAN",
};

const PG_TYPE_MAP = {
  integer: "INT",
  text:    "TEXT",
  boolean: "BOOL",
  numeric:  "FLOAT",
};

// ── Interface ──

function isInitialized() {
  try {
    const { Pool } = require("pg");
    const cfg = getPgConfig();
    const p = new Pool(cfg);
    return p.query("SELECT 1").then(r => { p.end().catch(() => {}); return true; }).catch(() => false);
  } catch { return false; }
}

async function ensureStorageDir() {
  // For Postgres, "ensureStorageDir" creates the tracking table if it doesn't exist.
  // We use a "zerobase_meta" table to store schema info since there's no filesystem.
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS zerobase_meta (
      table_name TEXT PRIMARY KEY,
      columns    JSONB NOT NULL,
      primary_key TEXT
    )
  `);
  return { type: "postgres" };
}

function getStorageDir() {
  return { type: "postgres", config: getPgConfig() };
}

async function readSchema() {
  const p = getPool();
  const { rows } = await p.query("SELECT table_name, columns, primary_key FROM zerobase_meta");
  const schema = {};
  for (const row of rows) {
    schema[row.table_name] = {
      columns:    row.columns,
      primaryKey: row.primary_key,
    };
  }
  return schema;
}

async function writeSchema(schema) {
  const p = getPool();
  for (const [name, info] of Object.entries(schema)) {
    await p.query(
      `INSERT INTO zerobase_meta (table_name, columns, primary_key)
       VALUES ($1, $2, $3)
       ON CONFLICT (table_name) DO UPDATE SET columns = $2, primary_key = $3`,
      [name, JSON.stringify(info.columns), info.primaryKey || null]
    );
  }
}

async function readTable(name) {
  const p = getPool();
  const { rows } = await p.query(`SELECT * FROM "${name}"`);
  return rows;
}

async function writeTable(name, rows) {
  const p = getPool();
  // Just write the full row set — delete then re-insert for simplicity
  await p.query(`DELETE FROM "${name}"`);
  for (const row of rows) {
    const cols = Object.keys(row);
    const vals = Object.values(row);
    const colStr = cols.map(c => `"${c}"`).join(", ");
    const valStr = vals.map((_, i) => `$${i + 1}`).join(", ");
    await p.query(`INSERT INTO "${name}" (${colStr}) VALUES (${valStr})`, vals);
  }
}

async function createTableFile(name) {
  const p = getPool();
  const { rows } = await p.query("SELECT columns, primary_key FROM zerobase_meta WHERE table_name = $1", [name]);
  if (!rows.length) throw new Error(`Schema not found for table "${name}".`);

  const { columns, primary_key } = rows[0];
  const colDefs = Object.entries(columns).map(([col, type]) => {
    const pgType = PG_TYPE_MAP[type] || "TEXT";
    return `"${col}" ${pgType}${primary_key === col ? " PRIMARY KEY" : ""}`;
  }).join(", ");

  await p.query(`CREATE TABLE IF NOT EXISTS "${name}" (${colDefs})`);
}

async function dropTableFile(name) {
  const p = getPool();
  await p.query(`DROP TABLE IF EXISTS "${name}"`);
}

async function listTables() {
  const p = getPool();
  const { rows } = await p.query(
    `SELECT table_name FROM zerobase_meta ORDER BY table_name`
  );
  return rows.map(r => r.table_name);
}

// ── Connect / Configure ──
async function connect(cfg) {
  setPgConfig(cfg);
  const p = getPool();
  await p.query("SELECT 1");
  await ensureStorageDir();
  return true;
}

module.exports = {
  isInitialized,
  ensureStorageDir,
  getStorageDir,
  readSchema,
  writeSchema,
  readTable,
  writeTable,
  createTableFile,
  dropTableFile,
  listTables,
  connect,
  setPgConfig,
};
