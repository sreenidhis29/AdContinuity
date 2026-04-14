/**
 * agents/executor.js — STAGE 3: Personalization Agent
 *
 * Generates the personalized landing page variant.
 * Uses the LLM router → Groq first (text-only), then OpenRouter, then Gemini.
 * This keeps Gemini's quota reserved for vision tasks in the Planner.
 */

const router = require('../utils/llmRouter');
const { logStage, logError } = require('../utils/logger');

const EXECUTOR_SYSTEM = `You are a world-class CRO (Conversion Rate Optimization) specialist and copywriter.
Your job is to personalize a landing page to create perfect message continuity from an ad.

HARD CONSTRAINTS:
1. ONLY change the messaging layer: headlines, subheadlines, CTA text, feature copy, social proof.
   NEVER suggest layout, structural, color, font, or design changes.
2. Every change must map to a CRO principle: "Message Match", "CTA Alignment", "Benefit Sequencing", "Urgency Continuity", or "Social Proof Targeting"
3. Generate exactly 4 high-quality changes. No more, no fewer.
4. Each "after" copy must be substantially different from "before" (at least 40% new words).
5. The hero headline MUST mirror the ad's exact offer framing and use audience-native vocabulary.
6. CTA text MUST use the same action verb as the ad's cta field.
7. If urgency is true, at least one change must carry urgency language. If false, remove any urgency.

Output a single JSON object with this exact schema:
{
  "changes": [
    {
      "section": "Hero Headline",
      "sectionId": "hero",
      "before": "original text",
      "after": "new personalized text",
      "reason": "why this change improves conversion",
      "croPrinciple": "Message Match"
    }
  ],
  "preview": {
    "heroHeadline": "Personalized H1",
    "heroSubhead": "Personalized subheadline paragraph",
    "ctaText": "Action CTA text",
    "features": [
      { "title": "Feature 1", "description": "Benefit description" },
      { "title": "Feature 2", "description": "Benefit description" }
    ],
    "socialProof": "Personalized testimonial or trust signal",
    "pageTheme": "A one-word theme (e.g. calm, energetic, professional, warm)",
    "accentColor": "A hex color that fits the brand and ad tone (e.g. #6366f1)"
  },
  "cro": {
    "messageMatch": 45,
    "conversionPotential": 55,
    "personalizedMessageMatch": 92,
    "personalizedConversionPotential": 88
  },
  "reasoning": "2-3 sentence explanation of the overall personalization strategy",
  "htmlSnippets": {
    "hero": "<section class=\"hero\"><h1>...</h1><p>...</p><a class=\"cta-btn\">...</a></section>",
    "cta": "<a class=\"cta-btn\">CTA text</a>",
    "socialProof": "<blockquote>...</blockquote>"
  }
}`;

function buildParts(adAnalysis, pageContent, correctionAddendum = null) {
  let text = `Ad Analysis (what the user saw in the ad):\n${JSON.stringify(adAnalysis, null, 2)}\n\n`;
  text += `Current Landing Page Content (what they land on):\n${JSON.stringify(pageContent, null, 2)}\n\n`;
  text += `Now generate the personalized variant that creates perfect message continuity between the ad and the landing page.`;

  if (correctionAddendum) {
    text += `\n\n--- CORRECTION REQUIRED ---\n${correctionAddendum}\nFix these issues and regenerate the complete JSON.`;
  }

  return [{ text }];
}

async function runExecutor(adAnalysis, pageContent, correctionAddendum = null, traceId = null) {
  const isCorrection = correctionAddendum !== null;
  const stageStart = Date.now();
  logStage('EXECUTOR', 'start', null, isCorrection ? 'correction-run' : 'first-run', traceId);

  try {
    const parts = buildParts(adAnalysis, pageContent, correctionAddendum);

    const { text, provider } = await router.route({
      task: isCorrection ? 'executor-correction' : 'executor',
      systemPrompt: EXECUTOR_SYSTEM,
      parts,
      maxTokens: 2500,
      needsVision: false, // Text-only — use Groq/OpenRouter, save Gemini for images
      cacheResult: !isCorrection, // Don't cache correction runs
      traceId,
    });

    const parsed = router.parseJson(text);

    logStage('EXECUTOR', 'success', Date.now() - stageStart, `${isCorrection ? 'corrected' : 'generated'} (via ${provider})`, traceId);
    return parsed;
  } catch (err) {
    logStage('EXECUTOR', 'error', Date.now() - stageStart, err.message, traceId);
    logError('EXECUTOR', err);
    throw err;
  }
}

module.exports = { runExecutor };
