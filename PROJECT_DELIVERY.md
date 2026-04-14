# 🚀 Troopod: Landing Page Personalizer – Deployment & Demo Guide

This document provides everything you need to deliver the mandatory **Live Demo / Link** for your project.

## 📦 Project Structure
- **Frontend**: `landing_page_personalizer.html` (Premium Single-Page App)
- **Backend**: `backend/` (Node.js/Express API with 4-stage Agent Pipeline)

---

## 🛠 Option 1: Quick Local Demo (Fastest)
If you are presenting via screen share, follow these steps:

1. **Start Backend**:
   ```bash
   cd backend
   npm install
   npm run dev
   ```
   *The API will run on `http://localhost:3001`.*

2. **Open Frontend**:
   Simply open `landing_page_personalizer.html` in any modern browser (Chrome/Edge).
   - Click the **"Try Demo Example"** button in the bottom right.
   - Click **"Generate Personalized Variant"**.
   - Watch the progress tracker (Analyzing → Fetching → Personalizing → Validating).

---

## 🌐 Option 2: Delivering a Live Link (Mandatory Requirement)
To get a public link, follow this 5-minute deployment strategy:

### 1. Backend (Server) Deployment
- **Provider**: [Render](https://render.com) or [Railway](https://railway.app).
- **Steps**: 
  1. Create a new "Web Service" from your GitHub repo.
  2. Set **Root Directory** to `backend`.
  3. Set **Build Command** to `npm install`.
  4. Set **Start Command** to `npm start`.
  5. **Environment Variable**: Add `GEMINI_API_KEY` (your key from Google AI Studio).
- **Result**: You get a URL like `https://troopod-api.onrender.com`.

### 2. Frontend Deployment
- **Provider**: [Vercel](https://vercel.com) or [Netlify](https://netlify.com).
- **Steps**:
  1. Rename `landing_page_personalizer.html` to `index.html`.
  2. In `index.html`, update the `API_URL` constant (line 539) to your new Render URL.
  3. Push to GitHub and connect to Vercel.
- **Result**: You get a premium live link like `https://troopod-personalizer.vercel.app`.

---

## 🎯 Demo Walkthrough (What to Show)

1. **The Continuity Problem**: Explain that most ads lead to generic pages, losing 90% of conversions.
2. **The Ad Analysis**: Upload an image or describe an ad. Show how Troopod extracts the "Core Hook" and "Audience Intent".
3. **The Live Personalization**:
   - Provide the URL of an existing landing page (e.g., `https://calm.com` or `https://notion.so`).
   - Click Generate.
4. **The CRO Results**:
   - **Metrics**: Show the "Message Match" jump from 40% to 95%.
   - **Mockup**: Show the "Live Preview" where the Hero Headline and CTA are now perfectly aligned with the ad.
   - **Changes**: Walk through the "Individual Changes" tab to show exactly *what* was modified and *why* (CRO Principles).
   - **Code**: Show the "Export Code" tab to demonstrate how a marketer can instantly use these results in their workflow.

---

## 🛡 Fault Tolerance
The system includes:
- **Rate Limit Queueing**: Automated slot management for the Gemini Free Tier.
- **Verification Loop**: If the AI makes a mistake (e.g. unclosed HTML or weak copy), the **Verifier Agent** automatically triggers a correction run before showing the result to the user.
- **Mock Fallback**: If the local API is not running during a quick UI check, a premium mock response is injected so the demo never "breaks".
