/**
 * BIR/TIN, SSS & PAG-IBIG APPLICATION ASSISTANCE SYSTEM
 * Complete Single-File Express & SQLite Web Application
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
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer Storage Configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, ''));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|pdf/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Only .png, .jpg, .jpeg and .pdf format files are allowed!'));
        }
    }
});

// Middleware Setup
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/uploads', express.static(uploadDir));
app.use(session({
    secret: process.env.SESSION_SECRET || 'gov_assistance_super_secret_key_2026',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// Database Initialization
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
        // Users Table
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            full_name TEXT NOT NULL,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            mobile_number TEXT NOT NULL,
            email TEXT NOT NULL,
            address TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Admin Users Table
        db.run(`CREATE TABLE IF NOT EXISTS admin_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Settings Table
        db.run(`CREATE TABLE IF NOT EXISTS settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT UNIQUE NOT NULL,
            value TEXT NOT NULL
        )`, () => {
            // Seed default settings if empty
            const defaults = [
                ['business_name', 'GovAssist PH - Application Assistance Service'],
                ['contact_number', '+63 912 345 6789'],
                ['email', 'support@govassist.ph'],
                ['address', 'Makati City, Metro Manila, Philippines'],
                ['gcash_name', 'GovAssist Services'],
                ['gcash_number', '09171234567'],
                ['gcash_qr', ''],
                ['payment_instructions', 'Send payment via GCash to the number above, then upload your receipt and reference number.'],
                ['application_instructions', 'Fill out the form completely, upload valid government IDs, and select your payment method.']
            ];
            defaults.forEach(([k, v]) => {
                db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`, [k, v]);
            });
        });

        // Service Fees Table
        db.run(`CREATE TABLE IF NOT EXISTS service_fees (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            service_name TEXT UNIQUE NOT NULL,
            fee REAL NOT NULL
        )`, () => {
            const fees = [
                ['BIR / TIN', 500.00],
                ['SSS', 600.00],
                ['PAG-IBIG', 600.00]
            ];
            fees.forEach(([s, f]) => {
                db.run(`INSERT OR IGNORE INTO service_fees (service_name, fee) VALUES (?, ?)`, [s, f]);
            });
        });

        // Applications Table
        db.run(`CREATE TABLE IF NOT EXISTS applications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            service TEXT NOT NULL,
            tracking_number TEXT UNIQUE NOT NULL,
            first_name TEXT,
            middle_name TEXT,
            last_name TEXT,
            suffix TEXT,
            date_of_birth TEXT,
            place_of_birth TEXT,
            sex TEXT,
            civil_status TEXT,
            nationality TEXT,
            house_unit TEXT,
            street TEXT,
            barangay TEXT,
            municipality_city TEXT,
            province TEXT,
            zip_code TEXT,
            mobile_number TEXT,
            email TEXT,
            mothers_maiden_name TEXT,
            fathers_name TEXT,
            occupation TEXT,
            employer TEXT,
            employer_address TEXT,
            other_info TEXT,
            payment_method TEXT DEFAULT 'CASH',
            payment_status TEXT DEFAULT 'Unpaid',
            amount_to_pay REAL DEFAULT 0,
            gcash_ref_number TEXT,
            gcash_amount_paid REAL,
            gcash_date_paid TEXT,
            payment_proof TEXT,
            application_status TEXT DEFAULT 'Submitted',
            admin_remarks TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )`);

        // Application Documents Table
        db.run(`CREATE TABLE IF NOT EXISTS application_documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            application_id INTEGER NOT NULL,
            doc_type TEXT NOT NULL,
            file_path TEXT NOT NULL,
            original_name TEXT,
            uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (application_id) REFERENCES applications(id)
        )`);

        // Application History Table
        db.run(`CREATE TABLE IF NOT EXISTS application_status_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            application_id INTEGER NOT NULL,
            action TEXT NOT NULL,
            previous_status TEXT,
            new_status TEXT,
            performed_by TEXT,
            remarks TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (application_id) REFERENCES applications(id)
        )`);

        // Notifications Table
        db.run(`CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            message TEXT NOT NULL,
            is_read INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )`);

        // Completed Documents Table
        db.run(`CREATE TABLE IF NOT EXISTS completed_documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            application_id INTEGER NOT NULL,
            file_path TEXT NOT NULL,
            original_name TEXT,
            uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (application_id) REFERENCES applications(id)
        )`);

        // Seed default admin account if none exists
        db.get(`SELECT COUNT(*) as count FROM admin_users`, async (err, row) => {
            if (row && row.count === 0) {
                const adminUser = process.env.ADMIN_USER || 'admin';
                const adminPass = process.env.ADMIN_PASS || 'admin123';
                const hashedPass = await bcrypt.hash(adminPass, 10);
                db.run(`INSERT INTO admin_users (username, password) VALUES (?, ?)`, [adminUser, hashedPass], () => {
                    console.log(`Default Admin Account Created -> Username: ${adminUser}, Password: ${adminPass}`);
                });
            }
        });
    });
}

// Helper: Notification Creator
function createNotification(userId, title, message) {
    db.run(`INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)`, [userId, title, message]);
}

// Helper: History Logger
function logHistory(appId, action, prevStatus, newStatus, performedBy, remarks) {
    db.run(`INSERT INTO application_status_history (application_id, action, previous_status, new_status, performed_by, remarks) VALUES (?, ?, ?, ?, ?, ?)`,
        [appId, action, prevStatus, newStatus, performedBy, remarks]);
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

// Global UI Layout Wrapper
function renderLayout(title, content, role = 'guest', user = null, activeTab = '') {
    const isCustomer = role === 'customer';
    const isAdmin = role === 'admin';

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - GovAssist PH</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <script>
        tailwind.config = {
            theme: {
                extend: {
                    colors: {
                        primary: '#1e40af',
                        secondary: '#0f172a',
                        accent: '#2563eb'
                    }
                }
            }
        }
    </script>
</head>
<body class="bg-slate-50 text-slate-800 font-sans antialiased min-h-screen flex flex-col justify-between">
    <div>
        <div class="bg-amber-500 text-slate-900 text-xs font-semibold py-1.5 px-4 text-center">
            <i class="fa-solid fa-triangle-exclamation mr-1"></i> DISCLAIMER: This system is NOT an official BIR, SSS, or Pag-IBIG website. It is an independent application assistance and document collection service.
        </div>

        <header class="bg-white border-b border-slate-200 sticky top-0 z-50 shadow-sm">
            <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
                <div class="flex items-center space-x-3">
                    <a href="/" class="flex items-center space-x-2">
                        <div class="bg-primary text-white p-2 rounded-lg font-bold"><i class="fa-solid fa-file-shield text-xl"></i></div>
                        <div>
                            <span class="font-bold text-lg text-slate-900 tracking-tight">GovAssist<span class="text-blue-600">PH</span></span>
                            <span class="block text-[10px] text-slate-500 uppercase tracking-widest">Assistance Portal</span>
                        </div>
                    </a>
                </div>

                <nav class="hidden md:flex items-center space-x-6 text-sm font-medium">
                    <a href="/" class="text-slate-600 hover:text-primary">Home</a>
                    <a href="/track" class="text-slate-600 hover:text-primary">Track Application</a>
                    ${isCustomer ? `
                        <a href="/customer/dashboard" class="${activeTab === 'dashboard' ? 'text-primary font-bold' : 'text-slate-600 hover:text-primary'}">Dashboard</a>
                        <a href="/customer/applications" class="${activeTab === 'applications' ? 'text-primary font-bold' : 'text-slate-600 hover:text-primary'}">My Applications</a>
                        <a href="/customer/notifications" class="${activeTab === 'notifications' ? 'text-primary font-bold' : 'text-slate-600 hover:text-primary'}">Notifications</a>
                        <a href="/customer/profile" class="${activeTab === 'profile' ? 'text-primary font-bold' : 'text-slate-600 hover:text-primary'}">Profile</a>
                        <a href="/customer/logout" class="text-red-600 hover:text-red-700 font-semibold"><i class="fa-solid fa-right-from-bracket mr-1"></i> Logout</a>
                    ` : isAdmin ? `
                        <a href="/admin/dashboard" class="${activeTab === 'dashboard' ? 'text-primary font-bold' : 'text-slate-600 hover:text-primary'}">Admin Dashboard</a>
                        <a href="/admin/applications" class="${activeTab === 'applications' ? 'text-primary font-bold' : 'text-slate-600 hover:text-primary'}">Applications</a>
                        <a href="/admin/payments" class="${activeTab === 'payments' ? 'text-primary font-bold' : 'text-slate-600 hover:text-primary'}">Payments</a>
                        <a href="/admin/reports" class="${activeTab === 'reports' ? 'text-primary font-bold' : 'text-slate-600 hover:text-primary'}">Reports</a>
                        <a href="/admin/settings" class="${activeTab === 'settings' ? 'text-primary font-bold' : 'text-slate-600 hover:text-primary'}">Settings</a>
                        <a href="/admin/logout" class="text-red-600 hover:text-red-700 font-semibold"><i class="fa-solid fa-right-from-bracket mr-1"></i> Logout</a>
                    ` : `
                        <a href="/customer/login" class="text-slate-700 hover:text-primary">Login</a>
                        <a href="/customer/register" class="bg-primary text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition">Get Started</a>
                        <a href="/admin/login" class="text-slate-500 hover:text-slate-800 text-xs">Admin Portal</a>
                    `}
                </nav>

                <div class="md:hidden flex items-center space-x-2">
                    ${isCustomer ? '<a href="/customer/dashboard" class="text-primary font-bold text-sm">Dashboard</a> <a href="/customer/logout" class="text-red-600 text-sm">Logout</a>' : 
                      isAdmin ? '<a href="/admin/dashboard" class="text-primary font-bold text-sm">Admin</a> <a href="/admin/logout" class="text-red-600 text-sm">Logout</a>' :
                      '<a href="/customer/login" class="bg-primary text-white text-xs px-3 py-1.5 rounded">Login</a>'}
                </div>
            </div>
        </header>

        <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full flex-grow">
            ${content}
        </main>
    </div>

    <footer class="bg-white border-t border-slate-200 mt-16 text-xs text-slate-500 py-6">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center space-y-4 md:space-y-0">
            <div>
                <p>&copy; 2026 GovAssist PH. All rights reserved.</p>
                <p class="text-amber-600 font-medium mt-1">Independent application assistance provider. Not affiliated with BIR, SSS, or Pag-IBIG.</p>
            </div>
            <div class="flex space-x-6">
                <a href="/" class="hover:text-primary">Home</a>
                <a href="/track" class="hover:text-primary">Track Application</a>
                <a href="/customer/login" class="hover:text-primary">Customer Portal</a>
                <a href="/admin/login" class="hover:text-primary">Admin Portal</a>
            </div>
        </div>
    </footer>
</body>
</html>`;
}

// ==========================================
// PUBLIC ROUTES
// ==========================================

app.get('/', (req, res) => {
    const content = `
        <div class="text-center py-12 max-w-3xl mx-auto">
            <span class="bg-blue-100 text-primary text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">Fast & Secure Processing Assistance</span>
            <h1 class="text-4xl sm:text-5xl font-extrabold text-slate-900 mt-4 tracking-tight">Government Application Assistance Made Easy</h1>
            <p class="text-lg text-slate-600 mt-4">We assist you with paperwork, document collection, form verification, and status tracking for <strong>BIR / TIN</strong>, <strong>SSS</strong>, and <strong>Pag-IBIG</strong> applications.</p>
            
            <div class="mt-8 flex justify-center space-x-4">
                <a href="/customer/register" class="bg-primary text-white font-semibold px-6 py-3 rounded-xl shadow hover:bg-blue-700 transition">Start New Application</a>
                <a href="/track" class="bg-white border border-slate-300 text-slate-700 font-semibold px-6 py-3 rounded-xl hover:bg-slate-50 transition">Track Application</a>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mt-16 text-left">
                <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                    <div class="text-blue-600 text-2xl font-bold mb-2"><i class="fa-solid fa-file-invoice"></i> BIR / TIN</div>
                    <p class="text-slate-600 text-sm">Get assistance in securing your Taxpayer Identification Number (TIN) and registration forms effortlessly.</p>
                </div>
                <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                    <div class="text-blue-600 text-2xl font-bold mb-2"><i class="fa-solid fa-shield-halved"></i> SSS</div>
                    <p class="text-slate-600 text-sm">Assistance for Social Security System membership registration, number requests, and document filing.</p>
                </div>
                <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                    <div class="text-blue-600 text-2xl font-bold mb-2"><i class="fa-solid fa-house-chimney"></i> Pag-IBIG</div>
                    <p class="text-slate-600 text-sm">Seamless support for Pag-IBIG Fund (HDMF) membership, MID number registration, and records.</p>
                </div>
            </div>

            <div class="mt-12 bg-amber-50 border border-amber-200 p-4 rounded-xl text-xs text-amber-800 text-left">
                <strong>Government Disclaimer:</strong> This system is NOT an official BIR, SSS, or Pag-IBIG website. It is an independent application assistance, document collection, processing, payment, and tracking system.
            </div>
        </div>
    `;
    res.send(renderLayout('Home', content, req.session.user ? 'customer' : 'guest'));
});

// Public Tracking Page (/track)
app.get('/track', (req, res) => {
    const trackingNo = req.query.tracking || '';
    let searchResult = null;
    let historyList = [];
    let errorMessage = '';

    if (trackingNo) {
        db.get(`SELECT * FROM applications WHERE tracking_number = ?`, [trackingNo.trim()], (err, app) => {
            if (app) {
                searchResult = app;
                db.all(`SELECT * FROM application_status_history WHERE application_id = ? ORDER BY created_at DESC`, [app.id], (err, history) => {
                    historyList = history || [];
                    renderTrackPage(res, searchResult, historyList, trackingNo, errorMessage);
                });
            } else {
                errorMessage = 'No application found with this tracking number.';
                renderTrackPage(res, null, [], trackingNo, errorMessage);
            }
        });
    } else {
        renderTrackPage(res, null, [], trackingNo, '');
    }
});

function renderTrackPage(res, searchResult, historyList, trackingNo, errorMessage) {
    const content = `
        <div class="max-w-2xl mx-auto py-8">
            <h1 class="text-3xl font-bold text-slate-900 text-center mb-2">Track Application Status</h1>
            <p class="text-slate-600 text-center mb-8">Enter your unique tracking number to view real-time progress.</p>

            <form action="/track" method="GET" class="flex gap-2 mb-8">
                <input type="text" name="tracking" value="${trackingNo}" placeholder="e.g. TIN-20260901-0001" required 
                    class="flex-grow border border-slate-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary uppercase font-mono">
                <button type="submit" class="bg-primary text-white px-6 py-3 rounded-xl font-semibold hover:bg-blue-700 transition">Track</button>
            </form>

            ${errorMessage ? `<div class="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl text-center mb-6">${errorMessage}</div>` : ''}

            ${searchResult ? `
                <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6">
                    <div class="flex justify-between items-start border-b border-slate-100 pb-4">
                        <div>
                            <span class="text-xs uppercase font-bold text-slate-400">Tracking Number</span>
                            <h2 class="text-xl font-mono font-bold text-primary">${searchResult.tracking_number}</h2>
                        </div>
                        <div class="text-right">
                            <span class="text-xs uppercase font-bold text-slate-400">Current Status</span>
                            <div><span class="px-3 py-1 bg-blue-100 text-blue-800 text-xs font-bold rounded-full">${searchResult.application_status}</span></div>
                        </div>
                    </div>

                    <div class="grid grid-cols-2 gap-4 text-sm">
                        <div>
                            <span class="text-slate-500 block text-xs">Service Type</span>
                            <strong class="text-slate-800">${searchResult.service}</strong>
                        </div>
                        <div>
                            <span class="text-slate-500 block text-xs">Date Submitted</span>
                            <strong class="text-slate-800">${searchResult.created_at}</strong>
                        </div>
                        <div>
                            <span class="text-slate-500 block text-xs">Payment Status</span>
                            <span class="px-2 py-0.5 bg-slate-100 text-slate-800 text-xs font-bold rounded">${searchResult.payment_status}</span>
                        </div>
                    </div>

                    ${searchResult.admin_remarks ? `
                        <div class="bg-blue-50 border border-blue-200 p-4 rounded-xl">
                            <span class="text-xs font-bold text-blue-800 uppercase block mb-1">Admin Remarks / Instructions</span>
                            <p class="text-sm text-blue-900">${searchResult.admin_remarks}</p>
                        </div>
                    ` : ''}

                    <div>
                        <h3 class="font-bold text-slate-800 mb-4">Status History Timeline</h3>
                        <div class="space-y-3 border-l-2 border-slate-200 pl-4 ml-2">
                            ${historyList.map(h => `
                                <div class="relative">
                                    <div class="absolute -left-[21px] top-1 w-3 h-3 bg-primary rounded-full border-2 border-white"></div>
                                    <div class="text-xs text-slate-400">${h.created_at}</div>
                                    <div class="font-semibold text-slate-800 text-sm">${h.action} (${h.new_status || 'Update'})</div>
                                    ${h.remarks ? `<div class="text-xs text-slate-600 mt-0.5">${h.remarks}</div>` : ''}
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
            ` : ''}
        </div>
    `;
    res.send(renderLayout('Track Application', content, 'guest'));
}

// ==========================================
// CUSTOMER AUTHENTICATION & PORTAL
// ==========================================

app.get('/customer/register', (req, res) => {
    const content = `
        <div class="max-w-md mx-auto bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
            <h1 class="text-2xl font-bold text-slate-900 mb-2 text-center">Customer Registration</h1>
            <p class="text-slate-500 text-sm mb-6 text-center">Create your account to submit and track government applications.</p>
            
            <form action="/customer/register" method="POST" class="space-y-4">
                <div>
                    <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Full Name</label>
                    <input type="text" name="full_name" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary">
                </div>
                <div>
                    <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Username</label>
                    <input type="text" name="username" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary">
                </div>
                <div>
                    <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Password</label>
                    <input type="password" name="password" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary">
                </div>
                <div>
                    <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Mobile Number</label>
                    <input type="text" name="mobile_number" required placeholder="09123456789" class="w-full border border-slate-300 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary">
                </div>
                <div>
                    <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Email Address</label>
                    <input type="email" name="email" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary">
                </div>
                <button type="submit" class="w-full bg-primary text-white font-semibold py-3 rounded-xl hover:bg-blue-700 transition">Register Account</button>
            </form>

            <p class="text-center text-sm text-slate-500 mt-6">Already have an account? <a href="/customer/login" class="text-primary font-semibold hover:underline">Login here</a></p>
        </div>
    `;
    res.send(renderLayout('Customer Registration', content, 'guest'));
});

app.post('/customer/register', async (req, res) => {
    const { full_name, username, password, mobile_number, email } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.run(`INSERT INTO users (full_name, username, password, mobile_number, email) VALUES (?, ?, ?, ?, ?)`,
            [full_name, username, hashedPassword, mobile_number, email], (err) => {
                if (err) {
                    return res.send(renderLayout('Error', `<div class="p-8 text-center"><h2 class="text-xl font-bold text-red-600">Registration Failed</h2><p class="text-slate-600 mt-2">Username or email may already be in use.</p><a href="/customer/register" class="mt-4 inline-block bg-primary text-white px-4 py-2 rounded">Try Again</a></div>`, 'guest'));
                }
                res.redirect('/customer/login');
            });
    } catch (e) {
        res.redirect('/customer/register');
    }
});

app.get('/customer/login', (req, res) => {
    const content = `
        <div class="max-w-md mx-auto bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
            <h1 class="text-2xl font-bold text-slate-900 mb-2 text-center">Customer Login</h1>
            <p class="text-slate-500 text-sm mb-6 text-center">Access your application dashboard.</p>
            
            <form action="/customer/login" method="POST" class="space-y-4">
                <div>
                    <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Username</label>
                    <input type="text" name="username" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary">
                </div>
                <div>
                    <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Password</label>
                    <input type="password" name="password" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary">
                </div>
                <button type="submit" class="w-full bg-primary text-white font-semibold py-3 rounded-xl hover:bg-blue-700 transition">Login</button>
            </form>

            <p class="text-center text-sm text-slate-500 mt-6">Don't have an account? <a href="/customer/register" class="text-primary font-semibold hover:underline">Register here</a></p>
        </div>
    `;
    res.send(renderLayout('Customer Login', content, 'guest'));
});

app.post('/customer/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
        if (user && await bcrypt.compare(password, user.password)) {
            req.session.user = user;
            res.redirect('/customer/dashboard');
        } else {
            res.send(renderLayout('Login Error', `<div class="p-8 text-center"><h2 class="text-xl font-bold text-red-600">Invalid Credentials</h2><p class="text-slate-600 mt-2">Please check your username and password.</p><a href="/customer/login" class="mt-4 inline-block bg-primary text-white px-4 py-2 rounded">Back to Login</a></div>`, 'guest'));
        }
    });
});

app.get('/customer/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
});

// Customer Dashboard
app.get('/customer/dashboard', requireCustomer, (req, res) => {
    const userId = req.session.user.id;
    db.all(`SELECT * FROM applications WHERE user_id = ?`, [userId], (err, apps) => {
        const total = apps.length;
        const pending = apps.filter(a => ['Submitted', 'Payment Pending', 'Payment Verification', 'Under Review', 'Need Correction'].includes(a.application_status)).length;
        const processing = apps.filter(a => a.application_status === 'Processing').length;
        const completed = apps.filter(a => ['Ready', 'Completed'].includes(a.application_status)).length;

        db.all(`SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 5`, [userId], (err, notifs) => {
            db.get(`SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0`, [userId], (err, unreadRow) => {
                const unreadCount = unreadRow ? unreadRow.count : 0;

                const content = `
                    <div class="space-y-8">
                        <div class="bg-primary text-white p-6 rounded-2xl shadow-sm flex flex-col md:flex-row justify-between items-center">
                            <div>
                                <h1 class="text-2xl font-bold">Welcome back, ${req.session.user.full_name}!</h1>
                                <p class="text-blue-100 text-sm mt-1">Manage your BIR, SSS, and Pag-IBIG applications in one secure place.</p>
                            </div>
                            <div class="mt-4 md:mt-0">
                                <a href="/customer/applications/new" class="bg-white text-primary font-bold px-5 py-2.5 rounded-xl shadow hover:bg-blue-50 transition"><i class="fa-solid fa-plus mr-1"></i> New Application</a>
                            </div>
                        </div>

                        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                                <span class="text-xs uppercase font-bold text-slate-400">Total Applications</span>
                                <div class="text-3xl font-extrabold text-slate-900 mt-1">${total}</div>
                            </div>
                            <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                                <span class="text-xs uppercase font-bold text-amber-500">Pending / Review</span>
                                <div class="text-3xl font-extrabold text-amber-600 mt-1">${pending}</div>
                            </div>
                            <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                                <span class="text-xs uppercase font-bold text-blue-500">Processing</span>
                                <div class="text-3xl font-extrabold text-blue-600 mt-1">${processing}</div>
                            </div>
                            <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                                <span class="text-xs uppercase font-bold text-emerald-500">Completed</span>
                                <div class="text-3xl font-extrabold text-emerald-600 mt-1">${completed}</div>
                            </div>
                        </div>

                        <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
                            <div class="md:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                                <div class="flex justify-between items-center mb-4">
                                    <h2 class="font-bold text-slate-900">Recent Applications</h2>
                                    <a href="/customer/applications" class="text-primary text-sm font-semibold hover:underline">View All</a>
                                </div>
                                ${apps.length === 0 ? `
                                    <p class="text-slate-500 text-sm py-8 text-center">No applications submitted yet.</p>
                                ` : `
                                    <div class="overflow-x-auto">
                                        <table class="w-full text-left text-sm">
                                            <thead class="bg-slate-100 text-slate-600 uppercase text-xs">
                                                <tr>
                                                    <th class="p-3 rounded-l-lg">Tracking #</th>
                                                    <th class="p-3">Service</th>
                                                    <th class="p-3">Status</th>
                                                    <th class="p-3 rounded-r-lg">Action</th>
                                                </tr>
                                            </thead>
                                            <tbody class="divide-y divide-slate-100">
                                                ${apps.slice(0, 5).map(a => `
                                                    <tr>
                                                        <td class="p-3 font-mono font-bold text-primary">${a.tracking_number}</td>
                                                        <td class="p-3">${a.service}</td>
                                                        <td class="p-3"><span class="px-2 py-0.5 bg-slate-100 text-slate-800 text-xs font-semibold rounded">${a.application_status}</span></td>
                                                        <td class="p-3"><a href="/customer/applications/${a.id}" class="text-primary font-semibold hover:underline">View Details</a></td>
                                                    </tr>
                                                `).join('')}
                                            </tbody>
                                        </table>
                                    </div>
                                `}
                            </div>

                            <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                                <div class="flex justify-between items-center mb-4">
                                    <h2 class="font-bold text-slate-900">Notifications</h2>
                                    ${unreadCount > 0 ? `<span class="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full font-bold">${unreadCount} unread</span>` : ''}
                                </div>
                                <div class="space-y-3">
                                    ${notifs.length === 0 ? '<p class="text-slate-500 text-sm">No notifications.</p>' : notifs.map(n => `
                                        <div class="p-3 bg-slate-50 rounded-xl border border-slate-100">
                                            <div class="font-bold text-xs text-slate-800">${n.title}</div>
                                            <div class="text-xs text-slate-600 mt-1">${n.message}</div>
                                            <div class="text-[10px] text-slate-400 mt-2">${n.created_at}</div>
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        </div>
                    </div>
                `;
                res.send(renderLayout('Customer Dashboard', content, 'customer', req.session.user, 'dashboard'));
            });
        });
    });
});

// New Application Form & Submission
app.get('/customer/applications/new', requireCustomer, (req, res) => {
    db.all(`SELECT * FROM service_fees`, (err, fees) => {
        const feeMap = {};
        fees.forEach(f => feeMap[f.service_name] = f.fee);

        const content = `
            <div class="max-w-3xl mx-auto bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
                <h1 class="text-2xl font-bold text-slate-900 mb-2">New Government Service Application</h1>
                <p class="text-slate-500 text-sm mb-6">Fill out the required information and upload necessary documents for assistance.</p>
                
                <form action="/customer/applications/new" method="POST" enctype="multipart/form-data" class="space-y-6">
                    <div>
                        <label class="block text-xs font-bold uppercase text-slate-600 mb-2">Select Service</label>
                        <select name="service" id="serviceSelect" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary font-semibold text-primary">
                            <option value="BIR / TIN">BIR / TIN Assistance (Fee: ₱${feeMap['BIR / TIN'] || 500})</option>
                            <option value="SSS">SSS Assistance (Fee: ₱${feeMap['SSS'] || 600})</option>
                            <option value="PAG-IBIG">Pag-IBIG Assistance (Fee: ₱${feeMap['PAG-IBIG'] || 600})</option>
                        </select>
                    </div>

                    <div class="border-t border-slate-200 pt-6">
                        <h3 class="font-bold text-slate-800 mb-4 text-lg">Personal Information</h3>
                        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div>
                                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">First Name</label>
                                <input type="text" name="first_name" required class="w-full border border-slate-300 rounded-xl px-4 py-2">
                            </div>
                            <div>
                                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Middle Name</label>
                                <input type="text" name="middle_name" class="w-full border border-slate-300 rounded-xl px-4 py-2">
                            </div>
                            <div>
                                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Last Name</label>
                                <input type="text" name="last_name" required class="w-full border border-slate-300 rounded-xl px-4 py-2">
                            </div>
                        </div>

                        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
                            <div>
                                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Suffix (Jr., III)</label>
                                <input type="text" name="suffix" class="w-full border border-slate-300 rounded-xl px-4 py-2">
                            </div>
                            <div>
                                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Date of Birth</label>
                                <input type="date" name="date_of_birth" required class="w-full border border-slate-300 rounded-xl px-4 py-2">
                            </div>
                            <div>
                                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Place of Birth</label>
                                <input type="text" name="place_of_birth" required class="w-full border border-slate-300 rounded-xl px-4 py-2">
                            </div>
                        </div>

                        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
                            <div>
                                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Sex</label>
                                <select name="sex" required class="w-full border border-slate-300 rounded-xl px-4 py-2">
                                    <option value="Male">Male</option>
                                    <option value="Female">Female</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Civil Status</label>
                                <select name="civil_status" required class="w-full border border-slate-300 rounded-xl px-4 py-2">
                                    <option value="Single">Single</option>
                                    <option value="Married">Married</option>
                                    <option value="Widowed">Widowed</option>
                                    <option value="Separated">Separated</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Nationality</label>
                                <input type="text" name="nationality" value="Filipino" required class="w-full border border-slate-300 rounded-xl px-4 py-2">
                            </div>
                        </div>
                    </div>

                    <div class="border-t border-slate-200 pt-6">
                        <h3 class="font-bold text-slate-800 mb-4 text-lg">Complete Address</h3>
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">House / Unit Number</label>
                                <input type="text" name="house_unit" required class="w-full border border-slate-300 rounded-xl px-4 py-2">
                            </div>
                            <div>
                                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Street</label>
                                <input type="text" name="street" required class="w-full border border-slate-300 rounded-xl px-4 py-2">
                            </div>
                        </div>
                        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
                            <div>
                                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Barangay</label>
                                <input type="text" name="barangay" required class="w-full border border-slate-300 rounded-xl px-4 py-2">
                            </div>
                            <div>
                                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Municipality / City</label>
                                <input type="text" name="municipality_city" required class="w-full border border-slate-300 rounded-xl px-4 py-2">
                            </div>
                            <div>
                                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Province</label>
                                <input type="text" name="province" required class="w-full border border-slate-300 rounded-xl px-4 py-2">
                            </div>
                        </div>
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                            <div>
                                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">ZIP Code</label>
                                <input type="text" name="zip_code" required class="w-full border border-slate-300 rounded-xl px-4 py-2">
                            </div>
                        </div>
                    </div>

                    <div class="border-t border-slate-200 pt-6">
                        <h3 class="font-bold text-slate-800 mb-4 text-lg">Contact & Family Information</h3>
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Mobile Number</label>
                                <input type="text" name="mobile_number" required class="w-full border border-slate-300 rounded-xl px-4 py-2">
                            </div>
                            <div>
                                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Email Address</label>
                                <input type="email" name="email" required class="w-full border border-slate-300 rounded-xl px-4 py-2">
                            </div>
                        </div>
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                            <div>
                                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Mother's Maiden Name</label>
                                <input type="text" name="mothers_maiden_name" required class="w-full border border-slate-300 rounded-xl px-4 py-2">
                            </div>
                            <div>
                                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Father's Name</label>
                                <input type="text" name="fathers_name" required class="w-full border border-slate-300 rounded-xl px-4 py-2">
                            </div>
                        </div>
                        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
                            <div>
                                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Occupation</label>
                                <input type="text" name="occupation" class="w-full border border-slate-300 rounded-xl px-4 py-2">
                            </div>
                            <div>
                                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Employer (if employed)</label>
                                <input type="text" name="employer" class="w-full border border-slate-300 rounded-xl px-4 py-2">
                            </div>
                            <div>
                                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Employer Address</label>
                                <input type="text" name="employer_address" class="w-full border border-slate-300 rounded-xl px-4 py-2">
                            </div>
                        </div>
                    </div>

                    <div class="border-t border-slate-200 pt-6">
                        <h3 class="font-bold text-slate-800 mb-4 text-lg">Document Uploads</h3>
                        <div class="space-y-4">
                            <div>
                                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Valid Government ID (National ID, Driver's License, Passport, etc.) *</label>
                                <input type="file" name="valid_id" required accept=".jpg,.jpeg,.png,.pdf" class="w-full border border-slate-300 rounded-xl p-2 text-sm bg-slate-50">
                            </div>
                            <div>
                                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Clear Photo of Customer Holding the Same ID *</label>
                                <input type="file" name="photo_holding_id" required accept=".jpg,.jpeg,.png,.pdf" class="w-full border border-slate-300 rounded-xl p-2 text-sm bg-slate-50">
                            </div>
                            <div>
                                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">ID Picture / Profile Picture *</label>
                                <input type="file" name="id_picture" required accept=".jpg,.jpeg,.png,.pdf" class="w-full border border-slate-300 rounded-xl p-2 text-sm bg-slate-50">
                            </div>
                            <div>
                                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Additional Supporting Document (Optional)</label>
                                <input type="file" name="additional_doc" accept=".jpg,.jpeg,.png,.pdf" class="w-full border border-slate-300 rounded-xl p-2 text-sm bg-slate-50">
                            </div>
                        </div>
                    </div>

                    <div class="border-t border-slate-200 pt-6">
                        <h3 class="font-bold text-slate-800 mb-4 text-lg">Payment Method</h3>
                        <div class="flex space-x-6">
                            <label class="flex items-center space-x-2 font-semibold">
                                <input type="radio" name="payment_method" value="CASH" checked class="text-primary">
                                <span>Cash Payment</span>
                            </label>
                            <label class="flex items-center space-x-2 font-semibold">
                                <input type="radio" name="payment_method" value="GCASH" class="text-primary">
                                <span>GCash</span>
                            </label>
                        </div>
                    </div>

                    <div class="border-t border-slate-200 pt-6">
                        <label class="flex items-start space-x-3 cursor-pointer">
                            <input type="checkbox" required class="mt-1 text-primary rounded">
                            <span class="text-sm font-semibold text-slate-800">I confirm that the information and documents I provided are accurate and true.</span>
                        </label>
                    </div>

                    <button type="submit" class="w-full bg-primary text-white font-bold py-3.5 rounded-xl hover:bg-blue-700 transition shadow">Submit Application</button>
                </form>
            </div>
        `;
        res.send(renderLayout('New Application', content, 'customer', req.session.user, 'applications'));
    });
});

app.post('/customer/applications/new', requireCustomer, upload.fields([
    { name: 'valid_id', maxCount: 1 },
    { name: 'photo_holding_id', maxCount: 1 },
    { name: 'id_picture', maxCount: 1 },
    { name: 'additional_doc', maxCount: 1 }
]), (req, res) => {
    const userId = req.session.user.id;
    const body = req.body;
    const service = body.service;

    // Fetch fee
    db.get(`SELECT fee FROM service_fees WHERE service_name = ?`, [service], (err, feeRow) => {
        const amountToPay = feeRow ? feeRow.fee : 500.00;

        // Generate unique tracking number (e.g., TIN-20260901-0001)
        const prefixMap = { 'BIR / TIN': 'TIN', 'SSS': 'SSS', 'PAG-IBIG': 'PAGIBIG' };
        const prefix = prefixMap[service] || 'GOV';
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');

        db.get(`SELECT COUNT(*) as cnt FROM applications WHERE service = ?`, [service], (err, row) => {
            const seq = (row ? row.cnt + 1 : 1).toString().padStart(4, '0');
            const trackingNumber = `${prefix}-${dateStr}-${seq}`;

            db.run(`INSERT INTO applications (
                user_id, service, tracking_number, first_name, middle_name, last_name, suffix,
                date_of_birth, place_of_birth, sex, civil_status, nationality,
                house_unit, street, barangay, municipality_city, province, zip_code,
                mobile_number, email, mothers_maiden_name, fathers_name, occupation,
                employer, employer_address, payment_method, amount_to_pay, application_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Submitted')`,
            [
                userId, service, trackingNumber, body.first_name, body.middle_name, body.last_name, body.suffix,
                body.date_of_birth, body.place_of_birth, body.sex, body.civil_status, body.nationality,
                body.house_unit, body.street, body.barangay, body.municipality_city, body.province, body.zip_code,
                body.mobile_number, body.email, body.mothers_maiden_name, body.fathers_name, body.occupation,
                body.employer, body.employer_address, body.payment_method, amountToPay
            ], function(err) {
                if (err) {
                    return res.send(renderLayout('Error', `<div class="p-8 text-center"><h2 class="text-xl font-bold text-red-600">Submission Error</h2><p class="text-slate-600 mt-2">${err.message}</p><a href="/customer/applications/new" class="mt-4 inline-block bg-primary text-white px-4 py-2 rounded">Back</a></div>`, 'customer', req.session.user));
                }

                const appId = this.lastID;

                // Save files
                if (req.files) {
                    if (req.files['valid_id']) {
                        db.run(`INSERT INTO application_documents (application_id, doc_type, file_path, original_name) VALUES (?, 'Valid ID', ?, ?)`,
                            [appId, req.files['valid_id'][0].path.replace(__dirname, ''), req.files['valid_id'][0].originalname]);
                    }
                    if (req.files['photo_holding_id']) {
                        db.run(`INSERT INTO application_documents (application_id, doc_type, file_path, original_name) VALUES (?, 'Photo Holding ID', ?, ?)`,
                            [appId, req.files['photo_holding_id'][0].path.replace(__dirname, ''), req.files['photo_holding_id'][0].originalname]);
                    }
                    if (req.files['id_picture']) {
                        db.run(`INSERT INTO application_documents (application_id, doc_type, file_path, original_name) VALUES (?, 'ID Picture', ?, ?)`,
                            [appId, req.files['id_picture'][0].path.replace(__dirname, ''), req.files['id_picture'][0].originalname]);
                    }
                    if (req.files['additional_doc']) {
                        db.run(`INSERT INTO application_documents (application_id, doc_type, file_path, original_name) VALUES (?, 'Additional Document', ?, ?)`,
                            [appId, req.files['additional_doc'][0].path.replace(__dirname, ''), req.files['additional_doc'][0].originalname]);
                    }
                }

                logHistory(appId, 'Application Submitted', null, 'Submitted', 'Customer', 'Application successfully created and submitted.');
                createNotification(userId, 'Application Submitted', `Your application for ${service} has been successfully submitted. Tracking #: ${trackingNumber}`);

                res.redirect(`/customer/applications/${appId}`);
            });
        });
    });
});

// My Applications List
app.get('/customer/applications', requireCustomer, (req, res) => {
    const userId = req.session.user.id;
    db.all(`SELECT * FROM applications WHERE user_id = ? ORDER BY created_at DESC`, [userId], (err, apps) => {
        const content = `
            <div class="space-y-6">
                <div class="flex justify-between items-center">
                    <div>
                        <h1 class="text-2xl font-bold text-slate-900">My Applications</h1>
                        <p class="text-slate-500 text-sm">View and track all your government service requests.</p>
                    </div>
                    <a href="/customer/applications/new" class="bg-primary text-white font-semibold px-4 py-2 rounded-xl shadow hover:bg-blue-700 transition text-sm"><i class="fa-solid fa-plus mr-1"></i> New Application</a>
                </div>

                <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <table class="w-full text-left text-sm">
                        <thead class="bg-slate-100 text-slate-600 uppercase text-xs">
                            <tr>
                                <th class="p-4">Tracking Number</th>
                                <th class="p-4">Service</th>
                                <th class="p-4">Date Submitted</th>
                                <th class="p-4">Payment Status</th>
                                <th class="p-4">Application Status</th>
                                <th class="p-4">Action</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100">
                            ${apps.length === 0 ? `<tr><td colspan="6" class="p-8 text-center text-slate-500">No applications found.</td></tr>` : apps.map(a => `
                                <tr>
                                    <td class="p-4 font-mono font-bold text-primary">${a.tracking_number}</td>
                                    <td class="p-4 font-semibold text-slate-800">${a.service}</td>
                                    <td class="p-4 text-slate-600 text-xs">${a.created_at}</td>
                                    <td class="p-4"><span class="px-2.5 py-1 bg-slate-100 text-slate-800 text-xs font-semibold rounded">${a.payment_status}</span></td>
                                    <td class="p-4"><span class="px-2.5 py-1 bg-blue-100 text-blue-800 text-xs font-semibold rounded">${a.application_status}</span></td>
                                    <td class="p-4"><a href="/customer/applications/${a.id}" class="text-primary font-semibold hover:underline">View Details</a></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
        res.send(renderLayout('My Applications', content, 'customer', req.session.user, 'applications'));
    });
});

// Application Details View & Payment Submission
app.get('/customer/applications/:id', requireCustomer, (req, res) => {
    const appId = req.params.id;
    const userId = req.session.user.id;

    db.get(`SELECT * FROM applications WHERE id = ? AND user_id = ?`, [appId, userId], (err, app) => {
        if (!app) {
            return res.send(renderLayout('Error', `<div class="p-8 text-center"><h2 class="text-xl font-bold text-red-600">Access Denied</h2><p class="text-slate-600 mt-2">Application not found or you do not have permission to view it.</p></div>`, 'customer', req.session.user));
        }

        db.all(`SELECT * FROM application_documents WHERE application_id = ?`, [appId], (err, docs) => {
            db.all(`SELECT * FROM completed_documents WHERE application_id = ?`, [appId], (err, completedDocs) => {
                db.all(`SELECT * FROM application_status_history WHERE application_id = ? ORDER BY created_at DESC`, [appId], (err, history) => {
                    db.get(`SELECT * FROM settings WHERE key IN ('gcash_name', 'gcash_number', 'gcash_qr', 'payment_instructions')`, (err, settingsRows) => {
                        // Gather settings into map
                        db.all(`SELECT * FROM settings`, (err, allSettings) => {
                            const settingsMap = {};
                            allSettings.forEach(s => settingsMap[s.key] = s.value);

                            const content = `
                                <div class="space-y-8 max-w-4xl mx-auto">
                                    <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 flex flex-col md:flex-row justify-between items-start md:items-center">
                                        <div>
                                            <span class="text-xs uppercase font-bold text-slate-400">Tracking Number</span>
                                            <h1 class="text-2xl font-mono font-bold text-primary">${app.tracking_number}</h1>
                                            <p class="text-slate-600 text-sm mt-1">Service: <strong>${app.service}</strong> | Submitted: ${app.created_at}</p>
                                        </div>
                                        <div class="mt-4 md:mt-0 text-right">
                                            <span class="text-xs uppercase font-bold text-slate-400 block mb-1">Status</span>
                                            <span class="px-3 py-1 bg-blue-100 text-blue-800 text-xs font-bold rounded-full">${app.application_status}</span>
                                        </div>
                                    </div>

                                    ${app.admin_remarks ? `
                                        <div class="bg-amber-50 border border-amber-200 p-5 rounded-2xl">
                                            <h3 class="font-bold text-amber-800 text-sm uppercase mb-1">Admin Remarks / Correction Request</h3>
                                            <p class="text-amber-900 text-sm">${app.admin_remarks}</p>
                                        </div>
                                    ` : ''}

                                    <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                                        <h3 class="font-bold text-slate-900 text-lg mb-4">Payment Information</h3>
                                        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                                            <div>
                                                <span class="text-xs text-slate-400 block uppercase font-bold">Amount to Pay</span>
                                                <strong class="text-xl text-slate-900">₱${app.amount_to_pay.toFixed(2)}</strong>
                                            </div>
                                            <div>
                                                <span class="text-xs text-slate-400 block uppercase font-bold">Payment Method</span>
                                                <strong class="text-slate-800">${app.payment_method}</strong>
                                            </div>
                                            <div>
                                                <span class="text-xs text-slate-400 block uppercase font-bold">Payment Status</span>
                                                <span class="px-2.5 py-1 bg-slate-100 text-slate-800 text-xs font-semibold rounded">${app.payment_status}</span>
                                            </div>
                                        </div>

                                        ${app.payment_status === 'Unpaid' || app.payment_status === 'Rejected' ? `
                                            <div class="border-t border-slate-100 pt-6">
                                                <h4 class="font-bold text-slate-800 mb-2">Submit Payment</h4>
                                                <p class="text-xs text-slate-600 mb-4">${settingsMap['payment_instructions']}</p>
                                                
                                                ${app.payment_method === 'GCash' ? `
                                                    <div class="bg-slate-50 p-4 rounded-xl border border-slate-200 mb-4 max-w-sm">
                                                        <p class="text-xs font-bold text-slate-700">GCash Name: ${settingsMap['gcash_name']}</p>
                                                        <p class="text-xs font-bold text-slate-700 mb-2">GCash Number: ${settingsMap['gcash_number']}</p>
                                                        ${settingsMap['gcash_qr'] ? `<img src="${settingsMap['gcash_qr']}" alt="GCash QR" class="w-48 h-48 mx-auto rounded shadow">` : ''}
                                                    </div>
                                                ` : ''}

                                                <form action="/customer/applications/${app.id}/pay" method="POST" enctype="multipart/form-data" class="space-y-4 max-w-md">
                                                    <div>
                                                        <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Reference Number *</label>
                                                        <input type="text" name="gcash_ref_number" required class="w-full border border-slate-300 rounded-xl px-4 py-2">
                                                    </div>
                                                    <div>
                                                        <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Amount Paid *</label>
                                                        <input type="number" step="0.01" name="gcash_amount_paid" required value="${app.amount_to_pay}" class="w-full border border-slate-300 rounded-xl px-4 py-2">
                                                    </div>
                                                    <div>
                                                        <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Date & Time Paid *</label>
                                                        <input type="datetime-local" name="gcash_date_paid" required class="w-full border border-slate-300 rounded-xl px-4 py-2">
                                                    </div>
                                                    <div>
                                                        <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Payment Receipt / Screenshot *</label>
                                                        <input type="file" name="payment_proof" required accept=".jpg,.jpeg,.png,.pdf" class="w-full border border-slate-300 rounded-xl p-2 text-sm bg-slate-50">
                                                    </div>
                                                    <button type="submit" class="bg-primary text-white font-bold px-6 py-2.5 rounded-xl hover:bg-blue-700 transition">Submit Payment Proof</button>
                                                </form>
                                            </div>
                                        ` : `
                                            ${app.payment_proof ? `
                                                <div class="mt-4">
                                                    <span class="text-xs font-bold text-slate-500 block mb-1">Payment Proof Uploaded</span>
                                                    <a href="${app.payment_proof}" target="_blank" class="text-primary font-semibold text-sm underline"><i class="fa-solid fa-file-image mr-1"></i> View Submitted Receipt</a>
                                                </div>
                                            ` : ''}
                                        `}
                                    </div>

                                    ${completedDocs.length > 0 ? `
                                        <div class="bg-emerald-50 border border-emerald-200 rounded-2xl p-6">
                                            <h3 class="font-bold text-emerald-900 text-lg mb-2"><i class="fa-solid fa-circle-check mr-2"></i> Completed Documents Ready</h3>
                                            <p class="text-xs text-emerald-700 mb-4">Your processing is finished! You can now download your completed documents below.</p>
                                            <div class="space-y-2">
                                                ${completedDocs.map(cd => `
                                                    <div class="bg-white p-3 rounded-xl border border-emerald-200 flex justify-between items-center">
                                                        <span class="text-sm font-semibold text-slate-800">${cd.original_name || 'Completed File'}</span>
                                                        <a href="${cd.file_path}" download class="bg-emerald-600 text-white text-xs font-bold px-4 py-2 rounded-lg hover:bg-emerald-700 transition"><i class="fa-solid fa-download mr-1"></i> Download File</a>
                                                    </div>
                                                `).join('')}
                                            </div>
                                        </div>
                                    ` : ''}

                                    <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                                        <h3 class="font-bold text-slate-900 text-lg mb-4">Uploaded Documents</h3>
                                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            ${docs.map(d => `
                                                <div class="p-4 bg-slate-50 rounded-xl border border-slate-200 flex justify-between items-center">
                                                    <div>
                                                        <strong class="text-slate-800 text-sm block">${d.doc_type}</strong>
                                                        <span class="text-xs text-slate-500">${d.original_name || 'File'}</span>
                                                    </div>
                                                    <a href="${d.file_path}" target="_blank" class="text-primary font-semibold text-xs hover:underline">View File</a>
                                                </div>
                                            `).join('')}
                                        </div>
                                    </div>

                                    <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                                        <h3 class="font-bold text-slate-900 text-lg mb-4">Submitted Information Summary</h3>
                                        <div class="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                                            <div><span class="text-slate-400 block text-xs">Full Name</span><strong>${app.first_name} ${app.middle_name || ''} ${app.last_name} ${app.suffix || ''}</strong></div>
                                            <div><span class="text-slate-400 block text-xs">Date of Birth</span><strong>${app.date_of_birth}</strong></div>
                                            <div><span class="text-slate-400 block text-xs">Sex</span><strong>${app.sex}</strong></div>
                                            <div><span class="text-slate-400 block text-xs">Civil Status</span><strong>${app.civil_status}</strong></div>
                                            <div><span class="text-slate-400 block text-xs">Mobile Number</span><strong>${app.mobile_number}</strong></div>
                                            <div><span class="text-slate-400 block text-xs">Email</span><strong>${app.email}</strong></div>
                                            <div class="col-span-2 md:col-span-3"><span class="text-slate-400 block text-xs">Address</span><strong>${app.house_unit}, ${app.street}, ${app.barangay}, ${app.municipality_city}, ${app.province} (${app.zip_code})</strong></div>
                                        </div>
                                    </div>

                                    <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                                        <h3 class="font-bold text-slate-900 text-lg mb-4">Application History</h3>
                                        <div class="space-y-3 border-l-2 border-slate-200 pl-4 ml-2">
                                            ${history.map(h => `
                                                <div class="relative">
                                                    <div class="absolute -left-[21px] top-1 w-3 h-3 bg-primary rounded-full border-2 border-white"></div>
                                                    <div class="text-xs text-slate-400">${h.created_at}</div>
                                                    <div class="font-semibold text-slate-800 text-sm">${h.action} (${h.new_status || 'Update'}) - <span class="text-xs text-slate-500">By ${h.performed_by}</span></div>
                                                    ${h.remarks ? `<div class="text-xs text-slate-600 mt-0.5">${h.remarks}</div>` : ''}
                                                </div>
                                            `).join('')}
                                        </div>
                                    </div>
                                </div>
                            `;
                            res.send(renderLayout('Application Details', content, 'customer', req.session.user, 'applications'));
                        });
                    });
                });
            });
        });
    });
});

// Submit Payment Proof
app.post('/customer/applications/:id/pay', requireCustomer, upload.single('payment_proof'), (req, res) => {
    const appId = req.params.id;
    const userId = req.session.user.id;
    const { gcash_ref_number, gcash_amount_paid, gcash_date_paid } = req.body;
    const paymentProofPath = req.file ? req.file.path.replace(__dirname, '') : '';

    db.run(`UPDATE applications SET payment_status = 'Pending Verification', payment_method = 'GCash', gcash_ref_number = ?, gcash_amount_paid = ?, gcash_date_paid = ?, payment_proof = ?, application_status = 'Payment Verification', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`,
        [gcash_ref_number, gcash_amount_paid, gcash_date_paid, paymentProofPath, appId, userId], (err) => {
            logHistory(appId, 'Payment Submitted', 'Payment Pending', 'Payment Verification', 'Customer', `GCash Ref #: ${gcash_ref_number}`);
            createNotification(userId, 'Payment Submitted', `Payment proof for application #${appId} submitted and pending admin verification.`);
            res.redirect(`/customer/applications/${appId}`);
        });
});

// Notifications Page
app.get('/customer/notifications', requireCustomer, (req, res) => {
    const userId = req.session.user.id;
    db.run(`UPDATE notifications SET is_read = 1 WHERE user_id = ?`, [userId], () => {
        db.all(`SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC`, [userId], (err, notifs) => {
            const content = `
                <div class="max-w-2xl mx-auto space-y-6">
                    <h1 class="text-2xl font-bold text-slate-900">Notifications</h1>
                    <div class="space-y-3">
                        ${notifs.length === 0 ? '<p class="text-slate-500 text-center py-8">No notifications.</p>' : notifs.map(n => `
                            <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                                <div class="flex justify-between items-start">
                                    <h3 class="font-bold text-slate-900">${n.title}</h3>
                                    <span class="text-xs text-slate-400">${n.created_at}</span>
                                </div>
                                <p class="text-slate-600 text-sm mt-2">${n.message}</p>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
            res.send(renderLayout('Notifications', content, 'customer', req.session.user, 'notifications'));
        });
    });
});

// Customer Profile
app.get('/customer/profile', requireCustomer, (req, res) => {
    const content = `
        <div class="max-w-md mx-auto bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
            <h1 class="text-2xl font-bold text-slate-900 mb-2">Customer Profile</h1>
            <p class="text-slate-500 text-sm mb-6">Update your contact information and password.</p>
            
            <form action="/customer/profile" method="POST" class="space-y-4">
                <div>
                    <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Full Name</label>
                    <input type="text" name="full_name" value="${req.session.user.full_name}" required class="w-full border border-slate-300 rounded-xl px-4 py-2">
                </div>
                <div>
                    <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Mobile Number</label>
                    <input type="text" name="mobile_number" value="${req.session.user.mobile_number}" required class="w-full border border-slate-300 rounded-xl px-4 py-2">
                </div>
                <div>
                    <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Email Address</label>
                    <input type="email" name="email" value="${req.session.user.email}" required class="w-full border border-slate-300 rounded-xl px-4 py-2">
                </div>
                <div>
                    <label class="block text-xs font-bold uppercase text-slate-600 mb-1">New Password (leave blank to keep current)</label>
                    <input type="password" name="password" class="w-full border border-slate-300 rounded-xl px-4 py-2">
                </div>
                <button type="submit" class="w-full bg-primary text-white font-semibold py-3 rounded-xl hover:bg-blue-700 transition">Save Changes</button>
            </form>
        </div>
    `;
    res.send(renderLayout('Profile', content, 'customer', req.session.user, 'profile'));
});

app.post('/customer/profile', requireCustomer, async (req, res) => {
    const userId = req.session.user.id;
    const { full_name, mobile_number, email, password } = req.body;

    if (password) {
        const hashed = await bcrypt.hash(password, 10);
        db.run(`UPDATE users SET full_name = ?, mobile_number = ?, email = ?, password = ? WHERE id = ?`,
            [full_name, mobile_number, email, hashed, userId], () => {
                req.session.user.full_name = full_name;
                res.redirect('/customer/profile');
            });
    } else {
        db.run(`UPDATE users SET full_name = ?, mobile_number = ?, email = ? WHERE id = ?`,
            [full_name, mobile_number, email, userId], () => {
                req.session.user.full_name = full_name;
                res.redirect('/customer/profile');
            });
    }
});


// ==========================================
// ADMIN PORTAL
// ==========================================

app.get('/admin/login', (req, res) => {
    const content = `
        <div class="max-w-md mx-auto bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
            <h1 class="text-2xl font-bold text-slate-900 mb-2 text-center">Admin Portal Login</h1>
            <p class="text-slate-500 text-sm mb-6 text-center">Authorized personnel only.</p>
            
            <form action="/admin/login" method="POST" class="space-y-4">
                <div>
                    <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Admin Username</label>
                    <input type="text" name="username" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary">
                </div>
                <div>
                    <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Password</label>
                    <input type="password" name="password" required class="w-full border border-slate-300 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary">
                </div>
                <button type="submit" class="w-full bg-slate-900 text-white font-semibold py-3 rounded-xl hover:bg-slate-800 transition">Admin Login</button>
            </form>
        </div>
    `;
    res.send(renderLayout('Admin Login', content, 'admin_guest'));
});

app.post('/admin/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM admin_users WHERE username = ?`, [username], async (err, admin) => {
        if (admin && await bcrypt.compare(password, admin.password)) {
            req.session.admin = admin;
            res.redirect('/admin/dashboard');
        } else {
            res.send(renderLayout('Error', `<div class="p-8 text-center"><h2 class="text-xl font-bold text-red-600">Invalid Admin Credentials</h2><a href="/admin/login" class="mt-4 inline-block bg-primary text-white px-4 py-2 rounded">Back</a></div>`, 'admin_guest'));
        }
    });
});

app.get('/admin/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/admin/login');
    });
});

// Admin Dashboard
app.get('/admin/dashboard', requireAdmin, (req, res) => {
    db.all(`SELECT * FROM applications`, (err, apps) => {
        db.get(`SELECT COUNT(*) as count FROM users`, (err, customerRow) => {
            const totalCustomers = customerRow ? customerRow.count : 0;
            const totalApps = apps.length;
            const birApps = apps.filter(a => a.service === 'BIR / TIN').length;
            const sssApps = apps.filter(a => a.service === 'SSS').length;
            const pagibigApps = apps.filter(a => a.service === 'PAG-IBIG').length;
            const pendingApps = apps.filter(a => a.application_status === 'Submitted').length;
            const needCorrection = apps.filter(a => a.application_status === 'Need Correction').length;
            const processing = apps.filter(a => a.application_status === 'Processing').length;
            const completed = apps.filter(a => ['Ready', 'Completed'].includes(a.application_status)).length;
            const pendingPayments = apps.filter(a => a.payment_status === 'Pending Verification').length;
            const verifiedPayments = apps.filter(a => a.payment_status === 'Verified').length;
            
            const totalRevenue = apps.filter(a => a.payment_status === 'Verified').reduce((sum, a) => sum + (a.amount_to_pay || 0), 0);

            const content = `
                <div class="space-y-8">
                    <div class="bg-slate-900 text-white p-6 rounded-2xl shadow-sm flex justify-between items-center">
                        <div>
                            <h1 class="text-2xl font-bold">Admin Management Dashboard</h1>
                            <p class="text-slate-400 text-sm mt-1">Overview of all customer applications, payments, and system statistics.</p>
                        </div>
                        <div>
                            <a href="/admin/applications" class="bg-primary text-white font-bold px-4 py-2 rounded-xl text-sm">Manage Applications</a>
                        </div>
                    </div>

                    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                            <span class="text-xs uppercase font-bold text-slate-400">Total Customers</span>
                            <div class="text-3xl font-extrabold text-slate-900 mt-1">${totalCustomers}</div>
                        </div>
                        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                            <span class="text-xs uppercase font-bold text-slate-400">Total Applications</span>
                            <div class="text-3xl font-extrabold text-primary mt-1">${totalApps}</div>
                        </div>
                        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                            <span class="text-xs uppercase font-bold text-amber-500">Pending Payments</span>
                            <div class="text-3xl font-extrabold text-amber-600 mt-1">${pendingPayments}</div>
                        </div>
                        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                            <span class="text-xs uppercase font-bold text-emerald-500">Total Revenue</span>
                            <div class="text-3xl font-extrabold text-emerald-600 mt-1">₱${totalRevenue.toFixed(2)}</div>
                        </div>
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                            <h3 class="font-bold text-slate-900">Services Breakdown</h3>
                            <div class="flex justify-between items-center text-sm"><span class="text-slate-600">BIR / TIN</span><strong class="text-slate-900">${birApps}</strong></div>
                            <div class="flex justify-between items-center text-sm"><span class="text-slate-600">SSS</span><strong class="text-slate-900">${sssApps}</strong></div>
                            <div class="flex justify-between items-center text-sm"><span class="text-slate-600">Pag-IBIG</span><strong class="text-slate-900">${pagibigApps}</strong></div>
                        </div>

                        <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                            <h3 class="font-bold text-slate-900">Application Status</h3>
                            <div class="flex justify-between items-center text-sm"><span class="text-slate-600">Pending Review</span><strong class="text-amber-600">${pendingApps}</strong></div>
                            <div class="flex justify-between items-center text-sm"><span class="text-slate-600">Need Correction</span><strong class="text-orange-600">${needCorrection}</strong></div>
                            <div class="flex justify-between items-center text-sm"><span class="text-slate-600">Processing</span><strong class="text-blue-600">${processing}</strong></div>
                            <div class="flex justify-between items-center text-sm"><span class="text-slate-600">Completed</span><strong class="text-emerald-600">${completed}</strong></div>
                        </div>

                        <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
                            <div>
                                <h3 class="font-bold text-slate-900 mb-2">Quick Navigation</h3>
                                <p class="text-slate-500 text-xs mb-4">Jump directly to critical management sections.</p>
                            </div>
                            <div class="space-y-2">
                                <a href="/admin/applications" class="block bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold p-2.5 rounded-xl text-center text-sm transition">Manage Applications</a>
                                <a href="/admin/payments" class="block bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold p-2.5 rounded-xl text-center text-sm transition">Verify Payments</a>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            res.send(renderLayout('Admin Dashboard', content, 'admin', null, 'dashboard'));
        });
    });
});

// Admin Applications Management
app.get('/admin/applications', requireAdmin, (req, res) => {
    const search = req.query.search || '';
    const serviceFilter = req.query.service || '';
    const statusFilter = req.query.status || '';

    let query = `SELECT a.*, u.full_name as applicant_name, u.username FROM applications a JOIN users u ON a.user_id = u.id WHERE 1=1`;
    let params = [];

    if (search) {
        query += ` AND (u.full_name LIKE ? OR u.username LIKE ? OR a.tracking_number LIKE ? OR a.mobile_number LIKE ?)`;
        const s = `%${search}%`;
        params.push(s, s, s, s);
    }
    if (serviceFilter) {
        query += ` AND a.service = ?`;
        params.push(serviceFilter);
    }
    if (statusFilter) {
        query += ` AND a.application_status = ?`;
        params.push(statusFilter);
    }

    query += ` ORDER BY a.created_at DESC`;

    db.all(query, params, (err, apps) => {
        const content = `
            <div class="space-y-6">
                <div class="flex justify-between items-center">
                    <div>
                        <h1 class="text-2xl font-bold text-slate-900">Application Management</h1>
                        <p class="text-slate-500 text-sm">Search, filter, and review all customer applications.</p>
                    </div>
                </div>

                <form action="/admin/applications" method="GET" class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div>
                        <input type="text" name="search" value="${search}" placeholder="Search name, tracking #..." class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm">
                    </div>
                    <div>
                        <select name="service" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm">
                            <option value="">All Services</option>
                            <option value="BIR / TIN" ${serviceFilter === 'BIR / TIN' ? 'selected' : ''}>BIR / TIN</option>
                            <option value="SSS" ${serviceFilter === 'SSS' ? 'selected' : ''}>SSS</option>
                            <option value="PAG-IBIG" ${serviceFilter === 'PAG-IBIG' ? 'selected' : ''}>Pag-IBIG</option>
                        </select>
                    </div>
                    <div>
                        <select name="status" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm">
                            <option value="">All Statuses</option>
                            <option value="Submitted" ${statusFilter === 'Submitted' ? 'selected' : ''}>Submitted</option>
                            <option value="Payment Pending" ${statusFilter === 'Payment Pending' ? 'selected' : ''}>Payment Pending</option>
                            <option value="Payment Verification" ${statusFilter === 'Payment Verification' ? 'selected' : ''}>Payment Verification</option>
                            <option value="Under Review" ${statusFilter === 'Under Review' ? 'selected' : ''}>Under Review</option>
                            <option value="Need Correction" ${statusFilter === 'Need Correction' ? 'selected' : ''}>Need Correction</option>
                            <option value="Processing" ${statusFilter === 'Processing' ? 'selected' : ''}>Processing</option>
                            <option value="Ready" ${statusFilter === 'Ready' ? 'selected' : ''}>Ready</option>
                            <option value="Completed" ${statusFilter === 'Completed' ? 'selected' : ''}>Completed</option>
                            <option value="Rejected" ${statusFilter === 'Rejected' ? 'selected' : ''}>Rejected</option>
                        </select>
                    </div>
                    <div class="flex space-x-2">
                        <button type="submit" class="bg-primary text-white px-4 py-2 rounded-xl text-sm font-semibold flex-grow">Filter</button>
                        <a href="/admin/applications" class="bg-slate-200 text-slate-700 px-3 py-2 rounded-xl text-sm font-semibold">Reset</a>
                    </div>
                </form>

                <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <table class="w-full text-left text-sm">
                        <thead class="bg-slate-100 text-slate-600 uppercase text-xs">
                            <tr>
                                <th class="p-4">Applicant</th>
                                <th class="p-4">Service</th>
                                <th class="p-4">Tracking #</th>
                                <th class="p-4">Date</th>
                                <th class="p-4">Payment</th>
                                <th class="p-4">Status</th>
                                <th class="p-4">Action</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100">
                            ${apps.length === 0 ? `<tr><td colspan="7" class="p-8 text-center text-slate-500">No applications found.</td></tr>` : apps.map(a => `
                                <tr>
                                    <td class="p-4 font-semibold text-slate-800">${a.applicant_name}<span class="block text-xs font-normal text-slate-400">@${a.username}</span></td>
                                    <td class="p-4">${a.service}</td>
                                    <td class="p-4 font-mono font-bold text-primary">${a.tracking_number}</td>
                                    <td class="p-4 text-xs text-slate-500">${a.created_at}</td>
                                    <td class="p-4"><span class="px-2 py-0.5 bg-slate-100 text-slate-800 text-xs rounded">${a.payment_status}</span></td>
                                    <td class="p-4"><span class="px-2 py-0.5 bg-blue-100 text-blue-800 text-xs rounded font-bold">${a.application_status}</span></td>
                                    <td class="p-4"><a href="/admin/applications/${a.id}" class="bg-primary text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-blue-700 transition">Review</a></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
        res.send(renderLayout('Admin Applications', content, 'admin', null, 'applications'));
    });
});

// Admin Applicant Detail & Action Panel
app.get('/admin/applications/:id', requireAdmin, (req, res) => {
    const appId = req.params.id;
    db.get(`SELECT a.*, u.full_name as applicant_name, u.email as user_email, u.mobile_number as user_phone FROM applications a JOIN users u ON a.user_id = u.id WHERE a.id = ?`, [appId], (err, app) => {
        if (!app) {
            return res.send(renderLayout('Error', `<div class="p-8 text-center"><h2 class="text-xl font-bold text-red-600">Application Not Found</h2></div>`, 'admin'));
        }

        db.all(`SELECT * FROM application_documents WHERE application_id = ?`, [appId], (err, docs) => {
            db.all(`SELECT * FROM completed_documents WHERE application_id = ?`, [appId], (err, completedDocs) => {
                db.all(`SELECT * FROM application_status_history WHERE application_id = ? ORDER BY created_at DESC`, [appId], (err, history) => {
                    const content = `
                        <div class="space-y-8 max-w-5xl mx-auto">
                            <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 flex justify-between items-center">
                                <div>
                                    <span class="text-xs uppercase font-bold text-slate-400">Applicant Details & Actions</span>
                                    <h1 class="text-2xl font-bold text-slate-900">${app.applicant_name}</h1>
                                    <p class="text-slate-500 text-sm">Tracking #: <strong class="text-primary font-mono">${app.tracking_number}</strong> | Service: <strong>${app.service}</strong></p>
                                </div>
                                <div>
                                    <a href="/admin/applications" class="bg-slate-200 text-slate-700 font-semibold px-4 py-2 rounded-xl text-sm">Back to List</a>
                                </div>
                            </div>

                            <div class="bg-slate-900 text-white rounded-2xl p-6 shadow-sm">
                                <h3 class="font-bold text-lg mb-4">Admin Application Controls</h3>
                                <form action="/admin/applications/${app.id}/action" method="POST" enctype="multipart/form-data" class="space-y-4">
                                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label class="block text-xs font-bold uppercase text-slate-400 mb-1">Update Status</label>
                                            <select name="application_status" class="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white">
                                                <option value="${app.application_status}" selected>Current: ${app.application_status}</option>
                                                <option value="Submitted">Submitted</option>
                                                <option value="Under Review">Under Review</option>
                                                <option value="Need Correction">Need Correction</option>
                                                <option value="Processing">Processing</option>
                                                <option value="Ready">Ready</option>
                                                <option value="Completed">Completed</option>
                                                <option value="Rejected">Rejected</option>
                                                <option value="Cancelled">Cancelled</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label class="block text-xs font-bold uppercase text-slate-400 mb-1">Payment Status Action</label>
                                            <select name="payment_status" class="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white">
                                                <option value="${app.payment_status}" selected>Current: ${app.payment_status}</option>
                                                <option value="Unpaid">Unpaid</option>
                                                <option value="Pending Verification">Pending Verification</option>
                                                <option value="Verified">Verified</option>
                                                <option value="Rejected">Rejected</option>
                                                <option value="Refunded">Refunded</option>
                                            </select>
                                        </div>
                                    </div>

                                    <div>
                                        <label class="block text-xs font-bold uppercase text-slate-400 mb-1">Admin Remarks / Correction Instructions</label>
                                        <textarea name="admin_remarks" rows="2" placeholder="Write remarks or correction messages here..." class="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2 text-white">${app.admin_remarks || ''}</textarea>
                                    </div>

                                    <div>
                                        <label class="block text-xs font-bold uppercase text-slate-400 mb-1">Upload Completed Document (When finished)</label>
                                        <input type="file" name="completed_file" class="w-full bg-slate-800 border border-slate-700 rounded-xl p-2 text-sm">
                                    </div>

                                    <button type="submit" class="bg-primary text-white font-bold px-6 py-3 rounded-xl hover:bg-blue-600 transition shadow">Save Changes & Execute Action</button>
                                </form>
                            </div>

                            <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                                <h3 class="font-bold text-slate-900 text-lg mb-4">Payment Information</h3>
                                <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4 text-sm">
                                    <div><span class="text-slate-400 block text-xs">Method</span><strong>${app.payment_method}</strong></div>
                                    <div><span class="text-slate-400 block text-xs">Amount Due</span><strong>₱${app.amount_to_pay.toFixed(2)}</strong></div>
                                    <div><span class="text-slate-400 block text-xs">Reference #</span><strong>${app.gcash_ref_number || 'N/A'}</strong></div>
                                    <div><span class="text-slate-400 block text-xs">Payment Status</span><strong>${app.payment_status}</strong></div>
                                </div>
                                ${app.payment_proof ? `
                                    <div>
                                        <span class="text-xs font-bold text-slate-500 block mb-1">Submitted Payment Proof</span>
                                        <a href="${app.payment_proof}" target="_blank" class="text-primary font-semibold text-sm underline"><i class="fa-solid fa-file-image mr-1"></i> View Receipt / Screenshot</a>
                                    </div>
                                ` : ''}
                            </div>

                            ${completedDocs.length > 0 ? `
                                <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                                    <h3 class="font-bold text-slate-900 text-lg mb-4">Completed Files</h3>
                                    <div class="space-y-2">
                                        ${completedDocs.map(cd => `
                                            <div class="p-3 bg-slate-50 rounded-xl border border-slate-200 flex justify-between items-center">
                                                <span class="text-sm font-semibold">${cd.original_name}</span>
                                                <a href="${cd.file_path}" target="_blank" class="text-primary font-semibold text-xs">Download / View</a>
                                            </div>
                                        `).join('')}
                                    </div>
                                </div>
                            ` : ''}

                            <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                                <h3 class="font-bold text-slate-900 text-lg mb-4">Customer Uploaded Documents</h3>
                                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    ${docs.map(d => `
                                        <div class="p-4 bg-slate-50 rounded-xl border border-slate-200 flex justify-between items-center">
                                            <div>
                                                <strong class="text-slate-800 text-sm block">${d.doc_type}</strong>
                                                <span class="text-xs text-slate-500">${d.original_name}</span>
                                            </div>
                                            <a href="${d.file_path}" target="_blank" class="text-primary font-semibold text-xs hover:underline">View File</a>
                                        </div>
                                    `).join('')}
                                </div>
                            </div>

                            <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                                <h3 class="font-bold text-slate-900 text-lg mb-4">Personal Information</h3>
                                <div class="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                                    <div><span class="text-slate-400 block text-xs">Full Name</span><strong>${app.first_name} ${app.middle_name || ''} ${app.last_name} ${app.suffix || ''}</strong></div>
                                    <div><span class="text-slate-400 block text-xs">Date of Birth</span><strong>${app.date_of_birth}</strong></div>
                                    <div><span class="text-slate-400 block text-xs">Sex</span><strong>${app.sex}</strong></div>
                                    <div><span class="text-slate-400 block text-xs">Civil Status</span><strong>${app.civil_status}</strong></div>
                                    <div><span class="text-slate-400 block text-xs">Contact Number</span><strong>${app.mobile_number}</strong></div>
                                    <div><span class="text-slate-400 block text-xs">Email</span><strong>${app.email}</strong></div>
                                    <div class="col-span-2 md:col-span-3"><span class="text-slate-400 block text-xs">Address</span><strong>${app.house_unit}, ${app.street}, ${app.barangay}, ${app.municipality_city}, ${app.province} (${app.zip_code})</strong></div>
                                </div>
                            </div>

                            <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                                <h3 class="font-bold text-slate-900 text-lg mb-4">Application History</h3>
                                <div class="space-y-3 border-l-2 border-slate-200 pl-4 ml-2">
                                    ${history.map(h => `
                                        <div class="relative">
                                            <div class="absolute -left-[21px] top-1 w-3 h-3 bg-primary rounded-full border-2 border-white"></div>
                                            <div class="text-xs text-slate-400">${h.created_at}</div>
                                            <div class="font-semibold text-slate-800 text-sm">${h.action} (${h.new_status || 'Update'}) - By ${h.performed_by}</div>
                                            ${h.remarks ? `<div class="text-xs text-slate-600 mt-0.5">${h.remarks}</div>` : ''}
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        </div>
                    `;
                    res.send(renderLayout('Applicant Details', content, 'admin', null, 'applications'));
                });
            });
        });
    });
});

// Admin Application Action POST
app.post('/admin/applications/:id/action', requireAdmin, upload.single('completed_file'), (req, res) => {
    const appId = req.params.id;
    const { application_status, payment_status, admin_remarks } = req.body;

    db.get(`SELECT * FROM applications WHERE id = ?`, [appId], (err, app) => {
        if (!app) return res.redirect('/admin/applications');

        db.run(`UPDATE applications SET application_status = ?, payment_status = ?, admin_remarks = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [application_status, payment_status, admin_remarks, appId], () => {

                if (req.file) {
                    const filePath = req.file.path.replace(__dirname, '');
                    db.run(`INSERT INTO completed_documents (application_id, file_path, original_name) VALUES (?, ?, ?)`,
                        [appId, filePath, req.file.originalname]);
                }

                logHistory(appId, `Status Updated to ${application_status}`, app.application_status, application_status, 'Admin', admin_remarks);
                createNotification(app.user_id, 'Application Update', `Your application #${app.tracking_number} status changed to: ${application_status}. ${admin_remarks ? 'Remarks: ' + admin_remarks : ''}`);

                res.redirect(`/admin/applications/${appId}`);
            });
    });
});

// Admin Payment Management Section
app.get('/admin/payments', requireAdmin, (req, res) => {
    db.all(`SELECT a.*, u.full_name as applicant_name FROM applications a JOIN users u ON a.user_id = u.id ORDER BY a.created_at DESC`, (err, apps) => {
        const content = `
            <div class="space-y-6">
                <h1 class="text-2xl font-bold text-slate-900">Payment Management</h1>
                <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <table class="w-full text-left text-sm">
                        <thead class="bg-slate-100 text-slate-600 uppercase text-xs">
                            <tr>
                                <th class="p-4">Applicant</th>
                                <th class="p-4">Tracking #</th>
                                <th class="p-4">Service</th>
                                <th class="p-4">Method</th>
                                <th class="p-4">Amount</th>
                                <th class="p-4">Ref #</th>
                                <th class="p-4">Status</th>
                                <th class="p-4">Action</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100">
                            ${apps.map(a => `
                                <tr>
                                    <td class="p-4 font-semibold text-slate-800">${a.applicant_name}</td>
                                    <td class="p-4 font-mono font-bold text-primary">${a.tracking_number}</td>
                                    <td class="p-4">${a.service}</td>
                                    <td class="p-4">${a.payment_method}</td>
                                    <td class="p-4 font-bold">₱${a.amount_to_pay.toFixed(2)}</td>
                                    <td class="p-4 font-mono">${a.gcash_ref_number || 'N/A'}</td>
                                    <td class="p-4"><span class="px-2 py-0.5 bg-slate-100 text-xs font-semibold rounded">${a.payment_status}</span></td>
                                    <td class="p-4"><a href="/admin/applications/${a.id}" class="text-primary font-semibold hover:underline">Verify Payment</a></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
        res.send(renderLayout('Admin Payments', content, 'admin', null, 'payments'));
    });
});

// Admin Reports Section
app.get('/admin/reports', requireAdmin, (req, res) => {
    db.all(`SELECT a.*, u.full_name as applicant_name FROM applications a JOIN users u ON a.user_id = u.id`, (err, apps) => {
        const totalRev = apps.filter(a => a.payment_status === 'Verified').reduce((sum, a) => sum + a.amount_to_pay, 0);

        const content = `
            <div class="space-y-6">
                <div class="flex justify-between items-center">
                    <h1 class="text-2xl font-bold text-slate-900">System Reports & Revenue Summary</h1>
                    <button onclick="window.print()" class="bg-slate-900 text-white px-4 py-2 rounded-xl text-sm font-semibold"><i class="fa-solid fa-print mr-1"></i> Print Report</button>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                        <span class="text-xs uppercase font-bold text-slate-400">Total Applications</span>
                        <div class="text-3xl font-extrabold text-slate-900 mt-1">${apps.length}</div>
                    </div>
                    <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                        <span class="text-xs uppercase font-bold text-emerald-500">Verified Revenue</span>
                        <div class="text-3xl font-extrabold text-emerald-600 mt-1">₱${totalRev.toFixed(2)}</div>
                    </div>
                    <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                        <span class="text-xs uppercase font-bold text-blue-500">Completed Applications</span>
                        <div class="text-3xl font-extrabold text-blue-600 mt-1">${apps.filter(a => a.application_status === 'Completed').length}</div>
                    </div>
                </div>

                <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                    <h3 class="font-bold text-slate-900 text-lg mb-4">Complete Application Log</h3>
                    <table class="w-full text-left text-sm">
                        <thead class="bg-slate-100 text-slate-600 uppercase text-xs">
                            <tr>
                                <th class="p-3">Tracking #</th>
                                <th class="p-3">Applicant</th>
                                <th class="p-3">Service</th>
                                <th class="p-3">Date</th>
                                <th class="p-3">Status</th>
                                <th class="p-3">Payment</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100">
                            ${apps.map(a => `
                                <tr>
                                    <td class="p-3 font-mono font-bold text-primary">${a.tracking_number}</td>
                                    <td class="p-3">${a.applicant_name}</td>
                                    <td class="p-3">${a.service}</td>
                                    <td class="p-3 text-xs text-slate-500">${a.created_at}</td>
                                    <td class="p-3">${a.application_status}</td>
                                    <td class="p-3">${a.payment_status}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
        res.send(renderLayout('Admin Reports', content, 'admin', null, 'reports'));
    });
});

// Admin Settings & Service Fees Configuration
app.get('/admin/settings', requireAdmin, (req, res) => {
    db.all(`SELECT * FROM settings`, (err, settings) => {
        db.all(`SELECT * FROM service_fees`, (err, fees) => {
            const settingsMap = {};
            settings.forEach(s => settingsMap[s.key] = s.value);

            const content = `
                <div class="max-w-3xl mx-auto space-y-8">
                    <h1 class="text-2xl font-bold text-slate-900">System Settings & Configurable Fees</h1>

                    <form action="/admin/settings" method="POST" enctype="multipart/form-data" class="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 space-y-6">
                        <h3 class="font-bold text-slate-900 text-lg">General Business & GCash Settings</h3>
                        
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Business Name</label>
                                <input type="text" name="business_name" value="${settingsMap['business_name'] || ''}" class="w-full border border-slate-300 rounded-xl px-4 py-2">
                            </div>
                            <div>
                                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Contact Number</label>
                                <input type="text" name="contact_number" value="${settingsMap['contact_number'] || ''}" class="w-full border border-slate-300 rounded-xl px-4 py-2">
                            </div>
                        </div>

                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">GCash Account Name</label>
                                <input type="text" name="gcash_name" value="${settingsMap['gcash_name'] || ''}" class="w-full border border-slate-300 rounded-xl px-4 py-2">
                            </div>
                            <div>
                                <label class="block text-xs font-bold uppercase text-slate-600 mb-1">GCash Number</label>
                                <input type="text" name="gcash_number" value="${settingsMap['gcash_number'] || ''}" class="w-full border border-slate-300 rounded-xl px-4 py-2">
                            </div>
                        </div>

                        <div>
                            <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Upload GCash QR Code</label>
                            ${settingsMap['gcash_qr'] ? `<img src="${settingsMap['gcash_qr']}" alt="QR" class="w-32 h-32 mb-2 rounded border">` : ''}
                            <input type="file" name="gcash_qr" accept=".jpg,.jpeg,.png" class="w-full border border-slate-300 rounded-xl p-2 text-sm">
                        </div>

                        <div>
                            <label class="block text-xs font-bold uppercase text-slate-600 mb-1">Payment Instructions</label>
                            <textarea name="payment_instructions" rows="2" class="w-full border border-slate-300 rounded-xl px-4 py-2">${settingsMap['payment_instructions'] || ''}</textarea>
                        </div>

                        <button type="submit" class="bg-primary text-white font-bold px-6 py-3 rounded-xl hover:bg-blue-700 transition">Save Settings</button>
                    </form>

                    <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
                        <h3 class="font-bold text-slate-900 text-lg mb-4">Configurable Service Fees</h3>
                        <form action="/admin/service-fees" method="POST" class="space-y-4">
                            ${fees.map(f => `
                                <div class="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-200">
                                    <span class="font-semibold text-slate-800">${f.service_name}</span>
                                    <div class="flex items-center space-x-2">
                                        <span class="text-slate-500 font-bold">₱</span>
                                        <input type="number" step="0.01" name="fee_${f.id}" value="${f.fee}" class="border border-slate-300 rounded-lg px-3 py-1.5 w-32 font-bold text-primary">
                                    </div>
                                </div>
                            `).join('')}
                            <button type="submit" class="bg-primary text-white font-bold px-6 py-2.5 rounded-xl hover:bg-blue-700 transition mt-2">Update Service Fees</button>
                        </form>
                    </div>
                </div>
            `;
            res.send(renderLayout('Admin Settings', content, 'admin', null, 'settings'));
        });
    });
});

app.post('/admin/settings', requireAdmin, upload.single('gcash_qr'), (req, res) => {
    const body = req.body;
    const keys = ['business_name', 'contact_number', 'gcash_name', 'gcash_number', 'payment_instructions'];
    
    keys.forEach(k => {
        if (body[k]) {
            db.run(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?`, [k, body[k], body[k]]);
        }
    });

    if (req.file) {
        const qrPath = req.file.path.replace(__dirname, '');
        db.run(`INSERT INTO settings (key, value) VALUES ('gcash_qr', ?) ON CONFLICT(key) DO UPDATE SET value = ?`, [qrPath, qrPath]);
    }

    res.redirect('/admin/settings');
});

app.post('/admin/service-fees', requireAdmin, (req, res) => {
    const body = req.body;
    db.all(`SELECT * FROM service_fees`, (err, fees) => {
        fees.forEach(f => {
            const newFee = body[`fee_${f.id}`];
            if (newFee) {
                db.run(`UPDATE service_fees SET fee = ? WHERE id = ?`, [newFee, f.id]);
            }
        });
        res.redirect('/admin/settings');
    });
});

// Start Server
app.listen(PORT, () => {
    console.log(`GovAssist PH Application Assistance System running on port ${PORT}`);
});
