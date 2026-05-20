module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  res.statusCode = 200;
  return res.end(JSON.stringify({
    status: "online",
    message: "GitHub Repository Analyzer API is running",
    endpoints: {
      analyze: "/api/analyze-repo (POST)"
    }
  }));
};