const express = require('express');
const session = require('express-session');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure uploads folder exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Storage Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|pdf/;
    const extName = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimeType = allowedTypes.test(file.mimetype);
    if (extName && mimeType) {
      return cb(null, true);
    }
    cb(new Error('Only JPG, PNG, and PDF files are allowed!'));
  }
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'gov-assistance-secret-key-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// Database Setup
const db = new sqlite3.Database(path.join(__dirname, 'database.sqlite'), (err) => {
  if (err) console.error('Database connection error:', err);
  else console.log('Connected to SQLite Database.');
});

db.serialize(() => {
  // Users Table
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    password TEXT,
    full_name TEXT,
    role TEXT DEFAULT 'customer',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Applications Table
  db.run(`CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    tracking_number TEXT UNIQUE,
    service_type TEXT,
    status TEXT DEFAULT 'Payment Pending',
    form_data TEXT,
    admin_remarks TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Documents Table
  db.run(`CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER,
    doc_type TEXT,
    file_path TEXT,
    original_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Payments Table
  db.run(`CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER,
    payment_method TEXT,
    amount REAL,
    reference_number TEXT,
    payment_date TEXT,
    receipt_path TEXT,
    status TEXT DEFAULT 'Pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Status History Table
  db.run(`CREATE TABLE IF NOT EXISTS status_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER,
    status TEXT,
    remarks TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Notifications Table
  db.run(`CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    message TEXT,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Payment Settings Table
  db.run(`CREATE TABLE IF NOT EXISTS payment_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    tin_fee REAL DEFAULT 300,
    sss_fee REAL DEFAULT 300,
    pagibig_fee REAL DEFAULT 300,
    gcash_number TEXT DEFAULT '09123456789',
    gcash_name TEXT DEFAULT 'ADMIN OFFICIAL',
    gcash_qr_path TEXT DEFAULT '',
    cash_enabled INTEGER DEFAULT 1,
    gcash_enabled INTEGER DEFAULT 1
  )`);

  // Seed Admin & Settings
  db.get(`SELECT * FROM users WHERE role = 'admin'`, async (err, row) => {
    if (!row) {
      const hash = await bcrypt.hash('admin123', 10);
      db.run(`INSERT INTO users (email, password, full_name, role) VALUES ('admin@system.com', ?, 'System Administrator', 'admin')`, [hash]);
      console.log('Default Admin Created: admin@system.com / admin123');
    }
  });

  db.get(`SELECT * FROM payment_settings WHERE id = 1`, (err, row) => {
    if (!row) {
      db.run(`INSERT INTO payment_settings (id) VALUES (1)`);
    }
  });
});

// Auth Guards
const requireAuth = (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.session.userId || req.session.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  next();
};

// --- AUTH ROUTES ---
app.post('/api/register', async (req, res) => {
  const { email, password, full_name } = req.body;
  if (!email || !password || !full_name) return res.status(400).json({ error: 'All fields required' });
  
  try {
    const hash = await bcrypt.hash(password, 10);
    db.run(`INSERT INTO users (email, password, full_name) VALUES (?, ?, ?)`, [email, hash, full_name], function(err) {
      if (err) return res.status(400).json({ error: 'Email already exists' });
      req.session.userId = this.lastID;
      req.session.role = 'customer';
      req.session.fullName = full_name;
      res.json({ success: true });
    });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
    if (err || !user) return res.status(400).json({ error: 'Invalid credentials' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ error: 'Invalid credentials' });

    req.session.userId = user.id;
    req.session.role = user.role;
    req.session.fullName = user.full_name;
    res.json({ success: true, role: user.role, name: user.full_name });
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.json({ authenticated: false });
  res.json({ authenticated: true, role: req.session.role, name: req.session.fullName });
});

// --- SETTINGS ROUTE ---
app.get('/api/settings', (req, res) => {
  db.get(`SELECT * FROM payment_settings WHERE id = 1`, (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(row);
  });
});

// --- CUSTOMER ROUTES ---
const appUploads = upload.fields([
  { name: 'valid_id', maxCount: 1 },
  { name: 'holding_id', maxCount: 1 },
  { name: 'profile_pic', maxCount: 1 },
  { name: 'other_doc', maxCount: 1 },
  { name: 'gcash_receipt', maxCount: 1 }
]);

app.post('/api/applications', requireAuth, appUploads, (req, res) => {
  const { service_type, payment_method, gcash_ref, gcash_date, gcash_amount, ...formData } = req.body;
  const userId = req.session.userId;
  
  // Tracking number generation
  const prefix = service_type.toUpperCase().replace(/[^A-Z]/g, '');
  const dateStr = new Date().toISOString().slice(0,10).replace(/-/g, '');
  const rand = Math.floor(1000 + Math.random() * 9000);
  const trackingNumber = `${prefix}-${dateStr}-${rand}`;

  let initialStatus = payment_method === 'GCASH' ? 'Payment Verification Pending' : 'Payment Pending';
  
  db.run(`INSERT INTO applications (user_id, tracking_number, service_type, status, form_data) VALUES (?, ?, ?, ?, ?)`,
    [userId, trackingNumber, service_type, initialStatus, JSON.stringify(formData)],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      const appId = this.lastID;

      // Handle Files
      const files = req.files || {};
      ['valid_id', 'holding_id', 'profile_pic', 'other_doc'].forEach(type => {
        if (files[type]) {
          db.run(`INSERT INTO documents (application_id, doc_type, file_path, original_name) VALUES (?, ?, ?, ?)`,
            [appId, type, files[type][0].filename, files[type][0].originalname]);
        }
      });

      // Handle Payment
      db.get(`SELECT * FROM payment_settings WHERE id = 1`, (err, settings) => {
        let fee = settings.tin_fee;
        if (service_type === 'SSS') fee = settings.sss_fee;
        if (service_type === 'Pag-IBIG') fee = settings.pagibig_fee;

        let receiptPath = files['gcash_receipt'] ? files['gcash_receipt'][0].filename : '';
        let payStatus = payment_method === 'GCASH' ? 'Verification Pending' : 'Pending';

        db.run(`INSERT INTO payments (application_id, payment_method, amount, reference_number, payment_date, receipt_path, status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [appId, payment_method, fee, gcash_ref || '', gcash_date || '', receiptPath, payStatus]);
      });

      // Status Log & Notification
      db.run(`INSERT INTO status_history (application_id, status, remarks) VALUES (?, ?, ?)`, [appId, initialStatus, 'Application submitted.']);
      db.run(`INSERT INTO notifications (user_id, message) VALUES (?, ?)`, [userId, `Application ${trackingNumber} submitted successfully.`]);

      res.json({ success: true, trackingNumber });
    }
  );
});

app.get('/api/my-applications', requireAuth, (req, res) => {
  const query = `
    SELECT a.*, p.payment_method, p.status as payment_status, p.amount, p.reference_number
    FROM applications a
    LEFT JOIN payments p ON a.id = p.application_id
    WHERE a.user_id = ?
    ORDER BY a.created_at DESC`;
  db.all(query, [req.session.userId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/application/:id', requireAuth, (req, res) => {
  const appId = req.params.id;
  const userId = req.session.userId;
  const isAdmin = req.session.role === 'admin';

  let query = `SELECT a.*, u.full_name, u.email FROM applications a JOIN users u ON a.user_id = u.id WHERE a.id = ?`;
  let params = [appId];

  if (!isAdmin) {
    query += ` AND a.user_id = ?`;
    params.push(userId);
  }

  db.get(query, params, (err, app) => {
    if (err || !app) return res.status(440).json({ error: 'Application not found' });

    db.all(`SELECT * FROM documents WHERE application_id = ?`, [appId], (err, docs) => {
      db.get(`SELECT * FROM payments WHERE application_id = ?`, [appId], (err, payment) => {
        db.all(`SELECT * FROM status_history WHERE application_id = ? ORDER BY created_at DESC`, [appId], (err, history) => {
          res.json({ app, docs, payment, history });
        });
      });
    });
  });
});

app.post('/api/application/:id/resubmit', requireAuth, upload.array('correction_docs'), (req, res) => {
  const appId = req.params.id;
  const files = req.files || [];

  files.forEach(file => {
    db.run(`INSERT INTO documents (application_id, doc_type, file_path, original_name) VALUES (?, 'correction_doc', ?, ?)`,
      [appId, file.filename, file.originalname]);
  });

  db.run(`UPDATE applications SET status = 'Under Review', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [appId]);
  db.run(`INSERT INTO status_history (application_id, status, remarks) VALUES (?, 'Under Review', ?)`, [appId, 'Customer submitted corrected files.']);

  res.json({ success: true });
});

app.get('/api/notifications', requireAuth, (req, res) => {
  db.all(`SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`, [req.session.userId], (err, rows) => {
    res.json(rows || []);
  });
});

// --- ADMIN ROUTES ---
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const stats = {};
  db.get(`SELECT 
    COUNT(*) as total,
    SUM(CASE WHEN service_type LIKE '%TIN%' THEN 1 ELSE 0 END) as tin,
    SUM(CASE WHEN service_type = 'SSS' THEN 1 ELSE 0 END) as sss,
    SUM(CASE WHEN service_type = 'Pag-IBIG' THEN 1 ELSE 0 END) as pagibig,
    SUM(CASE WHEN status = 'Processing' THEN 1 ELSE 0 END) as processing,
    SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) as completed
    FROM applications`, (err, row) => {
      Object.assign(stats, row);
      db.get(`SELECT 
        SUM(CASE WHEN status = 'Verification Pending' OR status = 'Pending' THEN 1 ELSE 0 END) as pending_pay,
        SUM(CASE WHEN status = 'Paid' THEN 1 ELSE 0 END) as paid_pay
        FROM payments`, (err, pRow) => {
          Object.assign(stats, pRow);
          res.json(stats);
      });
  });
});

app.get('/api/admin/applications', requireAdmin, (req, res) => {
  const query = `
    SELECT a.*, u.full_name as applicant_name, p.payment_method, p.status as payment_status
    FROM applications a
    JOIN users u ON a.user_id = u.id
    LEFT JOIN payments p ON a.id = p.application_id
    ORDER BY a.created_at DESC`;
  db.all(query, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/admin/application/:id/update', requireAdmin, upload.array('completed_docs'), (req, res) => {
  const appId = req.params.id;
  const { status, payment_status, remarks } = req.body;

  db.get(`SELECT user_id, tracking_number FROM applications WHERE id = ?`, [appId], (err, app) => {
    if (!app) return res.status(404).json({ error: 'App not found' });

    if (status) {
      db.run(`UPDATE applications SET status = ?, admin_remarks = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [status, remarks, appId]);
      db.run(`INSERT INTO status_history (application_id, status, remarks) VALUES (?, ?, ?)`, [appId, status, remarks]);
      db.run(`INSERT INTO notifications (user_id, message) VALUES (?, ?)`, [app.user_id, `Application ${app.tracking_number} status updated to: ${status}`]);
    }

    if (payment_status) {
      db.run(`UPDATE payments SET status = ? WHERE application_id = ?`, [payment_status, appId]);
      db.run(`INSERT INTO notifications (user_id, message) VALUES (?, ?)`, [app.user_id, `Payment status for ${app.tracking_number} set to: ${payment_status}`]);
    }

    const files = req.files || [];
    files.forEach(file => {
      db.run(`INSERT INTO documents (application_id, doc_type, file_path, original_name) VALUES (?, 'completed_doc', ?, ?)`,
        [appId, file.filename, file.originalname]);
    });

    res.json({ success: true });
  });
});

app.post('/api/admin/settings', requireAdmin, upload.single('gcash_qr'), (req, res) => {
  const { tin_fee, sss_fee, pagibig_fee, gcash_number, gcash_name, cash_enabled, gcash_enabled } = req.body;
  let qrPath = req.file ? req.file.filename : null;

  let query = `UPDATE payment_settings SET tin_fee=?, sss_fee=?, pagibig_fee=?, gcash_number=?, gcash_name=?, cash_enabled=?, gcash_enabled=?`;
  let params = [tin_fee, sss_fee, pagibig_fee, gcash_number, gcash_name, cash_enabled ? 1 : 0, gcash_enabled ? 1 : 0];

  if (qrPath) {
    query += `, gcash_qr_path=?`;
    params.push(qrPath);
  }
  query += ` WHERE id = 1`;

  db.run(query, params, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

app.delete('/api/admin/application/:id', requireAdmin, (req, res) => {
  const appId = req.params.id;
  db.run(`DELETE FROM applications WHERE id = ?`, [appId]);
  db.run(`DELETE FROM documents WHERE application_id = ?`, [appId]);
  db.run(`DELETE FROM payments WHERE application_id = ?`, [appId]);
  db.run(`DELETE FROM status_history WHERE application_id = ?`, [appId]);
  res.json({ success: true });
});

// Secure File Access Route
app.get('/uploads/:filename', requireAuth, (req, res) => {
  const file = path.join(uploadDir, req.params.filename);
  if (fs.existsSync(file)) {
    res.sendFile(file);
  } else {
    res.status(404).send('File not found');
  }
});

// --- SINGLE-PAGE FRONTEND APPLICATION ---
app.get('*', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GovAssist - Application Assistance & Tracking System</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.10.0/font/bootstrap-icons.css" rel="stylesheet">
  <style>
    :root { --primary-color: #0d6efd; --bg-light: #f8f9fa; }
    body { background-color: #f4f6f9; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
    .disclaimer-bar { background-color: #fff3cd; color: #856404; font-size: 0.85rem; padding: 8px; text-align: center; border-bottom: 1px solid #ffeeba; }
    .navbar-brand { font-weight: 700; letter-spacing: 0.5px; }
    .card { border: none; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); margin-bottom: 20px; }
    .form-section-title { border-bottom: 2px solid var(--primary-color); padding-bottom: 5px; margin-bottom: 15px; font-weight: 600; color: #333; }
    .preview-img { max-width: 100%; max-height: 150px; border-radius: 5px; margin-top: 10px; border: 1px solid #ddd; display: none; }
    .status-badge { font-size: 0.85rem; padding: 6px 12px; border-radius: 20px; }
    .progress-tracker { display: flex; justify-content: space-between; position: relative; margin: 20px 0; }
    .progress-step { flex: 1; text-align: center; position: relative; font-size: 0.8rem; font-weight: 600; color: #6c757d; }
    .progress-step.active { color: var(--primary-color); }
    .progress-step .icon { width: 30px; height: 30px; background: #e9ecef; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 5px; }
    .progress-step.active .icon { background: var(--primary-color); color: #fff; }
  </style>
</head>
<body>

  <div class="disclaimer-bar">
    <i class="bi bi-exclamation-triangle-fill me-1"></i>
    <strong>Disclaimer:</strong> This website is an independent application assistance and document processing/tracking service and is not an official website of BIR, SSS, or Pag-IBIG.
  </div>

  <nav class="navbar navbar-expand-lg navbar-dark bg-primary sticky-top">
    <div class="container">
      <a class="navbar-brand" href="#"><i class="bi bi-file-earmark-text me-2"></i>GovAssist</a>
      <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNav"></button>
      <div class="collapse navbar-collapse" id="navbarNav">
        <ul class="navbar-nav ms-auto" id="nav-links">
          </ul>
      </div>
    </div>
  </nav>

  <div class="container my-4" id="main-container">
    </div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
  <script>
    const state = { user: null, settings: {} };

    async function init() {
      await fetchUser();
      await fetchSettings();
      router();
    }

    async function fetchUser() {
      const res = await fetch('/api/me');
      const data = await res.json();
      state.user = data.authenticated ? data : null;
      renderNav();
    }

    async function fetchSettings() {
      const res = await fetch('/api/settings');
      state.settings = await res.json();
    }

    function renderNav() {
      const nav = document.getElementById('nav-links');
      if (!state.user) {
        nav.innerHTML = \`
          <li class="nav-item"><a class="nav-link" href="#" onclick="navigate('login')">Login</a></li>
          <li class="nav-item"><a class="nav-link" href="#" onclick="navigate('register')">Register</a></li>
        \`;
      } else if (state.user.role === 'admin') {
        nav.innerHTML = \`
          <li class="nav-item"><a class="nav-link" href="#" onclick="navigate('admin-dashboard')">Dashboard</a></li>
          <li class="nav-item"><a class="nav-link" href="#" onclick="navigate('admin-settings')">Payment Settings</a></li>
          <li class="nav-item"><a class="nav-link" href="#" onclick="logout()">Logout (\${state.user.name})</a></li>
        \`;
      } else {
        nav.innerHTML = \`
          <li class="nav-item"><a class="nav-link" href="#" onclick="navigate('dashboard')">My Applications</a></li>
          <li class="nav-item"><a class="nav-link" href="#" onclick="navigate('apply')">New Application</a></li>
          <li class="nav-item"><a class="nav-link" href="#" onclick="logout()">Logout (\${state.user.name})</a></li>
        \`;
      }
    }

    function navigate(view, param = null) {
      window.location.hash = view + (param ? '?id=' + param : '');
      router();
    }

    function router() {
      const hash = window.location.hash.replace('#', '') || (state.user ? (state.user.role === 'admin' ? 'admin-dashboard' : 'dashboard') : 'login');
      const [view, query] = hash.split('?');
      const param = query ? new URLSearchParams(query).get('id') : null;

      const container = document.getElementById('main-container');

      if (!state.user && ['login', 'register'].indexOf(view) === -1) {
        return renderLogin();
      }

      switch (view) {
        case 'login': renderLogin(); break;
        case 'register': renderRegister(); break;
        case 'dashboard': renderCustomerDashboard(); break;
        case 'apply': renderApplicationForm(); break;
        case 'view-app': renderViewApplication(param); break;
        case 'admin-dashboard': renderAdminDashboard(); break;
        case 'admin-view-app': renderAdminViewApp(param); break;
        case 'admin-settings': renderAdminSettings(); break;
        default: renderLogin(); break;
      }
    }

    // --- VIEWS ---

    function renderLogin() {
      document.getElementById('main-container').innerHTML = \`
        <div class="row justify-content-center mt-5">
          <div class="col-md-5">
            <div class="card p-4">
              <h3 class="text-center mb-4">Account Login</h3>
              <form id="login-form" onsubmit="handleLogin(event)">
                <div class="mb-3">
                  <label class="form-label">Email Address</label>
                  <input type="email" id="email" class="form-control" required>
                </div>
                <div class="mb-3">
                  <label class="form-label">Password</label>
                  <input type="password" id="password" class="form-control" required>
                </div>
                <button type="submit" class="btn btn-primary w-100">Login</button>
              </form>
              <div class="text-center mt-3">
                <small>Don't have an account? <a href="#" onclick="navigate('register')">Register here</a></small>
              </div>
            </div>
          </div>
        </div>\`;
    }

    async function handleLogin(e) {
      e.preventDefault();
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.value, password: password.value })
      });
      const data = await res.json();
      if (data.success) {
        await fetchUser();
        navigate(data.role === 'admin' ? 'admin-dashboard' : 'dashboard');
      } else alert(data.error);
    }

    function renderRegister() {
      document.getElementById('main-container').innerHTML = \`
        <div class="row justify-content-center mt-5">
          <div class="col-md-5">
            <div class="card p-4">
              <h3 class="text-center mb-4">Create Account</h3>
              <form id="reg-form" onsubmit="handleRegister(event)">
                <div class="mb-3">
                  <label class="form-label">Full Name</label>
                  <input type="text" id="reg_name" class="form-control" required>
                </div>
                <div class="mb-3">
                  <label class="form-label">Email Address</label>
                  <input type="email" id="reg_email" class="form-control" required>
                </div>
                <div class="mb-3">
                  <label class="form-label">Password</label>
                  <input type="password" id="reg_pass" class="form-control" required>
                </div>
                <button type="submit" class="btn btn-success w-100">Register</button>
              </form>
              <div class="text-center mt-3">
                <small>Already registered? <a href="#" onclick="navigate('login')">Login here</a></small>
              </div>
            </div>
          </div>
        </div>\`;
    }

    async function handleRegister(e) {
      e.preventDefault();
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: reg_name.value, email: reg_email.value, password: reg_pass.value })
      });
      const data = await res.json();
      if (data.success) {
        await fetchUser();
        navigate('dashboard');
      } else alert(data.error);
    }

    async function renderCustomerDashboard() {
      const res = await fetch('/api/my-applications');
      const apps = await res.json();
      const notifRes = await fetch('/api/notifications');
      const notifs = await notifRes.json();

      let html = \`
        <div class="row">
          <div class="col-md-8">
            <div class="d-flex justify-content-between align-items-center mb-3">
              <h4>My Applications</h4>
              <button class="btn btn-primary btn-sm" onclick="navigate('apply')"><i class="bi bi-plus-lg me-1"></i>New Application</button>
            </div>\`;

      if (apps.length === 0) {
        html += \`<div class="card p-4 text-center text-muted">No applications submitted yet.</div>\`;
      } else {
        apps.forEach(app => {
          html += \`
            <div class="card p-3">
              <div class="d-flex justify-content-between align-items-center">
                <div>
                  <h5 class="mb-1">\${app.service_type} Assistance</h5>
                  <span class="text-muted small">Tracking #: <strong>\${app.tracking_number}</strong></span><br>
                  <small class="text-muted">Submitted: \${new Date(app.created_at).toLocaleDateString()}</small>
                </div>
                <div class="text-end">
                  <span class="badge bg-info text-dark mb-1">\${app.status}</span><br>
                  <span class="badge bg-secondary">\${app.payment_method}: \${app.payment_status}</span>
                </div>
              </div>
              <div class="mt-3 text-end">
                <button class="btn btn-outline-primary btn-sm" onclick="navigate('view-app', \${app.id})">View Details & Status</button>
              </div>
            </div>\`;
        });
      }

      html += \`</div>
        <div class="col-md-4">
          <div class="card p-3">
            <h5><i class="bi bi-bell me-2"></i>Notifications</h5>
            <ul class="list-group list-group-flush small">
              \${notifs.length === 0 ? '<li class="list-group-item text-muted">No notifications</li>' : ''}
              \${notifs.map(n => \`<li class="list-group-item">\${n.message} <br><span class="text-muted" style="font-size:0.7rem">\${new Date(n.created_at).toLocaleString()}</span></li>\`).join('')}
            </ul>
          </div>
        </div>
      </div>\`;

      document.getElementById('main-container').innerHTML = html;
    }

    function renderApplicationForm() {
      document.getElementById('main-container').innerHTML = \`
        <div class="card p-4">
          <h3 class="mb-4">New Government Application Assistance Request</h3>
          <form id="app-form" onsubmit="handleAppSubmit(event)" enctype="multipart/form-data">
            
            <div class="form-section-title">1. Select Government Service</div>
            <div class="mb-3">
              <select class="form-select" id="service_type" required onchange="toggleServiceFields()">
                <option value="">-- Select Service --</option>
                <option value="BIR/TIN">BIR / TIN Registration</option>
                <option value="SSS">SSS Application</option>
                <option value="Pag-IBIG">Pag-IBIG Membership</option>
              </select>
            </div>

            <div class="form-section-title">2. Personal Details</div>
            <div class="row g-3 mb-3">
              <div class="col-md-3"><label class="form-label">First Name</label><input type="text" class="form-control" name="first_name" required></div>
              <div class="col-md-3"><label class="form-label">Middle Name</label><input type="text" class="form-control" name="middle_name"></div>
              <div class="col-md-3"><label class="form-label">Last Name</label><input type="text" class="form-control" name="last_name" required></div>
              <div class="col-md-3"><label class="form-label">Suffix</label><input type="text" class="form-control" name="suffix" placeholder="e.g. Jr, III"></div>
              <div class="col-md-3"><label class="form-label">Date of Birth</label><input type="date" class="form-control" name="dob" required></div>
              <div class="col-md-3"><label class="form-label">Place of Birth</label><input type="text" class="form-control" name="pob" required></div>
              <div class="col-md-3">
                <label class="form-label">Sex</label>
                <select class="form-select" name="sex" required>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </select>
              </div>
              <div class="col-md-3">
                <label class="form-label">Civil Status</label>
                <select class="form-select" name="civil_status" required>
                  <option value="Single">Single</option>
                  <option value="Married">Married</option>
                  <option value="Widowed">Widowed</option>
                </select>
              </div>
              <div class="col-md-4"><label class="form-label">Nationality</label><input type="text" class="form-control" name="nationality" value="Filipino" required></div>
              <div class="col-md-4"><label class="form-label">Mobile Number</label><input type="text" class="form-control" name="mobile" required></div>
              <div class="col-md-4"><label class="form-label">Email</label><input type="email" class="form-control" name="email" required></div>
            </div>

            <div class="form-section-title">3. Complete Address</div>
            <div class="row g-3 mb-3">
              <div class="col-md-3"><label class="form-label">Barangay</label><input type="text" class="form-control" name="barangay" required></div>
              <div class="col-md-3"><label class="form-label">City/Municipality</label><input type="text" class="form-control" name="city" required></div>
              <div class="col-md-3"><label class="form-label">Province</label><input type="text" class="form-control" name="province" required></div>
              <div class="col-md-3"><label class="form-label">ZIP Code</label><input type="text" class="form-control" name="zip" required></div>
            </div>

            <div class="form-section-title">4. Family & Employment Background</div>
            <div class="row g-3 mb-3">
              <div class="col-md-6"><label class="form-label">Mother's Maiden Name</label><input type="text" class="form-control" name="mother_maiden" required></div>
              <div class="col-md-6"><label class="form-label">Father's Full Name</label><input type="text" class="form-control" name="father_name" required></div>
              <div class="col-md-4"><label class="form-label">Occupation</label><input type="text" class="form-control" name="occupation"></div>
              <div class="col-md-4"><label class="form-label">Employer</label><input type="text" class="form-control" name="employer"></div>
              <div class="col-md-4"><label class="form-label">Employer Address</label><input type="text" class="form-control" name="employer_address"></div>
            </div>

            <div id="dynamic-fields"></div>

            <div class="form-section-title">5. Document Uploads (Max 5MB: JPG, PNG, PDF)</div>
            <div class="row g-3 mb-3">
              <div class="col-md-4">
                <label class="form-label">Valid Government ID</label>
                <input type="file" class="form-control" name="valid_id" accept=".jpg,.jpeg,.png,.pdf" required onchange="previewFile(this)">
                <img class="preview-img">
              </div>
              <div class="col-md-4">
                <label class="form-label">Photo Holding Same ID</label>
                <input type="file" class="form-control" name="holding_id" accept=".jpg,.jpeg,.png,.pdf" required onchange="previewFile(this)">
                <img class="preview-img">
              </div>
              <div class="col-md-4">
                <label class="form-label">ID / Profile Picture</label>
                <input type="file" class="form-control" name="profile_pic" accept=".jpg,.jpeg,.png,.pdf" required onchange="previewFile(this)">
                <img class="preview-img">
              </div>
            </div>

            <div class="form-section-title">6. Payment Details</div>
            <div class="mb-3">
              <label class="form-label">Payment Method</label>
              <select class="form-select" id="payment_method" name="payment_method" required onchange="togglePaymentUI()">
                <option value="">-- Choose Payment Method --</option>
                \${state.settings.cash_enabled ? '<option value="CASH">CASH</option>' : ''}
                \${state.settings.gcash_enabled ? '<option value="GCASH">GCASH</option>' : ''}
              </select>
            </div>

            <div id="payment-ui" class="card p-3 bg-light mb-3" style="display:none;"></div>

            <button type="submit" class="btn btn-primary btn-lg w-100 mt-3">Submit Application</button>
          </form>
        </div>\`;
    }

    function toggleServiceFields() {
      const type = document.getElementById('service_type').value;
      const target = document.getElementById('dynamic-fields');
      let html = '';

      if (type === 'BIR/TIN') {
        html = \`
          <div class="form-section-title">Specific Information (BIR/TIN)</div>
          <div class="row g-3 mb-3">
            <div class="col-md-6"><label class="form-label">Tax Type / Purpose</label><input type="text" class="form-control" name="tax_purpose" placeholder="e.g. Employment, First Time Jobseeker"></div>
            <div class="col-md-6"><label class="form-label">RDO Code (If known)</label><input type="text" class="form-control" name="rdo_code"></div>
          </div>\`;
      } else if (type === 'SSS') {
        html = \`
          <div class="form-section-title">Specific Information (SSS)</div>
          <div class="row g-3 mb-3">
            <div class="col-md-6"><label class="form-label">Membership Type</label><input type="text" class="form-control" name="sss_type" placeholder="e.g. Employed, Self-Employed, Voluntary"></div>
            <div class="col-md-6"><label class="form-label">Monthly Gross Income</label><input type="number" class="form-control" name="monthly_income"></div>
          </div>\`;
      } else if (type === 'Pag-IBIG') {
        html = \`
          <div class="form-section-title">Specific Information (Pag-IBIG)</div>
          <div class="row g-3 mb-3">
            <div class="col-md-6"><label class="form-label">Desired Monthly Contribution</label><input type="number" class="form-control" name="pagibig_contribution" value="200"></div>
            <div class="col-md-6"><label class="form-label">Preferred Overseas Center (If OFW)</label><input type="text" class="form-control" name="ofw_center"></div>
          </div>\`;
      }
      target.innerHTML = html;
      togglePaymentUI();
    }

    function togglePaymentUI() {
      const service = document.getElementById('service_type').value;
      const method = document.getElementById('payment_method').value;
      const target = document.getElementById('payment-ui');

      if (!method) { target.style.display = 'none'; return; }
      target.style.display = 'block';

      let fee = state.settings.tin_fee;
      if (service === 'SSS') fee = state.settings.sss_fee;
      if (service === 'Pag-IBIG') fee = state.settings.pagibig_fee;

      if (method === 'CASH') {
        target.innerHTML = \`
          <h5>Cash Payment</h5>
          <p class="mb-0">Service Fee: <strong>₱\${fee}</strong></p>
          <small class="text-muted">Please settle payment directly with our office. Status will be marked 'Payment Pending'.</small>\`;
      } else if (method === 'GCASH') {
        target.innerHTML = \`
          <h5>GCash Payment Information</h5>
          <p class="mb-1">Service Fee: <strong class="text-success">₱\${fee}</strong></p>
          <p class="mb-1">Account Name: <strong>\${state.settings.gcash_name}</strong></p>
          <p class="mb-2">GCash Number: <strong>\${state.settings.gcash_number}</strong></p>
          \${state.settings.gcash_qr_path ? \`<img src="/uploads/\${state.settings.gcash_qr_path}" style="max-width:200px;" class="mb-3 d-block border p-1 bg-white">\` : ''}
          <div class="row g-3">
            <div class="col-md-4"><label class="form-label">Reference Number</label><input type="text" class="form-control" name="gcash_ref" required></div>
            <div class="col-md-4"><label class="form-label">Date of Payment</label><input type="date" class="form-control" name="gcash_date" required></div>
            <div class="col-md-4">
              <label class="form-label">Upload Payment Receipt</label>
              <input type="file" class="form-control" name="gcash_receipt" accept=".jpg,.jpeg,.png,.pdf" required onchange="previewFile(this)">
              <img class="preview-img">
            </div>
          </div>\`;
      }
    }

    function previewFile(input) {
      const file = input.files[0];
      const img = input.nextElementSibling;
      if (file && file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = e => { img.src = e.target.result; img.style.display = 'block'; }
        reader.readAsDataURL(file);
      } else {
        if(img) img.style.display = 'none';
      }
    }

    async function handleAppSubmit(e) {
      e.preventDefault();
      const form = document.getElementById('app-form');
      const formData = new FormData(form);

      const res = await fetch('/api/applications', { method: 'POST', body: formData });
      const data = await res.json();

      if (data.success) {
        alert('Application submitted successfully! Tracking Number: ' + data.trackingNumber);
        navigate('dashboard');
      } else {
        alert(data.error);
      }
    }

    async function renderViewApplication(id) {
      const res = await fetch('/api/application/' + id);
      const { app, docs, payment, history } = await res.json();
      const fields = JSON.parse(app.form_data);

      let html = \`
        <div class="card p-4">
          <div class="d-flex justify-content-between align-items-center mb-3">
            <div>
              <h3>\${app.service_type} Application Details</h3>
              <span class="text-muted">Tracking #: <strong>\${app.tracking_number}</strong></span>
            </div>
            <span class="badge bg-primary fs-6">\${app.status}</span>
          </div>

          <div class="progress-tracker my-4">
            \${['Payment Pending', 'Submitted', 'Under Review', 'Processing', 'Ready', 'Completed'].map(st => \`
              <div class="progress-step \${app.status === st ? 'active' : ''}">
                <div class="icon"><i class="bi bi-check"></i></div>
                <div>\${st}</div>
              </div>\`).join('')}
          </div>

          <div class="row">
            <div class="col-md-6">
              <div class="card p-3 bg-light">
                <h5>Personal Details</h5>
                <hr class="my-1">
                <small><strong>Name:</strong> \${fields.first_name} \${fields.middle_name || ''} \${fields.last_name}</small><br>
                <small><strong>DOB:</strong> \${fields.dob} | <strong>Sex:</strong> \${fields.sex}</small><br>
                <small><strong>Address:</strong> \${fields.barangay}, \${fields.city}, \${fields.province} \${fields.zip}</small><br>
                <small><strong>Contact:</strong> \${fields.mobile} | \${fields.email}</small>
              </div>
            </div>
            <div class="col-md-6">
              <div class="card p-3 bg-light">
                <h5>Payment Status</h5>
                <hr class="my-1">
                <small><strong>Method:</strong> \${payment ? payment.payment_method : 'N/A'}</small><br>
                <small><strong>Amount:</strong> ₱\${payment ? payment.amount : '0'}</small><br>
                <small><strong>Status:</strong> <span class="badge bg-secondary">\${payment ? payment.status : 'Pending'}</span></small>
                \${payment && payment.reference_number ? \`<br><small><strong>Ref #:</strong> \${payment.reference_number}</small>\` : ''}
              </div>
            </div>
          </div>

          \${app.admin_remarks ? \`
            <div class="alert alert-warning mt-3">
              <strong>Admin Remarks:</strong> \${app.admin_remarks}
            </div>\` : ''}

          <div class="mt-4">
            <h5>Uploaded Documents</h5>
            <div class="row g-2">
              \${docs.filter(d => d.doc_type !== 'completed_doc').map(d => \`
                <div class="col-md-3">
                  <div class="border p-2 rounded text-center bg-white">
                    <small class="d-block text-truncate">\${d.doc_type}</small>
                    <a href="/uploads/\${d.file_path}" target="_blank" class="btn btn-sm btn-outline-secondary mt-1">View File</a>
                  </div>
                </div>\`).join('')}
            </div>
          </div>

          \${app.status === 'Need Correction' ? \`
            <div class="card p-3 mt-4 border-warning">
              <h5>Upload Requested Corrections</h5>
              <form onsubmit="handleCorrectionSubmit(event, \${app.id})">
                <div class="mb-3">
                  <input type="file" name="correction_docs" class="form-control" multiple required>
                </div>
                <button class="btn btn-warning btn-sm">Resubmit Documents</button>
              </form>
            </div>\` : ''}

          <div class="mt-4">
            <h5>Completed Documents</h5>
            <div class="row g-2">
              \${docs.filter(d => d.doc_type === 'completed_doc').length === 0 ? '<p class="text-muted small">No completed documents attached yet.</p>' : ''}
              \${docs.filter(d => d.doc_type === 'completed_doc').map(d => \`
                <div class="col-md-3">
                  <div class="border p-2 rounded text-center bg-success text-white">
                    <small class="d-block text-truncate">\${d.original_name}</small>
                    <a href="/uploads/\${d.file_path}" target="_blank" class="btn btn-sm btn-light mt-1">Download</a>
                  </div>
                </div>\`).join('')}
            </div>
          </div>

          <div class="mt-4">
            <h5>History Log</h5>
            <ul class="list-group list-group-flush small">
              \${history.map(h => \`
                <li class="list-group-item d-flex justify-content-between align-items-center">
                  <span><strong>\${h.status}</strong> - \${h.remarks}</span>
                  <span class="text-muted">\${new Date(h.created_at).toLocaleString()}</span>
                </li>\`).join('')}
            </ul>
          </div>
        </div>\`;

      document.getElementById('main-container').innerHTML = html;
    }

    async function handleCorrectionSubmit(e, appId) {
      e.preventDefault();
      const formData = new FormData(e.target);
      const res = await fetch(\`/api/application/\${appId}/resubmit\`, { method: 'POST', body: formData });
      if ((await res.json()).success) {
        alert('Correction files submitted.');
        renderViewApplication(appId);
      }
    }

    // --- ADMIN VIEWS ---

    async function renderAdminDashboard() {
      const statsRes = await fetch('/api/admin/stats');
      const stats = await statsRes.json();
      const appsRes = await fetch('/api/admin/applications');
      const apps = await appsRes.json();

      let html = \`
        <div class="mb-4">
          <h2>Admin Dashboard</h2>
          <div class="row g-3 mt-2">
            <div class="col-md-2"><div class="card p-3 text-center bg-primary text-white"><h3>\${stats.total || 0}</h3><small>Total Apps</small></div></div>
            <div class="col-md-2"><div class="card p-3 text-center bg-secondary text-white"><h3>\${stats.tin || 0}</h3><small>BIR/TIN</small></div></div>
            <div class="col-md-2"><div class="card p-3 text-center bg-info text-dark"><h3>\${stats.sss || 0}</h3><small>SSS</small></div></div>
            <div class="col-md-2"><div class="card p-3 text-center bg-warning text-dark"><h3>\${stats.pagibig || 0}</h3><small>Pag-IBIG</small></div></div>
            <div class="col-md-2"><div class="card p-3 text-center bg-danger text-white"><h3>\${stats.pending_pay || 0}</h3><small>Pending Payments</small></div></div>
            <div class="col-md-2"><div class="card p-3 text-center bg-success text-white"><h3>\${stats.completed || 0}</h3><small>Completed</small></div></div>
          </div>
        </div>

        <div class="card p-3">
          <div class="d-flex justify-content-between align-items-center mb-3">
            <h5>All Applications</h5>
            <input type="text" class="form-control w-25" id="admin-search" placeholder="Search applicant..." onkeyup="filterAdminTable()">
          </div>
          <div class="table-responsive">
            <table class="table table-hover align-middle" id="admin-table">
              <thead>
                <tr>
                  <th>Applicant Name</th>
                  <th>Service</th>
                  <th>Tracking #</th>
                  <th>Payment</th>
                  <th>Payment Status</th>
                  <th>App Status</th>
                  <th>Date</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                \${apps.map(a => \`
                  <tr>
                    <td>\${a.applicant_name}</td>
                    <td>\${a.service_type}</td>
                    <td><small><strong>\${a.tracking_number}</strong></small></td>
                    <td>\${a.payment_method || 'N/A'}</td>
                    <td><span class="badge bg-secondary">\${a.payment_status || 'Pending'}</span></td>
                    <td><span class="badge bg-info text-dark">\${a.status}</span></td>
                    <td><small>\${new Date(a.created_at).toLocaleDateString()}</small></td>
                    <td>
                      <button class="btn btn-primary btn-sm" onclick="navigate('admin-view-app', \${a.id})">Manage</button>
                    </td>
                  </tr>\`).join('')}
              </tbody>
            </table>
          </div>
        </div>\`;

      document.getElementById('main-container').innerHTML = html;
    }

    function filterAdminTable() {
      const q = document.getElementById('admin-search').value.toLowerCase();
      const rows = document.querySelectorAll('#admin-table tbody tr');
      rows.forEach(r => {
        r.style.display = r.innerText.toLowerCase().includes(q) ? '' : 'none';
      });
    }

    async function renderAdminViewApp(id) {
      const res = await fetch('/api/application/' + id);
      const { app, docs, payment, history } = await res.json();
      const fields = JSON.parse(app.form_data);

      let html = \`
        <div class="card p-4">
          <div class="d-flex justify-content-between align-items-center mb-3">
            <h3>Manage Application: \${app.tracking_number}</h3>
            <button class="btn btn-outline-danger btn-sm" onclick="deleteApp(\${app.id})">Delete Application</button>
          </div>

          <div class="row">
            <div class="col-md-6">
              <div class="card p-3 bg-light mb-3">
                <h5>Applicant Details</h5>
                <hr class="my-1">
                <small><strong>Name:</strong> \${fields.first_name} \${fields.middle_name || ''} \${fields.last_name} \${fields.suffix || ''}</small><br>
                <small><strong>DOB:</strong> \${fields.dob} | <strong>Place:</strong> \${fields.pob}</small><br>
                <small><strong>Sex:</strong> \${fields.sex} | <strong>Civil Status:</strong> \${fields.civil_status}</small><br>
                <small><strong>Address:</strong> \${fields.barangay}, \${fields.city}, \${fields.province} \${fields.zip}</small><br>
                <small><strong>Contact:</strong> \${fields.mobile} | \${fields.email}</small><br>
                <small><strong>Mother:</strong> \${fields.mother_maiden} | <strong>Father:</strong> \${fields.father_name}</small><br>
                <small><strong>Employer:</strong> \${fields.employer || 'N/A'} (\${fields.occupation || 'N/A'})</small>
              </div>
            </div>

            <div class="col-md-6">
              <div class="card p-3 bg-light mb-3">
                <h5>Payment Verification</h5>
                <hr class="my-1">
                <small><strong>Method:</strong> \${payment ? payment.payment_method : 'N/A'}</small><br>
                <small><strong>Amount:</strong> ₱\${payment ? payment.amount : '0'}</small><br>
                <small><strong>Current Status:</strong> <strong>\${payment ? payment.status : 'Pending'}</strong></small><br>
                \${payment && payment.reference_number ? \`<small><strong>Ref Number:</strong> \${payment.reference_number}</small><br>\` : ''}
                \${payment && payment.receipt_path ? \`<a href="/uploads/\${payment.receipt_path}" target="_blank" class="btn btn-sm btn-outline-info mt-2">View Receipt</a>\` : ''}
              </div>
            </div>
          </div>

          <div class="card p-3 bg-light mb-3">
            <h5>Update Status & Upload Completed Files</h5>
            <form onsubmit="handleAdminUpdate(event, \${app.id})" enctype="multipart/form-data">
              <div class="row g-3">
                <div class="col-md-4">
                  <label class="form-label">Application Status</label>
                  <select name="status" class="form-select">
                    <option value="Payment Pending" \${app.status==='Payment Pending'?'selected':''}>Payment Pending</option>
                    <option value="Submitted" \${app.status==='Submitted'?'selected':''}>Submitted</option>
                    <option value="Under Review" \${app.status==='Under Review'?'selected':''}>Under Review</option>
                    <option value="Need Correction" \${app.status==='Need Correction'?'selected':''}>Need Correction</option>
                    <option value="Processing" \${app.status==='Processing'?'selected':''}>Processing</option>
                    <option value="Ready" \${app.status==='Ready'?'selected':''}>Ready</option>
                    <option value="Completed" \${app.status==='Completed'?'selected':''}>Completed</option>
                    <option value="Rejected" \${app.status==='Rejected'?'selected':''}>Rejected</option>
                    <option value="Cancelled" \${app.status==='Cancelled'?'selected':''}>Cancelled</option>
                  </select>
                </div>

                <div class="col-md-4">
                  <label class="form-label">Payment Status</label>
                  <select name="payment_status" class="form-select">
                    <option value="Pending" \${payment && payment.status==='Pending'?'selected':''}>Pending</option>
                    <option value="Verification Pending" \${payment && payment.status==='Verification Pending'?'selected':''}>Verification Pending</option>
                    <option value="Paid" \${payment && payment.status==='Paid'?'selected':''}>Paid</option>
                    <option value="Invalid" \${payment && payment.status==='Invalid'?'selected':''}>Invalid</option>
                    <option value="Need New Receipt" \${payment && payment.status==='Need New Receipt'?'selected':''}>Need New Receipt</option>
                    <option value="Refunded" \${payment && payment.status==='Refunded'?'selected':''}>Refunded</option>
                  </select>
                </div>

                <div class="col-md-4">
                  <label class="form-label">Upload Completed Document(s)</label>
                  <input type="file" name="completed_docs" class="form-control" multiple>
                </div>

                <div class="col-12">
                  <label class="form-label">Admin Remarks / Correction Request</label>
                  <textarea name="remarks" class="form-control" rows="2">\${app.admin_remarks || ''}</textarea>
                </div>
              </div>
              <button class="btn btn-success mt-3">Save Updates</button>
            </form>
          </div>

          <div class="mt-3">
            <h5>Uploaded Documents</h5>
            <div class="row g-2">
              \${docs.map(d => \`
                <div class="col-md-3">
                  <div class="border p-2 rounded text-center bg-white">
                    <small class="d-block text-truncate">\${d.doc_type}</small>
                    <a href="/uploads/\${d.file_path}" target="_blank" class="btn btn-sm btn-outline-primary mt-1">View / Download</a>
                  </div>
                </div>\`).join('')}
            </div>
          </div>
        </div>\`;

      document.getElementById('main-container').innerHTML = html;
    }

    async function handleAdminUpdate(e, appId) {
      e.preventDefault();
      const formData = new FormData(e.target);
      const res = await fetch(\`/api/admin/application/\${appId}/update\`, { method: 'POST', body: formData });
      if ((await res.json()).success) {
        alert('Application updated.');
        renderAdminViewApp(appId);
      }
    }

    async function deleteApp(appId) {
      if (confirm('Are you sure you want to delete this application?')) {
        await fetch(\`/api/admin/application/\${appId}\`, { method: 'DELETE' });
        navigate('admin-dashboard');
      }
    }

    async function renderAdminSettings() {
      const res = await fetch('/api/settings');
      const s = await res.json();

      let html = \`
        <div class="card p-4">
          <h3>Payment Settings</h3>
          <form onsubmit="handleSettingsSubmit(event)" enctype="multipart/form-data">
            <div class="form-section-title">Service Fees (PHP)</div>
            <div class="row g-3 mb-3">
              <div class="col-md-4"><label class="form-label">BIR/TIN Fee</label><input type="number" class="form-control" name="tin_fee" value="\${s.tin_fee}"></div>
              <div class="col-md-4"><label class="form-label">SSS Fee</label><input type="number" class="form-control" name="sss_fee" value="\${s.sss_fee}"></div>
              <div class="col-md-4"><label class="form-label">Pag-IBIG Fee</label><input type="number" class="form-control" name="pagibig_fee" value="\${s.pagibig_fee}"></div>
            </div>

            <div class="form-section-title">Payment Toggles</div>
            <div class="form-check form-switch mb-2">
              <input class="form-check-input" type="checkbox" name="cash_enabled" id="c_e" \${s.cash_enabled ? 'checked' : ''}>
              <label class="form-check-label" for="c_e">Enable Cash Payments</label>
            </div>
            <div class="form-check form-switch mb-3">
              <input class="form-check-input" type="checkbox" name="gcash_enabled" id="g_e" \${s.gcash_enabled ? 'checked' : ''}>
              <label class="form-check-label" for="g_e">Enable GCash Payments</label>
            </div>

            <div class="form-section-title">GCash Account Details</div>
            <div class="row g-3 mb-3">
              <div class="col-md-6"><label class="form-label">Account Name</label><input type="text" class="form-control" name="gcash_name" value="\${s.gcash_name}"></div>
              <div class="col-md-6"><label class="form-label">Account Number</label><input type="text" class="form-control" name="gcash_number" value="\${s.gcash_number}"></div>
              <div class="col-md-12">
                <label class="form-label">Upload GCash QR Code</label>
                <input type="file" class="form-control" name="gcash_qr" accept=".jpg,.jpeg,.png">
                \${s.gcash_qr_path ? \`<img src="/uploads/\${s.gcash_qr_path}" style="max-width:150px;" class="mt-2 border p-1 bg-white d-block">\` : ''}
              </div>
            </div>

            <button type="submit" class="btn btn-primary">Save Settings</button>
          </form>
        </div>\`;

      document.getElementById('main-container').innerHTML = html;
    }

    async function handleSettingsSubmit(e) {
      e.preventDefault();
      const formData = new FormData(e.target);
      const res = await fetch('/api/admin/settings', { method: 'POST', body: formData });
      if ((await res.json()).success) {
        alert('Settings updated successfully.');
        await fetchSettings();
        renderAdminSettings();
      }
    }

    async function logout() {
      await fetch('/api/logout', { method: 'POST' });
      state.user = null;
      renderNav();
      navigate('login');
    }

    window.addEventListener('hashchange', router);
    window.addEventListener('DOMContentLoaded', init);
  </script>
</body>
</html>
  `);
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});