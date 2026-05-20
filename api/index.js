/**
 * GET / — Health check & usage info
 */
module.exports = function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.status(200).json({
    service: "GitHub Repository Analyzer",
    status: "running",
    endpoint: "POST /api/analyze-repo",
    body_example: { repo_url: "https://github.com/username/repository" },
  });
};
