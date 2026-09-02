/**
 * BIR / TIN, SSS & Pag-IBIG Application Assistance System
 * Developed by: Mark Jerald Agdigos
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

// Database Setup (SQLite for permanent persistence - data will not disappear)
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

    // Settings (Including GCash QR Code and Developer Info)
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
        gcash_name: 'Mark Jerald Agdigos (GovAssist Admin)',
        gcash_number: '09123456789',
        fee_bir: '500',
        fee_sss: '400',
        fee_pagibig: '400',
        payment_instructions: '1. Scan GCash QR Code or send payment to the number provided.\n2. Enter GCash Reference Number and upload clear proof of payment.\n3. Wait for admin verification within 24 hours.'
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

    // Documents (Uploaded by customer)
    db.run(`CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id INTEGER,
      doc_type TEXT,
      file_path TEXT,
      file_name TEXT,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Completed Files (Uploaded by Admin for Customer download)
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

    // Notifications
    db.run(`CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER,
      title TEXT,
      message TEXT,
      is_read INTEGER DEFAULT 0,
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
  secret: process.env.SESSION_SECRET || 'mark_jerald_agdigos_govassist_secret_2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 7 days session persistence
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

// Helper for notifications
function addNotification(customerId, title, message) {
  db.run(`INSERT INTO notifications (customer_id, title, message) VALUES (?, ?, ?)`, [customerId, title, message]);
}

// Global View Variables Middleware
app.use(async (req, res, next) => {
  try {
    res.locals.settings = await getSettings();
    res.locals.customer = req.session.customer || null;
    res.locals.admin = req.session.admin || null;
    next();
  } catch (e) {
    next();
  }
});

// ==========================================
// LANDING & PUBLIC PORTAL (WITH LANGUAGE SELECTOR)
// ==========================================
app.get('/', async (req, res) => {
  const settings = res.locals.settings;
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${settings.business_name}</title>
      <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
      <script>
        function changeLang(lang) {
          if(lang === 'fil') {
            document.getElementById('hero-title').innerText = 'Mabilis at Walang Hassle na Tulong sa Government Applications';
            document.getElementById('hero-desc').innerText = 'Tinutulungan ka namin sa iyong BIR/TIN, SSS, at Pag-IBIG registrations at aplikasyon nang ligtas, mabilis, at propesyonal.';
            document.getElementById('btn-get-started').innerText = 'Magsimula Na';
            document.getElementById('btn-track').innerText = 'I-track ang Aplikasyon';
          } else {
            document.getElementById('hero-title').innerText = 'Fast & Hassle-Free Government Application Assistance';
            document.getElementById('hero-desc').innerText = 'We assist you with your BIR/TIN, SSS, and Pag-IBIG registrations and applications securely, quickly, and professionally.';
            document.getElementById('btn-get-started').innerText = 'Get Started Now';
            document.getElementById('btn-track').innerText = 'Track Application';
          }
        }
      </script>
    </head>
    <body class="bg-gray-50 text-gray-800 font-sans">
      <header class="bg-blue-900 text-white shadow-md">
        <div class="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <div class="flex items-center space-x-3">
            ${settings.logo_url ? `<img src="${settings.logo_url}" class="h-10 w-10 object-contain bg-white rounded p-1"/>` : ''}
            <div>
              <span class="text-xl font-bold block">${settings.business_name}</span>
              <span class="text-xs text-blue-200">Created by: ${settings.developer_name}</span>
            </div>
          </div>
          <div class="flex items-center space-x-4">
            <select onchange="changeLang(this.value)" class="bg-blue-800 text-white text-xs px-2 py-1 rounded border border-blue-700">
              <option value="en">English</option>
              <option value="fil">Tagalog / Filipino</option>
            </select>
            <a href="/customer/login" class="px-4 py-2 bg-blue-700 hover:bg-blue-600 rounded text-sm font-semibold">Customer Login</a>
            <a href="/customer/register" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded text-sm font-semibold">Register</a>
          </div>
        </div>
      </header>

      <main class="max-w-7xl mx-auto px-4 py-12">
        <div class="text-center max-w-3xl mx-auto mb-12">
          <h1 id="hero-title" class="text-4xl font-extrabold text-blue-900 mb-4">Fast & Hassle-Free Government Application Assistance</h1>
          <p id="hero-desc" class="text-lg text-gray-600 mb-8">We assist you with your BIR/TIN, SSS, and Pag-IBIG registrations and applications securely, quickly, and professionally.</p>
          <div class="flex justify-center gap-4">
            <a id="btn-get-started" href="/customer/register" class="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow">Get Started Now</a>
            <a id="btn-track" href="/track-public" class="px-6 py-3 bg-white border border-gray-300 hover:bg-gray-100 text-blue-900 font-bold rounded-lg shadow">Track Application</a>
          </div>
        </div>

        <div class="grid md:grid-cols-3 gap-8 mb-12">
          <div class="bg-white p-6 rounded-xl shadow border border-gray-100 text-center">
            <div class="text-3xl mb-3">🏢</div>
            <h3 class="text-xl font-bold text-blue-900 mb-2">BIR / TIN</h3>
            <p class="text-gray-600 text-sm">Tax Identification Number registration assistance for employed, self-employed, and mixed-income earners.</p>
          </div>
          <div class="bg-white p-6 rounded-xl shadow border border-gray-100 text-center">
            <div class="text-3xl mb-3">🛡️</div>
            <h3 class="text-xl font-bold text-blue-900 mb-2">SSS Registration</h3>
            <p class="text-gray-600 text-sm">Social Security System membership number application, beneficiary listing, and digital profile support.</p>
          </div>
          <div class="bg-white p-6 rounded-xl shadow border border-gray-100 text-center">
            <div class="text-3xl mb-3">🏠</div>
            <h3 class="text-xl font-bold text-blue-900 mb-2">Pag-IBIG Fund</h3>
            <p class="text-gray-600 text-sm">HDMF MID number application assistance, membership registration, and contribution record support.</p>
          </div>
        </div>

        <div class="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-r-lg text-amber-900 text-xs md:text-sm">
          <strong>Government Disclaimer:</strong> ${settings.business_name} is an application assistance, document collection, processing, payment, and tracking platform created by <strong>${settings.developer_name}</strong>. It is not the official website of BIR, SSS, or Pag-IBIG.
        </div>
      </main>

      <footer class="bg-gray-900 text-gray-400 py-6 text-center text-sm">
        <p>&copy; 2026 ${settings.business_name} | Developer: ${settings.developer_name}. All rights reserved.</p>
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
      if (app) {
        searchResultHtml = `
          <div class="bg-white p-6 rounded-xl shadow mt-6 space-y-3 border-l-4 border-emerald-600">
            <h3 class="font-bold text-lg text-blue-900">Application Found</h3>
            <p><strong>Tracking Number:</strong> <span class="font-mono">${app.tracking_number}</span></p>
            <p><strong>Applicant Name:</strong> ${app.full_name}</p>
            <p><strong>Service:</strong> ${app.service}</p>
            <p><strong>Status:</strong> <span class="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs font-bold">${app.status}</span></p>
            <p><strong>Payment Status:</strong> <span class="px-2 py-1 bg-amber-100 text-amber-800 rounded text-xs font-bold">${app.payment_status}</span></p>
            ${app.admin_remarks ? `<p><strong>Admin Remarks:</strong> ${app.admin_remarks}</p>` : ''}
          </div>
        `;
      } else {
        searchResultHtml = `
          <div class="bg-red-50 p-4 rounded-xl shadow mt-6 text-red-700 text-sm">
            No application found with tracking number: <strong>${trackingNumber}</strong>
          </div>
        `;
      }
      renderTrackPage(res, trackingNumber, searchResultHtml);
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
      <title>Track Application</title>
      <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
    </head>
    <body class="bg-gray-50 text-gray-800 font-sans">
      <div class="max-w-xl mx-auto px-4 py-12">
        <div class="text-center mb-8">
          <h1 class="text-3xl font-bold text-blue-900">Track Your Application</h1>
          <p class="text-sm text-gray-600 mt-2">Enter your unique tracking number below to check real-time status.</p>
        </div>
        <form action="/track-public" method="GET" class="bg-white p-6 rounded-xl shadow space-y-4">
          <div>
            <label class="block text-sm font-semibold mb-1">Tracking Number</label>
            <input type="text" name="tracking_number" value="${trackingNumber}" required placeholder="e.g. TIN-20260901-0001" class="w-full border rounded px-3 py-2 uppercase font-mono">
          </div>
          <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded">Search Status</button>
        </form>
        ${resultHtml}
        <div class="text-center mt-6">
          <a href="/" class="text-blue-600 hover:underline text-sm">&larr; Back to Home</a>
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
      <title>Customer Registration</title>
      <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
    </head>
    <body class="bg-gray-100 flex items-center justify-center min-h-screen p-4">
      <div class="bg-white w-full max-w-md p-8 rounded-xl shadow-lg">
        <h2 class="text-2xl font-bold text-blue-900 mb-2 text-center">Customer Registration</h2>
        <p class="text-xs text-center text-gray-500 mb-6">Developer: Mark Jerald Agdigos</p>
        <form action="/customer/register" method="POST" class="space-y-4">
          <div>
            <label class="block text-sm font-medium mb-1">Full Name</label>
            <input type="text" name="full_name" required class="w-full border rounded px-3 py-2" placeholder="Juan Dela Cruz">
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">Username</label>
            <input type="text" name="username" required class="w-full border rounded px-3 py-2" placeholder="juandelacruz">
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">Mobile Number</label>
            <input type="text" name="mobile_number" required class="w-full border rounded px-3 py-2" placeholder="09123456789">
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">Email Address</label>
            <input type="email" name="email_address" required class="w-full border rounded px-3 py-2" placeholder="juan@example.com">
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">Password</label>
            <input type="password" name="password" required class="w-full border rounded px-3 py-2">
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">Confirm Password</label>
            <input type="password" name="confirm_password" required class="w-full border rounded px-3 py-2">
          </div>
          <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded">Register Account</button>
        </form>
        <p class="text-center text-sm mt-4 text-gray-600">Already have an account? <a href="/customer/login" class="text-blue-600 font-semibold hover:underline">Login here</a></p>
        <div class="text-center mt-2"><a href="/" class="text-gray-500 hover:underline text-xs">&larr; Back to home</a></div>
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
      <title>Customer Login</title>
      <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
    </head>
    <body class="bg-gray-100 flex items-center justify-center min-h-screen p-4">
      <div class="bg-white w-full max-w-md p-8 rounded-xl shadow-lg">
        <h2 class="text-2xl font-bold text-blue-900 mb-2 text-center">Customer Login</h2>
        <p class="text-xs text-center text-gray-500 mb-6">GovAssist PH by Mark Jerald Agdigos</p>
        <form action="/customer/login" method="POST" class="space-y-4">
          <div>
            <label class="block text-sm font-medium mb-1">Username</label>
            <input type="text" name="username" required class="w-full border rounded px-3 py-2">
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">Password</label>
            <input type="password" name="password" required class="w-full border rounded px-3 py-2">
          </div>
          <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded">Login</button>
        </form>
        <p class="text-center text-sm mt-4 text-gray-600">Don't have an account? <a href="/customer/register" class="text-blue-600 font-semibold hover:underline">Register here</a></p>
        <div class="text-center mt-2"><a href="/" class="text-gray-500 hover:underline text-xs">&larr; Back to home</a></div>
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
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Admin Login</title>
      <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
    </head>
    <body class="bg-gray-900 flex items-center justify-center min-h-screen p-4">
      <div class="bg-white w-full max-w-md p-8 rounded-xl shadow-lg">
        <h2 class="text-2xl font-bold text-gray-900 mb-2 text-center">Admin Portal Login</h2>
        <p class="text-xs text-center text-gray-500 mb-6">System created by: Mark Jerald Agdigos</p>
        <form action="/admin/login" method="POST" class="space-y-4">
          <div>
            <label class="block text-sm font-medium mb-1">Admin Username</label>
            <input type="text" name="username" required class="w-full border rounded px-3 py-2">
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">Password</label>
            <input type="password" name="password" required class="w-full border rounded px-3 py-2">
          </div>
          <button type="submit" class="w-full bg-gray-900 hover:bg-gray-800 text-white font-bold py-2 rounded">Login to Admin</button>
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

// ==========================================
// MIDDLEWARES & LAYOUTS
// ==========================================
function requireCustomer(req, res, next) {
  if (!req.session.customer) return res.redirect('/customer/login');
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.admin) return res.redirect('/admin/login');
  next();
}

function customerLayout(title, content, activeTab, unreadCount = 0, reqSession = null) {
  const customerName = reqSession && reqSession.customer ? reqSession.customer.full_name : '';
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title}</title>
      <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
    </head>
    <body class="bg-gray-100 text-gray-800 font-sans">
      <div class="min-h-screen flex flex-col md:flex-row">
        <aside class="bg-blue-900 text-white w-full md:w-64 p-6 flex flex-col justify-between">
          <div>
            <div class="text-xl font-extrabold mb-2">GovAssist PH</div>
            <div class="text-xs text-blue-300 mb-8">By Mark Jerald Agdigos</div>
            <nav class="space-y-2">
              <a href="/customer/dashboard" class="block px-4 py-2 rounded ${activeTab === 'dashboard' ? 'bg-blue-800 font-bold' : 'hover:bg-blue-800'}">Dashboard</a>
              <a href="/customer/apply" class="block px-4 py-2 rounded ${activeTab === 'apply' ? 'bg-blue-800 font-bold' : 'hover:bg-blue-800'}">+ New Application</a>
              <a href="/customer/applications" class="block px-4 py-2 rounded ${activeTab === 'applications' ? 'bg-blue-800 font-bold' : 'hover:bg-blue-800'}">My Applications</a>
              <a href="/customer/documents" class="block px-4 py-2 rounded ${activeTab === 'documents' ? 'bg-blue-800 font-bold' : 'hover:bg-blue-800'}">Completed Documents</a>
              <a href="/customer/notifications" class="block px-4 py-2 rounded ${activeTab === 'notifications' ? 'bg-blue-800 font-bold' : 'hover:bg-blue-800'}">Notifications ${unreadCount > 0 ? `<span class="bg-red-500 text-white px-2 py-0.5 rounded-full text-xs">${unreadCount}</span>` : ''}</a>
              <a href="/customer/profile" class="block px-4 py-2 rounded ${activeTab === 'profile' ? 'bg-blue-800 font-bold' : 'hover:bg-blue-800'}">Profile</a>
            </nav>
          </div>
          <div class="mt-8 pt-4 border-t border-blue-800">
            <span class="block text-sm text-blue-200 mb-2">Logged in as: <strong>${customerName}</strong></span>
            <a href="/customer/logout" class="block text-center bg-red-600 hover:bg-red-700 text-white py-2 rounded text-sm font-semibold">Logout</a>
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
    <body class="bg-gray-100 text-gray-800 font-sans">
      <div class="min-h-screen flex flex-col md:flex-row">
        <aside class="bg-gray-900 text-white w-full md:w-64 p-6 flex flex-col justify-between">
          <div>
            <div class="text-xl font-extrabold mb-1">Admin Portal</div>
            <div class="text-xs text-gray-400 mb-8">System by Mark Jerald Agdigos</div>
            <nav class="space-y-2">
              <a href="/admin/dashboard" class="block px-4 py-2 rounded ${activeTab === 'dashboard' ? 'bg-gray-800 font-bold' : 'hover:bg-gray-800'}">Dashboard</a>
              <a href="/admin/applications" class="block px-4 py-2 rounded ${activeTab === 'applications' ? 'bg-gray-800 font-bold' : 'hover:bg-gray-800'}">Manage Applications</a>
              <a href="/admin/payments" class="block px-4 py-2 rounded ${activeTab === 'payments' ? 'bg-gray-800 font-bold' : 'hover:bg-gray-800'}">Payment Verification</a>
              <a href="/admin/users" class="block px-4 py-2 rounded ${activeTab === 'users' ? 'bg-gray-800 font-bold' : 'hover:bg-gray-800'}">Customer Records</a>
              <a href="/admin/settings" class="block px-4 py-2 rounded ${activeTab === 'settings' ? 'bg-gray-800 font-bold' : 'hover:bg-gray-800'}">System Settings & GCash QR</a>
              <a href="/admin/backup" class="block px-4 py-2 rounded hover:bg-gray-800">Export Backup (JSON)</a>
            </nav>
          </div>
          <div class="mt-8 pt-4 border-t border-gray-800">
            <a href="/admin/logout" class="block text-center bg-red-600 hover:bg-red-700 text-white py-2 rounded text-sm font-semibold">Admin Logout</a>
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

// ==========================================
// CUSTOMER PORTAL ROUTES
// ==========================================
app.get('/customer/dashboard', requireCustomer, async (req, res) => {
  const customerId = req.session.customer.id;
  db.all(`SELECT * FROM applications WHERE customer_id = ? ORDER BY id DESC`, [customerId], (err, apps) => {
    db.all(`SELECT * FROM notifications WHERE customer_id = ? AND is_read = 0`, [customerId], (err2, notifs) => {
      const totalApps = apps.length;
      const pendingApps = apps.filter(a => a.status === 'Submitted' || a.status === 'Under Review').length;
      const completedApps = apps.filter(a => a.status === 'Completed').length;

      const content = `
        <h1 class="text-3xl font-bold text-blue-900 mb-2">Customer Dashboard</h1>
        <p class="text-xs text-gray-500 mb-6">Welcome back! All data is securely saved in your permanent database.</p>
        
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div class="bg-white p-6 rounded-xl shadow border-l-4 border-blue-600">
            <h3 class="text-gray-500 text-sm font-medium">Total Applications</h3>
            <p class="text-3xl font-bold text-blue-900 mt-2">${totalApps}</p>
          </div>
          <div class="bg-white p-6 rounded-xl shadow border-l-4 border-amber-500">
            <h3 class="text-gray-500 text-sm font-medium">Pending / In Progress</h3>
            <p class="text-3xl font-bold text-amber-600 mt-2">${pendingApps}</p>
          </div>
          <div class="bg-white p-6 rounded-xl shadow border-l-4 border-emerald-600">
            <h3 class="text-gray-500 text-sm font-medium">Completed</h3>
            <p class="text-3xl font-bold text-emerald-600 mt-2">${completedApps}</p>
          </div>
        </div>

        <div class="bg-white p-6 rounded-xl shadow mb-8">
          <div class="flex justify-between items-center mb-4">
            <h2 class="text-xl font-bold text-blue-900">Recent Applications</h2>
            <a href="/customer/apply" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm font-semibold">+ New Application</a>
          </div>
          ${apps.length === 0 ? `<p class="text-gray-500 text-sm">No applications submitted yet.</p>` : `
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
                      <td class="p-3 font-mono font-bold">${app.tracking_number}</td>
                      <td class="p-3">${app.service}</td>
                      <td class="p-3"><span class="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs">${app.status}</span></td>
                      <td class="p-3"><span class="px-2 py-1 bg-amber-100 text-amber-800 rounded text-xs">${app.payment_status}</span></td>
                      <td class="p-3"><a href="/customer/track/${app.id}" class="text-blue-600 font-semibold hover:underline">View Details</a></td>
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

// Comprehensive Application Wizard (Required Uploads + Beneficiaries + Marriage + Employment)
app.get('/customer/apply', requireCustomer, async (req, res) => {
  const settings = res.locals.settings;
  const content = `
    <h1 class="text-3xl font-bold text-blue-900 mb-2">New Government Application Form</h1>
    <p class="text-xs text-gray-500 mb-6">GovAssist PH Assistance System created by Mark Jerald Agdigos</p>

    <form action="/customer/apply" method="POST" enctype="multipart/form-data" class="bg-white p-8 rounded-xl shadow space-y-8" id="appForm">
      
      <div class="space-y-4">
        <h2 class="text-xl font-bold text-blue-900 border-b pb-2">Step 1: Select Government Service</h2>
        <div class="grid md:grid-cols-3 gap-4">
          <label class="border p-4 rounded-xl cursor-pointer hover:border-blue-600 flex flex-col justify-between">
            <div>
              <input type="radio" name="service" value="BIR / TIN" required class="mb-2">
              <span class="font-bold block text-lg">BIR / TIN</span>
              <span class="text-sm text-gray-500">Tax Identification Number Assistance. Fee: ₱${settings.fee_bir}</span>
            </div>
          </label>
          <label class="border p-4 rounded-xl cursor-pointer hover:border-blue-600 flex flex-col justify-between">
            <div>
              <input type="radio" name="service" value="SSS" required class="mb-2">
              <span class="font-bold block text-lg">SSS</span>
              <span class="text-sm text-gray-500">Social Security System Registration. Fee: ₱${settings.fee_sss}</span>
            </div>
          </label>
          <label class="border p-4 rounded-xl cursor-pointer hover:border-blue-600 flex flex-col justify-between">
            <div>
              <input type="radio" name="service" value="PAG-IBIG" required class="mb-2">
              <span class="font-bold block text-lg">Pag-IBIG</span>
              <span class="text-sm text-gray-500">HDMF Membership Assistance. Fee: ₱${settings.fee_pagibig}</span>
            </div>
          </label>
        </div>
      </div>

      <div class="space-y-4">
        <h2 class="text-xl font-bold text-blue-900 border-b pb-2">Step 2: Personal Information</h2>
        <div class="grid md:grid-cols-3 gap-4">
          <div>
            <label class="block text-sm font-semibold mb-1">First Name *</label>
            <input type="text" name="first_name" required class="w-full border rounded px-3 py-2" placeholder="Juan">
          </div>
          <div>
            <label class="block text-sm font-semibold mb-1">Middle Name</label>
            <input type="text" name="middle_name" class="w-full border rounded px-3 py-2" placeholder="Santos">
          </div>
          <div>
            <label class="block text-sm font-semibold mb-1">Last Name *</label>
            <input type="text" name="last_name" required class="w-full border rounded px-3 py-2" placeholder="Dela Cruz">
          </div>
          <div>
            <label class="block text-sm font-semibold mb-1">Suffix (Optional)</label>
            <input type="text" name="suffix" class="w-full border rounded px-3 py-2" placeholder="Jr., III">
          </div>
          <div>
            <label class="block text-sm font-semibold mb-1">Date of Birth *</label>
            <input type="date" name="date_of_birth" required class="w-full border rounded px-3 py-2">
          </div>
          <div>
            <label class="block text-sm font-semibold mb-1">Place of Birth *</label>
            <input type="text" name="place_of_birth" required class="w-full border rounded px-3 py-2" placeholder="Manila">
          </div>
          <div>
            <label class="block text-sm font-semibold mb-1">Sex *</label>
            <select name="sex" required class="w-full border rounded px-3 py-2">
              <option value="Male">Male</option>
              <option value="Female">Female</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-semibold mb-1">Civil Status *</label>
            <select name="civil_status" id="civilStatus" required class="w-full border rounded px-3 py-2" onchange="toggleMarriage()">
              <option value="Single">Single</option>
              <option value="Married">Married</option>
              <option value="Widowed">Widowed</option>
              <option value="Separated">Separated</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-semibold mb-1">Nationality *</label>
            <input type="text" name="nationality" value="Filipino" required class="w-full border rounded px-3 py-2">
          </div>
        </div>
      </div>

      <div class="space-y-4">
        <h2 class="text-xl font-bold text-blue-900 border-b pb-2">Step 3: Contact & Complete Address</h2>
        <div class="grid md:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-semibold mb-1">Mobile Number *</label>
            <input type="text" name="mobile_number" required class="w-full border rounded px-3 py-2" placeholder="09123456789">
          </div>
          <div>
            <label class="block text-sm font-semibold mb-1">Email Address *</label>
            <input type="email" name="email_address" required class="w-full border rounded px-3 py-2" placeholder="juan@example.com">
          </div>
        </div>
        <div class="grid md:grid-cols-3 gap-4">
          <div>
            <label class="block text-sm font-semibold mb-1">House/Unit No. & Street *</label>
            <input type="text" name="street" required class="w-full border rounded px-3 py-2" placeholder="123 Rizal St.">
          </div>
          <div>
            <label class="block text-sm font-semibold mb-1">Barangay *</label>
            <input type="text" name="barangay" required class="w-full border rounded px-3 py-2" placeholder="San Antonio">
          </div>
          <div>
            <label class="block text-sm font-semibold mb-1">City / Municipality *</label>
            <input type="text" name="city" required class="w-full border rounded px-3 py-2" placeholder="Manila">
          </div>
          <div>
            <label class="block text-sm font-semibold mb-1">Province *</label>
            <input type="text" name="province" required class="w-full border rounded px-3 py-2" placeholder="Metro Manila">
          </div>
          <div>
            <label class="block text-sm font-semibold mb-1">ZIP Code *</label>
            <input type="text" name="zip_code" required class="w-full border rounded px-3 py-2" placeholder="1000">
          </div>
        </div>
      </div>

      <div class="space-y-4">
        <h2 class="text-xl font-bold text-blue-900 border-b pb-2">Step 4: Parents & Spouse Details</h2>
        <div class="grid md:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-semibold mb-1">Father's Full Name *</label>
            <input type="text" name="father_name" required class="w-full border rounded px-3 py-2">
          </div>
          <div>
            <label class="block text-sm font-semibold mb-1">Father's Date of Birth *</label>
            <input type="date" name="father_dob" required class="w-full border rounded px-3 py-2">
          </div>
          <div>
            <label class="block text-sm font-semibold mb-1">Mother's Maiden Full Name *</label>
            <input type="text" name="mother_maiden_name" required class="w-full border rounded px-3 py-2">
          </div>
          <div>
            <label class="block text-sm font-semibold mb-1">Mother's Date of Birth *</label>
            <input type="date" name="mother_dob" required class="w-full border rounded px-3 py-2">
          </div>
        </div>

        <div id="marriageDiv" class="hidden p-4 bg-gray-50 border rounded-lg space-y-4">
          <h3 class="font-bold text-blue-900">Spouse Information (Required if Married)</h3>
          <div class="grid md:grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-semibold mb-1">Spouse Full Name</label>
              <input type="text" name="spouse_name" class="w-full border rounded px-3 py-2">
            </div>
            <div>
              <label class="block text-sm font-semibold mb-1">Spouse Date of Birth</label>
              <input type="date" name="spouse_dob" class="w-full border rounded px-3 py-2">
            </div>
          </div>
        </div>
      </div>

      <div class="space-y-4">
        <h2 class="text-xl font-bold text-blue-900 border-b pb-2">Step 5: Employment Information</h2>
        <div class="grid md:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-semibold mb-1">Employment Status *</label>
            <select name="employment_status" required class="w-full border rounded px-3 py-2">
              <option value="Employed">Employed</option>
              <option value="Self-Employed">Self-Employed</option>
              <option value="Unemployed">Unemployed</option>
              <option value="OFW">OFW</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-semibold mb-1">Occupation / Profession</label>
            <input type="text" name="occupation" class="w-full border rounded px-3 py-2">
          </div>
        </div>
      </div>

      <div class="space-y-4">
        <h2 class="text-xl font-bold text-blue-900 border-b pb-2">Step 6: Beneficiaries (For SSS & Pag-IBIG)</h2>
        <div id="beneficiariesList" class="space-y-4">
          <div class="border p-4 rounded-lg bg-gray-50 space-y-3">
            <h4 class="font-bold text-sm text-blue-900">Beneficiary 1</h4>
            <div class="grid md:grid-cols-3 gap-3">
              <div>
                <label class="block text-xs font-semibold mb-1">Full Name</label>
                <input type="text" name="ben_name[]" class="w-full border rounded px-3 py-2 bg-white" placeholder="Full Name">
              </div>
              <div>
                <label class="block text-xs font-semibold mb-1">Date of Birth</label>
                <input type="date" name="ben_dob[]" class="w-full border rounded px-3 py-2 bg-white">
              </div>
              <div>
                <label class="block text-xs font-semibold mb-1">Relationship</label>
                <input type="text" name="ben_relationship[]" class="w-full border rounded px-3 py-2 bg-white" placeholder="Spouse/Child">
              </div>
            </div>
          </div>
        </div>
        <button type="button" onclick="addBeneficiary()" class="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded text-sm font-semibold">+ Add Beneficiary</button>
      </div>

      <div class="space-y-4">
        <h2 class="text-xl font-bold text-blue-900 border-b pb-2">Step 7: Mandatory File Uploads</h2>
        <div class="grid md:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-semibold mb-1">Valid ID Type *</label>
            <select name="id_type" required class="w-full border rounded px-3 py-2">
              <option value="National ID">National ID</option>
              <option value="Passport">Passport</option>
              <option value="Driver's License">Driver's License</option>
              <option value="UMID">UMID</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-semibold mb-1">ID Picture / Selfie *</label>
            <input type="file" name="id_picture" accept="image/*" required class="w-full border rounded px-3 py-2 bg-white">
          </div>
          <div>
            <label class="block text-sm font-semibold mb-1">Valid ID (Front) *</label>
            <input type="file" name="id_front" accept="image/*,application/pdf" required class="w-full border rounded px-3 py-2 bg-white">
          </div>
          <div>
            <label class="block text-sm font-semibold mb-1">Valid ID (Back)</label>
            <input type="file" name="id_back" accept="image/*,application/pdf" class="w-full border rounded px-3 py-2 bg-white">
          </div>
          <div class="md:col-span-2">
            <label class="block text-sm font-semibold mb-1">Photo Holding Valid ID *</label>
            <input type="file" name="photo_holding_id" accept="image/*" required class="w-full border rounded px-3 py-2 bg-white">
          </div>
        </div>
      </div>

      <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl text-lg shadow-lg">Submit Application & Proceed to Payment</button>
    </form>

    <script>
      function toggleMarriage() {
        const val = document.getElementById('civilStatus').value;
        const div = document.getElementById('marriageDiv');
        if(val === 'Married') {
          div.classList.remove('hidden');
        } else {
          div.classList.add('hidden');
        }
      }
      function addBeneficiary() {
        const list = document.getElementById('beneficiariesList');
        const count = list.children.length + 1;
        const div = document.createElement('div');
        div.className = 'border p-4 rounded-lg bg-gray-50 space-y-3';
        div.innerHTML = \`
          <h4 class="font-bold text-sm text-blue-900">Beneficiary \${count}</h4>
          <div class="grid md:grid-cols-3 gap-3">
            <div>
              <label class="block text-xs font-semibold mb-1">Full Name</label>
              <input type="text" name="ben_name[]" class="w-full border rounded px-3 py-2 bg-white" placeholder="Full Name">
            </div>
            <div>
              <label class="block text-xs font-semibold mb-1">Date of Birth</label>
              <input type="date" name="ben_dob[]" class="w-full border rounded px-3 py-2 bg-white">
            </div>
            <div>
              <label class="block text-xs font-semibold mb-1">Relationship</label>
              <input type="text" name="ben_relationship[]" class="w-full border rounded px-3 py-2 bg-white" placeholder="Spouse/Child">
            </div>
          </div>
        \`;
        list.appendChild(div);
      }
    </script>
  `;
  res.send(customerLayout('New Application', content, 'apply', 0, req.session));
});

// Handle Application Submission
const uploadFields = upload.fields([
  { name: 'marriage_certificate', maxCount: 1 },
  { name: 'id_picture', maxCount: 1 },
  { name: 'id_front', maxCount: 1 },
  { name: 'id_back', maxCount: 1 },
  { name: 'photo_holding_id', maxCount: 1 }
]);

app.post('/customer/apply', requireCustomer, uploadFields, (req, res) => {
  const customerId = req.session.customer.id;
  const { service, ...formData } = req.body;
  const prefix = service === 'BIR / TIN' ? 'TIN' : service === 'SSS' ? 'SSS' : 'PAG';
  const trackingNumber = `${prefix}-${Date.now().toString().slice(-8)}`;

  db.run(`INSERT INTO applications (customer_id, service, tracking_number, status, payment_status, data_json) VALUES (?, ?, ?, 'Submitted', 'Payment Pending', ?)`,
    [customerId, service, trackingNumber, JSON.stringify(formData)], function(err) {
      if (err) {
        return res.send(`<script>alert('Error submitting application!'); window.location.href='/customer/apply';</script>');</script>`);
      }
      const appId = this.lastID;

      // Save beneficiaries
      if (formData.ben_name && Array.isArray(formData.ben_name)) {
        for (let i = 0; i < formData.ben_name.length; i++) {
          if (formData.ben_name[i]) {
            db.run(`INSERT INTO beneficiaries (application_id, full_name, birth_date, relationship) VALUES (?, ?, ?, ?)`,
              [appId, formData.ben_name[i], formData.ben_dob[i] || '', formData.ben_relationship[i] || '']);
          }
        }
      }

      // Save uploaded files
      if (req.files) {
        for (const [key, files] of Object.entries(req.files)) {
          if (files && files[0]) {
            db.run(`INSERT INTO documents (application_id, doc_type, file_path, file_name) VALUES (?, ?, ?, ?)`,
              [appId, key, files[0].path, files[0].originalname]);
          }
        }
      }

      addNotification(customerId, 'Application Submitted', `Your application for ${service} has been submitted. Tracking No: ${trackingNumber}. Please complete your payment.`);
      res.redirect(`/customer/payment/${appId}`);
    });
});

// GCash Payment Page for Customer (Showing GCash QR code uploaded by Admin)
app.get('/customer/payment/:id', requireCustomer, async (req, res) => {
  const appId = req.params.id;
  const settings = res.locals.settings;

  db.get(`SELECT * FROM applications WHERE id = ? AND customer_id = ?`, [appId, req.session.customer.id], (err, app) => {
    if (!app) return res.redirect('/customer/dashboard');

    let fee = settings.fee_bir;
    if (app.service === 'SSS') fee = settings.fee_sss;
    if (app.service === 'PAG-IBIG') fee = settings.fee_pagibig;

    const content = `
      <h1 class="text-3xl font-bold text-blue-900 mb-2">Payment Portal (GCash)</h1>
      <p class="text-xs text-gray-500 mb-6">Service: <strong>${app.service}</strong> | Tracking: <span class="font-mono font-bold">${app.tracking_number}</span></p>

      <div class="grid md:grid-cols-2 gap-8 bg-white p-8 rounded-xl shadow">
        <div class="space-y-4 border-r pr-6">
          <h2 class="text-xl font-bold text-blue-900 border-b pb-2">Payment Instructions</h2>
          <div class="text-sm space-y-2 whitespace-pre-line text-gray-700 bg-gray-50 p-4 rounded-lg">
            ${settings.payment_instructions}
          </div>
          <div class="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <p class="text-sm font-bold text-blue-900">Amount to Pay: ₱${fee}</p>
            <p class="text-xs text-blue-800 mt-1">GCash Name: <strong>${settings.gcash_name}</strong></p>
            <p class="text-xs text-blue-800">GCash Number: <strong>${settings.gcash_number}</strong></p>
          </div>

          ${settings.gcash_qr ? `
            <div class="text-center">
              <span class="block text-xs font-semibold mb-2 text-gray-600">Scan GCash QR Code to Pay:</span>
              <img src="/uploads/${path.basename(settings.gcash_qr)}" class="mx-auto h-48 w-48 object-contain border rounded p-2 bg-white shadow"/>
            </div>
          ` : `
            <div class="p-4 bg-amber-50 border border-amber-200 rounded text-amber-800 text-xs">
              Admin has not uploaded a GCash QR code yet. You may send payment directly to GCash Number: <strong>${settings.gcash_number}</strong>
            </div>
          `}
        </div>

        <div>
          <h2 class="text-xl font-bold text-blue-900 border-b pb-2">Submit Payment Proof</h2>
          <form action="/customer/payment/${appId}" method="POST" enctype="multipart/form-data" class="space-y-4 mt-4">
            <div>
              <label class="block text-sm font-semibold mb-1">GCash Reference Number *</label>
              <input type="text" name="reference_number" required class="w-full border rounded px-3 py-2 font-mono" placeholder="1234567890123">
            </div>
            <div>
              <label class="block text-sm font-semibold mb-1">Upload Proof of Payment (Screenshot / Receipt) *</label>
              <input type="file" name="proof" accept="image/*,application/pdf" required class="w-full border rounded px-3 py-2 bg-white">
            </div>
            <button type="submit" class="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded">Submit Payment for Verification</button>
          </form>
        </div>
      </div>
    `;
    res.send(customerLayout('Payment Portal', content, 'applications', 0, req.session));
  });
});

app.post('/customer/payment/:id', requireCustomer, upload.single('proof'), (req, res) => {
  const appId = req.params.id;
  const { reference_number } = req.body;
  const proofPath = req.file ? req.file.path : '';

  db.get(`SELECT * FROM applications WHERE id = ? AND customer_id = ?`, [appId, req.session.customer.id], (err, app) => {
    if (!app) return res.redirect('/customer/dashboard');

    let fee = 500;
    if (app.service === 'SSS') fee = 400;
    if (app.service === 'PAG-IBIG') fee = 400;

    db.run(`INSERT INTO payments (customer_id, application_id, tracking_number, service, payment_method, amount, reference_number, proof_path, payment_status) VALUES (?, ?, ?, ?, 'GCash', ?, ?, ?, 'Pending Verification')`,
      [req.session.customer.id, appId, app.tracking_number, app.service, fee, reference_number, proofPath]);

    db.run(`UPDATE applications SET payment_status = 'Verification Pending' WHERE id = ?`, [appId]);
    addNotification(req.session.customer.id, 'Payment Submitted', `Payment proof for tracking # ${app.tracking_number} has been submitted for verification.`);
    
    res.redirect(`/customer/track/${appId}`);
  });
});

// Customer Applications List
app.get('/customer/applications', requireCustomer, (req, res) => {
  db.all(`SELECT * FROM applications WHERE customer_id = ? ORDER BY id DESC`, [req.session.customer.id], (err, apps) => {
    const content = `
      <h1 class="text-3xl font-bold text-blue-900 mb-2">My Applications</h1>
      <p class="text-xs text-gray-500 mb-6">GovAssist PH System by Mark Jerald Agdigos</p>

      <div class="bg-white p-6 rounded-xl shadow">
        ${apps.length === 0 ? `<p class="text-gray-500 text-sm">No applications found.</p>` : `
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse">
              <thead>
                <tr class="border-b bg-gray-50 text-xs text-gray-600 uppercase">
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
                  <tr class="border-b hover:bg-gray-50">
                    <td class="p-3 font-mono font-bold">${app.tracking_number}</td>
                    <td class="p-3">${app.service}</td>
                    <td class="p-3"><span class="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs">${app.status}</span></td>
                    <td class="p-3"><span class="px-2 py-1 bg-amber-100 text-amber-800 rounded text-xs">${app.payment_status}</span></td>
                    <td class="p-3 text-xs text-gray-500">${app.created_at}</td>
                    <td class="p-3"><a href="/customer/track/${app.id}" class="text-blue-600 font-semibold hover:underline">View</a></td>
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

// Application Detailed Tracking & Completed File Download
app.get('/customer/track/:id', requireCustomer, (req, res) => {
  const appId = req.params.id;
  db.get(`SELECT * FROM applications WHERE id = ? AND customer_id = ?`, [appId, req.session.customer.id], (err, app) => {
    if (!app) return res.redirect('/customer/dashboard');

    db.all(`SELECT * FROM completed_files WHERE application_id = ?`, [appId], (err2, completedFiles) => {
      const formData = JSON.parse(app.data_json || '{}');
      const content = `
        <h1 class="text-3xl font-bold text-blue-900 mb-2">Application Tracking Details</h1>
        <p class="text-xs text-gray-500 mb-6">Tracking Number: <span class="font-mono font-bold text-base text-blue-700">${app.tracking_number}</span></p>

        <div class="grid md:grid-cols-2 gap-6 mb-8">
          <div class="bg-white p-6 rounded-xl shadow space-y-3">
            <h3 class="font-bold text-lg text-blue-900 border-b pb-2">Status Overview</h3>
            <p><strong>Service:</strong> ${app.service}</p>
            <p><strong>Application Status:</strong> <span class="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs font-bold">${app.status}</span></p>
            <p><strong>Payment Status:</strong> <span class="px-2 py-1 bg-amber-100 text-amber-800 rounded text-xs font-bold">${app.payment_status}</span></p>
            ${app.admin_remarks ? `<p><strong>Admin Remarks:</strong> ${app.admin_remarks}</p>` : ''}
            <div class="pt-4">
              <a href="/customer/payment/${app.id}" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm font-semibold">View / Update Payment</a>
            </div>
          </div>

          <div class="bg-white p-6 rounded-xl shadow space-y-3">
            <h3 class="font-bold text-lg text-blue-900 border-b pb-2">Processed Documents (From Admin)</h3>
            ${completedFiles.length === 0 ? `<p class="text-gray-500 text-sm">No completed documents uploaded by admin yet. Please wait for processing.</p>` : `
              <div class="space-y-2">
                ${completedFiles.map(f => `
                  <div class="flex justify-between items-center border p-3 rounded">
                    <div>
                      <p class="font-bold text-sm">${f.file_name}</p>
                      <p class="text-xs text-gray-500">${f.description || ''}</p>
                    </div>
                    <a href="/uploads/${path.basename(f.file_path)}" download class="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1 rounded text-xs font-bold">Download</a>
                  </div>
                `).join('')}
              </div>
            `}
          </div>
        </div>

        <div class="bg-white p-6 rounded-xl shadow space-y-4">
          <h3 class="font-bold text-lg text-blue-900 border-b pb-2">Submitted Information Summary</h3>
          <div class="grid md:grid-cols-3 gap-4 text-sm">
            <p><strong>Full Name:</strong> ${formData.first_name || ''} ${formData.middle_name || ''} ${formData.last_name || ''}</p>
            <p><strong>Date of Birth:</strong> ${formData.date_of_birth || ''}</p>
            <p><strong>Sex:</strong> ${formData.sex || ''}</p>
            <p><strong>Civil Status:</strong> ${formData.civil_status || ''}</p>
            <p><strong>Mobile:</strong> ${formData.mobile_number || ''}</p>
            <p><strong>Email:</strong> ${formData.email_address || ''}</p>
            <p class="md:col-span-3"><strong>Address:</strong> ${formData.street || ''}, ${formData.barangay || ''}, ${formData.city || ''}, ${formData.province || ''} (${formData.zip_code || ''})</p>
          </div>
        </div>
      `;
      res.send(customerLayout('Tracking Details', content, 'applications', 0, req.session));
    });
  });
});

// Completed Documents Hub for Customer
app.get('/customer/documents', requireCustomer, (req, res) => {
  db.all(`SELECT cf.*, a.tracking_number, a.service FROM completed_files cf JOIN applications a ON cf.application_id = a.id WHERE a.customer_id = ?`, [req.session.customer.id], (err, files) => {
    const content = `
      <h1 class="text-3xl font-bold text-blue-900 mb-2">Completed Documents</h1>
      <p class="text-xs text-gray-500 mb-6">Download your officially processed government forms and documents here.</p>

      <div class="bg-white p-6 rounded-xl shadow">
        ${files.length === 0 ? `<p class="text-gray-500 text-sm">No completed files available yet.</p>` : `
          <div class="space-y-3">
            ${files.map(f => `
              <div class="flex justify-between items-center border p-4 rounded-lg">
                <div>
                  <p class="font-bold text-blue-900">${f.file_name} (${f.service})</p>
                  <p class="text-xs text-gray-500">Tracking: ${f.tracking_number} | Uploaded: ${f.uploaded_at}</p>
                </div>
                <a href="/uploads/${path.basename(f.file_path)}" download class="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded text-sm font-bold">Download File</a>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    `;
    res.send(customerLayout('Completed Documents', content, 'documents', 0, req.session));
  });
});

// Customer Notifications
app.get('/customer/notifications', requireCustomer, (req, res) => {
  db.all(`SELECT * FROM notifications WHERE customer_id = ? ORDER BY id DESC`, [req.session.customer.id], (err, notifs) => {
    db.run(`UPDATE notifications SET is_read = 1 WHERE customer_id = ?`, [req.session.customer.id]);

    const content = `
      <h1 class="text-3xl font-bold text-blue-900 mb-2">Notifications</h1>
      <p class="text-xs text-gray-500 mb-6">Updates regarding your applications and payments.</p>

      <div class="bg-white p-6 rounded-xl shadow space-y-4">
        ${notifs.length === 0 ? `<p class="text-gray-500 text-sm">No notifications.</p>` : `
          ${notifs.map(n => `
            <div class="border-b pb-3">
              <div class="flex justify-between items-center">
                <h4 class="font-bold text-blue-900">${n.title}</h4>
                <span class="text-xs text-gray-400">${n.created_at}</span>
              </div>
              <p class="text-sm text-gray-700 mt-1">${n.message}</p>
            </div>
          `).join('')}
        `}
      </div>
    `;
    res.send(customerLayout('Notifications', content, 'notifications', 0, req.session));
  });
});

// Customer Profile
app.get('/customer/profile', requireCustomer, (req, res) => {
  db.get(`SELECT * FROM users WHERE id = ?`, [req.session.customer.id], (err, user) => {
    const content = `
      <h1 class="text-3xl font-bold text-blue-900 mb-2">Customer Profile</h1>
      <p class="text-xs text-gray-500 mb-6">Manage your account information.</p>

      <form action="/customer/profile" method="POST" class="bg-white p-8 rounded-xl shadow max-w-lg space-y-4">
        <div>
          <label class="block text-sm font-semibold mb-1">Full Name</label>
          <input type="text" name="full_name" value="${user.full_name}" required class="w-full border rounded px-3 py-2">
        </div>
        <div>
          <label class="block text-sm font-semibold mb-1">Mobile Number</label>
          <input type="text" name="mobile_number" value="${user.mobile_number}" required class="w-full border rounded px-3 py-2">
        </div>
        <div>
          <label class="block text-sm font-semibold mb-1">Email Address</label>
          <input type="email" name="email_address" value="${user.email_address}" required class="w-full border rounded px-3 py-2">
        </div>
        <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded">Update Profile</button>
      </form>
    `;
    res.send(customerLayout('Profile', content, 'profile', 0, req.session));
  });
});

app.post('/customer/profile', requireCustomer, (req, res) => {
  const { full_name, mobile_number, email_address } = req.body;
  db.run(`UPDATE users SET full_name = ?, mobile_number = ?, email_address = ? WHERE id = ?`,
    [full_name, mobile_number, email_address, req.session.customer.id], () => {
      req.session.customer.full_name = full_name;
      res.send(`<script>alert('Profile updated successfully!'); window.location.href='/customer/profile';</script>`);
    });
});


// ==========================================
// ADMIN PORTAL ROUTES
// ==========================================
app.get('/admin/dashboard', requireAdmin, (req, res) => {
  db.get(`SELECT COUNT(*) as count FROM applications`, [], (err, apps) => {
    db.get(`SELECT COUNT(*) as count FROM users`, [], (err2, users) => {
      db.get(`SELECT COUNT(*) as count FROM payments WHERE payment_status = 'Pending Verification'`, [], (err3, pendPay) => {
        
        const content = `
          <h1 class="text-3xl font-bold text-gray-900 mb-2">Admin Dashboard</h1>
          <p class="text-xs text-gray-500 mb-6">GovAssist PH Administration by Mark Jerald Agdigos</p>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div class="bg-white p-6 rounded-xl shadow border-l-4 border-blue-600">
              <h3 class="text-gray-500 text-sm font-medium">Total Applications</h3>
              <p class="text-3xl font-bold text-gray-900 mt-2">${apps.count}</p>
            </div>
            <div class="bg-white p-6 rounded-xl shadow border-l-4 border-emerald-600">
              <h3 class="text-gray-500 text-sm font-medium">Registered Customers</h3>
              <p class="text-3xl font-bold text-gray-900 mt-2">${users.count}</p>
            </div>
            <div class="bg-white p-6 rounded-xl shadow border-l-4 border-amber-500">
              <h3 class="text-gray-500 text-sm font-medium">Pending Payments</h3>
              <p class="text-3xl font-bold text-amber-600 mt-2">${pendPay.count}</p>
            </div>
          </div>
        `;
        res.send(adminLayout('Admin Dashboard', content, 'dashboard'));
      });
    });
  });
});

// Admin Applications Management
app.get('/admin/applications', requireAdmin, (req, res) => {
  db.all(`SELECT a.*, u.full_name FROM applications a JOIN users u ON a.customer_id = u.id ORDER BY a.id DESC`, [], (err, apps) => {
    const content = `
      <h1 class="text-3xl font-bold text-gray-900 mb-2">Manage Applications</h1>
      <p class="text-xs text-gray-500 mb-6">Review customer applications and upload completed files.</p>

      <div class="bg-white p-6 rounded-xl shadow">
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="border-b bg-gray-50 text-xs text-gray-600 uppercase">
                <th class="p-3">Tracking</th>
                <th class="p-3">Customer</th>
                <th class="p-3">Service</th>
                <th class="p-3">Status</th>
                <th class="p-3">Payment</th>
                <th class="p-3">Action</th>
              </tr>
            </thead>
            <tbody class="text-sm">
              ${apps.map(app => `
                <tr class="border-b hover:bg-gray-50">
                  <td class="p-3 font-mono font-bold">${app.tracking_number}</td>
                  <td class="p-3">${app.full_name}</td>
                  <td class="p-3">${app.service}</td>
                  <td class="p-3"><span class="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs">${app.status}</span></td>
                  <td class="p-3"><span class="px-2 py-1 bg-amber-100 text-amber-800 rounded text-xs">${app.payment_status}</span></td>
                  <td class="p-3"><a href="/admin/application/${app.id}" class="text-blue-600 font-bold hover:underline">Manage</a></td>
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

// Admin Single Application Review & Completed File Uploader
app.get('/admin/application/:id', requireAdmin, (req, res) => {
  const appId = req.params.id;
  db.get(`SELECT a.*, u.full_name, u.email_address, u.mobile_number FROM applications a JOIN users u ON a.customer_id = u.id WHERE a.id = ?`, [appId], (err, app) => {
    if (!app) return res.redirect('/admin/applications');

    db.all(`SELECT * FROM documents WHERE application_id = ?`, [appId], (err2, docs) => {
      db.all(`SELECT * FROM completed_files WHERE application_id = ?`, [appId], (err3, completedFiles) => {
        db.all(`SELECT * FROM payments WHERE application_id = ?`, [appId], (err4, payments) => {
          const formData = JSON.parse(app.data_json || '{}');

          const content = `
            <h1 class="text-3xl font-bold text-gray-900 mb-2">Review Application: ${app.tracking_number}</h1>
            <p class="text-xs text-gray-500 mb-6">Customer: ${app.full_name} (${app.service})</p>

            <div class="grid md:grid-cols-2 gap-8 mb-8">
              <div class="bg-white p-6 rounded-xl shadow space-y-4">
                <h3 class="font-bold text-lg text-gray-900 border-b pb-2">Update Status & Remarks</h3>
                <form action="/admin/application/${appId}/status" method="POST" class="space-y-4">
                  <div>
                    <label class="block text-sm font-semibold mb-1">Status</label>
                    <select name="status" class="w-full border rounded px-3 py-2">
                      <option value="Submitted" ${app.status === 'Submitted' ? 'selected' : ''}>Submitted</option>
                      <option value="Under Review" ${app.status === 'Under Review' ? 'selected' : ''}>Under Review</option>
                      <option value="Processing" ${app.status === 'Processing' ? 'selected' : ''}>Processing</option>
                      <option value="Completed" ${app.status === 'Completed' ? 'selected' : ''}>Completed</option>
                      <option value="Rejected" ${app.status === 'Rejected' ? 'selected' : ''}>Rejected</option>
                    </select>
                  </div>
                  <div>
                    <label class="block text-sm font-semibold mb-1">Payment Status</label>
                    <select name="payment_status" class="w-full border rounded px-3 py-2">
                      <option value="Payment Pending" ${app.payment_status === 'Payment Pending' ? 'selected' : ''}>Payment Pending</option>
                      <option value="Verification Pending" ${app.payment_status === 'Verification Pending' ? 'selected' : ''}>Verification Pending</option>
                      <option value="Paid & Verified" ${app.payment_status === 'Paid & Verified' ? 'selected' : ''}>Paid & Verified</option>
                    </select>
                  </div>
                  <div>
                    <label class="block text-sm font-semibold mb-1">Admin Remarks</label>
                    <textarea name="admin_remarks" rows="3" class="w-full border rounded px-3 py-2">${app.admin_remarks || ''}</textarea>
                  </div>
                  <button type="submit" class="bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 rounded text-sm font-bold">Save Changes</button>
                </form>
              </div>

              <div class="bg-white p-6 rounded-xl shadow space-y-4">
                <h3 class="font-bold text-lg text-gray-900 border-b pb-2">Upload Completed Document for Customer</h3>
                <form action="/admin/application/${appId}/upload-completed" method="POST" enctype="multipart/form-data" class="space-y-4">
                  <div>
                    <label class="block text-sm font-semibold mb-1">Select Completed File (PDF/Image)</label>
                    <input type="file" name="completed_file" required class="w-full border rounded px-3 py-2 bg-white">
                  </div>
                  <div>
                    <label class="block text-sm font-semibold mb-1">Description / Filename</label>
                    <input type="text" name="description" required class="w-full border rounded px-3 py-2" placeholder="e.g. Approved TIN ID / SSS Certificate">
                  </div>
                  <button type="submit" class="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded text-sm font-bold">Upload & Send to Customer</button>
                </form>

                <div class="mt-4 space-y-2">
                  <h4 class="font-semibold text-xs text-gray-600 uppercase">Already Uploaded Completed Files:</h4>
                  ${completedFiles.map(cf => `
                    <div class="flex justify-between items-center text-xs border p-2 rounded">
                      <span>${cf.file_name}</span>
                      <a href="/uploads/${path.basename(cf.file_path)}" download class="text-blue-600 font-bold">Download</a>
                    </div>
                  `).join('')}
                </div>
              </div>
            </div>

            <div class="bg-white p-6 rounded-xl shadow space-y-4 mb-8">
              <h3 class="font-bold text-lg text-gray-900 border-b pb-2">Customer Uploaded Files & IDs</h3>
              <div class="grid md:grid-cols-3 gap-4">
                ${docs.map(d => `
                  <div class="border p-4 rounded-lg bg-gray-50 text-center">
                    <p class="font-bold text-xs uppercase mb-2 text-blue-900">${d.doc_type}</p>
                    <a href="/uploads/${path.basename(d.file_path)}" target="_blank" class="block">
                      <img src="/uploads/${path.basename(d.file_path)}" class="h-32 mx-auto object-cover rounded border bg-white mb-2" onerror="this.src='https://placehold.co/200?text=PDF+Document'"/>
                    </a>
                    <a href="/uploads/${path.basename(d.file_path)}" download class="text-xs text-blue-600 font-bold hover:underline">Download Original</a>
                  </div>
                `).join('')}
              </div>
            </div>

            <div class="bg-white p-6 rounded-xl shadow space-y-4">
              <h3 class="font-bold text-lg text-gray-900 border-b pb-2">Payment Proofs</h3>
              ${payments.length === 0 ? `<p class="text-gray-500 text-sm">No payment submitted yet.</p>` : `
                <div class="space-y-4">
                  ${payments.map(p => `
                    <div class="border p-4 rounded-lg flex justify-between items-center">
                      <div>
                        <p class="font-bold text-sm">Method: ${p.payment_method} | Amount: ₱${p.amount}</p>
                        <p class="text-xs text-gray-600">Reference: <span class="font-mono font-bold">${p.reference_number}</span></p>
                        <p class="text-xs text-gray-500">Status: <strong>${p.payment_status}</strong></p>
                      </div>
                      ${p.proof_path ? `<a href="/uploads/${path.basename(p.proof_path)}" target="_blank" class="bg-blue-600 text-white px-3 py-1 rounded text-xs font-bold">View Proof</a>` : ''}
                    </div>
                  `).join('')}
                </div>
              `}
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
  const { status, payment_status, admin_remarks } = req.body;

  db.get(`SELECT customer_id, tracking_number FROM applications WHERE id = ?`, [appId], (err, app) => {
    if (app) {
      db.run(`UPDATE applications SET status = ?, payment_status = ?, admin_remarks = ? WHERE id = ?`,
        [status, payment_status, admin_remarks, appId], () => {
          addNotification(app.customer_id, 'Application Status Updated', `Your application ${app.tracking_number} status is now: ${status}.`);
          res.redirect(`/admin/application/${appId}`);
        });
    } else {
      res.redirect('/admin/applications');
    }
  });
});

app.post('/admin/application/:id/upload-completed', requireAdmin, upload.single('completed_file'), (req, res) => {
  const appId = req.params.id;
  const { description } = req.body;
  if (!req.file) return res.redirect(`/admin/application/${appId}`);

  db.get(`SELECT customer_id, tracking_number FROM applications WHERE id = ?`, [appId], (err, app) => {
    if (app) {
      db.run(`INSERT INTO completed_files (application_id, file_path, file_name, description) VALUES (?, ?, ?, ?)`,
        [appId, req.file.path, req.file.originalname, description], () => {
          db.run(`UPDATE applications SET status = 'Completed' WHERE id = ?`, [appId]);
          addNotification(app.customer_id, 'Completed Document Ready', `Your processed document for tracking # ${app.tracking_number} is now ready for download.`);
          res.redirect(`/admin/application/${appId}`);
        });
    } else {
      res.redirect('/admin/applications');
    }
  });
});

// Admin Payment Verification
app.get('/admin/payments', requireAdmin, (req, res) => {
  db.all(`SELECT p.*, u.full_name FROM payments p JOIN users u ON p.customer_id = u.id ORDER BY p.id DESC`, [], (err, payments) => {
    const content = `
      <h1 class="text-3xl font-bold text-gray-900 mb-2">Payment Verification</h1>
      <p class="text-xs text-gray-500 mb-6">Verify GCash reference numbers and proof of payments.</p>

      <div class="bg-white p-6 rounded-xl shadow">
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="border-b bg-gray-50 text-xs text-gray-600 uppercase">
                <th class="p-3">Tracking</th>
                <th class="p-3">Customer</th>
                <th class="p-3">Service</th>
                <th class="p-3">Amount</th>
                <th class="p-3">Reference #</th>
                <th class="p-3">Status</th>
                <th class="p-3">Action</th>
              </tr>
            </thead>
            <tbody class="text-sm">
              ${payments.map(p => `
                <tr class="border-b hover:bg-gray-50">
                  <td class="p-3 font-mono font-bold">${p.tracking_number}</td>
                  <td class="p-3">${p.full_name}</td>
                  <td class="p-3">${p.service}</td>
                  <td class="p-3">₱${p.amount}</td>
                  <td class="p-3 font-mono">${p.reference_number}</td>
                  <td class="p-3"><span class="px-2 py-1 bg-amber-100 text-amber-800 rounded text-xs">${p.payment_status}</span></td>
                  <td class="p-3 space-x-2">
                    ${p.proof_path ? `<a href="/uploads/${path.basename(p.proof_path)}" target="_blank" class="text-blue-600 font-bold hover:underline">View Proof</a>` : ''}
                    <a href="/admin/payment/verify/${p.id}" class="text-emerald-600 font-bold hover:underline">Approve</a>
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

app.get('/admin/payment/verify/:id', requireAdmin, (req, res) => {
  const paymentId = req.params.id;
  db.get(`SELECT * FROM payments WHERE id = ?`, [paymentId], (err, payment) => {
    if (payment) {
      db.run(`UPDATE payments SET payment_status = 'Verified' WHERE id = ?`, [paymentId]);
      db.run(`UPDATE applications SET payment_status = 'Paid & Verified' WHERE id = ?`, [payment.application_id]);
      addNotification(payment.customer_id, 'Payment Verified', `Your payment for tracking # ${payment.tracking_number} has been verified successfully.`);
    }
    res.redirect('/admin/payments');
  });
});

// Admin Users Records
app.get('/admin/users', requireAdmin, (req, res) => {
  db.all(`SELECT * FROM users ORDER BY id DESC`, [], (err, users) => {
    const content = `
      <h1 class="text-3xl font-bold text-gray-900 mb-2">Registered Customer Records</h1>
      <p class="text-xs text-gray-500 mb-6">List of all registered customers in the permanent database.</p>

      <div class="bg-white p-6 rounded-xl shadow">
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
                  <td class="p-3">${u.id}</td>
                  <td class="p-3 font-bold">${u.full_name}</td>
                  <td class="p-3">${u.username}</td>
                  <td class="p-3">${u.mobile_number}</td>
                  <td class="p-3">${u.email_address}</td>
                  <td class="p-3 text-xs text-gray-500">${u.created_at}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
    res.send(adminLayout('Customer Records', content, 'users'));
  });
});

// Admin Settings & GCash QR Uploader
app.get('/admin/settings', requireAdmin, async (req, res) => {
  const settings = res.locals.settings;
  const content = `
    <h1 class="text-3xl font-bold text-gray-900 mb-2">System Settings & GCash QR Code</h1>
    <p class="text-xs text-gray-500 mb-6">Manage business details, pricing, and GCash QR code displayed to customers.</p>

    <form action="/admin/settings" method="POST" enctype="multipart/form-data" class="bg-white p-8 rounded-xl shadow space-y-6 max-w-2xl">
      <div class="grid md:grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-semibold mb-1">Business Name</label>
          <input type="text" name="business_name" value="${settings.business_name}" required class="w-full border rounded px-3 py-2">
        </div>
        <div>
          <label class="block text-sm font-semibold mb-1">Developer Name</label>
          <input type="text" name="developer_name" value="${settings.developer_name}" required class="w-full border rounded px-3 py-2">
        </div>
        <div>
          <label class="block text-sm font-semibold mb-1">Contact Number</label>
          <input type="text" name="contact_number" value="${settings.contact_number}" required class="w-full border rounded px-3 py-2">
        </div>
        <div>
          <label class="block text-sm font-semibold mb-1">Email Address</label>
          <input type="email" name="email" value="${settings.email}" required class="w-full border rounded px-3 py-2">
        </div>
        <div>
          <label class="block text-sm font-semibold mb-1">BIR / TIN Fee (₱)</label>
          <input type="number" name="fee_bir" value="${settings.fee_bir}" required class="w-full border rounded px-3 py-2">
        </div>
        <div>
          <label class="block text-sm font-semibold mb-1">SSS Fee (₱)</label>
          <input type="number" name="fee_sss" value="${settings.fee_sss}" required class="w-full border rounded px-3 py-2">
        </div>
        <div>
          <label class="block text-sm font-semibold mb-1">Pag-IBIG Fee (₱)</label>
          <input type="number" name="fee_pagibig" value="${settings.fee_pagibig}" required class="w-full border rounded px-3 py-2">
        </div>
        <div>
          <label class="block text-sm font-semibold mb-1">GCash Account Name</label>
          <input type="text" name="gcash_name" value="${settings.gcash_name}" required class="w-full border rounded px-3 py-2">
        </div>
        <div class="md:col-span-2">
          <label class="block text-sm font-semibold mb-1">GCash Number</label>
          <input type="text" name="gcash_number" value="${settings.gcash_number}" required class="w-full border rounded px-3 py-2">
        </div>
        <div class="md:col-span-2">
          <label class="block text-sm font-semibold mb-1">Upload GCash QR Code Image</label>
          ${settings.gcash_qr ? `<div class="mb-2"><img src="/uploads/${path.basename(settings.gcash_qr)}" class="h-32 object-contain border p-1 rounded bg-gray-50"/></div>` : ''}
          <input type="file" name="gcash_qr" accept="image/*" class="w-full border rounded px-3 py-2 bg-white">
        </div>
        <div class="md:col-span-2">
          <label class="block text-sm font-semibold mb-1">Payment Instructions</label>
          <textarea name="payment_instructions" rows="4" class="w-full border rounded px-3 py-2">${settings.payment_instructions}</textarea>
        </div>
      </div>
      <button type="submit" class="bg-gray-900 hover:bg-gray-800 text-white font-bold px-6 py-2 rounded">Save Settings</button>
    </form>
  `;
  res.send(adminLayout('Settings', content, 'settings'));
});

app.post('/admin/settings', requireAdmin, upload.single('gcash_qr'), async (req, res) => {
  const settingsData = req.body;
  if (req.file) {
    settingsData.gcash_qr = req.file.path;
  } else {
    const currentSettings = await getSettings();
    settingsData.gcash_qr = currentSettings.gcash_qr || '';
  }

  db.serialize(() => {
    const stmt = db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`);
    for (const [key, value] of Object.entries(settingsData)) {
      stmt.run(key, value);
    }
    stmt.finalize();
  });

  res.send(`<script>alert('Settings updated successfully!'); window.location.href='/admin/settings';</script>`);
});

// Admin Backup / JSON Export
app.get('/admin/backup', requireAdmin, (req, res) => {
  db.all(`SELECT a.*, u.full_name FROM applications a JOIN users u ON a.customer_id = u.id`, [], (err, apps) => {
    db.all(`SELECT * FROM users`, [], (err2, users) => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename=govassist_backup_' + Date.now() + '.json');
      res.send(JSON.stringify({ developer: 'Mark Jerald Agdigos', timestamp: new Date(), users, applications: apps }, null, 2));
    });
  });
});

// Start Server
app.listen(PORT, () => {
  console.log(`GovAssist PH Application Assistance System (Developed by Mark Jerald Agdigos) running on port ${PORT}`);
});
