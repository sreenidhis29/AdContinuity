/**
 * utils/logger.js
 * Structured pipeline stage logger with request tracing.
 * 
 * ADVANCED UPGRADE: 
 * Tracks logs for each specific request traceId to return to the UI.
 */

const COLORS = {
  reset: '\x1b[0m', cyan: '\x1b[36m', green: '\x1b[32m',
  red: '\x1b[31m', yellow: '\x1b[33m', gray: '\x1b[90m',
};

// In-memory store for request traces (useful for the demo/UI console)
const traceStore = new Map();

/**
 * Log a pipeline stage event.
 * @param {string} stage - Stage name
 * @param {string} status - Lifecycle status
 * @param {number} durationMs - Elapsed time
 * @param {string} detail - Contextual detail
 * @param {string} traceId - Unique request ID
 */
function logStage(stage, status, durationMs = null, detail = '', traceId = null) {
  const ts = new Date().toISOString();
  const durationStr = durationMs !== null ? `${durationMs}ms` : '--';

  let statusColor = COLORS.yellow;
  if (status === 'success') statusColor = COLORS.green;
  else if (status === 'error') statusColor = COLORS.red;

  const line = [
    `${COLORS.cyan}[${stage}]${COLORS.reset}`,
    `${COLORS.gray}${ts}${COLORS.reset}`,
    `${statusColor}${status}${COLORS.reset}`,
    `${COLORS.gray}${durationStr}${COLORS.reset}`,
    detail ? `${COLORS.gray}${detail}${COLORS.reset}` : '',
  ].filter(Boolean).join(' ');

  console.log(line);

  // Store for UI retrieval if traceId is provided
  if (traceId) {
    if (!traceStore.has(traceId)) traceStore.set(traceId, []);
    traceStore.get(traceId).push({ stage, status, durationMs, detail, timestamp: ts });
  }
}

function getTraceLogs(traceId) {
  return traceStore.get(traceId) || [];
}

function clearTrace(traceId) {
  traceStore.delete(traceId);
}

function logInfo(msg) {
  console.log(`${COLORS.gray}[INFO] ${new Date().toISOString()} ${msg}${COLORS.reset}`);
}

function logError(context, err) {
  console.error(`${COLORS.red}[ERROR] ${new Date().toISOString()} [${context}] ${err?.message || err}${COLORS.reset}`);
}

module.exports = { logStage, logInfo, logError, getTraceLogs, clearTrace };
