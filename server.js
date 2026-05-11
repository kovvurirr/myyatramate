const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(path.join(__dirname, "public")));

// Data folder setup
const dataDir = path.join(__dirname, "data");
const leadsFile = path.join(dataDir, "early-access-leads.json");
const tripsFile = path.join(dataDir, "trip-plans.json");
const budgetsFile = path.join(dataDir, "budgets.json");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
}

if (!fs.existsSync(leadsFile)) {
  fs.writeFileSync(leadsFile, JSON.stringify([], null, 2));
}

if (!fs.existsSync(tripsFile)) {
  fs.writeFileSync(tripsFile, JSON.stringify([], null, 2));
}

if (!fs.existsSync(budgetsFile)) {
  fs.writeFileSync(budgetsFile, JSON.stringify([], null, 2));
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

// Early access API
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

// Trip planner API
app.post("/api/trip-plan", (req, res) => {
  try {
    const {
      fromCity,
      destination,
      days,
      travelType,
      budgetStyle,
      foodPref
    } = req.body;

    if (!destination || !days) {
      return res.status(400).json({
        success: false,
        message: "Destination and number of days are required."
      });
    }

    const tripDays = Number(days) || 3;

    let plan = `MyYatraMate Trip Plan\n\n`;
    plan += `From: ${fromCity || "Not specified"}\n`;
    plan += `Destination: ${destination}\n`;
    plan += `Duration: ${tripDays} days\n`;
    plan += `Travel Type: ${travelType}\n`;
    plan += `Budget Style: ${budgetStyle}\n`;
    plan += `Food Preference: ${foodPref}\n\n`;

    plan += `Recommended Travel Style:\n`;
    plan += `This trip is planned as a ${budgetStyle.toLowerCase()} ${travelType.toLowerCase()} with focus on comfort, safety, food preference and practical movement.\n\n`;

    for (let i = 1; i <= tripDays; i++) {
      if (i === 1) {
        plan += `Day ${i}: Arrival & Settling In\n`;
        plan += `- Reach destination and complete airport/railway exit.\n`;
        plan += `- Use Landing Mode for hotel route, taxi help, currency and emergency contacts.\n`;
        plan += `- Check in to hotel and explore nearby food options.\n`;
        plan += `- Keep the first day light to avoid tiredness.\n\n`;
      } else if (i === tripDays) {
        plan += `Day ${i}: Return Preparation\n`;
        plan += `- Keep the day light and stay near hotel/airport route.\n`;
        plan += `- Check baggage, passport/ID, medicines, chargers and shopping items.\n`;
        plan += `- Start for airport/railway station early.\n`;
        plan += `- Review final expenses and save important receipts.\n\n`;
      } else {
        plan += `Day ${i}: Sightseeing & Local Experience\n`;
        plan += `- Visit 2 to 3 important attractions at a comfortable pace.\n`;
        plan += `- Add rest breaks, especially for family/senior travellers.\n`;
        plan += `- Use translator, food finder, currency converter and expense tracker.\n`;
        plan += `- Keep evening flexible for shopping or local food.\n\n`;
      }
    }

    plan += `Packing Reminder:\n`;
    plan += `Passport/ID, tickets, hotel voucher, medicines, charger, power bank, weather-based clothes and emergency contact details.\n\n`;

    plan += `Safety Reminder:\n`;
    plan += `Save hotel address, emergency numbers, family contact and offline documents before travel.\n\n`;

    plan += `Note: This is the basic rule-based version. Later we will connect AI for highly personalized itineraries.`;

    const trips = JSON.parse(fs.readFileSync(tripsFile, "utf8"));

    const newTrip = {
      id: Date.now(),
      fromCity: fromCity || "",
      destination,
      days: tripDays,
      travelType,
      budgetStyle,
      foodPref,
      plan,
      createdAt: new Date().toISOString()
    };

    trips.push(newTrip);
    fs.writeFileSync(tripsFile, JSON.stringify(trips, null, 2));

    res.json({
      success: true,
      message: "Trip plan generated successfully.",
      trip: newTrip
    });
  } catch (error) {
    console.error("Trip plan error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to generate trip plan."
    });
  }
});

// Admin leads view
app.get("/admin/leads", (req, res) => {
  try {
    const leads = JSON.parse(fs.readFileSync(leadsFile, "utf8"));

    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>MyYatraMate Leads</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 30px; background: #f1f5f9; }
          h1 { color: #071a33; }
          table { width: 100%; border-collapse: collapse; background: white; }
          th, td { padding: 12px; border: 1px solid #e2e8f0; text-align: left; }
          th { background: #071a33; color: white; }
          a { color: #0f4c81; font-weight: bold; }
        </style>
      </head>
      <body>
        <h1>MyYatraMate Early Access Leads</h1>
        <p><a href="/admin/trips">View Trip Plans</a></p>
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

// Admin trip plans view
app.get("/admin/trips", (req, res) => {
  try {
    const trips = JSON.parse(fs.readFileSync(tripsFile, "utf8"));

    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>MyYatraMate Trip Plans</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 30px; background: #f1f5f9; }
          h1 { color: #071a33; }
          .trip {
            background: white;
            border: 1px solid #e2e8f0;
            border-radius: 18px;
            padding: 20px;
            margin-bottom: 18px;
          }
          .meta {
            color: #64748b;
            margin-bottom: 12px;
          }
          pre {
            white-space: pre-wrap;
            line-height: 1.6;
            background: #f8fafc;
            padding: 16px;
            border-radius: 12px;
          }
          a { color: #0f4c81; font-weight: bold; }
        </style>
      </head>
      <body>
        <h1>MyYatraMate Generated Trip Plans</h1>
        <p><a href="/admin/leads">View Early Access Leads</a></p>
    `;

    if (trips.length === 0) {
      html += `<p>No trip plans generated yet.</p>`;
    }

    trips.reverse().forEach((trip, index) => {
      html += `
        <div class="trip">
          <h2>${index + 1}. ${trip.destination} - ${trip.days} Days</h2>
          <div class="meta">
            From: ${trip.fromCity || "-"} |
            Type: ${trip.travelType} |
            Budget: ${trip.budgetStyle} |
            Food: ${trip.foodPref} |
            Date: ${new Date(trip.createdAt).toLocaleString()}
          </div>
          <pre>${trip.plan}</pre>
        </div>
      `;
    });

    html += `
      </body>
      </html>
    `;

    res.send(html);
  } catch (error) {
    res.status(500).send("Unable to load trip plans.");
  }
});

app.listen(PORT, () => {
  console.log(`MyYatraMate server running on port ${PORT}`);
});
