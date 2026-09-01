/**
 * COMPLETE BIR/TIN, SSS & PAG-IBIG APPLICATION ASSISTANCE SYSTEM
 * Production-Ready Single-File Architecture (app.js)
 * Implements Express Backend, PostgreSQL Storage, Authentication, Customer/Admin Portals,
 * Multi-Step Forms, Camera Capture, File Management, GCash/Cash Payments, Notifications, and Reports.
 */

const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple');
const session = require('express-session'); 
const bcrypt = require('bcrypt');
const multer = require('multer');
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

// Initialize Express App
const app = express();
const PORT = process.env.PORT || 3000;

// Ensure upload directories exist
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Database Connection via Environment Variable (Render PostgreSQL)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Configure Multer for Secure File Uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_'));
    }
});

const fileFilter = (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Only JPEG, PNG, and PDF files are allowed.'), false);
    }
};

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: fileFilter
});

// Middleware Setup
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));
app.use('/uploads', express.static(uploadDir));

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
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true
    }
}));

// ==========================================
// DATABASE INITIALIZATION & SCHEMA MIGRATION
// ==========================================
async function initDatabase() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Users (Customers)
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
                key VARCHAR(100) PRIMARY KEY,
                value TEXT
            );
        `);

        // Applications
        await client.query(`
            CREATE TABLE IF NOT EXISTS applications (
                id SERIAL PRIMARY KEY,
                tracking_number VARCHAR(100) UNIQUE NOT NULL,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                service_type VARCHAR(50) NOT NULL,
                status VARCHAR(50) DEFAULT 'Submitted',
                payment_status VARCHAR(50) DEFAULT 'Unpaid',
                payment_method VARCHAR(50) DEFAULT 'Unspecified',
                payment_fee NUMERIC(10,2) DEFAULT 0.00,
                payment_ref VARCHAR(255),
                payment_date TIMESTAMP,
                payment_proof VARCHAR(255),
                admin_notes TEXT,
                customer_remarks TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Personal Information
        await client.query(`
            CREATE TABLE IF NOT EXISTS personal_information (
                id SERIAL PRIMARY KEY,
                application_id INTEGER REFERENCES applications(id) ON DELETE CASCADE,
                first_name VARCHAR(100),
                middle_name VARCHAR(100),
                last_name VARCHAR(100),
                suffix VARCHAR(20),
                date_of_birth DATE,
                place_of_birth VARCHAR(255),
                sex VARCHAR(20),
                civil_status VARCHAR(50),
                nationality VARCHAR(100),
                mobile_number VARCHAR(50),
                email_address VARCHAR(255),
                complete_address TEXT,
                barangay VARCHAR(100),
                municipality_city VARCHAR(100),
                province VARCHAR(100),
                zip_code VARCHAR(20)
            );
        `);

        // Parent Information
        await client.query(`
            CREATE TABLE IF NOT EXISTS parent_information (
                id SERIAL PRIMARY KEY,
                application_id INTEGER REFERENCES applications(id) ON DELETE CASCADE,
                father_first_name VARCHAR(100),
                father_middle_name VARCHAR(100),
                father_last_name VARCHAR(100),
                father_dob DATE,
                mother_first_name VARCHAR(100),
                mother_middle_name VARCHAR(100),
                mother_maiden_name VARCHAR(100),
                mother_last_name VARCHAR(100),
                mother_dob DATE
            );
        `);

        // Beneficiaries
        await client.query(`
            CREATE TABLE IF NOT EXISTS beneficiaries (
                id SERIAL PRIMARY KEY,
                application_id INTEGER REFERENCES applications(id) ON DELETE CASCADE,
                full_name VARCHAR(255),
                relationship VARCHAR(100),
                date_of_birth DATE,
                address TEXT
            );
        `);

        // Spouse Information
        await client.query(`
            CREATE TABLE IF NOT EXISTS spouse_information (
                id SERIAL PRIMARY KEY,
                application_id INTEGER REFERENCES applications(id) ON DELETE CASCADE,
                spouse_full_name VARCHAR(255),
                spouse_dob DATE,
                spouse_occupation VARCHAR(100)
            );
        `);

        // Employment Information
        await client.query(`
            CREATE TABLE IF NOT EXISTS employment_information (
                id SERIAL PRIMARY KEY,
                application_id INTEGER REFERENCES applications(id) ON DELETE CASCADE,
                employment_status VARCHAR(100),
                employer_name VARCHAR(255),
                employer_address TEXT,
                employer_contact VARCHAR(100),
                source_of_income VARCHAR(255),
                monthly_income NUMERIC(12,2)
            );
        `);

        // Documents
        await client.query(`
            CREATE TABLE IF NOT EXISTS documents (
                id SERIAL PRIMARY KEY,
                application_id INTEGER REFERENCES applications(id) ON DELETE CASCADE,
                document_type VARCHAR(100) NOT NULL,
                file_path VARCHAR(255) NOT NULL,
                original_name VARCHAR(255),
                verified BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Completed Admin Documents
        await client.query(`
            CREATE TABLE IF NOT EXISTS completed_documents (
                id SERIAL PRIMARY KEY,
                application_id INTEGER REFERENCES applications(id) ON DELETE CASCADE,
                file_path VARCHAR(255) NOT NULL,
                original_name VARCHAR(255),
                document_type VARCHAR(100) DEFAULT 'Completed Government Document',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Status History
        await client.query(`
            CREATE TABLE IF NOT EXISTS status_history (
                id SERIAL PRIMARY KEY,
                application_id INTEGER REFERENCES applications(id) ON DELETE CASCADE,
                previous_status VARCHAR(50),
                new_status VARCHAR(50) NOT NULL,
                actor VARCHAR(100) NOT NULL,
                remarks TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Notifications
        await client.query(`
            CREATE TABLE IF NOT EXISTS notifications (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                title VARCHAR(255) NOT NULL,
                message TEXT NOT NULL,
                is_read BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Application Checklist
        await client.query(`
            CREATE TABLE IF NOT EXISTS application_checklists (
                id SERIAL PRIMARY KEY,
                application_id INTEGER REFERENCES applications(id) ON DELETE CASCADE,
                item_name VARCHAR(255) NOT NULL,
                is_verified BOOLEAN DEFAULT FALSE
            );
        `);

        await client.query('COMMIT');

        // Seed Default Admin Account if none exists
        const adminCheck = await client.query('SELECT * FROM admin_users LIMIT 1');
        if (adminCheck.rows.length === 0) {
            const defaultPass = process.env.ADMIN_DEFAULT_PASSWORD || 'AdminSecure2026!';
            const salt = await bcrypt.genSalt(10);
            const hash = await bcrypt.hash(defaultPass, salt);
            await client.query(
                'INSERT INTO admin_users (username, password_hash, full_name) VALUES ($1, $2, $3)',
                ['admin', hash, 'System Administrator']
            );
            console.log('Default admin account created: username "admin"');
        }

        // Seed Default System Settings if none exist
        const settingsCheck = await client.query('SELECT * FROM system_settings LIMIT 1');
        if (settingsCheck.rows.length === 0) {
            const defaultSettings = {
                business_name: 'GovAssit Ph Services',
                contact_number: '+63 912 345 6789',
                email: 'support@govassist.ph',
                address: 'Metro Manila, Philippines',
                gcash_name: 'GovAssist Admin',
                gcash_number: '09171234567',
                gcash_qr: '',
                fee_tin: '350.00',
                fee_sss: '500.00',
                fee_pagibig: '450.00',
                app_instructions: 'Please complete all required steps and upload valid ID documents.',
                customer_instructions: 'Track your application status anytime using your unique tracking number.'
            };
            for (const [key, value] of Object.entries(defaultSettings)) {
                await client.query(
                    'INSERT INTO system_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING',
                    [key, value]
                );
            }
        }

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error initializing database:', err);
    } finally {
        client.release();
    }
}

initDatabase();

// ==========================================
// AUTHENTICATION MIDDLEWARES
// ==========================================
function requireCustomer(req, res, next) {
    if (req.session && req.session.userId && req.session.userType === 'customer') {
        return next();
    }
    res.redirect('/customer/login');
}

function requireAdmin(req, res, next) {
    if (req.session && req.session.adminId && req.session.userType === 'admin') {
        return next();
    }
    res.redirect('/admin/login');
}

// Helper to add notification
async function createNotification(userId, title, message) {
    try {
        await pool.query(
            'INSERT INTO notifications (user_id, title, message) VALUES ($1, $2, $3)',
            [userId, title, message]
        );
    } catch (err) {
        console.error('Error creating notification:', err);
    }
}

// Helper to log status history
async function logStatusHistory(appId, prevStatus, newStatus, actor, remarks) {
    try {
        await pool.query(
            'INSERT INTO status_history (application_id, previous_status, new_status, actor, remarks) VALUES ($1, $2, $3, $4, $5)',
            [appId, prevStatus, newStatus, actor, remarks]
        );
    } catch (err) {
        console.error('Error logging status history:', err);
    }
}

// Helper to get system settings
async function getSettings() {
    try {
        const res = await pool.query('SELECT key, value FROM system_settings');
        const settings = {};
        res.rows.forEach(row => {
            settings[row.key] = row.value;
        });
        return settings;
    } catch (err) {
        return {};
    }
}

// ==========================================
// FRONTEND LAYOUT TEMPLATE ENGINE (HTML)
// ==========================================
function renderLayout(title, content, userType = 'guest', extraHead = '', activeNav = '') {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} | GovAssist PH Application Assistance</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        :root {
            --primary-color: #0d6efd;
            --secondary-color: #6c757d;
            --dark-bg: #212529;
            --sidebar-width: 260px;
        }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background-color: #f8f9fa;
            color: #333;
            margin: 0;
            padding: 0;
        }
        .navbar-brand { font-weight: 700; letter-spacing: -0.5px; }
        .card { border: none; box-shadow: 0 0.125rem 0.25rem rgba(0, 0, 0, 0.075); border-radius: 0.5rem; }
        .btn-primary { background-color: var(--primary-color); border: none; }
        .btn-primary:hover { background-color: #0b5ed7; }
        .disclaimer-banner {
            background-color: #fff3cd;
            color: #856404;
            border-bottom: 1px solid #ffeeba;
            font-size: 0.85rem;
            padding: 8px 0;
            text-align: center;
            font-weight: 500;
        }
        ${extraHead}
    </style>
</head>
<body>
    <div class="disclaimer-banner">
        <i class="fas fa-info-circle me-1"></i> DISCLAIMER: This website is an independent application assistance and document processing/tracking service. It is not an official BIR, SSS, or Pag-IBIG website.
    </div>
    ${content}
    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js"></script>
</body>
</html>`;
}

// ==========================================
// CUSTOMER PORTAL ROUTES
// ==========================================

// Customer Landing Page
app.get('/', async (req, res) => {
    const settings = await getSettings();
    const content = `
    <nav class="navbar navbar-expand-lg navbar-dark bg-dark">
        <div class="container">
            <a class="navbar-brand" href="/"><i class="fas fa-file-alt text-primary me-2"></i>GovAssist PH</a>
            <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNav">
                <span class="navbar-toggler-icon"></span>
            </button>
            <div class="collapse navbar-collapse justify-content-end" id="navbarNav">
                <ul class="navbar-nav align-items-center">
                    <li class="nav-item"><a class="nav-link" href="/track">Track Application</a></li>
                    <li class="nav-item ms-2"><a class="btn btn-outline-light btn-sm px-3" href="/customer/login">Customer Login</a></li>
                    <li class="nav-item ms-2"><a class="btn btn-primary btn-sm px-3" href="/customer/register">Register</a></li>
                </ul>
            </div>
        </div>
    </nav>
    <header class="bg-primary text-white py-5">
        <div class="container text-center py-4">
            <h1 class="display-5 fw-bold mb-3">BIR / TIN • SSS • PAG-IBIG APPLICATION ASSISTANCE</h1>
            <p class="lead mb-4">Fast, easy, and guided government document preparation, filing assistance, and status tracking.</p>
            <div class="d-flex justify-content-center gap-3">
                <a href="/customer/register" class="btn btn-light btn-lg text-primary fw-bold px-4 shadow-sm">Apply Now</a>
                <a href="/track" class="btn btn-outline-light btn-lg px-4">Track Application</a>
            </div>
        </div>
    </header>
    <section class="py-5 bg-white">
        <div class="container">
            <div class="row text-center g-4">
                <div class="col-md-4">
                    <div class="p-4 border rounded-3 h-100 shadow-sm">
                        <div class="text-primary mb-3"><i class="fas fa-id-card fa-3x"></i></div>
                        <h3>BIR / TIN Assistance</h3>
                        <p class="text-muted">Assistance with TIN registration, tax clearance applications, and document organization.</p>
                    </div>
                </div>
                <div class="col-md-4">
                    <div class="p-4 border rounded-3 h-100 shadow-sm">
                        <div class="text-primary mb-3"><i class="fas fa-shield-alt fa-3x"></i></div>
                        <h3>SSS Application</h3>
                        <p class="text-muted">Social Security System membership, loan assistance, and record updates.</p>
                    </div>
                </div>
                <div class="col-md-4">
                    <div class="p-4 border rounded-3 h-100 shadow-sm">
                        <div class="text-primary mb-3"><i class="fas fa-home fa-3x"></i></div>
                        <h3>Pag-IBIG Assistance</h3>
                        <p class="text-muted">HDMF membership registration, housing loan tracking, and contribution assistance.</p>
                    </div>
                </div>
            </div>
        </div>
    </section>
    <section class="py-5 bg-light border-top">
        <div class="container">
            <h2 class="text-center mb-5 fw-bold">How It Works</h2>
            <div class="row g-4">
                <div class="col-md-3 text-center">
                    <div class="bg-primary text-white rounded-circle d-inline-flex align-items-center justify-content-center fs-4 fw-bold mb-3" style="width: 60px; height: 60px;">1</div>
                    <h5>Create Account</h5>
                    <p class="text-muted small">Sign up securely with your email and mobile number.</p>
                </div>
                <div class="col-md-3 text-center">
                    <div class="bg-primary text-white rounded-circle d-inline-flex align-items-center justify-content-center fs-4 fw-bold mb-3" style="width: 60px; height: 60px;">2</div>
                    <h5>Choose Service</h5>
                    <p class="text-muted small">Select BIR/TIN, SSS, or Pag-IBIG and complete the simple step-by-step form.</p>
                </div>
                <div class="col-md-3 text-center">
                    <div class="bg-primary text-white rounded-circle d-inline-flex align-items-center justify-content-center fs-4 fw-bold mb-3" style="width: 60px; height: 60px;">3</div>
                    <h5>Upload Documents</h5>
                    <p class="text-muted small">Upload valid IDs and photos using your device camera or files.</p>
                </div>
                <div class="col-md-3 text-center">
                    <div class="bg-primary text-white rounded-circle d-inline-flex align-items-center justify-content-center fs-4 fw-bold mb-3" style="width: 60px; height: 60px;">4</div>
                    <h5>Submit & Track</h5>
                    <p class="text-muted small">Pay the assistance fee via GCash or Cash, then track your progress online.</p>
                </div>
            </div>
        </div>
    </section>
    <footer class="bg-dark text-white py-4">
        <div class="container text-center">
            <p class="mb-1">&copy; 2026 ${settings.business_name || 'GovAssist PH'}. All rights reserved.</p>
            <p class="small text-muted mb-0">Independent Document Assistance and Tracking System.</p>
        </div>
    </footer>`;
    res.send(renderLayout('Home', content));
});

// Customer Registration Page
app.get('/customer/register', (req, res) => {
    const content = `
    <div class="container py-5">
        <div class="row justify-content-center">
            <div class="col-md-6">
                <div class="card shadow-lg p-4">
                    <div class="text-center mb-4">
                        <h3><i class="fas fa-user-plus text-primary me-2"></i>Customer Registration</h3>
                        <p class="text-muted">Create your account to start your government application assistance.</p>
                    </div>
                    <form action="/customer/register" method="POST">
                        <div class="mb-3">
                            <label class="form-label fw-bold">Full Name *</label>
                            <input type="text" class="form-control" name="full_name" required placeholder="Juan Dela Cruz">
                        </div>
                        <div class="mb-3">
                            <label class="form-label fw-bold">Mobile Number *</label>
                            <input type="text" class="form-control" name="mobile_number" required placeholder="09123456789">
                        </div>
                        <div class="mb-3">
                            <label class="form-label fw-bold">Email Address *</label>
                            <input type="email" class="form-control" name="email" required placeholder="juan@example.com">
                        </div>
                        <div class="mb-3">
                            <label class="form-label fw-bold">Username *</label>
                            <input type="text" class="form-control" name="username" required placeholder="juandela">
                        </div>
                        <div class="mb-3">
                            <label class="form-label fw-bold">Password *</label>
                            <input type="password" class="form-control" name="password" required placeholder="••••••••">
                        </div>
                        <div class="mb-3">
                            <label class="form-label fw-bold">Confirm Password *</label>
                            <input type="password" class="form-control" name="confirm_password" required placeholder="••••••••">
                        </div>
                        <button type="submit" class="btn btn-primary w-100 py-2 fw-bold">Create Account</button>
                    </form>
                    <div class="text-center mt-3">
                        <p class="small">Already have an account? <a href="/customer/login">Login here</a></p>
                        <a href="/" class="small text-decoration-none"><i class="fas fa-arrow-left me-1"></i> Back to Home</a>
                    </div>
                </div>
            </div>
        </div>
    </div>`;
    res.send(renderLayout('Customer Registration', content));
});

app.post('/customer/register', async (req, res) => {
    try {
        const { full_name, mobile_number, email, username, password, confirm_password } = req.body;
        if (!full_name || !mobile_number || !email || !username || !password) {
            return res.send(renderLayout('Error', `<div class="container py-5"><div class="alert alert-danger">All fields are required. <a href="/customer/register">Go back</a></div></div>`));
        }
        if (password !== confirm_password) {
            return res.send(renderLayout('Error', `<div class="container py-5"><div class="alert alert-danger">Passwords do not match. <a href="/customer/register">Go back</a></div></div>`));
        }
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);

        await pool.query(
            'INSERT INTO users (full_name, mobile_number, email, username, password_hash) VALUES ($1, $2, $3, $4, $5)',
            [full_name, mobile_number, email, username, passwordHash]
        );
        res.redirect('/customer/login?registered=true');
    } catch (err) {
        console.error(err);
        res.send(renderLayout('Error', `<div class="container py-5"><div class="alert alert-danger">Registration failed. Username or email may already be taken. <a href="/customer/register">Try again</a></div></div>`));
    }
});

// Customer Login Page
app.get('/customer/login', (req, res) => {
    const successMsg = req.query.registered ? '<div class="alert alert-success">Registration successful! Please login.</div>' : '';
    const content = `
    <div class="container py-5">
        <div class="row justify-content-center">
            <div class="col-md-5">
                <div class="card shadow-lg p-4">
                    <div class="text-center mb-4">
                        <h3><i class="fas fa-sign-in-alt text-primary me-2"></i>Customer Login</h3>
                        <p class="text-muted">Access your applications and tracking portal.</p>
                    </div>
                    ${successMsg}
                    <form action="/customer/login" method="POST">
                        <div class="mb-3">
                            <label class="form-label fw-bold">Username</label>
                            <input type="text" class="form-control" name="username" required placeholder="Enter username">
                        </div>
                        <div class="mb-3">
                            <label class="form-label fw-bold">Password</label>
                            <input type="password" class="form-control" name="password" required placeholder="Enter password">
                        </div>
                        <button type="submit" class="btn btn-primary w-100 py-2 fw-bold">Login</button>
                    </form>
                    <div class="text-center mt-3">
                        <p class="small">Don't have an account? <a href="/customer/register">Register here</a></p>
                        <a href="/" class="small text-decoration-none"><i class="fas fa-arrow-left me-1"></i> Back to Home</a>
                    </div>
                </div>
            </div>
        </div>
    </div>`;
    res.send(renderLayout('Customer Login', content));
});

app.post('/customer/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        if (result.rows.length === 0) {
            return res.send(renderLayout('Login Error', `<div class="container py-5"><div class="alert alert-danger">Invalid username or password. <a href="/customer/login">Try again</a></div></div>`));
        }
        const user = result.rows.item ? result.rows.item(0) : result.rows[0];
        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) {
            return res.send(renderLayout('Login Error', `<div class="container py-5"><div class="alert alert-danger">Invalid username or password. <a href="/customer/login">Try again</a></div></div>`));
        }
        req.session.userId = user.id;
        req.session.userName = user.full_name;
        req.session.userType = 'customer';
        res.redirect('/customer/dashboard');
    } catch (err) {
        console.error(err);
        res.send(renderLayout('Error', `<div class="container py-5"><div class="alert alert-danger">An error occurred during login.</div></div>`));
    }
});

// Customer Logout
app.get('/customer/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/customer/login');
    });
});

// Customer Dashboard
app.get('/customer/dashboard', requireCustomer, async (req, res) => {
    try {
        const userId = req.session.userId;
        const appsRes = await pool.query('SELECT * FROM applications WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
        const notifRes = await pool.query('SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10', [userId]);
        const settings = await getSettings();

        let appsHtml = '';
        if (appsRes.rows.length === 0) {
            appsHtml = `<tr><td colspan="6" class="text-center py-4 text-muted">No applications submitted yet. Click below to start an application.</td></tr>`;
        } else {
            appsRes.rows.forEach(app => {
                let badgeClass = 'bg-secondary';
                if (app.status === 'Completed') badgeClass = 'bg-success';
                else if (app.status === 'Under Review' || app.status === 'Processing') badgeClass = 'bg-info text-dark';
                else if (app.status === 'Need Correction') badgeClass = 'bg-warning text-dark';
                else if (app.status === 'Rejected') badgeClass = 'bg-danger';

                let payBadge = 'bg-secondary';
                if (app.payment_status === 'Paid') payBadge = 'bg-success';
                else if (app.payment_status === 'Payment Verification') payBadge = 'bg-info text-dark';
                else if (app.payment_status === 'Payment Rejected') payBadge = 'bg-danger';

                appsHtml += `
                <tr>
                    <td class="fw-bold">${app.tracking_number}</td>
                    <td><span class="badge bg-dark">${app.service_type}</span></td>
                    <td>${new Date(app.created_at).toLocaleDateString()}</td>
                    <td><span class="badge ${badgeClass}">${app.status}</span></td>
                    <td><span class="badge ${payBadge}">${app.payment_status}</span></td>
                    <td>
                        <a href="/customer/application/${app.id}" class="btn btn-sm btn-outline-primary"><i class="fas fa-eye me-1"></i> View</a>
                    </td>
                </tr>`;
            });
        }

        let notifHtml = '';
        if (notifRes.rows.length === 0) {
            notifHtml = `<li class="list-group-item text-muted small">No notifications yet.</li>`;
        } else {
            notifRes.rows.forEach(n => {
                notifHtml += `
                <li class="list-group-item d-flex justify-content-between align-items-start">
                    <div>
                        <div class="fw-bold small">${n.title}</div>
                        <div class="text-muted small">${n.message}</div>
                    </div>
                    <span class="text-muted" style="font-size: 0.75rem;">${new Date(n.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                </li>`;
            });
        }

        const content = `
        <nav class="navbar navbar-expand-lg navbar-dark bg-dark">
            <div class="container">
                <a class="navbar-brand" href="/customer/dashboard"><i class="fas fa-user-circle text-primary me-2"></i>Customer Portal</a>
                <div class="d-flex align-items-center">
                    <span class="text-light me-3 small">Welcome, ${req.session.userName}</span>
                    <a href="/customer/logout" class="btn btn-outline-light btn-sm"><i class="fas fa-sign-out-alt me-1"></i> Logout</a>
                </div>
            </div>
        </nav>
        <div class="container py-4">
            <div class="row mb-4">
                <div class="col-md-8">
                    <h2>My Applications</h2>
                    <p class="text-muted">Manage and track your government assistance applications.</p>
                </div>
                <div class="col-md-4 text-md-end">
                    <a href="/customer/apply" class="btn btn-primary fw-bold px-4 py-2 shadow-sm"><i class="fas fa-plus-circle me-2"></i> New Application</a>
                </div>
            </div>

            <div class="row">
                <div class="col-lg-8">
                    <div class="card shadow-sm mb-4">
                        <div class="card-header bg-white fw-bold py-3"><i class="fas fa-list me-2 text-primary"></i> Application List</div>
                        <div class="table-responsive">
                            <table class="table table-hover align-middle mb-0">
                                <thead class="table-light">
                                    <tr>
                                        <th>Tracking No.</th>
                                        <th>Service</th>
                                        <th>Date</th>
                                        <th>Status</th>
                                        <th>Payment</th>
                                        <th>Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${appsHtml}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
                <div class="col-lg-4">
                    <div class="card shadow-sm mb-4">
                        <div class="card-header bg-white fw-bold py-3"><i class="fas fa-bell me-2 text-primary"></i> Notifications</div>
                        <ul class="list-group list-group-flush">
                            ${notifHtml}
                        </ul>
                    </div>
                </div>
            </div>
        </div>`;
        res.send(renderLayout('Customer Dashboard', content));
    } catch (err) {
        console.error(err);
        res.send(renderLayout('Error', `<div class="container py-5"><div class="alert alert-danger">Error loading dashboard.</div></div>`));
    }
});

// Customer New Application Form (Multi-Step Step-by-Step)
app.get('/customer/apply', requireCustomer, async (req, res) => {
    const settings = await getSettings();
    const content = `
    <nav class="navbar navbar-expand-lg navbar-dark bg-dark">
        <div class="container">
            <a class="navbar-brand" href="/customer/dashboard"><i class="fas fa-arrow-left me-2"></i>Back to Dashboard</a>
            <span class="text-light">Application Assistance Wizard</span>
        </div>
    </nav>
    <div class="container py-5">
        <div class="row justify-content-center">
            <div class="col-lg-10">
                <div class="card shadow-lg p-4">
                    <div class="text-center mb-4">
                        <h3>Government Application Assistance Form</h3>
                        <p class="text-muted">Please follow the step-by-step instructions below carefully.</p>
                    </div>

                    <form action="/customer/apply" method="POST" enctype="multipart/form-data" id="multiStepForm">
                        <div class="mb-4">
                            <label class="form-label fw-bold">Select Government Service *</label>
                            <select class="form-select form-select-lg" name="service_type" id="service_type" required onchange="updateServiceFees()">
                                <option value="">-- Choose Service --</option>
                                <option value="TIN">BIR / TIN Application Assistance (Fee: ₱${settings.fee_tin || '350.00'})</option>
                                <option value="SSS">SSS Application Assistance (Fee: ₱${settings.fee_sss || '500.00'})</option>
                                <option value="PAGIBIG">Pag-IBIG Application Assistance (Fee: ₱${settings.fee_pagibig || '450.00'})</option>
                            </select>
                        </div>

                        <div class="progress mb-4" style="height: 10px;">
                            <div class="progress-bar" id="formProgressBar" role="progressbar" style="width: 10%;" aria-valuenow="10" aria-valuemin="0" aria-valuemax="100"></div>
                        </div>

                        <div class="form-step" id="step-1">
                            <h4 class="text-primary mb-3">Step 1 — Personal Information</h4>
                            <div class="row g-3">
                                <div class="col-md-4">
                                    <label class="form-label">First Name *</label>
                                    <input type="text" class="form-control" name="first_name" required>
                                </div>
                                <div class="col-md-4">
                                    <label class="form-label">Middle Name</label>
                                    <input type="text" class="form-control" name="middle_name">
                                </div>
                                <div class="col-md-4">
                                    <label class="form-label">Last Name *</label>
                                    <input type="text" class="form-control" name="last_name" required>
                                </div>
                                <div class="col-md-3">
                                    <label class="form-label">Suffix (Jr, Sr, III)</label>
                                    <input type="text" class="form-control" name="suffix">
                                </div>
                                <div class="col-md-3">
                                    <label class="form-label">Date of Birth *</label>
                                    <input type="date" class="form-control" name="date_of_birth" required>
                                </div>
                                <div class="col-md-6">
                                    <label class="form-label">Place of Birth *</label>
                                    <input type="text" class="form-control" name="place_of_birth" required placeholder="City/Municipality, Province">
                                </div>
                                <div class="col-md-4">
                                    <label class="form-label">Sex *</label>
                                    <select class="form-select" name="sex" required>
                                        <option value="">Select Sex</option>
                                        <option value="Male">Male</option>
                                        <option value="Female">Female</option>
                                    </select>
                                </div>
                                <div class="col-md-4">
                                    <label class="form-label">Civil Status *</label>
                                    <select class="form-select" name="civil_status" id="civil_status" required onchange="toggleSpouseSection()">
                                        <option value="">Select Civil Status</option>
                                        <option value="Single">Single</option>
                                        <option value="Married">Married</option>
                                        <option value="Widowed">Widowed</option>
                                        <option value="Legally Separated">Legally Separated</option>
                                    </select>
                                </div>
                                <div class="col-md-4">
                                    <label class="form-label">Nationality *</label>
                                    <input type="text" class="form-control" name="nationality" value="Filipino" required>
                                </div>
                            </div>
                            <div class="mt-4 text-end">
                                <button type="button" class="btn btn-primary px-4" onclick="nextStep(2)">Next: Address <i class="fas fa-arrow-right ms-1"></i></button>
                            </div>
                        </div>

                        <div class="form-step d-none" id="step-2">
                            <h4 class="text-primary mb-3">Step 2 — Address Information</h4>
                            <div class="row g-3">
                                <div class="col-12">
                                    <label class="form-label">Complete House/Building/Street Address *</label>
                                    <input type="text" class="form-control" name="complete_address" required placeholder="House No., Street Name, Subdivision">
                                </div>
                                <div class="col-md-3">
                                    <label class="form-label">Barangay *</label>
                                    <input type="text" class="form-control" name="barangay" required>
                                </div>
                                <div class="col-md-3">
                                    <label class="form-label">Municipality / City *</label>
                                    <input type="text" class="form-control" name="municipality_city" required>
                                </div>
                                <div class="col-md-3">
                                    <label class="form-label">Province *</label>
                                    <input type="text" class="form-control" name="province" required>
                                </div>
                                <div class="col-md-3">
                                    <label class="form-label">ZIP Code *</label>
                                    <input type="text" class="form-control" name="zip_code" required>
                                </div>
                                <div class="col-md-6">
                                    <label class="form-label">Mobile Number *</label>
                                    <input type="text" class="form-control" name="mobile_number" required placeholder="09123456789">
                                </div>
                                <div class="col-md-6">
                                    <label class="form-label">Email Address *</label>
                                    <input type="email" class="form-control" name="email_address" required placeholder="juan@example.com">
                                </div>
                            </div>
                            <div class="mt-4 d-flex justify-content-between">
                                <button type="button" class="btn btn-outline-secondary px-4" onclick="prevStep(1)"><i class="fas fa-arrow-left me-1"></i> Back</button>
                                <button type="button" class="btn btn-primary px-4" onclick="nextStep(3)">Next: Parents <i class="fas fa-arrow-right ms-1"></i></button>
                            </div>
                        </div>

                        <div class="form-step d-none" id="step-3">
                            <h4 class="text-primary mb-3">Step 3 — Parent Information (Required for SSS & Pag-IBIG)</h4>
                            <div class="card bg-light p-3 mb-3">
                                <h5 class="text-secondary">Father's Information</h5>
                                <div class="row g-3">
                                    <div class="col-md-4">
                                        <label class="form-label">First Name</label>
                                        <input type="text" class="form-control" name="father_first_name">
                                    </div>
                                    <div class="col-md-4">
                                        <label class="form-label">Middle Name</label>
                                        <input type="text" class="form-control" name="father_middle_name">
                                    </div>
                                    <div class="col-md-4">
                                        <label class="form-label">Last Name</label>
                                        <input type="text" class="form-control" name="father_last_name">
                                    </div>
                                    <div class="col-md-4">
                                        <label class="form-label">Father's Date of Birth</label>
                                        <input type="date" class="form-control" name="father_dob">
                                    </div>
                                </div>
                            </div>

                            <div class="card bg-light p-3">
                                <h5 class="text-secondary">Mother's Information</h5>
                                <div class="row g-3">
                                    <div class="col-md-4">
                                        <label class="form-label">First Name</label>
                                        <input type="text" class="form-control" name="mother_first_name">
                                    </div>
                                    <div class="col-md-4">
                                        <label class="form-label">Middle Name</label>
                                        <input type="text" class="form-control" name="mother_middle_name">
                                    </div>
                                    <div class="col-md-4">
                                        <label class="form-label">Mother's Maiden Last Name</label>
                                        <input type="text" class="form-control" name="mother_maiden_name">
                                    </div>
                                    <div class="col-md-4">
                                        <label class="form-label">Last Name</label>
                                        <input type="text" class="form-control" name="mother_last_name">
                                    </div>
                                    <div class="col-md-4">
                                        <label class="form-label">Mother's Date of Birth</label>
                                        <input type="date" class="form-control" name="mother_dob">
                                    </div>
                                </div>
                            </div>
                            <div class="mt-4 d-flex justify-content-between">
                                <button type="button" class="btn btn-outline-secondary px-4" onclick="prevStep(2)"><i class="fas fa-arrow-left me-1"></i> Back</button>
                                <button type="button" class="btn btn-primary px-4" onclick="nextStep(4)">Next: Beneficiaries <i class="fas fa-arrow-right ms-1"></i></button>
                            </div>
                        </div>

                        <div class="form-step d-none" id="step-4">
                            <h4 class="text-primary mb-3">Step 4 — Beneficiaries (Dynamic)</h4>
                            <p class="text-muted small">You can add multiple beneficiaries as needed for your records.</p>
                            
                            <div id="beneficiaries-container">
                                <div class="card bg-light p-3 mb-3 beneficiary-item">
                                    <h6 class="text-secondary fw-bold">Beneficiary #1</h6>
                                    <div class="row g-3">
                                        <div class="col-md-4">
                                            <label class="form-label">Full Name *</label>
                                            <input type="text" class="form-control" name="ben_full_name[]" required>
                                        </div>
                                        <div class="col-md-3">
                                            <label class="form-label">Relationship *</label>
                                            <input type="text" class="form-control" name="ben_relationship[]" required placeholder="Spouse, Child, Parent">
                                        </div>
                                        <div class="col-md-2">
                                            <label class="form-label">Date of Birth *</label>
                                            <input type="date" class="form-control" name="ben_dob[]" required>
                                        </div>
                                        <div class="col-md-3">
                                            <label class="form-label">Address *</label>
                                            <input type="text" class="form-control" name="ben_address[]" required>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <button type="button" class="btn btn-outline-primary btn-sm mt-2" onclick="addBeneficiary()"><i class="fas fa-plus me-1"></i> + Add Another Beneficiary</button>

                            <div class="mt-4 d-flex justify-content-between">
                                <button type="button" class="btn btn-outline-secondary px-4" onclick="prevStep(3)"><i class="fas fa-arrow-left me-1"></i> Back</button>
                                <button type="button" class="btn btn-primary px-4" onclick="nextStep(5)">Next: Employment <i class="fas fa-arrow-right ms-1"></i></button>
                            </div>
                        </div>

                        <div class="form-step d-none" id="step-5">
                            <h4 class="text-primary mb-3">Step 5 — Employment & Income Information</h4>
                            <div class="row g-3">
                                <div class="col-md-6">
                                    <label class="form-label">Employment Status *</label>
                                    <select class="form-select" name="employment_status" required>
                                        <option value="">Select Status</option>
                                        <option value="Employed">Employed</option>
                                        <option value="Self-Employed">Self-Employed</option>
                                        <option value="Unemployed">Unemployed</option>
                                        <option value="Freelancer">Freelancer / OFW</option>
                                    </select>
                                </div>
                                <div class="col-md-6">
                                    <label class="form-label">Source of Income *</label>
                                    <input type="text" class="form-control" name="source_of_income" required placeholder="Salary, Business, Remittance">
                                </div>
                                <div class="col-md-4">
                                    <label class="form-label">Monthly Income (PHP)</label>
                                    <input type="number" step="0.01" class="form-control" name="monthly_income" placeholder="25000.00">
                                </div>
                                <div class="col-md-8">
                                    <label class="form-label">Employer / Business Name (If applicable)</label>
                                    <input type="text" class="form-control" name="employer_name" placeholder="Company Name Inc.">
                                </div>
                                <div class="col-12">
                                    <label class="form-label">Employer / Business Address</label>
                                    <input type="text" class="form-control" name="employer_address" placeholder="Company Address">
                                </div>
                                <div class="col-md-6">
                                    <label class="form-label">Employer Contact Number</label>
                                    <input type="text" class="form-control" name="employer_contact" placeholder="02-8123-4567">
                                </div>
                            </div>
                            <div class="mt-4 d-flex justify-content-between">
                                <button type="button" class="btn btn-outline-secondary px-4" onclick="prevStep(4)"><i class="fas fa-arrow-left me-1"></i> Back</button>
                                <button type="button" class="btn btn-primary px-4" onclick="nextStep(6)">Next: Spouse <i class="fas fa-arrow-right ms-1"></i></button>
                            </div>
                        </div>

                        <div class="form-step d-none" id="step-6">
                            <h4 class="text-primary mb-3">Step 6 — Spouse Information</h4>
                            <div id="spouse-fields-wrapper" class="card bg-light p-3 mb-3">
                                <p class="text-muted" id="spouse-notice">If you selected Married in Step 1, please fill out spouse details below. Otherwise, this step is optional or hidden.</p>
                                <div class="row g-3">
                                    <div class="col-md-6">
                                        <label class="form-label">Spouse Full Name</label>
                                        <input type="text" class="form-control" name="spouse_full_name">
                                    </div>
                                    <div class="col-md-3">
                                        <label class="form-label">Spouse Date of Birth</label>
                                        <input type="date" class="form-control" name="spouse_dob">
                                    </div>
                                    <div class="col-md-3">
                                        <label class="form-label">Spouse Occupation</label>
                                        <input type="text" class="form-control" name="spouse_occupation">
                                    </div>
                                </div>
                            </div>
                            <div class="mt-4 d-flex justify-content-between">
                                <button type="button" class="btn btn-outline-secondary px-4" onclick="prevStep(5)"><i class="fas fa-arrow-left me-1"></i> Back</button>
                                <button type="button" class="btn btn-primary px-4" onclick="nextStep(7)">Next: Documents <i class="fas fa-arrow-right ms-1"></i></button>
                            </div>
                        </div>

                        <div class="form-step d-none" id="step-7">
                            <h4 class="text-primary mb-3">Step 7 — Document Upload & Camera Capture</h4>
                            <p class="text-muted">Please upload clear pictures/PDFs or use your device camera to take photos.</p>
                            
                            <div class="row g-4">
                                <div class="col-md-6">
                                    <div class="card p-3 border">
                                        <label class="form-label fw-bold">Valid ID Type *</label>
                                        <select class="form-select mb-3" name="id_type" required>
                                            <option value="National ID">Philippine National ID (PhilSys)</option>
                                            <option value="Driver's License">Driver's License</option>
                                            <option value="Passport">Philippine Passport</option>
                                            <option value="UMID / SSS">UMID / SSS ID</option>
                                            <option value="Postal ID">Postal ID</option>
                                        </select>
                                        
                                        <label class="form-label fw-bold">ID Front Image *</label>
                                        <p class="text-muted small">"Please upload a clear picture of your valid ID."</p>
                                        <input type="file" class="form-control mb-2" name="id_front" accept="image/*" required>
                                        
                                        <label class="form-label fw-bold mt-2">ID Back Image</label>
                                        <input type="file" class="form-control" name="id_back" accept="image/*">
                                    </div>
                                </div>

                                <div class="col-md-6">
                                    <div class="card p-3 border">
                                        <label class="form-label fw-bold">Photo Holding ID *</label>
                                        <p class="text-muted small">"Please take a picture while holding the same ID. Make sure your face and ID are clearly visible."</p>
                                        <input type="file" class="form-control mb-2" name="photo_holding_id" accept="image/*" capture="user" required>
                                        <div class="form-text">Mobile users can click to open device camera directly.</div>

                                        <label class="form-label fw-bold mt-3">ID Picture (Passport Size) *</label>
                                        <input type="file" class="form-control" name="id_picture" accept="image/*" required>
                                    </div>
                                </div>

                                <div class="col-12" id="marriage-cert-container" style="display: none;">
                                    <div class="card p-3 border bg-light">
                                        <label class="form-label fw-bold">Marriage Certificate (Multiple pages allowed)</label>
                                        <p class="text-muted small">Since you are married, please upload clear images or PDF of your Marriage Certificate.</p>
                                        <input type="file" class="form-control" name="marriage_cert" accept="image/*,application/pdf" multiple>
                                    </div>
                                </div>

                                <div class="col-12">
                                    <div class="card p-3 border">
                                        <label class="form-label fw-bold">Additional Supporting Documents (Optional)</label>
                                        <input type="file" class="form-control" name="additional_docs" accept="image/*,application/pdf" multiple>
                                    </div>
                                </div>
                            </div>

                            <div class="mt-4 d-flex justify-content-between">
                                <button type="button" class="btn btn-outline-secondary px-4" onclick="prevStep(6)"><i class="fas fa-arrow-left me-1"></i> Back</button>
                                <button type="button" class="btn btn-primary px-4" onclick="nextStep(8)">Next: Payment <i class="fas fa-arrow-right ms-1"></i></button>
                            </div>
                        </div>

                        <div class="form-step d-none" id="step-8">
                            <h4 class="text-primary mb-3">Step 8 — Payment Method & Fee</h4>
                            <div class="alert alert-info">
                                <h5 class="alert-heading">Service Fee: <span id="display-fee" class="fw-bold">₱350.00</span></h5>
                                <hr>
                                <p class="mb-0">Choose how you would like to pay your application assistance fee.</p>
                            </div>

                            <div class="mb-4">
                                <label class="form-label fw-bold">Select Payment Method *</label>
                                <select class="form-select form-select-lg" name="payment_method" id="payment_method" required onchange="togglePaymentInstructions()">
                                    <option value="">-- Choose Payment Method --</option>
                                    <option value="GCash">GCash (Scan QR & Upload Receipt)</option>
                                    <option value="Cash">Cash (Pay at Partner Office / Instructions)</option>
                                </select>
                            </div>

                            <div id="gcash-box" class="card border-primary p-4 mb-3" style="display: none;">
                                <h5 class="text-primary fw-bold"><i class="fas fa-qrcode me-2"></i> GCash Payment Instructions</h5>
                                <p>SCAN THIS QR CODE TO PAY or send directly via GCash number below:</p>
                                <div class="row align-items-center">
                                    <div class="col-md-4 text-center">
                                        <div class="bg-light border p-3 rounded mb-2">
                                            <i class="fas fa-qrcode fa-5x text-secondary"></i>
                                            <div class="small text-muted mt-1">[GCash QR Code Configured by Admin]</div>
                                        </div>
                                    </div>
                                    <div class="col-md-8">
                                        <p class="mb-1"><strong>Account Name:</strong> <span id="lbl-gcash-name">${settings.gcash_name || 'GovAssist Admin'}</span></p>
                                        <p class="mb-3"><strong>Account Number:</strong> <span id="lbl-gcash-number" class="fs-5 fw-bold text-primary">${settings.gcash_number || '09171234567'}</span></p>
                                        
                                        <div class="mb-3">
                                            <label class="form-label fw-bold">GCash Reference Number *</label>
                                            <input type="text" class="form-control" name="payment_ref" placeholder="12桁 Reference No.">
                                        </div>
                                        <div class="mb-3">
                                            <label class="form-label fw-bold">Upload GCash Receipt Screenshot *</label>
                                            <input type="file" class="form-control" name="payment_proof" accept="image/*">
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div id="cash-box" class="card border-secondary p-4 mb-3" style="display: none;">
                                <h5 class="text-secondary fw-bold"><i class="fas fa-money-bill-wave me-2"></i> Cash Payment Instructions</h5>
                                <p class="lead fs-6">"Pay the service fee according to the instructions provided by Admin."</p>
                                <p class="text-muted small">Your application will be marked as Unpaid until cash is verified by our staff.</p>
                            </div>

                            <div class="mt-4 d-flex justify-content-between">
                                <button type="button" class="btn btn-outline-secondary px-4" onclick="prevStep(7)"><i class="fas fa-arrow-left me-1"></i> Back</button>
                                <button type="button" class="btn btn-primary px-4" onclick="nextStep(9)">Next: Review <i class="fas fa-arrow-right ms-1"></i></button>
                            </div>
                        </div>

                        <div class="form-step d-none" id="step-9">
                            <h4 class="text-primary mb-3">Step 9 — Review & Confirm Application</h4>
                            <p class="text-muted">Please review your information carefully before final submission.</p>

                            <div class="card bg-light p-4 mb-4">
                                <h5>Summary Checklist</h5>
                                <ul class="text-muted small mb-0">
                                    <li>All personal and address details are complete.</li>
                                    <li>Valid ID and photos are uploaded.</li>
                                    <li>Payment method is selected and proof attached if GCash.</li>
                                </ul>
                            </div>

                            <div class="form-check mb-4">
                                <input class="form-check-input" type="checkbox" value="" id="confirmCheck" required>
                                <label class="form-check-label fw-bold text-danger" for="confirmCheck">
                                    I confirm that the information I provided is correct and true.
                                </label>
                            </div>

                            <div class="mt-4 d-flex justify-content-between">
                                <button type="button" class="btn btn-outline-secondary px-4" onclick="prevStep(8)"><i class="fas fa-arrow-left me-1"></i> Back</button>
                                <button type="submit" class="btn btn-success px-5 py-2 fw-bold fs-5 shadow"><i class="fas fa-check-circle me-2"></i> Submit Application</button>
                            </div>
                        </div>

                    </form>
                </div>
            </div>
        </div>
    </div>

    <script>
        let currentStep = 1;
        function updateProgress() {
            const pct = (currentStep / 9) * 100;
            document.getElementById('formProgressBar').style.width = pct + '%';
        }
        function nextStep(step) {
            document.getElementById('step-' + currentStep).classList.add('d-none');
            currentStep = step;
            document.getElementById('step-' + currentStep).classList.remove('d-none');
            updateProgress();
            window.scrollTo(0, 0);
        }
        function prevStep(step) {
            document.getElementById('step-' + currentStep).classList.add('d-none');
            currentStep = step;
            document.getElementById('step-' + currentStep).classList.remove('d-none');
            updateProgress();
            window.scrollTo(0, 0);
        }
        function toggleSpouseSection() {
            const cs = document.getElementById('civil_status').value;
            const mc = document.getElementById('marriage-cert-container');
            if (cs === 'Married') {
                mc.style.display = 'block';
            } else {
                mc.style.display = 'none';
            }
        }
        function togglePaymentInstructions() {
            const pm = document.getElementById('payment_method').value;
            document.getElementById('gcash-box').style.display = pm === 'GCash' ? 'block' : 'none';
            document.getElementById('cash-box').style.display = pm === 'Cash' ? 'block' : 'none';
        }
        function updateServiceFees() {
            const st = document.getElementById('service_type').value;
            let fee = '350.00';
            if (st === 'SSS') fee = '500.00';
            else if (st === 'PAGIBIG') fee = '450.00';
            document.getElementById('display-fee').innerText = '₱' + fee;
        }
        function addBeneficiary() {
            const container = document.getElementById('beneficiaries-container');
            const count = container.getElementsByClassName('beneficiary-item').length + 1;
            const div = document.createElement('div');
            div.className = 'card bg-light p-3 mb-3 beneficiary-item';
            div.innerHTML = \`
                <div class="d-flex justify-content-between align-items-center mb-2">
                    <h6 class="text-secondary fw-bold mb-0">Beneficiary #\${count}</h6>
                    <button type="button" class="btn btn-sm btn-outline-danger" onclick="this.closest('.beneficiary-item').remove()"><i class="fas fa-trash"></i></button>
                </div>
                <div class="row g-3">
                    <div class="col-md-4">
                        <label class="form-label">Full Name *</label>
                        <input type="text" class="form-control" name="ben_full_name[]" required>
                    </div>
                    <div class="col-md-3">
                        <label class="form-label">Relationship *</label>
                        <input type="text" class="form-control" name="ben_relationship[]" required>
                    </div>
                    <div class="col-md-2">
                        <label class="form-label">Date of Birth *</label>
                        <input type="date" class="form-control" name="ben_dob[]" required>
                    </div>
                    <div class="col-md-3">
                        <label class="form-label">Address *</label>
                        <input type="text" class="form-control" name="ben_address[]" required>
                    </div>
                </div>
            \`;
            container.appendChild(div);
        }
    </script>`;
    res.send(renderLayout('Application Wizard', content));
});

// Handle Application Form Submission
const uploadFields = upload.fields([
    { name: 'id_front', maxCount: 1 },
    { name: 'id_back', maxCount: 1 },
    { name: 'photo_holding_id', maxCount: 1 },
    { name: 'id_picture', maxCount: 1 },
    { name: 'marriage_cert', maxCount: 10 },
    { name: 'additional_docs', maxCount: 10 },
    { name: 'payment_proof', maxCount: 1 }
]);

app.post('/customer/apply', requireCustomer, uploadFields, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const userId = req.session.userId;
        const {
            service_type, first_name, middle_name, last_name, suffix, date_of_birth, place_of_birth,
            sex, civil_status, nationality, mobile_number, email_address, complete_address,
            barangay, municipality_city, province, zip_code, father_first_name, father_middle_name,
            father_last_name, father_dob, mother_first_name, mother_middle_name, mother_maiden_name,
            mother_last_name, mother_dob, employment_status, source_of_income, monthly_income,
            employer_name, employer_address, employer_contact, spouse_full_name, spouse_dob,
            spouse_occupation, payment_method, payment_ref
        } = req.body;

        // Generate unique tracking number e.g. TIN-20260901-0001
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const countRes = await client.query('SELECT COUNT(*) FROM applications');
        const seq = String(parseInt(countRes.rows[0].count) + 1).padStart(4, '0');
        const trackingNumber = `${service_type}-${dateStr}-${seq}`;

        // Determine fee based on service
        const settingsRes = await client.query('SELECT key, value FROM system_settings');
        const settings = {};
        settingsRes.rows.forEach(r => settings[r.key] = r.value);

        let fee = 350.00;
        if (service_type === 'SSS') fee = parseFloat(settings.fee_sss || 500);
        else if (service_type === 'PAGIBIG') fee = parseFloat(settings.fee_pagibig || 450);
        else if (service_type === 'TIN') fee = parseFloat(settings.fee_tin || 350);

        let paymentStatus = payment_method === 'GCash' ? 'Payment Verification' : 'Unpaid';
        let paymentProofPath = req.files['payment_proof'] ? req.files['payment_proof'][0].filename : null;

        // Insert Application
        const appIns = await client.query(
            `INSERT INTO applications (tracking_number, user_id, service_type, status, payment_status, payment_method, payment_fee, payment_ref, payment_date, payment_proof)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
            [trackingNumber, userId, service_type, 'Submitted', paymentStatus, payment_method, fee, payment_ref, payment_method === 'GCash' ? new Date() : null, paymentProofPath]
        );
        const appId = appIns.rows[0].id;

        // Insert Personal Info
        await client.query(
            `INSERT INTO personal_information (application_id, first_name, middle_name, last_name, suffix, date_of_birth, place_of_birth, sex, civil_status, nationality, mobile_number, email_address, complete_address, barangay, municipality_city, province, zip_code)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
            [appId, first_name, middle_name, last_name, suffix, date_of_birth, place_of_birth, sex, civil_status, nationality, mobile_number, email_address, complete_address, barangay, municipality_city, province, zip_code]
        );

        // Insert Parents
        await client.query(
            `INSERT INTO parent_information (application_id, father_first_name, father_middle_name, father_last_name, father_dob, mother_first_name, mother_middle_name, mother_maiden_name, mother_last_name, mother_dob)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [appId, father_first_name, father_middle_name, father_last_name, father_dob || null, mother_first_name, mother_middle_name, mother_maiden_name, mother_last_name, mother_dob || null]
        );

        // Insert Beneficiaries (Dynamic arrays)
        if (req.body.ben_full_name) {
            const names = req.body.ben_full_name;
            const rels = req.body.ben_relationship;
            const dobs = req.body.ben_dob;
            const addrs = req.body.ben_address;
            for (let i = 0; i < names.length; i++) {
                if (names[i]) {
                    await client.query(
                        `INSERT INTO beneficiaries (application_id, full_name, relationship, date_of_birth, address) VALUES ($1, $2, $3, $4, $5)`,
                        [appId, names[i], rels[i], dobs[i], addrs[i]]
                    );
                }
            }
        }

        // Insert Spouse
        if (civil_status === 'Married' && spouse_full_name) {
            await client.query(
                `INSERT INTO spouse_information (application_id, spouse_full_name, spouse_dob, spouse_occupation) VALUES ($1, $2, $3, $4)`,
                [appId, spouse_full_name, spouse_dob || null, spouse_occupation]
            );
        }

        // Insert Employment
        await client.query(
            `INSERT INTO employment_information (application_id, employment_status, employer_name, employer_address, employer_contact, source_of_income, monthly_income)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [appId, employment_status, employer_name, employer_address, employer_contact, source_of_income, monthly_income || 0.00]
        );

        // Insert Documents
        const saveDoc = async (type, file) => {
            if (file) {
                await client.query(
                    `INSERT INTO documents (application_id, document_type, file_path, original_name) VALUES ($1, $2, $3, $4)`,
                    [appId, type, file.filename, file.originalname]
                );
            }
        };

        if (req.files['id_front']) await saveDoc('Valid ID (Front)', req.files['id_front'][0]);
        if (req.files['id_back']) await saveDoc('Valid ID (Back)', req.files['id_back'][0]);
        if (req.files['photo_holding_id']) await saveDoc('Photo Holding ID', req.files['photo_holding_id'][0]);
        if (req.files['id_picture']) await saveDoc('ID Picture', req.files['id_picture'][0]);

        if (req.files['marriage_cert']) {
            for (const f of req.files['marriage_cert']) {
                await saveDoc('Marriage Certificate', f);
            }
        }
        if (req.files['additional_docs']) {
            for (const f of req.files['additional_docs']) {
                await saveDoc('Additional Document', f);
            }
        }

        // Log status and notification
        await client.query(
            'INSERT INTO status_history (application_id, previous_status, new_status, actor, remarks) VALUES ($1, $2, $3, $4, $5)',
            [appId, null, 'Submitted', 'Customer', 'Application successfully submitted.']
        );

        await client.query(
            'INSERT INTO notifications (user_id, title, message) VALUES ($1, $2, $3)',
            [userId, 'Application Submitted', `Your application ${trackingNumber} has been successfully submitted.`]
        );

        await client.query('COMMIT');
        res.redirect('/customer/dashboard');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.send(renderLayout('Error', `<div class="container py-5"><div class="alert alert-danger">Error processing application submission. Please check all required fields.</div></div>`));
    } finally {
        client.release();
    }
});

// Customer View Application Details & Download Completed Docs
app.get('/customer/application/:id', requireCustomer, async (req, res) => {
    try {
        const appId = req.params.id;
        const userId = req.session.userId;

        const appRes = await pool.query('SELECT * FROM applications WHERE id = $1 AND user_id = $2', [appId, userId]);
        if (appRes.rows.length === 0) {
            return res.send(renderLayout('Not Found', `<div class="container py-5"><div class="alert alert-danger">Application not found or unauthorized.</div></div>`));
        }
        const app = appRes.rows[0];
        const docsRes = await pool.query('SELECT * FROM documents WHERE application_id = $1', [appId]);
        const compDocsRes = await pool.query('SELECT * FROM completed_documents WHERE application_id = $1', [appId]);
        const historyRes = await pool.query('SELECT * FROM status_history WHERE application_id = $1 ORDER BY created_at DESC', [appId]);

        let docsHtml = '';
        docsRes.rows.forEach(d => {
            docsHtml += `<li class="list-group-item d-flex justify-content-between align-items-center">
                <span><i class="fas fa-file-alt text-primary me-2"></i> ${d.document_type} (${d.original_name})</span>
                <a href="/uploads/${d.file_path}" target="_blank" class="btn btn-sm btn-outline-primary">View</a>
            </li>`;
        });

        let compDocsHtml = '';
        if (compDocsRes.rows.length === 0) {
            compDocsHtml = `<p class="text-muted small">No completed government documents uploaded by admin yet.</p>`;
        } else {
            compDocsRes.rows.forEach(cd => {
                compDocsHtml += `<li class="list-group-item d-flex justify-content-between align-items-center">
                    <span><i class="fas fa-check-circle text-success me-2"></i> ${cd.document_type} (${cd.original_name})</span>
                    <a href="/uploads/${cd.file_path}" download class="btn btn-sm btn-success"><i class="fas fa-download me-1"></i> Download</a>
                </li>`;
            });
        }

        let historyHtml = '';
        historyRes.rows.forEach(h => {
            historyHtml += `<tr>
                <td>${new Date(h.created_at).toLocaleString()}</td>
                <td><span class="badge bg-secondary">${h.new_status}</span></td>
                <td>${h.actor}</td>
                <td>${h.remarks || '-'}</td>
            </tr>`;
        });

        const content = `
        <nav class="navbar navbar-expand-lg navbar-dark bg-dark">
            <div class="container">
                <a class="navbar-brand" href="/customer/dashboard"><i class="fas fa-arrow-left me-2"></i>Back to Dashboard</a>
                <span class="text-light">Application Tracking: ${app.tracking_number}</span>
            </div>
        </nav>
        <div class="container py-4">
            <div class="row">
                <div class="col-lg-8">
                    <div class="card shadow-sm mb-4">
                        <div class="card-body">
                            <div class="d-flex justify-content-between align-items-center mb-3">
                                <h3>Tracking No: <span class="text-primary">${app.tracking_number}</span></h3>
                                <span class="badge bg-primary fs-6">${app.service_type}</span>
                            </div>
                            <div class="row g-3 mb-3">
                                <div class="col-md-4">
                                    <span class="text-muted small d-block">Status</span>
                                    <span class="badge bg-info text-dark fs-6">${app.status}</span>
                                </div>
                                <div class="col-md-4">
                                    <span class="text-muted small d-block">Payment Status</span>
                                    <span class="badge bg-secondary fs-6">${app.payment_status}</span>
                                </div>
                                <div class="col-md-4">
                                    <span class="text-muted small d-block">Date Submitted</span>
                                    <strong>${new Date(app.created_at).toLocaleDateString()}</strong>
                                </div>
                            </div>
                            ${app.customer_remarks ? `<div class="alert alert-warning"><i class="fas fa-exclamation-triangle me-2"></i><strong>Admin Message / Correction Notice:</strong> ${app.customer_remarks}</div>` : ''}
                        </div>
                    </div>

                    <div class="card shadow-sm mb-4">
                        <div class="card-header bg-white fw-bold py-3"><i class="fas fa-download me-2 text-success"></i> My Completed Documents (Ready for Download)</div>
                        <div class="card-body">
                            <ul class="list-group list-group-flush mb-0">
                                ${compDocsHtml}
                            </ul>
                        </div>
                    </div>

                    <div class="card shadow-sm mb-4">
                        <div class="card-header bg-white fw-bold py-3"><i class="fas fa-file-upload me-2 text-primary"></i> Uploaded Documents</div>
                        <ul class="list-group list-group-flush">
                            ${docsHtml}
                        </ul>
                    </div>
                </div>

                <div class="col-lg-4">
                    <div class="card shadow-sm mb-4">
                        <div class="card-header bg-white fw-bold py-3"><i class="fas fa-history me-2 text-primary"></i> Status History</div>
                        <div class="table-responsive">
                            <table class="table table-sm align-middle mb-0 small">
                                <thead>
                                    <tr>
                                        <th>Date</th>
                                        <th>Status</th>
                                        <th>Actor</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${historyHtml}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
        res.send(renderLayout('Application Details', content));
    } catch (err) {
        console.error(err);
        res.send(renderLayout('Error', `<div class="container py-5"><div class="alert alert-danger">Error loading application details.</div></div>`));
    }
});

// Public Tracking Page (Without Login)
app.get('/track', async (req, res) => {
    const trackingNo = req.query.tracking_number || '';
    let resultHtml = '';

    if (trackingNo) {
        const trackRes = await pool.query('SELECT * FROM applications WHERE tracking_number = $1', [trackingNo]);
        if (trackRes.rows.length === 0) {
            resultHtml = `<div class="alert alert-danger mt-3">No application found with tracking number: <strong>${trackingNo}</strong></div>`;
        } else {
            const app = trackRes.rows[0];
            resultHtml = `
            <div class="card shadow-sm mt-4 border-primary">
                <div class="card-body">
                    <h4 class="text-primary mb-3">Application Status Result</h4>
                    <p class="mb-2"><strong>Tracking Number:</strong> ${app.tracking_number}</p>
                    <p class="mb-2"><strong>Service:</strong> <span class="badge bg-dark">${app.service_type}</span></p>
                    <p class="mb-2"><strong>Status:</strong> <span class="badge bg-info text-dark">${app.status}</span></p>
                    <p class="mb-2"><strong>Payment Status:</strong> <span class="badge bg-secondary">${app.payment_status}</span></p>
                    <p class="mb-2"><strong>Date Submitted:</strong> ${new Date(app.created_at).toLocaleDateString()}</p>
                    ${app.customer_remarks ? `<p class="mb-0 text-danger"><strong>Remarks:</strong> ${app.customer_remarks}</p>` : ''}
                </div>
            </div>`;
        }
    }

    const content = `
    <nav class="navbar navbar-expand-lg navbar-dark bg-dark">
        <div class="container">
            <a class="navbar-brand" href="/"><i class="fas fa-home me-2"></i>GovAssist PH</a>
            <a href="/customer/login" class="btn btn-outline-light btn-sm">Customer Login</a>
        </div>
    </nav>
    <div class="container py-5">
        <div class="row justify-content-center">
            <div class="col-md-6">
                <div class="card shadow-lg p-4">
                    <div class="text-center mb-4">
                        <h3><i class="fas fa-search text-primary me-2"></i>Track Your Application</h3>
                        <p class="text-muted">Enter your unique tracking number to check live status.</p>
                    </div>
                    <form action="/track" method="GET">
                        <div class="mb-3">
                            <label class="form-label fw-bold">Tracking Number</label>
                            <input type="text" class="form-control" name="tracking_number" value="${trackingNo}" required placeholder="e.g. TIN-20260901-0001">
                        </div>
                        <button type="submit" class="btn btn-primary w-100 py-2 fw-bold">Check Status</button>
                    </form>
                    ${resultHtml}
                    <div class="text-center mt-3">
                        <a href="/" class="small text-decoration-none"><i class="fas fa-arrow-left me-1"></i> Back to Home</a>
                    </div>
                </div>
            </div>
        </div>
    </div>`;
    res.send(renderLayout('Track Application', content));
});


// ==========================================
// ADMIN PORTAL ROUTES
// ==========================================

// Admin Login Page
app.get('/admin/login', (req, res) => {
    const content = `
    <div class="container py-5">
        <div class="row justify-content-center">
            <div class="col-md-5">
                <div class="card shadow-lg p-4 border-top border-primary border-4">
                    <div class="text-center mb-4">
                        <h3><i class="fas fa-user-shield text-primary me-2"></i>Admin Portal Login</h3>
                        <p class="text-muted">Secure management dashboard for GovAssist PH.</p>
                    </div>
                    <form action="/admin/login" method="POST">
                        <div class="mb-3">
                            <label class="form-label fw-bold">Admin Username</label>
                            <input type="text" class="form-control" name="username" required placeholder="admin">
                        </div>
                        <div class="mb-3">
                            <label class="form-label fw-bold">Password</label>
                            <input type="password" class="form-control" name="password" required placeholder="••••••••">
                        </div>
                        <button type="submit" class="btn btn-primary w-100 py-2 fw-bold">Admin Login</button>
                    </form>
                    <div class="text-center mt-3">
                        <a href="/" class="small text-decoration-none"><i class="fas fa-arrow-left me-1"></i> Back to Home</a>
                    </div>
                </div>
            </div>
        </div>
    </div>`;
    res.send(renderLayout('Admin Login', content));
});

app.post('/admin/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const result = await pool.query('SELECT * FROM admin_users WHERE username = $1', [username]);
        if (result.rows.length === 0) {
            return res.send(renderLayout('Admin Login Error', `<div class="container py-5"><div class="alert alert-danger">Invalid admin credentials. <a href="/admin/login">Try again</a></div></div>`));
        }
        const admin = result.rows[0];
        const match = await bcrypt.compare(password, admin.password_hash);
        if (!match) {
            return res.send(renderLayout('Admin Login Error', `<div class="container py-5"><div class="alert alert-danger">Invalid admin credentials. <a href="/admin/login">Try again</a></div></div>`));
        }
        req.session.adminId = admin.id;
        req.session.adminName = admin.full_name;
        req.session.userType = 'admin';
        res.redirect('/admin/dashboard');
    } catch (err) {
        console.error(err);
        res.send(renderLayout('Error', `<div class="container py-5"><div class="alert alert-danger">Login error.</div></div>`));
    }
});

// Admin Logout
app.get('/admin/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/admin/login');
    });
});

// Admin Dashboard & Application Management Table
app.get('/admin/dashboard', requireAdmin, async (req, res) => {
    try {
        const search = req.query.search || '';
        const serviceFilter = req.query.service || '';
        const statusFilter = req.query.status || '';

        let query = `
            SELECT a.*, u.full_name AS customer_name, u.mobile_number, u.email 
            FROM applications a 
            JOIN users u ON a.user_id = u.id 
            WHERE 1=1
        `;
        let params = [];
        let idx = 1;

        if (search) {
            query += ` AND (a.tracking_number ILIKE $${idx} OR u.full_name ILIKE $${idx} OR u.mobile_number ILIKE $${idx} OR u.email ILIKE $${idx})`;
            params.push(`%${search}%`);
            idx++;
        }
        if (serviceFilter) {
            query += ` AND a.service_type = $${idx}`;
            params.push(serviceFilter);
            idx++;
        }
        if (statusFilter) {
            query += ` AND a.status = $${idx}`;
            params.push(statusFilter);
            idx++;
        }

        query += ` ORDER BY a.created_at DESC`;

        const appsRes = await pool.query(query, params);

        // Stats calculations
        const statsRes = await pool.query(`
            SELECT 
                COUNT(*) AS total,
                SUM(CASE WHEN service_type = 'TIN' THEN 1 ELSE 0 END) AS tin_count,
                SUM(CASE WHEN service_type = 'SSS' THEN 1 ELSE 0 END) AS sss_count,
                SUM(CASE WHEN service_type = 'PAGIBIG' THEN 1 ELSE 0 END) AS pagibig_count,
                SUM(CASE WHEN status = 'Submitted' THEN 1 ELSE 0 END) AS submitted_count,
                SUM(CASE WHEN status = 'Under Review' OR status = 'Processing' THEN 1 ELSE 0 END) AS processing_count,
                SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) AS completed_count,
                SUM(CASE WHEN payment_status = 'Paid' THEN payment_fee ELSE 0 END) AS total_revenue
            FROM applications
        `);
        const stats = statsRes.rows[0];

        let tableHtml = '';
        if (appsRes.rows.length === 0) {
            tableHtml = `<tr><td colspan="7" class="text-center py-4 text-muted">No applications found matching criteria.</td></tr>`;
        } else {
            appsRes.rows.forEach(app => {
                tableHtml += `
                <tr>
                    <td class="fw-bold">${app.tracking_number}</td>
                    <td>
                        <div>${app.customer_name}</div>
                        <div class="text-muted small">${app.mobile_number}</div>
                    </td>
                    <td><span class="badge bg-dark">${app.service_type}</span></td>
                    <td><span class="badge bg-info text-dark">${app.status}</span></td>
                    <td><span class="badge bg-secondary">${app.payment_status}</span></td>
                    <td>${new Date(app.created_at).toLocaleDateString()}</td>
                    <td>
                        <a href="/admin/application/${app.id}" class="btn btn-sm btn-primary"><i class="fas fa-user-edit me-1"></i> Review</a>
                    </td>
                </tr>`;
            });
        }

        const content = `
        <div class="container-fluid">
            <div class="row">
                <nav id="sidebar" class="col-md-3 col-lg-2 d-md-block bg-dark sidebar collapse text-white min-vh-100 p-3">
                    <div class="position-sticky">
                        <h4 class="text-primary fw-bold mb-4"><i class="fas fa-shield-alt me-2"></i>Admin Panel</h4>
                        <ul class="nav flex-column gap-2">
                            <li class="nav-item"><a href="/admin/dashboard" class="nav-link text-white active bg-primary rounded"><i class="fas fa-tachometer-alt me-2"></i> Dashboard</a></li>
                            <li class="nav-item"><a href="/admin/reports" class="nav-link text-white"><i class="fas fa-chart-bar me-2"></i> Reports & Export</a></li>
                            <li class="nav-item"><a href="/admin/settings" class="nav-link text-white"><i class="fas fa-cogs me-2"></i> System Settings</a></li>
                            <li class="nav-item mt-4"><a href="/admin/logout" class="nav-link text-danger"><i class="fas fa-sign-out-alt me-2"></i> Logout</a></li>
                        </ul>
                    </div>
                </nav>

                <main class="col-md-9 ms-sm-auto col-lg-10 px-md-4 py-4">
                    <div class="d-flex justify-content-between align-items-center mb-4">
                        <h2>Admin Dashboard Overview</h2>
                        <span class="text-muted">Logged in as: <strong>${req.session.adminName}</strong></span>
                    </div>

                    <div class="row g-3 mb-4">
                        <div class="col-md-3">
                            <div class="card p-3 bg-primary text-white shadow-sm">
                                <div class="small">Total Applications</div>
                                <div class="fs-3 fw-bold">${stats.total || 0}</div>
                            </div>
                        </div>
                        <div class="col-md-3">
                            <div class="card p-3 bg-info text-dark shadow-sm">
                                <div class="small">TIN / SSS / Pag-IBIG</div>
                                <div class="fs-6 fw-bold">${stats.tin_count} TIN | ${stats.sss_count} SSS | ${stats.pagibig_count} Pag-IBIG</div>
                            </div>
                        </div>
                        <div class="col-md-3">
                            <div class="card p-3 bg-warning text-dark shadow-sm">
                                <div class="small">Pending / Processing</div>
                                <div class="fs-3 fw-bold">${stats.processing_count || 0}</div>
                            </div>
                        </div>
                        <div class="col-md-3">
                            <div class="card p-3 bg-success text-white shadow-sm">
                                <div class="small">Collected Revenue</div>
                                <div class="fs-3 fw-bold">₱${parseFloat(stats.total_revenue || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}</div>
                            </div>
                        </div>
                    </div>

                    <div class="card shadow-sm mb-4 p-3">
                        <form action="/admin/dashboard" method="GET" class="row g-3">
                            <div class="col-md-4">
                                <input type="text" class="form-control" name="search" value="${search}" placeholder="Search name, tracking no, mobile...">
                            </div>
                            <div class="col-md-3">
                                <select class="form-select" name="service">
                                    <option value="">All Services</option>
                                    <option value="TIN" ${serviceFilter === 'TIN' ? 'selected' : ''}>BIR / TIN</option>
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
                                <button type="submit" class="btn btn-primary w-100"><i class="fas fa-filter me-1"></i> Filter</button>
                            </div>
                        </form>
                    </div>

                    <div class="card shadow-sm">
                        <div class="card-header bg-white fw-bold py-3"><i class="fas fa-list me-2 text-primary"></i> Application Management Table</div>
                        <div class="table-responsive">
                            <table class="table table-hover align-middle mb-0">
                                <thead class="table-light">
                                    <tr>
                                        <th>Tracking No.</th>
                                        <th>Applicant</th>
                                        <th>Service</th>
                                        <th>Status</th>
                                        <th>Payment</th>
                                        <th>Date</th>
                                        <th>Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${tableHtml}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </main>
            </div>
        </div>`;
        res.send(renderLayout('Admin Dashboard', content));
    } catch (err) {
        console.error(err);
        res.send(renderLayout('Error', `<div class="container py-5"><div class="alert alert-danger">Error loading admin dashboard.</div></div>`));
    }
});

// Admin Applicant Detail Profile (Comprehensive View of ALL Data)
app.get('/admin/application/:id', requireAdmin, async (req, res) => {
    try {
        const appId = req.params.id;
        const appRes = await pool.query(`
            SELECT a.*, u.full_name AS acc_name, u.mobile_number AS acc_mobile, u.email AS acc_email 
            FROM applications a 
            JOIN users u ON a.user_id = u.id 
            WHERE a.id = $1
        `, [appId]);

        if (appRes.rows.length === 0) {
            return res.send(renderLayout('Not Found', `<div class="container py-5"><div class="alert alert-danger">Application not found.</div></div>`));
        }
        const app = appRes.rows[0];

        const personalRes = await pool.query('SELECT * FROM personal_information WHERE application_id = $1', [appId]);
        const parentsRes = await pool.query('SELECT * FROM parent_information WHERE application_id = $1', [appId]);
        const benRes = await pool.query('SELECT * FROM beneficiaries WHERE application_id = $1', [appId]);
        const spouseRes = await pool.query('SELECT * FROM spouse_information WHERE application_id = $1', [appId]);
        const empRes = await pool.query('SELECT * FROM employment_information WHERE application_id = $1', [appId]);
        const docsRes = await pool.query('SELECT * FROM documents WHERE application_id = $1', [appId]);
        const compDocsRes = await pool.query('SELECT * FROM completed_documents WHERE application_id = $1', [appId]);
        const historyRes = await pool.query('SELECT * FROM status_history WHERE application_id = $1 ORDER BY created_at DESC', [appId]);

        const p = personalRes.rows[0] || {};
        const par = parentsRes.rows[0] || {};
        const spouse = spouseRes.rows[0] || {};
        const emp = empRes.rows[0] || {};

        let benHtml = '';
        if (benRes.rows.length === 0) {
            benHtml = `<p class="text-muted small">No beneficiaries listed.</p>`;
        } else {
            benRes.rows.forEach((b, idx) => {
                benHtml += `<div class="border-bottom pb-2 mb-2">
                    <strong>#${idx+1} ${b.full_name}</strong> (${b.relationship})<br>
                    <small class="text-muted">DOB: ${b.date_of_birth ? new Date(b.date_of_birth).toLocaleDateString() : 'N/A'} | Address: ${b.address}</small>
                </div>`;
            });
        }

        let docsHtml = '';
        docsRes.rows.forEach(d => {
            docsHtml += `<li class="list-group-item d-flex justify-content-between align-items-center">
                <span><i class="fas fa-file-alt text-primary me-2"></i><strong>${d.document_type}</strong> (${d.original_name})</span>
                <div>
                    <a href="/uploads/${d.file_path}" target="_blank" class="btn btn-sm btn-outline-primary me-1"><i class="fas fa-eye"></i> View</a>
                    <a href="/uploads/${d.file_path}" download class="btn btn-sm btn-outline-secondary"><i class="fas fa-download"></i></a>
                </div>
            </li>`;
        });

        let compDocsHtml = '';
        compDocsRes.rows.forEach(cd => {
            compDocsHtml += `<li class="list-group-item d-flex justify-content-between align-items-center">
                <span><i class="fas fa-check-circle text-success me-2"></i><strong>${cd.document_type}</strong> (${cd.original_name})</span>
                <form action="/admin/application/${appId}/delete-completed" method="POST" class="d-inline">
                    <input type="hidden" name="doc_id" value="${cd.id}">
                    <button type="submit" class="btn btn-sm btn-outline-danger"><i class="fas fa-trash"></i></button>
                </form>
            </li>`;
        });

        let historyHtml = '';
        historyRes.rows.forEach(h => {
            historyHtml += `<tr><td>${new Date(h.created_at).toLocaleString()}</td><td><span class="badge bg-secondary">${h.new_status}</span></td><td>${h.actor}</td><td>${h.remarks || '-'}</td></tr>`;
        });

        const content = `
        <div class="container-fluid py-4">
            <div class="d-flex justify-content-between align-items-center mb-4">
                <div>
                    <a href="/admin/dashboard" class="btn btn-outline-secondary btn-sm mb-2"><i class="fas fa-arrow-left me-1"></i> Back to Dashboard</a>
                    <h2>Applicant Profile & Management</h2>
                </div>
                <div>
                    <a href="/admin/application/${appId}/print" target="_blank" class="btn btn-dark"><i class="fas fa-print me-1"></i> Print Application</a>
                </div>
            </div>

            <div class="row">
                <div class="col-lg-8">
                    <div class="card shadow-sm mb-4">
                        <div class="card-header bg-primary text-white fw-bold"><i class="fas fa-id-card me-2"></i> Personal Information (${app.service_type})</div>
                        <div class="card-body">
                            <div class="row g-3">
                                <div class="col-md-4"><span class="text-muted small d-block">Full Name</span><strong>${p.first_name} ${p.middle_name || ''} ${p.last_name} ${p.suffix || ''}</strong></div>
                                <div class="col-md-4"><span class="text-muted small d-block">Date of Birth</span><strong>${p.date_of_birth ? new Date(p.date_of_birth).toLocaleDateString() : 'N/A'}</strong></div>
                                <div class="col-md-4"><span class="text-muted small d-block">Place of Birth</span><strong>${p.place_of_birth}</strong></div>
                                <div class="col-md-3"><span class="text-muted small d-block">Sex</span><strong>${p.sex}</strong></div>
                                <div class="col-md-3"><span class="text-muted small d-block">Civil Status</span><strong>${p.civil_status}</strong></div>
                                <div class="col-md-3"><span class="text-muted small d-block">Nationality</span><strong>${p.nationality}</strong></div>
                                <div class="col-md-3"><span class="text-muted small d-block">Mobile</span><strong>${p.mobile_number}</strong></div>
                            </div>
                        </div>
                    </div>

                    <div class="card shadow-sm mb-4">
                        <div class="card-header bg-white fw-bold"><i class="fas fa-map-marker-alt me-2 text-primary"></i> Address Information</div>
                        <div class="card-body">
                            <p class="mb-1"><strong>Complete Address:</strong> ${p.complete_address}, Brgy. ${p.barangay}, ${p.municipality_city}, ${p.province} (${p.zip_code})</p>
                        </div>
                    </div>

                    <div class="card shadow-sm mb-4">
                        <div class="card-header bg-white fw-bold"><i class="fas fa-users me-2 text-primary"></i> Parents Information</div>
                        <div class="card-body row">
                            <div class="col-md-6 border-end">
                                <h6 class="text-secondary fw-bold">Father</h6>
                                <p class="mb-1">${par.father_first_name || ''} ${par.father_middle_name || ''} ${par.father_last_name || 'N/A'}</p>
                                <small class="text-muted">DOB: ${par.father_dob ? new Date(par.father_dob).toLocaleDateString() : 'N/A'}</small>
                            </div>
                            <div class="col-md-6">
                                <h6 class="text-secondary fw-bold">Mother</h6>
                                <p class="mb-1">${par.mother_first_name || ''} ${par.mother_middle_name || ''} ${par.mother_maiden_name || ''} ${par.mother_last_name || 'N/A'}</p>
                                <small class="text-muted">DOB: ${par.mother_dob ? new Date(par.mother_dob).toLocaleDateString() : 'N/A'}</small>
                            </div>
                        </div>
                    </div>

                    <div class="card shadow-sm mb-4">
                        <div class="card-header bg-white fw-bold"><i class="fas fa-heart me-2 text-primary"></i> Beneficiaries & Spouse</div>
                        <div class="card-body">
                            <h6 class="text-secondary fw-bold">Beneficiaries</h6>
                            ${benHtml}
                            <h6 class="text-secondary fw-bold mt-3">Spouse Information</h6>
                            <p class="mb-0">${spouse.spouse_full_name ? `${spouse.spouse_full_name} (DOB: ${spouse.spouse_dob ? new Date(spouse.spouse_dob).toLocaleDateString() : 'N/A'}, Occupation: ${spouse.spouse_occupation})` : 'None / Not Applicable'}</p>
                        </div>
                    </div>

                    <div class="card shadow-sm mb-4">
                        <div class="card-header bg-white fw-bold"><i class="fas fa-briefcase me-2 text-primary"></i> Employment Information</div>
                        <div class="card-body">
                            <div class="row g-2">
                                <div class="col-md-4"><strong>Status:</strong> ${emp.employment_status || 'N/A'}</div>
                                <div class="col-md-4"><strong>Source of Income:</strong> ${emp.source_of_income || 'N/A'}</div>
                                <div class="col-md-4"><strong>Monthly Income:</strong> ₱${parseFloat(emp.monthly_income || 0).toLocaleString()}</div>
                                <div class="col-12 mt-2"><strong>Employer:</strong> ${emp.employer_name || 'N/A'} (${emp.employer_address || ''})</div>
                            </div>
                        </div>
                    </div>

                    <div class="card shadow-sm mb-4">
                        <div class="card-header bg-white fw-bold"><i class="fas fa-file-upload me-2 text-primary"></i> Uploaded Documents</div>
                        <ul class="list-group list-group-flush">
                            ${docsHtml}
                        </ul>
                    </div>

                    <div class="card shadow-sm mb-4 border-success">
                        <div class="card-header bg-success text-white fw-bold"><i class="fas fa-check-double me-2"></i> Completed Government Documents (Uploaded by Admin)</div>
                        <div class="card-body">
                            <ul class="list-group list-group-flush mb-3">
                                ${compDocsHtml}
                            </ul>
                            <form action="/admin/application/${appId}/upload-completed" method="POST" enctype="multipart/form-data" class="d-flex gap-2">
                                <input type="file" class="form-control" name="completed_docs" multiple required>
                                <button type="submit" class="btn btn-success text-nowrap"><i class="fas fa-upload me-1"></i> Upload Completed Doc</button>
                            </form>
                        </div>
                    </div>
                </div>

                <div class="col-lg-4">
                    <div class="card shadow-sm mb-4 border-primary">
                        <div class="card-header bg-primary text-white fw-bold"><i class="fas fa-tasks me-2"></i> Update Application Status</div>
                        <div class="card-body">
                            <form action="/admin/application/${appId}/status" method="POST">
                                <div class="mb-3">
                                    <label class="form-label fw-bold">Current Status</label>
                                    <select class="form-select" name="status">
                                        <option value="Submitted" ${app.status === 'Submitted' ? 'selected' : ''}>Submitted</option>
                                        <option value="Under Review" ${app.status === 'Under Review' ? 'selected' : ''}>Under Review</option>
                                        <option value="Need Correction" ${app.status === 'Need Correction' ? 'selected' : ''}>Need Correction</option>
                                        <option value="Processing" ${app.status === 'Processing' ? 'selected' : ''}>Processing</option>
                                        <option value="Ready" ${app.status === 'Ready' ? 'selected' : ''}>Ready</option>
                                        <option value="Completed" ${app.status === 'Completed' ? 'selected' : ''}>Completed</option>
                                        <option value="Rejected" ${app.status === 'Rejected' ? 'selected' : ''}>Rejected</option>
                                    </select>
                                </div>
                                <div class="mb-3">
                                    <label class="form-label fw-bold">Customer Remarks / Correction Notice</label>
                                    <textarea class="form-control" name="customer_remarks" rows="3" placeholder="e.g. Please upload a clearer valid ID image.">${app.customer_remarks || ''}</textarea>
                                </div>
                                <div class="mb-3">
                                    <label class="form-label fw-bold">Internal Admin Notes</label>
                                    <textarea class="form-control" name="admin_notes" rows="2">${app.admin_notes || ''}</textarea>
                                </div>
                                <button type="submit" class="btn btn-primary w-100 fw-bold">Save Status & Remarks</button>
                            </form>
                        </div>
                    </div>

                    <div class="card shadow-sm mb-4">
                        <div class="card-header bg-white fw-bold"><i class="fas fa-money-bill-wave me-2 text-primary"></i> Payment Information</div>
                        <div class="card-body">
                            <p class="mb-1"><strong>Fee:</strong> ₱${parseFloat(app.payment_fee || 0).toFixed(2)}</p>
                            <p class="mb-1"><strong>Method:</strong> ${app.payment_method}</p>
                            <p class="mb-1"><strong>Status:</strong> <span class="badge bg-secondary">${app.payment_status}</span></p>
                            <p class="mb-2"><strong>Reference No:</strong> ${app.payment_ref || 'None'}</p>
                            ${app.payment_proof ? `<a href="/uploads/${app.payment_proof}" target="_blank" class="btn btn-sm btn-outline-primary mb-3"><i class="fas fa-receipt"></i> View Payment Proof</a>` : ''}
                            
                            <form action="/admin/application/${appId}/payment" method="POST">
                                <div class="mb-2">
                                    <select class="form-select form-select-sm" name="payment_status">
                                        <option value="Unpaid" ${app.payment_status === 'Unpaid' ? 'selected' : ''}>Unpaid</option>
                                        <option value="Payment Verification" ${app.payment_status === 'Payment Verification' ? 'selected' : ''}>Payment Verification</option>
                                        <option value="Paid" ${app.payment_status === 'Paid' ? 'selected' : ''}>Paid</option>
                                        <option value="Payment Rejected" ${app.payment_status === 'Payment Rejected' ? 'selected' : ''}>Payment Rejected</option>
                                    </select>
                                </div>
                                <button type="submit" class="btn btn-sm btn-outline-success w-100">Update Payment Status</button>
                            </form>
                        </div>
                    </div>

                    <div class="card shadow-sm mb-4">
                        <div class="card-header bg-white fw-bold"><i class="fas fa-history me-2 text-primary"></i> Status History Log</div>
                        <div class="table-responsive" style="max-height: 250px;">
                            <table class="table table-sm small mb-0">
                                <thead><tr><th>Date</th><th>Status</th><th>Actor</th></tr></thead>
                                <tbody>${historyHtml}</tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
        res.send(renderLayout('Applicant Profile', content));
    } catch (err) {
        console.error(err);
        res.send(renderLayout('Error', `<div class="container py-5"><div class="alert alert-danger">Error loading applicant profile.</div></div>`));
    }
});

// Admin update status
app.post('/admin/application/:id/status', requireAdmin, async (req, res) => {
    const appId = req.params.id;
    const { status, customer_remarks, admin_notes } = req.body;
    try {
        const currentRes = await pool.query('SELECT status, user_id, tracking_number FROM applications WHERE id = $1', [appId]);
        const currentApp = currentRes.rows[0];
        const prevStatus = currentApp.status;

        await pool.query(
            'UPDATE applications SET status = $1, customer_remarks = $2, admin_notes = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4',
            [status, customer_remarks, admin_notes, appId]
        );

        if (prevStatus !== status) {
            await logStatusHistory(appId, prevStatus, status, 'Admin', customer_remarks || `Status updated to ${status}`);
            await createNotification(currentApp.user_id, 'Application Status Update', `Your application ${currentApp.tracking_number} status is now: ${status}.`);
        }

        res.redirect(`/admin/application/${appId}`);
    } catch (err) {
        console.error(err);
        res.send(renderLayout('Error', `<div class="container py-5"><div class="alert alert-danger">Error updating status.</div></div>`));
    }
});

// Admin update payment status
app.post('/admin/application/:id/payment', requireAdmin, async (req, res) => {
    const appId = req.params.id;
    const { payment_status } = req.body;
    try {
        const appRes = await pool.query('SELECT user_id, tracking_number FROM applications WHERE id = $1', [appId]);
        const app = appRes.rows[0];

        await pool.query('UPDATE applications SET payment_status = $1 WHERE id = $2', [payment_status, appId]);
        if (payment_status === 'Paid') {
            await createNotification(app.user_id, 'Payment Verified', `Your payment for application ${app.tracking_number} has been verified and marked as Paid.`);
        }
        res.redirect(`/admin/application/${appId}`);
    } catch (err) {
        console.error(err);
        res.send(renderLayout('Error', `<div class="container py-5"><div class="alert alert-danger">Error updating payment status.</div></div>`));
    }
});

// Admin upload completed documents
const uploadCompletedFiles = upload.array('completed_docs', 10);
app.post('/admin/application/:id/upload-completed', requireAdmin, uploadCompletedFiles, async (req, res) => {
    const appId = req.params.id;
    try {
        if (req.files) {
            for (const file of req.files) {
                await pool.query(
                    'INSERT INTO completed_documents (application_id, file_path, original_name) VALUES ($1, $2, $3)',
                    [appId, file.filename, file.originalname]
                );
            }
            const appRes = await pool.query('SELECT user_id, tracking_number FROM applications WHERE id = $1', [appId]);
            const app = appRes.rows[0];
            await createNotification(app.user_id, 'Completed Document Ready', `New completed document uploaded for application ${app.tracking_number}. You can now download it.`);
        }
        res.redirect(`/admin/application/${appId}`);
    } catch (err) {
        console.error(err);
        res.send(renderLayout('Error', `<div class="container py-5"><div class="alert alert-danger">Error uploading completed document.</div></div>`));
    }
});

app.post('/admin/application/:id/delete-completed', requireAdmin, async (req, res) => {
    const appId = req.params.id;
    const { doc_id } = req.body;
    try {
        await pool.query('DELETE FROM completed_documents WHERE id = $1', [doc_id]);
        res.redirect(`/admin/application/${appId}`);
    } catch (err) {
        console.error(err);
        res.send(renderLayout('Error', `<div class="container py-5"><div class="alert alert-danger">Error deleting completed document.</div></div>`));
    }
});

// Admin Print Application Page
app.get('/admin/application/:id/print', requireAdmin, async (req, res) => {
    try {
        const appId = req.params.id;
        const appRes = await pool.query('SELECT * FROM applications WHERE id = $1', [appId]);
        const pRes = await pool.query('SELECT * FROM personal_information WHERE application_id = $1', [appId]);
        const parRes = await pool.query('SELECT * FROM parent_information WHERE application_id = $1', [appId]);
        const benRes = await pool.query('SELECT * FROM beneficiaries WHERE application_id = $1', [appId]);
        const spouseRes = await pool.query('SELECT * FROM spouse_information WHERE application_id = $1', [appId]);
        const empRes = await pool.query('SELECT * FROM employment_information WHERE application_id = $1', [appId]);

        const app = appRes.rows[0];
        const p = pRes.rows[0] || {};
        const par = parRes.rows[0] || {};
        const spouse = spouseRes.rows[0] || {};
        const emp = empRes.rows[0] || {};

        let benList = '';
        benRes.rows.forEach((b, i) => {
            benList += `<li>${b.full_name} (${b.relationship}) - DOB: ${b.date_of_birth ? new Date(b.date_of_birth).toLocaleDateString() : 'N/A'}, Address: ${b.address}</li>`;
        });

        const html = `<!DOCTYPE html>
        <html>
        <head>
            <title>Print Application - ${app.tracking_number}</title>
            <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
            <style>
                body { background: white; color: black; font-size: 14px; }
                @media print { .no-print { display: none; } }
            </style>
        </head>
        <body onload="window.print()">
            <div class="container my-4">
                <div class="text-center mb-4">
                    <h3>GOVERNMENT ASSISTANCE APPLICATION REFERENCE</h3>
                    <h5>Service: ${app.service_type} | Tracking No: ${app.tracking_number}</h5>
                    <p class="text-muted small">Date Submitted: ${new Date(app.created_at).toLocaleString()}</p>
                </div>
                <hr>
                <h5>1. Personal Information</h5>
                <p><strong>Full Name:</strong> ${p.first_name} ${p.middle_name || ''} ${p.last_name} ${p.suffix || ''}</p>
                <p><strong>Date of Birth:</strong> ${p.date_of_birth ? new Date(p.date_of_birth).toLocaleDateString() : 'N/A'} | <strong>Place of Birth:</strong> ${p.place_of_birth}</p>
                <p><strong>Sex:</strong> ${p.sex} | <strong>Civil Status:</strong> ${p.civil_status} | <strong>Nationality:</strong> ${p.nationality}</p>
                <p><strong>Mobile:</strong> ${p.mobile_number} | <strong>Email:</strong> ${p.email_address}</p>
                <p><strong>Complete Address:</strong> ${p.complete_address}, Brgy. ${p.barangay}, ${p.municipality_city}, ${p.province} (${p.zip_code})</p>

                <h5 class="mt-4">2. Parents Information</h5>
                <p><strong>Father:</strong> ${par.father_first_name || ''} ${par.father_middle_name || ''} ${par.father_last_name || 'N/A'} (DOB: ${par.father_dob || 'N/A'})</p>
                <p><strong>Mother:</strong> ${par.mother_first_name || ''} ${par.mother_middle_name || ''} ${par.mother_maiden_name || ''} ${par.mother_last_name || 'N/A'} (DOB: ${par.mother_dob || 'N/A'})</p>

                <h5 class="mt-4">3. Beneficiaries</h5>
                <ul>${benList || '<li>None</li>'}</ul>

                <h5 class="mt-4">4. Spouse Information</h5>
                <p>${spouse.spouse_full_name ? `${spouse.spouse_full_name} (DOB: ${spouse.spouse_dob}, Occupation: ${spouse.spouse_occupation})` : 'None / Not Applicable'}</p>

                <h5 class="mt-4">5. Employment Information</h5>
                <p><strong>Status:</strong> ${emp.employment_status} | <strong>Source of Income:</strong> ${emp.source_of_income} | <strong>Monthly Income:</strong> ₱${emp.monthly_income}</p>
                <p><strong>Employer:</strong> ${emp.employer_name || 'N/A'} (${emp.employer_address || ''}) - Contact: ${emp.employer_contact || 'N/A'}</p>

                <h5 class="mt-4">6. Payment Information</h5>
                <p><strong>Method:</strong> ${app.payment_method} | <strong>Fee:</strong> ₱${app.payment_fee} | <strong>Status:</strong> ${app.payment_status} | <strong>Ref:</strong> ${app.payment_ref || 'N/A'}</p>

                <div class="mt-5 no-print text-center">
                    <button onclick="window.print()" class="btn btn-primary px-4">Print Again</button>
                </div>
            </div>
        </body>
        </html>`;
        res.send(html);
    } catch (err) {
        console.error(err);
        res.send('Error generating print page.');
    }
});

// Admin Reports Page
app.get('/admin/reports', requireAdmin, async (req, res) => {
    try {
        const service = req.query.service || '';
        const status = req.query.status || '';

        let query = `SELECT a.*, u.full_name AS customer_name FROM applications a JOIN users u ON a.user_id = u.id WHERE 1=1`;
        let params = [];
        let idx = 1;
        if (service) { query += ` AND a.service_type = $${idx}`; params.push(service); idx++; }
        if (status) { query += ` AND a.status = $${idx}`; params.push(status); idx++; }
        query += ` ORDER BY a.created_at DESC`;

        const resApps = await pool.query(query, params);
        const aggRes = await pool.query(`
            SELECT 
                COUNT(*) AS total_count,
                SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) AS completed_count,
                SUM(CASE WHEN status = 'Submitted' OR status = 'Under Review' OR status = 'Processing' THEN 1 ELSE 0 END) AS pending_count,
                SUM(CASE WHEN payment_status = 'Paid' THEN payment_fee ELSE 0 END) AS total_collected
            FROM applications
        `);
        const agg = aggRes.rows[0];

        let rowsHtml = '';
        resApps.rows.forEach(a => {
            rowsHtml += `<tr>
                <td>${a.tracking_number}</td>
                <td>${a.customer_name}</td>
                <td><span class="badge bg-dark">${a.service_type}</span></td>
                <td><span class="badge bg-info text-dark">${a.status}</span></td>
                <td><span class="badge bg-secondary">${a.payment_status}</span></td>
                <td>₱${parseFloat(a.payment_fee).toFixed(2)}</td>
                <td>${new Date(a.created_at).toLocaleDateString()}</td>
            </tr>`;
        });

        const content = `
        <div class="container-fluid py-4">
            <div class="d-flex justify-content-between align-items-center mb-4">
                <h2>Admin Reports & Analytics</h2>
                <a href="/admin/dashboard" class="btn btn-outline-secondary btn-sm"><i class="fas fa-arrow-left me-1"></i> Dashboard</a>
            </div>

            <div class="row g-3 mb-4">
                <div class="col-md-3">
                    <div class="card p-3 bg-light shadow-sm">
                        <div class="text-muted small">Total Filtered Applications</div>
                        <div class="fs-4 fw-bold">${resApps.rows.length}</div>
                    </div>
                </div>
                <div class="col-md-3">
                    <div class="card p-3 bg-light shadow-sm">
                        <div class="text-muted small">Completed Applications</div>
                        <div class="fs-4 fw-bold text-success">${agg.completed_count}</div>
                    </div>
                </div>
                <div class="col-md-3">
                    <div class="card p-3 bg-light shadow-sm">
                        <div class="text-muted small">Pending Applications</div>
                        <div class="fs-4 fw-bold text-warning">${agg.pending_count}</div>
                    </div>
                </div>
                <div class="col-md-3">
                    <div class="card p-3 bg-light shadow-sm">
                        <div class="text-muted small">Total Collected Fees</div>
                        <div class="fs-4 fw-bold text-primary">₱${parseFloat(agg.total_collected || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}</div>
                    </div>
                </div>
            </div>

            <div class="card shadow-sm mb-4 p-3">
                <form action="/admin/reports" method="GET" class="row g-3">
                    <div class="col-md-4">
                        <select class="form-select" name="service">
                            <option value="">All Services</option>
                            <option value="TIN" ${service === 'TIN' ? 'selected' : ''}>BIR / TIN</option>
                            <option value="SSS" ${service === 'SSS' ? 'selected' : ''}>SSS</option>
                            <option value="PAGIBIG" ${service === 'PAGIBIG' ? 'selected' : ''}>Pag-IBIG</option>
                        </select>
                    </div>
                    <div class="col-md-4">
                        <select class="form-select" name="status">
                            <option value="">All Statuses</option>
                            <option value="Submitted" ${status === 'Submitted' ? 'selected' : ''}>Submitted</option>
                            <option value="Completed" ${status === 'Completed' ? 'selected' : ''}>Completed</option>
                        </select>
                    </div>
                    <div class="col-md-4">
                        <button type="submit" class="btn btn-primary w-100"><i class="fas fa-filter me-1"></i> Generate Report</button>
                    </div>
                </form>
            </div>

            <div class="card shadow-sm">
                <div class="card-header bg-white fw-bold py-3"><i class="fas fa-table me-2 text-primary"></i> Report Data Table</div>
                <div class="table-responsive">
                    <table class="table table-hover align-middle mb-0">
                        <thead class="table-light">
                            <tr>
                                <th>Tracking No.</th>
                                <th>Applicant</th>
                                <th>Service</th>
                                <th>Status</th>
                                <th>Payment</th>
                                <th>Fee</th>
                                <th>Date</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rowsHtml}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>`;
        res.send(renderLayout('Admin Reports', content));
    } catch (err) {
        console.error(err);
        res.send(renderLayout('Error', `<div class="container py-5"><div class="alert alert-danger">Error generating reports.</div></div>`));
    }
});

// Admin System Settings Page
app.get('/admin/settings', requireAdmin, async (req, res) => {
    try {
        const settings = await getSettings();
        const content = `
        <div class="container-fluid py-4">
            <div class="d-flex justify-content-between align-items-center mb-4">
                <h2>System Settings & Configuration</h2>
                <a href="/admin/dashboard" class="btn btn-outline-secondary btn-sm"><i class="fas fa-arrow-left me-1"></i> Dashboard</a>
            </div>

            <div class="row justify-content-center">
                <div class="col-md-8">
                    <div class="card shadow-sm p-4">
                        <form action="/admin/settings" method="POST">
                            <h4 class="text-primary mb-3">General Business Information</h4>
                            <div class="mb-3">
                                <label class="form-label fw-bold">Business / Service Name</label>
                                <input type="text" class="form-control" name="business_name" value="${settings.business_name || ''}" required>
                            </div>
                            <div class="row g-3 mb-3">
                                <div class="col-md-6">
                                    <label class="form-label fw-bold">Contact Number</label>
                                    <input type="text" class="form-control" name="contact_number" value="${settings.contact_number || ''}">
                                </div>
                                <div class="col-md-6">
                                    <label class="form-label fw-bold">Email Address</label>
                                    <input type="email" class="form-control" name="email" value="${settings.email || ''}">
                                </div>
                            </div>

                            <h4 class="text-primary mb-3 mt-4">GCash Payment Configuration</h4>
                            <div class="row g-3 mb-3">
                                <div class="col-md-6">
                                    <label class="form-label fw-bold">GCash Account Name</label>
                                    <input type="text" class="form-control" name="gcash_name" value="${settings.gcash_name || ''}">
                                </div>
                                <div class="col-md-6">
                                    <label class="form-label fw-bold">GCash Account Number</label>
                                    <input type="text" class="form-control" name="gcash_number" value="${settings.gcash_number || ''}">
                                </div>
                            </div>

                            <h4 class="text-primary mb-3 mt-4">Service Fees (PHP)</h4>
                            <div class="row g-3 mb-4">
                                <div class="col-md-4">
                                    <label class="form-label fw-bold">BIR / TIN Fee</label>
                                    <input type="number" step="0.01" class="form-control" name="fee_tin" value="${settings.fee_tin || '350.00'}">
                                </div>
                                <div class="col-md-4">
                                    <label class="form-label fw-bold">SSS Fee</label>
                                    <input type="number" step="0.01" class="form-control" name="fee_sss" value="${settings.fee_sss || '500.00'}">
                                </div>
                                <div class="col-md-4">
                                    <label class="form-label fw-bold">Pag-IBIG Fee</label>
                                    <input type="number" step="0.01" class="form-control" name="fee_pagibig" value="${settings.fee_pagibig || '450.00'}">
                                </div>
                            </div>

                            <button type="submit" class="btn btn-primary px-4 py-2 fw-bold">Save Settings</button>
                        </form>
                    </div>
                </div>
            </div>
        </div>`;
        res.send(renderLayout('System Settings', content));
    } catch (err) {
        console.error(err);
        res.send(renderLayout('Error', `<div class="container py-5"><div class="alert alert-danger">Error loading settings.</div></div>`));
    }
});

app.post('/admin/settings', requireAdmin, async (req, res) => {
    try {
        const keys = Object.keys(req.body);
        for (const key of keys) {
            const value = req.body[key];
            await pool.query(
                `INSERT INTO system_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2`,
                [key, value]
            );
        }
        res.redirect('/admin/settings');
    } catch (err) {
        console.error(err);
        res.send(renderLayout('Error', `<div class="container py-5"><div class="alert alert-danger">Error saving settings.</div></div>`));
    }
});

// ==========================================
// START SERVER
// ==========================================
app.listen(PORT, () => {
    console.log(`GovAssist PH Application Assistance System running on port ${PORT}`);
});
