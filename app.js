const express = require('express');
const session = require('express-session');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Setup directories
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Setup Database (Persistent SQLite)
const db = new Database(path.join(__dirname, 'database.sqlite'));
db.pragma('journal_mode = WAL');

// Initialize Database Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    full_name TEXT NOT NULL,
    mobile TEXT NOT NULL,
    email TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    full_name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS admin_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    business_name TEXT DEFAULT 'GovAssist Express',
    contact_number TEXT DEFAULT '09170000000',
    email TEXT DEFAULT 'support@govassist.ph',
    address TEXT DEFAULT 'Manila, Philippines',
    gcash_name TEXT DEFAULT 'Admin Account',
    gcash_number TEXT DEFAULT '09170000000',
    gcash_qr_path TEXT DEFAULT '',
    fee_bir REAL DEFAULT 500.00,
    fee_sss REAL DEFAULT 400.00,
    fee_pagibig REAL DEFAULT 400.00
  );

  CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    tracking_number TEXT UNIQUE NOT NULL,
    service_type TEXT NOT NULL,
    status TEXT DEFAULT 'Submitted',
    payment_status TEXT DEFAULT 'Unpaid',
    payment_method TEXT DEFAULT 'CASH',
    amount REAL NOT NULL,
    gcash_ref TEXT DEFAULT '',
    gcash_date TEXT DEFAULT '',
    admin_remarks TEXT DEFAULT '',
    admin_notes TEXT DEFAULT '',
    form_data TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER NOT NULL,
    doc_type TEXT NOT NULL, -- valid_id, photo_holding_id, id_photo, gcash_proof, additional, completed
    file_path TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(application_id) REFERENCES applications(id)
  );

  CREATE TABLE IF NOT EXISTS status_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    remarks TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(application_id) REFERENCES applications(id)
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id INTEGER,
    action TEXT NOT NULL,
    details TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Insert Default Admin & Settings if not exists
const defaultAdmin = db.prepare('SELECT * FROM admins WHERE username = ?').get('admin');
if (!defaultAdmin) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO admins (username, password, full_name) VALUES (?, ?, ?)').run('admin', hash, 'System Administrator');
}

const defaultSettings = db.prepare('SELECT * FROM admin_settings WHERE id = 1').get();
if (!defaultSettings) {
  db.prepare('INSERT INTO admin_settings (id) VALUES (1)').run();
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'gov-assist-secret-key-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// Storage engine for Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(null, false);
  }
});

// Auth Middlewares
function authCustomer(req, res, next) {
  if (req.session.user && req.session.role === 'customer') return next();
  res.redirect('/customer/login');
}

function authAdmin(req, res, next) {
  if (req.session.user && req.session.role === 'admin') return next();
  res.redirect('/admin/login');
}

// Helper: Log Action
function logAudit(adminId, action, details) {
  db.prepare('INSERT INTO audit_logs (admin_id, action, details) VALUES (?, ?, ?)').run(adminId, action, details);
}

// Helper: Add Notification
function notifyUser(userId, title, message) {
  db.prepare('INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)').run(userId, title, message);
}

// ==========================================
// API ROUTES
// ==========================================

// Settings API
app.get('/api/settings', (req, res) => {
  const settings = db.prepare('SELECT business_name, contact_number, email, address, gcash_name, gcash_number, gcash_qr_path, fee_bir, fee_sss, fee_pagibig FROM admin_settings WHERE id = 1').get();
  res.json(settings);
});

// Customer Auth
app.post('/api/customer/register', (req, res) => {
  const { username, password, full_name, mobile, email } = req.body;
  try {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO users (username, password, full_name, mobile, email) VALUES (?, ?, ?, ?, ?)').run(username, hash, full_name, mobile, email);
    res.json({ success: true, message: 'Registration successful. Please login.' });
  } catch (err) {
    res.status(400).json({ success: false, message: 'Username already taken or invalid data.' });
  }
});

app.post('/api/customer/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (user && bcrypt.compareSync(password, user.password)) {
    req.session.user = { id: user.id, username: user.username, full_name: user.full_name, email: user.email, mobile: user.mobile };
    req.session.role = 'customer';
    return res.json({ success: true });
  }
  res.status(401).json({ success: false, message: 'Invalid username or password.' });
});

app.post('/api/customer/profile', authCustomer, (req, res) => {
  const { full_name, mobile, email, password } = req.body;
  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET full_name = ?, mobile = ?, email = ?, password = ? WHERE id = ?').run(full_name, mobile, email, hash, req.session.user.id);
  } else {
    db.prepare('UPDATE users SET full_name = ?, mobile = ?, email = ? WHERE id = ?').run(full_name, mobile, email, req.session.user.id);
  }
  req.session.user.full_name = full_name;
  req.session.user.mobile = mobile;
  req.session.user.email = email;
  res.json({ success: true, message: 'Profile updated successfully.' });
});

// New Application Submission
app.post('/api/applications', authCustomer, upload.fields([
  { name: 'valid_id', maxCount: 1 },
  { name: 'photo_holding_id', maxCount: 1 },
  { name: 'id_photo', maxCount: 1 },
  { name: 'additional', maxCount: 1 },
  { name: 'gcash_proof', maxCount: 1 }
]), (req, res) => {
  const { service_type, payment_method, gcash_ref, gcash_date, amount, ...formData } = req.body;
  
  // Dynamic Fee Lookup
  const settings = db.prepare('SELECT fee_bir, fee_sss, fee_pagibig FROM admin_settings WHERE id = 1').get();
  let fee = 0;
  if (service_type === 'BIR/TIN') fee = settings.fee_bir;
  else if (service_type === 'SSS') fee = settings.fee_sss;
  else if (service_type === 'Pag-IBIG') fee = settings.fee_pagibig;

  // Generate Tracking Number
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = service_type.replace(/[^a-zA-Z]/g, '').toUpperCase();
  const count = db.prepare('SELECT COUNT(*) as cnt FROM applications').get().cnt + 1;
  const trackingNumber = `${prefix}-${dateStr}-${String(count).padStart(4, '0')}`;

  const paymentStatus = (payment_method === 'GCASH' && req.files['gcash_proof']) ? 'Pending Verification' : 'Unpaid';

  const stmt = db.prepare(`
    INSERT INTO applications (user_id, tracking_number, service_type, payment_method, payment_status, amount, gcash_ref, gcash_date, form_data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(req.session.user.id, trackingNumber, service_type, payment_method, paymentStatus, fee, gcash_ref || '', gcash_date || '', JSON.stringify(formData));
  const appId = result.lastInsertRowid;

  // Save Initial History
  db.prepare('INSERT INTO status_history (application_id, status, remarks) VALUES (?, ?, ?)').run(appId, 'Submitted', 'Application submitted by customer.');

  // Save Documents
  const insertDoc = db.prepare('INSERT INTO documents (application_id, doc_type, file_path, original_name, mime_type) VALUES (?, ?, ?, ?, ?)');
  ['valid_id', 'photo_holding_id', 'id_photo', 'additional', 'gcash_proof'].forEach(key => {
    if (req.files[key]) {
      const file = req.files[key][0];
      insertDoc.run(appId, key, file.filename, file.originalname, file.mimetype);
    }
  });

  notifyUser(req.session.user.id, 'Application Submitted', `Your ${service_type} application (${trackingNumber}) has been submitted.`);
  res.json({ success: true, trackingNumber });
});

// Admin Auth
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
  if (admin && bcrypt.compareSync(password, admin.password)) {
    req.session.user = { id: admin.id, username: admin.username, full_name: admin.full_name };
    req.session.role = 'admin';
    logAudit(admin.id, 'LOGIN', 'Admin logged into system.');
    return res.json({ success: true });
  }
  res.status(401).json({ success: false, message: 'Invalid admin credentials.' });
});

// Admin Update Settings
app.post('/api/admin/settings', authAdmin, upload.single('gcash_qr'), (req, res) => {
  const { business_name, contact_number, email, address, gcash_name, gcash_number, fee_bir, fee_sss, fee_pagibig } = req.body;
  let qrPath = undefined;
  if (req.file) qrPath = req.file.filename;

  if (qrPath) {
    db.prepare(`UPDATE admin_settings SET business_name=?, contact_number=?, email=?, address=?, gcash_name=?, gcash_number=?, gcash_qr_path=?, fee_bir=?, fee_sss=?, fee_pagibig=? WHERE id=1`)
      .run(business_name, contact_number, email, address, gcash_name, gcash_number, qrPath, fee_bir, fee_sss, fee_pagibig);
  } else {
    db.prepare(`UPDATE admin_settings SET business_name=?, contact_number=?, email=?, address=?, gcash_name=?, gcash_number=?, fee_bir=?, fee_sss=?, fee_pagibig=? WHERE id=1`)
      .run(business_name, contact_number, email, address, gcash_name, gcash_number, fee_bir, fee_sss, fee_pagibig);
  }

  logAudit(req.session.user.id, 'SETTINGS_UPDATE', 'Updated business settings and GCash info.');
  res.json({ success: true });
});

// Admin Application Update
app.post('/api/admin/applications/update', authAdmin, upload.single('completed_file'), (req, res) => {
  const { id, status, payment_status, admin_remarks, admin_notes } = req.body;
  const appData = db.prepare('SELECT * FROM applications WHERE id = ?').get(id);

  if (!appData) return res.status(404).json({ success: false, message: 'Application not found' });

  db.prepare(`UPDATE applications SET status = ?, payment_status = ?, admin_remarks = ?, admin_notes = ? WHERE id = ?`)
    .run(status, payment_status, admin_remarks, admin_notes, id);

  if (status !== appData.status) {
    db.prepare('INSERT INTO status_history (application_id, status, remarks) VALUES (?, ?, ?)').run(id, status, admin_remarks);
    notifyUser(appData.user_id, 'Status Update', `Application ${appData.tracking_number} updated to ${status}.`);
  }

  if (req.file) {
    db.prepare('INSERT INTO documents (application_id, doc_type, file_path, original_name, mime_type) VALUES (?, ?, ?, ?, ?)')
      .run(id, 'completed', req.file.filename, req.file.originalname, req.file.mimetype);
    notifyUser(appData.user_id, 'File Ready', `A completed document has been uploaded for ${appData.tracking_number}.`);
  }

  logAudit(req.session.user.id, 'APPLICATION_UPDATE', `Updated status/payment for application #${appData.tracking_number}`);
  res.json({ success: true });
});

// Secure Document Viewer Route
app.get('/api/document/:id', (req, res) => {
  if (!req.session.user) return res.status(401).send('Unauthorized');
  const doc = db.prepare('SELECT d.*, a.user_id FROM documents d JOIN applications a ON d.application_id = a.id WHERE d.id = ?').get(req.params.id);

  if (!doc) return res.status(404).send('Document not found');

  // Customer Access Check
  if (req.session.role === 'customer' && doc.user_id !== req.session.user.id) {
    return res.status(403).send('Access Denied');
  }

  const filePath = path.join(UPLOADS_DIR, doc.file_path);
  if (!fs.existsSync(filePath)) return res.status(404).send('File missing on server');
  res.setHeader('Content-Type', doc.mime_type);
  res.sendFile(filePath);
});

// Logout
app.get('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// ==========================================
// FRONTEND VIEWS ROUTING & TEMPLATES
// ==========================================

const UI_HEADER = (title) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - GovAssist Express</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body class="bg-gray-50 text-gray-800 font-sans antialiased min-h-screen flex flex-col">
  <nav class="bg-slate-900 text-white shadow-md border-b border-slate-700">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
      <div class="flex items-center space-x-3">
        <i class="fa-solid fa-file-signature text-blue-400 text-2xl"></i>
        <span class="font-bold text-lg tracking-wide">GovAssist Express</span>
        <span class="text-xs bg-slate-800 border border-slate-600 px-2 py-0.5 rounded text-amber-400">Independent Assistance Service</span>
      </div>
      <div class="text-xs sm:text-sm text-gray-300">
        <i class="fa-solid fa-triangle-exclamation text-amber-400 mr-1"></i> Not an official BIR, SSS, or Pag-IBIG website
      </div>
    </div>
  </nav>
`;

const UI_FOOTER = `
  <footer class="bg-slate-900 text-gray-400 py-6 mt-auto border-t border-slate-800">
    <div class="max-w-7xl mx-auto px-4 text-center text-xs space-y-2">
      <p class="font-semibold text-gray-300">GovAssist Express Application Processing Assistance Service</p>
      <p>Disclaimer: This platform operates independently and is not affiliated with, endorsed by, or representing the Bureau of Internal Revenue (BIR), Social Security System (SSS), or Pag-IBIG Fund.</p>
      <p>© 2026 All Rights Reserved.</p>
    </div>
  </footer>
</body>
</html>
`;

// Landing / Redirect
app.get('/', (req, res) => {
  res.send(`
    ${UI_HEADER('Welcome')}
    <div class="flex-grow flex items-center justify-center p-6">
      <div class="max-w-md w-full bg-white rounded-xl shadow-lg p-8 text-center space-y-6">
        <h1 class="text-2xl font-bold text-slate-800">Document Processing Assistance</h1>
        <p class="text-sm text-gray-600">Select your destination portal to manage BIR/TIN, SSS, and Pag-IBIG assistance applications.</p>
        <div class="space-y-4">
          <a href="/customer" class="block w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow transition">Customer Portal</a>
          <a href="/admin" class="block w-full py-3 bg-slate-700 hover:bg-slate-800 text-white font-semibold rounded-lg shadow transition">Admin Portal</a>
        </div>
      </div>
    </div>
    ${UI_FOOTER}
  `);
});

// ------------------------------------------
// CUSTOMER PORTAL
// ------------------------------------------

app.get('/customer/login', (req, res) => {
  res.send(`
    ${UI_HEADER('Customer Login')}
    <div class="flex-grow flex items-center justify-center p-4">
      <div class="max-w-md w-full bg-white rounded-xl shadow-md p-6 border border-gray-100">
        <h2 class="text-xl font-bold text-slate-800 mb-4 text-center">Customer Sign In</h2>
        <form id="loginForm" class="space-y-4">
          <div>
            <label class="block text-xs font-semibold text-gray-600 uppercase mb-1">Username</label>
            <input type="text" id="username" required class="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-600 uppercase mb-1">Password</label>
            <input type="password" id="password" required class="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none">
          </div>
          <button type="submit" class="w-full bg-blue-600 text-white py-2 rounded-lg font-semibold hover:bg-blue-700">Login</button>
        </form>
        <p class="text-xs text-center text-gray-500 mt-4">Don't have an account? <a href="/customer/register" class="text-blue-600 underline">Register here</a></p>
      </div>
    </div>
    <script>
      document.getElementById('loginForm').onsubmit = async (e) => {
        e.preventDefault();
        const res = await fetch('/api/customer/login', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            username: e.target.username.value,
            password: e.target.password.value
          })
        });
        const data = await res.json();
        if(data.success) window.location.href = '/customer';
        else alert(data.message);
      };
    </script>
    ${UI_FOOTER}
  `);
});

app.get('/customer/register', (req, res) => {
  res.send(`
    ${UI_HEADER('Customer Registration')}
    <div class="flex-grow flex items-center justify-center p-4">
      <div class="max-w-md w-full bg-white rounded-xl shadow-md p-6 border border-gray-100">
        <h2 class="text-xl font-bold text-slate-800 mb-4 text-center">Create Customer Account</h2>
        <form id="regForm" class="space-y-3">
          <div>
            <label class="block text-xs font-semibold text-gray-600 uppercase mb-1">Full Name</label>
            <input type="text" name="full_name" required class="w-full border rounded px-3 py-1.5 text-sm">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-600 uppercase mb-1">Mobile Number</label>
            <input type="text" name="mobile" required class="w-full border rounded px-3 py-1.5 text-sm">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-600 uppercase mb-1">Email Address</label>
            <input type="email" name="email" required class="w-full border rounded px-3 py-1.5 text-sm">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-600 uppercase mb-1">Username</label>
            <input type="text" name="username" required class="w-full border rounded px-3 py-1.5 text-sm">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-600 uppercase mb-1">Password</label>
            <input type="password" name="password" required class="w-full border rounded px-3 py-1.5 text-sm">
          </div>
          <button type="submit" class="w-full bg-blue-600 text-white py-2 rounded font-semibold hover:bg-blue-700">Register</button>
        </form>
        <p class="text-xs text-center text-gray-500 mt-4">Already registered? <a href="/customer/login" class="text-blue-600 underline">Login here</a></p>
      </div>
    </div>
    <script>
      document.getElementById('regForm').onsubmit = async (e) => {
        e.preventDefault();
        const payload = Object.fromEntries(new FormData(e.target));
        const res = await fetch('/api/customer/register', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        alert(data.message);
        if(data.success) window.location.href = '/customer/login';
      };
    </script>
    ${UI_FOOTER}
  `);
});

app.get('/customer', authCustomer, (req, res) => {
  const user = req.session.user;
  const applications = db.prepare('SELECT * FROM applications WHERE user_id = ? ORDER BY id DESC').all(user.id);
  const notifications = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 5').all(user.id);

  res.send(`
    ${UI_HEADER('Customer Dashboard')}
    <div class="max-w-7xl mx-auto px-4 py-6 w-full space-y-6">
      <div class="bg-white rounded-xl p-6 shadow-sm border border-gray-200 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 class="text-2xl font-bold text-gray-800">Welcome back, ${user.full_name}!</h1>
          <p class="text-sm text-gray-500">Track and manage your government assistance service applications.</p>
        </div>
        <div class="flex gap-2">
          <a href="/customer/application/new" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-semibold shadow"><i class="fa-solid fa-plus mr-1"></i> New Application</a>
          <button onclick="logout()" class="bg-gray-200 hover:bg-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-semibold">Logout</button>
        </div>
      </div>

      ${notifications.length > 0 ? `
      <div class="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <h3 class="font-bold text-blue-900 text-sm mb-2"><i class="fa-solid fa-bell mr-1"></i> Recent Notifications</h3>
        <div class="space-y-1">
          ${notifications.map(n => `<div class="text-xs text-blue-800"><span class="font-semibold">${n.title}:</span> ${n.message} <span class="text-gray-400">(${n.created_at})</span></div>`).join('')}
        </div>
      </div>` : ''}

      <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div class="px-6 py-4 border-b border-gray-100 font-bold text-gray-700">My Applications</div>
        <div class="overflow-x-auto">
          <table class="w-full text-left text-sm text-gray-600">
            <thead class="bg-gray-50 text-gray-500 text-xs uppercase border-b">
              <tr>
                <th class="px-6 py-3">Tracking No.</th>
                <th class="px-6 py-3">Service</th>
                <th class="px-6 py-3">Date</th>
                <th class="px-6 py-3">Payment</th>
                <th class="px-6 py-3">Status</th>
                <th class="px-6 py-3">Action</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              ${applications.map(app => `
                <tr class="hover:bg-gray-50">
                  <td class="px-6 py-4 font-semibold text-blue-600">${app.tracking_number}</td>
                  <td class="px-6 py-4 font-medium">${app.service_type}</td>
                  <td class="px-6 py-4 text-xs">${app.created_at}</td>
                  <td class="px-6 py-4"><span class="px-2.5 py-1 rounded-full text-xs font-semibold ${app.payment_status === 'Paid' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}">${app.payment_status}</span></td>
                  <td class="px-6 py-4"><span class="px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">${app.status}</span></td>
                  <td class="px-6 py-4">
                    <a href="/customer/application/view/${app.id}" class="text-xs bg-slate-100 border hover:bg-slate-200 text-slate-700 px-3 py-1 rounded font-semibold">View Details</a>
                  </td>
                </tr>
              `).join('')}
              ${applications.length === 0 ? '<tr><td colspan="6" class="text-center py-6 text-gray-400 text-sm">No applications found. Click "New Application" to get started.</td></tr>' : ''}
            </tbody>
          </table>
        </div>
      </div>
    </div>
    <script>
      async function logout() {
        await fetch('/api/logout');
        window.location.href = '/customer/login';
      }
    </script>
    ${UI_FOOTER}
  `);
});

// Customer New Application Form
app.get('/customer/application/new', authCustomer, (req, res) => {
  const settings = db.prepare('SELECT fee_bir, fee_sss, fee_pagibig, gcash_name, gcash_number, gcash_qr_path FROM admin_settings WHERE id = 1').get();

  res.send(`
    ${UI_HEADER('New Application')}
    <div class="max-w-4xl mx-auto px-4 py-6 w-full">
      <div class="bg-white rounded-xl shadow-md p-6 border border-gray-200">
        <h2 class="text-xl font-bold text-slate-800 mb-2">Request Processing Assistance</h2>
        <p class="text-xs text-gray-500 mb-6">Select a service and fill out the required information accurately.</p>

        <form id="appForm" class="space-y-6" enctype="multipart/form-data">
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-2">Select Government Service Assistance</label>
            <select id="service_type" name="service_type" onchange="updateServiceInfo()" class="w-full border rounded-lg px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-blue-500">
              <option value="BIR/TIN">BIR / TIN Application Assistance (Fee: ₱${settings.fee_bir})</option>
              <option value="SSS">SSS Number / Coverage Assistance (Fee: ₱${settings.fee_sss})</option>
              <option value="Pag-IBIG">Pag-IBIG MID Number Assistance (Fee: ₱${settings.fee_pagibig})</option>
            </select>
          </div>

          <div class="border-t pt-4">
            <h3 class="font-bold text-gray-700 text-sm mb-3">Applicant Personal Information</h3>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div><label class="block text-xs text-gray-600 mb-1">First Name</label><input type="text" name="first_name" required class="w-full border rounded px-3 py-1.5 text-sm"></div>
              <div><label class="block text-xs text-gray-600 mb-1">Middle Name</label><input type="text" name="middle_name" class="w-full border rounded px-3 py-1.5 text-sm"></div>
              <div><label class="block text-xs text-gray-600 mb-1">Last Name</label><input type="text" name="last_name" required class="w-full border rounded px-3 py-1.5 text-sm"></div>
              <div><label class="block text-xs text-gray-600 mb-1">Suffix (e.g. Jr.)</label><input type="text" name="suffix" class="w-full border rounded px-3 py-1.5 text-sm"></div>
              <div><label class="block text-xs text-gray-600 mb-1">Date of Birth</label><input type="date" name="dob" required class="w-full border rounded px-3 py-1.5 text-sm"></div>
              <div><label class="block text-xs text-gray-600 mb-1">Sex</label><select name="sex" class="w-full border rounded px-3 py-1.5 text-sm"><option>Male</option><option>Female</option></select></div>
              <div><label class="block text-xs text-gray-600 mb-1">Civil Status</label><select name="civil_status" class="w-full border rounded px-3 py-1.5 text-sm"><option>Single</option><option>Married</option><option>Widowed</option></select></div>
              <div><label class="block text-xs text-gray-600 mb-1">Mother's Maiden Name</label><input type="text" name="mother_maiden" required class="w-full border rounded px-3 py-1.5 text-sm"></div>
              <div><label class="block text-xs text-gray-600 mb-1">Father's Name</label><input type="text" name="father_name" class="w-full border rounded px-3 py-1.5 text-sm"></div>
            </div>
          </div>

          <div id="dynamicFields" class="border-t pt-4 space-y-3">
            </div>

          <div class="border-t pt-4 space-y-4">
            <h3 class="font-bold text-gray-700 text-sm">Upload Required Documents</h3>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div class="border p-3 rounded-lg">
                <label class="block text-xs font-semibold text-gray-700 mb-1">1. Valid Government ID (JPG, PNG, PDF)</label>
                <input type="file" name="valid_id" required accept="image/*,.pdf" class="text-xs w-full">
              </div>
              <div class="border p-3 rounded-lg">
                <label class="block text-xs font-semibold text-gray-700 mb-1">2. Photo Holding Valid ID</label>
                <input type="file" name="photo_holding_id" required accept="image/*" class="text-xs w-full">
              </div>
              <div class="border p-3 rounded-lg">
                <label class="block text-xs font-semibold text-gray-700 mb-1">3. 2x2 / ID Photo</label>
                <input type="file" name="id_photo" required accept="image/*" class="text-xs w-full">
              </div>
              <div class="border p-3 rounded-lg">
                <label class="block text-xs font-semibold text-gray-700 mb-1">4. Additional Document (Optional)</label>
                <input type="file" name="additional" accept="image/*,.pdf" class="text-xs w-full">
              </div>
            </div>
          </div>

          <div class="border-t pt-4 space-y-3">
            <h3 class="font-bold text-gray-700 text-sm">Payment Details</h3>
            <div>
              <label class="block text-xs font-semibold text-gray-600 mb-1">Select Payment Method</label>
              <select name="payment_method" id="payment_method" onchange="togglePaymentFields()" class="w-full border rounded px-3 py-2 text-sm">
                <option value="CASH">Cash (Pay at Office/Upon Processing)</option>
                <option value="GCASH">GCash Online Payment</option>
              </select>
            </div>

            <div id="gcashSection" class="hidden border bg-blue-50 p-4 rounded-lg space-y-3">
              <div class="text-xs text-blue-900 space-y-1">
                <p class="font-bold">Admin GCash Payment Details:</p>
                <p>Account Name: <span class="font-medium">${settings.gcash_name}</span></p>
                <p>Account Number: <span class="font-medium">${settings.gcash_number}</span></p>
                ${settings.gcash_qr_path ? `<div class="mt-2"><p class="font-semibold text-xs mb-1">Scan QR Code:</p><img src="/api/document/qr" class="h-36 w-36 border rounded"></div>` : ''}
              </div>
              <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div><label class="block text-xs text-gray-600">Reference Number</label><input type="text" name="gcash_ref" class="w-full border rounded px-2 py-1 text-sm"></div>
                <div><label class="block text-xs text-gray-600">Date Paid</label><input type="date" name="gcash_date" class="w-full border rounded px-2 py-1 text-sm"></div>
                <div><label class="block text-xs text-gray-600">Proof of Payment</label><input type="file" name="gcash_proof" accept="image/*" class="text-xs w-full mt-1"></div>
              </div>
            </div>
          </div>

          <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-lg shadow">Submit Assistance Application</button>
        </form>
      </div>
    </div>

    <script>
      function updateServiceInfo() {
        const type = document.getElementById('service_type').value;
        const container = document.getElementById('dynamicFields');
        if (type === 'BIR/TIN') {
          container.innerHTML = \`
            <h4 class="text-xs font-bold text-gray-700 uppercase">BIR/TIN Specific Details</h4>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div><label class="block text-xs text-gray-600">Employment Status / Purpose</label><input type="text" name="bir_purpose" placeholder="e.g. First-Time Jobseeker, Self-Employed" class="w-full border rounded px-3 py-1.5 text-sm"></div>
              <div><label class="block text-xs text-gray-600">Employer Name (if applicable)</label><input type="text" name="employer_name" class="w-full border rounded px-3 py-1.5 text-sm"></div>
            </div>
          \`;
        } else if (type === 'SSS') {
          container.innerHTML = \`
            <h4 class="text-xs font-bold text-gray-700 uppercase">SSS Specific Details</h4>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div><label class="block text-xs text-gray-600">Membership Type</label><select name="sss_type" class="w-full border rounded px-3 py-1.5 text-sm"><option>Employed</option><option>Self-Employed</option><option>Voluntary</option><option>OFW</option></select></div>
              <div><label class="block text-xs text-gray-600">Monthly Income Estimate</label><input type="number" name="monthly_income" class="w-full border rounded px-3 py-1.5 text-sm"></div>
            </div>
          \`;
        } else {
          container.innerHTML = \`
            <h4 class="text-xs font-bold text-gray-700 uppercase">Pag-IBIG Specific Details</h4>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div><label class="block text-xs text-gray-600">Category</label><select name="pagibig_category" class="w-full border rounded px-3 py-1.5 text-sm"><option>Mandatory</option><option>Voluntary</option></select></div>
              <div><label class="block text-xs text-gray-600">Occupation</label><input type="text" name="occupation" class="w-full border rounded px-3 py-1.5 text-sm"></div>
            </div>
          \`;
        }
      }

      function togglePaymentFields() {
        const method = document.getElementById('payment_method').value;
        const section = document.getElementById('gcashSection');
        if (method === 'GCASH') section.classList.remove('hidden');
        else section.classList.add('hidden');
      }

      updateServiceInfo();

      document.getElementById('appForm').onsubmit = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const res = await fetch('/api/applications', { method: 'POST', body: formData });
        const data = await res.json();
        if(data.success) {
          alert('Application Submitted Successfully! Tracking No: ' + data.trackingNumber);
          window.location.href = '/customer';
        } else alert('Error submitting application');
      };
    </script>
    ${UI_FOOTER}
  `);
});

// Customer View Application Detail Page
app.get('/customer/application/view/:id', authCustomer, (req, res) => {
  const appData = db.prepare('SELECT * FROM applications WHERE id = ? AND user_id = ?').get(req.params.id, req.session.user.id);
  if (!appData) return res.redirect('/customer');

  const history = db.prepare('SELECT * FROM status_history WHERE application_id = ? ORDER BY id ASC').all(appData.id);
  const docs = db.prepare('SELECT * FROM documents WHERE application_id = ?').all(appData.id);

  res.send(`
    ${UI_HEADER('Application Tracker')}
    <div class="max-w-4xl mx-auto px-4 py-6 w-full space-y-6">
      <div class="bg-white rounded-xl shadow p-6 border border-gray-200">
        <div class="flex justify-between items-center border-b pb-4 mb-4">
          <div>
            <h2 class="text-xl font-bold text-slate-800">${appData.service_type} Assistance Request</h2>
            <p class="text-xs text-gray-500">Tracking Number: <span class="font-bold text-blue-600">${appData.tracking_number}</span></p>
          </div>
          <span class="px-3 py-1 text-xs font-bold rounded-full bg-blue-100 text-blue-800">${appData.status}</span>
        </div>

        <h3 class="font-bold text-sm text-gray-700 mb-2">Application Tracking Progress</h3>
        

[Image of application process workflow diagram]

        <div class="space-y-3 mt-4 border-l-2 border-blue-500 pl-4">
          ${history.map(h => `
            <div>
              <p class="text-xs font-bold text-gray-800">${h.status}</p>
              <p class="text-xs text-gray-500">${h.remarks || ''} - <span class="italic">${h.created_at}</span></p>
            </div>
          `).join('')}
        </div>

        ${appData.admin_remarks ? `
          <div class="mt-6 bg-amber-50 border border-amber-200 p-3 rounded text-xs text-amber-900">
            <strong>Admin Remarks:</strong> ${appData.admin_remarks}
          </div>
        ` : ''}

        <div class="mt-6 border-t pt-4">
          <h3 class="font-bold text-sm text-gray-700 mb-2">Associated Documents</h3>
          <div class="grid grid-cols-2 md:grid-cols-3 gap-2">
            ${docs.map(d => `
              <div class="border p-2 rounded text-xs flex justify-between items-center">
                <span class="truncate max-w-[120px] font-semibold">${d.doc_type.toUpperCase()}</span>
                <a href="/api/document/${d.id}" target="_blank" class="text-blue-600 underline text-xs">View/Download</a>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    </div>
    ${UI_FOOTER}
  `);
});

// ------------------------------------------
// ADMIN PORTAL
// ------------------------------------------

app.get('/admin/login', (req, res) => {
  res.send(`
    ${UI_HEADER('Admin Portal Access')}
    <div class="flex-grow flex items-center justify-center p-4">
      <div class="max-w-md w-full bg-slate-900 text-white rounded-xl shadow-xl p-8 border border-slate-700">
        <div class="text-center mb-6">
          <i class="fa-solid fa-user-shield text-4xl text-blue-400 mb-2"></i>
          <h2 class="text-xl font-bold">Admin Portal Login</h2>
        </div>
        <form id="adminForm" class="space-y-4">
          <div>
            <label class="block text-xs font-semibold text-gray-300 uppercase mb-1">Username</label>
            <input type="text" id="username" required class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-300 uppercase mb-1">Password</label>
            <input type="password" id="password" required class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none">
          </div>
          <button type="submit" class="w-full bg-blue-600 text-white py-2.5 rounded-lg font-semibold hover:bg-blue-500">Sign In to Dashboard</button>
        </form>
      </div>
    </div>
    <script>
      document.getElementById('adminForm').onsubmit = async (e) => {
        e.preventDefault();
        const res = await fetch('/api/admin/login', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            username: e.target.username.value,
            password: e.target.password.value
          })
        });
        const data = await res.json();
        if(data.success) window.location.href = '/admin';
        else alert(data.message);
      };
    </script>
    ${UI_FOOTER}
  `);
});

app.get('/admin', authAdmin, (req, res) => {
  const stats = {
    totalCustomers: db.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt,
    totalApps: db.prepare('SELECT COUNT(*) as cnt FROM applications').get().cnt,
    pendingApps: db.prepare("SELECT COUNT(*) as cnt FROM applications WHERE status = 'Submitted' OR status = 'Under Review'").get().cnt,
    pendingPayments: db.prepare("SELECT COUNT(*) as cnt FROM applications WHERE payment_status = 'Pending Verification'").get().cnt,
    completed: db.prepare("SELECT COUNT(*) as cnt FROM applications WHERE status = 'Completed'").get().cnt,
  };

  const applications = db.prepare(`
    SELECT a.*, u.full_name, u.mobile FROM applications a 
    JOIN users u ON a.user_id = u.id 
    ORDER BY a.id DESC
  `).all();

  res.send(`
    ${UI_HEADER('Admin Dashboard')}
    <div class="max-w-7xl mx-auto px-4 py-6 w-full space-y-6">
      <div class="flex justify-between items-center">
        <h1 class="text-2xl font-bold text-gray-800">Administrator Control Center</h1>
        <div class="space-x-2">
          <a href="/admin/settings" class="bg-slate-700 hover:bg-slate-800 text-white px-3 py-2 rounded text-xs font-semibold"><i class="fa-solid fa-gear mr-1"></i> Business Settings</a>
          <button onclick="logout()" class="bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded text-xs font-semibold">Logout</button>
        </div>
      </div>

      <div class="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div class="bg-white p-4 rounded-xl shadow-sm border text-center">
          <p class="text-xs text-gray-500 uppercase font-bold">Total Clients</p>
          <p class="text-2xl font-black text-gray-800">${stats.totalCustomers}</p>
        </div>
        <div class="bg-white p-4 rounded-xl shadow-sm border text-center">
          <p class="text-xs text-gray-500 uppercase font-bold">Applications</p>
          <p class="text-2xl font-black text-blue-600">${stats.totalApps}</p>
        </div>
        <div class="bg-white p-4 rounded-xl shadow-sm border text-center">
          <p class="text-xs text-gray-500 uppercase font-bold">Pending Review</p>
          <p class="text-2xl font-black text-amber-500">${stats.pendingApps}</p>
        </div>
        <div class="bg-white p-4 rounded-xl shadow-sm border text-center">
          <p class="text-xs text-gray-500 uppercase font-bold">Pending Payment</p>
          <p class="text-2xl font-black text-red-500">${stats.pendingPayments}</p>
        </div>
        <div class="bg-white p-4 rounded-xl shadow-sm border text-center">
          <p class="text-xs text-gray-500 uppercase font-bold">Completed</p>
          <p class="text-2xl font-black text-green-600">${stats.completed}</p>
        </div>
      </div>

      <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div class="px-6 py-4 border-b flex justify-between items-center">
          <h3 class="font-bold text-gray-700">All Submitted Applications</h3>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-left text-sm text-gray-600">
            <thead class="bg-gray-50 text-gray-500 text-xs uppercase border-b">
              <tr>
                <th class="px-4 py-3">Applicant</th>
                <th class="px-4 py-3">Service</th>
                <th class="px-4 py-3">Tracking No</th>
                <th class="px-4 py-3">Payment</th>
                <th class="px-4 py-3">Status</th>
                <th class="px-4 py-3">Manage</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              ${applications.map(app => `
                <tr class="hover:bg-gray-50">
                  <td class="px-4 py-3 font-medium">${app.full_name}<br><span class="text-xs text-gray-400">${app.mobile}</span></td>
                  <td class="px-4 py-3">${app.service_type}</td>
                  <td class="px-4 py-3 font-mono text-xs font-bold text-blue-600">${app.tracking_number}</td>
                  <td class="px-4 py-3"><span class="px-2 py-0.5 rounded text-xs font-bold ${app.payment_status === 'Paid' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">${app.payment_status}</span></td>
                  <td class="px-4 py-3"><span class="px-2 py-0.5 rounded text-xs font-bold bg-blue-100 text-blue-700">${app.status}</span></td>
                  <td class="px-4 py-3">
                    <a href="/admin/application/manage/${app.id}" class="bg-blue-600 text-white px-3 py-1 rounded text-xs font-semibold hover:bg-blue-700">Manage</a>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
    <script>
      async function logout() {
        await fetch('/api/logout');
        window.location.href = '/admin/login';
      }
    </script>
    ${UI_FOOTER}
  `);
});

// Admin Manage Application Details
app.get('/admin/application/manage/:id', authAdmin, (req, res) => {
  const appData = db.prepare(`
    SELECT a.*, u.full_name, u.mobile, u.email FROM applications a 
    JOIN users u ON a.user_id = u.id 
    WHERE a.id = ?
  `).get(req.params.id);

  if (!appData) return res.redirect('/admin');

  const docs = db.prepare('SELECT * FROM documents WHERE application_id = ?').all(appData.id);
  const formData = JSON.parse(appData.form_data);

  res.send(`
    ${UI_HEADER('Manage Application')}
    <div class="max-w-5xl mx-auto px-4 py-6 w-full space-y-6">
      <a href="/admin" class="text-xs font-bold text-blue-600 underline">&larr; Back to Dashboard</a>

      <div class="bg-white rounded-xl shadow p-6 border border-gray-200 grid grid-cols-1 md:grid-cols-3 gap-6">
        <div class="md:col-span-2 space-y-4">
          <h2 class="text-xl font-bold text-gray-800">Application #${appData.tracking_number}</h2>
          
          <div class="bg-gray-50 p-4 rounded-lg space-y-2 text-xs border">
            <p><strong>Customer:</strong> ${appData.full_name} (${appData.email} | ${appData.mobile})</p>
            <p><strong>Service Requested:</strong> ${appData.service_type}</p>
            <p><strong>Submission Date:</strong> ${appData.created_at}</p>
            <hr>
            <p class="font-bold text-gray-700 uppercase">Submitted Form Data:</p>
            <pre class="bg-white p-2 border rounded overflow-x-auto">${JSON.stringify(formData, null, 2)}</pre>
          </div>

          <div>
            <h3 class="font-bold text-xs uppercase text-gray-700 mb-2">Customer Documents</h3>
            <div class="grid grid-cols-2 gap-2">
              ${docs.map(d => `
                <div class="border p-2 rounded text-xs bg-gray-50 flex justify-between items-center">
                  <span class="font-bold">${d.doc_type}</span>
                  <a href="/api/document/${d.id}" target="_blank" class="text-blue-600 underline">View</a>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <div class="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-4">
          <h3 class="font-bold text-sm text-slate-800 border-b pb-2">Processing Controls</h3>

          <form id="updateForm" class="space-y-3" enctype="multipart/form-data">
            <input type="hidden" name="id" value="${appData.id}">
            
            <div>
              <label class="block text-xs font-semibold text-gray-600">Application Status</label>
              <select name="status" class="w-full border rounded px-2 py-1 text-xs">
                ${['Submitted', 'Under Review', 'Need Correction', 'Processing', 'Ready', 'Completed', 'Rejected'].map(s => `
                  <option value="${s}" ${appData.status === s ? 'selected' : ''}>${s}</option>
                `).join('')}
              </select>
            </div>

            <div>
              <label class="block text-xs font-semibold text-gray-600">Payment Status</label>
              <select name="payment_status" class="w-full border rounded px-2 py-1 text-xs">
                ${['Unpaid', 'Pending Verification', 'Paid', 'Refunded'].map(p => `
                  <option value="${p}" ${appData.payment_status === p ? 'selected' : ''}>${p}</option>
                `).join('')}
              </select>
            </div>

            <div>
              <label class="block text-xs font-semibold text-gray-600">Customer Remarks (Public)</label>
              <textarea name="admin_remarks" class="w-full border rounded px-2 py-1 text-xs h-16">${appData.admin_remarks || ''}</textarea>
            </div>

            <div>
              <label class="block text-xs font-semibold text-gray-600">Private Admin Notes</label>
              <textarea name="admin_notes" class="w-full border rounded px-2 py-1 text-xs h-16">${appData.admin_notes || ''}</textarea>
            </div>

            <div>
              <label class="block text-xs font-semibold text-gray-600">Upload Completed File (Optional)</label>
              <input type="file" name="completed_file" class="text-xs w-full mt-1">
            </div>

            <button type="submit" class="w-full bg-blue-600 text-white text-xs font-bold py-2 rounded hover:bg-blue-700">Save Changes</button>
          </form>
        </div>
      </div>
    </div>
    <script>
      document.getElementById('updateForm').onsubmit = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const res = await fetch('/api/admin/applications/update', { method: 'POST', body: formData });
        const data = await res.json();
        if(data.success) {
          alert('Application updated successfully.');
          window.location.reload();
        } else alert('Error updating application.');
      };
    </script>
    ${UI_FOOTER}
  `);
});

// Admin Business Settings Page
app.get('/admin/settings', authAdmin, (req, res) => {
  const settings = db.prepare('SELECT * FROM admin_settings WHERE id = 1').get();

  res.send(`
    ${UI_HEADER('Admin Settings')}
    <div class="max-w-3xl mx-auto px-4 py-6 w-full">
      <div class="bg-white rounded-xl shadow p-6 border border-gray-200">
        <h2 class="text-xl font-bold text-gray-800 mb-4">Business & Service Settings</h2>

        <form id="settingsForm" class="space-y-4" enctype="multipart/form-data">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><label class="block text-xs font-bold text-gray-600">Business Name</label><input type="text" name="business_name" value="${settings.business_name}" class="w-full border rounded px-3 py-1.5 text-sm"></div>
            <div><label class="block text-xs font-bold text-gray-600">Contact Number</label><input type="text" name="contact_number" value="${settings.contact_number}" class="w-full border rounded px-3 py-1.5 text-sm"></div>
            <div><label class="block text-xs font-bold text-gray-600">Contact Email</label><input type="email" name="email" value="${settings.email}" class="w-full border rounded px-3 py-1.5 text-sm"></div>
            <div><label class="block text-xs font-bold text-gray-600">Address</label><input type="text" name="address" value="${settings.address}" class="w-full border rounded px-3 py-1.5 text-sm"></div>
          </div>

          <hr>
          <h3 class="font-bold text-sm text-gray-700">GCash Configuration</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><label class="block text-xs font-bold text-gray-600">GCash Name</label><input type="text" name="gcash_name" value="${settings.gcash_name}" class="w-full border rounded px-3 py-1.5 text-sm"></div>
            <div><label class="block text-xs font-bold text-gray-600">GCash Number</label><input type="text" name="gcash_number" value="${settings.gcash_number}" class="w-full border rounded px-3 py-1.5 text-sm"></div>
            <div class="md:col-span-2">
              <label class="block text-xs font-bold text-gray-600">GCash QR Code Image</label>
              <input type="file" name="gcash_qr" accept="image/*" class="text-xs mt-1">
            </div>
          </div>

          <hr>
          <h3 class="font-bold text-sm text-gray-700">Dynamic Assistance Service Fees (₱)</h3>
          <div class="grid grid-cols-3 gap-4">
            <div><label class="block text-xs font-bold text-gray-600">BIR / TIN Fee</label><input type="number" step="0.01" name="fee_bir" value="${settings.fee_bir}" class="w-full border rounded px-3 py-1.5 text-sm"></div>
            <div><label class="block text-xs font-bold text-gray-600">SSS Fee</label><input type="number" step="0.01" name="fee_sss" value="${settings.fee_sss}" class="w-full border rounded px-3 py-1.5 text-sm"></div>
            <div><label class="block text-xs font-bold text-gray-600">Pag-IBIG Fee</label><input type="number" step="0.01" name="fee_pagibig" value="${settings.fee_pagibig}" class="w-full border rounded px-3 py-1.5 text-sm"></div>
          </div>

          <button type="submit" class="w-full bg-blue-600 text-white font-bold py-2 rounded hover:bg-blue-700 mt-4">Save Settings</button>
        </form>
      </div>
    </div>
    <script>
      document.getElementById('settingsForm').onsubmit = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const res = await fetch('/api/admin/settings', { method: 'POST', body: formData });
        const data = await res.json();
        if(data.success) alert('Settings saved successfully.');
        else alert('Error saving settings.');
      };
    </script>
    ${UI_FOOTER}
  `);
});

// Serve QR Code image route helper
app.get('/api/document/qr', (req, res) => {
  const settings = db.prepare('SELECT gcash_qr_path FROM admin_settings WHERE id = 1').get();
  if (settings && settings.gcash_qr_path) {
    const filePath = path.join(UPLOADS_DIR, settings.gcash_qr_path);
    if (fs.existsSync(filePath)) return res.sendFile(filePath);
  }
  res.status(404).send('Not found');
});

// Start Express Server
app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
