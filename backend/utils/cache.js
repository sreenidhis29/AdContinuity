/**
 * utils/cache.js
 * 
 * Global persistent disk cache.
 * All LLM responses are cached by content hash — survives server restarts.
 * Same ad + same URL = zero API calls, zero quota consumed, instant response.
 */

const storage = require('node-persist');
const path = require('path');

let initialized = false;

async function init() {
  if (initialized) return;
  await storage.init({
    dir: path.join(__dirname, '../.cache/llm'),
    stringify: JSON.stringify,
    parse: JSON.parse,
    encoding: 'utf8',
    ttl: 7 * 24 * 60 * 60 * 1000, // 7-day TTL — keeps cache fresh
  });
  initialized = true;
}

function makeKey(obj) {
  const str = JSON.stringify(obj);
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  return 'llm_' + Math.abs(hash >>> 0).toString(16);
}

async function get(keyObj) {
  await init();
  return storage.getItem(makeKey(keyObj));
}

async function set(keyObj, value) {
  await init();
  return storage.setItem(makeKey(keyObj), value);
}

async function clear() {
  await init();
  return storage.clear();
}

module.exports = { get, set, clear };
