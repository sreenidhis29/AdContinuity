/**
 * server.js — Entry point for the Landing Page Personalizer API.
 *
 * Sets up Express, mounts routes, and starts the HTTP server.
 * All pipeline logic lives in /agents — this file stays thin.
 */

// ── Load environment variables first — before any other imports ─────────────
require('dotenv').config();
require('express-async-errors'); // Patches Express to propagate async errors

const express = require('express');
const cors = require('cors');
const { logInfo, logError } = require('./utils/logger');

// ─────────────────────────────────────────────────────────────────────────────
// Validate required environment
// ─────────────────────────────────────────────────────────────────────────────
if (!process.env.GEMINI_API_KEY) {
  console.error('[FATAL] GEMINI_API_KEY is not set. Get a free key at https://aistudio.google.com/app/apikey');
  process.exit(1);
}

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

// ─────────────────────────────────────────────────────────────────────────────
// Global Middleware
// ─────────────────────────────────────────────────────────────────────────────

// CORS — allow all origins for development.
// In production, restrict to your frontend domain:
//   app.use(cors({ origin: 'https://yourdomain.com' }));
app.use(cors());

// Parse JSON bodies. Increase limit to accommodate base64 images (~10 MB).
app.use(express.json({ limit: '15mb' }));

// Simple request logger
app.use((req, _res, next) => {
  logInfo(`${req.method} ${req.path}`);
  next();
});

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

// Health check — shows provider status for debugging
app.get('/health', (_req, res) => {
  const { getProviderStatus } = require('./utils/llmRouter');
  const providers = getProviderStatus();
  const anyAvailable = providers.some(p => p.configured && !p.cooling);
  res.json({
    status: anyAvailable ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    providers,
  });
});

// Primary API route
app.use('/api/personalize', require('./routes/personalize'));

// 404 handler — catches any unmatched routes
app.use((_req, res) => {
  res.status(404).json({
    error: 'Route not found.',
    code: 'NOT_FOUND',
    retryable: false,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Global Error Handler
// ─────────────────────────────────────────────────────────────────────────────
// express-async-errors ensures rejected promises bubble up here.
// This is the last-resort safety net for any uncaught thrown errors.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  logError('GLOBAL', err);

  const code = err.code || 'PARSE_FAILURE';
  const statusMap = {
    MISSING_AD_INPUT: 400,
    INVALID_URL: 400,
    CLAUDE_TIMEOUT: 503,
    PARSE_FAILURE: 500,
    RATE_LIMITED: 429,
  };

  res.status(statusMap[code] || 500).json({
    error: err.message || 'An unexpected server error occurred.',
    code,
    retryable: code !== 'MISSING_AD_INPUT' && code !== 'INVALID_URL',
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Start Server
// ─────────────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  logInfo(`AdContinuity API running on http://localhost:${PORT}`);
  logInfo(`POST http://localhost:${PORT}/api/personalize`);
  logInfo(`GET  http://localhost:${PORT}/health`);
});
