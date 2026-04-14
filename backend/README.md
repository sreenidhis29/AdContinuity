# Troopod — Landing Page Personalizer (Backend)

Production-ready Node.js + Express API powering the Landing Page Personalizer.

## Architecture

```
POST /api/personalize
        │
        ├─ Stage 1: PLANNER       (agents/planner.js)
        │   └─ Claude vision/text → structured adAnalysis
        │
        ├─ Stage 2: TOOL USE      (agents/pageFetcher.js)
        │   └─ axios + cheerio → pageContent (graceful fallback)
        │
        ├─ Stage 3: EXECUTOR      (agents/executor.js)
        │   └─ Claude CRO prompt → personalized changes/preview/scores
        │
        └─ Stage 4: VERIFIER      (agents/verifier.js)
            └─ 5 quality checks + optional correction run
```

## Setup

### 1. Install dependencies
```bash
cd backend
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env — add your ANTHROPIC_API_KEY
```

### 3. Start the server
```bash
npm run dev      # development (auto-restarts)
npm start        # production
```

Server runs on **http://localhost:3001** by default.

## API

### `POST /api/personalize`

**Request body:**
```json
{
  "adImageBase64": "data:image/png;base64,...",
  "adUrl": null,
  "adDescription": null,
  "landingPageUrl": "https://calm.com"
}
```
At least one of `adImageBase64`, `adUrl`, or `adDescription` is required.

**Response:**
```json
{
  "status": "success | partial",
  "adAnalysis": { "offer": "...", "headline": "...", ... },
  "cro": {
    "messageMatch": 62,
    "personalizedMessageMatch": 91,
    "conversionPotential": 58,
    "personalizedConversionPotential": 89
  },
  "changes": [
    {
      "sectionId": "hero",
      "sectionName": "Hero Headline",
      "original": "...",
      "new": "...",
      "reason": "...",
      "croPrinciple": "Message Match"
    }
  ],
  "preview": { "heroHeadline": "...", ... },
  "reasoning": "...",
  "htmlSnippets": { "hero": "...", "cta": "...", "socialProof": "..." },
  "metadata": {
    "fetchSuccess": true,
    "correctionRan": false,
    "scoresClamped": false,
    "executionMs": 4120,
    "pipelineStages": ["planner", "tool", "executor", "verifier"]
  }
}
```

### `GET /health`
```json
{ "status": "ok", "timestamp": "2024-01-15T10:23:01.000Z" }
```

## Error Codes

| Code | HTTP | Retryable |
|------|------|-----------|
| `MISSING_AD_INPUT` | 400 | No |
| `INVALID_URL` | 400 | No |
| `CLAUDE_TIMEOUT` | 503 | Yes |
| `PARSE_FAILURE` | 500 | Yes |
| `RATE_LIMITED` | 429 | Yes |

## Stage Logs

Each stage prints structured logs to stdout:

```
[PLANNER]  2024-01-15T10:23:01Z success 312ms  offer="7-day sleep program"
[TOOL]     2024-01-15T10:23:02Z success 890ms  isShopify=false
[EXECUTOR] 2024-01-15T10:23:05Z success 2841ms first-run
[VERIFIER] 2024-01-15T10:23:05Z success 3ms    All checks passed
[PIPELINE] 2024-01-15T10:23:05Z success 4120ms status=success
```

## Frontend Integration

Open `../landing_page_personalizer.html` in your browser.  
It is pre-configured to call `http://localhost:3001/api/personalize`.

CORS is open in development. For production, set `origin` in `server.js`.
