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
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT,
      full_name TEXT,
      mobile_number TEXT,
      email_address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

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
        gcash_name: 'Mark Jerald Agdigos (GovAssist)',
        gcash_number: '09123456789',
        fee_bir: '500',
        fee_sss: '400',
        fee_pagibig: '400',
        payment_instructions: '1. Scan GCash QR or send to the number provided.\n2. Upload clear proof of payment.\n3. Wait for verification by our admin team.'
      };
      for (const [key, value] of Object.entries(defaultSettings)) {
        db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`, [key, value]);
      }
    });

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

    db.run(`CREATE TABLE IF NOT EXISTS beneficiaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id INTEGER,
      full_name TEXT,
      birth_date TEXT,
      relationship TEXT,
      address TEXT,
      contact_number TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id INTEGER,
      doc_type TEXT,
      file_path TEXT,
      file_name TEXT,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS completed_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id INTEGER,
      file_path TEXT,
      file_name TEXT,
      file_type TEXT,
      description TEXT,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

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

    db.run(`CREATE TABLE IF NOT EXISTS status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id INTEGER,
      status TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

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
  secret: process.env.SESSION_SECRET || 'markjerald_govassist_secret_key_2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

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
  db.run(`SELECT id FROM applications WHERE id = ?`, [appId], (err, row) => {
    if (!err && row) {
      db.run(`INSERT INTO status_history (application_id, status, notes) VALUES (?, ?, ?)`, [appId, status, notes]);
    }
  });
}

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
// PUBLIC LANDING & TRACKING
// ==========================================
app.get('/', async (req, res) => {
  const settings = res.locals.settings;
  res.send(`
    <!DOCTYPE html>
    <html lang="tl">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${settings.business_name}</title>
      <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
    </head>
    <body class="bg-slate-50 text-slate-800 font-sans antialiased">
      <header class="bg-blue-950 text-white shadow-lg sticky top-0 z-50">
        <div class="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <div class="flex items-center space-x-3">
            <div class="bg-blue-900 text-blue-200 p-2 rounded-lg font-bold text-lg">GA</div>
            <span class="text-xl font-black tracking-tight">${settings.business_name}</span>
          </div>
          <div class="space-x-3">
            <a href="/customer/login" class="px-4 py-2 bg-blue-900 hover:bg-blue-800 rounded-lg text-sm font-semibold transition">Login</a>
            <a href="/customer/register" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-sm font-semibold transition shadow">Mag-register</a>
          </div>
        </div>
      </header>

      <main class="max-w-7xl mx-auto px-6 py-16">
        <div class="text-center max-w-3xl mx-auto mb-16">
          <span class="inline-block bg-blue-100 text-blue-800 text-xs px-3 py-1 rounded-full font-bold mb-4 uppercase tracking-wider">Fast & Secure Assistance</span>
          <h1 class="text-4xl md:text-5xl font-black text-blue-950 mb-6 leading-tight">Mabilis na Tulong sa Iyong BIR, SSS & Pag-IBIG Applications</h1>
          <p class="text-lg text-slate-600 mb-8">Propesyonal na pag-assist sa iyong mga dokumento at aplikasyon nang ligtas, mabilis, at walang aberya.</p>
          <div class="flex flex-col sm:flex-row justify-center gap-4">
            <a href="/customer/register" class="px-8 py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg transition">Simulan ang Aplikasyon</a>
            <a href="/track-public" class="px-8 py-3.5 bg-white border border-slate-300 hover:bg-slate-100 text-blue-950 font-bold rounded-xl shadow transition">I-track ang Status</a>
          </div>
        </div>

        <div class="grid md:grid-cols-3 gap-8 mb-16">
          <div class="bg-white p-8 rounded-2xl shadow-sm border border-slate-100 text-center hover:shadow-md transition">
            <div class="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-4">🏢</div>
            <h3 class="text-xl font-bold text-blue-950 mb-2">BIR / TIN</h3>
            <p class="text-slate-600 text-sm">Tax Identification Number assistance para sa mga empleyado, self-employed, at mixed-income earners.</p>
          </div>
          <div class="bg-white p-8 rounded-2xl shadow-sm border border-slate-100 text-center hover:shadow-md transition">
            <div class="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-4">🛡️</div>
            <h3 class="text-xl font-bold text-blue-950 mb-2">SSS Registration</h3>
            <p class="text-slate-600 text-sm">Social Security System membership number application at beneficiary listing assistance.</p>
          </div>
          <div class="bg-white p-8 rounded-2xl shadow-sm border border-slate-100 text-center hover:shadow-md transition">
            <div class="w-16 h-16 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-4">🏠</div>
            <h3 class="text-xl font-bold text-blue-950 mb-2">Pag-IBIG Fund</h3>
            <p class="text-slate-600 text-sm">HDMF MID number application, membership registration, at contribution record support.</p>
          </div>
        </div>

        <div class="bg-amber-50 border-l-4 border-amber-500 p-6 rounded-r-2xl text-amber-900 text-sm shadow-sm">
          <strong>Paalala:</strong> Ang ${settings.business_name} ay isang independent application assistance at document processing platform. Hindi po ito opisyal na website ng gobyerno.
        </div>
      </main>

      <footer class="bg-slate-900 text-slate-400 py-8 text-center text-sm border-t border-slate-800">
        <p class="mb-1">&copy; 2026 ${settings.business_name}. All rights reserved.</p>
        <p class="text-xs text-slate-500 font-medium">Developed & Created by: <span class="text-blue-400 font-bold">Mark Jerald Agdigos</span></p>
      </footer>
    </body>
    </html>
  `);
});

app.get('/track-public', (req, res) => {
  const trackingNumber = req.query.tracking_number ? req.query.tracking_number.trim() : '';
  let searchResultHtml = '';

  if (trackingNumber) {
    db.get(`SELECT a.*, u.full_name FROM applications a JOIN users u ON a.customer_id = u.id WHERE a.tracking_number = ?`, [trackingNumber], (err, app) => {
      if (app) {
        db.all(`SELECT * FROM status_history WHERE application_id = ? ORDER BY id DESC`, [app.id], (err2, history) => {
          searchResultHtml = `
            <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 mt-6 space-y-4">
              <div class="flex justify-between items-start border-b pb-4">
                <div>
                  <span class="text-xs font-bold uppercase text-slate-400 block">Tracking Number</span>
                  <span class="text-xl font-mono font-bold text-blue-950">${app.tracking_number}</span>
                </div>
                <span class="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-bold">${app.status}</span>
              </div>
              <div class="grid grid-cols-2 gap-4 text-sm">
                <div><strong>Kliyente:</strong> ${app.full_name}</div>
                <div><strong>Serbisyo:</strong> ${app.service}</div>
                <div><strong>Bayad:</strong> <span class="text-amber-600 font-semibold">${app.payment_status}</span></div>
                <div><strong>Petsa:</strong> ${new Date(app.created_at).toLocaleDateString()}</div>
              </div>
              ${app.admin_remarks ? `<div class="bg-slate-50 p-3 rounded-lg text-xs"><strong>Admin Remarks:</strong> ${app.admin_remarks}</div>` : ''}
              
              <h4 class="font-bold text-sm text-blue-950 pt-2">Status Timeline History</h4>
              <div class="space-y-2">
                ${history.map(h => `
                  <div class="text-xs border-l-2 border-blue-600 pl-3 py-1">
                    <span class="font-bold text-blue-900">${h.status}</span> - <span class="text-slate-500">${new Date(h.created_at).toLocaleString()}</span>
                    ${h.notes ? `<p class="text-slate-600 mt-0.5">${h.notes}</p>` : ''}
                  </div>
                `).join('')}
              </div>
            </div>
          `;
          renderTrackPage(res, trackingNumber, searchResultHtml);
        });
      } else {
        searchResultHtml = `<div class="bg-red-50 text-red-700 p-4 rounded-xl mt-6 text-sm font-medium">Walang nahanap na aplikasyon para sa tracking number na ito.</div>`;
        renderTrackPage(res, trackingNumber, searchResultHtml);
      }
    });
  } else {
    renderTrackPage(res, trackingNumber, searchResultHtml);
  }
});

function renderTrackPage(res, trackingNumber, searchResultHtml) {
  res.send(`
    <!DOCTYPE html>
    <html lang="tl">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Track Application</title>
      <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
    </head>
    <body class="bg-slate-50 text-slate-800 font-sans">
      <div class="max-w-xl mx-auto px-6 py-16">
        <div class="text-center mb-8">
          <h1 class="text-3xl font-black text-blue-950">I-track ang Aplikasyon</h1>
          <p class="text-sm text-slate-600 mt-2">Ilagay ang iyong tracking number sa ibaba para malaman ang real-time status.</p>
        </div>
        <form action="/track-public" method="GET" class="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 space-y-4">
          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">Tracking Number</label>
            <input type="text" name="tracking_number" value="${trackingNumber}" required placeholder="hal. TIN-20260902-0001" class="w-full border border-slate-300 rounded-xl px-4 py-3 uppercase font-mono text-sm focus:ring-2 focus:ring-blue-600 outline-none">
          </div>
          <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition shadow">Hanapin ang Status</button>
        </form>
        ${searchResultHtml}
        <div class="text-center mt-8">
          <a href="/" class="text-blue-600 hover:underline text-sm font-semibold">&larr; Bumalik sa Home</a>
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
    <html lang="tl">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Customer Registration</title>
      <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
    </head>
    <body class="bg-slate-50 flex items-center justify-center min-h-screen p-6">
      <div class="bg-white w-full max-w-md p-8 rounded-2xl shadow-sm border border-slate-200">
        <h2 class="text-2xl font-black text-blue-950 mb-2 text-center">Mag-register</h2>
        <p class="text-xs text-slate-500 text-center mb-6">Gumawa ng iyong customer account</p>
        <form action="/customer/register" method="POST" class="space-y-4">
          <div>
            <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Buong Pangalan</label>
            <input type="text" name="full_name" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-600 outline-none" placeholder="Juan Dela Cruz">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Username</label>
            <input type="text" name="username" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-600 outline-none" placeholder="juandelacruz">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Mobile Number</label>
            <input type="text" name="mobile_number" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-600 outline-none" placeholder="09123456789">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Email Address</label>
            <input type="email" name="email_address" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-600 outline-none" placeholder="juan@example.com">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Password</label>
            <input type="password" name="password" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-600 outline-none">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Kumpirmahin ang Password</label>
            <input type="password" name="confirm_password" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-600 outline-none">
          </div>
          <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition shadow">Gumawa ng Account</button>
        </form>
        <p class="text-center text-sm mt-6 text-slate-600">May account na? <a href="/customer/login" class="text-blue-600 font-bold hover:underline">Mag-login dito</a></p>
      </div>
    </body>
    </html>
  `);
});

app.post('/customer/register', async (req, res) => {
  const { username, password, confirm_password, full_name, mobile_number, email_address } = req.body;
  if (password !== confirm_password) {
    return res.send(`<script>alert('Hindi magkatugma ang mga password!'); window.history.back();</script>`);
  }
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    db.run(`INSERT INTO users (username, password, full_name, mobile_number, email_address) VALUES (?, ?, ?, ?, ?)`,
      [username, hashedPassword, full_name, mobile_number, email_address], function(err) {
        if (err) {
          return res.send(`<script>alert('May ganyang username na o may mali sa iyong impormasyon!'); window.history.back();</script>`);
        }
        res.redirect('/customer/login');
      });
  } catch (e) {
    res.send(`<script>alert('May error sa pag-register!'); window.history.back();</script>`);
  }
});

app.get('/customer/login', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="tl">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Customer Login</title>
      <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
    </head>
    <body class="bg-slate-50 flex items-center justify-center min-h-screen p-6">
      <div class="bg-white w-full max-w-md p-8 rounded-2xl shadow-sm border border-slate-200">
        <h2 class="text-2xl font-black text-blue-950 mb-2 text-center">Customer Login</h2>
        <p class="text-xs text-slate-500 text-center mb-6">Mag-sign in sa iyong portal</p>
        <form action="/customer/login" method="POST" class="space-y-4">
          <div>
            <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Username</label>
            <input type="text" name="username" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-600 outline-none">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Password</label>
            <input type="password" name="password" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-600 outline-none">
          </div>
          <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition shadow">Mag-login</button>
        </form>
        <p class="text-center text-sm mt-6 text-slate-600">Wala pang account? <a href="/customer/register" class="text-blue-600 font-bold hover:underline">Mag-register</a></p>
        <div class="text-center mt-4"><a href="/" class="text-slate-400 hover:underline text-xs">&larr; Bumalik sa home</a></div>
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
      res.send(`<script>alert('Mali ang username o password!'); window.history.back();</script>`);
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
    <html lang="tl">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Admin Login</title>
      <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
    </head>
    <body class="bg-slate-950 flex items-center justify-center min-h-screen p-6">
      <div class="bg-white w-full max-w-md p-8 rounded-2xl shadow-xl">
        <h2 class="text-2xl font-black text-slate-900 mb-2 text-center">Admin Portal</h2>
        <p class="text-xs text-slate-500 text-center mb-6">Administrator Access Only</p>
        <form action="/admin/login" method="POST" class="space-y-4">
          <div>
            <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Admin Username</label>
            <input type="text" name="username" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-slate-900 outline-none">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Password</label>
            <input type="password" name="password" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-slate-900 outline-none">
          </div>
          <button type="submit" class="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-3 rounded-xl transition shadow">Login as Admin</button>
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
      res.send(`<script>alert('Mali ang admin credentials!'); window.history.back();</script>`);
    }
  });
});

app.get('/admin/logout', (req, res) => {
  req.session.admin = null;
  res.redirect('/admin/login');
});

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
// CUSTOMER PORTAL & DASHBOARD LAYOUT
// ==========================================
function customerLayout(title, content, activeTab, unreadCount = 0, reqSession = null) {
  const customerName = reqSession && reqSession.customer ? reqSession.customer.full_name : '';
  return `
    <!DOCTYPE html>
    <html lang="tl">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title}</title>
      <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
    </head>
    <body class="bg-slate-100 text-slate-800 font-sans">
      <div class="min-h-screen flex flex-col md:flex-row">
        <aside class="bg-blue-950 text-white w-full md:w-72 p-6 flex flex-col justify-between shadow-lg">
          <div>
            <div class="text-lg font-black mb-8 flex items-center space-x-2">
              <span class="bg-blue-900 text-blue-200 px-2 py-1 rounded">GA</span>
              <span>GovAssist PH</span>
            </div>
            <nav class="space-y-1.5 text-sm font-medium">
              <a href="/customer/dashboard" class="block px-4 py-2.5 rounded-xl ${activeTab === 'dashboard' ? 'bg-blue-900 font-bold text-white shadow' : 'text-slate-300 hover:bg-blue-900/50'}">Dashboard</a>
              <a href="/customer/apply" class="block px-4 py-2.5 rounded-xl ${activeTab === 'apply' ? 'bg-blue-900 font-bold text-white shadow' : 'text-slate-300 hover:bg-blue-900/50'}">+ Bagong Aplikasyon</a>
              <a href="/customer/applications" class="block px-4 py-2.5 rounded-xl ${activeTab === 'applications' ? 'bg-blue-900 font-bold text-white shadow' : 'text-slate-300 hover:bg-blue-900/50'}">Aking mga Aplikasyon</a>
              <a href="/customer/documents" class="block px-4 py-2.5 rounded-xl ${activeTab === 'documents' ? 'bg-blue-900 font-bold text-white shadow' : 'text-slate-300 hover:bg-blue-900/50'}">Mga Nakumpletong Dokumento</a>
              <a href="/customer/notifications" class="block px-4 py-2.5 rounded-xl ${activeTab === 'notifications' ? 'bg-blue-900 font-bold text-white shadow' : 'text-slate-300 hover:bg-blue-900/50'}">Notifications ${unreadCount > 0 ? `<span class="bg-red-500 text-white px-2 py-0.5 rounded-full text-xs font-bold">${unreadCount}</span>` : ''}</a>
              <a href="/customer/profile" class="block px-4 py-2.5 rounded-xl ${activeTab === 'profile' ? 'bg-blue-900 font-bold text-white shadow' : 'text-slate-300 hover:bg-blue-900/50'}">Profile</a>
            </nav>
          </div>
          <div class="mt-8 pt-4 border-t border-blue-900">
            <span class="block text-xs text-blue-300 mb-1">Login bilang:</span>
            <span class="block font-bold text-sm mb-3 truncate">${customerName}</span>
            <a href="/customer/logout" class="block text-center bg-red-600 hover:bg-red-700 text-white py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition shadow">Mag-logout</a>
          </div>
        </aside>
        
        <main class="flex-1 p-6 md:p-12 overflow-y-auto">
          ${content}
          <div class="mt-16 pt-6 border-t border-slate-300 text-center text-xs text-slate-500">
            Developer / Creator: <span class="font-bold text-slate-700">Mark Jerald Agdigos</span>
          </div>
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
        <h1 class="text-3xl font-black text-blue-950 mb-6">Customer Dashboard</h1>
        
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 border-l-4 border-l-blue-600">
            <h3 class="text-slate-500 text-xs font-bold uppercase">Total Aplikasyon</h3>
            <p class="text-3xl font-black text-blue-950 mt-2">${totalApps}</p>
          </div>
          <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 border-l-4 border-l-amber-500">
            <h3 class="text-slate-500 text-xs font-bold uppercase">Pending / In Progress</h3>
            <p class="text-3xl font-black text-amber-600 mt-2">${pendingApps}</p>
          </div>
          <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 border-l-4 border-l-emerald-600">
            <h3 class="text-slate-500 text-xs font-bold uppercase">Nakumpleto</h3>
            <p class="text-3xl font-black text-emerald-600 mt-2">${completedApps}</p>
          </div>
        </div>

        <div class="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 mb-8">
          <div class="flex justify-between items-center mb-6">
            <h2 class="text-xl font-bold text-blue-950">Mga Huling Aplikasyon</h2>
            <a href="/customer/apply" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition shadow">+ Bagong Aplikasyon</a>
          </div>
          ${apps.length === 0 ? `<p class="text-slate-500 text-sm">Wala pang naisusumiteng aplikasyon.</p>` : `
            <div class="overflow-x-auto">
              <table class="w-full text-left border-collapse">
                <thead>
                  <tr class="border-b bg-slate-50 text-xs text-slate-500 uppercase">
                    <th class="p-3">Tracking Number</th>
                    <th class="p-3">Serbisyo</th>
                    <th class="p-3">Status</th>
                    <th class="p-3">Bayad</th>
                    <th class="p-3">Aksyon</th>
                  </tr>
                </thead>
                <tbody class="text-sm">
                  ${apps.slice(0, 5).map(app => `
                    <tr class="border-b hover:bg-slate-50 transition">
                      <td class="p-3 font-mono font-bold text-blue-950">${app.tracking_number}</td>
                      <td class="p-3 font-medium">${app.service}</td>
                      <td class="p-3"><span class="px-2.5 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-bold">${app.status}</span></td>
                      <td class="p-3"><span class="px-2.5 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-bold">${app.payment_status}</span></td>
                      <td class="p-3"><a href="/customer/track/${app.id}" class="text-blue-600 font-bold hover:underline text-xs">Tingnan</a></td>
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

// Application Form with Enhanced UI and Dynamic Beneficiaries
app.get('/customer/apply', requireCustomer, async (req, res) => {
  const settings = res.locals.settings;
  const content = `
    <h1 class="text-3xl font-black text-blue-950 mb-6">Bagong Aplikasyon sa Gobyerno</h1>
    <form action="/customer/apply" method="POST" enctype="multipart/form-data" class="bg-white p-8 md:p-12 rounded-2xl shadow-sm border border-slate-200 space-y-8">
      
      <div class="space-y-4">
        <h2 class="text-xl font-bold text-blue-950 border-b pb-3">Hakbang 1: Piliin ang Serbisyo</h2>
        <div class="grid md:grid-cols-3 gap-4">
          <label class="border-2 border-slate-200 p-5 rounded-2xl cursor-pointer hover:border-blue-600 transition flex flex-col justify-between">
            <div>
              <input type="radio" name="service" value="BIR / TIN" required class="mb-3" onchange="toggleServiceForm()">
              <span class="font-bold block text-lg text-blue-950">BIR / TIN</span>
              <span class="text-xs text-slate-500 mt-1 block">Tax Identification Number registration. Fee: ₱${settings.fee_bir}</span>
            </div>
          </label>
          <label class="border-2 border-slate-200 p-5 rounded-2xl cursor-pointer hover:border-blue-600 transition flex flex-col justify-between">
            <div>
              <input type="radio" name="service" value="SSS" required class="mb-3" onchange="toggleServiceForm()">
              <span class="font-bold block text-lg text-blue-950">SSS</span>
              <span class="text-xs text-slate-500 mt-1 block">Social Security System registration & beneficiaries. Fee: ₱${settings.fee_sss}</span>
            </div>
          </label>
          <label class="border-2 border-slate-200 p-5 rounded-2xl cursor-pointer hover:border-blue-600 transition flex flex-col justify-between">
            <div>
              <input type="radio" name="service" value="PAG-IBIG" required class="mb-3" onchange="toggleServiceForm()">
              <span class="font-bold block text-lg text-blue-950">Pag-IBIG</span>
              <span class="text-xs text-slate-500 mt-1 block">HDMF membership & housing fund registration. Fee: ₱${settings.fee_pagibig}</span>
            </div>
          </label>
        </div>
      </div>

      <div class="space-y-4">
        <h2 class="text-xl font-bold text-blue-950 border-b pb-3">Hakbang 2: Personal na Impormasyon</h2>
        <div class="grid md:grid-cols-3 gap-4">
          <div>
            <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Pangalan (First Name) *</label>
            <input type="text" name="first_name" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-600 outline-none" placeholder="Juan">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Middle Name</label>
            <input type="text" name="middle_name" class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-600 outline-none" placeholder="Santos">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Apelyido (Last Name) *</label>
            <input type="text" name="last_name" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-600 outline-none" placeholder="Dela Cruz">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Suffix</label>
            <input type="text" name="suffix" class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm" placeholder="Jr., III">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Petsa ng Kapanganakan *</label>
            <input type="date" name="date_of_birth" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Lugar ng Kapanganakan *</label>
            <input type="text" name="place_of_birth" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm" placeholder="Manila">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Kasarian (Sex) *</label>
            <select name="sex" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm bg-white">
              <option value="Male">Male</option>
              <option value="Female">Female</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Civil Status *</label>
            <select name="civil_status" id="civilStatus" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm bg-white" onchange="toggleMarriageSection()">
              <option value="Single">Single</option>
              <option value="Married">Married</option>
              <option value="Widowed">Widowed</option>
              <option value="Separated">Separated</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Nasyonalidad *</label>
            <input type="text" name="nationality" value="Filipino" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm">
          </div>
        </div>
      </div>

      <div class="space-y-4">
        <h2 class="text-xl font-bold text-blue-950 border-b pb-3">Hakbang 3: Tirahan at Kontak</h2>
        <div class="grid md:grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Mobile Number *</label>
            <input type="text" name="mobile_number" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm" placeholder="09123456789">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Email Address *</label>
            <input type="email" name="email_address" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm" placeholder="juan@example.com">
          </div>
        </div>
        <div class="grid md:grid-cols-3 gap-4">
          <div>
            <label class="block text-xs font-bold uppercase text-slate-600 mb-1">House/Unit & Street *</label>
            <input type="text" name="street" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm" placeholder="123 Rizal St">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Barangay *</label>
            <input type="text" name="barangay" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm" placeholder="Brgy. San Antonio">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Lungsod / Munisipyo *</label>
            <input type="text" name="city" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm" placeholder="Quezon City">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Probinsya *</label>
            <input type="text" name="province" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm" placeholder="Metro Manila">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase text-slate-600 mb-1">ZIP Code *</label>
            <input type="text" name="zip_code" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm" placeholder="1100">
          </div>
        </div>
      </div>

      <div class="space-y-4">
        <h2 class="text-xl font-bold text-blue-950 border-b pb-3">Hakbang 4: Magulang at Asawa</h2>
        <div class="grid md:grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Pangalan ng Ama *</label>
            <input type="text" name="father_name" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm" placeholder="Pedro Dela Cruz">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Kapanganakan ng Ama *</label>
            <input type="date" name="father_dob" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Maiden Name ng Ina *</label>
            <input type="text" name="mother_maiden_name" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm" placeholder="Maria Santos">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Kapanganakan ng Ina *</label>
            <input type="date" name="mother_dob" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm">
          </div>
        </div>

        <div id="marriageSection" class="hidden p-6 bg-slate-50 border border-slate-200 rounded-2xl space-y-4 mt-4">
          <h3 class="font-bold text-blue-950">Detalye ng Asawa (Para sa Married)</h3>
          <div class="grid md:grid-cols-2 gap-4">
            <div>
              <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Buong Pangalan ng Asawa</label>
              <input type="text" name="spouse_name" class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm bg-white">
            </div>
            <div>
              <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Kapanganakan ng Asawa</label>
              <input type="date" name="spouse_dob" class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm bg-white">
            </div>
            <div>
              <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Petsa ng Kasal</label>
              <input type="date" name="marriage_date" class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm bg-white">
            </div>
            <div>
              <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Marriage Certificate (Larawan o PDF)</label>
              <input type="file" name="marriage_certificate" accept="image/*,application/pdf" class="w-full border border-slate-300 rounded-xl px-4 py-2 text-sm bg-white">
            </div>
          </div>
        </div>
      </div>

      <div class="space-y-4">
        <h2 class="text-xl font-bold text-blue-950 border-b pb-3">Hakbang 5: EmpleyO</h2>
        <div class="grid md:grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Employment Status *</label>
            <select name="employment_status" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm bg-white">
              <option value="Employed">Employed</option>
              <option value="Self-Employed">Self-Employed</option>
              <option value="Unemployed">Unemployed</option>
              <option value="OFW">OFW</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Trabaho / Profession</label>
            <input type="text" name="occupation" class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm" placeholder="Software Engineer">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Pangalan ng Kumpanya (Employer)</label>
            <input type="text" name="employer_name" class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm" placeholder="ABC Corp">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Address ng Kumpanya</label>
            <input type="text" name="employer_address" class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm" placeholder="Makati City">
          </div>
        </div>
      </div>

      <div class="space-y-4">
        <h2 class="text-xl font-bold text-blue-950 border-b pb-3">Hakbang 6: Beneficiaries (Para sa SSS & Pag-IBIG)</h2>
        <div id="beneficiariesList" class="space-y-4">
          <div class="beneficiary-item border border-slate-200 p-5 rounded-2xl bg-slate-50 relative space-y-3">
            <h4 class="font-bold text-xs uppercase text-blue-950">Beneficiary 1</h4>
            <div class="grid md:grid-cols-3 gap-3">
              <div>
                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Buong Pangalan</label>
                <input type="text" name="ben_name[]" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white" placeholder="Pangalan">
              </div>
              <div>
                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Kapanganakan</label>
                <input type="date" name="ben_dob[]" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white">
              </div>
              <div>
                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Relasyon</label>
                <input type="text" name="ben_relationship[]" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white" placeholder="Anak / Asawa">
              </div>
              <div class="md:col-span-2">
                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Tirahan</label>
                <input type="text" name="ben_address[]" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white" placeholder="Tirahan">
              </div>
              <div>
                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Contact Number</label>
                <input type="text" name="ben_contact[]" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white" placeholder="0912...">
              </div>
            </div>
          </div>
        </div>
        <button type="button" onclick="addBeneficiary()" class="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition shadow">+ Magdagdag ng Beneficiary</button>
      </div>

      <div class="space-y-4">
        <h2 class="text-xl font-bold text-blue-950 border-b pb-3">Hakbang 7: Valid ID at Larawan</h2>
        <div class="grid md:grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Uri ng Valid ID *</label>
            <select name="id_type" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm bg-white">
              <option value="National ID">National ID</option>
              <option value="Passport">Passport</option>
              <option value="Driver's License">Driver's License</option>
              <option value="UMID">UMID</option>
              <option value="Postal ID">Postal ID</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-bold uppercase text-slate-600 mb-1">ID Picture / Profile Picture *</label>
            <input type="file" name="id_picture" accept="image/*" capture="user" required class="w-full border border-slate-300 rounded-xl px-4 py-2 text-sm bg-white">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Front ng Valid ID *</label>
            <input type="file" name="id_front" accept="image/*,application/pdf" capture="environment" required class="w-full border border-slate-300 rounded-xl px-4 py-2 text-sm bg-white">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Back ng Valid ID</label>
            <input type="file" name="id_back" accept="image/*,application/pdf" capture="environment" class="w-full border border-slate-300 rounded-xl px-4 py-2 text-sm bg-white">
          </div>
          <div class="md:col-span-2">
            <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Larawan Hawak ang Valid ID *</label>
            <input type="file" name="photo_holding_id" accept="image/*" capture="user" required class="w-full border border-slate-300 rounded-xl px-4 py-2 text-sm bg-white">
            <span class="text-xs text-slate-500 mt-1 block">Kuha ng mukha habang hawak ang ID malapit sa mukha para sa beripikasyon.</span>
          </div>
        </div>
      </div>

      <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-xl text-base transition shadow-lg">Isumite ang Aplikasyon</button>
    </form>

    <script>
      function toggleMarriageSection() {
        const civilStatus = document.getElementById('civilStatus').value;
        const marriageSection = document.getElementById('marriageSection');
        if (civilStatus === 'Married') {
          marriageSection.classList.remove('hidden');
        } else {
          marriageSection.classList.add('hidden');
        }
      }

      function addBeneficiary() {
        const container = document.getElementById('beneficiariesList');
        const count = container.getElementsByClassName('beneficiary-item').length + 1;
        const div = document.createElement('div');
        div.className = 'beneficiary-item border border-slate-200 p-5 rounded-2xl bg-slate-50 relative space-y-3';
        div.innerHTML = \`
          <div class="flex justify-between items-center">
            <h4 class="font-bold text-xs uppercase text-blue-950">Beneficiary \${count}</h4>
            <button type="button" onclick="this.closest('.beneficiary-item').remove()" class="text-red-600 text-xs font-bold hover:underline">Tanggalin</button>
          </div>
          <div class="grid md:grid-cols-3 gap-3">
            <div>
              <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Buong Pangalan</label>
              <input type="text" name="ben_name[]" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white" placeholder="Pangalan">
            </div>
            <div>
              <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Kapanganakan</label>
              <input type="date" name="ben_dob[]" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white">
            </div>
            <div>
              <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Relasyon</label>
              <input type="text" name="ben_relationship[]" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white" placeholder="Anak / Asawa">
            </div>
            <div class="md:col-span-2">
              <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Tirahan</label>
              <input type="text" name="ben_address[]" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white" placeholder="Tirahan">
            </div>
            <div>
              <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Contact Number</label>
              <input type="text" name="ben_contact[]" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white" placeholder="0912...">
            </div>
          </div>
        \`;
        container.appendChild(div);
      }
    </script>
  `;
  res.send(customerLayout('Bagong Aplikasyon', content, 'apply', 0, req.session));
});

app.post('/customer/apply', requireCustomer, upload.any(), async (req, res) => {
  const customerId = req.session.customer.id;
  const { service, first_name, middle_name, last_name, suffix, date_of_birth, place_of_birth, sex, civil_status, nationality, mobile_number, email_address, street, barangay, city, province, zip_code, father_name, father_dob, mother_maiden_name, mother_dob, spouse_name, spouse_dob, marriage_date, employment_status, occupation, employer_name, employer_address, id_type } = req.body;

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randNum = Math.floor(1000 + Math.random() * 9000);
  const prefix = service.includes('BIR') ? 'TIN' : service.includes('SSS') ? 'SSS' : 'PAG';
  const trackingNumber = `${prefix}-${dateStr}-${randNum}`;

  const formData = req.body;
  const dataJson = JSON.stringify(formData);

  db.run(`INSERT INTO applications (customer_id, service, tracking_number, status, payment_status, data_json) VALUES (?, ?, ?, 'Submitted', 'Payment Pending', ?)`,
    [customerId, service, trackingNumber, dataJson], function(err) {
      if (err) {
        return res.send(`<script>alert('Error sa pagsusumite ng aplikasyon!'); window.history.back();</script>`);
      }
      const appId = this.lastID;
      logStatusHistory(appId, 'Submitted', 'Aplikasyon ay matagumpay na naisumite.');

      if (req.files) {
        req.files.forEach(f => {
          db.run(`INSERT INTO documents (application_id, doc_type, file_path, file_name) VALUES (?, ?, ?, ?)`,
            [appId, f.fieldname, '/uploads/' + f.filename, f.originalname]);
        });
      }

      const benNames = req.body.ben_name;
      if (benNames && Array.isArray(benNames)) {
        for (let i = 0; i < benNames.length; i++) {
          if (benNames[i]) {
            db.run(`INSERT INTO beneficiaries (application_id, full_name, birth_date, relationship, address, contact_number) VALUES (?, ?, ?, ?, ?, ?)`,
              [appId, benNames[i], req.body.ben_dob[i] || '', req.body.ben_relationship[i] || '', req.body.ben_address[i] || '', req.body.ben_contact[i] || '']);
          }
        }
      }

      addNotification(customerId, 'Aplikasyon Naisumite', `Ang iyong aplikasyon para sa ${service} (${trackingNumber}) ay matagumpay na natanggap.`);
      res.redirect('/customer/applications');
    });
});

app.get('/customer/applications', requireCustomer, async (req, res) => {
  const customerId = req.session.customer.id;
  db.all(`SELECT * FROM applications WHERE customer_id = ? ORDER BY id DESC`, [customerId], (err, apps) => {
    const content = `
      <h1 class="text-3xl font-black text-blue-950 mb-6">Aking mga Aplikasyon</h1>
      <div class="bg-white p-8 rounded-2xl shadow-sm border border-slate-200">
        ${apps.length === 0 ? `<p class="text-slate-500 text-sm">Wala pang nakatalang aplikasyon.</p>` : `
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse">
              <thead>
                <tr class="border-b bg-slate-50 text-xs text-slate-500 uppercase">
                  <th class="p-3">Tracking Number</th>
                  <th class="p-3">Serbisyo</th>
                  <th class="p-3">Status</th>
                  <th class="p-3">Bayad</th>
                  <th class="p-3">Petsa</th>
                  <th class="p-3">Aksyon</th>
                </tr>
              </thead>
              <tbody class="text-sm">
                ${apps.map(app => `
                  <tr class="border-b hover:bg-slate-50 transition">
                    <td class="p-3 font-mono font-bold text-blue-950">${app.tracking_number}</td>
                    <td class="p-3 font-medium">${app.service}</td>
                    <td class="p-3"><span class="px-2.5 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-bold">${app.status}</span></td>
                    <td class="p-3"><span class="px-2.5 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-bold">${app.payment_status}</span></td>
                    <td class="p-3 text-xs text-slate-500">${new Date(app.created_at).toLocaleDateString()}</td>
                    <td class="p-3"><a href="/customer/track/${app.id}" class="text-blue-600 font-bold hover:underline text-xs">Tingnan Detalye</a></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    `;
    res.send(customerLayout('Aking mga Aplikasyon', content, 'applications', 0, req.session));
  });
});

app.get('/customer/track/:id', requireCustomer, async (req, res) => {
  const appId = req.params.id;
  const customerId = req.session.customer.id;

  db.get(`SELECT * FROM applications WHERE id = ? AND customer_id = ?`, [appId, customerId], (err, app) => {
    if (!app) return res.redirect('/customer/applications');

    db.all(`SELECT * FROM status_history WHERE application_id = ? ORDER BY id DESC`, [appId], (err2, history) => {
      db.all(`SELECT * FROM documents WHERE application_id = ?`, [appId], (err3, docs) => {
        db.all(`SELECT * FROM completed_files WHERE application_id = ?`, [appId], (err4, completedFiles) => {
          db.get(`SELECT * FROM payments WHERE application_id = ?`, [appId], (err5, payment) => {
            db.all(`SELECT * FROM beneficiaries WHERE application_id = ?`, [appId], (err6, beneficiaries) => {
              const settings = res.locals.settings;

              const content = `
                <div class="flex justify-between items-center mb-6">
                  <div>
                    <span class="text-xs font-bold uppercase text-slate-400">Tracking Number</span>
                    <h1 class="text-2xl md:text-3xl font-black text-blue-950 font-mono">${app.tracking_number}</h1>
                  </div>
                  <a href="/customer/applications" class="text-sm font-bold text-blue-600 hover:underline">&larr; Bumalik</a>
                </div>

                <div class="grid md:grid-cols-3 gap-6 mb-8">
                  <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                    <span class="text-xs font-bold uppercase text-slate-400">Serbisyo</span>
                    <p class="text-lg font-bold text-blue-950 mt-1">${app.service}</p>
                  </div>
                  <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                    <span class="text-xs font-bold uppercase text-slate-400">Status ng Aplikasyon</span>
                    <p class="text-lg font-bold text-blue-600 mt-1">${app.status}</p>
                  </div>
                  <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                    <span class="text-xs font-bold uppercase text-slate-400">Status ng Bayad</span>
                    <p class="text-lg font-bold text-amber-600 mt-1">${app.payment_status}</p>
                  </div>
                </div>

                ${app.admin_remarks ? `
                  <div class="bg-blue-50 border border-blue-200 p-4 rounded-2xl mb-8">
                    <h4 class="font-bold text-blue-950 text-xs uppercase mb-1">Admin Remarks:</h4>
                    <p class="text-sm text-blue-900">${app.admin_remarks}</p>
                  </div>
                ` : ''}

                <div class="grid md:grid-cols-2 gap-8 mb-8">
                  <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-4">
                    <h3 class="font-bold text-blue-950 border-b pb-2">Mga Na-upload na Dokumento</h3>
                    <div class="space-y-2 text-sm">
                      ${docs.map(d => `<div class="flex justify-between items-center border-b pb-2"><span class="font-medium uppercase text-xs text-slate-600">${d.doc_type}</span><a href="${d.file_path}" target="_blank" class="text-blue-600 font-bold hover:underline text-xs">Tingnan File</a></div>`).join('')}
                    </div>
                  </div>

                  <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-4">
                    <h3 class="font-bold text-blue-950 border-b pb-2">Mga Nakumpletong Dokumento mula sa Admin</h3>
                    ${completedFiles.length === 0 ? `<p class="text-slate-400 text-xs">Wala pang nai-upload na completed files ng admin.</p>` : `
                      <div class="space-y-2 text-sm">
                        ${completedFiles.map(cf => `<div class="flex justify-between items-center border-b pb-2"><div><span class="font-bold text-xs text-slate-800 block">${cf.file_name}</span><span class="text-xs text-slate-500">${cf.description || ''}</span></div><a href="${cf.file_path}" target="_blank" class="bg-emerald-600 text-white px-3 py-1 rounded-lg text-xs font-bold">I-download</a></div>`).join('')}
                      </div>
                    `}
                  </div>
                </div>

                <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 mb-8 space-y-4">
                  <h3 class="font-bold text-blue-950 border-b pb-2">Detalye ng Pagbabayad (Payment)</h3>
                  ${payment ? `
                    <div class="grid md:grid-cols-3 gap-4 text-sm">
                      <div><strong>Paraan:</strong> ${payment.payment_method}</div>
                      <div><strong>Halaga:</strong> ₱${payment.amount}</div>
                      <div><strong>Status:</strong> <span class="text-amber-600 font-bold">${payment.payment_status}</span></div>
                      <div><strong>Reference #:</strong> ${payment.reference_number || 'N/A'}</div>
                      ${payment.proof_path ? `<div><strong>Proof:</strong> <a href="${payment.proof_path}" target="_blank" class="text-blue-600 font-bold hover:underline">Tingnan Proof</a></div>` : ''}
                    </div>
                  ` : `
                    <p class="text-sm text-slate-600 mb-4">Wala pang nai-submit na bayad para sa aplikasyong ito.</p>
                    <form action="/customer/payment" method="POST" enctype="multipart/form-data" class="space-y-4 border-t pt-4">
                      <input type="hidden" name="application_id" value="${app.id}">
                      <input type="hidden" name="tracking_number" value="${app.tracking_number}">
                      <input type="hidden" name="service" value="${app.service}">
                      <div class="grid md:grid-cols-2 gap-4">
                        <div>
                          <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Paraan ng Pagbabayad *</label>
                          <select name="payment_method" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm bg-white">
                            <option value="GCash">GCash (${settings.gcash_number} - ${settings.gcash_name})</option>
                            <option value="Bank Transfer">Bank Transfer</option>
                          </select>
                        </div>
                        <div>
                          <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Halaga (Amount) *</label>
                          <input type="number" name="amount" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm" value="${app.service.includes('BIR') ? settings.fee_bir : settings.fee_sss}">
                        </div>
                        <div>
                          <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Reference Number *</label>
                          <input type="text" name="reference_number" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm" placeholder="GCash Ref No.">
                        </div>
                        <div>
                          <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Katibayan ng Bayad (Proof of Payment) *</label>
                          <input type="file" name="proof_payment" accept="image/*,application/pdf" required class="w-full border border-slate-300 rounded-xl px-4 py-2 text-sm bg-white">
                        </div>
                      </div>
                      <div class="bg-amber-50 p-4 rounded-xl text-xs text-amber-900 whitespace-pre-line"><strong>Instruksyon sa Pagbabayad:</strong>\n${settings.payment_instructions}</div>
                      <button type="submit" class="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-6 py-3 rounded-xl text-xs uppercase tracking-wider transition shadow">Isumite ang Proof of Payment</button>
                    </form>
                  `}
                </div>

                <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                  <h3 class="font-bold text-blue-950 border-b pb-2 mb-4">Status History Timeline</h3>
                  <div class="space-y-3">
                    ${history.map(h => `
                      <div class="border-l-2 border-blue-600 pl-4 py-1 text-sm">
                        <span class="font-bold text-blue-950">${h.status}</span> <span class="text-xs text-slate-400 ml-2">${new Date(h.created_at).toLocaleString()}</span>
                        ${h.notes ? `<p class="text-slate-600 text-xs mt-0.5">${h.notes}</p>` : ''}
                      </div>
                    `).join('')}
                  </div>
                </div>
              `;
              res.send(customerLayout('Detalye ng Aplikasyon', content, 'applications', 0, req.session));
            });
          });
        });
      });
    });
  });
});

app.post('/customer/payment', requireCustomer, upload.single('proof_payment'), async (req, res) => {
  const customerId = req.session.customer.id;
  const { application_id, tracking_number, service, payment_method, amount, reference_number } = req.body;
  const proofPath = req.file ? '/uploads/' + req.file.filename : '';

  db.run(`INSERT INTO payments (customer_id, application_id, tracking_number, service, payment_method, amount, reference_number, proof_path, payment_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pending Verification')`,
    [customerId, application_id, tracking_number, service, payment_method, amount, reference_number, proofPath], function(err) {
      if (err) {
        return res.send(`<script>alert('Error sa pagsusumite ng payment proof!'); window.history.back();</script>`);
      }
      db.run(`UPDATE applications SET payment_status = 'Payment Verification Pending' WHERE id = ?`, [application_id]);
      logStatusHistory(application_id, 'Payment Submitted', 'Isinumite ang katibayan ng pagbabayad para beripikahin.');
      addNotification(customerId, 'Payment Submitted', `Ang iyong payment proof para sa ${tracking_number} ay isinumite na.`);
      res.redirect('/customer/track/' + application_id);
    });
});

app.get('/customer/documents', requireCustomer, async (req, res) => {
  const customerId = req.session.customer.id;
  db.all(`SELECT cf.*, a.tracking_number, a.service FROM completed_files cf JOIN applications a ON cf.application_id = a.id WHERE a.customer_id = ? ORDER BY cf.id DESC`, [customerId], (err, files) => {
    const content = `
      <h1 class="text-3xl font-black text-blue-950 mb-6">Mga Nakumpletong Dokumento</h1>
      <div class="bg-white p-8 rounded-2xl shadow-sm border border-slate-200">
        ${files.length === 0 ? `<p class="text-slate-500 text-sm">Wala pang nakumpletong dokumento na nai-upload ng admin.</p>` : `
          <div class="space-y-4">
            ${files.map(f => `
              <div class="border border-slate-200 p-5 rounded-2xl flex justify-between items-center bg-slate-50">
                <div>
                  <span class="text-xs font-bold uppercase text-blue-900 block">${f.service} (${f.tracking_number})</span>
                  <h4 class="font-bold text-slate-800 text-base mt-1">${f.file_name}</h4>
                  <p class="text-xs text-slate-500">${f.description || ''}</p>
                </div>
                <a href="${f.file_path}" target="_blank" class="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl text-xs font-bold transition shadow">I-download File</a>
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
  const customerId = req.session.customer.id;
  db.all(`SELECT * FROM notifications WHERE customer_id = ? ORDER BY id DESC`, [customerId], (err, notifs) => {
    db.run(`UPDATE notifications SET is_read = 1 WHERE customer_id = ?`, [customerId]);
    const content = `
      <h1 class="text-3xl font-black text-blue-950 mb-6">Notifications</h1>
      <div class="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 space-y-4">
        ${notifs.length === 0 ? `<p class="text-slate-500 text-sm">Walang notifications.</p>` : `
          ${notifs.map(n => `
            <div class="border-b pb-4 last:border-0">
              <div class="flex justify-between items-center">
                <h4 class="font-bold text-blue-950 text-base">${n.title}</h4>
                <span class="text-xs text-slate-400">${new Date(n.created_at).toLocaleString()}</span>
              </div>
              <p class="text-sm text-slate-600 mt-1">${n.message}</p>
            </div>
          `).join('')}
        `}
      </div>
    `;
    res.send(customerLayout('Notifications', content, 'notifications', 0, req.session));
  });
});

app.get('/customer/profile', requireCustomer, async (req, res) => {
  const customerId = req.session.customer.id;
  db.get(`SELECT * FROM users WHERE id = ?`, [customerId], (err, user) => {
    const content = `
      <h1 class="text-3xl font-black text-blue-950 mb-6">Profile ng Customer</h1>
      <div class="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 max-w-xl">
        <form action="/customer/profile" method="POST" class="space-y-4">
          <div>
            <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Buong Pangalan</label>
            <input type="text" name="full_name" value="${user.full_name}" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Username</label>
            <input type="text" value="${user.username}" disabled class="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm bg-slate-100 text-slate-500">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Mobile Number</label>
            <input type="text" name="mobile_number" value="${user.mobile_number}" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Email Address</label>
            <input type="email" name="email_address" value="${user.email_address}" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm">
          </div>
          <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-3 rounded-xl text-xs uppercase tracking-wider transition shadow">I-update ang Profile</button>
        </form>
      </div>
    `;
    res.send(customerLayout('Profile', content, 'profile', 0, req.session));
  });
});

app.post('/customer/profile', requireCustomer, (req, res) => {
  const customerId = req.session.customer.id;
  const { full_name, mobile_number, email_address } = req.body;
  db.run(`UPDATE users SET full_name = ?, mobile_number = ?, email_address = ? WHERE id = ?`, [full_name, mobile_number, email_address], (err) => {
    if (!err) {
      req.session.customer.full_name = full_name;
    }
    res.redirect('/customer/profile');
  });
});

// ==========================================
// ADMIN PORTAL & DASHBOARD
// ==========================================
function adminLayout(title, content, activeTab) {
  return `
    <!DOCTYPE html>
    <html lang="tl">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title}</title>
      <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
    </head>
    <body class="bg-slate-100 text-slate-800 font-sans">
      <div class="min-h-screen flex flex-col md:flex-row">
        <aside class="bg-slate-950 text-white w-full md:w-72 p-6 flex flex-col justify-between shadow-xl">
          <div>
            <div class="text-lg font-black mb-8 flex items-center space-x-2">
              <span class="bg-slate-800 text-slate-200 px-2 py-1 rounded">AD</span>
              <span>GovAssist Admin</span>
            </div>
            <nav class="space-y-1.5 text-sm font-medium">
              <a href="/admin/dashboard" class="block px-4 py-2.5 rounded-xl ${activeTab === 'dashboard' ? 'bg-slate-800 font-bold text-white shadow' : 'text-slate-300 hover:bg-slate-900'}">Dashboard</a>
              <a href="/admin/applications" class="block px-4 py-2.5 rounded-xl ${activeTab === 'applications' ? 'bg-slate-800 font-bold text-white shadow' : 'text-slate-300 hover:bg-slate-900'}">Lahat ng Aplikasyon</a>
              <a href="/admin/payments" class="block px-4 py-2.5 rounded-xl ${activeTab === 'payments' ? 'bg-slate-800 font-bold text-white shadow' : 'text-slate-300 hover:bg-slate-900'}">Payments Verification</a>
              <a href="/admin/settings" class="block px-4 py-2.5 rounded-xl ${activeTab === 'settings' ? 'bg-slate-800 font-bold text-white shadow' : 'text-slate-300 hover:bg-slate-900'}">Settings & Fees</a>
              <a href="/admin/backup" class="block px-4 py-2.5 rounded-xl text-slate-300 hover:bg-slate-900">Export / Backup Data</a>
            </nav>
          </div>
          <div class="mt-8 pt-4 border-t border-slate-800">
            <span class="block text-xs text-slate-400 mb-2">Admin Portal</span>
            <a href="/admin/logout" class="block text-center bg-red-600 hover:bg-red-700 text-white py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition shadow">Admin Logout</a>
          </div>
        </aside>

        <main class="flex-1 p-6 md:p-12 overflow-y-auto">
          ${content}
          <div class="mt-16 pt-6 border-t border-slate-300 text-center text-xs text-slate-500">
            System Lead Developer / Creator: <span class="font-bold text-slate-700">Mark Jerald Agdigos</span>
          </div>
        </main>
      </div>
    </body>
    </html>
  `;
}

app.get('/admin/dashboard', requireAdmin, async (req, res) => {
  db.all(`SELECT a.*, u.full_name FROM applications a JOIN users u ON a.customer_id = u.id ORDER BY a.id DESC`, [], (err, apps) => {
    db.all(`SELECT * FROM payments WHERE payment_status = 'Pending Verification'`, [], (err2, pendingPayments) => {
      const totalApps = apps.length;
      const pendingApps = apps.filter(a => a.status === 'Submitted' || a.status === 'Under Review').length;
      const completedApps = apps.filter(a => a.status === 'Completed').length;

      const content = `
        <h1 class="text-3xl font-black text-slate-900 mb-6">Admin Dashboard</h1>

        <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 border-l-4 border-l-slate-900">
            <h3 class="text-slate-500 text-xs font-bold uppercase">Total Aplikasyon</h3>
            <p class="text-3xl font-black text-slate-900 mt-2">${totalApps}</p>
          </div>
          <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 border-l-4 border-l-blue-600">
            <h3 class="text-slate-500 text-xs font-bold uppercase">Pending</h3>
            <p class="text-3xl font-black text-blue-600 mt-2">${pendingApps}</p>
          </div>
          <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 border-l-4 border-l-emerald-600">
            <h3 class="text-slate-500 text-xs font-bold uppercase">Completed</h3>
            <p class="text-3xl font-black text-emerald-600 mt-2">${completedApps}</p>
          </div>
          <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 border-l-4 border-l-amber-500">
            <h3 class="text-slate-500 text-xs font-bold uppercase">Pending Payments</h3>
            <p class="text-3xl font-black text-amber-600 mt-2">${pendingPayments.length}</p>
          </div>
        </div>

        <div class="bg-white p-8 rounded-2xl shadow-sm border border-slate-200">
          <h2 class="text-xl font-bold text-slate-900 mb-6">Pinakabagong Aplikasyon</h2>
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse">
              <thead>
                <tr class="border-b bg-slate-50 text-xs text-slate-500 uppercase">
                  <th class="p-3">Tracking #</th>
                  <th class="p-3">Kliyente</th>
                  <th class="p-3">Serbisyo</th>
                  <th class="p-3">Status</th>
                  <th class="p-3">Bayad</th>
                  <th class="p-3">Aksyon</th>
                </tr>
              </thead>
              <tbody class="text-sm">
                ${apps.slice(0, 10).map(app => `
                  <tr class="border-b hover:bg-slate-50 transition">
                    <td class="p-3 font-mono font-bold text-slate-900">${app.tracking_number}</td>
                    <td class="p-3 font-medium">${app.full_name}</td>
                    <td class="p-3">${app.service}</td>
                    <td class="p-3"><span class="px-2.5 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-bold">${app.status}</span></td>
                    <td class="p-3"><span class="px-2.5 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-bold">${app.payment_status}</span></td>
                    <td class="p-3"><a href="/admin/application/${app.id}" class="text-slate-900 font-bold hover:underline text-xs">Pamahalaan</a></td>
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
      <h1 class="text-3xl font-black text-slate-900 mb-6">Lahat ng Aplikasyon</h1>
      <div class="bg-white p-8 rounded-2xl shadow-sm border border-slate-200">
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="border-b bg-slate-50 text-xs text-slate-500 uppercase">
                <th class="p-3">Tracking #</th>
                <th class="p-3">Kliyente</th>
                <th class="p-3">Serbisyo</th>
                <th class="p-3">Status</th>
                <th class="p-3">Bayad</th>
                <th class="p-3">Aksyon</th>
              </tr>
            </thead>
            <tbody class="text-sm">
              ${apps.map(app => `
                <tr class="border-b hover:bg-slate-50 transition">
                  <td class="p-3 font-mono font-bold text-slate-900">${app.tracking_number}</td>
                  <td class="p-3 font-medium">${app.full_name}</td>
                  <td class="p-3">${app.service}</td>
                  <td class="p-3"><span class="px-2.5 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-bold">${app.status}</span></td>
                  <td class="p-3"><span class="px-2.5 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-bold">${app.payment_status}</span></td>
                  <td class="p-3"><a href="/admin/application/${app.id}" class="text-slate-900 font-bold hover:underline text-xs">Pamahalaan</a></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
    res.send(adminLayout('Lahat ng Aplikasyon', content, 'applications'));
  });
});

app.get('/admin/application/:id', requireAdmin, (req, res) => {
  const appId = req.params.id;
  db.get(`SELECT a.*, u.full_name, u.email_address, u.mobile_number, u.id as customer_id FROM applications a JOIN users u ON a.customer_id = u.id WHERE a.id = ?`, [appId], (err, app) => {
    if (!app) return res.redirect('/admin/applications');

    db.all(`SELECT * FROM documents WHERE application_id = ?`, [appId], (err2, docs) => {
      db.all(`SELECT * FROM completed_files WHERE application_id = ?`, [appId], (err3, completedFiles) => {
        db.get(`SELECT * FROM payments WHERE application_id = ?`, [appId], (err4, payment) => {
          db.all(`SELECT * FROM beneficiaries WHERE application_id = ?`, [appId], (err5, beneficiaries) => {
            let formData = {};
            try { formData = JSON.parse(app.data_json || '{}'); } catch(e){}

            const content = `
              <div class="flex justify-between items-center mb-6">
                <div>
                  <span class="text-xs font-bold uppercase text-slate-400">Admin Application Management</span>
                  <h1 class="text-2xl md:text-3xl font-black text-slate-900 font-mono">${app.tracking_number}</h1>
                </div>
                <a href="/admin/applications" class="text-sm font-bold text-slate-700 hover:underline">&larr; Bumalik</a>
              </div>

              <div class="grid md:grid-cols-2 gap-8 mb-8">
                <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-4">
                  <h3 class="font-bold text-slate-900 border-b pb-2">Impormasyon ng Kliyente</h3>
                  <div class="text-sm space-y-1">
                    <div><strong>Pangalan:</strong> ${app.full_name}</div>
                    <div><strong>Mobile:</strong> ${app.mobile_number}</div>
                    <div><strong>Email:</strong> ${app.email_address}</div>
                    <div><strong>Serbisyo:</strong> ${app.service}</div>
                  </div>

                  <h3 class="font-bold text-slate-900 border-b pb-2 pt-2">Personal & Form Data</h3>
                  <div class="text-xs space-y-1 bg-slate-50 p-3 rounded-xl">
                    <p><strong>Dob:</strong> ${formData.date_of_birth || ''}</p>
                    <p><strong>Address:</strong> ${formData.street || ''}, ${formData.barangay || ''}, ${formData.city || ''} (${formData.zip_code || ''})</p>
                    <p><strong>Father:</strong> ${formData.father_name || ''}</p>
                    <p><strong>Mother:</strong> ${formData.mother_maiden_name || ''}</p>
                    ${formData.spouse_name ? `<p><strong>Spouse:</strong> ${formData.spouse_name}</p>` : ''}
                  </div>
                </div>

                <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-6">
                  <h3 class="font-bold text-slate-900 border-b pb-2">I-update ang Status</h3>
                  <form action="/admin/application/${app.id}/status" method="POST" class="space-y-4">
                    <div>
                      <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Status</label>
                      <select name="status" class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm bg-white">
                        <option value="Submitted" ${app.status === 'Submitted' ? 'selected' : ''}>Submitted</option>
                        <option value="Under Review" ${app.status === 'Under Review' ? 'selected' : ''}>Under Review</option>
                        <option value="Processing with Government" ${app.status === 'Processing with Government' ? 'selected' : ''}>Processing with Government</option>
                        <option value="Completed" ${app.status === 'Completed' ? 'selected' : ''}>Completed</option>
                        <option value="Rejected" ${app.status === 'Rejected' ? 'selected' : ''}>Rejected</option>
                      </select>
                    </div>
                    <div>
                      <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Admin Remarks</label>
                      <textarea name="admin_remarks" rows="2" class="w-full border border-slate-300 rounded-xl p-3 text-sm" placeholder="Ilagay ang remarks o notes...">${app.admin_remarks || ''}</textarea>
                    </div>
                    <button type="submit" class="bg-slate-900 hover:bg-slate-800 text-white font-bold px-6 py-3 rounded-xl text-xs uppercase tracking-wider transition shadow">I-update ang Status</button>
                  </form>
                </div>
              </div>

              <div class="grid md:grid-cols-2 gap-8 mb-8">
                <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-4">
                  <h3 class="font-bold text-slate-900 border-b pb-2">Mga Na-upload na Dokumento ng Kliyente</h3>
                  <div class="space-y-2 text-sm">
                    ${docs.map(d => `<div class="flex justify-between items-center border-b pb-2"><span class="font-bold uppercase text-xs text-slate-600">${d.doc_type}</span><a href="${d.file_path}" target="_blank" class="text-blue-600 font-bold hover:underline text-xs">Tingnan File</a></div>`).join('')}
                  </div>
                </div>

                <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-4">
                  <h3 class="font-bold text-slate-900 border-b pb-2">Mag-upload ng Nakumpletong Dokumento (Resulta)</h3>
                  <form action="/admin/application/${app.id}/completed-file" method="POST" enctype="multipart/form-data" class="space-y-3">
                    <div>
                      <label class="block text-xs font-bold uppercase text-slate-600 mb-1">File ng Resulta (PDF/Image)</label>
                      <input type="file" name="completed_file" accept="image/*,application/pdf" required class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white">
                    </div>
                    <div>
                      <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Pangalan / Deskripsyon</label>
                      <input type="text" name="description" required class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm" placeholder="hal. Approved TIN ID / SSS E-1 Form">
                    </div>
                    <button type="submit" class="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2.5 rounded-xl text-xs uppercase tracking-wider transition shadow">I-upload ang Completed File</button>
                  </form>
                  <div class="mt-4 space-y-2">
                    ${completedFiles.map(cf => `<div class="flex justify-between items-center border-b pb-2 text-xs"><span class="font-bold">${cf.file_name}</span><a href="${cf.file_path}" target="_blank" class="text-blue-600 font-bold hover:underline">Tingnan</a></div>`).join('')}
                  </div>
                </div>
              </div>
            `;
            res.send(adminLayout('Pamahalaan Aplikasyon', content, 'applications'));
          });
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
      db.run(`UPDATE applications SET status = ?, admin_remarks = ? WHERE id = ?`, [status, admin_remarks, appId], (err2) => {
        logStatusHistory(appId, status, admin_remarks);
        addNotification(app.customer_id, 'Status Update', `Ang iyong aplikasyon na ${app.tracking_number} ay na-update sa: ${status}`);
        res.redirect('/admin/application/' + appId);
      });
    } else {
      res.redirect('/admin/applications');
    }
  });
});

app.post('/admin/application/:id/completed-file', requireAdmin, upload.single('completed_file'), (req, res) => {
  const appId = req.params.id;
  const { description } = req.body;
  if (req.file) {
    const filePath = '/uploads/' + req.file.filename;
    const fileName = req.file.originalname;
    const fileType = req.file.mimetype;

    db.run(`INSERT INTO completed_files (application_id, file_path, file_name, file_type, description) VALUES (?, ?, ?, ?, ?)`,
      [appId, filePath, fileName, fileType, description], (err) => {
        db.get(`SELECT customer_id, tracking_number FROM applications WHERE id = ?`, [appId], (err2, app) => {
          if (app) {
            addNotification(app.customer_id, 'Completed Document Ready', `May bago kang nai-upload na dokumento para sa iyong aplikasyon na ${app.tracking_number}.`);
          }
          res.redirect('/admin/application/' + appId);
        });
      });
  } else {
    res.redirect('/admin/application/' + appId);
  }
});

app.get('/admin/payments', requireAdmin, (req, res) => {
  db.all(`SELECT p.*, u.full_name FROM payments p JOIN users u ON p.customer_id = u.id ORDER BY p.id DESC`, [], (err, payments) => {
    const content = `
      <h1 class="text-3xl font-black text-slate-900 mb-6">Payments Verification</h1>
      <div class="bg-white p-8 rounded-2xl shadow-sm border border-slate-200">
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="border-b bg-slate-50 text-xs text-slate-500 uppercase">
                <th class="p-3">Tracking #</th>
                <th class="p-3">Kliyente</th>
                <th class="p-3">Paraan / Halaga</th>
                <th class="p-3">Reference #</th>
                <th class="p-3">Status</th>
                <th class="p-3">Proof</th>
                <th class="p-3">Aksyon</th>
              </tr>
            </thead>
            <tbody class="text-sm">
              ${payments.map(p => `
                <tr class="border-b hover:bg-slate-50 transition">
                  <td class="p-3 font-mono font-bold text-slate-900">${p.tracking_number}</td>
                  <td class="p-3 font-medium">${p.full_name}</td>
                  <td class="p-3">${p.payment_method} (₱${p.amount})</td>
                  <td class="p-3 font-mono text-xs">${p.reference_number || 'N/A'}</td>
                  <td class="p-3"><span class="px-2.5 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-bold">${p.payment_status}</span></td>
                  <td class="p-3">${p.proof_path ? `<a href="${p.proof_path}" target="_blank" class="text-blue-600 font-bold hover:underline text-xs">Tingnan</a>` : 'Wala'}</td>
                  <td class="p-3">
                    ${p.payment_status === 'Pending Verification' ? `
                      <form action="/admin/payment/${p.id}/verify" method="POST" class="inline">
                        <button type="submit" class="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1 rounded-lg text-xs font-bold">I-verify</button>
                      </form>
                    ` : '<span class="text-slate-400 text-xs font-bold">Na-verify na</span>'}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
    res.send(adminLayout('Payments Verification', content, 'payments'));
  });
});

app.post('/admin/payment/:id/verify', requireAdmin, (req, res) => {
  db.get(`SELECT * FROM payments WHERE id = ?`, [req.params.id], (err, payment) => {
    if (payment) {
      db.run(`UPDATE payments SET payment_status = 'Verified', verified_by = ? WHERE id = ?`, [req.session.admin.username, payment.id]);
      db.run(`UPDATE applications SET payment_status = 'Paid / Verified' WHERE id = ?`, [payment.application_id]);
      addNotification(payment.customer_id, 'Payment Verified', `Ang iyong bayad para sa tracking number ${payment.tracking_number} ay na-verify na.`);
    }
    res.redirect('/admin/payments');
  });
});

app.get('/admin/settings', requireAdmin, async (req, res) => {
  const settings = await getSettings();
  const content = `
    <h1 class="text-3xl font-black text-slate-900 mb-6">Settings & Fees Configuration</h1>
    <div class="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 max-w-2xl">
      <form action="/admin/settings" method="POST" class="space-y-4">
        <div>
          <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Pangalan ng Negosyo</label>
          <input type="text" name="business_name" value="${settings.business_name || ''}" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm">
        </div>
        <div class="grid md:grid-cols-3 gap-4">
          <div>
            <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Fee BIR (₱)</label>
            <input type="number" name="fee_bir" value="${settings.fee_bir || '500'}" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Fee SSS (₱)</label>
            <input type="number" name="fee_sss" value="${settings.fee_sss || '400'}" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm">
          </div>
          <div>
            <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Fee Pag-IBIG (₱)</label>
            <input type="number" name="fee_pagibig" value="${settings.fee_pagibig || '400'}" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm">
          </div>
        </div>
        <div>
          <label class="block text-xs font-bold uppercase text-slate-600 mb-1">GCash Account Name</label>
          <input type="text" name="gcash_name" value="${settings.gcash_name || ''}" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm">
        </div>
        <div>
          <label class="block text-xs font-bold uppercase text-slate-600 mb-1">GCash Number</label>
          <input type="text" name="gcash_number" value="${settings.gcash_number || ''}" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm">
        </div>
        <div>
          <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Instruksyon sa Pagbabayad</label>
          <textarea name="payment_instructions" rows="4" class="w-full border border-slate-300 rounded-xl p-3 text-sm">${settings.payment_instructions || ''}</textarea>
        </div>
        <button type="submit" class="bg-slate-900 hover:bg-slate-800 text-white font-bold px-6 py-3 rounded-xl text-xs uppercase tracking-wider transition shadow">I-save ang Settings</button>
      </form>
    </div>
  `;
  res.send(adminLayout('Settings', content, 'settings'));
});

app.post('/admin/settings', requireAdmin, (req, res) => {
  const settings = req.body;
  db.serialize(() => {
    for (const [key, value] of Object.entries(settings)) {
      db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [key, value]);
    }
  });
  res.redirect('/admin/settings');
});

app.get('/admin/backup', requireAdmin, (req, res) => {
  db.all(`SELECT a.*, u.full_name FROM applications a JOIN users u ON a.customer_id = u.id`, [], (err, apps) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=govassist_backup_' + Date.now() + '.json');
    res.send(JSON.stringify(apps, null, 2));
  });
});

app.listen(PORT, () => {
  console.log(`GovAssist PH Application running on port ${PORT}`);
  console.log(`Developed & Created by Mark Jerald Agdigos`);
});
