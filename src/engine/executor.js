/**
 * executor.js — Executes parsed SQL AST against JSON file storage
 */

const { QUERY_TYPES } = require("./parser");
const storage = require("../storage/file");

// ── WHERE evaluation: handles single condition OR array (AND/OR) ─
function matchesSingleCondition(row, cond) {
  const rowVal = row[cond.column];
  if (rowVal === undefined) return false;
  switch (cond.operator) {
    case "=":  return rowVal == cond.value;
    case "!=": return rowVal != cond.value;
    case ">":  return rowVal > cond.value;
    case "<":  return rowVal < cond.value;
    case ">=": return rowVal >= cond.value;
    case "<=": return rowVal <= cond.value;
    default:   return false;
  }
}

function matchesWhere(row, where) {
  if (!where) return true;

  // Array form: [cond, 'AND'|'OR', cond, ...]
  if (Array.isArray(where)) {
    let result = matchesSingleCondition(row, where[0]);
    for (let i = 1; i < where.length; i += 2) {
      const logic = where[i];       // 'AND' or 'OR'
      const next  = where[i + 1];
      const nextResult = matchesSingleCondition(row, next);
      if (logic === "AND") result = result && nextResult;
      else                 result = result || nextResult;
    }
    return result;
  }

  // Single condition object
  return matchesSingleCondition(row, where);
}

// ── Schema validation ────────────────────────────────────────────
function validateAgainstSchema(tableName, data, schema) {
  const tableSchema = schema[tableName];
  if (!tableSchema) throw new Error(`Table "${tableName}" not found in schema.`);
  for (const [col, val] of Object.entries(data)) {
    const expectedType = tableSchema.columns[col];
    if (!expectedType)
      throw new Error(`Column "${col}" does not exist in table "${tableName}".\n  Available columns: ${Object.keys(tableSchema.columns).join(", ")}`);
    const actualType = typeof val;
    if (actualType !== expectedType)
      throw new Error(`Type mismatch on "${col}": expected ${expectedType}, got ${actualType} (value: ${JSON.stringify(val)}).\n  Hint: Strings must be quoted, e.g. '${val}'`);
  }
}

function generateId(rows, primaryKey) {
  if (!primaryKey || rows.length === 0) return 1;
  return Math.max(...rows.map(r => r[primaryKey] || 0)) + 1;
}

// ── Aggregate computation ────────────────────────────────────────
function computeAggregate(fn, col, rows) {
  if (fn === "COUNT") return rows.length;
  const vals = rows.map(r => r[col]).filter(v => v !== undefined && v !== null);
  if (vals.length === 0) return null;
  switch (fn) {
    case "SUM": return vals.reduce((a, b) => a + b, 0);
    case "MIN": return Math.min(...vals);
    case "MAX": return Math.max(...vals);
    case "AVG": return parseFloat((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(4));
  }
}

// ── Executors ────────────────────────────────────────────────────

function executeCreate({ tableName, columns, primaryKey }) {
  const schema = storage.readSchema();
  if (schema[tableName]) throw new Error(`Table "${tableName}" already exists.`);
  schema[tableName] = { columns, primaryKey };
  storage.writeSchema(schema);
  storage.createTableFile(tableName);
  return { message: `Table "${tableName}" created.`, columns, primaryKey };
}

function executeDrop({ tableName }) {
  const schema = storage.readSchema();
  if (!schema[tableName]) throw new Error(`Table "${tableName}" does not exist.`);
  delete schema[tableName];
  storage.writeSchema(schema);
  storage.dropTableFile(tableName);
  return { message: `Table "${tableName}" dropped.`, tableName };
}

function executeInsert({ tableName, data }) {
  const schema = storage.readSchema();
  if (!schema[tableName])
    throw new Error(`Table "${tableName}" not found.\n  Hint: Run CREATE TABLE ${tableName} (...); first, or use .tables to see existing tables.`);
  validateAgainstSchema(tableName, data, schema);
  const rows = storage.readTable(tableName);
  const primaryKey = schema[tableName].primaryKey;
  if (primaryKey && data[primaryKey] === undefined) data[primaryKey] = generateId(rows, primaryKey);
  if (primaryKey && rows.some(r => r[primaryKey] === data[primaryKey]))
    throw new Error(`Duplicate primary key: ${data[primaryKey]} already exists in "${primaryKey}".`);
  // Reorder so PK and schema columns come first (preserves defined column order)
  const schemaColumns = Object.keys(schema[tableName].columns);
  const ordered = {};
  schemaColumns.forEach(col => { if (col in data) ordered[col] = data[col]; });

  rows.push(ordered);
  storage.writeTable(tableName, rows);
  return { message: `1 row inserted into "${tableName}".`, inserted: ordered, primaryKey };
}

function executeSelect({ tableName, columns, where, orderBy, limit }) {
  const schema = storage.readSchema();
  if (!schema[tableName])
    throw new Error(`Table "${tableName}" not found.\n  Use .tables to see existing tables.`);

  const rows    = storage.readTable(tableName);
  let   result  = rows.filter(row => matchesWhere(row, where));

  // ── Aggregates ──────────────────────────────────────────────
  const hasAgg = columns.some(c => c.type === "agg");
  if (hasAgg) {
    const aggRow = {};
    for (const col of columns) {
      if (col.type === "agg") {
        if (col.col !== "*") {
          const tableColumns = Object.keys(schema[tableName].columns);
          if (!tableColumns.includes(col.col))
            throw new Error(`Column "${col.col}" does not exist in table "${tableName}".`);
        }
        aggRow[col.alias] = computeAggregate(col.fn, col.col, result);
      } else {
        // Non-aggregate alongside aggregate — just take first value
        aggRow[col.alias || col.name] = result.length > 0 ? result[0][col.name] : null;
      }
    }
    return { rows: [aggRow], count: 1, aggregated: true };
  }

  // ── Normal column projection ────────────────────────────────
  if (!(columns.length === 1 && columns[0].name === "*")) {
    const tableColumns = Object.keys(schema[tableName].columns);
    for (const col of columns) {
      if (!tableColumns.includes(col.name))
        throw new Error(`Column "${col.name}" does not exist in table "${tableName}".\n  Available: ${tableColumns.join(", ")}`);
    }
    result = result.map(row => {
      const projected = {};
      columns.forEach(col => { projected[col.alias || col.name] = row[col.name]; });
      return projected;
    });
  }

  // ── ORDER BY ────────────────────────────────────────────────
  if (orderBy) {
    const { column, direction } = orderBy;
    result.sort((a, b) => {
      const av = a[column], bv = b[column];
      if (av === bv) return 0;
      const cmp = av < bv ? -1 : 1;
      return direction === "ASC" ? cmp : -cmp;
    });
  }

  // ── LIMIT ───────────────────────────────────────────────────
  if (limit !== null) result = result.slice(0, limit);

  return { rows: result, count: result.length };
}

function executeUpdate({ tableName, updates, where }) {
  const schema = storage.readSchema();
  if (!schema[tableName]) throw new Error(`Table "${tableName}" not found.`);
  validateAgainstSchema(tableName, updates, schema);
  const rows = storage.readTable(tableName);
  let updatedCount = 0;
  const newRows = rows.map(row => {
    if (matchesWhere(row, where)) { updatedCount++; return { ...row, ...updates }; }
    return row;
  });
  storage.writeTable(tableName, newRows);
  return { message: `${updatedCount} row(s) updated in "${tableName}".`, updatedCount };
}

function executeDelete({ tableName, where }) {
  const schema = storage.readSchema();
  if (!schema[tableName]) throw new Error(`Table "${tableName}" not found.`);
  const rows = storage.readTable(tableName);
  const newRows = rows.filter(row => !matchesWhere(row, where));
  const deletedCount = rows.length - newRows.length;
  storage.writeTable(tableName, newRows);
  return { message: `${deletedCount} row(s) deleted from "${tableName}".`, deletedCount };
}

// ── Router ───────────────────────────────────────────────────────
function execute(parsed) {
  switch (parsed.type) {
    case QUERY_TYPES.CREATE: return executeCreate(parsed);
    case QUERY_TYPES.DROP:   return executeDrop(parsed);
    case QUERY_TYPES.INSERT: return executeInsert(parsed);
    case QUERY_TYPES.SELECT: return executeSelect(parsed);
    case QUERY_TYPES.UPDATE: return executeUpdate(parsed);
    case QUERY_TYPES.DELETE: return executeDelete(parsed);
    default: throw new Error(`Unknown query type: ${parsed.type}`);
  }
}

module.exports = { execute };
