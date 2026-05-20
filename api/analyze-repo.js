/**
 * GitHub Repository Analyzer — Vercel Serverless Function
 *
 * Endpoint: POST /api/analyze-repo
 * Body:     { "repo_url": "https://github.com/owner/repo" }
 *
 * Fetches the primary source file from a public GitHub repo,
 * passes it to Gemini, and returns structured vulnerability analysis.
 */

const axios = require("axios");

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parses a GitHub URL into { owner, repo }.
 * Handles: plain URLs, .git suffix, /tree/branch paths.
 */
function parseGitHubUrl(url) {
  try {
    const cleaned = url.replace(/\.git$/, "").split("/tree/")[0];
    const { pathname } = new URL(cleaned);
    const parts = pathname.split("/").filter(Boolean);
    if (parts.length < 2) throw new Error("Cannot parse owner/repo from URL");
    return { owner: parts[0], repo: parts[1] };
  } catch {
    throw new Error(`Invalid GitHub URL: "${url}"`);
  }
}

/** Builds GitHub API headers, adding auth token if available. */
function buildGitHubHeaders() {
  const headers = { Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) {
    headers["Authorization"] = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

/** Returns the default branch name for a repo. */
async function getDefaultBranch(owner, repo) {
  const { data } = await axios.get(
    `https://api.github.com/repos/${owner}/${repo}`,
    { headers: buildGitHubHeaders() }
  );
  return data.default_branch || "main";
}

/** Walks the full file tree in one API request and returns all blob paths. */
async function getFileTree(owner, repo, branch) {
  const { data } = await axios.get(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
    { headers: buildGitHubHeaders() }
  );
  return data.tree.filter((i) => i.type === "blob").map((i) => i.path);
}

/** Fetches raw file content from GitHub. */
async function fetchFileContent(owner, repo, filePath, branch) {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
  const { data } = await axios.get(url, { responseType: "text" });
  return data;
}

// Source code extensions to consider
const CODE_EXTENSIONS = [
  ".js", ".ts", ".jsx", ".tsx", ".py", ".java", ".go", ".rb",
  ".php", ".cs", ".cpp", ".c", ".rs", ".swift", ".kt", ".scala", ".sh",
];

// Paths to skip (generated/vendor/build artifacts)
const SKIP_PATTERNS = [
  /node_modules/, /\.min\./, /dist\//, /build\//, /vendor\//,
  /\.lock$/, /package-lock\.json$/,
];

// Preferred entry-point filenames (checked in order)
const ENTRY_POINTS = [
  "index.js", "index.ts", "app.js", "app.ts",
  "main.js", "main.ts", "main.py", "app.py",
  "server.js", "server.ts", "index.py",
];

/**
 * Picks the single most representative source file from the tree.
 * Prefers known entry-point names; falls back to the first eligible file.
 */
function pickPrimaryFile(paths) {
  const eligible = paths.filter(
    (p) =>
      CODE_EXTENSIONS.some((ext) => p.endsWith(ext)) &&
      !SKIP_PATTERNS.some((rx) => rx.test(p))
  );
  if (eligible.length === 0) throw new Error("No source files found in repo.");

  for (const entry of ENTRY_POINTS) {
    const match = eligible.find(
      (p) => p === entry || p.endsWith(`/src/${entry}`) || p.endsWith(`/${entry}`)
    );
    if (match) return match;
  }
  return eligible[0];
}

/**
 * Sends code to Gemini 2.0 Flash and returns structured vulnerability analysis.
 * Returns { vulnerabilities_found: string[], suggestions: string }
 */
async function analyzeWithGemini(code, filePath, repoName) {
  const prompt = `You are an expert security auditor and senior software engineer.
Analyze the following source code from the GitHub repository "${repoName}" (file: ${filePath}).

Identify:
1. Security vulnerabilities (e.g. injection attacks, hardcoded secrets, insecure dependencies, improper auth)
2. Potential bugs (e.g. null dereferences, off-by-one errors, race conditions, uncaught exceptions)
3. Brief structural or optimization advice

Respond ONLY with a valid JSON object in this exact shape (no markdown, no extra keys):
{
  "vulnerabilities_found": ["concise description 1", "concise description 2"],
  "suggestions": "One short paragraph of structural/optimization advice."
}

If no issues are found, return an empty array for vulnerabilities_found and note the code looks clean in suggestions.

Code to analyze:
\`\`\`
${code.slice(0, 12000)}
\`\`\``;

  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
    },
    { headers: { "Content-Type": "application/json" } }
  );

  const raw = response.data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  const cleaned = raw.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned);
}

// ── Vercel Handler ────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight
  if (req.method === "OPTIONS") return res.status(200).end();

  // Only accept POST
  if (req.method !== "POST") {
    return res.status(405).json({ status: "error", message: "Method not allowed. Use POST." });
  }

  const { repo_url } = req.body || {};

  if (!repo_url || typeof repo_url !== "string") {
    return res.status(400).json({
      status: "error",
      message: 'Missing or invalid "repo_url" in request body.',
    });
  }

  try {
    // 1. Parse URL → owner + repo
    const { owner, repo } = parseGitHubUrl(repo_url);
    console.log(`[analyze] ${owner}/${repo}`);

    // 2. Get default branch
    const branch = await getDefaultBranch(owner, repo);

    // 3. Walk full file tree
    const allFiles = await getFileTree(owner, repo, branch);

    // 4. Pick best source file
    const primaryFile = pickPrimaryFile(allFiles);
    console.log(`[analyze] primary file: ${primaryFile}`);

    // 5. Fetch raw content
    const code = await fetchFileContent(owner, repo, primaryFile, branch);

    // 6. Analyze with Gemini
    const analysis = await analyzeWithGemini(code, primaryFile, repo);

    // 7. Return structured response
    return res.status(200).json({
      status: "success",
      repo_name: repo,
      file_analyzed: primaryFile,
      vulnerabilities_found: analysis.vulnerabilities_found ?? [],
      suggestions: analysis.suggestions ?? "",
    });

  } catch (err) {
    console.error("[analyze] error:", err.message);

    if (err.message?.includes("404"))
      return res.status(404).json({ status: "error", message: "Repository not found or is private." });
    if (err.message?.includes("Invalid GitHub URL"))
      return res.status(400).json({ status: "error", message: err.message });
    if (err.message?.includes("No source files"))
      return res.status(422).json({ status: "error", message: err.message });

    return res.status(500).json({ status: "error", message: "Internal server error. Please try again later." });
  }
};
