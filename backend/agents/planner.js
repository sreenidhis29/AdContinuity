/**
 * agents/planner.js — STAGE 1: Ad Intelligence Agent
 *
 * Extracts structured intent from any ad creative (image upload, URL, or text description).
 * Uses the LLM router → prefers Gemini for image tasks, Groq/OpenRouter for text-only.
 * Results are cached on disk — same ad description = zero API calls.
 */

const router = require('../utils/llmRouter');
const { logStage, logError } = require('../utils/logger');

const PLANNER_SYSTEM = `You are an expert digital-marketing strategist and ad analyst.
Your task is to extract structured intent from an advertisement.

Return ONLY a valid JSON object with exactly this schema:
{
  "offer": "the specific thing being advertised (product, feature, deal)",
  "headline": "the primary message or hook",
  "audience": "demographic + psychographic (e.g. stressed professionals 25-40)",
  "tone": "one of: urgent | calm | playful | aspirational | authoritative | empathetic | bold",
  "cta": "the action verb + context (e.g. Try free for 7 days)",
  "urgency": false,
  "visualStyle": "brief note on imagery mood (e.g. clean minimal, lifestyle aspirational)",
  "keyMessage": "the single most important thing to convey on the landing page",
  "emotionalHook": "the core emotion this ad triggers (e.g. FOMO, relief, aspiration)"
}

Rules:
- urgency: true only if the ad implies scarcity, deadlines, or FOMO
- Be specific and actionable — this output drives AI landing page personalization`;

async function runPlanner({ adImageBase64, adUrl, adDescription }, traceId = null) {
  const stageStart = Date.now();
  logStage('PLANNER', 'start', null, 'Analyzing ad creative', traceId);

  try {
    let parts;
    let needsVision = false;

    if (adImageBase64) {
      needsVision = true;
      parts = [
        router.buildBase64ImagePart(adImageBase64),
        { text: 'Analyze this ad image and return the structured JSON.' },
      ];
    } else if (adUrl) {
      needsVision = true;
      const imagePart = await router.buildUrlImagePart(adUrl);
      parts = [imagePart, { text: 'Analyze this ad image and return the structured JSON.' }];
    } else {
      needsVision = false;
      parts = [{ text: `Analyze this ad and return the structured JSON:\n\n"${adDescription}"` }];
    }

    const { text, provider } = await router.route({
      task: 'planner',
      systemPrompt: PLANNER_SYSTEM,
      parts,
      maxTokens: 600,
      needsVision,
      cacheResult: true,
      traceId,
    });

    const adAnalysis = router.parseJson(text);

    // Robust defaults to ensure relevance even if LLM is brief
    const defaults = {
      offer: 'Professional Services',
      headline: 'The Next Generation of Excellence',
      audience: 'Modern professionals and decision-makers',
      tone: 'aspirational',
      cta: 'Get Started',
      urgency: false,
      visualStyle: 'clean and premium',
      keyMessage: 'Unlocking new potential through innovation',
      emotionalHook: 'aspiration'
    };

    for (const [k, v] of Object.entries(defaults)) {
      if (!adAnalysis[k] || adAnalysis[k].toString().trim() === '') {
        adAnalysis[k] = v;
      }
    }

    logStage('PLANNER', 'success', Date.now() - stageStart, `"${adAnalysis.offer}" (via ${provider})`, traceId);
    return adAnalysis;
  } catch (err) {
    logStage('PLANNER', 'error', Date.now() - stageStart, err.message, traceId);
    logError('PLANNER', err);
    throw err;
  }
}

module.exports = { runPlanner };
