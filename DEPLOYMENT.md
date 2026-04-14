# AdContinuity Deployment Guide 🚀

Follow these steps to take your AI Personalization Engine from localhost to the public web.

## 1. Deploy the Backend (Railway / Render)

The backend requires a Node.js environment with **Playwright** support.

### Railway (Recommended)
1.  Login to [Railway.app](https://railway.app/).
2.  Click **New Project** > **Deploy from GitHub repo**.
3.  Select your `AdContinuity` repository.
4.  Railway will detect the `backend/` folder. Ensure the **Root Directory** is set to `backend`.
5.  Go to the **Variables** tab and add the following from your `.env`:
    *   `GEMINI_API_KEY`
    *   `GROQ_API_KEY`
    *   `OPENROUTER_API_KEY`
6.  Railway will provide a URL (e.g., `https://backend-production-123.up.railway.app`). **Copy this URL.**

## 2. Connect the Frontend

1.  Open `landing_page_personalizer.html`.
2.  Find line **702** (approx):
    ```javascript
    const API = ... : 'https://your-backend-url.railway.app';
    ```
3.  Replace that placeholder URL with your **actual Railway URL** from Step 1.
4.  Commit and push these changes to GitHub:
    ```bash
    git add .
    git commit -m "docs: set production backend URL"
    git push origin main
    ```

## 3. Deploy the Frontend (Vercel / Netlify)

1.  Login to [Vercel](https://vercel.com/).
2.  Click **Add New** > **Project**.
3.  Select the same `AdContinuity` repo.
4.  In the "Build and Output Settings", Vercel will likely treat it as a static project. 
5.  Since your HTML file is in the root, it will serve it as the index page.
6.  Deploy!

## 🔒 Security Note
Since the API is currently open, anyone who finds your backend URL can make requests. For a production launch, consider adding a simple `x-api-key` header logic in `server.js` and `landing_page_personalizer.html`.
