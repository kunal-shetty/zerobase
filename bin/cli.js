#!/usr/bin/env node

/**
 * cli.js — Zerobase CLI
 * Commands: init, query, tables, describe, drop, help
 */

const readline = require("readline");
const path     = require("path");
const fs       = require("fs");
const os       = require("os");
const figlet   = require("figlet");
const gradient = require("gradient-string");
const boxen    = require("boxen");
const chalk    = require("chalk");

const { parse, QUERY_TYPES } = require("../src/engine/parser");
const { execute }            = require("../src/engine/executor");
const storage                = require("../src/storage/file");

// ── Fallback ANSI (used for table rendering where chalk isn't needed) ──
const c = {
  reset:"\x1b[0m", bold:"\x1b[1m", dim:"\x1b[2m",
  cyan:"\x1b[36m", yellow:"\x1b[33m",
  bgreen:"\x1b[92m", bred:"\x1b[91m", bcyan:"\x1b[96m",
};

const ok   = (msg) => console.log(`  ${c.bgreen}✓${c.reset}  ${msg}`);
const fail = (msg) => {
  const lines = msg.split("\n");
  console.error(`\n  ${c.bred}✗${c.reset}  ${chalk.bold(lines[0])}`);
  lines.slice(1).forEach(l => console.error(`     ${chalk.dim(l)}`));
  console.error();
};
const info = (msg) => console.log(`     ${chalk.dim(msg)}`);
const hint = (msg) => console.log(`  ${c.yellow}›${c.reset}  ${chalk.dim(msg)}`);

// ── History ───────────────────────────────────────────────────────
const HISTORY_FILE = path.join(os.homedir(), ".zerobase_history");
const MAX_HISTORY  = 100;

function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE))
      return fs.readFileSync(HISTORY_FILE, "utf8").split("\n").filter(Boolean);
  } catch {}
  return [];
}

function saveHistory(history) {
  try { fs.writeFileSync(HISTORY_FILE, history.slice(-MAX_HISTORY).join("\n")); } catch {}
}

// ── Banner ────────────────────────────────────────────────────────
function banner() {
  console.clear();

  const art = figlet.textSync("ZEROBASE", { font: "ANSI Shadow" });
  console.log(gradient(["#22d3ee", "#3b82f6", "#6366f1", "#a855f7"]).multiline(art));

  const tagline =
    chalk.bold.white("SQL Engine over JSON\n") +
    chalk.gray("Zero setup · No server · Just queries\n\n") +
    chalk.dim("CREATE · INSERT · SELECT · UPDATE · DELETE");

  console.log(
    boxen(`${chalk.cyan.bold("Zerobase CLI")} ${chalk.gray("v1.1.0")}\n\n${tagline}`, {
      padding:       { top: 1, bottom: 1, left: 3, right: 3 },
      borderStyle:   "double",
      borderColor:   "cyan",
      textAlignment: "center",
    })
  );

  console.log(chalk.dim("\n  ⚡ Run SQL locally without installing a database\n"));
}

// ── Pretty table ──────────────────────────────────────────────────
function printTable(rows) {
  if (!rows || rows.length === 0) {
    console.log(`  ${chalk.dim("(no rows)")}\n`);
    return;
  }

  const cols   = Object.keys(rows[0]);
  const widths = cols.map(col =>
    Math.max(col.length, ...rows.map(r => String(r[col] ?? "null").length))
  );

  const top  = "  ┌" + widths.map(w => "─".repeat(w + 2)).join("┬") + "┐";
  const sep  = "  ├" + widths.map(w => "─".repeat(w + 2)).join("┼") + "┤";
  const bot  = "  └" + widths.map(w => "─".repeat(w + 2)).join("┴") + "┘";
  const head = "  │" + cols.map((col, i) =>
    ` ${chalk.bold.cyan(col.padEnd(widths[i]))} `
  ).join("│") + "│";

  console.log(top);
  console.log(head);
  console.log(sep);
  rows.forEach(row => {
    const line = "  │" + cols.map((col, i) => {
      const raw = row[col] ?? "null";
      const val = String(raw);
      const colored =
        raw === null || raw === "null" ? chalk.dim("null") :
        typeof raw === "number"        ? chalk.yellow(val) :
                                         val;
      const pad = " ".repeat(Math.max(0, widths[i] - val.length));
      return ` ${colored}${pad} `;
    }).join("│") + "│";
    console.log(line);
  });
  console.log(bot);
  console.log(`  ${chalk.dim(rows.length + " row(s)")}\n`);
}

// ── Timing ───────────────────────────────────────────────────────
function elapsed(start) {
  const ms = Date.now() - start;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
}

// ── Run SQL ───────────────────────────────────────────────────────
function runSQL(sql, { silent = false } = {}) {
  const trimmed = sql.trim();
  if (!trimmed) return;
  const start = Date.now();
  try {
    const parsed = parse(trimmed);
    const result = execute(parsed);
    const time   = elapsed(start);

    switch (parsed.type) {
      case QUERY_TYPES.CREATE: {
        const colCount = Object.keys(result.columns).length;
        ok(`Table ${chalk.bold.cyan(parsed.tableName)} created  ${chalk.dim(time)}`);
        console.log();
        // Print schema as a mini table
        const schemaRows = Object.entries(result.columns).map(([col, type]) => ({
          column: col,
          type,
          constraint: result.primaryKey === col ? "PRIMARY KEY" : "",
        }));
        printTable(schemaRows);
        break;
      }
      case QUERY_TYPES.DROP:
        ok(`Table ${chalk.bold(result.tableName)} dropped ${chalk.dim(`(${time})`)}`);
        break;
      case QUERY_TYPES.INSERT: {
        const pkVal = result.primaryKey ? result.inserted[result.primaryKey] : null;
        const pkStr = pkVal !== null ? chalk.dim(` · ${result.primaryKey}: ${chalk.yellow(pkVal)}`) : "";
        ok(`1 row inserted into ${chalk.bold.cyan(parsed.tableName)}${pkStr}  ${chalk.dim(time)}`);
        // Show the inserted row as a mini table
        printTable([result.inserted]);
        break;
      }
      case QUERY_TYPES.SELECT:
        if (!silent) {
          printTable(result.rows);
          console.log(`  ${chalk.dim("─".repeat(40))}`);
          console.log(`  ${chalk.green("✓")} ${chalk.bold(result.count)} row(s) returned  ${chalk.dim("· " + time)}`);
          console.log();
        }
        break;
      case QUERY_TYPES.UPDATE:
        ok(`${chalk.bold.yellow(result.updatedCount)} row(s) updated in ${chalk.bold.cyan(parsed.tableName)}  ${chalk.dim(time)}`);
        console.log();
        break;
      case QUERY_TYPES.DELETE:
        ok(`${chalk.bold.yellow(result.deletedCount)} row(s) deleted from ${chalk.bold.cyan(parsed.tableName)}  ${chalk.dim(time)}`);
        console.log();
        break;
    }
    return result;
  } catch (e) {
    fail(e.message);
    return null;
  }
}

// ── CLI Commands ──────────────────────────────────────────────────
function cmdInit() {
  try {
    const dir        = storage.ensureStorageDir();
    const schemaPath = path.join(dir, "schema.json");
    if (!fs.existsSync(schemaPath)) fs.writeFileSync(schemaPath, JSON.stringify({}, null, 2));
    console.log();
    ok(`Zerobase initialized → ${chalk.cyan("./storage/")}`);
    console.log();
    hint(`Open the SQL shell:   ${chalk.cyan("zerobase query")}`);
    hint(`Or use in Node.js:    ${chalk.cyan("const db = require('zerobase-cli')")}`);
    console.log();
  } catch (e) { fail(e.message); }
}

function cmdTables() {
  try {
    const tables = storage.listTables();
    console.log();
    if (tables.length === 0) {
      console.log(`  ${chalk.dim("No tables yet.")}  ${chalk.yellow("›")}  CREATE TABLE name (col TYPE, ...);`);
    } else {
      console.log(`  ${chalk.bold("Tables")}  ${chalk.dim(`(${tables.length})`)}`);
      console.log();
      const schema = storage.readSchema();
      tables.forEach(t => {
        const s    = schema[t] || {};
        const cols = Object.keys(s.columns || {}).length;
        const pk   = s.primaryKey ? chalk.dim(`  pk: ${s.primaryKey}`) : "";
        console.log(`  ${chalk.cyan("▸")}  ${chalk.bold(t)}  ${chalk.dim(`(${cols} cols)`)}${pk}`);
      });
    }
    console.log();
  } catch (e) { fail(e.message); }
}

function cmdDescribe(tableName) {
  if (!tableName) { fail("Usage: zerobase describe <tableName>"); return; }
  try {
    const schema = storage.readSchema();
    const table  = schema[tableName.toLowerCase()];
    if (!table) { fail(`Table "${tableName}" not found.\n  Use .tables to see all tables.`); return; }
    const rows = storage.readTable(tableName.toLowerCase());
    console.log();
    console.log(`  ${chalk.bold.cyan(tableName)}  ${chalk.dim(`(${rows.length} rows)`)}`);
    console.log(`  ${"─".repeat(44)}`);
    console.log(`  ${chalk.bold("COLUMN".padEnd(18) + " " + "TYPE".padEnd(10) + " CONSTRAINT")}`);
    console.log(`  ${"─".repeat(44)}`);
    Object.entries(table.columns).forEach(([col, type]) => {
      const pk = table.primaryKey === col ? ` ${chalk.yellow("◆ PRIMARY KEY")}` : "";
      console.log(`  ${col.padEnd(18)} ${chalk.dim(type.padEnd(10))}${pk}`);
    });
    console.log();
  } catch (e) { fail(e.message); }
}

function cmdDrop(tableName) {
  if (!tableName) { fail("Usage: zerobase drop <tableName>"); return; }
  runSQL(`DROP TABLE ${tableName};`);
}

function cmdHelp() {
  console.log(`
  ${chalk.bold.cyan("Zerobase CLI")}  ${chalk.dim("— SQL over JSON, no server needed")}

  ${chalk.bold("CLI Commands")}
  ${chalk.cyan("zerobase init")}                  Initialize storage in current directory
  ${chalk.cyan("zerobase query")}                 Open interactive SQL shell  ${chalk.dim("(↑↓ history)")}
  ${chalk.cyan("zerobase tables")}                List all tables
  ${chalk.cyan("zerobase describe <table>")}      Show table schema + row count
  ${chalk.cyan("zerobase drop <table>")}          Drop a table
  ${chalk.cyan("zerobase help")}                  Show this help

  ${chalk.bold("Shell commands")}
  ${chalk.cyan(".tables")}        List all tables        ${chalk.cyan(".describe <t>")}   Schema for table
  ${chalk.cyan(".drop <t>")}      Drop a table           ${chalk.cyan(".history")}        Recent queries
  ${chalk.cyan(".exit")}          Quit

  ${chalk.bold("Supported SQL")}
  ${chalk.dim("CREATE TABLE users (id INT PRIMARY KEY, name TEXT, age INT);")}
  ${chalk.dim("DROP TABLE users;")}
  ${chalk.dim("INSERT INTO users (name, age) VALUES ('Kunal', 20);")}
  ${chalk.dim("SELECT * FROM users;")}
  ${chalk.dim("SELECT * FROM users WHERE age > 18 AND name = 'Kunal';")}
  ${chalk.dim("SELECT * FROM users ORDER BY age DESC LIMIT 5;")}
  ${chalk.dim("SELECT COUNT(*), MAX(age), MIN(age), AVG(age) FROM users;")}
  ${chalk.dim("UPDATE users SET age = 21 WHERE id = 1;")}
  ${chalk.dim("DELETE FROM users WHERE id = 1;")}

  ${chalk.bold("Types:")}      INT  TEXT  FLOAT  BOOL
  ${chalk.bold("Operators:")}  =  !=  >  <  >=  <=
  ${chalk.bold("Logic:")}      AND  OR
`);
}

// ── Interactive SQL Shell ─────────────────────────────────────────
function cmdQuery() {
  if (!storage.isInitialized()) {
    console.log();
    fail(`Storage not found.\n  Run ${chalk.cyan("zerobase init")} in your project root first.`);
    process.exit(1);
  }

  banner();
  const storageDir = storage.getStorageDir();
  console.log(`  ${chalk.dim("Storage: " + storageDir)}`);
  console.log(
    `  ${chalk.dim("End queries with ")}${chalk.cyan(";")}${chalk.dim("  ·  ")}${chalk.cyan("↑ ↓")}${chalk.dim(" for history  ·  ")}${chalk.cyan(".help")}${chalk.dim(" for commands  ·  ")}${chalk.cyan(".tables")}${chalk.dim(" to view tables  ·  ")}${chalk.cyan(".exit")}${chalk.dim(" to exit")}`
  );
  console.log();

  const history = loadHistory();

  const rl = readline.createInterface({
    input:       process.stdin,
    output:      process.stdout,
    prompt:      `${chalk.bold.cyan("zerobase")}${chalk.dim("›")} `,
    history,
    historySize: MAX_HISTORY,
  });

  rl.prompt();
  let buffer = "";

  rl.on("line", (line) => {
    const trimmed = line.trim();

    if (trimmed === ".exit" || trimmed === "exit" || trimmed === "quit") {
      saveHistory(rl.history || history);
      console.log(`\n  ${chalk.dim("Bye!")}\n`);
      rl.close(); return;
    }
    if (trimmed === ".tables")                    { cmdTables();              rl.prompt(); return; }
    if (trimmed === ".history") {
      const h = (rl.history || history).slice(0, 20).reverse();
      console.log();
      h.forEach((q, i) => console.log(`  ${chalk.dim(String(i + 1).padStart(2) + ".")} ${q}`));
      console.log();
      rl.prompt(); return;
    }
    if (trimmed.startsWith(".describe "))         { cmdDescribe(trimmed.slice(10)); rl.prompt(); return; }
    if (trimmed.startsWith(".drop "))             { cmdDrop(trimmed.slice(6));      rl.prompt(); return; }
    if (trimmed === ".help" || trimmed === "help") { cmdHelp();                     rl.prompt(); return; }
    if (trimmed === "")                           { rl.prompt(); return; }

    buffer += (buffer ? " " : "") + trimmed;

    if (buffer.includes(";")) {
      const last = (rl.history || [])[0];
      if (buffer !== last) (rl.history || history).unshift(buffer);
      runSQL(buffer);
      buffer = "";
    }

    rl.prompt();
  });

  rl.on("close", () => {
    saveHistory(rl.history || history);
    process.exit(0);
  });
}

// ── Main ──────────────────────────────────────────────────────────
const [,, command, ...args] = process.argv;
switch (command) {
  case "init":     cmdInit(); break;
  case "query":    cmdQuery(); break;
  case "tables":   cmdTables(); break;
  case "describe": cmdDescribe(args[0]); break;
  case "drop":     cmdDrop(args[0]); break;
  case "help": case "--help": case "-h": cmdHelp(); break;
  default:
    if (!command) { banner(); cmdHelp(); }
    else { fail(`Unknown command: "${command}".\n  Run zerobase help to see available commands.`); }
}
