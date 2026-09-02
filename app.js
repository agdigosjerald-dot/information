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
    console.log('Connected to the SQLite database successfully.');
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

    // Settings
    db.run(`CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )`, () => {
      const defaultSettings = {
        business_name: 'GovAssist PH - Application Assistance System',
        developer_name: 'Mark Jerald Agdigos',
        contact_number: '+63 912 345 6789',
        email: 'support@govassist.ph',
        address: 'Manila, Philippines',
        gcash_name: 'Mark Jerald Agdigos (Admin)',
        gcash_number: '09123456789',
        fee_bir: '500',
        fee_sss: '400',
        fee_pagibig: '400',
        payment_instructions: '1. Scan GCash QR or transfer to the number provided.\n2. Upload clear proof of payment.\n3. Wait for admin verification (usually within 24 hours).'
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

    // Documents Uploaded by Customer
    db.run(`CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id INTEGER,
      doc_type TEXT,
      file_path TEXT,
      file_name TEXT,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Completed Files Uploaded by Admin
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

// Middleware
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));
app.use('/uploads', express.static(uploadDir));

app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: __dirname }),
  secret: process.env.SESSION_SECRET || 'govassist_secure_secret_key_2026',
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

function addNotification(customerId, title, message) {
  db.run(`INSERT INTO notifications (customer_id, title, message) VALUES (?, ?, ?)`, [customerId, title, message]);
}

app.use(async (req, res, next) => {
  try {
    res.locals.settings = await getSettings();
    res.locals.customer = req.session.customer || null;
    res.locals.admin = req.session.admin || null;
    res.locals.lang = req.session.lang || 'en'; // Default English or Tagalog
    next();
  } catch (e) {
    next();
  }
});

// Dictionary for Language Toggle (English / Tagalog)
const dict = {
  en: {
    title: "GovAssist PH - Application Assistance",
    welcome: "Fast & Secure Government Application Assistance",
    subtitle: "We assist you with your BIR/TIN, SSS, and Pag-IBIG registrations and applications professionally.",
    getStarted: "Get Started Now",
    trackApp: "Track Application",
    login: "Login",
    register: "Register",
    logout: "Logout",
    dashboard: "Dashboard",
    newApp: "+ New Application",
    myApps: "My Applications",
    completedDocs: "Completed Documents",
    notifications: "Notifications",
    profile: "Profile",
    disclaimer: "Disclaimer: This platform is an independent application assistance, document collection, and tracking service. It is not officially affiliated with BIR, SSS, or Pag-IBIG."
  },
  tl: {
    title: "GovAssist PH - Tulong sa Pagsusumite ng Dokumento",
    welcome: "Mabilis at Ligtas na Tulong sa Pagsusumite ng Gobyerno",
    subtitle: "Tinutulungan ka namin sa pagpaparehistro at pag-aayos ng iyong BIR/TIN, SSS, at Pag-IBIG nang propesyonal.",
    getStarted: "Magsimula Na",
    trackApp: "I-track ang Aplikasyon",
    login: "Mag-login",
    register: "Magrehistro",
    logout: "Mag-logout",
    dashboard: "Dashboard",
    newApp: "+ Bagong Aplikasyon",
    myApps: "Aking mga Aplikasyon",
    completedDocs: "Tapos na mga Dokumento",
    notifications: "Mga Abiso",
    profile: "Profil",
    disclaimer: "Paalala: Ang platapormang ito ay tumutulong sa paghahanda at pagsusumite ng mga aplikasyon. Hindi ito opisyal na website ng BIR, SSS, o Pag-IBIG."
  }
};

// Language Toggle Route
app.get('/lang/:locale', (req, res) => {
  const locale = req.params.locale;
  if (locale === 'en' || locale === 'tl') {
    req.session.lang = locale;
  }
  res.redirect(req.get('referer') || '/');
});

// ==========================================
// LANDING PAGE & PUBLIC PORTAL
// ==========================================
app.get('/', async (req, res) => {
  const settings = res.locals.settings;
  const t = dict[res.locals.lang];
  res.send(`
    <!DOCTYPE html>
    <html lang="${res.locals.lang}">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${settings.business_name}</title>
      <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
    </head>
    <body class="bg-gradient-to-br from-slate-50 to-blue-50 text-gray-800 font-sans min-h-screen flex flex-col justify-between">
      <header class="bg-blue-900 text-white shadow-xl sticky top-0 z-50">
        <div class="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <div class="flex items-center space-x-3">
            <span class="text-2xl font-black tracking-wide">🏛️ GovAssist PH</span>
          </div>
          <div class="flex items-center space-x-4">
            <div class="text-xs bg-blue-800 px-3 py-1.5 rounded-full border border-blue-700">
              Developer: <strong class="text-amber-300">${settings.developer_name}</strong>
            </div>
            <div class="flex space-x-1 text-xs font-bold">
              <a href="/lang/en" class="px-2 py-1 rounded ${res.locals.lang === 'en' ? 'bg-white text-blue-900' : 'text-blue-200'}">EN</a>
              <a href="/lang/tl" class="px-2 py-1 rounded ${res.locals.lang === 'tl' ? 'bg-white text-blue-900' : 'text-blue-200'}">TL</a>
            </div>
            ${res.locals.customer ? `
              <a href="/customer/dashboard" class="px-4 py-2 bg-blue-700 hover:bg-blue-600 rounded-lg text-sm font-semibold shadow">${t.dashboard}</a>
            ` : `
              <a href="/customer/login" class="px-4 py-2 bg-blue-700 hover:bg-blue-600 rounded-lg text-sm font-semibold">${t.login}</a>
              <a href="/customer/register" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-sm font-semibold">${t.register}</a>
            `}
          </div>
        </div>
      </header>

      <main class="max-w-7xl mx-auto px-6 py-16 flex-1">
        <div class="text-center max-w-3xl mx-auto mb-16">
          <span class="bg-blue-100 text-blue-800 text-xs font-extrabold px-3 py-1 rounded-full uppercase tracking-wider">Online Assistance Portal</span>
          <h1 class="text-4xl md:text-5xl font-black text-blue-900 mt-4 mb-6 leading-tight">${t.welcome}</h1>
          <p class="text-lg text-gray-600 mb-8">${t.subtitle}</p>
          <div class="flex justify-center gap-4 flex-wrap">
            <a href="/customer/register" class="px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg transition transform hover:-translate-y-0.5">${t.getStarted}</a>
            <a href="/track-public" class="px-8 py-4 bg-white border border-gray-300 hover:bg-gray-100 text-blue-900 font-bold rounded-xl shadow transition">${t.trackApp}</a>
          </div>
        </div>

        <div class="grid md:grid-cols-3 gap-8 mb-16">
          <div class="bg-white p-8 rounded-2xl shadow-md border border-gray-100 text-center hover:shadow-xl transition">
            <div class="text-4xl mb-4">🏢</div>
            <h3 class="text-2xl font-bold text-blue-900 mb-3">BIR / TIN</h3>
            <p class="text-gray-600 text-sm leading-relaxed">Tax Identification Number registration assistance for employed, self-employed, and mixed-income earners. Fee: ₱${settings.fee_bir}</p>
          </div>
          <div class="bg-white p-8 rounded-2xl shadow-md border border-gray-100 text-center hover:shadow-xl transition">
            <div class="text-4xl mb-4">🛡️</div>
            <h3 class="text-2xl font-bold text-blue-900 mb-3">SSS Registration</h3>
            <p class="text-gray-600 text-sm leading-relaxed">Social Security System membership number application, beneficiary listing, and digital profile support. Fee: ₱${settings.fee_sss}</p>
          </div>
          <div class="bg-white p-8 rounded-2xl shadow-md border border-gray-100 text-center hover:shadow-xl transition">
            <div class="text-4xl mb-4">🏠</div>
            <h3 class="text-2xl font-bold text-blue-900 mb-3">Pag-IBIG Fund</h3>
            <p class="text-gray-600 text-sm leading-relaxed">HDMF MID number application assistance, membership registration, and contribution record support. Fee: ₱${settings.fee_pagibig}</p>
          </div>
        </div>

        <div class="bg-amber-50 border-l-4 border-amber-500 p-6 rounded-r-2xl text-amber-900 text-xs md:text-sm shadow-sm">
          <strong>${t.disclaimer}</strong>
        </div>
      </main>

      <footer class="bg-gray-900 text-gray-400 py-8 text-center text-sm border-t border-gray-800">
        <p>&copy; 2026 ${settings.business_name}. Created by <strong>${settings.developer_name}</strong>. All rights reserved.</p>
      </footer>
    </body>
    </html>
  `);
});

// Public Tracking Page
app.get('/track-public', (req, res) => {
  const trackingNumber = (req.query.tracking_number || '').trim();
  let searchResult = null;
  let errorMessage = null;

  if (trackingNumber) {
    db.get(`SELECT * FROM applications WHERE tracking_number = ?`, [trackingNumber], (err, app) => {
      if (app) {
        db.all(`SELECT * FROM documents WHERE application_id = ?`, [app.id], (err2, docs) => {
          db.all(`SELECT * FROM completed_files WHERE application_id = ?`, [app.id], (err3, completedFiles) => {
            renderTracking(res, trackingNumber, app, docs, completedFiles, null);
          });
        });
      } else {
        renderTracking(res, trackingNumber, null, [], [], 'Application tracking number not found.');
      }
    });
  } else {
    renderTracking(res, '', null, [], [], null);
  }
});

function renderTracking(res, trackingNumber, app, docs, completedFiles, error) {
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
      <div class="max-w-2xl mx-auto px-4 py-12 w-full">
        <div class="text-center mb-8">
          <h1 class="text-3xl font-black text-blue-900">Track Your Application</h1>
          <p class="text-sm text-gray-600 mt-2">Enter your unique tracking number below to check real-time status.</p>
        </div>
        <form action="/track-public" method="GET" class="bg-white p-8 rounded-2xl shadow-lg space-y-4 mb-8">
          <div>
            <label class="block text-sm font-semibold mb-2">Tracking Number</label>
            <input type="text" name="tracking_number" value="${trackingNumber}" required placeholder="e.g. TIN-20260902-1234" class="w-full border rounded-xl px-4 py-3 uppercase font-mono text-lg focus:ring-2 focus:ring-blue-500">
          </div>
          <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl shadow transition">Search Status</button>
        </form>

        ${error ? `<div class="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl mb-6 text-center text-sm">${error}</div>` : ''}

        ${app ? `
          <div class="bg-white p-8 rounded-2xl shadow-lg space-y-6">
            <div class="flex justify-between items-center border-b pb-4">
              <div>
                <span class="text-xs text-gray-500 block">Tracking Number</span>
                <span class="text-lg font-mono font-bold text-blue-900">${app.tracking_number}</span>
              </div>
              <span class="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-bold">${app.status}</span>
            </div>
            <div class="grid grid-cols-2 gap-4 text-sm">
              <div><strong class="text-gray-500 block">Service:</strong> ${app.service}</div>
              <div><strong class="text-gray-500 block">Payment Status:</strong> <span class="text-amber-600 font-bold">${app.payment_status}</span></div>
              <div><strong class="text-gray-500 block">Date Submitted:</strong> ${app.created_at}</div>
              <div><strong class="text-gray-500 block">Admin Remarks:</strong> ${app.admin_remarks || 'None yet'}</div>
            </div>

            <div class="border-t pt-4">
              <h3 class="font-bold text-blue-900 mb-2">Uploaded Documents (${docs.length})</h3>
              <ul class="list-disc list-inside text-sm text-gray-600 space-y-1">
                ${docs.map(d => `<li>${d.doc_type}: <a href="/${d.file_path}" target="_blank" class="text-blue-600 hover:underline">View File</a></li>`).join('')}
              </ul>
            </div>

            <div class="border-t pt-4">
              <h3 class="font-bold text-emerald-800 mb-2">Completed Government Files (${completedFiles.length})</h3>
              ${completedFiles.length === 0 ? `<p class="text-sm text-gray-500">Processing in progress. Completed forms will appear here.</p>` : `
                <ul class="space-y-2">
                  ${completedFiles.map(cf => `<li class="bg-emerald-50 p-3 rounded-lg flex justify-between items-center text-sm"><span>${cf.file_name}</span> <a href="/${cf.file_path}" target="_blank" class="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1 rounded text-xs font-bold">Download</a></li>`).join('')}
                </ul>
              `}
            </div>
          </div>
        ` : ''}

        <div class="text-center mt-8">
          <a href="/" class="text-blue-600 hover:underline text-sm font-semibold">&larr; Back to Home</a>
        </div>
      </div>
      <footer class="bg-gray-900 text-gray-400 py-6 text-center text-sm">
        <p>&copy; 2026 GovAssist PH. Developed by Mark Jerald Agdigos.</p>
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
    <body class="bg-gray-100 flex items-center justify-center min-h-screen p-4">
      <div class="bg-white w-full max-w-md p-8 rounded-2xl shadow-xl">
        <h2 class="text-2xl font-black text-blue-900 mb-6 text-center">Customer Registration</h2>
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
          <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl shadow">Register Account</button>
        </form>
        <p class="text-center text-sm mt-6 text-gray-600">Already have an account? <a href="/customer/login" class="text-blue-600 font-bold hover:underline">Login here</a></p>
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
    <body class="bg-gray-100 flex items-center justify-center min-h-screen p-4">
      <div class="bg-white w-full max-w-md p-8 rounded-2xl shadow-xl">
        <h2 class="text-2xl font-black text-blue-900 mb-6 text-center">Customer Login</h2>
        <form action="/customer/login" method="POST" class="space-y-4">
          <div>
            <label class="block text-sm font-semibold mb-1">Username</label>
            <input type="text" name="username" required class="w-full border rounded-xl px-4 py-2.5">
          </div>
          <div>
            <label class="block text-sm font-semibold mb-1">Password</label>
            <input type="password" name="password" required class="w-full border rounded-xl px-4 py-2.5">
          </div>
          <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl shadow">Login</button>
        </form>
        <p class="text-center text-sm mt-6 text-gray-600">Don't have an account? <a href="/customer/register" class="text-blue-600 font-bold hover:underline">Register here</a></p>
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
        <h2 class="text-2xl font-black text-gray-900 mb-2 text-center">Admin Portal Login</h2>
        <p class="text-xs text-center text-gray-500 mb-6">System created by Mark Jerald Agdigos</p>
        <form action="/admin/login" method="POST" class="space-y-4">
          <div>
            <label class="block text-sm font-semibold mb-1">Admin Username</label>
            <input type="text" name="username" required class="w-full border rounded-xl px-4 py-2.5">
          </div>
          <div>
            <label class="block text-sm font-semibold mb-1">Password</label>
            <input type="password" name="password" required class="w-full border rounded-xl px-4 py-2.5">
          </div>
          <button type="submit" class="w-full bg-gray-900 hover:bg-gray-800 text-white font-bold py-3 rounded-xl shadow">Login to Admin Portal</button>
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

// Middleware for auth check
function requireCustomer(req, res, next) {
  if (!req.session.customer) return res.redirect('/customer/login');
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.admin) return res.redirect('/admin/login');
  next();
}

// ==========================================
// CUSTOMER PORTAL & DASHBOARD (15+ Features)
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
        <aside class="bg-blue-900 text-white w-full md:w-64 p-6 flex flex-col justify-between shadow-xl">
          <div>
            <div class="text-xl font-black mb-2 tracking-wide">🏛️ GovAssist PH</div>
            <div class="text-xs text-amber-300 mb-8 font-semibold">Dev: Mark Jerald Agdigos</div>
            <nav class="space-y-1.5 text-sm">
              <a href="/customer/dashboard" class="block px-4 py-2.5 rounded-xl ${activeTab === 'dashboard' ? 'bg-blue-800 font-bold shadow' : 'hover:bg-blue-800'}">📊 Dashboard</a>
              <a href="/customer/apply" class="block px-4 py-2.5 rounded-xl ${activeTab === 'apply' ? 'bg-blue-800 font-bold shadow' : 'hover:bg-blue-800'}">📝 + New Application</a>
              <a href="/customer/applications" class="block px-4 py-2.5 rounded-xl ${activeTab === 'applications' ? 'bg-blue-800 font-bold shadow' : 'hover:bg-blue-800'}">📂 My Applications</a>
              <a href="/customer/documents" class="block px-4 py-2.5 rounded-xl ${activeTab === 'documents' ? 'bg-blue-800 font-bold shadow' : 'hover:bg-blue-800'}">📥 Completed Documents</a>
              <a href="/customer/notifications" class="block px-4 py-2.5 rounded-xl ${activeTab === 'notifications' ? 'bg-blue-800 font-bold shadow' : 'hover:bg-blue-800'}">🔔 Notifications ${unreadCount > 0 ? `<span class="bg-red-500 text-white px-2 py-0.5 rounded-full text-xs">${unreadCount}</span>` : ''}</a>
              <a href="/customer/profile" class="block px-4 py-2.5 rounded-xl ${activeTab === 'profile' ? 'bg-blue-800 font-bold shadow' : 'hover:bg-blue-800'}">⚙️ Profile Settings</a>
            </nav>
          </div>
          <div class="mt-8 pt-4 border-t border-blue-800">
            <span class="block text-xs text-blue-200 mb-2 truncate">User: <strong>${customerName}</strong></span>
            <a href="/customer/logout" class="block text-center bg-red-600 hover:bg-red-700 text-white py-2 rounded-xl text-xs font-bold shadow">Logout</a>
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
        <h1 class="text-3xl font-black text-blue-900 mb-6">Customer Dashboard</h1>
        
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div class="bg-white p-6 rounded-2xl shadow border-l-4 border-blue-600">
            <h3 class="text-gray-500 text-xs font-bold uppercase">Total Applications</h3>
            <p class="text-3xl font-black text-blue-900 mt-2">${totalApps}</p>
          </div>
          <div class="bg-white p-6 rounded-2xl shadow border-l-4 border-amber-500">
            <h3 class="text-gray-500 text-xs font-bold uppercase">Pending / In Progress</h3>
            <p class="text-3xl font-black text-amber-600 mt-2">${pendingApps}</p>
          </div>
          <div class="bg-white p-6 rounded-2xl shadow border-l-4 border-emerald-600">
            <h3 class="text-gray-500 text-xs font-bold uppercase">Completed</h3>
            <p class="text-3xl font-black text-emerald-600 mt-2">${completedApps}</p>
          </div>
        </div>

        <div class="bg-white p-8 rounded-2xl shadow mb-8">
          <div class="flex justify-between items-center mb-6">
            <h2 class="text-xl font-bold text-blue-900">Recent Applications</h2>
            <a href="/customer/apply" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-bold shadow">+ New Application</a>
          </div>
          ${apps.length === 0 ? `<p class="text-gray-500 text-sm">No applications submitted yet.</p>` : `
            <div class="overflow-x-auto">
              <table class="w-full text-left border-collapse">
                <thead>
                  <tr class="border-b bg-gray-50 text-xs text-gray-500 uppercase">
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
                      <td class="p-3 font-semibold">${app.service}</td>
                      <td class="p-3"><span class="px-2.5 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-bold">${app.status}</span></td>
                      <td class="p-3"><span class="px-2.5 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-bold">${app.payment_status}</span></td>
                      <td class="p-3"><a href="/customer/track/${app.id}" class="text-blue-600 font-bold hover:underline">View</a></td>
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

// Application Form Wizard (All required uploads included)
app.get('/customer/apply', requireCustomer, async (req, res) => {
  const settings = res.locals.settings;
  const content = `
    <h1 class="text-3xl font-black text-blue-900 mb-6">New Government Application</h1>
    <form action="/customer/apply" method="POST" enctype="multipart/form-data" class="bg-white p-8 rounded-2xl shadow-xl space-y-8" id="appForm">
      
      <div class="space-y-4">
        <h2 class="text-xl font-bold text-blue-900 border-b pb-2">Step 1: Select Government Service</h2>
        <div class="grid md:grid-cols-3 gap-4">
          <label class="border-2 p-5 rounded-2xl cursor-pointer hover:border-blue-600 flex flex-col justify-between transition">
            <div>
              <input type="radio" name="service" value="BIR / TIN" required class="mb-3">
              <span class="font-black block text-lg text-blue-900">BIR / TIN</span>
              <span class="text-xs text-gray-500">Tax Identification Number registration. Fee: ₱${settings.fee_bir}</span>
            </div>
          </label>
          <label class="border-2 p-5 rounded-2xl cursor-pointer hover:border-blue-600 flex flex-col justify-between transition">
            <div>
              <input type="radio" name="service" value="SSS" required class="mb-3">
              <span class="font-black block text-lg text-blue-900">SSS</span>
              <span class="text-xs text-gray-500">Social Security System registration & beneficiaries. Fee: ₱${settings.fee_sss}</span>
            </div>
          </label>
          <label class="border-2 p-5 rounded-2xl cursor-pointer hover:border-blue-600 flex flex-col justify-between transition">
            <div>
              <input type="radio" name="service" value="PAG-IBIG" required class="mb-3">
              <span class="font-black block text-lg text-blue-900">Pag-IBIG</span>
              <span class="text-xs text-gray-500">HDMF membership & housing fund registration. Fee: ₱${settings.fee_pagibig}</span>
            </div>
          </label>
        </div>
      </div>

      <div class="space-y-4">
        <h2 class="text-xl font-bold text-blue-900 border-b pb-2">Step 2: Personal Information</h2>
        <div class="grid md:grid-cols-3 gap-4">
          <div>
            <label class="block text-xs font-bold uppercase mb-1">First Name *</label>
            <input type="text" name="first_name" required class="w-full border rounded-xl px-4 py-2.5" placeholder="Juan">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase mb-1">Middle Name</label>
            <input type="text" name="middle_name" class="w-full border rounded-xl px-4 py-2.5" placeholder="Santos">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase mb-1">Last Name *</label>
            <input type="text" name="last_name" required class="w-full border rounded-xl px-4 py-2.5" placeholder="Dela Cruz">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase mb-1">Suffix</label>
            <input type="text" name="suffix" class="w-full border rounded-xl px-4 py-2.5" placeholder="Jr., III">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase mb-1">Date of Birth *</label>
            <input type="date" name="date_of_birth" required class="w-full border rounded-xl px-4 py-2.5">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase mb-1">Place of Birth *</label>
            <input type="text" name="place_of_birth" required class="w-full border rounded-xl px-4 py-2.5" placeholder="Manila">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase mb-1">Sex *</label>
            <select name="sex" required class="w-full border rounded-xl px-4 py-2.5">
              <option value="Male">Male</option>
              <option value="Female">Female</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-bold uppercase mb-1">Civil Status *</label>
            <select name="civil_status" id="civilStatus" required class="w-full border rounded-xl px-4 py-2.5" onchange="toggleMarriage()">
              <option value="Single">Single</option>
              <option value="Married">Married</option>
              <option value="Widowed">Widowed</option>
              <option value="Separated">Separated</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-bold uppercase mb-1">Nationality *</label>
            <input type="text" name="nationality" value="Filipino" required class="w-full border rounded-xl px-4 py-2.5">
          </div>
        </div>
      </div>

      <div class="space-y-4">
        <h2 class="text-xl font-bold text-blue-900 border-b pb-2">Step 3: Contact & Address Information</h2>
        <div class="grid md:grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-bold uppercase mb-1">Mobile Number *</label>
            <input type="text" name="mobile_number" required class="w-full border rounded-xl px-4 py-2.5" placeholder="09123456789">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase mb-1">Email Address *</label>
            <input type="email" name="email_address" required class="w-full border rounded-xl px-4 py-2.5" placeholder="juan@example.com">
          </div>
        </div>
        <div class="grid md:grid-cols-3 gap-4">
          <div>
            <label class="block text-xs font-bold uppercase mb-1">House/Unit & Street *</label>
            <input type="text" name="street" required class="w-full border rounded-xl px-4 py-2.5" placeholder="123 Rizal St">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase mb-1">Barangay *</label>
            <input type="text" name="barangay" required class="w-full border rounded-xl px-4 py-2.5" placeholder="Brgy San Antonio">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase mb-1">City / Municipality *</label>
            <input type="text" name="city" required class="w-full border rounded-xl px-4 py-2.5" placeholder="Quezon City">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase mb-1">Province *</label>
            <input type="text" name="province" required class="w-full border rounded-xl px-4 py-2.5" placeholder="Metro Manila">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase mb-1">ZIP Code *</label>
            <input type="text" name="zip_code" required class="w-full border rounded-xl px-4 py-2.5" placeholder="1100">
          </div>
        </div>
      </div>

      <div class="space-y-4">
        <h2 class="text-xl font-bold text-blue-900 border-b pb-2">Step 4: Parents & Spouse Information</h2>
        <div class="grid md:grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-bold uppercase mb-1">Father's Full Name *</label>
            <input type="text" name="father_name" required class="w-full border rounded-xl px-4 py-2.5">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase mb-1">Father's Date of Birth *</label>
            <input type="date" name="father_dob" required class="w-full border rounded-xl px-4 py-2.5">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase mb-1">Mother's Maiden Full Name *</label>
            <input type="text" name="mother_maiden_name" required class="w-full border rounded-xl px-4 py-2.5">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase mb-1">Mother's Date of Birth *</label>
            <input type="date" name="mother_dob" required class="w-full border rounded-xl px-4 py-2.5">
          </div>
        </div>

        <div id="marriageBox" class="hidden p-5 bg-gray-50 border rounded-2xl space-y-4 mt-4">
          <h3 class="font-bold text-blue-900">Spouse Details (For Married Applicants)</h3>
          <div class="grid md:grid-cols-2 gap-4">
            <div>
              <label class="block text-xs font-bold uppercase mb-1">Spouse Full Name</label>
              <input type="text" name="spouse_name" class="w-full border rounded-xl px-4 py-2.5 bg-white">
            </div>
            <div>
              <label class="block text-xs font-bold uppercase mb-1">Spouse Date of Birth</label>
              <input type="date" name="spouse_dob" class="w-full border rounded-xl px-4 py-2.5 bg-white">
            </div>
          </div>
        </div>
      </div>

      <div class="space-y-4">
        <h2 class="text-xl font-bold text-blue-900 border-b pb-2">Step 5: Beneficiaries (For SSS & Pag-IBIG)</h2>
        <div id="benContainer" class="space-y-4">
          <div class="border p-5 rounded-2xl bg-gray-50 space-y-3">
            <h4 class="font-bold text-xs text-blue-900 uppercase">Beneficiary 1</h4>
            <div class="grid md:grid-cols-3 gap-3">
              <div><label class="block text-xs font-semibold mb-1">Full Name</label><input type="text" name="ben_name[]" class="w-full border rounded-xl px-3 py-2 bg-white"></div>
              <div><label class="block text-xs font-semibold mb-1">Date of Birth</label><input type="date" name="ben_dob[]" class="w-full border rounded-xl px-3 py-2 bg-white"></div>
              <div><label class="block text-xs font-semibold mb-1">Relationship</label><input type="text" name="ben_relationship[]" class="w-full border rounded-xl px-3 py-2 bg-white"></div>
            </div>
          </div>
        </div>
        <button type="button" onclick="addBeneficiary()" class="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs font-bold">+ Add Beneficiary</button>
      </div>

      <div class="space-y-4">
        <h2 class="text-xl font-bold text-blue-900 border-b pb-2">Step 6: Required Document Uploads (Required)</h2>
        <div class="grid md:grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-bold uppercase mb-1">ID Type *</label>
            <select name="id_type" required class="w-full border rounded-xl px-4 py-2.5">
              <option value="National ID">National ID</option>
              <option value="Passport">Passport</option>
              <option value="Driver's License">Driver's License</option>
              <option value="UMID">UMID</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-bold uppercase mb-1">ID Picture / Selfie *</label>
            <input type="file" name="id_picture" accept="image/*" required class="w-full border rounded-xl px-3 py-2 bg-white">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase mb-1">Front of Valid ID *</label>
            <input type="file" name="id_front" accept="image/*,application/pdf" required class="w-full border rounded-xl px-3 py-2 bg-white">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase mb-1">Back of Valid ID *</label>
            <input type="file" name="id_back" accept="image/*,application/pdf" required class="w-full border rounded-xl px-3 py-2 bg-white">
          </div>
          <div class="md:col-span-2">
            <label class="block text-xs font-bold uppercase mb-1">Photo Holding Valid ID *</label>
            <input type="file" name="photo_holding_id" accept="image/*" required class="w-full border rounded-xl px-3 py-2 bg-white">
          </div>
        </div>
      </div>

      <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-black py-4 rounded-2xl shadow-xl text-lg transition">Submit Application & Proceed to Payment</button>
    </form>

    <script>
      function toggleMarriage() {
        const val = document.getElementById('civilStatus').value;
        const box = document.getElementById('marriageBox');
        if (val === 'Married') box.classList.remove('hidden');
        else box.classList.add('hidden');
      }
      function addBeneficiary() {
        const container = document.getElementById('benContainer');
        const div = document.createElement('div');
        div.className = 'border p-5 rounded-2xl bg-gray-50 space-y-3';
        div.innerHTML = \`<h4 class="font-bold text-xs text-blue-900 uppercase">Beneficiary</h4>
          <div class="grid md:grid-cols-3 gap-3">
            <div><label class="block text-xs font-semibold mb-1">Full Name</label><input type="text" name="ben_name[]" class="w-full border rounded-xl px-3 py-2 bg-white"></div>
            <div><label class="block text-xs font-semibold mb-1">Date of Birth</label><input type="date" name="ben_dob[]" class="w-full border rounded-xl px-3 py-2 bg-white"></div>
            <div><label class="block text-xs font-semibold mb-1">Relationship</label><input type="text" name="ben_relationship[]" class="w-full border rounded-xl px-3 py-2 bg-white"></div>
          </div>\`;
        container.appendChild(div);
      }
    </script>
  `;
  res.send(customerLayout('New Application', content, 'apply', 0, req.session));
});

// Handle Application Submission & File Uploads
const uploadFields = upload.fields([
  { name: 'id_picture', maxCount: 1 },
  { name: 'id_front', maxCount: 1 },
  { name: 'id_back', maxCount: 1 },
  { name: 'photo_holding_id', maxCount: 1 },
  { name: 'marriage_certificate', maxCount: 1 }
]);

app.post('/customer/apply', requireCustomer, uploadFields, async (req, res) => {
  const customerId = req.session.customer.id;
  const { service, first_name, last_name } = req.body;
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randomNum = Math.floor(1000 + Math.random() * 9000);
  const trackingNumber = service.substring(0, 3).toUpperCase() + '-' + dateStr + '-' + randomNum;

  const dataJson = JSON.stringify(req.body);

  db.run(`INSERT INTO applications (customer_id, service, tracking_number, data_json) VALUES (?, ?, ?, ?)`,
    [customerId, service, trackingNumber, dataJson], function(err) {
      if (err) {
        return res.send(`<script>alert('Error creating application!'); window.history.back();</script>`);
      }
      const appId = this.lastID;

      // Save Beneficiaries if any
      if (req.body.ben_name) {
        const names = req.body.ben_name;
        const dobs = req.body.ben_dob;
        const rels = req.body.ben_relationship;
        for (let i = 0; i < names.length; i++) {
          if (names[i]) {
            db.run(`INSERT INTO beneficiaries (application_id, full_name, birth_date, relationship) VALUES (?, ?, ?, ?)`,
              [appId, names[i], dobs[i], rels[i]]);
          }
        }
      }

      // Save Uploaded Files
      if (req.files) {
        for (const [key, files] of Object.entries(req.files)) {
          if (files && files[0]) {
            db.run(`INSERT INTO documents (application_id, doc_type, file_path, file_name) VALUES (?, ?, ?, ?)`,
              [appId, key, files[0].path, files[0].originalname]);
          }
        }
      }

      addNotification(customerId, 'Application Submitted', `Your application for ${service} has been successfully submitted with tracking #${trackingNumber}.`);
      res.redirect(`/customer/payment/${appId}`);
    });
});

// Payment Page
app.get('/customer/payment/:id', requireCustomer, async (req, res) => {
  const appId = req.params.id;
  const settings = res.locals.settings;
  db.get(`SELECT * FROM applications WHERE id = ? AND customer_id = ?`, [appId, req.session.customer.id], (err, app) => {
    if (!app) return res.redirect('/customer/dashboard');

    let fee = settings.fee_bir;
    if (app.service === 'SSS') fee = settings.fee_sss;
    if (app.service === 'PAG-IBIG') fee = settings.fee_pagibig;

    const content = `
      <h1 class="text-3xl font-black text-blue-900 mb-6">Payment Verification - ${app.tracking_number}</h1>
      <div class="grid md:grid-cols-2 gap-8">
        <div class="bg-white p-8 rounded-2xl shadow-xl space-y-4">
          <h2 class="text-xl font-bold text-blue-900 border-b pb-2">GCash Payment Details</h2>
          <p class="text-sm text-gray-600">Please send the exact amount of <strong>₱${fee}</strong> to our official GCash account:</p>
          <div class="bg-blue-50 p-4 rounded-xl border border-blue-200 text-blue-900 font-mono text-center">
            <span class="block text-xs uppercase text-gray-500 font-sans">Account Name</span>
            <strong class="text-lg">${settings.gcash_name || 'Mark Jerald Agdigos'}</strong>
            <span class="block text-xs uppercase text-gray-500 font-sans mt-2">GCash Number</span>
            <strong class="text-xl">${settings.gcash_number || '09123456789'}</strong>
          </div>
          <div class="text-xs text-gray-500 space-y-1">
            ${settings.payment_instructions.replace(/\n/g, '<br>')}
          </div>
        </div>

        <div class="bg-white p-8 rounded-2xl shadow-xl">
          <h2 class="text-xl font-bold text-blue-900 border-b pb-2 mb-4">Upload Proof of Payment</h2>
          <form action="/customer/payment/${app.id}" method="POST" enctype="multipart/form-data" class="space-y-4">
            <div>
              <label class="block text-xs font-bold uppercase mb-1">Reference Number *</label>
              <input type="text" name="reference_number" required class="w-full border rounded-xl px-4 py-2.5 font-mono" placeholder="GCash Ref No.">
            </div>
            <div>
              <label class="block text-xs font-bold uppercase mb-1">Proof of Payment Screenshot *</label>
              <input type="file" name="proof_path" accept="image/*,application/pdf" required class="w-full border rounded-xl px-3 py-2 bg-white">
            </div>
            <input type="hidden" name="amount" value="${fee}">
            <button type="submit" class="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl shadow">Submit Payment Proof</button>
          </form>
        </div>
      </div>
    `;
    res.send(customerLayout('Payment', content, 'applications', 0, req.session));
  });
});

app.post('/customer/payment/:id', requireCustomer, upload.single('proof_path'), async (req, res) => {
  const appId = req.params.id;
  const { reference_number, amount } = req.body;
  const proofPath = req.file ? req.file.path : '';

  db.get(`SELECT * FROM applications WHERE id = ?`, [appId], (err, app) => {
    if (app) {
      db.run(`INSERT INTO payments (customer_id, application_id, tracking_number, service, payment_method, amount, reference_number, proof_path) VALUES (?, ?, ?, ?, 'GCash', ?, ?, ?)`,
        [req.session.customer.id, appId, app.tracking_number, app.service, amount, reference_number, proofPath]);
      
      db.run(`UPDATE applications SET payment_status = 'Pending Verification' WHERE id = ?`, [appId]);
      addNotification(req.session.customer.id, 'Payment Submitted', `Proof of payment for #${app.tracking_number} has been uploaded and is pending verification.`);
    }
    res.redirect('/customer/applications');
  });
});

app.get('/customer/applications', requireCustomer, async (req, res) => {
  db.all(`SELECT * FROM applications WHERE customer_id = ? ORDER BY id DESC`, [req.session.customer.id], (err, apps) => {
    const content = `
      <h1 class="text-3xl font-black text-blue-900 mb-6">My Applications</h1>
      <div class="bg-white p-8 rounded-2xl shadow-xl">
        ${apps.length === 0 ? `<p class="text-gray-500 text-sm">No applications found.</p>` : `
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse">
              <thead>
                <tr class="border-b bg-gray-50 text-xs text-gray-500 uppercase">
                  <th class="p-3">Tracking #</th>
                  <th class="p-3">Service</th>
                  <th class="p-3">Status</th>
                  <th class="p-3">Payment</th>
                  <th class="p-3">Date</th>
                  <th class="p-3">Action</th>
                </tr>
              </thead>
              <tbody class="text-sm">
                ${apps.map(a => `
                  <tr class="border-b hover:bg-gray-50">
                    <td class="p-3 font-mono font-bold">${a.tracking_number}</td>
                    <td class="p-3 font-semibold">${a.service}</td>
                    <td class="p-3"><span class="px-2.5 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-bold">${a.status}</span></td>
                    <td class="p-3"><span class="px-2.5 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-bold">${a.payment_status}</span></td>
                    <td class="p-3 text-xs text-gray-500">${a.created_at}</td>
                    <td class="p-3 space-x-2">
                      <a href="/customer/track/${a.id}" class="text-blue-600 font-bold hover:underline">View</a>
                      ${a.payment_status === 'Payment Pending' ? `<a href="/customer/payment/${a.id}" class="text-emerald-600 font-bold hover:underline">Pay</a>` : ''}
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

app.get('/customer/track/:id', requireCustomer, async (req, res) => {
  const appId = req.params.id;
  db.get(`SELECT * FROM applications WHERE id = ? AND customer_id = ?`, [appId, req.session.customer.id], (err, app) => {
    if (!app) return res.redirect('/customer/applications');

    db.all(`SELECT * FROM documents WHERE application_id = ?`, [appId], (err2, docs) => {
      db.all(`SELECT * FROM completed_files WHERE application_id = ?`, [appId], (err3, completedFiles) => {
        const content = `
          <div class="bg-white p-8 rounded-2xl shadow-xl space-y-6">
            <div class="flex justify-between items-center border-b pb-4">
              <div>
                <span class="text-xs text-gray-500 block">Application Details</span>
                <span class="text-2xl font-black text-blue-900">${app.tracking_number}</span>
              </div>
              <span class="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-bold">${app.status}</span>
            </div>
            <div class="grid grid-cols-2 gap-4 text-sm">
              <div><strong class="text-gray-500 block">Service:</strong> ${app.service}</div>
              <div><strong class="text-gray-500 block">Payment Status:</strong> <span class="text-amber-600 font-bold">${app.payment_status}</span></div>
              <div><strong class="text-gray-500 block">Admin Remarks:</strong> ${app.admin_remarks || 'None'}</div>
            </div>

            <div class="border-t pt-4">
              <h3 class="font-bold text-blue-900 mb-2">Uploaded Documents</h3>
              <ul class="list-disc list-inside text-sm text-gray-600 space-y-1">
                ${docs.map(d => `<li>${d.doc_type}: <a href="/${d.file_path}" target="_blank" class="text-blue-600 font-bold hover:underline">View</a></li>`).join('')}
              </ul>
            </div>

            <div class="border-t pt-4">
              <h3 class="font-bold text-emerald-800 mb-2">Completed Government Files</h3>
              ${completedFiles.length === 0 ? `<p class="text-sm text-gray-500">Your documents are currently being processed by our team.</p>` : `
                <ul class="space-y-2">
                  ${completedFiles.map(cf => `<li class="bg-emerald-50 p-3 rounded-xl flex justify-between items-center text-sm"><span>${cf.file_name}</span> <a href="/${cf.file_path}" target="_blank" class="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1 rounded-lg text-xs font-bold">Download File</a></li>`).join('')}
                </ul>
              `}
            </div>

            <div class="pt-4"><a href="/customer/applications" class="text-blue-600 font-bold text-sm">&larr; Back to Applications</a></div>
          </div>
        `;
        res.send(customerLayout('Track Application', content, 'applications', 0, req.session));
      });
    });
  });
});

app.get('/customer/documents', requireCustomer, async (req, res) => {
  db.all(`SELECT cf.*, a.tracking_number, a.service FROM completed_files cf JOIN applications a ON cf.application_id = a.id WHERE a.customer_id = ?`, [req.session.customer.id], (err, files) => {
    const content = `
      <h1 class="text-3xl font-black text-blue-900 mb-6">Completed Government Documents</h1>
      <div class="bg-white p-8 rounded-2xl shadow-xl">
        ${files.length === 0 ? `<p class="text-gray-500 text-sm">No completed files available yet.</p>` : `
          <div class="space-y-3">
            ${files.map(f => `
              <div class="border p-4 rounded-2xl flex justify-between items-center bg-gray-50">
                <div>
                  <strong class="block text-blue-900">${f.file_name}</strong>
                  <span class="text-xs text-gray-500">Tracking: ${f.tracking_number} (${f.service}) - Uploaded: ${f.uploaded_at}</span>
                </div>
                <a href="/${f.file_path}" target="_blank" class="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs font-bold shadow">Download PDF</a>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    `;
    res.send(customerLayout('Completed Documents', content, 'documents', 0, req.session));
  });
});

app.get('/customer/notifications', requireCustomer, async (req, res) => {
  db.run(`UPDATE notifications SET is_read = 1 WHERE customer_id = ?`, [req.session.customer.id]);
  db.all(`SELECT * FROM notifications WHERE customer_id = ? ORDER BY id DESC`, [req.session.customer.id], (err, notifs) => {
    const content = `
      <h1 class="text-3xl font-black text-blue-900 mb-6">Notifications</h1>
      <div class="bg-white p-8 rounded-2xl shadow-xl space-y-3">
        ${notifs.length === 0 ? `<p class="text-gray-500 text-sm">No notifications.</p>` : notifs.map(n => `
          <div class="border-l-4 border-blue-600 bg-gray-50 p-4 rounded-r-2xl">
            <h4 class="font-bold text-blue-900">${n.title}</h4>
            <p class="text-sm text-gray-600 mt-1">${n.message}</p>
            <span class="text-xs text-gray-400 block mt-2">${n.created_at}</span>
          </div>
        `).join('')}
      </div>
    `;
    res.send(customerLayout('Notifications', content, 'notifications', 0, req.session));
  });
});

app.get('/customer/profile', requireCustomer, async (req, res) => {
  db.get(`SELECT * FROM users WHERE id = ?`, [req.session.customer.id], (err, user) => {
    const content = `
      <h1 class="text-3xl font-black text-blue-900 mb-6">Profile Settings</h1>
      <form action="/customer/profile" method="POST" class="bg-white p-8 rounded-2xl shadow-xl space-y-4 max-w-xl">
        <div>
          <label class="block text-xs font-bold uppercase mb-1">Full Name</label>
          <input type="text" name="full_name" value="${user.full_name}" required class="w-full border rounded-xl px-4 py-2.5">
        </div>
        <div>
          <label class="block text-xs font-bold uppercase mb-1">Mobile Number</label>
          <input type="text" name="mobile_number" value="${user.mobile_number}" required class="w-full border rounded-xl px-4 py-2.5">
        </div>
        <div>
          <label class="block text-xs font-bold uppercase mb-1">Email Address</label>
          <input type="email" name="email_address" value="${user.email_address}" required class="w-full border rounded-xl px-4 py-2.5">
        </div>
        <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-2.5 rounded-xl text-sm shadow">Update Profile</button>
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
      res.redirect('/customer/profile');
    });
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
        <aside class="bg-gray-900 text-white w-full md:w-64 p-6 flex flex-col justify-between shadow-2xl">
          <div>
            <div class="text-xl font-black mb-1">🛡️ Admin Portal</div>
            <div class="text-xs text-amber-400 mb-8 font-semibold">Author: Mark Jerald Agdigos</div>
            <nav class="space-y-1.5 text-sm">
              <a href="/admin/dashboard" class="block px-4 py-2.5 rounded-xl ${activeTab === 'dashboard' ? 'bg-gray-800 font-bold shadow' : 'hover:bg-gray-800'}">📊 Dashboard</a>
              <a href="/admin/applications" class="block px-4 py-2.5 rounded-xl ${activeTab === 'applications' ? 'bg-gray-800 font-bold shadow' : 'hover:bg-gray-800'}">📂 Applications Manager</a>
              <a href="/admin/payments" class="block px-4 py-2.5 rounded-xl ${activeTab === 'payments' ? 'bg-gray-800 font-bold shadow' : 'hover:bg-gray-800'}">💳 Payments & Verification</a>
              <a href="/admin/settings" class="block px-4 py-2.5 rounded-xl ${activeTab === 'settings' ? 'bg-gray-800 font-bold shadow' : 'hover:bg-gray-800'}">⚙️ System Settings</a>
            </nav>
          </div>
          <div class="mt-8 pt-4 border-t border-gray-800">
            <a href="/admin/logout" class="block text-center bg-red-600 hover:bg-red-700 text-white py-2 rounded-xl text-xs font-bold shadow">Admin Logout</a>
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

app.get('/admin/dashboard', requireAdmin, async (req, res) => {
  db.all(`SELECT * FROM applications`, [], (err, apps) => {
    db.all(`SELECT * FROM payments`, [], (err2, payments) => {
      const totalApps = apps.length;
      const pendingApps = apps.filter(a => a.status === 'Submitted' || a.status === 'Under Review').length;
      const totalRevenue = payments.reduce((acc, p) => acc + (p.payment_status === 'Verified' ? p.amount : 0), 0);

      const content = `
        <h1 class="text-3xl font-black text-gray-900 mb-6">Admin Dashboard</h1>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div class="bg-white p-6 rounded-2xl shadow border-l-4 border-blue-600">
            <h3 class="text-gray-500 text-xs font-bold uppercase">Total Applications</h3>
            <p class="text-3xl font-black text-blue-900 mt-2">${totalApps}</p>
          </div>
          <div class="bg-white p-6 rounded-2xl shadow border-l-4 border-amber-500">
            <h3 class="text-gray-500 text-xs font-bold uppercase">Pending Review</h3>
            <p class="text-3xl font-black text-amber-600 mt-2">${pendingApps}</p>
          </div>
          <div class="bg-white p-6 rounded-2xl shadow border-l-4 border-emerald-600">
            <h3 class="text-gray-500 text-xs font-bold uppercase">Verified Revenue</h3>
            <p class="text-3xl font-black text-emerald-600 mt-2">₱${totalRevenue}</p>
          </div>
        </div>

        <div class="bg-white p-8 rounded-2xl shadow">
          <h2 class="text-xl font-bold text-gray-900 mb-4">Recent Applications</h2>
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse">
              <thead>
                <tr class="border-b bg-gray-50 text-xs text-gray-500 uppercase">
                  <th class="p-3">Tracking #</th>
                  <th class="p-3">Service</th>
                  <th class="p-3">Status</th>
                  <th class="p-3">Action</th>
                </tr>
              </thead>
              <tbody class="text-sm">
                ${apps.slice(0, 10).map(a => `
                  <tr class="border-b hover:bg-gray-50">
                    <td class="p-3 font-mono font-bold">${a.tracking_number}</td>
                    <td class="p-3">${a.service}</td>
                    <td class="p-3"><span class="px-2.5 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-bold">${a.status}</span></td>
                    <td class="p-3"><a href="/admin/application/${a.id}" class="text-blue-600 font-bold hover:underline">Manage</a></td>
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

app.get('/admin/applications', requireAdmin, (req, res) => {
  db.all(`SELECT a.*, u.full_name FROM applications a JOIN users u ON a.customer_id = u.id ORDER BY a.id DESC`, [], (err, apps) => {
    const content = `
      <h1 class="text-3xl font-black text-gray-900 mb-6">Applications Manager</h1>
      <div class="bg-white p-8 rounded-2xl shadow">
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="border-b bg-gray-50 text-xs text-gray-500 uppercase">
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
                  <td class="p-3 font-mono font-bold">${a.tracking_number}</td>
                  <td class="p-3">${a.full_name}</td>
                  <td class="p-3">${a.service}</td>
                  <td class="p-3"><span class="px-2.5 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-bold">${a.status}</span></td>
                  <td class="p-3"><span class="px-2.5 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-bold">${a.payment_status}</span></td>
                  <td class="p-3"><a href="/admin/application/${a.id}" class="text-blue-600 font-bold hover:underline">Manage</a></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
    res.send(adminLayout('Applications Manager', content, 'applications'));
  });
});

app.get('/admin/application/:id', requireAdmin, (req, res) => {
  const appId = req.params.id;
  db.get(`SELECT a.*, u.full_name, u.mobile_number, u.email_address FROM applications a JOIN users u ON a.customer_id = u.id WHERE a.id = ?`, [appId], (err, app) => {
    if (!app) return res.redirect('/admin/applications');

    db.all(`SELECT * FROM documents WHERE application_id = ?`, [appId], (err2, docs) => {
      db.all(`SELECT * FROM completed_files WHERE application_id = ?`, [appId], (err3, completedFiles) => {
        const formData = JSON.parse(app.data_json || '{}');
        const content = `
          <h1 class="text-3xl font-black text-gray-900 mb-6">Manage Application: ${app.tracking_number}</h1>
          <div class="grid md:grid-cols-2 gap-8">
            <div class="bg-white p-8 rounded-2xl shadow space-y-4">
              <h2 class="text-xl font-bold text-gray-900 border-b pb-2">Customer & Application Info</h2>
              <p><strong>Customer:</strong> ${app.full_name} (${app.mobile_number})</p>
              <p><strong>Service:</strong> ${app.service}</p>
              <p><strong>Address:</strong> ${formData.street || ''}, ${formData.barangay || ''}, ${formData.city || ''}, ${formData.province || ''}</p>
              
              <form action="/admin/application/${app.id}/status" method="POST" class="space-y-4 pt-4 border-t">
                <div>
                  <label class="block text-xs font-bold uppercase mb-1">Update Status</label>
                  <select name="status" class="w-full border rounded-xl px-4 py-2.5">
                    <option value="Submitted" ${app.status === 'Submitted' ? 'selected' : ''}>Submitted</option>
                    <option value="Under Review" ${app.status === 'Under Review' ? 'selected' : ''}>Under Review</option>
                    <option value="Processing" ${app.status === 'Processing' ? 'selected' : ''}>Processing</option>
                    <option value="Completed" ${app.status === 'Completed' ? 'selected' : ''}>Completed</option>
                    <option value="Rejected" ${app.status === 'Rejected' ? 'selected' : ''}>Rejected</option>
                  </select>
                </div>
                <div>
                  <label class="block text-xs font-bold uppercase mb-1">Admin Remarks</label>
                  <textarea name="admin_remarks" class="w-full border rounded-xl px-4 py-2.5">${app.admin_remarks || ''}</textarea>
                </div>
                <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-2 rounded-xl text-sm shadow">Save Status</button>
              </form>
            </div>

            <div class="bg-white p-8 rounded-2xl shadow space-y-6">
              <div>
                <h2 class="text-xl font-bold text-gray-900 border-b pb-2 mb-3">Uploaded Customer Documents</h2>
                <ul class="space-y-2 text-sm">
                  ${docs.map(d => `<li class="flex justify-between items-center bg-gray-50 p-3 rounded-xl"><span>${d.doc_type}</span> <a href="/${d.file_path}" target="_blank" class="text-blue-600 font-bold hover:underline">View</a></li>`).join('')}
                </ul>
              </div>

              <div>
                <h2 class="text-xl font-bold text-gray-900 border-b pb-2 mb-3">Upload Completed Government Form</h2>
                <form action="/admin/application/${app.id}/upload-completed" method="POST" enctype="multipart/form-data" class="space-y-3">
                  <div>
                    <label class="block text-xs font-bold uppercase mb-1">File Name / Description</label>
                    <input type="text" name="file_name" required class="w-full border rounded-xl px-3 py-2" placeholder="e.g. Official TIN ID PDF">
                  </div>
                  <div>
                    <input type="file" name="completed_file" accept="image/*,application/pdf" required class="w-full border rounded-xl px-3 py-2 bg-gray-50">
                  </div>
                  <button type="submit" class="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 rounded-xl text-xs shadow">Upload & Notify Customer</button>
                </form>

                <div class="mt-4 space-y-2">
                  ${completedFiles.map(cf => `<div class="bg-emerald-50 p-3 rounded-xl flex justify-between items-center text-xs"><span>${cf.file_name}</span> <a href="/${cf.file_path}" target="_blank" class="font-bold text-emerald-700 hover:underline">Download</a></div>`).join('')}
                </div>
              </div>
            </div>
          </div>
        `;
        res.send(adminLayout('Manage Application', content, 'applications'));
      });
    });
  });
});

app.post('/admin/application/:id/status', requireAdmin, (req, res) => {
  const appId = req.params.id;
  const { status, admin_remarks } = req.body;
  db.get(`SELECT * FROM applications WHERE id = ?`, [appId], (err, app) => {
    if (app) {
      db.run(`UPDATE applications SET status = ?, admin_remarks = ? WHERE id = ?`, [status, admin_remarks, appId]);
      addNotification(app.customer_id, 'Application Status Updated', `Your application #${app.tracking_number} status is now: ${status}.`);
    }
    res.redirect(`/admin/application/${appId}`);
  });
});

app.post('/admin/application/:id/upload-completed', requireAdmin, upload.single('completed_file'), (req, res) => {
  const appId = req.params.id;
  const { file_name } = req.body;
  const filePath = req.file ? req.file.path : '';

  db.get(`SELECT * FROM applications WHERE id = ?`, [appId], (err, app) => {
    if (app) {
      db.run(`INSERT INTO completed_files (application_id, file_path, file_name, file_type) VALUES (?, ?, ?, ?)`,
        [appId, filePath, file_name, req.file.mimetype]);
      addNotification(app.customer_id, 'Completed Document Ready', `Your completed document (${file_name}) for #${app.tracking_number} is now ready for download.`);
    }
    res.redirect(`/admin/application/${appId}`);
  });
});

app.get('/admin/payments', requireAdmin, (req, res) => {
  db.all(`SELECT p.*, u.full_name FROM payments p JOIN users u ON p.customer_id = u.id ORDER BY p.id DESC`, [], (err, payments) => {
    const content = `
      <h1 class="text-3xl font-black text-gray-900 mb-6">Payments & Verification</h1>
      <div class="bg-white p-8 rounded-2xl shadow">
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="border-b bg-gray-50 text-xs text-gray-500 uppercase">
                <th class="p-3">Tracking #</th>
                <th class="p-3">Customer</th>
                <th class="p-3">Amount</th>
                <th class="p-3">Reference #</th>
                <th class="p-3">Proof</th>
                <th class="p-3">Status</th>
                <th class="p-3">Action</th>
              </tr>
            </thead>
            <tbody class="text-sm">
              ${payments.map(p => `
                <tr class="border-b hover:bg-gray-50">
                  <td class="p-3 font-mono font-bold">${p.tracking_number}</td>
                  <td class="p-3">${p.full_name}</td>
                  <td class="p-3 font-bold">₱${p.amount}</td>
                  <td class="p-3 font-mono">${p.reference_number}</td>
                  <td class="p-3"><a href="/${p.proof_path}" target="_blank" class="text-blue-600 font-bold hover:underline">View Proof</a></td>
                  <td class="p-3"><span class="px-2.5 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-bold">${p.payment_status}</span></td>
                  <td class="p-3">
                    <a href="/admin/payment/verify/${p.id}" class="text-emerald-600 font-bold hover:underline">Verify</a>
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

app.get('/admin/payment/verify/:id', requireAdmin, (req, res) => {
  const payId = req.params.id;
  db.get(`SELECT * FROM payments WHERE id = ?`, [payId], (err, pay) => {
    if (pay) {
      db.run(`UPDATE payments SET payment_status = 'Verified' WHERE id = ?`, [payId]);
      db.run(`UPDATE applications SET payment_status = 'Paid & Verified' WHERE id = ?`, [pay.application_id]);
      addNotification(pay.customer_id, 'Payment Verified', `Your payment for tracking #${pay.tracking_number} has been verified by the admin.`);
    }
    res.redirect('/admin/payments');
  });
});

app.get('/admin/settings', requireAdmin, async (req, res) => {
  const settings = res.locals.settings;
  const content = `
    <h1 class="text-3xl font-black text-gray-900 mb-6">System Settings</h1>
    <form action="/admin/settings" method="POST" class="bg-white p-8 rounded-2xl shadow max-w-xl space-y-4">
      <div>
        <label class="block text-xs font-bold uppercase mb-1">Business Name</label>
        <input type="text" name="business_name" value="${settings.business_name}" required class="w-full border rounded-xl px-4 py-2.5">
      </div>
      <div>
        <label class="block text-xs font-bold uppercase mb-1">Developer Name</label>
        <input type="text" name="developer_name" value="${settings.developer_name}" required class="w-full border rounded-xl px-4 py-2.5">
      </div>
      <div>
        <label class="block text-xs font-bold uppercase mb-1">GCash Account Name</label>
        <input type="text" name="gcash_name" value="${settings.gcash_name}" required class="w-full border rounded-xl px-4 py-2.5">
      </div>
      <div>
        <label class="block text-xs font-bold uppercase mb-1">GCash Number</label>
        <input type="text" name="gcash_number" value="${settings.gcash_number}" required class="w-full border rounded-xl px-4 py-2.5">
      </div>
      <div class="grid grid-cols-3 gap-4">
        <div>
          <label class="block text-xs font-bold uppercase mb-1">BIR Fee (₱)</label>
          <input type="number" name="fee_bir" value="${settings.fee_bir}" required class="w-full border rounded-xl px-3 py-2">
        </div>
        <div>
          <label class="block text-xs font-bold uppercase mb-1">SSS Fee (₱)</label>
          <input type="number" name="fee_sss" value="${settings.fee_sss}" required class="w-full border rounded-xl px-3 py-2">
        </div>
        <div>
          <label class="block text-xs font-bold uppercase mb-1">Pag-IBIG Fee (₱)</label>
          <input type="number" name="fee_pagibig" value="${settings.fee_pagibig}" required class="w-full border rounded-xl px-3 py-2">
        </div>
      </div>
      <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-2.5 rounded-xl text-sm shadow">Save Settings</button>
    </form>
  `;
  res.send(adminLayout('Settings', content, 'settings'));
});

app.post('/admin/settings', requireAdmin, async (req, res) => {
  for (const [key, value] of Object.entries(req.body)) {
    db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [key, value]);
  }
  res.redirect('/admin/settings');
});

// Start Server
app.listen(PORT, () => {
  console.log(`GovAssist PH running successfully on port ${PORT}`);
  console.log(`Developer: Mark Jerald Agdigos`);
});
