/**
 * file.js — JSON file I/O for Zerobase
 *
 * Storage resolution: walks UP from CWD until storage/schema.json is found,
 * exactly like git finds .git — so you can run from any subdirectory.
 */

const fs   = require("fs");
const path = require("path");

function findProjectRoot(startDir) {
  let dir = startDir;
  const { root } = path.parse(dir);
  while (true) {
    if (fs.existsSync(path.join(dir, "storage", "schema.json"))) return dir;
    if (dir === root) return null;
    dir = path.dirname(dir);
  }
}

function getStorageDir() {
  const root = findProjectRoot(process.cwd());
  return path.join(root || process.cwd(), "storage");
}

function getSchemaPath()        { return path.join(getStorageDir(), "schema.json"); }
function getTablePath(name)     { return path.join(getStorageDir(), `${name}.json`); }

function ensureStorageDir() {
  const dir = path.join(process.cwd(), "storage");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readSchema() {
  const p = getSchemaPath();
  if (!fs.existsSync(p))
    throw new Error(`No Zerobase storage found.\n  Run "zerobase init" in your project root first.`);
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch (e) { throw new Error(`schema.json is corrupted: ${e.message}`); }
}

function writeSchema(schema) {
  fs.writeFileSync(getSchemaPath(), JSON.stringify(schema, null, 2));
}

function readTable(name) {
  const p = getTablePath(name);
  if (!fs.existsSync(p))
    throw new Error(`Table "${name}" does not exist.\n  Hint: Run CREATE TABLE ${name} (...); first, or use .tables to see existing tables.`);
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch (e) { throw new Error(`Data file for "${name}" is corrupted: ${e.message}`); }
}

function writeTable(name, rows) {
  fs.writeFileSync(getTablePath(name), JSON.stringify(rows, null, 2));
}

function createTableFile(name) {
  const p = getTablePath(name);
  if (fs.existsSync(p)) throw new Error(`Table "${name}" already exists.`);
  fs.writeFileSync(p, JSON.stringify([], null, 2));
}

function dropTableFile(name) {
  const p = getTablePath(name);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function isInitialized()  { return findProjectRoot(process.cwd()) !== null; }
function listTables()     { return Object.keys(readSchema()); }

module.exports = {
  readSchema, writeSchema, readTable, writeTable,
  createTableFile, dropTableFile,
  isInitialized, listTables,
  ensureStorageDir, getStorageDir, findProjectRoot,
};
