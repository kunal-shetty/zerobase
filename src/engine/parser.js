/**
 * parser.js — Regex-based SQL parser for Zerobase CLI
 * Supports: CREATE TABLE, INSERT, SELECT (with AND/OR/ORDER BY/LIMIT/aggregates),
 *           UPDATE, DELETE, DROP TABLE, COUNT/SUM/MIN/MAX/AVG
 */

const QUERY_TYPES = {
  CREATE: "CREATE", INSERT: "INSERT", SELECT: "SELECT",
  UPDATE: "UPDATE", DELETE: "DELETE", DROP: "DROP",
};

// ── Query type detection ─────────────────────────────────────────
function detectQueryType(sql) {
  const n = sql.trim().toUpperCase();
  if (n.startsWith("CREATE TABLE")) return QUERY_TYPES.CREATE;
  if (n.startsWith("INSERT INTO"))  return QUERY_TYPES.INSERT;
  if (n.startsWith("SELECT"))       return QUERY_TYPES.SELECT;
  if (n.startsWith("UPDATE"))       return QUERY_TYPES.UPDATE;
  if (n.startsWith("DELETE FROM"))  return QUERY_TYPES.DELETE;
  if (n.startsWith("DROP TABLE"))   return QUERY_TYPES.DROP;

  const first = n.split(/\s+/)[0];
  const hints = {
    CREATE:   "Did you mean: CREATE TABLE name (col TYPE, ...);",
    INSERT:   "Did you mean: INSERT INTO tableName (col1, col2) VALUES (val1, val2);",
    SELECT:   "Did you mean: SELECT * FROM tableName;",
    UPDATE:   "Did you mean: UPDATE tableName SET col = val WHERE id = 1;",
    DELETE:   "Did you mean: DELETE FROM tableName WHERE id = 1;",
    DROP:     "Did you mean: DROP TABLE tableName;",
    ALTER:    "ALTER TABLE is not supported in this version.",
    SHOW:     "Type .tables in the shell to list all tables.",
    DESCRIBE: "Use .describe tableName in the shell.",
    TRUNCATE: "Use DELETE FROM tableName; (no WHERE) to clear all rows.",
  };
  const hint = hints[first] ? `\n  Hint: ${hints[first]}` : "";
  throw new Error(`Unknown command: "${first}".\n  Supported: CREATE TABLE, INSERT INTO, SELECT, UPDATE, DELETE FROM, DROP TABLE${hint}`);
}

// ── WHERE clause: supports AND / OR ─────────────────────────────
// Returns array of condition objects joined by logic operators
// e.g. "age > 18 AND name = 'Kunal'" →
//   [{ column, operator, value }, 'AND', { column, operator, value }]
function parseSingleCondition(str) {
  const m = str.trim().match(/^(\w+)\s*(=|!=|>=|<=|>|<)\s*('([^']*)'|(\d+(?:\.\d+)?))$/);
  if (!m) throw new Error(
    `Invalid condition: "${str.trim()}".\n  Format:  column operator value\n  Example: age > 18   |   name = 'Kunal'   |   id != 3\n  Operators: =  !=  >  <  >=  <=`
  );
  return { column: m[1], operator: m[2], value: m[5] !== undefined ? Number(m[5]) : m[4] };
}

function parseWhere(whereStr) {
  if (!whereStr || !whereStr.trim()) return null;

  // Split on AND / OR while keeping the operator
  const parts = whereStr.trim().split(/\s+(AND|OR)\s+/i);
  if (parts.length === 1) {
    return parseSingleCondition(parts[0]);
  }

  // parts = [cond, 'AND'/'OR', cond, 'AND'/'OR', cond, ...]
  const conditions = [];
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) conditions.push(parseSingleCondition(parts[i]));
    else             conditions.push(parts[i].toUpperCase()); // 'AND' or 'OR'
  }
  return conditions; // array form: [cond, 'AND', cond, ...]
}

// ── SELECT column parsing: handles aggregates ────────────────────
// Returns array of column descriptors:
//   { type: 'col', name }  |  { type: 'agg', fn: 'COUNT', col: '*'|colName, alias }
function parseSelectColumns(raw) {
  if (raw.trim() === "*") return [{ type: "col", name: "*" }];

  return raw.split(",").map(part => {
    const s = part.trim();
    // Aggregate: COUNT(*), SUM(age), MIN(price) AS min_price
    const aggMatch = s.match(/^(COUNT|SUM|MIN|MAX|AVG)\s*\(\s*(\*|\w+)\s*\)(?:\s+AS\s+(\w+))?$/i);
    if (aggMatch) {
      return {
        type:  "agg",
        fn:    aggMatch[1].toUpperCase(),
        col:   aggMatch[2].toLowerCase() === "*" ? "*" : aggMatch[2].toLowerCase(),
        alias: aggMatch[3] ? aggMatch[3].toLowerCase() : `${aggMatch[1].toLowerCase()}(${aggMatch[2].toLowerCase()})`,
      };
    }
    // Regular col with optional alias: name AS n
    const aliasMatch = s.match(/^(\w+)(?:\s+AS\s+(\w+))?$/i);
    if (aliasMatch) return { type: "col", name: aliasMatch[1].toLowerCase(), alias: aliasMatch[2]?.toLowerCase() };
    throw new Error(`Cannot parse column expression: "${s}"`);
  });
}

// ── Parsers ──────────────────────────────────────────────────────

function parseCreate(sql) {
  const match = sql.match(/CREATE\s+TABLE\s+(\w+)\s*\((.+)\)\s*;?/is);
  if (!match) {
    if (/CREATE\s+TABLE\s+\w+\s*;/i.test(sql))
      throw new Error(`CREATE TABLE missing columns.\n  Example: CREATE TABLE users (id INT PRIMARY KEY, name TEXT, age INT);`);
    throw new Error(`Invalid CREATE TABLE syntax.\n  Expected: CREATE TABLE tableName (col TYPE, ...);\n  Example:  CREATE TABLE users (id INT PRIMARY KEY, name TEXT, age INT);`);
  }
  const tableName = match[1].toLowerCase();
  const columns = {}; let primaryKey = null;
  const colRx = /(\w+)\s+(INT|TEXT|FLOAT|BOOL)(\s+PRIMARY\s+KEY)?/gi;
  let col;
  while ((col = colRx.exec(match[2])) !== null) {
    const name = col[1].toLowerCase(), type = col[2].toUpperCase();
    columns[name] = { INT:"number", TEXT:"string", FLOAT:"number", BOOL:"boolean" }[type];
    if (col[3]) primaryKey = name;
  }
  if (!Object.keys(columns).length)
    throw new Error(`No valid columns in CREATE TABLE.\n  Supported types: INT, TEXT, FLOAT, BOOL\n  Example: (id INT PRIMARY KEY, name TEXT, age INT)`);
  return { type: QUERY_TYPES.CREATE, tableName, columns, primaryKey };
}

function parseDrop(sql) {
  const match = sql.match(/DROP\s+TABLE\s+(\w+)\s*;?/is);
  if (!match) throw new Error(`Invalid DROP TABLE syntax.\n  Expected: DROP TABLE tableName;`);
  return { type: QUERY_TYPES.DROP, tableName: match[1].toLowerCase() };
}

function parseInsert(sql) {
  const match = sql.match(/INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)\s*;?/is);
  if (!match) {
    if (!/VALUES/i.test(sql)) throw new Error(`INSERT missing VALUES keyword.\n  Expected: INSERT INTO tableName (col1, col2) VALUES (val1, val2);`);
    throw new Error(`Invalid INSERT syntax.\n  Expected: INSERT INTO tableName (col1, col2) VALUES (val1, val2);\n  Example:  INSERT INTO users (name, age) VALUES ('Kunal', 20);`);
  }
  const tableName = match[1].toLowerCase();
  const columns   = match[2].split(",").map(c => c.trim().toLowerCase());
  const values    = [];
  const vRx       = /'([^']*)'|(\d+(?:\.\d+)?)/g; let vm;
  while ((vm = vRx.exec(match[3])) !== null)
    values.push(vm[1] !== undefined ? vm[1] : Number(vm[2]));
  if (columns.length !== values.length)
    throw new Error(`Column/value count mismatch: ${columns.length} column(s) but ${values.length} value(s).\n  Columns: ${columns.join(", ")}\n  Values:  ${values.join(", ")}`);
  const data = {}; columns.forEach((c, i) => (data[c] = values[i]));
  return { type: QUERY_TYPES.INSERT, tableName, data };
}

function parseSelect(sql) {
  // Strip trailing semicolon first
  const clean = sql.replace(/;$/, "").trim();

  // Pull off LIMIT n
  let limit = null;
  let working = clean.replace(/\s+LIMIT\s+(\d+)\s*$/i, (_, n) => { limit = Number(n); return ""; }).trim();

  // Pull off ORDER BY col [ASC|DESC]
  let orderBy = null;
  working = working.replace(/\s+ORDER\s+BY\s+(\w+)(?:\s+(ASC|DESC))?/i, (_, col, dir) => {
    orderBy = { column: col.toLowerCase(), direction: (dir || "ASC").toUpperCase() };
    return "";
  }).trim();

  // Core SELECT
  const match = working.match(/^SELECT\s+(.+?)\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+))?$/is);
  if (!match) {
    if (!/FROM/i.test(sql)) throw new Error(`SELECT missing FROM keyword.\n  Expected: SELECT col1, col2 FROM tableName [WHERE condition];`);
    throw new Error(`Invalid SELECT syntax.\n  Examples: SELECT * FROM users;\n            SELECT name FROM users WHERE age > 18;\n            SELECT COUNT(*) FROM users WHERE age > 18;`);
  }

  const columns   = parseSelectColumns(match[1].trim());
  const tableName = match[2].toLowerCase();
  const where     = parseWhere(match[3] || null);

  return { type: QUERY_TYPES.SELECT, tableName, columns, where, orderBy, limit };
}

function parseUpdate(sql) {
  const match = sql.match(/UPDATE\s+(\w+)\s+SET\s+(.+?)\s+WHERE\s+(.+?)\s*;?$/is);
  if (!match) {
    if (!/SET/i.test(sql))   throw new Error(`UPDATE missing SET keyword.\n  Expected: UPDATE tableName SET col = val WHERE condition;`);
    if (!/WHERE/i.test(sql)) throw new Error(`UPDATE requires a WHERE clause.\n  Example: UPDATE users SET age = 25 WHERE id = 1;`);
    throw new Error(`Invalid UPDATE syntax.\n  Expected: UPDATE tableName SET col = val WHERE condition;\n  Example:  UPDATE users SET age = 25 WHERE id = 1;`);
  }
  const updates = {}; const sRx = /(\w+)\s*=\s*('([^']*)'|(\d+(?:\.\d+)?))/g; let sm;
  while ((sm = sRx.exec(match[2])) !== null)
    updates[sm[1].toLowerCase()] = sm[4] !== undefined ? Number(sm[4]) : sm[3];
  if (!Object.keys(updates).length)
    throw new Error(`No valid SET assignments.\n  Example: SET age = 25, name = 'Alice'`);
  const where = parseWhere(match[3]);
  if (!where) throw new Error(`UPDATE requires a WHERE clause.`);
  return { type: QUERY_TYPES.UPDATE, tableName: match[1].toLowerCase(), updates, where };
}

function parseDelete(sql) {
  const match = sql.match(/DELETE\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+?))?\s*;?$/is);
  if (!match) throw new Error(`Invalid DELETE syntax.\n  Example: DELETE FROM users WHERE id = 1;`);
  return { type: QUERY_TYPES.DELETE, tableName: match[1].toLowerCase(), where: parseWhere(match[2] || null) };
}

function parse(sql) {
  if (!sql || typeof sql !== "string" || !sql.trim()) throw new Error("SQL query cannot be empty.");
  const trimmed = sql.trim();
  const type = detectQueryType(trimmed);
  switch (type) {
    case QUERY_TYPES.CREATE: return parseCreate(trimmed);
    case QUERY_TYPES.DROP:   return parseDrop(trimmed);
    case QUERY_TYPES.INSERT: return parseInsert(trimmed);
    case QUERY_TYPES.SELECT: return parseSelect(trimmed);
    case QUERY_TYPES.UPDATE: return parseUpdate(trimmed);
    case QUERY_TYPES.DELETE: return parseDelete(trimmed);
  }
}

module.exports = { parse, QUERY_TYPES };
