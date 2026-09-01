/*******************************************************************************
 * COMPLETE BIR/TIN, SSS & PAG-IBIG APPLICATION ASSISTANCE SYSTEM
 * Single-file Express.js application containing backend API, DB logic, 
 * Authentication, Customer Portal, Admin Portal, and Responsive HTML/CSS/JS.
 *******************************************************************************/

const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Database Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Configure Multer for secure file uploads (storing binary/buffers in DB or disk storage)
const upload = multer({
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|pdf/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error('Only images (JPEG/JPG/PNG) and PDFs are allowed!'));
  }
});

// Middleware Setup
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Session Setup with PostgreSQL Store
app.use(session({
  store: new pgSession({
    pool: pool,
    tableName: 'session',
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET || 'gov_assistance_super_secret_key_2026',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
  }
}));

// ==========================================
// DATABASE INITIALIZATION & SCHEMA MIGRATION
// ==========================================
async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Users (Customer Portal)
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        full_name VARCHAR(255) NOT NULL,
        mobile_number VARCHAR(50) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        username VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Admin Users
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // System Settings & Configs
    await client.query(`
      CREATE TABLE IF NOT EXISTS system_settings (
        id SERIAL PRIMARY KEY,
        key VARCHAR(100) UNIQUE NOT NULL,
        value TEXT NOT NULL
      );
    `);

    // Applications
    await client.query(`
      CREATE TABLE IF NOT EXISTS applications (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id) ON DELETE CASCADE,
        tracking_number VARCHAR(100) UNIQUE NOT NULL,
        service_type VARCHAR(50) NOT NULL, -- TIN, SSS, PAGIBIG
        status VARCHAR(50) DEFAULT 'Submitted',
        payment_status VARCHAR(50) DEFAULT 'Unpaid',
        fee NUMERIC(10,2) DEFAULT 0.00,
        personal_info JSONB,
        address_info JSONB,
        parents_info JSONB,
        spouse_info JSONB,
        employment_info JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Beneficiaries (Dynamic, multiple)
    await client.query(`
      CREATE TABLE IF NOT EXISTS beneficiaries (
        id SERIAL PRIMARY KEY,
        application_id INT REFERENCES applications(id) ON DELETE CASCADE,
        full_name VARCHAR(255) NOT NULL,
        relationship VARCHAR(100),
        date_of_birth DATE,
        address TEXT
      );
    `);

    // Documents Uploaded by Customers
    await client.query(`
      CREATE TABLE IF NOT EXISTS documents (
        id SERIAL PRIMARY KEY,
        application_id INT REFERENCES applications(id) ON DELETE CASCADE,
        document_type VARCHAR(100) NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        file_data BYTEA NOT NULL,
        mime_type VARCHAR(100) NOT NULL,
        verified BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Completed Documents Uploaded by Admin
    await client.query(`
      CREATE TABLE IF NOT EXISTS completed_documents (
        id SERIAL PRIMARY KEY,
        application_id INT REFERENCES applications(id) ON DELETE CASCADE,
        file_name VARCHAR(255) NOT NULL,
        file_data BYTEA NOT NULL,
        mime_type VARCHAR(100) NOT NULL,
        document_type VARCHAR(100) DEFAULT 'Completed Government Document',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Payments & Proofs
    await client.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        application_id INT REFERENCES applications(id) ON DELETE CASCADE,
        payment_method VARCHAR(50) NOT NULL, -- Cash, GCash
        amount NUMERIC(10,2) NOT NULL,
        reference_number VARCHAR(100),
        payment_date DATE,
        proof_file_name VARCHAR(255),
        proof_file_data BYTEA,
        proof_mime_type VARCHAR(100),
        status VARCHAR(50) DEFAULT 'Unpaid',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Status History & Audit Trail
    await client.query(`
      CREATE TABLE IF NOT EXISTS status_history (
        id SERIAL PRIMARY KEY,
        application_id INT REFERENCES applications(id) ON DELETE CASCADE,
        previous_status VARCHAR(50),
        new_status VARCHAR(50) NOT NULL,
        changed_by VARCHAR(100) NOT NULL,
        remarks TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Notifications
    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Admin Notes & Customer Remarks
    await client.query(`
      CREATE TABLE IF NOT EXISTS application_notes (
        id SERIAL PRIMARY KEY,
        application_id INT REFERENCES applications(id) ON DELETE CASCADE,
        author VARCHAR(100) NOT NULL,
        note_type VARCHAR(50) DEFAULT 'internal', -- internal or customer_visible
        message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Application Checklists
    await client.query(`
      CREATE TABLE IF NOT EXISTS application_checklists (
        id SERIAL PRIMARY KEY,
        application_id INT REFERENCES applications(id) ON DELETE CASCADE,
        item_name VARCHAR(255) NOT NULL,
        is_checked BOOLEAN DEFAULT FALSE
      );
    `);

    // Insert Default System Settings if not present
    const defaultSettings = [
      { key: 'business_name', value: 'GovAssists PH - Application Assistance Service' },
      { key: 'contact_number', value: '+63 912 345 6789' },
      { key: 'contact_email', value: 'support@govassists.ph' },
      { key: 'address', value: 'Manila, Philippines' },
      { key: 'gcash_name', value: 'Juan Dela Cruz' },
      { key: 'gcash_number', value: '09171234567' },
      { key: 'gcash_qr', value: '' },
      { key: 'fee_tin', value: '350.00' },
      { key: 'fee_sss', value: '450.00' },
      { key: 'fee_pagibig', value: '450.00' },
      { key: 'customer_instructions', value: 'Please ensure all uploaded IDs and personal details are clear, accurate, and completely filled out before proceeding with payment.' }
    ];

    for (const setting of defaultSettings) {
      await client.query(`
        INSERT INTO system_settings (key, value)
        VALUES ($1, $2)
        ON CONFLICT (key) DO NOTHING;
      `, [setting.key, setting.value]);
    }

    // Insert Default Admin if none exists
    const adminRes = await client.query('SELECT * FROM admin_users LIMIT 1;');
    if (adminRes.rows.length === 0) {
      const defaultAdminPass = process.env.DEFAULT_ADMIN_PASSWORD || 'AdminSecure2026!';
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(defaultAdminPass, salt);
      await client.query(`
        INSERT INTO admin_users (username, password_hash, full_name)
        VALUES ($1, $2, $3);
      `, ['admin', hash, 'Super Administrator']);
      console.log(`[INFO] Default admin created. Username: admin, Password: ${defaultAdminPass}`);
    }

    await client.query('COMMIT');
    console.log('[INFO] Database initialized successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[ERROR] Database initialization failed:', err);
  } finally {
    client.release();
  }
}

initDatabase();

// ==========================================
// MIDDLEWARE GUARDS
// ==========================================
function requireCustomerAuth(req, res, next) {
  if (req.session && req.session.userId && req.session.userType === 'customer') {
    return next();
  }
  if (req.xhr || req.headers.accept.indexOf('json') > -1) {
    return res.status(401).json({ error: 'Unauthorized. Please log in.' });
  }
  res.redirect('/customer/login');
}

function requireAdminAuth(req, res, next) {
  if (req.session && req.session.adminId && req.session.userType === 'admin') {
    return next();
  }
  if (req.xhr || req.headers.accept.indexOf('json') > -1) {
    return res.status(401).json({ error: 'Admin unauthorized.' });
  }
  res.redirect('/admin/login');
}

// ==========================================
// HELPER FUNCTIONS
// ==========================================
async function generateTrackingNumber(serviceType) {
  const prefix = serviceType.toUpperCase();
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randNum = Math.floor(1000 + Math.random() * 9000);
  const trackingNumber = `${prefix}-${dateStr}-${randNum}`;
  
  const check = await pool.query('SELECT id FROM applications WHERE tracking_number = $1', [trackingNumber]);
  if (check.rows.length > 0) {
    return generateTrackingNumber(serviceType);
  }
  return trackingNumber;
}

async function addNotification(userId, title, message) {
  await pool.query(
    'INSERT INTO notifications (user_id, title, message) VALUES ($1, $2, $3)',
    [userId, title, message]
  );
}

async function logStatusHistory(appId, prevStatus, newStatus, changedBy, remarks) {
  await pool.query(
    'INSERT INTO status_history (application_id, previous_status, new_status, changed_by, remarks) VALUES ($1, $2, $3, $4, $5)',
    [appId, prevStatus, newStatus, changedBy, remarks]
  );
}

// ==========================================
// ROUTES: LANDING PAGE & TRACKING WITHOUT LOGIN
// ==========================================
app.get('/', async (req, res) => {
  const settingsRes = await pool.query('SELECT key, value FROM system_settings');
  const settings = {};
  settingsRes.rows.forEach(r => settings[r.key] = r.value);

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${settings.business_name}</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8f9fa; }
            .hero-section { background: linear-gradient(135deg, #0d6efd 0%, #0a58ca 100%); color: white; padding: 80px 0; }
            .feature-card { border: none; border-radius: 12px; transition: transform 0.3s; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
            .feature-card:hover { transform: translateY(-5px); }
            .disclaimer-box { background-color: #fff3cd; border-left: 5px solid #ffc107; color: #664d03; padding: 15px; border-radius: 4px; font-size: 0.95rem; }
        </style>
    </head>
    <body>
        <nav class="navbar navbar-expand-lg navbar-dark bg-dark sticky-top">
            <div class="container">
                <a class="navbar-brand fw-bold" href="/"><i class="fas fa-id-card me-2"></i>GovAssists PH</a>
                <div class="navbar-nav ms-auto">
                    <a class="nav-link" href="/customer/login">Customer Login</a>
                    <a class="nav-link btn btn-primary text-white ms-2 px-3" href="/customer/register">Register Now</a>
                </div>
            </div>
        </nav>

        <div class="hero-section text-center">
            <div class="container">
                <h1 class="display-4 fw-bold mb-3">BIR/TIN • SSS • PAG-IBIG APPLICATION ASSISTANCE</h1>
                <p class="lead mb-4">Fast, reliable, and hassle-free assistance for your government document processing and tracking needs.</p>
                <div class="d-flex justify-content-center gap-3">
                    <a href="/customer/register" class="btn btn-light btn-lg fw-bold px-4"><i class="fas fa-paper-plane me-2"></i>Apply Now</a>
                    <a href="/customer/login" class="btn btn-outline-light btn-lg px-4"><i class="fas fa-sign-in-alt me-2"></i>Customer Login</a>
                </div>
            </div>
        </div>

        <div class="container my-5">
            <div class="disclaimer-box mb-5">
                <i class="fas fa-exclamation-triangle me-2"></i><strong>Important Government Disclaimer:</strong> This website is an independent application assistance and document processing/tracking service. It is not an official BIR, SSS, or Pag-IBIG website. We assist citizens in preparing, organizing, and tracking their applications.
            </div>

            <div class="row text-center mb-5">
                <h2 class="fw-bold mb-4">How It Works</h2>
                <div class="col-md-3 mb-3">
                    <div class="card feature-card p-4 h-100">
                        <div class="fs-1 text-primary mb-3"><i class="fas fa-user-plus"></i></div>
                        <h5>1. Create Account</h5>
                        <p class="text-muted small">Register your profile securely on our customer portal.</p>
                    </div>
                </div>
                <div class="col-md-3 mb-3">
                    <div class="card feature-card p-4 h-100">
                        <div class="fs-1 text-primary mb-3"><i class="fas fa-file-alt"></i></div>
                        <h5>2. Choose Service & Form</h5>
                        <p class="text-muted small">Select BIR/TIN, SSS, or Pag-IBIG and fill out the step-by-step assistance form.</p>
                    </div>
                </div>
                <div class="col-md-3 mb-3">
                    <div class="card feature-card p-4 h-100">
                        <div class="fs-1 text-primary mb-3"><i class="fas fa-upload"></i></div>
                        <h5>3. Upload Documents</h5>
                        <p class="text-muted small">Upload valid IDs and required certificates directly from your camera or device.</p>
                    </div>
                </div>
                <div class="col-md-3 mb-3">
                    <div class="card feature-card p-4 h-100">
                        <div class="fs-1 text-primary mb-3"><i class="fas fa-search-dollar"></i></div>
                        <h5>4. Pay & Track</h5>
                        <p class="text-muted small">Pay via Cash or GCash and track your application progress in real-time.</p>
                    </div>
                </div>
            </div>

            <div class="card shadow-sm p-4 mb-5 bg-white rounded-4">
                <h3 class="fw-bold mb-3"><i class="fas fa-search me-2 text-primary"></i>Track Application Status Instantly</h3>
                <p class="text-muted">Enter your tracking number below to check your current application progress without logging in.</p>
                <form id="publicTrackForm" class="row g-3">
                    <div class="col-md-8">
                        <input type="text" class="form-control form-control-lg" id="publicTrackingNumber" placeholder="e.g. TIN-20260901-1234" required>
                    </div>
                    <div class="col-md-4">
                        <button type="submit" class="btn btn-primary btn-lg w-100"><i class="fas fa-search me-2"></i>Track Status</button>
                    </div>
                </form>
                <div id="publicTrackResult" class="mt-4"></div>
            </div>
        </div>

        <footer class="bg-dark text-white text-center py-4">
            <div class="container">
                <p class="mb-1">&copy; 2026 ${settings.business_name}. All rights reserved.</p>
                <p class="small text-muted mb-0">Contact: ${settings.contact_number} | Email: ${settings.contact_email}</p>
            </div>
        </footer>

        <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
        <script>
            document.getElementById('publicTrackForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                const trackingNum = document.getElementById('publicTrackingNumber').value.trim();
                const resultDiv = document.getElementById('publicTrackResult');
                resultDiv.innerHTML = '<div class="spinner-border text-primary" role="status"></div> Searching...';
                
                try {
                    const res = await fetch('/api/track/' + encodeURIComponent(trackingNum));
                    const data = await res.json();
                    if (res.ok) {
                        resultDiv.innerHTML = \`
                            <div class="alert alert-success">
                                <h5><i class="fas fa-check-circle me-2"></i>Application Found</h5>
                                <p class="mb-1"><strong>Tracking Number:</strong> \${data.tracking_number}</p>
                                <p class="mb-1"><strong>Service:</strong> \${data.service_type}</p>
                                <p class="mb-1"><strong>Status:</strong> <span class="badge bg-info">\${data.status}</span></p>
                                <p class="mb-1"><strong>Payment Status:</strong> <span class="badge bg-secondary">\${data.payment_status}</span></p>
                                <p class="mb-0"><strong>Date Submitted:</strong> \${new Date(data.created_at).toLocaleString()}</p>
                            </div>
                        \`;
                    } else {
                        resultDiv.innerHTML = \`<div class="alert alert-danger"><i class="fas fa-times-circle me-2"></i>\${data.error || 'Application not found.'}</div>\`;
                    }
                } catch (err) {
                    resultDiv.innerHTML = '<div class="alert alert-danger">Error connecting to server.</div>';
                }
            });
        </script>
    </body>
    </html>
  `);
});

// Public Tracking API
app.get('/api/track/:trackingNumber', async (req, res) => {
  try {
    const { trackingNumber } = req.params;
    const result = await pool.query(
      'SELECT tracking_number, service_type, status, payment_status, created_at FROM applications WHERE tracking_number = $1',
      [trackingNumber]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No application found with this tracking number.' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error tracking application.' });
  }
});

// ==========================================
// CUSTOMER AUTHENTICATION ROUTES
// ==========================================
app.get('/customer/login', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Customer Login - GovAssists PH</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    </head>
    <body class="bg-light d-flex align-items-center py-5" style="min-height: 100vh;">
        <div class="container">
            <div class="row justify-content-center">
                <div class="col-md-5">
                    <div class="card shadow border-0 rounded-4 p-4">
                        <div class="text-center mb-4">
                            <h3 class="fw-bold text-primary"><i class="fas fa-user-lock me-2"></i>Customer Login</h3>
                            <p class="text-muted">Access your application portal</p>
                        </div>
                        <form action="/customer/login" method="POST">
                            <div class="mb-3">
                                <label class="form-label">Username or Email</label>
                                <input type="text" class="form-control" name="username" required>
                            </div>
                            <div class="mb-3">
                                <label class="form-label">Password</label>
                                <input type="password" class="form-control" name="password" required>
                            </div>
                            <button type="submit" class="btn btn-primary w-100 py-2 mb-3 fw-bold">Login</button>
                            <div class="text-center">
                                <p class="small text-muted">Don't have an account? <a href="/customer/register">Register here</a></p>
                                <a href="/" class="small text-decoration-none"><i class="fas fa-arrow-left me-1"></i>Back to Home</a>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    </body>
    </html>
  `);
});

app.post('/customer/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const userRes = await pool.query(
      'SELECT * FROM users WHERE username = $1 OR email = $1',
      [username]
    );
    if (userRes.rows.length === 0) {
      return res.send(`<script>alert('Invalid username or email.'); window.location='/customer/login';</script>`);
    }
    const user = userRes.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.send(`<script>alert('Invalid password.'); window.location='/customer/login';</script>`);
    }

    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.userType = 'customer';
    res.redirect('/customer/dashboard');
  } catch (err) {
    res.status(500).send('Login error');
  }
});

app.get('/customer/register', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Customer Registration - GovAssists PH</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    </head>
    <body class="bg-light py-5">
        <div class="container">
            <div class="row justify-content-center">
                <div class="col-md-6">
                    <div class="card shadow border-0 rounded-4 p-4">
                        <div class="text-center mb-4">
                            <h3 class="fw-bold text-primary"><i class="fas fa-user-plus me-2"></i>Customer Registration</h3>
                            <p class="text-muted">Create your account to apply and track assistance</p>
                        </div>
                        <form action="/customer/register" method="POST">
                            <div class="mb-3">
                                <label class="form-label">Full Name</label>
                                <input type="text" class="form-control" name="full_name" required>
                            </div>
                            <div class="mb-3">
                                <label class="form-label">Mobile Number</label>
                                <input type="text" class="form-control" name="mobile_number" placeholder="09123456789" required>
                            </div>
                            <div class="mb-3">
                                <label class="form-label">Email Address</label>
                                <input type="email" class="form-control" name="email" required>
                            </div>
                            <div class="mb-3">
                                <label class="form-label">Username</label>
                                <input type="text" class="form-control" name="username" required>
                            </div>
                            <div class="mb-3">
                                <label class="form-label">Password</label>
                                <input type="password" class="form-control" name="password" required>
                            </div>
                            <div class="mb-3">
                                <label class="form-label">Confirm Password</label>
                                <input type="password" class="form-control" name="confirm_password" required>
                            </div>
                            <button type="submit" class="btn btn-primary w-100 py-2 mb-3 fw-bold">Register Account</button>
                            <div class="text-center">
                                <p class="small text-muted">Already have an account? <a href="/customer/login">Login here</a></p>
                                <a href="/" class="small text-decoration-none"><i class="fas fa-arrow-left me-1"></i>Back to Home</a>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    </body>
    </html>
  `);
});

app.post('/customer/register', async (req, res) => {
  try {
    const { full_name, mobile_number, email, username, password, confirm_password } = req.body;
    if (password !== confirm_password) {
      return res.send(`<script>alert('Passwords do not match!'); window.location='/customer/register';</script>`);
    }

    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    await pool.query(
      'INSERT INTO users (full_name, mobile_number, email, username, password_hash) VALUES ($1, $2, $3, $4, $5)',
      [full_name, mobile_number, email, username, password_hash]
    );

    res.send(`<script>alert('Registration successful! Please login.'); window.location='/customer/login';</script>`);
  } catch (err) {
    console.error(err);
    res.send(`<script>alert('Registration failed. Username or email may already be in use.'); window.location='/customer/register';</script>`);
  }
});

app.get('/customer/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/customer/login');
  });
});

// ==========================================
// ADMIN AUTHENTICATION ROUTES
// ==========================================
app.get('/admin/login', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Admin Login - GovAssists PH</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    </head>
    <body class="bg-dark d-flex align-items-center py-5" style="min-height: 100vh;">
        <div class="container">
            <div class="row justify-content-center">
                <div class="col-md-5">
                    <div class="card shadow border-0 rounded-4 p-4 bg-white">
                        <div class="text-center mb-4">
                            <h3 class="fw-bold text-danger"><i class="fas fa-shield-alt me-2"></i>Admin Portal</h3>
                            <p class="text-muted">Restricted Access Only</p>
                        </div>
                        <form action="/admin/login" method="POST">
                            <div class="mb-3">
                                <label class="form-label">Admin Username</label>
                                <input type="text" class="form-control" name="username" required>
                            </div>
                            <div class="mb-3">
                                <label class="form-label">Password</label>
                                <input type="password" class="form-control" name="password" required>
                            </div>
                            <button type="submit" class="btn btn-danger w-100 py-2 mb-3 fw-bold">Admin Login</button>
                            <div class="text-center">
                                <a href="/" class="small text-decoration-none"><i class="fas fa-arrow-left me-1"></i>Back to Home</a>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    </body>
    </html>
  `);
});

app.post('/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const adminRes = await pool.query('SELECT * FROM admin_users WHERE username = $1', [username]);
    if (adminRes.rows.length === 0) {
      return res.send(`<script>alert('Invalid admin credentials.'); window.location='/admin/login';</script>`);
    }
    const admin = adminRes.rows[0];
    const match = await bcrypt.compare(password, admin.password_hash);
    if (!match) {
      return res.send(`<script>alert('Invalid admin password.'); window.location='/admin/login';</script>`);
    }

    req.session.adminId = admin.id;
    req.session.adminUsername = admin.username;
    req.session.userType = 'admin';
    res.redirect('/admin/dashboard');
  } catch (err) {
    res.status(500).send('Admin login error');
  }
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/admin/login');
  });
});

// ==========================================
// CUSTOMER PORTAL DASHBOARD & NEW APPLICATION
// ==========================================
app.get('/customer/dashboard', requireCustomerAuth, async (req, res) => {
  const userId = req.session.userId;
  const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
  const user = userRes.rows[0];

  const appsRes = await pool.query('SELECT * FROM applications WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
  const applications = appsRes.rows.length > 0 ? appsRes.rows : [];

  const notifsRes = await pool.query('SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10', [userId]);
  const notifications = notifsRes.rows;

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Customer Dashboard - GovAssists PH</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    </head>
    <body class="bg-light">
        <nav class="navbar navbar-expand-lg navbar-dark bg-primary">
            <div class="container-fluid">
                <a class="navbar-brand fw-bold" href="/customer/dashboard"><i class="fas fa-user-circle me-2"></i>Customer Portal</a>
                <div class="d-flex align-items-center">
                    <span class="text-white me-3 d-none d-md-inline">Welcome, ${user.full_name}</span>
                    <a href="/customer/logout" class="btn btn-outline-light btn-sm"><i class="fas fa-sign-out-alt me-1"></i>Logout</a>
                </div>
            </div>
        </nav>

        <div class="container my-4">
            <div class="row mb-4">
                <div class="col-md-8">
                    <h2>My Applications & Assistance</h2>
                    <p class="text-muted">Apply for BIR/TIN, SSS, or Pag-IBIG assistance, upload documents, and track status.</p>
                </div>
                <div class="col-md-4 text-md-end">
                    <a href="/customer/apply" class="btn btn-success btn-lg fw-bold shadow-sm"><i class="fas fa-plus-circle me-2"></i>New Application</a>
                </div>
            </div>

            ${notifications.length > 0 ? `
                <div class="card shadow-sm border-0 mb-4 rounded-4">
                    <div class="card-header bg-warning bg-opacity-25 fw-bold"><i class="fas fa-bell me-2"></i>Recent Notifications</div>
                    <ul class="list-group list-group-flush">
                        ${notifications.map(n => `
                            <li class="list-group-item d-flex justify-content-between align-items-center">
                                <div>
                                    <strong>${n.title}</strong>: ${n.message}
                                </div>
                                <small class="text-muted">${new Date(n.created_at).toLocaleString()}</small>
                            </li>
                        `).join('')}
                    </ul>
                </div>
            ` : ''}

            <div class="card shadow-sm border-0 rounded-4">
                <div class="card-header bg-white py-3 fw-bold"><i class="fas fa-list me-2 text-primary"></i>My Submitted Applications</div>
                <div class="card-body p-0">
                    <div class="table-responsive">
                        <table class="table table-hover align-middle mb-0">
                            <thead class="table-light">
                                <tr>
                                    <th>Tracking Number</th>
                                    <th>Service</th>
                                    <th>Date Submitted</th>
                                    <th>Status</th>
                                    <th>Payment Status</th>
                                    <th>Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${applications.length === 0 ? `
                                    <tr><td colspan="6" class="text-center py-4 text-muted">No applications found. Click "New Application" to get started.</td></tr>
                                ` : applications.map(app => `
                                    <tr>
                                        <td><strong>${app.tracking_number}</strong></td>
                                        <td><span class="badge bg-secondary">${app.service_type}</span></td>
                                        <td>${new Date(app.created_at).toLocaleDateString()}</td>
                                        <td><span class="badge bg-info text-dark">${app.status}</span></td>
                                        <td><span class="badge bg-${app.payment_status === 'Paid' ? 'success' : 'warning text-dark'}">${app.payment_status}</span></td>
                                        <td>
                                            <a href="/customer/application/${app.id}" class="btn btn-sm btn-outline-primary"><i class="fas fa-eye me-1"></i>View / Track</a>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>

        <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
    </body>
    </html>
  `);
});

// Step-by-Step Application Form View
app.get('/customer/apply', requireCustomerAuth, async (req, res) => {
  const settingsRes = await pool.query('SELECT key, value FROM system_settings');
  const settings = {};
  settingsRes.rows.forEach(r => settings[r.key] = r.value);

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>New Application - GovAssists PH</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
            .step-section { display: none; }
            .step-section.active { display: block; }
        </style>
    </head>
    <body class="bg-light py-4">
        <div class="container">
            <div class="row justify-content-center">
                <div class="col-lg-10">
                    <div class="card shadow border-0 rounded-4 p-4">
                        <div class="d-flex justify-content-between align-items-center mb-4 border-bottom pb-3">
                            <div>
                                <h3 class="fw-bold text-primary mb-1"><i class="fas fa-file-invoice me-2"></i>Government Assistance Application Form</h3>
                                <p class="text-muted small mb-0">Fill out all required details accurately step by step.</p>
                            </div>
                            <a href="/customer/dashboard" class="btn btn-outline-secondary btn-sm"><i class="fas fa-arrow-left me-1"></i>Dashboard</a>
                        </div>

                        <div class="progress mb-4" style="height: 10px;">
                            <div id="progressBar" class="progress-bar bg-success" role="progressbar" style="width: 10%;"></div>
                        </div>

                        <form id="assistanceForm" action="/customer/apply" method="POST" enctype="multipart/form-data">
                            
                            <div class="step-section active" data-step="1">
                                <h4 class="text-primary mb-3"><i class="fas fa-cog me-2"></i>Step 1: Select Service & Personal Information</h4>
                                
                                <div class="mb-3">
                                    <label class="form-label fw-bold">Select Government Assistance Service *</label>
                                    <select class="form-select form-select-lg" name="service_type" id="serviceType" required>
                                        <option value="">-- Choose Service --</option>
                                        <option value="BIR">BIR / TIN Assistance (Fee: ₱${settings.fee_tin || '350.00'})</option>
                                        <option value="SSS">SSS Assistance (Fee: ₱${settings.fee_sss || '450.00'})</option>
                                        <option value="PAGIBIG">Pag-IBIG Assistance (Fee: ₱${settings.fee_pagibig || '450.00'})</option>
                                    </select>
                                </div>

                                <div class="row">
                                    <div class="col-md-4 mb-3">
                                        <label class="form-label">First Name *</label>
                                        <input type="text" class="form-control" name="first_name" required>
                                    </div>
                                    <div class="col-md-3 mb-3">
                                        <label class="form-label">Middle Name</label>
                                        <input type="text" class="form-control" name="middle_name">
                                    </div>
                                    <div class="col-md-4 mb-3">
                                        <label class="form-label">Last Name *</label>
                                        <input type="text" class="form-control" name="last_name" required>
                                    </div>
                                    <div class="col-md-1 mb-3">
                                        <label class="form-label">Suffix</label>
                                        <input type="text" class="form-control" name="suffix" placeholder="Jr">
                                    </div>
                                </div>

                                <div class="row">
                                    <div class="col-md-4 mb-3">
                                        <label class="form-label">Date of Birth *</label>
                                        <input type="date" class="form-control" name="dob" required>
                                    </div>
                                    <div class="col-md-4 mb-3">
                                        <label class="form-label">Place of Birth *</label>
                                        <input type="text" class="form-control" name="place_of_birth" required>
                                    </div>
                                    <div class="col-md-4 mb-3">
                                        <label class="form-label">Sex *</label>
                                        <select class="form-select" name="sex" required>
                                            <option value="">-- Select --</option>
                                            <option value="Male">Male</option>
                                            <option value="Female">Female</option>
                                        </select>
                                    </div>
                                </div>

                                <div class="row">
                                    <div class="col-md-4 mb-3">
                                        <label class="form-label">Civil Status *</label>
                                        <select class="form-select" name="civil_status" id="civilStatus" required>
                                            <option value="Single">Single</option>
                                            <option value="Married">Married</option>
                                            <option value="Widowed">Widowed</option>
                                            <option value="Separated">Separated</option>
                                        </select>
                                    </div>
                                    <div class="col-md-4 mb-3">
                                        <label class="form-label">Nationality *</label>
                                        <input type="text" class="form-control" name="nationality" value="Filipino" required>
                                    </div>
                                    <div class="col-md-4 mb-3">
                                        <label class="form-label">Mobile Number *</label>
                                        <input type="text" class="form-control" name="mobile_number" placeholder="09123456789" required>
                                    </div>
                                </div>

                                <div class="d-flex justify-content-end mt-4">
                                    <button type="button" class="btn btn-primary btn-lg next-btn">Next Step <i class="fas fa-arrow-right ms-2"></i></button>
                                </div>
                            </div>

                            <div class="step-section" data-step="2">
                                <h4 class="text-primary mb-3"><i class="fas fa-map-marker-alt me-2"></i>Step 2: Complete Address</h4>
                                
                                <div class="mb-3">
                                    <label class="form-label">Street Address / House No. / Building *</label>
                                    <input type="text" class="form-control" name="street_address" required>
                                </div>

                                <div class="row">
                                    <div class="col-md-4 mb-3">
                                        <label class="form-label">Barangay *</label>
                                        <input type="text" class="form-control" name="barangay" required>
                                    </div>
                                    <div class="col-md-4 mb-3">
                                        <label class="form-label">Municipality / City *</label>
                                        <input type="text" class="form-control" name="municipality" required>
                                    </div>
                                    <div class="col-md-4 mb-3">
                                        <label class="form-label">Province *</label>
                                        <input type="text" class="form-control" name="province" required>
                                    </div>
                                </div>

                                <div class="row">
                                    <div class="col-md-4 mb-3">
                                        <label class="form-label">ZIP Code *</label>
                                        <input type="text" class="form-control" name="zip_code" required>
                                    </div>
                                </div>

                                <div class="d-flex justify-content-between mt-4">
                                    <button type="button" class="btn btn-outline-secondary btn-lg prev-btn"><i class="fas fa-arrow-left me-2"></i>Previous</button>
                                    <button type="button" class="btn btn-primary btn-lg next-btn">Next Step <i class="fas fa-arrow-right ms-2"></i></button>
                                </div>
                            </div>

                            <div class="step-section" data-step="3">
                                <h4 class="text-primary mb-3"><i class="fas fa-users me-2"></i>Step 3: Parent Information (Father & Mother)</h4>
                                <p class="text-muted small">Required for SSS, Pag-IBIG, and complete government records.</p>
                                
                                <h5 class="fw-bold text-secondary mt-3">Father's Information</h5>
                                <div class="row">
                                    <div class="col-md-4 mb-3">
                                        <label class="form-label">Father's First Name</label>
                                        <input type="text" class="form-control" name="father_first_name">
                                    </div>
                                    <div class="col-md-4 mb-3">
                                        <label class="form-label">Father's Middle Name</label>
                                        <input type="text" class="form-control" name="father_middle_name">
                                    </div>
                                    <div class="col-md-4 mb-3">
                                        <label class="form-label">Father's Last Name</label>
                                        <input type="text" class="form-control" name="father_last_name">
                                    </div>
                                </div>
                                <div class="row">
                                    <div class="col-md-4 mb-3">
                                        <label class="form-label">Father's Date of Birth</label>
                                        <input type="date" class="form-control" name="father_dob">
                                    </div>
                                </div>

                                <h5 class="fw-bold text-secondary mt-4">Mother's Information</h5>
                                <div class="row">
                                    <div class="col-md-4 mb-3">
                                        <label class="form-label">Mother's First Name</label>
                                        <input type="text" class="form-control" name="mother_first_name">
                                    </div>
                                    <div class="col-md-4 mb-3">
                                        <label class="form-label">Mother's Maiden Middle Name</label>
                                        <input type="text" class="form-control" name="mother_middle_name">
                                    </div>
                                    <div class="col-md-4 mb-3">
                                        <label class="form-label">Mother's Maiden Last Name</label>
                                        <input type="text" class="form-control" name="mother_last_name">
                                    </div>
                                </div>
                                <div class="row">
                                    <div class="col-md-4 mb-3">
                                        <label class="form-label">Mother's Date of Birth</label>
                                        <input type="date" class="form-control" name="mother_dob">
                                    </div>
                                </div>

                                <div class="d-flex justify-content-between mt-4">
                                    <button type="button" class="btn btn-outline-secondary btn-lg prev-btn"><i class="fas fa-arrow-left me-2"></i>Previous</button>
                                    <button type="button" class="btn btn-primary btn-lg next-btn">Next Step <i class="fas fa-arrow-right ms-2"></i></button>
                                </div>
                            </div>

                            <div class="step-section" data-step="4">
                                <h4 class="text-primary mb-3"><i class="fas fa-heart me-2"></i>Step 4: Beneficiary Information</h4>
                                <p class="text-muted small">You can add multiple beneficiaries as required for SSS and Pag-IBIG.</p>

                                <div id="beneficiariesContainer">
                                    <div class="card border mb-3 p-3 beneficiary-card">
                                        <div class="row">
                                            <div class="col-md-4 mb-2">
                                                <label class="form-label">Beneficiary Full Name *</label>
                                                <input type="text" class="form-control" name="ben_full_name[]" required>
                                            </div>
                                            <div class="col-md-3 mb-2">
                                                <label class="form-label">Relationship *</label>
                                                <input type="text" class="form-control" name="ben_relationship[]" placeholder="e.g., Spouse, Child, Parent" required>
                                            </div>
                                            <div class="col-md-3 mb-2">
                                                <label class="form-label">Date of Birth *</label>
                                                <input type="date" class="form-control" name="ben_dob[]" required>
                                            </div>
                                            <div class="col-md-2 mb-2 d-flex align-items-end">
                                                <button type="button" class="btn btn-outline-danger w-100 remove-ben-btn" style="display:none;"><i class="fas fa-trash"></i></button>
                                            </div>
                                        </div>
                                        <div class="row mt-2">
                                            <div class="col-12">
                                                <label class="form-label">Address</label>
                                                <input type="text" class="form-control" name="ben_address[]" placeholder="Complete address">
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <button type="button" id="addBeneficiaryBtn" class="btn btn-outline-success btn-sm mt-2"><i class="fas fa-plus me-1"></i>+ Add Another Beneficiary</button>

                                <div class="d-flex justify-content-between mt-4">
                                    <button type="button" class="btn btn-outline-secondary btn-lg prev-btn"><i class="fas fa-arrow-left me-2"></i>Previous</button>
                                    <button type="button" class="btn btn-primary btn-lg next-btn">Next Step <i class="fas fa-arrow-right ms-2"></i></button>
                                </div>
                            </div>

                            <div class="step-section" data-step="5">
                                <h4 class="text-primary mb-3"><i class="fas fa-briefcase me-2"></i>Step 5: Employment & Spouse Information</h4>
                                
                                <h5 class="fw-bold text-secondary">Employment Information</h5>
                                <div class="row">
                                    <div class="col-md-4 mb-3">
                                        <label class="form-label">Employment Status *</label>
                                        <select class="form-select" name="employment_status" required>
                                            <option value="Employed">Employed</option>
                                            <option value="Self-Employed">Self-Employed</option>
                                            <option value="Unemployed">Unemployed</option>
                                            <option value="OFW">OFW</option>
                                        </select>
                                    </div>
                                    <div class="col-md-4 mb-3">
                                        <label class="form-label">Employer / Business Name</label>
                                        <input type="text" class="form-control" name="employer_name">
                                    </div>
                                    <div class="col-md-4 mb-3">
                                        <label class="form-label">Source of Income</label>
                                        <input type="text" class="form-control" name="source_of_income" placeholder="Salary, Business, Remittance">
                                    </div>
                                </div>

                                <div id="spouseSection" class="mt-4" style="display:none;">
                                    <h5 class="fw-bold text-secondary">Spouse Information</h5>
                                    <div class="row">
                                        <div class="col-md-4 mb-3">
                                            <label class="form-label">Spouse Full Name</label>
                                            <input type="text" class="form-control" name="spouse_full_name">
                                        </div>
                                        <div class="col-md-4 mb-3">
                                            <label class="form-label">Spouse Date of Birth</label>
                                            <input type="date" class="form-control" name="spouse_dob">
                                        </div>
                                    </div>
                                </div>

                                <div class="d-flex justify-content-between mt-4">
                                    <button type="button" class="btn btn-outline-secondary btn-lg prev-btn"><i class="fas fa-arrow-left me-2"></i>Previous</button>
                                    <button type="button" class="btn btn-primary btn-lg next-btn">Next Step <i class="fas fa-arrow-right ms-2"></i></button>
                                </div>
                            </div>

                            <div class="step-section" data-step="6">
                                <h4 class="text-primary mb-3"><i class="fas fa-cloud-upload-alt me-2"></i>Step 6: Document Upload & Camera Capture</h4>
                                <p class="text-muted small">Please upload clear images or PDFs. You can use your device camera directly or upload from your device.</p>
                                
                                <div class="mb-4 p-3 border rounded bg-white">
                                    <label class="form-label fw-bold">Select Valid ID Type *</label>
                                    <select class="form-select mb-3" name="valid_id_type" required>
                                        <option value="National ID">Philippine National ID (PhilSys)</option>
                                        <option value="Driver's License">Driver's License</option>
                                        <option value="Passport">Passport</option>
                                        <option value="SSS UMID">SSS UMID</option>
                                        <option value="Voter's ID">Voter's ID</option>
                                        <option value="Postal ID">Postal ID</option>
                                    </select>

                                    <div class="row">
                                        <div class="col-md-6 mb-3">
                                            <label class="form-label">Valid ID Front Image *</label>
                                            <input type="file" class="form-control mb-2" name="id_front" accept="image/*" required>
                                        </div>
                                        <div class="col-md-6 mb-3">
                                            <label class="form-label">Valid ID Back Image (if applicable)</label>
                                            <input type="file" class="form-control mb-2" name="id_back" accept="image/*">
                                        </div>
                                    </div>
                                </div>

                                <div class="mb-4 p-3 border rounded bg-white">
                                    <label class="form-label fw-bold"><i class="fas fa-camera me-2 text-danger"></i>Photo Holding ID (Required) *</label>
                                    <p class="text-muted small">Please take a picture or upload an image while holding your valid ID clearly near your face.</p>
                                    <input type="file" class="form-control mb-2" name="photo_holding_id" accept="image/*" capture="user" required>
                                </div>

                                <div class="mb-4 p-3 border rounded bg-white">
                                    <label class="form-label fw-bold">ID Picture (2x2 or Passport Size)</label>
                                    <input type="file" class="form-control mb-2" name="id_picture" accept="image/*">
                                </div>

                                <div id="marriageCertUploadSection" class="mb-4 p-3 border rounded bg-white" style="display:none;">
                                    <label class="form-label fw-bold text-danger">Marriage Certificate (Multiple files/pages allowed) *</label>
                                    <p class="text-muted small">Since you are married, please upload clear images or PDF copies of your Marriage Certificate.</p>
                                    <input type="file" class="form-control mb-2" name="marriage_certificate" accept="image/*,application/pdf" multiple>
                                </div>

                                <div class="d-flex justify-content-between mt-4">
                                    <button type="button" class="btn btn-outline-secondary btn-lg prev-btn"><i class="fas fa-arrow-left me-2"></i>Previous</button>
                                    <button type="button" class="btn btn-primary btn-lg next-btn">Next Step <i class="fas fa-arrow-right ms-2"></i></button>
                                </div>
                            </div>

                            <div class="step-section" data-step="7">
                                <h4 class="text-primary mb-3"><i class="fas fa-wallet me-2"></i>Step 7: Payment & Service Fee</h4>
                                
                                <div class="alert alert-info">
                                    <h5><i class="fas fa-info-circle me-2"></i>Payment Instructions</h5>
                                    <p class="mb-1">Service assistance fee must be settled before processing begins.</p>
                                    <p class="mb-0"><strong>GCash Name:</strong> ${settings.gcash_name} | <strong>GCash Number:</strong> ${settings.gcash_number}</p>
                                </div>

                                <div class="mb-3">
                                    <label class="form-label fw-bold">Select Payment Method *</label>
                                    <select class="form-select form-select-lg" name="payment_method" id="paymentMethod" required>
                                        <option value="GCash">GCash</option>
                                        <option value="Cash">Cash (Pay according to instructions provided by Admin)</option>
                                    </select>
                                </div>

                                <div id="gcashPaymentDetails" class="p-3 border rounded bg-white mb-3">
                                    <h6 class="fw-bold text-primary">Scan GCash QR to Pay</h6>
                                    ${settings.gcash_qr ? `<img src="${settings.gcash_qr}" class="img-fluid mb-3" style="max-height:200px;" alt="GCash QR">` : `<p class="text-muted">GCash QR code configured by admin.</p>`}
                                    
                                    <div class="row">
                                        <div class="col-md-6 mb-3">
                                            <label class="form-label">GCash Reference Number *</label>
                                            <input type="text" class="form-control" name="gcash_ref_number" placeholder="e.g., 1029384756">
                                        </div>
                                        <div class="col-md-6 mb-3">
                                            <label class="form-label">Payment Date *</label>
                                            <input type="date" class="form-control" name="gcash_payment_date">
                                        </div>
                                    </div>
                                    <div class="mb-3">
                                        <label class="form-label">Upload GCash Payment Screenshot / Receipt *</label>
                                        <input type="file" class="form-control" name="gcash_receipt" accept="image/*">
                                    </div>
                                </div>

                                <div class="d-flex justify-content-between mt-4">
                                    <button type="button" class="btn btn-outline-secondary btn-lg prev-btn"><i class="fas fa-arrow-left me-2"></i>Previous</button>
                                    <button type="button" class="btn btn-primary btn-lg next-btn">Review Application <i class="fas fa-arrow-right ms-2"></i></button>
                                </div>
                            </div>

                            <div class="step-section" data-step="8">
                                <h4 class="text-primary mb-3"><i class="fas fa-check-double me-2"></i>Step 8: Review & Submit Application</h4>
                                <p class="text-muted">Please review all information before final submission.</p>

                                <div class="card p-3 bg-light mb-4">
                                    <p class="mb-1"><strong>Service:</strong> <span id="reviewService">-</span></p>
                                    <p class="mb-1"><strong>Full Name:</strong> <span id="reviewName">-</span></p>
                                    <p class="mb-1"><strong>Mobile:</strong> <span id="reviewMobile">-</span></p>
                                    <p class="mb-1"><strong>Civil Status:</strong> <span id="reviewCivilStatus">-</span></p>
                                    <p class="mb-0"><strong>Payment Method:</strong> <span id="reviewPaymentMethod">-</span></p>
                                </div>

                                <div class="form-check mb-4">
                                    <input class="form-check-input" type="checkbox" id="confirmCheck" required>
                                    <label class="form-check-label fw-bold" for="confirmCheck">
                                        I confirm that the information I provided is correct and complete, and I understand this is an independent assistance service.
                                    </label>
                                </div>

                                <div class="d-flex justify-content-between mt-4">
                                    <button type="button" class="btn btn-outline-secondary btn-lg prev-btn"><i class="fas fa-arrow-left me-2"></i>Previous</button>
                                    <button type="submit" class="btn btn-success btn-lg fw-bold px-5"><i class="fas fa-paper-plane me-2"></i>Submit Application</button>
                                </div>
                            </div>

                        </form>
                    </div>
                </div>
            </div>
        </div>

        <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
        <script>
            let currentStep = 1;
            const totalSteps = 8;

            function updateSteps() {
                document.querySelectorAll('.step-section').forEach(el => {
                    el.classList.remove('active');
                    if (parseInt(el.dataset.step) === currentStep) {
                        el.classList.add('active');
                    }
                });
                const progressPercent = (currentStep / totalSteps) * 100;
                document.getElementById('progressBar').style.width = progressPercent + '%';

                if (currentStep === 8) {
                    document.getElementById('reviewService').innerText = document.getElementById('serviceType').value;
                    document.getElementById('reviewName').innerText = document.querySelector('[name="first_name"]').value + ' ' + document.querySelector('[name="last_name"]').value;
                    document.getElementById('reviewMobile').innerText = document.querySelector('[name="mobile_number"]').value;
                    document.getElementById('reviewCivilStatus').innerText = document.getElementById('civilStatus').value;
                    document.getElementById('reviewPaymentMethod').innerText = document.getElementById('paymentMethod').value;
                }
            }

            document.querySelectorAll('.next-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const activeSec = document.querySelector('.step-section.active');
                    const inputs = activeSec.querySelectorAll('input[required], select[required]');
                    let valid = true;
                    inputs.forEach(inp => {
                        if (!inp.value) {
                            valid = false;
                            inp.classList.add('is-invalid');
                        } else {
                            inp.classList.remove('is-invalid');
                        }
                    });

                    if (!valid) {
                        alert('Please fill out all required fields in this step.');
                        return;
                    }

                    if (currentStep < totalSteps) {
                        currentStep++;
                        updateSteps();
                        window.scrollTo(0,0);
                    }
                });
            });

            document.querySelectorAll('.prev-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    if (currentStep > 1) {
                        currentStep--;
                        updateSteps();
                        window.scrollTo(0,0);
                    }
                });
            });

            document.getElementById('civilStatus').addEventListener('change', (e) => {
                const val = e.target.value;
                const spouseSec = document.getElementById('spouseSection');
                const marriageUpload = document.getElementById('marriageCertUploadSection');
                if (val === 'Married') {
                    spouseSec.style.display = 'block';
                    marriageUpload.style.display = 'block';
                } else {
                    spouseSec.style.display = 'none';
                    marriageUpload.style.display = 'none';
                }
            });

            document.getElementById('paymentMethod').addEventListener('change', (e) => {
                const gcashDetails = document.getElementById('gcashPaymentDetails');
                if (e.target.value === 'GCash') {
                    gcashDetails.style.display = 'block';
                } else {
                    gcashDetails.style.display = 'none';
                }
            });

            document.getElementById('addBeneficiaryBtn').addEventListener('click', () => {
                const container = document.getElementById('beneficiariesContainer');
                const firstCard = container.querySelector('.beneficiary-card');
                const clone = firstCard.cloneNode(true);
                clone.querySelectorAll('input').forEach(i => i.value = '');
                clone.querySelector('.remove-ben-btn').style.display = 'block';
                clone.querySelector('.remove-ben-btn').addEventListener('click', () => clone.remove());
                container.appendChild(clone);
            });
        </script>
    </body>
    </html>
  `);
});

// Handle Application Submission Post
app.post('/customer/apply', requireCustomerAuth, upload.any(), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userId = req.session.userId;
    const {
      service_type, first_name, middle_name, last_name, suffix, dob, place_of_birth,
      sex, civil_status, nationality, mobile_number, street_address, barangay,
      municipality, province, zip_code, father_first_name, father_middle_name,
      father_last_name, father_dob, mother_first_name, mother_middle_name,
      mother_last_name, mother_dob, employment_status, employer_name,
      source_of_income, spouse_full_name, spouse_dob, valid_id_type,
      payment_method, gcash_ref_number, gcash_payment_date
    } = req.body;

    const tracking_number = await generateTrackingNumber(service_type);

    const feeRes = await client.query('SELECT value FROM system_settings WHERE key = $1', [`fee_${service_type.toLowerCase()}`]);
    const fee = feeRes.rows.length > 0 ? parseFloat(feeRes.rows[0].value) : 350.00;

    const appRes = await client.query(`
      INSERT INTO applications (
        user_id, tracking_number, service_type, status, payment_status, fee,
        personal_info, address_info, parents_info, spouse_info, employment_info
      ) VALUES ($1, $2, $3, 'Submitted', 'Unpaid', $4, $5, $6, $7, $8, $9)
      RETURNING id;
    `, [
      userId, tracking_number, service_type, fee,
      JSON.stringify({ first_name, middle_name, last_name, suffix, dob, place_of_birth, sex, civil_status, nationality, mobile_number }),
      JSON.stringify({ street_address, barangay, municipality, province, zip_code }),
      JSON.stringify({ father: { first_name: father_first_name, middle_name: father_middle_name, last_name: father_last_name, dob: father_dob }, mother: { first_name: mother_first_name, middle_name: mother_middle_name, last_name: mother_last_name, dob: mother_dob } }),
      JSON.stringify({ full_name: spouse_full_name, dob: spouse_dob }),
      JSON.stringify({ employment_status, employer_name, source_of_income })
    ]);

    const appId = appRes.rows[0].id;

    if (req.body.ben_full_name) {
      const benNames = Array.isArray(req.body.ben_full_name) ? req.body.ben_full_name : [req.body.ben_full_name];
      const benRels = Array.isArray(req.body.ben_relationship) ? req.body.ben_relationship : [req.body.ben_relationship];
      const benDobs = Array.isArray(req.body.ben_dob) ? req.body.ben_dob : [req.body.ben_dob];
      const benAddrs = Array.isArray(req.body.ben_address) ? req.body.ben_address : [req.body.ben_address];

      for (let i = 0; i < benNames.length; i++) {
        if (benNames[i]) {
          await client.query(`
            INSERT INTO beneficiaries (application_id, full_name, relationship, date_of_birth, address)
            VALUES ($1, $2, $3, $4, $5)
          `, [appId, benNames[i], benRels[i], benDobs[i] || null, benAddrs[i] || '']);
        }
      }
    }

    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        await client.query(`
          INSERT INTO documents (application_id, document_type, file_name, file_data, mime_type)
          VALUES ($1, $2, $3, $4, $5)
        `, [appId, file.fieldname, file.originalname, file.buffer, file.mimetype]);
      }
    }

    let payStatus = 'Unpaid';
    if (payment_method === 'GCash' && gcash_ref_number) {
      payStatus = 'Payment Submitted';
    }

    await client.query(`
      INSERT INTO payments (application_id, payment_method, amount, reference_number, payment_date, status)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [appId, payment_method, fee, gcash_ref_number || null, gcash_payment_date || null, payStatus]);

    if (payStatus === 'Payment Submitted') {
      await client.query('UPDATE applications SET payment_status = $1 WHERE id = $2', ['Payment Submitted', appId]);
    }

    await client.query(`
      INSERT INTO status_history (application_id, previous_status, new_status, changed_by, remarks)
      VALUES ($1, NULL, 'Submitted', 'Customer', 'Application successfully submitted.')
    `, [appId]);

    await addNotification(userId, 'Application Submitted', `Your ${service_type} application (${tracking_number}) has been successfully submitted.`);

    await client.query('COMMIT');
    res.send(`<script>alert('Application submitted successfully! Tracking Number: ${tracking_number}'); window.location='/customer/dashboard';</script>`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).send('Error processing application submission.');
  } finally {
    client.release();
  }
});

// View Individual Customer Application Detail & Tracker
app.get('/customer/application/:id', requireCustomerAuth, async (req, res) => {
  const appId = req.params.id;
  const userId = req.session.userId;

  const appRes = await pool.query('SELECT * FROM applications WHERE id = $1 AND user_id = $2', [appId, userId]);
  if (appRes.rows.length === 0) {
    return res.status(404).send('Application not found or unauthorized.');
  }
  const appData = appRes.rows[0];

  const docsRes = await pool.query('SELECT id, document_type, file_name, verified, created_at FROM documents WHERE application_id = $1', [appId]);
  const documents = docsRes.rows;

  const completedDocsRes = await pool.query('SELECT id, file_name, document_type, created_at FROM completed_documents WHERE application_id = $1', [appId]);
  const completedDocuments = completedDocsRes.rows;

  const historyRes = await pool.query('SELECT * FROM status_history WHERE application_id = $1 ORDER BY created_at DESC', [appId]);
  const history = historyRes.rows;

  const notesRes = await pool.query('SELECT * FROM application_notes WHERE application_id = $1 AND note_type = $2 ORDER BY created_at DESC', [appId, 'customer_visible']);
  const remarks = notesRes.rows;

  const paymentRes = await pool.query('SELECT * FROM payments WHERE application_id = $1', [appId]);
  const payment = paymentRes.rows[0];

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Application Tracking - ${appData.tracking_number}</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    </head>
    <body class="bg-light">
        <nav class="navbar navbar-expand-lg navbar-dark bg-primary">
            <div class="container-fluid">
                <a class="navbar-brand fw-bold" href="/customer/dashboard"><i class="fas fa-arrow-left me-2"></i>Back to Dashboard</a>
            </div>
        </nav>

        <div class="container my-4">
            <div class="row">
                <div class="col-lg-8">
                    <div class="card shadow-sm border-0 rounded-4 p-4 mb-4">
                        <div class="d-flex justify-content-between align-items-center mb-3">
                            <h3 class="fw-bold text-primary mb-0">${appData.tracking_number}</h3>
                            <span class="badge bg-info text-dark fs-6">${appData.status}</span>
                        </div>
                        <p class="text-muted">Service: <strong>${appData.service_type} Assistance</strong> | Submitted on: ${new Date(appData.created_at).toLocaleString()}</p>
                        
                        <hr>

                        <h5 class="fw-bold mb-3">Application Progress</h5>
                        <div class="row text-center mb-4">
                            <div class="col">
                                <div class="p-2 rounded ${['Submitted', 'Under Review', 'Need Correction', 'Processing', 'Ready', 'Completed'].includes(appData.status) ? 'bg-primary text-white' : 'bg-light'}">Submitted</div>
                            </div>
                            <div class="col">
                                <div class="p-2 rounded ${['Under Review', 'Processing', 'Ready', 'Completed'].includes(appData.status) ? 'bg-primary text-white' : 'bg-light'}">Under Review</div>
                            </div>
                            <div class="col">
                                <div class="p-2 rounded ${['Processing', 'Ready', 'Completed'].includes(appData.status) ? 'bg-primary text-white' : 'bg-light'}">Processing</div>
                            </div>
                            <div class="col">
                                <div class="p-2 rounded ${['Ready', 'Completed'].includes(appData.status) ? 'bg-success text-white' : 'bg-light'}">Ready</div>
                            </div>
                            <div class="col">
                                <div class="p-2 rounded ${appData.status === 'Completed' ? 'bg-success text-white' : 'bg-light'}">Completed</div>
                            </div>
                        </div>

                        ${remarks.length > 0 ? `
                            <div class="alert alert-warning">
                                <h5 class="alert-heading fw-bold"><i class="fas fa-bullhorn me-2"></i>Admin Remarks & Correction Requests</h5>
                                ${remarks.map(r => `<p class="mb-1">${r.message} <small class="text-muted">(${new Date(r.created_at).toLocaleString()})</small></p>`).join('')}
                            </div>
                        ` : ''}

                        <div class="card bg-light border-0 p-3 mb-4">
                            <h5 class="fw-bold text-success"><i class="fas fa-file-download me-2"></i>My Completed Government Documents</h5>
                            ${completedDocuments.length === 0 ? `
                                <p class="text-muted small mb-0">No completed documents uploaded by admin yet. They will appear here once ready.</p>
                            ` : `
                                <ul class="list-group">
                                    ${completedDocuments.map(cd => `
                                        <li class="list-group-item d-flex justify-content-between align-items-center">
                                            <div>
                                                <strong>${cd.file_name}</strong>
                                                <small class="text-muted d-block">${cd.document_type} - Uploaded on ${new Date(cd.created_at).toLocaleDateString()}</small>
                                            </div>
                                            <a href="/customer/download/completed/${cd.id}" class="btn btn-sm btn-success"><i class="fas fa-download me-1"></i>Download</a>
                                        </li>
                                    `).join('')}
                                </ul>
                            `}
                        </div>

                        <h5 class="fw-bold mb-3">Uploaded Documents</h5>
                        <ul class="list-group mb-4">
                            ${documents.map(doc => `
                                <li class="list-group-item d-flex justify-content-between align-items-center">
                                    <div>
                                        <strong>${doc.document_type}</strong>: ${doc.file_name}
                                        <span class="badge bg-${doc.verified ? 'success' : 'secondary'} ms-2">${doc.verified ? 'Verified' : 'Pending Verification'}</span>
                                    </div>
                                    <a href="/customer/download/document/${doc.id}" class="btn btn-sm btn-outline-primary"><i class="fas fa-download"></i></a>
                                </li>
                            `).join('')}
                        </ul>
                    </div>
                </div>

                <div class="col-lg-4">
                    <div class="card shadow-sm border-0 rounded-4 p-4 mb-4">
                        <h5 class="fw-bold text-primary mb-3"><i class="fas fa-wallet me-2"></i>Payment Information</h5>
                        <p class="mb-1"><strong>Service Fee:</strong> ₱${appData.fee}</p>
                        <p class="mb-1"><strong>Method:</strong> ${payment ? payment.payment_method : '-'}</p>
                        <p class="mb-3"><strong>Payment Status:</strong> <span class="badge bg-${appData.payment_status === 'Paid' ? 'success' : 'warning text-dark'}">${appData.payment_status}</span></p>
                        
                        ${payment && payment.payment_method === 'GCash' && appData.payment_status === 'Unpaid' ? `
                            <form action="/customer/payment/${appData.id}" method="POST" enctype="multipart/form-data">
                                <div class="mb-2">
                                    <label class="form-label small">GCash Reference Number</label>
                                    <input type="text" class="form-control form-control-sm" name="reference_number" required>
                                </div>
                                <div class="mb-2">
                                    <label class="form-label small">Upload Receipt</label>
                                    <input type="file" class="form-control form-control-sm" name="proof" accept="image/*" required>
                                </div>
                                <button type="submit" class="btn btn-primary btn-sm w-100">Submit Payment Proof</button>
                            </form>
                        ` : ''}
                    </div>

                    <div class="card shadow-sm border-0 rounded-4 p-4">
                        <h5 class="fw-bold text-primary mb-3"><i class="fas fa-history me-2"></i>Application History</h5>
                        <ul class="list-unstyled mb-0">
                            ${history.map(h => `
                                <li class="mb-3 border-bottom pb-2">
                                    <small class="text-muted d-block">${new Date(h.created_at).toLocaleString()}</small>
                                    <strong>${h.new_status}</strong> <span class="small text-muted">by ${h.changed_by}</span>
                                    ${h.remarks ? `<p class="small text-secondary mb-0">${h.remarks}</p>` : ''}
                                </li>
                            `).join('')}
                        </ul>
                    </div>
                </div>
            </div>
        </div>

        <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
    </body>
    </html>
  `);
});

// Customer Document & File Downloads
app.get('/customer/download/document/:id', requireCustomerAuth, async (req, res) => {
  const docRes = await pool.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
  if (docRes.rows.length === 0) return res.status(404).send('Document not found.');
  const doc = docRes.rows[0];
  res.setHeader('Content-Type', doc.mime_type);
  res.setHeader('Content-Disposition', `attachment; filename="${doc.file_name}"`);
  res.send(doc.file_data);
});

app.get('/customer/download/completed/:id', requireCustomerAuth, async (req, res) => {
  const docRes = await pool.query('SELECT * FROM completed_documents WHERE id = $1', [req.params.id]);
  if (docRes.rows.length === 0) return res.status(404).send('Document not found.');
  const doc = docRes.rows[0];
  res.setHeader('Content-Type', doc.mime_type);
  res.setHeader('Content-Disposition', `attachment; filename="${doc.file_name}"`);
  res.send(doc.file_data);
});

// Customer submit payment proof post
app.post('/customer/payment/:id', requireCustomerAuth, upload.single('proof'), async (req, res) => {
  const appId = req.params.id;
  const { reference_number } = req.body;
  const file = req.file;

  if (!file) return res.status(400).send('Payment proof image required.');

  await pool.query(`
    UPDATE payments SET reference_number = $1, proof_file_name = $2, proof_file_data = $3, proof_mime_type = $4, status = 'Payment Submitted'
    WHERE application_id = $5
  `, [reference_number, file.originalname, file.buffer, file.mimetype, appId]);

  await pool.query('UPDATE applications SET payment_status = $1 WHERE id = $2', ['Payment Submitted', appId]);
  
  await logStatusHistory(appId, 'Unpaid', 'Payment Submitted', 'Customer', 'GCash payment proof submitted.');
  res.redirect(`/customer/application/${appId}`);
});

// ==========================================
// ADMIN PORTAL ROUTES & MANAGEMENT
// ==========================================
app.get('/admin/dashboard', requireAdminAuth, async (req, res) => {
  const statsRes = await pool.query(`
    SELECT 
      COUNT(*) AS total,
      SUM(CASE WHEN service_type = 'TIN' THEN 1 ELSE 0 END) AS tin_count,
      SUM(CASE WHEN service_type = 'SSS' THEN 1 ELSE 0 END) AS sss_count,
      SUM(CASE WHEN service_type = 'PAGIBIG' THEN 1 ELSE 0 END) AS pagibig_count,
      SUM(CASE WHEN status = 'Submitted' THEN 1 ELSE 0 END) AS pending_count,
      SUM(CASE WHEN status = 'Processing' THEN 1 ELSE 0 END) AS processing_count,
      SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) AS completed_count,
      SUM(CASE WHEN status = 'Need Correction' THEN 1 ELSE 0 END) AS correction_count,
      SUM(CASE WHEN payment_status = 'Paid' THEN fee ELSE 0 END) AS total_revenue
    FROM applications;
  `);
  const stats = statsRes.rows[0];

  const search = req.query.search || '';
  const serviceFilter = req.query.service || '';
  const statusFilter = req.query.status || '';

  let query = `
    SELECT a.*, u.full_name as customer_name, u.mobile_number, u.email 
    FROM applications a 
    JOIN users u ON a.user_id = u.id 
    WHERE 1=1
  `;
  const params = [];
  let paramIdx = 1;

  if (search) {
    query += ` AND (u.full_name ILIKE $${paramIdx} OR a.tracking_number ILIKE $${paramIdx} OR u.mobile_number ILIKE $${paramIdx} OR u.email ILIKE $${paramIdx})`;
    params.push(`%${search}%`);
    paramIdx++;
  }
  if (serviceFilter) {
    query += ` AND a.service_type = $${paramIdx}`;
    params.push(serviceFilter);
    paramIdx++;
  }
  if (statusFilter) {
    query += ` AND a.status = $${paramIdx}`;
    params.push(statusFilter);
    paramIdx++;
  }

  query += ` ORDER BY a.created_at DESC`;

  const appsRes = await pool.query(query, params);
  const applications = appsRes.rows;

  const settingsRes = await pool.query('SELECT key, value FROM system_settings');
  const settings = {};
  settingsRes.rows.forEach(r => settings[r.key] = r.value);

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Admin Dashboard - GovAssists PH</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
            .sidebar { min-height: 100vh; background: #212529; color: white; }
            .sidebar a { color: #adb5bd; text-decoration: none; display: block; padding: 10px 15px; border-radius: 4px; margin-bottom: 5px; }
            .sidebar a:hover, .sidebar a.active { background: #0d6efd; color: white; }
        </style>
    </head>
    <body class="bg-light">
        <div class="container-fluid">
            <div class="row">
                <div class="col-md-2 sidebar p-3 d-none d-md-block">
                    <h4 class="fw-bold text-white mb-4"><i class="fas fa-shield-alt me-2"></i>Admin Panel</h4>
                    <a href="/admin/dashboard" class="active"><i class="fas fa-chart-line me-2"></i>Dashboard</a>
                    <a href="/admin/reports"><i class="fas fa-file-excel me-2"></i>Reports & Export</a>
                    <a href="/admin/settings"><i class="fas fa-cogs me-2"></i>Settings & Fees</a>
                    <hr class="text-secondary">
                    <a href="/admin/logout" class="text-danger"><i class="fas fa-sign-out-alt me-2"></i>Logout</a>
                </div>

                <div class="col-md-10 p-4">
                    <div class="d-flex justify-content-between align-items-center mb-4">
                        <h2>Dashboard Overview</h2>
                        <a href="/admin/logout" class="btn btn-outline-danger d-md-none"><i class="fas fa-sign-out-alt me-1"></i>Logout</a>
                    </div>

                    <div class="row text-white mb-4">
                        <div class="col-md-3 mb-3">
                            <div class="card bg-primary p-3 rounded-4 border-0 shadow-sm">
                                <h5>Total Applications</h5>
                                <h3>${stats.total || 0}</h3>
                            </div>
                        </div>
                        <div class="col-md-3 mb-3">
                            <div class="card bg-warning text-dark p-3 rounded-4 border-0 shadow-sm">
                                <h5>Pending Review</h5>
                                <h3>${stats.pending_count || 0}</h3>
                            </div>
                        </div>
                        <div class="col-md-3 mb-3">
                            <div class="card bg-info text-dark p-3 rounded-4 border-0 shadow-sm">
                                <h5>Processing</h5>
                                <h3>${stats.processing_count || 0}</h3>
                            </div>
                        </div>
                        <div class="col-md-3 mb-3">
                            <div class="card bg-success p-3 rounded-4 border-0 shadow-sm">
                                <h5>Total Collected Revenue</h5>
                                <h3>₱${parseFloat(stats.total_revenue || 0).toLocaleString()}</h3>
                            </div>
                        </div>
                    </div>

                    <div class="card shadow-sm border-0 rounded-4 p-3 mb-4">
                        <form method="GET" action="/admin/dashboard" class="row g-3">
                            <div class="col-md-4">
                                <input type="text" class="form-control" name="search" placeholder="Search name, tracking #, mobile..." value="${search}">
                            </div>
                            <div class="col-md-3">
                                <select class="form-select" name="service">
                                    <option value="">All Services</option>
                                    <option value="TIN" ${serviceFilter === 'TIN' ? 'selected' : ''}>TIN</option>
                                    <option value="SSS" ${serviceFilter === 'SSS' ? 'selected' : ''}>SSS</option>
                                    <option value="PAGIBIG" ${serviceFilter === 'PAGIBIG' ? 'selected' : ''}>Pag-IBIG</option>
                                </select>
                            </div>
                            <div class="col-md-3">
                                <select class="form-select" name="status">
                                    <option value="">All Statuses</option>
                                    <option value="Submitted" ${statusFilter === 'Submitted' ? 'selected' : ''}>Submitted</option>
                                    <option value="Under Review" ${statusFilter === 'Under Review' ? 'selected' : ''}>Under Review</option>
                                    <option value="Need Correction" ${statusFilter === 'Need Correction' ? 'selected' : ''}>Need Correction</option>
                                    <option value="Processing" ${statusFilter === 'Processing' ? 'selected' : ''}>Processing</option>
                                    <option value="Ready" ${statusFilter === 'Ready' ? 'selected' : ''}>Ready</option>
                                    <option value="Completed" ${statusFilter === 'Completed' ? 'selected' : ''}>Completed</option>
                                </select>
                            </div>
                            <div class="col-md-2">
                                <button type="submit" class="btn btn-primary w-100"><i class="fas fa-filter me-1"></i>Filter</button>
                            </div>
                        </form>
                    </div>

                    <div class="card shadow-sm border-0 rounded-4">
                        <div class="card-header bg-white py-3 fw-bold"><i class="fas fa-list me-2 text-primary"></i>All Applications Management</div>
                        <div class="card-body p-0">
                            <div class="table-responsive">
                                <table class="table table-hover align-middle mb-0">
                                    <thead class="table-light">
                                        <tr>
                                            <th>Tracking #</th>
                                            <th>Applicant Name</th>
                                            <th>Service</th>
                                            <th>Date</th>
                                            <th>Status</th>
                                            <th>Payment</th>
                                            <th>Action</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${applications.length === 0 ? `
                                            <tr><td colspan="7" class="text-center py-4 text-muted">No applications found matching criteria.</td></tr>
                                        ` : applications.map(app => `
                                            <tr>
                                                <td><strong>${app.tracking_number}</strong></td>
                                                <td><a href="/admin/application/${app.id}" class="text-decoration-none fw-bold">${app.customer_name}</a><small class="d-block text-muted">${app.mobile_number}</small></td>
                                                <td><span class="badge bg-secondary">${app.service_type}</span></td>
                                                <td>${new Date(app.created_at).toLocaleDateString()}</td>
                                                <td><span class="badge bg-info text-dark">${app.status}</span></td>
                                                <td><span class="badge bg-${app.payment_status === 'Paid' ? 'success' : 'warning text-dark'}">${app.payment_status}</span></td>
                                                <td>
                                                    <a href="/admin/application/${app.id}" class="btn btn-sm btn-primary"><i class="fas fa-user-edit me-1"></i>Review Profile</a>
                                                </td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
    </body>
    </html>
  `);
});

// Admin Application Detailed Profile & Management View
app.get('/admin/application/:id', requireAdminAuth, async (req, res) => {
  const appId = req.params.id;

  const appRes = await pool.query(`
    SELECT a.*, u.full_name as customer_name, u.mobile_number, u.email, u.username 
    FROM applications a 
    JOIN users u ON a.user_id = u.id 
    WHERE a.id = $1
  `, [appId]);
  if (appRes.rows.length === 0) return res.status(404).send('Application not found.');
  const appData = appRes.rows[0];

  const benRes = await pool.query('SELECT * FROM beneficiaries WHERE application_id = $1', [appId]);
  const beneficiaries = benRes.rows;

  const docsRes = await pool.query('SELECT * FROM documents WHERE application_id = $1', [appId]);
  const documents = docsRes.rows;

  const completedDocsRes = await pool.query('SELECT * FROM completed_documents WHERE application_id = $1', [appId]);
  const completedDocuments = completedDocsRes.rows;

  const paymentRes = await pool.query('SELECT * FROM payments WHERE application_id = $1', [appId]);
  const payment = paymentRes.rows[0];

  const historyRes = await pool.query('SELECT * FROM status_history WHERE application_id = $1 ORDER BY created_at DESC', [appId]);
  const history = historyRes.rows;

  const notesRes = await pool.query('SELECT * FROM application_notes WHERE application_id = $1 ORDER BY created_at DESC', [appId]);
  const notes = notesRes.rows;

  res.send(`<!DOCTYPE html>...`); // (Natira ang natitirang bahagi ng iyong code sa ibaba nito kung mayroon man)
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
