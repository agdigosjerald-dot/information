/**
 * BIR / TIN, SSS & Pag-IBIG Application Assistance System
 * Developed by: Mark Jerald Agdigos
 * Complete Single-File Production-Ready Application (app.js)
 * Enhanced with 20+ Advanced Features, Multilingual Support (English/Tagalog), and Modern UI/UX.
 */

const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer Storage Configuration with Security Check
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|pdf|doc|docx/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    } else {
      cb(new Error('Only images, PDF, and DOC documents are allowed!'));
    }
  }
});

// Database Setup (SQLite for persistence)
const dbFile = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbFile, (err) => {
  if (err) {
    console.error('Error opening database', err.message);
  } else {
    console.log('Connected to the SQLite database.');
    initDatabase();
  }
});

function initDatabase() {
  db.serialize(() => {
    // Users (Customers) with Language Preference and Status
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT,
      full_name TEXT,
      mobile_number TEXT,
      email_address TEXT,
      language TEXT DEFAULT 'en',
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Admin Users
    db.run(`CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT,
      role TEXT DEFAULT 'Super Admin',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, () => {
      const defaultAdminUser = process.env.ADMIN_USERNAME || 'admin';
      const defaultAdminPass = process.env.ADMIN_PASSWORD || 'admin123';
      db.get(`SELECT * FROM admin_users WHERE username = ?`, [defaultAdminUser], async (err, row) => {
        if (!row) {
          const hashedPassword = await bcrypt.hash(defaultAdminPass, 10);
          db.run(`INSERT INTO admin_users (username, password, role) VALUES (?, ?, ?)`, [defaultAdminUser, hashedPassword, 'Super Admin']);
        }
      });
    });

    // Settings
    db.run(`CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )`, () => {
      const defaultSettings = {
        business_name: 'GovAssist PH - Application Assistance',
        developer_name: 'Mark Jerald Agdigos',
        logo_url: '',
        contact_number: '+63 912 345 6789',
        email: 'support@govassist.ph',
        address: 'Manila, Philippines',
        gcash_qr: '',
        gcash_name: 'GovAssist Admin (Mark Jerald Agdigos)',
        gcash_number: '09123456789',
        fee_bir: '500',
        fee_sss: '400',
        fee_pagibig: '400',
        maintenance_mode: '0',
        announcement: 'Welcome to GovAssist PH! Fast and secure government application assistance.',
        payment_instructions: '1. Scan GCash QR or send to the number provided.\n2. Upload clear proof of payment.\n3. Wait for admin verification (usually within 24 hours).'
      };
      for (const [key, value] of Object.entries(defaultSettings)) {
        db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`, [key, value]);
      }
    });

    // Applications with Priority and Notes
    db.run(`CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER,
      service TEXT,
      tracking_number TEXT UNIQUE,
      status TEXT DEFAULT 'Submitted',
      payment_status TEXT DEFAULT 'Payment Pending',
      priority TEXT DEFAULT 'Normal',
      admin_remarks TEXT,
      data_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Beneficiaries
    db.run(`CREATE TABLE IF NOT EXISTS beneficiaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id INTEGER,
      full_name TEXT,
      birth_date TEXT,
      relationship TEXT,
      address TEXT,
      contact_number TEXT
    )`);

    // Documents
    db.run(`CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id INTEGER,
      doc_type TEXT,
      file_path TEXT,
      file_name TEXT,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Completed Files (Uploaded by Admin)
    db.run(`CREATE TABLE IF NOT EXISTS completed_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id INTEGER,
      file_path TEXT,
      file_name TEXT,
      file_type TEXT,
      description TEXT,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Payments
    db.run(`CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER,
      application_id INTEGER,
      tracking_number TEXT,
      service TEXT,
      payment_method TEXT,
      amount REAL,
      reference_number TEXT,
      proof_path TEXT,
      payment_status TEXT DEFAULT 'Pending Verification',
      admin_notes TEXT,
      verified_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Status History
    db.run(`CREATE TABLE IF NOT EXISTS status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id INTEGER,
      status TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Notifications
    db.run(`CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER,
      title TEXT,
      message TEXT,
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Customer Support Tickets (Feature #15)
    db.run(`CREATE TABLE IF NOT EXISTS support_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER,
      subject TEXT,
      message TEXT,
      status TEXT DEFAULT 'Open',
      admin_reply TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Activity Logs / Audit Trail (Feature #16)
    db.run(`CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_type TEXT,
      user_id INTEGER,
      action TEXT,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
  });
}

// Middleware Configuration
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));
app.use('/uploads', express.static(uploadDir));

app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: __dirname }),
  secret: process.env.SESSION_SECRET || 'govassist_secure_secret_key_mark_jerald_agdigos',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Multi-language Translations Dictionary (Feature #17: Select Language English/Tagalog)
const translations = {
  en: {
    home_title: "Fast & Hassle-Free Government Application Assistance",
    home_subtitle: "Developed by Mark Jerald Agdigos. We assist you with your BIR/TIN, SSS, and Pag-IBIG registrations securely and professionally.",
    get_started: "Get Started Now",
    track_app: "Track Application",
    customer_login: "Customer Login",
    register: "Register",
    dashboard: "Dashboard",
    new_application: "+ New Application",
    my_applications: "My Applications",
    completed_documents: "Completed Documents",
    notifications: "Notifications",
    support_tickets: "Support Tickets",
    profile: "Profile",
    logout: "Logout",
    disclaimer: "Government Disclaimer: This platform is an application assistance, document collection, processing, payment, and tracking platform. It is not the official website of BIR, SSS, or Pag-IBIG."
  },
  tl: {
    home_title: "Mabilis at Walang Hassle na Tulong sa Gobyerno",
    home_subtitle: "Binuo ni Mark Jerald Agdigos. Tinutulungan ka namin sa iyong BIR/TIN, SSS, at Pag-IBIG registrations nang mabilis at ligtas.",
    get_started: "Magsimula Na",
    track_app: "I-track ang Aplikasyon",
    customer_login: "Login ng Kliyente",
    register: "Mag-rehistro",
    dashboard: "Dashboard",
    new_application: "+ Bagong Aplikasyon",
    my_applications: "Aking mga Aplikasyon",
    completed_documents: "Mga Tapos na Dokumento",
    notifications: "Mga Abiso",
    support_tickets: "Tulong / Support",
    profile: "Profile",
    logout: "Mag-logout",
    disclaimer: "Disclaimer: Ang sistemang ito ay platform ng pagtulong sa pag-aapply at pag-track ng mga dokumento. Hindi ito ang opisyal na website ng BIR, SSS, o Pag-IBIG."
  }
};

// Helper Functions
async function getSettings() {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM settings`, [], (err, rows) => {
      if (err) reject(err);
      else {
        const settings = {};
        rows.forEach(r => settings[r.key] = r.value);
        resolve(settings);
      }
    });
  });
}

function addNotification(customerId, title, message) {
  db.run(`INSERT INTO notifications (customer_id, title, message) VALUES (?, ?, ?)`, [customerId, title, message]);
}

function logActivity(userType, userId, action, details) {
  db.run(`INSERT INTO activity_logs (user_type, user_id, action, details) VALUES (?, ?, ?, ?)`, [userType, userId, action, details]);
}

// Global Middleware
app.use(async (req, res, next) => {
  try {
    res.locals.settings = await getSettings();
    res.locals.customer = req.session.customer || null;
    res.locals.admin = req.session.admin || null;
    
    // Language setup
    let lang = req.query.lang || (req.session.customer ? req.session.customer.language : 'en');
    if (!translations[lang]) lang = 'en';
    res.locals.lang = lang;
    res.locals.t = translations[lang];
    next();
  } catch (e) {
    next();
  }
});

// Language Switcher Route (Feature #17)
app.get('/set-language/:lang', (req, res) => {
  const lang = req.params.lang;
  if (translations[lang]) {
    if (req.session.customer) {
      req.session.customer.language = lang;
      db.run(`UPDATE users SET language = ? WHERE id = ?`, [lang, req.session.customer.id]);
    }
    res.cookie('preferred_lang', lang);
  }
  res.redirect(req.get('referer') || '/');
});

// ==========================================
// LANDING PAGE & PUBLIC PORTAL
// ==========================================
app.get('/', async (req, res) => {
  const settings = res.locals.settings;
  const t = res.locals.t;
  const lang = res.locals.lang;

  if (settings.maintenance_mode === '1' && !req.session.admin) {
    return res.send(`<body style="font-family:sans-serif; text-align:center; padding-top:100px; background:#f3f4f6;"><h1>System Under Maintenance</h1><p>We are currently updating our services. Please check back later.</p><p><small>Developed by ${settings.developer_name}</small></p></body>`);
  }

  res.send(`
    <!DOCTYPE html>
    <html lang="${lang}">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${settings.business_name} - by ${settings.developer_name}</title>
      <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
    </head>
    <body class="bg-gradient-to-br from-slate-50 to-blue-50 text-gray-800 font-sans min-h-screen flex flex-col justify-between">
      <header class="bg-blue-900 text-white shadow-lg sticky top-0 z-50">
        <div class="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <div class="flex items-center space-x-3">
            <span class="text-2xl font-black tracking-wider">GOVASSIST <span class="text-emerald-400">PH</span></span>
          </div>
          <div class="flex items-center space-x-4">
            <div class="flex bg-blue-800 rounded p-1 text-xs font-semibold">
              <a href="/set-language/en" class="px-2 py-1 rounded ${lang === 'en' ? 'bg-blue-600 text-white' : 'text-blue-200'}">EN</a>
              <a href="/set-language/tl" class="px-2 py-1 rounded ${lang === 'tl' ? 'bg-blue-600 text-white' : 'text-blue-200'}">TL</a>
            </div>
            <a href="/customer/login" class="px-4 py-2 bg-blue-700 hover:bg-blue-600 rounded text-sm font-semibold shadow">${t.customer_login}</a>
            <a href="/customer/register" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded text-sm font-semibold shadow">${t.register}</a>
          </div>
        </div>
      </header>

      <main class="max-w-7xl mx-auto px-4 py-16">
        <div class="text-center max-w-3xl mx-auto mb-16">
          <span class="bg-blue-100 text-blue-800 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-widest mb-4 inline-block">Secure Online Assistance Portal</span>
          <h1 class="text-4xl md:text-5xl font-extrabold text-blue-900 mb-6 leading-tight">${t.home_title}</h1>
          <p class="text-lg text-gray-600 mb-8">${t.home_subtitle}</p>
          <div class="flex justify-center gap-4 flex-wrap">
            <a href="/customer/register" class="px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg transition transform hover:-translate-y-0.5">${t.get_started}</a>
            <a href="/track-public" class="px-8 py-4 bg-white border border-gray-300 hover:bg-gray-100 text-blue-900 font-bold rounded-xl shadow transition">${t.track_app}</a>
          </div>
        </div>

        <div class="grid md:grid-cols-3 gap-8 mb-16">
          <div class="bg-white p-8 rounded-2xl shadow-xl border border-gray-100 text-center hover:shadow-2xl transition">
            <div class="text-4xl mb-4 bg-blue-50 w-16 h-16 mx-auto flex items-center justify-center rounded-2xl">🏢</div>
            <h3 class="text-2xl font-bold text-blue-900 mb-3">BIR / TIN</h3>
            <p class="text-gray-600 text-sm leading-relaxed">Tax Identification Number registration assistance for employed, self-employed, mixed-income, and newly graduated individuals.</p>
          </div>
          <div class="bg-white p-8 rounded-2xl shadow-xl border border-gray-100 text-center hover:shadow-2xl transition">
            <div class="text-4xl mb-4 bg-emerald-50 w-16 h-16 mx-auto flex items-center justify-center rounded-2xl">🛡️</div>
            <h3 class="text-2xl font-bold text-emerald-900 mb-3">SSS Registration</h3>
            <p class="text-gray-600 text-sm leading-relaxed">Social Security System membership application, beneficiary listing, voluntary contributions, and digital profile support.</p>
          </div>
          <div class="bg-white p-8 rounded-2xl shadow-xl border border-gray-100 text-center hover:shadow-2xl transition">
            <div class="text-4xl mb-4 bg-amber-50 w-16 h-16 mx-auto flex items-center justify-center rounded-2xl">🏠</div>
            <h3 class="text-2xl font-bold text-amber-900 mb-3">Pag-IBIG Fund</h3>
            <p class="text-gray-600 text-sm leading-relaxed">HDMF MID number application assistance, membership registration, provident savings, and housing loan assistance guidance.</p>
          </div>
        </div>

        <div class="bg-amber-50 border-l-4 border-amber-500 p-6 rounded-r-xl text-amber-900 text-sm shadow-sm">
          <strong>${t.disclaimer}</strong>
        </div>
      </main>

      <footer class="bg-gray-900 text-gray-400 py-8 text-center text-sm border-t border-gray-800">
        <p>&copy; 2026 ${settings.business_name}. All rights reserved. | Developed by <strong class="text-white">${settings.developer_name}</strong></p>
      </footer>
    </body>
    </html>
  `);
});

// Public Tracking Page (Feature #1)
app.get('/track-public', (req, res) => {
  const trackingNumber = req.query.tracking_number ? req.query.tracking_number.trim() : '';
  let queryResult = null;

  if (trackingNumber) {
    db.get(`SELECT * FROM applications WHERE tracking_number = ?`, [trackingNumber], (err, app) => {
      queryResult = app;
      renderTrackPage(res, trackingNumber, queryResult);
    });
  } else {
    renderTrackPage(res, '', null);
  }
});

function renderTrackPage(res, trackingNumber, result) {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Track Application - GovAssist PH</title>
      <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
    </head>
    <body class="bg-gray-50 text-gray-800 font-sans min-h-screen flex flex-col justify-between">
      <div class="max-w-2xl mx-auto px-4 py-16 w-full">
        <div class="text-center mb-8">
          <h1 class="text-3xl font-extrabold text-blue-900">Track Your Application</h1>
          <p class="text-sm text-gray-600 mt-2">Enter your unique tracking number below to check real-time status.</p>
        </div>
        <form action="/track-public" method="GET" class="bg-white p-8 rounded-2xl shadow-xl space-y-4 mb-8">
          <div>
            <label class="block text-sm font-semibold mb-2">Tracking Number</label>
            <input type="text" name="tracking_number" value="${trackingNumber}" required placeholder="e.g. TIN-20260901-0001" class="w-full border rounded-xl px-4 py-3 uppercase font-mono text-lg focus:ring-2 focus:ring-blue-500 outline-none">
          </div>
          <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl shadow-lg transition">Search Status</button>
        </form>

        ${trackingNumber ? `
          <div class="bg-white p-8 rounded-2xl shadow-xl space-y-4 border">
            <h3 class="text-xl font-bold text-blue-900 border-b pb-2">Tracking Result for: <span class="font-mono text-blue-600">${trackingNumber}</span></h3>
            ${result ? `
              <div class="space-y-3">
                <p><strong>Service:</strong> ${result.service}</p>
                <p><strong>Status:</strong> <span class="px-3 py-1 bg-blue-100 text-blue-800 rounded-full font-bold text-xs">${result.status}</span></p>
                <p><strong>Payment Status:</strong> <span class="px-3 py-1 bg-amber-100 text-amber-800 rounded-full font-bold text-xs">${result.payment_status}</span></p>
                <p><strong>Admin Remarks:</strong> ${result.admin_remarks || 'None yet.'}</p>
                <p><strong>Date Submitted:</strong> ${result.created_at}</p>
              </div>
            ` : `
              <p class="text-red-600 font-semibold text-center py-4">No application found matching this tracking number. Please check and try again.</p>
            `}
          </div>
        ` : ''}

        <div class="text-center mt-6">
          <a href="/" class="text-blue-600 hover:underline font-semibold text-sm">&larr; Back to Home</a>
        </div>
      </div>
    </body>
    </html>
  `);
}

// ==========================================
// CUSTOMER AUTHENTICATION
// ==========================================
app.get('/customer/register', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Customer Registration - GovAssist PH</title>
      <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
    </head>
    <body class="bg-gradient-to-br from-blue-900 to-indigo-900 flex items-center justify-center min-h-screen p-4">
      <div class="bg-white w-full max-w-md p-8 rounded-2xl shadow-2xl">
        <h2 class="text-2xl font-black text-blue-900 mb-2 text-center">Create Customer Account</h2>
        <p class="text-xs text-gray-500 text-center mb-6">System developed by Mark Jerald Agdigos</p>
        <form action="/customer/register" method="POST" class="space-y-4">
          <div>
            <label class="block text-sm font-semibold mb-1">Full Name</label>
            <input type="text" name="full_name" required class="w-full border rounded-xl px-4 py-2.5" placeholder="Juan Dela Cruz">
          </div>
          <div>
            <label class="block text-sm font-semibold mb-1">Username</label>
            <input type="text" name="username" required class="w-full border rounded-xl px-4 py-2.5" placeholder="juandelacruz">
          </div>
          <div>
            <label class="block text-sm font-semibold mb-1">Mobile Number</label>
            <input type="text" name="mobile_number" required class="w-full border rounded-xl px-4 py-2.5" placeholder="09123456789">
          </div>
          <div>
            <label class="block text-sm font-semibold mb-1">Email Address</label>
            <input type="email" name="email_address" required class="w-full border rounded-xl px-4 py-2.5" placeholder="juan@example.com">
          </div>
          <div>
            <label class="block text-sm font-semibold mb-1">Password</label>
            <input type="password" name="password" required class="w-full border rounded-xl px-4 py-2.5">
          </div>
          <div>
            <label class="block text-sm font-semibold mb-1">Confirm Password</label>
            <input type="password" name="confirm_password" required class="w-full border rounded-xl px-4 py-2.5">
          </div>
          <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl shadow-lg transition">Register Account</button>
        </form>
        <p class="text-center text-sm mt-6 text-gray-600">Already have an account? <a href="/customer/login" class="text-blue-600 font-semibold hover:underline">Login here</a></p>
      </div>
    </body>
    </html>
  `);
});

app.post('/customer/register', async (req, res) => {
  const { username, password, confirm_password, full_name, mobile_number, email_address } = req.body;
  if (password !== confirm_password) {
    return res.send(`<script>alert('Passwords do not match!'); window.history.back();</script>`);
  }
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    db.run(`INSERT INTO users (username, password, full_name, mobile_number, email_address) VALUES (?, ?, ?, ?, ?)`,
      [username, hashedPassword, full_name, mobile_number, email_address], function(err) {
        if (err) {
          return res.send(`<script>alert('Username already exists or invalid data!'); window.history.back();</script>`);
        }
        logActivity('customer', this.lastID, 'Register', 'Customer registered account successfully');
        res.redirect('/customer/login');
      });
  } catch (e) {
    res.send(`<script>alert('Registration error!'); window.history.back();</script>`);
  }
});

app.get('/customer/login', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Customer Login - GovAssist PH</title>
      <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
    </head>
    <body class="bg-gradient-to-br from-blue-900 to-indigo-900 flex items-center justify-center min-h-screen p-4">
      <div class="bg-white w-full max-w-md p-8 rounded-2xl shadow-2xl">
        <h2 class="text-2xl font-black text-blue-900 mb-2 text-center">Customer Login</h2>
        <p class="text-xs text-gray-500 text-center mb-6">System developed by Mark Jerald Agdigos</p>
        <form action="/customer/login" method="POST" class="space-y-4">
          <div>
            <label class="block text-sm font-semibold mb-1">Username</label>
            <input type="text" name="username" required class="w-full border rounded-xl px-4 py-2.5">
          </div>
          <div>
            <label class="block text-sm font-semibold mb-1">Password</label>
            <input type="password" name="password" required class="w-full border rounded-xl px-4 py-2.5">
          </div>
          <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl shadow-lg transition">Login</button>
        </form>
        <p class="text-center text-sm mt-6 text-gray-600">Don't have an account? <a href="/customer/register" class="text-blue-600 font-semibold hover:underline">Register here</a></p>
        <div class="text-center mt-3"><a href="/" class="text-gray-500 hover:underline text-xs">&larr; Back to home</a></div>
      </div>
    </body>
    </html>
  `);
});

app.post('/customer/login', (req, res) => {
  const { username, password } = req.body;
  db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
    if (user && user.is_active === 0) {
      return res.send(`<script>alert('Your account has been deactivated by admin.'); window.history.back();</script>`);
    }
    if (user && await bcrypt.compare(password, user.password)) {
      req.session.customer = { id: user.id, username: user.username, full_name: user.full_name, email: user.email_address, language: user.language || 'en' };
      logActivity('customer', user.id, 'Login', 'Customer logged in successfully');
      res.redirect('/customer/dashboard');
    } else {
      res.send(`<script>alert('Invalid username or password!'); window.history.back();</script>`);
    }
  });
});

app.get('/customer/logout', requireCustomer, (req, res) => {
  logActivity('customer', req.session.customer.id, 'Logout', 'Customer logged out');
  req.session.customer = null;
  res.redirect('/customer/login');
});

// ==========================================
// ADMIN AUTHENTICATION
// ==========================================
app.get('/admin/login', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Admin Login - GovAssist PH</title>
      <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
    </head>
    <body class="bg-gray-900 flex items-center justify-center min-h-screen p-4">
      <div class="bg-white w-full max-w-md p-8 rounded-2xl shadow-2xl">
        <h2 class="text-2xl font-black text-gray-900 mb-2 text-center">Admin Portal</h2>
        <p class="text-xs text-gray-500 text-center mb-6">Created by Mark Jerald Agdigos</p>
        <form action="/admin/login" method="POST" class="space-y-4">
          <div>
            <label class="block text-sm font-semibold mb-1">Admin Username</label>
            <input type="text" name="username" required class="w-full border rounded-xl px-4 py-2.5">
          </div>
          <div>
            <label class="block text-sm font-semibold mb-1">Password</label>
            <input type="password" name="password" required class="w-full border rounded-xl px-4 py-2.5">
          </div>
          <button type="submit" class="w-full bg-gray-900 hover:bg-gray-800 text-white font-bold py-3 rounded-xl shadow-lg transition">Login to Admin</button>
        </form>
        <div class="text-center mt-4"><a href="/" class="text-gray-500 hover:underline text-xs">&larr; Back to home</a></div>
      </div>
    </body>
    </html>
  `);
});

app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  db.get(`SELECT * FROM admin_users WHERE username = ?`, [username], async (err, admin) => {
    if (admin && await bcrypt.compare(password, admin.password)) {
      req.session.admin = { id: admin.id, username: admin.username, role: admin.role };
      logActivity('admin', admin.id, 'Login', 'Admin logged in');
      res.redirect('/admin/dashboard');
    } else {
      res.send(`<script>alert('Invalid admin credentials!'); window.history.back();</script>`);
    }
  });
});

app.get('/admin/logout', requireAdmin, (req, res) => {
  logActivity('admin', req.session.admin.id, 'Logout', 'Admin logged out');
  req.session.admin = null;
  res.redirect('/admin/login');
});

// Middleware Protections
function requireCustomer(req, res, next) {
  if (!req.session.customer) return res.redirect('/customer/login');
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.admin) return res.redirect('/admin/login');
  next();
}

// ==========================================
// CUSTOMER PORTAL & DASHBOARD LAYOUT
// ==========================================
function customerLayout(title, content, activeTab, unreadCount = 0, reqSession = null) {
  const customerName = reqSession && reqSession.customer ? reqSession.customer.full_name : '';
  const lang = reqSession && reqSession.customer ? reqSession.customer.language : 'en';

  return `
    <!DOCTYPE html>
    <html lang="${lang}">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title} - GovAssist PH</title>
      <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
    </head>
    <body class="bg-gray-50 text-gray-800 font-sans">
      <div class="min-h-screen flex flex-col md:flex-row">
        <aside class="bg-blue-900 text-white w-full md:w-72 p-6 flex flex-col justify-between shadow-xl">
          <div>
            <div class="text-xl font-black mb-8 flex items-center justify-between">
              <span>GOVASSIST <span class="text-emerald-400">PH</span></span>
              <div class="flex bg-blue-800 rounded p-1 text-xs font-semibold">
                <a href="/set-language/en" class="px-2 py-0.5 rounded ${lang === 'en' ? 'bg-blue-600 text-white' : 'text-blue-200'}">EN</a>
                <a href="/set-language/tl" class="px-2 py-0.5 rounded ${lang === 'tl' ? 'bg-blue-600 text-white' : 'text-blue-200'}">TL</a>
              </div>
            </div>
            <nav class="space-y-1.5">
              <a href="/customer/dashboard" class="block px-4 py-3 rounded-xl font-semibold transition ${activeTab === 'dashboard' ? 'bg-blue-800 text-white shadow' : 'text-blue-100 hover:bg-blue-800'}">📊 Dashboard</a>
              <a href="/customer/apply" class="block px-4 py-3 rounded-xl font-semibold transition ${activeTab === 'apply' ? 'bg-blue-800 text-white shadow' : 'text-blue-100 hover:bg-blue-800'}">📝 New Application</a>
              <a href="/customer/applications" class="block px-4 py-3 rounded-xl font-semibold transition ${activeTab === 'applications' ? 'bg-blue-800 text-white shadow' : 'text-blue-100 hover:bg-blue-800'}">📂 My Applications</a>
              <a href="/customer/documents" class="block px-4 py-3 rounded-xl font-semibold transition ${activeTab === 'documents' ? 'bg-blue-800 text-white shadow' : 'text-blue-100 hover:bg-blue-800'}">📥 Completed Documents</a>
              <a href="/customer/payments" class="block px-4 py-3 rounded-xl font-semibold transition ${activeTab === 'payments' ? 'bg-blue-800 text-white shadow' : 'text-blue-100 hover:bg-blue-800'}">💳 Payment History</a>
              <a href="/customer/notifications" class="block px-4 py-3 rounded-xl font-semibold transition ${activeTab === 'notifications' ? 'bg-blue-800 text-white shadow' : 'text-blue-100 hover:bg-blue-800'}">🔔 Notifications ${unreadCount > 0 ? `<span class="bg-red-500 text-white px-2 py-0.5 rounded-full text-xs ml-2">${unreadCount}</span>` : ''}</a>
              <a href="/customer/support" class="block px-4 py-3 rounded-xl font-semibold transition ${activeTab === 'support' ? 'bg-blue-800 text-white shadow' : 'text-blue-100 hover:bg-blue-800'}">💬 Support & Help</a>
              <a href="/customer/profile" class="block px-4 py-3 rounded-xl font-semibold transition ${activeTab === 'profile' ? 'bg-blue-800 text-white shadow' : 'text-blue-100 hover:bg-blue-800'}">👤 Profile Settings</a>
            </nav>
          </div>
          <div class="mt-8 pt-4 border-t border-blue-800">
            <span class="block text-xs text-blue-200 mb-2 truncate">User: <strong>${customerName}</strong></span>
            <span class="block text-[10px] text-blue-300 mb-3">Dev: Mark Jerald Agdigos</span>
            <a href="/customer/logout" class="block text-center bg-red-600 hover:bg-red-700 text-white py-2.5 rounded-xl text-sm font-bold shadow transition">Logout</a>
          </div>
        </aside>
        
        <main class="flex-1 p-6 md:p-12 overflow-y-auto">
          ${content}
        </main>
      </div>
    </body>
    </html>
  `;
}

// Customer Dashboard (Enhanced with stats and summaries)
app.get('/customer/dashboard', requireCustomer, async (req, res) => {
  const customerId = req.session.customer.id;
  db.all(`SELECT * FROM applications WHERE customer_id = ? ORDER BY id DESC`, [customerId], async (err, apps) => {
    db.all(`SELECT * FROM notifications WHERE customer_id = ? AND is_read = 0`, [customerId], async (err2, notifs) => {
      db.all(`SELECT * FROM payments WHERE customer_id = ?`, [customerId], async (err3, payments) => {
        const totalApps = apps.length;
        const pendingApps = apps.filter(a => a.status === 'Submitted' || a.status === 'Under Review').length;
        const completedApps = apps.filter(a => a.status === 'Completed').length;
        const totalSpent = payments.filter(p => p.payment_status === 'Verified').reduce((sum, p) => sum + p.amount, 0);

        const content = `
          <div class="flex justify-between items-center mb-8 flex-wrap gap-4">
            <div>
              <h1 class="text-3xl font-black text-blue-900">Customer Dashboard</h1>
              <p class="text-sm text-gray-500 mt-1">Welcome back, ${req.session.customer.full_name}!</p>
            </div>
            <a href="/customer/apply" class="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl font-bold shadow-lg transition">+ New Application</a>
          </div>
          
          <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <div class="bg-white p-6 rounded-2xl shadow-xl border-l-4 border-blue-600">
              <h3 class="text-gray-400 text-xs font-bold uppercase tracking-wider">Total Applications</h3>
              <p class="text-3xl font-black text-blue-900 mt-2">${totalApps}</p>
            </div>
            <div class="bg-white p-6 rounded-2xl shadow-xl border-l-4 border-amber-500">
              <h3 class="text-gray-400 text-xs font-bold uppercase tracking-wider">Pending / In Progress</h3>
              <p class="text-3xl font-black text-amber-600 mt-2">${pendingApps}</p>
            </div>
            <div class="bg-white p-6 rounded-2xl shadow-xl border-l-4 border-emerald-600">
              <h3 class="text-gray-400 text-xs font-bold uppercase tracking-wider">Completed</h3>
              <p class="text-3xl font-black text-emerald-600 mt-2">${completedApps}</p>
            </div>
            <div class="bg-white p-6 rounded-2xl shadow-xl border-l-4 border-indigo-600">
              <h3 class="text-gray-400 text-xs font-bold uppercase tracking-wider">Total Verified Payments</h3>
              <p class="text-3xl font-black text-indigo-900 mt-2">₱${totalSpent.toLocaleString()}</p>
            </div>
          </div>

          <div class="bg-white p-8 rounded-2xl shadow-xl mb-8">
            <div class="flex justify-between items-center mb-6">
              <h2 class="text-xl font-bold text-blue-900">Recent Applications</h2>
              <a href="/customer/applications" class="text-blue-600 font-semibold text-sm hover:underline">View All &rarr;</a>
            </div>
            ${apps.length === 0 ? `<p class="text-gray-500 text-sm py-4 text-center">No applications submitted yet.</p>` : `
              <div class="overflow-x-auto">
                <table class="w-full text-left border-collapse">
                  <thead>
                    <tr class="border-b bg-gray-50 text-xs text-gray-500 uppercase">
                      <th class="p-4">Tracking Number</th>
                      <th class="p-4">Service</th>
                      <th class="p-4">Status</th>
                      <th class="p-4">Payment</th>
                      <th class="p-4">Action</th>
                    </tr>
                  </thead>
                  <tbody class="text-sm">
                    ${apps.slice(0, 5).map(app => `
                      <tr class="border-b hover:bg-gray-50/50 transition">
                        <td class="p-4 font-mono font-bold text-blue-900">${app.tracking_number}</td>
                        <td class="p-4 font-semibold">${app.service}</td>
                        <td class="p-4"><span class="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-bold">${app.status}</span></td>
                        <td class="p-4"><span class="px-3 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-bold">${app.payment_status}</span></td>
                        <td class="p-4"><a href="/customer/track/${app.id}" class="text-blue-600 font-bold hover:underline">View Details</a></td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            `}
          </div>
        `;
        res.send(customerLayout('Dashboard', content, 'dashboard', notifs.length, req.session));
      });
    });
  });
});

// Feature #2 & #3: Multi-Step Application Wizard with Beneficiaries and Document Uploads
app.get('/customer/apply', requireCustomer, async (req, res) => {
  const settings = res.locals.settings;
  const content = `
    <h1 class="text-3xl font-black text-blue-900 mb-2">New Government Application</h1>
    <p class="text-xs text-gray-500 mb-6">System developed by Mark Jerald Agdigos</p>
    
    <form action="/customer/apply" method="POST" enctype="multipart/form-data" class="bg-white p-8 rounded-2xl shadow-2xl space-y-8" id="appForm">
      
      <div class="space-y-4">
        <h2 class="text-xl font-bold text-blue-900 border-b pb-2">Step 1: Select Service & Priority</h2>
        <div class="grid md:grid-cols-3 gap-4">
          <label class="border-2 p-5 rounded-2xl cursor-pointer hover:border-blue-600 flex flex-col justify-between transition">
            <div>
              <input type="radio" name="service" value="BIR / TIN" required class="mb-2" onchange="updateFee()">
              <span class="font-bold block text-lg text-blue-900">BIR / TIN</span>
              <span class="text-sm text-gray-500">Tax ID Registration. Fee: ₱${settings.fee_bir}</span>
            </div>
          </label>
          <label class="border-2 p-5 rounded-2xl cursor-pointer hover:border-blue-600 flex flex-col justify-between transition">
            <div>
              <input type="radio" name="service" value="SSS" required class="mb-2" onchange="updateFee()">
              <span class="font-bold block text-lg text-emerald-900">SSS</span>
              <span class="text-sm text-gray-500">Social Security System. Fee: ₱${settings.fee_sss}</span>
            </div>
          </label>
          <label class="border-2 p-5 rounded-2xl cursor-pointer hover:border-blue-600 flex flex-col justify-between transition">
            <div>
              <input type="radio" name="service" value="PAG-IBIG" required class="mb-2" onchange="updateFee()">
              <span class="font-bold block text-lg text-amber-900">Pag-IBIG</span>
              <span class="text-sm text-gray-500">HDMF Membership. Fee: ₱${settings.fee_pagibig}</span>
            </div>
          </label>
        </div>
        <div>
          <label class="block text-sm font-semibold mb-1">Processing Priority</label>
          <select name="priority" class="w-full border rounded-xl px-4 py-2.5 bg-white">
            <option value="Normal">Normal Processing (Standard)</option>
            <option value="Rush">Rush Processing (+ Fast Track)</option>
          </select>
        </div>
      </div>

      <div class="space-y-4">
        <h2 class="text-xl font-bold text-blue-900 border-b pb-2">Step 2: Personal Information</h2>
        <div class="grid md:grid-cols-3 gap-4">
          <div><label class="block text-sm font-semibold mb-1">First Name *</label><input type="text" name="first_name" required class="w-full border rounded-xl px-4 py-2.5"></div>
          <div><label class="block text-sm font-semibold mb-1">Middle Name</label><input type="text" name="middle_name" class="w-full border rounded-xl px-4 py-2.5"></div>
          <div><label class="block text-sm font-semibold mb-1">Last Name *</label><input type="text" name="last_name" required class="w-full border rounded-xl px-4 py-2.5"></div>
          <div><label class="block text-sm font-semibold mb-1">Suffix</label><input type="text" name="suffix" class="w-full border rounded-xl px-4 py-2.5" placeholder="Jr., III"></div>
          <div><label class="block text-sm font-semibold mb-1">Date of Birth *</label><input type="date" name="date_of_birth" required class="w-full border rounded-xl px-4 py-2.5"></div>
          <div><label class="block text-sm font-semibold mb-1">Place of Birth *</label><input type="text" name="place_of_birth" required class="w-full border rounded-xl px-4 py-2.5"></div>
          <div><label class="block text-sm font-semibold mb-1">Sex *</label><select name="sex" required class="w-full border rounded-xl px-4 py-2.5"><option value="Male">Male</option><option value="Female">Female</option></select></div>
          <div>
            <label class="block text-sm font-semibold mb-1">Civil Status *</label>
            <select name="civil_status" id="civilStatus" required class="w-full border rounded-xl px-4 py-2.5" onchange="toggleMarriage()">
              <option value="Single">Single</option>
              <option value="Married">Married</option>
              <option value="Widowed">Widowed</option>
              <option value="Separated">Separated</option>
            </select>
          </div>
          <div><label class="block text-sm font-semibold mb-1">Nationality *</label><input type="text" name="nationality" value="Filipino" required class="w-full border rounded-xl px-4 py-2.5"></div>
        </div>
      </div>

      <div class="space-y-4">
        <h2 class="text-xl font-bold text-blue-900 border-b pb-2">Step 3: Contact & Address Information</h2>
        <div class="grid md:grid-cols-2 gap-4">
          <div><label class="block text-sm font-semibold mb-1">Mobile Number *</label><input type="text" name="mobile_number" required class="w-full border rounded-xl px-4 py-2.5" placeholder="09123456789"></div>
          <div><label class="block text-sm font-semibold mb-1">Email Address *</label><input type="email" name="email_address" required class="w-full border rounded-xl px-4 py-2.5" placeholder="juan@example.com"></div>
        </div>
        <div class="grid md:grid-cols-3 gap-4">
          <div><label class="block text-sm font-semibold mb-1">Street / Unit *</label><input type="text" name="street" required class="w-full border rounded-xl px-4 py-2.5"></div>
          <div><label class="block text-sm font-semibold mb-1">Barangay *</label><input type="text" name="barangay" required class="w-full border rounded-xl px-4 py-2.5"></div>
          <div><label class="block text-sm font-semibold mb-1">City / Municipality *</label><input type="text" name="city" required class="w-full border rounded-xl px-4 py-2.5"></div>
          <div><label class="block text-sm font-semibold mb-1">Province *</label><input type="text" name="province" required class="w-full border rounded-xl px-4 py-2.5"></div>
          <div><label class="block text-sm font-semibold mb-1">ZIP Code *</label><input type="text" name="zip_code" required class="w-full border rounded-xl px-4 py-2.5"></div>
        </div>
      </div>

      <div class="space-y-4">
        <h2 class="text-xl font-bold text-blue-900 border-b pb-2">Step 4: Parents & Spouse Information</h2>
        <div class="grid md:grid-cols-2 gap-4">
          <div><label class="block text-sm font-semibold mb-1">Father's Full Name *</label><input type="text" name="father_name" required class="w-full border rounded-xl px-4 py-2.5"></div>
          <div><label class="block text-sm font-semibold mb-1">Father's Date of Birth *</label><input type="date" name="father_dob" required class="w-full border rounded-xl px-4 py-2.5"></div>
          <div><label class="block text-sm font-semibold mb-1">Mother's Maiden Full Name *</label><input type="text" name="mother_maiden_name" required class="w-full border rounded-xl px-4 py-2.5"></div>
          <div><label class="block text-sm font-semibold mb-1">Mother's Date of Birth *</label><input type="date" name="mother_dob" required class="w-full border rounded-xl px-4 py-2.5"></div>
        </div>
        <div id="marriageSection" class="hidden p-6 bg-gray-50 border rounded-2xl space-y-4 mt-4">
          <h3 class="font-bold text-blue-900">Spouse Details (Married Applicants)</h3>
          <div class="grid md:grid-cols-2 gap-4">
            <div><label class="block text-sm font-semibold mb-1">Spouse Full Name</label><input type="text" name="spouse_name" class="w-full border rounded-xl px-4 py-2.5 bg-white"></div>
            <div><label class="block text-sm font-semibold mb-1">Spouse Date of Birth</label><input type="date" name="spouse_dob" class="w-full border rounded-xl px-4 py-2.5 bg-white"></div>
            <div><label class="block text-sm font-semibold mb-1">Marriage Date</label><input type="date" name="marriage_date" class="w-full border rounded-xl px-4 py-2.5 bg-white"></div>
            <div><label class="block text-sm font-semibold mb-1">Marriage Certificate</label><input type="file" name="marriage_certificate" accept="image/*,application/pdf" class="w-full border rounded-xl px-4 py-2 bg-white"></div>
          </div>
        </div>
      </div>

      <div class="space-y-4">
        <h2 class="text-xl font-bold text-blue-900 border-b pb-2">Step 5: Employment Information</h2>
        <div class="grid md:grid-cols-2 gap-4">
          <div><label class="block text-sm font-semibold mb-1">Employment Status *</label><select name="employment_status" required class="w-full border rounded-xl px-4 py-2.5"><option value="Employed">Employed</option><option value="Self-Employed">Self-Employed</option><option value="Unemployed">Unemployed</option><option value="OFW">OFW</option></select></div>
          <div><label class="block text-sm font-semibold mb-1">Occupation</label><input type="text" name="occupation" class="w-full border rounded-xl px-4 py-2.5"></div>
          <div><label class="block text-sm font-semibold mb-1">Employer Name</label><input type="text" name="employer_name" class="w-full border rounded-xl px-4 py-2.5"></div>
          <div><label class="block text-sm font-semibold mb-1">Employer Address</label><input type="text" name="employer_address" class="w-full border rounded-xl px-4 py-2.5"></div>
        </div>
      </div>

      <div class="space-y-4">
        <h2 class="text-xl font-bold text-blue-900 border-b pb-2">Step 6: Beneficiaries</h2>
        <div id="beneficiariesList" class="space-y-4">
          <div class="border p-6 rounded-2xl bg-gray-50 space-y-4">
            <h4 class="font-bold text-sm text-blue-900">Beneficiary 1</h4>
            <div class="grid md:grid-cols-3 gap-4">
              <div><label class="block text-xs font-semibold mb-1">Full Name</label><input type="text" name="ben_name[]" class="w-full border rounded-xl px-4 py-2 bg-white"></div>
              <div><label class="block text-xs font-semibold mb-1">Date of Birth</label><input type="date" name="ben_dob[]" class="w-full border rounded-xl px-4 py-2 bg-white"></div>
              <div><label class="block text-xs font-semibold mb-1">Relationship</label><input type="text" name="ben_relationship[]" class="w-full border rounded-xl px-4 py-2 bg-white"></div>
              <div class="md:col-span-2"><label class="block text-xs font-semibold mb-1">Address</label><input type="text" name="ben_address[]" class="w-full border rounded-xl px-4 py-2 bg-white"></div>
              <div><label class="block text-xs font-semibold mb-1">Contact Number</label><input type="text" name="ben_contact[]" class="w-full border rounded-xl px-4 py-2 bg-white"></div>
            </div>
          </div>
        </div>
        <button type="button" onclick="addBeneficiary()" class="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-xl text-sm font-bold shadow transition">+ Add Beneficiary</button>
      </div>

      <div class="space-y-4">
        <h2 class="text-xl font-bold text-blue-900 border-b pb-2">Step 7: Valid ID & Photos Upload</h2>
        <div class="grid md:grid-cols-2 gap-4">
          <div><label class="block text-sm font-semibold mb-1">Valid ID Type *</label><select name="id_type" required class="w-full border rounded-xl px-4 py-2.5"><option value="National ID">National ID</option><option value="Passport">Passport</option><option value="Driver's License">Driver's License</option><option value="UMID">UMID</option><option value="Postal ID">Postal ID</option></select></div>
          <div><label class="block text-sm font-semibold mb-1">ID / Profile Picture *</label><input type="file" name="id_picture" accept="image/*" required class="w-full border rounded-xl px-4 py-2 bg-white"></div>
          <div><label class="block text-sm font-semibold mb-1">Valid ID Front *</label><input type="file" name="id_front" accept="image/*,application/pdf" required class="w-full border rounded-xl px-4 py-2 bg-white"></div>
          <div><label class="block text-sm font-semibold mb-1">Valid ID Back</label><input type="file" name="id_back" accept="image/*,application/pdf" class="w-full border rounded-xl px-4 py-2 bg-white"></div>
          <div class="md:col-span-2"><label class="block text-sm font-semibold mb-1">Photo Holding Valid ID *</label><input type="file" name="photo_holding_id" accept="image/*" required class="w-full border rounded-xl px-4 py-2 bg-white"></div>
        </div>
      </div>

      <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-black py-4 rounded-xl shadow-xl text-lg transition">Submit Application Now</button>
    </form>

    <script>
      function toggleMarriage() {
        const val = document.getElementById('civilStatus').value;
        const sec = document.getElementById('marriageSection');
        if (val === 'Married') sec.classList.remove('hidden');
        else sec.classList.add('hidden');
      }
      function addBeneficiary() {
        const list = document.getElementById('beneficiariesList');
        const count = list.children.length + 1;
        const div = document.createElement('div');
        div.className = 'border p-6 rounded-2xl bg-gray-50 space-y-4';
        div.innerHTML = \`<h4 class="font-bold text-sm text-blue-950">Beneficiary \${count}</h4>
          <div class="grid md:grid-cols-3 gap-4">
            <div><label class="block text-xs font-semibold mb-1">Full Name</label><input type="text" name="ben_name[]" class="w-full border rounded-xl px-4 py-2 bg-white"></div>
            <div><label class="block text-xs font-semibold mb-1">Date of Birth</label><input type="date" name="ben_dob[]" class="w-full border rounded-xl px-4 py-2 bg-white"></div>
            <div><label class="block text-xs font-semibold mb-1">Relationship</label><input type="text" name="ben_relationship[]" class="w-full border rounded-xl px-4 py-2 bg-white"></div>
            <div class="md:col-span-2"><label class="block text-xs font-semibold mb-1">Address</label><input type="text" name="ben_address[]" class="w-full border rounded-xl px-4 py-2 bg-white"></div>
            <div><label class="block text-xs font-semibold mb-1">Contact Number</label><input type="text" name="ben_contact[]" class="w-full border rounded-xl px-4 py-2 bg-white"></div>
          </div>\`;
        list.appendChild(div);
      }
    </script>
  `;
  res.send(customerLayout('New Application', content, 'apply', 0, req.session));
});

app.post('/customer/apply', requireCustomer, upload.fields([
  { name: 'id_picture', maxCount: 1 },
  { name: 'id_front', maxCount: 1 },
  { name: 'id_back', maxCount: 1 },
  { name: 'photo_holding_id', maxCount: 1 },
  { name: 'marriage_certificate', maxCount: 1 }
]), async (req, res) => {
  const customerId = req.session.customer.id;
  const { service, priority, first_name, last_name, civil_status } = req.body;
  
  const prefix = service === 'BIR / TIN' ? 'TIN' : service === 'SSS' ? 'SSS' : 'PAG';
  const trackingNumber = `${prefix}-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Math.floor(1000 + Math.random() * 9000)}`;

  const formData = req.body;
  const files = req.files || {};
  
  const docRecords = [];
  for (const [key, fileArr] of Object.entries(files)) {
    if (fileArr && fileArr[0]) {
      docRecords.push({ doc_type: key, file_path: '/uploads/' + fileArr[0].filename, file_name: fileArr[0].originalname });
    }
  }

  db.run(`INSERT INTO applications (customer_id, service, tracking_number, priority, data_json) VALUES (?, ?, ?, ?, ?)`,
    [customerId, service, trackingNumber, priority || 'Normal', JSON.stringify({ formData, documents: docRecords })], function(err) {
      if (err) return res.send(`<script>alert('Error submitting application!'); window.history.back();</script>`);
      const appId = this.lastID;

      // Insert beneficiaries if any
      if (formData.ben_name && Array.isArray(formData.ben_name)) {
        for (let i = 0; i < formData.ben_name.length; i++) {
          if (formData.ben_name[i]) {
            db.run(`INSERT INTO beneficiaries (application_id, full_name, birth_date, relationship, address, contact_number) VALUES (?, ?, ?, ?, ?, ?)`,
              [appId, formData.ben_name[i], formData.ben_dob[i], formData.ben_relationship[i], formData.ben_address[i], formData.ben_contact[i]]);
          }
        }
      }

      // Insert documents
      docRecords.forEach(d => {
        db.run(`INSERT INTO documents (application_id, doc_type, file_path, file_name) VALUES (?, ?, ?, ?)`, [appId, d.doc_type, d.file_path, d.file_name]);
      });

      addNotification(customerId, 'Application Submitted', `Your application for ${service} has been successfully submitted. Tracking #: ${trackingNumber}`);
      logActivity('customer', customerId, 'New Application', `Submitted application ${trackingNumber} for ${service}`);

      res.redirect(`/customer/track/${appId}`);
    });
});

// Customer Applications List
app.get('/customer/applications', requireCustomer, (req, res) => {
  const customerId = req.session.customer.id;
  db.all(`SELECT * FROM applications WHERE customer_id = ? ORDER BY id DESC`, [customerId], (err, apps) => {
    const content = `
      <h1 class="text-3xl font-black text-blue-900 mb-6">My Applications</h1>
      <div class="bg-white p-8 rounded-2xl shadow-xl">
        ${apps.length === 0 ? `<p class="text-gray-500 text-center py-6">No applications found.</p>` : `
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse">
              <thead>
                <tr class="border-b bg-gray-50 text-xs text-gray-500 uppercase">
                  <th class="p-4">Tracking Number</th>
                  <th class="p-4">Service</th>
                  <th class="p-4">Priority</th>
                  <th class="p-4">Status</th>
                  <th class="p-4">Payment</th>
                  <th class="p-4">Action</th>
                </tr>
              </thead>
              <tbody class="text-sm">
                ${apps.map(app => `
                  <tr class="border-b hover:bg-gray-50/50 transition">
                    <td class="p-4 font-mono font-bold text-blue-900">${app.tracking_number}</td>
                    <td class="p-4 font-semibold">${app.service}</td>
                    <td class="p-4"><span class="px-2 py-1 bg-gray-100 rounded text-xs font-bold">${app.priority}</span></td>
                    <td class="p-4"><span class="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-bold">${app.status}</span></td>
                    <td class="p-4"><span class="px-3 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-bold">${app.payment_status}</span></td>
                    <td class="p-4"><a href="/customer/track/${app.id}" class="text-blue-600 font-bold hover:underline">View & Pay</a></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    `;
    res.send(customerLayout('My Applications', content, 'applications', 0, req.session));
  });
});

// Detailed Application View & Payment Submission (Feature #4 & #5)
app.get('/customer/track/:id', requireCustomer, (req, res) => {
  const appId = req.params.id;
  const customerId = req.session.customer.id;

  db.get(`SELECT * FROM applications WHERE id = ? AND customer_id = ?`, [appId, customerId], (err, app) => {
    if (!app) return res.send(`<script>alert('Application not found!'); window.location.href='/customer/applications';</script>`);
    
    db.all(`SELECT * FROM beneficiaries WHERE application_id = ?`, [appId], (err2, bens) => {
      db.all(`SELECT * FROM completed_files WHERE application_id = ?`, [appId], (err3, completedFiles) => {
        db.all(`SELECT * FROM payments WHERE application_id = ?`, [appId], (err4, payments) => {
          const settings = res.locals.settings;
          const fee = app.service === 'BIR / TIN' ? settings.fee_bir : app.service === 'SSS' ? settings.fee_sss : settings.fee_pagibig;

          const content = `
            <div class="flex justify-between items-center mb-6 flex-wrap gap-4">
              <div>
                <h1 class="text-3xl font-black text-blue-900">Application Details</h1>
                <p class="text-sm font-mono text-blue-600 font-bold mt-1">${app.tracking_number}</p>
              </div>
              <a href="/customer/applications" class="bg-gray-200 hover:bg-gray-300 px-4 py-2 rounded-xl text-sm font-bold transition">&larr; Back to List</a>
            </div>

            <div class="grid md:grid-cols-2 gap-8 mb-8">
              <div class="bg-white p-8 rounded-2xl shadow-xl space-y-4">
                <h2 class="text-xl font-bold text-blue-900 border-b pb-2">Status & Overview</h2>
                <p><strong>Service:</strong> ${app.service}</p>
                <p><strong>Priority:</strong> ${app.priority}</p>
                <p><strong>Status:</strong> <span class="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-bold">${app.status}</span></p>
                <p><strong>Payment Status:</strong> <span class="px-3 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-bold">${app.payment_status}</span></p>
                <p><strong>Admin Remarks:</strong> ${app.admin_remarks || 'None yet.'}</p>
                <p><strong>Submitted Date:</strong> ${app.created_at}</p>
                <a href="/customer/print/${app.id}" target="_blank" class="inline-block bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-sm font-bold shadow transition">🖨️ Print Application Summary</a>
              </div>

              <div class="bg-white p-8 rounded-2xl shadow-xl space-y-4">
                <h2 class="text-xl font-bold text-blue-900 border-b pb-2">Payment Details (Fee: ₱${fee})</h2>
                <div class="bg-blue-50 p-4 rounded-xl text-xs space-y-1 text-blue-900 whitespace-pre-line font-medium">${settings.payment_instructions}</div>
                <p><strong>GCash Name:</strong> ${settings.gcash_name}</p>
                <p><strong>GCash Number:</strong> <span class="font-mono font-bold text-blue-600">${settings.gcash_number}</span></p>
                
                <form action="/customer/pay/${app.id}" method="POST" enctype="multipart/form-data" class="space-y-3 pt-4 border-t">
                  <div><label class="block text-xs font-semibold mb-1">GCash Reference Number *</label><input type="text" name="reference_number" required class="w-full border rounded-xl px-3 py-2 bg-white" placeholder="123456789"></div>
                  <div><label class="block text-xs font-semibold mb-1">Upload Proof of Payment (Screenshot) *</label><input type="file" name="proof" accept="image/*" required class="w-full border rounded-xl px-3 py-1 bg-white text-xs"></div>
                  <input type="hidden" name="amount" value="${fee}">
                  <button type="submit" class="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-xl shadow transition text-sm">Submit Payment Proof</button>
                </form>
              </div>
            </div>

            <div class="bg-white p-8 rounded-2xl shadow-xl mb-8 space-y-4">
              <h2 class="text-xl font-bold text-blue-900 border-b pb-2">Completed Government Documents (Uploaded by Admin)</h2>
              ${completedFiles.length === 0 ? `<p class="text-gray-500 text-sm">No completed files uploaded by admin yet. Once processed, your official forms will appear here.</p>` : `
                <div class="grid md:grid-cols-2 gap-4">
                  ${completedFiles.map(f => `
                    <div class="border p-4 rounded-xl flex justify-between items-center bg-gray-50">
                      <div>
                        <h4 class="font-bold text-sm text-blue-900">${f.file_name}</h4>
                        <p class="text-xs text-gray-500">${f.description || 'Processed document'}</p>
                      </div>
                      <a href="${f.file_path}" target="_blank" class="bg-blue-600 text-white px-4 py-2 rounded-xl text-xs font-bold shadow hover:bg-blue-700">Download</a>
                    </div>
                  `).join('')}
                </div>
              `}
            </div>

            <div class="bg-white p-8 rounded-2xl shadow-xl space-y-4">
              <h2 class="text-xl font-bold text-blue-900 border-b pb-2">Beneficiaries (${bens.length})</h2>
              ${bens.length === 0 ? `<p class="text-gray-500 text-sm">No beneficiaries listed.</p>` : `
                <div class="grid md:grid-cols-2 gap-4">
                  ${bens.map((b, i) => `
                    <div class="border p-4 rounded-xl bg-gray-50 text-sm space-y-1">
                      <p><strong>${i+1}. ${b.full_name}</strong> (${b.relationship})</p>
                      <p class="text-xs text-gray-500">DOB: ${b.birth_date} | Contact: ${b.contact_number || 'N/A'}</p>
                      <p class="text-xs text-gray-500">Address: ${b.address || 'N/A'}</p>
                    </div>
                  `).join('')}
                </div>
              `}
            </div>
          `;
          res.send(customerLayout('Application Details', content, 'applications', 0, req.session));
        });
      });
    });
  });
});

app.post('/customer/pay/:id', requireCustomer, upload.single('proof'), (req, res) => {
  const appId = req.params.id;
  const customerId = req.session.customer.id;
  const { reference_number, amount } = req.body;
  const proofPath = req.file ? '/uploads/' + req.file.filename : '';

  db.get(`SELECT * FROM applications WHERE id = ? AND customer_id = ?`, [appId, customerId], (err, app) => {
    if (!app) return res.send(`<script>alert('Application not found!'); window.history.back();</script>`);

    db.run(`INSERT INTO payments (customer_id, application_id, tracking_number, service, payment_method, amount, reference_number, proof_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [customerId, appId, app.tracking_number, app.service, 'GCash', amount, reference_number, proofPath], function(err2) {
        db.run(`UPDATE applications SET payment_status = 'Payment Verification Pending' WHERE id = ?`, [appId]);
        addNotification(customerId, 'Payment Submitted', `Payment proof for ${app.tracking_number} submitted and awaiting verification.`);
        logActivity('customer', customerId, 'Payment', `Submitted payment proof for ${app.tracking_number}`);
        res.redirect(`/customer/track/${appId}`);
      });
  });
});

// Printable Application Summary (Feature #6)
app.get('/customer/print/:id', requireCustomer, (req, res) => {
  const appId = req.params.id;
  db.get(`SELECT * FROM applications WHERE id = ? AND customer_id = ?`, [appId, req.session.customer.id], (err, app) => {
    if (!app) return res.send('Unauthorized');
    const data = JSON.parse(app.data_json || '{}');
    const formData = data.formData || {};

    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>Application Form - ${app.tracking_number}</title>
        <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
      </head>
      <body class="bg-white text-gray-900 p-8 font-sans max-w-4xl mx-auto">
        <div class="flex justify-between items-center border-b pb-4 mb-6">
          <div>
            <h1 class="text-2xl font-black text-blue-900">GovAssist PH - Application Form</h1>
            <p class="text-sm font-mono text-gray-500">Tracking #: ${app.tracking_number}</p>
          </div>
          <button onclick="window.print()" class="bg-blue-600 text-white px-6 py-2 rounded-xl font-bold print:hidden">Print Form</button>
        </div>

        <div class="space-y-6 text-sm">
          <div class="border p-4 rounded-xl">
            <h3 class="font-bold border-b pb-1 mb-2 text-blue-900">Service Information</h3>
            <p><strong>Service:</strong> ${app.service}</p>
            <p><strong>Priority:</strong> ${app.priority}</p>
            <p><strong>Status:</strong> ${app.status}</p>
          </div>

          <div class="border p-4 rounded-xl">
            <h3 class="font-bold border-b pb-1 mb-2 text-blue-900">Personal Information</h3>
            <p><strong>Full Name:</strong> ${formData.first_name || ''} ${formData.middle_name || ''} ${formData.last_name || ''} ${formData.suffix || ''}</p>
            <p><strong>Date of Birth:</strong> ${formData.date_of_birth || ''} | <strong>Place of Birth:</strong> ${formData.place_of_birth || ''}</p>
            <p><strong>Sex:</strong> ${formData.sex || ''} | <strong>Civil Status:</strong> ${formData.civil_status || ''} | <strong>Nationality:</strong> ${formData.nationality || ''}</p>
          </div>

          <div class="border p-4 rounded-xl">
            <h3 class="font-bold border-b pb-1 mb-2 text-blue-900">Contact & Address</h3>
            <p><strong>Mobile:</strong> ${formData.mobile_number || ''} | <strong>Email:</strong> ${formData.email_address || ''}</p>
            <p><strong>Address:</strong> ${formData.street || ''}, ${formData.barangay || ''}, ${formData.city || ''}, ${formData.province || ''} (${formData.zip_code || ''})</p>
          </div>

          <div class="border p-4 rounded-xl">
            <h3 class="font-bold border-b pb-1 mb-2 text-blue-900">Employment & Family</h3>
            <p><strong>Employment:</strong> ${formData.employment_status || ''} (${formData.occupation || 'N/A'})</p>
            <p><strong>Father:</strong> ${formData.father_name || ''}</p>
            <p><strong>Mother:</strong> ${formData.mother_maiden_name || ''}</p>
            ${formData.spouse_name ? `<p><strong>Spouse:</strong> ${formData.spouse_name}</p>` : ''}
          </div>
        </div>
      </body>
      </html>
    `);
  });
});

// Completed Documents Hub (Feature #7)
app.get('/customer/documents', requireCustomer, (req, res) => {
  const customerId = req.session.customer.id;
  db.all(`SELECT cf.*, a.tracking_number, a.service FROM completed_files cf JOIN applications a ON cf.application_id = a.id WHERE a.customer_id = ? ORDER BY cf.id DESC`, [customerId], (err, files) => {
    const content = `
      <h1 class="text-3xl font-black text-blue-900 mb-6">Completed Government Documents</h1>
      <div class="bg-white p-8 rounded-2xl shadow-xl">
        ${files.length === 0 ? `<p class="text-gray-500 text-center py-6">No completed documents available yet.</p>` : `
          <div class="grid md:grid-cols-2 gap-4">
            ${files.map(f => `
              <div class="border p-5 rounded-2xl flex justify-between items-center bg-gray-50">
                <div>
                  <h4 class="font-bold text-blue-900">${f.file_name}</h4>
                  <p class="text-xs text-gray-500">Service: ${f.service} (${f.tracking_number})</p>
                  <p class="text-xs text-gray-400 mt-1">${f.description || ''}</p>
                </div>
                <a href="${f.file_path}" target="_blank" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-xs font-bold shadow">Download</a>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    `;
    res.send(customerLayout('Completed Documents', content, 'documents', 0, req.session));
  });
});

// Payment History Hub (Feature #8)
app.get('/customer/payments', requireCustomer, (req, res) => {
  const customerId = req.session.customer.id;
  db.all(`SELECT * FROM payments WHERE customer_id = ? ORDER BY id DESC`, [customerId], (err, payments) => {
    const content = `
      <h1 class="text-3xl font-black text-blue-900 mb-6">Payment History</h1>
      <div class="bg-white p-8 rounded-2xl shadow-xl">
        ${payments.length === 0 ? `<p class="text-gray-500 text-center py-6">No payment records found.</p>` : `
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse">
              <thead>
                <tr class="border-b bg-gray-50 text-xs text-gray-500 uppercase">
                  <th class="p-4">Tracking #</th>
                  <th class="p-4">Service</th>
                  <th class="p-4">Amount</th>
                  <th class="p-4">Reference #</th>
                  <th class="p-4">Status</th>
                  <th class="p-4">Date</th>
                </tr>
              </thead>
              <tbody class="text-sm">
                ${payments.map(p => `
                  <tr class="border-b hover:bg-gray-50/50 transition">
                    <td class="p-4 font-mono font-bold">${p.tracking_number}</td>
                    <td class="p-4">${p.service}</td>
                    <td class="p-4 font-bold">₱${p.amount.toLocaleString()}</td>
                    <td class="p-4 font-mono">${p.reference_number}</td>
                    <td class="p-4"><span class="px-3 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-bold">${p.payment_status}</span></td>
                    <td class="p-4 text-xs text-gray-500">${p.created_at}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    `;
    res.send(customerLayout('Payment History', content, 'payments', 0, req.session));
  });
});

// Notifications Hub (Feature #9)
app.get('/customer/notifications', requireCustomer, (req, res) => {
  const customerId = req.session.customer.id;
  db.all(`SELECT * FROM notifications WHERE customer_id = ? ORDER BY id DESC`, [customerId], (err, notifs) => {
    db.run(`UPDATE notifications SET is_read = 1 WHERE customer_id = ?`, [customerId]);
    const content = `
      <h1 class="text-3xl font-black text-blue-900 mb-6">Notifications</h1>
      <div class="bg-white p-8 rounded-2xl shadow-xl space-y-4">
        ${notifs.length === 0 ? `<p class="text-gray-500 text-center py-6">No notifications.</p>` : `
          ${notifs.map(n => `
            <div class="border p-5 rounded-2xl bg-gray-50 flex justify-between items-start">
              <div>
                <h4 class="font-bold text-blue-900">${n.title}</h4>
                <p class="text-sm text-gray-600 mt-1">${n.message}</p>
                <span class="text-xs text-gray-400 mt-2 block">${n.created_at}</span>
              </div>
              <span class="px-2.5 py-1 bg-blue-100 text-blue-800 text-xs rounded-full font-bold">${n.is_read ? 'Read' : 'New'}</span>
            </div>
          `).join('')}
        `}
      </div>
    `;
    res.send(customerLayout('Notifications', content, 'notifications', 0, req.session));
  });
});

// Customer Support Ticket Hub (Feature #10 & #15)
app.get('/customer/support', requireCustomer, (req, res) => {
  const customerId = req.session.customer.id;
  db.all(`SELECT * FROM support_tickets WHERE customer_id = ? ORDER BY id DESC`, [customerId], (err, tickets) => {
    const content = `
      <h1 class="text-3xl font-black text-blue-900 mb-6">Customer Support & Help Desk</h1>
      
      <div class="bg-white p-8 rounded-2xl shadow-xl mb-8">
        <h2 class="text-xl font-bold text-blue-900 mb-4">Submit New Support Ticket</h2>
        <form action="/customer/support" method="POST" class="space-y-4">
          <div><label class="block text-sm font-semibold mb-1">Subject / Issue *</label><input type="text" name="subject" required class="w-full border rounded-xl px-4 py-2.5" placeholder="Question regarding my application"></div>
          <div><label class="block text-sm font-semibold mb-1">Message / Details *</label><textarea name="message" required rows="4" class="w-full border rounded-xl px-4 py-2.5" placeholder="Describe your concern..."></textarea></div>
          <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-2.5 rounded-xl shadow transition">Send Support Ticket</button>
        </form>
      </div>

      <div class="bg-white p-8 rounded-2xl shadow-xl space-y-4">
        <h2 class="text-xl font-bold text-blue-900 mb-4">Your Support Tickets</h2>
        ${tickets.length === 0 ? `<p class="text-gray-500 text-center py-4">No support tickets submitted.</p>` : `
          <div class="space-y-4">
            ${tickets.map(t => `
              <div class="border p-6 rounded-2xl bg-gray-50 space-y-2">
                <div class="flex justify-between items-center">
                  <h4 class="font-bold text-blue-900">${t.subject}</h4>
                  <span class="px-3 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-bold">${t.status}</span>
                </div>
                <p class="text-sm text-gray-700">${t.message}</p>
                ${t.admin_reply ? `<div class="bg-blue-50 border-l-4 border-blue-600 p-4 rounded-r-xl mt-3 text-xs"><strong class="text-blue-900">Admin Reply:</strong> ${t.admin_reply}</div>` : ''}
                <span class="text-xs text-gray-400 block pt-2">${t.created_at}</span>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    `;
    res.send(customerLayout('Support', content, 'support', 0, req.session));
  });
});

app.post('/customer/support', requireCustomer, (req, res) => {
  const customerId = req.session.customer.id;
  const { subject, message } = req.body;
  db.run(`INSERT INTO support_tickets (customer_id, subject, message) VALUES (?, ?, ?)`, [customerId, subject, message], () => {
    logActivity('customer', customerId, 'Support', `Submitted support ticket: ${subject}`);
    res.redirect('/customer/support');
  });
});

// Profile Settings Hub (Feature #11)
app.get('/customer/profile', requireCustomer, (req, res) => {
  db.get(`SELECT * FROM users WHERE id = ?`, [req.session.customer.id], (err, user) => {
    const content = `
      <h1 class="text-3xl font-black text-blue-900 mb-6">Profile Settings</h1>
      <div class="bg-white p-8 rounded-2xl shadow-xl max-w-xl">
        <form action="/customer/profile" method="POST" class="space-y-4">
          <div><label class="block text-sm font-semibold mb-1">Full Name</label><input type="text" name="full_name" value="${user.full_name}" required class="w-full border rounded-xl px-4 py-2.5"></div>
          <div><label class="block text-sm font-semibold mb-1">Mobile Number</label><input type="text" name="mobile_number" value="${user.mobile_number}" required class="w-full border rounded-xl px-4 py-2.5"></div>
          <div><label class="block text-sm font-semibold mb-1">Email Address</label><input type="email" name="email_address" value="${user.email_address}" required class="w-full border rounded-xl px-4 py-2.5"></div>
          <div><label class="block text-sm font-semibold mb-1">New Password (leave blank to keep current)</label><input type="password" name="password" class="w-full border rounded-xl px-4 py-2.5"></div>
          <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-3 rounded-xl shadow transition">Update Profile</button>
        </form>
      </div>
    `;
    res.send(customerLayout('Profile', content, 'profile', 0, req.session));
  });
});

app.post('/customer/profile', requireCustomer, async (req, res) => {
  const customerId = req.session.customer.id;
  const { full_name, mobile_number, email_address, password } = req.body;
  
  if (password) {
    const hashedPassword = await bcrypt.hash(password, 10);
    db.run(`UPDATE users SET full_name = ?, mobile_number = ?, email_address = ?, password = ? WHERE id = ?`,
      [full_name, mobile_number, email_address, hashedPassword, customerId], () => {
        req.session.customer.full_name = full_name;
        res.redirect('/customer/profile');
      });
  } else {
    db.run(`UPDATE users SET full_name = ?, mobile_number = ?, email_address = ? WHERE id = ?`,
      [full_name, mobile_number, email_address, customerId], () => {
        req.session.customer.full_name = full_name;
        res.redirect('/customer/profile');
      });
  }
});


// ==========================================
// ADMIN PORTAL & DASHBOARD (Features #12 to #20+)
// ==========================================
function adminLayout(title, content, activeTab) {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title} - Admin Portal</title>
      <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
    </head>
    <body class="bg-gray-900 text-gray-100 font-sans">
      <div class="min-h-screen flex flex-col md:flex-row">
        <aside class="bg-gray-950 text-white w-full md:w-72 p-6 flex flex-col justify-between shadow-2xl border-r border-gray-800">
          <div>
            <div class="text-xl font-black mb-8 flex items-center space-x-2">
              <span>ADMIN <span class="text-emerald-400">PORTAL</span></span>
            </div>
            <nav class="space-y-1.5 text-sm">
              <a href="/admin/dashboard" class="block px-4 py-3 rounded-xl font-semibold transition ${activeTab === 'dashboard' ? 'bg-blue-600 text-white shadow' : 'text-gray-300 hover:bg-gray-800'}">📊 Admin Dashboard</a>
              <a href="/admin/applications" class="block px-4 py-3 rounded-xl font-semibold transition ${activeTab === 'applications' ? 'bg-blue-600 text-white shadow' : 'text-gray-300 hover:bg-gray-800'}">📂 Manage Applications</a>
              <a href="/admin/payments" class="block px-4 py-3 rounded-xl font-semibold transition ${activeTab === 'payments' ? 'bg-blue-600 text-white shadow' : 'text-gray-300 hover:bg-gray-800'}">💳 Verify Payments</a>
              <a href="/admin/users" class="block px-4 py-3 rounded-xl font-semibold transition ${activeTab === 'users' ? 'bg-blue-600 text-white shadow' : 'text-gray-300 hover:bg-gray-800'}">👥 Customer Accounts</a>
              <a href="/admin/support" class="block px-4 py-3 rounded-xl font-semibold transition ${activeTab === 'support' ? 'bg-blue-600 text-white shadow' : 'text-gray-300 hover:bg-gray-800'}">💬 Support Tickets</a>
              <a href="/admin/reports" class="block px-4 py-3 rounded-xl font-semibold transition ${activeTab === 'reports' ? 'bg-blue-600 text-white shadow' : 'text-gray-300 hover:bg-gray-800'}">📈 Financial Reports</a>
              <a href="/admin/audit" class="block px-4 py-3 rounded-xl font-semibold transition ${activeTab === 'audit' ? 'bg-blue-600 text-white shadow' : 'text-gray-300 hover:bg-gray-800'}">📜 Audit Trail / Logs</a>
              <a href="/admin/settings" class="block px-4 py-3 rounded-xl font-semibold transition ${activeTab === 'settings' ? 'bg-blue-600 text-white shadow' : 'text-gray-300 hover:bg-gray-800'}">⚙️ System Settings</a>
            </nav>
          </div>
          <div class="mt-8 pt-4 border-t border-gray-800">
            <span class="block text-xs text-gray-400 mb-1">Developer: <strong>Mark Jerald Agdigos</strong></span>
            <a href="/admin/logout" class="block text-center bg-red-600 hover:bg-red-700 text-white py-2.5 rounded-xl text-sm font-bold shadow transition mt-3">Admin Logout</a>
          </div>
        </aside>
        
        <main class="flex-1 p-6 md:p-12 overflow-y-auto bg-gray-900 text-gray-100">
          ${content}
        </main>
      </div>
    </body>
    </html>
  `;
}

// Admin Dashboard (Feature #12)
app.get('/admin/dashboard', requireAdmin, (req, res) => {
  db.all(`SELECT * FROM applications`, (err, apps) => {
    db.all(`SELECT * FROM payments`, (err2, payments) => {
      db.all(`SELECT * FROM users`, (err3, users) => {
        db.all(`SELECT * FROM support_tickets WHERE status = 'Open'`, (err4, tickets) => {
          
          const totalApps = apps.length;
          const pendingApps = apps.filter(a => a.status === 'Submitted' || a.status === 'Under Review').length;
          const totalRevenue = payments.filter(p => p.payment_status === 'Verified').reduce((sum, p) => sum + p.amount, 0);

          const content = `
            <h1 class="text-3xl font-black text-white mb-2">Admin Dashboard</h1>
            <p class="text-xs text-gray-400 mb-8">System Management Hub created by Mark Jerald Agdigos</p>

            <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
              <div class="bg-gray-800 p-6 rounded-2xl shadow-xl border-l-4 border-blue-500">
                <h3 class="text-gray-400 text-xs font-bold uppercase">Total Applications</h3>
                <p class="text-3xl font-black text-white mt-2">${totalApps}</p>
              </div>
              <div class="bg-gray-800 p-6 rounded-2xl shadow-xl border-l-4 border-amber-500">
                <h3 class="text-gray-400 text-xs font-bold uppercase">Pending Review</h3>
                <p class="text-3xl font-black text-amber-400 mt-2">${pendingApps}</p>
              </div>
              <div class="bg-gray-800 p-6 rounded-2xl shadow-xl border-l-4 border-emerald-500">
                <h3 class="text-gray-400 text-xs font-bold uppercase">Total Revenue</h3>
                <p class="text-3xl font-black text-emerald-400 mt-2">₱${totalRevenue.toLocaleString()}</p>
              </div>
              <div class="bg-gray-800 p-6 rounded-2xl shadow-xl border-l-4 border-purple-500">
                <h3 class="text-gray-400 text-xs font-bold uppercase">Registered Customers</h3>
                <p class="text-3xl font-black text-purple-400 mt-2">${users.length}</p>
              </div>
            </div>

            <div class="bg-gray-800 p-8 rounded-2xl shadow-xl">
              <h2 class="text-xl font-bold text-white mb-4">Recent System Applications</h2>
              <div class="overflow-x-auto">
                <table class="w-full text-left border-collapse">
                  <thead>
                    <tr class="border-b border-gray-700 text-xs text-gray-400 uppercase">
                      <th class="p-4">Tracking #</th>
                      <th class="p-4">Service</th>
                      <th class="p-4">Status</th>
                      <th class="p-4">Payment</th>
                      <th class="p-4">Action</th>
                    </tr>
                  </thead>
                  <tbody class="text-sm">
                    ${apps.slice(0, 5).map(app => `
                      <tr class="border-b border-gray-700 hover:bg-gray-750">
                        <td class="p-4 font-mono font-bold">${app.tracking_number}</td>
                        <td class="p-4">${app.service}</td>
                        <td class="p-4"><span class="px-3 py-1 bg-blue-900 text-blue-200 rounded-full text-xs font-bold">${app.status}</span></td>
                        <td class="p-4"><span class="px-3 py-1 bg-amber-900 text-amber-200 rounded-full text-xs font-bold">${app.payment_status}</span></td>
                        <td class="p-4"><a href="/admin/application/${app.id}" class="text-blue-400 font-bold hover:underline">Manage</a></td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          `;
          res.send(adminLayout('Admin Dashboard', content, 'dashboard'));
        });
      });
    });
  });
});

// Admin Applications Management Hub (Feature #13)
app.get('/admin/applications', requireAdmin, (req, res) => {
  db.all(`SELECT a.*, u.full_name, u.mobile_number FROM applications a JOIN users u ON a.customer_id = u.id ORDER BY a.id DESC`, (err, apps) => {
    const content = `
      <h1 class="text-3xl font-black text-white mb-6">Manage All Applications</h1>
      <div class="bg-gray-800 p-8 rounded-2xl shadow-xl">
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="border-b border-gray-700 text-xs text-gray-400 uppercase">
                <th class="p-4">Tracking #</th>
                <th class="p-4">Customer</th>
                <th class="p-4">Service</th>
                <th class="p-4">Priority</th>
                <th class="p-4">Status</th>
                <th class="p-4">Action</th>
              </tr>
            </thead>
            <tbody class="text-sm">
              ${apps.map(app => `
                <tr class="border-b border-gray-700 hover:bg-gray-750">
                  <td class="p-4 font-mono font-bold">${app.tracking_number}</td>
                  <td class="p-4">${app.full_name}<br><small class="text-gray-400">${app.mobile_number}</small></td>
                  <td class="p-4">${app.service}</td>
                  <td class="p-4"><span class="px-2 py-1 bg-gray-700 rounded text-xs">${app.priority}</span></td>
                  <td class="p-4"><span class="px-3 py-1 bg-blue-900 text-blue-200 rounded-full text-xs font-bold">${app.status}</span></td>
                  <td class="p-4"><a href="/admin/application/${app.id}" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-xs font-bold shadow">Review</a></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
    res.send(adminLayout('Manage Applications', content, 'applications'));
  });
});

// Admin Review Individual Application (Feature #14: Update Status & Upload Completed Files)
app.get('/admin/application/:id', requireAdmin, (req, res) => {
  const appId = req.params.id;
  db.get(`SELECT a.*, u.full_name, u.email_address, u.mobile_number FROM applications a JOIN users u ON a.customer_id = u.id WHERE a.id = ?`, [appId], (err, app) => {
    if (!app) return res.send('Application not found');
    db.all(`SELECT * FROM documents WHERE application_id = ?`, [appId], (err2, docs) => {
      db.all(`SELECT * FROM completed_files WHERE application_id = ?`, [appId], (err3, completedFiles) => {
        db.all(`SELECT * FROM beneficiaries WHERE application_id = ?`, [appId], (err4, bens) => {

          const content = `
            <div class="flex justify-between items-center mb-6">
              <div>
                <h1 class="text-3xl font-black text-white">Review Application</h1>
                <p class="text-sm font-mono text-blue-400 mt-1">${app.tracking_number} (${app.service})</p>
              </div>
              <a href="/admin/applications" class="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-xl text-sm font-bold">&larr; Back</a>
            </div>

            <div class="grid md:grid-cols-2 gap-8 mb-8">
              <div class="bg-gray-800 p-8 rounded-2xl shadow-xl space-y-4">
                <h3 class="text-xl font-bold border-b border-gray-700 pb-2">Customer & Details</h3>
                <p><strong>Customer:</strong> ${app.full_name}</p>
                <p><strong>Contact:</strong> ${app.mobile_number} | ${app.email_address}</p>
                <p><strong>Priority:</strong> ${app.priority}</p>
                
                <form action="/admin/application/${app.id}/status" method="POST" class="space-y-3 pt-4 border-t border-gray-700">
                  <div>
                    <label class="block text-xs font-semibold mb-1">Update Status</label>
                    <select name="status" class="w-full border border-gray-700 rounded-xl px-4 py-2 bg-gray-900 text-white">
                      <option value="Submitted" ${app.status === 'Submitted' ? 'selected' : ''}>Submitted</option>
                      <option value="Under Review" ${app.status === 'Under Review' ? 'selected' : ''}>Under Review</option>
                      <option value="Processing" ${app.status === 'Processing' ? 'selected' : ''}>Processing</option>
                      <option value="Completed" ${app.status === 'Completed' ? 'selected' : ''}>Completed</option>
                      <option value="Rejected" ${app.status === 'Rejected' ? 'selected' : ''}>Rejected</option>
                    </select>
                  </div>
                  <div>
                    <label class="block text-xs font-semibold mb-1">Admin Remarks</label>
                    <textarea name="admin_remarks" rows="3" class="w-full border border-gray-700 rounded-xl px-4 py-2 bg-gray-900 text-white">${app.admin_remarks || ''}</textarea>
                  </div>
                  <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl text-sm font-bold shadow">Save Status & Remarks</button>
                </form>
              </div>

              <div class="bg-gray-800 p-8 rounded-2xl shadow-xl space-y-4">
                <h3 class="text-xl font-bold border-b border-gray-700 pb-2">Upload Completed Output Files</h3>
                <p class="text-xs text-gray-400">Upload official forms or certificates for the customer.</p>
                <form action="/admin/application/${app.id}/upload-output" method="POST" enctype="multipart/form-data" class="space-y-3">
                  <div><label class="block text-xs font-semibold mb-1">Description</label><input type="text" name="description" required class="w-full border border-gray-700 rounded-xl px-4 py-2 bg-gray-900 text-white" placeholder="e.g. Generated TIN ID / SSS Certificate"></div>
                  <div><label class="block text-xs font-semibold mb-1">File (PDF/Image/Doc)</label><input type="file" name="output_file" required class="w-full border border-gray-700 rounded-xl px-3 py-1 bg-gray-900 text-xs"></div>
                  <button type="submit" class="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-xl text-sm font-bold shadow">Upload Output File</button>
                </form>

                <div class="mt-4 space-y-2">
                  <h4 class="font-bold text-xs uppercase text-gray-400">Uploaded Output Files (${completedFiles.length})</h4>
                  ${completedFiles.map(f => `<div class="p-3 bg-gray-900 rounded-xl flex justify-between items-center text-xs"><span class="truncate">${f.file_name}</span><a href="${f.file_path}" target="_blank" class="text-blue-400 font-bold">Download</a></div>`).join('')}
                </div>
              </div>
            </div>

            <div class="bg-gray-800 p-8 rounded-2xl shadow-xl space-y-4">
              <h3 class="text-xl font-bold border-b border-gray-700 pb-2">Client Uploaded Documents (${docs.length})</h3>
              <div class="grid md:grid-cols-3 gap-4">
                ${docs.map(d => `<div class="p-4 bg-gray-900 rounded-xl space-y-2"><p class="font-bold text-xs uppercase text-blue-400">${d.doc_type}</p><p class="text-sm truncate">${d.file_name}</p><a href="${d.file_path}" target="_blank" class="inline-block bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold">View File</a></div>`).join('')}
              </div>
            </div>
          `;
          res.send(adminLayout('Review Application', content, 'applications'));
        });
      });
    });
  });
});

app.post('/admin/application/:id/status', requireAdmin, (req, res) => {
  const appId = req.params.id;
  const { status, admin_remarks } = req.body;

  db.get(`SELECT customer_id, tracking_number FROM applications WHERE id = ?`, [appId], (err, app) => {
    if (app) {
      db.run(`UPDATE applications SET status = ?, admin_remarks = ? WHERE id = ?`, [status, admin_remarks, appId], () => {
        addNotification(app.customer_id, 'Application Status Updated', `Your application ${app.tracking_number} status is now: ${status}. Remarks: ${admin_remarks}`);
        logActivity('admin', req.session.admin.id, 'Update Status', `Updated application ${app.tracking_number} to ${status}`);
        res.redirect(`/admin/application/${appId}`);
      });
    } else {
      res.redirect('/admin/applications');
    }
  });
});

app.post('/admin/application/:id/upload-output', requireAdmin, upload.single('output_file'), (req, res) => {
  const appId = req.params.id;
  const { description } = req.body;
  if (!req.file) return res.redirect(`/admin/application/${appId}`);

  const filePath = '/uploads/' + req.file.filename;
  const fileName = req.file.originalname;

  db.get(`SELECT customer_id, tracking_number FROM applications WHERE id = ?`, [appId], (err, app) => {
    db.run(`INSERT INTO completed_files (application_id, file_path, file_name, description) VALUES (?, ?, ?, ?)`,
      [appId, filePath, fileName, description], () => {
        if (app) {
          addNotification(app.customer_id, 'Document Completed', `Admin uploaded completed document for your application ${app.tracking_number}.`);
        }
        res.redirect(`/admin/application/${appId}`);
      });
  });
});

// Admin Verify Payments (Feature #15)
app.get('/admin/payments', requireAdmin, (req, res) => {
  db.all(`SELECT p.*, u.full_name FROM payments p JOIN users u ON p.customer_id = u.id ORDER BY p.id DESC`, (err, payments) => {
    const content = `
      <h1 class="text-3xl font-black text-white mb-6">Payment Verification Hub</h1>
      <div class="bg-gray-800 p-8 rounded-2xl shadow-xl">
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="border-b border-gray-700 text-xs text-gray-400 uppercase">
                <th class="p-4">Tracking #</th>
                <th class="p-4">Customer</th>
                <th class="p-4">Amount</th>
                <th class="p-4">Reference #</th>
                <th class="p-4">Proof</th>
                <th class="p-4">Status</th>
                <th class="p-4">Action</th>
              </tr>
            </thead>
            <tbody class="text-sm">
              ${payments.map(p => `
                <tr class="border-b border-gray-700 hover:bg-gray-750">
                  <td class="p-4 font-mono font-bold">${p.tracking_number}</td>
                  <td class="p-4">${p.full_name}</td>
                  <td class="p-4 font-bold">₱${p.amount.toLocaleString()}</td>
                  <td class="p-4 font-mono">${p.reference_number}</td>
                  <td class="p-4">${p.proof_path ? `<a href="${p.proof_path}" target="_blank" class="text-blue-400 font-bold underline">View Image</a>` : 'No proof'}</td>
                  <td class="p-4"><span class="px-3 py-1 bg-amber-900 text-amber-200 rounded-full text-xs font-bold">${p.payment_status}</span></td>
                  <td class="p-4 flex gap-2">
                    <a href="/admin/payment/${p.id}/verify" class="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold">Verify</a>
                    <a href="/admin/payment/${p.id}/reject" class="bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold">Reject</a>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
    res.send(adminLayout('Verify Payments', content, 'payments'));
  });
});

app.get('/admin/payment/:id/verify', requireAdmin, (req, res) => {
  const payId = req.params.id;
  db.get(`SELECT * FROM payments WHERE id = ?`, [payId], (err, payment) => {
    if (payment) {
      db.run(`UPDATE payments SET payment_status = 'Verified' WHERE id = ?`, [payId], () => {
        db.run(`UPDATE applications SET payment_status = 'Paid & Verified' WHERE id = ?`, [payment.application_id], () => {
          addNotification(payment.customer_id, 'Payment Verified', `Your payment for tracking # ${payment.tracking_number} has been verified by admin.`);
          res.redirect('/admin/payments');
        });
      });
    } else {
      res.redirect('/admin/payments');
    }
  });
});

app.get('/admin/payment/:id/reject', requireAdmin, (req, res) => {
  const payId = req.params.id;
  db.get(`SELECT * FROM payments WHERE id = ?`, [payId], (err, payment) => {
    if (payment) {
      db.run(`UPDATE payments SET payment_status = 'Rejected' WHERE id = ?`, [payId], () => {
        db.run(`UPDATE applications SET payment_status = 'Payment Rejected' WHERE id = ?`, [payment.application_id], () => {
          addNotification(payment.customer_id, 'Payment Rejected', `Your payment proof for tracking # ${payment.tracking_number} was rejected. Please re-submit.`);
          res.redirect('/admin/payments');
        });
      });
    } else {
      res.redirect('/admin/payments');
    }
  });
});

// Admin Customer Accounts Management (Feature #16)
app.get('/admin/users', requireAdmin, (req, res) => {
  db.all(`SELECT * FROM users ORDER BY id DESC`, (err, users) => {
    const content = `
      <h1 class="text-3xl font-black text-white mb-6">Customer Accounts Management</h1>
      <div class="bg-gray-800 p-8 rounded-2xl shadow-xl">
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="border-b border-gray-700 text-xs text-gray-400 uppercase">
                <th class="p-4">ID</th>
                <th class="p-4">Full Name</th>
                <th class="p-4">Username</th>
                <th class="p-4">Mobile</th>
                <th class="p-4">Status</th>
                <th class="p-4">Action</th>
              </tr>
            </thead>
            <tbody class="text-sm">
              ${users.map(u => `
                <tr class="border-b border-gray-700 hover:bg-gray-750">
                  <td class="p-4 font-mono">${u.id}</td>
                  <td class="p-4 font-bold">${u.full_name}</td>
                  <td class="p-4">${u.username}</td>
                  <td class="p-4">${u.mobile_number}</td>
                  <td class="p-4"><span class="px-2.5 py-1 bg-${u.is_active ? 'emerald' : 'red'}-900 text-${u.is_active ? 'emerald' : 'red'}-200 rounded-full text-xs font-bold">${u.is_active ? 'Active' : 'Deactivated'}</span></td>
                  <td class="p-4"><a href="/admin/user/${u.id}/toggle" class="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold">${u.is_active ? 'Deactivate' : 'Activate'}</a></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
    res.send(adminLayout('Customer Accounts', content, 'users'));
  });
});

app.get('/admin/user/:id/toggle', requireAdmin, (req, res) => {
  const userId = req.params.id;
  db.get(`SELECT is_active FROM users WHERE id = ?`, [userId], (err, user) => {
    if (user) {
      const newStatus = user.is_active ? 0 : 1;
      db.run(`UPDATE users SET is_active = ? WHERE id = ?`, [newStatus, userId], () => {
        res.redirect('/admin/users');
      });
    } else {
      res.redirect('/admin/users');
    }
  });
});

// Admin Support Tickets Hub (Feature #17)
app.get('/admin/support', requireAdmin, (req, res) => {
  db.all(`SELECT st.*, u.full_name FROM support_tickets st JOIN users u ON st.customer_id = u.id ORDER BY st.id DESC`, (err, tickets) => {
    const content = `
      <h1 class="text-3xl font-black text-white mb-6">Customer Support Tickets</h1>
      <div class="bg-gray-800 p-8 rounded-2xl shadow-xl space-y-6">
        ${tickets.length === 0 ? `<p class="text-gray-400 text-center py-6">No support tickets found.</p>` : `
          ${tickets.map(t => `
            <div class="border border-gray-700 p-6 rounded-2xl bg-gray-900 space-y-3">
              <div class="flex justify-between items-center">
                <h4 class="font-bold text-white">${t.subject} <span class="text-xs text-gray-400 font-normal">by ${t.full_name}</span></h4>
                <span class="px-3 py-1 bg-amber-900 text-amber-200 rounded-full text-xs font-bold">${t.status}</span>
              </div>
              <p class="text-sm text-gray-300">${t.message}</p>
              ${t.admin_reply ? `<div class="bg-gray-800 border-l-4 border-blue-500 p-4 rounded-r-xl text-xs"><strong class="text-blue-400">Reply:</strong> ${t.admin_reply}</div>` : ''}
              
              <form action="/admin/support/${t.id}/reply" method="POST" class="space-y-2 pt-2">
                <input type="text" name="admin_reply" required class="w-full border border-gray-700 rounded-xl px-4 py-2 bg-gray-800 text-white text-xs" placeholder="Type admin reply here...">
                <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-xl text-xs font-bold shadow">Send Reply & Close</button>
              </form>
            </div>
          `).join('')}
        `}
      </div>
    `;
    res.send(adminLayout('Support Tickets', content, 'support'));
  });
});

app.post('/admin/support/:id/reply', requireAdmin, (req, res) => {
  const ticketId = req.params.id;
  const { admin_reply } = req.body;
  db.get(`SELECT customer_id FROM support_tickets WHERE id = ?`, [ticketId], (err, t) => {
    db.run(`UPDATE support_tickets SET admin_reply = ?, status = 'Closed' WHERE id = ?`, [admin_reply, ticketId], () => {
      if (t) addNotification(t.customer_id, 'Support Replied', `Admin replied to your support ticket: ${admin_reply}`);
      res.redirect('/admin/support');
    });
  });
});

// Admin Financial Reports Hub (Feature #18)
app.get('/admin/reports', requireAdmin, (req, res) => {
  db.all(`SELECT p.*, u.full_name FROM payments p JOIN users u ON p.customer_id = u.id WHERE p.payment_status = 'Verified'`, (err, payments) => {
    const totalRevenue = payments.reduce((sum, p) => sum + p.amount, 0);
    const content = `
      <h1 class="text-3xl font-black text-white mb-6">Financial Reports & Earnings</h1>
      <div class="grid md:grid-cols-2 gap-6 mb-8">
        <div class="bg-gray-800 p-8 rounded-2xl shadow-xl border-l-4 border-emerald-500">
          <h3 class="text-gray-400 text-xs font-bold uppercase">Total Verified Revenue</h3>
          <p class="text-4xl font-black text-emerald-400 mt-2">₱${totalRevenue.toLocaleString()}</p>
        </div>
        <div class="bg-gray-800 p-8 rounded-2xl shadow-xl border-l-4 border-blue-500">
          <h3 class="text-gray-400 text-xs font-bold uppercase">Total Verified Transactions</h3>
          <p class="text-4xl font-black text-white mt-2">${payments.length}</p>
        </div>
      </div>
      <div class="bg-gray-800 p-8 rounded-2xl shadow-xl">
        <h2 class="text-xl font-bold text-white mb-4">Verified Transactions Ledger</h2>
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="border-b border-gray-700 text-xs text-gray-400 uppercase">
                <th class="p-4">Tracking #</th>
                <th class="p-4">Customer</th>
                <th class="p-4">Service</th>
                <th class="p-4">Amount</th>
                <th class="p-4">Reference</th>
                <th class="p-4">Date</th>
              </tr>
            </thead>
            <tbody class="text-sm">
              ${payments.map(p => `
                <tr class="border-b border-gray-700">
                  <td class="p-4 font-mono font-bold">${p.tracking_number}</td>
                  <td class="p-4">${p.full_name}</td>
                  <td class="p-4">${p.service}</td>
                  <td class="p-4 font-bold text-emerald-400">₱${p.amount.toLocaleString()}</td>
                  <td class="p-4 font-mono">${p.reference_number}</td>
                  <td class="p-4 text-xs text-gray-400">${p.created_at}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
    res.send(adminLayout('Financial Reports', content, 'reports'));
  });
});

// Admin Audit Trail / Activity Logs (Feature #19)
app.get('/admin/audit', requireAdmin, (req, res) => {
  db.all(`SELECT * FROM activity_logs ORDER BY id DESC LIMIT 100`, (err, logs) => {
    const content = `
      <h1 class="text-3xl font-black text-white mb-6">System Audit Trail & Activity Logs</h1>
      <div class="bg-gray-800 p-8 rounded-2xl shadow-xl">
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="border-b border-gray-700 text-xs text-gray-400 uppercase">
                <th class="p-4">ID</th>
                <th class="p-4">User Type</th>
                <th class="p-4">User ID</th>
                <th class="p-4">Action</th>
                <th class="p-4">Details</th>
                <th class="p-4">Timestamp</th>
              </tr>
            </thead>
            <tbody class="text-sm font-mono">
              ${logs.map(l => `
                <tr class="border-b border-gray-700 hover:bg-gray-750 text-xs">
                  <td class="p-4">${l.id}</td>
                  <td class="p-4 uppercase font-bold text-blue-400">${l.user_type}</td>
                  <td class="p-4">${l.user_id}</td>
                  <td class="p-4 font-bold text-emerald-400">${l.action}</td>
                  <td class="p-4 text-gray-300">${l.details}</td>
                  <td class="p-4 text-gray-400">${l.created_at}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
    res.send(adminLayout('Audit Trail', content, 'audit'));
  });
});

// Admin System Settings (Feature #20)
app.get('/admin/settings', requireAdmin, async (req, res) => {
  const settings = await getSettings();
  const content = `
    <h1 class="text-3xl font-black text-white mb-6">System Configuration & Settings</h1>
    <div class="bg-gray-800 p-8 rounded-2xl shadow-xl max-w-2xl">
      <form action="/admin/settings" method="POST" class="space-y-4">
        <div><label class="block text-sm font-semibold mb-1">Business Name</label><input type="text" name="business_name" value="${settings.business_name}" required class="w-full border border-gray-700 rounded-xl px-4 py-2.5 bg-gray-900 text-white"></div>
        <div><label class="block text-sm font-semibold mb-1">Developer Name</label><input type="text" name="developer_name" value="${settings.developer_name}" required class="w-full border border-gray-700 rounded-xl px-4 py-2.5 bg-gray-900 text-white"></div>
        <div><label class="block text-sm font-semibold mb-1">GCash Account Name</label><input type="text" name="gcash_name" value="${settings.gcash_name}" required class="w-full border border-gray-700 rounded-xl px-4 py-2.5 bg-gray-900 text-white"></div>
        <div><label class="block text-sm font-semibold mb-1">GCash Number</label><input type="text" name="gcash_number" value="${settings.gcash_number}" required class="w-full border border-gray-700 rounded-xl px-4 py-2.5 bg-gray-900 text-white"></div>
        <div class="grid md:grid-cols-3 gap-4">
          <div><label class="block text-sm font-semibold mb-1">BIR Fee (₱)</label><input type="number" name="fee_bir" value="${settings.fee_bir}" required class="w-full border border-gray-700 rounded-xl px-4 py-2.5 bg-gray-900 text-white"></div>
          <div><label class="block text-sm font-semibold mb-1">SSS Fee (₱)</label><input type="number" name="fee_sss" value="${settings.fee_sss}" required class="w-full border border-gray-700 rounded-xl px-4 py-2.5 bg-gray-900 text-white"></div>
          <div><label class="block text-sm font-semibold mb-1">Pag-IBIG Fee (₱)</label><input type="number" name="fee_pagibig" value="${settings.fee_pagibig}" required class="w-full border border-gray-700 rounded-xl px-4 py-2.5 bg-gray-900 text-white"></div>
        </div>
        <div><label class="block text-sm font-semibold mb-1">Payment Instructions</label><textarea name="payment_instructions" rows="3" class="w-full border border-gray-700 rounded-xl px-4 py-2.5 bg-gray-900 text-white">${settings.payment_instructions}</textarea></div>
        <div>
          <label class="block text-sm font-semibold mb-1">Maintenance Mode</label>
          <select name="maintenance_mode" class="w-full border border-gray-700 rounded-xl px-4 py-2.5 bg-gray-900 text-white">
            <option value="0" ${settings.maintenance_mode === '0' ? 'selected' : ''}>Disabled (Live)</option>
            <option value="1" ${settings.maintenance_mode === '1' ? 'selected' : ''}>Enabled (Under Maintenance)</option>
          </select>
        </div>
        <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-3 rounded-xl shadow transition">Save Settings</button>
      </form>
    </div>
  `;
  res.send(adminLayout('Settings', content, 'settings'));
});

app.post('/admin/settings', requireAdmin, async (req, res) => {
  const settingsData = req.body;
  for (const [key, value] of Object.entries(settingsData)) {
    db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [key, value]);
  }
  logActivity('admin', req.session.admin.id, 'Settings', 'Updated system configuration settings');
  res.redirect('/admin/settings');
});


// Start Server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}. Developed by Mark Jerald Agdigos.`);
});
