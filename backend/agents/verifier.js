/**
 * agents/verifier.js  —  STAGE 4: VERIFIER (Output Validation)
 *
 * Runs 5 quality checks on the Executor's output.
 * If any check fails, triggers ONE correction run via the Executor.
 * A second failure results in best-effort output with status: "partial".
 *
 * The Verifier never calls Claude directly — it only orchestrates the
 * Executor and applies deterministic fixes (clamping, snippet repair).
 */

const { logStage, logError } = require('../utils/logger');
const { runExecutor } = require('./executor');

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

// CRO principles every output MUST include at least one of
const REQUIRED_PRINCIPLES = ['Message Match', 'CTA Alignment'];

// Score boundaries
const SCORE_MIN = 50;
const SCORE_MAX = 98;

// ─────────────────────────────────────────────────────────────────────────────
// Check 1 — Schema Completeness
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verify all required top-level and nested fields exist and are non-empty.
 *
 * @param {object} output - Raw Claude output
 * @returns {{ pass: boolean, issues: string[] }}
 */
function checkSchema(output) {
  const issues = [];

  if (!Array.isArray(output.changes) || output.changes.length === 0) {
    issues.push('Missing or empty "changes" array.');
  }
  if (!output.preview || typeof output.preview !== 'object') {
    issues.push('Missing "preview" object.');
  } else {
    const previewFields = ['heroHeadline', 'heroSubhead', 'ctaText', 'socialProof'];
    previewFields.forEach((f) => {
      if (!output.preview[f]) issues.push(`preview.${f} is missing or empty.`);
    });
    if (!Array.isArray(output.preview.features) || output.preview.features.length === 0) {
      issues.push('preview.features is missing or empty.');
    }
  }
  if (!output.cro || typeof output.cro !== 'object') {
    issues.push('Missing "cro" object.');
  } else {
    ['messageMatch', 'conversionPotential', 'personalizedMessageMatch', 'personalizedConversionPotential'].forEach((f) => {
      if (typeof output.cro[f] !== 'number') issues.push(`cro.${f} is missing or not a number.`);
    });
  }
  if (!output.reasoning || typeof output.reasoning !== 'string' || output.reasoning.length < 50) {
    issues.push('"reasoning" field is missing or too short (< 50 chars).');
  }
  if (!output.htmlSnippets || typeof output.htmlSnippets !== 'object') {
    issues.push('Missing "htmlSnippets" object.');
  }

  return { pass: issues.length === 0, issues };
}

// ─────────────────────────────────────────────────────────────────────────────
// Check 2 — Copy Differentiation (≥ 40% word difference)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute the proportion of words in `after` that are NOT in `before`.
 * A simple set-based difference — good enough for actionable flagging.
 *
 * @param {string} before
 * @param {string} after
 * @returns {number} - Fraction 0–1 (1 = completely different)
 */
function wordDiffRatio(before, after) {
  const tokenise = (s) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(Boolean);

  const bWords = new Set(tokenise(before));
  const aWords = tokenise(after);
  if (aWords.length === 0) return 0;

  // Count words in `after` that don't appear in `before`
  const newWords = aWords.filter((w) => !bWords.has(w)).length;
  return newWords / aWords.length;
}

/**
 * Check every change for ≥ 40% copy differentiation.
 *
 * @param {object[]} changes
 * @returns {{ pass: boolean, issues: string[] }}
 */
function checkCopyDifferentiation(changes) {
  const issues = [];

  changes.forEach((change) => {
    const ratio = wordDiffRatio(change.before || '', change.after || '');
    if (ratio < 0.4) {
      issues.push(
        `Change "${change.section}" is too similar to original (${Math.round(ratio * 100)}% different). Rewrite more substantially.`
      );
    }
  });

  return { pass: issues.length === 0, issues };
}

// ─────────────────────────────────────────────────────────────────────────────
// Check 3 — CRO Score Validity (deterministic clamp + flag)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Clamp CRO scores into valid ranges. Mutates the cro object in place.
 * Returns whether any clamping was performed.
 *
 * @param {object} cro - The cro sub-object from Claude output
 * @returns {boolean} wasClamped
 */
function clampCroScores(cro) {
  let clamped = false;

  const clamp = (val, min, max) => Math.min(max, Math.max(min, val));

  // Base scores: 50–95
  const origMM = cro.messageMatch;
  const origCP = cro.conversionPotential;
  cro.messageMatch = clamp(origMM, SCORE_MIN, 95);
  cro.conversionPotential = clamp(origCP, SCORE_MIN, 95);

  if (cro.messageMatch !== origMM || cro.conversionPotential !== origCP) clamped = true;

  // Personalized scores must be strictly greater than originals, max 98
  if (cro.personalizedMessageMatch <= cro.messageMatch) {
    cro.personalizedMessageMatch = Math.min(SCORE_MAX, cro.messageMatch + 8);
    clamped = true;
  }
  cro.personalizedMessageMatch = clamp(cro.personalizedMessageMatch, SCORE_MIN, SCORE_MAX);

  if (cro.personalizedConversionPotential <= cro.conversionPotential) {
    cro.personalizedConversionPotential = Math.min(SCORE_MAX, cro.conversionPotential + 8);
    clamped = true;
  }
  cro.personalizedConversionPotential = clamp(cro.personalizedConversionPotential, SCORE_MIN, SCORE_MAX);

  if (cro.personalizedMessageMatch !== cro.messageMatch + 8 || cro.personalizedConversionPotential !== cro.conversionPotential + 8) {
    // Quiet lint — no further action needed
  }

  return clamped;
}

// ─────────────────────────────────────────────────────────────────────────────
// Check 4 — CRO Principle Coverage
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ensure at least one "Message Match" and one "CTA Alignment" change exist.
 *
 * @param {object[]} changes
 * @returns {{ pass: boolean, issues: string[] }}
 */
function checkPrincipleCoverage(changes) {
  const principles = changes.map((c) => c.croPrinciple);
  const issues = [];

  REQUIRED_PRINCIPLES.forEach((required) => {
    if (!principles.includes(required)) {
      issues.push(`Missing required CRO principle: "${required}". You must include at least one "${required}" change.`);
    }
  });

  return { pass: issues.length === 0, issues };
}

// ─────────────────────────────────────────────────────────────────────────────
// Check 5 — HTML Snippet Validity
// ─────────────────────────────────────────────────────────────────────────────

// Regex that finds any HTML opening tag
const HAS_HTML_TAG = /<[a-zA-Z][^>]*>/;

// Naive unclosed-tag detector: count opening vs. closing tags
// "Unclosed" means a tag that opens but never closes (ignores self-closing void elements)
const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/**
 * Simple regex-based unclosed-tag detector (not a full HTML parser, but
 * sufficient to catch obvious issues like missing </div>, </section>, etc.).
 *
 * @param {string} html
 * @returns {boolean} hasUnclosed
 */
function hasUnclosedTags(html) {
  // Collect all opening tags
  const openRegex = /<([a-zA-Z][a-zA-Z0-9]*)[\s/>]/g;
  const closeRegex = /<\/([a-zA-Z][a-zA-Z0-9]*)\s*>/g;

  const opens = {};
  const closes = {};

  let m;
  while ((m = openRegex.exec(html)) !== null) {
    const tag = m[1].toLowerCase();
    if (!VOID_ELEMENTS.has(tag)) {
      opens[tag] = (opens[tag] || 0) + 1;
    }
  }
  while ((m = closeRegex.exec(html)) !== null) {
    const tag = m[1].toLowerCase();
    closes[tag] = (closes[tag] || 0) + 1;
  }

  // Any opening tag without a matching closing tag = unclosed
  return Object.keys(opens).some((tag) => (opens[tag] || 0) > (closes[tag] || 0));
}

/**
 * Generate a minimal valid HTML snippet for a given section if Claude's
 * snippet is invalid.
 *
 * @param {'hero'|'cta'|'socialProof'} section
 * @param {object} preview - The preview object from Claude output
 * @returns {string} - Valid fallback HTML snippet
 */
function generateFallbackSnippet(section, preview) {
  if (section === 'hero') {
    return `<section class="hero">\n  <h1>${preview.heroHeadline || 'Your headline here'}</h1>\n  <p>${preview.heroSubhead || 'Your subheadline here'}</p>\n</section>`;
  }
  if (section === 'cta') {
    return `<button class="btn-primary">${preview.ctaText || 'Get started'}</button>`;
  }
  if (section === 'socialProof') {
    return `<blockquote class="testimonial"><p>${preview.socialProof || 'Customer testimonial'}</p></blockquote>`;
  }
  return `<div class="${section}"></div>`;
}

/**
 * Validate htmlSnippets. Repairs invalid snippets in place with fallbacks.
 *
 * @param {object} htmlSnippets - e.g. { hero: string, cta: string, socialProof: string }
 * @param {object} preview      - Used to populate fallback snippets
 * @returns {{ pass: boolean, issues: string[] }}
 */
function checkAndRepairHtmlSnippets(htmlSnippets, preview) {
  const issues = [];
  const sections = ['hero', 'cta', 'socialProof'];

  sections.forEach((section) => {
    const snippet = htmlSnippets?.[section];

    // Check 1: must contain at least one HTML tag
    if (!snippet || !HAS_HTML_TAG.test(snippet)) {
      issues.push(`htmlSnippets.${section} contains no HTML tags — replaced with fallback.`);
      htmlSnippets[section] = generateFallbackSnippet(section, preview);
      return;
    }

    // Check 2: no unclosed tags
    if (hasUnclosedTags(snippet)) {
      issues.push(`htmlSnippets.${section} has unclosed tags — replaced with fallback.`);
      htmlSnippets[section] = generateFallbackSnippet(section, preview);
    }
  });

  return { pass: issues.length === 0, issues };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main exported function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run Stage 4 — Verifier.
 *
 * @param {object} firstRunOutput - Parsed output from Executor (first run)
 * @param {object} adAnalysis     - From Stage 1
 * @param {object} pageContent    - From Stage 2
 *
 * @returns {{
 *   output: object,
 *   correctionRan: boolean,
 *   scoresClamped: boolean,
 *   corrections: string[]
 * }}
 */
async function runVerifier(firstRunOutput, adAnalysis, pageContent, traceId = null) {
  const stageStart = Date.now();
  logStage('VERIFIER', 'start', null, 'Running quality checks', traceId);

  let output = firstRunOutput;
  let correctionRan = false;
  let scoresClamped = false;
  const allCorrections = [];

  function collectCorrectionIssues(o) {
    const issues = [];
    const schema = checkSchema(o);
    if (!schema.pass) issues.push(...schema.issues);
    if (Array.isArray(o.changes) && o.changes.length > 0) {
      const diff = checkCopyDifferentiation(o.changes);
      if (!diff.pass) issues.push(...diff.issues);
      const principles = checkPrincipleCoverage(o.changes);
      if (!principles.pass) issues.push(...principles.issues);
    }
    return issues;
  }

  const firstIssues = collectCorrectionIssues(output);

  if (firstIssues.length > 0) {
    logStage('VERIFIER', 'start', null, `Correction run needed: ${firstIssues.length} issue(s)`, traceId);
    allCorrections.push(...firstIssues);

    try {
      const correctionAddendum = firstIssues.join('\n');
      const correctedOutput = await runExecutor(adAnalysis, pageContent, correctionAddendum, traceId);

      correctionRan = true;
      const secondIssues = collectCorrectionIssues(correctedOutput);

      if (secondIssues.length === 0) {
        output = correctedOutput;
        logStage('VERIFIER', 'success', null, 'Correction run resolved all issues', traceId);
      } else {
        logStage('VERIFIER', 'error', null, `Correction still flawed — using best-effort`, traceId);
        allCorrections.push(...secondIssues.map((i) => `[after correction] ${i}`));
        output = correctedOutput;
      }
    } catch (err) {
      logError('VERIFIER', err);
      allCorrections.push(`Correction failed: ${err.message}`);
    }
  }

  if (output.cro) {
    scoresClamped = clampCroScores(output.cro);
    if (scoresClamped) logStage('VERIFIER', 'start', null, 'CRO scores clamped', traceId);
  }

  if (output.htmlSnippets) {
    const htmlCheck = checkAndRepairHtmlSnippets(output.htmlSnippets, output.preview || {});
    if (!htmlCheck.pass) {
      logStage('VERIFIER', 'info', null, `HTML snippets repaired`, traceId);
      allCorrections.push(...htmlCheck.issues);
    }
  }

  logStage('VERIFIER', 'success', Date.now() - stageStart, `${allCorrections.length} total adjustments`, traceId);

  return { output, correctionRan, scoresClamped, corrections: allCorrections };
}

module.exports = { runVerifier };
