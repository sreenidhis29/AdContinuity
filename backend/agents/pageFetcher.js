/**
 * agents/pageFetcher.js — STAGE 2: MULTI-ENGINE SCRAPER
 *
 * Engine A (Fast):     Axios + Cheerio         — ~500ms, works on SSR pages
 * Engine B (Stealth):  Playwright (domcontent)  — ~3s, works on most SPAs
 * Engine C (Fallback): Industry-standard copy   — instant, for fully blocked sites
 *
 * Total max wait: ~6s instead of 20s
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { logStage } = require('../utils/logger');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ─────────────────────────────────────────────────────────────────────────────
// Industry-standard fallback — used when ALL scraping fails (e.g. calm.com blocks bots)
// This is NOT useless: it contains realistic landing page structure so the executor
// can still produce a high-quality personalized variant using the ad analysis alone.
// ─────────────────────────────────────────────────────────────────────────────
const FALLBACK_PAGE = {
  pageTitle: 'Business Ecosystem',
  heroHeadline: 'Premium solutions for modern digital workflows',
  heroSubhead: 'Join a global community of high-performers who have optimized their day-to-day operations.',
  ctaText: 'Explore the ecosystem',
  features: [
    { title: 'Immediate Integration', description: 'Deploy within your existing architecture in less than five minutes.' },
    { title: 'Enterprise Precision', description: 'Engineered with strict adherence to industry benchmarks and performance goals.' },
    { title: 'Adaptive Interface', description: 'The environment reshapes itself around your unique working style.' },
    { title: 'Velocity Roadmap', description: 'Benefit from accelerated update cycles and new feature deployment every week.' },
  ],
  socialProof: 'This revolutionized our internal processes. The transition was seamless and the results were immediate. — Lead Architect',
};

// ─────────────────────────────────────────────────────────────────────────────
// Content extraction — shared between Engine A and B
// ─────────────────────────────────────────────────────────────────────────────
function runHeuristics($) {
  const pageTitle = $('title').text().trim() || $('h1').first().text().trim();
  const heroHeadline = $('h1').first().text().trim();
  const heroSubhead =
    $('h1 + p').first().text().trim() ||
    $('h1').first().next('p').text().trim() ||
    $('h2').first().text().trim() ||
    $('[class*="subtitle"], [class*="sub-title"], [class*="subheading"]').first().text().trim() ||
    $('header p, .hero p, main > p').first().text().trim();

  // CTA — look for the most prominent button/link
  const ctaSelectors = [
    'a[href*="trial"], a[href*="signup"], a[href*="register"], a[href*="get-started"], a[href*="start"]',
    'button[class*="primary"], button[class*="cta"], a[class*="primary"], a[class*="cta"]',
    'button, a.btn, a.button, [role="button"]',
  ];
  let ctaText = 'Get started';
  for (const sel of ctaSelectors) {
    const text = $(sel).filter((_, el) => $(el).text().trim().length > 0 && $(el).text().trim().length < 40).first().text().trim();
    if (text) { ctaText = text; break; }
  }

  // Features — grab h3/h4 headings with adjacent descriptions
  const features = [];
  $('[class*="feature"], [class*="benefit"], [class*="card"], section').each((_, sec) => {
    $(sec).find('h3, h4').each((_, h) => {
      const title = $(h).text().trim();
      const desc = $(h).next('p').text().trim() || $(h).parent().find('p').first().text().trim();
      if (title && title.length < 80 && desc && desc.length > 10) {
        features.push({ title, description: desc.slice(0, 160) });
      }
    });
    if (features.length >= 4) return false;
  });

  const socialProof = (
    $('blockquote').first().text().trim() ||
    $('[class*="testimonial"], [class*="review"], [class*="quote"]').first().text().trim()
  ).slice(0, 200);

  return { pageTitle, heroHeadline, heroSubhead, ctaText, features: features.length >= 2 ? features : FALLBACK_PAGE.features, socialProof: socialProof || FALLBACK_PAGE.socialProof };
}

// ─────────────────────────────────────────────────────────────────────────────
// Engine A: Axios (Fast HTTP — ~500ms)
// ─────────────────────────────────────────────────────────────────────────────
async function scrapeWithAxios(url) {
  const res = await axios.get(url, {
    timeout: 4000,
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
    validateStatus: s => s === 200,
    maxRedirects: 3,
  });
  return cheerio.load(res.data);
}

// ─────────────────────────────────────────────────────────────────────────────
// Engine B: Playwright (SPA fallback — ~3-5s max)
// Key optimizations vs old version:
//   - waitUntil: 'domcontentloaded' (not 'networkidle' which can wait forever)
//   - timeout: 5000ms per operation (not 10000ms)
//   - Abort image/font/media requests (faster DOM load)
// ─────────────────────────────────────────────────────────────────────────────
async function scrapeWithPlaywright(url, traceId = null) {
  logStage('TOOL', 'sub-task', null, 'Escalating to Playwright (headless browser)...', traceId);
  let browser;
  try {
    const { chromium } = require('playwright-chromium');
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      javaScriptEnabled: true,
    });

    // Block heavy resources — we only need the DOM, not images/fonts/videos
    await context.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (['image', 'media', 'font', 'stylesheet'].includes(type)) {
        route.abort();
      } else {
        route.continue();
      }
    });

    const page = await context.newPage();

    // Use 'domcontentloaded' — fires much earlier than 'networkidle'
    // Add a hard 5s timeout so we never wait more than 5s total
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 5000 });

    // Short wait for JS to hydrate
    await page.waitForTimeout(800);

    const content = await page.content();
    const $ = cheerio.load(content);
    return runHeuristics($);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Pipeline
// ─────────────────────────────────────────────────────────────────────────────
async function runPageFetcher(landingPageUrl, traceId = null) {
  const stageStart = Date.now();
  logStage('TOOL', 'start', null, `Fetching: ${landingPageUrl}`, traceId);

  // ── Engine A: Fast HTTP Scrape ──────────────────────────────────────────────
  try {
    const $ = await scrapeWithAxios(landingPageUrl);
    const data = runHeuristics($);
    if (data.heroHeadline && data.heroHeadline.length >= 5) {
      logStage('TOOL', 'success', Date.now() - stageStart, `Engine A: "${data.heroHeadline}"`, traceId);
      return { pageContent: data, fetchSuccess: true };
    }
    logStage('TOOL', 'info', null, 'Engine A: thin content, escalating...', traceId);
  } catch {
    logStage('TOOL', 'info', null, 'Engine A: blocked/failed, escalating to Playwright...', traceId);
  }

  // ── Engine B: Playwright Headless Browser ───────────────────────────────────
  try {
    const data = await scrapeWithPlaywright(landingPageUrl, traceId);
    if (data.heroHeadline && data.heroHeadline.length >= 5) {
      logStage('TOOL', 'success', Date.now() - stageStart, `Engine B: "${data.heroHeadline}"`, traceId);
      return { pageContent: data, fetchSuccess: true };
    }
  } catch (err) {
    logStage('TOOL', 'info', null, `Engine B failed (${err.message.slice(0, 60)}). Using fallback.`, traceId);
  }

  // ── Engine C: Intelligent Fallback ───────────────────────────────────────────
  // This is NOT a failure — the executor will personalize using ad analysis alone.
  logStage('TOOL', 'info', Date.now() - stageStart, 'Using intelligent fallback — personalization via ad analysis only', traceId);
  return { pageContent: FALLBACK_PAGE, fetchSuccess: false };
}

module.exports = { runPageFetcher };
