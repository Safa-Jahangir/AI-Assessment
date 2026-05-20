// ── Vercel Handler ────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  // Helper to send JSON responses reliably
  const sendJSON = (statusCode, data) => {
    res.statusCode = statusCode;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.end(JSON.stringify(data));
  };

  // Handle preflight
  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    return res.end();
  }

  // Only accept POST
  if (req.method !== "POST") {
    return sendJSON(405, { status: "error", message: "Method not allowed. Use POST." });
  }

  const { repo_url } = req.body || {};

  if (!repo_url || typeof repo_url !== "string") {
    return sendJSON(400, {
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
    return sendJSON(200, {
      status: "success",
      repo_name: repo,
      file_analyzed: primaryFile,
      vulnerabilities_found: analysis.vulnerabilities_found ?? [],
      suggestions: analysis.suggestions ?? "",
    });

  } catch (err) {
    console.error("[analyze] error:", err.message);

    if (err.message?.includes("404"))
      return sendJSON(404, { status: "error", message: "Repository not found or is private." });
    if (err.message?.includes("Invalid GitHub URL"))
      return sendJSON(400, { status: "error", message: err.message });
    if (err.message?.includes("No source files"))
      return sendJSON(422, { status: "error", message: err.message });

    return sendJSON(500, { 
      status: "error", 
      message: "Internal server error.", 
      details: err.message // This helps you see the actual error in ReqBin
    });
  }
};