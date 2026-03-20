/**
 * index.js — Zerobase Runtime SDK
 *
 * Usage:
 *   const db = require('zerobase-cli');
 *   await db.query("INSERT INTO users (name, age) VALUES ('Kunal', 20)");
 *   const result = await db.query("SELECT * FROM users WHERE age > 18");
 */

const { parse } = require("./engine/parser");
const { execute } = require("./engine/executor");
const { isInitialized } = require("./storage/file");

/**
 * Execute a SQL query string.
 * Returns the result object from the executor.
 *
 * @param {string} sql - The SQL query to run
 * @returns {Promise<object>} - Query result
 */
async function query(sql) {
  if (!isInitialized()) {
    throw new Error(
      `Zerobase storage not initialized.\nRun "npx zerobase init" in your project directory first.`
    );
  }

  const parsed = parse(sql);
  const result = execute(parsed);
  return result;
}

/**
 * Convenience: SELECT rows directly
 * @param {string} sql - SELECT statement
 * @returns {Promise<Array>} - array of rows
 */
async function select(sql) {
  const result = await query(sql);
  return result.rows;
}

module.exports = { query, select };
