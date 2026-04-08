/**
 * storage/file.js — JSON file-based storage for Zerobase
 *
 * All file operations are relative to the ./storage/ directory
 * discovered by walking up from the current working directory.
 */

const fs   = require("fs");
const path = require("path");

// ── Find ./storage/ directory (like git finds .git) ─────────────
function findStorageDir(start = process.cwd()) {
  let dir = start;
  // Walk up to root
  while (true) {
    const candidate = path.join(dir, "storage");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached root
    dir = parent;
  }
  return null;
}

// ── Public API ────────────────────────────────────────────────────

function isInitialized() {
  return findStorageDir() !== null;
}

function ensureStorageDir() {
  const dir = findStorageDir();
  if (dir) return dir;
  const fresh = path.join(process.cwd(), "storage");
  fs.mkdirSync(fresh, { recursive: true });
  return fresh;
}

function getStorageDir() {
  const dir = findStorageDir();
  if (!dir) throw new Error("Storage not initialized. Run 'zerobase init' first.");
  return dir;
}

function schemaPath() {
  return path.join(getStorageDir(), "schema.json");
}


function tablePath(name) {
  return path.join(getStorageDir(), `${name}.json`);
}

function readSchema() {
  const p = schemaPath();
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeSchema(schema) {
  fs.writeFileSync(schemaPath(), JSON.stringify(schema, null, 2));
}

function readTable(name) {
  const p = tablePath(name);
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeTable(name, rows) {
  fs.writeFileSync(tablePath(name), JSON.stringify(rows, null, 2));
}

function createTableFile(name) {
  fs.writeFileSync(tablePath(name), "[]");
}

function dropTableFile(name) {
  const p = tablePath(name);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function listTables() {
  const dir = getStorageDir();
  return fs.readdirSync(dir)
    .filter(f => f.endsWith(".json") && f !== "schema.json")
    .map(f => f.replace(/\.json$/, ""));
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
  findStorageDir,
};
