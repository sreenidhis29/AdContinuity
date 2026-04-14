/**
 * utils/llmRouter.js — The Universal LLM Router
 *
 * ARCHITECTURE:
 * ┌─────────────────────────────────────────────────────────┐
 * │                     LLM ROUTER                         │
 * │                                                         │
 * │  1. CHECK CACHE → Return instantly if hit               │
 * │  2. SELECT PROVIDER → Based on task type & availability │
 * │  3. CALL PROVIDER → With per-provider rate tracking     │
 * │  4. ON 429 → Mark provider as cooling down, try next   │
 * │  5. CACHE SUCCESS → Never call same prompt again        │
 * └─────────────────────────────────────────────────────────┘
 *
 * PROVIDER PRIORITY:
 *  Vision tasks:   gemini → openrouter (vision-capable models)
 *  Text tasks:     groq → openrouter → gemini
 *
 * This ensures Gemini quota is ONLY consumed for vision/image tasks.
 * Text tasks go to Groq first, preserving Gemini's 1500 req/day.
 */

const cache = require('./cache');
const { logStage } = require('./logger');

// Import providers
const geminiProvider = require('./providers/gemini');
const groqProvider = require('./providers/groq');
const openrouterProvider = require('./providers/openrouter');

// ─────────────────────────────────────────────────────────
// Provider Cooldown Tracker (rate limits)
// ─────────────────────────────────────────────────────────

const cooldowns = new Map();   // providerId → recoveryTimestamp
const badKeyProviders = new Set(); // providers with invalid API keys (401)

// Detect placeholder keys — treat as unconfigured
function isRealKey(val) {
  if (!val) return false;
  if (val.startsWith('PASTE_') || val.includes('_HERE')) return false;
  if (val.length < 10) return false;
  return true;
}

function isCooling(provider) {
  const until = cooldowns.get(provider.id);
  if (!until) return false;
  if (Date.now() >= until) {
    cooldowns.delete(provider.id);
    return false;
  }
  return true;
}

function hasBadKey(provider) {
  return badKeyProviders.has(provider.id);
}

function markBadKey(provider) {
  badKeyProviders.add(provider.id);
  logStage('ROUTER', 'auth-error', null, `${provider.name} has an invalid API key — skipping. Fix ${provider.envKey} in .env`);
}

function setCooldown(provider, ms) {
  cooldowns.set(provider.id, Date.now() + ms);
  const seconds = Math.round(ms / 1000);
  logStage('ROUTER', 'cooldown', null, `${provider.name} cooling down for ${seconds}s`);
}

function getCooldownRemaining(provider) {
  const until = cooldowns.get(provider.id);
  if (!until) return 0;
  return Math.max(0, until - Date.now());
}

// ─────────────────────────────────────────────────────────
// Per-provider RPM throttle (simple interval guard)
// ─────────────────────────────────────────────────────────

const rpmTrackers = new Map();

const RPM_LIMITS = {
  gemini: { rpm: 13, minInterval: 4600 },    // 15 RPM limit → use 13 safely
  groq: { rpm: 28, minInterval: 2200 },       // 30 RPM limit → use 28 safely
  openrouter: { rpm: 18, minInterval: 3400 }, // 20 RPM limit → use 18 safely
};

async function waitForRpm(provider) {
  const limits = RPM_LIMITS[provider.id];
  if (!limits) return;

  if (!rpmTrackers.has(provider.id)) {
    rpmTrackers.set(provider.id, { requests: [], lastReq: 0 });
  }

  const tracker = rpmTrackers.get(provider.id);
  const now = Date.now();

  // Clean old timestamps
  tracker.requests = tracker.requests.filter(t => t > now - 60000);

  // Enforce minimum interval between requests (prevent burst)
  const timeSinceLast = now - tracker.lastReq;
  if (timeSinceLast < limits.minInterval) {
    const wait = limits.minInterval - timeSinceLast;
    await new Promise(r => setTimeout(r, wait));
  }

  // Enforce sliding window RPM
  if (tracker.requests.length >= limits.rpm) {
    const waitUntil = tracker.requests[0] + 60000;
    const waitMs = waitUntil - Date.now() + 500;
    if (waitMs > 0) {
      logStage('ROUTER', 'throttle', null, `${provider.name} RPM window full. Waiting ${Math.round(waitMs / 1000)}s`);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }

  tracker.requests.push(Date.now());
  tracker.lastReq = Date.now();
}

// ─────────────────────────────────────────────────────────
// JSON parser (robust)
// ─────────────────────────────────────────────────────────

function parseJson(raw) {
  if (!raw) throw new SyntaxError('Empty response');
  try { return JSON.parse(raw); } catch {}
  const stripped = raw.replace(/```(?:json)?\s*([\s\S]*?)```/g, '$1').trim();
  try { return JSON.parse(stripped); } catch {}
  const s = stripped.indexOf('{');
  const e = stripped.lastIndexOf('}');
  if (s !== -1 && e > s) {
    try { return JSON.parse(stripped.slice(s, e + 1)); } catch {}
  }
  throw new SyntaxError(`Cannot parse JSON from: ${raw.slice(0, 200)}`);
}

// ─────────────────────────────────────────────────────────
// Image helpers
// ─────────────────────────────────────────────────────────

function buildBase64ImagePart(imageBase64) {
  let mimeType = 'image/jpeg';
  let data = imageBase64;
  const match = imageBase64.match(/^data:([^;]+);base64,(.+)$/s);
  if (match) { mimeType = match[1]; data = match[2]; }
  return { inlineData: { mimeType, data } };
}

async function buildUrlImagePart(url) {
  const axios = require('axios');
  const response = await axios.get(url, { 
    responseType: 'arraybuffer', 
    timeout: 12000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });
  const mimeType = response.headers['content-type']?.split(';')[0] || 'image/jpeg';
  const data = Buffer.from(response.data).toString('base64');
  return { inlineData: { mimeType, data } };
}

// ─────────────────────────────────────────────────────────
// Core Router
// ─────────────────────────────────────────────────────────

/**
 * Route an LLM call to the best available provider.
 *
 * @param {object} opts
 * @param {string}  opts.task          - Label for logging ('planner', 'executor', etc.)
 * @param {string}  opts.systemPrompt  - System/instruction prompt
 * @param {Array}   opts.parts         - Gemini-style parts [{text}] or [{inlineData}]
 * @param {number}  [opts.maxTokens]   - Max output tokens
 * @param {boolean} [opts.needsVision] - If true, must use a vision-capable provider
 * @param {boolean} [opts.cacheResult] - Cache the result permanently (default: true)
 * @param {string}  [opts.traceId]     - Request trace ID for logging
 * @returns {Promise<{text: string, provider: string}>}
 */
async function route({ task, systemPrompt, parts, maxTokens = 2000, needsVision = false, cacheResult = true, traceId = null }) {

  // ── 1. Cache Check ──────────────────────────────────────────────────────────
  // For vision tasks, we must hash the image data to include in cache key
  const processedParts = parts.map(p => {
    if (p.inlineData) {
      // Create a hash of the image data instead of storing the whole thing in the key
      const hash = require('crypto').createHash('sha256').update(p.inlineData.data).digest('hex');
      return { visionHash: hash };
    }
    return p;
  });

  const cacheKey = { task, systemPrompt, parts: processedParts, maxTokens };
  
  if (cacheResult) {
    const cached = await cache.get(cacheKey);
    if (cached) {
      logStage('ROUTER', 'cache-hit', null, `[${task}] Using disk cache (unique creative hash)`, traceId);
      return { text: cached, provider: 'cache' };
    }
  }

  // ── 2. Build Provider Priority List ─────────────────────────────────────────
  // Vision tasks: Gemini first (only one with image support), then openrouter (some support vision)
  // Text tasks: Groq first (fastest, most generous), then OpenRouter, then Gemini as last resort
  let providers;
  if (needsVision) {
    providers = [geminiProvider, openrouterProvider];
  } else {
    providers = [groqProvider, openrouterProvider, geminiProvider];
  }

  // Filter: must have a real key, not be cooling, and not have a bad/invalid key
  const available = providers.filter(p =>
    p.isAvailable() &&
    isRealKey(process.env[p.envKey]) &&
    !isCooling(p) &&
    !hasBadKey(p)
  );

  if (available.length === 0) {
    // Check if any are only cooling (not bad keys), and wait for the fastest recovery
    const recoverableProviders = providers.filter(p =>
      p.isAvailable() && isRealKey(process.env[p.envKey]) && !hasBadKey(p)
    );

    if (recoverableProviders.length === 0) {
      const configuredCount = providers.filter(p => p.isAvailable() && isRealKey(process.env[p.envKey])).length;
      if (configuredCount === 0) {
        throw new Error('No LLM providers are configured. Add GEMINI_API_KEY, GROQ_API_KEY, or OPENROUTER_API_KEY to your .env file.');
      }
      throw new Error('All configured providers have invalid API keys (401). Please check your .env keys.');
    }

    const soonest = recoverableProviders.reduce((a, b) =>
      getCooldownRemaining(a) < getCooldownRemaining(b) ? a : b
    );
    const waitMs = getCooldownRemaining(soonest);
    logStage('ROUTER', 'wait', null, `All providers cooling. Waiting ${Math.round(waitMs / 1000)}s for ${soonest.name}`, traceId);
    await new Promise(r => setTimeout(r, waitMs));
    return route({ task, systemPrompt, parts, maxTokens, needsVision, cacheResult, traceId });
  }

  // ── 3. Try Each Provider in Priority Order ───────────────────────────────────
  let lastErr;
  for (const provider of available) {
    try {
      logStage('ROUTER', 'call', null, `[${task}] → ${provider.name}`, traceId);

      // Per-provider RPM throttle
      await waitForRpm(provider);

      // Make the call
      const text = await provider.call({ systemPrompt, parts, maxTokens });

      // ── 4. Cache Success ──────────────────────────────────────────────────
      if (cacheResult) {
        await cache.set(cacheKey, text);
      }

      logStage('ROUTER', 'success', null, `[${task}] ✓ ${provider.name}`, traceId);
      return { text, provider: provider.id };

    } catch (err) {
      lastErr = err;
      const httpStatus = err?.response?.status || err?.status;
      const isAuthError = httpStatus === 401 || httpStatus === 403;

      // ── Auth error (invalid key) → mark & skip to next provider ──
      if (isAuthError) {
        markBadKey(provider);
        logStage('ROUTER', 'fallback', null, `[${task}] ${provider.name} auth failed (${httpStatus}) → trying next provider`, traceId);
        continue;
      }

      // ── Rate limit → cool down & skip to next provider ──────────
      if (provider.isQuotaError(err)) {
        const retryMs = provider.parseRetryAfter(err.message, err?.response?.headers);
        setCooldown(provider, retryMs);
        logStage('ROUTER', 'fallback', null, `[${task}] ${provider.name} quota hit → trying next provider`, traceId);
        continue;
      }

      // ── 4xx HTTP errors → provider/model unavailable, skip to next ──
      // (covers 404 model-not-found, 422 unsupported-param, 400 bad-request, etc.)
      const isProviderError = httpStatus >= 400 && httpStatus < 500;
      if (isProviderError) {
        logStage('ROUTER', 'fallback', null, `[${task}] ${provider.name} HTTP ${httpStatus} → trying next provider`, traceId);
        continue;
      }

      // ── Network errors → skip to next provider ──
      const isNetworkError = err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET';
      if (isNetworkError) {
        logStage('ROUTER', 'fallback', null, `[${task}] ${provider.name} network error → trying next provider`, traceId);
        continue;
      }

      // ── Timeout → skip to next provider ──
      if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
        logStage('ROUTER', 'fallback', null, `[${task}] ${provider.name} timed out → trying next provider`, traceId);
        continue;
      }

      // Genuine fatal error (e.g. JSON parse failure in our own code) — re-throw
      throw err;
    }
  }

  // All providers tried and failed — throw last error with a clear message
  const errMsg = lastErr?.response?.status
    ? `All providers failed (last error: HTTP ${lastErr.response.status}). Check your API keys and try again.`
    : lastErr?.message || `All LLM providers exhausted for task: ${task}`;
  const finalErr = new Error(errMsg);
  finalErr.code = 'PROVIDERS_EXHAUSTED';
  throw finalErr;
}

// ─────────────────────────────────────────────────────────
// Status helper (for health endpoint)
// ─────────────────────────────────────────────────────────

function getProviderStatus() {
  const allProviders = [geminiProvider, groqProvider, openrouterProvider];
  return allProviders.map(p => {
    const hasKey = p.isAvailable() && isRealKey(process.env[p.envKey]);
    const authFailed = hasBadKey(p);
    const cooling = isCooling(p);
    let status = 'not_configured';
    if (hasKey && !authFailed && !cooling) status = 'active';
    else if (hasKey && !authFailed && cooling) status = 'cooling';
    else if (authFailed) status = 'invalid_key';
    return {
      id: p.id,
      name: p.name,
      configured: hasKey,
      status,
      cooling,
      authFailed,
      cooldownRemainingMs: getCooldownRemaining(p),
    };
  });
}

module.exports = {
  route,
  parseJson,
  buildBase64ImagePart,
  buildUrlImagePart,
  getProviderStatus,
};
