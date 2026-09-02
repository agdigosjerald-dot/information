/**
 * BIR / TIN, SSS & Pag-IBIG Application Assistance System
 * Enhanced Production-Ready Application (app.js)
 * Created by: Mark Jerald Agdigos
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

// Multer Storage Configuration
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
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|pdf|doc|docx/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    } else {
      cb(new Error('Only images, PDFs, and documents are allowed!'));
    }
  }
});

// Database Setup (SQLite for long-term persistence - data remains intact)
const dbFile = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbFile, (err) => {
  if (err) {
    console.error('Error opening database', err.message);
  } else {
    console.log('Connected to the persistent SQLite database.');
    initDatabase();
  }
});

function initDatabase() {
  db.serialize(() => {
    // Users (Customers)
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT,
      full_name TEXT,
      mobile_number TEXT,
      email_address TEXT,
      device_preference TEXT DEFAULT 'mobile',
      is_verified INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Admin Users
    db.run(`CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, () => {
      const defaultAdminUser = process.env.ADMIN_USERNAME || 'admin';
      const defaultAdminPass = process.env.ADMIN_PASSWORD || 'admin123';
      db.get(`SELECT * FROM admin_users WHERE username = ?`, [defaultAdminUser], async (err, row) => {
        if (!row) {
          const hashedPassword = await bcrypt.hash(defaultAdminPass, 10);
          db.run(`INSERT INTO admin_users (username, password) VALUES (?, ?)`, [defaultAdminUser, hashedPassword]);
        }
      });
    });

    // Settings
    db.run(`CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )`, () => {
      const defaultSettings = {
        business_name: 'GovAssist PH - Multi-Service Assistance',
        logo_url: '',
        contact_number: '+63 912 345 6789',
        email: 'support@govassist.ph',
        address: 'Manila, Philippines',
        creator_name: 'Mark Jerald Agdigos',
        gcash_name: 'GovAssist Admin',
        gcash_number: '09123456789',
        qr_bir: '',
        qr_sss: '',
        qr_pagibig: '',
        fee_bir: '500',
        fee_sss: '400',
        fee_pagibig: '400',
        announcement: 'Welcome to GovAssist PH! Fast, secure, and device-optimized government application assistance.',
        maintenance_mode: '0'
      };
      for (const [key, value] of Object.entries(defaultSettings)) {
        db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`, [key, value]);
      }
    });

    // Applications
    db.run(`CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER,
      service TEXT,
      tracking_number TEXT UNIQUE,
      status TEXT DEFAULT 'Submitted',
      payment_status TEXT DEFAULT 'Payment Pending',
      admin_remarks TEXT,
      priority TEXT DEFAULT 'Standard',
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

    // Completed Files
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

    // Support Tickets / Messages
    db.run(`CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER,
      subject TEXT,
      message TEXT,
      status TEXT DEFAULT 'Open',
      admin_reply TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Audit Logs
    db.run(`CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_username TEXT,
      action TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
  });
}

// Middleware Configuration
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));
app.use('/uploads', express.static(uploadDir));

// Persistent Session Configuration (15 Days Session Retention)
app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: __dirname }),
  secret: process.env.SESSION_SECRET || 'mark_jerald_agdigos_govassist_secure_key_2026',
  resave: true,
  saveUninitialized: false,
  cookie: { maxAge: 15 * 24 * 60 * 60 * 1000 } // Retain login for 15 Days
}));

// Helper to get settings
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

function logStatusHistory(appId, status, notes = '') {
  db.run(`INSERT INTO status_history (application_id, status, notes) VALUES (?, ?, ?)`, [appId, status, notes]);
}

function logAudit(adminUser, action) {
  db.run(`INSERT INTO audit_logs (admin_username, action) VALUES (?, ?)`, [adminUser, action]);
}

// Global View Variables Middleware
app.use(async (req, res, next) => {
  try {
    res.locals.settings = await getSettings();
    res.locals.customer = req.session.customer || null;
    res.locals.admin = req.session.admin || null;
    res.locals.lang = req.session.lang || 'en';
    res.locals.device = req.session.device || null;
    next();
  } catch (e) {
    next();
  }
});

// Language Switcher Route
app.get('/set-lang/:lang', (req, res) => {
  const lang = req.params.lang;
  if (lang === 'en' || lang === 'tl') {
    req.session.lang = lang;
  }
  res.redirect(req.get('referer') || '/');
});

// ==========================================
// FEATURE #1: DEVICE SELECTION ROUTE
// ==========================================
app.get('/customer/select-device', (req, res) => {
  const settings = res.locals.settings;
  const redirectUrl = req.query.redirect || '/customer/dashboard';
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Select Device - ${settings.business_name}</title>
      <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
    </head>
    <body class="bg-slate-900 text-slate-100 flex items-center justify-center min-h-screen p-4">
      <div class="bg-slate-950 max-w-lg w-full p-8 rounded-3xl shadow-2xl border border-slate-800 text-center">
        <div class="mb-6">
          <span class="text-4xl block mb-2">📱💻</span>
          <h1 class="text-2xl font-black text-white">Anong device ang gamit mo?</h1>
          <p class="text-xs text-slate-400 mt-2">Pumili para sa mas maganda at angkop na karanasan sa pag-browse.</p>
        </div>

        <form action="/customer/select-device" method="POST" class="space-y-4">
          <input type="hidden" name="redirect_url" value="${redirectUrl}">
          
          <label class="flex items-center p-4 border border-slate-800 bg-slate-900 rounded-2xl hover:border-blue-500 cursor-pointer transition">
            <input type="radio" name="device" value="mobile" checked class="w-5 h-5 text-blue-600">
            <div class="ml-4 text-left">
              <span class="block font-bold text-white text-base">📱 Mobile Phone (Smartphone)</span>
              <span class="block text-xs text-slate-400">Optimized layout para sa maliit na screen at mabilis na touch navigation.</span>
            </div>
          </label>

          <label class="flex items-center p-4 border border-slate-800 bg-slate-900 rounded-2xl hover:border-blue-500 cursor-pointer transition">
            <input type="radio" name="device" value="tablet" class="w-5 h-5 text-blue-600">
            <div class="ml-4 text-left">
              <span class="block font-bold text-white text-base">📲 Tablet / iPad</span>
              <span class="block text-xs text-slate-400">Balanseng layout para sa medium screen size.</span>
            </div>
          </label>

          <label class="flex items-center p-4 border border-slate-800 bg-slate-900 rounded-2xl hover:border-blue-500 cursor-pointer transition">
            <input type="radio" name="device" value="desktop" class="w-5 h-5 text-blue-600">
            <div class="ml-4 text-left">
              <span class="block font-bold text-white text-base">💻 Laptop / Desktop Computer</span>
              <span class="block text-xs text-slate-400">Full widescreen display na may kumpletong multi-column view.</span>
            </div>
          </label>

          <button type="submit" class="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3.5 rounded-xl shadow-lg transition text-sm">Magpatuloy sa Customer Portal &rarr;</button>
        </form>
      </div>
    </body>
    </html>
  `);
});

app.post('/customer/select-device', (req, res) => {
  const { device, redirect_url } = req.body;
  req.session.device = device || 'mobile';
  
  if (req.session.customer) {
    db.run(`UPDATE users SET device_preference = ? WHERE id = ?`, [req.session.device, req.session.customer.id]);
  }

  res.redirect(redirect_url || '/customer/dashboard');
});

// ==========================================
// MIDDLEWARE GUARDS
// ==========================================
function requireCustomer(req, res, next) {
  if (!req.session.customer) {
    return res.redirect('/customer/login');
  }
  if (!req.session.device) {
    return res.redirect('/customer/select-device?redirect=' + encodeURIComponent(req.originalUrl));
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.admin) {
    return res.redirect('/admin/login');
  }
  next();
}

// ==========================================
// LANDING & PUBLIC PORTAL
// ==========================================
app.get('/', async (req, res) => {
  const settings = res.locals.settings;
  const lang = res.locals.lang;
  res.send(`
    <!DOCTYPE html>
    <html lang="${lang}">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${settings.business_name}</title>
      <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
    </head>
    <body class="bg-slate-50 text-slate-800 font-sans antialiased">
      <header class="bg-gradient-to-r from-blue-900 to-indigo-900 text-white shadow-xl sticky top-0 z-50">
        <div class="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <div class="flex items-center space-x-3">
            ${settings.logo_url ? `<img src="${settings.logo_url}" class="h-10 w-10 object-contain bg-white rounded-lg p-1"/>` : '<div class="bg-blue-600 p-2 rounded-lg font-black text-xl">GA</div>'}
            <div>
              <span class="text-xl font-extrabold tracking-tight">${settings.business_name}</span>
              <span class="block text-xs text-blue-200">Developed by: ${settings.creator_name}</span>
            </div>
          </div>
          <div class="flex items-center space-x-4">
            <div class="flex bg-blue-950 p-1 rounded-lg border border-blue-800 text-xs font-bold">
              <a href="/set-lang/en" class="px-3 py-1 rounded ${lang === 'en' ? 'bg-blue-600 text-white' : 'text-blue-300'}">EN</a>
              <a href="/set-lang/tl" class="px-3 py-1 rounded ${lang === 'tl' ? 'bg-blue-600 text-white' : 'text-blue-300'}">PH</a>
            </div>
            <a href="/customer/login" class="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-semibold transition shadow">Login</a>
            <a href="/customer/register" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-sm font-semibold transition shadow">Register</a>
          </div>
        </div>
      </header>

      ${settings.announcement ? `
        <div class="bg-amber-500 text-slate-950 text-center py-2 px-4 text-sm font-bold shadow-inner">
          📢 Announcement: ${settings.announcement}
        </div>
      ` : ''}

      <main class="max-w-7xl mx-auto px-6 py-16">
        <div class="text-center max-w-3xl mx-auto mb-16">
          <span class="bg-blue-100 text-blue-800 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide">Secure Government Assistance</span>
          <h1 class="text-4xl md:text-5xl font-black text-blue-950 mt-4 mb-6 leading-tight">
            ${lang === 'tl' ? 'Mabilis at Walang Kahirap-Hirap na Government Application Assistance' : 'Fast & Seamless Government Application Assistance'}
          </h1>
          <p class="text-lg text-slate-600 mb-8">
            ${lang === 'tl' ? 'Tulong sa pagkuha at pagproseso ng BIR/TIN, SSS, at Pag-IBIG nang ligtas, mabilis, at propesyonal.' : 'We securely and professionally assist you with your BIR/TIN, SSS, and Pag-IBIG registrations and application documents.'}
          </p>
          <div class="flex justify-center gap-4 flex-wrap">
            <a href="/customer/register" class="px-8 py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg transition transform hover:-translate-y-0.5">Get Started Now</a>
            <a href="/track-public" class="px-8 py-3.5 bg-white border border-slate-300 hover:bg-slate-100 text-blue-950 font-bold rounded-xl shadow transition">Track Application</a>
          </div>
        </div>

        <div class="grid md:grid-cols-3 gap-8 mb-16">
          <div class="bg-white p-8 rounded-2xl shadow-xl border border-slate-100 hover:shadow-2xl transition">
            <div class="text-4xl mb-4 bg-blue-50 w-16 h-16 flex items-center justify-center rounded-2xl text-blue-600">🏢</div>
            <h3 class="text-2xl font-bold text-blue-950 mb-3">BIR / TIN</h3>
            <p class="text-slate-600 text-sm leading-relaxed">Tax Identification Number registration assistance for new employees, self-employed professionals, and mixed-income earners.</p>
          </div>
          <div class="bg-white p-8 rounded-2xl shadow-xl border border-slate-100 hover:shadow-2xl transition">
            <div class="text-4xl mb-4 bg-emerald-50 w-16 h-16 flex items-center justify-center rounded-2xl text-emerald-600">🛡️</div>
            <h3 class="text-2xl font-bold text-blue-950 mb-3">SSS Registration</h3>
            <p class="text-slate-600 text-sm leading-relaxed">Social Security System membership number application, beneficiary profile structuring, and digital document support.</p>
          </div>
          <div class="bg-white p-8 rounded-2xl shadow-xl border border-slate-100 hover:shadow-2xl transition">
            <div class="text-4xl mb-4 bg-amber-50 w-16 h-16 flex items-center justify-center rounded-2xl text-amber-600">🏠</div>
            <h3 class="text-2xl font-bold text-blue-900 mb-3">Pag-IBIG Fund</h3>
            <p class="text-slate-600 text-sm leading-relaxed">HDMF MID number application assistance, membership registration, savings ID generation, and contribution tracking.</p>
          </div>
        </div>

        <div class="bg-slate-900 text-slate-300 p-8 rounded-3xl shadow-2xl mb-16 grid md:grid-cols-2 gap-8 items-center">
          <div>
            <h2 class="text-2xl font-bold text-white mb-4">30+ Features Built For Your Convenience</h2>
            <ul class="space-y-3 text-sm">
              <li class="flex items-center space-x-2"><span>📱</span> <strong>Device Selection Gateway</strong> (Mobile, Tablet, Desktop customization)</li>
              <li class="flex items-center space-x-2"><span>⏳</span> <strong>15-Day Long Session Persistence</strong> (No need to re-login every day)</li>
              <li class="flex items-center space-x-2"><span>✅</span> <strong>Dedicated GCash QR Codes</strong> for BIR, SSS, and Pag-IBIG payments</li>
              <li class="flex items-center space-x-2"><span>🌐</span> <strong>Bilingual Support</strong> (English and Tagalog language switcher)</li>
            </ul>
          </div>
          <div class="bg-slate-800 p-6 rounded-2xl border border-slate-700 text-center">
            <h3 class="font-bold text-white mb-2">Need Assistance?</h3>
            <p class="text-xs text-slate-400 mb-4">Contact our support hotline or email us anytime.</p>
            <p class="text-blue-400 font-bold">${settings.contact_number}</p>
            <p class="text-blue-400 font-bold">${settings.email}</p>
          </div>
        </div>

        <div class="bg-amber-50 border-l-4 border-amber-500 p-6 rounded-r-2xl text-amber-900 text-xs md:text-sm shadow">
          <strong>Government Disclaimer:</strong> ${settings.business_name} is an independent application assistance, document collection, processing, and tracking platform created by <strong>${settings.creator_name}</strong>. It is not affiliated with the official websites of BIR, SSS, or Pag-IBIG.
        </div>
      </main>

      <footer class="bg-slate-950 text-slate-400 py-8 text-center text-sm border-t border-slate-800">
        <p>&copy; 2026 ${settings.business_name}. Developed by <strong>${settings.creator_name}</strong>. All rights reserved.</p>
      </footer>
    </body>
    </html>
  `);
});

// Public Application Tracker
app.get('/track-public', (req, res) => {
  const trackingNumber = (req.query.tracking_number || '').trim();
  const settings = res.locals.settings;

  if (!trackingNumber) {
    return res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Track Application - ${settings.business_name}</title>
        <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
      </head>
      <body class="bg-slate-50 text-slate-800 font-sans">
        <div class="max-w-xl mx-auto px-4 py-16">
          <div class="text-center mb-8">
            <h1 class="text-3xl font-black text-blue-950">Track Your Application</h1>
            <p class="text-sm text-slate-600 mt-2">Enter your unique tracking number below to check real-time status.</p>
          </div>
          <form action="/track-public" method="GET" class="bg-white p-8 rounded-2xl shadow-xl space-y-4 mb-6 border border-slate-100">
            <div>
              <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-2">Tracking Number</label>
              <input type="text" name="tracking_number" required placeholder="e.g. TIN-20260902-1234" class="w-full border border-slate-300 rounded-xl px-4 py-3 uppercase font-mono text-sm focus:ring-2 focus:ring-blue-600 outline-none">
            </div>
            <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl shadow-lg transition">Search Status</button>
          </form>
          <div class="text-center mt-6">
            <a href="/" class="text-blue-600 hover:underline text-sm font-semibold">&larr; Back to Home</a>
          </div>
        </div>
      </body>
      </html>
    `);
  }

  db.get(`SELECT * FROM applications WHERE tracking_number = ?`, [trackingNumber], (err, app) => {
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Tracking Result - ${settings.business_name}</title>
        <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
      </head>
      <body class="bg-slate-50 text-slate-800 font-sans">
        <div class="max-w-xl mx-auto px-4 py-16">
          <div class="text-center mb-8">
            <h1 class="text-3xl font-black text-blue-950">Application Status</h1>
          </div>
          ${app ? `
            <div class="bg-white p-8 rounded-3xl shadow-xl border border-slate-100 space-y-4">
              <div class="flex justify-between border-b pb-3">
                <span class="text-xs font-bold text-slate-500 uppercase">Tracking Number</span>
                <span class="font-mono font-bold text-blue-900">${app.tracking_number}</span>
              </div>
              <div class="flex justify-between border-b pb-3">
                <span class="text-xs font-bold text-slate-500 uppercase">Service</span>
                <span class="font-bold text-slate-800">${app.service}</span>
              </div>
              <div class="flex justify-between border-b pb-3">
                <span class="text-xs font-bold text-slate-500 uppercase">Application Status</span>
                <span class="px-3 py-1 bg-blue-100 text-blue-800 rounded-full font-bold text-xs">${app.status}</span>
              </div>
              <div class="flex justify-between border-b pb-3">
                <span class="text-xs font-bold text-slate-500 uppercase">Payment Status</span>
                <span class="px-3 py-1 bg-amber-100 text-amber-800 rounded-full font-bold text-xs">${app.payment_status}</span>
              </div>
              <div class="text-center pt-4">
                <a href="/customer/login" class="text-blue-600 font-bold hover:underline text-sm">Login to customer portal for complete files and history &rarr;</a>
              </div>
            </div>
          ` : `
            <div class="bg-white p-8 rounded-3xl shadow-xl border border-slate-100 text-center">
              <p class="text-red-600 font-bold mb-4">No application found matching tracking number "${trackingNumber}".</p>
              <a href="/track-public" class="text-blue-600 hover:underline text-sm font-semibold">Try searching again</a>
            </div>
          `}
          <div class="text-center mt-6">
            <a href="/" class="text-blue-600 hover:underline text-sm font-semibold">&larr; Back to Home</a>
          </div>
        </div>
      </body>
      </html>
    `);
  });
});

// ==========================================
// CUSTOMER AUTHENTICATION & REGISTRATION
// ==========================================
app.get('/customer/register', (req, res) => {
  const settings = res.locals.settings;
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Customer Registration - ${settings.business_name}</title>
      <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
    </head>
    <body class="bg-slate-100 flex items-center justify-center min-h-screen p-4">
      <div class="bg-white w-full max-w-md p-8 rounded-3xl shadow-2xl border border-slate-100">
        <h2 class="text-2xl font-black text-blue-950 mb-2 text-center">Customer Registration</h2>
        <p class="text-xs text-slate-500 text-center mb-6">System by: ${settings.creator_name}</p>
        <form action="/customer/register" method="POST" class="space-y-4">
          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Full Name</label>
            <input type="text" name="full_name" required class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-600 outline-none" placeholder="Juan Dela Cruz">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Username</label>
            <input type="text" name="username" required class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-600 outline-none" placeholder="juandelacruz">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Mobile Number</label>
            <input type="text" name="mobile_number" required class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-600 outline-none" placeholder="09123456789">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Email Address</label>
            <input type="email" name="email_address" required class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-600 outline-none" placeholder="juan@example.com">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Password</label>
            <input type="password" name="password" required class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-600 outline-none">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Confirm Password</label>
            <input type="password" name="confirm_password" required class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-600 outline-none">
          </div>
          <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl shadow-lg transition text-sm">Register Account</button>
        </form>
        <p class="text-center text-sm mt-6 text-slate-600">Already have an account? <a href="/customer/login" class="text-blue-600 font-bold hover:underline">Login here</a></p>
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
        res.redirect('/customer/login');
      });
  } catch (e) {
    res.send(`<script>alert('Registration error!'); window.history.back();</script>`);
  }
});

app.get('/customer/login', (req, res) => {
  const settings = res.locals.settings;
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Customer Login - ${settings.business_name}</title>
      <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
    </head>
    <body class="bg-slate-100 flex items-center justify-center min-h-screen p-4">
      <div class="bg-white w-full max-w-md p-8 rounded-3xl shadow-2xl border border-slate-100">
        <h2 class="text-2xl font-black text-blue-950 mb-2 text-center">Customer Login</h2>
        <p class="text-xs text-slate-500 text-center mb-6">Created by: ${settings.creator_name}</p>
        <form action="/customer/login" method="POST" class="space-y-4">
          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Username</label>
            <input type="text" name="username" required class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-600 outline-none">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Password</label>
            <input type="password" name="password" required class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-600 outline-none">
          </div>
          <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl shadow-lg transition text-sm">Login</button>
        </form>
        <p class="text-center text-sm mt-6 text-slate-600">Don't have an account? <a href="/customer/register" class="text-blue-600 font-bold hover:underline">Register here</a></p>
        <div class="text-center mt-4"><a href="/" class="text-slate-400 hover:underline text-xs">&larr; Back to home</a></div>
      </div>
    </body>
    </html>
  `);
});

app.post('/customer/login', (req, res) => {
  const { username, password } = req.body;
  db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
    if (user && await bcrypt.compare(password, user.password)) {
      req.session.customer = { id: user.id, username: user.username, full_name: user.full_name, email: user.email_address };
      if (user.device_preference) {
        req.session.device = user.device_preference;
      }
      res.redirect('/customer/select-device?redirect=/customer/dashboard');
    } else {
      res.send(`<script>alert('Invalid username or password!'); window.history.back();</script>`);
    }
  });
});

app.get('/customer/logout', (req, res) => {
  req.session.customer = null;
  res.redirect('/customer/login');
});

// ==========================================
// ADMIN AUTHENTICATION
// ==========================================
app.get('/admin/login', (req, res) => {
  const settings = res.locals.settings;
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Admin Portal Login - ${settings.business_name}</title>
      <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
    </head>
    <body class="bg-slate-950 flex items-center justify-center min-h-screen p-4">
      <div class="bg-white w-full max-w-md p-8 rounded-3xl shadow-2xl border border-slate-800">
        <h2 class="text-2xl font-black text-slate-900 mb-2 text-center">Admin Portal Login</h2>
        <p class="text-xs text-slate-500 text-center mb-6">Developer: ${settings.creator_name}</p>
        <form action="/admin/login" method="POST" class="space-y-4">
          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Admin Username</label>
            <input type="text" name="username" required class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-slate-900 outline-none">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Password</label>
            <input type="password" name="password" required class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-slate-900 outline-none">
          </div>
          <button type="submit" class="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-3 rounded-xl shadow-lg transition text-sm">Login to Admin</button>
        </form>
        <div class="text-center mt-4"><a href="/" class="text-slate-400 hover:underline text-xs">&larr; Back to home</a></div>
      </div>
    </body>
    </html>
  `);
});

app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  db.get(`SELECT * FROM admin_users WHERE username = ?`, [username], async (err, admin) => {
    if (admin && await bcrypt.compare(password, admin.password)) {
      req.session.admin = { id: admin.id, username: admin.username };
      logAudit(admin.username, 'Admin logged in');
      res.redirect('/admin/dashboard');
    } else {
      res.send(`<script>alert('Invalid admin credentials!'); window.history.back();</script>`);
    }
  });
});

app.get('/admin/logout', (req, res) => {
  if (req.session.admin) {
    logAudit(req.session.admin.username, 'Admin logged out');
  }
  req.session.admin = null;
  res.redirect('/admin/login');
});

// ==========================================
// CUSTOMER PORTAL & DASHBOARD
// ==========================================
function customerLayout(title, content, activeTab, unreadCount = 0, reqSession = null) {
  const customerName = reqSession && reqSession.customer ? reqSession.customer.full_name : '';
  const lang = reqSession && reqSession.lang ? reqSession.lang : 'en';
  const device = reqSession && reqSession.device ? reqSession.device : 'mobile';

  return `
    <!DOCTYPE html>
    <html lang="${lang}">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title} - GovAssist PH (${device.toUpperCase()} Mode)</title>
      <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
    </head>
    <body class="bg-slate-100 text-slate-800 font-sans antialiased">
      <div class="min-h-screen flex flex-col md:flex-row">
        <aside class="bg-blue-950 text-white w-full md:w-72 p-6 flex flex-col justify-between shadow-2xl">
          <div>
            <div class="mb-6 flex justify-between items-start">
              <div>
                <span class="text-xl font-black tracking-tight block">GovAssist PH</span>
                <span class="text-xs text-blue-300">Created by: Mark Jerald Agdigos</span>
              </div>
              <a href="/customer/select-device" class="bg-blue-800 hover:bg-blue-700 text-xs px-2 py-1 rounded font-bold uppercase tracking-wide">
                ${device === 'mobile' ? '📱 Mobile' : (device === 'tablet' ? '📲 Tablet' : '💻 PC')}
              </a>
            </div>
            <nav class="space-y-1.5 text-sm">
              <a href="/customer/dashboard" class="flex items-center space-x-2 px-4 py-3 rounded-xl transition ${activeTab === 'dashboard' ? 'bg-blue-600 font-bold shadow-lg' : 'hover:bg-blue-900 text-blue-200'}">📊 Dashboard</a>
              <a href="/customer/apply" class="flex items-center space-x-2 px-4 py-3 rounded-xl transition ${activeTab === 'apply' ? 'bg-blue-600 font-bold shadow-lg' : 'hover:bg-blue-900 text-blue-200'}">➕ New Application</a>
              <a href="/customer/applications" class="flex items-center space-x-2 px-4 py-3 rounded-xl transition ${activeTab === 'applications' ? 'bg-blue-600 font-bold shadow-lg' : 'hover:bg-blue-900 text-blue-200'}">📋 My Applications</a>
              <a href="/customer/documents" class="flex items-center space-x-2 px-4 py-3 rounded-xl transition ${activeTab === 'documents' ? 'bg-blue-600 font-bold shadow-lg' : 'hover:bg-blue-900 text-blue-200'}">📂 Completed Files</a>
              <a href="/customer/tickets" class="flex items-center space-x-2 px-4 py-3 rounded-xl transition ${activeTab === 'tickets' ? 'bg-blue-600 font-bold shadow-lg' : 'hover:bg-blue-900 text-blue-200'}">💬 Support Tickets</a>
              <a href="/customer/notifications" class="flex items-center justify-between px-4 py-3 rounded-xl transition ${activeTab === 'notifications' ? 'bg-blue-600 font-bold shadow-lg' : 'hover:bg-blue-900 text-blue-200'}">
                <span>🔔 Notifications</span>
                ${unreadCount > 0 ? `<span class="bg-red-500 text-white px-2 py-0.5 rounded-full text-xs font-bold">${unreadCount}</span>` : ''}
              </a>
              <a href="/customer/profile" class="flex items-center space-x-2 px-4 py-3 rounded-xl transition ${activeTab === 'profile' ? 'bg-blue-600 font-bold shadow-lg' : 'hover:bg-blue-900 text-blue-200'}">👤 My Profile</a>
            </nav>
          </div>
          <div class="mt-8 pt-4 border-t border-blue-900 space-y-4">
            <div class="flex bg-blue-900 p-1 rounded-xl text-xs font-bold justify-center">
              <a href="/set-lang/en" class="px-3 py-1 rounded ${lang === 'en' ? 'bg-blue-600 text-white' : 'text-blue-300'}">English</a>
              <a href="/set-lang/tl" class="px-3 py-1 rounded ${lang === 'tl' ? 'bg-blue-600 text-white' : 'text-blue-300'}">Tagalog</a>
            </div>
            <span class="block text-xs text-blue-300 truncate">User: <strong>${customerName}</strong></span>
            <a href="/customer/logout" class="block text-center bg-red-600 hover:bg-red-700 text-white py-2.5 rounded-xl text-xs font-bold shadow transition">Logout</a>
          </div>
        </aside>
        
        <main class="flex-1 p-4 md:p-10 overflow-y-auto">
          ${content}
        </main>
      </div>
    </body>
    </html>
  `;
}

app.get('/customer/dashboard', requireCustomer, async (req, res) => {
  const customerId = req.session.customer.id;
  db.all(`SELECT * FROM applications WHERE customer_id = ? ORDER BY id DESC`, [customerId], async (err, apps) => {
    db.all(`SELECT * FROM notifications WHERE customer_id = ? AND is_read = 0`, [customerId], async (err2, notifs) => {
      const totalApps = apps.length;
      const pendingApps = apps.filter(a => a.status === 'Submitted' || a.status === 'Under Review' || a.status === 'Processing').length;
      const completedApps = apps.filter(a => a.status === 'Completed').length;

      const content = `
        <h1 class="text-3xl font-black text-blue-950 mb-6">Customer Dashboard</h1>
        
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div class="bg-white p-6 rounded-2xl shadow-xl border-l-4 border-blue-600 border border-slate-100">
            <h3 class="text-slate-500 text-xs font-bold uppercase tracking-wider">Total Applications</h3>
            <p class="text-3xl font-black text-blue-950 mt-2">${totalApps}</p>
          </div>
          <div class="bg-white p-6 rounded-2xl shadow-xl border-l-4 border-amber-500 border border-slate-100">
            <h3 class="text-slate-500 text-xs font-bold uppercase tracking-wider">Pending / In Progress</h3>
            <p class="text-3xl font-black text-amber-600 mt-2">${pendingApps}</p>
          </div>
          <div class="bg-white p-6 rounded-2xl shadow-xl border-l-4 border-emerald-600 border border-slate-100">
            <h3 class="text-slate-500 text-xs font-bold uppercase tracking-wider">Completed</h3>
            <p class="text-3xl font-black text-emerald-600 mt-2">${completedApps}</p>
          </div>
        </div>

        <div class="bg-white p-8 rounded-2xl shadow-xl border border-slate-100 mb-8">
          <div class="flex justify-between items-center mb-6">
            <h2 class="text-xl font-bold text-blue-950">Recent Applications</h2>
            <a href="/customer/apply" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-xs font-bold shadow transition">+ New Application</a>
          </div>
          ${apps.length === 0 ? `<p class="text-slate-500 text-sm">No applications submitted yet.</p>` : `
            <div class="overflow-x-auto">
              <table class="w-full text-left border-collapse">
                <thead>
                  <tr class="border-b bg-slate-50 text-xs text-slate-600 uppercase">
                    <th class="p-3">Tracking Number</th>
                    <th class="p-3">Service</th>
                    <th class="p-3">Status</th>
                    <th class="p-3">Payment</th>
                    <th class="p-3">Action</th>
                  </tr>
                </thead>
                <tbody class="text-sm">
                  ${apps.slice(0, 5).map(app => `
                    <tr class="border-b hover:bg-slate-50 transition">
                      <td class="p-3 font-mono font-bold text-blue-900">${app.tracking_number}</td>
                      <td class="p-3 font-semibold">${app.service}</td>
                      <td class="p-3"><span class="px-2.5 py-1 bg-blue-100 text-blue-800 rounded-full font-bold text-xs">${app.status}</span></td>
                      <td class="p-3"><span class="px-2.5 py-1 bg-amber-100 text-amber-800 rounded-full font-bold text-xs">${app.payment_status}</span></td>
                      <td class="p-3 space-x-2">
                        <a href="/customer/track/${app.id}" class="text-blue-600 font-bold hover:underline text-xs">View Tracking</a>
                        <a href="/customer/print/${app.id}" target="_blank" class="text-emerald-600 font-bold hover:underline text-xs">Print Receipt</a>
                      </td>
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

// Multi-Step Application Wizard Route with Specific BIR, SSS, and Pag-IBIG QR Codes
app.get('/customer/apply', requireCustomer, async (req, res) => {
  const settings = res.locals.settings;

  if (settings.maintenance_mode === '1') {
    return res.send(customerLayout('Maintenance', `
      <div class="bg-amber-50 border border-amber-200 p-8 rounded-3xl text-center">
        <h2 class="text-2xl font-black text-amber-900 mb-2">System Under Maintenance</h2>
        <p class="text-slate-600 text-sm">Pansamantalang sarado ang pagtanggap ng mga bagong aplikasyon habang isinasagawa ang maintenance. Subukang muli mamaya.</p>
      </div>
    `, 'apply', 0, req.session));
  }

  const content = `
    <h1 class="text-3xl font-black text-blue-950 mb-6">New Government Application</h1>
    <form action="/customer/apply" method="POST" enctype="multipart/form-data" class="bg-white p-6 md:p-12 rounded-3xl shadow-2xl space-y-10 border border-slate-100" id="appForm">
      
      <div class="space-y-4">
        <h2 class="text-xl font-black text-blue-950 border-b pb-2 flex items-center justify-between">
          <span>Step 1: Select Government Service</span>
          <span class="text-xs text-blue-600 font-normal">Assisted by ${settings.creator_name}</span>
        </h2>
        <div class="grid md:grid-cols-3 gap-6">
          <label class="border-2 p-6 rounded-2xl cursor-pointer hover:border-blue-600 transition flex flex-col justify-between bg-slate-50">
            <div>
              <input type="radio" name="service" value="BIR / TIN" required class="mb-3" onchange="updateQRCodes('BIR')">
              <span class="font-black block text-xl text-blue-950">BIR / TIN</span>
              <span class="text-xs text-slate-500 block mt-2">Tax ID registration & verification support. Fee: ₱${settings.fee_bir}</span>
            </div>
          </label>
          <label class="border-2 p-6 rounded-2xl cursor-pointer hover:border-emerald-600 transition flex flex-col justify-between bg-slate-50">
            <div>
              <input type="radio" name="service" value="SSS" required class="mb-3" onchange="updateQRCodes('SSS')">
              <span class="font-black block text-xl text-emerald-950">SSS Registration</span>
              <span class="text-xs text-slate-500 block mt-2">Social Security System membership & data. Fee: ₱${settings.fee_sss}</span>
            </div>
          </label>
          <label class="border-2 p-6 rounded-2xl cursor-pointer hover:border-amber-600 transition flex flex-col justify-between bg-slate-50">
            <div>
              <input type="radio" name="service" value="PAG-IBIG" required class="mb-3" onchange="updateQRCodes('PAG-IBIG')">
              <span class="font-black block text-xl text-amber-950">Pag-IBIG Fund</span>
              <span class="text-xs text-slate-500 block mt-2">HDMF MID registration & housing fund. Fee: ₱${settings.fee_pagibig}</span>
            </div>
          </label>
        </div>
      </div>

      <div class="space-y-4">
        <h2 class="text-xl font-black text-blue-950 border-b pb-2">Step 2: Personal Information</h2>
        <div class="grid md:grid-cols-3 gap-4">
          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">First Name *</label>
            <input type="text" name="first_name" required class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-600 outline-none" placeholder="Juan">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Middle Name</label>
            <input type="text" name="middle_name" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-600 outline-none" placeholder="Santos">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Last Name *</label>
            <input type="text" name="last_name" required class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-600 outline-none" placeholder="Dela Cruz">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Suffix (Optional)</label>
            <input type="text" name="suffix" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-600 outline-none" placeholder="Jr., III">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Date of Birth *</label>
            <input type="date" name="date_of_birth" required class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-600 outline-none">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Place of Birth *</label>
            <input type="text" name="place_of_birth" required class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-600 outline-none" placeholder="Manila">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Sex *</label>
            <select name="sex" required class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white">
              <option value="Male">Male</option>
              <option value="Female">Female</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Civil Status *</label>
            <select name="civil_status" id="civilStatus" required class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white" onchange="toggleMarriageSection()">
              <option value="Single">Single</option>
              <option value="Married">Married</option>
              <option value="Widowed">Widowed</option>
              <option value="Separated">Separated</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Nationality *</label>
            <input type="text" name="nationality" value="Filipino" required class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm">
          </div>
        </div>
      </div>

      <div class="space-y-4">
        <h2 class="text-xl font-black text-blue-950 border-b pb-2">Step 3: Contact & Address Information</h2>
        <div class="grid md:grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Mobile Number *</label>
            <input type="text" name="mobile_number" required class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm" placeholder="09123456789">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Email Address *</label>
            <input type="email" name="email_address" required class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm" placeholder="juan@example.com">
          </div>
        </div>
        <div class="grid md:grid-cols-3 gap-4">
          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">House / Unit & Street *</label>
            <input type="text" name="street" required class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm" placeholder="123 Rizal Street">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Barangay *</label>
            <input type="text" name="barangay" required class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm" placeholder="Barangay San Antonio">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">City / Municipality *</label>
            <input type="text" name="city" required class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm" placeholder="Quezon City">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Province *</label>
            <input type="text" name="province" required class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm" placeholder="Metro Manila">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">ZIP Code *</label>
            <input type="text" name="zip_code" required class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm" placeholder="1100">
          </div>
        </div>
      </div>

      <div class="space-y-4">
        <h2 class="text-xl font-black text-blue-950 border-b pb-2">Step 4: Parents & Spouse Information</h2>
        <div class="grid md:grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Father's Full Name *</label>
            <input type="text" name="father_name" required class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm" placeholder="Pedro Dela Cruz">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Father's Date of Birth *</label>
            <input type="date" name="father_dob" required class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Mother's Maiden Full Name *</label>
            <input type="text" name="mother_maiden_name" required class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm" placeholder="Maria Santos">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Mother's Date of Birth *</label>
            <input type="date" name="mother_dob" required class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm">
          </div>
        </div>

        <div id="marriageSection" class="hidden p-6 bg-slate-50 border rounded-2xl space-y-4 mt-4">
          <h3 class="font-bold text-blue-950">Spouse Details (Required for Married applicants)</h3>
          <div class="grid md:grid-cols-2 gap-4">
            <div>
              <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Spouse Full Name</label>
              <input type="text" name="spouse_name" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white">
            </div>
            <div>
              <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Spouse Date of Birth</label>
              <input type="date" name="spouse_dob" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white">
            </div>
            <div>
              <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Marriage Date</label>
              <input type="date" name="marriage_date" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white">
            </div>
            <div>
              <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Marriage Certificate (Image or PDF)</label>
              <input type="file" name="marriage_certificate" accept="image/*,application/pdf" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs bg-white">
            </div>
          </div>
        </div>
      </div>

      <div class="space-y-4">
        <h2 class="text-xl font-black text-blue-950 border-b pb-2">Step 5: Employment & Financial Information</h2>
        <div class="grid md:grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Employment Status *</label>
            <select name="employment_status" required class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white">
              <option value="Employed">Employed</option>
              <option value="Self-Employed">Self-Employed</option>
              <option value="Unemployed">Unemployed</option>
              <option value="OFW">OFW</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Occupation / Profession</label>
            <input type="text" name="occupation" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm" placeholder="Software Engineer">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Employer Name (If Employed)</label>
            <input type="text" name="employer_name" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm" placeholder="ABC Corporation">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Monthly Income Bracket</label>
            <select name="income_bracket" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white">
              <option value="Below 15,000">Below ₱15,000</option>
              <option value="15,000 - 30,000">₱15,000 - ₱30,000</option>
              <option value="30,000 - 50,000">₱30,000 - ₱50,000</option>
              <option value="Above 50,000">Above ₱50,000</option>
            </select>
          </div>
        </div>
      </div>

      <div id="beneficiarySectionContainer" class="space-y-4">
        <h2 class="text-xl font-black text-blue-950 border-b pb-2">Step 6: Beneficiaries (For SSS & Pag-IBIG)</h2>
        <div id="beneficiariesList" class="space-y-4">
          <div class="beneficiary-item border-2 p-6 rounded-2xl bg-slate-50 relative space-y-3">
            <h4 class="font-bold text-sm text-blue-950">Beneficiary 1</h4>
            <div class="grid md:grid-cols-3 gap-3">
              <div>
                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Full Name</label>
                <input type="text" name="ben_name[]" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white" placeholder="Full Name">
              </div>
              <div>
                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Date of Birth</label>
                <input type="date" name="ben_dob[]" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white">
              </div>
              <div>
                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Relationship</label>
                <input type="text" name="ben_relationship[]" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white" placeholder="Spouse / Child / Parent">
              </div>
              <div class="md:col-span-2">
                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Address</label>
                <input type="text" name="ben_address[]" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white" placeholder="Address">
              </div>
              <div>
                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Contact Number</label>
                <input type="text" name="ben_contact[]" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white" placeholder="Contact #">
              </div>
            </div>
          </div>
        </div>
        <button type="button" onclick="addBeneficiary()" class="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs font-bold transition shadow">+ Add Beneficiary</button>
      </div>

      <div class="space-y-4">
        <h2 class="text-xl font-black text-blue-950 border-b pb-2">Step 7: Mandatory Valid ID & Document Uploads</h2>
        <div class="grid md:grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Valid ID Type *</label>
            <select name="id_type" required class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white">
              <option value="National ID">National ID</option>
              <option value="Passport">Passport</option>
              <option value="Driver's License">Driver's License</option>
              <option value="UMID">UMID</option>
              <option value="Postal ID">Postal ID</option>
              <option value="Voter's ID">Voter's ID</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">ID Picture / Selfie *</label>
            <input type="file" name="id_picture" accept="image/*" required class="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs bg-white">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Front of Valid ID *</label>
            <input type="file" name="id_front" accept="image/*,application/pdf" required class="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs bg-white">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Back of Valid ID *</label>
            <input type="file" name="id_back" accept="image/*,application/pdf" required class="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs bg-white">
          </div>
          <div class="md:col-span-2">
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">Photo Holding Valid ID *</label>
            <input type="file" name="photo_holding_id" accept="image/*" required class="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs bg-white">
            <span class="text-xs text-slate-500">Clear selfie holding your valid ID next to your face for identity verification.</span>
          </div>
        </div>
      </div>

      <div class="space-y-4">
        <h2 class="text-xl font-black text-blue-950 border-b pb-2">Step 8: Payment & Dedicated Service QR Code</h2>
        <div class="grid md:grid-cols-2 gap-4">
          <label class="border-2 p-6 rounded-2xl cursor-pointer hover:border-blue-600 block bg-slate-50">
            <input type="radio" name="payment_method" value="GCash" required class="mb-2" checked>
            <span class="font-bold block text-blue-950">GCash Instant Payment</span>
            <span class="text-xs text-slate-500 block mt-1">Scan the specific BIR, SSS, or Pag-IBIG QR code below and upload receipt.</span>
          </label>
          <label class="border-2 p-6 rounded-2xl cursor-pointer hover:border-blue-600 block bg-slate-50">
            <input type="radio" name="payment_method" value="Cash" required class="mb-2">
            <span class="font-bold block text-blue-950">Over-the-Counter Cash</span>
            <span class="text-xs text-slate-500 block mt-1">Pay at physical partner locations or office.</span>
          </label>
        </div>

        <div class="bg-blue-50 p-6 rounded-2xl border border-blue-200">
          <h4 class="font-black text-blue-950 text-base mb-2">GCash Account Information:</h4>
          <p class="text-xs text-slate-700">Account Name: <strong>${settings.gcash_name}</strong></p>
          <p class="text-xs text-slate-700 mb-4">Account Number: <strong>${settings.gcash_number}</strong></p>
          
          <div class="grid md:grid-cols-3 gap-4 mb-4">
            <div id="qrBirContainer" class="bg-white p-4 rounded-xl border text-center">
              <span class="text-xs font-bold block mb-1 text-blue-900">BIR QR Code</span>
              ${settings.qr_bir ? `<img src="${settings.qr_bir}" class="h-32 w-32 object-contain mx-auto border p-1 rounded"/>` : '<span class="text-xs text-slate-400">No BIR QR set</span>'}
            </div>
            <div id="qrSssContainer" class="bg-white p-4 rounded-xl border text-center">
              <span class="text-xs font-bold block mb-1 text-emerald-900">SSS QR Code</span>
              ${settings.qr_sss ? `<img src="${settings.qr_sss}" class="h-32 w-32 object-contain mx-auto border p-1 rounded"/>` : '<span class="text-xs text-slate-400">No SSS QR set</span>'}
            </div>
            <div id="qrPagibigContainer" class="bg-white p-4 rounded-xl border text-center">
              <span class="text-xs font-bold block mb-1 text-amber-900">Pag-IBIG QR Code</span>
              ${settings.qr_pagibig ? `<img src="${settings.qr_pagibig}" class="h-32 w-32 object-contain mx-auto border p-1 rounded"/>` : '<span class="text-xs text-slate-400">No Pag-IBIG QR set</span>'}
            </div>
          </div>

          <div class="space-y-3">
            <div>
              <label class="block text-xs font-bold uppercase text-slate-700 mb-1">Upload Proof of Payment / Receipt *</label>
              <input type="file" name="proof_of_payment" accept="image/*,application/pdf" class="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white text-xs">
            </div>
            <div>
              <input type="text" name="reference_number" placeholder="GCash Reference Number (e.g. 104928374)" class="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white text-sm">
            </div>
          </div>
        </div>
      </div>

      <div class="pt-4 border-t">
        <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-2xl text-base shadow-xl transition transform hover:-translate-y-0.5">Submit Application & Generate Tracking Number</button>
      </div>

    </form>

    <script>
      function toggleMarriageSection() {
        const val = document.getElementById('civilStatus').value;
        const section = document.getElementById('marriageSection');
        if (val === 'Married') {
          section.classList.remove('hidden');
        } else {
          section.classList.add('hidden');
        }
      }

      let beneficiaryCount = 1;
      function addBeneficiary() {
        beneficiaryCount++;
        const container = document.getElementById('beneficiariesList');
        const div = document.createElement('div');
        div.className = 'beneficiary-item border-2 p-6 rounded-2xl bg-slate-50 relative space-y-3';
        div.innerHTML = \`
          <div class="flex justify-between items-center">
            <h4 class="font-bold text-sm text-blue-950">Beneficiary \${beneficiaryCount}</h4>
            <button type="button" onclick="this.closest('.beneficiary-item').remove()" class="text-red-600 text-xs font-bold hover:underline">Remove</button>
          </div>
          <div class="grid md:grid-cols-3 gap-3">
            <div>
              <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Full Name</label>
              <input type="text" name="ben_name[]" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white" placeholder="Full Name">
            </div>
            <div>
              <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Date of Birth</label>
              <input type="date" name="ben_dob[]" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white">
            </div>
            <div>
              <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Relationship</label>
              <input type="text" name="ben_relationship[]" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white" placeholder="Spouse / Child / Parent">
            </div>
            <div class="md:col-span-2">
              <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Address</label>
              <input type="text" name="ben_address[]" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white" placeholder="Address">
            </div>
            <div>
              <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Contact Number</label>
              <input type="text" name="ben_contact[]" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white" placeholder="Contact #">
            </div>
          </div>
        \`;
        container.appendChild(div);
      }

      function updateQRCodes(serviceType) {
        document.getElementById('qrBirContainer').style.opacity = serviceType === 'BIR / TIN' ? '1' : '0.4';
        document.getElementById('qrSssContainer').style.opacity = serviceType === 'SSS' ? '1' : '0.4';
        document.getElementById('qrPagibigContainer').style.opacity = serviceType === 'PAG-IBIG' ? '1' : '0.4';
      }
    </script>
  `;
  res.send(customerLayout('New Application', content, 'apply', 0, req.session));
});

// Handle Application Submission with Multer fields
const cpUpload = upload.fields([
  { name: 'marriage_certificate', maxCount: 1 },
  { name: 'id_picture', maxCount: 1 },
  { name: 'id_front', maxCount: 1 },
  { name: 'id_back', maxCount: 1 },
  { name: 'photo_holding_id', maxCount: 1 },
  { name: 'proof_of_payment', maxCount: 1 }
]);

app.post('/customer/apply', requireCustomer, cpUpload, async (req, res) => {
  const customerId = req.session.customer.id;
  const body = req.body;
  const files = req.files;

  const service = body.service;
  const prefix = service === 'BIR / TIN' ? 'TIN' : (service === 'SSS' ? 'SSS' : 'PAGIBIG');
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randomNum = Math.floor(1000 + Math.random() * 9000);
  const trackingNumber = `${prefix}-${dateStr}-${randomNum}`;

  const settings = await getSettings();
  const fee = service === 'BIR / TIN' ? settings.fee_bir : (service === 'SSS' ? settings.fee_sss : settings.fee_pagibig);

  db.run(`INSERT INTO applications (customer_id, service, tracking_number, status, payment_status, data_json) VALUES (?, ?, ?, 'Submitted', 'Payment Pending', ?)`,
    [customerId, service, trackingNumber, JSON.stringify(body)], function(err) {
      if (err) {
        return res.send(`<script>alert('Error creating application: ${err.message}'); window.history.back();</script>`);
      }
      const appId = this.lastID;

      logStatusHistory(appId, 'Submitted', 'Application successfully submitted by customer.');
      addNotification(customerId, 'Application Submitted', `Your application ${trackingNumber} has been successfully submitted.`);

      if (body.ben_name && Array.isArray(body.ben_name)) {
        for (let i = 0; i < body.ben_name.length; i++) {
          if (body.ben_name[i]) {
            db.run(`INSERT INTO beneficiaries (application_id, full_name, birth_date, relationship, address, contact_number) VALUES (?, ?, ?, ?, ?, ?)`,
              [appId, body.ben_name[i], body.ben_dob[i], body.ben_relationship[i], body.ben_address[i], body.ben_contact[i]]);
          }
        }
      }

      if (files) {
        for (const [key, fileArr] of Object.entries(files)) {
          if (fileArr && fileArr[0]) {
            db.run(`INSERT INTO documents (application_id, doc_type, file_path, file_name) VALUES (?, ?, ?, ?)`,
              [appId, key, '/uploads/' + fileArr[0].filename, fileArr[0].originalname]);
          }
        }
      }

      const proofPath = files['proof_of_payment'] ? '/uploads/' + files['proof_of_payment'][0].filename : '';
      db.run(`INSERT INTO payments (customer_id, application_id, tracking_number, service, payment_method, amount, reference_number, proof_path, payment_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pending Verification')`,
        [customerId, appId, trackingNumber, service, body.payment_method, fee, body.reference_number || '', proofPath]);

      res.redirect(`/customer/track/${appId}`);
    });
});

app.get('/customer/applications', requireCustomer, (req, res) => {
  const customerId = req.session.customer.id;
  db.all(`SELECT * FROM applications WHERE customer_id = ? ORDER BY id DESC`, [customerId], (err, apps) => {
    const content = `
      <h1 class="text-3xl font-black text-blue-950 mb-6">My Applications</h1>
      <div class="bg-white p-8 rounded-3xl shadow-2xl border border-slate-100">
        ${apps.length === 0 ? `<p class="text-slate-500 text-sm">No applications found.</p>` : `
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse">
              <thead>
                <tr class="border-b bg-slate-50 text-xs text-slate-600 uppercase">
                  <th class="p-3">Tracking Number</th>
                  <th class="p-3">Service</th>
                  <th class="p-3">Status</th>
                  <th class="p-3">Payment</th>
                  <th class="p-3">Date</th>
                  <th class="p-3">Action</th>
                </tr>
              </thead>
              <tbody class="text-sm">
                ${apps.map(app => `
                  <tr class="border-b hover:bg-slate-50 transition">
                    <td class="p-3 font-mono font-bold text-blue-900">${app.tracking_number}</td>
                    <td class="p-3 font-semibold">${app.service}</td>
                    <td class="p-3"><span class="px-2.5 py-1 bg-blue-100 text-blue-800 rounded-full font-bold text-xs">${app.status}</span></td>
                    <td class="p-3"><span class="px-2.5 py-1 bg-amber-100 text-amber-800 rounded-full font-bold text-xs">${app.payment_status}</span></td>
                    <td class="p-3 text-xs text-slate-500">${app.created_at}</td>
                    <td class="p-3 space-x-2">
                      <a href="/customer/track/${app.id}" class="text-blue-600 font-bold hover:underline text-xs">Track Details</a>
                      <a href="/customer/print/${app.id}" target="_blank" class="text-emerald-600 font-bold hover:underline text-xs">Receipt</a>
                    </td>
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

// Printable Receipt / Summary View (Feature #11)
app.get('/customer/print/:id', requireCustomer, (req, res) => {
  const appId = req.params.id;
  const customerId = req.session.customer.id;
  const settings = res.locals.settings;

  db.get(`SELECT a.*, u.full_name, u.email_address, u.mobile_number FROM applications a JOIN users u ON a.customer_id = u.id WHERE a.id = ? AND a.customer_id = ?`, [appId, customerId], (err, app) => {
    if (!app) return res.send(`Application not found.`);

    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>Application Receipt - ${app.tracking_number}</title>
        <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
        <style>@media print { .no-print { display: none; } }</style>
      </head>
      <body class="bg-white text-slate-900 p-8 max-w-2xl mx-auto border my-8 shadow-lg font-sans">
        <div class="no-print mb-6 text-right">
          <button onclick="window.print()" class="bg-blue-600 text-white px-6 py-2 rounded-xl text-xs font-bold">Print Receipt / Save PDF</button>
        </div>
        <div class="border-b pb-6 mb-6 flex justify-between items-center">
          <div>
            <h1 class="text-2xl font-black text-blue-950">${settings.business_name}</h1>
            <p class="text-xs text-slate-500">Official Assistance Document Summary</p>
          </div>
          <div class="text-right">
            <span class="text-xs text-slate-400 block uppercase">Tracking No.</span>
            <span class="font-mono font-black text-lg text-blue-900">${app.tracking_number}</span>
          </div>
        </div>

        <div class="space-y-4 text-sm">
          <div class="grid grid-cols-2 gap-4 border-b pb-4">
            <div><span class="text-xs text-slate-500 block uppercase">Applicant Name</span> <strong>${app.full_name}</strong></div>
            <div><span class="text-xs text-slate-500 block uppercase">Service Applied</span> <strong>${app.service}</strong></div>
            <div><span class="text-xs text-slate-500 block uppercase">Contact Mobile</span> <span>${app.mobile_number}</span></div>
            <div><span class="text-xs text-slate-500 block uppercase">Date Submitted</span> <span>${app.created_at}</span></div>
          </div>

          <div class="border-b pb-4">
            <span class="text-xs text-slate-500 block uppercase mb-1">Status Overview</span>
            <div class="flex gap-4">
              <span class="px-3 py-1 bg-blue-100 text-blue-800 rounded-full font-bold text-xs">Application: ${app.status}</span>
              <span class="px-3 py-1 bg-amber-100 text-amber-800 rounded-full font-bold text-xs">Payment: ${app.payment_status}</span>
            </div>
          </div>
        </div>

        <div class="mt-12 text-center text-xs text-slate-400 border-t pt-4">
          <p>Created by: ${settings.creator_name} &bull; ${settings.contact_number}</p>
        </div>
      </body>
      </html>
    `);
  });
});

app.get('/customer/track/:id', requireCustomer, (req, res) => {
  const appId = req.params.id;
  const customerId = req.session.customer.id;

  db.get(`SELECT * FROM applications WHERE id = ? AND customer_id = ?`, [appId, customerId], (err, app) => {
    if (!app) return res.send(`<p>Application not found or unauthorized.</p>`);

    db.all(`SELECT * FROM status_history WHERE application_id = ? ORDER BY id DESC`, [appId], (err2, history) => {
      db.all(`SELECT * FROM completed_files WHERE application_id = ?`, [appId], (err3, completedFiles) => {
        db.all(`SELECT * FROM documents WHERE application_id = ?`, [appId], (err4, docs) => {
          const content = `
            <div class="flex justify-between items-center mb-6">
              <div>
                <h1 class="text-3xl font-black text-blue-950">Application Tracking</h1>
                <p class="text-xs font-mono text-slate-500 mt-1">Tracking Number: ${app.tracking_number}</p>
              </div>
              <div class="space-x-2">
                <a href="/customer/print/${app.id}" target="_blank" class="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs font-bold transition">Print Receipt</a>
                <a href="/customer/applications" class="bg-slate-200 hover:bg-slate-300 px-4 py-2 rounded-xl text-xs font-bold transition">&larr; Back</a>
              </div>
            </div>

            <div class="grid md:grid-cols-3 gap-6 mb-8">
              <div class="bg-white p-8 rounded-3xl shadow-2xl md:col-span-2 space-y-4 border border-slate-100">
                <div class="flex justify-between border-b pb-3 text-sm">
                  <span class="font-bold text-slate-600">Service:</span>
                  <span class="text-blue-950 font-black">${app.service}</span>
                </div>
                <div class="flex justify-between border-b pb-3 text-sm">
                  <span class="font-bold text-slate-600">Current Status:</span>
                  <span class="px-3 py-1 bg-blue-100 text-blue-800 rounded-full font-bold text-xs">${app.status}</span>
                </div>
                <div class="flex justify-between border-b pb-3 text-sm">
                  <span class="font-bold text-slate-600">Payment Status:</span>
                  <span class="px-3 py-1 bg-amber-100 text-amber-800 rounded-full font-bold text-xs">${app.payment_status}</span>
                </div>
                <div class="flex justify-between border-b pb-3 text-sm">
                  <span class="font-bold text-slate-600">Submission Date:</span>
                  <span class="font-semibold">${app.created_at}</span>
                </div>
                ${app.admin_remarks ? `
                  <div class="bg-amber-50 border-l-4 border-amber-500 p-4 text-amber-900 text-sm rounded-r-xl">
                    <strong>Admin Remarks / Correction Request:</strong>
                    <p class="mt-1">${app.admin_remarks}</p>
                  </div>
                ` : ''}
              </div>

              <div class="bg-white p-8 rounded-3xl shadow-2xl space-y-4 border border-slate-100">
                <h3 class="font-black text-blue-950 text-base border-b pb-2">Completed Files</h3>
                ${completedFiles.length === 0 ? `<p class="text-xs text-slate-500">No completed files uploaded by admin yet.</p>` : `
                  <div class="space-y-3">
                    ${completedFiles.map(cf => `
                      <div class="border p-3 rounded-2xl bg-slate-50 text-xs space-y-1">
                        <p class="font-bold text-blue-950">${cf.file_name}</p>
                        <p class="text-slate-500">${cf.description || 'Processed file'}</p>
                        <a href="${cf.file_path}" target="_blank" class="block text-center bg-blue-600 hover:bg-blue-700 text-white py-1.5 rounded-xl font-bold mt-2">Download</a>
                      </div>
                    `).join('')}
                  </div>
                `}
              </div>
            </div>

            <div class="bg-white p-8 rounded-3xl shadow-2xl mb-8 border border-slate-100">
              <h3 class="font-black text-blue-950 text-lg mb-6">Tracking History Timeline</h3>
              <div class="space-y-6 border-l-2 border-blue-600 pl-6 ml-2">
                ${history.map(h => `
                  <div class="relative">
                    <div class="absolute -left-[31px] top-1 w-4 h-4 bg-blue-600 rounded-full border-4 border-white shadow"></div>
                    <p class="text-xs font-semibold text-slate-400">${h.created_at}</p>
                    <p class="font-black text-blue-950 text-base mt-0.5">${h.status}</p>
                    ${h.notes ? `<p class="text-sm text-slate-600 mt-1">${h.notes}</p>` : ''}
                  </div>
                `).join('')}
              </div>
            </div>
          `;
          res.send(customerLayout('Application Tracking', content, 'applications', 0, req.session));
        });
      });
    });
  });
});

app.get('/customer/documents', requireCustomer, (req, res) => {
  const customerId = req.session.customer.id;
  db.all(`SELECT cf.*, a.tracking_number, a.service FROM completed_files cf JOIN applications a ON cf.application_id = a.id WHERE a.customer_id = ?`, [customerId], (err, files) => {
    const content = `
      <h1 class="text-3xl font-black text-blue-950 mb-6">Completed Documents</h1>
      <div class="bg-white p-8 rounded-3xl shadow-2xl border border-slate-100">
        ${files.length === 0 ? `<p class="text-slate-500 text-sm">No completed documents available yet.</p>` : `
          <div class="grid md:grid-cols-2 gap-4">
            ${files.map(f => `
              <div class="border p-6 rounded-2xl bg-slate-50 flex justify-between items-center">
                <div>
                  <span class="text-xs font-mono font-bold text-blue-600">${f.tracking_number} (${f.service})</span>
                  <h4 class="font-bold text-slate-900 text-base mt-1">${f.file_name}</h4>
                  <p class="text-xs text-slate-500 mt-1">${f.description || 'Processed document'} &bull; ${f.uploaded_at}</p>
                </div>
                <a href="${f.file_path}" target="_blank" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-xs font-bold transition">Download</a>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    `;
    res.send(customerLayout('Completed Documents', content, 'documents', 0, req.session));
  });
});

app.get('/customer/tickets', requireCustomer, (req, res) => {
  const customerId = req.session.customer.id;
  db.all(`SELECT * FROM tickets WHERE customer_id = ? ORDER BY id DESC`, [customerId], (err, tickets) => {
    const content = `
      <h1 class="text-3xl font-black text-blue-950 mb-6">Support Tickets</h1>
      <div class="grid md:grid-cols-3 gap-8">
        <form action="/customer/tickets" method="POST" class="bg-white p-8 rounded-3xl shadow-2xl space-y-4 border border-slate-100 md:col-span-1">
          <h3 class="font-black text-blue-950 text-lg mb-2">Create Ticket</h3>
          <div>
            <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Subject</label>
            <input type="text" name="subject" required class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm" placeholder="Inquiry about payment">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Message</label>
            <textarea name="message" required rows="4" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm" placeholder="Describe your concern..."></textarea>
          </div>
          <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl text-xs transition">Submit Ticket</button>
        </form>

        <div class="bg-white p-8 rounded-3xl shadow-2xl md:col-span-2 space-y-4 border border-slate-100">
          <h3 class="font-black text-blue-950 text-lg mb-4">My Inquiries</h3>
          ${tickets.length === 0 ? `<p class="text-slate-500 text-sm">No support tickets found.</p>` : tickets.map(t => `
            <div class="border p-5 rounded-2xl bg-slate-50 space-y-2">
              <div class="flex justify-between items-center">
                <span class="font-bold text-blue-950 text-base">${t.subject}</span>
                <span class="px-2.5 py-1 bg-amber-100 text-amber-800 rounded-full font-bold text-xs">${t.status}</span>
              </div>
              <p class="text-sm text-slate-600">${t.message}</p>
              ${t.admin_reply ? `<div class="bg-blue-50 p-3 rounded-xl border border-blue-200 mt-2 text-xs"><strong>Admin Reply:</strong> ${t.admin_reply}</div>` : '<p class="text-xs text-slate-400 italic">Waiting for admin response...</p>'}
            </div>
          `).join('')}
        </div>
      </div>
    `;
    res.send(customerLayout('Support Tickets', content, 'tickets', 0, req.session));
  });
});

app.post('/customer/tickets', requireCustomer, (req, res) => {
  const customerId = req.session.customer.id;
  const { subject, message } = req.body;
  db.run(`INSERT INTO tickets (customer_id, subject, message) VALUES (?, ?, ?)`, [customerId, subject, message], () => {
    res.redirect('/customer/tickets');
  });
});

app.get('/customer/notifications', requireCustomer, (req, res) => {
  const customerId = req.session.customer.id;
  db.run(`UPDATE notifications SET is_read = 1 WHERE customer_id = ?`, [customerId]);
  db.all(`SELECT * FROM notifications WHERE customer_id = ? ORDER BY id DESC`, [customerId], (err, notifs) => {
    const content = `
      <h1 class="text-3xl font-black text-blue-950 mb-6">Notifications</h1>
      <div class="bg-white p-8 rounded-3xl shadow-2xl space-y-4 border border-slate-100">
        ${notifs.length === 0 ? `<p class="text-slate-500 text-sm">No notifications.</p>` : notifs.map(n => `
          <div class="border-b pb-4 flex justify-between items-start">
            <div>
              <h4 class="font-bold text-blue-950">${n.title}</h4>
              <p class="text-sm text-slate-600 mt-1">${n.message}</p>
            </div>
            <span class="text-xs text-slate-400">${n.created_at}</span>
          </div>
        `).join('')}
      </div>
    `;
    res.send(customerLayout('Notifications', content, 'notifications', 0, req.session));
  });
});

app.get('/customer/profile', requireCustomer, (req, res) => {
  const customerId = req.session.customer.id;
  db.get(`SELECT * FROM users WHERE id = ?`, [customerId], (err, user) => {
    const content = `
      <h1 class="text-3xl font-black text-blue-950 mb-6">Customer Profile</h1>
      <form action="/customer/profile" method="POST" class="bg-white p-8 rounded-3xl shadow-2xl max-w-lg space-y-4 border border-slate-100">
        <div>
          <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Full Name</label>
          <input type="text" value="${user.full_name}" disabled class="w-full border rounded-xl px-3 py-2 bg-slate-100 text-slate-600 text-sm">
        </div>
        <div>
          <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Username</label>
          <input type="text" value="${user.username}" disabled class="w-full border rounded-xl px-3 py-2 bg-slate-100 text-slate-600 text-sm">
        </div>
        <div>
          <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Mobile Number</label>
          <input type="text" name="mobile_number" value="${user.mobile_number}" required class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm">
        </div>
        <div>
          <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Email Address</label>
          <input type="email" name="email_address" value="${user.email_address}" required class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm">
        </div>
        <div>
          <label class="block text-xs font-bold uppercase text-slate-600 mb-1">New Password (leave blank to keep current)</label>
          <input type="password" name="password" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm">
        </div>
        <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-3 rounded-xl text-xs transition shadow">Update Profile</button>
      </form>
    `;
    res.send(customerLayout('Profile', content, 'profile', 0, req.session));
  });
});

app.post('/customer/profile', requireCustomer, async (req, res) => {
  const customerId = req.session.customer.id;
  const { mobile_number, email_address, password } = req.body;
  if (password && password.trim() !== '') {
    const hashedPassword = await bcrypt.hash(password, 10);
    db.run(`UPDATE users SET mobile_number = ?, email_address = ?, password = ? WHERE id = ?`, [mobile_number, email_address, hashedPassword, customerId]);
  } else {
    db.run(`UPDATE users SET mobile_number = ?, email_address = ? WHERE id = ?`, [mobile_number, email_address, customerId]);
  }
  res.redirect('/customer/profile');
});

// ==========================================
// ADMIN PORTAL & MANAGEMENT
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
    <body class="bg-slate-900 text-slate-100 font-sans antialiased">
      <div class="min-h-screen flex flex-col md:flex-row">
        <aside class="bg-slate-950 text-white w-full md:w-72 p-6 flex flex-col justify-between shadow-2xl border-r border-slate-800">
          <div>
            <div class="mb-8">
              <span class="text-xl font-black tracking-tight block">Admin Control</span>
              <span class="text-xs text-slate-400">Developer: Mark Jerald Agdigos</span>
            </div>
            <nav class="space-y-1.5 text-sm">
              <a href="/admin/dashboard" class="flex items-center space-x-2 px-4 py-3 rounded-xl transition ${activeTab === 'dashboard' ? 'bg-blue-600 font-bold shadow-lg' : 'hover:bg-slate-900 text-slate-300'}">📊 Dashboard</a>
              <a href="/admin/applications" class="flex items-center space-x-2 px-4 py-3 rounded-xl transition ${activeTab === 'applications' ? 'bg-blue-600 font-bold shadow-lg' : 'hover:bg-slate-900 text-slate-300'}">📋 All Applications</a>
              <a href="/admin/payments" class="flex items-center space-x-2 px-4 py-3 rounded-xl transition ${activeTab === 'payments' ? 'bg-blue-600 font-bold shadow-lg' : 'hover:bg-slate-900 text-slate-300'}">💳 Payments & Verification</a>
              <a href="/admin/tickets" class="flex items-center space-x-2 px-4 py-3 rounded-xl transition ${activeTab === 'tickets' ? 'bg-blue-600 font-bold shadow-lg' : 'hover:bg-slate-900 text-slate-300'}">💬 Support Tickets</a>
              <a href="/admin/users" class="flex items-center space-x-2 px-4 py-3 rounded-xl transition ${activeTab === 'users' ? 'bg-blue-600 font-bold shadow-lg' : 'hover:bg-slate-900 text-slate-300'}">👥 Customer Accounts</a>
              <a href="/admin/settings" class="flex items-center space-x-2 px-4 py-3 rounded-xl transition ${activeTab === 'settings' ? 'bg-blue-600 font-bold shadow-lg' : 'hover:bg-slate-900 text-slate-300'}">⚙️ Settings & QR Codes</a>
              <a href="/admin/audit" class="flex items-center space-x-2 px-4 py-3 rounded-xl transition ${activeTab === 'audit' ? 'bg-blue-600 font-bold shadow-lg' : 'hover:bg-slate-900 text-slate-300'}">📜 Audit Logs</a>
              <a href="/admin/backup" class="flex items-center space-x-2 px-4 py-3 rounded-xl transition ${activeTab === 'backup' ? 'bg-blue-600 font-bold shadow-lg' : 'hover:bg-slate-900 text-slate-300'}">💾 Backup Database</a>
            </nav>
          </div>
          <div class="mt-8 pt-4 border-t border-slate-800">
            <a href="/admin/logout" class="block text-center bg-red-600 hover:bg-red-700 text-white py-2.5 rounded-xl text-xs font-bold shadow transition">Admin Logout</a>
          </div>
        </aside>

        <main class="flex-1 p-6 md:p-12 overflow-y-auto bg-slate-900 text-slate-100">
          ${content}
        </main>
      </div>
    </body>
    </html>
  `;
}

app.get('/admin/dashboard', requireAdmin, (req, res) => {
  db.all(`SELECT a.*, u.full_name as customer_name FROM applications a JOIN users u ON a.customer_id = u.id`, [], (err, apps) => {
    db.all(`SELECT * FROM payments`, [], (err2, payments) => {
      db.all(`SELECT * FROM users`, [], (err3, users) => {
        db.all(`SELECT * FROM tickets WHERE status = 'Open'`, [], (err4, openTickets) => {

          const totalCustomers = users.length;
          const totalApplications = apps.length;
          const birApps = apps.filter(a => a.service === 'BIR / TIN').length;
          const sssApps = apps.filter(a => a.service === 'SSS').length;
          const pagibigApps = apps.filter(a => a.service === 'PAG-IBIG').length;
          const pendingApps = apps.filter(a => a.status === 'Submitted' || a.status === 'Under Review').length;
          const totalRevenue = payments.filter(p => p.payment_status === 'Verified').reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);

          const content = `
            <div class="flex justify-between items-center mb-6">
              <h1 class="text-3xl font-black text-white">Admin Dashboard</h1>
              <span class="text-xs text-slate-400">System Developer: <strong>Mark Jerald Agdigos</strong></span>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
              <div class="bg-slate-950 p-6 rounded-3xl shadow-xl border-l-4 border-blue-600 border border-slate-800">
                <h3 class="text-slate-400 text-xs font-bold uppercase tracking-wider">Total Customers</h3>
                <p class="text-3xl font-black text-white mt-2">${totalCustomers}</p>
              </div>
              <div class="bg-slate-950 p-6 rounded-3xl shadow-xl border-l-4 border-indigo-600 border border-slate-800">
                <h3 class="text-slate-400 text-xs font-bold uppercase tracking-wider">Total Applications</h3>
                <p class="text-3xl font-black text-indigo-400 mt-2">${totalApplications}</p>
              </div>
              <div class="bg-slate-950 p-6 rounded-3xl shadow-xl border-l-4 border-amber-500 border border-slate-800">
                <h3 class="text-slate-400 text-xs font-bold uppercase tracking-wider">Pending Review</h3>
                <p class="text-3xl font-black text-amber-400 mt-2">${pendingApps}</p>
              </div>
              <div class="bg-slate-950 p-6 rounded-3xl shadow-xl border-l-4 border-emerald-600 border border-slate-800">
                <h3 class="text-slate-400 text-xs font-bold uppercase tracking-wider">Verified Revenue</h3>
                <p class="text-3xl font-black text-emerald-400 mt-2">₱${totalRevenue.toLocaleString()}</p>
              </div>
            </div>

            <div class="grid md:grid-cols-3 gap-6 mb-8">
              <div class="bg-slate-950 p-6 rounded-3xl shadow-xl border border-slate-800">
                <h3 class="font-black text-white mb-4">Service Breakdown</h3>
                <ul class="space-y-3 text-sm">
                  <li class="flex justify-between"><span>BIR / TIN:</span> <strong class="text-blue-400">${birApps}</strong></li>
                  <li class="flex justify-between"><span>SSS Registration:</span> <strong class="text-emerald-400">${sssApps}</strong></li>
                  <li class="flex justify-between"><span>Pag-IBIG Fund:</span> <strong class="text-amber-400">${pagibigApps}</strong></li>
                </ul>
              </div>
              <div class="bg-slate-950 p-6 rounded-3xl shadow-xl md:col-span-2 border border-slate-800 flex flex-col justify-between">
                <div>
                  <h3 class="font-black text-white mb-2">System Quick Actions & Stats</h3>
                  <p class="text-xs text-slate-400 mb-4">Manage queue, verify payments, and oversee customer accounts seamlessly.</p>
                </div>
                <div class="flex gap-4 flex-wrap">
                  <a href="/admin/applications" class="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl text-xs font-bold transition">Manage Applications</a>
                  <a href="/admin/payments" class="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-xl text-xs font-bold transition">Verify Payments</a>
                  <a href="/admin/tickets" class="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl text-xs font-bold transition">Support Tickets (${openTickets.length})</a>
                  <a href="/admin/settings" class="bg-slate-800 hover:bg-slate-700 text-white px-5 py-2.5 rounded-xl text-xs font-bold transition">Settings & QR</a>
                </div>
              </div>
            </div>
          `;
          res.send(adminLayout('Dashboard', content, 'dashboard'));
        });
      });
    });
  });
});

app.get('/admin/applications', requireAdmin, (req, res) => {
  const search = req.query.search || '';
  const serviceFilter = req.query.service || '';
  const statusFilter = req.query.status || '';

  let query = `SELECT a.*, u.full_name as customer_name, u.username, u.mobile_number FROM applications a JOIN users u ON a.customer_id = u.id WHERE 1=1`;
  let params = [];

  if (search) {
    query += ` AND (u.full_name LIKE ? OR a.tracking_number LIKE ? OR u.username LIKE ? OR u.mobile_number LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (serviceFilter) {
    query += ` AND a.service = ?`;
    params.push(serviceFilter);
  }
  if (statusFilter) {
    query += ` AND a.status = ?`;
    params.push(statusFilter);
  }

  query += ` ORDER BY a.id DESC`;

  db.all(query, params, (err, apps) => {
    const content = `
      <h1 class="text-3xl font-black text-white mb-6">Manage Applications</h1>

      <form action="/admin/applications" method="GET" class="bg-slate-950 p-6 rounded-3xl shadow-xl mb-6 grid md:grid-cols-4 gap-4 border border-slate-800">
        <div>
          <label class="block text-xs font-bold uppercase text-slate-400 mb-1">Search</label>
          <input type="text" name="search" value="${search}" placeholder="Name, Tracking #..." class="w-full border border-slate-700 bg-slate-900 rounded-xl px-3 py-2 text-sm text-white">
        </div>
        <div>
          <label class="block text-xs font-bold uppercase text-slate-400 mb-1">Service</label>
          <select name="service" class="w-full border border-slate-700 bg-slate-900 rounded-xl px-3 py-2 text-sm text-white">
            <option value="">All Services</option>
            <option value="BIR / TIN" ${serviceFilter === 'BIR / TIN' ? 'selected' : ''}>BIR / TIN</option>
            <option value="SSS" ${serviceFilter === 'SSS' ? 'selected' : ''}>SSS</option>
            <option value="PAG-IBIG" ${serviceFilter === 'PAG-IBIG' ? 'selected' : ''}>Pag-IBIG</option>
          </select>
        </div>
        <div>
          <label class="block text-xs font-bold uppercase text-slate-400 mb-1">Status</label>
          <select name="status" class="w-full border border-slate-700 bg-slate-900 rounded-xl px-3 py-2 text-sm text-white">
            <option value="">All Statuses</option>
            <option value="Submitted" ${statusFilter === 'Submitted' ? 'selected' : ''}>Submitted</option>
            <option value="Under Review" ${statusFilter === 'Under Review' ? 'selected' : ''}>Under Review</option>
            <option value="Processing" ${statusFilter === 'Processing' ? 'selected' : ''}>Processing</option>
            <option value="Completed" ${statusFilter === 'Completed' ? 'selected' : ''}>Completed</option>
          </select>
        </div>
        <div class="flex items-end">
          <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded-xl text-sm transition">Filter Applications</button>
        </div>
      </form>

      <form action="/admin/applications/bulk-update" method="POST" class="bg-slate-950 p-6 rounded-3xl shadow-xl border border-slate-800">
        <div class="flex justify-between items-center mb-4">
          <h3 class="font-bold text-white">Bulk Actions</h3>
          <div class="flex gap-2">
            <select name="bulk_status" class="border border-slate-700 bg-slate-900 text-xs text-white rounded-xl px-3 py-2">
              <option value="Under Review">Set to Under Review</option>
              <option value="Processing">Set to Processing</option>
              <option value="Completed">Set to Completed</option>
            </select>
            <button type="submit" class="bg-amber-600 hover:bg-amber-700 text-white font-bold px-4 py-2 rounded-xl text-xs">Apply Bulk Update</button>
          </div>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="border-b border-slate-800 bg-slate-900 text-xs text-slate-400 uppercase">
                <th class="p-3"><input type="checkbox" onclick="document.querySelectorAll('.app-checkbox').forEach(c => c.checked = this.checked)"></th>
                <th class="p-3">Applicant</th>
                <th class="p-3">Service</th>
                <th class="p-3">Tracking Number</th>
                <th class="p-3">Status</th>
                <th class="p-3">Payment</th>
                <th class="p-3">Date</th>
                <th class="p-3">Action</th>
              </tr>
            </thead>
            <tbody class="text-sm">
              ${apps.map(app => `
                <tr class="border-b border-slate-800 hover:bg-slate-900 transition">
                  <td class="p-3"><input type="checkbox" name="app_ids[]" value="${app.id}" class="app-checkbox"></td>
                  <td class="p-3 font-bold">${app.customer_name}</td>
                  <td class="p-3 font-semibold text-blue-400">${app.service}</td>
                  <td class="p-3 font-mono font-bold text-slate-300">${app.tracking_number}</td>
                  <td class="p-3"><span class="px-2.5 py-1 bg-blue-900 text-blue-200 rounded-full font-bold text-xs">${app.status}</span></td>
                  <td class="p-3"><span class="px-2.5 py-1 bg-amber-900 text-amber-200 rounded-full font-bold text-xs">${app.payment_status}</span></td>
                  <td class="p-3 text-xs text-slate-400">${app.created_at}</td>
                  <td class="p-3"><a href="/admin/application/${app.id}" class="text-blue-400 font-bold hover:underline text-xs">Review & Process &rarr;</a></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </form>
    `;
    res.send(adminLayout('Manage Applications', content, 'applications'));
  });
});

app.post('/admin/applications/bulk-update', requireAdmin, (req, res) => {
  const { app_ids, bulk_status } = req.body;
  if (app_ids && Array.isArray(app_ids) && app_ids.length > 0) {
    const placeholders = app_ids.map(() => '?').join(',');
    db.run(`UPDATE applications SET status = ? WHERE id IN (${placeholders})`, [bulk_status, ...app_ids], () => {
      logAudit(req.session.admin.username, `Bulk updated ${app_ids.length} applications to status ${bulk_status}`);
      res.redirect('/admin/applications');
    });
  } else {
    res.redirect('/admin/applications');
  }
});

app.get('/admin/application/:id', requireAdmin, (req, res) => {
  const appId = req.params.id;
  db.get(`SELECT a.*, u.full_name as customer_name, u.email_address, u.mobile_number FROM applications a JOIN users u ON a.customer_id = u.id WHERE a.id = ?`, [appId], (err, app) => {
    if (!app) return res.send(`Application not found.`);

    db.all(`SELECT * FROM documents WHERE application_id = ?`, [appId], (err2, docs) => {
      db.all(`SELECT * FROM beneficiaries WHERE application_id = ?`, [appId], (err3, bens) => {
        db.all(`SELECT * FROM completed_files WHERE application_id = ?`, [appId], (err4, completedFiles) => {

          const formData = JSON.parse(app.data_json || '{}');

          const content = `
            <div class="flex justify-between items-center mb-6">
              <h1 class="text-3xl font-black text-white">Review Application: ${app.tracking_number}</h1>
              <a href="/admin/applications" class="bg-slate-800 hover:bg-slate-700 px-4 py-2 rounded-xl text-xs font-bold">&larr; Back to List</a>
            </div>

            <div class="grid md:grid-cols-3 gap-6 mb-8">
              <div class="bg-slate-950 p-6 rounded-3xl border border-slate-800 md:col-span-2 space-y-4">
                <h3 class="font-black text-blue-400 text-lg border-b border-slate-800 pb-2">Applicant Submitted Form Data</h3>
                <div class="grid grid-cols-2 gap-4 text-sm">
                  <div><span class="text-xs text-slate-400 block">Applicant Name</span> <strong>${app.customer_name}</strong></div>
                  <div><span class="text-xs text-slate-400 block">Mobile Number</span> <span>${app.mobile_number}</span></div>
                  <div><span class="text-xs text-slate-400 block">Date of Birth</span> <span>${formData.date_of_birth || 'N/A'}</span></div>
                  <div><span class="text-xs text-slate-400 block">Place of Birth</span> <span>${formData.place_of_birth || 'N/A'}</span></div>
                  <div><span class="text-xs text-slate-400 block">Civil Status</span> <span>${formData.civil_status || 'N/A'}</span></div>
                  <div><span class="text-xs text-slate-400 block">Employment Status</span> <span>${formData.employment_status || 'N/A'}</span></div>
                  <div><span class="text-xs text-slate-400 block">Father's Name</span> <span>${formData.father_name || 'N/A'}</span></div>
                  <div><span class="text-xs text-slate-400 block">Mother's Maiden Name</span> <span>${formData.mother_maiden_name || 'N/A'}</span></div>
                </div>

                ${bens.length > 0 ? `
                  <h4 class="font-bold text-white text-sm border-t border-slate-800 pt-4 mt-4">Declared Beneficiaries</h4>
                  <div class="space-y-2">
                    ${bens.map(b => `<div class="bg-slate-900 p-3 rounded-xl text-xs border border-slate-800"><strong>${b.full_name}</strong> (${b.relationship}) - DOB: ${b.birth_date}</div>`).join('')}
                  </div>
                ` : ''}

                <h4 class="font-bold text-white text-sm border-t border-slate-800 pt-4 mt-4">Uploaded Documents</h4>
                <div class="grid grid-cols-2 gap-3">
                  ${docs.map(d => `
                    <div class="bg-slate-900 p-3 rounded-xl border border-slate-800 text-xs">
                      <span class="font-bold block text-blue-400 uppercase">${d.doc_type}</span>
                      <a href="${d.file_path}" target="_blank" class="text-slate-300 hover:underline mt-1 block truncate">${d.file_name}</a>
                    </div>
                  `).join('')}
                </div>
              </div>

              <div class="bg-slate-950 p-6 rounded-3xl border border-slate-800 space-y-6">
                <form action="/admin/application/${app.id}/update-status" method="POST" class="space-y-4">
                  <h3 class="font-black text-white text-base border-b border-slate-800 pb-2">Update Application Status</h3>
                  <div>
                    <label class="block text-xs font-bold uppercase text-slate-400 mb-1">Status</label>
                    <select name="status" class="w-full border border-slate-700 bg-slate-900 text-white rounded-xl px-3 py-2 text-sm">
                      <option value="Submitted" ${app.status === 'Submitted' ? 'selected' : ''}>Submitted</option>
                      <option value="Under Review" ${app.status === 'Under Review' ? 'selected' : ''}>Under Review</option>
                      <option value="Processing" ${app.status === 'Processing' ? 'selected' : ''}>Processing</option>
                      <option value="Completed" ${app.status === 'Completed' ? 'selected' : ''}>Completed</option>
                      <option value="Rejected" ${app.status === 'Rejected' ? 'selected' : ''}>Rejected / Correction Required</option>
                    </select>
                  </div>
                  <div>
                    <label class="block text-xs font-bold uppercase text-slate-400 mb-1">Admin Remarks / Notes for Customer</label>
                    <textarea name="admin_remarks" rows="3" class="w-full border border-slate-700 bg-slate-900 text-white rounded-xl px-3 py-2 text-sm">${app.admin_remarks || ''}</textarea>
                  </div>
                  <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-xl text-xs">Update Status</button>
                </form>

                <form action="/admin/application/${app.id}/upload-completed" method="POST" enctype="multipart/form-data" class="space-y-4 border-t border-slate-800 pt-4">
                  <h3 class="font-black text-white text-base border-b border-slate-800 pb-2">Upload Final Completed File</h3>
                  <div>
                    <label class="block text-xs font-bold uppercase text-slate-400 mb-1">File Description</label>
                    <input type="text" name="description" placeholder="e.g. Official TIN Slip / SSS Form" required class="w-full border border-slate-700 bg-slate-900 text-white rounded-xl px-3 py-2 text-sm">
                  </div>
                  <div>
                    <label class="block text-xs font-bold uppercase text-slate-400 mb-1">Upload Approved Document</label>
                    <input type="file" name="completed_file" required class="w-full text-xs text-slate-400">
                  </div>
                  <button type="submit" class="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-xl text-xs">Upload Completed Document</button>
                </form>
              </div>
            </div>
          `;
          res.send(adminLayout('Application Details', content, 'applications'));
        });
      });
    });
  });
});

app.post('/admin/application/:id/update-status', requireAdmin, (req, res) => {
  const appId = req.params.id;
  const { status, admin_remarks } = req.body;
  
  db.get(`SELECT * FROM applications WHERE id = ?`, [appId], (err, app) => {
    db.run(`UPDATE applications SET status = ?, admin_remarks = ? WHERE id = ?`, [status, admin_remarks, appId], () => {
      logStatusHistory(appId, status, admin_remarks);
      addNotification(app.customer_id, `Application Status Update: ${status}`, `Your application ${app.tracking_number} status is now: ${status}`);
      logAudit(req.session.admin.username, `Updated status for application ${app.tracking_number} to ${status}`);
      res.redirect(`/admin/application/${appId}`);
    });
  });
});

app.post('/admin/application/:id/upload-completed', requireAdmin, upload.single('completed_file'), (req, res) => {
  const appId = req.params.id;
  const { description } = req.body;
  const file = req.file;

  if (file) {
    db.run(`INSERT INTO completed_files (application_id, file_path, file_name, file_type, description) VALUES (?, ?, ?, ?, ?)`,
      [appId, '/uploads/' + file.filename, file.originalname, file.mimetype, description], () => {
        db.get(`SELECT * FROM applications WHERE id = ?`, [appId], (err, app) => {
          addNotification(app.customer_id, 'Completed Document Ready', `A completed document for application ${app.tracking_number} has been uploaded.`);
          logAudit(req.session.admin.username, `Uploaded completed file for application ${app.tracking_number}`);
          res.redirect(`/admin/application/${appId}`);
        });
      });
  } else {
    res.redirect(`/admin/application/${appId}`);
  }
});

app.get('/admin/payments', requireAdmin, (req, res) => {
  db.all(`SELECT p.*, u.full_name as customer_name FROM payments p JOIN users u ON p.customer_id = u.id ORDER BY p.id DESC`, [], (err, payments) => {
    const content = `
      <h1 class="text-3xl font-black text-white mb-6">Payment Verification Desk</h1>
      <div class="bg-slate-950 p-6 rounded-3xl shadow-xl border border-slate-800">
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="border-b border-slate-800 bg-slate-900 text-xs text-slate-400 uppercase">
                <th class="p-3">Customer</th>
                <th class="p-3">Tracking #</th>
                <th class="p-3">Service</th>
                <th class="p-3">Amount</th>
                <th class="p-3">Ref Number</th>
                <th class="p-3">Proof</th>
                <th class="p-3">Status</th>
                <th class="p-3">Action</th>
              </tr>
            </thead>
            <tbody class="text-sm">
              ${payments.map(p => `
                <tr class="border-b border-slate-800 hover:bg-slate-900 transition">
                  <td class="p-3 font-bold">${p.customer_name}</td>
                  <td class="p-3 font-mono font-bold text-slate-300">${p.tracking_number}</td>
                  <td class="p-3 font-semibold text-blue-400">${p.service}</td>
                  <td class="p-3 font-bold text-emerald-400">₱${p.amount}</td>
                  <td class="p-3 font-mono text-xs">${p.reference_number || 'N/A'}</td>
                  <td class="p-3">
                    ${p.proof_path ? `<a href="${p.proof_path}" target="_blank" class="text-blue-400 font-bold hover:underline text-xs">View Receipt</a>` : '<span class="text-xs text-slate-500">None</span>'}
                  </td>
                  <td class="p-3"><span class="px-2.5 py-1 bg-amber-900 text-amber-200 rounded-full font-bold text-xs">${p.payment_status}</span></td>
                  <td class="p-3 space-x-2">
                    <a href="/admin/payment/${p.id}/verify" class="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1 rounded-lg font-bold text-xs">Verify</a>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
    res.send(adminLayout('Payment Verification', content, 'payments'));
  });
});

app.get('/admin/payment/:id/verify', requireAdmin, (req, res) => {
  const payId = req.params.id;
  db.get(`SELECT * FROM payments WHERE id = ?`, [payId], (err, payment) => {
    if (payment) {
      db.run(`UPDATE payments SET payment_status = 'Verified' WHERE id = ?`, [payId]);
      db.run(`UPDATE applications SET payment_status = 'Paid' WHERE id = ?`, [payment.application_id]);
      addNotification(payment.customer_id, 'Payment Verified', `Your payment for ${payment.tracking_number} has been verified.`);
      logAudit(req.session.admin.username, `Verified payment for tracking number ${payment.tracking_number}`);
    }
    res.redirect('/admin/payments');
  });
});

app.get('/admin/tickets', requireAdmin, (req, res) => {
  db.all(`SELECT t.*, u.full_name as customer_name FROM tickets t JOIN users u ON t.customer_id = u.id ORDER BY t.id DESC`, [], (err, tickets) => {
    const content = `
      <h1 class="text-3xl font-black text-white mb-6">Support Tickets Desk</h1>
      <div class="bg-slate-950 p-6 rounded-3xl shadow-xl space-y-4 border border-slate-800">
        ${tickets.length === 0 ? `<p class="text-slate-500 text-sm">No tickets submitted.</p>` : tickets.map(t => `
          <div class="border border-slate-800 p-6 rounded-2xl bg-slate-900 space-y-3">
            <div class="flex justify-between items-center">
              <div>
                <span class="font-bold text-white text-base">${t.subject}</span>
                <span class="text-xs text-slate-400 block">From: ${t.customer_name} &bull; ${t.created_at}</span>
              </div>
              <span class="px-2.5 py-1 bg-amber-900 text-amber-200 rounded-full font-bold text-xs">${t.status}</span>
            </div>
            <p class="text-sm text-slate-300 bg-slate-950 p-4 rounded-xl border border-slate-800">${t.message}</p>
            
            <form action="/admin/ticket/${t.id}/reply" method="POST" class="space-y-2 pt-2">
              <input type="text" name="admin_reply" value="${t.admin_reply || ''}" placeholder="Type your reply to customer..." required class="w-full border border-slate-700 bg-slate-950 text-white rounded-xl px-3 py-2 text-sm">
              <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-xl text-xs">Send Admin Reply</button>
            </form>
          </div>
        `).join('')}
      </div>
    `;
    res.send(adminLayout('Support Tickets', content, 'tickets'));
  });
});

app.post('/admin/ticket/:id/reply', requireAdmin, (req, res) => {
  const ticketId = req.params.id;
  const { admin_reply } = req.body;
  db.get(`SELECT * FROM tickets WHERE id = ?`, [ticketId], (err, ticket) => {
    db.run(`UPDATE tickets SET admin_reply = ?, status = 'Closed' WHERE id = ?`, [admin_reply, ticketId], () => {
      addNotification(ticket.customer_id, 'Ticket Replied', `Admin replied to your inquiry: "${ticket.subject}"`);
      logAudit(req.session.admin.username, `Replied to ticket ID ${ticketId}`);
      res.redirect('/admin/tickets');
    });
  });
});

app.get('/admin/users', requireAdmin, (req, res) => {
  db.all(`SELECT * FROM users ORDER BY id DESC`, [], (err, users) => {
    const content = `
      <h1 class="text-3xl font-black text-white mb-6">Customer Accounts Directory</h1>
      <div class="bg-slate-950 p-6 rounded-3xl shadow-xl border border-slate-800">
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="border-b border-slate-800 bg-slate-900 text-xs text-slate-400 uppercase">
                <th class="p-3">ID</th>
                <th class="p-3">Full Name</th>
                <th class="p-3">Username</th>
                <th class="p-3">Mobile Number</th>
                <th class="p-3">Email Address</th>
                <th class="p-3">Preferred Device</th>
                <th class="p-3">Registered Date</th>
              </tr>
            </thead>
            <tbody class="text-sm">
              ${users.map(u => `
                <tr class="border-b border-slate-800 hover:bg-slate-900 transition">
                  <td class="p-3 font-mono text-slate-400">#${u.id}</td>
                  <td class="p-3 font-bold">${u.full_name}</td>
                  <td class="p-3 font-semibold text-blue-400">${u.username}</td>
                  <td class="p-3 text-slate-300">${u.mobile_number}</td>
                  <td class="p-3 text-slate-300">${u.email_address}</td>
                  <td class="p-3"><span class="px-2 py-0.5 bg-slate-800 text-xs rounded uppercase font-mono">${u.device_preference || 'mobile'}</span></td>
                  <td class="p-3 text-xs text-slate-400">${u.created_at}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
    res.send(adminLayout('Customer Directory', content, 'users'));
  });
});

app.get('/admin/settings', requireAdmin, async (req, res) => {
  const settings = await getSettings();
  const content = `
    <h1 class="text-3xl font-black text-white mb-6">System Settings, Fees & QR Codes</h1>
    <form action="/admin/settings" method="POST" enctype="multipart/form-data" class="bg-slate-950 p-8 rounded-3xl shadow-xl space-y-6 border border-slate-800 max-w-3xl">
      <div class="grid md:grid-cols-2 gap-4">
        <div>
          <label class="block text-xs font-bold uppercase text-slate-400 mb-1">Business / Platform Name</label>
          <input type="text" name="business_name" value="${settings.business_name}" required class="w-full border border-slate-700 bg-slate-900 text-white rounded-xl px-3 py-2 text-sm">
        </div>
        <div>
          <label class="block text-xs font-bold uppercase text-slate-400 mb-1">Creator / Developer Name</label>
          <input type="text" name="creator_name" value="${settings.creator_name}" required class="w-full border border-slate-700 bg-slate-900 text-white rounded-xl px-3 py-2 text-sm">
        </div>
        <div>
          <label class="block text-xs font-bold uppercase text-slate-400 mb-1">GCash Account Name</label>
          <input type="text" name="gcash_name" value="${settings.gcash_name}" required class="w-full border border-slate-700 bg-slate-900 text-white rounded-xl px-3 py-2 text-sm">
        </div>
        <div>
          <label class="block text-xs font-bold uppercase text-slate-400 mb-1">GCash Account Number</label>
          <input type="text" name="gcash_number" value="${settings.gcash_number}" required class="w-full border border-slate-700 bg-slate-900 text-white rounded-xl px-3 py-2 text-sm">
        </div>
      </div>

      <div class="grid md:grid-cols-3 gap-4 border-t border-slate-800 pt-4">
        <div>
          <label class="block text-xs font-bold uppercase text-slate-400 mb-1">BIR Application Fee (₱)</label>
          <input type="text" name="fee_bir" value="${settings.fee_bir}" required class="w-full border border-slate-700 bg-slate-900 text-white rounded-xl px-3 py-2 text-sm">
        </div>
        <div>
          <label class="block text-xs font-bold uppercase text-slate-400 mb-1">SSS Application Fee (₱)</label>
          <input type="text" name="fee_sss" value="${settings.fee_sss}" required class="w-full border border-slate-700 bg-slate-900 text-white rounded-xl px-3 py-2 text-sm">
        </div>
        <div>
          <label class="block text-xs font-bold uppercase text-slate-400 mb-1">Pag-IBIG Application Fee (₱)</label>
          <input type="text" name="fee_pagibig" value="${settings.fee_pagibig}" required class="w-full border border-slate-700 bg-slate-900 text-white rounded-xl px-3 py-2 text-sm">
        </div>
      </div>

      <div class="grid md:grid-cols-3 gap-4 border-t border-slate-800 pt-4">
        <div>
          <label class="block text-xs font-bold uppercase text-slate-400 mb-1">Upload BIR GCash QR</label>
          <input type="file" name="qr_bir" accept="image/*" class="w-full text-xs text-slate-400">
        </div>
        <div>
          <label class="block text-xs font-bold uppercase text-slate-400 mb-1">Upload SSS GCash QR</label>
          <input type="file" name="qr_sss" accept="image/*" class="w-full text-xs text-slate-400">
        </div>
        <div>
          <label class="block text-xs font-bold uppercase text-slate-400 mb-1">Upload Pag-IBIG GCash QR</label>
          <input type="file" name="qr_pagibig" accept="image/*" class="w-full text-xs text-slate-400">
        </div>
      </div>

      <div class="space-y-3 border-t border-slate-800 pt-4">
        <div>
          <label class="block text-xs font-bold uppercase text-slate-400 mb-1">Top Announcement Text</label>
          <input type="text" name="announcement" value="${settings.announcement}" class="w-full border border-slate-700 bg-slate-900 text-white rounded-xl px-3 py-2 text-sm">
        </div>
        <div>
          <label class="block text-xs font-bold uppercase text-slate-400 mb-1">Maintenance Mode</label>
          <select name="maintenance_mode" class="w-full border border-slate-700 bg-slate-900 text-white rounded-xl px-3 py-2 text-sm">
            <option value="0" ${settings.maintenance_mode === '0' ? 'selected' : ''}>Disabled (Live Applications Open)</option>
            <option value="1" ${settings.maintenance_mode === '1' ? 'selected' : ''}>Enabled (Block New Applications)</option>
          </select>
        </div>
      </div>

      <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-3 rounded-xl text-xs shadow transition">Save Settings</button>
    </form>
  `;
  res.send(adminLayout('Settings', content, 'settings'));
});

const qrUpload = upload.fields([
  { name: 'qr_bir', maxCount: 1 },
  { name: 'qr_sss', maxCount: 1 },
  { name: 'qr_pagibig', maxCount: 1 }
]);

app.post('/admin/settings', requireAdmin, qrUpload, (req, res) => {
  const body = req.body;
  const files = req.files;

  for (const [k, v] of Object.entries(body)) {
    db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [k, v]);
  }

  if (files) {
    if (files['qr_bir']) db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('qr_bir', ?)`, ['/uploads/' + files['qr_bir'][0].filename]);
    if (files['qr_sss']) db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('qr_sss', ?)`, ['/uploads/' + files['qr_sss'][0].filename]);
    if (files['qr_pagibig']) db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('qr_pagibig', ?)`, ['/uploads/' + files['qr_pagibig'][0].filename]);
  }

  logAudit(req.session.admin.username, 'Updated system settings and QR codes');
  res.redirect('/admin/settings');
});

app.get('/admin/audit', requireAdmin, (req, res) => {
  db.all(`SELECT * FROM audit_logs ORDER BY id DESC LIMIT 100`, [], (err, logs) => {
    const content = `
      <h1 class="text-3xl font-black text-white mb-6">Security & Admin Audit Logs</h1>
      <div class="bg-slate-950 p-6 rounded-3xl shadow-xl border border-slate-800">
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="border-b border-slate-800 bg-slate-900 text-xs text-slate-400 uppercase">
                <th class="p-3">ID</th>
                <th class="p-3">Admin</th>
                <th class="p-3">Action Performed</th>
                <th class="p-3">Timestamp</th>
              </tr>
            </thead>
            <tbody class="text-sm">
              ${logs.map(l => `
                <tr class="border-b border-slate-800 hover:bg-slate-900 transition">
                  <td class="p-3 font-mono text-slate-500">#${l.id}</td>
                  <td class="p-3 font-bold text-blue-400">${l.admin_username}</td>
                  <td class="p-3 text-slate-300">${l.action}</td>
                  <td class="p-3 text-xs text-slate-400">${l.created_at}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
    res.send(adminLayout('Audit Logs', content, 'audit'));
  });
});

// JSON Database Export Backup (Feature #25)
app.get('/admin/backup', requireAdmin, (req, res) => {
  db.all(`SELECT * FROM users`, [], (err, users) => {
    db.all(`SELECT * FROM applications`, [], (err2, apps) => {
      db.all(`SELECT * FROM payments`, [], (err3, payments) => {
        const data = {
          export_date: new Date().toISOString(),
          users,
          applications: apps,
          payments
        };
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename=govassist-database-backup.json');
        res.send(JSON.stringify(data, null, 2));
      });
    });
  });
});

// Start Server
app.listen(PORT, () => {
  console.log(`GovAssist PH Production Server is running on port ${PORT}`);
});
