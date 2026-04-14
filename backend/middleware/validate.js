/**
 * middleware/validate.js
 *
 * Express middleware for validating the /api/personalize request body.
 * Produces structured error responses matching the project's error schema:
 *   { error: string, code: string, retryable: boolean }
 */

/**
 * Validate that:
 *  1. landingPageUrl is present and is a valid URL string.
 *  2. At least one of adImageBase64, adUrl, adDescription is provided.
 */
function validatePersonalizeRequest(req, res, next) {
  const { adImageBase64, adUrl, adDescription, landingPageUrl } = req.body || {};

  // ── Check: at least one ad creative input ─────────────────────────────────
  const hasAdInput =
    (typeof adImageBase64 === 'string' && adImageBase64.trim().length > 0) ||
    (typeof adUrl === 'string' && adUrl.trim().length > 0) ||
    (typeof adDescription === 'string' && adDescription.trim().length > 0);

  if (!hasAdInput) {
    return res.status(400).json({
      error:
        'At least one ad creative input is required: adImageBase64, adUrl, or adDescription.',
      code: 'MISSING_AD_INPUT',
      retryable: false,
    });
  }

  // ── Check: landingPageUrl present and parseable ────────────────────────────
  if (!landingPageUrl || typeof landingPageUrl !== 'string' || landingPageUrl.trim().length === 0) {
    return res.status(400).json({
      error: 'landingPageUrl is required.',
      code: 'INVALID_URL',
      retryable: false,
    });
  }

  // Attempt URL parsing (Node 18+ has URL built-in without import)
  try {
    const parsed = new URL(landingPageUrl.trim());
    // Only allow http and https schemes
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Only http and https URLs are supported.');
    }
  } catch {
    return res.status(400).json({
      error: `"${landingPageUrl}" is not a valid URL. Provide a full URL including protocol (https://).`,
      code: 'INVALID_URL',
      retryable: false,
    });
  }

  next();
}

module.exports = { validatePersonalizeRequest };
