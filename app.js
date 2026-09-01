/**
 * COMPLETE BIR/TIN, SSS & PAG-IBIG APPLICATION ASSISTANCE SYSTEM
 * Single-file Node.js (Express, SQLite3, Multer, Express-Session, Bcrypt)
 * Production-ready for Render deployment.
 */

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer storage configuration
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
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|pdf/;
        const extName = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimeType = allowedTypes.test(file.mimetype);
        if (extName && mimeType) {
            return cb(null, true);
        } else {
            cb(new Error('Only images (jpg, jpeg, png) and PDF documents are allowed!'));
        }
    }
});

// Middleware setup
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));
app.use('/uploads', express.static(uploadDir));

app.use(session({
    secret: process.env.SESSION_SECRET || 'gov-assistance-super-secret-key-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// Database Setup
const dbFile = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbFile, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to SQLite database.');
        initDatabase();
    }
});

function initDatabase() {
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fullname TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            mobile TEXT NOT NULL,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            status TEXT DEFAULT 'Active',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS admin_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            fullname TEXT NOT NULL,
            role TEXT DEFAULT 'SuperAdmin',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, () => {
            // Seed default admin if none exists
            db.get(`SELECT COUNT(*) as count FROM admin_users`, (err, row) => {
                if (row && row.count === 0) {
                    const hashedAdminPass = bcrypt.hashSync('admin123', 10);
                    db.run(`INSERT INTO admin_users (username, password, fullname, role) VALUES (?, ?, ?, ?)`,
                        ['admin', hashedAdminPass, 'System Administrator', 'SuperAdmin']);
                }
            });
        });

        db.run(`CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )`, () => {
            const defaults = [
                ['business_name', 'GovAssist PH - Application Assistance'],
                ['contact_number', '+63 912 345 6789'],
                ['email', 'support@govassist.ph'],
                ['address', 'Metro Manila, Philippines'],
                ['tin_fee', '500'],
                ['sss_fee', '500'],
                ['pagibig_fee', '500'],
                ['gcash_number', '09171234567'],
                ['gcash_name', 'GovAssist Processing Services'],
                ['gcash_qr', ''],
                ['payment_instructions', 'Send payment via GCash, enter reference number, and upload proof of payment.'],
                ['app_instructions', '1. Select service\n2. Fill out complete details\n3. Upload valid IDs & documents\n4. Pay service fee & submit.'],
                ['system_status', 'Active']
            ];
            defaults.forEach(([k, v]) => {
                db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`, [k, v]);
            });
        });

        db.run(`CREATE TABLE IF NOT EXISTS applications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            tracking_number TEXT UNIQUE NOT NULL,
            service TEXT NOT NULL,
            payment_status TEXT DEFAULT 'Unpaid',
            application_status TEXT DEFAULT 'Submitted',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
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
            nationality TEXT,
            citizenship TEXT,
            mobile TEXT,
            email TEXT,
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
            business_name TEXT,
            business_address TEXT,
            source_of_income TEXT,
            FOREIGN KEY(application_id) REFERENCES applications(id)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS parent_information (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            application_id INTEGER,
            mother_first TEXT,
            mother_middle TEXT,
            mother_maiden_last TEXT,
            mother_dob TEXT,
            father_first TEXT,
            father_middle TEXT,
            father_last TEXT,
            father_dob TEXT,
            FOREIGN KEY(application_id) REFERENCES applications(id)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS spouse_information (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            application_id INTEGER,
            spouse_first TEXT,
            spouse_middle TEXT,
            spouse_last TEXT,
            spouse_dob TEXT,
            spouse_address TEXT,
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
            contact TEXT,
            FOREIGN KEY(application_id) REFERENCES applications(id)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            application_id INTEGER,
            doc_type TEXT,
            file_path TEXT,
            file_name TEXT,
            uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(application_id) REFERENCES applications(id)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS completed_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            application_id INTEGER,
            title TEXT,
            file_path TEXT,
            file_name TEXT,
            uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(application_id) REFERENCES applications(id)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            application_id INTEGER,
            payment_method TEXT,
            amount REAL,
            reference_number TEXT,
            proof_path TEXT,
            payment_status TEXT DEFAULT 'Unpaid',
            rejection_reason TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(application_id) REFERENCES applications(id)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS status_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            application_id INTEGER,
            status TEXT,
            remarks TEXT,
            changed_by TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
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
    }
}

// Authentication Middlewares
function requireCustomer(req, res, next) {
    if (req.session && req.session.user) {
        return next();
    }
    res.redirect('/customer/login');
}

function requireAdmin(req, res, next) {
    if (req.session && req.session.admin) {
        return next();
    }
    res.redirect('/admin/login');
}

// Helper function to create notification
function createNotification(userId, title, message) {
    db.run(`INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)`, [userId, title, message]);
}

// Helper function to record status history
function recordStatusHistory(appId, status, remarks, changedBy) {
    db.run(`INSERT INTO status_history (application_id, status, remarks, changed_by) VALUES (?, ?, ?, ?)`, 
        [appId, status, remarks, changedBy]);
    db.run(`UPDATE applications SET application_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, 
        [status, appId]);
}

// ==================== PUBLIC & LANDING ROUTES ====================

app.get('/', (req, res) => {
    db.all(`SELECT * FROM settings`, [], (err, rows) => {
        const settings = {};
        if (rows) rows.forEach(r => settings[r.key] = r.value);

        res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${settings.business_name || 'GovAssist PH'}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body class="bg-slate-50 text-slate-800 font-sans">
    <!-- Navbar -->
    <nav class="bg-blue-900 text-white shadow-md sticky top-0 z-50">
        <div class="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
            <div class="flex items-center space-x-2">
                <i class="fa-solid fa-file-shield text-2xl text-blue-400"></i>
                <span class="font-bold text-xl tracking-wide">GovAssist PH</span>
            </div>
            <div class="space-x-4">
                <a href="/track" class="hover:text-blue-300 font-medium"><i class="fa-solid fa-magnifying-glass mr-1"></i> Track App</a>
                <a href="/customer/login" class="hover:text-blue-300 font-medium"><i class="fa-solid fa-right-to-bracket mr-1"></i> Login</a>
                <a href="/customer/register" class="bg-blue-600 px-4 py-2 rounded-lg font-medium hover:bg-blue-500 transition">Get Started</a>
            </div>
        </div>
    </nav>

    <!-- Hero Section -->
    <header class="bg-gradient-to-r from-blue-900 to-indigo-900 text-white py-20 px-4 text-center">
        <div class="max-w-4xl mx-auto">
            <h1 class="text-4xl md:text-5xl font-extrabold mb-6 leading-tight">Fast, Secure Assistance for BIR/TIN, SSS & Pag-IBIG Applications</h1>
            <p class="text-lg md:text-xl text-blue-200 mb-8">Skip the hassle. Let our professional team assist you in preparing, filing, and tracking your government documentation accurately.</p>
            <div class="flex justify-center space-x-4">
                <a href="/customer/register" class="bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold px-8 py-3 rounded-xl shadow-lg transition">Apply Now</a>
                <a href="/track" class="bg-white/10 hover:bg-white/20 border border-white/30 text-white font-bold px-8 py-3 rounded-xl transition">Track Application</a>
            </div>
        </div>
    </header>

    <!-- Services Overview -->
    <section class="py-16 max-w-7xl mx-auto px-4">
        <h2 class="text-3xl font-bold text-center mb-4 text-slate-900">Supported Government Services</h2>
        <p class="text-center text-slate-600 mb-12 max-w-2xl mx-auto">Select the service you need assistance with. Our guided forms ensure all requirements are correctly filled and verified.</p>
        
        <div class="grid md:grid-cols-3 gap-8">
            <div class="bg-white rounded-2xl shadow-md p-8 border border-slate-100 hover:shadow-xl transition flex flex-col justify-between">
                <div>
                    <div class="w-14 h-14 bg-blue-100 text-blue-700 rounded-xl flex items-center justify-center text-2xl mb-6">
                        <i class="fa-solid fa-id-card"></i>
                    </div>
                    <h3 class="text-xl font-bold text-slate-900 mb-3">BIR / TIN Application</h3>
                    <p class="text-slate-600 mb-6">Get assistance in securing your Tax Identification Number (TIN) and registering with the Bureau of Internal Revenue.</p>
                </div>
                <a href="/customer/login" class="text-blue-600 font-semibold hover:text-blue-800 flex items-center">Apply for TIN <i class="fa-solid fa-arrow-right ml-2"></i></a>
            </div>

            <div class="bg-white rounded-2xl shadow-md p-8 border border-slate-100 hover:shadow-xl transition flex flex-col justify-between">
                <div>
                    <div class="w-14 h-14 bg-indigo-100 text-indigo-700 rounded-xl flex items-center justify-center text-2xl mb-6">
                        <i class="fa-solid fa-shield-halved"></i>
                    </div>
                    <h3 class="text-xl font-bold text-slate-900 mb-3">SSS Application</h3>
                    <p class="text-slate-600 mb-6">Social Security System membership assistance, including complete beneficiary profiling and document verification.</p>
                </div>
                <a href="/customer/login" class="text-indigo-600 font-semibold hover:text-indigo-800 flex items-center">Apply for SSS <i class="fa-solid fa-arrow-right ml-2"></i></a>
            </div>

            <div class="bg-white rounded-2xl shadow-md p-8 border border-slate-100 hover:shadow-xl transition flex flex-col justify-between">
                <div>
                    <div class="w-14 h-14 bg-emerald-100 text-emerald-700 rounded-xl flex items-center justify-center text-2xl mb-6">
                        <i class="fa-solid fa-house-chimney"></i>
                    </div>
                    <h3 class="text-xl font-bold text-slate-900 mb-3">Pag-IBIG Application</h3>
                    <p class="text-slate-600 mb-6">Home Development Mutual Fund (Pag-IBIG) membership registration, tracking, and compliance assistance.</p>
                </div>
                <a href="/customer/login" class="text-emerald-600 font-semibold hover:text-emerald-800 flex items-center">Apply for Pag-IBIG <i class="fa-solid fa-arrow-right ml-2"></i></a>
            </div>
        </div>
    </section>

    <!-- Disclaimer Footer -->
    <footer class="bg-slate-900 text-slate-400 py-12 px-4 border-t border-slate-800">
        <div class="max-w-7xl mx-auto grid md:grid-cols-2 gap-8 mb-8">
            <div>
                <div class="flex items-center space-x-2 text-white mb-4">
                    <i class="fa-solid fa-file-shield text-xl text-blue-400"></i>
                    <span class="font-bold text-lg">GovAssist PH</span>
                </div>
                <p class="text-sm leading-relaxed">Providing professional application assistance, document preparation, and tracking services.</p>
            </div>
            <div>
                <h4 class="text-white font-semibold mb-3">Government Disclaimer</h4>
                <p class="text-xs leading-relaxed bg-slate-800 p-4 rounded-xl border border-slate-700">
                    This is an independent application assistance and document processing/tracking service. It is not an official website of the BIR, SSS, or Pag-IBIG unless officially authorized or integrated.
                </p>
            </div>
        </div>
        <div class="max-w-7xl mx-auto pt-6 border-t border-slate-800 text-center text-xs">
            &copy; 2026 GovAssist PH. All rights reserved. | <a href="/admin/login" class="hover:text-white">Admin Portal</a>
        </div>
    </footer>
</body>
</html>`);
    });
});

// ==================== PUBLIC TRACKING PAGE ====================
app.get('/track', (req, res) => {
    const trackingNo = req.query.tracking || '';
    let htmlResult = '';

    if (trackingNo) {
        db.get(`SELECT a.*, ai.first_name, ai.last_name FROM applications a 
                LEFT JOIN applicant_information ai ON a.id = ai.application_id 
                WHERE a.tracking_number = ?`, [trackingNo], (err, app) => {
            if (!app) {
                renderTrackPage(res, trackingNo, `<div class="bg-red-50 text-red-700 p-4 rounded-xl border border-red-200">Application with tracking number <strong>${trackingNo}</strong> not found.</div>`, null, []);
            } else {
                db.all(`SELECT * FROM status_history WHERE application_id = ? ORDER BY created_at ASC`, [app.id], (err, history) => {
                    const maskedName = `${app.first_name ? app.first_name[0] : ''}*** ${app.last_name || ''}`;
                    renderTrackPage(res, trackingNo, null, app, history, maskedName);
                });
            }
        });
    } else {
        renderTrackPage(res, '', null, null, []);
    }
});

function renderTrackPage(res, searchVal, alertHtml, appData, historyList, maskedName = '') {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Track Application - GovAssist PH</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body class="bg-slate-50 text-slate-800 font-sans min-h-screen flex flex-col justify-between">
    <nav class="bg-blue-900 text-white shadow-md">
        <div class="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
            <a href="/" class="flex items-center space-x-2 font-bold text-xl"><i class="fa-solid fa-file-shield text-blue-400"></i><span>GovAssist PH</span></a>
            <a href="/customer/login" class="text-sm hover:text-blue-300">Customer Login</a>
        </div>
    </nav>

    <div class="max-w-3xl mx-auto px-4 py-12 flex-grow w-full">
        <h1 class="text-3xl font-extrabold text-slate-900 mb-2 text-center">Track Your Application</h1>
        <p class="text-slate-600 text-center mb-8">Enter your unique tracking number to view real-time status and progress.</p>
        
        <form action="/track" method="GET" class="flex gap-3 mb-8">
            <input type="text" name="tracking" value="${searchVal}" placeholder="e.g. TIN-20260901-0001" required class="flex-grow px-4 py-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-600 text-lg">
            <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white font-bold px-8 py-3 rounded-xl transition flex items-center"><i class="fa-solid fa-magnifying-glass mr-2"></i> Track</button>
        </form>

        ${alertHtml || ''}

        ${appData ? `
            <div class="bg-white rounded-2xl shadow-md p-8 border border-slate-200">
                <div class="flex justify-between items-start border-b border-slate-100 pb-6 mb-6">
                    <div>
                        <span class="text-xs font-bold uppercase tracking-wider px-3 py-1 bg-blue-100 text-blue-800 rounded-full">${appData.service}</span>
                        <h2 class="text-2xl font-bold text-slate-900 mt-2">${appData.tracking_number}</h2>
                        <p class="text-sm text-slate-500 mt-1">Applicant: ${maskedName}</p>
                    </div>
                    <div class="text-right">
                        <span class="inline-block px-3 py-1 text-sm font-semibold rounded-full ${appData.application_status === 'Completed' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">${appData.application_status}</span>
                        <p class="text-xs text-slate-400 mt-1">Submitted: ${appData.created_at}</p>
                    </div>
                </div>

                <h3 class="font-bold text-lg text-slate-800 mb-4">Application Progress Timeline</h3>
                <div class="space-y-6 relative before:absolute before:inset-0 before:left-3.5 before:w-0.5 before:bg-slate-200">
                    ${historyList.map((h, i) => `
                        <div class="flex items-start space-x-4 relative">
                            <div class="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold z-10">${i+1}</div>
                            <div class="flex-grow bg-slate-50 p-4 rounded-xl border border-slate-100">
                                <div class="flex justify-between items-center mb-1">
                                    <span class="font-bold text-slate-900">${h.status}</span>
                                    <span class="text-xs text-slate-400">${h.created_at}</span>
                                </div>
                                ${h.remarks ? `<p class="text-sm text-slate-600 mt-1">Remarks: ${h.remarks}</p>` : ''}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        ` : ''}
    </div>

    <footer class="bg-slate-900 text-slate-400 py-6 text-center text-xs">
        &copy; 2026 GovAssist PH. Independent Assistance Service.
    </footer>
</body>
</html>`);
}

// ==================== CUSTOMER AUTH ROUTES ====================

app.get('/customer/register', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Customer Register - GovAssist PH</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body class="bg-slate-50 text-slate-800 font-sans flex items-center justify-center min-h-screen py-12 px-4">
    <div class="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 border border-slate-100">
        <div class="text-center mb-8">
            <a href="/" class="inline-flex items-center space-x-2 text-blue-900 font-bold text-2xl mb-2">
                <i class="fa-solid fa-file-shield text-blue-600"></i><span>GovAssist PH</span>
            </a>
            <h2 class="text-xl font-bold text-slate-800">Create Customer Account</h2>
            <p class="text-sm text-slate-500">Register to start and track your applications</p>
        </div>

        ${req.query.error ? `<div class="bg-red-50 text-red-700 p-3 rounded-xl mb-6 text-sm">${req.query.error}</div>` : ''}

        <form action="/customer/register" method="POST" class="space-y-4">
            <div>
                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Full Name</label>
                <input type="text" name="fullname" required class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-600">
            </div>
            <div>
                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Email Address</label>
                <input type="email" name="email" required class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-600">
            </div>
            <div>
                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Mobile Number</label>
                <input type="text" name="mobile" placeholder="09XXXXXXXXX" required class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-600">
            </div>
            <div>
                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Username</label>
                <input type="text" name="username" required class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-600">
            </div>
            <div>
                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Password</label>
                <input type="password" name="password" required class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-600">
            </div>
            <div>
                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Confirm Password</label>
                <input type="password" name="confirm_password" required class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-600">
            </div>
            <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition shadow-md">Register Account</button>
        </form>

        <p class="text-center text-sm text-slate-600 mt-6">Already have an account? <a href="/customer/login" class="text-blue-600 font-semibold hover:underline">Login here</a></p>
    </div>
</body>
</html>`);
});

app.post('/customer/register', (req, res) => {
    const { fullname, email, mobile, username, password, confirm_password } = req.body;
    if (password !== confirm_password) {
        return res.redirect('/customer/register?error=Passwords do not match');
    }
    const hashedPassword = bcrypt.hashSync(password, 10);
    db.run(`INSERT INTO users (fullname, email, mobile, username, password) VALUES (?, ?, ?, ?, ?)`,
        [fullname, email, mobile, username, hashedPassword], function(err) {
            if (err) {
                return res.redirect('/customer/register?error=Username or Email already exists');
            }
            res.redirect('/customer/login?success=Account created successfully. Please login.');
        });
});

app.get('/customer/login', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Customer Login - GovAssist PH</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body class="bg-slate-50 text-slate-800 font-sans flex items-center justify-center min-h-screen py-12 px-4">
    <div class="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 border border-slate-100">
        <div class="text-center mb-8">
            <a href="/" class="inline-flex items-center space-x-2 text-blue-900 font-bold text-2xl mb-2">
                <i class="fa-solid fa-file-shield text-blue-600"></i><span>GovAssist PH</span>
            </a>
            <h2 class="text-xl font-bold text-slate-800">Customer Portal Login</h2>
            <p class="text-sm text-slate-500">Access your applications and documents</p>
        </div>

        ${req.query.error ? `<div class="bg-red-50 text-red-700 p-3 rounded-xl mb-6 text-sm">${req.query.error}</div>` : ''}
        ${req.query.success ? `<div class="bg-emerald-50 text-emerald-700 p-3 rounded-xl mb-6 text-sm">${req.query.success}</div>` : ''}

        <form action="/customer/login" method="POST" class="space-y-4">
            <div>
                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Username</label>
                <input type="text" name="username" required class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-600">
            </div>
            <div>
                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Password</label>
                <input type="password" name="password" required class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-600">
            </div>
            <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition shadow-md">Login</button>
        </form>

        <p class="text-center text-sm text-slate-600 mt-6">Don't have an account? <a href="/customer/register" class="text-blue-600 font-semibold hover:underline">Register here</a></p>
    </div>
</body>
</html>`);
});

app.post('/customer/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, user) => {
        if (!user || !bcrypt.compareSync(password, user.password)) {
            return res.redirect('/customer/login?error=Invalid username or password');
        }
        req.session.user = user;
        res.redirect('/customer/dashboard');
    });
});

app.get('/customer/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/customer/login');
    });
});

// ==================== ADMIN AUTH ROUTES ====================

app.get('/admin/login', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin Login - GovAssist PH</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body class="bg-slate-900 text-slate-100 font-sans flex items-center justify-center min-h-screen py-12 px-4">
    <div class="max-w-md w-full bg-slate-800 rounded-2xl shadow-2xl p-8 border border-slate-700">
        <div class="text-center mb-8">
            <div class="w-14 h-14 bg-blue-600/20 text-blue-400 rounded-2xl flex items-center justify-center text-2xl mx-auto mb-3">
                <i class="fa-solid fa-lock"></i>
            </div>
            <h2 class="text-xl font-bold text-white">Admin Portal Login</h2>
            <p class="text-sm text-slate-400">Authorized personnel only</p>
        </div>

        ${req.query.error ? `<div class="bg-red-900/50 text-red-200 p-3 rounded-xl mb-6 text-sm border border-red-700">${req.query.error}</div>` : ''}

        <form action="/admin/login" method="POST" class="space-y-4">
            <div>
                <label class="block text-xs font-bold uppercase text-slate-400 mb-1">Username</label>
                <input type="text" name="username" required class="w-full px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            </div>
            <div>
                <label class="block text-xs font-bold uppercase text-slate-400 mb-1">Password</label>
                <input type="password" name="password" required class="w-full px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            </div>
            <button type="submit" class="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl transition shadow-lg">Admin Login</button>
        </form>
    </div>
</body>
</html>`);
});

app.post('/admin/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM admin_users WHERE username = ?`, [username], (err, admin) => {
        if (!admin || !bcrypt.compareSync(password, admin.password)) {
            return res.redirect('/admin/login?error=Invalid admin credentials');
        }
        req.session.admin = admin;
        res.redirect('/admin/dashboard');
    });
});

app.get('/admin/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/admin/login');
    });
});

// ==================== CUSTOMER PORTAL ====================

app.get('/customer/dashboard', requireCustomer, (req, res) => {
    const userId = req.session.user.id;
    db.all(`SELECT * FROM applications WHERE user_id = ? ORDER BY created_at DESC`, [userId], (err, apps) => {
        db.all(`SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`, [userId], (err, notifs) => {
            db.get(`SELECT * FROM users WHERE id = ?`, [userId], (err, user) => {
                renderCustomerDashboard(res, user, apps || [], notifs || [], 'dashboard');
            });
        });
    });
});

app.get('/customer/apply', requireCustomer, (req, res) => {
    const service = req.query.service || 'TIN';
    db.get(`SELECT * FROM settings`, [], (err, settingsRow) => {
        // Fetch all settings
        db.all(`SELECT * FROM settings`, [], (err, rows) => {
            const settings = {};
            if (rows) rows.forEach(r => settings[r.key] = r.value);
            db.get(`SELECT * FROM users WHERE id = ?`, [req.session.user.id], (err, user) => {
                renderApplicationForm(res, user, service, settings);
            });
        });
    });
});

// Handle Application Submission
app.post('/customer/apply', requireCustomer, upload.fields([
    { name: 'valid_id_file', maxCount: 1 },
    { name: 'photo_holding_id', maxCount: 1 },
    { name: 'id_picture', maxCount: 1 },
    { name: 'marriage_cert', maxCount: 1 },
    { name: 'proof_file', maxCount: 1 },
    { name: 'other_docs', maxCount: 5 }
]), (req, res) => {
    const userId = req.session.user.id;
    const { 
        service, first_name, middle_name, last_name, suffix, dob, pob, sex, civil_status, nationality, citizenship,
        mobile, email, house_no, street, barangay, municipality, province, zip_code,
        employment_status, occupation, employer_name, employer_address, business_name, business_address, source_of_income,
        mother_first, mother_middle, mother_maiden_last, mother_dob,
        father_first, father_middle, father_last, father_dob,
        spouse_first, spouse_middle, spouse_last, spouse_dob, spouse_address,
        id_type, id_number, payment_method, reference_number,
        beneficiary_fullname, beneficiary_relationship, beneficiary_dob, beneficiary_sex, beneficiary_address, beneficiary_contact
    } = req.body;

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    const trackingNumber = `${service}-${dateStr}-${randomNum}`;

    db.run(`INSERT INTO applications (user_id, tracking_number, service, payment_status, application_status) VALUES (?, ?, ?, ?, ?)`,
        [userId, trackingNumber, service, payment_method === 'GCash' ? 'Pending Verification' : 'Unpaid', 'Submitted'], function(err) {
            if (err) {
                return res.redirect('/customer/dashboard?error=Error creating application');
            }
            const appId = this.lastID;

            // Save Applicant Info
            db.run(`INSERT INTO applicant_information (application_id, first_name, middle_name, last_name, suffix, dob, pob, sex, civil_status, nationality, citizenship, mobile, email, house_no, street, barangay, municipality, province, zip_code, employment_status, occupation, employer_name, employer_address, business_name, business_address, source_of_income) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [appId, first_name, middle_name, last_name, suffix, dob, pob, sex, civil_status, nationality, citizenship, mobile, email, house_no, street, barangay, municipality, province, zip_code, employment_status, occupation, employer_name, employer_address, business_name, business_address, source_of_income]);

            // Save Parents
            db.run(`INSERT INTO parent_information (application_id, mother_first, mother_middle, mother_maiden_last, mother_dob, father_first, father_middle, father_last, father_dob) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [appId, mother_first, mother_middle, mother_maiden_last, mother_dob, father_first, father_middle, father_last, father_dob]);

            // Save Spouse if married
            if (civil_status === 'Married') {
                const marriageCertPath = req.files && req.files['marriage_cert'] ? req.files['marriage_cert'][0].filename : '';
                db.run(`INSERT INTO spouse_information (application_id, spouse_first, spouse_middle, spouse_last, spouse_dob, spouse_address, marriage_cert) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [appId, spouse_first, spouse_middle, spouse_last, spouse_dob, spouse_address, marriageCertPath]);
            }

            // Save Beneficiaries (supports multiple)
            if (beneficiary_fullname) {
                const names = Array.isArray(beneficiary_fullname) ? beneficiary_fullname : [beneficiary_fullname];
                const rels = Array.isArray(beneficiary_relationship) ? beneficiary_relationship : [beneficiary_relationship];
                const dobs = Array.isArray(beneficiary_dob) ? beneficiary_dob : [beneficiary_dob];
                const sexes = Array.isArray(beneficiary_sex) ? beneficiary_sex : [beneficiary_sex];
                const addrs = Array.isArray(beneficiary_address) ? beneficiary_address : [beneficiary_address];
                const conts = Array.isArray(beneficiary_contact) ? beneficiary_contact : [beneficiary_contact];

                for (let i = 0; i < names.length; i++) {
                    if (names[i]) {
                        db.run(`INSERT INTO beneficiaries (application_id, fullname, relationship, dob, sex, address, contact) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                            [appId, names[i], rels[i], dobs[i], sexes[i], addrs[i], conts[i]]);
                    }
                }
            }

            // Save Documents
            if (req.files) {
                if (req.files['valid_id_file']) {
                    db.run(`INSERT INTO documents (application_id, doc_type, file_path, file_name) VALUES (?, ?, ?, ?)`,
                        [appId, 'Valid ID (' + id_type + ')', req.files['valid_id_file'][0].filename, req.files['valid_id_file'][0].originalname]);
                }
                if (req.files['photo_holding_id']) {
                    db.run(`INSERT INTO documents (application_id, doc_type, file_path, file_name) VALUES (?, ?, ?, ?)`,
                        [appId, 'Photo Holding Valid ID', req.files['photo_holding_id'][0].filename, req.files['photo_holding_id'][0].originalname]);
                }
                if (req.files['id_picture']) {
                    db.run(`INSERT INTO documents (application_id, doc_type, file_path, file_name) VALUES (?, ?, ?, ?)`,
                        [appId, 'ID Picture / Profile', req.files['id_picture'][0].filename, req.files['id_picture'][0].originalname]);
                }
                if (req.files['other_docs']) {
                    req.files['other_docs'].forEach(f => {
                        db.run(`INSERT INTO documents (application_id, doc_type, file_path, file_name) VALUES (?, ?, ?, ?)`,
                            [appId, 'Other Document', f.filename, f.originalname]);
                    });
                }
            }

            // Save Payment
            let fee = 500;
            if (service === 'TIN') fee = 500;
            else if (service === 'SSS') fee = 500;
            else if (service === 'Pag-IBIG') fee = 500;

            const proofPath = req.files && req.files['proof_file'] ? req.files['proof_file'][0].filename : '';
            db.run(`INSERT INTO payments (application_id, payment_method, amount, reference_number, proof_path, payment_status) VALUES (?, ?, ?, ?, ?, ?)`,
                [appId, payment_method, fee, reference_number || '', proofPath, payment_method === 'GCash' ? 'Pending Verification' : 'Unpaid']);

            // Status History & Notification
            recordStatusHistory(appId, 'Submitted', 'Application successfully submitted by customer.', 'Customer');
            createNotification(userId, 'Application Submitted', `Your application ${trackingNumber} has been successfully submitted.`);

            res.redirect(`/customer/success?tracking=${trackingNumber}`);
        });
});

app.get('/customer/success', requireCustomer, (req, res) => {
    const tracking = req.query.tracking;
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Application Success - GovAssist PH</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body class="bg-slate-50 text-slate-800 font-sans flex items-center justify-center min-h-screen py-12 px-4">
    <div class="max-w-lg w-full bg-white rounded-2xl shadow-xl p-8 border border-slate-100 text-center">
        <div class="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center text-3xl mx-auto mb-6">
            <i class="fa-solid fa-check"></i>
        </div>
        <h2 class="text-2xl font-extrabold text-slate-900 mb-2">Application Submitted Successfully!</h2>
        <p class="text-slate-600 mb-6">Your application has been received and is now queued for review.</p>
        
        <div class="bg-slate-50 p-4 rounded-xl border border-slate-200 mb-8 text-left">
            <p class="text-xs text-slate-500 uppercase font-bold mb-1">Tracking Number</p>
            <p class="text-xl font-bold text-blue-600">${tracking}</p>
        </div>

        <div class="space-y-3">
            <a href="/track?tracking=${tracking}" class="block w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition shadow-md">Track Application</a>
            <a href="/customer/dashboard" class="block w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3 rounded-xl transition">Go to My Dashboard</a>
        </div>
    </div>
</body>
</html>`);
});

app.get('/customer/documents', requireCustomer, (req, res) => {
    const userId = req.session.user.id;
    db.all(`SELECT cf.*, a.tracking_number, a.service FROM completed_files cf 
            JOIN applications a ON cf.application_id = a.id 
            WHERE a.user_id = ? ORDER BY cf.uploaded_at DESC`, [userId], (err, files) => {
        db.get(`SELECT * FROM users WHERE id = ?`, [userId], (err, user) => {
            renderCustomerCompletedDocs(res, user, files || []);
        });
    });
});

app.get('/customer/profile', requireCustomer, (req, res) => {
    db.get(`SELECT * FROM users WHERE id = ?`, [req.session.user.id], (err, user) => {
        renderCustomerProfile(res, user);
    });
});

app.post('/customer/profile', requireCustomer, (req, res) => {
    const { fullname, mobile, email, password } = req.body;
    const userId = req.session.user.id;
    if (password) {
        const hashed = bcrypt.hashSync(password, 10);
        db.run(`UPDATE users SET fullname = ?, mobile = ?, email = ?, password = ? WHERE id = ?`,
            [fullname, mobile, email, hashed, userId], () => {
                res.redirect('/customer/profile?success=Profile updated successfully');
            });
    } else {
        db.run(`UPDATE users SET fullname = ?, mobile = ?, email = ? WHERE id = ?`,
            [fullname, mobile, email, userId], () => {
                res.redirect('/customer/profile?success=Profile updated successfully');
            });
    }
});

// ==================== ADMIN PORTAL ====================

app.get('/admin/dashboard', requireAdmin, (req, res) => {
    db.get(`SELECT COUNT(*) as count FROM users`, [], (err, u) => {
        db.get(`SELECT COUNT(*) as count FROM applications`, [], (err, a) => {
            db.get(`SELECT COUNT(*) as count FROM applications WHERE service = 'TIN'`, [], (err, tin) => {
                db.get(`SELECT COUNT(*) as count FROM applications WHERE service = 'SSS'`, [], (err, sss) => {
                    db.get(`SELECT COUNT(*) as count FROM applications WHERE service = 'Pag-IBIG'`, [], (err, pag) => {
                        db.get(`SELECT COUNT(*) as count FROM applications WHERE application_status = 'Submitted'`, [], (err, sub) => {
                            db.get(`SELECT COUNT(*) as count FROM applications WHERE application_status = 'Completed'`, [], (err, comp) => {
                                db.all(`SELECT a.*, u.fullname FROM applications a JOIN users u ON a.user_id = u.id ORDER BY a.created_at DESC LIMIT 10`, [], (err, recentApps) => {
                                    renderAdminDashboard(res, {
                                        customers: u.count,
                                        applications: a.count,
                                        tin: tin.count,
                                        sss: sss.count,
                                        pagibig: pag.count,
                                        pending: sub.count,
                                        completed: comp.count
                                    }, recentApps || []);
                                });
                            });
                        });
                    });
                });
            });
        });
    });
});

app.get('/admin/applications', requireAdmin, (req, res) => {
    const { search = '', service = '', status = '' } = req.query;
    let query = `SELECT a.*, u.fullname FROM applications a JOIN users u ON a.user_id = u.id WHERE 1=1`;
    let params = [];

    if (search) {
        query += ` AND (a.tracking_number LIKE ? OR u.fullname LIKE ?)`;
        params.push(`%${search}%`, `%${search}%`);
    }
    if (service) {
        query += ` AND a.service = ?`;
        params.push(service);
    }
    if (status) {
        query += ` AND a.application_status = ?`;
        params.push(status);
    }

    query += ` ORDER BY a.created_at DESC`;

    db.all(query, params, (err, apps) => {
        renderAdminApplications(res, apps || [], { search, service, status });
    });
});

// Admin View Complete Applicant Details
app.get('/admin/applications/:id', requireAdmin, (req, res) => {
    const appId = req.params.id;
    db.get(`SELECT a.*, u.fullname as user_fullname, u.email as user_email, u.mobile as user_mobile FROM applications a JOIN users u ON a.user_id = u.id WHERE a.id = ?`, [appId], (err, app) => {
        if (!app) return res.redirect('/admin/applications');

        db.get(`SELECT * FROM applicant_information WHERE application_id = ?`, [appId], (err, info) => {
            db.get(`SELECT * FROM parent_information WHERE application_id = ?`, [appId], (err, parents) => {
                db.get(`SELECT * FROM spouse_information WHERE application_id = ?`, [appId], (err, spouse) => {
                    db.all(`SELECT * FROM beneficiaries WHERE application_id = ?`, [appId], (err, beneficiaries) => {
                        db.all(`SELECT * FROM documents WHERE application_id = ?`, [appId], (err, documents) => {
                            db.all(`SELECT * FROM completed_files WHERE application_id = ?`, [appId], (err, completedFiles) => {
                                db.get(`SELECT * FROM payments WHERE application_id = ?`, [appId], (err, payment) => {
                                    db.all(`SELECT * FROM status_history WHERE application_id = ? ORDER BY created_at ASC`, [appId], (err, history) => {
                                        renderAdminApplicantDetail(res, app, info, parents, spouse, beneficiaries || [], documents || [], completedFiles || [], payment, history || []);
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

// Admin Update Application Status / Remarks
app.post('/admin/applications/:id/status', requireAdmin, (req, res) => {
    const appId = req.params.id;
    const { status, remarks } = req.body;
    recordStatusHistory(appId, status, remarks, 'Admin');

    db.get(`SELECT user_id, tracking_number FROM applications WHERE id = ?`, [appId], (err, app) => {
        if (app) {
            createNotification(app.user_id, `Application Update: ${status}`, `Your application ${app.tracking_number} status changed to ${status}. Remarks: ${remarks}`);
        }
        res.redirect(`/admin/applications/${appId}`);
    });
});

// Admin Upload Completed Files
app.post('/admin/applications/:id/upload-completed', requireAdmin, upload.array('completed_files', 5), (req, res) => {
    const appId = req.params.id;
    const { title } = req.body;

    if (req.files && req.files.length > 0) {
        req.files.forEach(f => {
            db.run(`INSERT INTO completed_files (application_id, title, file_path, file_name) VALUES (?, ?, ?, ?)`,
                [appId, title || 'Completed Document', f.filename, f.originalname]);
        });
    }

    db.get(`SELECT user_id, tracking_number FROM applications WHERE id = ?`, [appId], (err, app) => {
        if (app) {
            createNotification(app.user_id, 'Completed Document Uploaded', `Admin uploaded completed document(s) for your application ${app.tracking_number}.`);
        }
        res.redirect(`/admin/applications/${appId}`);
    });
});

// Admin Verify Payment
app.post('/admin/applications/:id/verify-payment', requireAdmin, (req, res) => {
    const appId = req.params.id;
    const { payment_status, rejection_reason } = req.body;

    db.run(`UPDATE payments SET payment_status = ?, rejection_reason = ? WHERE application_id = ?`,
        [payment_status, rejection_reason || '', appId], () => {
            db.run(`UPDATE applications SET payment_status = ? WHERE id = ?`, [payment_status, appId]);
            db.get(`SELECT user_id, tracking_number FROM applications WHERE id = ?`, [appId], (err, app) => {
                if (app) {
                    createNotification(app.user_id, `Payment Status: ${payment_status}`, `Your payment for application ${app.tracking_number} is marked as ${payment_status}. ${rejection_reason ? 'Reason: ' + rejection_reason : ''}`);
                }
                res.redirect(`/admin/applications/${appId}`);
            });
        });
});

app.get('/admin/customers', requireAdmin, (req, res) => {
    db.all(`SELECT u.*, (SELECT COUNT(*) FROM applications WHERE user_id = u.id) as app_count FROM users u ORDER BY u.created_at DESC`, [], (err, customers) => {
        renderAdminCustomers(res, customers || []);
    });
});

app.get('/admin/settings', requireAdmin, (req, res) => {
    db.all(`SELECT * FROM settings`, [], (err, rows) => {
        const settings = {};
        if (rows) rows.forEach(r => settings[r.key] = r.value);
        renderAdminSettings(res, settings);
    });
});

app.post('/admin/settings', requireAdmin, upload.single('gcash_qr'), (req, res) => {
    const body = req.body;
    if (req.file) {
        body.gcash_qr = req.file.filename;
    }

    const keys = Object.keys(body);
    let completed = 0;

    if (keys.length === 0) return res.redirect('/admin/settings');

    keys.forEach(key => {
        db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [key, body[key]], () => {
            completed++;
            if (completed === keys.length) {
                res.redirect('/admin/settings?success=Settings updated successfully');
            }
        });
    });
});

app.get('/admin/reports', requireAdmin, (req, res) => {
    db.get(`SELECT COUNT(*) as count FROM applications`, [], (err, total) => {
        db.get(`SELECT COUNT(*) as count FROM applications WHERE application_status = 'Completed'`, [], (err, comp) => {
            db.get(`SELECT COUNT(*) as count FROM payments WHERE payment_status = 'Paid'`, [], (err, paid) => {
                db.all(`SELECT service, COUNT(*) as count FROM applications GROUP BY service`, [], (err, services) => {
                    renderAdminReports(res, total.count, comp.count, paid.count, services || []);
                });
            });
        });
    });
});

// Admin Print Application Page
app.get('/admin/applications/:id/print', requireAdmin, (req, res) => {
    const appId = req.params.id;
    db.get(`SELECT a.*, u.fullname as user_fullname FROM applications a JOIN users u ON a.user_id = u.id WHERE a.id = ?`, [appId], (err, app) => {
        db.get(`SELECT * FROM applicant_information WHERE application_id = ?`, [appId], (err, info) => {
            db.get(`SELECT * FROM parent_information WHERE application_id = ?`, [appId], (err, parents) => {
                db.get(`SELECT * FROM spouse_information WHERE application_id = ?`, [appId], (err, spouse) => {
                    db.all(`SELECT * FROM beneficiaries WHERE application_id = ?`, [appId], (err, beneficiaries) => {
                        db.get(`SELECT * FROM payments WHERE application_id = ?`, [appId], (err, payment) => {
                            renderPrintableApplication(res, app, info, parents, spouse, beneficiaries || [], payment);
                        });
                    });
                });
            });
        });
    });
});

// ==================== RENDER TEMPLATES (HTML GENERATORS) ====================

function renderCustomerDashboard(res, user, apps, notifs, activeTab) {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Customer Dashboard - GovAssist PH</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body class="bg-slate-50 text-slate-800 font-sans flex h-screen overflow-hidden">
    <!-- Sidebar -->
    <aside class="w-64 bg-blue-900 text-white flex flex-col justify-between hidden md:flex shadow-xl">
        <div>
            <div class="p-6 flex items-center space-x-3 border-b border-blue-800">
                <i class="fa-solid fa-file-shield text-2xl text-blue-400"></i>
                <span class="font-bold text-xl">GovAssist PH</span>
            </div>
            <nav class="p-4 space-y-2">
                <a href="/customer/dashboard" class="flex items-center space-x-3 px-4 py-3 rounded-xl bg-blue-800 text-white font-medium"><i class="fa-solid fa-gauge w-5"></i><span>Dashboard</span></a>
                <a href="/customer/apply?service=TIN" class="flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-blue-800/50 text-blue-200 transition"><i class="fa-solid fa-plus-circle w-5"></i><span>New Application</span></a>
                <a href="/customer/documents" class="flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-blue-800/50 text-blue-200 transition"><i class="fa-solid fa-folder-open w-5"></i><span>Completed Docs</span></a>
                <a href="/customer/profile" class="flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-blue-800/50 text-blue-200 transition"><i class="fa-solid fa-user w-5"></i><span>Profile</span></a>
            </nav>
        </div>
        <div class="p-4 border-t border-blue-800">
            <a href="/customer/logout" class="flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-red-600/20 text-red-300 transition"><i class="fa-solid fa-right-from-bracket w-5"></i><span>Logout</span></a>
        </div>
    </aside>

    <!-- Main Content -->
    <div class="flex-grow flex flex-col overflow-y-auto">
        <header class="bg-white shadow-sm px-8 py-4 flex justify-between items-center border-b border-slate-200">
            <h1 class="text-xl font-bold text-slate-900">Welcome, ${user.fullname}</h1>
            <div class="flex items-center space-x-4">
                <a href="/track" class="text-sm bg-slate-100 hover:bg-slate-200 px-4 py-2 rounded-xl font-medium"><i class="fa-solid fa-magnifying-glass mr-1"></i> Track App</a>
                <div class="w-10 h-10 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold">${user.fullname[0]}</div>
            </div>
        </header>

        <main class="p-8 max-w-7xl mx-auto w-full space-y-8">
            <!-- Quick Actions -->
            <div class="grid md:grid-cols-3 gap-6">
                <a href="/customer/apply?service=TIN" class="bg-gradient-to-r from-blue-600 to-blue-700 text-white p-6 rounded-2xl shadow-md hover:shadow-xl transition flex items-center justify-between">
                    <div>
                        <h3 class="font-bold text-lg mb-1">Apply for TIN</h3>
                        <p class="text-xs text-blue-100">Bureau of Internal Revenue</p>
                    </div>
                    <i class="fa-solid fa-arrow-right text-2xl"></i>
                </a>
                <a href="/customer/apply?service=SSS" class="bg-gradient-to-r from-indigo-600 to-indigo-700 text-white p-6 rounded-2xl shadow-md hover:shadow-xl transition flex items-center justify-between">
                    <div>
                        <h3 class="font-bold text-lg mb-1">Apply for SSS</h3>
                        <p class="text-xs text-indigo-100">Social Security System</p>
                    </div>
                    <i class="fa-solid fa-arrow-right text-2xl"></i>
                </a>
                <a href="/customer/apply?service=Pag-IBIG" class="bg-gradient-to-r from-emerald-600 to-emerald-700 text-white p-6 rounded-2xl shadow-md hover:shadow-xl transition flex items-center justify-between">
                    <div>
                        <h3 class="font-bold text-lg mb-1">Apply for Pag-IBIG</h3>
                        <p class="text-xs text-emerald-100">Home Development Mutual Fund</p>
                    </div>
                    <i class="fa-solid fa-arrow-right text-2xl"></i>
                </a>
            </div>

            <!-- Notifications -->
            ${notifs.length > 0 ? `
                <div class="bg-amber-50 border border-amber-200 rounded-2xl p-6">
                    <h3 class="font-bold text-amber-900 mb-3 flex items-center"><i class="fa-solid fa-bell mr-2"></i> Recent Notifications</h3>
                    <div class="space-y-2">
                        ${notifs.slice(0, 3).map(n => `
                            <div class="bg-white p-3 rounded-xl border border-amber-100 text-sm flex justify-between items-center">
                                <div><strong class="text-slate-900">${n.title}:</strong> <span class="text-slate-600">${n.message}</span></div>
                                <span class="text-xs text-slate-400">${n.created_at}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}

            <!-- Applications Table -->
            <div class="bg-white rounded-2xl shadow-md border border-slate-200 overflow-hidden">
                <div class="p-6 border-b border-slate-100 flex justify-between items-center">
                    <h3 class="font-bold text-lg text-slate-900">My Applications</h3>
                    <span class="text-xs font-semibold px-3 py-1 bg-slate-100 text-slate-600 rounded-full">${apps.length} Total</span>
                </div>
                <div class="overflow-x-auto">
                    <table class="w-full text-left border-collapse">
                        <thead>
                            <tr class="bg-slate-50 text-slate-500 text-xs uppercase font-bold border-b border-slate-200">
                                <th class="p-4">Service</th>
                                <th class="p-4">Tracking Number</th>
                                <th class="p-4">Date Submitted</th>
                                <th class="p-4">Payment Status</th>
                                <th class="p-4">Application Status</th>
                                <th class="p-4">Action</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100 text-sm">
                            ${apps.length === 0 ? `
                                <tr><td colspan="6" class="p-8 text-center text-slate-500">No applications found. Click above to start an application.</td></tr>
                            ` : apps.map(app => `
                                <tr>
                                    <td class="p-4 font-semibold text-slate-900">${app.service}</td>
                                    <td class="p-4 font-mono text-blue-600 font-bold">${app.tracking_number}</td>
                                    <td class="p-4 text-slate-600">${app.created_at}</td>
                                    <td class="p-4"><span class="px-2.5 py-1 text-xs font-semibold rounded-full ${app.payment_status === 'Paid' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">${app.payment_status}</span></td>
                                    <td class="p-4"><span class="px-2.5 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">${app.application_status}</span></td>
                                    <td class="p-4"><a href="/track?tracking=${app.tracking_number}" class="text-blue-600 font-semibold hover:underline">Track</a></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        </main>
    </div>
</body>
</html>`);
}

function renderApplicationForm(res, user, service, settings) {
    let fee = settings.tin_fee || 500;
    if (service === 'SSS') fee = settings.sss_fee || 500;
    if (service === 'Pag-IBIG') fee = settings.pagibig_fee || 500;

    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Apply for ${service} - GovAssist PH</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body class="bg-slate-50 text-slate-800 font-sans">
    <nav class="bg-blue-900 text-white shadow-md">
        <div class="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
            <a href="/customer/dashboard" class="flex items-center space-x-2 font-bold text-xl"><i class="fa-solid fa-file-shield text-blue-400"></i><span>GovAssist PH</span></a>
            <a href="/customer/dashboard" class="text-sm hover:text-blue-300">Back to Dashboard</a>
        </div>
    </nav>

    <div class="max-w-4xl mx-auto px-4 py-12">
        <div class="bg-white rounded-2xl shadow-xl p-8 border border-slate-200 mb-8">
            <span class="text-xs font-bold uppercase tracking-wider px-3 py-1 bg-blue-100 text-blue-800 rounded-full">Step-by-Step Guided Form</span>
            <h1 class="text-3xl font-extrabold text-slate-900 mt-2 mb-2">${service} Application Assistance Form</h1>
            <p class="text-slate-600 text-sm">Please fill out all required fields accurately. This information will be used by our administrators to prepare your official government application.</p>
        </div>

        <form action="/customer/apply" method="POST" enctype="multipart/form-data" class="space-y-8">
            <input type="hidden" name="service" value="${service}">

            <!-- Personal Information -->
            <div class="bg-white rounded-2xl shadow-md p-8 border border-slate-200">
                <h3 class="text-lg font-bold text-slate-900 mb-4 pb-2 border-b border-slate-100 flex items-center"><i class="fa-solid fa-user mr-2 text-blue-600"></i> Personal Information</h3>
                <div class="grid md:grid-cols-3 gap-4">
                    <div>
                        <label class="block text-xs font-bold uppercase text-slate-600 mb-1">First Name *</label>
                        <input type="text" name="first_name" required class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-600">
                    </div>
                    <div>
                        <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Middle Name</label>
                        <input type="text" name="middle_name" class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-600">
                    </div>
                    <div>
                        <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Last Name *</label>
                        <input type="text" name="last_name" required class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-600">
                    </div>
                    <div>
                        <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Suffix</label>
                        <input type="text" name="suffix" placeholder="Jr., III" class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-600">
                    </div>
                    <div>
                        <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Date of Birth *</label>
                        <input type="date" name="dob" required class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-600">
                    </div>
                    <div>
                        <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Place of Birth *</label>
                        <input type="text" name="pob" required class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-600">
                    </div>
                    <div>
                        <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Sex *</label>
                        <select name="sex" required class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-600">
                            <option value="Male">Male</option>
                            <option value="Female">Female</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Civil Status *</label>
                        <select name="civil_status" id="civil_status_select" onchange="toggleCivilStatus()" required class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-600">
                            <option value="Single">Single</option>
                            <option value="Married">Married</option>
                            <option value="Widowed">Widowed</option>
                            <option value="Separated">Separated</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Nationality *</label>
                        <input type="text" name="nationality" value="Filipino" required class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-600">
                    </div>
                    <div>
                        <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Citizenship *</label>
                        <input type="text" name="citizenship" value="Filipino" required class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-600">
                    </div>
                </div>
            </div>

            <!-- Contact Information -->
            <div class="bg-white rounded-2xl shadow-md p-8 border border-slate-200">
                <h3 class="text-lg font-bold text-slate-900 mb-4 pb-2 border-b border-slate-100 flex items-center"><i class="fa-solid fa-address-book mr-2 text-blue-600"></i> Contact Information</h3>
                <div class="grid md:grid-cols-2 gap-4">
                    <div>
                        <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Mobile Number *</label>
                        <input type="text" name="mobile" value="${user.mobile || ''}" required class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-600">
                    </div>
                    <div>
                        <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Email Address *</label>
                        <input type="email" name="email" value="${user.email || ''}" required class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-600">
                    </div>
                </div>
            </div>

            <!-- Address -->
            <div class="bg-white rounded-2xl shadow-md p-8 border border-slate-200">
                <h3 class="text-lg font-bold text-slate-900 mb-4 pb-2 border-b border-slate-100 flex items-center"><i class="fa-solid fa-house mr-2 text-blue-600"></i> Complete Address</h3>
                <div class="grid md:grid-cols-3 gap-4">
                    <div>
                        <label class="block text-xs font-bold uppercase text-slate-600 mb-1">House/Unit Number</label>
                        <input type="text" name="house_no" class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-600">
                    </div>
                    <div>
                        <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Street</label>
                        <input type="text" name="street" class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-600">
                    </div>
                    <div>
                        <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Barangay *</label>
                        <input type="text" name="barangay" required class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-600">
                    </div>
                    <div>
                        <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Municipality / City *</label>
                        <input type="text" name="municipality" required class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-600">
                    </div>
                    <div>
                        <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Province *</label>
                        <input type="text" name="province" required class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-600">
                    </div>
                    <div>
                        <label class="block text-xs font-bold uppercase text-slate-600 mb-1">ZIP Code *</label>
                        <input type="text" name="zip_code" required class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-600">
                    </div>
                </div>
            </div>

            <!-- Employment / Income (Specific for TIN / General) -->
            <div class="bg-white rounded-2xl shadow-md p-8 border border-slate-200">
                <h3 class="text-lg font-bold text-slate-900 mb-4 pb-2 border-b border-slate-100 flex items-center"><i class="fa-solid fa-briefcase mr-2 text-blue-600"></i> Employment & Income Information</h3>
                <div class="grid md:grid-cols-2 gap-4">
                    <div>
                        <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Employment Status *</label>
                        <select name="employment_status" required class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-600">
                            <option value="Employed">Employed</option>
                            <option value="Self-Employed">Self-Employed</option>
                            <option value="Unemployed">Unemployed</option>
                            <option value="Student">Student</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Source of Income</label>
                        <input type="text" name="source_of_income" placeholder="Salary, Business, Remittance" class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-600">
                    </div>
                    <div>
                        <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Employer Name (if employed)</label>
                        <input type="text" name="employer_name" class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-600">
                    </div>
                    <div>
                        <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Employer Address</label>
                        <input type="text" name="employer_address" class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-600">
                    </div>
                    <div>
                        <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Business Name (if applicable)</label>
                        <input type="text" name="business_name" class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-600">
                    </div>
                    <div>
                        <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Business Address</label>
                        <input type="text" name="business_address" class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-600">
                    </div>
                </div>
            </div>

            <!-- Parents Information (Required for SSS & Pag-IBIG) -->
            <div class="bg-white rounded-2xl shadow-md p-8 border border-slate-200">
                <h3 class="text-lg font-bold text-slate-900 mb-2 pb-2 border-b border-slate-100 flex items-center"><i class="fa-solid fa-users mr-2 text-blue-600"></i> Parents Information</h3>
                <p class="text-xs text-slate-500 mb-4">Required by government agencies for identification and record integrity.</p>
                <div class="space-y-6">
                    <div>
                        <h4 class="font-bold text-slate-800 text-sm mb-3">Mother's Maiden Name</h4>
                        <div class="grid md:grid-cols-4 gap-4">
                            <input type="text" name="mother_first" placeholder="First Name *" required class="px-4 py-3 rounded-xl border border-slate-300">
                            <input type="text" name="mother_middle" placeholder="Middle Name" class="px-4 py-3 rounded-xl border border-slate-300">
                            <input type="text" name="mother_maiden_last" placeholder="Maiden Last Name *" required class="px-4 py-3 rounded-xl border border-slate-300">
                            <input type="date" name="mother_dob" required class="px-4 py-3 rounded-xl border border-slate-300">
                        </div>
                    </div>
                    <div>
                        <h4 class="font-bold text-slate-800 text-sm mb-3">Father's Name</h4>
                        <div class="grid md:grid-cols-4 gap-4">
                            <input type="text" name="father_first" placeholder="First Name *" required class="px-4 py-3 rounded-xl border border-slate-300">
                            <input type="text" name="father_middle" placeholder="Middle Name" class="px-4 py-3 rounded-xl border border-slate-300">
                            <input type="text" name="father_last" placeholder="Last Name *" required class="px-4 py-3 rounded-xl border border-slate-300">
                            <input type="date" name="father_dob" required class="px-4 py-3 rounded-xl border border-slate-300">
                        </div>
                    </div>
                </div>
            </div>

            <!-- Spouse Information (Conditionally shown if Married) -->
            <div id="spouse_section" class="bg-white rounded-2xl shadow-md p-8 border border-slate-200" style="display:none;">
                <h3 class="text-lg font-bold text-slate-900 mb-2 pb-2 border-b border-slate-100 flex items-center"><i class="fa-solid fa-ring mr-2 text-blue-600"></i> Spouse Information & Marriage Certificate</h3>
                <div class="grid md:grid-cols-3 gap-4 mb-4">
                    <div>
                        <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Spouse First Name</label>
                        <input type="text" name="spouse_first" class="w-full px-4 py-3 rounded-xl border border-slate-300">
                    </div>
                    <div>
                        <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Spouse Middle Name</label>
                        <input type="text" name="spouse_middle" class="w-full px-4 py-3 rounded-xl border border-slate-300">
                    </div>
                    <div>
                        <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Spouse Last Name</label>
                        <input type="text" name="spouse_last" class="w-full px-4 py-3 rounded-xl border border-slate-300">
                    </div>
                    <div>
                        <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Spouse Date of Birth</label>
                        <input type="date" name="spouse_dob" class="w-full px-4 py-3 rounded-xl border border-slate-300">
                    </div>
                    <div class="md:col-span-2">
                        <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Spouse Address</label>
                        <input type="text" name="spouse_address" class="w-full px-4 py-3 rounded-xl border border-slate-300">
                    </div>
                </div>
                <div>
                    <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Marriage Certificate Upload *</label>
                    <input type="file" name="marriage_cert" accept=".jpg,.jpeg,.png,.pdf" class="w-full px-4 py-2 border border-slate-300 rounded-xl">
                    <p class="text-xs text-slate-500 mt-1">Upload a clear photo or PDF copy of your Marriage Certificate.</p>
                </div>
            </div>

            <!-- Beneficiaries (Multiple Support) -->
            <div class="bg-white rounded-2xl shadow-md p-8 border border-slate-200">
                <div class="flex justify-between items-center mb-4 pb-2 border-b border-slate-100">
                    <h3 class="text-lg font-bold text-slate-900 flex items-center"><i class="fa-solid fa-heart mr-2 text-blue-600"></i> Beneficiaries (Multiple Allowed)</h3>
                    <button type="button" onclick="addBeneficiary()" class="bg-blue-100 text-blue-700 font-semibold px-4 py-2 rounded-xl text-xs hover:bg-blue-200 transition"><i class="fa-solid fa-plus mr-1"></i> Add Beneficiary</button>
                </div>
                <div id="beneficiaries_container" class="space-y-4">
                    <div class="beneficiary-item bg-slate-50 p-4 rounded-xl border border-slate-200 relative">
                        <div class="grid md:grid-cols-3 gap-4">
                            <div>
                                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Full Name</label>
                                <input type="text" name="beneficiary_fullname" required class="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm">
                            </div>
                            <div>
                                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Relationship</label>
                                <select name="beneficiary_relationship" class="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm">
                                    <option value="Spouse">Spouse</option>
                                    <option value="Child">Child</option>
                                    <option value="Parent">Parent</option>
                                    <option value="Sibling">Sibling</option>
                                    <option value="Other">Other</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Date of Birth</label>
                                <input type="date" name="beneficiary_dob" required class="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm">
                            </div>
                            <div>
                                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Sex</label>
                                <select name="beneficiary_sex" class="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm">
                                    <option value="Male">Male</option>
                                    <option value="Female">Female</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Address</label>
                                <input type="text" name="beneficiary_address" class="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm">
                            </div>
                            <div>
                                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Contact Number</label>
                                <input type="text" name="beneficiary_contact" class="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm">
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Document Uploads -->
            <div class="bg-white rounded-2xl shadow-md p-8 border border-slate-200">
                <h3 class="text-lg font-bold text-slate-900 mb-4 pb-2 border-b border-slate-100 flex items-center"><i class="fa-solid fa-file-arrow-up mr-2 text-blue-600"></i> Document Uploads</h3>
                <div class="grid md:grid-cols-2 gap-6">
                    <div>
                        <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Valid ID Type *</label>
                        <select name="id_type" required class="w-full px-4 py-3 rounded-xl border border-slate-300 mb-3">
                            <option value="National ID">National ID</option>
                            <option value="Driver's License">Driver's License</option>
                            <option value="Passport">Passport</option>
                            <option value="UMID">UMID</option>
                            <option value="PhilHealth ID">PhilHealth ID</option>
                            <option value="Postal ID">Postal ID</option>
                            <option value="Other">Other Government ID</option>
                        </select>
                        <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Upload Valid ID File *</label>
                        <input type="file" name="valid_id_file" accept=".jpg,.jpeg,.png,.pdf" required class="w-full px-4 py-2 border border-slate-300 rounded-xl">
                    </div>
                    <div>
                        <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Photo Holding Valid ID *</label>
                        <input type="file" name="photo_holding_id" accept=".jpg,.jpeg,.png" required class="w-full px-4 py-2 border border-slate-300 rounded-xl mb-3">
                        <p class="text-xs text-slate-500">Take a clear photo while holding your valid ID. Ensure your face and ID are legible.</p>
                    </div>
                    <div>
                        <label class="block text-xs font-bold uppercase text-slate-600 mb-1">ID Picture / Profile Picture *</label>
                        <input type="file" name="id_picture" accept=".jpg,.jpeg,.png" required class="w-full px-4 py-2 border border-slate-300 rounded-xl">
                    </div>
                    <div>
                        <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Other Supporting Documents (Optional)</label>
                        <input type="file" name="other_docs" multiple accept=".jpg,.jpeg,.png,.pdf" class="w-full px-4 py-2 border border-slate-300 rounded-xl">
                    </div>
                </div>
            </div>

            <!-- Payment System -->
            <div class="bg-white rounded-2xl shadow-md p-8 border border-slate-200">
                <h3 class="text-lg font-bold text-slate-900 mb-4 pb-2 border-b border-slate-100 flex items-center"><i class="fa-solid fa-peso-sign mr-2 text-blue-600"></i> Payment Details</h3>
                <div class="mb-4 bg-blue-50 p-4 rounded-xl border border-blue-200 flex justify-between items-center">
                    <div>
                        <p class="text-xs font-bold uppercase text-blue-800">Assistance Service Fee</p>
                        <p class="text-2xl font-extrabold text-blue-900">₱${fee}.00</p>
                    </div>
                    <span class="text-sm font-semibold text-blue-700">${service} Processing</span>
                </div>

                <div class="mb-4">
                    <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Payment Method *</label>
                    <select name="payment_method" id="payment_method_select" onchange="togglePaymentMethod()" required class="w-full px-4 py-3 rounded-xl border border-slate-300">
                        <option value="GCash">GCash</option>
                        <option value="Cash">Cash (Walk-in / Office)</option>
                    </select>
                </div>

                <div id="gcash_payment_box" class="space-y-4 bg-slate-50 p-6 rounded-xl border border-slate-200">
                    <p class="font-bold text-slate-800 text-sm">Scan QR Code or Send to GCash Number:</p>
                    <p class="text-lg font-mono font-bold text-blue-600">${settings.gcash_number || '09171234567'} (${settings.gcash_name || 'GovAssist'})</p>
                    ${settings.gcash_qr ? `<img src="/uploads/${settings.gcash_qr}" alt="GCash QR" class="w-48 h-48 object-cover rounded-xl border border-slate-300">` : ''}
                    <div>
                        <label class="block text-xs font-bold uppercase text-slate-600 mb-1">GCash Reference Number *</label>
                        <input type="text" name="reference_number" class="w-full px-4 py-3 rounded-xl border border-slate-300">
                    </div>
                    <div>
                        <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Upload Payment Proof (Screenshot) *</label>
                        <input type="file" name="proof_file" accept=".jpg,.jpeg,.png,.pdf" class="w-full px-4 py-2 border border-slate-300 rounded-xl">
                    </div>
                </div>

                <div id="cash_payment_box" class="space-y-2 bg-slate-50 p-6 rounded-xl border border-slate-200" style="display:none;">
                    <p class="font-bold text-slate-800 text-sm">Cash Payment Instructions:</p>
                    <p class="text-sm text-slate-600">You selected Cash payment. Please visit our office or coordinate with our administrator to complete your payment according to office guidelines.</p>
                </div>
            </div>

            <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-extrabold py-4 rounded-xl text-lg shadow-xl transition">Submit Application & Documents</button>
        </form>
    </div>

    <script>
        function toggleCivilStatus() {
            const status = document.getElementById('civil_status_select').value;
            const spouseBox = document.getElementById('spouse_section');
            if (status === 'Married') {
                spouseBox.style.display = 'block';
            } else {
                spouseBox.style.display = 'none';
            }
        }

        function togglePaymentMethod() {
            const method = document.getElementById('payment_method_select').value;
            const gcashBox = document.getElementById('gcash_payment_box');
            const cashBox = document.getElementById('cash_payment_box');
            if (method === 'GCash') {
                gcashBox.style.display = 'block';
                cashBox.style.display = 'none';
            } else {
                gcashBox.style.display = 'none';
                cashBox.style.display = 'block';
            }
        }

        function addBeneficiary() {
            const container = document.getElementById('beneficiaries_container');
            const div = document.createElement('div');
            div.className = 'beneficiary-item bg-slate-50 p-4 rounded-xl border border-slate-200 relative mt-4';
            div.innerHTML = \`
                <div class="grid md:grid-cols-3 gap-4">
                    <div>
                        <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Full Name</label>
                        <input type="text" name="beneficiary_fullname" required class="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm">
                    </div>
                    <div>
                        <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Relationship</label>
                        <select name="beneficiary_relationship" class="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm">
                            <option value="Spouse">Spouse</option>
                            <option value="Child">Child</option>
                            <option value="Parent">Parent</option>
                            <option value="Sibling">Sibling</option>
                            <option value="Other">Other</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Date of Birth</label>
                        <input type="date" name="beneficiary_dob" required class="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm">
                    </div>
                    <div>
                        <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Sex</label>
                        <select name="beneficiary_sex" class="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm">
                            <option value="Male">Male</option>
                            <option value="Female">Female</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Address</label>
                        <input type="text" name="beneficiary_address" class="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm">
                    </div>
                    <div>
                        <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Contact Number</label>
                        <input type="text" name="beneficiary_contact" class="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm">
                    </div>
                </div>
                <button type="button" onclick="this.parentElement.remove()" class="mt-3 text-red-600 text-xs font-semibold hover:underline"><i class="fa-solid fa-trash mr-1"></i> Remove Beneficiary</button>
            \`;
            container.appendChild(div);
        }
    </script>
</body>
</html>`);
}

function renderCustomerCompletedDocs(res, user, files) {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Completed Documents - GovAssist PH</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body class="bg-slate-50 text-slate-800 font-sans flex h-screen overflow-hidden">
    <aside class="w-64 bg-blue-900 text-white flex flex-col justify-between hidden md:flex shadow-xl">
        <div>
            <div class="p-6 flex items-center space-x-3 border-b border-blue-800">
                <i class="fa-solid fa-file-shield text-2xl text-blue-400"></i>
                <span class="font-bold text-xl">GovAssist PH</span>
            </div>
            <nav class="p-4 space-y-2">
                <a href="/customer/dashboard" class="flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-blue-800/50 text-blue-200 transition"><i class="fa-solid fa-gauge w-5"></i><span>Dashboard</span></a>
                <a href="/customer/apply?service=TIN" class="flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-blue-800/50 text-blue-200 transition"><i class="fa-solid fa-plus-circle w-5"></i><span>New Application</span></a>
                <a href="/customer/documents" class="flex items-center space-x-3 px-4 py-3 rounded-xl bg-blue-800 text-white font-medium"><i class="fa-solid fa-folder-open w-5"></i><span>Completed Docs</span></a>
                <a href="/customer/profile" class="flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-blue-800/50 text-blue-200 transition"><i class="fa-solid fa-user w-5"></i><span>Profile</span></a>
            </nav>
        </div>
        <div class="p-4 border-t border-blue-800">
            <a href="/customer/logout" class="flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-red-600/20 text-red-300 transition"><i class="fa-solid fa-right-from-bracket w-5"></i><span>Logout</span></a>
        </div>
    </aside>

    <div class="flex-grow flex flex-col overflow-y-auto">
        <header class="bg-white shadow-sm px-8 py-4 flex justify-between items-center border-b border-slate-200">
            <h1 class="text-xl font-bold text-slate-900">Completed Documents</h1>
            <div class="w-10 h-10 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold">${user.fullname[0]}</div>
        </header>

        <main class="p-8 max-w-7xl mx-auto w-full">
            <div class="bg-white rounded-2xl shadow-md border border-slate-200 overflow-hidden">
                <div class="p-6 border-b border-slate-100">
                    <h3 class="font-bold text-lg text-slate-900">Files Uploaded by Administrator</h3>
                    <p class="text-xs text-slate-500 mt-1">Download your processed government documents and official receipts here.</p>
                </div>
                <div class="overflow-x-auto">
                    <table class="w-full text-left border-collapse">
                        <thead>
                            <tr class="bg-slate-50 text-slate-500 text-xs uppercase font-bold border-b border-slate-200">
                                <th class="p-4">Document Title</th>
                                <th class="p-4">Service / Tracking</th>
                                <th class="p-4">Date Uploaded</th>
                                <th class="p-4">Action</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100 text-sm">
                            ${files.length === 0 ? `
                                <tr><td colspan="4" class="p-8 text-center text-slate-500">No completed documents uploaded yet.</td></tr>
                            ` : files.map(f => `
                                <tr>
                                    <td class="p-4 font-semibold text-slate-900">${f.title}</td>
                                    <td class="p-4"><span class="font-mono text-blue-600 font-bold">${f.tracking_number}</span> (${f.service})</td>
                                    <td class="p-4 text-slate-600">${f.uploaded_at}</td>
                                    <td class="p-4"><a href="/uploads/${f.file_path}" target="_blank" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-xs font-semibold shadow-md transition inline-flex items-center"><i class="fa-solid fa-download mr-1"></i> Download</a></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        </main>
    </div>
</body>
</html>`);
}

function renderCustomerProfile(res, user) {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Customer Profile - GovAssist PH</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body class="bg-slate-50 text-slate-800 font-sans flex h-screen overflow-hidden">
    <aside class="w-64 bg-blue-900 text-white flex flex-col justify-between hidden md:flex shadow-xl">
        <div>
            <div class="p-6 flex items-center space-x-3 border-b border-blue-800">
                <i class="fa-solid fa-file-shield text-2xl text-blue-400"></i>
                <span class="font-bold text-xl">GovAssist PH</span>
            </div>
            <nav class="p-4 space-y-2">
                <a href="/customer/dashboard" class="flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-blue-800/50 text-blue-200 transition"><i class="fa-solid fa-gauge w-5"></i><span>Dashboard</span></a>
                <a href="/customer/apply?service=TIN" class="flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-blue-800/50 text-blue-200 transition"><i class="fa-solid fa-plus-circle w-5"></i><span>New Application</span></a>
                <a href="/customer/documents" class="flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-blue-800/50 text-blue-200 transition"><i class="fa-solid fa-folder-open w-5"></i><span>Completed Docs</span></a>
                <a href="/customer/profile" class="flex items-center space-x-3 px-4 py-3 rounded-xl bg-blue-800 text-white font-medium"><i class="fa-solid fa-user w-5"></i><span>Profile</span></a>
            </nav>
        </div>
        <div class="p-4 border-t border-blue-800">
            <a href="/customer/logout" class="flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-red-600/20 text-red-300 transition"><i class="fa-solid fa-right-from-bracket w-5"></i><span>Logout</span></a>
        </div>
    </aside>

    <div class="flex-grow flex flex-col overflow-y-auto">
        <header class="bg-white shadow-sm px-8 py-4 flex justify-between items-center border-b border-slate-200">
            <h1 class="text-xl font-bold text-slate-900">Customer Profile</h1>
            <div class="w-10 h-10 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold">${user.fullname[0]}</div>
        </header>

        <main class="p-8 max-w-2xl mx-auto w-full">
            <div class="bg-white rounded-2xl shadow-md p-8 border border-slate-200">
                ${req.query.success ? `<div class="bg-emerald-50 text-emerald-700 p-3 rounded-xl mb-6 text-sm">${req.query.success}</div>` : ''}
                <form action="/customer/profile" method="POST" class="space-y-4">
                    <div>
                        <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Full Name</label>
                        <input type="text" name="fullname" value="${user.fullname}" required class="w-full px-4 py-3 rounded-xl border border-slate-300">
                    </div>
                    <div>
                        <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Email Address</label>
                        <input type="email" name="email" value="${user.email}" required class="w-full px-4 py-3 rounded-xl border border-slate-300">
                    </div>
                    <div>
                        <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Mobile Number</label>
                        <input type="text" name="mobile" value="${user.mobile}" required class="w-full px-4 py-3 rounded-xl border border-slate-300">
                    </div>
                    <div>
                        <label class="block text-xs font-bold uppercase text-slate-600 mb-1">New Password (leave blank to keep current)</label>
                        <input type="password" name="password" class="w-full px-4 py-3 rounded-xl border border-slate-300">
                    </div>
                    <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition shadow-md">Update Profile</button>
                </form>
            </div>
        </main>
    </div>
</body>
</html>`);
}

function renderAdminDashboard(res, stats, recentApps) {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin Dashboard - GovAssist PH</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body class="bg-slate-900 text-slate-100 font-sans flex h-screen overflow-hidden">
    <aside class="w-64 bg-slate-800 text-white flex flex-col justify-between hidden md:flex border-r border-slate-700">
        <div>
            <div class="p-6 flex items-center space-x-3 border-b border-slate-700">
                <i class="fa-solid fa-lock text-2xl text-blue-400"></i>
                <span class="font-bold text-xl">Admin Portal</span>
            </div>
            <nav class="p-4 space-y-2">
                <a href="/admin/dashboard" class="flex items-center space-x-3 px-4 py-3 rounded-xl bg-blue-600 text-white font-medium"><i class="fa-solid fa-gauge w-5"></i><span>Dashboard</span></a>
                <a href="/admin/applications" class="flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-slate-700 text-slate-300 transition"><i class="fa-solid fa-file-lines w-5"></i><span>Applications</span></a>
                <a href="/admin/customers" class="flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-slate-700 text-slate-300 transition"><i class="fa-solid fa-users w-5"></i><span>Customers</span></a>
                <a href="/admin/reports" class="flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-slate-700 text-slate-300 transition"><i class="fa-solid fa-chart-pie w-5"></i><span>Reports</span></a>
                <a href="/admin/settings" class="flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-slate-700 text-slate-300 transition"><i class="fa-solid fa-gear w-5"></i><span>Settings</span></a>
            </nav>
        </div>
        <div class="p-4 border-t border-slate-700">
            <a href="/admin/logout" class="flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-red-600/20 text-red-400 transition"><i class="fa-solid fa-right-from-bracket w-5"></i><span>Logout</span></a>
        </div>
    </aside>

    <div class="flex-grow flex flex-col overflow-y-auto">
        <header class="bg-slate-800 shadow-sm px-8 py-4 flex justify-between items-center border-b border-slate-700">
            <h1 class="text-xl font-bold text-white">Administrator Dashboard</h1>
            <a href="/" target="_blank" class="text-sm bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-xl text-slate-200">View Public Site</a>
        </header>

        <main class="p-8 max-w-7xl mx-auto w-full space-y-8">
            <div class="grid md:grid-cols-4 gap-6">
                <div class="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg">
                    <p class="text-xs text-slate-400 uppercase font-bold mb-1">Total Customers</p>
                    <p class="text-3xl font-extrabold text-white">${stats.customers}</p>
                </div>
                <div class="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg">
                    <p class="text-xs text-slate-400 uppercase font-bold mb-1">Total Applications</p>
                    <p class="text-3xl font-extrabold text-white">${stats.applications}</p>
                </div>
                <div class="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg">
                    <p class="text-xs text-slate-400 uppercase font-bold mb-1">Pending Review</p>
                    <p class="text-3xl font-extrabold text-amber-400">${stats.pending}</p>
                </div>
                <div class="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg">
                    <p class="text-xs text-slate-400 uppercase font-bold mb-1">Completed</p>
                    <p class="text-3xl font-extrabold text-emerald-400">${stats.completed}</p>
                </div>
            </div>

            <div class="bg-slate-800 rounded-2xl border border-slate-700 shadow-lg overflow-hidden">
                <div class="p-6 border-b border-slate-700 flex justify-between items-center">
                    <h3 class="font-bold text-lg text-white">Recent Applications</h3>
                    <a href="/admin/applications" class="text-sm text-blue-400 hover:underline">View All</a>
                </div>
                <div class="overflow-x-auto">
                    <table class="w-full text-left border-collapse">
                        <thead>
                            <tr class="bg-slate-900 text-slate-400 text-xs uppercase font-bold border-b border-slate-700">
                                <th class="p-4">Applicant</th>
                                <th class="p-4">Service</th>
                                <th class="p-4">Tracking Number</th>
                                <th class="p-4">Payment</th>
                                <th class="p-4">Status</th>
                                <th class="p-4">Action</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-700 text-sm">
                            ${recentApps.map(app => `
                                <tr>
                                    <td class="p-4 font-semibold text-white">${app.fullname}</td>
                                    <td class="p-4">${app.service}</td>
                                    <td class="p-4 font-mono text-blue-400">${app.tracking_number}</td>
                                    <td class="p-4"><span class="px-2.5 py-1 text-xs font-semibold rounded-full ${app.payment_status === 'Paid' ? 'bg-emerald-900/50 text-emerald-300' : 'bg-amber-900/50 text-amber-300'}">${app.payment_status}</span></td>
                                    <td class="p-4"><span class="px-2.5 py-1 text-xs font-semibold rounded-full bg-blue-900/50 text-blue-300">${app.application_status}</span></td>
                                    <td class="p-4"><a href="/admin/applications/${app.id}" class="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold">Review</a></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        </main>
    </div>
</body>
</html>`);
}

function renderAdminApplications(res, apps, filters) {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin Applications - GovAssist PH</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body class="bg-slate-900 text-slate-100 font-sans flex h-screen overflow-hidden">
    <aside class="w-64 bg-slate-800 text-white flex flex-col justify-between hidden md:flex border-r border-slate-700">
        <div>
            <div class="p-6 flex items-center space-x-3 border-b border-slate-700">
                <i class="fa-solid fa-lock text-2xl text-blue-400"></i>
                <span class="font-bold text-xl">Admin Portal</span>
            </div>
            <nav class="p-4 space-y-2">
                <a href="/admin/dashboard" class="flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-slate-700 text-slate-300 transition"><i class="fa-solid fa-gauge w-5"></i><span>Dashboard</span></a>
                <a href="/admin/applications" class="flex items-center space-x-3 px-4 py-3 rounded-xl bg-blue-600 text-white font-medium"><i class="fa-solid fa-file-lines w-5"></i><span>Applications</span></a>
                <a href="/admin/customers" class="flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-slate-700 text-slate-300 transition"><i class="fa-solid fa-users w-5"></i><span>Customers</span></a>
                <a href="/admin/reports" class="flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-slate-700 text-slate-300 transition"><i class="fa-solid fa-chart-pie w-5"></i><span>Reports</span></a>
                <a href="/admin/settings" class="flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-slate-700 text-slate-300 transition"><i class="fa-solid fa-gear w-5"></i><span>Settings</span></a>
            </nav>
        </div>
        <div class="p-4 border-t border-slate-700">
            <a href="/admin/logout" class="flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-red-600/20 text-red-400 transition"><i class="fa-solid fa-right-from-bracket w-5"></i><span>Logout</span></a>
        </div>
    </aside>

    <div class="flex-grow flex flex-col overflow-y-auto">
        <header class="bg-slate-800 shadow-sm px-8 py-4 flex justify-between items-center border-b border-slate-700">
            <h1 class="text-xl font-bold text-white">Manage Applications</h1>
        </header>

        <main class="p-8 max-w-7xl mx-auto w-full space-y-6">
            <form action="/admin/applications" method="GET" class="bg-slate-800 p-6 rounded-2xl border border-slate-700 grid md:grid-cols-4 gap-4">
                <input type="text" name="search" value="${filters.search}" placeholder="Search name or tracking..." class="px-4 py-2.5 bg-slate-900 rounded-xl border border-slate-700 text-white text-sm">
                <select name="service" class="px-4 py-2.5 bg-slate-900 rounded-xl border border-slate-700 text-white text-sm">
                    <option value="">All Services</option>
                    <option value="TIN" ${filters.service === 'TIN' ? 'selected' : ''}>TIN</option>
                    <option value="SSS" ${filters.service === 'SSS' ? 'selected' : ''}>SSS</option>
                    <option value="Pag-IBIG" ${filters.service === 'Pag-IBIG' ? 'selected' : ''}>Pag-IBIG</option>
                </select>
                <select name="status" class="px-4 py-2.5 bg-slate-900 rounded-xl border border-slate-700 text-white text-sm">
                    <option value="">All Statuses</option>
                    <option value="Submitted" ${filters.status === 'Submitted' ? 'selected' : ''}>Submitted</option>
                    <option value="Under Review" ${filters.status === 'Under Review' ? 'selected' : ''}>Under Review</option>
                    <option value="Processing" ${filters.status === 'Processing' ? 'selected' : ''}>Processing</option>
                    <option value="Completed" ${filters.status === 'Completed' ? 'selected' : ''}>Completed</option>
                </select>
                <button type="submit" class="bg-blue-600 hover:bg-blue-500 text-white font-bold py-2.5 rounded-xl text-sm transition">Filter</button>
            </form>

            <div class="bg-slate-800 rounded-2xl border border-slate-700 shadow-lg overflow-hidden">
                <div class="overflow-x-auto">
                    <table class="w-full text-left border-collapse">
                        <thead>
                            <tr class="bg-slate-900 text-slate-400 text-xs uppercase font-bold border-b border-slate-700">
                                <th class="p-4">Applicant</th>
                                <th class="p-4">Service</th>
                                <th class="p-4">Tracking Number</th>
                                <th class="p-4">Date</th>
                                <th class="p-4">Payment</th>
                                <th class="p-4">Status</th>
                                <th class="p-4">Action</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-700 text-sm">
                            ${apps.map(app => `
                                <tr>
                                    <td class="p-4 font-semibold text-white">${app.fullname}</td>
                                    <td class="p-4">${app.service}</td>
                                    <td class="p-4 font-mono text-blue-400">${app.tracking_number}</td>
                                    <td class="p-4 text-slate-400">${app.created_at}</td>
                                    <td class="p-4"><span class="px-2.5 py-1 text-xs font-semibold rounded-full ${app.payment_status === 'Paid' ? 'bg-emerald-900/50 text-emerald-300' : 'bg-amber-900/50 text-amber-300'}">${app.payment_status}</span></td>
                                    <td class="p-4"><span class="px-2.5 py-1 text-xs font-semibold rounded-full bg-blue-900/50 text-blue-300">${app.application_status}</span></td>
                                    <td class="p-4"><a href="/admin/applications/${app.id}" class="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold">Review</a></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        </main>
    </div>
</body>
</html>`);
}

function renderAdminApplicantDetail(res, app, info, parents, spouse, beneficiaries, documents, completedFiles, payment, history) {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Review Application - ${app.tracking_number}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body class="bg-slate-900 text-slate-100 font-sans flex h-screen overflow-hidden">
    <aside class="w-64 bg-slate-800 text-white flex flex-col justify-between hidden md:flex border-r border-slate-700">
        <div>
            <div class="p-6 flex items-center space-x-3 border-b border-slate-700">
                <i class="fa-solid fa-lock text-2xl text-blue-400"></i>
                <span class="font-bold text-xl">Admin Portal</span>
            </div>
            <nav class="p-4 space-y-2">
                <a href="/admin/dashboard" class="flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-slate-700 text-slate-300 transition"><i class="fa-solid fa-gauge w-5"></i><span>Dashboard</span></a>
                <a href="/admin/applications" class="flex items-center space-x-3 px-4 py-3 rounded-xl bg-blue-600 text-white font-medium"><i class="fa-solid fa-file-lines w-5"></i><span>Applications</span></a>
                <a href="/admin/customers" class="flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-slate-700 text-slate-300 transition"><i class="fa-solid fa-users w-5"></i><span>Customers</span></a>
                <a href="/admin/reports" class="flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-slate-700 text-slate-300 transition"><i class="fa-solid fa-chart-pie w-5"></i><span>Reports</span></a>
                <a href="/admin/settings" class="flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-slate-700 text-slate-300 transition"><i class="fa-solid fa-gear w-5"></i><span>Settings</span></a>
            </nav>
        </div>
        <div class="p-4 border-t border-slate-700">
            <a href="/admin/logout" class="flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-red-600/20 text-red-400 transition"><i class="fa-solid fa-right-from-bracket w-5"></i><span>Logout</span></a>
        </div>
    </aside>

    <div class="flex-grow flex flex-col overflow-y-auto">
        <header class="bg-slate-800 shadow-sm px-8 py-4 flex justify-between items-center border-b border-slate-700">
            <div class="flex items-center space-x-4">
                <a href="/admin/applications" class="text-slate-400 hover:text-white"><i class="fa-solid fa-arrow-left"></i></a>
                <h1 class="text-xl font-bold text-white">${app.tracking_number} (${app.service})</h1>
            </div>
            <a href="/admin/applications/${app.id}/print" target="_blank" class="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl text-sm font-bold shadow-md transition flex items-center"><i class="fa-solid fa-print mr-2"></i> Print Application</a>
        </header>

        <main class="p-8 max-w-7xl mx-auto w-full space-y-8">
            <!-- Status & Management Actions -->
            <div class="grid md:grid-cols-2 gap-6">
                <div class="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg">
                    <h3 class="font-bold text-lg text-white mb-4">Update Application Status</h3>
                    <form action="/admin/applications/${app.id}/status" method="POST" class="space-y-4">
                        <div>
                            <label class="block text-xs font-bold uppercase text-slate-400 mb-1">Status</label>
                            <select name="status" class="w-full px-4 py-2.5 bg-slate-900 rounded-xl border border-slate-700 text-white text-sm">
                                <option value="Submitted" ${app.application_status === 'Submitted' ? 'selected' : ''}>Submitted</option>
                                <option value="Under Review" ${app.application_status === 'Under Review' ? 'selected' : ''}>Under Review</option>
                                <option value="Need Correction" ${app.application_status === 'Need Correction' ? 'selected' : ''}>Need Correction</option>
                                <option value="Processing" ${app.application_status === 'Processing' ? 'selected' : ''}>Processing</option>
                                <option value="Ready" ${app.application_status === 'Ready' ? 'selected' : ''}>Ready</option>
                                <option value="Completed" ${app.application_status === 'Completed' ? 'selected' : ''}>Completed</option>
                                <option value="Rejected" ${app.application_status === 'Rejected' ? 'selected' : ''}>Rejected</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-xs font-bold uppercase text-slate-400 mb-1">Remarks / Correction Reason</label>
                            <textarea name="remarks" rows="2" class="w-full px-4 py-2.5 bg-slate-900 rounded-xl border border-slate-700 text-white text-sm" placeholder="Enter remarks or instructions..."></textarea>
                        </div>
                        <button type="submit" class="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-2.5 rounded-xl text-sm transition">Update Status</button>
                    </form>
                </div>

                <div class="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg">
                    <h3 class="font-bold text-lg text-white mb-4">Payment Verification</h3>
                    <div class="mb-4 text-sm space-y-1">
                        <p><strong class="text-slate-400">Method:</strong> ${payment ? payment.payment_method : 'N/A'}</p>
                        <p><strong class="text-slate-400">Amount:</strong> ₱${payment ? payment.amount : 0}.00</p>
                        <p><strong class="text-slate-400">Reference:</strong> ${payment && payment.reference_number ? payment.reference_number : 'None'}</p>
                        <p><strong class="text-slate-400">Status:</strong> <span class="text-amber-400">${payment ? payment.payment_status : 'N/A'}</span></p>
                        ${payment && payment.proof_path ? `<p class="mt-2"><a href="/uploads/${payment.proof_path}" target="_blank" class="text-blue-400 underline font-semibold">View Payment Proof Screenshot</a></p>` : ''}
                    </div>
                    <form action="/admin/applications/${app.id}/verify-payment" method="POST" class="space-y-4">
                        <input type="hidden" name="payment_status" value="Paid">
                        <button type="submit" class="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 rounded-xl text-sm transition">Confirm Payment as Paid</button>
                    </form>
                </div>
            </div>

            <!-- Complete Applicant Information -->
            ${info ? `
                <div class="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg space-y-6">
                    <h3 class="font-bold text-xl text-white border-b border-slate-700 pb-3">Complete Applicant Information</h3>
                    
                    <div class="grid md:grid-cols-3 gap-6 text-sm">
                        <div><strong class="text-slate-400 block text-xs uppercase">Full Name</strong> ${info.first_name} ${info.middle_name || ''} ${info.last_name} ${info.suffix || ''}</div>
                        <div><strong class="text-slate-400 block text-xs uppercase">Date of Birth</strong> ${info.dob}</div>
                        <div><strong class="text-slate-400 block text-xs uppercase">Place of Birth</strong> ${info.pob}</div>
                        <div><strong class="text-slate-400 block text-xs uppercase">Sex / Civil Status</strong> ${info.sex} / ${info.civil_status}</div>
                        <div><strong class="text-slate-400 block text-xs uppercase">Nationality / Citizenship</strong> ${info.nationality} / ${info.citizenship}</div>
                        <div><strong class="text-slate-400 block text-xs uppercase">Mobile / Email</strong> ${info.mobile} / ${info.email}</div>
                        <div class="md:col-span-3"><strong class="text-slate-400 block text-xs uppercase">Complete Address</strong> ${info.house_no || ''} ${info.street || ''}, Brgy. ${info.barangay}, ${info.municipality}, ${info.province} (${info.zip_code})</div>
                        <div><strong class="text-slate-400 block text-xs uppercase">Employment Status</strong> ${info.employment_status}</div>
                        <div><strong class="text-slate-400 block text-xs uppercase">Occupation</strong> ${info.occupation || 'N/A'}</div>
                        <div><strong class="text-slate-400 block text-xs uppercase">Source of Income</strong> ${info.source_of_income || 'N/A'}</div>
                    </div>
                </div>
            ` : ''}

            <!-- Parents & Spouse -->
            <div class="grid md:grid-cols-2 gap-6">
                ${parents ? `
                    <div class="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg">
                        <h3 class="font-bold text-lg text-white mb-4 border-b border-slate-700 pb-2">Parents Information</h3>
                        <div class="text-sm space-y-2">
                            <p><strong class="text-slate-400">Mother:</strong> ${parents.mother_first} ${parents.mother_middle || ''} ${parents.mother_maiden_last} (DOB: ${parents.mother_dob})</p>
                            <p><strong class="text-slate-400">Father:</strong> ${parents.father_first} ${parents.father_middle || ''} ${parents.father_last} (DOB: ${parents.father_dob})</p>
                        </div>
                    </div>
                ` : ''}

                ${spouse ? `
                    <div class="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg">
                        <h3 class="font-bold text-lg text-white mb-4 border-b border-slate-700 pb-2">Spouse Information</h3>
                        <div class="text-sm space-y-2">
                            <p><strong class="text-slate-400">Spouse Name:</strong> ${spouse.spouse_first} ${spouse.spouse_middle || ''} ${spouse.spouse_last}</p>
                            <p><strong class="text-slate-400">Date of Birth:</strong> ${spouse.spouse_dob || 'N/A'}</p>
                            ${spouse.marriage_cert ? `<p><strong class="text-slate-400">Marriage Certificate:</strong> <a href="/uploads/${spouse.marriage_cert}" target="_blank" class="text-blue-400 underline">View Certificate</a></p>` : ''}
                        </div>
                    </div>
                ` : ''}
            </div>

            <!-- Beneficiaries Table -->
            <div class="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg">
                <h3 class="font-bold text-lg text-white mb-4 border-b border-slate-700 pb-2">Beneficiaries (${beneficiaries.length})</h3>
                <div class="overflow-x-auto">
                    <table class="w-full text-left border-collapse text-sm">
                        <thead>
                            <tr class="bg-slate-900 text-slate-400 text-xs uppercase font-bold border-b border-slate-700">
                                <th class="p-3">Full Name</th>
                                <th class="p-3">Relationship</th>
                                <th class="p-3">Date of Birth</th>
                                <th class="p-3">Sex</th>
                                <th class="p-3">Address</th>
                                <th class="p-3">Contact</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-700">
                            ${beneficiaries.length === 0 ? `<tr><td colspan="6" class="p-4 text-center text-slate-500">No beneficiaries listed.</td></tr>` : beneficiaries.map(b => `
                                <tr>
                                    <td class="p-3 font-semibold text-white">${b.fullname}</td>
                                    <td class="p-3">${b.relationship}</td>
                                    <td class="p-3">${b.dob}</td>
                                    <td class="p-3">${b.sex}</td>
                                    <td class="p-3">${b.address || 'N/A'}</td>
                                    <td class="p-3">${b.contact || 'N/A'}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Uploaded Documents Viewer -->
            <div class="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg">
                <h3 class="font-bold text-lg text-white mb-4 border-b border-slate-700 pb-2">Uploaded Customer Documents</h3>
                <div class="grid md:grid-cols-3 gap-4">
                    ${documents.map(d => `
                        <div class="bg-slate-900 p-4 rounded-xl border border-slate-700 flex flex-col justify-between">
                            <div>
                                <p class="font-bold text-white text-sm mb-1">${d.doc_type}</p>
                                <p class="text-xs text-slate-400 mb-3">${d.file_name}</p>
                            </div>
                            <a href="/uploads/${d.file_path}" target="_blank" class="bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded-lg text-xs font-semibold text-center"><i class="fa-solid fa-eye mr-1"></i> View / Download</a>
                        </div>
                    `).join('')}
                </div>
            </div>

            <!-- Admin Completed Files Section -->
            <div class="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg">
                <h3 class="font-bold text-lg text-white mb-4 border-b border-slate-700 pb-2">Completed Government Files (Uploaded by Admin)</h3>
                
                <div class="grid md:grid-cols-3 gap-4 mb-6">
                    ${completedFiles.map(cf => `
                        <div class="bg-slate-900 p-4 rounded-xl border border-slate-700 flex flex-col justify-between">
                            <div>
                                <p class="font-bold text-white text-sm mb-1">${cf.title}</p>
                                <p class="text-xs text-slate-400 mb-3">${cf.file_name}</p>
                            </div>
                            <a href="/uploads/${cf.file_path}" target="_blank" class="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-2 rounded-lg text-xs font-semibold text-center"><i class="fa-solid fa-download mr-1"></i> Download</a>
                        </div>
                    `).join('')}
                </div>

                <form action="/admin/applications/${app.id}/upload-completed" method="POST" enctype="multipart/form-data" class="bg-slate-900 p-6 rounded-xl border border-slate-700 space-y-4">
                    <h4 class="font-bold text-white text-sm">Upload Completed File for Customer</h4>
                    <div class="grid md:grid-cols-2 gap-4">
                        <div>
                            <label class="block text-xs font-bold uppercase text-slate-400 mb-1">Document Title</label>
                            <input type="text" name="title" placeholder="e.g. Approved TIN ID / SSS Copy" required class="w-full px-4 py-2.5 bg-slate-800 rounded-xl border border-slate-700 text-white text-sm">
                        </div>
                        <div>
                            <label class="block text-xs font-bold uppercase text-slate-400 mb-1">Select File</label>
                            <input type="file" name="completed_files" multiple required class="w-full px-3 py-2 bg-slate-800 rounded-xl border border-slate-700 text-white text-sm">
                        </div>
                    </div>
                    <button type="submit" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-6 py-2.5 rounded-xl text-sm transition">Upload Completed File</button>
                </form>
            </div>
        </main>
    </div>
</body>
</html>`);
}

function renderAdminCustomers(res, customers) {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin Customers - GovAssist PH</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body class="bg-slate-900 text-slate-100 font-sans flex h-screen overflow-hidden">
    <aside class="w-64 bg-slate-800 text-white flex flex-col justify-between hidden md:flex border-r border-slate-700">
        <div>
            <div class="p-6 flex items-center space-x-3 border-b border-slate-700">
                <i class="fa-solid fa-lock text-2xl text-blue-400"></i>
                <span class="font-bold text-xl">Admin Portal</span>
            </div>
            <nav class="p-4 space-y-2">
                <a href="/admin/dashboard" class="flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-slate-700 text-slate-300 transition"><i class="fa-solid fa-gauge w-5"></i><span>Dashboard</span></a>
                <a href="/admin/applications" class="flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-slate-700 text-slate-300 transition"><i class="fa-solid fa-file-lines w-5"></i><span>Applications</span></a>
                <a href="/admin/customers" class="flex items-center space-x-3 px-4 py-3 rounded-xl bg-blue-600 text-white font-medium"><i class="fa-solid fa-users w-5"></i><span>Customers</span></a>
                <a href="/admin/reports" class="flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-slate-700 text-slate-300 transition"><i class="fa-solid fa-chart-pie w-5"></i><span>Reports</span></a>
                <a href="/admin/settings" class="flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-slate-700 text-slate-300 transition"><i class="fa-solid fa-gear w-5"></i><span>Settings</span></a>
            </nav>
        </div>
        <div class="p-4 border-t border-slate-700">
            <a href="/admin/logout" class="flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-red-600/20 text-red-400 transition"><i class="fa-solid fa-right-from-bracket w-5"></i><span>Logout</span></a>
        </div>
    </aside>

    <div class="flex-grow flex flex-col overflow-y-auto">
        <header class="bg-slate-800 shadow-sm px-8 py-4 flex justify-between items-center border-b border-slate-700">
            <h1 class="text-xl font-bold text-white">Registered Customers</h1>
        </header>

        <main class="p-8 max-w-7xl mx-auto w-full">
            <div class="bg-slate-800 rounded-2xl border border-slate-700 shadow-lg overflow-hidden">
                <div class="overflow-x-auto">
                    <table class="w-full text-left border-collapse">
                        <thead>
                            <tr class="bg-slate-900 text-slate-400 text-xs uppercase font-bold border-b border-slate-700">
                                <th class="p-4">Full Name</th>
                                <th class="p-4">Email</th>
                                <th class="p-4">Mobile</th>
                                <th class="p-4">Applications</th>
                                <th class="p-4">Registration Date</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-700 text-sm">
                            ${customers.map(c => `
                                <tr>
                                    <td class="p-4 font-semibold text-white">${c.fullname}</td>
                                    <td class="p-4 text-slate-300">${c.email}</td>
                                    <td class="p-4 text-slate-300">${c.mobile}</td>
                                    <td class="p-4"><span class="px-2.5 py-1 text-xs font-semibold rounded-full bg-blue-900/50 text-blue-300">${c.app_count} Apps</span></td>
                                    <td class="p-4 text-slate-400">${c.created_at}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        </main>
    </div>
</body>
</html>`);
}

function renderAdminSettings(res, settings) {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin Settings - GovAssist PH</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body class="bg-slate-900 text-slate-100 font-sans flex h-screen overflow-hidden">
    <aside class="w-64 bg-slate-800 text-white flex flex-col justify-between hidden md:flex border-r border-slate-700">
        <div>
            <div class="p-6 flex items-center space-x-3 border-b border-slate-700">
                <i class="fa-solid fa-lock text-2xl text-blue-400"></i>
                <span class="font-bold text-xl">Admin Portal</span>
            </div>
            <nav class="p-4 space-y-2">
                <a href="/admin/dashboard" class="flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-slate-700 text-slate-300 transition"><i class="fa-solid fa-gauge w-5"></i><span>Dashboard</span></a>
                <a href="/admin/applications" class="flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-slate-700 text-slate-300 transition"><i class="fa-solid fa-file-lines w-5"></i><span>Applications</span></a>
                <a href="/admin/customers" class="flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-slate-700 text-slate-300 transition"><i class="fa-solid fa-users w-5"></i><span>Customers</span></a>
                <a href="/admin/reports" class="flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-slate-700 text-slate-300 transition"><i class="fa-solid fa-chart-pie w-5"></i><span>Reports</span></a>
                <a href="/admin/settings" class="flex items-center space-x-3 px-4 py-3 rounded-xl bg-blue-600 text-white font-medium"><i class="fa-solid fa-gear w-5"></i><span>Settings</span></a>
            </nav>
        </div>
        <div class="p-4 border-t border-slate-700">
            <a href="/admin/logout" class="flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-red-600/20 text-red-400 transition"><i class="fa-solid fa-right-from-bracket w-5"></i><span>Logout</span></a>
        </div>
    </aside>

    <div class="flex-grow flex flex-col overflow-y-auto">
        <header class="bg-slate-800 shadow-sm px-8 py-4 flex justify-between items-center border-b border-slate-700">
            <h1 class="text-xl font-bold text-white">System Settings & GCash QR</h1>
        </header>

        <main class="p-8 max-w-4xl mx-auto w-full">
            <div class="bg-slate-800 rounded-2xl border border-slate-700 shadow-lg p-8">
                ${req.query.success ? `<div class="bg-emerald-900/50 text-emerald-200 p-3 rounded-xl mb-6 text-sm border border-emerald-700">${req.query.success}</div>` : ''}
                <form action="/admin/settings" method="POST" enctype="multipart/form-data" class="space-y-6">
                    <div class="grid md:grid-cols-2 gap-6">
                        <div>
                            <label class="block text-xs font-bold uppercase text-slate-400 mb-1">Business Name</label>
                            <input type="text" name="business_name" value="${settings.business_name || ''}" class="w-full px-4 py-3 bg-slate-900 rounded-xl border border-slate-700 text-white">
                        </div>
                        <div>
                            <label class="block text-xs font-bold uppercase text-slate-400 mb-1">Contact Number</label>
                            <input type="text" name="contact_number" value="${settings.contact_number || ''}" class="w-full px-4 py-3 bg-slate-900 rounded-xl border border-slate-700 text-white">
                        </div>
                        <div>
                            <label class="block text-xs font-bold uppercase text-slate-400 mb-1">TIN Service Fee (₱)</label>
                            <input type="text" name="tin_fee" value="${settings.tin_fee || '500'}" class="w-full px-4 py-3 bg-slate-900 rounded-xl border border-slate-700 text-white">
                        </div>
                        <div>
                            <label class="block text-xs font-bold uppercase text-slate-400 mb-1">SSS Service Fee (₱)</label>
                            <input type="text" name="sss_fee" value="${settings.sss_fee || '500'}" class="w-full px-4 py-3 bg-slate-900 rounded-xl border border-slate-700 text-white">
                        </div>
                        <div>
                            <label class="block text-xs font-bold uppercase text-slate-400 mb-1">Pag-IBIG Service Fee (₱)</label>
                            <input type="text" name="pagibig_fee" value="${settings.pagibig_fee || '500'}" class="w-full px-4 py-3 bg-slate-900 rounded-xl border border-slate-700 text-white">
                        </div>
                        <div>
                            <label class="block text-xs font-bold uppercase text-slate-400 mb-1">GCash Account Number</label>
                            <input type="text" name="gcash_number" value="${settings.gcash_number || ''}" class="w-full px-4 py-3 bg-slate-900 rounded-xl border border-slate-700 text-white">
                        </div>
                        <div>
                            <label class="block text-xs font-bold uppercase text-slate-400 mb-1">GCash Account Name</label>
                            <input type="text" name="gcash_name" value="${settings.gcash_name || ''}" class="w-full px-4 py-3 bg-slate-900 rounded-xl border border-slate-700 text-white">
                        </div>
                    </div>

                    <div>
                        <label class="block text-xs font-bold uppercase text-slate-400 mb-1">GCash QR Code Image</label>
                        ${settings.gcash_qr ? `<div class="mb-3"><img src="/uploads/${settings.gcash_qr}" class="w-32 h-32 object-cover rounded-xl border border-slate-700"></div>` : ''}
                        <input type="file" name="gcash_qr" accept=".jpg,.jpeg,.png" class="w-full px-4 py-2 bg-slate-900 rounded-xl border border-slate-700 text-white">
                    </div>

                    <button type="submit" class="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl transition shadow-lg">Save Settings</button>
                </form>
            </div>
        </main>
    </div>
</body>
</html>`);
}

function renderAdminReports(res, total, completed, paid, services) {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin Reports - GovAssist PH</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body class="bg-slate-900 text-slate-100 font-sans flex h-screen overflow-hidden">
    <aside class="w-64 bg-slate-800 text-white flex flex-col justify-between hidden md:flex border-r border-slate-700">
        <div>
            <div class="p-6 flex items-center space-x-3 border-b border-slate-700">
                <i class="fa-solid fa-lock text-2xl text-blue-400"></i>
                <span class="font-bold text-xl">Admin Portal</span>
            </div>
            <nav class="p-4 space-y-2">
                <a href="/admin/dashboard" class="flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-slate-700 text-slate-300 transition"><i class="fa-solid fa-gauge w-5"></i><span>Dashboard</span></a>
                <a href="/admin/applications" class="flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-slate-700 text-slate-300 transition"><i class="fa-solid fa-file-lines w-5"></i><span>Applications</span></a>
                <a href="/admin/customers" class="flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-slate-700 text-slate-300 transition"><i class="fa-solid fa-users w-5"></i><span>Customers</span></a>
                <a href="/admin/reports" class="flex items-center space-x-3 px-4 py-3 rounded-xl bg-blue-600 text-white font-medium"><i class="fa-solid fa-chart-pie w-5"></i><span>Reports</span></a>
                <a href="/admin/settings" class="flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-slate-700 text-slate-300 transition"><i class="fa-solid fa-gear w-5"></i><span>Settings</span></a>
            </nav>
        </div>
        <div class="p-4 border-t border-slate-700">
            <a href="/admin/logout" class="flex items-center space-x-3 px-4 py-3 rounded-xl hover:bg-red-600/20 text-red-400 transition"><i class="fa-solid fa-right-from-bracket w-5"></i><span>Logout</span></a>
        </div>
    </aside>

    <div class="flex-grow flex flex-col overflow-y-auto">
        <header class="bg-slate-800 shadow-sm px-8 py-4 flex justify-between items-center border-b border-slate-700">
            <h1 class="text-xl font-bold text-white">System Reports</h1>
            <button onclick="window.print()" class="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-xl text-sm font-bold"><i class="fa-solid fa-print mr-2"></i> Print Report</button>
        </header>

        <main class="p-8 max-w-7xl mx-auto w-full space-y-8">
            <div class="grid md:grid-cols-3 gap-6">
                <div class="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg">
                    <p class="text-xs text-slate-400 uppercase font-bold mb-1">Total Applications</p>
                    <p class="text-3xl font-extrabold text-white">${total}</p>
                </div>
                <div class="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg">
                    <p class="text-xs text-slate-400 uppercase font-bold mb-1">Completed Applications</p>
                    <p class="text-3xl font-extrabold text-emerald-400">${completed}</p>
                </div>
                <div class="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg">
                    <p class="text-xs text-slate-400 uppercase font-bold mb-1">Paid Applications</p>
                    <p class="text-3xl font-extrabold text-blue-400">${paid}</p>
                </div>
            </div>

            <div class="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg">
                <h3 class="font-bold text-lg text-white mb-4">Applications by Service</h3>
                <ul class="space-y-3">
                    ${services.map(s => `
                        <li class="flex justify-between items-center bg-slate-900 p-4 rounded-xl border border-slate-700">
                            <span class="font-semibold text-white">${s.service}</span>
                            <span class="px-3 py-1 bg-blue-900/50 text-blue-300 rounded-full font-bold text-sm">${s.count} Applications</span>
                        </li>
                    `).join('')}
                </ul>
            </div>
        </main>
    </div>
</body>
</html>`);
}

function renderPrintableApplication(res, app, info, parents, spouse, beneficiaries, payment) {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Print Application - ${app.tracking_number}</title>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-white text-slate-900 font-sans p-12">
    <div class="max-w-4xl mx-auto space-y-8">
        <div class="text-center border-b pb-6">
            <h1 class="text-2xl font-extrabold">GovAssist PH - Official Application Summary</h1>
            <p class="text-sm text-slate-600">Service: ${app.service} | Tracking Number: ${app.tracking_number}</p>
            <p class="text-xs text-slate-400">Date Submitted: ${app.created_at}</p>
        </div>

        ${info ? `
            <div>
                <h3 class="font-bold text-lg border-b pb-2 mb-4">Personal & Contact Information</h3>
                <div class="grid grid-cols-2 gap-4 text-sm">
                    <p><strong>Full Name:</strong> ${info.first_name} ${info.middle_name || ''} ${info.last_name} ${info.suffix || ''}</p>
                    <p><strong>Date of Birth:</strong> ${info.dob}</p>
                    <p><strong>Place of Birth:</strong> ${info.pob}</p>
                    <p><strong>Sex / Civil Status:</strong> ${info.sex} / ${info.civil_status}</p>
                    <p><strong>Nationality:</strong> ${info.nationality}</p>
                    <p><strong>Mobile / Email:</strong> ${info.mobile} / ${info.email}</p>
                    <p class="col-span-2"><strong>Address:</strong> ${info.house_no || ''} ${info.street || ''}, Brgy. ${info.barangay}, ${info.municipality}, ${info.province} (${info.zip_code})</p>
                    <p><strong>Employment Status:</strong> ${info.employment_status}</p>
                    <p><strong>Employer / Business:</strong> ${info.employer_name || info.business_name || 'N/A'}</p>
                </div>
            </div>
        ` : ''}

        ${parents ? `
            <div>
                <h3 class="font-bold text-lg border-b pb-2 mb-4">Parents Information</h3>
                <div class="text-sm space-y-1">
                    <p><strong>Mother's Maiden Name:</strong> ${parents.mother_first} ${parents.mother_middle || ''} ${parents.mother_maiden_last} (DOB: ${parents.mother_dob})</p>
                    <p><strong>Father's Name:</strong> ${parents.father_first} ${parents.father_middle || ''} ${parents.father_last} (DOB: ${parents.father_dob})</p>
                </div>
            </div>
        ` : ''}

        ${spouse ? `
            <div>
                <h3 class="font-bold text-lg border-b pb-2 mb-4">Spouse Information</h3>
                <div class="text-sm space-y-1">
                    <p><strong>Spouse Name:</strong> ${spouse.spouse_first} ${spouse.spouse_middle || ''} ${spouse.spouse_last}</p>
                    <p><strong>Date of Birth:</strong> ${spouse.spouse_dob || 'N/A'}</p>
                </div>
            </div>
        ` : ''}

        <div>
            <h3 class="font-bold text-lg border-b pb-2 mb-4">Beneficiaries (${beneficiaries.length})</h3>
            <table class="w-full text-left text-sm border-collapse border">
                <thead>
                    <tr class="bg-slate-100 border-b">
                        <th class="p-2 border">Full Name</th>
                        <th class="p-2 border">Relationship</th>
                        <th class="p-2 border">Date of Birth</th>
                        <th class="p-2 border">Contact</th>
                    </tr>
                </thead>
                <tbody>
                    ${beneficiaries.map(b => `
                        <tr>
                            <td class="p-2 border">${b.fullname}</td>
                            <td class="p-2 border">${b.relationship}</td>
                            <td class="p-2 border">${b.dob}</td>
                            <td class="p-2 border">${b.contact || 'N/A'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>

        <div>
            <h3 class="font-bold text-lg border-b pb-2 mb-4">Payment Information</h3>
            <div class="text-sm space-y-1">
                <p><strong>Method:</strong> ${payment ? payment.payment_method : 'N/A'}</p>
                <p><strong>Amount:</strong> ₱${payment ? payment.amount : 0}.00</p>
                <p><strong>Reference Number:</strong> ${payment && payment.reference_number ? payment.reference_number : 'N/A'}</p>
                <p><strong>Status:</strong> ${payment ? payment.payment_status : 'N/A'}</p>
            </div>
        </div>

        <div class="pt-12 text-center text-xs text-slate-500">
            <p>Generated by GovAssist PH Application Assistance System</p>
        </div>
    </div>
    <script>window.print();</script>
</body>
</html>`);
}

// Start Server
app.listen(PORT, () => {
    console.log(`GovAssist PH System running on port ${PORT}`);
});
