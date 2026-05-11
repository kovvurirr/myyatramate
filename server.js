const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

// Temporary admin PIN. Later we will replace this with proper login.
// You can change this PIN here or set ADMIN_PIN in Hostinger environment variables.
const ADMIN_PIN = process.env.ADMIN_PIN || "1234";

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(path.join(__dirname, "public")));

// ---------------------------
// Data file setup
// ---------------------------
const dataDir = path.join(__dirname, "data");
const files = {
  leads: path.join(dataDir, "early-access-leads.json"),
  trips: path.join(dataDir, "trip-plans.json"),
  budgets: path.join(dataDir, "budgets.json"),
  expenses: path.join(dataDir, "expenses.json")
};

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
}

Object.values(files).forEach((filePath) => {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify([], null, 2));
  }
});

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return [];
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function adminAllowed(req) {
  return req.query.pin === ADMIN_PIN;
}

function adminShell(title, body) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>${escapeHtml(title)}</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <style>
        body {
          font-family: Arial, sans-serif;
          margin: 0;
          padding: 30px;
          background: #f1f5f9;
          color: #0f172a;
        }
        h1 { color: #071a33; margin-top: 0; }
        a { color: #0f4c81; font-weight: bold; }
        .nav {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          margin-bottom: 24px;
        }
        .nav a {
          background: white;
          border: 1px solid #e2e8f0;
          padding: 10px 14px;
          border-radius: 999px;
          text-decoration: none;
        }
        .card {
          background: white;
          border: 1px solid #e2e8f0;
          border-radius: 18px;
          padding: 20px;
          margin-bottom: 18px;
        }
        .meta {
          color: #64748b;
          margin-bottom: 12px;
          line-height: 1.6;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          background: white;
          border-radius: 14px;
          overflow: hidden;
        }
        th, td {
          padding: 12px;
          border: 1px solid #e2e8f0;
          text-align: left;
          vertical-align: top;
        }
        th {
          background: #071a33;
          color: white;
        }
        pre {
          white-space: pre-wrap;
          line-height: 1.6;
          background: #f8fafc;
          padding: 16px;
          border-radius: 12px;
          overflow-x: auto;
        }
        .warning {
          background: #fff7ed;
          border: 1px solid #fed7aa;
          padding: 16px;
          border-radius: 14px;
          color: #9a3412;
          margin-bottom: 18px;
        }
        @media(max-width: 700px) {
          body { padding: 16px; }
          table { font-size: 13px; }
        }
      </style>
    </head>
    <body>
      ${body}
    </body>
    </html>
  `;
}

function adminAuthPage() {
  return adminShell(
    "MyYatraMate Admin",
    `
      <h1>MyYatraMate Admin</h1>
      <div class="warning">
        Enter admin PIN in the URL to view data. Example:
        <br><br>
        <strong>/admin?pin=1234</strong>
      </div>
      <p>This is temporary protection for the MVP. Later we will add proper admin login.</p>
    `
  );
}

// ---------------------------
// Public routes
// ---------------------------
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/app", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "app.html"));
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    app: "MyYatraMate",
    message: "Server is running",
    timestamp: new Date().toISOString()
  });
});

// ---------------------------
// API routes
// ---------------------------
app.post("/api/early-access", (req, res) => {
  try {
    const { name, email, phone, travellerType } = req.body;

    if (!name || !email) {
      return res.status(400).json({
        success: false,
        message: "Name and email are required."
      });
    }

    const leads = readJson(files.leads);
    const newLead = {
      id: Date.now(),
      name: String(name).trim(),
      email: String(email).trim(),
      phone: String(phone || "").trim(),
      travellerType: String(travellerType || "").trim(),
      createdAt: new Date().toISOString()
    };

    leads.push(newLead);
    writeJson(files.leads, leads);

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

app.post("/api/trip-plan", (req, res) => {
  try {
    const {
      fromCity,
      destination,
      days,
      travellers,
      travelType,
      budgetStyle,
      foodPref,
      specialNeeds
    } = req.body;

    if (!destination || !days) {
      return res.status(400).json({
        success: false,
        message: "Destination and number of days are required."
      });
    }

    const tripDays = Math.max(1, Math.min(Number(days) || 3, 30));
    const numTravellers = Number(travellers) || 1;

    let plan = `MyYatraMate Trip Plan\n\n`;
    plan += `From: ${fromCity || "Not specified"}\n`;
    plan += `Destination: ${destination}\n`;
    plan += `Duration: ${tripDays} days\n`;
    plan += `Travellers: ${numTravellers}\n`;
    plan += `Travel Type: ${travelType || "General Trip"}\n`;
    plan += `Budget Style: ${budgetStyle || "Comfort"}\n`;
    plan += `Food Preference: ${foodPref || "No Preference"}\n`;
    plan += `Special Needs: ${specialNeeds || "None"}\n\n`;

    plan += `Recommended Travel Style:\n`;
    plan += `This trip is planned with focus on practical movement, safety, food preference, budget control and after-landing support.\n\n`;

    for (let i = 1; i <= tripDays; i++) {
      if (i === 1) {
        plan += `Day ${i}: Arrival & Settling In\n`;
        plan += `- Complete airport/railway exit and baggage collection.\n`;
        plan += `- Use Landing Mode for hotel route, taxi help, currency and emergency contacts.\n`;
        plan += `- Check in to hotel and save hotel address offline.\n`;
        plan += `- Keep the first day light to avoid tiredness.\n`;
        plan += `- Find suitable food based on preference: ${foodPref || "No Preference"}.\n\n`;
      } else if (i === tripDays) {
        plan += `Day ${i}: Return Preparation\n`;
        plan += `- Keep the day light and stay close to hotel/airport route.\n`;
        plan += `- Check baggage, passport/ID, medicines, chargers and shopping items.\n`;
        plan += `- Start early for airport/railway station.\n`;
        plan += `- Review expenses and save important receipts.\n\n`;
      } else {
        plan += `Day ${i}: Sightseeing & Local Experience\n`;
        plan += `- Visit 2 to 3 important attractions at a comfortable pace.\n`;
        plan += `- Add rest breaks if travelling with family or senior citizens.\n`;
        plan += `- Use translator, food finder, currency converter and expense tracker.\n`;
        plan += `- Keep evening flexible for shopping or local food.\n\n`;
      }
    }

    plan += `Packing Reminder:\n`;
    plan += `Passport/ID, tickets, hotel voucher, medicines, charger, power bank, weather-based clothes and emergency contact details.\n\n`;

    plan += `Safety Reminder:\n`;
    plan += `Save hotel address, emergency numbers, family contact and offline documents before travel.\n\n`;

    plan += `Note: This is the rule-based MVP. Later we will connect OpenAI/Gemini API for richer personalized itineraries.`;

    const trips = readJson(files.trips);
    const newTrip = {
      id: Date.now(),
      fromCity: fromCity || "",
      destination,
      days: tripDays,
      travellers: numTravellers,
      travelType: travelType || "",
      budgetStyle: budgetStyle || "",
      foodPref: foodPref || "",
      specialNeeds: specialNeeds || "",
      plan,
      createdAt: new Date().toISOString()
    };

    trips.push(newTrip);
    writeJson(files.trips, trips);

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

app.post("/api/budget", (req, res) => {
  try {
    const {
      destination,
      travellers,
      hotelCost,
      nights,
      foodCost,
      transportCost,
      ticketCost,
      shoppingCost
    } = req.body;

    if (!destination) {
      return res.status(400).json({
        success: false,
        message: "Destination is required."
      });
    }

    const numTravellers = Number(travellers) || 1;
    const numHotelCost = Number(hotelCost) || 0;
    const numNights = Number(nights) || 0;
    const numFoodCost = Number(foodCost) || 0;
    const numTransportCost = Number(transportCost) || 0;
    const numTicketCost = Number(ticketCost) || 0;
    const numShoppingCost = Number(shoppingCost) || 0;

    const hotelTotal = numHotelCost * numNights;
    const foodTotal = numFoodCost * (numNights + 1) * numTravellers;
    const subtotal = hotelTotal + foodTotal + numTransportCost + numTicketCost + numShoppingCost;
    const emergencyBuffer = subtotal * 0.12;
    const grandTotal = subtotal + emergencyBuffer;
    const perPerson = grandTotal / numTravellers;

    const budgetSummary =
`MyYatraMate Budget Estimate

Destination: ${destination}
Travellers: ${numTravellers}
Nights: ${numNights}

Hotel Total: ₹${hotelTotal.toLocaleString("en-IN")}
Food Total: ₹${foodTotal.toLocaleString("en-IN")}
Local Transport: ₹${numTransportCost.toLocaleString("en-IN")}
Sightseeing / Tickets: ₹${numTicketCost.toLocaleString("en-IN")}
Shopping Buffer: ₹${numShoppingCost.toLocaleString("en-IN")}
Emergency Buffer 12%: ₹${Math.round(emergencyBuffer).toLocaleString("en-IN")}

Estimated Total Budget: ₹${Math.round(grandTotal).toLocaleString("en-IN")}
Approx Cost Per Person: ₹${Math.round(perPerson).toLocaleString("en-IN")}

Note:
This is a practical estimate. Actual cost may vary based on travel dates, hotel category, exchange rate, local transport and personal shopping.`;

    const budgets = readJson(files.budgets);
    const newBudget = {
      id: Date.now(),
      destination,
      travellers: numTravellers,
      hotelCost: numHotelCost,
      nights: numNights,
      foodCost: numFoodCost,
      transportCost: numTransportCost,
      ticketCost: numTicketCost,
      shoppingCost: numShoppingCost,
      hotelTotal,
      foodTotal,
      emergencyBuffer,
      grandTotal,
      perPerson,
      budgetSummary,
      createdAt: new Date().toISOString()
    };

    budgets.push(newBudget);
    writeJson(files.budgets, budgets);

    res.json({
      success: true,
      message: "Budget calculated successfully.",
      budget: newBudget
    });
  } catch (error) {
    console.error("Budget error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to calculate budget."
    });
  }
});

app.post("/api/expense", (req, res) => {
  try {
    const { tripName, category, amount, currency, note } = req.body;

    if (!category || !amount) {
      return res.status(400).json({
        success: false,
        message: "Category and amount are required."
      });
    }

    const expenses = readJson(files.expenses);
    const newExpense = {
      id: Date.now(),
      tripName: String(tripName || "General Trip").trim(),
      category: String(category).trim(),
      amount: Number(amount) || 0,
      currency: String(currency || "INR").trim(),
      note: String(note || "").trim(),
      createdAt: new Date().toISOString()
    };

    expenses.push(newExpense);
    writeJson(files.expenses, expenses);

    const tripExpenses = expenses.filter((item) => item.tripName === newExpense.tripName);
    const total = tripExpenses.reduce((sum, item) => sum + Number(item.amount || 0), 0);

    res.json({
      success: true,
      message: "Expense saved successfully.",
      expense: newExpense,
      tripTotal: total,
      tripExpenses
    });
  } catch (error) {
    console.error("Expense error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to save expense."
    });
  }
});

app.get("/api/expenses", (req, res) => {
  const tripName = req.query.tripName;
  const expenses = readJson(files.expenses);
  const filtered = tripName ? expenses.filter((item) => item.tripName === tripName) : expenses;
  res.json({ success: true, expenses: filtered });
});

// ---------------------------
// Admin pages
// ---------------------------
app.get("/admin", (req, res) => {
  if (!adminAllowed(req)) return res.send(adminAuthPage());

  const pin = encodeURIComponent(req.query.pin);
  const body = `
    <h1>MyYatraMate Admin Dashboard</h1>
    <div class="nav">
      <a href="/admin/leads?pin=${pin}">Early Access Leads</a>
      <a href="/admin/trips?pin=${pin}">Trip Plans</a>
      <a href="/admin/budgets?pin=${pin}">Budget Estimates</a>
      <a href="/admin/expenses?pin=${pin}">Expenses</a>
      <a href="/health">Health Check</a>
    </div>
    <div class="card">
      <h2>Admin Status</h2>
      <p>The MVP admin pages are working. This is protected with a temporary PIN.</p>
      <p><strong>Next upgrade:</strong> proper username/password login and MySQL database.</p>
    </div>
  `;
  res.send(adminShell("MyYatraMate Admin", body));
});

app.get("/admin/leads", (req, res) => {
  if (!adminAllowed(req)) return res.send(adminAuthPage());
  const pin = encodeURIComponent(req.query.pin);
  const leads = readJson(files.leads);

  let rows = leads.map((lead, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(lead.name)}</td>
      <td>${escapeHtml(lead.email)}</td>
      <td>${escapeHtml(lead.phone)}</td>
      <td>${escapeHtml(lead.travellerType)}</td>
      <td>${new Date(lead.createdAt).toLocaleString()}</td>
    </tr>
  `).join("");

  if (!rows) {
    rows = `<tr><td colspan="6">No early access leads yet.</td></tr>`;
  }

  const body = `
    <h1>MyYatraMate Early Access Leads</h1>
    <div class="nav">
      <a href="/admin?pin=${pin}">Admin Home</a>
      <a href="/admin/trips?pin=${pin}">Trip Plans</a>
      <a href="/admin/budgets?pin=${pin}">Budgets</a>
      <a href="/admin/expenses?pin=${pin}">Expenses</a>
    </div>
    <table>
      <thead>
        <tr><th>S.No</th><th>Name</th><th>Email</th><th>Phone</th><th>Traveller Type</th><th>Date</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  res.send(adminShell("MyYatraMate Leads", body));
});

app.get("/admin/trips", (req, res) => {
  if (!adminAllowed(req)) return res.send(adminAuthPage());
  const pin = encodeURIComponent(req.query.pin);
  const trips = readJson(files.trips).reverse();

  let cards = trips.map((trip, index) => `
    <div class="card">
      <h2>${index + 1}. ${escapeHtml(trip.destination)} - ${escapeHtml(trip.days)} Days</h2>
      <div class="meta">
        From: ${escapeHtml(trip.fromCity || "-")} |
        Travellers: ${escapeHtml(trip.travellers || "-")} |
        Type: ${escapeHtml(trip.travelType)} |
        Budget: ${escapeHtml(trip.budgetStyle)} |
        Food: ${escapeHtml(trip.foodPref)} |
        Date: ${new Date(trip.createdAt).toLocaleString()}
      </div>
      <pre>${escapeHtml(trip.plan)}</pre>
    </div>
  `).join("");

  if (!cards) cards = `<p>No trip plans generated yet.</p>`;

  const body = `
    <h1>MyYatraMate Generated Trip Plans</h1>
    <div class="nav">
      <a href="/admin?pin=${pin}">Admin Home</a>
      <a href="/admin/leads?pin=${pin}">Leads</a>
      <a href="/admin/budgets?pin=${pin}">Budgets</a>
      <a href="/admin/expenses?pin=${pin}">Expenses</a>
    </div>
    ${cards}
  `;

  res.send(adminShell("MyYatraMate Trip Plans", body));
});

app.get("/admin/budgets", (req, res) => {
  if (!adminAllowed(req)) return res.send(adminAuthPage());
  const pin = encodeURIComponent(req.query.pin);
  const budgets = readJson(files.budgets).reverse();

  let cards = budgets.map((budget, index) => `
    <div class="card">
      <h2>${index + 1}. ${escapeHtml(budget.destination)}</h2>
      <div class="meta">
        Travellers: ${escapeHtml(budget.travellers)} |
        Nights: ${escapeHtml(budget.nights)} |
        Total: ₹${Math.round(budget.grandTotal).toLocaleString("en-IN")} |
        Per Person: ₹${Math.round(budget.perPerson).toLocaleString("en-IN")} |
        Date: ${new Date(budget.createdAt).toLocaleString()}
      </div>
      <pre>${escapeHtml(budget.budgetSummary)}</pre>
    </div>
  `).join("");

  if (!cards) cards = `<p>No budget estimates generated yet.</p>`;

  const body = `
    <h1>MyYatraMate Budget Estimates</h1>
    <div class="nav">
      <a href="/admin?pin=${pin}">Admin Home</a>
      <a href="/admin/leads?pin=${pin}">Leads</a>
      <a href="/admin/trips?pin=${pin}">Trips</a>
      <a href="/admin/expenses?pin=${pin}">Expenses</a>
    </div>
    ${cards}
  `;

  res.send(adminShell("MyYatraMate Budget Estimates", body));
});

app.get("/admin/expenses", (req, res) => {
  if (!adminAllowed(req)) return res.send(adminAuthPage());
  const pin = encodeURIComponent(req.query.pin);
  const expenses = readJson(files.expenses).reverse();

  let rows = expenses.map((expense, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(expense.tripName)}</td>
      <td>${escapeHtml(expense.category)}</td>
      <td>${escapeHtml(expense.currency)}</td>
      <td>${Number(expense.amount || 0).toLocaleString("en-IN")}</td>
      <td>${escapeHtml(expense.note)}</td>
      <td>${new Date(expense.createdAt).toLocaleString()}</td>
    </tr>
  `).join("");

  if (!rows) {
    rows = `<tr><td colspan="7">No expenses added yet.</td></tr>`;
  }

  const body = `
    <h1>MyYatraMate Expenses</h1>
    <div class="nav">
      <a href="/admin?pin=${pin}">Admin Home</a>
      <a href="/admin/leads?pin=${pin}">Leads</a>
      <a href="/admin/trips?pin=${pin}">Trips</a>
      <a href="/admin/budgets?pin=${pin}">Budgets</a>
    </div>
    <table>
      <thead>
        <tr><th>S.No</th><th>Trip</th><th>Category</th><th>Currency</th><th>Amount</th><th>Note</th><th>Date</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  res.send(adminShell("MyYatraMate Expenses", body));
});

app.listen(PORT, () => {
  console.log(`MyYatraMate server running on port ${PORT}`);
});
