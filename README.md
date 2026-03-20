# Zerobase CLI  ⚡

> **SQL without a database server.** A CLI-first, file-based database that stores data as JSON and lets you query it with real SQL — including `AND`/`OR`, `ORDER BY`, `LIMIT`, and aggregate functions.

```bash
npx zerobase-cli init
npx zerobase-cli query
```

---

## Install

```bash
npm install zerobase-cli
```

---

## Quick Start

```bash
zerobase init           # creates ./storage/
zerobase query          # open SQL shell
```

```sql
zerobase› CREATE TABLE users (id INT PRIMARY KEY, name TEXT, age INT);
zerobase› INSERT INTO users (name, age) VALUES ('Kunal', 19);
zerobase› INSERT INTO users (name, age) VALUES ('Ayushi', 23);
zerobase› SELECT * FROM users WHERE age > 18 ORDER BY age DESC;
```

```
  ┌────┬────────┬─────┐
  │ id │ name   │ age │
  ├────┼────────┼─────┤
  │ 2  │ Ayushi │ 23  │
  │ 1  │ Kunal  │ 19  │
  └────┴────────┴─────┘
  2 row(s)
```

---

## CLI Commands

| Command | Description |
|---------|-------------|
| `zerobase init` | Initialize storage in current directory |
| `zerobase query` | Open interactive SQL shell (↑↓ history) |
| `zerobase tables` | List all tables |
| `zerobase describe <table>` | Show schema + row count |
| `zerobase drop <table>` | Drop a table |
| `zerobase help` | Help |

**Shell commands (inside `zerobase query`):**

| Command | Description |
|---------|-------------|
| `.tables` | List all tables |
| `.describe <table>` | Show table schema |
| `.drop <table>` | Drop a table |
| `.history` | Show recent queries |
| `.exit` | Quit |

---

## Full SQL Reference

### CREATE TABLE
```sql
CREATE TABLE products (id INT PRIMARY KEY, name TEXT, price FLOAT, active BOOL);
```

### DROP TABLE
```sql
DROP TABLE products;
```

### INSERT
```sql
INSERT INTO products (name, price) VALUES ('Widget', 9.99);
```

### SELECT
```sql
-- Basic
SELECT * FROM products;
SELECT name, price FROM products;

-- WHERE with AND / OR
SELECT * FROM products WHERE price > 5 AND active = 1;
SELECT * FROM products WHERE price < 2 OR price > 50;

-- ORDER BY + LIMIT
SELECT * FROM products ORDER BY price DESC LIMIT 10;
SELECT * FROM products ORDER BY name ASC;

-- Aggregates
SELECT COUNT(*) FROM products;
SELECT COUNT(*) AS total FROM products WHERE active = 1;
SELECT SUM(price), MIN(price), MAX(price), AVG(price) FROM products;
```

### UPDATE
```sql
UPDATE products SET price = 12.99 WHERE id = 1;
```

### DELETE
```sql
DELETE FROM products WHERE id = 1;
DELETE FROM products;   -- clears all rows
```

---

## Runtime SDK

```js
const db = require('zerobase-cli');

await db.query("INSERT INTO users (name, age) VALUES ('Kunal', 20)");

const result = await db.query("SELECT * FROM users WHERE age > 18 ORDER BY age DESC");
console.log(result.rows);

const rows = await db.select("SELECT * FROM users LIMIT 5");

const stats = await db.query("SELECT COUNT(*) AS total, AVG(age) AS avg_age FROM users");
console.log(stats.rows[0]); // { total: 3, avg_age: 19.67 }
```

---

## Storage Format

```
./storage/
  schema.json     ← column definitions, types, primary keys
  users.json      ← row data
  products.json   ← row data
```

**Works from any subdirectory** — Zerobase walks up the directory tree to find `storage/`, just like git finds `.git`.

---

## Supported Types & Operators

| SQL Type | JS Type  |
|----------|----------|
| INT      | number   |
| FLOAT    | number   |
| TEXT     | string   |
| BOOL     | boolean  |

**WHERE operators:** `=`  `!=`  `>`  `<`  `>=`  `<=`  
**Logic:** `AND`  `OR`

---

## Architecture

```
zerobase-cli/
├── bin/cli.js              ← Interactive shell + CLI commands
├── src/
│   ├── engine/
│   │   ├── parser.js       ← Regex SQL parser → AST
│   │   └── executor.js     ← Runs AST against JSON storage
│   ├── storage/file.js     ← Read/write JSON, project-root detection
│   └── index.js            ← Runtime SDK
└── tests/test.js           ← 46 passing tests
```

---

## Roadmap

- [ ] Multi-column ORDER BY
- [ ] GROUP BY
- [ ] JOIN support
- [ ] Export to CSV
- [ ] Web dashboard

---

## License

MIT
