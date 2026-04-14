/**
 * utils/geminiClient.js
 * Shared Google Generative AI (Gemini) client singleton.
 *
 * Model used: gemini-2.0-flash  — FREE tier, fast, multimodal
 * 
 * ADVANCED UPGRADE:
 * - Persistent Disk Cache: Saved to ./.cache/ via node-persist (survives restarts)
 * - Strict Interval Throttling: Ensures ~4s spacing between requests to avoid burst rejections.
 * - Sliding Window Enforcement: Strictly caps RPM at 12.
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const storage = require('node-persist');
const { logStage, logError } = require('./logger');

// Instantiate Gemni Client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const DEFAULT_MODEL = 'gemini-2.0-flash';

// ─────────────────────────────────────────────────────────────────────────────
// Initialization
// ─────────────────────────────────────────────────────────────────────────────

let storageInitialized = false;
async function initStorage() {
  if (storageInitialized) return;
  await storage.init({
    dir: '.cache/gemini',
    stringify: JSON.stringify,
    parse: JSON.parse,
    encoding: 'utf8',
  });
  storageInitialized = true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rate Limiting & Queueing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Advanced Rate Limiter
 * Combines a sliding window (RPM) with a strict interval throttle to prevent bursts.
 */
class GeminiRateLimiter {
  constructor(maxRpm = 12) {
    this.maxRpm = maxRpm;
    this.requests = [];
    this.lastRequestStartTime = 0;
    this.minIntervalMs = 4500; // 4.5s spacing even if RPM allows more
  }

  async waitForSlot() {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    // Clean window
    this.requests = this.requests.filter(ts => ts > oneMinuteAgo);

    // 1. Check strict interval (Deburst)
    const timeSinceLast = now - this.lastRequestStartTime;
    if (timeSinceLast < this.minIntervalMs) {
      const wait = this.minIntervalMs - timeSinceLast;
      await new Promise(r => setTimeout(r, wait));
      return this.waitForSlot();
    }

    // 2. Check RPM window
    if (this.requests.length >= this.maxRpm) {
      const waitTime = 60000 - (now - this.requests[0]);
      logStage('GEMINI', 'queue', null, `RPM limit reached. Waiting ${Math.round(waitTime / 1000)}s...`);
      await new Promise(resolve => setTimeout(resolve, waitTime + 500));
      return this.waitForSlot();
    }

    this.requests.push(Date.now());
    this.lastRequestStartTime = Date.now();
  }
}

const limiter = new GeminiRateLimiter(12);
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function hashKey(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return 'cache_' + Math.abs(hash).toString(16);
}

function parseGeminiJson(raw) {
  try { return JSON.parse(raw); } catch {}
  const stripped = raw.replace(/```(?:json)?\s*([\s\S]*?)```/g, '$1').trim();
  try { return JSON.parse(stripped); } catch {}
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start !== -1 && end !== -1) {
    try { return JSON.parse(stripped.slice(start, end + 1)); } catch {}
  }
  throw new SyntaxError('JSON parse failed.');
}

function buildBase64ImagePart(imageBase64) {
  let mimeType = 'image/jpeg';
  let data = imageBase64;
  const match = imageBase64.match(/^data:([^;]+);base64,(.+)$/s);
  if (match) {
    mimeType = match[1];
    data = match[2];
  }
  return { inlineData: { mimeType, data } };
}

async function buildUrlImagePart(url) {
  const axios = require('axios');
  const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 5000 });
  const mimeType = response.headers['content-type']?.split(';')[0] || 'image/jpeg';
  const data = Buffer.from(response.data).toString('base64');
  return { inlineData: { mimeType, data } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Call Logic
// ─────────────────────────────────────────────────────────────────────────────

async function callGemini({ systemInstruction, parts, maxOutputTokens = 2000, model = DEFAULT_MODEL, useCache = false }) {
  await initStorage();

  // 1. Persistent Cache Check
  let cacheId = null;
  if (useCache) {
    cacheId = hashKey(JSON.stringify({ systemInstruction, parts, model }));
    const cached = await storage.getItem(cacheId);
    if (cached) {
      logStage('GEMINI', 'cache-hit', null, `Serving from disk cache (${cacheId})`);
      return cached;
    }
  }

  // 2. Queueing
  await limiter.waitForSlot();

  // 3. Execution with Retries
  const maxRetries = 3;
  let currentDelay = 5000;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const geminiModel = genAI.getGenerativeModel({
        model,
        systemInstruction,
        generationConfig: {
          maxOutputTokens: attempt > 0 ? 800 : maxOutputTokens,
          responseMimeType: 'application/json',
        },
      });

      const result = await geminiModel.generateContent({ contents: [{ role: 'user', parts }] });
      const text = result.response.text();

      if (!text) throw new Error('Empty response');

      if (useCache && cacheId) {
        await storage.setItem(cacheId, text);
      }

      return text;
    } catch (err) {
      const msg = err?.message?.toLowerCase() || '';
      const isQuota = msg.includes('429') || msg.includes('quota') || msg.includes('rate limit');
      
      if (isQuota && attempt < maxRetries) {
        logStage('GEMINI', 'retry', null, `Rate limit attempt ${attempt + 1}. Backing off...`);
        await sleep(currentDelay);
        currentDelay *= 2;
        continue;
      }
      throw err;
    }
  }
}

module.exports = { callGemini, parseGeminiJson, buildBase64ImagePart, buildUrlImagePart };

