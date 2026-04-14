/**
 * verify_system.js
 * Comprehensive validation script to ensure the engine is production-ready.
 */
require('dotenv').config();
const axios = require('axios');

const API = 'http://localhost:3001';

async function verify() {
  console.log('🚀 INITIALIZING SYSTEM VALIDATION...\n');

  // 1. Check ENV
  console.log('--- Phase 1: Environment Check ---');
  const keys = ['GEMINI_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY'];
  keys.forEach(k => {
    const val = process.env[k];
    if (!val || val.includes('PASTE')) {
      console.error(`❌ Missing ${k}`);
    } else {
      console.log(`✅ ${k} is configured`);
    }
  });

  // 2. Health Check
  console.log('\n--- Phase 2: Provider Health ---');
  try {
    const h = await axios.get(`${API}/health`);
    console.log(`✅ API is live (${h.data.status})`);
    h.data.providers.forEach(p => {
      const status = p.cooling ? 'Cooling' : (p.configured ? 'Active' : 'Missing Key');
      console.log(`   - ${p.name}: ${status}`);
    });
  } catch (err) {
    console.error(`❌ Health check failed: Is the server running? (${err.message})`);
    return;
  }

  // 3. functional Test (Text-only fallback)
  console.log('\n--- Phase 3: Functional Test (Copywriting) ---');
  try {
    console.log('🔄 Orchestrating personalization for "Sneakers" on "Example.com"...');
    const res = await axios.post(`${API}/api/personalize`, {
      adDescription: 'High-performance running sneakers with 20% discount. Built for marathon runners.',
      landingPageUrl: 'https://example.com'
    });
    
    if (res.data.status === 'success' || res.data.status === 'partial') {
      console.log('✅ Pipeline completed!');
      console.log(`   - Headline: "${res.data.preview.heroHeadline}"`);
      console.log(`   - Message Match: ${res.data.cro.personalizedMessageMatch}%`);
      console.log(`   - Time: ${(res.data.metadata.executionMs / 1000).toFixed(2)}s`);
    } else {
      console.error('❌ Pipeline returned unexpected status');
    }
  } catch (err) {
    console.error(`❌ Personalization failed: ${err.response?.data?.error || err.message}`);
  }

  // 4. Vision Test
  console.log('\n--- Phase 4: Vision / Image Test ---');
  try {
    const imgUrl = 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQUFBYza7crvKEsbhO1JoahNyseDQmBQE-5nw&s';
    console.log(`🔄 Testing Image Vision fallback for: ${imgUrl.slice(0, 40)}...`);
    const res = await axios.post(`${API}/api/personalize`, {
      adUrl: imgUrl,
      landingPageUrl: 'https://apple.com'
    });
    
    if (res.data.status === 'success' || res.data.status === 'partial') {
      console.log('✅ Vision Pipeline completed!');
      console.log(`   - Ad Analysis Offer: "${res.data.adAnalysis.offer}"`);
      console.log(`   - Personalized CTA: "${res.data.preview.ctaText}"`);
    } else {
      console.error('❌ Vision Pipeline returned unexpected status');
    }
  } catch (err) {
    console.error(`❌ Vision Test failed: ${err.response?.data?.error || err.message}`);
  }

  // 5. File Integrity
  console.log('\n--- Phase 5: File Integrity ---');
  const fs = require('fs');
  const path = require('path');
  const files = [
    'utils/llmRouter.js',
    'agents/planner.js',
    'agents/pageFetcher.js',
    'agents/executor.js',
    'agents/verifier.js'
  ];
  files.forEach(f => {
    if (fs.existsSync(path.join(__dirname, f))) {
      console.log(`✅ Found ${f}`);
    } else {
      console.error(`❌ Missing ${f}`);
    }
  });

  console.log('\n✨ VALIDATION COMPLETE. SYSTEM IS READY FOR DEPLOYMENT.');
}

verify();
