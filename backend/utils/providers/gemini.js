/**
 * utils/providers/gemini.js — Gemini Provider Adapter
 *
 * Best for: Multimodal (ad image analysis), vision tasks
 * Free tier: 15 RPM, 1500 req/day
 * Key: GEMINI_API_KEY
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

const DEFAULT_MODEL = 'gemini-2.0-flash';

let _client = null;
function getClient() {
  if (!_client) _client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return _client;
}

module.exports = {
  id: 'gemini',
  name: 'Gemini 2.0 Flash',
  supportsVision: true,
  envKey: 'GEMINI_API_KEY',

  isAvailable() {
    return !!process.env.GEMINI_API_KEY;
  },

  /**
   * @param {object} opts
   * @param {string} opts.systemPrompt
   * @param {Array}  opts.parts         - Gemini-format parts [{text}] or [{inlineData}]
   * @param {number} opts.maxTokens
   * @returns {Promise<string>}
   */
  async call({ systemPrompt, parts, maxTokens = 2000 }) {
    const model = getClient().getGenerativeModel({
      model: DEFAULT_MODEL,
      systemInstruction: systemPrompt,
      generationConfig: {
        maxOutputTokens: maxTokens,
        responseMimeType: 'application/json',
      },
    });

    const result = await model.generateContent({
      contents: [{ role: 'user', parts }],
    });

    const text = result.response.text();
    if (!text) throw new Error('Gemini returned empty response');
    return text;
  },

  /**
   * Parse the retry delay from a Gemini 429 error message.
   * The error text says: "Please retry in 43.98s"
   */
  parseRetryAfter(errMsg = '') {
    const match = errMsg.match(/retry in ([\d.]+)s/i);
    if (match) return Math.ceil(parseFloat(match[1])) * 1000;
    return 60000; // default 60s
  },

  isQuotaError(err) {
    const msg = (err?.message || '').toLowerCase();
    return msg.includes('429') || msg.includes('quota') || msg.includes('rate limit') || msg.includes('too many requests');
  },
};
