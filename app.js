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

// Database Setup (SQLite for persistence - data will not vanish overnight)
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
    // Users (Customers)
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT,
      full_name TEXT,
      mobile_number TEXT,
      email_address TEXT,
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

    // Settings (Includes specific QR codes for BIR, SSS, PAG-IBIG)
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
        announcement: 'Welcome to GovAssist PH! Fast & secure government application processing.',
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

    // Audit Logs for Admin
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

// Persistent Session Configuration (Prevents data loss on restart/overnight)
app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: __dirname }),
  secret: process.env.SESSION_SECRET || 'mark_jerald_agdigos_govassist_secure_key_2026',
  resave: true,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 7 days persistence
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
            <h2 class="text-2xl font-bold text-white mb-4">Features Built For Your Convenience</h2>
            <ul class="space-y-3 text-sm">
              <li class="flex items-center space-x-2"><span>✅</span> <strong>Over 40+ Advanced Features</strong> (PDF Export, Audit Trail, Live QR Verification)</li>
              <li class="flex items-center space-x-2"><span>✅</span> <strong>Overnight Data Persistence</strong> (SQLite database storage ensures zero data loss)</li>
              <li class="flex items-center space-x-2"><span>✅</span> <strong>Dedicated GCash QR Codes</strong> for BIR, SSS, and Pag-IBIG payments</li>
              <li class="flex items-center space-x-2"><span>✅</span> <strong>Bilingual Support</strong> (English and Tagalog language switcher)</li>
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

// Public Tracking Page
app.get('/track-public', (req, res) => {
  const trackingNumber = req.query.tracking_number || '';
  const settings = res.locals.settings;
  res.send(`
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
            <input type="text" name="tracking_number" value="${trackingNumber}" required placeholder="e.g. TIN-20260902-1234" class="w-full border border-slate-300 rounded-xl px-4 py-3 uppercase font-mono text-sm focus:ring-2 focus:ring-blue-600 outline-none">
          </div>
          <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl shadow-lg transition">Search Status</button>
        </form>
        ${trackingNumber ? `
          <div class="bg-white p-6 rounded-2xl shadow-xl border border-slate-100 text-center">
            <p class="text-sm text-slate-500 mb-2">Searching for: <strong>${trackingNumber}</strong></p>
            <!-- Search Results logic handled or redirected -->
            <a href="/customer/login" class="text-blue-600 font-bold hover:underline text-sm">Login to customer portal for full detailed history &rarr;</a>
          </div>
        ` : ''}
        <div class="text-center mt-6">
          <a href="/" class="text-blue-600 hover:underline text-sm font-semibold">&larr; Back to Home</a>
        </div>
      </div>
    </body>
    </html>
  `);
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
      res.redirect('/customer/dashboard');
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
// MIDDLEWARE GUARDS
// ==========================================
function requireCustomer(req, res, next) {
  if (!req.session.customer) {
    return res.redirect('/customer/login');
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
// CUSTOMER PORTAL & DASHBOARD
// ==========================================
function customerLayout(title, content, activeTab, unreadCount = 0, reqSession = null) {
  const customerName = reqSession && reqSession.customer ? reqSession.customer.full_name : '';
  const lang = reqSession && reqSession.lang ? reqSession.lang : 'en';
  return `
    <!DOCTYPE html>
    <html lang="${lang}">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title} - GovAssist PH</title>
      <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
    </head>
    <body class="bg-slate-100 text-slate-800 font-sans antialiased">
      <div class="min-h-screen flex flex-col md:flex-row">
        <aside class="bg-blue-950 text-white w-full md:w-72 p-6 flex flex-col justify-between shadow-2xl">
          <div>
            <div class="mb-8">
              <span class="text-xl font-black tracking-tight block">GovAssist PH</span>
              <span class="text-xs text-blue-300">Created by: Mark Jerald Agdigos</span>
            </div>
            <nav class="space-y-1.5 text-sm">
              <a href="/customer/dashboard" class="flex items-center space-px px-4 py-3 rounded-xl transition ${activeTab === 'dashboard' ? 'bg-blue-600 font-bold shadow-lg' : 'hover:bg-blue-900 text-blue-200'}">📊 Dashboard</a>
              <a href="/customer/apply" class="flex items-center space-px px-4 py-3 rounded-xl transition ${activeTab === 'apply' ? 'bg-blue-600 font-bold shadow-lg' : 'hover:bg-blue-900 text-blue-200'}">➕ New Application</a>
              <a href="/customer/applications" class="flex items-center space-px px-4 py-3 rounded-xl transition ${activeTab === 'applications' ? 'bg-blue-600 font-bold shadow-lg' : 'hover:bg-blue-900 text-blue-200'}">📋 My Applications</a>
              <a href="/customer/documents" class="flex items-center space-px px-4 py-3 rounded-xl transition ${activeTab === 'documents' ? 'bg-blue-600 font-bold shadow-lg' : 'hover:bg-blue-900 text-blue-200'}">📂 Completed Files</a>
              <a href="/customer/tickets" class="flex items-center space-px px-4 py-3 rounded-xl transition ${activeTab === 'tickets' ? 'bg-blue-600 font-bold shadow-lg' : 'hover:bg-blue-900 text-blue-200'}">💬 Support Tickets</a>
              <a href="/customer/notifications" class="flex items-center justify-between px-4 py-3 rounded-xl transition ${activeTab === 'notifications' ? 'bg-blue-600 font-bold shadow-lg' : 'hover:bg-blue-900 text-blue-200'}">
                <span>🔔 Notifications</span>
                ${unreadCount > 0 ? `<span class="bg-red-500 text-white px-2 py-0.5 rounded-full text-xs font-bold">${unreadCount}</span>` : ''}
              </a>
              <a href="/customer/profile" class="flex items-center space-px px-4 py-3 rounded-xl transition ${activeTab === 'profile' ? 'bg-blue-600 font-bold shadow-lg' : 'hover:bg-blue-900 text-blue-200'}">👤 My Profile</a>
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
        
        <main class="flex-1 p-6 md:p-12 overflow-y-auto">
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
                      <td class="p-3"><a href="/customer/track/${app.id}" class="text-blue-600 font-bold hover:underline text-xs">View Tracking</a></td>
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
  const content = `
    <h1 class="text-3xl font-black text-blue-950 mb-6">New Government Application</h1>
    <form action="/customer/apply" method="POST" enctype="multipart/form-data" class="bg-white p-8 md:p-12 rounded-3xl shadow-2xl space-y-10 border border-slate-100" id="appForm">
      
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
                    <td class="p-3"><a href="/customer/track/${app.id}" class="text-blue-600 font-bold hover:underline text-xs">Track & Details</a></td>
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
              <a href="/customer/applications" class="bg-slate-200 hover:bg-slate-300 px-4 py-2 rounded-xl text-xs font-bold transition">&larr; Back to Applications</a>
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

// Support Tickets Feature (Feature #36)
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
// ADMIN PORTAL & DASHBOARD (40+ Features)
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
              <a href="/admin/dashboard" class="flex items-center space-px px-4 py-3 rounded-xl transition ${activeTab === 'dashboard' ? 'bg-blue-600 font-bold shadow-lg' : 'hover:bg-slate-900 text-slate-300'}">📊 Dashboard</a>
              <a href="/admin/applications" class="flex items-center space-px px-4 py-3 rounded-xl transition ${activeTab === 'applications' ? 'bg-blue-600 font-bold shadow-lg' : 'hover:bg-slate-900 text-slate-300'}">📋 All Applications</a>
              <a href="/admin/payments" class="flex items-center space-px px-4 py-3 rounded-xl transition ${activeTab === 'payments' ? 'bg-blue-600 font-bold shadow-lg' : 'hover:bg-slate-900 text-slate-300'}">💳 Payments & Verification</a>
              <a href="/admin/tickets" class="flex items-center space-px px-4 py-3 rounded-xl transition ${activeTab === 'tickets' ? 'bg-blue-600 font-bold shadow-lg' : 'hover:bg-slate-900 text-slate-300'}">💬 Support Tickets</a>
              <a href="/admin/users" class="flex items-center space-px px-4 py-3 rounded-xl transition ${activeTab === 'users' ? 'bg-blue-600 font-bold shadow-lg' : 'hover:bg-slate-900 text-slate-300'}">👥 Customer Accounts</a>
              <a href="/admin/settings" class="flex items-center space-px px-4 py-3 rounded-xl transition ${activeTab === 'settings' ? 'bg-blue-600 font-bold shadow-lg' : 'hover:bg-slate-900 text-slate-300'}">⚙️ Settings, Fees & QR Codes</a>
              <a href="/admin/audit" class="flex items-center space-px px-4 py-3 rounded-xl transition ${activeTab === 'audit' ? 'bg-blue-600 font-bold shadow-lg' : 'hover:bg-slate-900 text-slate-300'}">📜 Audit Logs</a>
              <a href="/admin/backup" class="flex items-center space-px px-4 py-3 rounded-xl transition ${activeTab === 'backup' ? 'bg-blue-600 font-bold shadow-lg' : 'hover:bg-slate-900 text-slate-300'}">💾 Backup / Export JSON</a>
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
          const completedApps = apps.filter(a => a.status === 'Completed').length;
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
          <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded-xl text-sm transition">Filter</button>
        </div>
      </form>

      <div class="bg-slate-950 p-6 rounded-3xl shadow-xl border border-slate-800">
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="border-b border-slate-800 bg-slate-900 text-xs text-slate-400 uppercase">
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
              ${apps.length === 0 ? `<tr><td colspan="7" class="p-4 text-center text-slate-500">No applications found.</td></tr>` : apps.map(app => `
                <tr class="border-b border-slate-800 hover:bg-slate-900 transition">
                  <td class="p-3 font-bold">${app.customer_name}</td>
                  <td class="p-3">${app.service}</td>
                  <td class="p-3 font-mono text-blue-400">${app.tracking_number}</td>
                  <td class="p-3"><span class="px-2.5 py-1 bg-blue-900 text-blue-200 rounded-full text-xs font-bold">${app.status}</span></td>
                  <td class="p-3"><span class="px-2.5 py-1 bg-amber-950 text-amber-300 rounded-full text-xs font-bold">${app.payment_status}</span></td>
                  <td class="p-3 text-xs text-slate-400">${app.created_at}</td>
                  <td class="p-3"><a href="/admin/applications/${app.id}" class="text-blue-400 font-bold hover:underline text-xs">Review Profile</a></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
    res.send(adminLayout('Applications', content, 'applications'));
  });
});

app.get('/admin/applications/:id', requireAdmin, (req, res) => {
  const appId = req.params.id;
  db.get(`SELECT a.*, u.full_name as customer_name, u.username, u.email_address, u.mobile_number FROM applications a JOIN users u ON a.customer_id = u.id WHERE a.id = ?`, [appId], (err, app) => {
    if (!app) return res.send(`<p>Application not found.</p>`);

    db.all(`SELECT * FROM beneficiaries WHERE application_id = ?`, [appId], (err2, beneficiaries) => {
      db.all(`SELECT * FROM documents WHERE application_id = ?`, [appId], (err3, documents) => {
        db.all(`SELECT * FROM completed_files WHERE application_id = ?`, [appId], (err4, completedFiles) => {
          db.get(`SELECT * FROM payments WHERE application_id = ?`, [appId], (err5, payment) => {

            const formData = JSON.parse(app.data_json || '{}');

            const content = `
              <div class="flex justify-between items-center mb-6">
                <div>
                  <h1 class="text-3xl font-black text-white">Applicant Profile & Review</h1>
                  <p class="text-xs font-mono text-slate-400 mt-1">Tracking: ${app.tracking_number} &bull; Service: ${app.service}</p>
                </div>
                <div class="space-x-2">
                  <a href="/admin/print/${app.id}" target="_blank" class="bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-xl text-xs font-bold transition">Print Summary</a>
                  <a href="/admin/applications" class="bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-xl text-xs font-bold transition">&larr; Back</a>
                </div>
              </div>

              <div class="bg-slate-950 p-6 rounded-3xl shadow-xl mb-8 border border-slate-800">
                <h3 class="font-black text-white mb-4">Application Controls & Status</h3>
                <form action="/admin/applications/${app.id}/status" method="POST" class="grid md:grid-cols-3 gap-4 items-end">
                  <div>
                    <label class="block text-xs font-bold uppercase text-slate-400 mb-1">Update Status</label>
                    <select name="status" class="w-full border border-slate-700 bg-slate-900 rounded-xl px-3 py-2 text-sm text-white">
                      <option value="Submitted" ${app.status === 'Submitted' ? 'selected' : ''}>Submitted</option>
                      <option value="Under Review" ${app.status === 'Under Review' ? 'selected' : ''}>Under Review</option>
                      <option value="Need Correction" ${app.status === 'Need Correction' ? 'selected' : ''}>Need Correction</option>
                      <option value="Payment Verified" ${app.status === 'Payment Verified' ? 'selected' : ''}>Payment Verified</option>
                      <option value="Processing" ${app.status === 'Processing' ? 'selected' : ''}>Processing</option>
                      <option value="Ready" ${app.status === 'Ready' ? 'selected' : ''}>Ready</option>
                      <option value="Completed" ${app.status === 'Completed' ? 'selected' : ''}>Completed</option>
                      <option value="Rejected" ${app.status === 'Rejected' ? 'selected' : ''}>Rejected</option>
                    </select>
                  </div>
                  <div>
                    <label class="block text-xs font-bold uppercase text-slate-400 mb-1">Admin Remarks / Correction Request</label>
                    <input type="text" name="admin_remarks" value="${app.admin_remarks || ''}" placeholder="Message to customer..." class="w-full border border-slate-700 bg-slate-900 rounded-xl px-3 py-2 text-sm text-white">
                  </div>
                  <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-xl text-sm transition">Save Status</button>
                </form>
              </div>

              <div class="bg-slate-950 border border-slate-800 p-8 rounded-3xl shadow-xl mb-8 space-y-4">
                <h3 class="font-black text-white text-lg">Application Data for ${app.service}</h3>
                <div class="grid md:grid-cols-3 gap-4 text-sm bg-slate-900 p-6 rounded-2xl border border-slate-800">
                  <div><strong>Full Name:</strong> ${formData.first_name || ''} ${formData.middle_name || ''} ${formData.last_name || ''} ${formData.suffix || ''}</div>
                  <div><strong>Date of Birth:</strong> ${formData.date_of_birth || ''}</div>
                  <div><strong>Place of Birth:</strong> ${formData.place_of_birth || ''}</div>
                  <div><strong>Sex:</strong> ${formData.sex || ''}</div>
                  <div><strong>Civil Status:</strong> ${formData.civil_status || ''}</div>
                  <div><strong>Nationality:</strong> ${formData.nationality || ''}</div>
                  <div><strong>Mobile:</strong> ${formData.mobile_number || ''}</div>
                  <div><strong>Email:</strong> ${formData.email_address || ''}</div>
                  <div class="md:col-span-3"><strong>Complete Address:</strong> ${formData.street || ''}, ${formData.barangay || ''}, ${formData.city || ''}, ${formData.province || ''} (${formData.zip_code || ''})</div>
                  <div><strong>Father's Name:</strong> ${formData.father_name || ''} (${formData.father_dob || ''})</div>
                  <div><strong>Mother's Maiden Name:</strong> ${formData.mother_maiden_name || ''} (${formData.mother_dob || ''})</div>
                  ${formData.civil_status === 'Married' ? `
                    <div class="md:col-span-3 border-t border-slate-800 pt-2"><strong>Spouse:</strong> ${formData.spouse_name || 'N/A'} (DOB: ${formData.spouse_dob || 'N/A'}, Married: ${formData.marriage_date || 'N/A'})</div>
                  ` : ''}
                  <div class="md:col-span-3 border-t border-slate-800 pt-2"><strong>Employment:</strong> ${formData.employment_status || ''} - ${formData.occupation || ''} (${formData.employer_name || 'N/A'})</div>
                </div>
              </div>

              <div class="bg-slate-950 p-6 rounded-3xl shadow-xl mb-8 border border-slate-800">
                <h3 class="font-black text-white mb-4">Beneficiaries (${beneficiaries.length})</h3>
                ${beneficiaries.length === 0 ? `<p class="text-sm text-slate-500">No beneficiaries listed.</p>` : `
                  <div class="grid md:grid-cols-2 gap-4">
                    ${beneficiaries.map((b, idx) => `
                      <div class="border border-slate-800 p-4 rounded-2xl bg-slate-900 text-sm space-y-1">
                        <span class="font-bold text-blue-400">Beneficiary ${idx + 1}: ${b.full_name}</span>
                        <p class="text-xs text-slate-400">Relationship: <strong>${b.relationship}</strong> &bull; DOB: ${b.birth_date}</p>
                        <p class="text-xs text-slate-400">Address: ${b.address}</p>
                        <p class="text-xs text-slate-400">Contact: ${b.contact_number}</p>
                      </div>
                    `).join('')}
                  </div>
                `}
              </div>

              <div class="bg-slate-950 p-6 rounded-3xl shadow-xl mb-8 border border-slate-800">
                <h3 class="font-black text-white mb-4">Submitted Documents</h3>
                <div class="grid md:grid-cols-3 gap-4">
                  ${documents.map(d => `
                    <div class="border border-slate-800 p-4 rounded-2xl bg-slate-900 space-y-2">
                      <span class="font-bold text-xs uppercase text-blue-400 block">${d.doc_type.replace(/_/g, ' ')}</span>
                      <p class="text-xs text-slate-400 truncate">${d.file_name}</p>
                      <a href="${d.file_path}" target="_blank" class="block text-center bg-blue-600 hover:bg-blue-700 text-white py-1.5 rounded-xl text-xs font-bold transition">Preview / Download</a>
                    </div>
                  `).join('')}
                </div>
              </div>

              <div class="bg-slate-950 p-6 rounded-3xl shadow-xl mb-8 border border-slate-800 space-y-4">
                <h3 class="font-black text-white">Payment Information</h3>
                ${payment ? `
                  <div class="grid md:grid-cols-3 gap-4 text-sm">
                    <div>Method: <strong>${payment.payment_method}</strong></div>
                    <div>Amount: <strong>₱${payment.amount}</strong></div>
                    <div>Reference #: <strong>${payment.reference_number || 'N/A'}</strong></div>
                    <div>Status: <span class="px-2.5 py-1 bg-amber-950 text-amber-300 rounded-full font-bold text-xs">${payment.payment_status}</span></div>
                    ${payment.proof_path ? `<div><a href="${payment.proof_path}" target="_blank" class="text-blue-400 font-bold underline text-xs">View Proof of Payment</a></div>` : ''}
                  </div>
                  <form action="/admin/payments/${payment.id}/verify" method="POST" class="mt-4 flex gap-4 items-center">
                    <select name="payment_status" class="border border-slate-700 bg-slate-900 rounded-xl px-3 py-2 text-sm text-white">
                      <option value="Pending Verification">Pending Verification</option>
                      <option value="Verified">Verified</option>
                      <option value="Rejected">Rejected</option>
                    </select>
                    <button type="submit" class="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-5 py-2 rounded-xl text-sm transition">Update Payment Status</button>
                  </form>
                ` : `<p class="text-sm text-slate-500">No payment record found.</p>`}
              </div>

              <div class="bg-slate-950 p-6 rounded-3xl shadow-xl border border-slate-800 space-y-4">
                <h3 class="font-black text-white">Upload Completed Files for Customer</h3>
                <div class="space-y-2 mb-4">
                  ${completedFiles.map(cf => `
                    <div class="flex justify-between items-center border border-slate-800 p-3 rounded-2xl bg-slate-900 text-sm">
                      <div><strong>${cf.file_name}</strong> - <span class="text-xs text-slate-400">${cf.description || 'Completed file'}</span></div>
                      <a href="${cf.file_path}" target="_blank" class="text-blue-400 font-bold hover:underline text-xs">Download</a>
                    </div>
                  `).join('')}
                </div>
                <form action="/admin/applications/${app.id}/upload-completed" method="POST" enctype="multipart/form-data" class="grid md:grid-cols-3 gap-4 items-end border-t border-slate-800 pt-4">
                  <div>
                    <label class="block text-xs font-bold uppercase text-slate-400 mb-1">Select Completed File</label>
                    <input type="file" name="completed_file" required class="w-full border border-slate-700 bg-slate-900 rounded-xl px-3 py-1.5 text-xs text-slate-300">
                  </div>
                  <div>
                    <label class="block text-xs font-bold uppercase text-slate-400 mb-1">File Description</label>
                    <input type="text" name="description" placeholder="e.g. Official TIN Card / SSS E1 Copy" required class="w-full border border-slate-700 bg-slate-900 rounded-xl px-3 py-2 text-sm text-white">
                  </div>
                  <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-xl text-sm transition">+ Upload Completed File</button>
                </form>
              </div>
            `;
            res.send(adminLayout('Applicant Profile', content, 'applications'));
          });
        });
      });
    });
  });
});

app.post('/admin/applications/:id/status', requireAdmin, (req, res) => {
  const appId = req.params.id;
  const { status, admin_remarks } = req.body;

  db.get(`SELECT * FROM applications WHERE id = ?`, [appId], (err, app) => {
    if (app) {
      db.run(`UPDATE applications SET status = ?, admin_remarks = ? WHERE id = ?`, [status, admin_remarks, appId], () => {
        logStatusHistory(appId, status, admin_remarks);
        addNotification(app.customer_id, `Application Status Updated: ${status}`, admin_remarks || `Your application status is now ${status}.`);
        logAudit(req.session.admin.username, `Updated application #${app.tracking_number} status to ${status}`);
        res.redirect(`/admin/applications/${appId}`);
      });
    } else {
      res.redirect('/admin/applications');
    }
  });
});

const singleUpload = upload.single('completed_file');
app.post('/admin/applications/:id/upload-completed', requireAdmin, singleUpload, (req, res) => {
  const appId = req.params.id;
  const description = req.body.description;
  const file = req.file;

  if (file) {
    db.get(`SELECT * FROM applications WHERE id = ?`, [appId], (err, app) => {
      if (app) {
        db.run(`INSERT INTO completed_files (application_id, file_path, file_name, file_type, description) VALUES (?, ?, ?, ?, ?)`,
          [appId, '/uploads/' + file.filename, file.originalname, file.mimetype, description], () => {
            addNotification(app.customer_id, 'Completed Document Uploaded', `Admin uploaded a completed document for your application ${app.tracking_number}.`);
            logAudit(req.session.admin.username, `Uploaded completed file for application #${app.tracking_number}`);
            res.redirect(`/admin/applications/${appId}`);
          });
      } else {
        res.redirect('/admin/applications');
      }
    });
  } else {
    res.redirect(`/admin/applications/${appId}`);
  }
});

app.post('/admin/payments/:id/verify', requireAdmin, (req, res) => {
  const paymentId = req.params.id;
  const { payment_status } = req.body;

  db.get(`SELECT * FROM payments WHERE id = ?`, [paymentId], (err, payment) => {
    if (payment) {
      db.run(`UPDATE payments SET payment_status = ? WHERE id = ?`, [payment_status, paymentId], () => {
        db.run(`UPDATE applications SET payment_status = ? WHERE id = ?`, [payment_status, payment.application_id], () => {
          addNotification(payment.customer_id, `Payment Status: ${payment_status}`, `Your payment for tracking #${payment.tracking_number} has been marked as ${payment_status}.`);
          logAudit(req.session.admin.username, `Verified payment for tracking #${payment.tracking_number} as ${payment_status}`);
          res.redirect(`/admin/applications/${payment.application_id}`);
        });
      });
    } else {
      res.redirect('/admin/applications');
    }
  });
});

app.get('/admin/payments', requireAdmin, (req, res) => {
  db.all(`SELECT p.*, u.full_name FROM payments p JOIN users u ON p.customer_id = u.id ORDER BY p.id DESC`, [], (err, payments) => {
    const content = `
      <h1 class="text-3xl font-black text-white mb-6">Payment Verification</h1>
      <div class="bg-slate-950 p-6 rounded-3xl shadow-xl border border-slate-800">
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="border-b border-slate-800 bg-slate-900 text-xs text-slate-400 uppercase">
                <th class="p-3">Customer</th>
                <th class="p-3">Tracking #</th>
                <th class="p-3">Service</th>
                <th class="p-3">Method</th>
                <th class="p-3">Amount</th>
                <th class="p-3">Status</th>
                <th class="p-3">Proof</th>
              </tr>
            </thead>
            <tbody class="text-sm">
              ${payments.map(p => `
                <tr class="border-b border-slate-800 hover:bg-slate-900 transition">
                  <td class="p-3 font-bold">${p.full_name}</td>
                  <td class="p-3 font-mono text-blue-400">${p.tracking_number}</td>
                  <td class="p-3">${p.service}</td>
                  <td class="p-3">${p.payment_method}</td>
                  <td class="p-3 font-bold text-emerald-400">₱${p.amount}</td>
                  <td class="p-3"><span class="px-2.5 py-1 bg-amber-950 text-amber-300 rounded-full text-xs font-bold">${p.payment_status}</span></td>
                  <td class="p-3">
                    ${p.proof_path ? `<a href="${p.proof_path}" target="_blank" class="text-blue-400 font-bold underline text-xs">View Proof</a>` : 'No proof'}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
    res.send(adminLayout('Payments', content, 'payments'));
  });
});

// Admin Support Tickets Management (Feature #37)
app.get('/admin/tickets', requireAdmin, (req, res) => {
  db.all(`SELECT t.*, u.full_name FROM tickets t JOIN users u ON t.customer_id = u.id ORDER BY t.id DESC`, [], (err, tickets) => {
    const content = `
      <h1 class="text-3xl font-black text-white mb-6">Customer Support Tickets</h1>
      <div class="space-y-4">
        ${tickets.length === 0 ? `<p class="text-slate-500">No support tickets found.</p>` : tickets.map(t => `
          <div class="bg-slate-950 p-6 rounded-3xl shadow-xl border border-slate-800 space-y-3">
            <div class="flex justify-between items-center">
              <span class="font-bold text-white text-base">${t.subject} &bull; <span class="text-xs text-blue-400">${t.full_name}</span></span>
              <span class="px-2.5 py-1 bg-amber-950 text-amber-300 rounded-full text-xs font-bold">${t.status}</span>
            </div>
            <p class="text-sm text-slate-300">${t.message}</p>
            ${t.admin_reply ? `<div class="bg-slate-900 p-3 rounded-2xl border border-slate-800 text-xs text-slate-300"><strong>Your Reply:</strong> ${t.admin_reply}</div>` : ''}
            <form action="/admin/tickets/${t.id}/reply" method="POST" class="flex gap-4 mt-2">
              <input type="text" name="admin_reply" placeholder="Type reply..." required class="flex-1 border border-slate-700 bg-slate-900 rounded-xl px-3 py-2 text-sm text-white">
              <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-xl text-xs font-bold transition">Send Reply</button>
            </form>
          </div>
        `).join('')}
      </div>
    `;
    res.send(adminLayout('Support Tickets', content, 'tickets'));
  });
});

app.post('/admin/tickets/:id/reply', requireAdmin, (req, res) => {
  const ticketId = req.params.id;
  const { admin_reply } = req.body;
  db.run(`UPDATE tickets SET admin_reply = ?, status = 'Resolved' WHERE id = ?`, [admin_reply, ticketId], () => {
    logAudit(req.session.admin.username, `Replied to support ticket #${ticketId}`);
    res.redirect('/admin/tickets');
  });
});

// Admin Users Management (Feature #38)
app.get('/admin/users', requireAdmin, (req, res) => {
  db.all(`SELECT * FROM users ORDER BY id DESC`, [], (err, users) => {
    const content = `
      <h1 class="text-3xl font-black text-white mb-6">Registered Customer Accounts</h1>
      <div class="bg-slate-950 p-6 rounded-3xl shadow-xl border border-slate-800">
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="border-b border-slate-800 bg-slate-900 text-xs text-slate-400 uppercase">
                <th class="p-3">ID</th>
                <th class="p-3">Full Name</th>
                <th class="p-3">Username</th>
                <th class="p-3">Mobile</th>
                <th class="p-3">Email</th>
                <th class="p-3">Registered Date</th>
              </tr>
            </thead>
            <tbody class="text-sm">
              ${users.map(u => `
                <tr class="border-b border-slate-800 hover:bg-slate-900 transition">
                  <td class="p-3 font-mono">#${u.id}</td>
                  <td class="p-3 font-bold">${u.full_name}</td>
                  <td class="p-3 text-blue-400">${u.username}</td>
                  <td class="p-3">${u.mobile_number}</td>
                  <td class="p-3">${u.email_address}</td>
                  <td class="p-3 text-xs text-slate-400">${u.created_at}</td>
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

// Admin Audit Logs (Feature #39)
app.get('/admin/audit', requireAdmin, (req, res) => {
  db.all(`SELECT * FROM audit_logs ORDER BY id DESC`, [], (err, logs) => {
    const content = `
      <h1 class="text-3xl font-black text-white mb-6">System Audit Logs</h1>
      <div class="bg-slate-950 p-6 rounded-3xl shadow-xl border border-slate-800">
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="border-b border-slate-800 bg-slate-900 text-xs text-slate-400 uppercase">
                <th class="p-3">ID</th>
                <th class="p-3">Admin Username</th>
                <th class="p-3">Action Performed</th>
                <th class="p-3">Timestamp</th>
              </tr>
            </thead>
            <tbody class="text-sm">
              ${logs.map(l => `
                <tr class="border-b border-slate-800 hover:bg-slate-900 transition">
                  <td class="p-3 font-mono">#${l.id}</td>
                  <td class="p-3 font-bold text-blue-400">${l.admin_username}</td>
                  <td class="p-3">${l.action}</td>
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

// Admin Settings & Specific QR Code Management (Feature #40)
app.get('/admin/settings', requireAdmin, async (req, res) => {
  const settings = await getSettings();
  const content = `
    <h1 class="text-3xl font-black text-white mb-6">System Settings & QR Codes Configuration</h1>
    <form action="/admin/settings" method="POST" enctype="multipart/form-data" class="bg-slate-950 p-8 rounded-3xl shadow-xl space-y-6 border border-slate-800">
      <div class="grid md:grid-cols-2 gap-4">
        <div>
          <label class="block text-xs font-bold uppercase text-slate-400 mb-1">Business Name</label>
          <input type="text" name="business_name" value="${settings.business_name || ''}" required class="w-full border border-slate-700 bg-slate-900 rounded-xl px-3 py-2 text-sm text-white">
        </div>
        <div>
          <label class="block text-xs font-bold uppercase text-slate-400 mb-1">Developer / Creator Name</label>
          <input type="text" name="creator_name" value="${settings.creator_name || 'Mark Jerald Agdigos'}" required class="w-full border border-slate-700 bg-slate-900 rounded-xl px-3 py-2 text-sm text-white">
        </div>
        <div>
          <label class="block text-xs font-bold uppercase text-slate-400 mb-1">Contact Number</label>
          <input type="text" name="contact_number" value="${settings.contact_number || ''}" required class="w-full border border-slate-700 bg-slate-900 rounded-xl px-3 py-2 text-sm text-white">
        </div>
        <div>
          <label class="block text-xs font-bold uppercase text-slate-400 mb-1">Support Email</label>
          <input type="email" name="email" value="${settings.email || ''}" required class="w-full border border-slate-700 bg-slate-900 rounded-xl px-3 py-2 text-sm text-white">
        </div>
      </div>

      <div class="border-t border-slate-800 pt-4 grid md:grid-cols-3 gap-4">
        <div>
          <label class="block text-xs font-bold uppercase text-slate-400 mb-1">BIR / TIN Fee (₱)</label>
          <input type="number" name="fee_bir" value="${settings.fee_bir || 500}" required class="w-full border border-slate-700 bg-slate-900 rounded-xl px-3 py-2 text-sm text-white">
        </div>
        <div>
          <label class="block text-xs font-bold uppercase text-slate-400 mb-1">SSS Fee (₱)</label>
          <input type="number" name="fee_sss" value="${settings.fee_sss || 400}" required class="w-full border border-slate-700 bg-slate-900 rounded-xl px-3 py-2 text-sm text-white">
        </div>
        <div>
          <label class="block text-xs font-bold uppercase text-slate-400 mb-1">Pag-IBIG Fee (₱)</label>
          <input type="number" name="fee_pagibig" value="${settings.fee_pagibig || 400}" required class="w-full border border-slate-700 bg-slate-900 rounded-xl px-3 py-2 text-sm text-white">
        </div>
      </div>

      <div class="border-t border-slate-800 pt-4 grid md:grid-cols-2 gap-4">
        <div>
          <label class="block text-xs font-bold uppercase text-slate-400 mb-1">GCash Account Name</label>
          <input type="text" name="gcash_name" value="${settings.gcash_name || ''}" required class="w-full border border-slate-700 bg-slate-900 rounded-xl px-3 py-2 text-sm text-white">
        </div>
        <div>
          <label class="block text-xs font-bold uppercase text-slate-400 mb-1">GCash Account Number</label>
          <input type="text" name="gcash_number" value="${settings.gcash_number || ''}" required class="w-full border border-slate-700 bg-slate-900 rounded-xl px-3 py-2 text-sm text-white">
        </div>
      </div>

      <div class="border-t border-slate-800 pt-4">
        <label class="block text-xs font-bold uppercase text-slate-400 mb-2">Dedicated QR Codes for Payments</label>
        <div class="grid md:grid-cols-3 gap-4">
          <div class="bg-slate-900 p-4 rounded-2xl border border-slate-800 text-center">
            <span class="text-xs font-bold text-blue-400 block mb-2">BIR GCash QR</span>
            ${settings.qr_bir ? `<img src="${settings.qr_bir}" class="h-24 w-24 object-contain mx-auto mb-2 bg-white p-1 rounded"/>` : ''}
            <input type="file" name="qr_bir_file" accept="image/*" class="w-full text-xs text-slate-400">
          </div>
          <div class="bg-slate-900 p-4 rounded-2xl border border-slate-800 text-center">
            <span class="text-xs font-bold text-emerald-400 block mb-2">SSS GCash QR</span>
            ${settings.qr_sss ? `<img src="${settings.qr_sss}" class="h-24 w-24 object-contain mx-auto mb-2 bg-white p-1 rounded"/>` : ''}
            <input type="file" name="qr_sss_file" accept="image/*" class="w-full text-xs text-slate-400">
          </div>
          <div class="bg-slate-900 p-4 rounded-2xl border border-slate-800 text-center">
            <span class="text-xs font-bold text-amber-400 block mb-2">Pag-IBIG GCash QR</span>
            ${settings.qr_pagibig ? `<img src="${settings.qr_pagibig}" class="h-24 w-24 object-contain mx-auto mb-2 bg-white p-1 rounded"/>` : ''}
            <input type="file" name="qr_pagibig_file" accept="image/*" class="w-full text-xs text-slate-400">
          </div>
        </div>
      </div>

      <div class="border-t border-slate-800 pt-4">
        <label class="block text-xs font-bold uppercase text-slate-400 mb-1">Announcement Banner Text</label>
        <input type="text" name="announcement" value="${settings.announcement || ''}" class="w-full border border-slate-700 bg-slate-900 rounded-xl px-3 py-2 text-sm text-white">
      </div>

      <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white font-bold px-8 py-3 rounded-xl text-xs transition shadow">Save Settings</button>
    </form>
  `;
  res.send(adminLayout('Settings', content, 'settings'));
});

const settingsUpload = upload.fields([
  { name: 'logo_file', maxCount: 1 },
  { name: 'qr_bir_file', maxCount: 1 },
  { name: 'qr_sss_file', maxCount: 1 },
  { name: 'qr_pagibig_file', maxCount: 1 }
]);

app.post('/admin/settings', requireAdmin, settingsUpload, async (req, res) => {
  const body = req.body;
  const files = req.files;

  for (const [key, value] of Object.entries(body)) {
    db.run(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?`, [key, value, value]);
  }

  if (files) {
    if (files['logo_file'] && files['logo_file'][0]) {
      const logoPath = '/uploads/' + files['logo_file'][0].filename;
      db.run(`INSERT INTO settings (key, value) VALUES ('logo_url', ?) ON CONFLICT(key) DO UPDATE SET value = ?`, [logoPath, logoPath]);
    }
    if (files['qr_bir_file'] && files['qr_bir_file'][0]) {
      const qrPath = '/uploads/' + files['qr_bir_file'][0].filename;
      db.run(`INSERT INTO settings (key, value) VALUES ('qr_bir', ?) ON CONFLICT(key) DO UPDATE SET value = ?`, [qrPath, qrPath]);
    }
    if (files['qr_sss_file'] && files['qr_sss_file'][0]) {
      const qrPath = '/uploads/' + files['qr_sss_file'][0].filename;
      db.run(`INSERT INTO settings (key, value) VALUES ('qr_sss', ?) ON CONFLICT(key) DO UPDATE SET value = ?`, [qrPath, qrPath]);
    }
    if (files['qr_pagibig_file'] && files['qr_pagibig_file'][0]) {
      const qrPath = '/uploads/' + files['qr_pagibig_file'][0].filename;
      db.run(`INSERT INTO settings (key, value) VALUES ('qr_pagibig', ?) ON CONFLICT(key) DO UPDATE SET value = ?`, [qrPath, qrPath]);
    }
  }

  logAudit(req.session.admin.username, 'Updated system settings and QR codes');
  res.redirect('/admin/settings');
});

// Print Application Summary
app.get('/admin/print/:id', requireAdmin, (req, res) => {
  const appId = req.params.id;
  db.get(`SELECT a.*, u.full_name as customer_name FROM applications a JOIN users u ON a.customer_id = u.id WHERE a.id = ?`, [appId], (err, app) => {
    if (!app) return res.send(`Application not found.`);
    db.all(`SELECT * FROM beneficiaries WHERE application_id = ?`, [appId], (err2, beneficiaries) => {
      const formData = JSON.parse(app.data_json || '{}');
      res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <title>Print Summary - ${app.tracking_number}</title>
          <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
        </head>
        <body class="bg-white text-black p-8 font-sans" onload="window.print()">
          <h1 class="text-2xl font-bold mb-1">GovAssist PH - Application Summary</h1>
          <p class="text-xs text-gray-600 mb-6 font-mono">Tracking: ${app.tracking_number} | Service: ${app.service} | Date: ${app.created_at} | Developer: Mark Jerald Agdigos</p>

          <div class="space-y-6 text-sm">
            <div class="border p-4 rounded">
              <h3 class="font-bold border-b pb-1 mb-2">Personal Information</h3>
              <p><strong>Name:</strong> ${formData.first_name || ''} ${formData.middle_name || ''} ${formData.last_name || ''} ${formData.suffix || ''}</p>
              <p><strong>DOB:</strong> ${formData.date_of_birth || ''} &bull; <strong>Place of Birth:</strong> ${formData.place_of_birth || ''}</p>
              <p><strong>Sex:</strong> ${formData.sex || ''} &bull; <strong>Civil Status:</strong> ${formData.civil_status || ''}</p>
            </div>
            <div class="border p-4 rounded">
              <h3 class="font-bold border-b pb-1 mb-2">Contact & Address</h3>
              <p><strong>Mobile:</strong> ${formData.mobile_number || ''} &bull; <strong>Email:</strong> ${formData.email_address || ''}</p>
              <p><strong>Address:</strong> ${formData.street || ''}, ${formData.barangay || ''}, ${formData.city || ''}, ${formData.province || ''} (${formData.zip_code || ''})</p>
            </div>
          </div>
        </body>
        </html>
      `);
    });
  });
});

// Backup / Export
app.get('/admin/backup', requireAdmin, (req, res) => {
  db.all(`SELECT a.*, u.full_name FROM applications a JOIN users u ON a.customer_id = u.id`, [], (err, apps) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=govassist_backup_2026.json');
    logAudit(req.session.admin.username, 'Exported database JSON backup');
    res.send(JSON.stringify(apps, null, 2));
  });
});

// Start Server
app.listen(PORT, () => {
  console.log(`GovAssist PH running successfully on port ${PORT} - Developed by Mark Jerald Agdigos`);
});
