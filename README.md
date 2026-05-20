# GitHub Repository Analyzer API

Analyzes public GitHub repositories for bugs and security vulnerabilities using Gemini 1.5 Pro. Built as a Vercel serverless deployment.

---

## Live API

**Base URL:** https://ai-assessment-pearl.vercel.app
**Health Check:** https://ai-assessment-pearl.vercel.app/api

### `POST /api/analyze-repo`

**Request:**
```json
{ "repo_url": "https://github.com/username/repository" }
```

**Response:**
```json
{
  "status": "success",
  "repo_name": "repository-name",
  "file_analyzed": "index.js",
  "vulnerabilities_found": [
    "Hardcoded API key found on line 12",
    "No input validation before SQL query construction"
  ],
  "suggestions": "Consider splitting the monolithic index.js into separate route handlers..."
}
```

**Health check:** `GET /api` — returns service info.

---

## Project Structure

```
├── api/
│   ├── analyze-repo.js   # POST /api/analyze-repo — core logic
│   └── index.js          # GET  /api             — health check
├── vercel.json           # Vercel config (30s function timeout)
├── package.json
├── .env.example
└── .gitignore
```

---

## Deploy to Vercel (5 minutes)

### Option A — Vercel Dashboard (easiest)

1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com) → **Add New Project**
3. Import your GitHub repo
4. Under **Environment Variables**, add:
   - `GEMINI_API_KEY` → your key from [aistudio.google.com](https://aistudio.google.com/)
   - `GITHUB_TOKEN` → optional, raises rate limits
5. Click **Deploy** — you get a live `https://` URL instantly

### Option B — Vercel CLI

```bash
npm i -g vercel
vercel                        # follow prompts
vercel env add ANTHROPIC_API_KEY
vercel env add GITHUB_TOKEN   # optional
vercel --prod
```

---

## Local Development

```bash
npm install
cp .env.example .env          # fill in your keys
npm i -g vercel
vercel dev                    # runs at http://localhost:3000
```

Test it:
```bash
curl -X POST http://localhost:3000/api/analyze-repo \
  -H "Content-Type: application/json" \
  -d '{"repo_url": "https://github.com/expressjs/express"}'
```

---

## Security

- API keys loaded from environment variables only — never hardcoded
- `.env` is gitignored; `.env.example` contains no real credentials
- CORS enabled for flexible testing
