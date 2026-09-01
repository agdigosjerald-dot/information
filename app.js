/**
 * PH GOVERNMENT APPLICATION ASSISTANCE & DOCUMENT MANAGEMENT SYSTEM
 * Supporting BIR/TIN, SSS, and Pag-IBIG Assistance Processing
 * Full-stack implementation containing Backend API, Postgres Persistence, and Embedded Portals.
 */

const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Initialize App
const app = express();
const PORT = process.env.PORT || 3000;

// Database Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Create Persistent Upload Directory
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Storage Engine Setup (Binary Storage in DB Option + File Fallback)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|pdf/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    if (ext && mime) return cb(null, true);
    cb(new Error('Only images (JPG, PNG) and PDFs are allowed!'));
  }
});

// Middleware
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use('/uploads', express.static(UPLOAD_DIR));

// Session Setup
app.use(session({
  store: new PgSession({ pool: pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'ph-gov-assistance-super-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 } // 30 days
}));

// Auth Middlewares
const requireCustomer = (req, res, next) => {
  if (req.session.user && req.session.user.role === 'customer') return next();
  res.redirect('/customer/login');
};

const requireAdmin = (req, res, next) => {
  if (req.session.user && req.session.user.role === 'admin') return next();
  res.redirect('/admin/login');
};

// --- DATABASE INITIALIZATION SCHEMAS ---
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        full_name VARCHAR(255) NOT NULL,
        mobile VARCHAR(50) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        username VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'customer',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS system_settings (
        key VARCHAR(100) PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS applications (
        id SERIAL PRIMARY KEY,
        tracking_number VARCHAR(100) UNIQUE NOT NULL,
        user_id INT REFERENCES users(id) ON DELETE CASCADE,
        service_type VARCHAR(50) NOT NULL,
        status VARCHAR(50) DEFAULT 'Submitted',
        payment_status VARCHAR(50) DEFAULT 'Unpaid',
        payment_method VARCHAR(50),
        payment_ref VARCHAR(100),
        amount_paid NUMERIC(10,2) DEFAULT 0.00,
        fee NUMERIC(10,2) DEFAULT 0.00,
        personal_info JSONB NOT NULL,
        parent_info JSONB,
        spouse_info JSONB,
        employment_info JSONB,
        beneficiaries JSONB,
        customer_remarks TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS documents (
        id SERIAL PRIMARY KEY,
        application_id INT REFERENCES applications(id) ON DELETE CASCADE,
        document_type VARCHAR(100) NOT NULL,
        file_path VARCHAR(255) NOT NULL,
        original_name VARCHAR(255) NOT NULL,
        is_completed_doc BOOLEAN DEFAULT FALSE,
        uploaded_by VARCHAR(20) DEFAULT 'customer',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS status_history (
        id SERIAL PRIMARY KEY,
        application_id INT REFERENCES applications(id) ON DELETE CASCADE,
        previous_status VARCHAR(50),
        new_status VARCHAR(50),
        remarks TEXT,
        changed_by VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS admin_notes (
        id SERIAL PRIMARY KEY,
        application_id INT REFERENCES applications(id) ON DELETE CASCADE,
        note TEXT NOT NULL,
        admin_name VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS application_checklists (
        id SERIAL PRIMARY KEY,
        application_id INT REFERENCES applications(id) ON DELETE CASCADE,
        item_name VARCHAR(255) NOT NULL,
        is_verified BOOLEAN DEFAULT FALSE
      );
    `);

    // Seed Initial Settings
    const defaultSettings = [
      ['business_name', 'PH Application Assistance Center'],
      ['gcash_name', 'OFFICIAL ASSIST'],
      ['gcash_number', '09171234567'],
      ['gcash_qr', '/uploads/default_qr.png'],
      ['fee_tin', '250.00'],
      ['fee_sss', '300.00'],
      ['fee_pagibig', '300.00']
    ];

    for (let [k, v] of defaultSettings) {
      await client.query(`INSERT INTO system_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`, [k, v]);
    }

    // Seed Initial Admin User if none exists
    const adminRes = await client.query(`SELECT * FROM users WHERE role = 'admin'`);
    if (adminRes.rowCount === 0) {
      const adminPass = process.env.ADMIN_INITIAL_PASSWORD || 'AdminSecure2026!';
      const hashed = await bcrypt.hash(adminPass, 10);
      await client.query(
        `INSERT INTO users (full_name, mobile, email, username, password, role) VALUES ($1, $2, $3, $4, $5, $6)`,
        ['System Admin', '09000000000', 'admin@assistance.ph', 'admin', hashed, 'admin']
      );
      console.log('Default Admin Account Created: username "admin"');
    }

  } catch (err) {
    console.error('Database Initialization Error:', err);
  } finally {
    client.release();
  }
}
initDB();

// --- API & ROUTE HANDLING ---

// Global Disclaimer Helper Component
const disclaimerHTML = `
  <div class="alert alert-warning text-center my-3 fs-7" role="alert">
    <strong>IMPORTANT GOVERNMENT DISCLAIMER:</strong> This website is an independent application assistance and document processing/tracking service. It is NOT an official BIR, SSS, or Pag-IBIG government website. We provide administrative preparation and submission support.
  </div>
`;

// Layout Wrapper
function renderPage(title, content, activeUser = null, activeTab = '') {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title}</title>
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css">
      <style>
        body { background-color: #f4f6f9; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
        .navbar-brand { font-weight: 700; letter-spacing: 0.5px; }
        .card { border-radius: 12px; border: none; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
        .btn-primary { background-color: #0d6efd; border-radius: 8px; padding: 10px 20px; font-weight: 600; }
        .form-section { display: none; }
        .form-section.active { display: block; }
        .step-indicator { display: flex; justify-content: space-between; margin-bottom: 25px; }
        .step-item { flex: 1; text-align: center; padding: 10px; font-size: 13px; font-weight: 600; border-bottom: 3px solid #dee2e6; color: #6c757d; }
        .step-item.active { border-color: #0d6efd; color: #0d6efd; }
        .step-item.completed { border-color: #198754; color: #198754; }
        .sidebar { min-height: calc(100vh - 56px); background: #1e293b; color: white; }
        .sidebar a { color: #94a3b8; text-decoration: none; padding: 12px 20px; display: block; font-weight: 500; }
        .sidebar a:hover, .sidebar a.active { background: #0f172a; color: white; border-left: 4px solid #0d6efd; }
        .preview-img { max-width: 100%; max-height: 200px; border-radius: 8px; margin-top: 10px; display: none; }
        @media print { .no-print { display: none !important; } .print-only { display: block !important; } }
      </style>
    </head>
    <body>
      <nav class="navbar navbar-expand-lg navbar-dark bg-primary no-print">
        <div class="container-fluid px-4">
          <a class="navbar-brand" href="/"><i class="bi bi-file-earmark-text-fill me-2"></i>GOV-ASSIST PH</a>
          <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNav">
            <span class="navbar-toggler-icon"></span>
          </button>
          <div class="collapse navbar-collapse" id="navbarNav">
            <ul class="navbar-nav ms-auto align-items-center">
              <li class="nav-item"><a class="nav-link text-white" href="/">Home</a></li>
              <li class="nav-item"><a class="nav-link text-white" href="/track">Track Application</a></li>
              ${activeUser ? `
                <li class="nav-item"><a class="nav-link text-white fw-bold" href="${activeUser.role === 'admin' ? '/admin/dashboard' : '/customer/dashboard'}">Dashboard (${activeUser.username})</a></li>
                <li class="nav-item"><a class="btn btn-outline-light btn-sm ms-2" href="/logout">Logout</a></li>
              ` : `
                <li class="nav-item"><a class="btn btn-outline-light btn-sm ms-2" href="/customer/login">Customer Login</a></li>
                <li class="nav-item"><a class="btn btn-light btn-sm ms-2 fw-bold text-primary" href="/admin/login">Admin Portal</a></li>
              `}
            </ul>
          </div>
        </div>
      </nav>

      <div class="container-fluid">
        ${content}
      </div>

      <footer class="text-center py-4 text-muted border-top mt-5 no-print">
        <div class="container">
          <p class="mb-1">&copy; 2026 Independent Government Application Assistance Portal.</p>
          <small class="text-secondary">Disclaimer: This website is privately operated and is not affiliated with the BIR, SSS, or Pag-IBIG.</small>
        </div>
      </footer>

      <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
    </body>
    </html>
  `;
}

// --- PUBLIC LANDING & TRACKING ROUTES ---

app.get('/', (req, res) => {
  const content = `
    <div class="container py-5">
      ${disclaimerHTML}
      <div class="row align-items-center my-5">
        <div class="col-lg-7">
          <h1 class="display-4 fw-bold text-dark mb-3">Fast & Reliable Government Assistance</h1>
          <p class="lead text-secondary mb-4">We assist you in processing and preparing your official BIR/TIN, SSS, and Pag-IBIG documentation securely with step-by-step assistance and real-time tracking.</p>
          <div class="d-grid gap-3 d-md-flex justify-content-md-start mb-4">
            <a href="/customer/register" class="btn btn-primary btn-lg px-4 me-md-2">Apply Now</a>
            <a href="/track" class="btn btn-outline-secondary btn-lg px-4">Track Existing Request</a>
          </div>
        </div>
        <div class="col-lg-5">
          <div class="card p-4 shadow-sm border-0">
            <h4 class="fw-bold mb-3"><i class="bi bi-shield-check text-primary me-2"></i>Supported Assistance Services</h4>
            <ul class="list-group list-group-flush mb-3">
              <li class="list-group-item d-flex align-items-center"><i class="bi bi-check-circle-fill text-success me-3"></i>BIR / TIN Registration Assistance</li>
              <li class="list-group-item d-flex align-items-center"><i class="bi bi-check-circle-fill text-success me-3"></i>SSS Member Registration & Records</li>
              <li class="list-group-item d-flex align-items-center"><i class="bi bi-check-circle-fill text-success me-3"></i>Pag-IBIG Number Registration</li>
            </ul>
            <a href="/customer/login" class="btn btn-primary w-100 fw-bold">Customer Portal Login</a>
          </div>
        </div>
      </div>
    </div>
  `;
  res.send(renderPage('Home - GOV-ASSIST PH', content, req.session.user));
});

app.get('/track', async (req, res) => {
  const { tracking_number, mobile } = req.query;
  let result = null;
  let error = null;

  if (tracking_number && mobile) {
    try {
      const q = await pool.query(
        `SELECT a.tracking_number, a.service_type, a.status, a.created_at, a.customer_remarks 
         FROM applications a 
         JOIN users u ON a.user_id = u.id 
         WHERE a.tracking_number = $1 AND u.mobile = $2`,
        [tracking_number.trim(), mobile.trim()]
      );
      if (q.rowCount > 0) {
        result = q.rows[0];
      } else {
        error = "No matching application found. Please verify the tracking number and mobile number.";
      }
    } catch (err) {
      error = "Database query error. Please try again.";
    }
  }

  const content = `
    <div class="container py-5" style="max-width: 700px;">
      ${disclaimerHTML}
      <div class="card p-4 shadow-sm">
        <h3 class="fw-bold text-center mb-4"><i class="bi bi-search me-2"></i>Track Application Status</h3>
        <form method="GET" action="/track" class="mb-4">
          <div class="mb-3">
            <label class="form-label fw-semibold">Tracking Number</label>
            <input type="text" name="tracking_number" class="form-control form-control-lg" placeholder="e.g. TIN-20260901-1234" value="${tracking_number || ''}" required>
          </div>
          <div class="mb-3">
            <label class="form-label fw-semibold">Registered Mobile Number</label>
            <input type="text" name="mobile" class="form-control form-control-lg" placeholder="09123456789" value="${mobile || ''}" required>
          </div>
          <button type="submit" class="btn btn-primary btn-lg w-100">Search Status</button>
        </form>

        ${error ? `<div class="alert alert-danger">${error}</div>` : ''}

        ${result ? `
          <div class="border rounded p-3 bg-light mt-3">
            <h5 class="fw-bold text-primary mb-3">Application Tracking Found</h5>
            <p><strong>Service Type:</strong> ${result.service_type.toUpperCase()}</p>
            <p><strong>Tracking Number:</strong> ${result.tracking_number}</p>
            <p><strong>Date Submitted:</strong> ${new Date(result.created_at).toLocaleDateString()}</p>
            <p><strong>Current Status:</strong> <span class="badge bg-info text-dark">${result.status}</span></p>
            ${result.customer_remarks ? `<div class="alert alert-secondary mt-2"><strong>Admin Remarks:</strong> ${result.customer_remarks}</div>` : ''}
            
            <div class="mt-4">
              <h6>Progress Tracker</h6>
              <div class="progress" style="height: 25px;">
                <div class="progress-bar ${result.status === 'Completed' ? 'bg-success' : 'bg-primary progress-bar-striped progress-bar-animated'}" 
                     role="progressbar" 
                     style="width: ${
                       result.status === 'Submitted' ? '20%' :
                       result.status === 'Under Review' ? '40%' :
                       result.status === 'Processing' ? '70%' :
                       result.status === 'Ready' ? '90%' :
                       result.status === 'Completed' ? '100%' : '30%'
                     };">
                  ${result.status}
                </div>
              </div>
            </div>
          </div>
        ` : ''}
      </div>
    </div>
  `;
  res.send(renderPage('Track Application', content, req.session.user));
});

// --- CUSTOMER PORTAL & AUTH ---

app.get('/customer/login', (req, res) => {
  const content = `
    <div class="container py-5" style="max-width: 450px;">
      <div class="card p-4 shadow-sm">
        <h3 class="fw-bold text-center mb-3">Customer Login</h3>
        <p class="text-muted text-center mb-4">Manage your government applications</p>
        <form action="/api/login" method="POST">
          <input type="hidden" name="role" value="customer">
          <div class="mb-3">
            <label class="form-label fw-semibold">Username or Email</label>
            <input type="text" name="username" class="form-control form-control-lg" required>
          </div>
          <div class="mb-3">
            <label class="form-label fw-semibold">Password</label>
            <input type="password" name="password" class="form-control form-control-lg" required>
          </div>
          <button type="submit" class="btn btn-primary btn-lg w-100 mb-3">Sign In</button>
        </form>
        <div class="text-center">
          <p class="mb-0">Don't have an account? <a href="/customer/register" class="fw-bold">Register Here</a></p>
        </div>
      </div>
    </div>
  `;
  res.send(renderPage('Customer Login', content));
});

app.get('/customer/register', (req, res) => {
  const content = `
    <div class="container py-5" style="max-width: 550px;">
      <div class="card p-4 shadow-sm">
        <h3 class="fw-bold text-center mb-3">Create Customer Account</h3>
        <form action="/api/register" method="POST">
          <div class="mb-3">
            <label class="form-label fw-semibold">Full Name</label>
            <input type="text" name="full_name" class="form-control" required placeholder="e.g. Juan Dela Cruz">
          </div>
          <div class="row">
            <div class="col-md-6 mb-3">
              <label class="form-label fw-semibold">Mobile Number</label>
              <input type="text" name="mobile" class="form-control" required placeholder="09123456789">
            </div>
            <div class="col-md-6 mb-3">
              <label class="form-label fw-semibold">Email Address</label>
              <input type="email" name="email" class="form-control" required placeholder="name@domain.com">
            </div>
          </div>
          <div class="mb-3">
            <label class="form-label fw-semibold">Username</label>
            <input type="text" name="username" class="form-control" required>
          </div>
          <div class="row">
            <div class="col-md-6 mb-3">
              <label class="form-label fw-semibold">Password</label>
              <input type="password" name="password" class="form-control" required>
            </div>
            <div class="col-md-6 mb-3">
              <label class="form-label fw-semibold">Confirm Password</label>
              <input type="password" name="confirm_password" class="form-control" required>
            </div>
          </div>
          <button type="submit" class="btn btn-primary btn-lg w-100 mb-3">Register Account</button>
        </form>
        <div class="text-center">
          <p class="mb-0">Already registered? <a href="/customer/login" class="fw-bold">Login Here</a></p>
        </div>
      </div>
    </div>
  `;
  res.send(renderPage('Customer Register', content));
});

app.get('/customer/dashboard', requireCustomer, async (req, res) => {
  const client = await pool.connect();
  try {
    const apps = await client.query(`SELECT * FROM applications WHERE user_id = $1 ORDER BY created_at DESC`, [req.session.user.id]);
    const notifs = await client.query(`SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5`, [req.session.user.id]);

    let listHtml = apps.rows.map(app => `
      <tr>
        <td><strong>${app.tracking_number}</strong></td>
        <td><span class="badge bg-secondary">${app.service_type.toUpperCase()}</span></td>
        <td>${new Date(app.created_at).toLocaleDateString()}</td>
        <td><span class="badge bg-info text-dark">${app.status}</span></td>
        <td><span class="badge ${app.payment_status === 'Paid' ? 'bg-success' : 'bg-warning text-dark'}">${app.payment_status}</span></td>
        <td><a href="/customer/application/${app.id}" class="btn btn-sm btn-outline-primary">View & Manage</a></td>
      </tr>
    `).join('');

    let content = `
      <div class="container py-4">
        ${disclaimerHTML}
        <div class="d-flex justify-content-between align-items-center mb-4">
          <h2>Welcome, ${req.session.user.full_name}!</h2>
          <a href="/customer/apply" class="btn btn-primary btn-lg"><i class="bi bi-plus-circle me-2"></i>New Application</a>
        </div>

        ${notifs.rows.length > 0 ? `
          <div class="card p-3 mb-4 bg-light">
            <h6 class="fw-bold"><i class="bi bi-bell-fill text-warning me-2"></i>Recent Notifications</h6>
            <ul class="list-unstyled mb-0">
              ${notifs.rows.map(n => `<li class="border-bottom py-1"><small class="text-muted">${new Date(n.created_at).toLocaleTimeString()}</small> - ${n.message}</li>`).join('')}
            </ul>
          </div>
        ` : ''}

        <div class="card p-4">
          <h4 class="fw-bold mb-3">Your Applications</h4>
          <div class="table-responsive">
            <table class="table table-hover align-middle">
              <thead>
                <tr>
                  <th>Tracking #</th>
                  <th>Service</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th>Payment</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                ${listHtml.length > 0 ? listHtml : '<tr><td colspan="6" class="text-center py-4 text-muted">No applications found. Click "New Application" to start.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
    res.send(renderPage('Customer Dashboard', content, req.session.user));
  } finally {
    client.release();
  }
});

// --- STEP-BY-STEP APPLICATION FORM ENGINE ---

app.get('/customer/apply', requireCustomer, async (req, res) => {
  const client = await pool.connect();
  let fees = { tin: '250.00', sss: '300.00', pagibig: '300.00', gcash_num: '', gcash_name: '', gcash_qr: '' };
  try {
    const s = await client.query(`SELECT * FROM system_settings`);
    s.rows.forEach(r => {
      if (r.key === 'fee_tin') fees.tin = r.value;
      if (r.key === 'fee_sss') fees.sss = r.value;
      if (r.key === 'fee_pagibig') fees.pagibig = r.value;
      if (r.key === 'gcash_number') fees.gcash_num = r.value;
      if (r.key === 'gcash_name') fees.gcash_name = r.value;
      if (r.key === 'gcash_qr') fees.gcash_qr = r.value;
    });
  } finally {
    client.release();
  }

  const content = `
    <div class="container py-4" style="max-width: 900px;">
      ${disclaimerHTML}
      <div class="card p-4">
        <h3 class="fw-bold text-center mb-4">Application Assistance Request</h3>

        <div class="step-indicator no-print">
          <div class="step-item active" id="ind-1">1. Service</div>
          <div class="step-item" id="ind-2">2. Personal</div>
          <div class="step-item" id="ind-3">3. Parents</div>
          <div class="step-item" id="ind-4">4. Spouse/Family</div>
          <div class="step-item" id="ind-5">5. Documents</div>
          <div class="step-item" id="ind-6">6. Payment</div>
          <div class="step-item" id="ind-7">7. Review</div>
        </div>

        <form id="multiStepForm" action="/api/applications/submit" method="POST" enctype="multipart/form-data">
          
          <div class="form-section active" id="sec-1">
            <h5 class="fw-bold mb-3">Select Government Assistance Service</h5>
            <div class="row g-3">
              <div class="col-md-4">
                <div class="card p-3 border text-center service-card">
                  <input type="radio" name="service_type" value="tin" id="srv_tin" class="btn-check" checked onchange="updateFee()">
                  <label class="btn btn-outline-primary w-100 py-3" for="srv_tin">
                    <i class="bi bi-file-person fs-1 d-block mb-2"></i>
                    <strong>BIR / TIN Assistance</strong>
                    <div class="mt-2 text-dark">Fee: ₱<span id="fee-display-tin">${fees.tin}</span></div>
                  </label>
                </div>
              </div>
              <div class="col-md-4">
                <div class="card p-3 border text-center service-card">
                  <input type="radio" name="service_type" value="sss" id="srv_sss" class="btn-check" onchange="updateFee()">
                  <label class="btn btn-outline-primary w-100 py-3" for="srv_sss">
                    <i class="bi bi-shield-lock fs-1 d-block mb-2"></i>
                    <strong>SSS Assistance</strong>
                    <div class="mt-2 text-dark">Fee: ₱<span id="fee-display-sss">${fees.sss}</span></div>
                  </label>
                </div>
              </div>
              <div class="col-md-4">
                <div class="card p-3 border text-center service-card">
                  <input type="radio" name="service_type" value="pagibig" id="srv_pagibig" class="btn-check" onchange="updateFee()">
                  <label class="btn btn-outline-primary w-100 py-3" for="srv_pagibig">
                    <i class="bi bi-house-door fs-1 d-block mb-2"></i>
                    <strong>Pag-IBIG Assistance</strong>
                    <div class="mt-2 text-dark">Fee: ₱<span id="fee-display-pagibig">${fees.pagibig}</span></div>
                  </label>
                </div>
              </div>
            </div>
            <button type="button" class="btn btn-primary mt-4 float-end" onclick="nextStep(2)">Next: Personal Info</button>
          </div>

          <div class="form-section" id="sec-2">
            <h5 class="fw-bold mb-3">Personal Details</h5>
            <div class="row g-3">
              <div class="col-md-3"><label class="form-label">First Name *</label><input type="text" name="first_name" class="form-control" required></div>
              <div class="col-md-3"><label class="form-label">Middle Name</label><input type="text" name="middle_name" class="form-control"></div>
              <div class="col-md-3"><label class="form-label">Last Name *</label><input type="text" name="last_name" class="form-control" required></div>
              <div class="col-md-3"><label class="form-label">Suffix</label><input type="text" name="suffix" class="form-control" placeholder="e.g. Jr., III"></div>
              <div class="col-md-4"><label class="form-label">Date of Birth *</label><input type="date" name="dob" class="form-control" required></div>
              <div class="col-md-4"><label class="form-label">Place of Birth *</label><input type="text" name="pob" class="form-control" required></div>
              <div class="col-md-4">
                <label class="form-label">Sex *</label>
                <select name="sex" class="form-select" required>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </select>
              </div>
              <div class="col-md-4">
                <label class="form-label">Civil Status *</label>
                <select name="civil_status" id="civil_status" class="form-select" onchange="toggleSpouseSection()" required>
                  <option value="Single">Single</option>
                  <option value="Married">Married</option>
                  <option value="Widowed">Widowed</option>
                  <option value="Separated">Separated</option>
                </select>
              </div>
              <div class="col-md-4"><label class="form-label">Mobile Number *</label><input type="text" name="mobile" class="form-control" value="${req.session.user.mobile}" required></div>
              <div class="col-md-4"><label class="form-label">Email Address *</label><input type="email" name="email" class="form-control" value="${req.session.user.email}" required></div>
              <div class="col-12"><label class="form-label">Street Address *</label><input type="text" name="address" class="form-control" required></div>
              <div class="col-md-4"><label class="form-label">Barangay *</label><input type="text" name="barangay" class="form-control" required></div>
              <div class="col-md-4"><label class="form-label">City/Municipality *</label><input type="text" name="city" class="form-control" required></div>
              <div class="col-md-4"><label class="form-label">Province / ZIP Code *</label><input type="text" name="province_zip" class="form-control" required></div>
            </div>
            <div class="mt-4 d-flex justify-content-between">
              <button type="button" class="btn btn-secondary" onclick="nextStep(1)">Back</button>
              <button type="button" class="btn btn-primary" onclick="nextStep(3)">Next: Parents Info</button>
            </div>
          </div>

          <div class="form-section" id="sec-3">
            <h5 class="fw-bold mb-3">Parent Information (Required for SSS/Pag-IBIG/BIR)</h5>
            <h6 class="text-primary mt-3">Father's Information</h6>
            <div class="row g-3">
              <div class="col-md-4"><label class="form-label">Father's First Name</label><input type="text" name="father_first" class="form-control"></div>
              <div class="col-md-4"><label class="form-label">Father's Middle Name</label><input type="text" name="father_middle" class="form-control"></div>
              <div class="col-md-4"><label class="form-label">Father's Last Name</label><input type="text" name="father_last" class="form-control"></div>
              <div class="col-md-6"><label class="form-label">Father's Date of Birth</label><input type="date" name="father_dob" class="form-control"></div>
            </div>
            <h6 class="text-primary mt-4">Mother's Information (Maiden Name)</h6>
            <div class="row g-3">
              <div class="col-md-4"><label class="form-label">Mother's First Name</label><input type="text" name="mother_first" class="form-control"></div>
              <div class="col-md-4"><label class="form-label">Mother's Maiden Middle Name</label><input type="text" name="mother_middle" class="form-control"></div>
              <div class="col-md-4"><label class="form-label">Mother's Maiden Last Name</label><input type="text" name="mother_last" class="form-control"></div>
              <div class="col-md-6"><label class="form-label">Mother's Date of Birth</label><input type="date" name="mother_dob" class="form-control"></div>
            </div>
            <div class="mt-4 d-flex justify-content-between">
              <button type="button" class="btn btn-secondary" onclick="nextStep(2)">Back</button>
              <button type="button" class="btn btn-primary" onclick="nextStep(4)">Next: Spouse & Beneficiaries</button>
            </div>
          </div>

          <div class="form-section" id="sec-4">
            <div id="spouse-block" style="display: none;" class="mb-4">
              <h5 class="fw-bold text-danger mb-3">Spouse Information</h5>
              <div class="row g-3">
                <div class="col-md-6"><label class="form-label">Spouse Full Name</label><input type="text" name="spouse_name" class="form-control"></div>
                <div class="col-md-6"><label class="form-label">Spouse Date of Birth</label><input type="date" name="spouse_dob" class="form-control"></div>
              </div>
            </div>

            <h5 class="fw-bold mb-3">Beneficiaries List</h5>
            <div id="beneficiaries-container">
              </div>
            <button type="button" class="btn btn-outline-primary btn-sm my-3" onclick="addBeneficiaryRow()">+ Add Beneficiary</button>

            <div class="mt-4 d-flex justify-content-between">
              <button type="button" class="btn btn-secondary" onclick="nextStep(3)">Back</button>
              <button type="button" class="btn btn-primary" onclick="nextStep(5)">Next: Upload Documents</button>
            </div>
          </div>

          <div class="form-section" id="sec-5">
            <h5 class="fw-bold mb-3">Upload Required Documents</h5>
            <p class="text-muted small">Clear images/PDFs are required. Use camera buttons on mobile if preferred.</p>

            <div class="mb-3">
              <label class="form-label fw-semibold">1. Select Valid ID Type *</label>
              <select name="id_type" class="form-select mb-2" required>
                <option value="National ID">Philippine National ID (PhilID)</option>
                <option value="Driver's License">Driver's License</option>
                <option value="Passport">Passport</option>
                <option value="UMID">UMID Card</option>
              </select>
              <input type="text" name="id_number" class="form-control" placeholder="ID Number (Optional)">
            </div>

            <div class="row g-3">
              <div class="col-md-6">
                <label class="form-label">Front ID Image *</label>
                <input type="file" name="doc_id_front" class="form-control" accept="image/*,application/pdf" capture="environment" required>
              </div>
              <div class="col-md-6">
                <label class="form-label">Back ID Image</label>
                <input type="file" name="doc_id_back" class="form-control" accept="image/*,application/pdf" capture="environment">
              </div>
              <div class="col-md-6">
                <label class="form-label">Photo Holding ID *</label>
                <input type="file" name="doc_holding_id" class="form-control" accept="image/*" capture="user" required>
              </div>
              <div class="col-md-6">
                <label class="form-label">2x2 / ID Picture *</label>
                <input type="file" name="doc_id_picture" class="form-control" accept="image/*" capture="user" required>
              </div>
              <div class="col-md-12" id="marriage-doc-block" style="display:none;">
                <label class="form-label text-danger">Marriage Certificate (Required if Married)</label>
                <input type="file" name="doc_marriage_cert" class="form-control" accept="image/*,application/pdf" multiple>
              </div>
            </div>

            <div class="mt-4 d-flex justify-content-between">
              <button type="button" class="btn btn-secondary" onclick="nextStep(4)">Back</button>
              <button type="button" class="btn btn-primary" onclick="nextStep(6)">Next: Payment Method</button>
            </div>
          </div>

          <div class="form-section" id="sec-6">
            <h5 class="fw-bold mb-3">Service Fee Payment</h5>
            <div class="alert alert-info">
              Total Processing Fee: <strong>₱<span id="payment-amount-display">${fees.tin}</span></strong>
            </div>

            <div class="mb-3">
              <label class="form-label fw-semibold">Payment Method *</label>
              <select name="payment_method" id="payment_method" class="form-select" onchange="togglePaymentFields()" required>
                <option value="GCash">GCash</option>
                <option value="Cash">Cash / On-Site</option>
              </select>
            </div>

            <div id="gcash-block" class="p-3 border rounded bg-light mb-3">
              <h6>Scan GCash QR Code or Send to:</h6>
              <p class="mb-1"><strong>Account Name:</strong> ${fees.gcash_name}</p>
              <p class="mb-2"><strong>GCash Number:</strong> ${fees.gcash_num}</p>
              ${fees.gcash_qr ? `<img src="${fees.gcash_qr}" class="img-fluid border rounded mb-3" style="max-width: 200px;">` : ''}
              <div class="mb-2">
                <label class="form-label">GCash Reference Number *</label>
                <input type="text" name="payment_ref" class="form-control" placeholder="13-digit GCash Ref">
              </div>
              <div class="mb-2">
                <label class="form-label">Upload GCash Payment Proof *</label>
                <input type="file" name="doc_payment_proof" class="form-control" accept="image/*">
              </div>
            </div>

            <div class="mt-4 d-flex justify-content-between">
              <button type="button" class="btn btn-secondary" onclick="nextStep(5)">Back</button>
              <button type="button" class="btn btn-primary" onclick="nextStep(7)">Next: Review & Confirm</button>
            </div>
          </div>

          <div class="form-section" id="sec-7">
            <h5 class="fw-bold mb-3">Review Application Details</h5>
            <p class="text-muted">Please double-check all details before final submission.</p>
            
            <div id="review-summary" class="border rounded p-3 bg-light mb-3">
              </div>

            <div class="form-check mb-4">
              <input class="form-check-input" type="checkbox" value="1" id="confirm_check" required>
              <label class="form-check-label fw-semibold" for="confirm_check">
                I confirm that all information and uploaded documents provided are authentic and accurate.
              </label>
            </div>

            <div class="mt-4 d-flex justify-content-between">
              <button type="button" class="btn btn-secondary" onclick="nextStep(6)">Back</button>
              <button type="submit" class="btn btn-success btn-lg">Submit Application</button>
            </div>
          </div>

        </form>
      </div>
    </div>

    <script>
      let currentStep = 1;

      function nextStep(step) {
        document.querySelectorAll('.form-section').forEach(el => el.classList.remove('active'));
        document.querySelectorAll('.step-item').forEach((el, idx) => {
          el.classList.remove('active');
          if (idx + 1 < step) el.classList.add('completed');
        });

        document.getElementById('sec-' + step).classList.add('active');
        document.getElementById('ind-' + step).classList.add('active');
        currentStep = step;

        if (step === 7) populateReview();
      }

      function toggleSpouseSection() {
        const val = document.getElementById('civil_status').value;
        const spouseBlock = document.getElementById('spouse-block');
        const marriageDoc = document.getElementById('marriage-doc-block');
        if (val === 'Married') {
          spouseBlock.style.display = 'block';
          marriageDoc.style.display = 'block';
        } else {
          spouseBlock.style.display = 'none';
          marriageDoc.style.display = 'none';
        }
      }

      function updateFee() {
        let fee = '${fees.tin}';
        if (document.getElementById('srv_sss').checked) fee = '${fees.sss}';
        if (document.getElementById('srv_pagibig').checked) fee = '${fees.pagibig}';
        document.getElementById('payment-amount-display').innerText = fee;
      }

      function togglePaymentFields() {
        const method = document.getElementById('payment_method').value;
        document.getElementById('gcash-block').style.display = method === 'GCash' ? 'block' : 'none';
      }

      let benCount = 0;
      function addBeneficiaryRow() {
        benCount++;
        const div = document.createElement('div');
        div.className = 'row g-2 mb-2 p-2 border rounded align-items-center';
        div.innerHTML = \`
          <div class="col-md-4"><input type="text" name="ben_name[]" class="form-control form-control-sm" placeholder="Beneficiary Full Name"></div>
          <div class="col-md-3"><input type="text" name="ben_rel[]" class="form-control form-control-sm" placeholder="Relationship"></div>
          <div class="col-md-4"><input type="date" name="ben_dob[]" class="form-control form-control-sm"></div>
          <div class="col-md-1"><button type="button" class="btn btn-danger btn-sm" onclick="this.parentElement.parentElement.remove()">X</button></div>
        \`;
        document.getElementById('beneficiaries-container').appendChild(div);
      }
      addBeneficiaryRow(); // Initial Row

      function populateReview() {
        const form = document.getElementById('multiStepForm');
        const formData = new FormData(form);
        let html = \`<p><strong>Service Type:</strong> \${formData.get('service_type').toUpperCase()}</p>\`;
        html += \`<p><strong>Name:</strong> \${formData.get('first_name')} \${formData.get('last_name')}</p>\`;
        html += \`<p><strong>Mobile:</strong> \${formData.get('mobile')} | <strong>Email:</strong> \${formData.get('email')}</p>\`;
        html += \`<p><strong>Civil Status:</strong> \${formData.get('civil_status')}</p>\`;
        html += \`<p><strong>Payment Method:</strong> \${formData.get('payment_method')}</p>\`;
        document.getElementById('review-summary').innerHTML = html;
      }
    </script>
  `;
  res.send(renderPage('New Application', content, req.session.user));
});

// --- SUBMISSION API ---

app.post('/api/applications/submit', requireCustomer, upload.fields([
  { name: 'doc_id_front', maxCount: 1 },
  { name: 'doc_id_back', maxCount: 1 },
  { name: 'doc_holding_id', maxCount: 1 },
  { name: 'doc_id_picture', maxCount: 1 },
  { name: 'doc_marriage_cert', maxCount: 5 },
  { name: 'doc_payment_proof', maxCount: 1 }
]), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const b = req.body;

    // Generate Unique Tracking ID
    const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randSuffix = Math.floor(1000 + Math.random() * 9000);
    const trackingNo = `${b.service_type.toUpperCase()}-${datePrefix}-${randSuffix}`;

    // Fee determination
    let fee = 250.00;
    if (b.service_type === 'sss') fee = 300.00;
    if (b.service_type === 'pagibig') fee = 300.00;

    // Construct structured JSON blocks
    const personalInfo = {
      first_name: b.first_name,
      middle_name: b.middle_name,
      last_name: b.last_name,
      suffix: b.suffix,
      dob: b.dob,
      pob: b.pob,
      sex: b.sex,
      civil_status: b.civil_status,
      mobile: b.mobile,
      email: b.email,
      address: b.address,
      barangay: b.barangay,
      city: b.city,
      province_zip: b.province_zip,
      id_type: b.id_type,
      id_number: b.id_number
    };

    const parentInfo = {
      father: { first: b.father_first, middle: b.father_middle, last: b.father_last, dob: b.father_dob },
      mother: { first: b.mother_first, middle: b.mother_middle, last: b.mother_last, dob: b.mother_dob }
    };

    const spouseInfo = b.civil_status === 'Married' ? { name: b.spouse_name, dob: b.spouse_dob } : null;

    // Beneficiaries parsing
    let beneficiaries = [];
    if (b['ben_name[]']) {
      const names = Array.isArray(b['ben_name[]']) ? b['ben_name[]'] : [b['ben_name[]']];
      const rels = Array.isArray(b['ben_rel[]']) ? b['ben_rel[]'] : [b['ben_rel[]']];
      const dobs = Array.isArray(b['ben_dob[]']) ? b['ben_dob[]'] : [b['ben_dob[]']];
      names.forEach((n, idx) => {
        if (n.trim()) beneficiaries.push({ name: n, relationship: rels[idx], dob: dobs[idx] });
      });
    }

    const appRes = await client.query(
      `INSERT INTO applications (tracking_number, user_id, service_type, status, payment_status, payment_method, payment_ref, fee, personal_info, parent_info, spouse_info, beneficiaries)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [
        trackingNo, req.session.user.id, b.service_type, 'Submitted',
        b.payment_method === 'GCash' ? 'Payment Verification' : 'Unpaid',
        b.payment_method, b.payment_ref || null, fee,
        JSON.stringify(personalInfo), JSON.stringify(parentInfo), JSON.stringify(spouseInfo), JSON.stringify(beneficiaries)
      ]
    );

    const appId = appRes.rows[0].id;

    // Process Document Records
    const files = req.files;
    const saveDoc = async (fileArr, docType) => {
      if (fileArr && fileArr.length > 0) {
        for (let f of fileArr) {
          await client.query(
            `INSERT INTO documents (application_id, document_type, file_path, original_name, uploaded_by) VALUES ($1, $2, $3, $4, $5)`,
            [appId, docType, '/uploads/' + f.filename, f.originalname, 'customer']
          );
        }
      }
    };

    await saveDoc(files['doc_id_front'], 'ID Front');
    await saveDoc(files['doc_id_back'], 'ID Back');
    await saveDoc(files['doc_holding_id'], 'Photo Holding ID');
    await saveDoc(files['doc_id_picture'], 'ID Picture');
    await saveDoc(files['doc_marriage_cert'], 'Marriage Certificate');
    await saveDoc(files['doc_payment_proof'], 'Payment Receipt');

    // Create initial status log
    await client.query(
      `INSERT INTO status_history (application_id, previous_status, new_status, remarks, changed_by) VALUES ($1, $2, $3, $4, $5)`,
      [appId, 'None', 'Submitted', 'Application submitted by customer', req.session.user.username]
    );

    // Initial Checklist items
    const checklist = ['Valid ID Verification', 'Selfie with ID Verification', 'Payment Verification'];
    for (let item of checklist) {
      await client.query(`INSERT INTO application_checklists (application_id, item_name) VALUES ($1, $2)`, [appId, item]);
    }

    await client.query('COMMIT');
    res.redirect(`/customer/application/${appId}`);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).send("Error submitting application: " + err.message);
  } finally {
    client.release();
  }
});

// --- APPLICATION VIEW (CUSTOMER) ---

app.get('/customer/application/:id', requireCustomer, async (req, res) => {
  const client = await pool.connect();
  try {
    const appRes = await client.query(`SELECT * FROM applications WHERE id = $1 AND user_id = $2`, [req.params.id, req.session.user.id]);
    if (appRes.rowCount === 0) return res.status(404).send("Application Not Found");

    const appData = appRes.rows[0];
    const docs = await client.query(`SELECT * FROM documents WHERE application_id = $1`, [appData.id]);
    const history = await client.query(`SELECT * FROM status_history WHERE application_id = $1 ORDER BY created_at DESC`, [appData.id]);

    let docsHtml = docs.rows.map(d => `
      <li class="list-group-item d-flex justify-content-between align-items-center">
        <div>
          <strong>${d.document_type}</strong> ${d.is_completed_doc ? '<span class="badge bg-success">Completed Result Document</span>' : ''}
          <br><small class="text-muted">${d.original_name}</small>
        </div>
        <a href="${d.file_path}" target="_blank" class="btn btn-sm btn-outline-primary">View / Download</a>
      </li>
    `).join('');

    let content = `
      <div class="container py-4">
        ${disclaimerHTML}
        <div class="card p-4">
          <div class="d-flex justify-content-between align-items-center mb-3">
            <h3>Application Tracking: ${appData.tracking_number}</h3>
            <span class="badge bg-primary fs-6">${appData.status}</span>
          </div>

          <div class="row mb-4">
            <div class="col-md-6">
              <p><strong>Service Requested:</strong> ${appData.service_type.toUpperCase()}</p>
              <p><strong>Payment Status:</strong> <span class="badge bg-warning text-dark">${appData.payment_status}</span></p>
              <p><strong>Total Fee:</strong> ₱${appData.fee}</p>
            </div>
            <div class="col-md-6">
              <p><strong>Date Submitted:</strong> ${new Date(appData.created_at).toLocaleString()}</p>
              ${appData.customer_remarks ? `<div class="alert alert-info"><strong>Admin Note to You:</strong> ${appData.customer_remarks}</div>` : ''}
            </div>
          </div>

          <h5 class="fw-bold mt-3">Uploaded Documents & Issued Results</h5>
          <ul class="list-group mb-4">
            ${docsHtml.length > 0 ? docsHtml : '<li class="list-group-item">No documents available.</li>'}
          </ul>

          <h5 class="fw-bold mt-3">Application History Log</h5>
          <ul class="list-group">
            ${history.rows.map(h => `
              <li class="list-group-item">
                <small class="text-muted">${new Date(h.created_at).toLocaleString()}</small> - 
                <strong>${h.new_status}</strong> (${h.remarks || 'No remarks'})
              </li>
            `).join('')}
          </ul>
        </div>
      </div>
    `;
    res.send(renderPage('View Application', content, req.session.user));
  } finally {
    client.release();
  }
});

// --- ADMIN PORTAL ROUTES ---

app.get('/admin/login', (req, res) => {
  const content = `
    <div class="container py-5" style="max-width: 450px;">
      <div class="card p-4 shadow-sm">
        <h3 class="fw-bold text-center mb-3 text-primary"><i class="bi bi-shield-lock-fill me-2"></i>Admin Portal Login</h3>
        <form action="/api/login" method="POST">
          <input type="hidden" name="role" value="admin">
          <div class="mb-3">
            <label class="form-label fw-semibold">Admin Username</label>
            <input type="text" name="username" class="form-control form-control-lg" required>
          </div>
          <div class="mb-3">
            <label class="form-label fw-semibold">Password</label>
            <input type="password" name="password" class="form-control form-control-lg" required>
          </div>
          <button type="submit" class="btn btn-primary btn-lg w-100">Sign In to Dashboard</button>
        </form>
      </div>
    </div>
  `;
  res.send(renderPage('Admin Login', content));
});

app.get('/admin/dashboard', requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const { search, service, status, payment_status } = req.query;

    // Aggregates & Metrics
    const totalApps = await client.query(`SELECT COUNT(*) FROM applications`);
    const pendingApps = await client.query(`SELECT COUNT(*) FROM applications WHERE status IN ('Submitted', 'Under Review')`);
    const completedApps = await client.query(`SELECT COUNT(*) FROM applications WHERE status = 'Completed'`);
    const totalRevenue = await client.query(`SELECT SUM(fee) FROM applications WHERE payment_status = 'Paid'`);

    // Dynamic Filter Query
    let whereClauses = [];
    let params = [];
    if (search) {
      params.push(`%${search}%`);
      whereClauses.push(`(a.tracking_number ILIKE $${params.length} OR u.full_name ILIKE $${params.length} OR u.mobile ILIKE $${params.length})`);
    }
    if (service) {
      params.push(service);
      whereClauses.push(`a.service_type = $${params.length}`);
    }
    if (status) {
      params.push(status);
      whereClauses.push(`a.status = $${params.length}`);
    }
    if (payment_status) {
      params.push(payment_status);
      whereClauses.push(`a.payment_status = $${params.length}`);
    }

    const whereSQL = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

    const apps = await client.query(
      `SELECT a.*, u.full_name, u.mobile, u.email FROM applications a JOIN users u ON a.user_id = u.id ${whereSQL} ORDER BY a.created_at DESC`,
      params
    );

    let content = `
      <div class="row">
        <div class="col-md-2 sidebar p-0 no-print">
          <div class="p-3 fs-5 fw-bold text-center border-bottom border-secondary">ADMIN MENU</div>
          <a href="/admin/dashboard" class="active"><i class="bi bi-speedometer2 me-2"></i>Dashboard</a>
          <a href="/admin/settings"><i class="bi bi-gear me-2"></i>System Settings</a>
          <a href="/admin/reports"><i class="bi bi-file-earmark-bar-graph me-2"></i>Reports & Revenue</a>
        </div>

        <div class="col-md-10 p-4">
          <h2 class="fw-bold mb-4">Management Dashboard</h2>

          <div class="row g-3 mb-4">
            <div class="col-md-3">
              <div class="card p-3 bg-primary text-white">
                <h6>Total Applications</h6>
                <h3 class="fw-bold">${totalApps.rows[0].count}</h3>
              </div>
            </div>
            <div class="col-md-3">
              <div class="card p-3 bg-warning text-dark">
                <h6>Pending Action</h6>
                <h3 class="fw-bold">${pendingApps.rows[0].count}</h3>
              </div>
            </div>
            <div class="col-md-3">
              <div class="card p-3 bg-success text-white">
                <h6>Completed Assistance</h6>
                <h3 class="fw-bold">${completedApps.rows[0].count}</h3>
              </div>
            </div>
            <div class="col-md-3">
              <div class="card p-3 bg-dark text-white">
                <h6>Total Collected Fees</h6>
                <h3 class="fw-bold">₱${totalRevenue.rows[0].sum || '0.00'}</h3>
              </div>
            </div>
          </div>

          <div class="card p-3 mb-4">
            <form method="GET" action="/admin/dashboard" class="row g-2">
              <div class="col-md-3">
                <input type="text" name="search" class="form-control" placeholder="Search Name, Tracking #" value="${search || ''}">
              </div>
              <div class="col-md-2">
                <select name="service" class="form-select">
                  <option value="">All Services</option>
                  <option value="tin" ${service === 'tin' ? 'selected' : ''}>BIR/TIN</option>
                  <option value="sss" ${service === 'sss' ? 'selected' : ''}>SSS</option>
                  <option value="pagibig" ${service === 'pagibig' ? 'selected' : ''}>Pag-IBIG</option>
                </select>
              </div>
              <div class="col-md-3">
                <select name="status" class="form-select">
                  <option value="">All Statuses</option>
                  <option value="Submitted" ${status === 'Submitted' ? 'selected' : ''}>Submitted</option>
                  <option value="Under Review" ${status === 'Under Review' ? 'selected' : ''}>Under Review</option>
                  <option value="Need Correction" ${status === 'Need Correction' ? 'selected' : ''}>Need Correction</option>
                  <option value="Processing" ${status === 'Processing' ? 'selected' : ''}>Processing</option>
                  <option value="Completed" ${status === 'Completed' ? 'selected' : ''}>Completed</option>
                </select>
              </div>
              <div class="col-md-2">
                <button type="submit" class="btn btn-primary w-100">Filter</button>
              </div>
              <div class="col-md-2">
                <a href="/admin/dashboard" class="btn btn-outline-secondary w-100">Reset</a>
              </div>
            </form>
          </div>

          <div class="card p-3">
            <div class="table-responsive">
              <table class="table table-hover align-middle">
                <thead>
                  <tr>
                    <th>Applicant</th>
                    <th>Service</th>
                    <th>Tracking #</th>
                    <th>Payment</th>
                    <th>Status</th>
                    <th>Submitted</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  ${apps.rows.map(a => `
                    <tr>
                      <td><strong>${a.full_name}</strong><br><small class="text-muted">${a.mobile}</small></td>
                      <td><span class="badge bg-secondary">${a.service_type.toUpperCase()}</span></td>
                      <td><small>${a.tracking_number}</small></td>
                      <td><span class="badge ${a.payment_status === 'Paid' ? 'bg-success' : 'bg-warning text-dark'}">${a.payment_status}</span></td>
                      <td><span class="badge bg-info text-dark">${a.status}</span></td>
                      <td>${new Date(a.created_at).toLocaleDateString()}</td>
                      <td>
                        <a href="/admin/applicant/${a.id}" class="btn btn-sm btn-primary">Review Details</a>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      </div>
    `;
    res.send(renderPage('Admin Dashboard', content, req.session.user));
  } finally {
    client.release();
  }
});

// --- ADMIN APPLICANT PROFILE & COMPLETED DOCUMENT MANAGEMENT ---

app.get('/admin/applicant/:id', requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const appRes = await client.query(
      `SELECT a.*, u.full_name as user_full_name, u.mobile as user_mobile, u.email as user_email 
       FROM applications a JOIN users u ON a.user_id = u.id WHERE a.id = $1`,
      [req.params.id]
    );

    if (appRes.rowCount === 0) return res.status(404).send("Applicant Record Not Found");

    const appData = appRes.rows[0];
    const docs = await client.query(`SELECT * FROM documents WHERE application_id = $1`, [appData.id]);
    const checklist = await client.query(`SELECT * FROM application_checklists WHERE application_id = $1`, [appData.id]);
    const notes = await client.query(`SELECT * FROM admin_notes WHERE application_id = $1 ORDER BY created_at DESC`, [appData.id]);

    const p = appData.personal_info || {};
    const parents = appData.parent_info || { father: {}, mother: {} };
    const spouse = appData.spouse_info;
    const beneficiaries = appData.beneficiaries || [];

    let content = `
      <div class="container-fluid py-4">
        <div class="d-flex justify-content-between align-items-center mb-3 no-print">
          <a href="/admin/dashboard" class="btn btn-secondary">&larr; Back to Dashboard</a>
          <div>
            <button onclick="window.print()" class="btn btn-outline-dark me-2"><i class="bi bi-printer me-1"></i>Print Application Sheet</button>
            <form action="/api/admin/application/delete" method="POST" class="d-inline" onsubmit="return confirm('Are you sure you want to delete this application? This action cannot be easily undone.');">
              <input type="hidden" name="application_id" value="${appData.id}">
              <button type="submit" class="btn btn-danger">Delete Application</button>
            </form>
          </div>
        </div>

        <div class="card p-4">
          <div class="border-bottom pb-3 mb-4 d-flex justify-content-between align-items-center">
            <div>
              <h2 class="fw-bold mb-1">${p.first_name || ''} ${p.middle_name || ''} ${p.last_name || ''}</h2>
              <span class="badge bg-primary fs-6">${appData.service_type.toUpperCase()} ASSISTANCE</span>
              <span class="ms-2 text-muted">Tracking #: <strong>${appData.tracking_number}</strong></span>
            </div>
            <div class="text-end">
              <span class="badge bg-info text-dark fs-6">${appData.status}</span>
              <div class="small text-muted mt-1">Payment: ${appData.payment_status}</div>
            </div>
          </div>

          <div class="row g-4">
            <div class="col-md-6">
              <h5 class="fw-bold text-primary">1. Personal Information</h5>
              <table class="table table-sm table-bordered">
                <tr><th>Full Name</th><td>${p.first_name} ${p.middle_name} ${p.last_name} ${p.suffix || ''}</td></tr>
                <tr><th>DOB / Place</th><td>${p.dob} / ${p.pob}</td></tr>
                <tr><th>Sex / Civil Status</th><td>${p.sex} / ${p.civil_status}</td></tr>
                <tr><th>Mobile / Email</th><td>${p.mobile} / ${p.email}</td></tr>
                <tr><th>Complete Address</th><td>${p.address}, ${p.barangay}, ${p.city}, ${p.province_zip}</td></tr>
                <tr><th>ID Submitted</th><td>${p.id_type} (${p.id_number || 'N/A'})</td></tr>
              </table>
            </div>

            <div class="col-md-6">
              <h5 class="fw-bold text-primary">2. Parent Information</h5>
              <table class="table table-sm table-bordered">
                <tr><th>Father's Name</th><td>${parents.father.first || ''} ${parents.father.middle || ''} ${parents.father.last || ''}</td></tr>
                <tr><th>Father's DOB</th><td>${parents.father.dob || 'N/A'}</td></tr>
                <tr><th>Mother's Maiden Name</th><td>${parents.mother.first || ''} ${parents.mother.middle || ''} ${parents.mother.last || ''}</td></tr>
                <tr><th>Mother's DOB</th><td>${parents.mother.dob || 'N/A'}</td></tr>
              </table>

              ${spouse ? `
                <h5 class="fw-bold text-primary mt-3">3. Spouse Details</h5>
                <p><strong>Name:</strong> ${spouse.name} | <strong>DOB:</strong> ${spouse.dob}</p>
              ` : ''}
            </div>

            <div class="col-12">
              <h5 class="fw-bold text-primary">4. Declared Beneficiaries</h5>
              <table class="table table-sm table-bordered">
                <thead><tr><th>Name</th><th>Relationship</th><th>DOB</th></tr></thead>
                <tbody>
                  ${beneficiaries.length > 0 ? beneficiaries.map(b => `<tr><td>${b.name}</td><td>${b.relationship}</td><td>${b.dob}</td></tr>`).join('') : '<tr><td colspan="3">No beneficiaries registered.</td></tr>'}
                </tbody>
              </table>
            </div>
          </div>

          <hr class="my-4 no-print">

          <div class="row g-4 no-print">
            
            <div class="col-md-6">
              <div class="card p-3 bg-light">
                <h5 class="fw-bold mb-3">Verification Checklist</h5>
                <form action="/api/admin/checklist/update" method="POST">
                  <input type="hidden" name="application_id" value="${appData.id}">
                  ${checklist.rows.map(c => `
                    <div class="form-check mb-2">
                      <input class="form-check-input" type="checkbox" name="checklist_items[]" value="${c.id}" ${c.is_verified ? 'checked' : ''}>
                      <label class="form-check-label">${c.item_name}</label>
                    </div>
                  `).join('')}
                  <button type="submit" class="btn btn-sm btn-outline-primary mt-2">Save Checklist</button>
                </form>

                <hr>

                <h5 class="fw-bold mb-3">Update Application & Payment Status</h5>
                <form action="/api/admin/status/update" method="POST">
                  <input type="hidden" name="application_id" value="${appData.id}">
                  <div class="mb-2">
                    <label class="form-label small fw-semibold">Application Status</label>
                    <select name="status" class="form-select">
                      <option value="Submitted" ${appData.status === 'Submitted' ? 'selected' : ''}>Submitted</option>
                      <option value="Under Review" ${appData.status === 'Under Review' ? 'selected' : ''}>Under Review</option>
                      <option value="Need Correction" ${appData.status === 'Need Correction' ? 'selected' : ''}>Need Correction</option>
                      <option value="Processing" ${appData.status === 'Processing' ? 'selected' : ''}>Processing</option>
                      <option value="Ready" ${appData.status === 'Ready' ? 'selected' : ''}>Ready</option>
                      <option value="Completed" ${appData.status === 'Completed' ? 'selected' : ''}>Completed</option>
                    </select>
                  </div>
                  <div class="mb-2">
                    <label class="form-label small fw-semibold">Payment Status</label>
                    <select name="payment_status" class="form-select">
                      <option value="Unpaid" ${appData.payment_status === 'Unpaid' ? 'selected' : ''}>Unpaid</option>
                      <option value="Payment Verification" ${appData.payment_status === 'Payment Verification' ? 'selected' : ''}>Payment Verification</option>
                      <option value="Paid" ${appData.payment_status === 'Paid' ? 'selected' : ''}>Paid</option>
                      <option value="Rejected" ${appData.payment_status === 'Rejected' ? 'selected' : ''}>Rejected</option>
                    </select>
                  </div>
                  <div class="mb-2">
                    <label class="form-label small fw-semibold">Customer Message / Correction Request</label>
                    <textarea name="customer_remarks" class="form-control" rows="2">${appData.customer_remarks || ''}</textarea>
                  </div>
                  <button type="submit" class="btn btn-primary w-100">Update Status & Notify</button>
                </form>
              </div>
            </div>

            <div class="col-md-6">
              <div class="card p-3 bg-light">
                <h5 class="fw-bold mb-3">Customer Documents</h5>
                <ul class="list-group mb-3">
                  ${docs.rows.filter(d => !d.is_completed_doc).map(d => `
                    <li class="list-group-item d-flex justify-content-between align-items-center">
                      <span>${d.document_type}</span>
                      <a href="${d.file_path}" target="_blank" class="btn btn-sm btn-outline-secondary">View File</a>
                    </li>
                  `).join('')}
                </ul>

                <h5 class="fw-bold mb-2">Upload Completed Output Files</h5>
                <p class="small text-muted mb-2">Attach completed official TIN, SSS, or Pag-IBIG registration documents for the customer.</p>
                <form action="/api/admin/completed-doc/upload" method="POST" enctype="multipart/form-data" class="mb-3">
                  <input type="hidden" name="application_id" value="${appData.id}">
                  <div class="mb-2">
                    <input type="file" name="completed_files" class="form-control" multiple required>
                  </div>
                  <button type="submit" class="btn btn-success btn-sm w-100">Upload Completed Files</button>
                </form>

                <h6 class="fw-bold mt-3">Completed Files Uploaded:</h6>
                <ul class="list-group">
                  ${docs.rows.filter(d => d.is_completed_doc).map(d => `
                    <li class="list-group-item d-flex justify-content-between align-items-center bg-white">
                      <span><i class="bi bi-file-earmark-check text-success me-2"></i>${d.original_name}</span>
                      <a href="${d.file_path}" target="_blank" class="btn btn-sm btn-outline-success">Download</a>
                    </li>
                  `).join('')}
                </ul>

              </div>
            </div>

          </div>

        </div>
      </div>
    `;
    res.send(renderPage('Applicant Profile', content, req.session.user));
  } finally {
    client.release();
  }
});

// --- SYSTEM API ENDPOINTS ---

app.post('/api/register', async (req, res) => {
  const { full_name, mobile, email, username, password, confirm_password } = req.body;
  if (password !== confirm_password) return res.status(400).send("Passwords do not match");

  const client = await pool.connect();
  try {
    const hashed = await bcrypt.hash(password, 10);
    await client.query(
      `INSERT INTO users (full_name, mobile, email, username, password, role) VALUES ($1, $2, $3, $4, $5, 'customer')`,
      [full_name, mobile, email, username, hashed]
    );
    res.redirect('/customer/login');
  } catch (err) {
    res.status(500).send("Registration error: " + err.message);
  } finally {
    client.release();
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password, role } = req.body;
  const client = await pool.connect();
  try {
    const q = await client.query(`SELECT * FROM users WHERE (username = $1 OR email = $1) AND role = $2`, [username, role]);
    if (q.rowCount === 0) return res.status(401).send("Invalid credentials.");

    const user = q.rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).send("Invalid credentials.");

    req.session.user = { id: user.id, username: user.username, full_name: user.full_name, role: user.role, email: user.email, mobile: user.mobile };
    res.redirect(role === 'admin' ? '/admin/dashboard' : '/customer/dashboard');
  } finally {
    client.release();
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

app.post('/api/admin/status/update', requireAdmin, async (req, res) => {
  const { application_id, status, payment_status, customer_remarks } = req.body;
  const client = await pool.connect();
  try {
    const current = await client.query(`SELECT * FROM applications WHERE id = $1`, [application_id]);
    const oldStatus = current.rows[0].status;

    await client.query(
      `UPDATE applications SET status = $1, payment_status = $2, customer_remarks = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4`,
      [status, payment_status, customer_remarks, application_id]
    );

    await client.query(
      `INSERT INTO status_history (application_id, previous_status, new_status, remarks, changed_by) VALUES ($1, $2, $3, $4, $5)`,
      [application_id, oldStatus, status, customer_remarks, req.session.user.username]
    );

    // Create Notification
    await client.query(
      `INSERT INTO notifications (user_id, title, message) VALUES ($1, $2, $3)`,
      [current.rows[0].user_id, 'Application Status Update', `Your application ${current.rows[0].tracking_number} status changed to ${status}.`]
    );

    res.redirect(`/admin/applicant/${application_id}`);
  } finally {
    client.release();
  }
});

app.post('/api/admin/completed-doc/upload', requireAdmin, upload.array('completed_files', 5), async (req, res) => {
  const { application_id } = req.body;
  const client = await pool.connect();
  try {
    if (req.files && req.files.length > 0) {
      for (let f of req.files) {
        await client.query(
          `INSERT INTO documents (application_id, document_type, file_path, original_name, is_completed_doc, uploaded_by) VALUES ($1, $2, $3, $4, TRUE, 'admin')`,
          [application_id, 'Official Completed Output', '/uploads/' + f.filename, f.originalname]
        );
      }
    }
    res.redirect(`/admin/applicant/${application_id}`);
  } finally {
    client.release();
  }
});

app.post('/api/admin/checklist/update', requireAdmin, async (req, res) => {
  const { application_id, checklist_items } = req.body;
  const client = await pool.connect();
  try {
    await client.query(`UPDATE application_checklists SET is_verified = FALSE WHERE application_id = $1`, [application_id]);
    if (checklist_items) {
      const items = Array.isArray(checklist_items) ? checklist_items : [checklist_items];
      for (let id of items) {
        await client.query(`UPDATE application_checklists SET is_verified = TRUE WHERE id = $1`, [id]);
      }
    }
    res.redirect(`/admin/applicant/${application_id}`);
  } finally {
    client.release();
  }
});

app.post('/api/admin/application/delete', requireAdmin, async (req, res) => {
  const { application_id } = req.body;
  const client = await pool.connect();
  try {
    await client.query(`DELETE FROM applications WHERE id = $1`, [application_id]);
    res.redirect('/admin/dashboard');
  } finally {
    client.release();
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`Application Assistance System running on port ${PORT}`);
});
