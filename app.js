/**
 * COMPLETE BIR/TIN, SSS & PAG-IBIG APPLICATION ASSISTANCE SYSTEM
 * Production-ready single-file Node.js/Express application.
 */

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure upload directory exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: });
}

// Multer storage config
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
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
        const extName = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimeType = allowedTypes.test(file.mimetype);
        if (extName && mimeType) {
            return cb(null, true);
        }
        cb(new Error('Only images and PDF files are allowed!'));
    }
});

// Database Setup
const dbFile = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbFile, (err) => {
    if (err) console.error('Database opening error: ' + err.message);
    else console.log('Connected to SQLite database.');
});

// Initialize Database Tables
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fullname TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        mobile TEXT NOT NULL,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS admin_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        service_type TEXT NOT NULL,
        tracking_number TEXT UNIQUE NOT NULL,
        status TEXT DEFAULT 'Submitted',
        payment_status TEXT DEFAULT 'Unpaid',
        payment_method TEXT,
        amount_paid REAL DEFAULT 0,
        reference_number TEXT,
        payment_date TEXT,
        gcash_proof TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS applicant_information (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        application_id INTEGER,
        firstname TEXT,
        middlename TEXT,
        lastname TEXT,
        suffix TEXT,
        dob TEXT,
        pob TEXT,
        sex TEXT,
        civil_status TEXT,
        nationality TEXT,
        mobile TEXT,
        email TEXT,
        house TEXT,
        street TEXT,
        barangay TEXT,
        municipality TEXT,
        province TEXT,
        zipcode TEXT,
        FOREIGN KEY(application_id) REFERENCES applications(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS parents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        application_id INTEGER,
        father_firstname TEXT,
        father_middlename TEXT,
        father_lastname TEXT,
        father_dob TEXT,
        mother_firstname TEXT,
        mother_middlename TEXT,
        mother_maidenname TEXT,
        mother_lastname TEXT,
        mother_dob TEXT,
        FOREIGN KEY(application_id) REFERENCES applications(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS spouses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        application_id INTEGER,
        fullname TEXT,
        dob TEXT,
        marriage_cert TEXT,
        FOREIGN KEY(application_id) REFERENCES applications(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS beneficiaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        application_id INTEGER,
        fullname TEXT,
        relationship TEXT,
        dob TEXT,
        sex TEXT,
        address TEXT,
        FOREIGN KEY(application_id) REFERENCES applications(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS employment (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        application_id INTEGER,
        status TEXT,
        employer_name TEXT,
        employer_address TEXT,
        employer_contact TEXT,
        occupation TEXT,
        position TEXT,
        monthly_income TEXT,
        date_started TEXT,
        business_name TEXT,
        business_address TEXT,
        FOREIGN KEY(application_id) REFERENCES applications(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        application_id INTEGER,
        doc_type TEXT,
        file_path TEXT,
        original_name TEXT,
        uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(application_id) REFERENCES applications(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS completed_documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        application_id INTEGER,
        file_name TEXT,
        file_path TEXT,
        file_type TEXT,
        description TEXT,
        uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(application_id) REFERENCES applications(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS status_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        application_id INTEGER,
        action TEXT,
        user_name TEXT,
        remarks TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(application_id) REFERENCES applications(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        message TEXT,
        is_read INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    // Seed default admin and settings if not present
    db.get("SELECT * FROM admin_users WHERE username = 'admin'", (err, row) => {
        if (!row) {
            const hashed = bcrypt.hashSync('admin123', 10);
            db.run("INSERT INTO admin_users (username, password) VALUES (?, ?)", ['admin', hashed]);
        }
    });

    const defaultSettings = [
        ['business_name', 'GovAssist PH'],
        ['contact_number', '+63 912 345 6789'],
        ['email', 'support@govassist.ph'],
        ['address', 'Manila, Philippines'],
        ['gcash_account_name', 'GovAssist Corp'],
        ['gcash_number', '09171234567'],
        ['gcash_qr', ''],
        ['tin_fee', '500'],
        ['sss_fee', '400'],
        ['pagibig_fee', '400'],
        ['cash_instructions', 'Proceed to our designated office or partner payment centers to complete cash payments.'],
        ['terms', 'By using this application assistance system, you acknowledge that we assist in document processing and do not guarantee direct government approval.'],
        ['customer_instructions', 'Please ensure all uploaded documents are clear and accurate to avoid processing delays.']
    ];

    defaultSettings.forEach(([key, value]) => {
        db.run("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", [key, value]);
    });
});

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/uploads', express.static(uploadDir));
app.use(session({
    secret: 'gov_assist_secret_key_2026',
    resave: false,
    saveUninitialized: false
}));

// Helper to get settings as object
function getSettings(callback) {
    db.all("SELECT * FROM settings", (err, rows) => {
        const settings = {};
        if (rows) {
            rows.forEach(r => settings[r.key] = r.value);
        }
        callback(settings);
    });
}

// Helper to log application history
function logHistory(appId, action, userName, remarks) {
    db.run("INSERT INTO status_history (application_id, action, user_name, remarks) VALUES (?, ?, ?, ?)", 
        [appId, action, userName, remarks]);
}

// Helper to create notification
function createNotification(userId, message) {
    db.run("INSERT INTO notifications (user_id, message) VALUES (?, ?)", [userId, message]);
}

// ==================== HTML / UI TEMPLATE BUILDER ==================== //

function renderLayout(title, content, userRole = 'guest', settings = {}) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - ${settings.business_name || 'GovAssist PH'}</title>
    <style>
        :root {
            --primary: #1e3a8a;
            --primary-dark: #1e40af;
            --secondary: #0ea5e9;
            --success: #10b981;
            --warning: #f59e0b;
            --danger: #ef4444;
            --bg-light: #f8fafc;
            --text-main: #1e293b;
            --border: #cbd5e1;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
        body { background: var(--bg-light); color: var(--text-main); line-height: 1.5; display: flex; flex-direction: column; min-height: 100vh; }
        header { background: var(--primary); color: white; padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        header h1 { font-size: 1.25rem; display: flex; align-items: center; gap: 10px; }
        nav a { color: white; text-decoration: none; margin-left: 20px; font-weight: 500; font-size: 0.95rem; }
        nav a:hover { text-decoration: underline; }
        .container { max-width: 1200px; margin: 2rem auto; padding: 0 1rem; width: 100%; flex: 1; }
        footer { background: #0f172a; color: #94a3b8; text-align: center; padding: 1.5rem; font-size: 0.85rem; margin-top: auto; }
        
        /* Cards & Layouts */
        .card { background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); padding: 1.5rem; margin-bottom: 1.5rem; border: 1px solid #e2e8f0; }
        .grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.5rem; }
        .grid-3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; }
        
        /* Forms */
        .form-group { margin-bottom: 1rem; }
        label { display: block; margin-bottom: 0.5rem; font-weight: 600; font-size: 0.9rem; color: #334155; }
        input, select, textarea { width: 100%; padding: 0.75rem; border: 1px solid var(--border); border-radius: 6px; font-size: 1rem; background: #fff; }
        input:focus, select:focus, textarea:focus { outline: none; border-color: var(--secondary); box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.15); }
        
        /* Buttons */
        .btn { display: inline-block; background: var(--primary); color: white; padding: 0.75rem 1.5rem; border: none; border-radius: 6px; font-size: 1rem; font-weight: 600; cursor: pointer; text-decoration: none; text-align: center; transition: background 0.2s; }
        .btn:hover { background: var(--primary-dark); }
        .btn-secondary { background: #64748b; }
        .btn-secondary:hover { background: #475569; }
        .btn-danger { background: var(--danger); }
        .btn-danger:hover { background: #dc2626; }
        .btn-success { background: var(--success); }
        .btn-success:hover { background: #059669; }
        .btn-sm { padding: 0.4rem 0.8rem; font-size: 0.85rem; }
        
        /* Tables */
        table { width: 100%; border-collapse: collapse; margin-top: 1rem; background: white; border-radius: 6px; overflow: hidden; border: 1px solid #e2e8f0; }
        th, td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid #e2e8f0; font-size: 0.95rem; }
        th { background: #f1f5f9; font-weight: 600; color: #475569; }
        tr:hover { background: #f8fafc; }
        
        /* Badges */
        .badge { display: inline-block; padding: 0.25rem 0.6rem; border-radius: 50px; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; }
        .badge-submitted, .badge-pending { background: #fef3c7; color: #d97706; }
        .badge-review, .badge-processing { background: #e0f2fe; color: #0284c7; }
        .badge-completed, .badge-paid, .badge-verified { background: #d1fae5; color: #059669; }
        .badge-rejected, .badge-cancelled, .badge-unpaid { background: #fee2e2; color: #dc2626; }
        .badge-correction { background: #ffedd5; color: #c2410c; }

        /* Utility */
        .text-center { text-align: center; }
        .mt-2 { margin-top: 1rem; }
        .mb-2 { margin-bottom: 1rem; }
        .alert { padding: 1rem; border-radius: 6px; margin-bottom: 1rem; font-size: 0.95rem; }
        .alert-error { background: #fee2e2; color: #b91c1c; border: 1px solid #fecaca; }
        .alert-success { background: #d1fae5; color: #065f46; border: 1px solid #a7f3d0; }
        
        @media print {
            header, footer, .no-print, .btn { display: none !important; }
            body { background: white; color: black; }
            .card { border: none; box-shadow: none; padding: 0; }
        }
    </style>
</head>
<body>
    <header>
        <h1>
            <span>🏛️</span> ${settings.business_name || 'GovAssist PH'}
        </h1>
        <nav>
            <a href="/">Home</a>
            <a href="/track">Track Application</a>
            ${userRole === 'customer' ? `
                <a href="/customer/dashboard">Dashboard</a>
                <a href="/customer/notifications">Notifications</a>
                <a href="/customer/logout">Logout</a>
            ` : userRole === 'admin' ? `
                <a href="/admin/dashboard">Admin Dashboard</a>
                <a href="/admin/settings">Settings</a>
                <a href="/admin/logout">Logout</a>
            ` : `
                <a href="/customer/login">Customer Login</a>
                <a href="/admin/login">Admin Login</a>
            `}
        </nav>
    </header>
    <div class="container">
        ${content}
    </div>
    <footer>
        <p><strong>Important Disclaimer:</strong> This system provides application assistance, document collection, processing, and tracking services. It is not an official government website unless an official partnership/integration is established.</p>
        <p class="mt-2">&copy; 2026 ${settings.business_name || 'GovAssist PH'}. All rights reserved.</p>
    </footer>
</body>
</html>`;
}

// ==================== PUBLIC & AUTH ROUTES ==================== //

app.get('/', (req, res) => {
    getSettings((settings) => {
        const content = `
            <div class="card text-center" style="padding: 3rem 1.5rem;">
                <h2 style="font-size: 2.2rem; margin-bottom: 1rem; color: var(--primary);">Government Application Assistance Made Easy</h2>
                <p style="font-size: 1.1rem; color: #64748b; max-width: 700px; margin: 0 auto 2rem auto;">We help you securely prepare, submit, and track your BIR/TIN, SSS, and Pag-IBIG applications with professional guidance.</p>
                <div style="display: flex; justify-content: center; gap: 1rem; flex-wrap: wrap;">
                    <a href="/customer/register" class="btn">Get Started - Register</a>
                    <a href="/customer/login" class="btn btn-secondary">Customer Login</a>
                    <a href="/track" class="btn" style="background: var(--secondary);">Track Existing Application</a>
                </div>
            </div>
            <div class="grid-3">
                <div class="card">
                    <h3 style="color: var(--primary); margin-bottom: 0.5rem;">📋 BIR / TIN Application</h3>
                    <p>New TIN registration, replacement cards, and updating taxpayer records handled seamlessly.</p>
                </div>
                <div class="card">
                    <h3 style="color: var(--primary); margin-bottom: 0.5rem;">🛡️ SSS Application</h3>
                    <p>Social Security System membership registration, loan assistance, and record verification.</p>
                </div>
                <div class="card">
                    <h3 style="color: var(--primary); margin-bottom: 0.5rem;">🏠 Pag-IBIG Application</h3>
                    <p>HDMF membership ID generation, Provident savings, and housing loan application assistance.</p>
                </div>
            </div>
        `;
        res.send(renderLayout('Home', content, req.session.user ? 'customer' : 'guest', settings));
    });
});

// Public Tracking Page
app.get('/track', (req, res) => {
    const trackingNo = req.query.tracking || '';
    getSettings((settings) => {
        let searchResultHtml = '';
        if (trackingNo) {
            db.get(`SELECT a.*, ai.firstname, ai.lastname FROM applications a 
                    LEFT JOIN applicant_information ai ON a.id = ai.application_id 
                    WHERE a.tracking_number = ?`, [trackingNo], (err, row) => {
                if (row) {
                    searchResultHtml = `
                        <div class="card mt-2">
                            <h3>Application Details</h3>
                            <p><strong>Tracking Number:</strong> ${row.tracking_number}</p>
                            <p><strong>Applicant:</strong> ${row.firstname} ${row.lastname}</p>
                            <p><strong>Service:</strong> ${row.service_type}</p>
                            <p><strong>Status:</strong> <span class="badge badge-${row.status.toLowerCase().replace(/\s+/g, '-')}">${row.status}</span></p>
                            <p><strong>Payment Status:</strong> <span class="badge badge-${row.payment_status.toLowerCase().replace(/\s+/g, '-')}">${row.payment_status}</span></p>
                            <p><strong>Last Updated:</strong> ${row.updated_at}</p>
                        </div>
                    `;
                } else {
                    searchResultHtml = `<div class="alert alert-error mt-2">No application found with tracking number: ${trackingNo}</div>`;
                }
                sendTrackPage(searchResultHtml);
            });
        } else {
            sendTrackPage('');
        }

        function sendTrackPage(resultHtml) {
            const content = `
                <div class="card" style="max-width: 600px; margin: 0 auto;">
                    <h2>Track Your Application</h2>
                    <p style="color: #64748b; margin-bottom: 1rem;">Enter your unique tracking number to check progress.</p>
                    <form action="/track" method="GET">
                        <div class="form-group">
                            <label>Tracking Number</label>
                            <input type="text" name="tracking" value="${trackingNo}" placeholder="e.g. TIN-20260901-0001" required>
                        </div>
                        <button type="submit" class="btn" style="width: 100%;">Search Tracking</button>
                    </form>
                    ${resultHtml}
                </div>
            `;
            res.send(renderLayout('Track Application', content, req.session.user ? 'customer' : 'guest', settings));
        }
    });
});

// ==================== CUSTOMER AUTH & PORTAL ==================== //

app.get('/customer/register', (req, res) => {
    getSettings((settings) => {
        const error = req.query.error || '';
        const content = `
            <div class="card" style="max-width: 500px; margin: 0 auto;">
                <h2>Customer Registration</h2>
                ${error ? `<div class="alert alert-error">${error}</div>` : ''}
                <form action="/customer/register" method="POST">
                    <div class="form-group"><label>Full Name</label><input type="text" name="fullname" required></div>
                    <div class="form-group"><label>Email Address</label><input type="email" name="email" required></div>
                    <div class="form-group"><label>Mobile Number</label><input type="text" name="mobile" required></div>
                    <div class="form-group"><label>Username</label><input type="text" name="username" required></div>
                    <div class="form-group"><label>Password</label><input type="password" name="password" required></div>
                    <div class="form-group"><label>Confirm Password</label><input type="password" name="confirm_password" required></div>
                    <button type="submit" class="btn" style="width: 100%;">Register Account</button>
                </form>
                <p class="text-center mt-2"><a href="/customer/login">Already have an account? Login here</a></p>
            </div>
        `;
        res.send(renderLayout('Customer Registration', content, 'guest', settings));
    });
});

app.post('/customer/register', (req, res) => {
    const { fullname, email, mobile, username, password, confirm_password } = req.body;
    if (password !== confirm_password) {
        return res.redirect('/customer/register?error=' + encodeURIComponent('Passwords do not match.'));
    }
    const hashed = bcrypt.hashSync(password, 10);
    db.run("INSERT INTO users (fullname, email, mobile, username, password) VALUES (?, ?, ?, ?, ?)",
        [fullname, email, mobile, username, hashed], (err) => {
            if (err) {
                return res.redirect('/customer/register?error=' + encodeURIComponent('Username or Email already exists.'));
            }
            res.redirect('/customer/login?success=' + encodeURIComponent('Registration successful! Please login.'));
        });
});

app.get('/customer/login', (req, res) => {
    getSettings((settings) => {
        const error = req.query.error || '';
        const success = req.query.success || '';
        const content = `
            <div class="card" style="max-width: 400px; margin: 0 auto;">
                <h2>Customer Login</h2>
                ${error ? `<div class="alert alert-error">${error}</div>` : ''}
                ${success ? `<div class="alert alert-success">${success}</div>` : ''}
                <form action="/customer/login" method="POST">
                    <div class="form-group"><label>Username</label><input type="text" name="username" required></div>
                    <div class="form-group"><label>Password</label><input type="password" name="password" required></div>
                    <button type="submit" class="btn" style="width: 100%;">Login</button>
                </form>
                <p class="text-center mt-2"><a href="/customer/register">Don't have an account? Register</a></p>
            </div>
        `;
        res.send(renderLayout('Customer Login', content, 'guest', settings));
    });
});

app.post('/customer/login', (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
        if (user && bcrypt.compareSync(password, user.password)) {
            req.session.user = user;
            res.redirect('/customer/dashboard');
        } else {
            res.redirect('/customer/login?error=' + encodeURIComponent('Invalid username or password.'));
        }
    });
});

app.get('/customer/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
});

// Customer Dashboard
app.get('/customer/dashboard', (req, res) => {
    if (!req.session.user) return res.redirect('/customer/login');
    getSettings((settings) => {
        db.all("SELECT * FROM applications WHERE user_id = ?", [req.session.user.id], (err, apps) => {
            db.all("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 5", [req.session.user.id], (err2, notifs) => {
                const content = `
                    <div class="card">
                        <h2>Welcome, ${req.session.user.fullname}!</h2>
                        <p style="color: #64748b;">Manage your government assistance applications from your dashboard.</p>
                        <div class="mt-2" style="display: flex; gap: 1rem; flex-wrap: wrap;">
                            <a href="/customer/apply" class="btn">✨ New Application</a>
                            <a href="/customer/notifications" class="btn btn-secondary">Notifications</a>
                            <a href="/customer/profile" class="btn btn-secondary">My Profile</a>
                        </div>
                    </div>
                    
                    <div class="card">
                        <h3>My Applications</h3>
                        ${apps && apps.length > 0 ? `
                            <table>
                                <tr>
                                    <th>Tracking No.</th>
                                    <th>Service</th>
                                    <th>Status</th>
                                    <th>Payment</th>
                                    <th>Date</th>
                                    <th>Action</th>
                                </tr>
                                ${apps.map(a => `
                                    <tr>
                                        <td><strong>${a.tracking_number}</strong></td>
                                        <td>${a.service_type}</td>
                                        <td><span class="badge badge-${a.status.toLowerCase().replace(/\s+/g, '-')}">${a.status}</span></td>
                                        <td><span class="badge badge-${a.payment_status.toLowerCase().replace(/\s+/g, '-')}">${a.payment_status}</span></td>
                                        <td>${a.created_at}</td>
                                        <td>
                                            <a href="/customer/application/${a.id}" class="btn btn-sm">View Details</a>
                                        </td>
                                    </tr>
                                `).join('')}
                            </table>
                        ` : `<p style="color: #64748b; margin-top: 1rem;">You have no applications yet. Click "New Application" to start.</p>`}
                    </div>

                    <div class="card">
                        <h3>Recent Notifications</h3>
                        ${notifs && notifs.length > 0 ? `
                            <ul>
                                ${notifs.map(n => `<li style="margin-bottom: 0.5rem; font-size: 0.95rem;">${n.message} <small style="color: #64748b;">(${n.created_at})</small></li>`).join('')}
                            </ul>
                        ` : `<p style="color: #64748b; margin-top: 1rem;">No recent notifications.</p>`}
                    </div>
                `;
                res.send(renderLayout('Customer Dashboard', content, 'customer', settings));
            });
        });
    });
});

// Customer New Application Form (Multi-step wizard UI handled via standard form submission)
app.get('/customer/apply', (req, res) => {
    if (!req.session.user) return res.redirect('/customer/login');
    getSettings((settings) => {
        const content = `
            <div class="card" style="max-width: 800px; margin: 0 auto;">
                <h2>New Government Application Assistance</h2>
                <p style="color: #64748b; margin-bottom: 1.5rem;">Complete the multi-step wizard to submit your application details and documents.</p>
                <form action="/customer/apply" method="POST" enctype="multipart/form-data">
                    
                    <!-- SERVICE SELECTION -->
                    <div class="form-group">
                        <label>Select Government Service *</label>
                        <select name="service_type" required>
                            <option value="BIR / TIN">BIR / TIN Application (Fee: ₱${settings.tin_fee})</option>
                            <option value="SSS">SSS Application (Fee: ₱${settings.sss_fee})</option>
                            <option value="Pag-IBIG">Pag-IBIG Application (Fee: ₱${settings.pagibig_fee})</option>
                        </select>
                    </div>
                    
                    <hr style="margin: 1.5rem 0; border: 0; border-top: 1px solid #e2e8f0;">

                    <!-- STEP 1: PERSONAL INFORMATION -->
                    <h3>Step 1: Personal Information</h3>
                    <div class="grid-2">
                        <div class="form-group"><label>First Name</label><input type="text" name="firstname" required></div>
                        <div class="form-group"><label>Middle Name</label><input type="text" name="middlename"></div>
                        <div class="form-group"><label>Last Name</label><input type="text" name="lastname" required></div>
                        <div class="form-group"><label>Suffix (Jr., Sr., III)</label><input type="text" name="suffix"></div>
                        <div class="form-group"><label>Date of Birth</label><input type="date" name="dob" required></div>
                        <div class="form-group"><label>Place of Birth</label><input type="text" name="pob" required></div>
                        <div class="form-group"><label>Sex</label><select name="sex"><option value="Male">Male</option><option value="Female">Female</option></select></div>
                        <div class="form-group"><label>Civil Status</label><select name="civil_status" id="civilStatusSelect" onchange="toggleSpouse()"><option value="Single">Single</option><option value="Married">Married</option><option value="Widowed">Widowed</option><option value="Separated">Separated</option></select></div>
                        <div class="form-group"><label>Nationality</label><input type="text" name="nationality" value="Filipino" required></div>
                        <div class="form-group"><label>Mobile Number</label><input type="text" name="mobile" value="${req.session.user.mobile}" required></div>
                        <div class="form-group"><label>Email Address</label><input type="email" name="email" value="${req.session.user.email}" required></div>
                    </div>

                    <hr style="margin: 1.5rem 0; border: 0; border-top: 1px solid #e2e8f0;">

                    <!-- STEP 2: ADDRESS -->
                    <h3>Step 2: Complete Address</h3>
                    <div class="grid-2">
                        <div class="form-group"><label>House / Block / Lot No.</label><input type="text" name="house"></div>
                        <div class="form-group"><label>Street</label><input type="text" name="street"></div>
                        <div class="form-group"><label>Barangay</label><input type="text" name="barangay" required></div>
                        <div class="form-group"><label>Municipality / City</label><input type="text" name="municipality" required></div>
                        <div class="form-group"><label>Province</label><input type="text" name="province" required></div>
                        <div class="form-group"><label>ZIP Code</label><input type="text" name="zipcode" required></div>
                    </div>

                    <hr style="margin: 1.5rem 0; border: 0; border-top: 1px solid #e2e8f0;">

                    <!-- STEP 3: PARENTS INFORMATION -->
                    <h3>Step 3: Parents Information</h3>
                    <h4>Father's Details</h4>
                    <div class="grid-2">
                        <div class="form-group"><label>First Name</label><input type="text" name="father_firstname"></div>
                        <div class="form-group"><label>Middle Name</label><input type="text" name="father_middlename"></div>
                        <div class="form-group"><label>Last Name</label><input type="text" name="father_lastname"></div>
                        <div class="form-group"><label>Date of Birth</label><input type="date" name="father_dob"></div>
                    </div>
                    <h4>Mother's Details</h4>
                    <div class="grid-2">
                        <div class="form-group"><label>First Name</label><input type="text" name="mother_firstname"></div>
                        <div class="form-group"><label>Middle Name</label><input type="text" name="mother_middlename"></div>
                        <div class="form-group"><label>Maiden Name</label><input type="text" name="mother_maidenname"></div>
                        <div class="form-group"><label>Last Name</label><input type="text" name="mother_lastname"></div>
                        <div class="form-group"><label>Date of Birth</label><input type="date" name="mother_dob"></div>
                    </div>

                    <!-- SPOUSE SECTION (Conditional) -->
                    <div id="spouseSection" style="display:none; margin-top: 1.5rem;">
                        <hr style="margin: 1.5rem 0; border: 0; border-top: 1px solid #e2e8f0;">
                        <h3>Spouse Information</h3>
                        <div class="grid-2">
                            <div class="form-group"><label>Spouse Full Name</label><input type="text" name="spouse_fullname"></div>
                            <div class="form-group"><label>Spouse Date of Birth</label><input type="date" name="spouse_dob"></div>
                            <div class="form-group"><label>Marriage Certificate (Upload)</label><input type="file" name="marriage_cert" accept="image/*,.pdf"></div>
                        </div>
                    </div>

                    <hr style="margin: 1.5rem 0; border: 0; border-top: 1px solid #e2e8f0;">

                    <!-- STEP 4: BENEFICIARIES / DEPENDENTS -->
                    <h3>Step 4: Beneficiaries / Dependents</h3>
                    <p style="color: #64748b; font-size: 0.9rem; margin-bottom: 1rem;">Add qualified beneficiaries (Parents, Spouse, Children, Siblings, etc.).</p>
                    <div id="beneficiariesContainer">
                        <div class="card" style="background: #f8fafc; border: 1px dashed #cbd5e1; margin-bottom: 1rem; padding: 1rem;">
                            <div class="grid-2">
                                <div class="form-group"><label>Beneficiary Full Name</label><input type="text" name="ben_name[]"></div>
                                <div class="form-group"><label>Relationship</label><input type="text" name="ben_relationship[]" placeholder="e.g. Child, Parent"></div>
                                <div class="form-group"><label>Date of Birth</label><input type="date" name="ben_dob[]"></div>
                                <div class="form-group"><label>Sex</label><select name="ben_sex[]"><option value="Male">Male</option><option value="Female">Female</option></select></div>
                            </div>
                            <div class="form-group"><label>Address</label><input type="text" name="ben_address[]"></div>
                        </div>
                    </div>
                    <button type="button" class="btn btn-secondary btn-sm" onclick="addBeneficiary()">+ Add Another Beneficiary</button>

                    <hr style="margin: 1.5rem 0; border: 0; border-top: 1px solid #e2e8f0;">

                    <!-- STEP 5: EMPLOYMENT INFORMATION -->
                    <h3>Step 5: Employment Information</h3>
                    <div class="grid-2">
                        <div class="form-group"><label>Employment Status</label><select name="emp_status" id="empStatusSelect" onchange="toggleEmp()"><option value="Employed">Employed</option><option value="Self-Employed">Self-Employed</option><option value="Unemployed">Unemployed</option></select></div>
                        <div class="form-group employed-field"><label>Employer Name</label><input type="text" name="employer_name"></div>
                        <div class="form-group employed-field"><label>Employer Address</label><input type="text" name="employer_address"></div>
                        <div class="form-group employed-field"><label>Employer Contact Number</label><input type="text" name="employer_contact"></div>
                        <div class="form-group employed-field"><label>Occupation / Position</label><input type="text" name="occupation"></div>
                        <div class="form-group employed-field"><label>Monthly Income</label><input type="text" name="monthly_income"></div>
                        <div class="form-group employed-field"><label>Date Started</label><input type="date" name="date_started"></div>
                        <div class="form-group self-employed-field" style="display:none;"><label>Business Name</label><input type="text" name="business_name"></div>
                        <div class="form-group self-employed-field" style="display:none;"><label>Business Address</label><input type="text" name="business_address"></div>
                    </div>

                    <hr style="margin: 1.5rem 0; border: 0; border-top: 1px solid #e2e8f0;">

                    <!-- STEP 6: DOCUMENTS & CAMERA UPLOAD -->
                    <h3>Step 6: Required Documents</h3>
                    <p style="color: #64748b; font-size: 0.9rem; margin-bottom: 1rem;">Take a photo using your device camera or upload files from your device.</p>
                    <div class="grid-2">
                        <div class="form-group">
                            <label>Valid Government ID (Front/Back)</label>
                            <input type="file" name="valid_id" accept="image/*,.pdf" capture="environment" required>
                            <small style="color: #64748b;">Mobile users can take a photo directly.</small>
                        </div>
                        <div class="form-group">
                            <label>Photo of You Holding Your Valid ID</label>
                            <input type="file" name="photo_holding_id" accept="image/*" capture="user" required>
                            <small style="color: #64748b;">Clear picture of yourself holding the uploaded ID.</small>
                        </div>
                        <div class="form-group">
                            <label>ID Picture (2x2 or Passport size)</label>
                            <input type="file" name="id_picture" accept="image/*" required>
                        </div>
                        <div class="form-group">
                            <label>Supporting Document / Birth Certificate</label>
                            <input type="file" name="supporting_doc" accept="image/*,.pdf">
                        </div>
                    </div>

                    <hr style="margin: 1.5rem 0; border: 0; border-top: 1px solid #e2e8f0;">

                    <!-- STEP 7: PAYMENT METHOD -->
                    <h3>Step 7: Payment Method</h3>
                    <div class="form-group">
                        <label>Select Payment Option</label>
                        <select name="payment_method" id="paymentMethodSelect" onchange="togglePayment()" required>
                            <option value="GCash">GCash</option>
                            <option value="Cash">Cash Payment</option>
                        </select>
                    </div>

                    <div id="gcashPaymentBox" class="card" style="background: #f8fafc; border: 1px solid #cbd5e1;">
                        <h4>GCash Payment Instructions</h4>
                        <p style="margin-bottom: 0.5rem;">Scan the QR code below or send payment to the GCash account:</p>
                        <p><strong>Account Name:</strong> ${settings.gcash_account_name}</p>
                        <p><strong>GCash Number:</strong> ${settings.gcash_number}</p>
                        ${settings.gcash_qr ? `<div class="mt-2"><img src="/uploads/${settings.gcash_qr}" alt="GCash QR" style="max-width: 200px; border-radius: 6px;"></div>` : '<p style="color: #d97706; margin-top:0.5rem;">[GCash QR Code will be displayed once configured by Admin]</p>'}
                        <div class="form-group mt-2">
                            <label>Upload GCash Payment Screenshot / Proof</label>
                            <input type="file" name="gcash_proof" accept="image/*">
                        </div>
                        <div class="form-group">
                            <label>Reference Number</label>
                            <input type="text" name="reference_number" placeholder="Enter GCash Ref No.">
                        </div>
                    </div>

                    <div id="cashPaymentBox" class="card" style="background: #f8fafc; border: 1px solid #cbd5e1; display:none;">
                        <h4>Cash Payment Instructions</h4>
                        <p>${settings.cash_instructions}</p>
                    </div>

                    <div class="form-group mt-2">
                        <label style="display: flex; align-items: center; gap: 10px; font-weight: normal; cursor: pointer;">
                            <input type="checkbox" required style="width: auto;">
                            <span>I confirm that the information I provided is correct and complete.</span>
                        </label>
                    </div>

                    <button type="submit" class="btn" style="width: 100%; margin-top: 1rem;">Submit Application</button>
                </form>
            </div>

            <script>
                function toggleSpouse() {
                    const status = document.getElementById('civilStatusSelect').value;
                    const spouseBox = document.getElementById('spouseSection');
                    if (status === 'Married') {
                        spouseBox.style.display = 'block';
                    } else {
                        spouseBox.style.display = 'none';
                    }
                }
                function toggleEmp() {
                    const status = document.getElementById('empStatusSelect').value;
                    const employedFields = document.querySelectorAll('.employed-field');
                    const selfFields = document.querySelectorAll('.self-employed-field');
                    if (status === 'Employed') {
                        employedFields.forEach(el => el.style.display = 'block');
                        selfFields.forEach(el => el.style.display = 'none');
                    } else if (status === 'Self-Employed') {
                        employedFields.forEach(el => el.style.display = 'none');
                        selfFields.forEach(el => el.style.display = 'block');
                    } else {
                        employedFields.forEach(el => el.style.display = 'none');
                        selfFields.forEach(el => el.style.display = 'none');
                    }
                }
                function togglePayment() {
                    const method = document.getElementById('paymentMethodSelect').value;
                    if (method === 'GCash') {
                        document.getElementById('gcashPaymentBox').style.display = 'block';
                        document.getElementById('cashPaymentBox').style.display = 'none';
                    } else {
                        document.getElementById('gcashPaymentBox').style.display = 'none';
                        document.getElementById('cashPaymentBox').style.display = 'block';
                    }
                }
                function addBeneficiary() {
                    const container = document.getElementById('beneficiariesContainer');
                    const div = document.createElement('div');
                    div.className = 'card';
                    div.style.cssText = 'background: #f8fafc; border: 1px dashed #cbd5e1; margin-bottom: 1rem; padding: 1rem;';
                    div.innerHTML = \`
                        <div class="grid-2">
                            <div class="form-group"><label>Beneficiary Full Name</label><input type="text" name="ben_name[]"></div>
                            <div class="form-group"><label>Relationship</label><input type="text" name="ben_relationship[]"></div>
                            <div class="form-group"><label>Date of Birth</label><input type="date" name="ben_dob[]"></div>
                            <div class="form-group"><label>Sex</label><select name="ben_sex[]"><option value="Male">Male</option><option value="Female">Female</option></select></div>
                        </div>
                        <div class="form-group"><label>Address</label><input type="text" name="ben_address[]"></div>
                        <button type="button" class="btn btn-danger btn-sm mt-1" onclick="this.parentElement.remove()">Remove Beneficiary</button>
                    \`;
                    container.appendChild(div);
                }
            </script>
        `;
        res.send(renderLayout('New Application', content, 'customer', settings));
    });
});

// Handle Application Submission
const uploadFields = upload.fields([
    { name: 'marriage_cert', maxCount: 1 },
    { name: 'valid_id', maxCount: 1 },
    { name: 'photo_holding_id', maxCount: 1 },
    { name: 'id_picture', maxCount: 1 },
    { name: 'supporting_doc', maxCount: 1 },
    { name: 'gcash_proof', maxCount: 1 }
]);

app.post('/customer/apply', uploadFields, (req, res) => {
    if (!req.session.user) return res.redirect('/customer/login');
    const body = req.body;
    const files = req.files || {};
    
    // Generate Unique Tracking Number
    const prefixMap = { 'BIR / TIN': 'TIN', 'SSS': 'SSS', 'Pag-IBIG': 'PAGIBIG' };
    const prefix = prefixMap[body.service_type] || 'GOV';
    const dateStr = new Date().toISOString().slice(0,10).replace(/-/g,'');
    const trackingNumber = `${prefix}-${dateStr}-${Math.floor(1000 + Math.random() * 9000)}`;

    const feeMap = { 'BIR / TIN': 500, 'SSS': 400, 'Pag-IBIG': 400 };
    getSettings((settings) => {
        const amount = body.service_type === 'BIR / TIN' ? settings.tin_fee : body.service_type === 'SSS' ? settings.sss_fee : settings.pagibig_fee;

        db.run(`INSERT INTO applications (user_id, service_type, tracking_number, status, payment_status, payment_method, amount_paid, reference_number, gcash_proof) 
                VALUES (?, ?, ?, 'Submitted', ?, ?, ?, ?, ?)`,
            [req.session.user.id, body.service_type, tracking_number, body.payment_method === 'GCash' ? 'Pending Verification' : 'Unpaid', body.payment_method, amount, body.reference_number || '', files.gcash_proof ? files.gcash_proof[0].filename : ''],
            function(err) {
                if (err) {
                    console.error(err);
                    return res.redirect('/customer/dashboard');
                }
                const appId = this.lastID;

                // Insert Personal Info
                db.run(`INSERT INTO applicant_information (application_id, firstname, middlename, lastname, suffix, dob, pob, sex, civil_status, nationality, mobile, email, house, street, barangay, municipality, province, zipcode)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [appId, body.firstname, body.middlename, body.lastname, body.suffix, body.dob, body.pob, body.sex, body.civil_status, body.nationality, body.mobile, body.email, body.house, body.street, body.barangay, body.municipality, body.province, body.zipcode]);

                // Insert Parents
                db.run(`INSERT INTO parents (application_id, father_firstname, father_middlename, father_lastname, father_dob, mother_firstname, mother_middlename, mother_maidenname, mother_lastname, mother_dob)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [appId, body.father_firstname, body.father_middlename, body.father_lastname, body.father_dob, body.mother_firstname, body.mother_middlename, body.mother_maidenname, body.mother_lastname, body.mother_dob]);

                // Insert Spouse if married
                if (body.civil_status === 'Married') {
                    db.run(`INSERT INTO spouses (application_id, fullname, dob, marriage_cert) VALUES (?, ?, ?, ?)`,
                        [appId, body.spouse_fullname, body.spouse_dob, files.marriage_cert ? files.marriage_cert[0].filename : '']);
                }

                // Insert Beneficiaries
                if (body.ben_name && Array.isArray(body.ben_name)) {
                    for (let i = 0; i < body.ben_name.length; i++) {
                        if (body.ben_name[i]) {
                            db.run(`INSERT INTO beneficiaries (application_id, fullname, relationship, dob, sex, address) VALUES (?, ?, ?, ?, ?, ?)`,
                                [appId, body.ben_name[i], body.ben_relationship[i], body.ben_dob[i], body.ben_sex[i], body.ben_address[i]]);
                        }
                    }
                }

                // Insert Employment
                db.run(`INSERT INTO employment (application_id, status, employer_name, employer_address, employer_contact, occupation, position, monthly_income, date_started, business_name, business_address)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [appId, body.emp_status, body.employer_name, body.employer_address, body.employer_contact, body.occupation, body.occupation, body.monthly_income, body.date_started, body.business_name, body.business_address]);

                // Insert Documents
                const docMap = [
                    { key: 'valid_id', type: 'Valid ID' },
                    { key: 'photo_holding_id', type: 'Photo Holding ID' },
                    { key: 'id_picture', type: 'ID Picture' },
                    { key: 'supporting_doc', type: 'Supporting Document' }
                ];
                docMap.forEach(d => {
                    if (files[d.key]) {
                        db.run(`INSERT INTO documents (application_id, doc_type, file_path, original_name) VALUES (?, ?, ?, ?)`,
                            [appId, d.type, files[d.key][0].filename, files[d.key][0].originalname]);
                    }
                });

                logHistory(appId, 'Application Submitted', req.session.user.fullname, 'Application successfully submitted by customer.');
                createNotification(req.session.user.id, `Your application ${trackingNumber} has been successfully submitted.`);

                res.redirect('/customer/dashboard');
            });
    });
});

// View Single Application (Customer)
app.get('/customer/application/:id', (req, res) => {
    if (!req.session.user) return res.redirect('/customer/login');
    const appId = req.params.id;
    getSettings((settings) => {
        db.get("SELECT * FROM applications WHERE id = ? AND user_id = ?", [appId, req.session.user.id], (err, appData) => {
            if (!appData) return res.redirect('/customer/dashboard');
            db.get("SELECT * FROM applicant_information WHERE application_id = ?", [appId], (err2, info) => {
                db.all("SELECT * FROM documents WHERE application_id = ?", [appId], (err3, docs) => {
                    db.all("SELECT * FROM completed_documents WHERE application_id = ?", [appId], (err4, completedDocs) => {
                        db.all("SELECT * FROM status_history WHERE application_id = ? ORDER BY created_at DESC", [appId], (err5, history) => {
                            
                            const content = `
                                <div class="card">
                                    <h2>Application Details: ${appData.tracking_number}</h2>
                                    <p><strong>Service:</strong> ${appData.service_type}</p>
                                    <p><strong>Status:</strong> <span class="badge badge-${appData.status.toLowerCase().replace(/\s+/g, '-')}">${appData.status}</span></p>
                                    <p><strong>Payment Status:</strong> <span class="badge badge-${appData.payment_status.toLowerCase().replace(/\s+/g, '-')}">${appData.payment_status}</span></p>
                                    <p><strong>Submitted Date:</strong> ${appData.created_at}</p>
                                </div>

                                <div class="card">
                                    <h3>Applicant Information</h3>
                                    <p><strong>Name:</strong> ${info.firstname} ${info.middlename || ''} ${info.lastname} ${info.suffix || ''}</p>
                                    <p><strong>Date of Birth:</strong> ${info.dob} | <strong>Sex:</strong> ${info.sex}</p>
                                    <p><strong>Address:</strong> ${info.house || ''} ${info.street || ''}, ${info.barangay}, ${info.municipality}, ${info.province} (${info.zipcode})</p>
                                </div>

                                <div class="card">
                                    <h3>Completed Documents from Admin</h3>
                                    ${completedDocs && completedDocs.length > 0 ? `
                                        <table>
                                            <tr><th>File Name</th><th>Description</th><th>Date</th><th>Action</th></tr>
                                            ${completedDocs.map(cd => `
                                                <tr>
                                                    <td>${cd.file_name}</td>
                                                    <td>${cd.description || 'Completed Document'}</td>
                                                    <td>${cd.uploaded_at}</td>
                                                    <td><a href="/uploads/${cd.file_path}" class="btn btn-sm" download>Download</a></td>
                                                </tr>
                                            `).join('')}
                                        </table>
                                    ` : '<p style="color: #64748b;">No completed documents uploaded by admin yet.</p>'}
                                </div>

                                <div class="card">
                                    <h3>Application History</h3>
                                    <ul>
                                        ${history.map(h => `<li><strong>${h.created_at}</strong> - ${h.action}: ${h.remarks || ''}</li>`).join('')}
                                    </ul>
                                </div>

                                <div class="mt-2"><a href="/customer/dashboard" class="btn btn-secondary">Back to Dashboard</a></div>
                            `;
                            res.send(renderLayout('Application Details', content, 'customer', settings));
                        });
                    });
                });
            });
        });
    });
});

app.get('/customer/notifications', (req, res) => {
    if (!req.session.user) return res.redirect('/customer/login');
    getSettings((settings) => {
        db.all("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC", [req.session.user.id], (err, notifs) => {
            const content = `
                <div class="card">
                    <h2>Notifications</h2>
                    ${notifs && notifs.length > 0 ? `
                        <ul>
                            ${notifs.map(n => `<li style="padding: 0.75rem 0; border-bottom: 1px solid #e2e8f0;">${n.message} <br><small style="color: #64748b;">${n.created_at}</small></li>`).join('')}
                        </ul>
                    ` : '<p style="color: #64748b;">No notifications found.</p>'}
                </div>
            `;
            res.send(renderLayout('Notifications', content, 'customer', settings));
        });
    });
});

app.get('/customer/profile', (req, res) => {
    if (!req.session.user) return res.redirect('/customer/login');
    getSettings((settings) => {
        const content = `
            <div class="card" style="max-width: 500px; margin: 0 auto;">
                <h2>My Profile</h2>
                <p><strong>Full Name:</strong> ${req.session.user.fullname}</p>
                <p><strong>Email:</strong> ${req.session.user.email}</p>
                <p><strong>Mobile Number:</strong> ${req.session.user.mobile}</p>
                <p><strong>Username:</strong> ${req.session.user.username}</p>
            </div>
        `;
        res.send(renderLayout('My Profile', content, 'customer', settings));
    });
});


// ==================== ADMIN PORTAL ==================== //

app.get('/admin/login', (req, res) => {
    getSettings((settings) => {
        const error = req.query.error || '';
        const content = `
            <div class="card" style="max-width: 400px; margin: 0 auto;">
                <h2>Admin Login</h2>
                ${error ? `<div class="alert alert-error">${error}</div>` : ''}
                <form action="/admin/login" method="POST">
                    <div class="form-group"><label>Admin Username</label><input type="text" name="username" required></div>
                    <div class="form-group"><label>Password</label><input type="password" name="password" required></div>
                    <button type="submit" class="btn" style="width: 100%;">Admin Login</button>
                </form>
            </div>
        `;
        res.send(renderLayout('Admin Login', content, 'guest', settings));
    });
});

app.post('/admin/login', (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM admin_users WHERE username = ?", [username], (err, admin) => {
        if (admin && bcrypt.compareSync(password, admin.password)) {
            req.session.admin = admin;
            res.redirect('/admin/dashboard');
        } else {
            res.redirect('/admin/login?error=' + encodeURIComponent('Invalid admin credentials.'));
        }
    });
});

app.get('/admin/logout', (req, res) => {
    delete req.session.admin;
    res.redirect('/admin/login');
});

// Admin Dashboard
app.get('/admin/dashboard', (req, res) => {
    if (!req.session.admin) return res.redirect('/admin/login');
    getSettings((settings) => {
        db.all(`SELECT a.*, ai.firstname, ai.lastname, u.email as user_email FROM applications a 
                LEFT JOIN applicant_information ai ON a.id = ai.application_id 
                LEFT JOIN users u ON a.user_id = u.id 
                ORDER BY a.created_at DESC`, (err, apps) => {
            
            db.get(`SELECT 
                COUNT(*) as total_apps,
                SUM(CASE WHEN service_type='BIR / TIN' THEN 1 ELSE 0 END) as tin_apps,
                SUM(CASE WHEN service_type='SSS' THEN 1 ELSE 0 END) as sss_apps,
                SUM(CASE WHEN service_type='Pag-IBIG' THEN 1 ELSE 0 END) as pagibig_apps,
                SUM(CASE WHEN payment_status='Pending Verification' THEN 1 ELSE 0 END) as pending_payments,
                SUM(CASE WHEN status='Completed' THEN 1 ELSE 0 END) as completed_apps
                FROM applications`, (err2, stats) => {

                const content = `
                    <div class="card">
                        <h2>Admin Dashboard</h2>
                        <p style="color: #64748b;">Overview of all customer assistance applications and statistics.</p>
                        <div class="grid-3 mt-2">
                            <div class="card" style="background: #eff6ff; border: 1px solid #bfdbfe;">
                                <h3>${stats.total_apps || 0}</h3>
                                <p style="color: #1e40af; font-weight: 600;">Total Applications</p>
                            </div>
                            <div class="card" style="background: #f0fdf4; border: 1px solid #bbf7d0;">
                                <h3>${stats.completed_apps || 0}</h3>
                                <p style="color: #166534; font-weight: 600;">Completed Applications</p>
                            </div>
                            <div class="card" style="background: #fef3c7; border: 1px solid #fde68a;">
                                <h3>${stats.pending_payments || 0}</h3>
                                <p style="color: #92400e; font-weight: 600;">Pending Payments</p>
                            </div>
                        </div>
                    </div>

                    <div class="card">
                        <h3>Applications Management</h3>
                        <table>
                            <tr>
                                <th>Tracking No.</th>
                                <th>Applicant</th>
                                <th>Service</th>
                                <th>Payment</th>
                                <th>Status</th>
                                <th>Date</th>
                                <th>Action</th>
                            </tr>
                            ${apps && apps.length > 0 ? apps.map(a => `
                                <tr>
                                    <td><strong>${a.tracking_number}</strong></td>
                                    <td>${a.firstname || ''} ${a.lastname || ''}</td>
                                    <td>${a.service_type}</td>
                                    <td><span class="badge badge-${a.payment_status.toLowerCase().replace(/\s+/g, '-')}">${a.payment_status}</span></td>
                                    <td><span class="badge badge-${a.status.toLowerCase().replace(/\s+/g, '-')}">${a.status}</span></td>
                                    <td>${a.created_at}</td>
                                    <td>
                                        <a href="/admin/application/${a.id}" class="btn btn-sm">Review</a>
                                    </td>
                                </tr>
                            `).join('') : '<tr><td colspan="7">No applications found.</td></tr>'}
                        </table>
                    </div>
                `;
                res.send(renderLayout('Admin Dashboard', content, 'admin', settings));
            });
        });
    });
});

// Detailed Admin Application View
app.get('/admin/application/:id', (req, res) => {
    if (!req.session.admin) return res.redirect('/admin/login');
    const appId = req.params.id;
    getSettings((settings) => {
        db.get("SELECT * FROM applications WHERE id = ?", [appId], (err, appData) => {
            if (!appData) return res.redirect('/admin/dashboard');
            db.get("SELECT * FROM applicant_information WHERE application_id = ?", [appId], (err2, info) => {
                db.get("SELECT * FROM parents WHERE application_id = ?", [appId], (err3, parents) => {
                    db.get("SELECT * FROM spouses WHERE application_id = ?", [appId], (err4, spouse) => {
                        db.all("SELECT * FROM beneficiaries WHERE application_id = ?", [appId], (err5, bens) => {
                            db.get("SELECT * FROM employment WHERE application_id = ?", [appId], (err6, emp) => {
                                db.all("SELECT * FROM documents WHERE application_id = ?", [appId], (err7, docs) => {
                                    db.all("SELECT * FROM completed_documents WHERE application_id = ?", [appId], (err8, compDocs) => {
                                        db.all("SELECT * FROM status_history WHERE application_id = ? ORDER BY created_at DESC", [appId], (err9, history) => {
                                            
                                            const content = `
                                                <div class="card">
                                                    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap;">
                                                        <h2>Application Review: ${appData.tracking_number}</h2>
                                                        <div>
                                                            <button onclick="window.print()" class="btn btn-secondary btn-sm">Print Summary</button>
                                                        </div>
                                                    </div>
                                                    
                                                    <!-- UPDATE STATUS & PAYMENT FORM -->
                                                    <form action="/admin/application/${appId}/update" method="POST" class="mt-2" style="background: #f1f5f9; padding: 1rem; border-radius: 6px;">
                                                        <div class="grid-2">
                                                            <div class="form-group">
                                                                <label>Update Application Status</label>
                                                                <select name="status">
                                                                    ${['Submitted', 'Payment Pending', 'Under Review', 'Need Correction', 'Processing', 'Ready', 'Completed', 'Rejected', 'Cancelled'].map(s => `<option value="${s}" ${appData.status === s ? 'selected' : ''}>${s}</option>`).join('')}
                                                                </select>
                                                            </div>
                                                            <div class="form-group">
                                                                <label>Update Payment Status</label>
                                                                <select name="payment_status">
                                                                    ${['Unpaid', 'Pending Verification', 'Paid', 'Rejected', 'Refunded'].map(ps => `<option value="${ps}" ${appData.payment_status === ps ? 'selected' : ''}>${ps}</option>`).join('')}
                                                                </select>
                                                            </div>
                                                        </div>
                                                        <div class="form-group">
                                                            <label>Remarks / Notes / Correction Message</label>
                                                            <textarea name="remarks" placeholder="Enter status remarks or instructions..."></textarea>
                                                        </div>
                                                        <button type="submit" class="btn btn-sm">Save Changes</button>
                                                    </form>
                                                </div>

                                                <!-- ADMIN DATA SUMMARY FOR EASY COPYING -->
                                                <div class="card">
                                                    <h3>Application Data Summary (For Government Forms)</h3>
                                                    <table>
                                                        <tr><th>Field</th><th>Customer Answer</th></tr>
                                                        <tr><td>Service Type</td><td><strong>${appData.service_type}</strong></td></tr>
                                                        <tr><td>Full Name</td><td>${info.firstname} ${info.middlename || ''} ${info.lastname} ${info.suffix || ''}</td></tr>
                                                        <tr><td>Date of Birth</td><td>${info.dob}</td></tr>
                                                        <tr><td>Place of Birth</td><td>${info.pob}</td></tr>
                                                        <tr><td>Sex</td><td>${info.sex}</td></tr>
                                                        <tr><td>Civil Status</td><td>${info.civil_status}</td></tr>
                                                        <tr><td>Nationality</td><td>${info.nationality}</td></tr>
                                                        <tr><td>Mobile / Email</td><td>${info.mobile} / ${info.email}</td></tr>
                                                        <tr><td>Complete Address</td><td>${info.house || ''} ${info.street || ''}, ${info.barangay}, ${info.municipality}, ${info.province} (${info.zipcode})</td></tr>
                                                        <tr><td>Father's Name</td><td>${parents ? `${parents.father_firstname || ''} ${parents.father_middlename || ''} ${parents.father_lastname || ''} (DOB: ${parents.father_dob || 'N/A'})` : 'N/A'}</td></tr>
                                                        <tr><td>Mother's Name</td><td>${parents ? `${parents.mother_firstname || ''} ${parents.mother_middlename || ''} ${parents.mother_lastname || ''} (DOB: ${parents.mother_dob || 'N/A'})` : 'N/A'}</td></tr>
                                                        <tr><td>Spouse Name</td><td>${spouse ? `${spouse.fullname} (DOB: ${spouse.dob})` : 'N/A'}</td></tr>
                                                        <tr><td>Employment Status</td><td>${emp ? emp.status : 'N/A'}</td></tr>
                                                        <tr><td>Employer / Business</td><td>${emp ? (emp.employer_name || emp.business_name || 'N/A') : 'N/A'}</td></tr>
                                                    </table>
                                                </div>

                                                <!-- BENEFICIARIES -->
                                                <div class="card">
                                                    <h3>Beneficiaries</h3>
                                                    ${bens && bens.length > 0 ? `
                                                        <table>
                                                            <tr><th>Name</th><th>Relationship</th><th>DOB</th><th>Sex</th><th>Address</th></tr>
                                                            ${bens.map(b => `<tr><td>${b.fullname}</td><td>${b.relationship}</td><td>${b.dob}</td><td>${b.sex}</td><td>${b.address}</td></tr>`).join('')}
                                                        </table>
                                                    ` : '<p style="color: #64748b;">No beneficiaries listed.</p>'}
                                                </div>

                                                <!-- DOCUMENTS -->
                                                <div class="card">
                                                    <h3>Customer Uploaded Documents</h3>
                                                    ${appData.gcash_proof ? `<p><strong>GCash Payment Proof:</strong> <a href="/uploads/${appData.gcash_proof}" target="_blank">View Proof</a> (Ref: ${appData.reference_number})</p>` : ''}
                                                    ${docs && docs.length > 0 ? `
                                                        <ul>
                                                            ${docs.map(d => `<li style="margin-bottom: 0.5rem;"><strong>${d.doc_type}:</strong> <a href="/uploads/${d.file_path}" target="_blank">Preview / Download</a></li>`).join('')}
                                                        </ul>
                                                    ` : '<p style="color: #64748b;">No documents uploaded.</p>'}
                                                </div>

                                                <!-- ADMIN UPLOAD COMPLETED FILES -->
                                                <div class="card">
                                                    <h3>Upload Completed Documents to Customer Portal</h3>
                                                    <form action="/admin/application/${appId}/upload-completed" method="POST" enctype="multipart/form-data">
                                                        <div class="form-group">
                                                            <label>Select File(s)</label>
                                                            <input type="file" name="completed_file" required>
                                                        </div>
                                                        <div class="form-group">
                                                            <label>Description / Document Name</label>
                                                            <input type="text" name="description" placeholder="e.g. Generated TIN ID / SSS Registration Form" required>
                                                        </div>
                                                        <button type="submit" class="btn btn-success btn-sm">Upload File</button>
                                                    </form>
                                                    <h4 class="mt-2">Already Uploaded Files:</h4>
                                                    ${compDocs && compDocs.length > 0 ? `
                                                        <ul>
                                                            ${compDocs.map(cd => `<li>${cd.file_name} (${cd.description}) - <a href="/uploads/${cd.file_path}" download>Download</a></li>`).join('')}
                                                        </ul>
                                                    ` : '<p style="color: #64748b;">None uploaded yet.</p>'}
                                                </div>

                                                <div class="card">
                                                    <h3>History Timeline</h3>
                                                    <ul>
                                                        ${history.map(h => `<li><strong>${h.created_at}</strong> - ${h.action} (${h.user_name}): ${h.remarks || ''}</li>`).join('')}
                                                    </ul>
                                                </div>

                                                <div class="mt-2"><a href="/admin/dashboard" class="btn btn-secondary">Back to Admin Dashboard</a></div>
                                            `;
                                            res.send(renderLayout('Admin Application Review', content, 'admin', settings));
                                        });
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    });
});

// Update Application Status (Admin)
app.post('/admin/application/:id/update', (req, res) => {
    if (!req.session.admin) return res.redirect('/admin/login');
    const appId = req.params.id;
    const { status, payment_status, remarks } = req.body;

    db.get("SELECT user_id, tracking_number FROM applications WHERE id = ?", [appId], (err, appRow) => {
        db.run("UPDATE applications SET status = ?, payment_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            [status, payment_status, appId], () => {
                logHistory(appId, `Status Updated to ${status} / Payment: ${payment_status}`, req.session.admin.username, remarks);
                if (appRow) {
                    createNotification(appRow.user_id, `Your application ${appRow.tracking_number} status was updated to: ${status} (Payment: ${payment_status}). ${remarks ? 'Note: ' + remarks : ''}`);
                }
                res.redirect('/admin/application/' + appId);
            });
    });
});

// Upload Completed Files (Admin)
const uploadCompleted = upload.single('completed_file');
app.post('/admin/application/:id/upload-completed', uploadCompleted, (req, res) => {
    if (!req.session.admin) return res.redirect('/admin/login');
    const appId = req.params.id;
    const file = req.file;
    const description = req.body.description;

    if (file) {
        db.run("INSERT INTO completed_documents (application_id, file_name, file_path, file_type, description) VALUES (?, ?, ?, ?, ?)",
            [appId, file.originalname, file.filename, file.mimetype, description], () => {
                db.get("SELECT user_id, tracking_number FROM applications WHERE id = ?", [appId], (err, appRow) => {
                    logHistory(appId, 'Completed Document Uploaded', req.session.admin.username, `Uploaded: ${description}`);
                    if (appRow) {
                        createNotification(appRow.user_id, `Admin uploaded a new document for your application ${appRow.tracking_number}: ${description}`);
                    }
                    res.redirect('/admin/application/' + appId);
                });
            });
    } else {
        res.redirect('/admin/application/' + appId);
    }
});

// Admin Settings
app.get('/admin/settings', (req, res) => {
    if (!req.session.admin) return res.redirect('/admin/login');
    getSettings((settings) => {
        const success = req.query.success || '';
        const content = `
            <div class="card" style="max-width: 700px; margin: 0 auto;">
                <h2>Admin Settings & Configuration</h2>
                ${success ? `<div class="alert alert-success">${success}</div>` : ''}
                <form action="/admin/settings" method="POST" enctype="multipart/form-data">
                    <div class="form-group"><label>Business Name</label><input type="text" name="business_name" value="${settings.business_name || ''}" required></div>
                    <div class="grid-2">
                        <div class="form-group"><label>Contact Number</label><input type="text" name="contact_number" value="${settings.contact_number || ''}"></div>
                        <div class="form-group"><label>Email Address</label><input type="email" name="email" value="${settings.email || ''}"></div>
                    </div>
                    <div class="form-group"><label>Office Address</label><input type="text" name="address" value="${settings.address || ''}"></div>
                    
                    <hr style="margin: 1.5rem 0; border: 0; border-top: 1px solid #e2e8f0;">
                    <h3>Service Fees (PHP)</h3>
                    <div class="grid-3">
                        <div class="form-group"><label>BIR / TIN Fee</label><input type="number" name="tin_fee" value="${settings.tin_fee || 500}"></div>
                        <div class="form-group"><label>SSS Fee</label><input type="number" name="sss_fee" value="${settings.sss_fee || 400}"></div>
                        <div class="form-group"><label>Pag-IBIG Fee</label><input type="number" name="pagibig_fee" value="${settings.pagibig_fee || 400}"></div>
                    </div>

                    <hr style="margin: 1.5rem 0; border: 0; border-top: 1px solid #e2e8f0;">
                    <h3>GCash & Payment Settings</h3>
                    <div class="grid-2">
                        <div class="form-group"><label>GCash Account Name</label><input type="text" name="gcash_account_name" value="${settings.gcash_account_name || ''}"></div>
                        <div class="form-group"><label>GCash Number</label><input type="text" name="gcash_number" value="${settings.gcash_number || ''}"></div>
                    </div>
                    <div class="form-group">
                        <label>GCash QR Code Image</label>
                        ${settings.gcash_qr ? `<div class="mb-2"><img src="/uploads/${settings.gcash_qr}" style="max-width: 150px;"></div>` : ''}
                        <input type="file" name="gcash_qr" accept="image/*">
                    </div>
                    <div class="form-group"><label>Cash Payment Instructions</label><textarea name="cash_instructions">${settings.cash_instructions || ''}</textarea></div>

                    <button type="submit" class="btn" style="width: 100%; margin-top: 1rem;">Save Settings</button>
                </form>
            </div>
        `;
        res.send(renderLayout('Admin Settings', content, 'admin', settings));
    });
});

const uploadQr = upload.single('gcash_qr');
app.post('/admin/settings', uploadQr, (req, res) => {
    if (!req.session.admin) return res.redirect('/admin/login');
    const body = req.body;
    const file = req.file;

    const keys = ['business_name', 'contact_number', 'email', 'address', 'gcash_account_name', 'gcash_number', 'tin_fee', 'sss_fee', 'pagibig_fee', 'cash_instructions'];
    keys.forEach(k => {
        if (body[k] !== undefined) {
            db.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [k, body[k]]);
        }
    });

    if (file) {
        db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('gcash_qr', ?)", [file.filename]);
    }

    res.redirect('/admin/settings?success=' + encodeURIComponent('Settings successfully updated!'));
});

// Start Server
app.listen(PORT, () => {
    console.log(`GovAssist PH system is running on port ${PORT}`);
});
