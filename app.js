const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { Parser } = require('json2csv');

const PORT = process.env.PORT || 3000;
const app = express();

// Ensure uploads directory exists
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Database Initialization
const db = new sqlite3.Database('./gov_assistance.db', (err) => {
  if (err) console.error('Database connection error:', err.message);
  else console.log('Connected to SQLite database.');
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    mobile TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    role TEXT DEFAULT 'customer',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tracking_number TEXT UNIQUE NOT NULL,
    user_id INTEGER NOT NULL,
    service_type TEXT NOT NULL,
    status TEXT DEFAULT 'Submitted',
    payment_status TEXT DEFAULT 'Unpaid',
    form_data TEXT NOT NULL,
    admin_remarks TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER NOT NULL,
    doc_type TEXT NOT NULL,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(application_id) REFERENCES applications(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER NOT NULL,
    payment_method TEXT NOT NULL,
    amount REAL NOT NULL,
    reference_number TEXT UNIQUE,
    payment_date DATETIME,
    proof_filename TEXT,
    status TEXT DEFAULT 'Pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(application_id) REFERENCES applications(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS status_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    remarks TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(application_id) REFERENCES applications(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    message TEXT NOT NULL,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Default Admin Account: username 'admin', password 'admin123'
  const adminPass = bcrypt.hashSync('admin123', 10);
  db.run(`INSERT OR IGNORE INTO users (id, full_name, username, password, mobile, email, role) 
          VALUES (1, 'System Administrator', 'admin', ?, '09000000000', 'admin@system.local', 'admin')`, [adminPass]);

  // Seed Default Settings
  const defaultSettings = [
    ['business_name', 'GovAssist Processing Services'],
    ['contact_number', '09171234567'],
    ['email', 'support@govassist.local'],
    ['address', '123 Service Road, Metro Manila, Philippines'],
    ['operating_hours', 'Mon - Fri: 8:00 AM - 5:00 PM'],
    ['gcash_name', 'GovAssist Admin'],
    ['gcash_number', '09171234567'],
    ['gcash_qr', ''],
    ['fee_bir', '500'],
    ['fee_sss', '400'],
    ['fee_pagibig', '400'],
    ['fee_other', '300'],
    ['enable_cash', 'true'],
    ['enable_gcash', 'true']
  ];

  defaultSettings.forEach(([k, v]) => {
    db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`, [k, v]);
  });
});

// Middleware Setup
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'gov_assistance_super_secret_key_2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// File Upload Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB Limit
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.pdf'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Invalid file type. Only JPG, JPEG, PNG, and PDF are allowed.'));
  }
});

// Auth Guard Middlewares
const requireAuth = (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized. Please log in.' });
  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.session.userId || req.session.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden. Admin access required.' });
  }
  next();
};

function logAudit(userId, action) {
  db.run(`INSERT INTO audit_logs (user_id, action) VALUES (?, ?)`, [userId, action]);
}

function notifyUser(userId, message) {
  db.run(`INSERT INTO notifications (user_id, message) VALUES (?, ?)`, [userId, message]);
}

// ----------------------------------------------------
// API ROUTES
// ----------------------------------------------------

// Authentication API
app.post('/api/register', (req, res) => {
  const { full_name, username, password, mobile, email } = req.body;
  if (!full_name || !username || !password || !mobile || !email) {
    return res.status(400).json({ error: 'All fields are required.' });
  }
  const hash = bcrypt.hashSync(password, 10);
  db.run(
    `INSERT INTO users (full_name, username, password, mobile, email) VALUES (?, ?, ?, ?, ?)`,
    [full_name, username, hash, mobile, email],
    function (err) {
      if (err) return res.status(400).json({ error: 'Username or Email already exists.' });
      notifyUser(this.lastID, 'Account successfully created! Welcome to GovAssist.');
      res.json({ success: true });
    }
  );
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, user) => {
    if (err || !user) return res.status(400).json({ error: 'Invalid credentials.' });
    if (!bcrypt.compareSync(password, user.password)) {
      return res.status(400).json({ error: 'Invalid credentials.' });
    }
    req.session.userId = user.id;
    req.session.role = user.role;
    req.session.fullName = user.full_name;
    logAudit(user.id, 'User Logged In');
    res.json({ success: true, role: user.role, name: user.full_name });
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.json({ loggedIn: false });
  db.get(`SELECT id, full_name, username, mobile, email, role FROM users WHERE id = ?`, [req.session.userId], (err, user) => {
    res.json({ loggedIn: true, user });
  });
});

// Settings API
app.get('/api/settings', (req, res) => {
  db.all(`SELECT * FROM settings`, [], (err, rows) => {
    const settings = {};
    rows.forEach(r => settings[r.key] = r.value);
    res.json(settings);
  });
});

// Submit Application
app.post('/api/applications', requireAuth, upload.fields([
  { name: 'valid_id', maxCount: 1 },
  { name: 'holding_id', maxCount: 1 },
  { name: 'id_photo', maxCount: 1 },
  { name: 'extra_doc', maxCount: 1 }
]), (req, res) => {
  const userId = req.session.userId;
  const { service_type, ...formData } = req.body;

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = service_type.toUpperCase().replace(/\s/g, '');

  db.get(`SELECT COUNT(*) as count FROM applications WHERE tracking_number LIKE ?`, [`${prefix}-${dateStr}-%`], (err, row) => {
    const seq = String(row.count + 1).padStart(4, '0');
    const trackingNum = `${prefix}-${dateStr}-${seq}`;

    db.run(
      `INSERT INTO applications (tracking_number, user_id, service_type, form_data) VALUES (?, ?, ?, ?)`,
      [trackingNum, userId, service_type, JSON.stringify(formData)],
      function (err) {
        if (err) return res.status(500).json({ error: 'Failed to create application.' });
        const appId = this.lastID;

        // Save documents
        const files = req.files;
        ['valid_id', 'holding_id', 'id_photo', 'extra_doc'].forEach(key => {
          if (files[key]) {
            db.run(`INSERT INTO documents (application_id, doc_type, filename, original_name) VALUES (?, ?, ?, ?)`,
              [appId, key, files[key][0].filename, files[key][0].originalname]);
          }
        });

        // Save status history
        db.run(`INSERT INTO status_history (application_id, status, remarks) VALUES (?, ?, ?)`,
          [appId, 'Submitted', 'Application submitted by applicant.']);

        notifyUser(userId, `Application submitted! Tracking Number: ${trackingNum}`);
        logAudit(userId, `Submitted application ${trackingNum}`);

        res.json({ success: true, trackingNumber: trackingNum });
      }
    );
  });
});

// Get User Applications
app.get('/api/my-applications', requireAuth, (req, res) => {
  db.all(`SELECT * FROM applications WHERE user_id = ? ORDER BY created_at DESC`, [req.session.userId], (err, rows) => {
    res.json(rows);
  });
});

// Application Details
app.get('/api/applications/:id', requireAuth, (req, res) => {
  const appId = req.params.id;
  db.get(`SELECT a.*, u.full_name, u.email, u.mobile FROM applications a JOIN users u ON a.user_id = u.id WHERE a.id = ?`, [appId], (err, appData) => {
    if (!appData) return res.status(404).json({ error: 'Not found.' });
    if (req.session.role !== 'admin' && appData.user_id !== req.session.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    db.all(`SELECT * FROM documents WHERE application_id = ?`, [appId], (err, docs) => {
      db.all(`SELECT * FROM payments WHERE application_id = ?`, [appId], (err, payments) => {
        db.all(`SELECT * FROM status_history WHERE application_id = ? ORDER BY created_at DESC`, [appId], (err, history) => {
          res.json({ application: appData, documents: docs, payments: payments, history: history });
        });
      });
    });
  });
});

// Payments
app.post('/api/payments', requireAuth, upload.single('payment_proof'), (req, res) => {
  const { application_id, payment_method, amount, reference_number, payment_date } = req.body;

  if (payment_method === 'GCASH' && !reference_number) {
    return res.status(400).json({ error: 'Reference number required for GCash.' });
  }

  db.get(`SELECT id FROM payments WHERE reference_number = ? AND reference_number IS NOT NULL AND reference_number != ''`, [reference_number], (err, existing) => {
    if (existing) return res.status(400).json({ error: 'GCash Reference Number already submitted.' });

    const proofFile = req.file ? req.file.filename : null;
    db.run(
      `INSERT INTO payments (application_id, payment_method, amount, reference_number, payment_date, proof_filename)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [application_id, payment_method, amount, reference_number || null, payment_date || new Date().toISOString(), proofFile],
      function (err) {
        if (err) return res.status(500).json({ error: 'Payment processing error.' });

        db.run(`UPDATE applications SET status = 'Payment Verification', payment_status = 'Pending' WHERE id = ?`, [application_id]);
        db.run(`INSERT INTO status_history (application_id, status, remarks) VALUES (?, ?, ?)`,
          [application_id, 'Payment Verification', 'Payment uploaded by applicant.']);

        notifyUser(req.session.userId, `Payment submitted for verification.`);
        res.json({ success: true });
      }
    );
  });
});

// Notifications
app.get('/api/notifications', requireAuth, (req, res) => {
  db.all(`SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC`, [req.session.userId], (err, rows) => {
    res.json(rows);
  });
});

app.post('/api/notifications/read', requireAuth, (req, res) => {
  db.run(`UPDATE notifications SET is_read = 1 WHERE user_id = ?`, [req.session.userId], () => {
    res.json({ success: true });
  });
});

// Public Tracking Route
app.get('/api/public-track/:tracking', (req, res) => {
  db.get(
    `SELECT tracking_number, service_type, status, admin_remarks, created_at, updated_at FROM applications WHERE tracking_number = ?`,
    [req.params.tracking],
    (err, row) => {
      if (!row) return res.status(404).json({ error: 'Tracking Number Not Found.' });
      res.json(row);
    }
  );
});

// Document File Access
app.get('/api/documents/file/:filename', requireAuth, (req, res) => {
  const filePath = path.join(UPLOAD_DIR, req.params.filename);
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).send('File not found');
  }
});

// Replace / Re-upload Document on Request
app.post('/api/documents/reupload', requireAuth, upload.single('doc_file'), (req, res) => {
  const { application_id, doc_type } = req.body;
  if (!req.file) return res.status(400).json({ error: 'File required.' });

  db.run(`INSERT INTO documents (application_id, doc_type, filename, original_name) VALUES (?, ?, ?, ?)`,
    [application_id, doc_type, req.file.filename, req.file.originalname],
    function (err) {
      if (err) return res.status(500).json({ error: 'Upload failed.' });
      db.run(`UPDATE applications SET status = 'Under Review' WHERE id = ?`, [application_id]);
      db.run(`INSERT INTO status_history (application_id, status, remarks) VALUES (?, ?, ?)`,
        [application_id, 'Under Review', `Re-uploaded document for ${doc_type}`]);
      res.json({ success: true });
    }
  );
});

// ----------------------------------------------------
// ADMIN ROUTES
// ----------------------------------------------------

app.get('/api/admin/dashboard', requireAdmin, (req, res) => {
  const stats = {};
  db.get(`SELECT COUNT(*) as total FROM users WHERE role = 'customer'`, [], (e, r) => {
    stats.totalCustomers = r.total;
    db.get(`SELECT COUNT(*) as total FROM applications`, [], (e, r) => {
      stats.totalApps = r.total;
      db.get(`SELECT COUNT(*) as total FROM applications WHERE service_type LIKE '%TIN%'`, [], (e, r) => {
        stats.birApps = r.total;
        db.get(`SELECT COUNT(*) as total FROM applications WHERE service_type LIKE '%SSS%'`, [], (e, r) => {
          stats.sssApps = r.total;
          db.get(`SELECT COUNT(*) as total FROM applications WHERE service_type LIKE '%PAG%'`, [], (e, r) => {
            stats.pagibigApps = r.total;
            db.get(`SELECT COUNT(*) as total FROM applications WHERE status = 'Processing'`, [], (e, r) => {
              stats.processingApps = r.total;
              db.get(`SELECT COUNT(*) as total FROM applications WHERE status = 'Completed'`, [], (e, r) => {
                stats.completedApps = r.total;
                db.get(`SELECT SUM(amount) as total FROM payments WHERE status = 'Approved'`, [], (e, r) => {
                  stats.totalRevenue = r.total || 0;
                  res.json(stats);
                });
              });
            });
          });
        });
      });
    });
  });
});

app.get('/api/admin/applications', requireAdmin, (req, res) => {
  db.all(
    `SELECT a.*, u.full_name as applicant_name FROM applications a JOIN users u ON a.user_id = u.id ORDER BY a.created_at DESC`,
    [],
    (err, rows) => {
      res.json(rows);
    }
  );
});

app.post('/api/admin/update-status', requireAdmin, (req, res) => {
  const { application_id, status, remarks } = req.body;
  db.run(`UPDATE applications SET status = ?, admin_remarks = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [status, remarks, application_id],
    function () {
      db.run(`INSERT INTO status_history (application_id, status, remarks) VALUES (?, ?, ?)`,
        [application_id, status, remarks]);

      db.get(`SELECT user_id, tracking_number FROM applications WHERE id = ?`, [application_id], (e, row) => {
        notifyUser(row.user_id, `Application ${row.tracking_number} status changed to: ${status}`);
        logAudit(req.session.userId, `Updated status of ${row.tracking_number} to ${status}`);
      });

      res.json({ success: true });
    }
  );
});

app.post('/api/admin/update-payment', requireAdmin, (req, res) => {
  const { payment_id, status } = req.body;
  db.run(`UPDATE payments SET status = ? WHERE id = ?`, [status], function () {
    db.get(`SELECT p.application_id, a.user_id, a.tracking_number FROM payments p JOIN applications a ON p.application_id = a.id WHERE p.id = ?`, [payment_id], (e, row) => {
      const appPaymentStatus = status === 'Approved' ? 'Paid' : 'Rejected';
      const appStatus = status === 'Approved' ? 'Under Review' : 'Payment Pending';
      db.run(`UPDATE applications SET payment_status = ?, status = ? WHERE id = ?`, [appPaymentStatus, appStatus, row.application_id]);

      notifyUser(row.user_id, `Payment for application ${row.tracking_number} was ${status.toLowerCase()}.`);
      res.json({ success: true });
    });
  });
});

app.post('/api/admin/upload-completed', requireAdmin, upload.single('completed_doc'), (req, res) => {
  const { application_id } = req.body;
  if (!req.file) return res.status(400).json({ error: 'File required.' });

  db.run(`INSERT INTO documents (application_id, doc_type, filename, original_name) VALUES (?, 'completed_document', ?, ?)`,
    [application_id, req.file.filename, req.file.originalname],
    function () {
      db.run(`UPDATE applications SET status = 'Completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [application_id]);
      db.run(`INSERT INTO status_history (application_id, status, remarks) VALUES (?, ?, ?)`,
        [application_id, 'Completed', 'Final completed document processed and uploaded.']);

      db.get(`SELECT user_id, tracking_number FROM applications WHERE id = ?`, [application_id], (e, row) => {
        notifyUser(row.user_id, `Your completed official documents for ${row.tracking_number} are ready for download!`);
      });

      res.json({ success: true });
    }
  );
});

app.post('/api/admin/settings', requireAdmin, upload.single('gcash_qr'), (req, res) => {
  const body = req.body;
  if (req.file) {
    body.gcash_qr = req.file.filename;
  }

  Object.keys(body).forEach(key => {
    db.run(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?`, [key, body[key], body[key]]);
  });

  logAudit(req.session.userId, 'Updated System Settings');
  res.json({ success: true });
});

app.get('/api/admin/reports/csv', requireAdmin, (req, res) => {
  db.all(`SELECT a.tracking_number, u.full_name, a.service_type, a.status, a.payment_status, a.created_at 
          FROM applications a JOIN users u ON a.user_id = u.id`, [], (err, rows) => {
    const json2csvParser = new Parser();
    const csv = json2csvParser.parse(rows);
    res.header('Content-Type', 'text/csv');
    res.attachment('government_applications_report.csv');
    return res.send(csv);
  });
});


// ----------------------------------------------------
// FRONTEND MONOLITH HTML UI
// ----------------------------------------------------
app.get('*', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GovAssist - Independent Government Application Assistance Service</title>
  <style>
    :root {
      --primary: #0284c7;
      --primary-dark: #0369a1;
      --secondary: #0f172a;
      --bg: #f8fafc;
      --card-bg: #ffffff;
      --text: #334155;
      --border: #e2e8f0;
      --success: #16a34a;
      --warning: #ca8a04;
      --danger: #dc2626;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: system-ui, -apple-system, sans-serif; }
    body { background-color: var(--bg); color: var(--text); line-height: 1.5; padding-bottom: 60px; }
    
    .disclaimer-banner { background: #fef3c7; color: #92400e; padding: 12px 20px; text-align: center; font-size: 0.875rem; font-weight: 600; border-bottom: 1px solid #fde68a; }
    
    nav { background: var(--secondary); color: white; padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; }
    nav .logo { font-size: 1.25rem; font-weight: bold; color: #38bdf8; display: flex; align-items: center; gap: 8px; }
    nav ul { display: flex; list-style: none; gap: 1rem; align-items: center; }
    nav a { color: #f1f5f9; text-decoration: none; font-size: 0.9rem; cursor: pointer; }
    nav a:hover { color: #38bdf8; }
    
    .container { max-width: 1200px; margin: 2rem auto; padding: 0 1rem; }
    .card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    
    h1, h2, h3 { color: var(--secondary); margin-bottom: 1rem; }
    .btn { background: var(--primary); color: white; border: none; padding: 0.6rem 1.2rem; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.9rem; }
    .btn:hover { background: var(--primary-dark); }
    .btn-secondary { background: #64748b; }
    .btn-danger { background: var(--danger); }
    .btn-sm { padding: 0.3rem 0.6rem; font-size: 0.8rem; }
    
    form .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1rem; }
    .form-group { margin-bottom: 1rem; }
    .form-group label { display: block; font-weight: 600; margin-bottom: 0.4rem; font-size: 0.85rem; }
    .form-group input, .form-group select, .form-group textarea { width: 100%; padding: 0.6rem; border: 1px solid var(--border); border-radius: 6px; }
    
    table { width: 100%; border-collapse: collapse; margin-top: 1rem; font-size: 0.9rem; }
    th, td { border: 1px solid var(--border); padding: 0.75rem; text-align: left; }
    th { background: #f1f5f9; font-weight: 600; }
    
    .badge { padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 700; display: inline-block; }
    .badge-Submitted { background: #e0f2fe; color: #0369a1; }
    .badge-Processing { background: #fef9c3; color: #a16207; }
    .badge-Completed { background: #dcfce7; color: #15803d; }
    .badge-Rejected { background: #fee2e2; color: #b91c1c; }
    
    /* Dynamic UI Hide Rules */
    .view { display: none; }
    .view.active { display: block; }
    
    .progress-tracker { display: flex; justify-content: space-between; margin: 1.5rem 0; position: relative; }
    .progress-step { flex: 1; text-align: center; font-size: 0.8rem; position: relative; }
    .progress-step::before { content: ''; width: 12px; height: 12px; background: #cbd5e1; border-radius: 50%; display: block; margin: 0 auto 4px; }
    .progress-step.active::before { background: var(--primary); }
    
    .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); align-items: center; justify-content: center; z-index: 1000; }
    .modal.active { display: flex; }
    .modal-content { background: white; padding: 2rem; border-radius: 8px; max-width: 600px; width: 90%; max-height: 90vh; overflow-y: auto; }
  </style>
</head>
<body>

  <div class="disclaimer-banner">
    ⚠️ DISCLAIMER: This website is an independent application assistance and processing service. It is NOT an official BIR, SSS, or Pag-IBIG government website.
  </div>

  <nav>
    <div class="logo">🇵🇭 GovAssist Portal</div>
    <ul id="nav-links">
      <li><a onclick="showView('public-track-view')">Track Application</a></li>
      <li><a onclick="showView('login-view')" id="link-login">Login</a></li>
      <li><a onclick="showView('register-view')" id="link-register">Register</a></li>
    </ul>
  </nav>

  <div class="container">

    <div id="public-track-view" class="view active">
      <div class="card" style="max-width: 600px; margin: 0 auto;">
        <h2>Track Application Status</h2>
        <p style="font-size: 0.85rem; color: #64748b; margin-bottom: 1rem;">Enter your official tracking reference code to verify real-time processing status.</p>
        <div class="form-group">
          <input type="text" id="public-tracking-input" placeholder="e.g. TIN-20260901-0001">
        </div>
        <button class="btn" onclick="trackPublicApplication()">Search Status</button>
        <div id="public-track-result" style="margin-top: 1.5rem;"></div>
      </div>
    </div>

    <div id="login-view" class="view">
      <div class="card" style="max-width: 400px; margin: 0 auto;">
        <h2>Sign In</h2>
        <form onsubmit="handleLogin(event)">
          <div class="form-group">
            <label>Username</label>
            <input type="text" id="login-username" required>
          </div>
          <div class="form-group">
            <label>Password</label>
            <input type="password" id="login-password" required>
          </div>
          <button class="btn" type="submit" style="width:100%">Login</button>
        </form>
      </div>
    </div>

    <div id="register-view" class="view">
      <div class="card" style="max-width: 500px; margin: 0 auto;">
        <h2>Create Account</h2>
        <form onsubmit="handleRegister(event)">
          <div class="form-group">
            <label>Full Name</label>
            <input type="text" id="reg-fullname" required>
          </div>
          <div class="form-group">
            <label>Username</label>
            <input type="text" id="reg-username" required>
          </div>
          <div class="form-group">
            <label>Email Address</label>
            <input type="email" id="reg-email" required>
          </div>
          <div class="form-group">
            <label>Mobile Number</label>
            <input type="tel" id="reg-mobile" placeholder="09171234567" required>
          </div>
          <div class="form-group">
            <label>Password</label>
            <input type="password" id="reg-password" required>
          </div>
          <button class="btn" type="submit" style="width:100%">Register Account</button>
        </form>
      </div>
    </div>

    <div id="customer-dashboard-view" class="view">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 1rem;">
        <h2>Customer Portal</h2>
        <button class="btn" onclick="showView('new-app-view')">+ New Assistance Request</button>
      </div>

      <div class="grid" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
        <div class="card"><h3 id="cust-stat-total">0</h3><p>Total Applications</p></div>
        <div class="card"><h3 id="cust-stat-pending">0</h3><p>Pending Actions</p></div>
        <div class="card"><h3 id="cust-stat-completed">0</h3><p>Completed Documents</p></div>
      </div>

      <div class="card">
        <h3>My Applications</h3>
        <table>
          <thead>
            <tr>
              <th>Tracking Number</th>
              <th>Service</th>
              <th>Status</th>
              <th>Payment</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody id="customer-apps-table"></tbody>
        </table>
      </div>

      <div class="card">
        <h3>Notifications</h3>
        <ul id="customer-notif-list" style="list-style:none;"></ul>
      </div>
    </div>

    <div id="new-app-view" class="view">
      <div class="card">
        <h2>Government Service Assistance Request</h2>
        <form id="app-form" onsubmit="submitApplication(event)">
          
          <div class="form-group">
            <label>Select Assistance Service</label>
            <select id="app-service" onchange="renderServiceFields()" required>
              <option value="">-- Choose Service --</option>
              <option value="BIR / TIN Registration">BIR / TIN Application</option>
              <option value="SSS Assistance">SSS Assistance</option>
              <option value="Pag-IBIG Application">Pag-IBIG Application</option>
            </select>
          </div>

          <div class="grid">
            <div class="form-group"><label>First Name</label><input type="text" name="first_name" required></div>
            <div class="form-group"><label>Middle Name</label><input type="text" name="middle_name"></div>
            <div class="form-group"><label>Last Name</label><input type="text" name="last_name" required></div>
            <div class="form-group"><label>Suffix</label><input type="text" name="suffix" placeholder="Jr/Sr/III"></div>
          </div>

          <div class="grid">
            <div class="form-group"><label>Date of Birth</label><input type="date" name="dob" required></div>
            <div class="form-group"><label>Place of Birth</label><input type="text" name="pob" required></div>
            <div class="form-group">
              <label>Sex</label>
              <select name="sex" required><option value="Male">Male</option><option value="Female">Female</option></select>
            </div>
            <div class="form-group"><label>Civil Status</label><input type="text" name="civil_status" required></div>
          </div>

          <div class="grid">
            <div class="form-group"><label>Barangay</label><input type="text" name="barangay" required></div>
            <div class="form-group"><label>City / Municipality</label><input type="text" name="city" required></div>
            <div class="form-group"><label>Province</label><input type="text" name="province" required></div>
            <div class="form-group"><label>ZIP Code</label><input type="text" name="zip" required></div>
          </div>

          <div class="grid">
            <div class="form-group"><label>Mother's Maiden Name</label><input type="text" name="mother_maiden" required></div>
            <div class="form-group"><label>Father's Name</label><input type="text" name="father_name" required></div>
          </div>

          <div id="dynamic-service-fields"></div>

          <h3 style="margin-top: 1.5rem;">Document Uploads</h3>
          <p style="font-size: 0.8rem; color: #64748b; margin-bottom: 1rem;">Accepted: JPG, PNG, PDF (Max 5MB each)</p>
          
          <div class="grid">
            <div class="form-group">
              <label>Valid Government ID *</label>
              <input type="file" name="valid_id" accept=".jpg,.jpeg,.png,.pdf" required>
            </div>
            <div class="form-group">
              <label>Selfie Holding Valid ID *</label>
              <input type="file" name="holding_id" accept=".jpg,.jpeg,.png,.pdf" required>
            </div>
            <div class="form-group">
              <label>2x2 / ID Photo *</label>
              <input type="file" name="id_photo" accept=".jpg,.jpeg,.png,.pdf" required>
            </div>
            <div class="form-group">
              <label>Additional Supporting Document</label>
              <input type="file" name="extra_doc" accept=".jpg,.jpeg,.png,.pdf">
            </div>
          </div>

          <button class="btn" type="submit" style="margin-top: 1rem;">Review & Submit Application</button>
        </form>
      </div>
    </div>

    <div id="app-detail-view" class="view">
      <div class="card" id="app-detail-card"></div>
    </div>

    <div id="admin-dashboard-view" class="view">
      <h2>Admin Processing Center</h2>
      <div class="grid" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
        <div class="card"><h3 id="adm-stat-cust">0</h3><p>Customers</p></div>
        <div class="card"><h3 id="adm-stat-apps">0</h3><p>Applications</p></div>
        <div class="card"><h3 id="adm-stat-proc">0</h3><p>Processing</p></div>
        <div class="card"><h3 id="adm-stat-comp">0</h3><p>Completed</p></div>
        <div class="card"><h3 id="adm-stat-rev">₱0</h3><p>Revenue</p></div>
      </div>

      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <h3>Application Directory</h3>
          <button class="btn btn-secondary btn-sm" onclick="downloadCsvReport()">Export CSV Report</button>
        </div>
        <table>
          <thead>
            <tr>
              <th>Applicant</th>
              <th>Tracking Number</th>
              <th>Service</th>
              <th>Payment</th>
              <th>Status</th>
              <th>Submitted</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody id="admin-apps-table"></tbody>
        </table>
      </div>

      <div class="card">
        <h3>System Settings Configuration</h3>
        <form onsubmit="saveSettings(event)" id="admin-settings-form">
          <div class="grid">
            <div class="form-group"><label>GCash Number</label><input type="text" id="set-gcash-num" name="gcash_number"></div>
            <div class="form-group"><label>GCash Account Name</label><input type="text" id="set-gcash-name" name="gcash_name"></div>
            <div class="form-group"><label>BIR Service Fee (₱)</label><input type="number" id="set-fee-bir" name="fee_bir"></div>
            <div class="form-group"><label>SSS Service Fee (₱)</label><input type="number" id="set-fee-sss" name="fee_sss"></div>
            <div class="form-group"><label>Pag-IBIG Service Fee (₱)</label><input type="number" id="set-fee-pagibig" name="fee_pagibig"></div>
            <div class="form-group"><label>Upload GCash QR Code</label><input type="file" name="gcash_qr"></div>
          </div>
          <button class="btn" type="submit">Update System Settings</button>
        </form>
      </div>
    </div>

  </div>

  <div class="modal" id="admin-action-modal">
    <div class="modal-content">
      <h3>Manage Application Process</h3>
      <div id="modal-app-info" style="margin: 1rem 0;"></div>
      
      <div class="form-group">
        <label>Update Status</label>
        <select id="modal-status-select">
          <option value="Under Review">Under Review</option>
          <option value="Need Correction">Need Correction</option>
          <option value="Processing">Processing</option>
          <option value="Ready">Ready</option>
          <option value="Completed">Completed</option>
          <option value="Rejected">Rejected</option>
        </select>
      </div>

      <div class="form-group">
        <label>Remarks / Instructions</label>
        <textarea id="modal-remarks" rows="3"></textarea>
      </div>
      <button class="btn" onclick="submitStatusUpdate()">Update Status</button>

      <hr style="margin: 1.5rem 0;">

      <h4>Upload Official Processed Document</h4>
      <form onsubmit="submitCompletedDoc(event)" style="margin-top: 0.5rem;">
        <input type="file" id="modal-completed-file" required>
        <button class="btn btn-secondary" type="submit" style="margin-top: 0.5rem;">Upload & Complete</button>
      </form>

      <button class="btn btn-secondary btn-sm" style="margin-top: 1.5rem;" onclick="closeModal()">Close</button>
    </div>
  </div>

  <script>
    let currentUser = null;
    let selectedAppId = null;

    async function initApp() {
      const res = await fetch('/api/me');
      const data = await res.json();
      if (data.loggedIn) {
        currentUser = data.user;
        updateNav(true);
        if (currentUser.role === 'admin') {
          showView('admin-dashboard-view');
          loadAdminDashboard();
        } else {
          showView('customer-dashboard-view');
          loadCustomerDashboard();
        }
      } else {
        updateNav(false);
        showView('public-track-view');
      }
    }

    function updateNav(loggedIn) {
      const navLinks = document.getElementById('nav-links');
      if (loggedIn) {
        navLinks.innerHTML = \`
          <li><a onclick="showView('public-track-view')">Track Application</a></li>
          \${currentUser.role === 'admin' ? '<li><a onclick="showView(\\'admin-dashboard-view\\'); loadAdminDashboard();">Admin Center</a></li>' : '<li><a onclick="showView(\\'customer-dashboard-view\\'); loadCustomerDashboard();">My Portal</a></li>'}
          <li><a onclick="handleLogout()">Logout (\${currentUser.full_name})</a></li>
        \`;
      } else {
        navLinks.innerHTML = \`
          <li><a onclick="showView('public-track-view')">Track Application</a></li>
          <li><a onclick="showView('login-view')">Login</a></li>
          <li><a onclick="showView('register-view')">Register</a></li>
        \`;
      }
    }

    function showView(viewId) {
      document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
      document.getElementById(viewId).classList.add('active');
    }

    // Dynamic Fields rendering
    function renderServiceFields() {
      const service = document.getElementById('app-service').value;
      const target = document.getElementById('dynamic-service-fields');
      if (service.includes('BIR')) {
        target.innerHTML = \`
          <h4 style="margin-top:1rem;">BIR/TIN Required Details</h4>
          <div class="grid">
            <div class="form-group"><label>Taxpayer Type</label><select name="taxpayer_type"><option>Individual / Employee</option><option>Self-Employed / Business</option></select></div>
            <div class="form-group"><label>Employer TIN (If Employed)</label><input type="text" name="employer_tin"></div>
          </div>
        \`;
      } else if (service.includes('SSS')) {
        target.innerHTML = \`
          <h4 style="margin-top:1rem;">SSS Required Details</h4>
          <div class="grid">
            <div class="form-group"><label>Membership Type</label><select name="sss_type"><option>Voluntary / Non-Working Spouse</option><option>OFW</option><option>Employed</option></select></div>
            <div class="form-group"><label>Monthly Income Estimate</label><input type="number" name="monthly_income"></div>
          </div>
        \`;
      } else if (service.includes('Pag-IBIG')) {
        target.innerHTML = \`
          <h4 style="margin-top:1rem;">Pag-IBIG Required Details</h4>
          <div class="grid">
            <div class="form-group"><label>Occupation Status</label><input type="text" name="occupation_status" placeholder="Private / Gov / OFW"></div>
            <div class="form-group"><label>Desired Monthly Contribution</label><input type="number" name="pagibig_contribution" value="200"></div>
          </div>
        \`;
      } else {
        target.innerHTML = '';
      }
    }

    // Authentication Handlers
    async function handleLogin(e) {
      e.preventDefault();
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: document.getElementById('login-username').value,
          password: document.getElementById('login-password').value
        })
      });
      const data = await res.json();
      if (data.success) {
        initApp();
      } else alert(data.error);
    }

    async function handleRegister(e) {
      e.preventDefault();
      const body = {
        full_name: document.getElementById('reg-fullname').value,
        username: document.getElementById('reg-username').value,
        email: document.getElementById('reg-email').value,
        mobile: document.getElementById('reg-mobile').value,
        password: document.getElementById('reg-password').value,
      };
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (data.success) {
        alert('Account created! Please sign in.');
        showView('login-view');
      } else alert(data.error);
    }

    async function handleLogout() {
      await fetch('/api/logout', { method: 'POST' });
      currentUser = null;
      initApp();
    }

    // Public Tracking
    async function trackPublicApplication() {
      const tracking = document.getElementById('public-tracking-input').value.trim();
      const res = await fetch('/api/public-track/' + tracking);
      const data = await res.json();
      const target = document.getElementById('public-track-result');
      if (res.ok) {
        target.innerHTML = \`
          <div style="background:#f1f5f9; padding:1rem; border-radius:6px;">
            <p><strong>Tracking Number:</strong> \${data.tracking_number}</p>
            <p><strong>Service:</strong> \${data.service_type}</p>
            <p><strong>Status:</strong> <span class="badge badge-\${data.status}">\${data.status}</span></p>
            <p><strong>Submitted On:</strong> \${new Date(data.created_at).toLocaleString()}</p>
            <p><strong>Remarks:</strong> \${data.admin_remarks || 'None'}</p>
          </div>
        \`;
      } else {
        target.innerHTML = \`<p style="color:red;">\${data.error}</p>\`;
      }
    }

    // Application Submission
    async function submitApplication(e) {
      e.preventDefault();
      const formData = new FormData(document.getElementById('app-form'));
      formData.append('service_type', document.getElementById('app-service').value);

      const res = await fetch('/api/applications', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.success) {
        alert('Application submitted successfully! Tracking Number: ' + data.trackingNumber);
        showView('customer-dashboard-view');
        loadCustomerDashboard();
      } else alert(data.error);
    }

    // Load Customer Dashboard
    async function loadCustomerDashboard() {
      const res = await fetch('/api/my-applications');
      const apps = await res.json();
      
      document.getElementById('cust-stat-total').innerText = apps.length;
      document.getElementById('cust-stat-pending').innerText = apps.filter(a => a.status !== 'Completed').length;
      document.getElementById('cust-stat-completed').innerText = apps.filter(a => a.status === 'Completed').length;

      const tbody = document.getElementById('customer-apps-table');
      tbody.innerHTML = apps.map(a => \`
        <tr>
          <td><strong>\${a.tracking_number}</strong></td>
          <td>\${a.service_type}</td>
          <td><span class="badge badge-\${a.status}">\${a.status}</span></td>
          <td>\${a.payment_status}</td>
          <td><button class="btn btn-sm" onclick="viewApplicationDetail(\${a.id})">Manage</button></td>
        </tr>
      \`).join('');

      const nRes = await fetch('/api/notifications');
      const notifs = await nRes.json();
      document.getElementById('customer-notif-list').innerHTML = notifs.map(n => \`
        <li style="padding: 0.5rem 0; border-bottom: 1px solid var(--border); font-size: 0.85rem;">
          \${n.message} <span style="color:#94a3b8; font-size:0.75rem;">(\${new Date(n.created_at).toLocaleDateString()})</span>
        </li>
      \`).join('');
    }

    // View Application Detail Page
    async function viewApplicationDetail(appId) {
      selectedAppId = appId;
      const res = await fetch('/api/applications/' + appId);
      const data = await res.json();
      const settingsRes = await fetch('/api/settings');
      const settings = await settingsRes.json();

      const app = data.application;
      const docs = data.documents;
      const history = data.history;

      let fee = settings.fee_other;
      if (app.service_type.includes('TIN')) fee = settings.fee_bir;
      if (app.service_type.includes('SSS')) fee = settings.fee_sss;
      if (app.service_type.includes('PAG')) fee = settings.fee_pagibig;

      const card = document.getElementById('app-detail-card');
      card.innerHTML = \`
        <button class="btn btn-secondary btn-sm" onclick="showView(currentUser.role === 'admin' ? 'admin-dashboard-view' : 'customer-dashboard-view')">&larr; Back</button>
        <h2 style="margin-top: 1rem;">Tracking Code: \${app.tracking_number}</h2>
        <p><strong>Service:</strong> \${app.service_type} | <strong>Current Status:</strong> <span class="badge badge-\${app.status}">\${app.status}</span></p>

        <hr style="margin: 1rem 0;">

        <h3>Payment Information</h3>
        <p>Service Fee: <strong>₱\${fee}</strong> | Status: <strong>\${app.payment_status}</strong></p>
        
        \${app.payment_status !== 'Paid' ? \`
          <div style="background: #f8fafc; padding: 1rem; border: 1px solid var(--border); border-radius: 6px; margin-top: 1rem;">
            <h4>GCash Payment Instructions</h4>
            <p>Send ₱\${fee} to GCash Number: <strong>\${settings.gcash_number}</strong> (\${settings.gcash_name})</p>
            <form onsubmit="submitPayment(event, \${app.id}, \${fee})" style="margin-top: 1rem;">
              <div class="grid">
                <div class="form-group"><label>GCash Ref Number</label><input type="text" id="pay-ref" required></div>
                <div class="form-group"><label>Proof Screenshot</label><input type="file" id="pay-proof" accept=".jpg,.jpeg,.png,.pdf"></div>
              </div>
              <button class="btn" type="submit">Submit Payment Proof</button>
            </form>
          </div>
        \` : '<p style="color:var(--success); font-weight:bold; margin-top:0.5rem;">✓ Payment Verified</p>'}

        <hr style="margin: 1rem 0;">

        <h3>Uploaded Documents</h3>
        <ul style="margin-bottom: 1rem;">
          \${docs.map(d => \`
            <li>
              \${d.doc_type.toUpperCase()}: <a href="/api/documents/file/\${d.filename}" target="_blank">\${d.original_name}</a>
            </li>
          \`).join('')}
        </ul>

        <hr style="margin: 1rem 0;">

        <h3>Application History Timeline</h3>
        <ul style="font-size: 0.85rem;">
          \${history.map(h => \`
            <li><strong>\${new Date(h.created_at).toLocaleString()}</strong> - \${h.status}: \${h.remarks || ''}</li>
          \`).join('')}
        </ul>
      \`;

      showView('app-detail-view');
    }

    async function submitPayment(e, appId, amount) {
      e.preventDefault();
      const formData = new FormData();
      formData.append('application_id', appId);
      formData.append('payment_method', 'GCASH');
      formData.append('amount', amount);
      formData.append('reference_number', document.getElementById('pay-ref').value);
      if (document.getElementById('pay-proof').files[0]) {
        formData.append('payment_proof', document.getElementById('pay-proof').files[0]);
      }

      const res = await fetch('/api/payments', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        alert('Payment uploaded! Awaiting verification.');
        viewApplicationDetail(appId);
      } else alert(data.error);
    }

    // Admin Dashboard Logic
    async function loadAdminDashboard() {
      const res = await fetch('/api/admin/dashboard');
      const stats = await res.json();

      document.getElementById('adm-stat-cust').innerText = stats.totalCustomers;
      document.getElementById('adm-stat-apps').innerText = stats.totalApps;
      document.getElementById('adm-stat-proc').innerText = stats.processingApps;
      document.getElementById('adm-stat-comp').innerText = stats.completedApps;
      document.getElementById('adm-stat-rev').innerText = '₱' + stats.totalRevenue;

      const appRes = await fetch('/api/admin/applications');
      const apps = await appRes.json();

      const tbody = document.getElementById('admin-apps-table');
      tbody.innerHTML = apps.map(a => \`
        <tr>
          <td>\${a.applicant_name}</td>
          <td><strong>\${a.tracking_number}</strong></td>
          <td>\${a.service_type}</td>
          <td>\${a.payment_status}</td>
          <td><span class="badge badge-\${a.status}">\${a.status}</span></td>
          <td>\${new Date(a.created_at).toLocaleDateString()}</td>
          <td>
            <button class="btn btn-sm" onclick="viewApplicationDetail(\${a.id})">View</button>
            <button class="btn btn-sm btn-secondary" onclick="openAdminModal(\${a.id}, '\${a.tracking_number}')">Manage</button>
          </td>
        </tr>
      \`).join('');

      const setRes = await fetch('/api/settings');
      const set = await setRes.json();
      document.getElementById('set-gcash-num').value = set.gcash_number || '';
      document.getElementById('set-gcash-name').value = set.gcash_name || '';
      document.getElementById('set-fee-bir').value = set.fee_bir || '';
      document.getElementById('set-fee-sss').value = set.fee_sss || '';
      document.getElementById('set-fee-pagibig').value = set.fee_pagibig || '';
    }

    function openAdminModal(id, tracking) {
      selectedAppId = id;
      document.getElementById('modal-app-info').innerText = 'Managing Application: ' + tracking;
      document.getElementById('admin-action-modal').classList.add('active');
    }

    function closeModal() {
      document.getElementById('admin-action-modal').classList.remove('active');
    }

    async function submitStatusUpdate() {
      const status = document.getElementById('modal-status-select').value;
      const remarks = document.getElementById('modal-remarks').value;

      const res = await fetch('/api/admin/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ application_id: selectedAppId, status, remarks })
      });
      if (res.ok) {
        alert('Status updated.');
        closeModal();
        loadAdminDashboard();
      }
    }

    async function submitCompletedDoc(e) {
      e.preventDefault();
      const fileInput = document.getElementById('modal-completed-file');
      if (!fileInput.files[0]) return;

      const formData = new FormData();
      formData.append('application_id', selectedAppId);
      formData.append('completed_doc', fileInput.files[0]);

      const res = await fetch('/api/admin/upload-completed', { method: 'POST', body: formData });
      if (res.ok) {
        alert('Final processed document uploaded successfully!');
        closeModal();
        loadAdminDashboard();
      }
    }

    async function saveSettings(e) {
      e.preventDefault();
      const formData = new FormData(document.getElementById('admin-settings-form'));
      const res = await fetch('/api/admin/settings', { method: 'POST', body: formData });
      if (res.ok) alert('Settings saved.');
    }

    function downloadCsvReport() {
      window.location.href = '/api/admin/reports/csv';
    }

    // Global Initialization
    window.onload = initApp;
  </script>
</body>
</html>
  `);
});

// Start Server
app.listen(PORT, () => {
  console.log(`GovAssist processing portal active on port ${PORT}`);
});
