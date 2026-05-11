const express = require("express");
const path = require("path");
const mysql = require("mysql2/promise");

const app = express();
const PORT = process.env.PORT || 3000;

// Admin PIN from Hostinger Environment Variables
const ADMIN_PIN = process.env.ADMIN_PIN || "1234";

// MySQL credentials from Hostinger Environment Variables
const DB_HOST = process.env.DB_HOST || "localhost";
const DB_USER = process.env.DB_USER || "";
const DB_PASSWORD = process.env.DB_PASSWORD || "";
const DB_NAME = process.env.DB_NAME || "";

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

let pool;

async function initDatabase() {
  if (!DB_USER || !DB_NAME) {
    throw new Error("DB_USER and DB_NAME environment variables are required.");
  }

  pool = mysql.createPool({
    host: DB_HOST,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS early_access_leads (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(150) NOT NULL,
      email VARCHAR(180) NOT NULL,
      phone VARCHAR(50),
      traveller_type VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS trip_plans (
      id INT AUTO_INCREMENT PRIMARY KEY,
      from_city VARCHAR(150),
      destination VARCHAR(150) NOT NULL,
      days INT,
      travellers INT,
      travel_type VARCHAR(100),
      budget_style VARCHAR(100),
      food_pref VARCHAR(100),
      special_needs TEXT,
      plan LONGTEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS budgets (
      id INT AUTO_INCREMENT PRIMARY KEY,
      destination VARCHAR(150) NOT NULL,
      travellers INT,
      hotel_cost DECIMAL(12,2),
      nights INT,
      food_cost DECIMAL(12,2),
      transport_cost DECIMAL(12,2),
      ticket_cost DECIMAL(12,2),
      shopping_cost DECIMAL(12,2),
      hotel_total DECIMAL(12,2),
      food_total DECIMAL(12,2),
      emergency_buffer DECIMAL(12,2),
      grand_total DECIMAL(12,2),
      per_person DECIMAL(12,2),
      budget_summary LONGTEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS expenses (
      id INT AUTO_INCREMENT PRIMARY KEY,
      trip_name VARCHAR(180),
      category VARCHAR(100),
      amount DECIMAL(12,2),
      currency VARCHAR(20),
      note TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log("MySQL database initialized successfully.");
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
        body { font-family: Arial, sans-serif; margin: 0; padding: 30px; background: #f1f5f9; color: #0f172a; }
        h1 { color: #071a33; margin-top: 0; }
        a { color: #0f4c81; font-weight: bold; }
        .nav { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 24px; }
        .nav a { background: white; border: 1px solid #e2e8f0; padding: 10px 14px; border-radius: 999px; text-decoration: none; }
        .card { background: white; border: 1px solid #e2e8f0; border-radius: 18px; padding: 20px; margin-bottom: 18px; }
        .meta { color: #64748b; margin-bottom: 12px; line-height: 1.6; }
        table { width: 100%; border-collapse: collapse; background: white; border-radius: 14px; overflow: hidden; }
        th, td { padding: 12px; border: 1px solid #e2e8f0; text-align: left; vertical-align: top; }
        th { background: #071a33; color: white; }
        pre { white-space: pre-wrap; line-height: 1.6; background: #f8fafc; padding: 16px; border-radius: 12px; overflow-x: auto; }
        .warning { background: #fff7ed; border: 1px solid #fed7aa; padding: 16px; border-radius: 14px; color: #9a3412; margin-bottom: 18px; }
        @media(max-width: 700px) { body { padding: 16px; } table { font-size: 13px; } }
      </style>
    </head>
    <body>${body}</body>
    </html>
  `;
}

function adminAuthPage() {
  return adminShell("MyYatraMate Admin", `
    <h1>MyYatraMate Admin</h1>
    <div class="warning">
      Enter admin PIN in the URL to view data.<br><br>
      Example: <strong>/admin?pin=1234</strong>
    </div>
    <p>This is temporary protection for the MVP. Later we will add proper admin login.</p>
  `);
}

// Public routes
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/app", (req, res) => res.sendFile(path.join(__dirname, "public", "app.html")));

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({
      status: "ok",
      app: "MyYatraMate",
      database: "connected",
      message: "Server and MySQL are running",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      app: "MyYatraMate",
      database: "not connected",
      message: error.message
    });
  }
});

// API: Early Access
app.post("/api/early-access", async (req, res) => {
  try {
    const { name, email, phone, travellerType } = req.body;

    if (!name || !email) {
      return res.status(400).json({ success: false, message: "Name and email are required." });
    }

    const [result] = await pool.query(
      `INSERT INTO early_access_leads (name, email, phone, traveller_type) VALUES (?, ?, ?, ?)`,
      [String(name).trim(), String(email).trim(), String(phone || "").trim(), String(travellerType || "").trim()]
    );

    res.json({
      success: true,
      message: "Early access request saved successfully.",
      lead: { id: result.insertId, name, email, phone, travellerType }
    });
  } catch (error) {
    console.error("Early access error:", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// API: Trip Planner
app.post("/api/trip-plan", async (req, res) => {
  try {
    const { fromCity, destination, days, travellers, travelType, budgetStyle, foodPref, specialNeeds } = req.body;

    if (!destination || !days) {
      return res.status(400).json({ success: false, message: "Destination and number of days are required." });
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

    const [result] = await pool.query(
      `INSERT INTO trip_plans (from_city, destination, days, travellers, travel_type, budget_style, food_pref, special_needs, plan)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [fromCity || "", destination, tripDays, numTravellers, travelType || "", budgetStyle || "", foodPref || "", specialNeeds || "", plan]
    );

    res.json({
      success: true,
      message: "Trip plan generated successfully.",
      trip: { id: result.insertId, fromCity, destination, days: tripDays, travellers: numTravellers, travelType, budgetStyle, foodPref, specialNeeds, plan }
    });
  } catch (error) {
    console.error("Trip plan error:", error);
    res.status(500).json({ success: false, message: "Unable to generate trip plan." });
  }
});

// API: Budget
app.post("/api/budget", async (req, res) => {
  try {
    const { destination, travellers, hotelCost, nights, foodCost, transportCost, ticketCost, shoppingCost } = req.body;

    if (!destination) {
      return res.status(400).json({ success: false, message: "Destination is required." });
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

    const [result] = await pool.query(
      `INSERT INTO budgets
       (destination, travellers, hotel_cost, nights, food_cost, transport_cost, ticket_cost, shopping_cost, hotel_total, food_total, emergency_buffer, grand_total, per_person, budget_summary)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [destination, numTravellers, numHotelCost, numNights, numFoodCost, numTransportCost, numTicketCost, numShoppingCost, hotelTotal, foodTotal, emergencyBuffer, grandTotal, perPerson, budgetSummary]
    );

    res.json({
      success: true,
      message: "Budget calculated successfully.",
      budget: { id: result.insertId, destination, travellers: numTravellers, hotelCost: numHotelCost, nights: numNights, foodCost: numFoodCost, transportCost: numTransportCost, ticketCost: numTicketCost, shoppingCost: numShoppingCost, hotelTotal, foodTotal, emergencyBuffer, grandTotal, perPerson, budgetSummary }
    });
  } catch (error) {
    console.error("Budget error:", error);
    res.status(500).json({ success: false, message: "Unable to calculate budget." });
  }
});

// API: Expense
app.post("/api/expense", async (req, res) => {
  try {
    const { tripName, category, amount, currency, note } = req.body;

    if (!category || !amount) {
      return res.status(400).json({ success: false, message: "Category and amount are required." });
    }

    const cleanTripName = String(tripName || "General Trip").trim();
    const cleanCurrency = String(currency || "INR").trim();
    const numAmount = Number(amount) || 0;

    const [result] = await pool.query(
      `INSERT INTO expenses (trip_name, category, amount, currency, note) VALUES (?, ?, ?, ?, ?)`,
      [cleanTripName, String(category).trim(), numAmount, cleanCurrency, String(note || "").trim()]
    );

    const [tripExpenses] = await pool.query(
      `SELECT id, trip_name AS tripName, category, amount, currency, note, created_at AS createdAt
       FROM expenses WHERE trip_name = ? ORDER BY id ASC`,
      [cleanTripName]
    );

    const tripTotal = tripExpenses.reduce((sum, item) => sum + Number(item.amount || 0), 0);

    res.json({
      success: true,
      message: "Expense saved successfully.",
      expense: { id: result.insertId, tripName: cleanTripName, category, amount: numAmount, currency: cleanCurrency, note },
      tripTotal,
      tripExpenses
    });
  } catch (error) {
    console.error("Expense error:", error);
    res.status(500).json({ success: false, message: "Unable to save expense." });
  }
});

// Admin pages
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
      <p>The MVP admin pages are working with MySQL database.</p>
      <p><strong>Next upgrade:</strong> proper username/password login and user accounts.</p>
    </div>
  `;
  res.send(adminShell("MyYatraMate Admin", body));
});

app.get("/admin/leads", async (req, res) => {
  if (!adminAllowed(req)) return res.send(adminAuthPage());
  const pin = encodeURIComponent(req.query.pin);
  const [leads] = await pool.query(`SELECT * FROM early_access_leads ORDER BY id DESC`);

  const rows = leads.length
    ? leads.map((lead, index) => `
      <tr><td>${index + 1}</td><td>${escapeHtml(lead.name)}</td><td>${escapeHtml(lead.email)}</td><td>${escapeHtml(lead.phone)}</td><td>${escapeHtml(lead.traveller_type)}</td><td>${new Date(lead.created_at).toLocaleString()}</td></tr>
    `).join("")
    : `<tr><td colspan="6">No early access leads yet.</td></tr>`;

  res.send(adminShell("MyYatraMate Leads", `
    <h1>MyYatraMate Early Access Leads</h1>
    <div class="nav">
      <a href="/admin?pin=${pin}">Admin Home</a>
      <a href="/admin/trips?pin=${pin}">Trip Plans</a>
      <a href="/admin/budgets?pin=${pin}">Budgets</a>
      <a href="/admin/expenses?pin=${pin}">Expenses</a>
    </div>
    <table><thead><tr><th>S.No</th><th>Name</th><th>Email</th><th>Phone</th><th>Traveller Type</th><th>Date</th></tr></thead><tbody>${rows}</tbody></table>
  `));
});

app.get("/admin/trips", async (req, res) => {
  if (!adminAllowed(req)) return res.send(adminAuthPage());
  const pin = encodeURIComponent(req.query.pin);
  const [trips] = await pool.query(`SELECT * FROM trip_plans ORDER BY id DESC`);

  const cards = trips.length
    ? trips.map((trip, index) => `
      <div class="card">
        <h2>${index + 1}. ${escapeHtml(trip.destination)} - ${escapeHtml(trip.days)} Days</h2>
        <div class="meta">
          From: ${escapeHtml(trip.from_city || "-")} |
          Travellers: ${escapeHtml(trip.travellers || "-")} |
          Type: ${escapeHtml(trip.travel_type)} |
          Budget: ${escapeHtml(trip.budget_style)} |
          Food: ${escapeHtml(trip.food_pref)} |
          Date: ${new Date(trip.created_at).toLocaleString()}
        </div>
        <pre>${escapeHtml(trip.plan)}</pre>
      </div>
    `).join("")
    : `<p>No trip plans generated yet.</p>`;

  res.send(adminShell("MyYatraMate Trip Plans", `
    <h1>MyYatraMate Generated Trip Plans</h1>
    <div class="nav">
      <a href="/admin?pin=${pin}">Admin Home</a>
      <a href="/admin/leads?pin=${pin}">Leads</a>
      <a href="/admin/budgets?pin=${pin}">Budgets</a>
      <a href="/admin/expenses?pin=${pin}">Expenses</a>
    </div>
    ${cards}
  `));
});

app.get("/admin/budgets", async (req, res) => {
  if (!adminAllowed(req)) return res.send(adminAuthPage());
  const pin = encodeURIComponent(req.query.pin);
  const [budgets] = await pool.query(`SELECT * FROM budgets ORDER BY id DESC`);

  const cards = budgets.length
    ? budgets.map((budget, index) => `
      <div class="card">
        <h2>${index + 1}. ${escapeHtml(budget.destination)}</h2>
        <div class="meta">
          Travellers: ${escapeHtml(budget.travellers)} |
          Nights: ${escapeHtml(budget.nights)} |
          Total: ₹${Math.round(Number(budget.grand_total || 0)).toLocaleString("en-IN")} |
          Per Person: ₹${Math.round(Number(budget.per_person || 0)).toLocaleString("en-IN")} |
          Date: ${new Date(budget.created_at).toLocaleString()}
        </div>
        <pre>${escapeHtml(budget.budget_summary)}</pre>
      </div>
    `).join("")
    : `<p>No budget estimates generated yet.</p>`;

  res.send(adminShell("MyYatraMate Budget Estimates", `
    <h1>MyYatraMate Budget Estimates</h1>
    <div class="nav">
      <a href="/admin?pin=${pin}">Admin Home</a>
      <a href="/admin/leads?pin=${pin}">Leads</a>
      <a href="/admin/trips?pin=${pin}">Trips</a>
      <a href="/admin/expenses?pin=${pin}">Expenses</a>
    </div>
    ${cards}
  `));
});

app.get("/admin/expenses", async (req, res) => {
  if (!adminAllowed(req)) return res.send(adminAuthPage());
  const pin = encodeURIComponent(req.query.pin);
  const [expenses] = await pool.query(`SELECT * FROM expenses ORDER BY id DESC`);

  const rows = expenses.length
    ? expenses.map((expense, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(expense.trip_name)}</td>
        <td>${escapeHtml(expense.category)}</td>
        <td>${escapeHtml(expense.currency)}</td>
        <td>${Number(expense.amount || 0).toLocaleString("en-IN")}</td>
        <td>${escapeHtml(expense.note)}</td>
        <td>${new Date(expense.created_at).toLocaleString()}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="7">No expenses added yet.</td></tr>`;

  res.send(adminShell("MyYatraMate Expenses", `
    <h1>MyYatraMate Expenses</h1>
    <div class="nav">
      <a href="/admin?pin=${pin}">Admin Home</a>
      <a href="/admin/leads?pin=${pin}">Leads</a>
      <a href="/admin/trips?pin=${pin}">Trips</a>
      <a href="/admin/budgets?pin=${pin}">Budgets</a>
    </div>
    <table><thead><tr><th>S.No</th><th>Trip</th><th>Category</th><th>Currency</th><th>Amount</th><th>Note</th><th>Date</th></tr></thead><tbody>${rows}</tbody></table>
  `));
});

initDatabase()
  .then(() => {
    app.listen(PORT, () => console.log(`MyYatraMate server running on port ${PORT}`));
  })
  .catch((error) => {
    console.error("Failed to initialize MySQL database:", error);
    process.exit(1);
  });
