/**
 * server.js — HTTP API server for ZeroBase Dashboard
 *
 * Provides REST endpoints that wrap the zerobase CLI engine
 * so the browser-based dashboard can interact with the database.
 *
 * Usage: node server.js [--port 3000]
 */

const http = require("http");
const path = require("path");
const fs   = require("fs");
const url  = require("url");

const { parse, QUERY_TYPES } = require("./src/engine/parser");
const { execute }            = require("./src/engine/executor");
const storage                = require("./src/storage/index");

// ── CORS headers ──
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// ── JSON response ──
function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json", ...CORS });
  res.end(JSON.stringify(data));
}

// ── Parse body helper ──
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

// ── Route: GET /api/status ──
async function handleStatus(req, res) {
  try {
    const initialized = storage.isInitialized();
    const storageDir   = initialized ? storage.getStorageDir() : null;
    json(res, 200, { initialized, storageDir });
  } catch (e) {
    json(res, 200, { initialized: false });
  }
}

// ── Route: GET /api/tables ──
async function handleTables(req, res) {
  try {
    if (!storage.isInitialized()) {
      json(res, 200, { tables: [], schema: {} });
      return;
    }
    const tableNames = storage.listTables();
    const schema    = storage.readSchema();
    const tables    = tableNames.map(name => {
      let rowCount = 0;
      try {
        const rows = storage.readTable(name);
        rowCount = rows.length;
      } catch {}
      return { name, rowCount };
    });
    json(res, 200, { tables, schema });
  } catch (e) {
    json(res, 500, { error: e.message });
  }
}

// ── Route: POST /api/query ──
async function handleQuery(req, res) {
  try {
    if (!storage.isInitialized()) {
      json(res, 400, { error: "Storage not initialized. Run 'zerobase init' first." });
      return;
    }
    const body  = await readBody(req);
    const { sql } = JSON.parse(body);
    if (!sql || !sql.trim()) {
      json(res, 400, { error: "SQL query is required." });
      return;
    }

    const start  = Date.now();
    const parsed = parse(sql.trim());
    const result = execute(parsed);
    const time   = Date.now() - start;

    json(res, 200, { ...result, _time: time });
  } catch (e) {
    json(res, 400, { error: e.message });
  }
}

// ── Route: POST /api/pg/connect ──
async function handlePgConnect(req, res) {
  try {
    const body = await readBody(req);
    const cfg  = JSON.parse(body);
    if (!cfg.host || !cfg.database) {
      json(res, 400, { error: "host and database are required." });
      return;
    }
    const pg = require("./src/storage/postgres");
    await pg.connect(cfg);
    const idx = require("./src/storage/index");
    idx.setBackend("postgres", cfg);
    json(res, 200, { connected: true, message: `Connected to PostgreSQL ${cfg.host}:${cfg.port}/${cfg.database}` });
  } catch (e) {
    json(res, 400, { error: e.message });
  }
}

// ── Serve static files ──
function serveFile(req, res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    const types = {
      ".html": "text/html",
      ".css":  "text/css",
      ".js":   "application/javascript",
      ".json": "application/json",
      ".png":  "image/png",
    };
    res.writeHead(200, { "Content-Type": types[ext] || "text/plain", ...CORS });
    res.end(data);
  });
}

// ── Main server ──
const PORT = process.argv.includes("--port")
  ? Number(process.argv[process.argv.indexOf("--port") + 1])
  : 3000;

const server = http.createServer(async (req, res) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname  = parsedUrl.pathname;

  // Dashboard SPA
  if (req.method === "GET" && (pathname === "/" || pathname === "/dashboard")) {
    serveFile(req, res, path.join(__dirname, "dashboard.html"));
    return;
  }

  // API routes
  if (pathname.startsWith("/api/")) {
    const route = pathname.slice(4); // "/status", "/tables", "/query", etc.

    if (req.method === "GET" && route === "/status") {
      await handleStatus(req, res);
    } else if (req.method === "GET" && route === "/tables") {
      await handleTables(req, res);
    } else if (req.method === "POST" && route === "/query") {
      await handleQuery(req, res);
    } else if (req.method === "POST" && route === "/pg/connect") {
      await handlePgConnect(req, res);
    } else {
      json(res, 404, { error: `Route not found: ${route}` });
    }
    return;
  }

  // Static assets
  serveFile(req, res, path.join(__dirname, pathname));
});

server.listen(PORT, () => {
  console.log(`\n  ZeroBase Dashboard running at http://localhost:${PORT}\n`);
  console.log(`  Open http://localhost:${PORT}/dashboard in your browser\n`);
});
