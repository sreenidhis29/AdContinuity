/**
 * utils/providers/groq.js — Groq Provider Adapter
 *
 * OpenAI-compatible API. Very fast inference (GroqChip HPU).
 * Best for: Text-only tasks (executor / personalization agent)
 * Free tier: 30 RPM, ~14,400 req/day (for llama-3.1-8b-instant)
 *            30 RPM, ~1,000 req/day  (for llama-3.3-70b-versatile)
 * Key: GROQ_API_KEY  →  https://console.groq.com/keys
 */

const axios = require('axios');

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Use 8b model for high-volume, 70b for quality-sensitive tasks
const DEFAULT_MODEL = 'llama-3.3-70b-versatile';
const FAST_MODEL = 'llama-3.1-8b-instant';

module.exports = {
  id: 'groq',
  name: 'Groq (Llama 3.3 70B)',
  supportsVision: false,
  envKey: 'GROQ_API_KEY',

  isAvailable() {
    return !!process.env.GROQ_API_KEY;
  },

  async call({ systemPrompt, parts, maxTokens = 2000, fast = false }) {
    // Convert Gemini-style parts to OpenAI-style string
    const userContent = parts
      .filter(p => p.text)
      .map(p => p.text)
      .join('\n');

    const model = fast ? FAST_MODEL : DEFAULT_MODEL;

    const response = await axios.post(
      GROQ_API_URL,
      {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        max_tokens: maxTokens,
        temperature: 0.3,
        response_format: { type: 'json_object' },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    const text = response.data?.choices?.[0]?.message?.content;
    if (!text) throw new Error('Groq returned empty response');
    return text;
  },

  parseRetryAfter(errMsg = '', headers = {}) {
    // Groq sends Retry-After header
    if (headers?.['retry-after']) return parseInt(headers['retry-after']) * 1000;
    const match = errMsg.match(/try again in ([\d.]+)s/i);
    if (match) return Math.ceil(parseFloat(match[1])) * 1000;
    return 30000;
  },

  isQuotaError(err) {
    const status = err?.response?.status;
    const msg = (err?.message || err?.response?.data?.error?.message || '').toLowerCase();
    return status === 429 || msg.includes('rate limit') || msg.includes('quota');
  },
};
