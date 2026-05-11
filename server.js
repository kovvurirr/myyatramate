const express = require("express");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 3000;

// Serve static files from public folder
app.use(express.static(path.join(__dirname, "public")));

// Main route
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Health check route
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    app: "MyYatraMate",
    message: "Server is running"
  });
});

app.listen(PORT, () => {
  console.log(`MyYatraMate server running on port ${PORT}`);
});
