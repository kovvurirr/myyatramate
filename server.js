const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(path.join(__dirname, "public")));

// Create data folder if not exists
const dataDir = path.join(__dirname, "data");
const leadsFile = path.join(dataDir, "early-access-leads.json");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
}

if (!fs.existsSync(leadsFile)) {
  fs.writeFileSync(leadsFile, JSON.stringify([], null, 2));
}

// Home route
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// App demo route
app.get("/app", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "app.html"));
});

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    app: "MyYatraMate",
    message: "Server is running"
  });
});

// Early access form API
app.post("/api/early-access", (req, res) => {
  try {
    const { name, email, phone, travellerType } = req.body;

    if (!name || !email) {
      return res.status(400).json({
        success: false,
        message: "Name and email are required."
      });
    }

    const leads = JSON.parse(fs.readFileSync(leadsFile, "utf8"));

    const newLead = {
      id: Date.now(),
      name,
      email,
      phone: phone || "",
      travellerType: travellerType || "",
      createdAt: new Date().toISOString()
    };

    leads.push(newLead);

    fs.writeFileSync(leadsFile, JSON.stringify(leads, null, 2));

    res.json({
      success: true,
      message: "Early access request saved successfully.",
      lead: newLead
    });
  } catch (error) {
    console.error("Early access error:", error);

    res.status(500).json({
      success: false,
      message: "Something went wrong. Please try again."
    });
  }
});

// Temporary protected leads view
app.get("/admin/leads", (req, res) => {
  try {
    const leads = JSON.parse(fs.readFileSync(leadsFile, "utf8"));

    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>MyYatraMate Leads</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            padding: 30px;
            background: #f1f5f9;
          }
          h1 {
            color: #071a33;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            background: white;
          }
          th, td {
            padding: 12px;
            border: 1px solid #e2e8f0;
            text-align: left;
          }
          th {
            background: #071a33;
            color: white;
          }
        </style>
      </head>
      <body>
        <h1>MyYatraMate Early Access Leads</h1>
        <table>
          <thead>
            <tr>
              <th>S.No</th>
              <th>Name</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Traveller Type</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
    `;

    leads.forEach((lead, index) => {
      html += `
        <tr>
          <td>${index + 1}</td>
          <td>${lead.name}</td>
          <td>${lead.email}</td>
          <td>${lead.phone}</td>
          <td>${lead.travellerType}</td>
          <td>${new Date(lead.createdAt).toLocaleString()}</td>
        </tr>
      `;
    });

    html += `
          </tbody>
        </table>
      </body>
      </html>
    `;

    res.send(html);
  } catch (error) {
    res.status(500).send("Unable to load leads.");
  }
});

app.listen(PORT, () => {
  console.log(`MyYatraMate server running on port ${PORT}`);
});
