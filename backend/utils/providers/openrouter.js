/**
 * utils/providers/openrouter.js — OpenRouter Provider Adapter
 *
 * OpenRouter aggregates 200+ models. The :free models require no billing.
 * Best for: Text tasks when other providers are rate-limited.
 * Key: OPENROUTER_API_KEY → https://openrouter.ai/settings/keys
 *
 * NOTE: This provider does NOT support vision/images.
 * For image tasks, only text parts are sent (image URL/description as context).
 */

const axios = require('axios');
const { logStage } = require('../logger');

const OR_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Verified stable free models on OpenRouter (updated list, no vision needed here)
// These are text-only models with high reliability on the free tier
const FREE_MODELS = [
  'nvidia/nemotron-3-super-120b-a12b:free',
  'google/gemma-4-26b-a4b-it:free',
  'liquid/lfm-2.5-1.2b-instruct:free',
  'google/gemma-3-12b-it:free',
  'minimax/minimax-m2.5:free',
  'openai/gpt-oss-120b:free',
  'qwen/qwen3-next-80b-a3b-instruct:free',
  'meta-llama/llama-3.2-3b-instruct:free',
];

module.exports = {
  id: 'openrouter',
  name: 'OpenRouter (Multi-Model)',
  supportsVision: false,
  envKey: 'OPENROUTER_API_KEY',

  isAvailable() {
    return !!process.env.OPENROUTER_API_KEY;
  },

  async call({ systemPrompt, parts, maxTokens = 2000 }) {
    // Strip inlineData (images) — this provider is text-only
    // If image parts exist, add a note so the model knows context
    const hasImage = parts.some(p => p.inlineData);
    const textParts = parts.filter(p => p.text).map(p => p.text);
    if (hasImage) {
      textParts.unshift('[Note: An ad image was provided but cannot be rendered here. Analyze the text context only.]');
    }
    const userContent = textParts.join('\n');

    // Try each free model in order
    let lastErr;
    for (const model of FREE_MODELS) {
      try {
        logStage('ROUTER', 'info', null, `Trying OpenRouter model: ${model}`);
        
        const response = await axios.post(
          OR_API_URL,
          {
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              {
                role: 'user',
                content: userContent + '\n\nIMPORTANT: Respond with ONLY a valid JSON object. No preamble, no markdown blocks.',
              },
            ],
            max_tokens: maxTokens,
            temperature: 0.1,
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': 'https://adcontinuity.ai',
              'X-Title': 'AdContinuity',
            },
            timeout: 25000,
          }
        );

        const text = response.data?.choices?.[0]?.message?.content;
        
        if (text && text.trim().length > 5) {
          logStage('ROUTER', 'info', null, `Success with ${model}`);
          return text;
        }

        console.log(`[OR DEBUG] Model ${model} returned empty/short:`, response.data);
        throw new Error(`Empty response from ${model}`);

      } catch (err) {
        lastErr = err;
        const status = err?.response?.status;
        const errorData = err?.response?.data;
        
        if (errorData) console.log(`[OR DEBUG] Model ${model} failed:`, JSON.stringify(errorData));

        // Skip to next model on 4xx/5xx/timeout/empty
        logStage('ROUTER', 'info', null, `${model} failed, trying next...`);
        // Small delay to prevent cascading rate limits
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
    }

    throw lastErr || new Error('All OpenRouter free models failed to provide a valid response.');
  },

  parseRetryAfter(errMsg = '', headers = {}) {
    if (headers?.['retry-after']) return parseInt(headers['retry-after']) * 1000;
    return 30000;
  },

  isQuotaError(err) {
    // 429 = Rate Limit, 402 = Insufficient Balance (sometimes happens on free models if limits hit)
    return err?.response?.status === 429 || err?.response?.status === 402;
  },
};
