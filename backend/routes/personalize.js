/**
 * routes/personalize.js
 *
 * POST /api/personalize — the primary API endpoint.
 *
 * Orchestrates the full 4-stage agent pipeline:
 *   Stage 1: Planner    (Ad Analysis)
 *   Stage 2: Tool Use   (Page Fetch)
 *   Stage 3: Executor   (Personalization)
 *   Stage 4: Verifier   (Output Validation)
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');

const { runPlanner } = require('../agents/planner');
const { runPageFetcher } = require('../agents/pageFetcher');
const { runExecutor } = require('../agents/executor');
const { runVerifier } = require('../agents/verifier');
const { validatePersonalizeRequest } = require('../middleware/validate');
const { logStage, logError, getTraceLogs, clearTrace } = require('../utils/logger');

const ERROR_MAP = {
  MISSING_AD_INPUT: { status: 400, retryable: false },
  INVALID_URL: { status: 400, retryable: false },
  PROVIDERS_EXHAUSTED: { status: 503, retryable: true },
  PARSE_FAILURE: { status: 500, retryable: true },
  RATE_LIMITED: { status: 429, retryable: true },
};

router.post('/', validatePersonalizeRequest, async (req, res) => {
  const pipelineStart = Date.now();
  const traceId = crypto.randomUUID();
  const { adImageBase64, adUrl, adDescription, landingPageUrl } = req.body;

  logStage('PIPELINE', 'start', null, `url=${landingPageUrl}`, traceId);

  try {
    const adAnalysis = await runPlanner({ adImageBase64, adUrl, adDescription }, traceId);
    const { pageContent, fetchSuccess } = await runPageFetcher(landingPageUrl, traceId);
    const firstRunOutput = await runExecutor(adAnalysis, pageContent, null, traceId);
    const { output, correctionRan, scoresClamped, corrections } = await runVerifier(firstRunOutput, adAnalysis, pageContent, traceId);

    const hasUnresolvedIssues = correctionRan && corrections.some((c) => c.startsWith('[after correction]'));
    const status = !fetchSuccess || hasUnresolvedIssues ? 'partial' : 'success';

    const reshapedChanges = (output.changes || []).map((c) => ({
      sectionId: c.sectionId || slugifySection(c.section),
      sectionName: c.section || c.sectionId || 'Unknown Section',
      original: c.before || '',
      new: c.after || '',
      reason: c.reason || '',
      croPrinciple: c.croPrinciple || 'Message Match',
    }));

    const logs = getTraceLogs(traceId);
    clearTrace(traceId);

    return res.status(200).json({
      status,
      adAnalysis,
      cro: output.cro || {},
      changes: reshapedChanges,
      preview: output.preview || {},
      reasoning: output.reasoning || '',
      htmlSnippets: output.htmlSnippets || {},
      logs,
      metadata: {
        fetchSuccess,
        correctionRan,
        scoresClamped,
        executionMs: Date.now() - pipelineStart,
        traceId
      },
    });
  } catch (err) {
    const executionMs = Date.now() - pipelineStart;
    logStage('PIPELINE', 'error', executionMs, err.message, traceId);
    logError('PIPELINE', err);

    const logs = getTraceLogs(traceId);
    clearTrace(traceId);

    const code = err.code || 'PARSE_FAILURE';
    const mapped = ERROR_MAP[code] || { status: 500, retryable: true };

    return res.status(mapped.status).json({
      error: err.message || 'Error occurred',
      code,
      retryable: mapped.retryable,
      logs
    });
  }
});

/**
 * Convert a free-form section label to a valid sectionId slug
 * that the frontend's preview mockup can map to a DOM element.
 * e.g. "Hero Headline & Subheadline" → "hero"
 */
function slugifySection(section = '') {
  const lower = (section || '').toLowerCase();
  if (lower.includes('hero') || lower.includes('headline')) return 'hero';
  if (lower.includes('cta') || lower.includes('button') || lower.includes('call')) return 'cta';
  if (lower.includes('social') || lower.includes('proof') || lower.includes('testimonial')) return 'social';
  if (lower.includes('feature') || lower.includes('benefit')) {
    const numMatch = lower.match(/(\d+)/);
    const num = numMatch ? parseInt(numMatch[1], 10) : 1;
    return `feature${Math.min(num, 4)}`;
  }
  return lower.replace(/[^a-z0-9]/g, '_').replace(/__+/g, '_').slice(0, 30);
}

module.exports = router;
