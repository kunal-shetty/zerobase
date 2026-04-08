/**
 * storage/index.js — Storage backend selector
 *
 * Selects between JSON file backend and PostgreSQL backend based on:
 *   process.env.ZEROBASE_BACKEND = "json" | "postgres"
 *   or a call to setBackend("postgres", config)
 */

const file  = require("./file");
let current = file;
let pgMod   = null;

function setBackend(type, config) {
  if (type === "postgres") {
    if (!pgMod) pgMod = require("./postgres");
    if (config) pgMod.setPgConfig(config);
    current = pgMod;
  } else {
    current = file;
  }
}

function getCurrent() {
  return current;
}

// Proxy: forward all calls to whichever backend is active
// We use a Proxy so callers don't need to change anything
const handler = {
  get(_, prop) {
    const target = getCurrent();
    const val    = target[prop];
    if (typeof val === "function") {
      return (...args) => val.apply(target, args);
    }
    return val;
  },
};

module.exports = new Proxy({}, handler);
module.exports.setBackend = setBackend;
module.exports.getCurrent  = getCurrent;
