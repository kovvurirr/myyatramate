const express = require("express");
const path = require("path");
const mysql = require("mysql2/promise");
const session = require("express-session");
const bcrypt = require("bcryptjs");

const app = express();
const PORT = process.env.PORT || 3000;

// Admin credentials from Hostinger Environment Variables
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const SESSION_SECRET = process.env.SESSION_SECRET || "myyatramate-change-this-secret";

// MySQL credentials from Hostinger Environment Variables
const DB_HOST = process.env.DB_HOST || "localhost";
const DB_USER = process.env.DB_USER || "";
const DB_PASSWORD = process.env.DB_PASSWORD || "";
const DB_NAME = process.env.DB_NAME || "";

// Gemini AI settings
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));

app.use(express.static(path.join(__dirname, "public")));

let pool;

async function columnExists(tableName, columnName) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS count
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [DB_NAME, tableName, columnName]
  );
  return Number(rows[0].count) > 0;
}

async function addColumnIfMissing(tableName, columnName, definition) {
  const exists = await columnExists(tableName, columnName);
  if (!exists) {
    await pool.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}


async function ensureProfileAndTripColumns() {
  await addColumnIfMissing("users", "phone", "VARCHAR(50) NULL");
  await addColumnIfMissing("users", "home_city", "VARCHAR(120) NULL");
  await addColumnIfMissing("users", "preferred_food", "VARCHAR(120) NULL");
  await addColumnIfMissing("users", "travel_style", "VARCHAR(120) NULL");

  await addColumnIfMissing("trip_plans", "trip_status", "VARCHAR(50) DEFAULT 'Upcoming'");
  await addColumnIfMissing("trip_plans", "is_favourite", "TINYINT(1) DEFAULT 0");
}



async function ensureAIBudgetColumns() {
  await addColumnIfMissing("budgets", "trip_plan_text", "LONGTEXT NULL");
  await addColumnIfMissing("budgets", "travel_mode", "VARCHAR(80) NULL");
  await addColumnIfMissing("budgets", "hotel_category", "VARCHAR(80) NULL");
  await addColumnIfMissing("budgets", "local_transport_mode", "VARCHAR(80) NULL");
  await addColumnIfMissing("budgets", "shopping_budget", "DECIMAL(12,2) DEFAULT 0");
  await addColumnIfMissing("budgets", "ai_budget_json", "LONGTEXT NULL");
  await addColumnIfMissing("budgets", "ai_budget_source", "VARCHAR(80) NULL");
}



async function ensureTripDateColumns() {
  await addColumnIfMissing("trip_plans", "departure_date", "VARCHAR(40) NULL");
  await addColumnIfMissing("trip_plans", "return_date", "VARCHAR(40) NULL");
}



async function ensureVisaChecklistTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS visa_checklists (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NULL,
      guest_id VARCHAR(100) NULL,
      passport_country VARCHAR(120) NULL,
      destination VARCHAR(120) NOT NULL,
      travel_purpose VARCHAR(80) NULL,
      departure_date VARCHAR(40) NULL,
      return_date VARCHAR(40) NULL,
      checklist_json LONGTEXT NULL,
      passport_expiry VARCHAR(40) NULL,
      visa_expiry VARCHAR(40) NULL,
      uploaded_docs LONGTEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Existing installations may already have visa_checklists table without this new column.
  await addColumnIfMissing("visa_checklists", "passport_country", "VARCHAR(120) NULL");
  await addColumnIfMissing("visa_checklists", "trip_id", "INT NULL");
}



async function ensureTravelDocumentVaultTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS travel_document_vault (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NULL,
      guest_id VARCHAR(100) NULL,
      profile_name VARCHAR(120) NOT NULL,
      relation VARCHAR(80) NULL,
      document_type VARCHAR(120) NOT NULL,
      document_name VARCHAR(255) NOT NULL,
      document_number VARCHAR(160) NULL,
      traveller_name VARCHAR(160) NULL,
      airline VARCHAR(160) NULL,
      flight_number VARCHAR(80) NULL,
      from_airport VARCHAR(120) NULL,
      to_airport VARCHAR(120) NULL,
      travel_datetime VARCHAR(80) NULL,
      seat_number VARCHAR(40) NULL,
      gate_number VARCHAR(40) NULL,
      boarding_time VARCHAR(80) NULL,
      issue_date VARCHAR(40) NULL,
      expiry_date VARCHAR(40) NULL,
      notes TEXT NULL,
      file_name VARCHAR(255) NULL,
      file_type VARCHAR(120) NULL,
      file_size BIGINT NULL,
      file_data LONGTEXT NULL,
      is_offline_ready TINYINT DEFAULT 1,
      is_family_document TINYINT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await addColumnIfMissing("travel_document_vault", "traveller_name", "VARCHAR(160) NULL");
  await addColumnIfMissing("travel_document_vault", "airline", "VARCHAR(160) NULL");
  await addColumnIfMissing("travel_document_vault", "flight_number", "VARCHAR(80) NULL");
  await addColumnIfMissing("travel_document_vault", "from_airport", "VARCHAR(120) NULL");
  await addColumnIfMissing("travel_document_vault", "to_airport", "VARCHAR(120) NULL");
  await addColumnIfMissing("travel_document_vault", "travel_datetime", "VARCHAR(80) NULL");
  await addColumnIfMissing("travel_document_vault", "seat_number", "VARCHAR(40) NULL");
  await addColumnIfMissing("travel_document_vault", "gate_number", "VARCHAR(40) NULL");
  await addColumnIfMissing("travel_document_vault", "boarding_time", "VARCHAR(80) NULL");
  await addColumnIfMissing("travel_document_vault", "trip_id", "INT NULL");
}



async function ensureAITravelChatTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_travel_chat_history (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NULL,
      guest_id VARCHAR(100) NULL,
      question TEXT NOT NULL,
      answer LONGTEXT NOT NULL,
      context_json LONGTEXT NULL,
      source VARCHAR(80) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}



async function ensureTripLinkedTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS packing_checklists (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NULL,
      guest_id VARCHAR(100) NULL,
      trip_id INT NULL,
      destination VARCHAR(150) NULL,
      checklist_json LONGTEXT NULL,
      source VARCHAR(80) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS local_transport_guides (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NULL,
      guest_id VARCHAR(100) NULL,
      trip_id INT NULL,
      destination VARCHAR(150) NULL,
      guide_json LONGTEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}


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
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(150) NOT NULL,
      email VARCHAR(180) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

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

  // Add user/guest tracking columns to existing tables if missing.
  await addColumnIfMissing("trip_plans", "user_id", "INT NULL");
  await addColumnIfMissing("trip_plans", "guest_id", "VARCHAR(100) NULL");
  await addColumnIfMissing("budgets", "user_id", "INT NULL");
  await addColumnIfMissing("budgets", "guest_id", "VARCHAR(100) NULL");
  await addColumnIfMissing("budgets", "trip_id", "INT NULL");
  await addColumnIfMissing("expenses", "user_id", "INT NULL");
  await addColumnIfMissing("expenses", "guest_id", "VARCHAR(100) NULL");

  await ensureProfileAndTripColumns();
  await ensureAIBudgetColumns();
  await ensureTripDateColumns();
  await ensureVisaChecklistTables();
  await ensureTravelDocumentVaultTables();
  await ensureAITravelChatTables();
  await ensureTripLinkedTables();

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

function isAdminLoggedIn(req) {
  return req.session && req.session.isAdmin === true;
}

function requireAdmin(req, res, next) {
  if (!isAdminLoggedIn(req)) {
    return res.redirect("/admin-login");
  }
  next();
}

function requireUserOrGuest(req, res, next) {
  if (req.session.user || req.session.guestId) {
    return next();
  }
  return res.status(401).json({ success: false, message: "Please login or continue as guest." });
}

function getSessionOwner(req) {
  return {
    userId: req.session.user ? req.session.user.id : null,
    guestId: req.session.guestId || null
  };
}

function pageShell(title, body) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>${escapeHtml(title)}</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <style>
        * { box-sizing: border-box; }
        body { font-family: Arial, sans-serif; margin: 0; padding: 30px; background: #f1f5f9; color: #0f172a; }
        h1 { color: #071a33; margin-top: 0; }
        a { color: #0f4c81; font-weight: bold; }
        .nav { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 24px; }
        .nav a, .nav form button {
          background: white; border: 1px solid #e2e8f0; padding: 10px 14px; border-radius: 999px;
          text-decoration: none; color: #0f4c81; font-weight: bold; cursor: pointer; font-size: 16px;
        }
        .card { background: white; border: 1px solid #e2e8f0; border-radius: 18px; padding: 20px; margin-bottom: 18px; }
        .meta { color: #64748b; margin-bottom: 12px; line-height: 1.6; }
        table { width: 100%; border-collapse: collapse; background: white; border-radius: 14px; overflow: hidden; }
        th, td { padding: 12px; border: 1px solid #e2e8f0; text-align: left; vertical-align: top; }
        th { background: #071a33; color: white; }
        pre { white-space: pre-wrap; line-height: 1.6; background: #f8fafc; padding: 16px; border-radius: 12px; overflow-x: auto; }
        .login-wrap { min-height: calc(100vh - 60px); display: grid; place-items: center; }
        .login-card {
          width: min(440px, 100%); background: white; border: 1px solid #e2e8f0; border-radius: 24px; padding: 30px;
          box-shadow: 0 18px 50px rgba(15, 23, 42, 0.12);
        }
        .login-card h1 { margin-bottom: 8px; }
        .login-card p { color: #64748b; line-height: 1.6; }
        .form-group { display: grid; gap: 8px; margin-bottom: 14px; }
        label { font-weight: 700; color: #334155; }
        input { width: 100%; padding: 14px 15px; border: 1px solid #e2e8f0; border-radius: 14px; font-size: 15px; }
        .primary-btn { width: 100%; border: none; border-radius: 999px; padding: 14px 20px; background: #f97316; color: white; font-weight: 800; font-size: 16px; cursor: pointer; margin-top: 8px; }
        .error { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; padding: 12px; border-radius: 12px; margin-bottom: 14px; }
        @media(max-width: 700px) { body { padding: 16px; } table { font-size: 13px; } }
      </style>
    </head>
    <body>${body}</body>
    </html>
  `;
}

function adminNav() {
  return `
    <div class="nav">
      <a href="/admin">Admin Home</a>
      <a href="/admin/users">Users</a>
      <a href="/admin/leads">Early Access Leads</a>
      <a href="/admin/trips">Trip Plans</a>
      <a href="/admin/budgets">Budget Estimates</a>
      <a href="/admin/expenses">Expenses</a>
      <a href="/health">Health Check</a>
      <form method="POST" action="/admin-logout" style="margin:0;"><button type="submit">Logout</button></form>
    </div>
  `;
}


function buildRuleBasedTripPlan({ fromCity, destination, tripDays, numTravellers, travelType, budgetStyle, foodPref, specialNeeds }) {
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
  plan += `Note: This is the rule-based fallback plan.`;

  return plan;
}

async function generateAITripPlan({ fromCity, destination, tripDays, numTravellers, travelType, budgetStyle, foodPref, specialNeeds }) {
  if (!GEMINI_API_KEY) {
    return null;
  }

  const prompt = `
You are MyYatraMate, an AI travel assistant designed especially for Indian travellers.

Create a practical, safe, family-friendly travel itinerary using the details below.

Trip Details:
- From city: ${fromCity || "Not specified"}
- Destination: ${destination}
- Duration: ${tripDays} days\n- Departure date: ${departureDate || "Not specified"}\n- Return date: ${returnDate || "Not specified"}
- Travellers: ${numTravellers}
- Travel type: ${travelType || "General Trip"}
- Budget style: ${budgetStyle || "Comfort"}
- Food preference: ${foodPref || "No Preference"}
- Special needs: ${specialNeeds || "None"}

Output format:
1. Start with a short trip summary.
2. Give a day-wise itinerary for each day.
3. Include after-landing guidance.
4. Include food guidance suitable for the stated food preference.
5. Include local transport guidance.
6. Include safety tips.
7. Include packing reminders.
8. Include estimated daily pacing: light/moderate/heavy.
9. Include a final "MyYatraMate Tips" section.

Important rules:
- Be realistic and practical.
- Avoid unsafe or unverified claims.
- Do not invent exact prices or timings unless stated as approximate.
- Keep the response easy to read.
- Use Indian Rupee symbols only when discussing estimated spending.
`;

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        temperature: 0.7,
        topP: 0.9,
        maxOutputTokens: 4096
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Gemini API error:", response.status, errorText);
    return null;
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("")
    .trim();

  return text || null;
}


// Public routes
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/login", (req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));
app.get("/app", (req, res) => {
  if (!req.session.user && !req.session.guestId) {
    return res.redirect("/login.html");
  }
  res.sendFile(path.join(__dirname, "public", "app.html"));
});

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
    res.status(500).json({ status: "error", app: "MyYatraMate", database: "not connected", message: error.message });
  }
});

// User auth API
app.post("/api/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: "Name, email and password are required." });
    }

    if (String(password).length < 6) {
      return res.status(400).json({ success: false, message: "Password must be at least 6 characters." });
    }

    const [existing] = await pool.query(`SELECT id FROM users WHERE email = ?`, [String(email).trim().toLowerCase()]);
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: "Email already registered. Please login." });
    }

    const passwordHash = await bcrypt.hash(String(password), 10);

    const [result] = await pool.query(
      `INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)`,
      [String(name).trim(), String(email).trim().toLowerCase(), passwordHash]
    );

    req.session.user = {
      id: result.insertId,
      name: String(name).trim(),
      email: String(email).trim().toLowerCase()
    };
    req.session.guestId = null;

    res.json({ success: true, message: "Account created successfully.", user: req.session.user });
  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({ success: false, message: "Unable to register." });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required." });
    }

    const [users] = await pool.query(`SELECT * FROM users WHERE email = ?`, [String(email).trim().toLowerCase()]);

    if (users.length === 0) {
      return res.status(401).json({ success: false, message: "Invalid email or password." });
    }

    const user = users[0];
    const passwordOk = await bcrypt.compare(String(password), user.password_hash);

    if (!passwordOk) {
      return res.status(401).json({ success: false, message: "Invalid email or password." });
    }

    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email
    };
    req.session.guestId = null;

    res.json({ success: true, message: "Login successful.", user: req.session.user });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ success: false, message: "Unable to login." });
  }
});

app.post("/api/guest", (req, res) => {
  req.session.user = null;
  req.session.guestId = "guest_" + Date.now() + "_" + Math.random().toString(36).slice(2, 10);
  res.json({ success: true, message: "Guest session started.", guestId: req.session.guestId });
});

app.post("/api/logout", (req, res) => {
  req.session.user = null;
  req.session.guestId = null;
  res.json({ success: true, message: "Logged out." });
});

app.get("/api/me", (req, res) => {
  res.json({
    loggedIn: !!req.session.user,
    guest: !!req.session.guestId,
    user: req.session.user || null,
    guestId: req.session.guestId || null
  });
});

// Admin login routes
app.get("/admin-login", (req, res) => {
  if (req.session && req.session.isAdmin === true) return res.redirect("/admin");

  const error = req.query.error ? `<div class="error">Invalid username or password.</div>` : "";

  res.send(pageShell("MyYatraMate Admin Login", `
    <div class="login-wrap">
      <form class="login-card" method="POST" action="/admin-login">
        <h1>MyYatraMate Admin</h1>
        <p>Login to view users, leads, trips, budgets and expenses.</p>
        ${error}
        <div class="form-group"><label>Username</label><input type="text" name="username" placeholder="Admin username" required /></div>
        <div class="form-group"><label>Password</label><input type="password" name="password" placeholder="Admin password" required /></div>
        <button class="primary-btn" type="submit">Login</button>
      </form>
    </div>
  `));
});

app.post("/admin-login", (req, res) => {
  const { username, password } = req.body;

  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    req.session.adminUsername = username;
    return res.redirect("/admin");
  }

  return res.redirect("/admin-login?error=1");
});

app.post("/admin-logout", (req, res) => {
  req.session.isAdmin = false;
  req.session.adminUsername = null;
  res.redirect("/admin-login");
});

// API: Early Access
app.post("/api/early-access", async (req, res) => {
  try {
    const { name, email, phone, travellerType } = req.body;

    if (!name || !email) return res.status(400).json({ success: false, message: "Name and email are required." });

    const [result] = await pool.query(
      `INSERT INTO early_access_leads (name, email, phone, traveller_type) VALUES (?, ?, ?, ?)`,
      [String(name).trim(), String(email).trim(), String(phone || "").trim(), String(travellerType || "").trim()]
    );

    res.json({ success: true, message: "Early access request saved successfully.", lead: { id: result.insertId, name, email, phone, travellerType } });
  } catch (error) {
    console.error("Early access error:", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// API: Trip Planner
app.post("/api/trip-plan", requireUserOrGuest, async (req, res) => {
  try {
    const { fromCity, destination, days, travellers, travelType, budgetStyle, foodPref, specialNeeds, departureDate, returnDate } = req.body;

    if (!destination || !days) return res.status(400).json({ success: false, message: "Destination and number of days are required." });

    const tripDays = Math.max(1, Math.min(Number(days) || 3, 30));
    const numTravellers = Number(travellers) || 1;
    const owner = getSessionOwner(req);

    const tripInput = {
      fromCity,
      destination,
      tripDays,
      numTravellers,
      travelType,
      budgetStyle,
      foodPref,
      specialNeeds
    };

    let planSource = "rule-based";
    let plan = null;

    try {
      plan = await generateAITripPlan(tripInput);
      if (plan) {
        planSource = "gemini-ai";
        plan = `MyYatraMate AI Trip Plan

${plan}`;
      }
    } catch (aiError) {
      console.error("AI trip planner failed. Falling back to rule-based plan:", aiError);
      plan = null;
    }

    if (!plan) {
      plan = buildRuleBasedTripPlan(tripInput);
    }

    const [result] = await pool.query(
      `INSERT INTO trip_plans (user_id, guest_id, from_city, destination, days, travellers, travel_type, budget_style, food_pref, special_needs, departure_date, return_date, plan)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [owner.userId, owner.guestId, fromCity || "", destination, tripDays, numTravellers, travelType || "", budgetStyle || "", foodPref || "", specialNeeds || "", departureDate || "", returnDate || "", plan]
    );

    res.json({
      success: true,
      message: planSource === "gemini-ai" ? "AI trip plan generated successfully." : "Fallback trip plan generated successfully.",
      source: planSource,
      trip: { id: result.insertId, fromCity, destination, days: tripDays, travellers: numTravellers, travelType, budgetStyle, foodPref, specialNeeds, plan }
    });
  } catch (error) {
    console.error("Trip plan error:", error);
    res.status(500).json({ success: false, message: "Unable to generate trip plan." });
  }
});


function extractJSONFromText(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/```json/g, "").replace(/```/g, "").trim();
  try { return JSON.parse(cleaned); } catch (e) {}
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try { return JSON.parse(cleaned.slice(first, last + 1)); } catch (e) {}
  }
  return null;
}

function buildFallbackAIBudget(input) {
  const destination = input.destination || "";
  const numDays = Math.max(1, Number(input.days) || 3);
  const numTravellers = Math.max(1, Number(input.travellers) || 1);
  const shopping = Number(input.shoppingBudget) || 0;

  const domesticHints = ["india", "hyderabad", "tirupati", "goa", "delhi", "mumbai", "bangalore", "chennai", "kolkata", "kerala", "jaipur"];
  const isInternational = !domesticHints.some((p) => destination.toLowerCase().includes(p));

  const mode = String(input.travelMode || "").toLowerCase();
  const fromCity = input.fromCity || "Origin";
  const routeLabel = `${fromCity} to ${destination}`;

  let fareItemName = "Travel fare";
  let fareBasis = "Approximate travel fare";
  let farePerPerson = isInternational ? 28000 : 7000;

  if (mode.includes("flight")) {
    fareItemName = "Round-trip flight fare";
    fareBasis = `Approx economy return airfare for ${routeLabel}. This is an estimate, not a live airline quote.`;
    farePerPerson = isInternational ? 28000 : 7000;
  } else if (mode.includes("train")) {
    fareItemName = "Train fare";
    fareBasis = `Approx return train fare for ${routeLabel}.`;
    farePerPerson = isInternational ? 0 : 2500;
  } else if (mode.includes("bus")) {
    fareItemName = "Bus fare";
    fareBasis = `Approx return bus fare for ${routeLabel}.`;
    farePerPerson = isInternational ? 0 : 1600;
  } else if (mode.includes("own")) {
    fareItemName = "Own vehicle fuel / tolls";
    fareBasis = `Approx fuel, toll and parking estimate for ${routeLabel}.`;
    farePerPerson = 3500;
  } else {
    fareItemName = "Travel fare";
    fareBasis = `Approx travel fare for ${routeLabel}.`;
  }

  // If user knows actual fare, use it instead of estimation.
  if (Number(input.knownFarePerTraveller) > 0) {
    farePerPerson = Number(input.knownFarePerTraveller);
    fareBasis = `User-entered fare per traveller for ${routeLabel}.`;
  }

  const hotelCat = String(input.hotelCategory || "").toLowerCase();
  let hotelPerNight = isInternational ? 6500 : 3500;
  if (hotelCat.includes("ordinary") || hotelCat.includes("budget")) hotelPerNight = isInternational ? 3500 : 1800;
  if (hotelCat.includes("4")) hotelPerNight = isInternational ? 10500 : 6500;
  if (hotelCat.includes("5")) hotelPerNight = isInternational ? 18000 : 12000;
  if (hotelCat.includes("apartment")) hotelPerNight = isInternational ? 7500 : 4500;

  const foodPerPersonPerDay = isInternational ? 2200 : 900;

  let localTransportPerDay = isInternational ? 4500 : 2200;
  const localMode = String(input.localTransportMode || "").toLowerCase();
  if (localMode.includes("metro") || localMode.includes("bus")) localTransportPerDay = isInternational ? 1600 : 800;
  if (localMode.includes("private") || localMode.includes("car")) localTransportPerDay = isInternational ? 7000 : 4200;

  const fareTotal = farePerPerson * numTravellers;
  const hotelTotal = hotelPerNight * Math.max(1, numDays - 1);
  const foodTotal = foodPerPersonPerDay * numTravellers * numDays;
  const airportTransfers = isInternational ? 7000 : 2500;
  const localTransportTotal = localTransportPerDay * numDays;
  const sightseeingTickets = isInternational ? 2500 * numTravellers * Math.max(1, numDays - 1) : 900 * numTravellers * Math.max(1, numDays - 1);
  const simRoaming = isInternational ? 2500 : 300;
  const insurance = isInternational ? 1200 * numTravellers : 0;
  const misc = isInternational ? 3000 : 1500;
  const subtotal = fareTotal + hotelTotal + foodTotal + airportTransfers + localTransportTotal + sightseeingTickets + simRoaming + insurance + shopping + misc;
  const emergency = subtotal * 0.12;
  const total = subtotal + emergency;

  return {
    destination,
    currency: "INR",
    assumptions: [
      "Fallback estimate used when AI budget is unavailable.",
      "Actual fares and hotel prices depend on travel dates, availability and booking time.",
      "Airport transfers, local transport, tickets, SIM/roaming and emergency buffer are included."
    ],
    costItems: [
      { item: fareItemName, basis: `${fareBasis} Travellers: ${numTravellers}.`, amount: Math.round(fareTotal) },
      { item: "Hotel", basis: `${input.hotelCategory || "3 Star"} for ${Math.max(1, numDays - 1)} night(s)`, amount: Math.round(hotelTotal) },
      { item: "Food", basis: `${numTravellers} traveller(s) x ${numDays} day(s)`, amount: Math.round(foodTotal) },
      { item: "Airport / station transfers", basis: "Home to airport/station plus destination airport/station to hotel", amount: Math.round(airportTransfers) },
      { item: "Local transport", basis: `${input.localTransportMode || "Mixed transport"} for sightseeing movement`, amount: Math.round(localTransportTotal) },
      { item: "Sightseeing / entry tickets", basis: "Approximate attraction entry costs based on trip length", amount: Math.round(sightseeingTickets) },
      { item: "SIM card / roaming", basis: isInternational ? "International SIM/roaming pack" : "Connectivity allowance", amount: Math.round(simRoaming) },
      { item: "Travel insurance / documents", basis: isInternational ? "Basic travel insurance estimate" : "Usually not required for domestic trip", amount: Math.round(insurance) },
      { item: "Shopping buffer", basis: "User-entered shopping budget", amount: Math.round(shopping) },
      { item: "Miscellaneous", basis: "Water, tips, lockers, baggage, convenience fees", amount: Math.round(misc) },
      { item: "Emergency buffer", basis: "12% contingency", amount: Math.round(emergency) }
    ],
    planComparison: {
      economy: Math.round(total * 0.78),
      comfort: Math.round(total),
      premium: Math.round(total * 1.55)
    },
    totalBudget: Math.round(total),
    perPerson: Math.round(total / numTravellers),
    recommendation: "Use the Comfort estimate as your working budget and keep the emergency buffer untouched.",
    savingsTips: [
      "Book flights and hotels early.",
      "Use metro/bus where safe and practical.",
      "Use private taxi for airport transfers, late nights or senior comfort.",
      "Pre-check ticket prices for major attractions."
    ],
    disclaimer: "This is an approximate planning estimate, not a live booking quote."
  };
}

async function generateAIBudgetEstimate(input) {
  if (!GEMINI_API_KEY) return null;

  const prompt = `
You are MyYatraMate's intelligent travel budget engine for Indian travellers.

Use the trip plan and preferences to estimate the full budget.

Trip details:
From city: ${input.fromCity || "Not specified"}
Destination: ${input.destination}
Days: ${input.days}\nDeparture date: ${input.departureDate || "Not specified"}\nReturn date: ${input.returnDate || "Not specified"}
Travellers: ${input.travellers}
Travel type: ${input.travelType || "General"}
Budget style: ${input.budgetStyle || "Comfort"}
Food preference: ${input.foodPref || "Indian Food"}
Special needs: ${input.specialNeeds || "None"}

Budget preferences:
Travel mode: ${input.travelMode || "Flight"}
Hotel category: ${input.hotelCategory || "3 Star"}
Local transport mode: ${input.localTransportMode || "Mixed"}
Known fare per traveller if user entered: INR ${input.knownFarePerTraveller || 0}
User shopping budget: INR ${input.shoppingBudget || 0}

Trip itinerary:
${input.tripPlanText || "No itinerary text supplied."}

Return ONLY valid JSON:
{
 "destination": "string",
 "currency": "INR",
 "assumptions": ["string"],
 "costItems": [
  {"item":"Round-trip flight fare / train fare / bus fare based on selected travel mode","basis":"string","amount":0},
  {"item":"Hotel","basis":"string","amount":0},
  {"item":"Food","basis":"string","amount":0},
  {"item":"Airport / station transfers","basis":"string","amount":0},
  {"item":"Local transport","basis":"string","amount":0},
  {"item":"Sightseeing / entry tickets","basis":"string","amount":0},
  {"item":"SIM card / roaming","basis":"string","amount":0},
  {"item":"Travel insurance / documents","basis":"string","amount":0},
  {"item":"Shopping buffer","basis":"string","amount":0},
  {"item":"Miscellaneous","basis":"string","amount":0},
  {"item":"Emergency buffer","basis":"10% to 15% contingency","amount":0}
 ],
 "planComparison": {"economy":0,"comfort":0,"premium":0},
 "totalBudget":0,
 "perPerson":0,
 "recommendation":"string",
 "savingsTips":["string"],
 "disclaimer":"string"
}

Use practical labels based on selected travel mode. If travel mode is Flight, call it "Round-trip flight fare" and do not call it train/bus. If known fare is entered, use that value. Otherwise estimate approximate airfare/train/bus fare, home-to-airport/station transfer, destination arrival transfer, local sightseeing transport, entry tickets, food, hotel, SIM/roaming and emergency buffer. Amounts must be numeric INR values.`;

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.35, topP: 0.85, maxOutputTokens: 4096 }
    })
  });

  if (!response.ok) {
    console.error("Gemini budget API error:", response.status, await response.text());
    return null;
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
  return extractJSONFromText(text);
}


// API: Budget
app.post("/api/budget", requireUserOrGuest, async (req, res) => {
  try {
    const input = req.body;
    if (!input.destination) return res.status(400).json({ success: false, message: "Destination is required." });

    const owner = getSessionOwner(req);
    const travellers = Math.max(1, Number(input.travellers) || 1);

    let aiBudget = null;
    let source = "fallback";

    try {
      aiBudget = await generateAIBudgetEstimate(input);
      if (aiBudget && Array.isArray(aiBudget.costItems)) source = "gemini-ai";
    } catch (aiError) {
      console.error("AI budget generation failed:", aiError);
      aiBudget = null;
    }

    if (!aiBudget) aiBudget = buildFallbackAIBudget(input);

    const totalBudget = Number(aiBudget.totalBudget || 0);
    const perPerson = Number(aiBudget.perPerson || (totalBudget / travellers) || 0);
    const emergencyItem = (aiBudget.costItems || []).find((x) => String(x.item || "").toLowerCase().includes("emergency"));
    const hotelItem = (aiBudget.costItems || []).find((x) => String(x.item || "").toLowerCase().includes("hotel"));
    const foodItem = (aiBudget.costItems || []).find((x) => String(x.item || "").toLowerCase().includes("food"));

    const budgetSummary = `MyYatraMate AI Smart Budget

Destination: ${input.destination}
Travellers: ${travellers}
Total Budget: ₹${Math.round(totalBudget).toLocaleString("en-IN")}
Per Person: ₹${Math.round(perPerson).toLocaleString("en-IN")}`;

    const [result] = await pool.query(
      `INSERT INTO budgets
       (user_id, guest_id, trip_id, destination, travellers, travel_mode, hotel_category, local_transport_mode, shopping_budget, trip_plan_text, ai_budget_json, ai_budget_source, hotel_total, food_total, emergency_buffer, grand_total, per_person, economy_total, comfort_total, premium_total, recommended_plan, budget_summary)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        owner.userId,
        owner.guestId,
        Number(input.tripId) || null,
        input.destination,
        travellers,
        input.travelMode || "",
        input.hotelCategory || "",
        input.localTransportMode || "",
        Number(input.shoppingBudget) || 0,
        input.tripPlanText || "",
        JSON.stringify(aiBudget),
        source,
        Number(hotelItem?.amount || 0),
        Number(foodItem?.amount || 0),
        Number(emergencyItem?.amount || 0),
        totalBudget,
        perPerson,
        Number(aiBudget.planComparison?.economy || 0),
        Number(aiBudget.planComparison?.comfort || totalBudget),
        Number(aiBudget.planComparison?.premium || 0),
        aiBudget.recommendation || "",
        budgetSummary
      ]
    );

    res.json({ success: true, source, budget: { id: result.insertId, ...aiBudget, source } });
  } catch (error) {
    console.error("AI Budget error:", error);
    res.status(500).json({ success: false, message: "Unable to generate AI smart budget: " + error.message });
  }
});


// API: Expense
app.post("/api/expense", requireUserOrGuest, async (req, res) => {
  try {
    const { tripName, category, amount, currency, note } = req.body;

    if (!category || !amount) return res.status(400).json({ success: false, message: "Category and amount are required." });

    const owner = getSessionOwner(req);
    const cleanTripName = String(tripName || "General Trip").trim();
    const cleanCurrency = String(currency || "INR").trim();
    const numAmount = Number(amount) || 0;

    const [result] = await pool.query(
      `INSERT INTO expenses (user_id, guest_id, trip_name, category, amount, currency, note) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [owner.userId, owner.guestId, cleanTripName, String(category).trim(), numAmount, cleanCurrency, String(note || "").trim()]
    );

    const [tripExpenses] = await pool.query(
      `SELECT id, trip_name AS tripName, category, amount, currency, note, created_at AS createdAt
       FROM expenses
       WHERE trip_name = ? AND ((user_id <=> ?) AND (guest_id <=> ?))
       ORDER BY id ASC`,
      [cleanTripName, owner.userId, owner.guestId]
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



// API: User profile
app.get("/api/profile", requireUserOrGuest, async (req, res) => {
  try {
    if (!req.session.user) {
      return res.json({
        success: true,
        guest: true,
        profile: {
          name: "Guest Traveller",
          email: "",
          phone: "",
          homeCity: "",
          preferredFood: "",
          travelStyle: "Guest Mode"
        }
      });
    }

    const [users] = await pool.query(
      `SELECT id, name, email, phone, home_city AS homeCity, preferred_food AS preferredFood, travel_style AS travelStyle, created_at AS createdAt
       FROM users
       WHERE id = ?`,
      [req.session.user.id]
    );

    if (users.length === 0) {
      return res.status(404).json({ success: false, message: "Profile not found." });
    }

    res.json({ success: true, guest: false, profile: users[0] });
  } catch (error) {
    console.error("Profile fetch error:", error);
    res.status(500).json({ success: false, message: "Unable to load profile: " + error.message });
  }
});


async function handleProfileUpdate(req, res) {
  try {
    if (!req.session.user) {
      return res.status(400).json({ success: false, message: "Guest profile cannot be updated. Please register to save profile details." });
    }

    const { name, phone, homeCity, preferredFood, travelStyle } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, message: "Name is required." });
    }

    await ensureProfileAndTripColumns();
  await ensureAIBudgetColumns();

    await pool.query(
      `UPDATE users
       SET name = ?, phone = ?, home_city = ?, preferred_food = ?, travel_style = ?
       WHERE id = ?`,
      [
        String(name).trim(),
        String(phone || "").trim(),
        String(homeCity || "").trim(),
        String(preferredFood || "").trim(),
        String(travelStyle || "").trim(),
        req.session.user.id
      ]
    );

    req.session.user.name = String(name).trim();

    res.json({ success: true, message: "Profile updated successfully." });
  } catch (error) {
    console.error("Profile update error:", error);
    res.status(500).json({ success: false, message: "Unable to update profile: " + error.message });
  }
}

app.put("/api/profile", requireUserOrGuest, handleProfileUpdate);

// POST alias added because some shared hosting/reverse proxy setups behave more reliably with POST than PUT.
app.post("/api/profile", requireUserOrGuest, handleProfileUpdate);


app.put("/api/trip/:id/meta", requireUserOrGuest, async (req, res) => {
  try {
    const owner = getSessionOwner(req);
    const tripId = Number(req.params.id);
    const { tripStatus, isFavourite } = req.body;

    if (!tripId) {
      return res.status(400).json({ success: false, message: "Invalid trip id." });
    }

    const allowedStatus = ["Upcoming", "Completed", "Cancelled"];
    const cleanStatus = allowedStatus.includes(tripStatus) ? tripStatus : "Upcoming";
    const fav = isFavourite ? 1 : 0;

    const [result] = await pool.query(
      `UPDATE trip_plans
       SET trip_status = ?, is_favourite = ?
       WHERE id = ? AND (user_id <=> ?) AND (guest_id <=> ?)`,
      [cleanStatus, fav, tripId, owner.userId, owner.guestId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Trip not found or you do not have permission." });
    }

    res.json({ success: true, message: "Trip category updated successfully." });
  } catch (error) {
    console.error("Trip meta update error:", error);
    res.status(500).json({ success: false, message: "Unable to update trip category." });
  }
});


// API: User saved history
app.get("/api/my-trips", requireUserOrGuest, async (req, res) => {
  try {
    const owner = getSessionOwner(req);

    const [trips] = await pool.query(
      `SELECT id, from_city AS fromCity, destination, days, travellers, departure_date AS departureDate, return_date AS returnDate, travel_type AS travelType,
              budget_style AS budgetStyle, food_pref AS foodPref, special_needs AS specialNeeds,
              plan, trip_status AS tripStatus, is_favourite AS isFavourite, created_at AS createdAt
       FROM trip_plans
       WHERE (user_id <=> ?) AND (guest_id <=> ?)
       ORDER BY id DESC`,
      [owner.userId, owner.guestId]
    );

    const [budgets] = await pool.query(
      `SELECT id, trip_id AS tripId, destination, grand_total AS grandTotal, per_person AS perPerson, created_at AS createdAt
       FROM budgets
       WHERE (user_id <=> ?) AND (guest_id <=> ?)
       ORDER BY id DESC`,
      [owner.userId, owner.guestId]
    );

    const budgetsByTrip = {};
    budgets.forEach((budget) => {
      const key = budget.tripId ? String(budget.tripId) : "";
      if (!budgetsByTrip[key]) budgetsByTrip[key] = [];
      budgetsByTrip[key].push(budget);
    });

    trips.forEach((trip) => {
      trip.budgets = budgetsByTrip[String(trip.id)] || [];
      trip.latestBudget = trip.budgets[0] || null;
    });

    res.json({ success: true, trips });
  } catch (error) {
    console.error("My trips error:", error);
    res.status(500).json({ success: false, message: "Unable to load saved trips." });
  }
});

app.get("/api/my-budgets", requireUserOrGuest, async (req, res) => {
  try {
    const owner = getSessionOwner(req);

    const [budgets] = await pool.query(
      `SELECT id, trip_id AS tripId, destination, travellers, nights, grand_total AS grandTotal, per_person AS perPerson,
              budget_summary AS budgetSummary, created_at AS createdAt
       FROM budgets
       WHERE (user_id <=> ?) AND (guest_id <=> ?)
       ORDER BY id DESC`,
      [owner.userId, owner.guestId]
    );

    res.json({ success: true, budgets });
  } catch (error) {
    console.error("My budgets error:", error);
    res.status(500).json({ success: false, message: "Unable to load saved budgets." });
  }
});

app.get("/api/my-expenses", requireUserOrGuest, async (req, res) => {
  try {
    const owner = getSessionOwner(req);

    const [expenses] = await pool.query(
      `SELECT id, trip_name AS tripName, category, amount, currency, note, created_at AS createdAt
       FROM expenses
       WHERE (user_id <=> ?) AND (guest_id <=> ?)
       ORDER BY id DESC`,
      [owner.userId, owner.guestId]
    );

    res.json({ success: true, expenses });
  } catch (error) {
    console.error("My expenses error:", error);
    res.status(500).json({ success: false, message: "Unable to load saved expenses." });
  }
});



// API: Trip selector list
app.get("/api/trip-selector", requireUserOrGuest, async (req, res) => {
  try {
    const owner = getSessionOwner(req);
    const [trips] = await pool.query(
      `SELECT id, from_city AS fromCity, destination, days, travellers, departure_date AS departureDate, return_date AS returnDate,
              travel_type AS travelType, budget_style AS budgetStyle, food_pref AS foodPref, special_needs AS specialNeeds,
              plan, created_at AS createdAt
       FROM trip_plans
       WHERE (user_id <=> ?) AND (guest_id <=> ?)
       ORDER BY id DESC`,
      [owner.userId, owner.guestId]
    );
    res.json({ success: true, trips });
  } catch (error) {
    res.status(500).json({ success: false, message: "Unable to load trips." });
  }
});

// API: Trip-linked details
app.get("/api/trip/:id/details", requireUserOrGuest, async (req, res) => {
  try {
    const owner = getSessionOwner(req);
    const tripId = Number(req.params.id);

    const [tripRows] = await pool.query(
      `SELECT id, from_city AS fromCity, destination, days, travellers, departure_date AS departureDate, return_date AS returnDate,
              travel_type AS travelType, budget_style AS budgetStyle, food_pref AS foodPref, special_needs AS specialNeeds,
              plan, trip_status AS tripStatus, is_favourite AS isFavourite, created_at AS createdAt
       FROM trip_plans
       WHERE id = ? AND (user_id <=> ?) AND (guest_id <=> ?)
       LIMIT 1`,
      [tripId, owner.userId, owner.guestId]
    );

    if (!tripRows.length) return res.status(404).json({ success: false, message: "Trip not found." });

    const [budgets] = await pool.query(
      `SELECT id, trip_id AS tripId, destination, travellers, grand_total AS grandTotal, per_person AS perPerson,
              budget_summary AS budgetSummary, ai_budget_json AS aiBudgetJson, created_at AS createdAt
       FROM budgets
       WHERE trip_id = ? AND (user_id <=> ?) AND (guest_id <=> ?)
       ORDER BY id DESC`,
      [tripId, owner.userId, owner.guestId]
    );

    const [visaChecklists] = await pool.query(
      `SELECT id, trip_id AS tripId, passport_country AS passportCountry, destination, travel_purpose AS travelPurpose,
              checklist_json AS checklistJson, created_at AS createdAt
       FROM visa_checklists
       WHERE trip_id = ? AND (user_id <=> ?) AND (guest_id <=> ?)
       ORDER BY id DESC`,
      [tripId, owner.userId, owner.guestId]
    );

    const [documents] = await pool.query(
      `SELECT id, trip_id AS tripId, profile_name AS profileName, document_type AS documentType, document_name AS documentName,
              expiry_date AS expiryDate, file_name AS fileName, created_at AS createdAt
       FROM travel_document_vault
       WHERE trip_id = ? AND (user_id <=> ?) AND (guest_id <=> ?)
       ORDER BY id DESC`,
      [tripId, owner.userId, owner.guestId]
    );

    const [packing] = await pool.query(
      `SELECT id, trip_id AS tripId, destination, checklist_json AS checklistJson, source, created_at AS createdAt
       FROM packing_checklists
       WHERE trip_id = ? AND (user_id <=> ?) AND (guest_id <=> ?)
       ORDER BY id DESC`,
      [tripId, owner.userId, owner.guestId]
    );

    const [transportGuides] = await pool.query(
      `SELECT id, trip_id AS tripId, destination, guide_json AS guideJson, created_at AS createdAt
       FROM local_transport_guides
       WHERE trip_id = ? AND (user_id <=> ?) AND (guest_id <=> ?)
       ORDER BY id DESC`,
      [tripId, owner.userId, owner.guestId]
    );

    res.json({ success: true, trip: tripRows[0], budgets, visaChecklists, documents, packing, transportGuides });
  } catch (error) {
    console.error("Trip details error:", error);
    res.status(500).json({ success: false, message: "Unable to load trip details." });
  }
});

// API: Update saved trip
app.put("/api/trip/:id", requireUserOrGuest, async (req, res) => {
  try {
    const owner = getSessionOwner(req);
    const tripId = Number(req.params.id);
    const { destination, days, travellers, travelType, budgetStyle, foodPref, specialNeeds, plan, tripStatus, isFavourite } = req.body;

    if (!tripId) {
      return res.status(400).json({ success: false, message: "Invalid trip id." });
    }

    if (!destination || !plan) {
      return res.status(400).json({ success: false, message: "Destination and plan are required." });
    }

    const [result] = await pool.query(
      `UPDATE trip_plans
       SET destination = ?, days = ?, travellers = ?, travel_type = ?, budget_style = ?, food_pref = ?, special_needs = ?, plan = ?,
           trip_status = COALESCE(?, trip_status), is_favourite = COALESCE(?, is_favourite)
       WHERE id = ? AND (user_id <=> ?) AND (guest_id <=> ?)`,
      [
        String(destination).trim(),
        Number(days) || 1,
        Number(travellers) || 1,
        String(travelType || "").trim(),
        String(budgetStyle || "").trim(),
        String(foodPref || "").trim(),
        String(specialNeeds || "").trim(),
        String(plan || "").trim(),
        tripStatus || null,
        typeof isFavourite === "boolean" ? (isFavourite ? 1 : 0) : null,
        tripId,
        owner.userId,
        owner.guestId
      ]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Trip not found or you do not have permission." });
    }

    res.json({ success: true, message: "Trip updated successfully." });
  } catch (error) {
    console.error("Update trip error:", error);
    res.status(500).json({ success: false, message: "Unable to update trip." });
  }
});

// API: Delete saved trip
app.delete("/api/trip/:id", requireUserOrGuest, async (req, res) => {
  try {
    const owner = getSessionOwner(req);
    const tripId = Number(req.params.id);

    if (!tripId) {
      return res.status(400).json({ success: false, message: "Invalid trip id." });
    }

    const [result] = await pool.query(
      `DELETE FROM trip_plans
       WHERE id = ? AND (user_id <=> ?) AND (guest_id <=> ?)`,
      [tripId, owner.userId, owner.guestId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Trip not found or you do not have permission." });
    }

    res.json({ success: true, message: "Trip deleted successfully." });
  } catch (error) {
    console.error("Delete trip error:", error);
    res.status(500).json({ success: false, message: "Unable to delete trip." });
  }
});



function getVisaChecklistTemplate(passportCountry, destination, travelPurpose) {
  const passport = String(passportCountry || "India").toLowerCase();
  const d = String(destination || "").toLowerCase();
  const purpose = String(travelPurpose || "").toLowerCase();
  const isIndianPassport = passport.includes("india");

  let region = destination || "General International Travel";
  let visaStatusNote = `Visa and entry rules depend on passport country and destination. Passport country selected: ${passportCountry || "India"}. Verify with the official embassy/consulate or a reliable visa partner before booking.`;
  let documents = [
    "Valid passport with sufficient validity",
    "Confirmed return/onward ticket",
    "Hotel booking or stay address",
    "Travel insurance",
    "Proof of funds",
    "Day-wise itinerary",
    "Passport-size photographs as per destination rules"
  ];
  let travelForms = ["Check whether arrival card, health declaration, customs declaration or e-visa registration is required."];
  let reminders = [
    "Passport should usually have at least 6 months validity from travel date.",
    "Keep printed and digital copies of all documents.",
    "Verify latest requirements from official sources before travel."
  ];

  if (d.includes("thailand")) {
    region = "Thailand";
    visaStatusNote = isIndianPassport ? "For Indian passport holders, Thailand entry/visa rules may change. Check official Thai immigration/embassy guidance before travel." : `For ${passportCountry || "your"} passport holders, Thailand visa/entry rules may differ. Verify through official Thai immigration/embassy sources.`;
    documents = ["Passport", "Thailand Digital Arrival Card if required", "Hotel booking / stay address", "Return or onward ticket", "Travel insurance recommended", "Proof of funds if requested", "Day-wise itinerary"];
    travelForms = ["Thailand Digital Arrival Card / arrival form if applicable."];
  } else if (d.includes("dubai") || d.includes("uae") || d.includes("united arab emirates")) {
    region = "Dubai / UAE";
    visaStatusNote = isIndianPassport ? "Indian passport holders generally need a UAE visa unless eligible under a specific exemption. Verify latest UAE visa rules before travel." : `For ${passportCountry || "your"} passport holders, UAE visa/entry rules may differ. Verify latest UAE visa rules before travel.`;
    documents = ["Passport", "UAE / Dubai visa", "Travel insurance", "Hotel booking / stay address", "Return ticket", "Passport-size photograph", "Proof of funds if requested"];
    travelForms = ["Check airline/UAE entry requirements before departure."];
  } else if (d.includes("schengen") || d.includes("france") || d.includes("germany") || d.includes("italy") || d.includes("spain") || d.includes("netherlands") || d.includes("switzerland") || d.includes("austria")) {
    region = "Schengen";
    visaStatusNote = isIndianPassport ? "Indian passport holders generally need a Schengen visa. Requirements vary by embassy/VFS and country of main stay." : `For ${passportCountry || "your"} passport holders, Schengen visa requirements may differ. Check the embassy/consulate of the main-stay country.`;
    documents = ["Schengen visa application form", "Cover letter", "Day-wise itinerary", "Bank statement", "Income tax returns / financial proof", "Travel insurance meeting Schengen requirements", "Hotel bookings", "Flight reservation / confirmed tickets as applicable", "Employment letter / leave letter", "Passport-size photographs", "Passport"];
    travelForms = ["Check country-specific form, VFS/embassy appointment and biometrics requirements."];
  } else if (d.includes("japan")) {
    region = "Japan";
    visaStatusNote = isIndianPassport ? "Indian passport holders generally need a Japan visa. Business travellers may need invitation/supporting documents." : `For ${passportCountry || "your"} passport holders, Japan visa requirements may differ. Verify through official sources.`;
    documents = ["Japan visa application form", "Passport", "Photograph as per Japan visa specification", "Day-wise itinerary", "Hotel booking", "Flight itinerary", "Employment letter / leave approval", "Bank statement", "Invitation letter if business", "Company covering letter if business"];
    travelForms = ["Check latest Japan embassy/VFS process and appointment requirements."];
  } else if (d.includes("china")) {
    region = "China";
    visaStatusNote = isIndianPassport ? "Indian passport holders generally need a China visa. Business travel usually requires invitation and company details." : `For ${passportCountry || "your"} passport holders, China visa requirements may differ. Business travel usually requires invitation and company details.`;
    documents = ["Passport", "China visa application form", "Invitation letter", "Business details / company covering letter", "Applicant employment details", "Hotel booking / stay details", "Flight itinerary", "Photograph as per China visa specification", "Previous China visa details if applicable"];
    travelForms = ["Check latest China visa centre process and appointment requirements."];
  }

  if (purpose.includes("business")) {
    documents.push("Business meeting invitation / expo registration if applicable");
    documents.push("Company covering letter");
    documents.push("Company profile / business card if required");
  }

  return {
    passportCountry: passportCountry || "India",
    destination: region,
    visaStatusNote,
    documents: Array.from(new Set(documents)),
    travelForms,
    reminders,
    expiryAlerts: ["Passport expiry reminder", "Visa expiry reminder", "Travel insurance validity reminder"],
    officialSourceReminder: "Always verify with official embassy/consulate/immigration sources or a reliable visa partner because visa rules change."
  };
}

app.post("/api/visa-checklist", requireUserOrGuest, async (req, res) => {
  try {
    const { passportCountry, destination, travelPurpose, departureDate, returnDate, passportExpiry, visaExpiry, uploadedDocs } = req.body;
    if (!destination) return res.status(400).json({ success: false, message: "Destination is required." });

    const owner = getSessionOwner(req);
    const checklist = getVisaChecklistTemplate(passportCountry || "India", destination, travelPurpose);
    checklist.travelPurpose = travelPurpose || "";
    checklist.departureDate = departureDate || "";
    checklist.returnDate = returnDate || "";
    checklist.passportExpiry = passportExpiry || "";
    checklist.visaExpiry = visaExpiry || "";
    checklist.uploadedDocs = Array.isArray(uploadedDocs) ? uploadedDocs : [];

    const [result] = await pool.query(
      `INSERT INTO visa_checklists
       (user_id, guest_id, trip_id, passport_country, destination, travel_purpose, departure_date, return_date, checklist_json, passport_expiry, visa_expiry, uploaded_docs)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [owner.userId, owner.guestId, Number(req.body.tripId) || null, passportCountry || "India", destination, travelPurpose || "", departureDate || "", returnDate || "", JSON.stringify(checklist), passportExpiry || "", visaExpiry || "", JSON.stringify(checklist.uploadedDocs)]
    );

    res.json({ success: true, checklistId: result.insertId, checklist });
  } catch (error) {
    console.error("Visa checklist error:", error);
    res.status(500).json({ success: false, message: "Unable to generate visa checklist: " + error.message });
  }
});



function fallbackExtractDocumentDetails(fileName, documentType) {
  const name = String(fileName || "");
  const lower = name.toLowerCase();
  const result = {
    documentType: documentType || "",
    documentName: name ? name.replace(/\.[^/.]+$/, "").replace(/[_-]+/g, " ") : "",
    documentNumber: "",
    travellerName: "",
    issueDate: "",
    expiryDate: "",
    airline: "",
    flightNumber: "",
    fromAirport: "",
    toAirport: "",
    travelDateTime: "",
    seatNumber: "",
    gateNumber: "",
    boardingTime: "",
    confidence: "low",
    note: "Fallback extraction used. For accurate extraction, ensure GEMINI_API_KEY is active and upload a clear image/PDF."
  };

  const flightMatch = name.match(/\b([A-Z]{2}|[A-Z0-9]{2})\s?(\d{2,5})\b/i);
  if (flightMatch && (lower.includes("boarding") || lower.includes("flight") || lower.includes("ticket"))) {
    result.documentType = "Boarding Pass";
    result.flightNumber = (flightMatch[1] + flightMatch[2]).toUpperCase();
  }

  return result;
}

async function extractDocumentDetailsWithAI({ fileName, fileType, fileData, documentType }) {
  if (!GEMINI_API_KEY || !fileData) return null;

  const base64 = String(fileData).includes(",") ? String(fileData).split(",")[1] : String(fileData);
  const mimeType = fileType || "application/octet-stream";

  const prompt = `
Extract structured travel document details from this uploaded file.

Return ONLY valid JSON. Do not add markdown.

Fields:
{
  "documentType": "Passport Copy | Visa | Boarding Pass | Flight Ticket | Hotel Booking | Travel Insurance | Forex Card | Aadhaar | PAN | Vaccination Certificate | Emergency Contact | Other",
  "documentName": "short useful name",
  "documentNumber": "passport number / visa number / PNR / policy no / ID no if visible",
  "travellerName": "holder/passenger name if visible",
  "issueDate": "YYYY-MM-DD if visible, otherwise blank",
  "expiryDate": "YYYY-MM-DD if visible, otherwise blank",
  "airline": "airline if boarding pass/ticket",
  "flightNumber": "flight number if visible",
  "fromAirport": "origin airport/city if visible",
  "toAirport": "destination airport/city if visible",
  "travelDateTime": "departure/travel date and time if visible",
  "seatNumber": "seat if visible",
  "gateNumber": "gate if visible",
  "boardingTime": "boarding time if visible",
  "confidence": "high | medium | low",
  "note": "short extraction note"
}

Rules:
- If unsure, leave field blank.
- Do not hallucinate sensitive numbers.
- Use the uploaded file contents. Filename: ${fileName || ""}
- User selected document type: ${documentType || ""}
`;

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [
          { text: prompt },
          { inlineData: { mimeType, data: base64 } }
        ]
      }],
      generationConfig: { temperature: 0.1, topP: 0.8, maxOutputTokens: 2048 }
    })
  });

  if (!response.ok) {
    console.error("Gemini document extraction error:", response.status, await response.text());
    return null;
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
  return extractJSONFromText(text);
}


function buildFallbackPackingChecklist(input) {
  const destination = String(input.destination || "your destination");
  const days = Math.max(1, Number(input.days) || 3);
  const travellers = Math.max(1, Number(input.travellers) || 1);
  const special = String(input.specialNeeds || input.familyProfile || "").toLowerCase();
  const destinationLower = destination.toLowerCase();
  const hasChildren = special.includes("child") || special.includes("kid") || special.includes("children") || special.includes("baby");
  const hasSenior = special.includes("senior") || special.includes("parent") || special.includes("elder");
  const isHot = destinationLower.includes("dubai") || destinationLower.includes("uae") || destinationLower.includes("thailand");
  const isRain = destinationLower.includes("thailand") || destinationLower.includes("singapore") || destinationLower.includes("kerala");
  const isBusiness = String(input.travelType || "").toLowerCase().includes("business");

  const clothingPairs = Math.ceil(days * 1.2);
  const items = [
    { category: "Documents", item: "Passport / ID proof", quantity: "1 per traveller + digital copy", reason: "Required for travel and hotel check-in" },
    { category: "Documents", item: "Visa / entry approval if required", quantity: "1 per traveller", reason: "Immigration readiness" },
    { category: "Documents", item: "Flight/train tickets and hotel booking", quantity: "Printed + digital copy", reason: "Airport, immigration and check-in" },
    { category: "Clothing", item: "Daily outfits", quantity: `${clothingPairs} pairs per traveller`, reason: `Based on ${days} day trip with buffer` },
    { category: "Clothing", item: "Innerwear and socks", quantity: `${days + 2} sets per traveller`, reason: "Comfort and hygiene buffer" },
    { category: "Clothing", item: isHot ? "Light cotton clothes" : "Weather-suitable clothes", quantity: "As needed", reason: isHot ? "Hot weather destination" : "Destination weather comfort" },
    { category: "Footwear", item: "Comfortable walking shoes", quantity: "1 pair per traveller", reason: "Sightseeing/local movement" },
    { category: "Toiletries", item: "Toothbrush, toothpaste, soap, shampoo, comb, deodorant", quantity: "Travel-size kit", reason: "Daily hygiene" },
    { category: "Health", item: "Basic medicines and prescriptions", quantity: "Full trip + 2 day buffer", reason: "Emergency readiness" },
    { category: "Electronics", item: "Phone charger, power bank, universal adapter", quantity: "1 set", reason: "Connectivity and charging" },
    { category: "Money", item: "Cash, forex card, credit/debit card", quantity: "Split across bags", reason: "Payments and emergency backup" }
  ];

  if (isRain) items.push({ category: "Weather", item: "Umbrella / rain jacket", quantity: "1 per traveller", reason: "Rain possibility" });
  if (isHot) items.push({ category: "Weather", item: "Sunscreen, sunglasses, cap/hat", quantity: "1 set", reason: "Sun protection" });
  if (isBusiness) items.push({ category: "Business", item: "Formal wear, business cards, meeting documents", quantity: "As per meetings", reason: "Business trip readiness" });
  if (hasChildren) {
    items.push({ category: "Children", item: "Milk bottle / sipper / child food", quantity: "As per child age", reason: "Child comfort" });
    items.push({ category: "Children", item: "Child medicines, snacks, wet wipes, small toy", quantity: "Trip kit", reason: "Family travel support" });
  }
  if (hasSenior) {
    items.push({ category: "Senior Care", item: "Regular medicines, prescription, easy footwear", quantity: "Trip kit", reason: "Senior comfort and medical continuity" });
  }

  return {
    destination,
    summary: `Packing checklist for ${travellers} traveller(s), ${days} day(s).`,
    weatherNote: isHot ? "Likely warm/hot destination. Prefer breathable clothing and hydration." : "Check latest weather before travel and adjust clothing.",
    clothingPlan: `${clothingPairs} daily outfit pairs per traveller, plus 1 comfortable travel outfit.`,
    items,
    reminders: [
      "Keep essential documents in both digital and printed form.",
      "Keep medicines in cabin baggage with prescription.",
      "Do not overpack; leave space for shopping.",
      "Verify airline baggage allowance before travel."
    ]
  };
}

async function generateAIPackingChecklist(input) {
  if (!GEMINI_API_KEY) return null;

  const prompt = `
Create a detailed intelligent travel packing checklist as JSON only.

Input:
${JSON.stringify(input, null, 2)}

Return JSON:
{
  "destination": "",
  "summary": "",
  "weatherNote": "",
  "clothingPlan": "",
  "items": [
    {"category":"", "item":"", "quantity":"", "reason":""}
  ],
  "reminders": []
}

Consider:
- destination, travel dates and likely weather season
- number of days
- number of travellers
- children, adults, senior citizens, parents
- special needs
- food preference
- business/family/pilgrimage/solo trip type
- toiletries
- medicines
- shoes
- clothing count/pairs
- chargers, adapters, travel documents
- keep it practical for Indian travellers
`;

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({
      contents: [{role:"user", parts:[{text: prompt}]}],
      generationConfig: { temperature: 0.35, topP: 0.9, maxOutputTokens: 3072 }
    })
  });
  if (!response.ok) return null;
  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p)=>p.text || "").join("").trim();
  return extractJSONFromText(text);
}

// API: AI Packing Checklist
app.post("/api/packing-checklist", requireUserOrGuest, async (req, res) => {
  try {
    const owner = getSessionOwner(req);
    const input = req.body || {};
    if (!input.destination) return res.status(400).json({ success: false, message: "Destination is required." });

    let checklist = null;
    let source = "fallback";
    try {
      checklist = await generateAIPackingChecklist(input);
      if (checklist && Array.isArray(checklist.items)) source = "gemini-ai";
    } catch (error) {
      console.error("AI packing failed:", error);
    }
    if (!checklist) checklist = buildFallbackPackingChecklist(input);

    const [result] = await pool.query(
      `INSERT INTO packing_checklists (user_id, guest_id, trip_id, destination, checklist_json, source)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [owner.userId, owner.guestId, Number(input.tripId) || null, input.destination, JSON.stringify(checklist), source]
    );

    res.json({ success: true, checklistId: result.insertId, source, checklist });
  } catch (error) {
    console.error("Packing checklist error:", error);
    res.status(500).json({ success: false, message: "Unable to generate packing checklist." });
  }
});

// API: Travel Document Vault - extract passport/visa/boarding pass details
app.post("/api/document-vault/extract", requireUserOrGuest, async (req, res) => {
  try {
    const { fileName, fileType, fileData, documentType } = req.body;

    if (!fileData) {
      return res.status(400).json({ success: false, message: "File data is required for extraction." });
    }

    let details = null;
    let source = "fallback";

    try {
      details = await extractDocumentDetailsWithAI({ fileName, fileType, fileData, documentType });
      if (details) source = "gemini-ai";
    } catch (error) {
      console.error("Document AI extraction failed:", error);
      details = null;
    }

    if (!details) {
      details = fallbackExtractDocumentDetails(fileName, documentType);
    }

    res.json({ success: true, source, details });
  } catch (error) {
    console.error("Document extraction route error:", error);
    res.status(500).json({ success: false, message: "Unable to extract document details: " + error.message });
  }
});


// API: Travel Document Vault - add document
app.post("/api/document-vault", requireUserOrGuest, async (req, res) => {
  try {
    const {
      profileName,
      relation,
      documentType,
      documentName,
      documentNumber,
      travellerName,
      airline,
      flightNumber,
      fromAirport,
      toAirport,
      travelDateTime,
      seatNumber,
      gateNumber,
      boardingTime,
      issueDate,
      expiryDate,
      notes,
      fileName,
      fileType,
      fileSize,
      fileData,
      isOfflineReady,
      isFamilyDocument
    } = req.body;

    if (!profileName || !documentType || !documentName) {
      return res.status(400).json({ success: false, message: "Profile name, document type and document name are required." });
    }

    const owner = getSessionOwner(req);

    const [result] = await pool.query(
      `INSERT INTO travel_document_vault
       (user_id, guest_id, trip_id, profile_name, relation, document_type, document_name, document_number, traveller_name, airline, flight_number, from_airport, to_airport, travel_datetime, seat_number, gate_number, boarding_time, issue_date, expiry_date, notes, file_name, file_type, file_size, file_data, is_offline_ready, is_family_document)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        owner.userId,
        owner.guestId,
        Number(req.body.tripId) || null,
        String(profileName || "").trim(),
        String(relation || "").trim(),
        String(documentType || "").trim(),
        String(documentName || "").trim(),
        String(documentNumber || "").trim(),
        String(travellerName || "").trim(),
        String(airline || "").trim(),
        String(flightNumber || "").trim(),
        String(fromAirport || "").trim(),
        String(toAirport || "").trim(),
        String(travelDateTime || "").trim(),
        String(seatNumber || "").trim(),
        String(gateNumber || "").trim(),
        String(boardingTime || "").trim(),
        String(issueDate || "").trim(),
        String(expiryDate || "").trim(),
        String(notes || "").trim(),
        String(fileName || "").trim(),
        String(fileType || "").trim(),
        Number(fileSize) || 0,
        String(fileData || ""),
        isOfflineReady ? 1 : 0,
        isFamilyDocument ? 1 : 0
      ]
    );

    res.json({ success: true, message: "Document saved to travel vault.", documentId: result.insertId });
  } catch (error) {
    console.error("Document vault save error:", error);
    res.status(500).json({ success: false, message: "Unable to save document: " + error.message });
  }
});

// API: Travel Document Vault - list documents
app.get("/api/document-vault", requireUserOrGuest, async (req, res) => {
  try {
    const owner = getSessionOwner(req);

    const [rows] = await pool.query(
      `SELECT id, profile_name AS profileName, relation, document_type AS documentType,
              document_name AS documentName, document_number AS documentNumber,
              traveller_name AS travellerName, airline, flight_number AS flightNumber,
              from_airport AS fromAirport, to_airport AS toAirport,
              travel_datetime AS travelDateTime, seat_number AS seatNumber,
              gate_number AS gateNumber, boarding_time AS boardingTime,
              issue_date AS issueDate, expiry_date AS expiryDate, notes,
              file_name AS fileName, file_type AS fileType, file_size AS fileSize,
              is_offline_ready AS isOfflineReady, is_family_document AS isFamilyDocument,
              created_at AS createdAt
       FROM travel_document_vault
       WHERE (user_id <=> ?) AND (guest_id <=> ?)
       ORDER BY created_at DESC`,
      [owner.userId, owner.guestId]
    );

    res.json({ success: true, documents: rows });
  } catch (error) {
    console.error("Document vault list error:", error);
    res.status(500).json({ success: false, message: "Unable to load document vault." });
  }
});

// API: Travel Document Vault - get file data for a document
app.get("/api/document-vault/:id", requireUserOrGuest, async (req, res) => {
  try {
    const owner = getSessionOwner(req);
    const [rows] = await pool.query(
      `SELECT id, profile_name AS profileName, document_type AS documentType,
              document_name AS documentName, file_name AS fileName, file_type AS fileType,
              file_size AS fileSize, file_data AS fileData
       FROM travel_document_vault
       WHERE id = ? AND (user_id <=> ?) AND (guest_id <=> ?)
       LIMIT 1`,
      [req.params.id, owner.userId, owner.guestId]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: "Document not found." });
    }

    res.json({ success: true, document: rows[0] });
  } catch (error) {
    console.error("Document vault read error:", error);
    res.status(500).json({ success: false, message: "Unable to read document." });
  }
});

// API: Travel Document Vault - delete document
app.delete("/api/document-vault/:id", requireUserOrGuest, async (req, res) => {
  try {
    const owner = getSessionOwner(req);
    const [result] = await pool.query(
      `DELETE FROM travel_document_vault
       WHERE id = ? AND (user_id <=> ?) AND (guest_id <=> ?)`,
      [req.params.id, owner.userId, owner.guestId]
    );

    res.json({ success: true, deleted: result.affectedRows });
  } catch (error) {
    console.error("Document vault delete error:", error);
    res.status(500).json({ success: false, message: "Unable to delete document." });
  }
});

// API: Travel Document Vault - share bundle summary
app.post("/api/document-vault/share-bundle", requireUserOrGuest, async (req, res) => {
  try {
    const { profileName, documentIds } = req.body;
    const owner = getSessionOwner(req);

    let query = `SELECT id, profile_name AS profileName, relation, document_type AS documentType,
                        document_name AS documentName, document_number AS documentNumber,
                        traveller_name AS travellerName, airline, flight_number AS flightNumber,
                        from_airport AS fromAirport, to_airport AS toAirport,
                        travel_datetime AS travelDateTime, seat_number AS seatNumber,
                        gate_number AS gateNumber, boarding_time AS boardingTime,
                        expiry_date AS expiryDate, file_name AS fileName, created_at AS createdAt
                 FROM travel_document_vault
                 WHERE (user_id <=> ?) AND (guest_id <=> ?)`;
    const params = [owner.userId, owner.guestId];

    if (profileName) {
      query += " AND profile_name = ?";
      params.push(profileName);
    }

    if (Array.isArray(documentIds) && documentIds.length) {
      query += ` AND id IN (${documentIds.map(() => "?").join(",")})`;
      params.push(...documentIds);
    }

    query += " ORDER BY profile_name, document_type";

    const [rows] = await pool.query(query, params);

    const lines = [];
    lines.push("MyYatraMate Travel Document Bundle");
    lines.push("");
    if (profileName) lines.push(`Profile: ${profileName}`);
    lines.push(`Generated: ${new Date().toLocaleString("en-IN")}`);
    lines.push("");
    rows.forEach((doc, index) => {
      lines.push(`${index + 1}. ${doc.documentType} - ${doc.documentName}`);
      if (doc.profileName) lines.push(`   Traveller: ${doc.profileName}`);
      if (doc.documentNumber) lines.push(`   Document No: ${doc.documentNumber}`);
      if (doc.expiryDate) lines.push(`   Expiry: ${doc.expiryDate}`);
      if (doc.flightNumber) lines.push(`   Flight: ${doc.airline || ""} ${doc.flightNumber}`.trim());
      if (doc.fromAirport || doc.toAirport) lines.push(`   Route: ${doc.fromAirport || "-"} → ${doc.toAirport || "-"}`);
      if (doc.travelDateTime) lines.push(`   Travel Time: ${doc.travelDateTime}`);
      if (doc.seatNumber) lines.push(`   Seat: ${doc.seatNumber}`);
      if (doc.gateNumber) lines.push(`   Gate: ${doc.gateNumber}`);
      if (doc.boardingTime) lines.push(`   Boarding: ${doc.boardingTime}`);
      if (doc.fileName) lines.push(`   File: ${doc.fileName}`);
    });
    lines.push("");
    lines.push("Security note: Share this bundle only with trusted travel agents or family members.");

    res.json({ success: true, bundleText: lines.join("\\n"), documents: rows });
  } catch (error) {
    console.error("Document bundle error:", error);
    res.status(500).json({ success: false, message: "Unable to prepare document bundle." });
  }
});



function buildCabAppLinks(appNames) {
  const known = {
    "Uber": {
      name: "Uber",
      useFor: "International cab booking in many cities",
      ios: "Search 'Uber' on Apple App Store",
      android: "Search 'Uber' on Google Play Store",
      website: "https://www.uber.com"
    },
    "Careem": {
      name: "Careem",
      useFor: "UAE / Middle East taxi, car and delivery services",
      ios: "Search 'Careem' on Apple App Store",
      android: "Search 'Careem' on Google Play Store",
      website: "https://www.careem.com"
    },
    "Grab": {
      name: "Grab",
      useFor: "Thailand / Southeast Asia rides, food and local transport",
      ios: "Search 'Grab' on Apple App Store",
      android: "Search 'Grab' on Google Play Store",
      website: "https://www.grab.com"
    },
    "Bolt": {
      name: "Bolt",
      useFor: "Europe and selected countries for taxis and rides",
      ios: "Search 'Bolt' on Apple App Store",
      android: "Search 'Bolt' on Google Play Store",
      website: "https://bolt.eu"
    },
    "RTA Dubai": {
      name: "RTA Dubai",
      useFor: "Dubai public transport, Nol, metro, bus and taxi information",
      ios: "Search 'RTA Dubai' on Apple App Store",
      android: "Search 'RTA Dubai' on Google Play Store",
      website: "https://www.rta.ae"
    },
    "Didi": {
      name: "Didi",
      useFor: "China ride-hailing / taxi booking",
      ios: "Search 'DiDi' on Apple App Store",
      android: "Search 'DiDi' on Google Play Store",
      website: "https://www.didiglobal.com"
    },
    "Baidu Maps": {
      name: "Baidu Maps",
      useFor: "China maps and transport navigation",
      ios: "Search 'Baidu Maps' on Apple App Store",
      android: "Search 'Baidu Maps' on Android app stores",
      website: "https://map.baidu.com"
    },
    "GO Taxi": {
      name: "GO Taxi",
      useFor: "Japan taxi booking",
      ios: "Search 'GO Taxi' on Apple App Store",
      android: "Search 'GO Taxi' on Google Play Store",
      website: "https://go.goinc.jp"
    },
    "Japan Travel by NAVITIME": {
      name: "Japan Travel by NAVITIME",
      useFor: "Japan rail, metro and route planning",
      ios: "Search 'Japan Travel NAVITIME' on Apple App Store",
      android: "Search 'Japan Travel NAVITIME' on Google Play Store",
      website: "https://japantravel.navitime.com"
    },
    "Citymapper": {
      name: "Citymapper",
      useFor: "Europe city public transport routing",
      ios: "Search 'Citymapper' on Apple App Store",
      android: "Search 'Citymapper' on Google Play Store",
      website: "https://citymapper.com"
    },
    "Google Maps": {
      name: "Google Maps",
      useFor: "Navigation, transit routes and offline maps",
      ios: "Search 'Google Maps' on Apple App Store",
      android: "Search 'Google Maps' on Google Play Store",
      website: "https://maps.google.com"
    },
    "Ola": {
      name: "Ola",
      useFor: "India cab booking",
      ios: "Search 'Ola' on Apple App Store",
      android: "Search 'Ola' on Google Play Store",
      website: "https://www.olacabs.com"
    },
    "Rapido": {
      name: "Rapido",
      useFor: "India bike taxi, auto and cab options where available",
      ios: "Search 'Rapido' on Apple App Store",
      android: "Search 'Rapido' on Google Play Store",
      website: "https://www.rapido.bike"
    },
    "inDrive": {
      name: "inDrive",
      useFor: "Ride-hailing with fare negotiation in selected countries",
      ios: "Search 'inDrive' on Apple App Store",
      android: "Search 'inDrive' on Google Play Store",
      website: "https://indrive.com"
    }
  };

  return Array.from(new Set(appNames || [])).map((name) => known[name] || {
    name,
    useFor: "Local transport app",
    ios: `Search '${name}' on Apple App Store`,
    android: `Search '${name}' on Google Play Store`,
    website: ""
  });
}

function getLocalTransportGuide(destination, tripType) {
  const d = String(destination || "").toLowerCase();
  const type = String(tripType || "").toLowerCase();

  let guide = {
    destination: destination || "Selected destination",
    airportToCity: [
      { mode: "Airport taxi / cab app", example: "Use official airport taxi counter or trusted cab app", approxFare: "₹1,500 - ₹4,000 equivalent", bestFor: "Families, late arrivals, luggage" },
      { mode: "Metro / train / airport bus", example: "Use airport express / public transport where available", approxFare: "₹150 - ₹800 equivalent", bestFor: "Budget travellers, solo travellers" }
    ],
    cityTransport: [
      { mode: "Cab app", example: "Uber / local taxi app", approxFare: "Short rides ₹300 - ₹1,500 equivalent", bestFor: "Convenience" },
      { mode: "Metro / local bus", example: "Buy local travel card if available", approxFare: "₹50 - ₹400 equivalent per ride", bestFor: "Budget and predictable routes" }
    ],
    bestAreaToStay: "Stay near your main activity area to reduce local transport cost and travel fatigue.",
    safetyTips: [
      "Use official taxis or trusted cab apps, especially at night.",
      "Avoid accepting random taxi offers inside/outside airports.",
      "Keep hotel address saved offline.",
      "For family/senior travellers, prefer private taxi for late-night movement.",
      "Check last metro/bus timings before planning evening activities."
    ],
    localApps: ["Google Maps", "Uber"],
    estimatedDailyLocalTransport: "₹1,500 - ₹4,000 equivalent per day depending on transport choice",
    note: "This is a practical planning estimate, not live fare data."
  };

  if (d.includes("dubai") || d.includes("uae") || d.includes("united arab emirates")) {
    guide.destination = "Dubai / UAE";
    guide.airportToCity = [
      { mode: "Dubai Metro", example: "Red Line from DXB Terminal 1/3 to city areas", approxFare: "AED 5 - 15", bestFor: "Budget travellers, light luggage" },
      { mode: "Taxi / Careem / Uber", example: "Airport taxi, Careem or Uber from DXB", approxFare: "AED 60 - 140 depending on area", bestFor: "Families, luggage, late arrival" },
      { mode: "Hotel transfer", example: "Pre-booked hotel or private transfer", approxFare: "AED 100 - 250", bestFor: "Premium / family / senior travellers" }
    ];
    guide.cityTransport = [
      { mode: "Nol Card + Metro", example: "Use Nol card for metro, tram and buses", approxFare: "AED 3 - 15 per ride", bestFor: "Economy and predictable routes" },
      { mode: "Careem / Uber / Taxi", example: "Use Careem or Uber for point-to-point trips", approxFare: "AED 25 - 100 per ride", bestFor: "Family, business, less walking" },
      { mode: "Private car with driver", example: "Half-day or full-day car hire", approxFare: "AED 350 - 800 per day", bestFor: "Family/senior travellers, packed itinerary" }
    ];
    guide.bestAreaToStay = type.includes("business")
      ? "Business Bay, Downtown Dubai, DIFC or near expo/meeting venue."
      : type.includes("family")
        ? "Downtown Dubai, Dubai Marina, Bur Dubai or Deira depending on budget."
        : "For budget trips, Bur Dubai/Deira. For premium/leisure, Downtown or Dubai Marina.";
    guide.localApps = ["Careem", "Uber", "RTA Dubai", "Google Maps"];
    guide.estimatedDailyLocalTransport = "AED 50 - 120 by metro/taxi mix; AED 250 - 600 with more taxis/private car.";
  } else if (d.includes("thailand") || d.includes("bangkok") || d.includes("phuket") || d.includes("pattaya")) {
    guide.destination = "Thailand";
    guide.airportToCity = [
      { mode: "Airport Rail Link / train", example: "Bangkok Airport Rail Link where applicable", approxFare: "THB 15 - 45", bestFor: "Budget travellers" },
      { mode: "Grab / official taxi", example: "Use Grab or official airport taxi", approxFare: "THB 300 - 900", bestFor: "Families, luggage" },
      { mode: "Hotel transfer", example: "Pre-booked hotel transfer", approxFare: "THB 800 - 2,000", bestFor: "Late arrival, family, senior travellers" }
    ];
    guide.cityTransport = [
      { mode: "BTS/MRT", example: "Use BTS/MRT in Bangkok", approxFare: "THB 20 - 70 per ride", bestFor: "Fast city movement" },
      { mode: "Grab", example: "Grab car/bike where suitable", approxFare: "THB 80 - 400 per ride", bestFor: "Convenience" },
      { mode: "Tuk-tuk/local taxi", example: "Negotiate or use meter where possible", approxFare: "Variable", bestFor: "Short tourist rides" }
    ];
    guide.bestAreaToStay = type.includes("family")
      ? "Sukhumvit, Siam or Riverside in Bangkok; Patong/Kata/Karon in Phuket depending on comfort."
      : "Sukhumvit/Siam for first-time visitors; budget travellers can consider Pratunam/old city areas.";
    guide.localApps = ["Grab", "Bolt", "Google Maps", "BTS SkyTrain app"];
    guide.estimatedDailyLocalTransport = "THB 300 - 900 per day using BTS/MRT + Grab; higher for private taxis/day tours.";
  } else if (d.includes("japan") || d.includes("tokyo") || d.includes("osaka") || d.includes("kyoto")) {
    guide.destination = "Japan";
    guide.airportToCity = [
      { mode: "Airport train", example: "Narita Express / Keisei / Haruka depending on airport", approxFare: "JPY 1,000 - 4,000", bestFor: "Fast and reliable" },
      { mode: "Airport limousine bus", example: "Airport bus to major hotel zones", approxFare: "JPY 1,500 - 3,500", bestFor: "Luggage and hotel-area drops" },
      { mode: "Taxi", example: "Airport taxi", approxFare: "JPY 15,000 - 30,000+", bestFor: "Premium only; expensive" }
    ];
    guide.cityTransport = [
      { mode: "IC Card + Metro/train", example: "Suica/Pasmo/Icoca for metro, train and buses", approxFare: "JPY 150 - 500 per ride", bestFor: "Most travellers" },
      { mode: "Taxi", example: "Use taxi for late night or senior comfort", approxFare: "JPY 1,000 - 4,000 for short rides", bestFor: "Comfort / late night" }
    ];
    guide.bestAreaToStay = type.includes("business")
      ? "Tokyo Station, Shinagawa, Shinjuku or near meeting/expo venue."
      : "Shinjuku, Ginza/Tokyo Station, Ueno or Namba/Umeda in Osaka depending on itinerary.";
    guide.localApps = ["Google Maps", "Japan Travel by NAVITIME", "GO Taxi", "Suica/Pasmo"];
    guide.estimatedDailyLocalTransport = "JPY 800 - 2,000 per day using metro/train; more if taxis are used.";
  } else if (d.includes("china") || d.includes("shanghai") || d.includes("beijing") || d.includes("guangzhou")) {
    guide.destination = "China";
    guide.airportToCity = [
      { mode: "Metro / airport train", example: "Airport metro or Maglev/airport express where available", approxFare: "CNY 5 - 80", bestFor: "Budget and fast movement" },
      { mode: "Didi / official taxi", example: "Use Didi or official taxi queue", approxFare: "CNY 80 - 250", bestFor: "Business travellers, luggage" },
      { mode: "Hotel transfer", example: "Pre-booked transfer", approxFare: "CNY 200 - 500", bestFor: "First-time/business travellers" }
    ];
    guide.cityTransport = [
      { mode: "Metro", example: "Use city metro for most movement", approxFare: "CNY 3 - 10 per ride", bestFor: "Efficient city travel" },
      { mode: "Didi", example: "Use Didi for cabs", approxFare: "CNY 25 - 120 per ride", bestFor: "Convenience" }
    ];
    guide.bestAreaToStay = type.includes("business")
      ? "Stay near the exhibition/meeting district or central business area."
      : "Stay near metro lines and main attractions to reduce travel time.";
    guide.localApps = ["Didi", "Baidu Maps", "Alipay", "WeChat"];
    guide.estimatedDailyLocalTransport = "CNY 30 - 100 by metro; CNY 150 - 400 with taxis.";
  } else if (d.includes("schengen") || d.includes("germany") || d.includes("france") || d.includes("italy") || d.includes("spain") || d.includes("netherlands") || d.includes("switzerland")) {
    guide.destination = "Schengen / Europe";
    guide.airportToCity = [
      { mode: "Airport train/metro", example: "Use airport rail/metro where available", approxFare: "EUR 3 - 20", bestFor: "Most travellers" },
      { mode: "Taxi / Uber / Bolt", example: "Use official taxi or app cab", approxFare: "EUR 30 - 90", bestFor: "Families, luggage, late arrivals" },
      { mode: "Airport bus", example: "Airport shuttle bus", approxFare: "EUR 5 - 20", bestFor: "Budget travellers" }
    ];
    guide.cityTransport = [
      { mode: "Day pass / transport card", example: "Metro/tram/bus day pass", approxFare: "EUR 5 - 15 per day", bestFor: "Tourism and city movement" },
      { mode: "Uber/Bolt/taxi", example: "Cab apps where available", approxFare: "EUR 10 - 40 short rides", bestFor: "Night movement / luggage" }
    ];
    guide.bestAreaToStay = type.includes("business")
      ? "Near meeting venue, central station or airport if meetings are spread out."
      : "Near central station/old town/metro hub for easier sightseeing.";
    guide.localApps = ["Google Maps", "Uber", "Bolt", "Citymapper", "Local transit app"];
    guide.estimatedDailyLocalTransport = "EUR 8 - 20 using public transport; EUR 40 - 120 with taxis.";
  }

  guide.cabApps = buildCabAppLinks(guide.localApps || []);

  if (d.includes("india") || d.includes("hyderabad") || d.includes("delhi") || d.includes("mumbai") || d.includes("bangalore") || d.includes("chennai") || d.includes("goa") || d.includes("tirupati")) {
    guide.destination = "India";
    guide.airportToCity = [
      { mode: "Airport taxi / Ola / Uber", example: "Use official airport taxi, Ola or Uber", approxFare: "₹500 - ₹2,500 depending on city and distance", bestFor: "Families, luggage, late arrivals" },
      { mode: "Airport bus / metro", example: "Use airport bus/metro where available", approxFare: "₹50 - ₹300", bestFor: "Budget travellers" }
    ];
    guide.cityTransport = [
      { mode: "Ola / Uber", example: "Use app cabs for point-to-point rides", approxFare: "₹150 - ₹800 per ride", bestFor: "Convenience" },
      { mode: "Rapido / auto / local bus / metro", example: "Use metro/bus where available; Rapido/auto for short trips", approxFare: "₹30 - ₹300 per ride", bestFor: "Budget movement" }
    ];
    guide.bestAreaToStay = type.includes("business")
      ? "Stay near meeting venue, airport corridor or main business district."
      : "Stay near main sightseeing area, metro line or central location to reduce cab cost.";
    guide.localApps = ["Ola", "Uber", "Rapido", "Google Maps"];
    guide.estimatedDailyLocalTransport = "₹500 - ₹2,500 per day depending on city, cab usage and distance.";
  }

  return guide;
}

// API: Local Transport Guide
app.post("/api/local-transport-guide", requireUserOrGuest, async (req, res) => {
  try {
    const { destination, tripType, tripId } = req.body;
    if (!destination) {
      return res.status(400).json({ success: false, message: "Destination is required." });
    }

    const guide = getLocalTransportGuide(destination, tripType);
    const owner = getSessionOwner(req);
    const [result] = await pool.query(
      `INSERT INTO local_transport_guides (user_id, guest_id, trip_id, destination, guide_json)
       VALUES (?, ?, ?, ?, ?)`,
      [owner.userId, owner.guestId, Number(tripId) || null, destination, JSON.stringify(guide)]
    );
    res.json({ success: true, guideId: result.insertId, guide });
  } catch (error) {
    console.error("Local transport guide error:", error);
    res.status(500).json({ success: false, message: "Unable to generate local transport guide." });
  }
});


function buildRuleBasedTravelAssistantAnswer(question, context) {
  const q = String(question || "").toLowerCase();
  const destination = context?.destination || "your destination";
  const travelMonth = context?.travelMonth || context?.departureDate || "";
  const tripType = context?.travelType || "your trip";

  if (q.includes("miss") && q.includes("flight")) {
    return `If you miss your flight, stay calm and act quickly.

1. Go immediately to the airline counter or call the airline support number.
2. Ask whether you can be moved to the next available flight under the airline's missed-flight/no-show policy.
3. If it was a connecting flight on the same ticket, ask the airline to rebook the connection.
4. If you booked through a travel agent or OTA, contact them also.
5. Keep boarding pass, ticket, booking reference and payment card ready.
6. Inform hotel/driver/meeting contact if your arrival will be delayed.
7. Check travel insurance only if the missed flight reason is covered.

MyYatraMate tip: Always reach international airports 3 hours before departure and domestic airports 2 hours before departure.`;
  }

  if (q.includes("cash") && (q.includes("thailand") || destination.toLowerCase().includes("thailand"))) {
    return `For Thailand, carry a practical mix of cash and card.

Suggested approach for Indian travellers:
- Keep some Thai Baht cash for airport transfer, local food, markets and emergency use.
- Carry an international debit/credit card or forex card for hotels, shopping and larger payments.
- Avoid carrying all money in one place.
- Keep emergency INR/USD separately if needed.
- For visa/entry checks, proof of funds requirements can change, so verify latest official Thailand entry rules before travel.

Practical planning estimate:
For a short leisure trip, many travellers keep around THB 5,000-10,000 cash per person and use card/forex for the rest. Adjust based on family size, shopping and itinerary.`;
  }

  if ((q.includes("vegetarian") || q.includes("veg")) && (q.includes("dubai") || destination.toLowerCase().includes("dubai") || destination.toLowerCase().includes("uae"))) {
    return `Vegetarian food plan for Dubai:

Breakfast:
- Hotel breakfast with fruits, bread, dosa/idli if available, cereal, yogurt.
- Indian restaurants in Bur Dubai, Deira, Karama and Discovery Gardens are good options.

Lunch:
- Indian vegetarian thali / North Indian / South Indian meal.
- Mall food courts usually have vegetarian choices.

Dinner:
- Choose areas like Bur Dubai, Karama, Deira, Downtown or Dubai Marina based on your stay.
- Keep one light dinner option if sightseeing is heavy.

Useful tips:
- Search for "pure vegetarian Indian restaurant near me".
- Jain food is available in many Indian restaurants, but call ahead.
- Carry light snacks if travelling with children or senior citizens.
- If diabetic-friendly food is needed, avoid sugary drinks and choose grilled/low-carb options where possible.`;
  }

  if ((q.includes("cif") || q.includes("fob")) && (q.includes("business") || q.includes("shipment") || q.includes("export") || q.includes("import"))) {
    return `CIF and FOB are common Incoterms used in international trade.

FOB - Free On Board:
- Seller delivers goods onto the vessel at the port of shipment.
- Buyer usually pays ocean freight, insurance and destination charges.
- Risk usually transfers once goods are loaded on board.

CIF - Cost, Insurance and Freight:
- Seller pays cost, insurance and freight up to the destination port.
- Buyer handles import clearance, duties and local delivery after arrival.
- Risk transfer and cost responsibility should be reviewed carefully in the contract.

Simple business travel example:
If you are meeting a supplier, ask whether their quoted price is FOB port or CIF destination port. CIF may look convenient, but compare freight, insurance and destination charges before deciding.`;
  }

  if (q.includes("medicine") || q.includes("medicines") || q.includes("tablet") || q.includes("prescription")) {
    return `Carrying medicines internationally:

1. Carry medicines in original packaging.
2. Keep a doctor's prescription, especially for regular medication.
3. Carry only reasonable personal-use quantity.
4. Keep critical medicines in cabin baggage, not only check-in baggage.
5. Check destination rules for controlled medicines, sleeping pills, pain medicines, injections or syrups.
6. For diabetes, thyroid, BP or heart medicines, keep prescription and a short medical note.
7. Some countries restrict common medicines, so verify with official customs/embassy guidance before travel.

MyYatraMate tip: Prepare a small medicine pouch with prescription copy, dosage list and emergency contact.`;
  }

  if (q.includes("pack") && (q.includes("china") || destination.toLowerCase().includes("china")) && (q.includes("june") || travelMonth.toLowerCase().includes("june"))) {
    return `Packing for China in June:

Clothing:
- Light breathable clothes for warm/humid weather.
- One light jacket or shirt for air-conditioned meeting halls.
- Comfortable walking shoes.
- Business attire if attending meetings/expo.

Weather readiness:
- Compact umbrella or rain jacket.
- Sunscreen and sunglasses.
- Reusable water bottle.

Travel essentials:
- Passport, visa, invitation letter if business, hotel booking and flight details.
- VPN/connectivity planning where legally appropriate and allowed.
- Translation app and offline maps.
- Power adapter, power bank.
- Basic medicines with prescription.

Business traveller tip:
Carry printed company profile, business cards, invitation letters and meeting addresses in English and Chinese if available.`;
  }

  return `Here is a practical MyYatraMate answer for your question:

Question: ${question}

For ${tripType} to ${destination}, plan with these principles:
1. Keep documents ready: passport, visa if required, tickets, hotel booking, insurance and emergency contacts.
2. Keep local transport options ready before arrival.
3. Carry a small emergency fund and at least one working card/forex option.
4. Save hotel address and key contacts offline.
5. Check destination-specific rules for visa, medicines, customs and arrival forms from official sources.
6. For family/senior travel, reduce walking, keep rest breaks and avoid late-night uncertainty.

Note: For legal, immigration, airline or medical rules, verify from official sources because rules change.`;
}

async function generateAITravelAssistantAnswer(question, context) {
  if (!GEMINI_API_KEY) return null;

  const prompt = `
You are MyYatraMate's premium AI travel assistant for Indian and global travellers.

Answer the user's travel question clearly and practically.

User question:
${question}

Available app context:
- From city: ${context.fromCity || "Not specified"}
- Destination: ${context.destination || "Not specified"}
- Departure date: ${context.departureDate || "Not specified"}
- Return date: ${context.returnDate || "Not specified"}
- Travel type: ${context.travelType || "Not specified"}
- Budget style: ${context.budgetStyle || "Not specified"}
- Food preference: ${context.foodPref || "Not specified"}
- Travel pace: ${context.travelPace || "Not specified"}
- Family profile: ${context.familyProfile || "Not specified"}
- Special needs: ${context.specialNeeds || "Not specified"}

Rules:
- Be practical and traveller-friendly.
- If the user asks about visa, immigration, medicine, customs, airline rules, or country restrictions, include a clear warning to verify official sources.
- Do not pretend to have live government/airline data.
- For business trade terms like CIF/FOB, explain simply with examples.
- For packing, food, money, local transport, missed flight, documents, safety, give actionable steps.
- Keep answer structured with headings and bullets.
`;

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.45, topP: 0.9, maxOutputTokens: 3072 }
    })
  });

  if (!response.ok) {
    console.error("Gemini travel assistant error:", response.status, await response.text());
    return null;
  }

  const data = await response.json();
  const answer = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
  return answer || null;
}

// API: AI Travel Assistant Chat
app.post("/api/ai-travel-chat", requireUserOrGuest, async (req, res) => {
  try {
    const { question, context } = req.body;

    if (!question || !String(question).trim()) {
      return res.status(400).json({ success: false, message: "Please enter a travel question." });
    }

    const owner = getSessionOwner(req);
    const cleanQuestion = String(question).trim();
    const safeContext = context || {};

    let source = "fallback";
    let answer = null;

    try {
      answer = await generateAITravelAssistantAnswer(cleanQuestion, safeContext);
      if (answer) source = "gemini-ai";
    } catch (error) {
      console.error("AI travel assistant failed:", error);
      answer = null;
    }

    if (!answer) {
      answer = buildRuleBasedTravelAssistantAnswer(cleanQuestion, safeContext);
    }

    const [result] = await pool.query(
      `INSERT INTO ai_travel_chat_history
       (user_id, guest_id, question, answer, context_json, source)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [owner.userId, owner.guestId, cleanQuestion, answer, JSON.stringify(safeContext), source]
    );

    res.json({
      success: true,
      chatId: result.insertId,
      source,
      answer
    });
  } catch (error) {
    console.error("AI travel chat error:", error);
    res.status(500).json({ success: false, message: "Unable to answer right now: " + error.message });
  }
});

// API: AI Travel Assistant Chat History
app.get("/api/ai-travel-chat/history", requireUserOrGuest, async (req, res) => {
  try {
    const owner = getSessionOwner(req);
    const [rows] = await pool.query(
      `SELECT id, question, answer, source, created_at AS createdAt
       FROM ai_travel_chat_history
       WHERE (user_id <=> ?) AND (guest_id <=> ?)
       ORDER BY created_at DESC
       LIMIT 25`,
      [owner.userId, owner.guestId]
    );

    res.json({ success: true, history: rows });
  } catch (error) {
    console.error("AI travel chat history error:", error);
    res.status(500).json({ success: false, message: "Unable to load chat history." });
  }
});


function safeJSONParseWorkflow(value, fallback = {}) {
  try { return JSON.parse(value || "{}"); } catch (error) { return fallback; }
}

async function tryWorkflowQuery(sql, params = []) {
  try {
    const [rows] = await pool.query(sql, params);
    return rows || [];
  } catch (error) {
    console.warn("Workflow optional query skipped:", error.message);
    return [];
  }
}

function normalizeWorkflowTrip(row) {
  return {
    id: row.id,
    title: row.title || row.tripTitle || `${row.destination || "Trip"} ${row.departureDate ? "- " + row.departureDate : ""}`,
    fromCity: row.fromCity || row.from_city || "",
    destination: row.destination || "",
    days: row.days || "",
    travellers: row.travellers || "",
    travelType: row.travelType || row.travel_type || "",
    budgetStyle: row.budgetStyle || row.budget_style || "",
    foodPref: row.foodPref || row.food_pref || "",
    departureDate: row.departureDate || row.departure_date || "",
    returnDate: row.returnDate || row.return_date || "",
    createdAt: row.createdAt || row.created_at || ""
  };
}

function buildWorkflowSteps({ trip, budgets, visaChecklists, docs, transportSaved, packingSaved }) {
  const hasTrip = !!trip;
  const hasBudget = (budgets || []).length > 0;
  const hasVisa = (visaChecklists || []).length > 0;
  const docTypes = (docs || []).map((d) => String(d.documentType || d.document_type || "").toLowerCase());
  const hasPassport = docTypes.some((t) => t.includes("passport"));
  const hasVisaDoc = docTypes.some((t) => t.includes("visa"));
  const hasTicket = docTypes.some((t) => t.includes("ticket") || t.includes("boarding") || t.includes("flight"));
  const hasHotel = docTypes.some((t) => t.includes("hotel"));
  const hasInsurance = docTypes.some((t) => t.includes("insurance"));
  const hasDocs = docs && docs.length > 0;
  const hasTransport = !!transportSaved;
  const hasPacking = !!packingSaved;

  const steps = [
    { key: "trip", label: "Trip Plan", status: hasTrip ? "completed" : "pending", module: "plan", message: hasTrip ? "Trip plan created." : "Create your trip plan first." },
    { key: "budget", label: "Smart Budget", status: hasBudget ? "completed" : "pending", module: "budget", message: hasBudget ? "Budget estimate available." : "Generate budget estimate." },
    { key: "visa", label: "Visa Checklist", status: hasVisa ? "completed" : "pending", module: "visa", message: hasVisa ? "Visa checklist generated." : "Generate visa checklist." },
    { key: "transport", label: "Local Transport", status: hasTransport ? "completed" : "pending", module: "transport", message: hasTransport ? "Transport guide generated on this browser." : "Generate local transport guide." },
    { key: "docs", label: "Document Vault", status: hasDocs ? (hasPassport && hasTicket ? "completed" : "attention") : "pending", module: "vault", message: hasDocs ? "Documents saved. Check missing essentials." : "Upload passport, visa, ticket, hotel and insurance." },
    { key: "packing", label: "Packing", status: hasPacking ? "completed" : "pending", module: "packing", message: hasPacking ? "Packing checklist started on this browser." : "Create packing checklist." },
    { key: "readiness", label: "Trip Readiness", status: hasTrip && hasBudget && hasVisa && hasPassport && hasTicket ? "completed" : "attention", module: "readiness", message: "Review final travel readiness score." }
  ];

  const readinessItems = [
    { label: "Trip plan created", done: hasTrip },
    { label: "Budget estimate completed", done: hasBudget },
    { label: "Visa checklist generated", done: hasVisa },
    { label: "Passport uploaded", done: hasPassport },
    { label: "Visa document uploaded if required", done: hasVisaDoc },
    { label: "Flight ticket / boarding pass uploaded", done: hasTicket },
    { label: "Hotel booking uploaded", done: hasHotel },
    { label: "Travel insurance uploaded", done: hasInsurance },
    { label: "Local transport guide generated", done: hasTransport },
    { label: "Packing checklist started", done: hasPacking }
  ];

  const doneCount = readinessItems.filter((item) => item.done).length;
  const score = Math.round((doneCount / readinessItems.length) * 100);

  return { steps, readinessItems, score };
}

// API: Guided Workflow Summary
app.post("/api/workflow-summary", requireUserOrGuest, async (req, res) => {
  try {
    const owner = getSessionOwner(req);
    const { activeTripId, localSignals } = req.body || {};

    let trips = await tryWorkflowQuery(
      `SELECT id, from_city AS fromCity, destination, days, travellers, travel_type AS travelType,
              budget_style AS budgetStyle, food_pref AS foodPref, departure_date AS departureDate,
              return_date AS returnDate, created_at AS createdAt
       FROM trip_plans
       WHERE (user_id <=> ?) AND (guest_id <=> ?)
       ORDER BY created_at DESC`,
      [owner.userId, owner.guestId]
    );

    trips = trips.map(normalizeWorkflowTrip);

    let activeTrip = null;
    if (activeTripId) {
      activeTrip = trips.find((trip) => String(trip.id) === String(activeTripId)) || null;
    }
    if (!activeTrip && trips.length) activeTrip = trips[0];

    const budgets = await tryWorkflowQuery(
      `SELECT id, trip_id AS tripId, destination, grand_total AS grandTotal, per_person AS perPerson, created_at AS createdAt
       FROM budgets
       WHERE (user_id <=> ?) AND (guest_id <=> ?)
       ORDER BY created_at DESC`,
      [owner.userId, owner.guestId]
    );

    const visaChecklists = await tryWorkflowQuery(
      `SELECT id, trip_id AS tripId, destination, passport_country AS passportCountry, created_at AS createdAt
       FROM visa_checklists
       WHERE (user_id <=> ?) AND (guest_id <=> ?)
       ORDER BY created_at DESC`,
      [owner.userId, owner.guestId]
    );

    const docs = await tryWorkflowQuery(
      `SELECT id, trip_id AS tripId, profile_name AS profileName, document_type AS documentType, document_name AS documentName,
              expiry_date AS expiryDate, created_at AS createdAt
       FROM travel_document_vault
       WHERE (user_id <=> ?) AND (guest_id <=> ?)
       ORDER BY created_at DESC`,
      [owner.userId, owner.guestId]
    );

    const signals = localSignals || {};
    const workflow = buildWorkflowSteps({
      trip: activeTrip,
      budgets,
      visaChecklists,
      docs,
      transportSaved: !!signals.transportSaved,
      packingSaved: !!signals.packingSaved
    });

    res.json({
      success: true,
      activeTrip,
      trips,
      counts: {
        trips: trips.length,
        budgets: budgets.length,
        visaChecklists: visaChecklists.length,
        documents: docs.length
      },
      documents: docs,
      ...workflow
    });
  } catch (error) {
    console.error("Workflow summary error:", error);
    res.status(500).json({ success: false, message: "Unable to load workflow summary: " + error.message });
  }
});

// Protected admin pages
app.get("/admin", requireAdmin, (req, res) => {
  const body = `
    <h1>MyYatraMate Admin Dashboard</h1>
    ${adminNav()}
    <div class="card">
      <h2>Admin Status</h2>
      <p>The MVP admin pages are working with MySQL database, admin login and user accounts.</p>
      <p><strong>Logged in as:</strong> ${escapeHtml(req.session.adminUsername || "admin")}</p>
      <p><strong>Next upgrade:</strong> real AI integration and PDF exports.</p>
    </div>
  `;
  res.send(pageShell("MyYatraMate Admin", body));
});

app.get("/admin/users", requireAdmin, async (req, res) => {
  const [users] = await pool.query(`SELECT id, name, email, created_at FROM users ORDER BY id DESC`);

  const rows = users.length
    ? users.map((user, index) => `
      <tr><td>${index + 1}</td><td>${escapeHtml(user.name)}</td><td>${escapeHtml(user.email)}</td><td>${new Date(user.created_at).toLocaleString()}</td></tr>
    `).join("")
    : `<tr><td colspan="4">No registered users yet.</td></tr>`;

  res.send(pageShell("MyYatraMate Users", `
    <h1>MyYatraMate Users</h1>
    ${adminNav()}
    <table><thead><tr><th>S.No</th><th>Name</th><th>Email</th><th>Created</th></tr></thead><tbody>${rows}</tbody></table>
  `));
});

app.get("/admin/leads", requireAdmin, async (req, res) => {
  const [leads] = await pool.query(`SELECT * FROM early_access_leads ORDER BY id DESC`);

  const rows = leads.length
    ? leads.map((lead, index) => `
      <tr><td>${index + 1}</td><td>${escapeHtml(lead.name)}</td><td>${escapeHtml(lead.email)}</td><td>${escapeHtml(lead.phone)}</td><td>${escapeHtml(lead.traveller_type)}</td><td>${new Date(lead.created_at).toLocaleString()}</td></tr>
    `).join("")
    : `<tr><td colspan="6">No early access leads yet.</td></tr>`;

  res.send(pageShell("MyYatraMate Leads", `
    <h1>MyYatraMate Early Access Leads</h1>
    ${adminNav()}
    <table><thead><tr><th>S.No</th><th>Name</th><th>Email</th><th>Phone</th><th>Traveller Type</th><th>Date</th></tr></thead><tbody>${rows}</tbody></table>
  `));
});

app.get("/admin/trips", requireAdmin, async (req, res) => {
  const [trips] = await pool.query(`
    SELECT t.*, u.name AS user_name, u.email AS user_email
    FROM trip_plans t
    LEFT JOIN users u ON t.user_id = u.id
    ORDER BY t.id DESC
  `);

  const cards = trips.length
    ? trips.map((trip, index) => `
      <div class="card">
        <h2>${index + 1}. ${escapeHtml(trip.destination)} - ${escapeHtml(trip.days)} Days</h2>
        <div class="meta">
          Owner: ${trip.user_name ? escapeHtml(trip.user_name + " (" + trip.user_email + ")") : escapeHtml(trip.guest_id || "Old/Unassigned")} |
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

  res.send(pageShell("MyYatraMate Trip Plans", `
    <h1>MyYatraMate Generated Trip Plans</h1>
    ${adminNav()}
    ${cards}
  `));
});

app.get("/admin/budgets", requireAdmin, async (req, res) => {
  const [budgets] = await pool.query(`
    SELECT b.*, u.name AS user_name, u.email AS user_email
    FROM budgets b
    LEFT JOIN users u ON b.user_id = u.id
    ORDER BY b.id DESC
  `);

  const cards = budgets.length
    ? budgets.map((budget, index) => `
      <div class="card">
        <h2>${index + 1}. ${escapeHtml(budget.destination)}</h2>
        <div class="meta">
          Owner: ${budget.user_name ? escapeHtml(budget.user_name + " (" + budget.user_email + ")") : escapeHtml(budget.guest_id || "Old/Unassigned")} |
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

  res.send(pageShell("MyYatraMate Budget Estimates", `
    <h1>MyYatraMate Budget Estimates</h1>
    ${adminNav()}
    ${cards}
  `));
});

app.get("/admin/expenses", requireAdmin, async (req, res) => {
  const [expenses] = await pool.query(`
    SELECT e.*, u.name AS user_name, u.email AS user_email
    FROM expenses e
    LEFT JOIN users u ON e.user_id = u.id
    ORDER BY e.id DESC
  `);

  const rows = expenses.length
    ? expenses.map((expense, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${expense.user_name ? escapeHtml(expense.user_name + " (" + expense.user_email + ")") : escapeHtml(expense.guest_id || "Old/Unassigned")}</td>
        <td>${escapeHtml(expense.trip_name)}</td>
        <td>${escapeHtml(expense.category)}</td>
        <td>${escapeHtml(expense.currency)}</td>
        <td>${Number(expense.amount || 0).toLocaleString("en-IN")}</td>
        <td>${escapeHtml(expense.note)}</td>
        <td>${new Date(expense.created_at).toLocaleString()}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="8">No expenses added yet.</td></tr>`;

  res.send(pageShell("MyYatraMate Expenses", `
    <h1>MyYatraMate Expenses</h1>
    ${adminNav()}
    <table><thead><tr><th>S.No</th><th>Owner</th><th>Trip</th><th>Category</th><th>Currency</th><th>Amount</th><th>Note</th><th>Date</th></tr></thead><tbody>${rows}</tbody></table>
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
