/**
 * BIR / TIN, SSS & Pag-IBIG Application Assistance System
 * Created by: Mark Jerald Agdigos
 * Complete Single-File Production-Ready Application (app.js)
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
const CREATOR_NAME = 'Mark Jerald Agdigos';

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer Storage Configuration for all required uploads
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
    const allowedTypes = /jpeg|jpg|png|pdf/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    } else {
      cb(new Error('Only images (JPEG, JPG, PNG) and PDF documents are allowed!'));
    }
  }
});

// Database Setup (SQLite for persistence)
const dbFile = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbFile, (err) => {
  if (err) {
    console.error('Error opening database', err.message);
  } else {
    console.log('Connected to the SQLite database. Creator: ' + CREATOR_NAME);
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
      language TEXT DEFAULT 'en',
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
        business_name: 'GovAssist PH - Created by Mark Jerald Agdigos',
        logo_url: '',
        contact_number: '+63 912 345 6789',
        email: 'support@govassist.ph',
        address: 'Manila, Philippines',
        gcash_qr: '',
        gcash_name: 'Mark Jerald Agdigos (Admin)',
        gcash_number: '09123456789',
        fee_bir: '500',
        fee_sss: '400',
        fee_pagibig: '400',
        payment_instructions: '1. Scan GCash QR or send payment to the number provided.\n2. Upload clear proof of payment.\n3. Wait for admin verification (usually within 24 hours).'
      };
      for (const [key, value] of Object.entries(defaultSettings)) {
        db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`, [key, value]);
      }
    });

    // Applications with comprehensive fields
    db.run(`CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER,
      service TEXT,
      tracking_number TEXT UNIQUE,
      status TEXT DEFAULT 'Submitted',
      payment_status TEXT DEFAULT 'Payment Pending',
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

    // Uploaded Documents per application (ID, Proof of Payment, etc.)
    db.run(`CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id INTEGER,
      doc_type TEXT,
      file_path TEXT,
      file_name TEXT,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Completed Files Uploaded by Admin (e.g. Generated TIN ID, SSS stub, Pag-IBIG MID form)
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

    // Status History Log
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

    // Support Messages / Live Chat
    db.run(`CREATE TABLE IF NOT EXISTS support_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER,
      sender TEXT,
      message TEXT,
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
  secret: process.env.SESSION_SECRET || 'govassist_secure_secret_key_2026_markjerald',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 1 day
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

// Global View Middleware
app.use(async (req, res, next) => {
  try {
    res.locals.settings = await getSettings();
    res.locals.customer = req.session.customer || null;
    res.locals.admin = req.session.admin || null;
    res.locals.creator = CREATOR_NAME;
    next();
  } catch (e) {
    next();
  }
});

// ==========================================
// TRANSLATIONS / LANGUAGE PACK (EN / TL)
// ==========================================
const langPack = {
  en: {
    home_title: "Fast & Hassle-Free Government Application Assistance",
    home_subtitle: "System created by Mark Jerald Agdigos. We assist you with your BIR/TIN, SSS, and Pag-IBIG registrations and applications securely.",
    get_started: "Get Started Now",
    track_app: "Track Application",
    customer_login: "Customer Login",
    register: "Register",
    admin_login: "Admin Portal",
    disclaimer: "System Disclaimer: Created by Mark Jerald Agdigos. This is an application assistance and tracking platform, not the official government website."
  },
  tl: {
    home_title: "Mabilis at Madaling Tulong sa Pag-aapply sa Gobyerno",
    home_subtitle: "Sistemang ginawa ni Mark Jerald Agdigos. Tinutulungan ka namin sa iyong BIR/TIN, SSS, at Pag-IBIG registrations nang mabilis at ligtas.",
    get_started: "Magsimula Na",
    track_app: "I-track ang Application",
    customer_login: "Login ng Customer",
    register: "Magrehistro",
    admin_login: "Admin Portal",
    disclaimer: "Paunawa: Ginawa ni Mark Jerald Agdigos. Ito ay isang assistance platform at hindi ang opisyal na website ng gobyerno."
  }
};

app.get('/set-lang/:lang', (req, res) => {
  const lang = req.params.lang;
  if (['en', 'tl'].includes(lang)) {
    req.session.lang = lang;
    if (req.session.customer) {
      db.run(`UPDATE users SET language = ? WHERE id = ?`, [lang, req.session.customer.id]);
    }
  }
  res.redirect('back');
});

function getLang(req) {
  return req.session.lang || 'en';
}

// ==========================================
// PUBLIC LANDING & TRACKING
// ==========================================
app.get('/', async (req, res) => {
  const settings = res.locals.settings;
  const l = langPack[getLang(req)];
  res.send(`
    <!DOCTYPE html>
    <html lang="${getLang(req)}">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${settings.business_name}</title>
      <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
    </head>
    <body class="bg-gray-50 text-gray-800 font-sans">
      <header class="bg-indigo-900 text-white shadow-lg sticky top-0 z-50">
        <div class="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <div class="flex items-center space-x-3">
            <span class="text-xl font-extrabold tracking-tight">GovAssist PH <span class="text-xs bg-indigo-700 px-2 py-0.5 rounded text-indigo-200">By ${CREATOR_NAME}</span></span>
          </div>
          <div class="flex items-center space-x-4">
            <div class="text-sm">
              <a href="/set-lang/en" class="px-2 py-1 rounded ${getLang(req) === 'en' ? 'bg-indigo-700 font-bold' : 'text-indigo-200'}">EN</a> |
              <a href="/set-lang/tl" class="px-2 py-1 rounded ${getLang(req) === 'tl' ? 'bg-indigo-700 font-bold' : 'text-indigo-200'}">PH/TL</a>
            </div>
            <a href="/customer/login" class="px-4 py-2 bg-indigo-700 hover:bg-indigo-600 rounded text-sm font-semibold shadow">${l.customer_login}</a>
            <a href="/customer/register" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded text-sm font-semibold shadow">${l.register}</a>
            <a href="/admin/login" class="text-xs text-indigo-300 hover:underline">${l.admin_login}</a>
          </div>
        </div>
      </header>

      <main class="max-w-7xl mx-auto px-4 py-16">
        <div class="text-center max-w-3xl mx-auto mb-16">
          <span class="inline-block bg-indigo-100 text-indigo-800 text-xs px-3 py-1 rounded-full font-semibold mb-4">Developed by ${CREATOR_NAME}</span>
          <h1 class="text-4xl md:text-5xl font-extrabold text-indigo-900 mb-6 leading-tight">${l.home_title}</h1>
          <p class="text-lg text-gray-600 mb-8">${l.home_subtitle}</p>
          <div class="flex justify-center gap-4">
            <a href="/customer/register" class="px-8 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-lg transition">${l.get_started}</a>
            <a href="/track-public" class="px-8 py-3 bg-white border border-gray-300 hover:bg-gray-100 text-indigo-900 font-bold rounded-xl shadow transition">${l.track_app}</a>
          </div>
        </div>

        <div class="grid md:grid-cols-3 gap-8 mb-16">
          <div class="bg-white p-8 rounded-2xl shadow-xl border border-gray-100 text-center hover:transform hover:-translate-y-1 transition duration-300">
            <div class="text-4xl mb-4">🏢</div>
            <h3 class="text-xl font-bold text-indigo-900 mb-2">BIR / TIN Assistance</h3>
            <p class="text-gray-600 text-sm">Tax Identification Number registration assistance for employed, self-employed, mixed-income, and professionals. Fee: ₱${settings.fee_bir}</p>
          </div>
          <div class="bg-white p-8 rounded-2xl shadow-xl border border-gray-100 text-center hover:transform hover:-translate-y-1 transition duration-300">
            <div class="text-4xl mb-4">🛡️</div>
            <h3 class="text-xl font-bold text-indigo-900 mb-2">SSS Registration</h3>
            <p class="text-gray-600 text-sm">Social Security System membership number application, beneficiary listing, and digital profile support. Fee: ₱${settings.fee_sss}</p>
          </div>
          <div class="bg-white p-8 rounded-2xl shadow-xl border border-gray-100 text-center hover:transform hover:-translate-y-1 transition duration-300">
            <div class="text-4xl mb-4">🏠</div>
            <h3 class="text-xl font-bold text-indigo-900 mb-2">Pag-IBIG Fund</h3>
            <p class="text-gray-600 text-sm">HDMF MID number application assistance, membership registration, and contribution tracking support. Fee: ₱${settings.fee_pagibig}</p>
          </div>
        </div>

        <div class="bg-amber-50 border-l-4 border-amber-500 p-6 rounded-r-2xl text-amber-900 text-xs md:text-sm shadow">
          <strong>${l.disclaimer}</strong>
        </div>
      </main>

      <footer class="bg-gray-900 text-gray-400 py-8 text-center text-sm border-t border-gray-800">
        <p>&copy; 2026 GovAssist PH. Designed & Developed with excellence by <strong class="text-white">${CREATOR_NAME}</strong>. All rights reserved.</p>
      </footer>
    </body>
    </html>
  `);
});

// Public Tracking Page
app.get('/track-public', (req, res) => {
  const trackingNumber = req.query.tracking_number ? req.query.tracking_number.trim() : '';
  let searchResultHtml = '';

  if (trackingNumber) {
    db.get(`SELECT a.*, u.full_name FROM applications a JOIN users u ON a.customer_id = u.id WHERE a.tracking_number = ?`, [trackingNumber], (err, app) => {
      if (!app) {
        searchResultHtml = `<div class="bg-red-50 text-red-700 p-4 rounded-xl text-center font-medium mt-4">Tracking number not found. Please check and try again.</div>`;
        renderTrackPage(res, trackingNumber, searchResultHtml);
      } else {
        db.all(`SELECT * FROM status_history WHERE application_id = ? ORDER BY id DESC`, [app.id], (err2, histories) => {
          searchResultHtml = `
            <div class="bg-white p-6 rounded-2xl shadow-xl mt-6 space-y-4 border border-indigo-100">
              <div class="flex justify-between items-center border-b pb-3">
                <div>
                  <span class="text-xs text-gray-500 block">Tracking Number</span>
                  <span class="font-mono font-bold text-lg text-indigo-900">${app.tracking_number}</span>
                </div>
                <div class="text-right">
                  <span class="px-3 py-1 bg-indigo-100 text-indigo-800 rounded-full text-xs font-bold">${app.status}</span>
                </div>
              </div>
              <div class="grid md:grid-cols-2 gap-4 text-sm">
                <p><strong>Service:</strong> ${app.service}</p>
                <p><strong>Applicant Name:</strong> ${app.full_name || app.full_name}</p>
                <p><strong>Payment Status:</strong> <span class="text-amber-600 font-bold">${app.payment_status}</span></p>
                <p><strong>Date Submitted:</strong> ${app.created_at}</p>
              </div>
              ${app.admin_remarks ? `<div class="bg-indigo-50 p-4 rounded-lg text-sm text-indigo-900"><strong>Admin Remarks:</strong> ${app.admin_remarks}</div>` : ''}
              
              <h4 class="font-bold text-indigo-900 mt-4 border-t pt-3">Status Timeline</h4>
              <div class="space-y-2">
                ${histories.map(h => `
                  <div class="flex items-start space-x-3 text-xs bg-gray-50 p-3 rounded-lg border">
                    <span class="font-bold text-indigo-700">${h.status}</span>
                    <span class="text-gray-600 flex-1">${h.notes || ''}</span>
                    <span class="text-gray-400">${h.created_at}</span>
                  </div>
                `).join('')}
              </div>
            </div>
          `;
          renderTrackPage(res, trackingNumber, searchResultHtml);
        });
      }
    });
  } else {
    renderTrackPage(res, '', '');
  }
});

function renderTrackPage(res, trackingNumber, resultHtml) {
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
      <div class="max-w-xl mx-auto px-4 py-12 w-full">
        <div class="text-center mb-8">
          <span class="text-xs text-indigo-600 font-bold uppercase tracking-wider">Created by ${CREATOR_NAME}</span>
          <h1 class="text-3xl font-extrabold text-indigo-900 mt-1">Track Your Application</h1>
          <p class="text-sm text-gray-600 mt-2">Enter your unique tracking number below to view real-time status.</p>
        </div>
        <form action="/track-public" method="GET" class="bg-white p-6 rounded-2xl shadow-xl space-y-4">
          <div>
            <label class="block text-sm font-semibold mb-1">Tracking Number</label>
            <input type="text" name="tracking_number" value="${trackingNumber}" required placeholder="e.g. TIN-20260901-0001" class="w-full border rounded-xl px-4 py-3 uppercase font-mono text-sm focus:ring-2 focus:ring-indigo-500">
          </div>
          <button type="submit" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl shadow transition">Search Status</button>
        </form>
        ${resultHtml}
        <div class="text-center mt-8">
          <a href="/" class="text-indigo-600 hover:underline text-sm font-semibold">&larr; Back to Home</a>
        </div>
      </div>
      <footer class="bg-white py-4 text-center text-xs text-gray-500 border-t">
        System by ${CREATOR_NAME} &copy; 2026
      </footer>
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
    <body class="bg-indigo-50 flex items-center justify-center min-h-screen p-4">
      <div class="bg-white w-full max-w-md p-8 rounded-2xl shadow-2xl border border-indigo-100">
        <div class="text-center mb-6">
          <span class="text-xs text-indigo-600 font-bold">Created by ${CREATOR_NAME}</span>
          <h2 class="text-2xl font-extrabold text-indigo-900 mt-1">Customer Registration</h2>
        </div>
        <form action="/customer/register" method="POST" class="space-y-4">
          <div>
            <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Full Name</label>
            <input type="text" name="full_name" required class="w-full border rounded-xl px-4 py-2.5 text-sm" placeholder="Juan Dela Cruz">
          </div>
          <div>
            <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Username</label>
            <input type="text" name="username" required class="w-full border rounded-xl px-4 py-2.5 text-sm" placeholder="juandelacruz">
          </div>
          <div>
            <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Mobile Number</label>
            <input type="text" name="mobile_number" required class="w-full border rounded-xl px-4 py-2.5 text-sm" placeholder="09123456789">
          </div>
          <div>
            <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Email Address</label>
            <input type="email" name="email_address" required class="w-full border rounded-xl px-4 py-2.5 text-sm" placeholder="juan@example.com">
          </div>
          <div>
            <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Password</label>
            <input type="password" name="password" required class="w-full border rounded-xl px-4 py-2.5 text-sm">
          </div>
          <div>
            <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Confirm Password</label>
            <input type="password" name="confirm_password" required class="w-full border rounded-xl px-4 py-2.5 text-sm">
          </div>
          <button type="submit" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl shadow transition">Register Account</button>
        </form>
        <p class="text-center text-sm mt-6 text-gray-600">Already have an account? <a href="/customer/login" class="text-indigo-600 font-semibold hover:underline">Login here</a></p>
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
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Customer Login - GovAssist PH</title>
      <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
    </head>
    <body class="bg-indigo-50 flex items-center justify-center min-h-screen p-4">
      <div class="bg-white w-full max-w-md p-8 rounded-2xl shadow-2xl border border-indigo-100">
        <div class="text-center mb-6">
          <span class="text-xs text-indigo-600 font-bold">Created by ${CREATOR_NAME}</span>
          <h2 class="text-2xl font-extrabold text-indigo-900 mt-1">Customer Login</h2>
        </div>
        <form action="/customer/login" method="POST" class="space-y-4">
          <div>
            <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Username</label>
            <input type="text" name="username" required class="w-full border rounded-xl px-4 py-2.5 text-sm">
          </div>
          <div>
            <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Password</label>
            <input type="password" name="password" required class="w-full border rounded-xl px-4 py-2.5 text-sm">
          </div>
          <button type="submit" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl shadow transition">Login</button>
        </form>
        <p class="text-center text-sm mt-6 text-gray-600">Don't have an account? <a href="/customer/register" class="text-indigo-600 font-semibold hover:underline">Register here</a></p>
        <div class="text-center mt-3"><a href="/" class="text-gray-500 hover:underline text-xs">&larr; Back to home</a></div>
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
      req.session.lang = user.language || 'en';
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
        <div class="text-center mb-6">
          <span class="text-xs text-indigo-600 font-bold">Created by ${CREATOR_NAME}</span>
          <h2 class="text-2xl font-extrabold text-gray-900 mt-1">Admin Portal Login</h2>
        </div>
        <form action="/admin/login" method="POST" class="space-y-4">
          <div>
            <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Admin Username</label>
            <input type="text" name="username" required class="w-full border rounded-xl px-4 py-2.5 text-sm">
          </div>
          <div>
            <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Password</label>
            <input type="password" name="password" required class="w-full border rounded-xl px-4 py-2.5 text-sm">
          </div>
          <button type="submit" class="w-full bg-gray-900 hover:bg-gray-800 text-white font-bold py-3 rounded-xl shadow transition">Login to Admin</button>
        </form>
        <div class="text-center mt-4"><a href="/" class="text-xs text-gray-500 hover:underline">&larr; Back to Home</a></div>
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
      res.redirect('/admin/dashboard');
    } else {
      res.send(`<script>alert('Invalid admin credentials!'); window.history.back();</script>`);
    }
  });
});

app.get('/admin/logout', (req, res) => {
  req.session.admin = null;
  res.redirect('/admin/login');
});

// Middleware Checkers
function requireCustomer(req, res, next) {
  if (!req.session.customer) return res.redirect('/customer/login');
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.admin) return res.redirect('/admin/login');
  next();
}

// ==========================================
// CUSTOMER PORTAL LAYOUT & FEATURES (15+ FEATURES)
// ==========================================
function customerLayout(title, content, activeTab, unreadCount = 0, reqSession = null) {
  const customerName = reqSession && reqSession.customer ? reqSession.customer.full_name : '';
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title} - GovAssist PH</title>
      <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
    </head>
    <body class="bg-gray-100 text-gray-800 font-sans">
      <div class="min-h-screen flex flex-col md:flex-row">
        <aside class="bg-indigo-900 text-white w-full md:w-64 p-6 flex flex-col justify-between shadow-xl">
          <div>
            <div class="text-xl font-extrabold mb-2 tracking-tight">GovAssist PH</div>
            <span class="text-xs text-indigo-300 block mb-6 pb-4 border-b border-indigo-800">By ${CREATOR_NAME}</span>
            <nav class="space-y-1.5 text-sm">
              <a href="/customer/dashboard" class="block px-4 py-2.5 rounded-xl transition ${activeTab === 'dashboard' ? 'bg-indigo-800 font-bold shadow' : 'hover:bg-indigo-800'}">📊 Dashboard</a>
              <a href="/customer/apply" class="block px-4 py-2.5 rounded-xl transition ${activeTab === 'apply' ? 'bg-indigo-800 font-bold shadow' : 'hover:bg-indigo-800'}">📝 + New Application</a>
              <a href="/customer/applications" class="block px-4 py-2.5 rounded-xl transition ${activeTab === 'applications' ? 'bg-indigo-800 font-bold shadow' : 'hover:bg-indigo-800'}">📂 My Applications</a>
              <a href="/customer/payments" class="block px-4 py-2.5 rounded-xl transition ${activeTab === 'payments' ? 'bg-indigo-800 font-bold shadow' : 'hover:bg-indigo-800'}">💳 Payments & GCash</a>
              <a href="/customer/documents" class="block px-4 py-2.5 rounded-xl transition ${activeTab === 'documents' ? 'bg-indigo-800 font-bold shadow' : 'hover:bg-indigo-800'}">📁 Completed Files</a>
              <a href="/customer/notifications" class="block px-4 py-2.5 rounded-xl transition ${activeTab === 'notifications' ? 'bg-indigo-800 font-bold shadow' : 'hover:bg-indigo-800'}">🔔 Notifications ${unreadCount > 0 ? `<span class="bg-red-500 text-white px-2 py-0.5 rounded-full text-xs">${unreadCount}</span>` : ''}</a>
              <a href="/customer/support" class="block px-4 py-2.5 rounded-xl transition ${activeTab === 'support' ? 'bg-indigo-800 font-bold shadow' : 'hover:bg-indigo-800'}">💬 Live Support Chat</a>
              <a href="/customer/profile" class="block px-4 py-2.5 rounded-xl transition ${activeTab === 'profile' ? 'bg-indigo-800 font-bold shadow' : 'hover:bg-indigo-800'}">👤 Profile Settings</a>
            </nav>
          </div>
          <div class="mt-8 pt-4 border-t border-indigo-800">
            <div class="mb-3 text-xs">
              <span class="text-indigo-300 block">Logged in as:</span>
              <strong class="text-white truncate block">${customerName}</strong>
            </div>
            <a href="/customer/logout" class="block text-center bg-red-600 hover:bg-red-700 text-white py-2 rounded-xl text-sm font-semibold shadow transition">Logout</a>
          </div>
        </aside>
        
        <main class="flex-1 p-6 md:p-10 overflow-y-auto">
          ${content}
        </main>
      </div>
    </body>
    </html>
  `;
}

// Feature 1: Customer Dashboard
app.get('/customer/dashboard', requireCustomer, async (req, res) => {
  const customerId = req.session.customer.id;
  db.all(`SELECT * FROM applications WHERE customer_id = ? ORDER BY id DESC`, [customerId], async (err, apps) => {
    db.all(`SELECT * FROM notifications WHERE customer_id = ? AND is_read = 0`, [customerId], async (err2, notifs) => {
      const totalApps = apps.length;
      const pendingApps = apps.filter(a => a.status === 'Submitted' || a.status === 'Under Review').length;
      const completedApps = apps.filter(a => a.status === 'Completed').length;

      const content = `
        <h1 class="text-3xl font-extrabold text-indigo-900 mb-6">Customer Dashboard</h1>
        
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div class="bg-white p-6 rounded-2xl shadow-xl border-l-4 border-indigo-600">
            <h3 class="text-gray-500 text-xs font-semibold uppercase">Total Applications</h3>
            <p class="text-3xl font-extrabold text-indigo-900 mt-2">${totalApps}</p>
          </div>
          <div class="bg-white p-6 rounded-2xl shadow-xl border-l-4 border-amber-500">
            <h3 class="text-gray-500 text-xs font-semibold uppercase">Pending / In Progress</h3>
            <p class="text-3xl font-extrabold text-amber-600 mt-2">${pendingApps}</p>
          </div>
          <div class="bg-white p-6 rounded-2xl shadow-xl border-l-4 border-emerald-600">
            <h3 class="text-gray-500 text-xs font-semibold uppercase">Completed & Approved</h3>
            <p class="text-3xl font-extrabold text-emerald-600 mt-2">${completedApps}</p>
          </div>
        </div>

        <div class="bg-white p-6 rounded-2xl shadow-xl mb-8 border border-indigo-50">
          <div class="flex justify-between items-center mb-4">
            <h2 class="text-xl font-bold text-indigo-900">Recent Applications</h2>
            <a href="/customer/apply" class="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-sm font-semibold shadow transition">+ New Application</a>
          </div>
          ${apps.length === 0 ? `<p class="text-gray-500 text-sm py-4">No applications submitted yet. Click '+ New Application' to start.</p>` : `
            <div class="overflow-x-auto">
              <table class="w-full text-left border-collapse">
                <thead>
                  <tr class="border-b bg-gray-50 text-xs text-gray-600 uppercase">
                    <th class="p-3">Tracking Number</th>
                    <th class="p-3">Service</th>
                    <th class="p-3">Status</th>
                    <th class="p-3">Payment</th>
                    <th class="p-3">Action</th>
                  </tr>
                </thead>
                <tbody class="text-sm">
                  ${apps.slice(0, 5).map(app => `
                    <tr class="border-b hover:bg-gray-50">
                      <td class="p-3 font-mono font-bold text-indigo-900">${app.tracking_number}</td>
                      <td class="p-3">${app.service}</td>
                      <td class="p-3"><span class="px-2.5 py-1 bg-indigo-100 text-indigo-800 rounded-full text-xs font-bold">${app.status}</span></td>
                      <td class="p-3"><span class="px-2.5 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-bold">${app.payment_status}</span></td>
                      <td class="p-3"><a href="/customer/track/${app.id}" class="text-indigo-600 font-semibold hover:underline">View Details</a></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>

        <div class="bg-indigo-50 border border-indigo-200 p-4 rounded-xl text-indigo-900 text-xs">
          <strong>Notice:</strong> System designed and programmed by <strong>${CREATOR_NAME}</strong>. Secure and reliable government application assistant platform.
        </div>
      `;
      res.send(customerLayout('Dashboard', content, 'dashboard', notifs.length, req.session));
    });
  });
});

// Feature 2: Multi-Step Application Wizard with Required Uploads
app.get('/customer/apply', requireCustomer, async (req, res) => {
  const settings = res.locals.settings;
  db.get(`SELECT * FROM users WHERE id = ?`, [req.session.customer.id], (err, user) => {
    const content = `
      <h1 class="text-3xl font-extrabold text-indigo-900 mb-6">New Government Application Wizard</h1>
      <form action="/customer/apply" method="POST" enctype="multipart/form-data" class="bg-white p-8 rounded-2xl shadow-xl space-y-8 border border-indigo-50">
        
        <div class="space-y-4">
          <h2 class="text-xl font-bold text-indigo-900 border-b pb-2 flex items-center justify-between">
            <span>Step 1: Select Service</span>
            <span class="text-xs text-gray-400 font-normal">Created by ${CREATOR_NAME}</span>
          </h2>
          <div class="grid md:grid-cols-3 gap-4">
            <label class="border-2 p-5 rounded-2xl cursor-pointer hover:border-indigo-600 flex flex-col justify-between transition">
              <div>
                <input type="radio" name="service" value="BIR / TIN" required class="mb-2" onchange="toggleServiceForm()">
                <span class="font-bold block text-lg text-indigo-950">BIR / TIN</span>
                <span class="text-sm text-gray-500">Tax ID registration assistance. Fee: ₱${settings.fee_bir}</span>
              </div>
            </label>
            <label class="border-2 p-5 rounded-2xl cursor-pointer hover:border-indigo-600 flex flex-col justify-between transition">
              <div>
                <input type="radio" name="service" value="SSS" required class="mb-2" onchange="toggleServiceForm()">
                <span class="font-bold block text-lg text-indigo-950">SSS</span>
                <span class="text-sm text-gray-500">Social Security System registration. Fee: ₱${settings.fee_sss}</span>
              </div>
            </label>
            <label class="border-2 p-5 rounded-2xl cursor-pointer hover:border-indigo-600 flex flex-col justify-between transition">
              <div>
                <input type="radio" name="service" value="PAG-IBIG" required class="mb-2" onchange="toggleServiceForm()">
                <span class="font-bold block text-lg text-indigo-950">Pag-IBIG</span>
                <span class="text-sm text-gray-500">HDMF membership registration. Fee: ₱${settings.fee_pagibig}</span>
              </div>
            </label>
          </div>
        </div>

        <div class="space-y-4">
          <h2 class="text-xl font-bold text-indigo-900 border-b pb-2">Step 2: Personal Information</h2>
          <div class="grid md:grid-cols-3 gap-4">
            <div>
              <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">First Name *</label>
              <input type="text" name="first_name" required class="w-full border rounded-xl px-4 py-2.5 text-sm" placeholder="Juan">
            </div>
            <div>
              <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Middle Name</label>
              <input type="text" name="middle_name" class="w-full border rounded-xl px-4 py-2.5 text-sm" placeholder="Santos">
            </div>
            <div>
              <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Last Name *</label>
              <input type="text" name="last_name" required class="w-full border rounded-xl px-4 py-2.5 text-sm" placeholder="Dela Cruz">
            </div>
            <div>
              <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Suffix (Optional)</label>
              <input type="text" name="suffix" class="w-full border rounded-xl px-4 py-2.5 text-sm" placeholder="Jr., III">
            </div>
            <div>
              <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Date of Birth *</label>
              <input type="date" name="date_of_birth" required class="w-full border rounded-xl px-4 py-2.5 text-sm">
            </div>
            <div>
              <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Place of Birth *</label>
              <input type="text" name="place_of_birth" required class="w-full border rounded-xl px-4 py-2.5 text-sm" placeholder="Manila">
            </div>
            <div>
              <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Sex *</label>
              <select name="sex" required class="w-full border rounded-xl px-4 py-2.5 text-sm bg-white">
                <option value="Male">Male</option>
                <option value="Female">Female</option>
              </select>
            </div>
            <div>
              <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Civil Status *</label>
              <select name="civil_status" id="civilStatus" required class="w-full border rounded-xl px-4 py-2.5 text-sm bg-white" onchange="toggleMarriageSection()">
                <option value="Single">Single</option>
                <option value="Married">Married</option>
                <option value="Widowed">Widowed</option>
                <option value="Separated">Separated</option>
              </select>
            </div>
            <div>
              <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Nationality *</label>
              <input type="text" name="nationality" value="Filipino" required class="w-full border rounded-xl px-4 py-2.5 text-sm">
            </div>
          </div>
        </div>

        <div class="space-y-4">
          <h2 class="text-xl font-bold text-indigo-900 border-b pb-2">Step 3: Contact & Address Information</h2>
          <div class="grid md:grid-cols-2 gap-4">
            <div>
              <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Mobile Number *</label>
              <input type="text" name="mobile_number" value="${user.mobile_number || ''}" required class="w-full border rounded-xl px-4 py-2.5 text-sm" placeholder="09123456789">
            </div>
            <div>
              <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Email Address *</label>
              <input type="email" name="email_address" value="${user.email_address || ''}" required class="w-full border rounded-xl px-4 py-2.5 text-sm" placeholder="juan@example.com">
            </div>
          </div>
          <div class="grid md:grid-cols-3 gap-4">
            <div>
              <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">House/Unit & Street *</label>
              <input type="text" name="street" required class="w-full border rounded-xl px-4 py-2.5 text-sm" placeholder="123 Rizal Street">
            </div>
            <div>
              <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Barangay *</label>
              <input type="text" name="barangay" required class="w-full border rounded-xl px-4 py-2.5 text-sm" placeholder="San Antonio">
            </div>
            <div>
              <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">City / Municipality *</label>
              <input type="text" name="city" required class="w-full border rounded-xl px-4 py-2.5 text-sm" placeholder="Quezon City">
            </div>
            <div>
              <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Province *</label>
              <input type="text" name="province" required class="w-full border rounded-xl px-4 py-2.5 text-sm" placeholder="Metro Manila">
            </div>
            <div>
              <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">ZIP Code *</label>
              <input type="text" name="zip_code" required class="w-full border rounded-xl px-4 py-2.5 text-sm" placeholder="1100">
            </div>
          </div>
        </div>

        <div class="space-y-4">
          <h2 class="text-xl font-bold text-indigo-900 border-b pb-2">Step 4: Parents & Spouse Information</h2>
          <div class="grid md:grid-cols-2 gap-4">
            <div>
              <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Father's Full Name *</label>
              <input type="text" name="father_name" required class="w-full border rounded-xl px-4 py-2.5 text-sm" placeholder="Pedro Dela Cruz">
            </div>
            <div>
              <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Father's Date of Birth *</label>
              <input type="date" name="father_dob" required class="w-full border rounded-xl px-4 py-2.5 text-sm">
            </div>
            <div>
              <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Mother's Maiden Full Name *</label>
              <input type="text" name="mother_maiden_name" required class="w-full border rounded-xl px-4 py-2.5 text-sm" placeholder="Maria Santos">
            </div>
            <div>
              <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Mother's Date of Birth *</label>
              <input type="date" name="mother_dob" required class="w-full border rounded-xl px-4 py-2.5 text-sm">
            </div>
          </div>

          <div id="marriageSection" class="hidden p-5 bg-indigo-50 border border-indigo-200 rounded-xl space-y-4 mt-4">
            <h3 class="font-bold text-indigo-900">Spouse Details (Required for Married applicants)</h3>
            <div class="grid md:grid-cols-2 gap-4">
              <div>
                <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Spouse Full Name</label>
                <input type="text" name="spouse_name" class="w-full border rounded-xl px-4 py-2.5 text-sm bg-white">
              </div>
              <div>
                <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Spouse Date of Birth</label>
                <input type="date" name="spouse_dob" class="w-full border rounded-xl px-4 py-2.5 text-sm bg-white">
              </div>
              <div>
                <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Marriage Date</label>
                <input type="date" name="marriage_date" class="w-full border rounded-xl px-4 py-2.5 text-sm bg-white">
              </div>
              <div>
                <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Marriage Certificate Upload (Required if Married)</label>
                <input type="file" name="marriage_certificate" accept="image/*,application/pdf" class="w-full border rounded-xl px-3 py-2 bg-white text-sm">
              </div>
            </div>
          </div>
        </div>

        <div class="space-y-4">
          <h2 class="text-xl font-bold text-indigo-900 border-b pb-2">Step 5: Employment Information</h2>
          <div class="grid md:grid-cols-2 gap-4">
            <div>
              <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Employment Status *</label>
              <select name="employment_status" required class="w-full border rounded-xl px-4 py-2.5 text-sm bg-white">
                <option value="Employed">Employed</option>
                <option value="Self-Employed">Self-Employed</option>
                <option value="Unemployed">Unemployed</option>
                <option value="OFW">OFW</option>
              </select>
            </div>
            <div>
              <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Occupation / Profession</label>
              <input type="text" name="occupation" class="w-full border rounded-xl px-4 py-2.5 text-sm" placeholder="Software Engineer">
            </div>
            <div>
              <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Employer Name (If Employed)</label>
              <input type="text" name="employer_name" class="w-full border rounded-xl px-4 py-2.5 text-sm" placeholder="ABC Corp">
            </div>
            <div>
              <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Employer Address</label>
              <input type="text" name="employer_address" class="w-full border rounded-xl px-4 py-2.5 text-sm" placeholder="Makati City">
            </div>
          </div>
        </div>

        <div class="space-y-4">
          <h2 class="text-xl font-bold text-indigo-900 border-b pb-2">Step 6: Beneficiaries (For SSS & Pag-IBIG)</h2>
          <div id="beneficiariesList" class="space-y-4">
            <div class="beneficiary-item border p-4 rounded-xl bg-gray-50 space-y-3">
              <h4 class="font-bold text-xs text-indigo-900 uppercase">Beneficiary 1</h4>
              <div class="grid md:grid-cols-3 gap-3">
                <div>
                  <label class="block text-xs font-semibold mb-1">Full Name</label>
                  <input type="text" name="ben_name[]" class="w-full border rounded-xl px-3 py-2 bg-white text-sm" placeholder="Full Name">
                </div>
                <div>
                  <label class="block text-xs font-semibold mb-1">Date of Birth</label>
                  <input type="date" name="ben_dob[]" class="w-full border rounded-xl px-3 py-2 bg-white text-sm">
                </div>
                <div>
                  <label class="block text-xs font-semibold mb-1">Relationship</label>
                  <input type="text" name="ben_relationship[]" class="w-full border rounded-xl px-3 py-2 bg-white text-sm" placeholder="Spouse / Child">
                </div>
                <div class="md:col-span-2">
                  <label class="block text-xs font-semibold mb-1">Address</label>
                  <input type="text" name="ben_address[]" class="w-full border rounded-xl px-3 py-2 bg-white text-sm" placeholder="Address">
                </div>
                <div>
                  <label class="block text-xs font-semibold mb-1">Contact Number</label>
                  <input type="text" name="ben_contact[]" class="w-full border rounded-xl px-3 py-2 bg-white text-sm" placeholder="Contact #">
                </div>
              </div>
            </div>
          </div>
          <button type="button" onclick="addBeneficiary()" class="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-sm font-semibold shadow transition">+ Add Beneficiary</button>
        </div>

        <div class="space-y-4">
          <h2 class="text-xl font-bold text-indigo-900 border-b pb-2">Step 7: Required Valid ID & Selfie Uploads</h2>
          <div class="grid md:grid-cols-2 gap-4">
            <div>
              <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Valid ID Type *</label>
              <select name="id_type" required class="w-full border rounded-xl px-4 py-2.5 text-sm bg-white">
                <option value="National ID">National ID</option>
                <option value="Passport">Passport</option>
                <option value="Driver's License">Driver's License</option>
                <option value="UMID">UMID</option>
                <option value="Postal ID">Postal ID</option>
              </select>
            </div>
            <div>
              <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">ID Picture / Selfie *</label>
              <input type="file" name="id_picture" accept="image/*" capture="user" required class="w-full border rounded-xl px-3 py-2 bg-white text-sm">
              <span class="text-xs text-gray-500">Clear selfie or portrait photo.</span>
            </div>
            <div>
              <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Front of Valid ID *</label>
              <input type="file" name="id_front" accept="image/*,application/pdf" capture="environment" required class="w-full border rounded-xl px-3 py-2 bg-white text-sm">
            </div>
            <div>
              <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Back of Valid ID</label>
              <input type="file" name="id_back" accept="image/*,application/pdf" capture="environment" class="w-full border rounded-xl px-3 py-2 bg-white text-sm">
            </div>
            <div class="md:col-span-2">
              <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Photo Holding Valid ID *</label>
              <input type="file" name="photo_holding_id" accept="image/*" capture="user" required class="w-full border rounded-xl px-3 py-2 bg-white text-sm">
              <span class="text-xs text-gray-500">Hold your valid ID next to your face clearly.</span>
            </div>
          </div>
        </div>

        <button type="submit" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold py-4 rounded-xl shadow-xl text-lg transition">Submit Application</button>
      </form>

      <script>
        function toggleMarriageSection() {
          const status = document.getElementById('civilStatus').value;
          const section = document.getElementById('marriageSection');
          if (status === 'Married') {
            section.classList.remove('hidden');
          } else {
            section.classList.add('hidden');
          }
        }
        let benCount = 1;
        function addBeneficiary() {
          benCount++;
          const list = document.getElementById('beneficiariesList');
          const div = document.createElement('div');
          div.className = 'beneficiary-item border p-4 rounded-xl bg-gray-50 space-y-3';
          div.innerHTML = \`
            <div class="flex justify-between items-center"><h4 class="font-bold text-xs text-indigo-900 uppercase">Beneficiary \${benCount}</h4><button type="button" onclick="this.parentElement.parentElement.remove()" class="text-red-600 text-xs font-bold">Remove</button></div>
            <div class="grid md:grid-cols-3 gap-3">
              <div><label class="block text-xs font-semibold mb-1">Full Name</label><input type="text" name="ben_name[]" class="w-full border rounded-xl px-3 py-2 bg-white text-sm"></div>
              <div><label class="block text-xs font-semibold mb-1">Date of Birth</label><input type="date" name="ben_dob[]" class="w-full border rounded-xl px-3 py-2 bg-white text-sm"></div>
              <div><label class="block text-xs font-semibold mb-1">Relationship</label><input type="text" name="ben_relationship[]" class="w-full border rounded-xl px-3 py-2 bg-white text-sm"></div>
              <div class="md:col-span-2"><label class="block text-xs font-semibold mb-1">Address</label><input type="text" name="ben_address[]" class="w-full border rounded-xl px-3 py-2 bg-white text-sm"></div>
              <div><label class="block text-xs font-semibold mb-1">Contact Number</label><input type="text" name="ben_contact[]" class="w-full border rounded-xl px-3 py-2 bg-white text-sm"></div>
            </div>
          \`;
          list.appendChild(div);
        }
      </script>
    `;
    res.send(customerLayout('New Application', content, 'apply', 0, req.session));
  });
});

// Handle Application Submission with Multer fields
const cpUpload = upload.fields([
  { name: 'marriage_certificate', maxCount: 1 },
  { name: 'id_picture', maxCount: 1 },
  { name: 'id_front', maxCount: 1 },
  { name: 'id_back', maxCount: 1 },
  { name: 'photo_holding_id', maxCount: 1 }
]);

app.post('/customer/apply', requireCustomer, cpUpload, (req, res) => {
  const customerId = req.session.customer.id;
  const { service, first_name, middle_name, last_name, suffix } = req.body;
  const fullName = `${first_name} ${middle_name ? middle_name + ' ' : ''}${last_name}${suffix ? ' ' + suffix : ''}`;
  const trackingNumber = service.substring(0, 3).toUpperCase() + '-' + Date.now().toString().slice(-8);

  const dataJson = JSON.stringify(req.body);

  db.run(`INSERT INTO applications (customer_id, service, tracking_number, data_json) VALUES (?, ?, ?, ?)`,
    [customerId, service, trackingNumber, dataJson], function(err) {
      if (err) {
        return res.send(`<script>alert('Error submitting application!'); window.history.back();</script>`);
      }
      const appId = this.lastID;
      logStatusHistory(appId, 'Submitted', 'Application submitted by customer.');
      addNotification(customerId, 'Application Submitted', `Your ${service} application tracking #${trackingNumber} has been received.`);

      // Save uploaded files
      if (req.files) {
        for (const [fieldname, files] of Object.entries(req.files)) {
          if (files && files[0]) {
            const f = files[0];
            db.run(`INSERT INTO documents (application_id, doc_type, file_path, file_name) VALUES (?, ?, ?, ?)`,
              [appId, fieldname, '/uploads/' + f.filename, f.originalname]);
          }
        }
      }

      // Save beneficiaries if any
      const benNames = req.body.ben_name || [];
      const benDobs = req.body.ben_dob || [];
      const benRels = req.body.ben_relationship || [];
      const benAddrs = req.body.ben_address || [];
      const benContacts = req.body.ben_contact || [];

      for (let i = 0; i < benNames.length; i++) {
        if (benNames[i]) {
          db.run(`INSERT INTO beneficiaries (application_id, full_name, birth_date, relationship, address, contact_number) VALUES (?, ?, ?, ?, ?, ?)`,
            [appId, benNames[i], benDobs[i], benRels[i], benAddrs[i], benContacts[i]]);
        }
      }

      res.redirect('/customer/applications');
    });
});

// Feature 3: My Applications List
app.get('/customer/applications', requireCustomer, (req, res) => {
  const customerId = req.session.customer.id;
  db.all(`SELECT * FROM applications WHERE customer_id = ? ORDER BY id DESC`, [customerId], (err, apps) => {
    const content = `
      <h1 class="text-3xl font-extrabold text-indigo-900 mb-6">My Applications</h1>
      <div class="bg-white p-6 rounded-2xl shadow-xl border border-indigo-50">
        ${apps.length === 0 ? `<p class="text-gray-500">No applications found.</p>` : `
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse">
              <thead>
                <tr class="border-b bg-gray-50 text-xs text-gray-600 uppercase">
                  <th class="p-3">Tracking #</th>
                  <th class="p-3">Service</th>
                  <th class="p-3">Status</th>
                  <th class="p-3">Payment</th>
                  <th class="p-3">Date</th>
                  <th class="p-3">Action</th>
                </tr>
              </thead>
              <tbody class="text-sm">
                ${apps.map(app => `
                  <tr class="border-b hover:bg-gray-50">
                    <td class="p-3 font-mono font-bold text-indigo-900">${app.tracking_number}</td>
                    <td class="p-3">${app.service}</td>
                    <td class="p-3"><span class="px-2.5 py-1 bg-indigo-100 text-indigo-800 rounded-full text-xs font-bold">${app.status}</span></td>
                    <td class="p-3"><span class="px-2.5 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-bold">${app.payment_status}</span></td>
                    <td class="p-3 text-xs text-gray-500">${app.created_at}</td>
                    <td class="p-3 space-x-2">
                      <a href="/customer/track/${app.id}" class="text-indigo-600 font-semibold hover:underline">View</a>
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

// Feature 4: Application Details & Tracking View
app.get('/customer/track/:id', requireCustomer, (req, res) => {
  const appId = req.params.id;
  const customerId = req.session.customer.id;
  db.get(`SELECT * FROM applications WHERE id = ? AND customer_id = ?`, [appId, customerId], (err, app) => {
    if (!app) return res.redirect('/customer/applications');

    db.all(`SELECT * FROM documents WHERE application_id = ?`, [appId], (err2, docs) => {
      db.all(`SELECT * FROM beneficiaries WHERE application_id = ?`, [appId], (err3, bens) => {
        db.all(`SELECT * FROM status_history WHERE application_id = ? ORDER BY id DESC`, [appId], (err4, histories) => {
          db.all(`SELECT * FROM completed_files WHERE application_id = ?`, [appId], (err5, completedFiles) => {
            let formData = {};
            try { formData = JSON.parse(app.data_json || '{}'); } catch (e) {}

            const content = `
              <div class="flex justify-between items-center mb-6">
                <div>
                  <span class="text-xs text-indigo-600 font-bold uppercase">Application Details</span>
                  <h1 class="text-3xl font-extrabold text-indigo-900 font-mono">${app.tracking_number}</h1>
                </div>
                <a href="/customer/applications" class="bg-gray-200 hover:bg-gray-300 px-4 py-2 rounded-xl text-sm font-semibold">&larr; Back</a>
              </div>

              <div class="grid md:grid-cols-3 gap-6 mb-8">
                <div class="bg-white p-6 rounded-2xl shadow-xl border border-indigo-50 md:col-span-2 space-y-4">
                  <div class="flex justify-between border-b pb-3">
                    <span class="font-bold text-indigo-900">Service: ${app.service}</span>
                    <span class="px-3 py-1 bg-indigo-100 text-indigo-800 rounded-full text-xs font-bold">${app.status}</span>
                  </div>
                  <div class="grid md:grid-cols-2 gap-4 text-sm">
                    <p><strong>Full Name:</strong> ${formData.first_name || ''} ${formData.middle_name || ''} ${formData.last_name || ''}</p>
                    <p><strong>DOB:</strong> ${formData.date_of_birth || ''}</p>
                    <p><strong>Mobile:</strong> ${formData.mobile_number || ''}</p>
                    <p><strong>Email:</strong> ${formData.email_address || ''}</p>
                    <p><strong>Address:</strong> ${formData.street || ''}, ${formData.barangay || ''}, ${formData.city || ''}, ${formData.province || ''}</p>
                    <p><strong>Employment:</strong> ${formData.employment_status || ''} (${formData.occupation || 'N/A'})</p>
                  </div>
                  ${app.admin_remarks ? `<div class="bg-indigo-50 p-4 rounded-xl text-indigo-900 text-sm"><strong>Admin Remarks:</strong> ${app.admin_remarks}</div>` : ''}
                </div>

                <div class="bg-white p-6 rounded-2xl shadow-xl border border-indigo-50 space-y-4">
                  <h3 class="font-bold text-indigo-900 border-b pb-2">Payment Status</h3>
                  <p class="text-sm">Status: <span class="font-bold text-amber-600">${app.payment_status}</span></p>
                  ${app.payment_status === 'Payment Pending' ? `
                    <a href="/customer/payments" class="block text-center bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 rounded-xl text-sm font-semibold shadow">Upload Proof of Payment</a>
                  ` : ''}
                </div>
              </div>

              ${bens.length > 0 ? `
                <div class="bg-white p-6 rounded-2xl shadow-xl mb-8 border border-indigo-50">
                  <h3 class="font-bold text-indigo-900 mb-4">Beneficiaries (${bens.length})</h3>
                  <div class="grid md:grid-cols-2 gap-4">
                    ${bens.map((b, i) => `
                      <div class="border p-4 rounded-xl bg-gray-50 text-sm">
                        <p class="font-bold text-indigo-900">${i+1}. ${b.full_name}</p>
                        <p class="text-gray-600 text-xs">Relationship: ${b.relationship} | DOB: ${b.birth_date}</p>
                      </div>
                    `).join('')}
                  </div>
                </div>
              ` : ''}

              <div class="bg-white p-6 rounded-2xl shadow-xl mb-8 border border-indigo-50">
                <h3 class="font-bold text-indigo-900 mb-4">Completed Government Files (Uploaded by Admin)</h3>
                ${completedFiles.length === 0 ? `<p class="text-gray-500 text-sm">No completed files uploaded by admin yet. Once processed, your TIN ID / SSS stub will appear here.</p>` : `
                  <div class="grid md:grid-cols-2 gap-4">
                    ${completedFiles.map(cf => `
                      <div class="border p-4 rounded-xl bg-emerald-50 border-emerald-200 flex justify-between items-center">
                        <div>
                          <p class="font-bold text-emerald-900">${cf.file_name}</p>
                          <p class="text-xs text-emerald-700">${cf.description || 'Approved document'}</p>
                        </div>
                        <a href="${cf.file_path}" target="_blank" class="bg-emerald-600 text-white px-4 py-2 rounded-xl text-xs font-bold shadow">Download / View</a>
                      </div>
                    `).join('')}
                  </div>
                `}
              </div>

              <div class="bg-white p-6 rounded-2xl shadow-xl mb-8 border border-indigo-50">
                <h3 class="font-bold text-indigo-900 mb-4">Your Uploaded Files</h3>
                <div class="grid md:grid-cols-3 gap-4">
                  ${docs.map(doc => `
                    <div class="border p-3 rounded-xl bg-gray-50 text-center">
                      <p class="font-bold text-xs uppercase text-indigo-900 mb-2">${doc.doc_type}</p>
                      <a href="${doc.file_path}" target="_blank" class="text-indigo-600 hover:underline text-sm font-semibold">${doc.file_name}</a>
                    </div>
                  `).join('')}
                </div>
              </div>

              <div class="bg-white p-6 rounded-2xl shadow-xl border border-indigo-50">
                <h3 class="font-bold text-indigo-900 mb-4">Status Timeline</h3>
                <div class="space-y-3">
                  ${histories.map(h => `
                    <div class="flex items-start space-x-3 text-sm bg-gray-50 p-3 rounded-xl border">
                      <span class="font-bold text-indigo-700">${h.status}</span>
                      <span class="text-gray-600 flex-1">${h.notes || ''}</span>
                      <span class="text-xs text-gray-400">${h.created_at}</span>
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
});

// Feature 5: Payments & GCash Upload Page
app.get('/customer/payments', requireCustomer, async (req, res) => {
  const customerId = req.session.customer.id;
  const settings = res.locals.settings;
  db.all(`SELECT * FROM applications WHERE customer_id = ? ORDER BY id DESC`, [customerId], (err, apps) => {
    db.all(`SELECT * FROM payments WHERE customer_id = ? ORDER BY id DESC`, [customerId], (err2, payments) => {
      const content = `
        <h1 class="text-3xl font-extrabold text-indigo-900 mb-6">Payments & GCash Upload</h1>
        
        <div class="grid md:grid-cols-2 gap-8 mb-8">
          <div class="bg-white p-6 rounded-2xl shadow-xl border border-indigo-50 space-y-4">
            <h2 class="text-xl font-bold text-indigo-900 border-b pb-2">GCash Payment Instructions</h2>
            <div class="bg-indigo-50 p-4 rounded-xl text-sm space-y-2">
              <p><strong>GCash Name:</strong> ${settings.gcash_name}</p>
              <p><strong>GCash Number:</strong> ${settings.gcash_number}</p>
              ${settings.gcash_qr ? `<div class="mt-3"><img src="${settings.gcash_qr}" class="w-48 h-48 object-contain mx-auto bg-white p-2 rounded-xl border"/></div>` : ''}
            </div>
            <div class="text-xs text-gray-600 whitespace-pre-line bg-gray-50 p-4 rounded-xl border">${settings.payment_instructions}</div>
          </div>

          <div class="bg-white p-6 rounded-2xl shadow-xl border border-indigo-50">
            <h2 class="text-xl font-bold text-indigo-900 border-b pb-2 mb-4">Submit Payment Proof</h2>
            <form action="/customer/payments" method="POST" enctype="multipart/form-data" class="space-y-4">
              <div>
                <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Select Application *</label>
                <select name="application_id" required class="w-full border rounded-xl px-4 py-2.5 text-sm bg-white">
                  ${apps.map(a => `<option value="${a.id}">${a.tracking_number} - ${a.service}</option>`).join('')}
                </select>
              </div>
              <div>
                <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Payment Method *</label>
                <select name="payment_method" required class="w-full border rounded-xl px-4 py-2.5 text-sm bg-white">
                  <option value="GCash">GCash</option>
                  <option value="Maya">Maya</option>
                  <option value="Bank Transfer">Bank Transfer</option>
                  <option value="Palawan / Cebuana">Palawan / Cebuana</option>
                </select>
              </div>
              <div>
                <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Amount Paid (₱) *</label>
                <input type="number" step="0.01" name="amount" required class="w-full border rounded-xl px-4 py-2.5 text-sm" placeholder="500">
              </div>
              <div>
                <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Reference Number *</label>
                <input type="text" name="reference_number" required class="w-full border rounded-xl px-4 py-2.5 text-sm" placeholder="1234567890123">
              </div>
              <div>
                <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Upload Receipt / Screenshot *</label>
                <input type="file" name="proof_path" accept="image/*,application/pdf" required class="w-full border rounded-xl px-3 py-2 bg-white text-sm">
              </div>
              <button type="submit" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl shadow transition">Submit Payment for Verification</button>
            </form>
          </div>
        </div>

        <div class="bg-white p-6 rounded-2xl shadow-xl border border-indigo-50">
          <h2 class="text-xl font-bold text-indigo-900 mb-4">Payment History</h2>
          ${payments.length === 0 ? `<p class="text-gray-500 text-sm">No payment records found.</p>` : `
            <div class="overflow-x-auto">
              <table class="w-full text-left border-collapse">
                <thead>
                  <tr class="border-b bg-gray-50 text-xs text-gray-600 uppercase">
                    <th class="p-3">Tracking #</th>
                    <th class="p-3">Method</th>
                    <th class="p-3">Amount</th>
                    <th class="p-3">Reference #</th>
                    <th class="p-3">Status</th>
                    <th class="p-3">Proof</th>
                  </tr>
                </thead>
                <tbody class="text-sm">
                  ${payments.map(p => `
                    <tr class="border-b hover:bg-gray-50">
                      <td class="p-3 font-mono font-bold text-indigo-900">${p.tracking_number}</td>
                      <td class="p-3">${p.payment_method}</td>
                      <td class="p-3 font-bold">₱${p.amount}</td>
                      <td class="p-3 font-mono">${p.reference_number}</td>
                      <td class="p-3"><span class="px-2.5 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-bold">${p.payment_status}</span></td>
                      <td class="p-3"><a href="${p.proof_path}" target="_blank" class="text-indigo-600 hover:underline font-semibold">View Receipt</a></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>
      `;
      res.send(customerLayout('Payments', content, 'payments', 0, req.session));
    });
  });
});

app.post('/customer/payments', requireCustomer, upload.single('proof_path'), (req, res) => {
  const customerId = req.session.customer.id;
  const { application_id, payment_method, amount, reference_number } = req.body;
  const proofPath = req.file ? '/uploads/' + req.file.filename : '';

  db.get(`SELECT * FROM applications WHERE id = ?`, [application_id], (err, app) => {
    if (!app) return res.send(`<script>alert('Application not found!'); window.history.back();</script>`);

    db.run(`INSERT INTO payments (customer_id, application_id, tracking_number, service, payment_method, amount, reference_number, proof_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [customerId, application_id, app.tracking_number, app.service, payment_method, amount, reference_number, proofPath], function() {
        db.run(`UPDATE applications SET payment_status = 'Pending Verification' WHERE id = ?`, [application_id]);
        addNotification(customerId, 'Payment Submitted', `Payment for ${app.tracking_number} submitted and awaiting admin verification.`);
        res.redirect('/customer/payments');
      });
  });
});

// Feature 6: Completed Files Archive for Customer
app.get('/customer/documents', requireCustomer, (req, res) => {
  const customerId = req.session.customer.id;
  db.all(`SELECT cf.*, a.tracking_number, a.service FROM completed_files cf JOIN applications a ON cf.application_id = a.id WHERE a.customer_id = ? ORDER BY cf.id DESC`, [customerId], (err, files) => {
    const content = `
      <h1 class="text-3xl font-extrabold text-indigo-900 mb-6">Completed Government Documents</h1>
      <div class="bg-white p-6 rounded-2xl shadow-xl border border-indigo-50">
        ${files.length === 0 ? `<p class="text-gray-500 text-sm">No completed files ready for download yet.</p>` : `
          <div class="grid md:grid-cols-2 gap-4">
            ${files.map(f => `
              <div class="border p-5 rounded-2xl bg-emerald-50 border-emerald-200 flex justify-between items-center shadow">
                <div>
                  <span class="text-xs text-emerald-800 font-bold uppercase block">${f.service} (${f.tracking_number})</span>
                  <p class="font-bold text-emerald-950 text-base mt-1">${f.file_name}</p>
                  <p class="text-xs text-emerald-700 mt-1">${f.description || 'Official completed document'}</p>
                </div>
                <a href="${f.file_path}" target="_blank" class="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl text-xs font-bold shadow transition">Download</a>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    `;
    res.send(customerLayout('Completed Documents', content, 'documents', 0, req.session));
  });
});

// Feature 7: Notifications Center
app.get('/customer/notifications', requireCustomer, (req, res) => {
  const customerId = req.session.customer.id;
  db.all(`SELECT * FROM notifications WHERE customer_id = ? ORDER BY id DESC`, [customerId], (err, notifs) => {
    db.run(`UPDATE notifications SET is_read = 1 WHERE customer_id = ?`, [customerId]);
    const content = `
      <h1 class="text-3xl font-extrabold text-indigo-900 mb-6">Notifications</h1>
      <div class="bg-white p-6 rounded-2xl shadow-xl border border-indigo-50 space-y-4">
        ${notifs.length === 0 ? `<p class="text-gray-500 text-sm">No notifications found.</p>` : `
          <div class="space-y-3">
            ${notifs.map(n => `
              <div class="border p-4 rounded-xl ${n.is_read ? 'bg-white' : 'bg-indigo-50 border-indigo-200'}">
                <div class="flex justify-between items-center mb-1">
                  <h4 class="font-bold text-indigo-900 text-sm">${n.title}</h4>
                  <span class="text-xs text-gray-400">${n.created_at}</span>
                </div>
                <p class="text-sm text-gray-700">${n.message}</p>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    `;
    res.send(customerLayout('Notifications', content, 'notifications', 0, req.session));
  });
});

// Feature 8: Live Support Chat Widget
app.get('/customer/support', requireCustomer, (req, res) => {
  const customerId = req.session.customer.id;
  db.all(`SELECT * FROM support_messages WHERE customer_id = ? ORDER BY id ASC`, [customerId], (err, msgs) => {
    const content = `
      <h1 class="text-3xl font-extrabold text-indigo-900 mb-6">Live Support Chat</h1>
      <div class="bg-white p-6 rounded-2xl shadow-xl border border-indigo-50 flex flex-col h-[600px] justify-between">
        <div class="overflow-y-auto space-y-4 pr-2 flex-1 mb-4" id="chatContainer">
          ${msgs.length === 0 ? `<p class="text-gray-400 text-center text-sm my-auto">No messages yet. Send a message to our admin support team below.</p>` : `
            ${msgs.map(m => `
              <div class="flex ${m.sender === 'customer' ? 'justify-end' : 'justify-start'}">
                <div class="max-w-md p-4 rounded-2xl text-sm ${m.sender === 'customer' ? 'bg-indigo-600 text-white rounded-br-none shadow' : 'bg-gray-100 text-gray-800 rounded-bl-none border'}">
                  <p>${m.message}</p>
                  <span class="text-[10px] ${m.sender === 'customer' ? 'text-indigo-200' : 'text-gray-400'} block mt-1 text-right">${m.created_at}</span>
                </div>
              </div>
            `).join('')}
          `}
        </div>
        <form action="/customer/support" method="POST" class="flex gap-2">
          <input type="text" name="message" required placeholder="Type your message or inquiry here..." class="flex-1 border rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-indigo-500">
          <button type="submit" class="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-xl font-bold text-sm shadow transition">Send</button>
        </form>
      </div>
      <script>
        const chat = document.getElementById('chatContainer');
        chat.scrollTop = chat.scrollHeight;
      </script>
    `;
    res.send(customerLayout('Live Support', content, 'support', 0, req.session));
  });
});

app.post('/customer/support', requireCustomer, (req, res) => {
  const customerId = req.session.customer.id;
  const { message } = req.body;
  db.run(`INSERT INTO support_messages (customer_id, sender, message) VALUES (?, 'customer', ?)`, [customerId, message], () => {
    res.redirect('/customer/support');
  });
});

// Feature 9: Profile Settings & Password Change
app.get('/customer/profile', requireCustomer, (req, res) => {
  const customerId = req.session.customer.id;
  db.get(`SELECT * FROM users WHERE id = ?`, [customerId], (err, user) => {
    const content = `
      <h1 class="text-3xl font-extrabold text-indigo-900 mb-6">Profile Settings</h1>
      <div class="grid md:grid-cols-2 gap-8">
        <div class="bg-white p-6 rounded-2xl shadow-xl border border-indigo-50">
          <h2 class="text-xl font-bold text-indigo-900 border-b pb-2 mb-4">Personal Information</h2>
          <form action="/customer/profile" method="POST" class="space-y-4">
            <div>
              <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Full Name</label>
              <input type="text" name="full_name" value="${user.full_name}" required class="w-full border rounded-xl px-4 py-2.5 text-sm">
            </div>
            <div>
              <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Mobile Number</label>
              <input type="text" name="mobile_number" value="${user.mobile_number || ''}" required class="w-full border rounded-xl px-4 py-2.5 text-sm">
            </div>
            <div>
              <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Email Address</label>
              <input type="email" name="email_address" value="${user.email_address || ''}" required class="w-full border rounded-xl px-4 py-2.5 text-sm">
            </div>
            <button type="submit" class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-6 py-2.5 rounded-xl text-sm shadow transition">Update Profile</button>
          </form>
        </div>

        <div class="bg-white p-6 rounded-2xl shadow-xl border border-indigo-50">
          <h2 class="text-xl font-bold text-indigo-900 border-b pb-2 mb-4">Change Password</h2>
          <form action="/customer/password" method="POST" class="space-y-4">
            <div>
              <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Current Password</label>
              <input type="password" name="current_password" required class="w-full border rounded-xl px-4 py-2.5 text-sm">
            </div>
            <div>
              <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">New Password</label>
              <input type="password" name="new_password" required class="w-full border rounded-xl px-4 py-2.5 text-sm">
            </div>
            <button type="submit" class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-6 py-2.5 rounded-xl text-sm shadow transition">Change Password</button>
          </form>
        </div>
      </div>
    `;
    res.send(customerLayout('Profile', content, 'profile', 0, req.session));
  });
});

app.post('/customer/profile', requireCustomer, (req, res) => {
  const customerId = req.session.customer.id;
  const { full_name, mobile_number, email_address } = req.body;
  db.run(`UPDATE users SET full_name = ?, mobile_number = ?, email_address = ? WHERE id = ?`,
    [full_name, mobile_number, email_address, customerId], () => {
      req.session.customer.full_name = full_name;
      res.send(`<script>alert('Profile updated successfully!'); window.location='/customer/profile';</script>`);
    });
});

app.post('/customer/password', requireCustomer, (req, res) => {
  const customerId = req.session.customer.id;
  const { current_password, new_password } = req.body;
  db.get(`SELECT * FROM users WHERE id = ?`, [customerId], async (err, user) => {
    if (user && await bcrypt.compare(current_password, user.password)) {
      const hashed = await bcrypt.hash(new_password, 10);
      db.run(`UPDATE users SET password = ? WHERE id = ?`, [hashed], () => {
        res.send(`<script>alert('Password changed successfully!'); window.location='/customer/profile';</script>`);
      });
    } else {
      res.send(`<script>alert('Incorrect current password!'); window.history.back();</script>`);
    }
  });
});

// ==========================================
// ADMIN PORTAL & ADVANCED FEATURES (15+ FEATURES)
// ==========================================
function adminLayout(title, content, activeTab) {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title} - Admin GovAssist PH</title>
      <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
    </head>
    <body class="bg-gray-100 text-gray-800 font-sans">
      <div class="min-h-screen flex flex-col md:flex-row">
        <aside class="bg-gray-900 text-white w-full md:w-64 p-6 flex flex-col justify-between shadow-2xl">
          <div>
            <div class="text-xl font-extrabold mb-1 tracking-tight">Admin Portal</div>
            <span class="text-xs text-indigo-400 block mb-6 pb-4 border-b border-gray-800">GovAssist by ${CREATOR_NAME}</span>
            <nav class="space-y-1.5 text-sm">
              <a href="/admin/dashboard" class="block px-4 py-2.5 rounded-xl transition ${activeTab === 'dashboard' ? 'bg-indigo-600 font-bold shadow' : 'hover:bg-gray-800'}">📊 Admin Dashboard</a>
              <a href="/admin/applications" class="block px-4 py-2.5 rounded-xl transition ${activeTab === 'applications' ? 'bg-indigo-600 font-bold shadow' : 'hover:bg-gray-800'}">📁 Manage Applications</a>
              <a href="/admin/payments" class="block px-4 py-2.5 rounded-xl transition ${activeTab === 'payments' ? 'bg-indigo-600 font-bold shadow' : 'hover:bg-gray-800'}">💳 Verify Payments</a>
              <a href="/admin/customers" class="block px-4 py-2.5 rounded-xl transition ${activeTab === 'customers' ? 'bg-indigo-600 font-bold shadow' : 'hover:bg-gray-800'}">👥 Customers List</a>
              <a href="/admin/support" class="block px-4 py-2.5 rounded-xl transition ${activeTab === 'support' ? 'bg-indigo-600 font-bold shadow' : 'hover:bg-gray-800'}">💬 Support Chats</a>
              <a href="/admin/settings" class="block px-4 py-2.5 rounded-xl transition ${activeTab === 'settings' ? 'bg-indigo-600 font-bold shadow' : 'hover:bg-gray-800'}">⚙️ System Settings & Fees</a>
              <a href="/admin/backup" class="block px-4 py-2.5 rounded-xl transition ${activeTab === 'backup' ? 'bg-indigo-600 font-bold shadow' : 'hover:bg-gray-800'}">💾 Backup Database</a>
            </nav>
          </div>
          <div class="mt-8 pt-4 border-t border-gray-800">
            <a href="/admin/logout" class="block text-center bg-red-600 hover:bg-red-700 text-white py-2.5 rounded-xl text-sm font-semibold shadow transition">Logout Admin</a>
          </div>
        </aside>
        
        <main class="flex-1 p-6 md:p-10 overflow-y-auto">
          ${content}
        </main>
      </div>
    </body>
    </html>
  `;
}

// Admin Feature 1: Dashboard Analytics
app.get('/admin/dashboard', requireAdmin, (req, res) => {
  db.all(`SELECT * FROM applications`, [], (err, apps) => {
    db.all(`SELECT * FROM payments`, [], (err2, payments) => {
      db.all(`SELECT * FROM users`, [], (err3, users) => {
        const totalRevenue = payments.filter(p => p.payment_status === 'Verified').reduce((sum, p) => sum + p.amount, 0);
        const pendingPayments = payments.filter(p => p.payment_status === 'Pending Verification').length;
        const completedApps = apps.filter(a => a.status === 'Completed').length;

        const content = `
          <h1 class="text-3xl font-extrabold text-gray-900 mb-6">Admin Analytics Dashboard</h1>
          <span class="text-xs text-indigo-600 block mb-4 font-bold">System Creator: ${CREATOR_NAME}</span>

          <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <div class="bg-white p-6 rounded-2xl shadow-xl border-l-4 border-indigo-600">
              <h3 class="text-gray-500 text-xs font-semibold uppercase">Total Customers</h3>
              <p class="text-3xl font-extrabold text-gray-900 mt-2">${users.length}</p>
            </div>
            <div class="bg-white p-6 rounded-2xl shadow-xl border-l-4 border-blue-600">
              <h3 class="text-gray-500 text-xs font-semibold uppercase">Total Applications</h3>
              <p class="text-3xl font-extrabold text-gray-900 mt-2">${apps.length}</p>
            </div>
            <div class="bg-white p-6 rounded-2xl shadow-xl border-l-4 border-emerald-600">
              <h3 class="text-gray-500 text-xs font-semibold uppercase">Total Verified Revenue</h3>
              <p class="text-3xl font-extrabold text-emerald-600 mt-2">₱${totalRevenue.toLocaleString()}</p>
            </div>
            <div class="bg-white p-6 rounded-2xl shadow-xl border-l-4 border-amber-500">
              <h3 class="text-gray-500 text-xs font-semibold uppercase">Pending Payments</h3>
              <p class="text-3xl font-extrabold text-amber-600 mt-2">${pendingPayments}</p>
            </div>
          </div>

          <div class="bg-white p-6 rounded-2xl shadow-xl border border-gray-100">
            <h2 class="text-xl font-bold text-gray-900 mb-4">Recent Applications</h2>
            <div class="overflow-x-auto">
              <table class="w-full text-left border-collapse">
                <thead>
                  <tr class="border-b bg-gray-50 text-xs text-gray-600 uppercase">
                    <th class="p-3">Tracking #</th>
                    <th class="p-3">Service</th>
                    <th class="p-3">Status</th>
                    <th class="p-3">Payment</th>
                    <th class="p-3">Action</th>
                  </tr>
                </thead>
                <tbody class="text-sm">
                  ${apps.slice(0, 5).map(a => `
                    <tr class="border-b hover:bg-gray-50">
                      <td class="p-3 font-mono font-bold text-indigo-900">${a.tracking_number}</td>
                      <td class="p-3">${a.service}</td>
                      <td class="p-3"><span class="px-2.5 py-1 bg-indigo-100 text-indigo-800 rounded-full text-xs font-bold">${a.status}</span></td>
                      <td class="p-3"><span class="px-2.5 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-bold">${a.payment_status}</span></td>
                      <td class="p-3"><a href="/admin/applications/${a.id}" class="text-indigo-600 font-semibold hover:underline">Manage</a></td>
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

// Admin Feature 2: Manage All Applications
app.get('/admin/applications', requireAdmin, (req, res) => {
  db.all(`SELECT a.*, u.full_name, u.email_address FROM applications a JOIN users u ON a.customer_id = u.id ORDER BY a.id DESC`, [], (err, apps) => {
    const content = `
      <h1 class="text-3xl font-extrabold text-gray-900 mb-6">Manage All Applications</h1>
      <div class="bg-white p-6 rounded-2xl shadow-xl border border-gray-100">
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="border-b bg-gray-50 text-xs text-gray-600 uppercase">
                <th class="p-3">Tracking #</th>
                <th class="p-3">Customer</th>
                <th class="p-3">Service</th>
                <th class="p-3">Status</th>
                <th class="p-3">Payment</th>
                <th class="p-3">Action</th>
              </tr>
            </thead>
            <tbody class="text-sm">
              ${apps.map(a => `
                <tr class="border-b hover:bg-gray-50">
                  <td class="p-3 font-mono font-bold text-indigo-900">${a.tracking_number}</td>
                  <td class="p-3">${a.full_name}</td>
                  <td class="p-3">${a.service}</td>
                  <td class="p-3"><span class="px-2.5 py-1 bg-indigo-100 text-indigo-800 rounded-full text-xs font-bold">${a.status}</span></td>
                  <td class="p-3"><span class="px-2.5 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-bold">${a.payment_status}</span></td>
                  <td class="p-3"><a href="/admin/applications/${a.id}" class="bg-indigo-600 text-white px-3 py-1.5 rounded-xl text-xs font-bold shadow">Review</a></td>
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

// Admin Feature 3: Review Single Application & Upload Completed Government Files
app.get('/admin/applications/:id', requireAdmin, (req, res) => {
  const appId = req.params.id;
  db.get(`SELECT a.*, u.full_name, u.mobile_number, u.email_address FROM applications a JOIN users u ON a.customer_id = u.id WHERE a.id = ?`, [appId], (err, app) => {
    if (!app) return res.redirect('/admin/applications');

    db.all(`SELECT * FROM documents WHERE application_id = ?`, [appId], (err2, docs) => {
      db.all(`SELECT * FROM beneficiaries WHERE application_id = ?`, [appId], (err3, bens) => {
        db.all(`SELECT * FROM completed_files WHERE application_id = ?`, [appId], (err4, completedFiles) => {
          let formData = {};
          try { formData = JSON.parse(app.data_json || '{}'); } catch(e){}

          const content = `
            <div class="flex justify-between items-center mb-6">
              <div>
                <span class="text-xs text-indigo-600 font-bold uppercase">Admin Review</span>
                <h1 class="text-3xl font-extrabold text-gray-900 font-mono">${app.tracking_number}</h1>
              </div>
              <a href="/admin/applications" class="bg-gray-200 px-4 py-2 rounded-xl text-sm font-semibold">&larr; Back</a>
            </div>

            <div class="grid md:grid-cols-2 gap-8 mb-8">
              <div class="bg-white p-6 rounded-2xl shadow-xl border border-gray-100 space-y-4">
                <h2 class="text-xl font-bold text-gray-900 border-b pb-2">Customer & Application Data</h2>
                <div class="grid grid-cols-2 gap-3 text-sm">
                  <p><strong>Service:</strong> ${app.service}</p>
                  <p><strong>Customer:</strong> ${app.full_name}</p>
                  <p><strong>Mobile:</strong> ${app.mobile_number}</p>
                  <p><strong>Email:</strong> ${app.email_address}</p>
                  <p><strong>DOB:</strong> ${formData.date_of_birth || ''}</p>
                  <p><strong>Civil Status:</strong> ${formData.civil_status || ''}</p>
                  <p class="col-span-2"><strong>Address:</strong> ${formData.street || ''}, ${formData.barangay || ''}, ${formData.city || ''}, ${formData.province || ''}</p>
                  <p><strong>Father:</strong> ${formData.father_name || ''}</p>
                  <p><strong>Mother:</strong> ${formData.mother_maiden_name || ''}</p>
                </div>

                <h3 class="font-bold text-gray-900 mt-4 border-t pt-2">Uploaded Requirements</h3>
                <div class="grid grid-cols-2 gap-2">
                  ${docs.map(d => `<a href="${d.file_path}" target="_blank" class="text-indigo-600 hover:underline text-xs font-semibold p-2 bg-gray-50 rounded border">${d.doc_type}: ${d.file_name}</a>`).join('')}
                </div>
              </div>

              <div class="bg-white p-6 rounded-2xl shadow-xl border border-gray-100 space-y-6">
                <h2 class="text-xl font-bold text-gray-900 border-b pb-2">Update Application Status</h2>
                <form action="/admin/applications/${app.id}/status" method="POST" class="space-y-4">
                  <div>
                    <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Status</label>
                    <select name="status" class="w-full border rounded-xl px-4 py-2.5 text-sm bg-white">
                      <option value="Submitted" ${app.status === 'Submitted' ? 'selected' : ''}>Submitted</option>
                      <option value="Under Review" ${app.status === 'Under Review' ? 'selected' : ''}>Under Review</option>
                      <option value="Processing with Government" ${app.status === 'Processing with Government' ? 'selected' : ''}>Processing with Government</option>
                      <option value="Completed" ${app.status === 'Completed' ? 'selected' : ''}>Completed</option>
                      <option value="Rejected" ${app.status === 'Rejected' ? 'selected' : ''}>Rejected</option>
                    </select>
                  </div>
                  <div>
                    <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Admin Remarks / Notes</label>
                    <textarea name="admin_remarks" rows="3" class="w-full border rounded-xl p-3 text-sm">${app.admin_remarks || ''}</textarea>
                  </div>
                  <button type="submit" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl shadow transition">Save Status & Remarks</button>
                </form>

                <div class="border-t pt-4">
                  <h3 class="font-bold text-gray-900 mb-3">Upload Completed Government Files (TIN ID, SSS card, etc.)</h3>
                  <form action="/admin/applications/${app.id}/complete-file" method="POST" enctype="multipart/form-data" class="space-y-3">
                    <div>
                      <input type="file" name="completed_file" required class="w-full border rounded-xl p-2 bg-white text-xs">
                    </div>
                    <div>
                      <input type="text" name="description" placeholder="Description (e.g. Official BIR TIN ID PDF)" required class="w-full border rounded-xl px-4 py-2 text-sm">
                    </div>
                    <button type="submit" class="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-xl text-xs shadow transition">Upload File to Customer</button>
                  </form>
                </div>
              </div>
            </div>

            <div class="bg-white p-6 rounded-2xl shadow-xl border border-gray-100">
              <h3 class="font-bold text-gray-900 mb-4">Already Uploaded Completed Files (${completedFiles.length})</h3>
              <div class="grid md:grid-cols-3 gap-4">
                ${completedFiles.map(cf => `
                  <div class="border p-4 rounded-xl bg-emerald-50 border-emerald-200 flex justify-between items-center">
                    <div>
                      <p class="font-bold text-emerald-900 text-sm">${cf.file_name}</p>
                      <p class="text-xs text-emerald-700">${cf.description}</p>
                    </div>
                    <a href="${cf.file_path}" target="_blank" class="bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold">View</a>
                  </div>
                `).join('')}
              </div>
            </div>
          `;
          res.send(adminLayout('Review Application', content, 'applications'));
        });
      });
    });
  });
});

app.post('/admin/applications/:id/status', requireAdmin, (req, res) => {
  const appId = req.params.id;
  const { status, admin_remarks } = req.body;
  db.get(`SELECT * FROM applications WHERE id = ?`, [appId], (err, app) => {
    db.run(`UPDATE applications SET status = ?, admin_remarks = ? WHERE id = ?`, [status, admin_remarks, appId], () => {
      logStatusHistory(appId, status, admin_remarks);
      addNotification(app.customer_id, 'Application Status Update', `Your application #${app.tracking_number} status is now: ${status}.`);
      res.redirect(`/admin/applications/${appId}`);
    });
  });
});

app.post('/admin/applications/:id/complete-file', requireAdmin, upload.single('completed_file'), (req, res) => {
  const appId = req.params.id;
  const { description } = req.body;
  const filePath = req.file ? '/uploads/' + req.file.filename : '';
  const fileName = req.file ? req.file.originalname : 'Document';

  db.get(`SELECT * FROM applications WHERE id = ?`, [appId], (err, app) => {
    db.run(`INSERT INTO completed_files (application_id, file_path, file_name, file_type, description) VALUES (?, ?, ?, ?, ?)`,
      [appId, filePath, fileName, req.file ? req.file.mimetype : '', description], () => {
        addNotification(app.customer_id, 'Completed File Ready', `Admin uploaded your completed document for #${app.tracking_number}.`);
        res.redirect(`/admin/applications/${appId}`);
      });
  });
});

// Admin Feature 4: Verify Payments
app.get('/admin/payments', requireAdmin, (req, res) => {
  db.all(`SELECT p.*, u.full_name FROM payments p JOIN users u ON p.customer_id = u.id ORDER BY p.id DESC`, [], (err, payments) => {
    const content = `
      <h1 class="text-3xl font-extrabold text-gray-900 mb-6">Verify Payments</h1>
      <div class="bg-white p-6 rounded-2xl shadow-xl border border-gray-100">
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="border-b bg-gray-50 text-xs text-gray-600 uppercase">
                <th class="p-3">Tracking #</th>
                <th class="p-3">Customer</th>
                <th class="p-3">Method</th>
                <th class="p-3">Amount</th>
                <th class="p-3">Reference #</th>
                <th class="p-3">Receipt</th>
                <th class="p-3">Status</th>
                <th class="p-3">Action</th>
              </tr>
            </thead>
            <tbody class="text-sm">
              ${payments.map(p => `
                <tr class="border-b hover:bg-gray-50">
                  <td class="p-3 font-mono font-bold text-indigo-900">${p.tracking_number}</td>
                  <td class="p-3">${p.full_name}</td>
                  <td class="p-3">${p.payment_method}</td>
                  <td class="p-3 font-bold">₱${p.amount}</td>
                  <td class="p-3 font-mono">${p.reference_number}</td>
                  <td class="p-3"><a href="${p.proof_path}" target="_blank" class="text-indigo-600 hover:underline font-semibold">View Receipt</a></td>
                  <td class="p-3"><span class="px-2.5 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-bold">${p.payment_status}</span></td>
                  <td class="p-3 space-x-2">
                    <a href="/admin/payments/${p.id}/verify" class="bg-emerald-600 text-white px-3 py-1.5 rounded-xl text-xs font-bold shadow">Verify</a>
                    <a href="/admin/payments/${p.id}/reject" class="bg-red-600 text-white px-3 py-1.5 rounded-xl text-xs font-bold shadow">Reject</a>
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

app.get('/admin/payments/:id/verify', requireAdmin, (req, res) => {
  const payId = req.params.id;
  db.get(`SELECT * FROM payments WHERE id = ?`, [payId], (err, p) => {
    db.run(`UPDATE payments SET payment_status = 'Verified' WHERE id = ?`, [payId], () => {
      db.run(`UPDATE applications SET payment_status = 'Paid & Verified' WHERE id = ?`, [p.application_id]);
      addNotification(p.customer_id, 'Payment Verified', `Your payment for #${p.tracking_number} has been verified successfully!`);
      res.redirect('/admin/payments');
    });
  });
});

app.get('/admin/payments/:id/reject', requireAdmin, (req, res) => {
  const payId = req.params.id;
  db.get(`SELECT * FROM payments WHERE id = ?`, [payId], (err, p) => {
    db.run(`UPDATE payments SET payment_status = 'Rejected' WHERE id = ?`, [payId], () => {
      db.run(`UPDATE applications SET payment_status = 'Payment Rejected' WHERE id = ?`, [p.application_id]);
      addNotification(p.customer_id, 'Payment Rejected', `Your payment proof for #${p.tracking_number} was rejected. Please re-upload.`);
      res.redirect('/admin/payments');
    });
  });
});

// Admin Feature 5: Customers List
app.get('/admin/customers', requireAdmin, (req, res) => {
  db.all(`SELECT * FROM users ORDER BY id DESC`, [], (err, users) => {
    const content = `
      <h1 class="text-3xl font-extrabold text-gray-900 mb-6">Registered Customers</h1>
      <div class="bg-white p-6 rounded-2xl shadow-xl border border-gray-100">
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="border-b bg-gray-50 text-xs text-gray-600 uppercase">
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
                <tr class="border-b hover:bg-gray-50">
                  <td class="p-3 font-mono">${u.id}</td>
                  <td class="p-3 font-bold">${u.full_name}</td>
                  <td class="p-3">${u.username}</td>
                  <td class="p-3">${u.mobile_number || ''}</td>
                  <td class="p-3">${u.email_address || ''}</td>
                  <td class="p-3 text-xs text-gray-500">${u.created_at}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
    res.send(adminLayout('Customers', content, 'customers'));
  });
});

// Admin Feature 6: Support Chats
app.get('/admin/support', requireAdmin, (req, res) => {
  db.all(`SELECT sm.*, u.full_name FROM support_messages sm JOIN users u ON sm.customer_id = u.id ORDER BY sm.id DESC`, [], (err, msgs) => {
    const content = `
      <h1 class="text-3xl font-extrabold text-gray-900 mb-6">Customer Support Inquiries</h1>
      <div class="bg-white p-6 rounded-2xl shadow-xl border border-gray-100 space-y-4">
        ${msgs.map(m => `
          <div class="border p-4 rounded-xl bg-gray-50 flex justify-between items-center">
            <div>
              <span class="text-xs font-bold text-indigo-700">${m.full_name} (${m.sender})</span>
              <p class="text-sm text-gray-800 mt-1">${m.message}</p>
              <span class="text-[10px] text-gray-400 block mt-1">${m.created_at}</span>
            </div>
          </div>
        `).join('')}
      </div>
    `;
    res.send(adminLayout('Support Chats', content, 'support'));
  });
});

// Admin Feature 7: System Settings & Service Fees Editor
app.get('/admin/settings', requireAdmin, async (req, res) => {
  const settings = await getSettings();
  const content = `
    <h1 class="text-3xl font-extrabold text-gray-900 mb-6">System Settings & Service Fees</h1>
    <span class="text-xs text-indigo-600 block mb-4 font-bold">System Creator: ${CREATOR_NAME}</span>
    <form action="/admin/settings" method="POST" class="bg-white p-8 rounded-2xl shadow-xl border border-gray-100 space-y-6">
      <div class="grid md:grid-cols-2 gap-6">
        <div>
          <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Business Name</label>
          <input type="text" name="business_name" value="${settings.business_name}" required class="w-full border rounded-xl px-4 py-2.5 text-sm">
        </div>
        <div>
          <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Contact Number</label>
          <input type="text" name="contact_number" value="${settings.contact_number}" required class="w-full border rounded-xl px-4 py-2.5 text-sm">
        </div>
        <div>
          <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Support Email</label>
          <input type="email" name="email" value="${settings.email}" required class="w-full border rounded-xl px-4 py-2.5 text-sm">
        </div>
        <div>
          <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">GCash Name</label>
          <input type="text" name="gcash_name" value="${settings.gcash_name}" required class="w-full border rounded-xl px-4 py-2.5 text-sm">
        </div>
        <div>
          <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">GCash Number</label>
          <input type="text" name="gcash_number" value="${settings.gcash_number}" required class="w-full border rounded-xl px-4 py-2.5 text-sm">
        </div>
        <div>
          <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">GCash QR Image URL</label>
          <input type="text" name="gcash_qr" value="${settings.gcash_qr || ''}" class="w-full border rounded-xl px-4 py-2.5 text-sm">
        </div>
        <div>
          <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">BIR / TIN Fee (₱)</label>
          <input type="number" name="fee_bir" value="${settings.fee_bir}" required class="w-full border rounded-xl px-4 py-2.5 text-sm">
        </div>
        <div>
          <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">SSS Fee (₱)</label>
          <input type="number" name="fee_sss" value="${settings.fee_sss}" required class="w-full border rounded-xl px-4 py-2.5 text-sm">
        </div>
        <div>
          <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Pag-IBIG Fee (₱)</label>
          <input type="number" name="fee_pagibig" value="${settings.fee_pagibig}" required class="w-full border rounded-xl px-4 py-2.5 text-sm">
        </div>
      </div>
      <div>
        <label class="block text-xs font-semibold mb-1 uppercase text-gray-600">Payment Instructions</label>
        <textarea name="payment_instructions" rows="4" class="w-full border rounded-xl p-3 text-sm">${settings.payment_instructions}</textarea>
      </div>
      <button type="submit" class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-8 py-3 rounded-xl shadow transition">Save Settings</button>
    </form>
  `;
  res.send(adminLayout('Settings', content, 'settings'));
});

app.post('/admin/settings', requireAdmin, async (req, res) => {
  for (const [key, value] of Object.entries(req.body)) {
    db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [key, value]);
  }
  res.send(`<script>alert('Settings updated successfully!'); window.location='/admin/settings';</script>`);
});

// Admin Feature 8: Database Backup Export
app.get('/admin/backup', requireAdmin, (req, res) => {
  db.all(`SELECT a.*, u.full_name FROM applications a JOIN users u ON a.customer_id = u.id`, [], (err, apps) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=govassist_backup_2026.json');
    res.send(JSON.stringify({ creator: CREATOR_NAME, date: new Date(), applications: apps }, null, 2));
  });
});

// Start Server
app.listen(PORT, () => {
  console.log(`GovAssist PH system running on port ${PORT}. Created by ${CREATOR_NAME}.`);
});
