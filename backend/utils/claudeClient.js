/**
 * utils/claudeClient.js
 * Shared Anthropic SDK client singleton.
 * Centralises retry / timeout / JSON-extraction logic shared by
 * the Planner and Executor agents.
 */

const Anthropic = require('@anthropic-ai/sdk');
const { logError } = require('./logger');

// Instantiate once at module load time; the SDK reads ANTHROPIC_API_KEY
// automatically from process.env.
const anthropic = new Anthropic();

// Default Claude model used across all pipeline stages.
const DEFAULT_MODEL = 'claude-opus-4-5';
const DEFAULT_MAX_TOKENS = 2000;

/**
 * Strip markdown code fences from Claude output.
 * Claude sometimes wraps JSON in  ```json … ``` or ``` … ```.
 *
 * @param {string} raw - Raw text from Claude
 * @returns {string} - Text with fences removed
 */
function stripMarkdownFences(raw) {
  // Remove ```json ... ``` or ``` ... ``` (multiline, non-greedy)
  return raw
    .replace(/```(?:json)?\s*([\s\S]*?)```/g, '$1')
    .trim();
}

/**
 * Extract the outermost JSON object from a string.
 * Used as a last-resort fallback when the response contains surrounding prose.
 *
 * @param {string} text
 * @returns {string|null} - The extracted JSON block or null
 */
function extractJsonBlock(text) {
  // Find the first '{' and the last '}' — covers almost all real-world cases
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    return text.slice(start, end + 1);
  }
  return null;
}

/**
 * Parse JSON from Claude output, gracefully handling markdown fences
 * and surrounding prose.
 *
 * @param {string} raw - Raw Claude response text
 * @returns {object} - Parsed JSON object
 * @throws {SyntaxError} if still unparseable after all attempts
 */
function parseClaudeJson(raw) {
  // Attempt 1: direct parse (ideal case)
  try {
    return JSON.parse(raw);
  } catch {}

  // Attempt 2: strip markdown fences
  const stripped = stripMarkdownFences(raw);
  try {
    return JSON.parse(stripped);
  } catch {}

  // Attempt 3: extract outermost { } block
  const block = extractJsonBlock(stripped);
  if (block) {
    try {
      return JSON.parse(block);
    } catch {}
  }

  throw new SyntaxError('Unable to parse JSON from Claude response after all fallbacks.');
}

/**
 * Call Claude (messages API) with automatic retry on timeout.
 * On a CLAUDE_TIMEOUT, retries once with a reduced max_tokens budget.
 *
 * @param {object} params
 * @param {string} params.system - System prompt text
 * @param {Array}  params.messages - Array of { role, content } messages
 * @param {number} [params.maxTokens] - Max tokens for this call
 * @param {string} [params.model] - Claude model override
 *
 * @returns {string} - The assistant's text reply
 */
async function callClaude({ system, messages, maxTokens = DEFAULT_MAX_TOKENS, model = DEFAULT_MODEL }) {
  // Inner helper so we can call it twice (original + CLAUDE_TIMEOUT retry)
  async function attempt(tokenBudget) {
    const response = await anthropic.messages.create({
      model,
      max_tokens: tokenBudget,
      system,
      messages,
    });

    // Extract the text content from the first content block
    const block = response.content?.[0];
    if (!block || block.type !== 'text') {
      throw new Error('Claude returned no text content block.');
    }
    return block.text;
  }

  try {
    return await attempt(maxTokens);
  } catch (err) {
    // Detect Anthropic timeout / overload errors for the retry path
    const isTimeout =
      err?.status === 529 || // overloaded
      err?.status === 503 ||
      err?.message?.toLowerCase().includes('timeout') ||
      err?.message?.toLowerCase().includes('overload');

    if (isTimeout) {
      logError('claudeClient', `Timeout on first attempt — retrying with reduced tokens (600).`);
      // Retry ONCE with a tighter token ceiling
      try {
        return await attempt(600);
      } catch (retryErr) {
        // Translate into our CLAUDE_TIMEOUT error code so the route handler
        // can produce the correct error response shape
        const timeout = new Error('Claude API timed out after retry.');
        timeout.code = 'CLAUDE_TIMEOUT';
        throw timeout;
      }
    }

    // Rate limit detection
    if (err?.status === 429) {
      const rateErr = new Error('Anthropic rate limit reached.');
      rateErr.code = 'RATE_LIMITED';
      throw rateErr;
    }

    // Re-throw all other errors as-is
    throw err;
  }
}

module.exports = { callClaude, parseClaudeJson };
