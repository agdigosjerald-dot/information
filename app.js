/**
 * BIR / TIN, SSS & Pag-IBIG Application Assistance System
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
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
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
      // Seed default admin if not exists
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
        business_name: 'GovAssist PH - Application Assistance',
        logo_url: '',
        contact_number: '+63 912 345 6789',
        email: 'support@govassist.ph',
        address: 'Manila, Philippines',
        gcash_qr: '',
        gcash_name: 'GovAssist Admin',
        gcash_number: '09123456789',
        fee_bir: '500',
        fee_sss: '400',
        fee_pagibig: '400',
        payment_instructions: '1. Scan GCash QR or send to the number provided.\n2. Upload clear proof of payment.\n3. Wait for admin verification (usually within 24 hours).'
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
  }
}

// Middleware Configuration
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));
app.use('/uploads', express.static(uploadDir));

app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: __dirname }),
  secret: process.env.SESSION_SECRET || 'govassist_secure_secret_key_2026',
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

// Helper to add notification
function addNotification(customerId, title, message) {
  db.run(`INSERT INTO notifications (customer_id, title, message) VALUES (?, ?, ?)`, [customerId, title, message]);
}

// Helper to log status history
function logStatusHistory(appId, status, notes = '') {
  db.run(`INSERT INTO status_history (application_id, status, notes) VALUES (?, ?, ?)`, [appId, status, notes]);
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
// LANDING & PUBLIC PORTAL
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
    </head>
    <body class="bg-gray-50 text-gray-800 font-sans">
      <header class="bg-blue-900 text-white shadow-md">
        <div class="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <div class="flex items-center space-x-3">
            ${settings.logo_url ? `<img src="${settings.logo_url}" class="h-10 w-10 object-contain bg-white rounded p-1"/>` : ''}
            <span class="text-xl font-bold">${settings.business_name}</span>
          </div>
          <div class="space-x-4">
            <a href="/customer/login" class="px-4 py-2 bg-blue-700 hover:bg-blue-600 rounded text-sm font-semibold">Customer Login</a>
            <a href="/customer/register" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded text-sm font-semibold">Register</a>
          </div>
        </div>
      </header>

      <main class="max-w-7xl mx-auto px-4 py-12">
        <div class="text-center max-w-3xl mx-auto mb-12">
          <h1 class="text-4xl font-extrabold text-blue-900 mb-4">Fast & Hassle-Free Government Application Assistance</h1>
          <p class="text-lg text-gray-600 mb-8">We assist you with your BIR/TIN, SSS, and Pag-IBIG registrations and applications securely, quickly, and professionally.</p>
          <div class="flex justify-center gap-4">
            <a href="/customer/register" class="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow">Get Started Now</a>
            <a href="/track-public" class="px-6 py-3 bg-white border border-gray-300 hover:bg-gray-100 text-blue-900 font-bold rounded-lg shadow">Track Application</a>
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
          <strong>Government Disclaimer:</strong> ${settings.business_name} is an application assistance, document collection, processing, payment, and tracking platform. It is not the official website of BIR, SSS, or Pag-IBIG. We do not falsely claim government affiliation.
        </div>
      </main>

      <footer class="bg-gray-900 text-gray-400 py-6 text-center text-sm">
        <p>&copy; 2026 ${settings.business_name}. All rights reserved.</p>
      </footer>
    </body>
    </html>
  `);
});

// Public Tracking Page
app.get('/track-public', (req, res) => {
  const trackingNumber = req.query.tracking_number || '';
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
        <form action="/track-public" method="GET" class="bg-white p-6 rounded-xl shadow space-y-4 mb-6">
          <div>
            <label class="block text-sm font-semibold mb-1">Tracking Number</label>
            <input type="text" name="tracking_number" value="${trackingNumber}" required placeholder="e.g. TIN-20260901-0001" class="w-full border rounded px-3 py-2 uppercase font-mono">
          </div>
          <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded">Search Status</button>
        </form>
        <div class="text-center">
          <a href="/" class="text-blue-600 hover:underline text-sm">&larr; Back to Home</a>
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
        <h2 class="text-2xl font-bold text-blue-900 mb-6 text-center">Customer Registration</h2>
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
        <h2 class="text-2xl font-bold text-blue-900 mb-6 text-center">Customer Login</h2>
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
        <h2 class="text-2xl font-bold text-gray-900 mb-6 text-center">Admin Portal Login</h2>
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
// CUSTOMER PORTAL & DASHBOARD
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

// Layout helper for Customer Portal
function customerLayout(title, content, activeTab, unreadCount = 0) {
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
            <div class="text-xl font-extrabold mb-8 flex items-center space-x-2">
              <span>GovAssist PH</span>
            </div>
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
            <span class="block text-sm text-blue-200 mb-2">Logged in as: <strong>${session.customer ? session.customer.full_name : ''}</strong></span>
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

app.get('/customer/dashboard', requireCustomer, async (req, res) => {
  const customerId = req.session.customer.id;
  db.all(`SELECT * FROM applications WHERE customer_id = ? ORDER BY id DESC`, [customerId], async (err, apps) => {
    db.all(`SELECT * FROM notifications WHERE customer_id = ? AND is_read = 0`, [customerId], async (err2, notifs) => {
      const totalApps = apps.length;
      const pendingApps = apps.filter(a => a.status === 'Submitted' || a.status === 'Under Review').length;
      const completedApps = apps.filter(a => a.status === 'Completed').length;

      const content = `
        <h1 class="text-3xl font-bold text-blue-900 mb-6">Customer Dashboard</h1>
        
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
                      <td class="p-3"><a href="/customer/track/${app.id}" class="text-blue-600 font-semibold hover:underline">View</a></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>

        <div class="bg-amber-50 border border-amber-200 p-4 rounded-lg text-amber-900 text-xs">
          <strong>Disclaimer:</strong> This platform assists you in preparing and submitting government applications. It is not an official government portal.
        </div>
      `;
      res.send(customerLayout('Dashboard', content, 'dashboard', notifs.length));
    });
  });
});

// Multi-Step Application Wizard Route
app.get('/customer/apply', requireCustomer, async (req, res) => {
  const settings = res.locals.settings;
  const content = `
    <h1 class="text-3xl font-bold text-blue-900 mb-6">New Government Application</h1>
    <form action="/customer/apply" method="POST" enctype="multipart/form-data" class="bg-white p-8 rounded-xl shadow space-y-8" id="appForm">
      
      <div class="space-y-4">
        <h2 class="text-xl font-bold text-blue-900 border-b pb-2">Step 1: Select Service</h2>
        <div class="grid md:grid-cols-3 gap-4">
          <label class="border p-4 rounded-xl cursor-pointer hover:border-blue-600 flex flex-col justify-between">
            <div>
              <input type="radio" name="service" value="BIR / TIN" required class="mb-2" onchange="toggleServiceForm()">
              <span class="font-bold block text-lg">BIR / TIN</span>
              <span class="text-sm text-gray-500">Tax Identification Number registration. Fee: ₱${settings.fee_bir}</span>
            </div>
          </label>
          <label class="border p-4 rounded-xl cursor-pointer hover:border-blue-600 flex flex-col justify-between">
            <div>
              <input type="radio" name="service" value="SSS" required class="mb-2" onchange="toggleServiceForm()">
              <span class="font-bold block text-lg">SSS</span>
              <span class="text-sm text-gray-500">Social Security System registration & beneficiaries. Fee: ₱${settings.fee_sss}</span>
            </div>
          </label>
          <label class="border p-4 rounded-xl cursor-pointer hover:border-blue-600 flex flex-col justify-between">
            <div>
              <input type="radio" name="service" value="PAG-IBIG" required class="mb-2" onchange="toggleServiceForm()">
              <span class="font-bold block text-lg">Pag-IBIG</span>
              <span class="text-sm text-gray-500">HDMF membership & housing fund registration. Fee: ₱${settings.fee_pagibig}</span>
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
            <select name="civil_status" id="civilStatus" required class="w-full border rounded px-3 py-2" onchange="toggleMarriageSection()">
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
        <h2 class="text-xl font-bold text-blue-900 border-b pb-2">Step 3: Contact & Address Information</h2>
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
            <label class="block text-sm font-semibold mb-1">House/Unit Number & Street *</label>
            <input type="text" name="street" required class="w-full border rounded px-3 py-2" placeholder="123 Rizal Street">
          </div>
          <div>
            <label class="block text-sm font-semibold mb-1">Barangay *</label>
            <input type="text" name="barangay" required class="w-full border rounded px-3 py-2" placeholder="Barangay San Antonio">
          </div>
          <div>
            <label class="block text-sm font-semibold mb-1">City / Municipality *</label>
            <input type="text" name="city" required class="w-full border rounded px-3 py-2" placeholder="Quezon City">
          </div>
          <div>
            <label class="block text-sm font-semibold mb-1">Province *</label>
            <input type="text" name="province" required class="w-full border rounded px-3 py-2" placeholder="Metro Manila">
          </div>
          <div>
            <label class="block text-sm font-semibold mb-1">ZIP Code *</label>
            <input type="text" name="zip_code" required class="w-full border rounded px-3 py-2" placeholder="1100">
          </div>
        </div>
      </div>

      <div class="space-y-4">
        <h2 class="text-xl font-bold text-blue-900 border-b pb-2">Step 4: Parents & Spouse Information</h2>
        <div class="grid md:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-semibold mb-1">Father's Full Name *</label>
            <input type="text" name="father_name" required class="w-full border rounded px-3 py-2" placeholder="Pedro Dela Cruz">
          </div>
          <div>
            <label class="block text-sm font-semibold mb-1">Father's Date of Birth *</label>
            <input type="date" name="father_dob" required class="w-full border rounded px-3 py-2">
          </div>
          <div>
            <label class="block text-sm font-semibold mb-1">Mother's Maiden Full Name *</label>
            <input type="text" name="mother_maiden_name" required class="w-full border rounded px-3 py-2" placeholder="Maria Santos">
          </div>
          <div>
            <label class="block text-sm font-semibold mb-1">Mother's Date of Birth *</label>
            <input type="date" name="mother_dob" required class="w-full border rounded px-3 py-2">
          </div>
        </div>

        <div id="marriageSection" class="hidden p-4 bg-gray-50 border rounded-lg space-y-4 mt-4">
          <h3 class="font-bold text-blue-900">Spouse Details (Required for Married applicants)</h3>
          <div class="grid md:grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-semibold mb-1">Spouse Full Name</label>
              <input type="text" name="spouse_name" class="w-full border rounded px-3 py-2">
            </div>
            <div>
              <label class="block text-sm font-semibold mb-1">Spouse Date of Birth</label>
              <input type="date" name="spouse_dob" class="w-full border rounded px-3 py-2">
            </div>
            <div>
              <label class="block text-sm font-semibold mb-1">Marriage Date</label>
              <input type="date" name="marriage_date" class="w-full border rounded px-3 py-2">
            </div>
            <div>
              <label class="block text-sm font-semibold mb-1">Marriage Certificate (Image or PDF)</label>
              <input type="file" name="marriage_certificate" accept="image/*,application/pdf" class="w-full border rounded px-3 py-2 bg-white">
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
            <input type="text" name="occupation" class="w-full border rounded px-3 py-2" placeholder="Software Engineer">
          </div>
          <div>
            <label class="block text-sm font-semibold mb-1">Employer Name (If Employed)</label>
            <input type="text" name="employer_name" class="w-full border rounded px-3 py-2" placeholder="ABC Corporation">
          </div>
          <div>
            <label class="block text-sm font-semibold mb-1">Employer Address</label>
            <input type="text" name="employer_address" class="w-full border rounded px-3 py-2" placeholder="Makati City">
          </div>
        </div>
      </div>

      <div id="beneficiarySectionContainer" class="space-y-4">
        <h2 class="text-xl font-bold text-blue-900 border-b pb-2">Step 6: Beneficiaries (For SSS & Pag-IBIG)</h2>
        <div id="beneficiariesList" class="space-y-4">
          <div class="beneficiary-item border p-4 rounded-lg bg-gray-50 relative space-y-3">
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
                <input type="text" name="ben_relationship[]" class="w-full border rounded px-3 py-2 bg-white" placeholder="Spouse / Child / Parent">
              </div>
              <div class="md:col-span-2">
                <label class="block text-xs font-semibold mb-1">Address</label>
                <input type="text" name="ben_address[]" class="w-full border rounded px-3 py-2 bg-white" placeholder="Address">
              </div>
              <div>
                <label class="block text-xs font-semibold mb-1">Contact Number</label>
                <input type="text" name="ben_contact[]" class="w-full border rounded px-3 py-2 bg-white" placeholder="Contact #">
              </div>
            </div>
          </div>
        </div>
        <button type="button" onclick="addBeneficiary()" class="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded text-sm font-semibold">+ Add Beneficiary</button>
      </div>

      <div class="space-y-4">
        <h2 class="text-xl font-bold text-blue-900 border-b pb-2">Step 7: Valid ID & Photos Upload</h2>
        <div class="grid md:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-semibold mb-1">Valid ID Type *</label>
            <select name="id_type" required class="w-full border rounded px-3 py-2">
              <option value="National ID">National ID</option>
              <option value="Passport">Passport</option>
              <option value="Driver's License">Driver's License</option>
              <option value="UMID">UMID</option>
              <option value="Postal ID">Postal ID</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-semibold mb-1">ID Picture / Profile Picture *</label>
            <input type="file" name="id_picture" accept="image/*" capture="user" required class="w-full border rounded px-3 py-2 bg-white">
            <span class="text-xs text-gray-500">Take selfie or upload ID photo.</span>
          </div>
          <div>
            <label class="block text-sm font-semibold mb-1">Upload Front of Valid ID *</label>
            <input type="file" name="id_front" accept="image/*,application/pdf" capture="environment" required class="w-full border rounded px-3 py-2 bg-white">
          </div>
          <div>
            <label class="block text-sm font-semibold mb-1">Upload Back of Valid ID</label>
            <input type="file" name="id_back" accept="image/*,application/pdf" capture="environment" class="w-full border rounded px-3 py-2 bg-white">
          </div>
          <div class="md:col-span-2">
            <label class="block text-sm font-semibold mb-1">Photo Holding Valid ID *</label>
            <input type="file" name="photo_holding_id" accept="image/*" capture="user" required class="w-full border rounded px-3 py-2 bg-white">
            <span class="text-xs text-gray-500">Clear photo of yourself holding your valid ID next to your face.</span>
          </div>
        </div>
      </div>

      <div class="space-y-4">
        <h2 class="text-xl font-bold text-blue-900 border-b pb-2">Step 8: Payment Method</h2>
        <div class="grid md:grid-cols-2 gap-4">
          <label class="border p-4 rounded-xl cursor-pointer hover:border-blue-600 block">
            <input type="radio" name="payment_method" value="GCash" required class="mb-2" checked>
            <span class="font-bold block">GCash Payment</span>
            <span class="text-xs text-gray-500 block mt-1">Scan admin QR code or send to GCash number, then upload proof.</span>
          </label>
          <label class="border p-4 rounded-xl cursor-pointer hover:border-blue-600 block">
            <input type="radio" name="payment_method" value="Cash" required class="mb-2">
            <span class="font-bold block">Cash Payment</span>
            <span class="text-xs text-gray-500 block mt-1">Pay over-the-counter or via authorized physical channels.</span>
          </label>
        </div>

        <div class="bg-blue-50 p-4 rounded-lg border border-blue-200">
          <h4 class="font-bold text-blue-900 text-sm mb-1">GCash Account Details:</h4>
          <p class="text-xs text-gray-700">Account Name: <strong>${settings.gcash_name}</strong></p>
          <p class="text-xs text-gray-700">Account Number: <strong>${settings.gcash_number}</strong></p>
          ${settings.gcash_qr ? `<div class="mt-2"><img src="${settings.gcash_qr}" class="h-32 w-32 object-contain border bg-white p-1 rounded"/></div>` : ''}
          <div class="mt-3">
            <label class="block text-xs font-semibold mb-1">Upload Proof of GCash Payment / Reference Number</label>
            <input type="file" name="proof_of_payment" accept="image/*,application/pdf" class="w-full border rounded px-3 py-2 bg-white">
            <input type="text" name="reference_number" placeholder="GCash Reference Number" class="w-full border rounded px-3 py-2 mt-2 bg-white text-xs">
          </div>
        </div>
      </div>

      <div class="pt-4 border-t">
        <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl text-lg shadow-lg">Submit Application & Generate Tracking Number</button>
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
        div.className = 'beneficiary-item border p-4 rounded-lg bg-gray-50 relative space-y-3';
        div.innerHTML = \`
          <div class="flex justify-between items-center">
            <h4 class="font-bold text-sm text-blue-900">Beneficiary \${beneficiaryCount}</h4>
            <button type="button" onclick="this.closest('.beneficiary-item').remove()" class="text-red-600 text-xs font-bold hover:underline">Remove</button>
          </div>
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
              <input type="text" name="ben_relationship[]" class="w-full border rounded px-3 py-2 bg-white" placeholder="Spouse / Child / Parent">
            </div>
            <div class="md:col-span-2">
              <label class="block text-xs font-semibold mb-1">Address</label>
              <input type="text" name="ben_address[]" class="w-full border rounded px-3 py-2 bg-white" placeholder="Address">
            </div>
            <div>
              <label class="block text-xs font-semibold mb-1">Contact Number</label>
              <input type="text" name="ben_contact[]" class="w-full border rounded px-3 py-2 bg-white" placeholder="Contact #">
            </div>
          </div>
        \`;
        container.appendChild(div);
      }

      function toggleServiceForm() {
        // Can customize fields shown per service if needed
      }
    </script>
  `;
  res.send(customerLayout('New Application', content, 'apply'));
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

      // Log Status History
      logStatusHistory(appId, 'Submitted', 'Application successfully submitted by customer.');
      addNotification(customerId, 'Application Submitted', `Your application ${trackingNumber} has been successfully submitted.`);

      // Save Beneficiaries if any
      if (body.ben_name && Array.isArray(body.ben_name)) {
        for (let i = 0; i < body.ben_name.length; i++) {
          if (body.ben_name[i]) {
            db.run(`INSERT INTO beneficiaries (application_id, full_name, birth_date, relationship, address, contact_number) VALUES (?, ?, ?, ?, ?, ?)`,
              [appId, body.ben_name[i], body.ben_dob[i], body.ben_relationship[i], body.ben_address[i], body.ben_contact[i]]);
          }
        }
      }

      // Save Documents
      if (files) {
        for (const [key, fileArr] of Object.entries(files)) {
          if (fileArr && fileArr[0]) {
            db.run(`INSERT INTO documents (application_id, doc_type, file_path, file_name) VALUES (?, ?, ?, ?)`,
              [appId, key, '/uploads/' + fileArr[0].filename, fileArr[0].originalname]);
          }
        }
      }

      // Record Payment
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
      <h1 class="text-3xl font-bold text-blue-900 mb-6">My Applications</h1>
      <div class="bg-white p-6 rounded-xl shadow">
        ${apps.length === 0 ? `<p class="text-gray-500">No applications found.</p>` : `
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
                    <td class="p-3"><a href="/customer/track/${app.id}" class="text-blue-600 font-semibold hover:underline">Track & Details</a></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    `;
    res.send(customerLayout('My Applications', content, 'applications'));
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
                <h1 class="text-3xl font-bold text-blue-900">Application Tracking</h1>
                <p class="text-sm text-gray-500 font-mono mt-1">Tracking Number: ${app.tracking_number}</p>
              </div>
              <a href="/customer/applications" class="bg-gray-200 hover:bg-gray-300 px-4 py-2 rounded text-sm font-semibold">&larr; Back to Applications</a>
            </div>

            <div class="grid md:grid-cols-3 gap-6 mb-8">
              <div class="bg-white p-6 rounded-xl shadow md:col-span-2 space-y-4">
                <div class="flex justify-between border-b pb-2">
                  <span class="font-semibold">Service:</span>
                  <span class="text-blue-900 font-bold">${app.service}</span>
                </div>
                <div class="flex justify-between border-b pb-2">
                  <span class="font-semibold">Current Status:</span>
                  <span class="px-2 py-1 bg-blue-100 text-blue-800 rounded font-bold text-xs">${app.status}</span>
                </div>
                <div class="flex justify-between border-b pb-2">
                  <span class="font-semibold">Payment Status:</span>
                  <span class="px-2 py-1 bg-amber-100 text-amber-800 rounded font-bold text-xs">${app.payment_status}</span>
                </div>
                <div class="flex justify-between border-b pb-2">
                  <span class="font-semibold">Submission Date:</span>
                  <span>${app.created_at}</span>
                </div>
                ${app.admin_remarks ? `
                  <div class="bg-amber-50 border-l-4 border-amber-500 p-4 text-amber-900 text-sm">
                    <strong>Admin Remarks / Correction Request:</strong>
                    <p class="mt-1">${app.admin_remarks}</p>
                  </div>
                ` : ''}
              </div>

              <div class="bg-white p-6 rounded-xl shadow space-y-4">
                <h3 class="font-bold text-blue-900 border-b pb-2">Completed Documents</h3>
                ${completedFiles.length === 0 ? `<p class="text-xs text-gray-500">No completed documents uploaded by admin yet.</p>` : `
                  <div class="space-y-3">
                    ${completedFiles.map(cf => `
                      <div class="border p-3 rounded bg-gray-50 text-xs space-y-1">
                        <p class="font-bold text-blue-900">${cf.file_name}</p>
                        <p class="text-gray-500">${cf.description || 'Processed file'}</p>
                        <a href="${cf.file_path}" target="_blank" class="block text-center bg-blue-600 hover:bg-blue-700 text-white py-1 rounded font-semibold mt-2">Download / View</a>
                      </div>
                    `).join('')}
                  </div>
                `}
              </div>
            </div>

            <div class="bg-white p-6 rounded-xl shadow mb-8">
              <h3 class="font-bold text-blue-900 text-lg mb-4">Tracking History</h3>
              <div class="space-y-4 border-l-2 border-blue-600 pl-4 ml-2">
                ${history.map(h => `
                  <div class="relative">
                    <div class="absolute -left-5 top-1.5 w-3 h-3 bg-blue-600 rounded-full"></div>
                    <p class="text-xs text-gray-500">${h.created_at}</p>
                    <p class="font-bold text-blue-900">${h.status}</p>
                    ${h.notes ? `<p class="text-sm text-gray-600">${h.notes}</p>` : ''}
                  </div>
                `).join('')}
              </div>
            </div>
          `;
          res.send(customerLayout('Application Tracking', content, 'applications'));
        });
      });
    });
  });
});

app.get('/customer/documents', requireCustomer, (req, res) => {
  const customerId = req.session.customer.id;
  db.all(`SELECT cf.*, a.tracking_number, a.service FROM completed_files cf JOIN applications a ON cf.application_id = a.id WHERE a.customer_id = ?`, [customerId], (err, files) => {
    const content = `
      <h1 class="text-3xl font-bold text-blue-900 mb-6">Completed Documents</h1>
      <div class="bg-white p-6 rounded-xl shadow">
        ${files.length === 0 ? `<p class="text-gray-500 text-sm">No completed documents available yet.</p>` : `
          <div class="grid md:grid-cols-2 gap-4">
            ${files.map(f => `
              <div class="border p-4 rounded-xl bg-gray-50 flex justify-between items-center">
                <div>
                  <span class="text-xs font-mono font-bold text-blue-600">${f.tracking_number} (${f.service})</span>
                  <h4 class="font-bold text-gray-900 text-base mt-1">${f.file_name}</h4>
                  <p class="text-xs text-gray-500">${f.description || 'Processed document'} &bull; ${f.uploaded_at}</p>
                </div>
                <a href="${f.file_path}" target="_blank" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm font-semibold">Download</a>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    `;
    res.send(customerLayout('Completed Documents', content, 'documents'));
  });
});

app.get('/customer/notifications', requireCustomer, (req, res) => {
  const customerId = req.session.customer.id;
  db.run(`UPDATE notifications SET is_read = 1 WHERE customer_id = ?`, [customerId]);
  db.all(`SELECT * FROM notifications WHERE customer_id = ? ORDER BY id DESC`, [customerId], (err, notifs) => {
    const content = `
      <h1 class="text-3xl font-bold text-blue-900 mb-6">Notifications</h1>
      <div class="bg-white p-6 rounded-xl shadow space-y-4">
        ${notifs.length === 0 ? `<p class="text-gray-500 text-sm">No notifications.</p>` : notifs.map(n => `
          <div class="border-b pb-4 flex justify-between items-start">
            <div>
              <h4 class="font-bold text-blue-900">${n.title}</h4>
              <p class="text-sm text-gray-600 mt-1">${n.message}</p>
            </div>
            <span class="text-xs text-gray-400">${n.created_at}</span>
          </div>
        `).join('')}
      </div>
    `;
    res.send(customerLayout('Notifications', content, 'notifications', 0));
  });
});

app.get('/customer/profile', requireCustomer, (req, res) => {
  const customerId = req.session.customer.id;
  db.get(`SELECT * FROM users WHERE id = ?`, [customerId], (err, user) => {
    const content = `
      <h1 class="text-3xl font-bold text-blue-900 mb-6">Customer Profile</h1>
      <form action="/customer/profile" method="POST" class="bg-white p-6 rounded-xl shadow max-w-lg space-y-4">
        <div>
          <label class="block text-sm font-semibold mb-1">Full Name</label>
          <input type="text" value="${user.full_name}" disabled class="w-full border rounded px-3 py-2 bg-gray-100 text-gray-600">
        </div>
        <div>
          <label class="block text-sm font-semibold mb-1">Username</label>
          <input type="text" value="${user.username}" disabled class="w-full border rounded px-3 py-2 bg-gray-100 text-gray-600">
        </div>
        <div>
          <label class="block text-sm font-semibold mb-1">Mobile Number</label>
          <input type="text" name="mobile_number" value="${user.mobile_number}" required class="w-full border rounded px-3 py-2">
        </div>
        <div>
          <label class="block text-sm font-semibold mb-1">Email Address</label>
          <input type="email" name="email_address" value="${user.email_address}" required class="w-full border rounded px-3 py-2">
        </div>
        <div>
          <label class="block text-sm font-semibold mb-1">New Password (leave blank to keep current)</label>
          <input type="password" name="password" class="w-full border rounded px-3 py-2">
        </div>
        <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded">Update Profile</button>
      </form>
    `;
    res.send(customerLayout('Profile', content, 'profile'));
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
// ADMIN PORTAL & DASHBOARD
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
    <body class="bg-gray-100 text-gray-800 font-sans">
      <div class="min-h-screen flex flex-col md:flex-row">
        <aside class="bg-gray-900 text-white w-full md:w-64 p-6 flex flex-col justify-between">
          <div>
            <div class="text-xl font-extrabold mb-8 flex items-center space-x-2">
              <span>Admin Portal</span>
            </div>
            <nav class="space-y-2">
              <a href="/admin/dashboard" class="block px-4 py-2 rounded ${activeTab === 'dashboard' ? 'bg-gray-800 font-bold' : 'hover:bg-gray-800'}">Dashboard</a>
              <a href="/admin/applications" class="block px-4 py-2 rounded ${activeTab === 'applications' ? 'bg-gray-800 font-bold' : 'hover:bg-gray-800'}">All Applications</a>
              <a href="/admin/payments" class="block px-4 py-2 rounded ${activeTab === 'payments' ? 'bg-gray-800 font-bold' : 'hover:bg-gray-800'}">Payments & Verification</a>
              <a href="/admin/settings" class="block px-4 py-2 rounded ${activeTab === 'settings' ? 'bg-gray-800 font-bold' : 'hover:bg-gray-800'}">Settings & Fees</a>
              <a href="/admin/backup" class="block px-4 py-2 rounded ${activeTab === 'backup' ? 'bg-gray-800 font-bold' : 'hover:bg-gray-800'}">Backup / Export</a>
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

app.get('/admin/dashboard', requireAdmin, (req, res) => {
  db.all(`SELECT a.*, u.full_name as customer_name FROM applications a JOIN users u ON a.customer_id = u.id`, [], (err, apps) => {
    db.all(`SELECT * FROM payments`, [], (err2, payments) => {
      db.all(`SELECT * FROM users`, [], (err3, users) => {

        const totalCustomers = users.length;
        const totalApplications = apps.length;
        const birApps = apps.filter(a => a.service === 'BIR / TIN').length;
        const sssApps = apps.filter(a => a.service === 'SSS').length;
        const pagibigApps = apps.filter(a => a.service === 'PAG-IBIG').length;
        const pendingApps = apps.filter(a => a.status === 'Submitted' || a.status === 'Under Review').length;
        const completedApps = apps.filter(a => a.status === 'Completed').length;
        const totalRevenue = payments.filter(p => p.payment_status === 'Verified').reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);

        const content = `
          <h1 class="text-3xl font-bold text-gray-900 mb-6">Admin Dashboard</h1>

          <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <div class="bg-white p-6 rounded-xl shadow border-l-4 border-blue-600">
              <h3 class="text-gray-500 text-sm font-medium">Total Customers</h3>
              <p class="text-3xl font-bold text-gray-900 mt-2">${totalCustomers}</p>
            </div>
            <div class="bg-white p-6 rounded-xl shadow border-l-4 border-indigo-600">
              <h3 class="text-gray-500 text-sm font-medium">Total Applications</h3>
              <p class="text-3xl font-bold text-indigo-600 mt-2">${totalApplications}</p>
            </div>
            <div class="bg-white p-6 rounded-xl shadow border-l-4 border-amber-500">
              <h3 class="text-gray-500 text-sm font-medium">Pending Applications</h3>
              <p class="text-3xl font-bold text-amber-600 mt-2">${pendingApps}</p>
            </div>
            <div class="bg-white p-6 rounded-xl shadow border-l-4 border-emerald-600">
              <h3 class="text-gray-500 text-sm font-medium">Total Revenue</h3>
              <p class="text-3xl font-bold text-emerald-600 mt-2">₱${totalRevenue.toLocaleString()}</p>
            </div>
          </div>

          <div class="grid md:grid-cols-3 gap-6 mb-8">
            <div class="bg-white p-6 rounded-xl shadow">
              <h3 class="font-bold text-gray-900 mb-2">Service Breakdown</h3>
              <ul class="space-y-2 text-sm">
                <li class="flex justify-between"><span>BIR / TIN:</span> <strong class="text-blue-900">${birApps}</strong></li>
                <li class="flex justify-between"><span>SSS:</span> <strong class="text-blue-900">${sssApps}</strong></li>
                <li class="flex justify-between"><span>Pag-IBIG:</span> <strong class="text-blue-900">${pagibigApps}</strong></li>
              </ul>
            </div>
            <div class="bg-white p-6 rounded-xl shadow md:col-span-2">
              <h3 class="font-bold text-gray-900 mb-2">Quick Actions</h3>
              <div class="flex gap-4">
                <a href="/admin/applications" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm font-semibold">Manage Applications</a>
                <a href="/admin/payments" class="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded text-sm font-semibold">Verify Payments</a>
                <a href="/admin/settings" class="bg-gray-800 hover:bg-gray-900 text-white px-4 py-2 rounded text-sm font-semibold">System Settings</a>
              </div>
            </div>
          </div>
        `;
        res.send(adminLayout('Dashboard', content, 'dashboard'));
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
      <h1 class="text-3xl font-bold text-gray-900 mb-6">Manage Applications</h1>

      <form action="/admin/applications" method="GET" class="bg-white p-4 rounded-xl shadow mb-6 grid md:grid-cols-4 gap-4">
        <div>
          <label class="block text-xs font-semibold mb-1">Search</label>
          <input type="text" name="search" value="${search}" placeholder="Name, Tracking #, etc." class="w-full border rounded px-3 py-2 text-sm">
        </div>
        <div>
          <label class="block text-xs font-semibold mb-1">Service</label>
          <select name="service" class="w-full border rounded px-3 py-2 text-sm">
            <option value="">All Services</option>
            <option value="BIR / TIN" ${serviceFilter === 'BIR / TIN' ? 'selected' : ''}>BIR / TIN</option>
            <option value="SSS" ${serviceFilter === 'SSS' ? 'selected' : ''}>SSS</option>
            <option value="PAG-IBIG" ${serviceFilter === 'PAG-IBIG' ? 'selected' : ''}>Pag-IBIG</option>
          </select>
        </div>
        <div>
          <label class="block text-xs font-semibold mb-1">Status</label>
          <select name="status" class="w-full border rounded px-3 py-2 text-sm">
            <option value="">All Statuses</option>
            <option value="Submitted" ${statusFilter === 'Submitted' ? 'selected' : ''}>Submitted</option>
            <option value="Under Review" ${statusFilter === 'Under Review' ? 'selected' : ''}>Under Review</option>
            <option value="Processing" ${statusFilter === 'Processing' ? 'selected' : ''}>Processing</option>
            <option value="Completed" ${statusFilter === 'Completed' ? 'selected' : ''}>Completed</option>
          </select>
        </div>
        <div class="flex items-end">
          <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded text-sm">Filter</button>
        </div>
      </form>

      <div class="bg-white p-6 rounded-xl shadow">
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="border-b bg-gray-50 text-xs text-gray-600 uppercase">
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
              ${apps.length === 0 ? `<tr><td colspan="7" class="p-4 text-center text-gray-500">No applications found.</td></tr>` : apps.map(app => `
                <tr class="border-b hover:bg-gray-50">
                  <td class="p-3 font-bold">${app.customer_name}</td>
                  <td class="p-3">${app.service}</td>
                  <td class="p-3 font-mono">${app.tracking_number}</td>
                  <td class="p-3"><span class="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs">${app.status}</span></td>
                  <td class="p-3"><span class="px-2 py-1 bg-amber-100 text-amber-800 rounded text-xs">${app.payment_status}</span></td>
                  <td class="p-3 text-xs text-gray-500">${app.created_at}</td>
                  <td class="p-3"><a href="/admin/applications/${app.id}" class="text-blue-600 font-semibold hover:underline">Review Profile</a></td>
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

// Detailed Applicant Profile & Document Viewer
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
                  <h1 class="text-3xl font-bold text-gray-900">Applicant Complete Profile</h1>
                  <p class="text-sm font-mono text-gray-500">Tracking: ${app.tracking_number} &bull; Service: ${app.service}</p>
                </div>
                <div class="space-x-2">
                  <a href="/admin/print/${app.id}" target="_blank" class="bg-gray-800 hover:bg-gray-900 text-white px-4 py-2 rounded text-sm font-semibold">Print Summary</a>
                  <a href="/admin/applications" class="bg-gray-200 hover:bg-gray-300 px-4 py-2 rounded text-sm font-semibold">&larr; Back</a>
                </div>
              </div>

              <div class="bg-white p-6 rounded-xl shadow mb-8">
                <h3 class="font-bold text-gray-900 mb-4">Application Controls & Status</h3>
                <form action="/admin/applications/${app.id}/status" method="POST" class="grid md:grid-cols-3 gap-4 items-end">
                  <div>
                    <label class="block text-xs font-semibold mb-1">Update Status</label>
                    <select name="status" class="w-full border rounded px-3 py-2 text-sm">
                      <option value="Submitted" ${app.status === 'Submitted' ? 'selected' : ''}>Submitted</option>
                      <option value="Under Review" ${app.status === 'Under Review' ? 'selected' : ''}>Under Review</option>
                      <option value="Need Correction" ${app.status === 'Need Correction' ? 'selected' : ''}>Need Correction</option>
                      <option value="Payment Pending" ${app.status === 'Payment Pending' ? 'selected' : ''}>Payment Pending</option>
                      <option value="Payment Verified" ${app.status === 'Payment Verified' ? 'selected' : ''}>Payment Verified</option>
                      <option value="Processing" ${app.status === 'Processing' ? 'selected' : ''}>Processing</option>
                      <option value="Ready" ${app.status === 'Ready' ? 'selected' : ''}>Ready</option>
                      <option value="Completed" ${app.status === 'Completed' ? 'selected' : ''}>Completed</option>
                      <option value="Rejected" ${app.status === 'Rejected' ? 'selected' : ''}>Rejected</option>
                    </select>
                  </div>
                  <div>
                    <label class="block text-xs font-semibold mb-1">Admin Remarks / Correction Request</label>
                    <input type="text" name="admin_remarks" value="${app.admin_remarks || ''}" placeholder="Message to customer..." class="w-full border rounded px-3 py-2 text-sm">
                  </div>
                  <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded text-sm">Save Status</button>
                </form>
              </div>

              <div class="bg-blue-50 border border-blue-200 p-6 rounded-xl shadow mb-8 space-y-4">
                <h3 class="font-bold text-blue-900 text-lg">Application Data to Enter into ${app.service} Form</h3>
                <div class="grid md:grid-cols-3 gap-4 text-sm bg-white p-4 rounded-lg">
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
                    <div class="md:col-span-3 border-t pt-2"><strong>Spouse:</strong> ${formData.spouse_name || 'N/A'} (DOB: ${formData.spouse_dob || 'N/A'}, Married: ${formData.marriage_date || 'N/A'})</div>
                  ` : ''}
                  <div class="md:col-span-3 border-t pt-2"><strong>Employment:</strong> ${formData.employment_status || ''} - ${formData.occupation || ''} (${formData.employer_name || 'N/A'})</div>
                </div>
              </div>

              <div class="bg-white p-6 rounded-xl shadow mb-8">
                <h3 class="font-bold text-gray-900 mb-4">Beneficiaries (${beneficiaries.length})</h3>
                ${beneficiaries.length === 0 ? `<p class="text-sm text-gray-500">No beneficiaries listed.</p>` : `
                  <div class="grid md:grid-cols-2 gap-4">
                    ${beneficiaries.map((b, idx) => `
                      <div class="border p-4 rounded-lg bg-gray-50 text-sm space-y-1">
                        <span class="font-bold text-blue-900">Beneficiary ${idx + 1}: ${b.full_name}</span>
                        <p class="text-xs text-gray-600">Relationship: <strong>${b.relationship}</strong> &bull; DOB: ${b.birth_date}</p>
                        <p class="text-xs text-gray-600">Address: ${b.address}</p>
                        <p class="text-xs text-gray-600">Contact: ${b.contact_number}</p>
                      </div>
                    `).join('')}
                  </div>
                `}
              </div>

              <div class="bg-white p-6 rounded-xl shadow mb-8">
                <h3 class="font-bold text-gray-900 mb-4">Submitted Valid ID & Documents</h3>
                <div class="grid md:grid-cols-3 gap-4">
                  ${documents.map(d => `
                    <div class="border p-4 rounded-lg bg-gray-50 space-y-2">
                      <span class="font-bold text-xs uppercase text-blue-900 block">${d.doc_type.replace(/_/g, ' ')}</span>
                      <p class="text-xs text-gray-500 truncate">${d.file_name}</p>
                      <a href="${d.file_path}" target="_blank" class="block text-center bg-blue-600 hover:bg-blue-700 text-white py-1.5 rounded text-xs font-semibold">Preview / Download</a>
                    </div>
                  `).join('')}
                </div>
              </div>

              <div class="bg-white p-6 rounded-xl shadow mb-8 space-y-4">
                <h3 class="font-bold text-gray-900">Payment Information</h3>
                ${payment ? `
                  <div class="grid md:grid-cols-3 gap-4 text-sm">
                    <div>Method: <strong>${payment.payment_method}</strong></div>
                    <div>Amount: <strong>₱${payment.amount}</strong></div>
                    <div>Reference #: <strong>${payment.reference_number || 'N/A'}</strong></div>
                    <div>Status: <span class="px-2 py-0.5 bg-amber-100 text-amber-800 rounded font-bold">${payment.payment_status}</span></div>
                    ${payment.proof_path ? `<div><a href="${payment.proof_path}" target="_blank" class="text-blue-600 font-semibold underline">View Proof of Payment</a></div>` : ''}
                  </div>
                  <form action="/admin/payments/${payment.id}/verify" method="POST" class="mt-4 flex gap-4 items-center">
                    <select name="payment_status" class="border rounded px-3 py-1.5 text-sm">
                      <option value="Pending Verification">Pending Verification</option>
                      <option value="Verified">Verified</option>
                      <option value="Rejected">Rejected</option>
                    </select>
                    <button type="submit" class="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-1.5 rounded text-sm">Update Payment Status</button>
                  </form>
                ` : `<p class="text-sm text-gray-500">No payment record found.</p>`}
              </div>

              <div class="bg-white p-6 rounded-xl shadow space-y-4">
                <h3 class="font-bold text-gray-900">Upload Completed Files for Customer</h3>
                <div class="space-y-2 mb-4">
                  ${completedFiles.map(cf => `
                    <div class="flex justify-between items-center border p-3 rounded bg-gray-50 text-sm">
                      <div><strong>${cf.file_name}</strong> - <span class="text-xs text-gray-500">${cf.description || 'Completed file'}</span></div>
                      <a href="${cf.file_path}" target="_blank" class="text-blue-600 font-semibold hover:underline">Download</a>
                    </div>
                  `).join('')}
                </div>
                <form action="/admin/applications/${app.id}/upload-completed" method="POST" enctype="multipart/form-data" class="grid md:grid-cols-3 gap-4 items-end border-t pt-4">
                  <div>
                    <label class="block text-xs font-semibold mb-1">Select Completed File</label>
                    <input type="file" name="completed_file" required class="w-full border rounded px-3 py-1.5 text-xs bg-gray-50">
                  </div>
                  <div>
                    <label class="block text-xs font-semibold mb-1">File Description</label>
                    <input type="text" name="description" placeholder="e.g. Official TIN ID / SSS E1 Copy" required class="w-full border rounded px-3 py-2 text-sm">
                  </div>
                  <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded text-sm">+ Upload Completed File</button>
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

// Update Application Status Route
app.post('/admin/applications/:id/status', requireAdmin, (req, res) => {
  const appId = req.params.id;
  const { status, admin_remarks } = req.body;

  db.get(`SELECT * FROM applications WHERE id = ?`, [appId], (err, app) => {
    if (app) {
      db.run(`UPDATE applications SET status = ?, admin_remarks = ? WHERE id = ?`, [status, admin_remarks, appId], () => {
        logStatusHistory(appId, status, admin_remarks);
        addNotification(app.customer_id, `Application Status Updated: ${status}`, admin_remarks || `Your application status is now ${status}.`);
        res.redirect(`/admin/applications/${appId}`);
      });
    } else {
      res.redirect('/admin/applications');
    }
  });
});

// Admin Upload Completed File Route
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

// Verify Payment Route
app.post('/admin/payments/:id/verify', requireAdmin, (req, res) => {
  const paymentId = req.params.id;
  const { payment_status } = req.body;

  db.get(`SELECT * FROM payments WHERE id = ?`, [paymentId], (err, payment) => {
    if (payment) {
      db.run(`UPDATE payments SET payment_status = ? WHERE id = ?`, [payment_status, paymentId], () => {
        db.run(`UPDATE applications SET payment_status = ? WHERE id = ?`, [payment_status, payment.application_id], () => {
          addNotification(payment.customer_id, `Payment Status: ${payment_status}`, `Your payment for tracking #${payment.tracking_number} has been marked as ${payment_status}.`);
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
      <h1 class="text-3xl font-bold text-gray-900 mb-6">Payment Verification</h1>
      <div class="bg-white p-6 rounded-xl shadow">
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="border-b bg-gray-50 text-xs text-gray-600 uppercase">
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
                <tr class="border-b hover:bg-gray-50">
                  <td class="p-3 font-bold">${p.full_name}</td>
                  <td class="p-3 font-mono">${p.tracking_number}</td>
                  <td class="p-3">${p.service}</td>
                  <td class="p-3">${p.payment_method}</td>
                  <td class="p-3 font-bold text-emerald-600">₱${p.amount}</td>
                  <td class="p-3"><span class="px-2 py-1 bg-amber-100 text-amber-800 rounded text-xs">${p.payment_status}</span></td>
                  <td class="p-3">
                    ${p.proof_path ? `<a href="${p.proof_path}" target="_blank" class="text-blue-600 font-semibold underline">View Proof</a>` : 'No proof'}
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

// Admin Settings & Fees
app.get('/admin/settings', requireAdmin, async (req, res) => {
  const settings = await getSettings();
  const content = `
    <h1 class="text-3xl font-bold text-gray-900 mb-6">System Settings & Configuration</h1>
    <form action="/admin/settings" method="POST" enctype="multipart/form-data" class="bg-white p-6 rounded-xl shadow space-y-6">
      <div class="grid md:grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-semibold mb-1">Business Name</label>
          <input type="text" name="business_name" value="${settings.business_name || ''}" required class="w-full border rounded px-3 py-2">
        </div>
        <div>
          <label class="block text-sm font-semibold mb-1">Contact Number</label>
          <input type="text" name="contact_number" value="${settings.contact_number || ''}" required class="w-full border rounded px-3 py-2">
        </div>
        <div>
          <label class="block text-sm font-semibold mb-1">Support Email</label>
          <input type="email" name="email" value="${settings.email || ''}" required class="w-full border rounded px-3 py-2">
        </div>
        <div>
          <label class="block text-sm font-semibold mb-1">Business Address</label>
          <input type="text" name="address" value="${settings.address || ''}" required class="w-full border rounded px-3 py-2">
        </div>
      </div>

      <div class="border-t pt-4 grid md:grid-cols-3 gap-4">
        <div>
          <label class="block text-sm font-semibold mb-1">BIR / TIN Processing Fee (₱)</label>
          <input type="number" name="fee_bir" value="${settings.fee_bir || 500}" required class="w-full border rounded px-3 py-2">
        </div>
        <div>
          <label class="block text-sm font-semibold mb-1">SSS Processing Fee (₱)</label>
          <input type="number" name="fee_sss" value="${settings.fee_sss || 400}" required class="w-full border rounded px-3 py-2">
        </div>
        <div>
          <label class="block text-sm font-semibold mb-1">Pag-IBIG Processing Fee (₱)</label>
          <input type="number" name="fee_pagibig" value="${settings.fee_pagibig || 400}" required class="w-full border rounded px-3 py-2">
        </div>
      </div>

      <div class="border-t pt-4 grid md:grid-cols-3 gap-4">
        <div>
          <label class="block text-sm font-semibold mb-1">GCash Account Name</label>
          <input type="text" name="gcash_name" value="${settings.gcash_name || ''}" required class="w-full border rounded px-3 py-2">
        </div>
        <div>
          <label class="block text-sm font-semibold mb-1">GCash Account Number</label>
          <input type="text" name="gcash_number" value="${settings.gcash_number || ''}" required class="w-full border rounded px-3 py-2">
        </div>
        <div>
          <label class="block text-sm font-semibold mb-1">Upload Business Logo</label>
          <input type="file" name="logo_file" accept="image/*" class="w-full border rounded px-3 py-1.5 text-xs bg-gray-50">
        </div>
      </div>

      <div>
        <label class="block text-sm font-semibold mb-1">Upload GCash QR Code Image</label>
        <input type="file" name="gcash_qr_file" accept="image/*" class="w-full border rounded px-3 py-1.5 text-xs bg-gray-50">
        ${settings.gcash_qr ? `<div class="mt-2"><img src="${settings.gcash_qr}" class="h-24 w-24 object-contain border p-1 bg-white rounded"/></div>` : ''}
      </div>

      <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-2 rounded">Save Settings</button>
    </form>
  `;
  res.send(adminLayout('Settings', content, 'settings'));
});

const settingsUpload = upload.fields([{ name: 'logo_file', maxCount: 1 }, { name: 'gcash_qr_file', maxCount: 1 }]);
app.post('/admin/settings', requireAdmin, settingsUpload, async (req, res) => {
  const body = req.body;
  const files = req.files;

  for (const [key, value] of Object.entries(body)) {
    db.run(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?`, [key, value, value]);
  }

  if (files && files['logo_file'] && files['logo_file'][0]) {
    const logoPath = '/uploads/' + files['logo_file'][0].filename;
    db.run(`INSERT INTO settings (key, value) VALUES ('logo_url', ?) ON CONFLICT(key) DO UPDATE SET value = ?`, [logoPath, logoPath]);
  }

  if (files && files['gcash_qr_file'] && files['gcash_qr_file'][0]) {
    const qrPath = '/uploads/' + files['gcash_qr_file'][0].filename;
    db.run(`INSERT INTO settings (key, value) VALUES ('gcash_qr', ?) ON CONFLICT(key) DO UPDATE SET value = ?`, [qrPath, qrPath]);
  }

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
          <p class="text-sm text-gray-600 mb-6 font-mono">Tracking Number: ${app.tracking_number} | Service: ${app.service} | Date: ${app.created_at}</p>

          <div class="space-y-6 text-sm">
            <div class="border p-4 rounded">
              <h3 class="font-bold border-b pb-1 mb-2">Personal Information</h3>
              <p><strong>Name:</strong> ${formData.first_name || ''} ${formData.middle_name || ''} ${formData.last_name || ''} ${formData.suffix || ''}</p>
              <p><strong>DOB:</strong> ${formData.date_of_birth || ''} &bull; <strong>Place of Birth:</strong> ${formData.place_of_birth || ''}</p>
              <p><strong>Sex:</strong> ${formData.sex || ''} &bull; <strong>Civil Status:</strong> ${formData.civil_status || ''} &bull; <strong>Nationality:</strong> ${formData.nationality || ''}</p>
            </div>

            <div class="border p-4 rounded">
              <h3 class="font-bold border-b pb-1 mb-2">Contact & Address</h3>
              <p><strong>Mobile:</strong> ${formData.mobile_number || ''} &bull; <strong>Email:</strong> ${formData.email_address || ''}</p>
              <p><strong>Address:</strong> ${formData.street || ''}, ${formData.barangay || ''}, ${formData.city || ''}, ${formData.province || ''} (${formData.zip_code || ''})</p>
            </div>

            <div class="border p-4 rounded">
              <h3 class="font-bold border-b pb-1 mb-2">Parents & Spouse</h3>
              <p><strong>Father:</strong> ${formData.father_name || ''} (${formData.father_dob || ''})</p>
              <p><strong>Mother:</strong> ${formData.mother_maiden_name || ''} (${formData.mother_dob || ''})</p>
              ${formData.spouse_name ? `<p><strong>Spouse:</strong> ${formData.spouse_name} (${formData.spouse_dob})</p>` : ''}
            </div>

            <div class="border p-4 rounded">
              <h3 class="font-bold border-b pb-1 mb-2">Beneficiaries (${beneficiaries.length})</h3>
              ${beneficiaries.map((b, i) => `<p>${i+1}. ${b.full_name} (${b.relationship}, DOB: ${b.birth_date})</p>`).join('')}
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
    res.send(JSON.stringify(apps, null, 2));
  });
});

// Start Server
app.listen(PORT, () => {
  console.log(`GovAssist PH running successfully on port ${PORT}`);
});
