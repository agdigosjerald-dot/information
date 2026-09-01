/**
 * COMPLETE BIR/TIN, SSS & PAG-IBIG APPLICATION ASSISTANCE SYSTEM
 * Single-File Node.js Application (app.js)
 */

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure upload directories exist
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer storage setup
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname.replace(/\s+/g, '_'));
    }
});
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/uploads', express.static(uploadDir));
app.use(session({
    secret: process.env.SESSION_SECRET || 'government-assistance-secret-key-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// Database Setup
const dbFile = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbFile, (err) => {
    if (err) console.error('Database opening error: ', err.message);
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
        fullname TEXT NOT NULL
    )`, () => {
        // Create default admin if not exists
        db.get(`SELECT * FROM admin_users WHERE username = ?`, ['admin'], async (err, row) => {
            if (!row) {
                const hashed = await bcrypt.hash('admin123', 10);
                db.run(`INSERT INTO admin_users (username, password, fullname) VALUES (?, ?, ?)`, ['admin', hashed, 'System Administrator']);
            }
        });
    });

    db.run(`CREATE TABLE IF NOT EXISTS system_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        business_name TEXT DEFAULT 'GovAssist PH Services',
        contact_number TEXT DEFAULT '09123456789',
        email TEXT DEFAULT 'support@govassist.ph',
        address TEXT DEFAULT 'Manila, Philippines',
        logo_url TEXT DEFAULT '',
        gcash_name TEXT DEFAULT 'GovAssist Admin',
        gcash_number TEXT DEFAULT '09171234567',
        gcash_qr TEXT DEFAULT '',
        bir_fee REAL DEFAULT 350.00,
        sss_fee REAL DEFAULT 350.00,
        pagibig_fee REAL DEFAULT 350.00,
        other_fees REAL DEFAULT 0.00,
        customer_instructions TEXT DEFAULT 'Please complete all fields carefully and upload clear documents.',
        processing_instructions TEXT DEFAULT 'Processing takes 3-5 working days upon payment verification.',
        notification_settings TEXT DEFAULT 'enabled'
    )`, () => {
        db.get(`SELECT * FROM system_settings WHERE id = 1`, (err, row) => {
            if (!row) {
                db.run(`INSERT INTO system_settings (id) VALUES (1)`);
            }
        });
    });

    db.run(`CREATE TABLE IF NOT EXISTS applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        service TEXT NOT NULL,
        tracking_number TEXT UNIQUE NOT NULL,
        date_submitted DATETIME DEFAULT CURRENT_TIMESTAMP,
        payment_status TEXT DEFAULT 'Unpaid',
        application_status TEXT DEFAULT 'Submitted',
        admin_remarks TEXT DEFAULT '',
        private_notes TEXT DEFAULT '',
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS applicant_information (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        application_id INTEGER,
        first_name TEXT,
        middle_name TEXT,
        last_name TEXT,
        suffix TEXT,
        dob TEXT,
        pob TEXT,
        sex TEXT,
        civil_status TEXT,
        citizenship TEXT,
        mobile TEXT,
        email TEXT,
        telephone TEXT,
        house_no TEXT,
        street TEXT,
        barangay TEXT,
        municipality TEXT,
        province TEXT,
        zip_code TEXT,
        employment_status TEXT,
        occupation TEXT,
        employer_name TEXT,
        employer_address TEXT,
        employer_contact TEXT,
        date_started TEXT,
        FOREIGN KEY(application_id) REFERENCES applications(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS parents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        application_id INTEGER,
        mother_fullname TEXT,
        mother_maidenname TEXT,
        mother_dob TEXT,
        father_fullname TEXT,
        father_dob TEXT,
        FOREIGN KEY(application_id) REFERENCES applications(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS spouses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        application_id INTEGER,
        spouse_fullname TEXT,
        spouse_dob TEXT,
        spouse_address TEXT,
        FOREIGN KEY(application_id) REFERENCES applications(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS beneficiaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        application_id INTEGER,
        fullname TEXT,
        relationship TEXT,
        dob TEXT,
        address TEXT,
        contact TEXT,
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

    db.run(`CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        application_id INTEGER,
        payment_method TEXT,
        amount REAL,
        reference_no TEXT,
        payment_date TEXT,
        proof_path TEXT,
        status TEXT DEFAULT 'Unpaid',
        FOREIGN KEY(application_id) REFERENCES applications(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS status_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        application_id INTEGER,
        status TEXT,
        remarks TEXT,
        action_by TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(application_id) REFERENCES applications(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        title TEXT,
        message TEXT,
        is_read INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS admin_notes_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        application_id INTEGER,
        note TEXT,
        admin_name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(application_id) REFERENCES applications(id)
    )`);
});

// Helper functions
function generateTrackingNumber(service) {
    const prefix = service.includes('BIR') ? 'TIN' : service.includes('SSS') ? 'SSS' : 'PAGIBIG';
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `${prefix}-${dateStr}-${rand}`;
}

function addNotification(userId, title, message) {
    db.run(`INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)`, [userId, title, message]);
}

function logStatusHistory(appId, status, remarks, actionBy) {
    db.run(`INSERT INTO status_history (application_id, status, remarks, action_by) VALUES (?, ?, ?, ?)`, [appId, status, remarks, actionBy]);
}

// Authentication Middlewares
function requireCustomer(req, res, next) {
    if (req.session && req.session.customerId) {
        return next();
    }
    res.redirect('/customer/login');
}

function requireAdmin(req, res, next) {
    if (req.session && req.session.adminId) {
        return next();
    }
    res.redirect('/admin/login');
}

// ----------------------------------------------------
// HTML TEMPLATES & LAYOUTS GENERATOR
// ----------------------------------------------------
function renderLayout(title, content, userType = 'guest', settings = {}) {
    const disclaimer = `<div style="background:#fff3cd; color:#856404; padding:10px; text-align:center; font-size:13px; border-bottom:1px solid #ffeeba;">⚠️ DISCLAIMER: This system provides application assistance and document processing/tracking services. It is not an official website of BIR, SSS, or Pag-IBIG.</div>`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - GovAssist PH</title>
    <style>
        :root { --primary: #0f172a; --secondary: #2563eb; --accent: #10b981; --bg: #f8fafc; --text: #334155; --border: #cbd5e1; }
        * { box-sizing: border-box; margin:0; padding:0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
        body { background: var(--bg); color: var(--text); line-height: 1.5; }
        header { background: var(--primary); color: #fff; padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; }
        header a { color: #fff; text-decoration: none; margin-left: 15px; font-weight: 500; }
        .container { max-width: 1200px; margin: 2rem auto; padding: 0 1rem; }
        .card { background: #fff; border-radius: 8px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); padding: 2rem; margin-bottom: 1.5rem; }
        h1, h2, h3 { color: var(--primary); margin-bottom: 1rem; }
        .btn { display: inline-block; background: var(--secondary); color: #fff; padding: 0.6rem 1.2rem; border-radius: 6px; text-decoration: none; border: none; cursor: pointer; font-weight: 600; }
        .btn:hover { opacity: 0.9; }
        .btn-success { background: var(--accent); }
        .btn-danger { background: #ef4444; }
        .form-group { margin-bottom: 1.2rem; }
        label { display: block; margin-bottom: 0.5rem; font-weight: 600; font-size: 0.9rem; }
        input, select, textarea { width: 100%; padding: 0.75rem; border: 1px solid var(--border); border-radius: 6px; font-size: 1rem; }
        table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
        th, td { padding: 0.75rem; border-bottom: 1px solid var(--border); text-align: left; font-size: 0.95rem; }
        th { background: #f1f5f9; color: var(--primary); }
        .badge { display: inline-block; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.8rem; font-weight: 600; }
        .badge-pending { background: #fef3c7; color: #d97706; }
        .badge-paid { background: #d1fae5; color: #065f46; }
        .badge-completed { background: #dbeafe; color: #1e40af; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1.5rem; }
        .step-container { display: none; }
        .step-container.active { display: block; }
        .flex { display: flex; gap: 10px; align-items: center; }
        .justify-between { justify-content: space-between; }
        @media(max-width: 768px) { .grid { grid-template-columns: 1fr; } header { flex-direction: column; gap: 10px; text-align: center; } }
    </style>
</head>
<body>
    ${disclaimer}
    <header>
        <div><h2>GovAssist PH Portal</h2></div>
        <nav>
            ${userType === 'customer' ? `
                <a href="/customer/dashboard">Dashboard</a>
                <a href="/customer/apply">Mag-Apply</a>
                <a href="/customer/applications">Aking Application</a>
                <a href="/customer/notifications">Notifications</a>
                <a href="/customer/profile">Profile</a>
                <a href="/customer/logout" style="color:#fca5a5;">Logout</a>
            ` : userType === 'admin' ? `
                <a href="/admin/dashboard">Dashboard</a>
                <a href="/admin/applications">Applications</a>
                <a href="/admin/settings">Settings</a>
                <a href="/admin/logout" style="color:#fca5a5;">Admin Logout</a>
            ` : `
                <a href="/">Home</a>
                <a href="/customer/login">Customer Login</a>
                <a href="/admin/login">Admin Login</a>
            `}
        </nav>
    </header>
    <div class="container">
        ${content}
    </div>
</body>
</html>`;
}

// ----------------------------------------------------
// PUBLIC ROUTES
// ----------------------------------------------------
app.get('/', (req, res) => {
    const html = `
        <div class="card" style="text-align:center; padding: 4rem 2rem;">
            <h1>BIR/TIN, SSS & Pag-IBIG Application Assistance System</h1>
            <p style="margin: 1.5rem 0; font-size: 1.1rem; color: #64748b;">Fast, secure, and guided assistance for your government applications.</p>
            <div style="display:flex; justify-content:center; gap:20px; margin-top: 2rem;">
                <a href="/customer/login" class="btn">Customer Portal</a>
                <a href="/admin/login" class="btn" style="background:var(--primary);">Admin Portal</a>
            </div>
        </div>
    `;
    res.send(renderLayout('Home', html, 'guest'));
});

// ----------------------------------------------------
// CUSTOMER AUTHENTICATION & REGISTRATION
// ----------------------------------------------------
app.get('/customer/login', (req, res) => {
    const html = `
        <div class="card" style="max-width: 400px; margin: 3rem auto;">
            <h2>Customer Login</h2>
            <form action="/customer/login" method="POST">
                <div class="form-group">
                    <label>Username / Email</label>
                    <input type="text" name="username" required>
                </div>
                <div class="form-group">
                    <label>Password</label>
                    <input type="password" name="password" required>
                </div>
                <button type="submit" class="btn" style="width:100%;">Login</button>
            </form>
            <p style="margin-top:1rem; text-align:center; font-size:0.9rem;">Don't have an account? <a href="/customer/register">Register here</a></p>
        </div>
    `;
    res.send(renderLayout('Customer Login', html, 'guest'));
});

app.post('/customer/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ? OR email = ?`, [username, username], async (err, user) => {
        if (user && await bcrypt.compare(password, user.password)) {
            req.session.customerId = user.id;
            req.session.customerName = user.fullname;
            res.redirect('/customer/dashboard');
        } else {
            res.send(renderLayout('Customer Login', `<div class="card"><p style="color:red;">Invalid username or password.</p><a href="/customer/login" class="btn">Back</a></div>`, 'guest'));
        }
    });
});

app.get('/customer/register', (req, res) => {
    const html = `
        <div class="card" style="max-width: 500px; margin: 2rem auto;">
            <h2>Customer Registration</h2>
            <form action="/customer/register" method="POST">
                <div class="form-group"><label>Full Name</label><input type="text" name="fullname" required></div>
                <div class="form-group"><label>Email</label><input type="email" name="email" required></div>
                <div class="form-group"><label>Mobile Number</label><input type="text" name="mobile" required></div>
                <div class="form-group"><label>Username</label><input type="text" name="username" required></div>
                <div class="form-group"><label>Password</label><input type="password" name="password" required></div>
                <div class="form-group"><label>Confirm Password</label><input type="password" name="confirm_password" required></div>
                <button type="submit" class="btn" style="width:100%;">Register Account</button>
            </form>
            <p style="margin-top:1rem; text-align:center; font-size:0.9rem;">Already have an account? <a href="/customer/login">Login here</a></p>
        </div>
    `;
    res.send(renderLayout('Customer Registration', html, 'guest'));
});

app.post('/customer/register', async (req, res) => {
    const { fullname, email, mobile, username, password, confirm_password } = req.body;
    if (password !== confirm_password) {
        return res.send(renderLayout('Error', `<div class="card"><p style="color:red;">Passwords do not match.</p><a href="/customer/register" class="btn">Back</a></div>`, 'guest'));
    }
    const hashed = await bcrypt.hash(password, 10);
    db.run(`INSERT INTO users (fullname, email, mobile, username, password) VALUES (?, ?, ?, ?, ?)`,
        [fullname, email, mobile, username, hashed], function(err) {
            if (err) {
                return res.send(renderLayout('Error', `<div class="card"><p style="color:red;">Username or email already exists.</p><a href="/customer/register" class="btn">Back</a></div>`, 'guest'));
            }
            req.session.customerId = this.lastID;
            req.session.customerName = fullname;
            addNotification(this.lastID, 'Welcome', 'Your account has been successfully created.');
            res.redirect('/customer/dashboard');
        });
});

app.get('/customer/logout', (req, res) => {
    req.session.destroy(() => { res.redirect('/customer/login'); });
});

// ----------------------------------------------------
// ADMIN AUTHENTICATION
// ----------------------------------------------------
app.get('/admin/login', (req, res) => {
    const html = `
        <div class="card" style="max-width: 400px; margin: 3rem auto;">
            <h2>Admin Portal Login</h2>
            <form action="/admin/login" method="POST">
                <div class="form-group"><label>Admin Username</label><input type="text" name="username" required></div>
                <div class="form-group"><label>Password</label><input type="password" name="password" required></div>
                <button type="submit" class="btn" style="width:100%; background:var(--primary);">Admin Login</button>
            </form>
        </div>
    `;
    res.send(renderLayout('Admin Login', html, 'guest'));
});

app.post('/admin/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM admin_users WHERE username = ?`, [username], async (err, admin) => {
        if (admin && await bcrypt.compare(password, admin.password)) {
            req.session.adminId = admin.id;
            req.session.adminName = admin.fullname;
            res.redirect('/admin/dashboard');
        } else {
            res.send(renderLayout('Admin Login', `<div class="card"><p style="color:red;">Invalid admin credentials.</p><a href="/admin/login" class="btn">Back</a></div>`, 'guest'));
        }
    });
});

app.get('/admin/logout', (req, res) => {
    req.session.destroy(() => { res.redirect('/admin/login'); });
});

// ----------------------------------------------------
// CUSTOMER PORTAL & DASHBOARD
// ----------------------------------------------------
app.get('/customer/dashboard', requireCustomer, (req, res) => {
    db.all(`SELECT * FROM applications WHERE user_id = ? ORDER BY id DESC`, [req.session.customerId], (err, apps) => {
        db.all(`SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 5`, [req.session.customerId], (err, notifs) => {
            let html = `
                <h2>Welcome, ${req.session.customerName}</h2>
                <div style="display:flex; gap:15px; margin-bottom:2rem; flex-wrap:wrap;">
                    <a href="/customer/apply" class="btn btn-success">+ Mag-Apply (Apply Now)</a>
                    <a href="/customer/applications" class="btn">Aking Application (My Applications)</a>
                    <a href="/customer/notifications" class="btn" style="background:#64748b;">Notifications</a>
                    <a href="/customer/profile" class="btn" style="background:#475569;">Profile</a>
                </div>
                <div class="grid">
                    <div class="card">
                        <h3>Recent Applications</h3>
                        ${apps.length === 0 ? '<p>No applications yet.</p>' : `
                            <table>
                                <tr><th>Tracking #</th><th>Service</th><th>Status</th><th>Payment</th></tr>
                                ${apps.slice(0, 3).map(a => `<tr><td><a href="/customer/track/${a.tracking_number}">${a.tracking_number}</a></td><td>${a.service}</td><td><span class="badge badge-pending">${a.application_status}</span></td><td><span class="badge badge-paid">${a.payment_status}</span></td></tr>`).join('')}
                            </table>
                        `}
                    </div>
                    <div class="card">
                        <h3>Recent Notifications</h3>
                        ${notifs.length === 0 ? '<p>No new notifications.</p>' : `
                            <ul>
                                ${notifs.map(n => `<li style="margin-bottom:10px; font-size:0.9rem;"><strong>${n.title}</strong>: ${n.message}<br><small style="color:#888;">${n.created_at}</small></li>`).join('')}
                            </ul>
                        `}
                    </div>
                </div>
            `;
            res.send(renderLayout('Customer Dashboard', html, 'customer'));
        });
    });
});

app.get('/customer/applications', requireCustomer, (req, res) => {
    db.all(`SELECT * FROM applications WHERE user_id = ? ORDER BY id DESC`, [req.session.customerId], (err, apps) => {
        let html = `
            <div class="card">
                <h2>Aking Application (My Applications)</h2>
                ${apps.length === 0 ? '<p>You have not submitted any applications.</p>' : `
                    <table>
                        <tr><th>Tracking Number</th><th>Service</th><th>Date Submitted</th><th>Payment Status</th><th>Application Status</th><th>Action</th></tr>
                        ${apps.map(a => `
                            <tr>
                                <td><strong>${a.tracking_number}</strong></td>
                                <td>${a.service}</td>
                                <td>${a.date_submitted}</td>
                                <td><span class="badge">${a.payment_status}</span></td>
                                <td><span class="badge badge-pending">${a.application_status}</span></td>
                                <td><a href="/customer/track/${a.tracking_number}" class="btn" style="padding:0.3rem 0.6rem; font-size:0.8rem;">View / Track</a></td>
                            </tr>
                        `).join('')}
                    </table>
                `}
            </div>
        `;
        res.send(renderLayout('My Applications', html, 'customer'));
    });
});

app.get('/customer/notifications', requireCustomer, (req, res) => {
    db.all(`SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC`, [req.session.customerId], (err, notifs) => {
        let html = `
            <div class="card">
                <h2>Notifications</h2>
                ${notifs.length === 0 ? '<p>No notifications found.</p>' : `
                    <table>
                        <tr><th>Date</th><th>Title</th><th>Message</th></tr>
                        ${notifs.map(n => `<tr><td>${n.created_at}</td><td><strong>${n.title}</strong></td><td>${n.message}</td></tr>`).join('')}
                    </table>
                `}
            </div>
        `;
        res.send(renderLayout('Notifications', html, 'customer'));
    });
});

app.get('/customer/profile', requireCustomer, (req, res) => {
    db.get(`SELECT * FROM users WHERE id = ?`, [req.session.customerId], (err, user) => {
        let html = `
            <div class="card" style="max-width: 500px;">
                <h2>Customer Profile</h2>
                <p><strong>Full Name:</strong> ${user.fullname}</p>
                <p><strong>Email:</strong> ${user.email}</p>
                <p><strong>Mobile Number:</strong> ${user.mobile}</p>
                <p><strong>Username:</strong> ${user.username}</p>
            </div>
        `;
        res.send(renderLayout('Profile', html, 'customer'));
    });
});

// ----------------------------------------------------
// APPLICATION FORM WIZARD (MULTI-STEP)
// ----------------------------------------------------
app.get('/customer/apply', requireCustomer, (req, res) => {
    db.get(`SELECT * FROM system_settings WHERE id = 1`, (err, settings) => {
        let html = `
            <div class="card">
                <h2>New Government Application Assistance</h2>
                <form id="applicationForm" action="/customer/apply" method="POST" enctype="multipart/form-data">
                    
                    <!-- Progress Indicator -->
                    <div style="display:flex; justify-content:space-between; margin-bottom:2rem; overflow-x:auto; gap:5px;">
                        ${[1,2,3,4,5,6,7,8,9,10].map(s => `<span class="step-indicator badge" id="ind-${s}" style="background:#cbd5e1; color:#333; padding:5px 10px;">Step ${s}</span>`).join('')}
                    </div>

                    <!-- STEP 1: Service & Personal Information -->
                    <div class="step-container active" data-step="1">
                        <h3>Step 1: Select Service & Personal Information</h3>
                        <div class="form-group">
                            <label>Select Service *</label>
                            <select name="service" id="serviceSelect" required onchange="toggleServiceFields()">
                                <option value="">-- Choose Service --</option>
                                <option value="BIR / TIN APPLICATION">BIR / TIN Application (Fee: ₱${settings.bir_fee})</option>
                                <option value="SSS APPLICATION">SSS Application (Fee: ₱${settings.sss_fee})</option>
                                <option value="PAG-IBIG APPLICATION">Pag-IBIG Application (Fee: ₱${settings.pagibig_fee})</option>
                            </select>
                        </div>
                        <div class="grid">
                            <div class="form-group"><label>First Name *</label><input type="text" name="first_name" required></div>
                            <div class="form-group"><label>Middle Name</label><input type="text" name="middle_name"></div>
                            <div class="form-group"><label>Last Name *</label><input type="text" name="last_name" required></div>
                            <div class="form-group"><label>Suffix (Jr, Sr, III)</label><input type="text" name="suffix"></div>
                            <div class="form-group"><label>Date of Birth *</label><input type="date" name="dob" required></div>
                            <div class="form-group"><label>Place of Birth *</label><input type="text" name="pob" required></div>
                            <div class="form-group"><label>Sex *</label><select name="sex" required><option value="Male">Male</option><option value="Female">Female</option></select></div>
                            <div class="form-group"><label>Civil Status *</label><select name="civil_status" id="civilStatusSelect" required onchange="toggleSpouseSection()"><option value="Single">Single</option><option value="Married">Married</option><option value="Widowed">Widowed</option><option value="Divorced">Divorced</option></select></div>
                            <div class="form-group"><label>Citizenship *</label><input type="text" name="citizenship" value="Filipino" required></div>
                            <div class="form-group"><label>Mobile Number *</label><input type="text" name="mobile" required></div>
                            <div class="form-group"><label>Email Address *</label><input type="email" name="email" required></div>
                            <div class="form-group"><label>Telephone Number</label><input type="text" name="telephone"></div>
                        </div>
                        <button type="button" class="btn" onclick="nextStep(2)">Next</button>
                    </div>

                    <!-- STEP 2: Address -->
                    <div class="step-container" data-step="2">
                        <h3>Step 2: Address</h3>
                        <div class="grid">
                            <div class="form-group"><label>House / Unit Number *</label><input type="text" name="house_no" required></div>
                            <div class="form-group"><label>Street *</label><input type="text" name="street" required></div>
                            <div class="form-group"><label>Barangay *</label><input type="text" name="barangay" required></div>
                            <div class="form-group"><label>Municipality / City *</label><input type="text" name="municipality" required></div>
                            <div class="form-group"><label>Province *</label><input type="text" name="province" required></div>
                            <div class="form-group"><label>ZIP Code *</label><input type="text" name="zip_code" required></div>
                        </div>
                        <button type="button" class="btn" onclick="prevStep(1)">Back</button>
                        <button type="button" class="btn" onclick="nextStep(3)">Next</button>
                    </div>

                    <!-- STEP 3: Family / Parents -->
                    <div class="step-container" data-step="3">
                        <h3>Step 3: Parents Information (Required for SSS & Pag-IBIG)</h3>
                        <p style="font-size:0.9rem; color:#666; margin-bottom:1rem;">Note: For SSS and Pag-IBIG, exact birthdates of both mother and father are required.</p>
                        <div class="grid">
                            <div class="form-group"><label>Mother's Full Name (First, Middle, Last) *</label><input type="text" name="mother_fullname" required></div>
                            <div class="form-group"><label>Mother's Maiden Name *</label><input type="text" name="mother_maidenname" required></div>
                            <div class="form-group"><label>Mother's Date of Birth *</label><input type="date" name="mother_dob" required></div>
                            <div class="form-group"><label>Father's Full Name (First, Middle, Last) *</label><input type="text" name="father_fullname" required></div>
                            <div class="form-group"><label>Father's Date of Birth *</label><input type="date" name="father_dob" required></div>
                        </div>
                        <button type="button" class="btn" onclick="prevStep(2)">Back</button>
                        <button type="button" class="btn" onclick="nextStep(4)">Next</button>
                    </div>

                    <!-- STEP 4: Employment -->
                    <div class="step-container" data-step="4">
                        <h3>Step 4: Employment Information</h3>
                        <div class="grid">
                            <div class="form-group"><label>Employment Status *</label><select name="employment_status"><option value="Employed">Employed</option><option value="Self-Employed">Self-Employed</option><option value="Unemployed">Unemployed</option><option value="Student">Student</option></select></div>
                            <div class="form-group"><label>Occupation</label><input type="text" name="occupation"></div>
                            <div class="form-group"><label>Employer Name</label><input type="text" name="employer_name"></div>
                            <div class="form-group"><label>Employer Address</label><input type="text" name="employer_address"></div>
                            <div class="form-group"><label>Employer Contact Number</label><input type="text" name="employer_contact"></div>
                            <div class="form-group"><label>Date Started Working</label><input type="date" name="date_started"></div>
                        </div>
                        <button type="button" class="btn" onclick="prevStep(3)">Back</button>
                        <button type="button" class="btn" onclick="nextStep(5)">Next</button>
                    </div>

                    <!-- STEP 5: Spouse -->
                    <div class="step-container" data-step="5">
                        <h3>Step 5: Spouse Information (If Married)</h3>
                        <div id="spouseSection">
                            <p>If you selected Married, please fill out spouse details and prepare your Marriage Certificate.</p>
                            <div class="grid">
                                <div class="form-group"><label>Spouse Full Name</label><input type="text" name="spouse_fullname"></div>
                                <div class="form-group"><label>Spouse Date of Birth</label><input type="date" name="spouse_dob"></div>
                                <div class="form-group"><label>Spouse Address</label><input type="text" name="spouse_address"></div>
                            </div>
                        </div>
                        <button type="button" class="btn" onclick="prevStep(4)">Back</button>
                        <button type="button" class="btn" onclick="nextStep(6)">Next</button>
                    </div>

                    <!-- STEP 6: Beneficiaries -->
                    <div class="step-container" data-step="6">
                        <h3>Step 6: Beneficiaries (Required for SSS & Pag-IBIG)</h3>
                        <p style="font-size:0.9rem; color:#666; margin-bottom:1rem;">Add the people you want to list as beneficiaries and indicate your relationship with them.</p>
                        <div id="beneficiariesList">
                            <div class="beneficiary-item card" style="background:#f8fafc; padding:1rem; margin-bottom:1rem;">
                                <h4>Beneficiary 1</h4>
                                <div class="grid">
                                    <div class="form-group"><label>Full Name</label><input type="text" name="ben_fullname[]"></div>
                                    <div class="form-group"><label>Relationship</label><input type="text" name="ben_relationship[]"></div>
                                    <div class="form-group"><label>Date of Birth</label><input type="date" name="ben_dob[]"></div>
                                    <div class="form-group"><label>Address</label><input type="text" name="ben_address[]"></div>
                                    <div class="form-group"><label>Contact Number</label><input type="text" name="ben_contact[]"></div>
                                </div>
                            </div>
                        </div>
                        <button type="button" class="btn btn-success" onclick="addBeneficiary()">+ Add Beneficiary</button>
                        <br><br>
                        <button type="button" class="btn" onclick="prevStep(5)">Back</button>
                        <button type="button" class="btn" onclick="nextStep(7)">Next</button>
                    </div>

                    <!-- STEP 7: Valid ID & Photos -->
                    <div class="step-container" data-step="7">
                        <h3>Step 7: Valid ID, Photo Holding ID & ID Picture</h3>
                        <div class="form-group">
                            <label>Valid ID Type *</label>
                            <select name="id_type" required>
                                <option value="National ID">National ID</option>
                                <option value="Driver's License">Driver's License</option>
                                <option value="Passport">Passport</option>
                                <option value="Postal ID">Postal ID</option>
                                <option value="PhilSys ID">PhilSys ID</option>
                                <option value="Other Government ID">Other Government ID</option>
                            </select>
                        </div>
                        <div class="form-group"><label>ID Number (if applicable)</label><input type="text" name="id_number"></div>
                        <div class="form-group"><label>Upload Valid ID (Front) *</label><input type="file" name="id_front" accept="image/*,application/pdf" required></div>
                        <div class="form-group"><label>Upload Valid ID (Back)</label><input type="file" name="id_back" accept="image/*,application/pdf"></div>
                        
                        <hr style="margin:1.5rem 0;">
                        <h4>Photo Holding ID</h4>
                        <p style="font-size:0.9rem; color:#666;">Please upload a clear photo of yourself while holding the same ID you uploaded. Make sure your face and ID can be clearly seen.</p>
                        <div class="form-group"><label>Upload Photo Holding ID *</label><input type="file" name="photo_holding_id" accept="image/*" required></div>

                        <hr style="margin:1.5rem 0;">
                        <h4>ID Picture / Profile Picture</h4>
                        <div class="form-group"><label>Upload 2x2 or Passport ID Picture (JPG/PNG) *</label><input type="file" name="id_picture" accept="image/*" required></div>

                        <hr style="margin:1.5rem 0;">
                        <h4>Supporting Documents (e.g., Marriage Certificate if Married)</h4>
                        <div class="form-group"><label>Marriage Certificate (Required if Married)</label><input type="file" name="marriage_cert" accept="image/*,application/pdf"></div>
                        <div class="form-group"><label>Other Supporting Documents</label><input type="file" name="other_docs" accept="image/*,application/pdf"></div>

                        <button type="button" class="btn" onclick="prevStep(6)">Back</button>
                        <button type="button" class="btn" onclick="nextStep(8)">Next</button>
                    </div>

                    <!-- STEP 8: Review Application -->
                    <div class="step-container" data-step="8">
                        <h3>Step 8: Review Application Summary</h3>
                        <p>Please review your information before proceeding to payment. Click 'Edit Information' if you need to make changes.</p>
                        <div id="reviewSummary" class="card" style="background:#f1f5f9; padding:1.5rem; margin:1rem 0;">
                            <!-- Dynamically populated via JS -->
                        </div>
                        <button type="button" class="btn" onclick="prevStep(7)">Back</button>
                        <button type="button" class="btn btn-success" onclick="nextStep(9)">Proceed to Payment</button>
                    </div>

                    <!-- STEP 9: Payment -->
                    <div class="step-container" data-step="9">
                        <h3>Step 9: Payment System</h3>
                        <p>Select your preferred payment method:</p>
                        <div class="form-group">
                            <label><input type="radio" name="payment_method" value="CASH" checked onclick="togglePaymentMethod('CASH')"> Cash Payment</label>
                            <label><input type="radio" name="payment_method" value="GCASH" onclick="togglePaymentMethod('GCASH')"> GCash Payment</label>
                        </div>

                        <div id="cashInstructions" class="card" style="background:#f8fafc;">
                            <h4>Cash Payment Instructions</h4>
                            <p>Please pay the processing fee according to the instructions provided by our office or staff. Processing fee will be validated once received.</p>
                        </div>

                        <div id="gcashInstructions" class="card" style="background:#f8fafc; display:none;">
                            <h4>GCash Payment Instructions</h4>
                            <p>Scan the QR code below or send payment to:</p>
                            <p><strong>GCash Name:</strong> ${settings.gcash_name}</p>
                            <p><strong>GCash Number:</strong> ${settings.gcash_number}</p>
                            ${settings.gcash_qr ? `<img src="/uploads/${settings.gcash_qr}" alt="GCash QR" style="max-width:200px; display:block; margin:10px 0;">` : '<p style="color:red;">QR code not uploaded by admin yet. Please use GCash number.</p>'}
                            
                            <div class="form-group" style="margin-top:1rem;"><label>GCash Reference Number *</label><input type="text" name="gcash_ref"></div>
                            <div class="form-group"><label>Payment Date *</label><input type="date" name="gcash_date"></div>
                            <div class="form-group"><label>Amount Paid *</label><input type="number" step="0.01" name="gcash_amount"></div>
                            <div class="form-group"><label>Upload GCash Proof of Payment (Screenshot) *</label><input type="file" name="gcash_proof" accept="image/*"></div>
                        </div>

                        <button type="button" class="btn" onclick="prevStep(8)">Back</button>
                        <button type="button" class="btn btn-success" onclick="nextStep(10)">Final Submit</button>
                    </div>

                    <!-- STEP 10: Submit -->
                    <div class="step-container" data-step="10">
                        <h3>Step 10: Final Submission</h3>
                        <p>By clicking submit, you confirm that all information provided is accurate and truthful.</p>
                        <button type="button" class="btn" onclick="prevStep(9)">Back</button>
                        <button type="submit" class="btn btn-success" style="font-size:1.1rem; padding:0.8rem 2rem;">Submit Application</button>
                    </div>

                </form>
            </div>

            <script>
                let currentStep = 1;
                function showStep(step) {
                    document.querySelectorAll('.step-container').forEach(el => el.classList.remove('active'));
                    document.querySelector('.step-container[data-step="'+step+'"]').classList.add('active');
                    document.querySelectorAll('.step-indicator').forEach(el => el.style.background = '#cbd5e1');
                    document.getElementById('ind-'+step).style.background = '#2563eb';
                    document.getElementById('ind-'+step).style.color = '#fff';
                    currentStep = step;
                    if(step === 8) generateReview();
                    window.scrollTo(0,0);
                }
                function nextStep(step) { showStep(step); }
                function prevStep(step) { showStep(step); }

                function addBeneficiary() {
                    const container = document.getElementById('beneficiariesList');
                    const count = container.children.length + 1;
                    const div = document.createElement('div');
                    div.className = 'beneficiary-item card';
                    div.style.cssText = 'background:#f8fafc; padding:1rem; margin-bottom:1rem;';
                    div.innerHTML = '<h4>Beneficiary ' + count + '</h4><div class="grid"><div class="form-group"><label>Full Name</label><input type="text" name="ben_fullname[]"></div><div class="form-group"><label>Relationship</label><input type="text" name="ben_relationship[]"></div><div class="form-group"><label>Date of Birth</label><input type="date" name="ben_dob[]"></div><div class="form-group"><label>Address</label><input type="text" name="ben_address[]"></div><div class="form-group"><label>Contact Number</label><input type="text" name="ben_contact[]"></div></div>';
                    container.appendChild(div);
                }

                function togglePaymentMethod(method) {
                    if(method === 'CASH') {
                        document.getElementById('cashInstructions').style.display = 'block';
                        document.getElementById('gcashInstructions').style.display = 'none';
                    } else {
                        document.getElementById('cashInstructions').style.display = 'none';
                        document.getElementById('gcashInstructions').style.display = 'block';
                    }
                }

                function generateReview() {
                    const form = document.getElementById('applicationForm');
                    const formData = new FormData(form);
                    let html = '<h4>Summary of Information</h4><ul>';
                    for(let pair of formData.entries()) {
                        if(pair[1] instanceof File) {
                            if(pair[1].name) html += '<li><strong>' + pair[0] + ':</strong> ' + pair[1].name + '</li>';
                        } else if(pair[1]) {
                            html += '<li><strong>' + pair[0] + ':</strong> ' + pair[1] + '</li>';
                        }
                    }
                    html += '</ul>';
                    document.getElementById('reviewSummary').innerHTML = html;
                }

                showStep(1);
            </script>
        `;
        res.send(renderLayout('Apply for Assistance', html, 'customer'));
    });
});

const uploadFields = upload.fields([
    { name: 'id_front', maxCount: 1 },
    { name: 'id_back', maxCount: 1 },
    { name: 'photo_holding_id', maxCount: 1 },
    { name: 'id_picture', maxCount: 1 },
    { name: 'marriage_cert', maxCount: 1 },
    { name: 'other_docs', maxCount: 1 },
    { name: 'gcash_proof', maxCount: 1 }
]);

app.post('/customer/apply', requireCustomer, uploadFields, (req, res) => {
    const data = req.body;
    const userId = req.session.customerId;
    const service = data.service || 'BIR / TIN APPLICATION';
    const trackingNumber = generateTrackingNumber(service);

    db.run(`INSERT INTO applications (user_id, service, tracking_number, payment_status, application_status) VALUES (?, ?, ?, ?, ?)`,
        [userId, service, trackingNumber, data.payment_method === 'GCASH' ? 'Proof Submitted' : 'Unpaid', 'Submitted'], function(err) {
            if(err) {
                return res.send(renderLayout('Error', `<div class="card"><p style="color:red;">Error creating application: ${err.message}</p><a href="/customer/apply" class="btn">Back</a></div>`, 'customer'));
            }
            const appId = this.lastID;

            // Save applicant info
            db.run(`INSERT INTO applicant_information (application_id, first_name, middle_name, last_name, suffix, dob, pob, sex, civil_status, citizenship, mobile, email, telephone, house_no, street, barangay, municipality, province, zip_code, employment_status, occupation, employer_name, employer_address, employer_contact, date_started) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                [appId, data.first_name, data.middle_name, data.last_name, data.suffix, data.dob, data.pob, data.sex, data.civil_status, data.citizenship, data.mobile, data.email, data.telephone, data.house_no, data.street, data.barangay, data.municipality, data.province, data.zip_code, data.employment_status, data.occupation, data.employer_name, data.employer_address, data.employer_contact, data.date_started]);

            // Save parents
            db.run(`INSERT INTO parents (application_id, mother_fullname, mother_maidenname, mother_dob, father_fullname, father_dob) VALUES (?,?,?,?,?,?)`,
                [appId, data.mother_fullname, data.mother_maidenname, data.mother_dob, data.father_fullname, data.father_dob]);

            // Save spouse
            if(data.civil_status === 'Married') {
                db.run(`INSERT INTO spouses (application_id, spouse_fullname, spouse_dob, spouse_address) VALUES (?,?,?,?)`,
                    [appId, data.spouse_fullname, data.spouse_dob, data.spouse_address]);
            }

            // Save beneficiaries
            if(data.ben_fullname) {
                for(let i=0; i<data.ben_fullname.length; i++) {
                    if(data.ben_fullname[i]) {
                        db.run(`INSERT INTO beneficiaries (application_id, fullname, relationship, dob, address, contact) VALUES (?,?,?,?,?,?)`,
                            [appId, data.ben_fullname[i], data.ben_relationship[i], data.ben_dob[i], data.ben_address[i], data.ben_contact[i]]);
                    }
                }
            }

            // Save documents
            if(req.files) {
                Object.keys(req.files).forEach(fieldName => {
                    const file = req.files[fieldName][0];
                    db.run(`INSERT INTO documents (application_id, doc_type, file_path, original_name) VALUES (?,?,?,?)`,
                        [appId, fieldName, file.filename, file.originalname]);
                });
            }

            // Save payment
            db.run(`INSERT INTO payments (application_id, payment_method, amount, reference_no, payment_date, proof_path, status) VALUES (?,?,?,?,?,?,?)`,
                [appId, data.payment_method, data.gcash_amount || 0, data.gcash_ref || '', data.gcash_date || '', req.files && req.files.gcash_proof ? req.files.gcash_proof[0].filename : '', data.payment_method === 'GCASH' ? 'Proof Submitted' : 'Unpaid']);

            logStatusHistory(appId, 'Submitted', 'Application successfully submitted by customer.', 'Customer');
            addNotification(userId, 'Application Submitted', `Your application ${trackingNumber} has been successfully submitted.`);

            res.redirect(`/customer/track/${trackingNumber}`);
        });
});

app.get('/customer/track/:trackingNumber', requireCustomer, (req, res) => {
    const trackingNumber = req.params.trackingNumber;
    db.get(`SELECT * FROM applications WHERE tracking_number = ? AND user_id = ?`, [trackingNumber, req.session.customerId], (err, app) => {
        if(!app) {
            return res.send(renderLayout('Error', `<div class="card"><p style="color:red;">Application not found or unauthorized.</p><a href="/customer/dashboard" class="btn">Dashboard</a></div>`, 'customer'));
        }
        db.all(`SELECT * FROM status_history WHERE application_id = ? ORDER BY id ASC`, [app.id], (err, history) => {
            db.all(`SELECT * FROM documents WHERE application_id = ?`, [app.id], (err, docs) => {
                db.get(`SELECT * FROM payments WHERE application_id = ?`, [app.id], (err, payment) => {
                    let html = `
                        <div class="card">
                            <h2>Application Tracking: ${app.tracking_number}</h2>
                            <p><strong>Service:</strong> ${app.service}</p>
                            <p><strong>Date Submitted:</strong> ${app.date_submitted}</p>
                            <p><strong>Payment Status:</strong> <span class="badge badge-paid">${app.payment_status}</span></p>
                            <p><strong>Application Status:</strong> <span class="badge badge-pending">${app.application_status}</span></p>
                            <p><strong>Admin Remarks:</strong> ${app.admin_remarks || 'None yet.'}</p>
                        </div>
                        <div class="card">
                            <h3>Application Progress Timeline</h3>
                            <ul>
                                ${history.map(h => `<li style="margin-bottom:10px;"><strong>${h.status}</strong> - ${h.timestamp}<br><small>${h.remarks}</small></li>`).join('')}
                            </ul>
                        </div>
                        <div class="card">
                            <h3>Uploaded Documents</h3>
                            <ul>
                                ${docs.map(d => `<li>${d.doc_type}: <a href="/uploads/${d.file_path}" target="_blank">${d.original_name}</a></li>`).join('')}
                            </ul>
                        </div>
                        <div class="card">
                            <h3>Completed Files from Admin</h3>
                            ${docs.filter(d => d.doc_type.includes('completed')).length === 0 ? '<p>No completed files uploaded by admin yet.</p>' : `
                                <ul>
                                    ${docs.filter(d => d.doc_type.includes('completed')).map(d => `<li><a href="/uploads/${d.file_path}" target="_blank" download>${d.original_name}</a></li>`).join('')}
                                </ul>
                            `}
                        </div>
                    `;
                    res.send(renderLayout('Tracking Application', html, 'customer'));
                });
            });
        });
    });
});

// ----------------------------------------------------
// ADMIN PORTAL & DASHBOARD
// ----------------------------------------------------
app.get('/admin/dashboard', requireAdmin, (req, res) => {
    db.get(`SELECT COUNT(*) as total FROM applications`, (err, r1) => {
        db.get(`SELECT COUNT(*) as total FROM users`, (err, r2) => {
            db.get(`SELECT COUNT(*) as total FROM applications WHERE service LIKE '%BIR%'`, (err, r3) => {
                db.get(`SELECT COUNT(*) as total FROM applications WHERE service LIKE '%SSS%'`, (err, r4) => {
                    db.get(`SELECT COUNT(*) as total FROM applications WHERE service LIKE '%PAG-IBIG%'`, (err, r5) => {
                        db.get(`SELECT COUNT(*) as total FROM applications WHERE application_status = 'Submitted'`, (err, r6) => {
                            db.get(`SELECT COUNT(*) as total FROM applications WHERE payment_status = 'Proof Submitted'`, (err, r7) => {
                                let html = `
                                    <h2>Admin Dashboard</h2>
                                    <div class="grid" style="margin-bottom:2rem;">
                                        <div class="card" style="background:#2563eb; color:#fff;"><h3>Total Applications</h3><p style="font-size:2rem; font-weight:bold;">${r1.total}</p></div>
                                        <div class="card" style="background:#10b981; color:#fff;"><h3>Total Customers</h3><p style="font-size:2rem; font-weight:bold;">${r2.total}</p></div>
                                        <div class="card" style="background:#f59e0b; color:#fff;"><h3>Pending Review</h3><p style="font-size:2rem; font-weight:bold;">${r6.total}</p></div>
                                        <div class="card" style="background:#8b5cf6; color:#fff;"><h3>Payment Verification</h3><p style="font-size:2rem; font-weight:bold;">${r7.total}</p></div>
                                    </div>
                                    <div class="card">
                                        <h3>Quick Stats by Service</h3>
                                        <p>BIR / TIN: <strong>${r3.total}</strong></p>
                                        <p>SSS: <strong>${r4.total}</strong></p>
                                        <p>Pag-IBIG: <strong>${r5.total}</strong></p>
                                        <br>
                                        <a href="/admin/applications" class="btn">Manage All Applications</a>
                                        <a href="/admin/settings" class="btn" style="background:#475569;">System Settings</a>
                                    </div>
                                `;
                                res.send(renderLayout('Admin Dashboard', html, 'admin'));
                            });
                        });
                    });
                });
            });
        });
    });
});

app.get('/admin/applications', requireAdmin, (req, res) => {
    const { search, filter_service, filter_status } = req.query;
    let query = `SELECT a.*, u.fullname as customer_name FROM applications a JOIN users u ON a.user_id = u.id WHERE 1=1`;
    let params = [];

    if(search) {
        query += ` AND (u.fullname LIKE ? OR a.tracking_number LIKE ? OR u.mobile LIKE ?)`;
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if(filter_service) {
        query += ` AND a.service = ?`;
        params.push(filter_service);
    }
    if(filter_status) {
        query += ` AND a.application_status = ?`;
        params.push(filter_status);
    }

    query += ` ORDER BY a.id DESC`;

    db.all(query, params, (err, apps) => {
        let html = `
            <div class="card">
                <h2>Admin Applications Management</h2>
                <form method="GET" action="/admin/applications" style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:1.5rem;">
                    <input type="text" name="search" placeholder="Search name, tracking #, mobile..." value="${search || ''}" style="flex:1; min-width:200px;">
                    <select name="filter_service">
                        <option value="">All Services</option>
                        <option value="BIR / TIN APPLICATION" ${filter_service === 'BIR / TIN APPLICATION' ? 'selected' : ''}>BIR / TIN</option>
                        <option value="SSS APPLICATION" ${filter_service === 'SSS APPLICATION' ? 'selected' : ''}>SSS</option>
                        <option value="PAG-IBIG APPLICATION" ${filter_service === 'PAG-IBIG APPLICATION' ? 'selected' : ''}>Pag-IBIG</option>
                    </select>
                    <select name="filter_status">
                        <option value="">All Statuses</option>
                        <option value="Submitted" ${filter_status === 'Submitted' ? 'selected' : ''}>Submitted</option>
                        <option value="Under Review" ${filter_status === 'Under Review' ? 'selected' : ''}>Under Review</option>
                        <option value="Processing" ${filter_status === 'Processing' ? 'selected' : ''}>Processing</option>
                        <option value="Completed" ${filter_status === 'Completed' ? 'selected' : ''}>Completed</option>
                    </select>
                    <button type="submit" class="btn">Filter</button>
                    <a href="/admin/applications" class="btn" style="background:#64748b;">Reset</a>
                </form>

                <table>
                    <tr><th>Applicant Name</th><th>Service</th><th>Tracking Number</th><th>Date</th><th>Payment</th><th>Status</th><th>Action</th></tr>
                    ${apps.map(a => `
                        <tr>
                            <td><a href="/admin/applicant/${a.id}"><strong>${a.customer_name}</strong></a></td>
                            <td>${a.service}</td>
                            <td>${a.tracking_number}</td>
                            <td>${a.date_submitted}</td>
                            <td><span class="badge">${a.payment_status}</span></td>
                            <td><span class="badge badge-pending">${a.application_status}</span></td>
                            <td><a href="/admin/applicant/${a.id}" class="btn" style="padding:0.3rem 0.6rem; font-size:0.8rem;">Review</a></td>
                        </tr>
                    `).join('')}
                </table>
            </div>
        `;
        res.send(renderLayout('Manage Applications', html, 'admin'));
    });
});

app.get('/admin/applicant/:id', requireAdmin, (req, res) => {
    const appId = req.params.id;
    db.get(`SELECT a.*, u.fullname as customer_name, u.email as user_email, u.mobile as user_mobile FROM applications a JOIN users u ON a.user_id = u.id WHERE a.id = ?`, [appId], (err, app) => {
        db.get(`SELECT * FROM applicant_information WHERE application_id = ?`, [appId], (err, info) => {
            db.get(`SELECT * FROM parents WHERE application_id = ?`, [appId], (err, parents) => {
                db.get(`SELECT * FROM spouses WHERE application_id = ?`, [appId], (err, spouse) => {
                    db.all(`SELECT * FROM beneficiaries WHERE application_id = ?`, [appId], (err, benList) => {
                        db.all(`SELECT * FROM documents WHERE application_id = ?`, [appId], (err, docs) => {
                            db.get(`SELECT * FROM payments WHERE application_id = ?`, [appId], (err, payment) => {
                                db.all(`SELECT * FROM status_history WHERE application_id = ?`, [appId], (err, history) => {
                                    
                                    let html = `
                                        <div class="card">
                                            <h2>Applicant Profile: ${app.customer_name} (${app.tracking_number})</h2>
                                            <div style="display:flex; gap:10px; margin-bottom:1rem;">
                                                <button onclick="window.print()" class="btn">Print Application Information</button>
                                            </div>

                                            <!-- APPLICATION ASSISTANCE DATA VIEW -->
                                            <div class="card" style="background:#f8fafc; border:1px solid #cbd5e1;">
                                                <h3>APPLICATION INFORMATION / DATA TO ENTER</h3>
                                                <p style="font-size:0.9rem; color:#666; margin-bottom:1rem;">Use this data when filling out the official government application form.</p>
                                                <table>
                                                    <tr><th>Field</th><th>Customer Information</th></tr>
                                                    <tr><td>Service</td><td><strong>${app.service}</strong></td></tr>
                                                    <tr><td>First Name</td><td>${info.first_name || ''}</td></tr>
                                                    <tr><td>Middle Name</td><td>${info.middle_name || ''}</td></tr>
                                                    <tr><td>Last Name</td><td>${info.last_name || ''}</td></tr>
                                                    <tr><td>Suffix</td><td>${info.suffix || ''}</td></tr>
                                                    <tr><td>Date of Birth</td><td>${info.dob || ''}</td></tr>
                                                    <tr><td>Place of Birth</td><td>${info.pob || ''}</td></tr>
                                                    <tr><td>Sex</td><td>${info.sex || ''}</td></tr>
                                                    <tr><td>Civil Status</td><td>${info.civil_status || ''}</td></tr>
                                                    <tr><td>Citizenship</td><td>${info.citizenship || ''}</td></tr>
                                                    <tr><td>Contact Number</td><td>${info.mobile || ''}</td></tr>
                                                    <tr><td>Email Address</td><td>${info.email || ''}</td></tr>
                                                    <tr><td>Complete Address</td><td>${info.house_no}, ${info.street}, ${info.barangay}, ${info.municipality}, ${info.province} (${info.zip_code})</td></tr>
                                                    <tr><td>Mother's Full Name</td><td>${parents ? parents.mother_fullname : ''}</td></tr>
                                                    <tr><td>Mother's Maiden Name</td><td>${parents ? parents.mother_maidenname : ''}</td></tr>
                                                    <tr><td>Mother's Date of Birth</td><td>${parents ? parents.mother_dob : ''}</td></tr>
                                                    <tr><td>Father's Full Name</td><td>${parents ? parents.father_fullname : ''}</td></tr>
                                                    <tr><td>Father's Date of Birth</td><td>${parents ? parents.father_dob : ''}</td></tr>
                                                    ${spouse ? `
                                                        <tr><td>Spouse Full Name</td><td>${spouse.spouse_fullname}</td></tr>
                                                        <tr><td>Spouse DOB</td><td>${spouse.spouse_dob}</td></tr>
                                                        <tr><td>Spouse Address</td><td>${spouse.spouse_address}</td></tr>
                                                    ` : ''}
                                                    <tr><td>Employment Status</td><td>${info.employment_status}</td></tr>
                                                    <tr><td>Occupation</td><td>${info.occupation}</td></tr>
                                                    <tr><td>Employer Name</td><td>${info.employer_name}</td></tr>
                                                    <tr><td>Employer Address</td><td>${info.employer_address}</td></tr>
                                                    <tr><td>Employer Contact</td><td>${info.employer_contact}</td></tr>
                                                </table>

                                                <h4 style="margin-top:1.5rem;">Beneficiaries</h4>
                                                ${benList.length === 0 ? '<p>No beneficiaries listed.</p>': `
                                                    <table>
                                                        <tr><th>Full Name</th><th>Relationship</th><th>DOB</th><th>Address</th><th>Contact</th></tr>
                                                        ${benList.map(b => `<tr><td>${b.fullname}</td><td>${b.relationship}</td><td>${b.dob}</td><td>${b.address}</td><td>${b.contact}</td></tr>`).join('')}
                                                    </table>
                                                `}
                                            </div>

                                            <div class="card">
                                                <h3>Uploaded Documents & Photos</h3>
                                                <ul>
                                                    ${docs.map(d => `<li><strong>${d.doc_type}:</strong> <a href="/uploads/${d.file_path}" target="_blank">${d.original_name}</a></li>`).join('')}
                                                </ul>
                                            </div>

                                            <div class="card">
                                                <h3>Payment Information</h3>
                                                <p><strong>Method:</strong> ${payment ? payment.payment_method : 'N/A'}</p>
                                                <p><strong>Status:</strong> ${payment ? payment.status : 'N/A'}</p>
                                                <p><strong>Reference No:</strong> ${payment ? payment.reference_no : 'N/A'}</p>
                                                <p><strong>Amount Paid:</strong> ₱${payment ? payment.amount : '0.00'}</p>
                                                ${payment && payment.proof_path ? `<p>Proof: <a href="/uploads/${payment.proof_path}" target="_blank">View Proof of Payment</a></p>` : ''}
                                                
                                                <form action="/admin/update-payment/${appId}" method="POST" style="margin-top:1rem; display:flex; gap:10px;">
                                                    <select name="payment_status">
                                                        <option value="Unpaid">Unpaid</option>
                                                        <option value="Pending">Pending</option>
                                                        <option value="Paid">Paid</option>
                                                        <option value="Verified">Verified</option>
                                                        <option value="Rejected">Rejected</option>
                                                    </select>
                                                    <button type="submit" class="btn">Update Payment Status</button>
                                                </form>
                                            </div>

                                            <div class="card">
                                                <h3>Update Application Status & Upload Completed Files</h3>
                                                <form action="/admin/update-status/${appId}" method="POST" enctype="multipart/form-data">
                                                    <div class="form-group">
                                                        <label>Application Status</label>
                                                        <select name="application_status">
                                                            <option value="Submitted" ${app.application_status === 'Submitted' ? 'selected' : ''}>Submitted</option>
                                                            <option value="Under Review" ${app.application_status === 'Under Review' ? 'selected' : ''}>Under Review</option>
                                                            <option value="Need Correction" ${app.application_status === 'Need Correction' ? 'selected' : ''}>Need Correction</option>
                                                            <option value="Processing" ${app.application_status === 'Processing' ? 'selected' : ''}>Processing</option>
                                                            <option value="Ready" ${app.application_status === 'Ready' ? 'selected' : ''}>Ready</option>
                                                            <option value="Completed" ${app.application_status === 'Completed' ? 'selected' : ''}>Completed</option>
                                                            <option value="Rejected" ${app.application_status === 'Rejected' ? 'selected' : ''}>Rejected</option>
                                                        </select>
                                                    </div>
                                                    <div class="form-group">
                                                        <label>Customer-visible Remarks / Instructions</label>
                                                        <textarea name="admin_remarks">${app.admin_remarks || ''}</textarea>
                                                    </div>
                                                    <div class="form-group">
                                                        <label>Upload Completed Government Files / Documents</label>
                                                        <input type="file" name="completed_file" multiple>
                                                    </div>
                                                    <button type="submit" class="btn btn-success">Save Changes & Notify Customer</button>
                                                </form>
                                            </div>
                                        </div>
                                    `;
                                    res.send(renderLayout('Applicant Details', html, 'admin'));
                                });
                            });
                        });
                    });
                });
            });
        });
    });
});

app.post('/admin/update-payment/:id', requireAdmin, (req, res) => {
    const appId = req.params.id;
    const { payment_status } = req.body;
    db.run(`UPDATE payments SET status = ? WHERE application_id = ?`, [payment_status, appId]);
    db.run(`UPDATE applications SET payment_status = ? WHERE id = ?`, [payment_status, appId], () => {
        res.redirect(`/admin/applicant/${appId}`);
    });
});

const uploadCompleted = upload.array('completed_file');
app.post('/admin/update-status/:id', requireAdmin, uploadCompleted, (req, res) => {
    const appId = req.params.id;
    const { application_status, admin_remarks } = req.body;

    if(req.files && req.files.length > 0) {
        req.files.forEach(file => {
            db.run(`INSERT INTO documents (application_id, doc_type, file_path, original_name) VALUES (?,?,?,?)`,
                [appId, 'completed_file', file.filename, file.originalname]);
        });
    }

    db.run(`UPDATE applications SET application_status = ?, admin_remarks = ? WHERE id = ?`, [application_status, admin_remarks, appId], function(err) {
        logStatusHistory(appId, application_status, admin_remarks, 'Admin');
        
        db.get(`SELECT user_id FROM applications WHERE id = ?`, [appId], (err, row) => {
            if(row) {
                addNotification(row.user_id, `Application Status Update: ${application_status}`, admin_remarks || 'Your application status has been updated.');
            }
        });

        res.redirect(`/admin/applicant/${appId}`);
    });
});

// ----------------------------------------------------
// ADMIN SETTINGS
// ----------------------------------------------------
app.get('/admin/settings', requireAdmin, (req, res) => {
    db.get(`SELECT * FROM system_settings WHERE id = 1`, (err, settings) => {
        let html = `
            <div class="card" style="max-width:800px; margin:auto;">
                <h2>Admin System Settings</h2>
                <form action="/admin/settings" method="POST" enctype="multipart/form-data">
                    <h3>Business Information</h3>
                    <div class="form-group"><label>Business / Service Name</label><input type="text" name="business_name" value="${settings.business_name || ''}"></div>
                    <div class="form-group"><label>Contact Number</label><input type="text" name="contact_number" value="${settings.contact_number || ''}"></div>
                    <div class="form-group"><label>Email</label><input type="email" name="email" value="${settings.email || ''}"></div>
                    <div class="form-group"><label>Address</label><input type="text" name="address" value="${settings.address || ''}"></div>

                    <h3 style="margin-top:1.5rem;">Payment Configuration</h3>
                    <div class="form-group"><label>GCash Name</label><input type="text" name="gcash_name" value="${settings.gcash_name || ''}"></div>
                    <div class="form-group"><label>GCash Number</label><input type="text" name="gcash_number" value="${settings.gcash_number || ''}"></div>
                    <div class="form-group">
                        <label>GCash QR Code Image</label>
                        ${settings.gcash_qr ? `<img src="/uploads/${settings.gcash_qr}" style="max-width:150px; display:block; margin-bottom:10px;">` : ''}
                        <input type="file" name="gcash_qr" accept="image/*">
                    </div>
                    <div class="grid">
                        <div class="form-group"><label>BIR / TIN Fee (₱)</label><input type="number" step="0.01" name="bir_fee" value="${settings.bir_fee}"></div>
                        <div class="form-group"><label>SSS Fee (₱)</label><input type="number" step="0.01" name="sss_fee" value="${settings.sss_fee}"></div>
                        <div class="form-group"><label>Pag-IBIG Fee (₱)</label><input type="number" step="0.01" name="pagibig_fee" value="${settings.pagibig_fee}"></div>
                    </div>

                    <button type="submit" class="btn btn-success" style="margin-top:1rem;">Save Settings</button>
                </form>
            </div>
        `;
        res.send(renderLayout('Admin Settings', html, 'admin'));
    });
});

const uploadSettingsQR = upload.single('gcash_qr');
app.post('/admin/settings', requireAdmin, uploadSettingsQR, (req, res) => {
    const data = req.body;
    let qrFile = req.file ? req.file.filename : null;

    if(qrFile) {
        db.run(`UPDATE system_settings SET business_name=?, contact_number=?, email=?, address=?, gcash_name=?, gcash_number=?, gcash_qr=?, bir_fee=?, sss_fee=?, pagibig_fee=? WHERE id=1`,
            [data.business_name, data.contact_number, data.email, data.address, data.gcash_name, data.gcash_number, qrFile, data.bir_fee, data.sss_fee, data.pagibig_fee], () => {
                res.redirect('/admin/settings');
            });
    } else {
        db.run(`UPDATE system_settings SET business_name=?, contact_number=?, email=?, address=?, gcash_name=?, gcash_number=?, bir_fee=?, sss_fee=?, pagibig_fee=? WHERE id=1`,
            [data.business_name, data.contact_number, data.email, data.address, data.gcash_name, data.gcash_number, data.bir_fee, data.sss_fee, data.pagibig_fee], () => {
                res.redirect('/admin/settings');
            });
    }
});

// Start Server
app.listen(PORT, () => {
    console.log(`GovAssist PH application running on port ${PORT}`);
});
