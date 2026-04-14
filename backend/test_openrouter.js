require('dotenv').config();
const axios = require('axios');

const toTest = [
  'meta-llama/llama-3.1-8b-instruct:free',
  'google/gemma-2-9b-it:free',
  'openai/gpt-oss-20b:free',
  'qwen/qwen-2.5-72b-instruct:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
];

(async () => {
  console.log('Testing OpenRouter free models...');
  for (const model of toTest) {
    try {
      const r = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
        model,
        messages: [{ role: 'user', content: 'Say OK' }],
        max_tokens: 10,
        temperature: 0,
      }, {
        headers: {
          Authorization: 'Bearer ' + process.env.OPENROUTER_API_KEY,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://troopod.app',
        },
        timeout: 10000,
      });
      const reply = (r.data?.choices?.[0]?.message?.content || '').trim();
      console.log(`[OK]   ${model.padEnd(40)} -> "${reply}"`);
    } catch(e) {
      console.log(`[FAIL] ${model.padEnd(40)} -> HTTP ${e?.response?.status || e.code || '?'}`);
    }
  }
})();
