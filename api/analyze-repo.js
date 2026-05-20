const axios = require("axios");

// -- HELPER FUNCTIONS --
function parseGitHubUrl(url) {
  try {
    const cleaned = url.replace(/\.git$/, "").split("/tree/")[0];
    const { pathname } = new URL(cleaned);
    const parts = pathname.split("/").filter(Boolean);
    if (parts.length < 2) throw new Error("Invalid format");
    return { owner: parts[0], repo: parts[1] };
  } catch (e) {
    throw new Error(`Invalid GitHub URL: ${url}`);
  }
}

async function analyzeWithGemini(code, filePath, repoName) {
  const prompt = `Analyze this code from ${repoName} (${filePath}) for bugs and security issues. 
  Respond ONLY with a JSON object: {"vulnerabilities_found": [], "suggestions": ""}.
  Code: ${code.slice(0, 10000)}`;

  // Using the more stable v1 endpoint instead of v1beta
  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    { 
      contents: [{ parts: [{ text: prompt }] }] 
    },
    {
      headers: {
        'Content-Type': 'application/json'
      }
    }
  );

  const raw = response.data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  const cleaned = raw.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned);
}

// -- MAIN HANDLER --
module.exports = async (req, res) => {
  // Set CORS headers manually for maximum compatibility
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    return res.end();
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: "Use POST" }));
  }

  try {
    const { repo_url } = req.body || {};
    if (!repo_url) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: "repo_url is required" }));
    }

    const { owner, repo } = parseGitHubUrl(repo_url);
    
    // Fetch basic repo info to get default branch
    const repoInfo = await axios.get(`https://api.github.com/repos/${owner}/${repo}`);
    const branch = repoInfo.data.default_branch || "main";

    // Fetch the file tree to find a source file
    const treeInfo = await axios.get(`https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`);
    const primaryFile = treeInfo.data.tree.find(f => f.path.endsWith('.js') || f.path.endsWith('.py') || f.path.endsWith('.ts'))?.path;

    if (!primaryFile) {
      res.statusCode = 404;
      return res.end(JSON.stringify({ error: "No source files found" }));
    }

    // Get the raw code
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${primaryFile}`;
    const codeRes = await axios.get(rawUrl);
    
    // Analyze
    const analysis = await analyzeWithGemini(codeRes.data, primaryFile, repo);

    res.statusCode = 200;
    return res.end(JSON.stringify({
      status: "success",
      repo_name: repo,
      analysis: analysis
    }));

  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    return res.end(JSON.stringify({ 
      status: "error", 
      message: err.message,
      note: "Check if GEMINI_API_KEY is set in Vercel settings" 
    }));
  }
};