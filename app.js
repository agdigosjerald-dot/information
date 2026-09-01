/**
 * COMPLETE BIR/TIN, SSS & PAG-IBIG APPLICATION ASSISTANCE SYSTEM
 * Production-Ready Single-File Node.js Application
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

// Ensure upload directory exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer storage setup
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname))
});
const upload = multer({ storage: storage, limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB limit

// Database setup
const dbFile = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbFile, (err) => {
    if (err) console.error('Database connection error:', err.message);
    else console.log('Connected to SQLite database.');
});

// Initialize Database Tables
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        mobile_number TEXT NOT NULL,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS admin_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        full_name TEXT NOT NULL
    )`, () => {
        // Create default admin if not exists (username: admin, password: password123)
        db.get(`SELECT * FROM admin_users WHERE username = 'admin'`, async (err, row) => {
            if (!row) {
                const hashedPassword = await bcrypt.hash('password123', 10);
                db.run(`INSERT INTO admin_users (username, password, full_name) VALUES (?, ?, ?)`, ['admin', hashedPassword, 'System Administrator']);
            }
        });
    });

    db.run(`CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE NOT NULL,
        value TEXT
    )`, () => {
        const defaults = [
            ['business_name', 'GovAssist PH - Application Assistance'],
            ['contact_number', '+63 912 345 6789'],
            ['email', 'support@govassist.ph'],
            ['address', 'Metro Manila, Philippines'],
            ['gcash_qr', ''],
            ['gcash_account_name', 'GovAssist PH Services'],
            ['gcash_number', '09123456789'],
            ['bir_fee', '500'],
            ['sss_fee', '400'],
            ['pagibig_fee', '400'],
            ['cash_instructions', 'Proceed to our main office or accredited partner agents to pay in cash.'],
            ['terms', 'This system provides application assistance, document collection, processing, and tracking services. It is not an official government website unless an official partnership/integration is established.'],
            ['customer_instructions', 'Please ensure all uploaded documents are clear and readable. Fill out all required fields accurately.']
        ];
        defaults.forEach(([k, v]) => {
            db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`, [k, v]);
        });
    });

    db.run(`CREATE TABLE IF NOT EXISTS applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        service_type TEXT NOT NULL,
        tracking_number TEXT UNIQUE NOT NULL,
        status TEXT DEFAULT 'Submitted',
        payment_status TEXT DEFAULT 'Unpaid',
        payment_method TEXT,
        payment_ref TEXT,
        amount_paid REAL,
        date_paid TEXT,
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
        mobile TEXT,
        email TEXT,
        house_block_lot TEXT,
        street TEXT,
        barangay TEXT,
        municipality_city TEXT,
        province TEXT,
        zip_code TEXT,
        FOREIGN KEY(application_id) REFERENCES applications(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS parents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        application_id INTEGER,
        father_first_name TEXT,
        father_middle_name TEXT,
        father_last_name TEXT,
        father_dob TEXT,
        mother_first_name TEXT,
        mother_middle_name TEXT,
        mother_maiden_name TEXT,
        mother_last_name TEXT,
        mother_dob TEXT,
        FOREIGN KEY(application_id) REFERENCES applications(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS spouses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        application_id INTEGER,
        spouse_full_name TEXT,
        spouse_dob TEXT,
        marriage_cert TEXT,
        FOREIGN KEY(application_id) REFERENCES applications(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS beneficiaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        application_id INTEGER,
        full_name TEXT,
        relationship TEXT,
        dob TEXT,
        sex TEXT,
        address TEXT,
        FOREIGN KEY(application_id) REFERENCES applications(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS employment (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        application_id INTEGER,
        employment_status TEXT,
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
        file_name TEXT,
        uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(application_id) REFERENCES applications(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS admin_uploaded_files (
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
});

// Middleware setup
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/uploads', express.static(uploadDir));
app.use(session({
    secret: 'govassist_secret_key_998877',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Helper functions for settings cache/fetch
function getSettings(callback) {
    db.all(`SELECT * FROM settings`, (err, rows) => {
        const settings = {};
        if (rows) {
            rows.forEach(r => settings[r.key] = r.value);
        }
        callback(settings);
    });
}

// ---------------------------------------------------------
// PUBLIC / TRACKING ROUTES
// ---------------------------------------------------------
app.get('/track', (req, res) => {
    const trackingNo = req.query.tracking_number || '';
    getSettings(settings => {
        let htmlContent = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Track Application - ${settings.business_name}</title>
            <script src="https://cdn.tailwindcss.com"></script>
        </head>
        <body class="bg-gray-50 font-sans">
            <div class="max-w-2xl mx-auto p-6 mt-10 bg-white rounded-xl shadow-md">
                <div class="text-center mb-6">
                    <h1 class="text-2xl font-bold text-blue-900">Application Tracking</h1>
                    <p class="text-sm text-gray-600">Enter your unique tracking number below to check progress.</p>
                </div>
                <form method="GET" action="/track" class="flex gap-2 mb-6">
                    <input type="text" name="tracking_number" value="${trackingNo}" placeholder="e.g. TIN-20260901-0001" required class="flex-1 border p-2 rounded focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <button type="submit" class="bg-blue-600 text-white px-4 py-2 rounded font-medium hover:bg-blue-700">Track</button>
                </form>
        `;

        if (trackingNo) {
            db.get(`SELECT * FROM applications WHERE tracking_number = ?`, [trackingNo], (err, app) => {
                if (!app) {
                    htmlContent += `<div class="p-4 bg-red-100 text-red-700 rounded">Application not found for tracking number: <strong>${trackingNo}</strong></div>`;
                    finishTrack();
                } else {
                    db.all(`SELECT * FROM status_history WHERE application_id = ? ORDER BY created_at ASC`, [app.id], (err, history) => {
                        htmlContent += `
                        <div class="border-t pt-4">
                            <div class="flex justify-between items-center mb-4">
                                <div>
                                    <p class="text-sm text-gray-500">Service: <span class="font-bold uppercase text-gray-800">${app.service_type}</span></p>
                                    <p class="text-sm text-gray-500">Tracking Number: <span class="font-bold text-blue-600">${app.tracking_number}</span></p>
                                </div>
                                <div class="text-right">
                                    <span class="px-3 py-1 text-xs rounded-full font-semibold bg-blue-100 text-blue-800">${app.status}</span>
                                    <p class="text-xs text-gray-500 mt-1">Payment: <span class="font-semibold">${app.payment_status}</span></p>
                                </div>
                            </div>
                            <h3 class="font-bold text-gray-700 mb-3">Progress Timeline</h3>
                            <div class="space-y-3 border-l-2 border-blue-200 pl-4 ml-2">
                        `;
                        history.forEach(h => {
                            htmlContent += `
                                <div class="relative">
                                    <div class="absolute -left-[21px] top-1 w-3 h-3 bg-blue-600 rounded-full border-2 border-white"></div>
                                    <p class="text-xs text-gray-400">${h.created_at}</p>
                                    <p class="font-medium text-gray-800">${h.action}</p>
                                    ${h.remarks ? `<p class="text-sm text-gray-600 bg-gray-50 p-2 rounded mt-1">${h.remarks}</p>` : ''}
                                </div>
                            `;
                        });
                        htmlContent += `</div></div>`;
                        finishTrack();
                    });
                }
            });
        } else {
            finishTrack();
        }

        function finishTrack() {
            htmlContent += `
                <div class="mt-8 text-center">
                    <a href="/customer/login" class="text-blue-600 text-sm hover:underline">Back to Customer Portal</a>
                </div>
                <div class="mt-8 pt-4 border-t text-center text-xs text-gray-500">
                    <p>${settings.terms}</p>
                </div>
            </div></body></html>`;
            res.send(htmlContent);
        }
    });
});

// ---------------------------------------------------------
// CUSTOMER AUTH & PORTAL ROUTES
// ---------------------------------------------------------
app.get('/customer/login', (req, res) => {
    getSettings(settings => {
        res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Customer Login - ${settings.business_name}</title>
            <script src="https://cdn.tailwindcss.com"></script>
        </head>
        <body class="bg-gray-100 flex items-center justify-center min-h-screen">
            <div class="max-w-md w-full bg-white p-8 rounded-xl shadow-md">
                <div class="text-center mb-6">
                    <h1 class="text-2xl font-bold text-blue-900">${settings.business_name}</h1>
                    <p class="text-sm text-gray-600 mt-1">Customer Portal Login</p>
                </div>
                ${req.query.registered ? '<div class="mb-4 p-3 bg-green-100 text-green-700 text-sm rounded">Registration successful! Please login.</div>' : ''}
                ${req.query.error ? '<div class="mb-4 p-3 bg-red-100 text-red-700 text-sm rounded">Invalid username or password.</div>' : ''}
                <form method="POST" action="/customer/login" class="space-y-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-700">Username or Email</label>
                        <input type="text" name="username" required class="w-full border p-2 rounded mt-1 focus:ring-2 focus:ring-blue-500">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700">Password</label>
                        <input type="password" name="password" required class="w-full border p-2 rounded mt-1 focus:ring-2 focus:ring-blue-500">
                    </div>
                    <button type="submit" class="w-full bg-blue-600 text-white p-2 rounded font-medium hover:bg-blue-700">Login</button>
                </form>
                <div class="mt-4 text-center text-sm">
                    <p class="text-gray-600">Don't have an account? <a href="/customer/register" class="text-blue-600 font-medium hover:underline">Register here</a></p>
                    <p class="mt-2"><a href="/track" class="text-gray-500 hover:underline">Track Application Status</a></p>
                </div>
            </div>
        </body>
        </html>
        `);
    });
});

app.post('/customer/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ? OR email = ?`, [username, username], async (err, user) => {
        if (user && await bcrypt.compare(password, user.password)) {
            req.session.userId = user.id;
            req.session.userName = user.full_name;
            res.redirect('/customer');
        } else {
            res.redirect('/customer/login?error=1');
        }
    });
});

app.get('/customer/register', (req, res) => {
    getSettings(settings => {
        res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Customer Registration - ${settings.business_name}</title>
            <script src="https://cdn.tailwindcss.com"></script>
        </head>
        <body class="bg-gray-100 flex items-center justify-center min-h-screen py-10">
            <div class="max-w-md w-full bg-white p-8 rounded-xl shadow-md">
                <div class="text-center mb-6">
                    <h1 class="text-2xl font-bold text-blue-900">Create Account</h1>
                    <p class="text-sm text-gray-600 mt-1">Register for government application assistance</p>
                </div>
                ${req.query.error ? `<div class="mb-4 p-3 bg-red-100 text-red-700 text-sm rounded">${req.query.error}</div>` : ''}
                <form method="POST" action="/customer/register" class="space-y-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-700">Full Name</label>
                        <input type="text" name="full_name" required class="w-full border p-2 rounded mt-1">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700">Email Address</label>
                        <input type="email" name="email" required class="w-full border p-2 rounded mt-1">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700">Mobile Number</label>
                        <input type="text" name="mobile_number" placeholder="09XXXXXXXXX" required class="w-full border p-2 rounded mt-1">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700">Username</label>
                        <input type="text" name="username" required class="w-full border p-2 rounded mt-1">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700">Password</label>
                        <input type="password" name="password" required class="w-full border p-2 rounded mt-1">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700">Confirm Password</label>
                        <input type="password" name="confirm_password" required class="w-full border p-2 rounded mt-1">
                    </div>
                    <button type="submit" class="w-full bg-blue-600 text-white p-2 rounded font-medium hover:bg-blue-700">Register</button>
                </form>
                <div class="mt-4 text-center text-sm">
                    <p class="text-gray-600">Already have an account? <a href="/customer/login" class="text-blue-600 font-medium hover:underline">Login here</a></p>
                </div>
            </div>
        </body>
        </html>
        `);
    });
});

app.post('/customer/register', async (req, res) => {
    const { full_name, email, mobile_number, username, password, confirm_password } = req.body;
    if (password !== confirm_password) {
        return res.redirect('/customer/register?error=Passwords do not match');
    }
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.run(`INSERT INTO users (full_name, email, mobile_number, username, password) VALUES (?, ?, ?, ?, ?)`,
            [full_name, email, mobile_number, username, hashedPassword], function(err) {
                if (err) {
                    return res.redirect('/customer/register?error=Username or Email already exists');
                }
                // Add notification
                db.run(`INSERT INTO notifications (user_id, message) VALUES (?, ?)`, [this.lastID, 'Welcome! Your account has been successfully created.']);
                res.redirect('/customer/login?registered=1');
            });
    } catch (e) {
        res.redirect('/customer/register?error=Registration failed');
    }
});

app.get('/customer/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/customer/login'));
});

// Customer Authentication Middleware
function requireCustomer(req, res, next) {
    if (!req.session.userId) return res.redirect('/customer/login');
    next();
}

// Customer Portal Home & Dashboard
app.get('/customer', requireCustomer, (req, res) => {
    db.serialize(() => {
        db.all(`SELECT * FROM applications WHERE user_id = ? ORDER BY created_at DESC`, [req.session.userId], (err, apps) => {
            db.all(`SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC`, [req.session.userId], (err, notifs) => {
                getSettings(settings => {
                    const unreadCount = notifs.filter(n => n.is_read === 0).length;
                    
                    res.send(`
                    <!DOCTYPE html>
                    <html lang="en">
                    <head>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <title>Customer Dashboard - ${settings.business_name}</title>
                        <script src="https://cdn.tailwindcss.com"></script>
                        <script src="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/js/all.min.js"></script>
                    </head>
                    <body class="bg-gray-100 font-sans">
                        <div class="min-h-screen flex flex-col">
                            <!-- Header -->
                            <header class="bg-blue-900 text-white shadow-md">
                                <div class="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
                                    <div class="flex items-center space-x-3">
                                        <h1 class="text-xl font-bold">${settings.business_name}</h1>
                                    </div>
                                    <div class="flex items-center space-x-4">
                                        <span class="text-sm">Hello, ${req.session.userName}</span>
                                        <a href="/customer/logout" class="bg-red-600 px-3 py-1 rounded text-sm hover:bg-red-700"><i class="fas.fa-sign-out-alt"></i> Logout</a>
                                    </div>
                                </div>
                            </header>

                            <!-- Main Content -->
                            <div class="max-w-7xl mx-auto px-4 py-6 flex-1 w-full grid grid-cols-1 md:grid-cols-4 gap-6">
                                <!-- Sidebar Links -->
                                <div class="bg-white p-4 rounded-xl shadow-sm h-fit space-y-2">
                                    <a href="/customer" class="block p-2 rounded bg-blue-50 text-blue-700 font-medium"><i class="fas fa-home mr-2"></i> Dashboard</a>
                                    <a href="/customer/apply" class="block p-2 rounded hover:bg-gray-50 text-gray-700"><i class="fas fa-file-alt mr-2"></i> New Application</a>
                                    <a href="/customer/profile" class="block p-2 rounded hover:bg-gray-50 text-gray-700"><i class="fas fa-user mr-2"></i> Profile & Password</a>
                                    <a href="/track" target="_blank" class="block p-2 rounded hover:bg-gray-50 text-gray-700"><i class="fas fa-search mr-2"></i> Public Track</a>
                                </div>

                                <!-- Content Area -->
                                <div class="md:col-span-3 space-y-6">
                                    <!-- Notifications Bar -->
                                    <div class="bg-white p-4 rounded-xl shadow-sm">
                                        <h3 class="font-bold text-gray-800 mb-2 flex items-center justify-between">
                                            <span><i class="fas fa-bell text-blue-600 mr-2"></i> Notifications</span>
                                            ${unreadCount > 0 ? `<span class="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full">${unreadCount} Unread</span>` : ''}
                                        </h3>
                                        <div class="space-y-2 max-h-40 overflow-y-auto">
                                            ${notifs.length === 0 ? '<p class="text-sm text-gray-500">No notifications yet.</p>' : ''}
                                            ${notifs.map(n => `
                                                <div class="p-2 text-sm bg-gray-50 rounded border-l-4 ${n.is_read ? 'border-gray-300 text-gray-600' : 'border-blue-600 text-gray-800 font-medium'} flex justify-between">
                                                    <span>${n.message}</span>
                                                    <span class="text-xs text-gray-400 ml-2">${n.created_at}</span>
                                                </div>
                                            `).join('')}
                                        </div>
                                    </div>

                                    <!-- My Applications -->
                                    <div class="bg-white p-6 rounded-xl shadow-sm">
                                        <div class="flex justify-between items-center mb-4">
                                            <h3 class="font-bold text-lg text-gray-800">My Applications</h3>
                                            <a href="/customer/apply" class="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700">+ New Application</a>
                                        </div>
                                        <div class="overflow-x-auto">
                                            <table class="w-full text-left border-collapse text-sm">
                                                <thead>
                                                    <tr class="bg-gray-50 border-b">
                                                        <th class="p-3">Tracking No.</th>
                                                        <th class="p-3">Service</th>
                                                        <th class="p-3">Status</th>
                                                        <th class="p-3">Payment</th>
                                                        <th class="p-3">Date Submitted</th>
                                                        <th class="p-3">Action</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    ${apps.length === 0 ? `<tr><td colspan="6" class="p-4 text-center text-gray-500">No applications found. Click 'New Application' to start.</td></tr>` : ''}
                                                    ${apps.map(app => `
                                                        <tr class="border-b hover:bg-gray-50">
                                                            <td class="p-3 font-mono font-bold text-blue-600">${app.tracking_number}</td>
                                                            <td class="p-3 uppercase font-medium">${app.service_type}</td>
                                                            <td class="p-3"><span class="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs font-semibold">${app.status}</span></td>
                                                            <td class="p-3"><span class="px-2 py-1 rounded text-xs font-semibold ${app.payment_status === 'Paid' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}">${app.payment_status}</span></td>
                                                            <td class="p-3 text-gray-500">${app.created_at}</td>
                                                            <td class="p-3">
                                                                <a href="/customer/application/${app.id}" class="text-blue-600 hover:underline font-medium">View / Pay</a>
                                                            </td>
                                                        </tr>
                                                    `).join('')}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- Footer Disclaimer -->
                            <footer class="bg-white border-t py-4 text-center text-xs text-gray-500 px-4">
                                <p>${settings.terms}</p>
                            </footer>
                        </div>
                    </body>
                    </html>
                    `);
                });
            });
        });
    });
});

// ---------------------------------------------------------
// CUSTOMER APPLICATION WIZARD (9 STEPS)
// ---------------------------------------------------------
app.get('/customer/apply', requireCustomer, (req, res) => {
    getSettings(settings => {
        res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>New Application - ${settings.business_name}</title>
            <script src="https://cdn.tailwindcss.com"></script>
            <script src="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/js/all.min.js"></script>
        </head>
        <body class="bg-gray-100 font-sans py-10">
            <div class="max-w-3xl mx-auto bg-white p-8 rounded-xl shadow-md">
                <div class="mb-6 border-b pb-4 flex justify-between items-center">
                    <div>
                        <h1 class="text-2xl font-bold text-blue-900">New Government Application</h1>
                        <p class="text-sm text-gray-600">Select service and complete the step-by-step wizard.</p>
                    </div>
                    <a href="/customer" class="text-gray-500 hover:text-gray-700"><i class="fas fa-times text-xl"></i></a>
                </div>

                <form id="wizardForm" method="POST" action="/customer/apply" enctype="multipart/form-data">
                    <!-- Step 0: Select Service -->
                    <div class="wizard-step" data-step="0">
                        <h2 class="text-lg font-bold text-gray-800 mb-4">Select Service Type</h2>
                        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                            <label class="border p-4 rounded-xl cursor-pointer hover:border-blue-600 flex flex-col items-center text-center">
                                <input type="radio" name="service_type" value="bir" required class="mb-2" onchange="updateFees('bir')">
                                <span class="font-bold text-blue-900">BIR / TIN</span>
                                <span class="text-xs text-gray-500 mt-1">Tax Identification Number Application & Assistance</span>
                                <span class="text-sm font-semibold text-green-600 mt-2">Fee: ₱${settings.bir_fee}</span>
                            </label>
                            <label class="border p-4 rounded-xl cursor-pointer hover:border-blue-600 flex flex-col items-center text-center">
                                <input type="radio" name="service_type" value="sss" required class="mb-2" onchange="updateFees('sss')">
                                <span class="font-bold text-blue-900">SSS APPLICATION</span>
                                <span class="text-xs text-gray-500 mt-1">Social Security System Registration & Assistance</span>
                                <span class="text-sm font-semibold text-green-600 mt-2">Fee: ₱${settings.sss_fee}</span>
                            </label>
                            <label class="border p-4 rounded-xl cursor-pointer hover:border-blue-600 flex flex-col items-center text-center">
                                <input type="radio" name="service_type" value="pagibig" required class="mb-2" onchange="updateFees('pagibig')">
                                <span class="font-bold text-blue-900">PAG-IBIG APPLICATION</span>
                                <span class="text-xs text-gray-500 mt-1">HDMF Pag-IBIG Membership Registration</span>
                                <span class="text-sm font-semibold text-green-600 mt-2">Fee: ₱${settings.pagibig_fee}</span>
                            </label>
                        </div>
                        <div class="flex justify-end">
                            <button type="button" onclick="nextStep(1)" class="bg-blue-600 text-white px-6 py-2 rounded font-medium hover:bg-blue-700">Next Step <i class="fas fa-arrow-right ml-1"></i></button>
                        </div>
                    </div>

                    <!-- Step 1: Personal Information -->
                    <div class="wizard-step hidden" data-step="1">
                        <h2 class="text-lg font-bold text-gray-800 mb-4">Step 1: Personal Information</h2>
                        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                            <div><label class="block text-sm font-medium">First Name *</label><input type="text" name="first_name" required class="w-full border p-2 rounded mt-1"></div>
                            <div><label class="block text-sm font-medium">Middle Name</label><input type="text" name="middle_name" class="w-full border p-2 rounded mt-1"></div>
                            <div><label class="block text-sm font-medium">Last Name *</label><input type="text" name="last_name" required class="w-full border p-2 rounded mt-1"></div>
                        </div>
                        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                            <div><label class="block text-sm font-medium">Suffix (Jr, Sr, III)</label><input type="text" name="suffix" class="w-full border p-2 rounded mt-1"></div>
                            <div><label class="block text-sm font-medium">Date of Birth *</label><input type="date" name="dob" required class="w-full border p-2 rounded mt-1"></div>
                            <div><label class="block text-sm font-medium">Place of Birth *</label><input type="text" name="pob" required class="w-full border p-2 rounded mt-1"></div>
                        </div>
                        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                            <div>
                                <label class="block text-sm font-medium">Sex *</label>
                                <select name="sex" required class="w-full border p-2 rounded mt-1">
                                    <option value="">Select Sex</option>
                                    <option value="Male">Male</option>
                                    <option value="Female">Female</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-sm font-medium">Civil Status *</label>
                                <select name="civil_status" id="civilStatusSelect" required onchange="toggleSpouseSection()" class="w-full border p-2 rounded mt-1">
                                    <option value="">Select Status</option>
                                    <option value="Single">Single</option>
                                    <option value="Married">Married</option>
                                    <option value="Widowed">Widowed</option>
                                    <option value="Separated">Separated</option>
                                </select>
                            </div>
                            <div><label class="block text-sm font-medium">Nationality *</label><input type="text" name="nationality" value="Filipino" required class="w-full border p-2 rounded mt-1"></div>
                        </div>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                            <div><label class="block text-sm font-medium">Mobile Number *</label><input type="text" name="mobile" placeholder="09XXXXXXXXX" required class="w-full border p-2 rounded mt-1"></div>
                            <div><label class="block text-sm font-medium">Email Address *</label><input type="email" name="email" required class="w-full border p-2 rounded mt-1"></div>
                        </div>
                        <div class="flex justify-between">
                            <button type="button" onclick="prevStep(0)" class="bg-gray-300 text-gray-700 px-6 py-2 rounded font-medium hover:bg-gray-400"><i class="fas fa-arrow-left mr-1"></i> Back</button>
                            <button type="button" onclick="nextStep(2)" class="bg-blue-600 text-white px-6 py-2 rounded font-medium hover:bg-blue-700">Next Step <i class="fas fa-arrow-right ml-1"></i></button>
                        </div>
                    </div>

                    <!-- Step 2: Address -->
                    <div class="wizard-step hidden" data-step="2">
                        <h2 class="text-lg font-bold text-gray-800 mb-4">Step 2: Complete Address</h2>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                            <div><label class="block text-sm font-medium">House / Block / Lot No.</label><input type="text" name="house_block_lot" class="w-full border p-2 rounded mt-1"></div>
                            <div><label class="block text-sm font-medium">Street</label><input type="text" name="street" class="w-full border p-2 rounded mt-1"></div>
                        </div>
                        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                            <div><label class="block text-sm font-medium">Barangay *</label><input type="text" name="barangay" required class="w-full border p-2 rounded mt-1"></div>
                            <div><label class="block text-sm font-medium">Municipality / City *</label><input type="text" name="municipality_city" required class="w-full border p-2 rounded mt-1"></div>
                            <div><label class="block text-sm font-medium">Province *</label><input type="text" name="province" required class="w-full border p-2 rounded mt-1"></div>
                        </div>
                        <div class="mb-6">
                            <div class="w-full md:w-1/3"><label class="block text-sm font-medium">ZIP Code *</label><input type="text" name="zip_code" required class="w-full border p-2 rounded mt-1"></div>
                        </div>
                        <div class="flex justify-between">
                            <button type="button" onclick="prevStep(1)" class="bg-gray-300 text-gray-700 px-6 py-2 rounded font-medium hover:bg-gray-400"><i class="fas fa-arrow-left mr-1"></i> Back</button>
                            <button type="button" onclick="nextStep(3)" class="bg-blue-600 text-white px-6 py-2 rounded font-medium hover:bg-blue-700">Next Step <i class="fas fa-arrow-right ml-1"></i></button>
                        </div>
                    </div>

                    <!-- Step 3: Parents Information -->
                    <div class="wizard-step hidden" data-step="3">
                        <h2 class="text-lg font-bold text-gray-800 mb-4">Step 3: Parents Information (Required for SSS / Pag-IBIG / BIR)</h2>
                        <div class="mb-6 p-4 bg-gray-50 rounded-xl border">
                            <h3 class="font-semibold text-blue-900 mb-3">Father's Information</h3>
                            <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-3">
                                <div><label class="block text-sm font-medium">First Name</label><input type="text" name="father_first_name" class="w-full border p-2 rounded mt-1"></div>
                                <div><label class="block text-sm font-medium">Middle Name</label><input type="text" name="father_middle_name" class="w-full border p-2 rounded mt-1"></div>
                                <div><label class="block text-sm font-medium">Last Name</label><input type="text" name="father_last_name" class="w-full border p-2 rounded mt-1"></div>
                            </div>
                            <div><label class="block text-sm font-medium">Father's Date of Birth</label><input type="date" name="father_dob" class="w-full md:w-1/3 border p-2 rounded mt-1"></div>
                        </div>

                        <div class="mb-6 p-4 bg-gray-50 rounded-xl border">
                            <h3 class="font-semibold text-blue-900 mb-3">Mother's Information</h3>
                            <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-3">
                                <div><label class="block text-sm font-medium">First Name</label><input type="text" name="mother_first_name" class="w-full border p-2 rounded mt-1"></div>
                                <div><label class="block text-sm font-medium">Middle Name</label><input type="text" name="mother_middle_name" class="w-full border p-2 rounded mt-1"></div>
                                <div><label class="block text-sm font-medium">Maiden Name</label><input type="text" name="mother_maiden_name" class="w-full border p-2 rounded mt-1"></div>
                            </div>
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div><label class="block text-sm font-medium">Last Name</label><input type="text" name="mother_last_name" class="w-full border p-2 rounded mt-1"></div>
                                <div><label class="block text-sm font-medium">Mother's Date of Birth</label><input type="date" name="mother_dob" class="w-full border p-2 rounded mt-1"></div>
                            </div>
                        </div>
                        <div class="flex justify-between">
                            <button type="button" onclick="prevStep(2)" class="bg-gray-300 text-gray-700 px-6 py-2 rounded font-medium hover:bg-gray-400"><i class="fas fa-arrow-left mr-1"></i> Back</button>
                            <button type="button" onclick="nextStep(4)" class="bg-blue-600 text-white px-6 py-2 rounded font-medium hover:bg-blue-700">Next Step <i class="fas fa-arrow-right ml-1"></i></button>
                        </div>
                    </div>

                    <!-- Step 4: Beneficiaries / Dependents -->
                    <div class="wizard-step hidden" data-step="4">
                        <h2 class="text-lg font-bold text-gray-800 mb-2">Step 4: Beneficiaries / Dependents</h2>
                        <p class="text-sm text-gray-600 mb-4">You can add multiple beneficiaries. Click "+ Add Beneficiary" for each.</p>
                        
                        <div id="beneficiariesContainer" class="space-y-4 mb-4">
                            <div class="beneficiary-item p-4 bg-gray-50 rounded-xl border relative">
                                <h3 class="font-semibold text-gray-700 mb-2">Beneficiary 1</h3>
                                <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-3">
                                    <div><label class="block text-sm font-medium">Full Name *</label><input type="text" name="ben_full_name[]" required class="w-full border p-2 rounded mt-1"></div>
                                    <div><label class="block text-sm font-medium">Relationship *</label><input type="text" name="ben_relationship[]" placeholder="e.g. Spouse, Child, Parent" required class="w-full border p-2 rounded mt-1"></div>
                                    <div><label class="block text-sm font-medium">Date of Birth *</label><input type="date" name="ben_dob[]" required class="w-full border p-2 rounded mt-1"></div>
                                </div>
                                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label class="block text-sm font-medium">Sex *</label>
                                        <select name="ben_sex[]" required class="w-full border p-2 rounded mt-1">
                                            <option value="Male">Male</option>
                                            <option value="Female">Female</option>
                                        </select>
                                    </div>
                                    <div><label class="block text-sm font-medium">Address *</label><input type="text" name="ben_address[]" required class="w-full border p-2 rounded mt-1"></div>
                                </div>
                            </div>
                        </div>

                        <button type="button" onclick="addBeneficiary()" class="bg-green-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-green-700 mb-6"><i class="fas fa-plus mr-1"></i> Add Beneficiary</button>

                        <div class="flex justify-between">
                            <button type="button" onclick="prevStep(3)" class="bg-gray-300 text-gray-700 px-6 py-2 rounded font-medium hover:bg-gray-400"><i class="fas fa-arrow-left mr-1"></i> Back</button>
                            <button type="button" onclick="nextStep(5)" class="bg-blue-600 text-white px-6 py-2 rounded font-medium hover:bg-blue-700">Next Step <i class="fas fa-arrow-right ml-1"></i></button>
                        </div>
                    </div>

                    <!-- Step 5: Employment Information -->
                    <div class="wizard-step hidden" data-step="5">
                        <h2 class="text-lg font-bold text-gray-800 mb-4">Step 5: Employment Information</h2>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                            <div>
                                <label class="block text-sm font-medium">Employment Status *</label>
                                <select name="employment_status" id="empStatus" required onchange="toggleEmploymentFields()" class="w-full border p-2 rounded mt-1">
                                    <option value="">Select Status</option>
                                    <option value="Employed">Employed</option>
                                    <option value="Self-Employed">Self-Employed</option>
                                    <option value="Unemployed">Unemployed</option>
                                    <option value="Freelancer">Freelancer</option>
                                </select>
                            </div>
                            <div><label class="block text-sm font-medium">Monthly Income (₱)</label><input type="text" name="monthly_income" class="w-full border p-2 rounded mt-1"></div>
                        </div>
                        <div id="employerSection" class="space-y-4 mb-4 hidden p-4 bg-gray-50 rounded-xl border">
                            <h3 class="font-semibold text-blue-900">Employer Details</h3>
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div><label class="block text-sm font-medium">Employer Name</label><input type="text" name="employer_name" class="w-full border p-2 rounded mt-1"></div>
                                <div><label class="block text-sm font-medium">Employer Contact Number</label><input type="text" name="employer_contact" class="w-full border p-2 rounded mt-1"></div>
                            </div>
                            <div><label class="block text-sm font-medium">Employer Address</label><input type="text" name="employer_address" class="w-full border p-2 rounded mt-1"></div>
                        </div>
                        <div id="selfEmployedSection" class="space-y-4 mb-4 hidden p-4 bg-gray-50 rounded-xl border">
                            <h3 class="font-semibold text-blue-900">Business Details</h3>
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div><label class="block text-sm font-medium">Business Name</label><input type="text" name="business_name" class="w-full border p-2 rounded mt-1"></div>
                                <div><label class="block text-sm font-medium">Date Started</label><input type="date" name="date_started" class="w-full border p-2 rounded mt-1"></div>
                            </div>
                            <div><label class="block text-sm font-medium">Business Address</label><input type="text" name="business_address" class="w-full border p-2 rounded mt-1"></div>
                        </div>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                            <div><label class="block text-sm font-medium">Occupation</label><input type="text" name="occupation" class="w-full border p-2 rounded mt-1"></div>
                            <div><label class="block text-sm font-medium">Position</label><input type="text" name="position" class="w-full border p-2 rounded mt-1"></div>
                        </div>
                        <div class="flex justify-between">
                            <button type="button" onclick="prevStep(4)" class="bg-gray-300 text-gray-700 px-6 py-2 rounded font-medium hover:bg-gray-400"><i class="fas fa-arrow-left mr-1"></i> Back</button>
                            <button type="button" onclick="nextStep(6)" class="bg-blue-600 text-white px-6 py-2 rounded font-medium hover:bg-blue-700">Next Step <i class="fas fa-arrow-right ml-1"></i></button>
                        </div>
                    </div>

                    <!-- Step 6: Civil Status & Spouse (Conditional) -->
                    <div class="wizard-step hidden" data-step="6">
                        <h2 class="text-lg font-bold text-gray-800 mb-2">Step 6: Spouse Information & Marriage Certificate</h2>
                        <p class="text-sm text-gray-600 mb-4">If you selected Married, please provide spouse details and upload your Marriage Certificate.</p>
                        
                        <div id="spouseWrapper" class="p-4 bg-gray-50 rounded-xl border mb-6">
                            <div id="spouseNotMarriedMsg" class="text-sm text-gray-500">You are currently single/widowed/separated. Spouse information is not required.</div>
                            <div id="spouseFields" class="space-y-4 hidden">
                                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div><label class="block text-sm font-medium">Spouse Full Name</label><input type="text" name="spouse_full_name" class="w-full border p-2 rounded mt-1"></div>
                                    <div><label class="block text-sm font-medium">Spouse Date of Birth</label><input type="date" name="spouse_dob" class="w-full border p-2 rounded mt-1"></div>
                                </div>
                                <div>
                                    <label class="block text-sm font-medium">Marriage Certificate (Take Photo or Upload)</label>
                                    <input type="file" name="marriage_cert" accept="image/*,application/pdf" class="w-full border p-2 rounded mt-1 bg-white">
                                </div>
                            </div>
                        </div>

                        <div class="flex justify-between">
                            <button type="button" onclick="prevStep(5)" class="bg-gray-300 text-gray-700 px-6 py-2 rounded font-medium hover:bg-gray-400"><i class="fas fa-arrow-left mr-1"></i> Back</button>
                            <button type="button" onclick="nextStep(7)" class="bg-blue-600 text-white px-6 py-2 rounded font-medium hover:bg-blue-700">Next Step <i class="fas fa-arrow-right ml-1"></i></button>
                        </div>
                    </div>

                    <!-- Step 7: Documents & Camera Upload -->
                    <div class="wizard-step hidden" data-step="7">
                        <h2 class="text-lg font-bold text-gray-800 mb-2">Step 7: Required Documents</h2>
                        <p class="text-sm text-gray-600 mb-4">Upload a valid ID, your photo holding the ID, and ID picture.</p>
                        
                        <div class="space-y-4 mb-6">
                            <div>
                                <label class="block text-sm font-medium">Select Valid ID Type *</label>
                                <select name="valid_id_type" required class="w-full border p-2 rounded mt-1 mb-2">
                                    <option value="National ID">National ID (PhilID)</option>
                                    <option value="Driver's License">Driver's License</option>
                                    <option value="Passport">Passport</option>
                                    <option value="UMID">UMID</option>
                                    <option value="Postal ID">Postal ID</option>
                                    <option value="Other Valid Govt ID">Other Valid Government ID</option>
                                </select>
                            </div>

                            <div class="p-4 bg-gray-50 rounded-xl border">
                                <label class="block text-sm font-bold text-gray-800 mb-1">Valid ID Upload (Front / Back) *</label>
                                <p class="text-xs text-gray-500 mb-2">Use "Take Photo" on mobile or upload file.</p>
                                <input type="file" name="valid_id" accept="image/*" capture="environment" required class="w-full border p-2 rounded bg-white">
                            </div>

                            <div class="p-4 bg-gray-50 rounded-xl border">
                                <label class="block text-sm font-bold text-gray-800 mb-1">Photo of You Holding Your Valid ID *</label>
                                <p class="text-xs text-gray-500 mb-2">Take a clear picture of yourself while holding the same ID you uploaded.</p>
                                <input type="file" name="photo_holding_id" accept="image/*" capture="user" required class="w-full border p-2 rounded bg-white">
                            </div>

                            <div class="p-4 bg-gray-50 rounded-xl border">
                                <label class="block text-sm font-bold text-gray-800 mb-1">2x2 ID Picture *</label>
                                <input type="file" name="id_picture" accept="image/*" required class="w-full border p-2 rounded bg-white">
                            </div>
                        </div>

                        <div class="flex justify-between">
                            <button type="button" onclick="prevStep(6)" class="bg-gray-300 text-gray-700 px-6 py-2 rounded font-medium hover:bg-gray-400"><i class="fas fa-arrow-left mr-1"></i> Back</button>
                            <button type="button" onclick="nextStep(8)" class="bg-blue-600 text-white px-6 py-2 rounded font-medium hover:bg-blue-700">Next Step <i class="fas fa-arrow-right ml-1"></i></button>
                        </div>
                    </div>

                    <!-- Step 8: Payment -->
                    <div class="wizard-step hidden" data-step="8">
                        <h2 class="text-lg font-bold text-gray-800 mb-2">Step 8: Payment Options</h2>
                        <p class="text-sm text-gray-600 mb-4">Service Fee Amount to Pay: <span id="displayFee" class="font-bold text-green-600 text-lg">₱500</span></p>

                        <div class="space-y-4 mb-6">
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <label class="border p-4 rounded-xl cursor-pointer hover:border-blue-600 flex items-center space-x-3">
                                    <input type="radio" name="payment_method" value="gcash" checked onchange="togglePaymentMethod('gcash')">
                                    <div>
                                        <span class="font-bold text-blue-900 block">GCash Payment</span>
                                        <span class="text-xs text-gray-500">Scan QR or send to GCash number</span>
                                    </div>
                                </label>
                                <label class="border p-4 rounded-xl cursor-pointer hover:border-blue-600 flex items-center space-x-3">
                                    <input type="radio" name="payment_method" value="cash" onchange="togglePaymentMethod('cash')">
                                    <div>
                                        <span class="font-bold text-blue-900 block">Cash Payment</span>
                                        <span class="text-xs text-gray-500">Pay at office or partner agents</span>
                                    </div>
                                </label>
                            </div>

                            <!-- GCash Box -->
                            <div id="gcashBox" class="p-4 bg-blue-50 rounded-xl border border-blue-200">
                                <h3 class="font-bold text-blue-900 mb-2">GCash Transfer Details</h3>
                                <p class="text-sm text-gray-700">Account Name: <strong>${settings.gcash_account_name}</strong></p>
                                <p class="text-sm text-gray-700 mb-3">GCash Number: <strong>${settings.gcash_number}</strong></p>
                                ${settings.gcash_qr ? `<div class="mb-3"><img src="${settings.gcash_qr}" alt="GCash QR" class="w-48 h-48 object-cover border rounded"></div>` : '<p class="text-xs text-gray-500 mb-3">[Admin QR Code not uploaded yet. Use GCash Number above]</p>'}
                                
                                <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                                    <div><label class="block text-xs font-medium">Reference Number *</label><input type="text" name="payment_ref" class="w-full border p-2 rounded text-sm mt-1"></div>
                                    <div><label class="block text-xs font-medium">Amount Paid *</label><input type="number" name="amount_paid" class="w-full border p-2 rounded text-sm mt-1"></div>
                                    <div><label class="block text-xs font-medium">Date Paid *</label><input type="date" name="date_paid" class="w-full border p-2 rounded text-sm mt-1"></div>
                                </div>
                                <div class="mt-3">
                                    <label class="block text-xs font-medium">Upload Payment Screenshot / Proof *</label>
                                    <input type="file" name="gcash_proof" accept="image/*" class="w-full border p-2 rounded text-sm bg-white mt-1">
                                </div>
                            </div>

                            <!-- Cash Box -->
                            <div id="cashBox" class="p-4 bg-yellow-50 rounded-xl border border-yellow-200 hidden">
                                <h3 class="font-bold text-yellow-900 mb-2">Cash Payment Instructions</h3>
                                <p class="text-sm text-gray-700">${settings.cash_instructions}</p>
                            </div>
                        </div>

                        <div class="flex justify-between">
                            <button type="button" onclick="prevStep(7)" class="bg-gray-300 text-gray-700 px-6 py-2 rounded font-medium hover:bg-gray-400"><i class="fas fa-arrow-left mr-1"></i> Back</button>
                            <button type="button" onclick="nextStep(9)" class="bg-blue-600 text-white px-6 py-2 rounded font-medium hover:bg-blue-700">Review & Submit <i class="fas fa-arrow-right ml-1"></i></button>
                        </div>
                    </div>

                    <!-- Step 9: Review & Submit -->
                    <div class="wizard-step hidden" data-step="9">
                        <h2 class="text-lg font-bold text-gray-800 mb-2">Step 9: Review & Submit</h2>
                        <p class="text-sm text-gray-600 mb-4">Please verify your information before final submission.</p>

                        <div class="p-4 bg-gray-50 rounded-xl border mb-6 text-sm space-y-2">
                            <p><strong>Service Selected:</strong> <span id="revService" class="uppercase text-blue-600 font-bold"></span></p>
                            <p><strong>Full Name:</strong> <span id="revName"></span></p>
                            <p><strong>Mobile Number:</strong> <span id="revMobile"></span></p>
                            <p><strong>Email Address:</strong> <span id="revEmail"></span></p>
                            <p><strong>Civil Status:</strong> <span id="revCivil"></span></p>
                            <p><strong>Payment Method:</strong> <span id="revPayment" class="uppercase"></span></p>
                        </div>

                        <div class="mb-6">
                            <label class="flex items-center space-x-3 cursor-pointer">
                                <input type="checkbox" required class="w-5 h-5 text-blue-600 rounded">
                                <span class="text-sm font-medium text-gray-800">I confirm that the information I provided is correct and complete.</span>
                            </label>
                        </div>

                        <div class="flex justify-between">
                            <button type="button" onclick="prevStep(8)" class="bg-gray-300 text-gray-700 px-6 py-2 rounded font-medium hover:bg-gray-400"><i class="fas fa-arrow-left mr-1"></i> Back</button>
                            <button type="submit" class="bg-green-600 text-white px-8 py-3 rounded-xl font-bold hover:bg-green-700 text-lg shadow-md"><i class="fas fa-paper-plane mr-2"></i> Submit Application</button>
                        </div>
                    </div>
                </form>
            </div>

            <script>
                const fees = { bir: ${settings.bir_fee}, sss: ${settings.sss_fee}, pagibig: ${settings.pagibig_fee} };
                let currentStep = 0;

                function updateFees(service) {
                    const fee = fees[service] || 500;
                    document.getElementById('displayFee').innerText = '₱' + fee;
                }

                function showStep(step) {
                    document.querySelectorAll('.wizard-step').forEach(el => el.classList.add('hidden'));
                    document.querySelector('.wizard-step[data-step="'+step+'"]').classList.remove('hidden');
                    currentStep = step;
                    window.scrollTo(0,0);
                    if(step === 9) populateReview();
                }

                function nextStep(step) {
                    // Simple validation for step 0
                    if(step === 1) {
                        const checked = document.querySelector('input[name="service_type"]:checked');
                        if(!checked) { alert('Please select a service type.'); return; }
                    }
                    showStep(step);
                }

                function prevStep(step) { showStep(step); }

                function toggleSpouseSection() {
                    const status = document.getElementById('civilStatusSelect').value;
                    const msg = document.getElementById('spouseNotMarriedMsg');
                    const fields = document.getElementById('spouseFields');
                    if(status === 'Married') {
                        msg.classList.add('hidden');
                        fields.classList.remove('hidden');
                    } else {
                        msg.classList.remove('hidden');
                        fields.classList.add('hidden');
                    }
                }

                function addBeneficiary() {
                    const container = document.getElementById('beneficiariesContainer');
                    const count = container.querySelectorAll('.beneficiary-item').length + 1;
                    const div = document.createElement('div');
                    div.className = 'beneficiary-item p-4 bg-gray-50 rounded-xl border relative mt-3';
                    div.innerHTML = \`
                        <div class="flex justify-between items-center mb-2">
                            <h3 class="font-semibold text-gray-700">Beneficiary \${count}</h3>
                            <button type="button" onclick="this.closest('.beneficiary-item').remove()" class="text-red-500 text-xs font-bold hover:underline">Remove</button>
                        </div>
                        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-3">
                            <div><label class="block text-sm font-medium">Full Name *</label><input type="text" name="ben_full_name[]" required class="w-full border p-2 rounded mt-1"></div>
                            <div><label class="block text-sm font-medium">Relationship *</label><input type="text" name="ben_relationship[]" required class="w-full border p-2 rounded mt-1"></div>
                            <div><label class="block text-sm font-medium">Date of Birth *</label><input type="date" name="ben_dob[]" required class="w-full border p-2 rounded mt-1"></div>
                        </div>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label class="block text-sm font-medium">Sex *</label>
                                <select name="ben_sex[]" required class="w-full border p-2 rounded mt-1">
                                    <option value="Male">Male</option>
                                    <option value="Female">Female</option>
                                </select>
                            </div>
                            <div><label class="block text-sm font-medium">Address *</label><input type="text" name="ben_address[]" required class="w-full border p-2 rounded mt-1"></div>
                        </div>
                    \`;
                    container.appendChild(div);
                }

                function toggleEmploymentFields() {
                    const status = document.getElementById('empStatus').value;
                    const empSec = document.getElementById('employerSection');
                    const selfSec = document.getElementById('selfEmployedSection');
                    empSec.classList.add('hidden');
                    selfSec.classList.add('hidden');
                    if(status === 'Employed') empSec.classList.remove('hidden');
                    if(status === 'Self-Employed' || status === 'Freelancer') selfSec.classList.remove('hidden');
                }

                function togglePaymentMethod(method) {
                    const gcashBox = document.getElementById('gcashBox');
                    const cashBox = document.getElementById('cashBox');
                    if(method === 'gcash') {
                        gcashBox.classList.remove('hidden');
                        cashBox.classList.add('hidden');
                    } else {
                        gcashBox.classList.add('hidden');
                        cashBox.classList.remove('hidden');
                    }
                }

                function populateReview() {
                    const form = document.getElementById('wizardForm');
                    document.getElementById('revService').innerText = form.querySelector('input[name="service_type"]:checked').value;
                    document.getElementById('revName').innerText = form.querySelector('input[name="first_name"]').value + ' ' + form.querySelector('input[name="last_name"]').value;
                    document.getElementById('revMobile').innerText = form.querySelector('input[name="mobile"]').value;
                    document.getElementById('revEmail').innerText = form.querySelector('input[name="email"]').value;
                    document.getElementById('revCivil').innerText = form.querySelector('select[name="civil_status"]').value;
                    document.getElementById('revPayment').innerText = form.querySelector('input[name="payment_method"]:checked').value;
                }
            </script>
        </body>
        </html>
        `);
    });
});

// Handle Wizard Form Submission
const uploadFields = upload.fields([
    { name: 'marriage_cert', maxCount: 1 },
    { name: 'valid_id', maxCount: 1 },
    { name: 'photo_holding_id', maxCount: 1 },
    { name: 'id_picture', maxCount: 1 },
    { name: 'gcash_proof', maxCount: 1 }
]);

app.post('/customer/apply', requireCustomer, uploadFields, (req, res) => {
    const userId = req.session.userId;
    const body = req.body;
    const files = req.files || {};

    getSettings(settings => {
        const service = body.service_type;
        const fee = service === 'bir' ? settings.bir_fee : (service === 'sss' ? settings.sss_fee : settings.pagibig_fee);
        
        // Generate Unique Tracking Number
        const dateStr = new Date().toISOString().slice(0,10).replace(/-/g,'');
        const randNum = Math.floor(1000 + Math.random() * 9000);
        const trackingNumber = `${service.toUpperCase()}-${dateStr}-${randNum}`;

        db.serialize(() => {
            db.run(`INSERT INTO applications (user_id, service_type, tracking_number, payment_method, payment_ref, amount_paid, date_paid, payment_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [userId, service, trackingNumber, body.payment_method, body.payment_ref || '', body.amount_paid || fee, body.date_paid || '', body.payment_method === 'gcash' ? 'Pending Verification' : 'Unpaid'], function(err) {
                    if(err) {
                        return res.redirect('/customer?error=Failed to submit application');
                    }
                    const appId = this.lastID;

                    // Applicant Info
                    db.run(`INSERT INTO applicant_information (application_id, first_name, middle_name, last_name, suffix, dob, pob, sex, civil_status, nationality, mobile, email, house_block_lot, street, barangay, municipality_city, province, zip_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [appId, body.first_name, body.middle_name, body.last_name, body.suffix, body.dob, body.pob, body.sex, body.civil_status, body.nationality, body.mobile, body.email, body.house_block_lot, body.street, body.barangay, body.municipality_city, body.province, body.zip_code]);

                    // Parents
                    db.run(`INSERT INTO parents (application_id, father_first_name, father_middle_name, father_last_name, father_dob, mother_first_name, mother_middle_name, mother_maiden_name, mother_last_name, mother_dob) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [appId, body.father_first_name, body.father_middle_name, body.father_last_name, body.father_dob, body.mother_first_name, body.mother_middle_name, body.mother_maiden_name, body.mother_last_name, body.mother_dob]);

                    // Spouse
                    if(body.civil_status === 'Married') {
                        const mcPath = files.marriage_cert ? files.marriage_cert[0].path : '';
                        db.run(`INSERT INTO spouses (application_id, spouse_full_name, spouse_dob, marriage_cert) VALUES (?, ?, ?, ?)`,
                            [appId, body.spouse_full_name, body.spouse_dob, mcPath]);
                    }

                    // Beneficiaries
                    if(body.ben_full_name && Array.isArray(body.ben_full_name)) {
                        for(let i=0; i<body.ben_full_name.length; i++) {
                            db.run(`INSERT INTO beneficiaries (application_id, full_name, relationship, dob, sex, address) VALUES (?, ?, ?, ?, ?, ?)`,
                                [appId, body.ben_full_name[i], body.ben_relationship[i], body.ben_dob[i], body.ben_sex[i], body.ben_address[i]]);
                        }
                    }

                    // Employment
                    db.run(`INSERT INTO employment (application_id, employment_status, employer_name, employer_address, employer_contact, occupation, position, monthly_income, date_started, business_name, business_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [appId, body.employment_status, body.employer_name, body.employer_address, body.employer_contact, body.occupation, body.position, body.monthly_income, body.date_started, body.business_name, body.business_address]);

                    // Documents
                    if(files.valid_id) db.run(`INSERT INTO documents (application_id, doc_type, file_path, file_name) VALUES (?, ?, ?, ?)`, [appId, 'Valid ID', files.valid_id[0].path, files.valid_id[0].filename]);
                    if(files.photo_holding_id) db.run(`INSERT INTO documents (application_id, doc_type, file_path, file_name) VALUES (?, ?, ?, ?)`, [appId, 'Photo Holding ID', files.photo_holding_id[0].path, files.photo_holding_id[0].filename]);
                    if(files.id_picture) db.run(`INSERT INTO documents (application_id, doc_type, file_path, file_name) VALUES (?, ?, ?, ?)`, [appId, 'ID Picture', files.id_picture[0].path, files.id_picture[0].filename]);
                    if(files.marriage_cert) db.run(`INSERT INTO documents (application_id, doc_type, file_path, file_name) VALUES (?, ?, ?, ?)`, [appId, 'Marriage Certificate', files.marriage_cert[0].path, files.marriage_cert[0].filename]);
                    if(files.gcash_proof) db.run(`INSERT INTO documents (application_id, doc_type, file_path, file_name) VALUES (?, ?, ?, ?)`, [appId, 'GCash Proof', files.gcash_proof[0].path, files.gcash_proof[0].filename]);

                    // Status history & Notification
                    db.run(`INSERT INTO status_history (application_id, action, user_name, remarks) VALUES (?, ?, ?, ?)`, [appId, 'Application Submitted', req.session.userName, 'Application successfully created and submitted.']);
                    db.run(`INSERT INTO notifications (user_id, message) VALUES (?, ?)`, [userId, `Your application ${trackingNumber} has been successfully submitted.`]);

                    res.redirect('/customer');
                });
        });
    });
});

// Customer View Application Details & Completed Documents
app.get('/customer/application/:id', requireCustomer, (req, res) => {
    const appId = req.params.id;
    db.get(`SELECT * FROM applications WHERE id = ? AND user_id = ?`, [appId, req.session.userId], (err, app) => {
        if(!app) return res.redirect('/customer');

        db.all(`SELECT * FROM documents WHERE application_id = ?`, [appId], (err, docs) => {
            db.all(`SELECT * FROM admin_uploaded_files WHERE application_id = ?`, [appId], (err, adminFiles) => {
                db.all(`SELECT * FROM status_history WHERE application_id = ? ORDER BY created_at ASC`, [appId], (err, history) => {
                    getSettings(settings => {
                        res.send(`
                        <!DOCTYPE html>
                        <html lang="en">
                        <head>
                            <meta charset="UTF-8">
                            <meta name="viewport" content="width=device-width, initial-scale=1.0">
                            <title>Application Details - ${app.tracking_number}</title>
                            <script src="https://cdn.tailwindcss.com"></script>
                            <script src="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/js/all.min.js"></script>
                        </head>
                        <body class="bg-gray-100 font-sans py-10">
                            <div class="max-w-4xl mx-auto bg-white p-8 rounded-xl shadow-md space-y-6">
                                <div class="flex justify-between items-center border-b pb-4">
                                    <div>
                                        <h1 class="text-xl font-bold text-blue-900">Application: <span class="font-mono text-blue-600">${app.tracking_number}</span></h1>
                                        <p class="text-sm text-gray-500">Service: <span class="uppercase font-semibold">${app.service_type}</span></p>
                                    </div>
                                    <a href="/customer" class="bg-gray-200 px-4 py-2 rounded text-sm font-medium hover:bg-gray-300"><i class="fas fa-arrow-left mr-1"></i> Back to Dashboard</a>
                                </div>

                                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div class="p-4 bg-gray-50 rounded-xl border">
                                        <h3 class="font-bold text-gray-800 mb-2">Status & Payment</h3>
                                        <p class="text-sm">Application Status: <span class="px-2 py-1 bg-blue-100 text-blue-800 rounded font-semibold text-xs">${app.status}</span></p>
                                        <p class="text-sm mt-2">Payment Status: <span class="px-2 py-1 rounded font-semibold text-xs ${app.payment_status === 'Paid' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}">${app.payment_status}</span></p>
                                        <p class="text-sm mt-2">Payment Method: <span class="uppercase font-semibold">${app.payment_method || 'N/A'}</span></p>
                                    </div>

                                    <div class="p-4 bg-gray-50 rounded-xl border">
                                        <h3 class="font-bold text-gray-800 mb-2">Completed Documents from Admin</h3>
                                        <div class="space-y-2">
                                            ${adminFiles.length === 0 ? '<p class="text-sm text-gray-500">No completed documents uploaded by admin yet.</p>' : ''}
                                            ${adminFiles.map(af => `
                                                <div class="flex justify-between items-center bg-white p-2 rounded border text-sm">
                                                    <div>
                                                        <p class="font-semibold text-gray-800">${af.file_name}</p>
                                                        <p class="text-xs text-gray-400">${af.description || ''}</p>
                                                    </div>
                                                    <a href="//${af.file_path}" target="_blank" class="bg-blue-600 text-white px-3 py-1 rounded text-xs hover:bg-blue-700">Download</a>
                                                </div>
                                            `).join('')}
                                        </div>
                                    </div>
                                </div>

                                <!-- Uploaded Documents Preview -->
                                <div class="p-4 bg-gray-50 rounded-xl border">
                                    <h3 class="font-bold text-gray-800 mb-2">Your Uploaded Documents</h3>
                                    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                                        ${docs.map(d => `
                                            <div class="bg-white p-2 rounded border text-center">
                                                <p class="text-xs font-semibold mb-2">${d.doc_type}</p>
                                                <a href="/${d.file_path}" target="_blank" class="text-blue-600 text-xs underline">Preview / View</a>
                                            </div>
                                        `).join('')}
                                    </div>
                                </div>

                                <!-- History Timeline -->
                                <div class="p-4 bg-gray-50 rounded-xl border">
                                    <h3 class="font-bold text-gray-800 mb-3">Application History</h3>
                                    <div class="space-y-3 border-l-2 border-blue-200 pl-4 ml-2">
                                        ${history.map(h => `
                                            <div class="relative">
                                                <div class="absolute -left-[21px] top-1 w-3 h-3 bg-blue-600 rounded-full border-2 border-white"></div>
                                                <p class="text-xs text-gray-400">${h.created_at}</p>
                                                <p class="font-medium text-gray-800">${h.action}</p>
                                                ${h.remarks ? `<p class="text-sm text-gray-600 bg-white p-2 rounded mt-1 border">${h.remarks}</p>` : ''}
                                            </div>
                                        `).join('')}
                                    </div>
                                </div>
                            </div>
                        </body>
                        </html>
                        `);
                    });
                });
            });
        });
    });
});

// Customer Profile & Password
app.get('/customer/profile', requireCustomer, (req, res) => {
    db.get(`SELECT * FROM users WHERE id = ?`, [req.session.userId], (err, user) => {
        getSettings(settings => {
            res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Profile - ${settings.business_name}</title>
                <script src="https://cdn.tailwindcss.com"></script>
            </head>
            <body class="bg-gray-100 font-sans py-10">
                <div class="max-w-md mx-auto bg-white p-8 rounded-xl shadow-md space-y-6">
                    <div class="flex justify-between items-center border-b pb-4">
                        <h1 class="text-xl font-bold text-blue-900">Profile & Security</h1>
                        <a href="/customer" class="text-sm text-blue-600 hover:underline">Back</a>
                    </div>
                    ${req.query.success ? '<div class="p-3 bg-green-100 text-green-700 text-sm rounded">Password updated successfully!</div>' : ''}
                    ${req.query.error ? '<div class="p-3 bg-red-100 text-red-700 text-sm rounded">Current password incorrect.</div>' : ''}
                    
                    <div class="space-y-2 text-sm">
                        <p><strong>Full Name:</strong> ${user.full_name}</p>
                        <p><strong>Email:</strong> ${user.email}</p>
                        <p><strong>Mobile:</strong> ${user.mobile_number}</p>
                        <p><strong>Username:</strong> ${user.username}</p>
                    </div>

                    <form method="POST" action="/customer/profile" class="space-y-4 border-t pt-4">
                        <h3 class="font-bold text-gray-800">Change Password</h3>
                        <div>
                            <label class="block text-sm font-medium">Current Password</label>
                            <input type="password" name="current_password" required class="w-full border p-2 rounded mt-1">
                        </div>
                        <div>
                            <label class="block text-sm font-medium">New Password</label>
                            <input type="password" name="new_password" required class="w-full border p-2 rounded mt-1">
                        </div>
                        <button type="submit" class="w-full bg-blue-600 text-white p-2 rounded font-medium hover:bg-blue-700">Update Password</button>
                    </form>
                </div>
            </body>
            </html>
            `);
        });
    });
});

app.post('/customer/profile', requireCustomer, async (req, res) => {
    const { current_password, new_password } = req.body;
    db.get(`SELECT * FROM users WHERE id = ?`, [req.session.userId], async (err, user) => {
        if(user && await bcrypt.compare(current_password, user.password)) {
            const hashed = await bcrypt.hash(new_password, 10);
            db.run(`UPDATE users SET password = ? WHERE id = ?`, [hashed, req.session.userId], () => {
                res.redirect('/customer/profile?success=1');
            });
        } else {
            res.redirect('/customer/profile?error=1');
        }
    });
});

// ---------------------------------------------------------
// ADMIN AUTH & PORTAL ROUTES
// ---------------------------------------------------------
app.get('/admin/login', (req, res) => {
    getSettings(settings => {
        res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Admin Login - ${settings.business_name}</title>
            <script src="https://cdn.tailwindcss.com"></script>
        </head>
        <body class="bg-gray-900 flex items-center justify-center min-h-screen">
            <div class="max-w-md w-full bg-white p-8 rounded-xl shadow-lg">
                <div class="text-center mb-6">
                    <h1 class="text-2xl font-bold text-gray-900">Admin Portal</h1>
                    <p class="text-sm text-gray-600 mt-1">${settings.business_name}</p>
                </div>
                ${req.query.error ? '<div class="mb-4 p-3 bg-red-100 text-red-700 text-sm rounded">Invalid admin credentials.</div>' : ''}
                <form method="POST" action="/admin/login" class="space-y-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-700">Admin Username</label>
                        <input type="text" name="username" required class="w-full border p-2 rounded mt-1">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700">Password</label>
                        <input type="password" name="password" required class="w-full border p-2 rounded mt-1">
                    </div>
                    <button type="submit" class="w-full bg-gray-900 text-white p-2 rounded font-medium hover:bg-gray-800">Admin Login</button>
                </form>
            </div>
        </body>
        </html>
        `);
    });
});

app.post('/admin/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM admin_users WHERE username = ?`, [username], async (err, admin) => {
        if(admin && await bcrypt.compare(password, admin.password)) {
            req.session.adminId = admin.id;
            req.session.adminName = admin.full_name;
            res.redirect('/admin');
        } else {
            res.redirect('/admin/login?error=1');
        }
    });
});

app.get('/admin/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/admin/login'));
});

function requireAdmin(req, res, next) {
    if(!req.session.adminId) return res.redirect('/admin/login');
    next();
}

// Admin Dashboard & Applications Management
app.get('/admin', requireAdmin, (req, res) => {
    const search = req.query.search || '';
    const statusFilter = req.query.status || '';
    const serviceFilter = req.query.service || '';

    let query = `SELECT a.*, u.full_name, u.email, u.mobile_number FROM applications a JOIN users u ON a.user_id = u.id WHERE 1=1`;
    let params = [];

    if(search) {
        query += ` AND (a.tracking_number LIKE ? OR u.full_name LIKE ? OR u.mobile_number LIKE ? OR u.email LIKE ?)`;
        params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }
    if(statusFilter) {
        query += ` AND a.status = ?`;
        params.push(statusFilter);
    }
    if(serviceFilter) {
        query += ` AND a.service_type = ?`;
        params.push(serviceFilter);
    }
    query += ` ORDER BY a.created_at DESC`;

    db.serialize(() => {
        db.all(query, params, (err, apps) => {
            db.all(`SELECT service_type, status, payment_status FROM applications`, (err, allApps) => {
                db.all(`SELECT COUNT(*) as cnt FROM users`, (err, userCount) => {
                    getSettings(settings => {
                        const totalCustomers = userCount[0].cnt;
                        const totalApplications = allApps.length;
                        const birCount = allApps.filter(a => a.service_type === 'bir').length;
                        const sssCount = allApps.filter(a => a.service_type === 'sss').length;
                        const pagibigCount = allApps.filter(a => a.service_type === 'pagibig').length;
                        const pendingCount = allApps.filter(a => a.status === 'Submitted' || a.status === 'Under Review').length;
                        const verifiedPayments = allApps.filter(a => a.payment_status === 'Paid').length;

                        res.send(`
                        <!DOCTYPE html>
                        <html lang="en">
                        <head>
                            <meta charset="UTF-8">
                            <meta name="viewport" content="width=device-width, initial-scale=1.0">
                            <title>Admin Dashboard - ${settings.business_name}</title>
                            <script src="https://cdn.tailwindcss.com"></script>
                            <script src="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/js/all.min.js"></script>
                        </head>
                        <body class="bg-gray-100 font-sans">
                            <div class="min-h-screen flex flex-col md:flex-row">
                                <!-- Sidebar -->
                                <aside class="w-full md:w-64 bg-gray-900 text-white p-6 space-y-4">
                                    <h2 class="text-xl font-bold border-b border-gray-800 pb-3">Admin Portal</h2>
                                    <nav class="space-y-2 text-sm">
                                        <a href="/admin" class="block p-2 rounded bg-gray-800 font-medium"><i class="fas.fa-chart-pie mr-2"></i> Dashboard & Applications</a>
                                        <a href="/admin/settings" class="block p-2 rounded hover:bg-gray-800 text-gray-300"><i class="fas fa-cogs mr-2"></i> System Settings & Fees</a>
                                        <a href="/admin/logout" class="block p-2 rounded hover:bg-red-800 text-red-400 mt-10"><i class="fas fa-sign-out-alt mr-2"></i> Logout</a>
                                    </nav>
                                </aside>

                                <!-- Main Content Area -->
                                <main class="flex-1 p-8 space-y-6">
                                    <div class="flex justify-between items-center">
                                        <h1 class="text-2xl font-bold text-gray-900">Dashboard Overview</h1>
                                        <span class="text-sm text-gray-600">Logged in as: <strong>${req.session.adminName}</strong></span>
                                    </div>

                                    <!-- Stat Cards -->
                                    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                                        <div class="bg-white p-4 rounded-xl shadow-sm border">
                                            <p class="text-xs text-gray-500 font-semibold">TOTAL CUSTOMERS</p>
                                            <p class="text-2xl font-bold text-gray-900 mt-1">${totalCustomers}</p>
                                        </div>
                                        <div class="bg-white p-4 rounded-xl shadow-sm border">
                                            <p class="text-xs text-gray-500 font-semibold">TOTAL APPLICATIONS</p>
                                            <p class="text-2xl font-bold text-blue-600 mt-1">${totalApplications}</p>
                                        </div>
                                        <div class="bg-white p-4 rounded-xl shadow-sm border">
                                            <p class="text-xs text-gray-500 font-semibold">PENDING REVIEW</p>
                                            <p class="text-2xl font-bold text-yellow-600 mt-1">${pendingCount}</p>
                                        </div>
                                        <div class="bg-white p-4 rounded-xl shadow-sm border">
                                            <p class="text-xs text-gray-500 font-semibold">VERIFIED PAYMENTS</p>
                                            <p class="text-2xl font-bold text-green-600 mt-1">${verifiedPayments}</p>
                                        </div>
                                    </div>

                                    <div class="grid grid-cols-3 gap-4 text-xs font-semibold">
                                        <div class="bg-blue-50 p-3 rounded border border-blue-200 text-blue-900">BIR/TIN Applications: ${birCount}</div>
                                        <div class="bg-green-50 p-3 rounded border border-green-200 text-green-900">SSS Applications: ${sssCount}</div>
                                        <div class="bg-purple-50 p-3 rounded border border-purple-200 text-purple-900">Pag-IBIG Applications: ${pagibigCount}</div>
                                    </div>

                                    <!-- Applications Table & Filters -->
                                    <div class="bg-white p-6 rounded-xl shadow-sm border space-y-4">
                                        <h3 class="font-bold text-lg text-gray-800">Applications Management</h3>
                                        
                                        <form method="GET" action="/admin" class="grid grid-cols-1 md:grid-cols-4 gap-3">
                                            <input type="text" name="search" value="${search}" placeholder="Search name, tracking no, email..." class="border p-2 rounded text-sm w-full">
                                            <select name="status" class="border p-2 rounded text-sm w-full">
                                                <option value="">All Statuses</option>
                                                <option value="Submitted" ${statusFilter==='Submitted'?'selected':''}>Submitted</option>
                                                <option value="Under Review" ${statusFilter==='Under Review'?'selected':''}>Under Review</option>
                                                <option value="Processing" ${statusFilter==='Processing'?'selected':''}>Processing</option>
                                                <option value="Need Correction" ${statusFilter==='Need Correction'?'selected':''}>Need Correction</option>
                                                <option value="Ready" ${statusFilter==='Ready'?'selected':''}>Ready</option>
                                                <option value="Completed" ${statusFilter==='Completed'?'selected':''}>Completed</option>
                                                <option value="Rejected" ${statusFilter==='Rejected'?'selected':''}>Rejected</option>
                                            </select>
                                            <select name="service" class="border p-2 rounded text-sm w-full">
                                                <option value="">All Services</option>
                                                <option value="bir" ${serviceFilter==='bir'?'selected':''}>BIR / TIN</option>
                                                <option value="sss" ${serviceFilter==='sss'?'selected':''}>SSS</option>
                                                <option value="pagibig" ${serviceFilter==='pagibig'?'selected':''}>Pag-IBIG</option>
                                            </select>
                                            <button type="submit" class="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700">Filter / Search</button>
                                        </form>

                                        <div class="overflow-x-auto">
                                            <table class="w-full text-left border-collapse text-sm">
                                                <thead>
                                                    <tr class="bg-gray-50 border-b">
                                                        <th class="p-3">Tracking No.</th>
                                                        <th class="p-3">Applicant Name</th>
                                                        <th class="p-3">Service</th>
                                                        <th class="p-3">Payment</th>
                                                        <th class="p-3">Status</th>
                                                        <th class="p-3">Date</th>
                                                        <th class="p-3">Action</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    ${apps.length === 0 ? `<tr><td colspan="7" class="p-4 text-center text-gray-500">No applications found.</td></tr>` : ''}
                                                    ${apps.map(app => `
                                                        <tr class="border-b hover:bg-gray-50">
                                                            <td class="p-3 font-mono font-bold text-blue-600">${app.tracking_number}</td>
                                                            <td class="p-3 font-medium">${app.full_name}</td>
                                                            <td class="p-3 uppercase font-semibold">${app.service_type}</td>
                                                            <td class="p-3"><span class="px-2 py-1 rounded text-xs font-semibold ${app.payment_status === 'Paid' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}">${app.payment_status}</span></td>
                                                            <td class="p-3"><span class="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs font-semibold">${app.status}</span></td>
                                                            <td class="p-3 text-gray-500 text-xs">${app.created_at}</td>
                                                            <td class="p-3">
                                                                <a href="/admin/application/${app.id}" class="bg-blue-600 text-white px-3 py-1 rounded text-xs hover:bg-blue-700 font-medium">Manage</a>
                                                            </td>
                                                        </tr>
                                                    `).join('')}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </main>
                            </div>
                        </body>
                        </html>
                        `);
                    });
                });
            });
        });
    });
});

// Admin Complete Application Profile & Management
app.get('/admin/application/:id', requireAdmin, (req, res) => {
    const appId = req.params.id;

    db.get(`SELECT a.*, u.full_name as user_fullname, u.email, u.mobile_number FROM applications a JOIN users u ON a.user_id = u.id WHERE a.id = ?`, [appId], (err, app) => {
        if(!app) return res.redirect('/admin');

        db.get(`SELECT * FROM applicant_information WHERE application_id = ?`, [appId], (err, info) => {
            db.get(`SELECT * FROM parents WHERE application_id = ?`, [appId], (err, parents) => {
                db.get(`SELECT * FROM spouses WHERE application_id = ?`, [appId], (err, spouse) => {
                    db.all(`SELECT * FROM beneficiaries WHERE application_id = ?`, [appId], (err, benList) => {
                        db.get(`SELECT * FROM employment WHERE application_id = ?`, [appId], (err, emp) => {
                            db.all(`SELECT * FROM documents WHERE application_id = ?`, [appId], (err, docs) => {
                                db.all(`SELECT * FROM admin_uploaded_files WHERE application_id = ?`, [appId], (err, adminFiles) => {
                                    db.all(`SELECT * FROM status_history WHERE application_id = ? ORDER BY created_at ASC`, [appId], (err, history) => {
                                        getSettings(settings => {
                                            res.send(`
                                            <!DOCTYPE html>
                                            <html lang="en">
                                            <head>
                                                <meta charset="UTF-8">
                                                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                                                <title>Manage Application - ${app.tracking_number}</title>
                                                <script src="https://cdn.tailwindcss.com"></script>
                                                <script src="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/js/all.min.js"></script>
                                            </head>
                                            <body class="bg-gray-100 font-sans py-10">
                                                <div class="max-w-5xl mx-auto bg-white p-8 rounded-xl shadow-md space-y-6">
                                                    <!-- Top Bar -->
                                                    <div class="flex justify-between items-center border-b pb-4">
                                                        <div>
                                                            <h1 class="text-2xl font-bold text-gray-900">Application Profile</h1>
                                                            <p class="text-sm text-gray-500 font-mono">Tracking No: ${app.tracking_number} | Service: <span class="uppercase font-bold">${app.service_type}</span></p>
                                                        </div>
                                                        <div class="flex space-x-2">
                                                            <a href="/admin/application/${app.id}/print" target="_blank" class="bg-gray-800 text-white px-4 py-2 rounded text-sm font-medium hover:bg-gray-700"><i class="fas fa-print mr-1"></i> Print Summary</a>
                                                            <a href="/admin" class="bg-gray-200 px-4 py-2 rounded text-sm font-medium hover:bg-gray-300">Back</a>
                                                        </div>
                                                    </div>

                                                    <!-- Status & Payment Update Forms -->
                                                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-gray-50 rounded-xl border">
                                                        <form method="POST" action="/admin/application/${app.id}/status" class="space-y-3">
                                                            <h3 class="font-bold text-gray-800">Update Application Status</h3>
                                                            <div class="flex gap-2">
                                                                <select name="status" class="border p-2 rounded text-sm flex-1">
                                                                    <option value="Submitted" ${app.status==='Submitted'?'selected':''}>Submitted</option>
                                                                    <option value="Payment Pending" ${app.status==='Payment Pending'?'selected':''}>Payment Pending</option>
                                                                    <option value="Under Review" ${app.status==='Under Review'?'selected':''}>Under Review</option>
                                                                    <option value="Need Correction" ${app.status==='Need Correction'?'selected':''}>Need Correction</option>
                                                                    <option value="Processing" ${app.status==='Processing'?'selected':''}>Processing</option>
                                                                    <option value="Ready" ${app.status==='Ready'?'selected':''}>Ready</option>
                                                                    <option value="Completed" ${app.status==='Completed'?'selected':''}>Completed</option>
                                                                    <option value="Rejected" ${app.status==='Rejected'?'selected':''}>Rejected</option>
                                                                    <option value="Cancelled" ${app.status==='Cancelled'?'selected':''}>Cancelled</option>
                                                                </select>
                                                                <button type="submit" class="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700">Update</button>
                                                            </div>
                                                            <div><input type="text" name="remarks" placeholder="Optional remarks for status change / correction..." class="border p-2 rounded text-sm w-full mt-1"></div>
                                                        </form>

                                                        <form method="POST" action="/admin/application/${app.id}/payment" class="space-y-3">
                                                            <h3 class="font-bold text-gray-800">Verify Payment</h3>
                                                            <div class="flex gap-2">
                                                                <select name="payment_status" class="border p-2 rounded text-sm flex-1">
                                                                    <option value="Unpaid" ${app.payment_status==='Unpaid'?'selected':''}>Unpaid</option>
                                                                    <option value="Pending Verification" ${app.payment_status==='Pending Verification'?'selected':''}>Pending Verification</option>
                                                                    <option value="Paid" ${app.payment_status==='Paid'?'selected':''}>Paid / Verified</option>
                                                                    <option value="Rejected" ${app.payment_status==='Rejected'?'selected':''}>Rejected</option>
                                                                    <option value="Refunded" ${app.payment_status==='Refunded'?'selected':''}>Refunded</option>
                                                                </select>
                                                                <button type="submit" class="bg-green-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-green-700">Verify</button>
                                                            </div>
                                                            <p class="text-xs text-gray-500">Method: <span class="uppercase font-bold">${app.payment_method || 'N/A'}</span> | Ref: <strong>${app.payment_ref || 'N/A'}</strong> | Paid: <strong>₱${app.amount_paid || 0}</strong></p>
                                                        </form>
                                                    </div>

                                                    <!-- APPLICATION DATA SUMMARY FOR TRANSCRIPTION -->
                                                    <div class="p-6 bg-blue-50 rounded-xl border border-blue-200 space-y-4">
                                                        <h3 class="font-bold text-lg text-blue-900 flex justify-between items-center">
                                                            <span>Application Data Summary (For Government Form Transcription)</span>
                                                            <a href="/admin/application/${app.id}/print" target="_blank" class="text-xs bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700">Print Form Data</a>
                                                        </h3>
                                                        <table class="w-full text-sm bg-white rounded border">
                                                            <thead>
                                                                <tr class="bg-blue-100 text-blue-900">
                                                                    <th class="p-2 border">FIELD</th>
                                                                    <th class="p-2 border">CUSTOMER ANSWER</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                <tr><td class="p-2 border font-semibold">Service Type</td><td class="p-2 border uppercase font-bold text-blue-600">${app.service_type}</td></tr>
                                                                <tr><td class="p-2 border font-semibold">Full Name</td><td class="p-2 border">${info ? `${info.first_name} ${info.middle_name || ''} ${info.last_name} ${info.suffix || ''}` : ''}</td></tr>
                                                                <tr><td class="p-2 border font-semibold">Date of Birth / Place of Birth</td><td class="p-2 border">${info ? `${info.dob} / ${info.pob}` : ''}</td></tr>
                                                                <tr><td class="p-2 border font-semibold">Sex & Civil Status</td><td class="p-2 border">${info ? `${info.sex}, ${info.civil_status}` : ''}</td></tr>
                                                                <tr><td class="p-2 border font-semibold">Contact Info</td><td class="p-2 border">${info ? `${info.mobile} / ${info.email}` : ''}</td></tr>
                                                                <tr><td class="p-2 border font-semibold">Complete Address</td><td class="p-2 border">${info ? `${info.house_block_lot || ''} ${info.street || ''}, Brgy. ${info.barangay}, ${info.municipality_city}, ${info.province} (${info.zip_code})` : ''}</td></tr>
                                                                <tr><td class="p-2 border font-semibold">Father's Full Name & DOB</td><td class="p-2 border">${parents ? `${parents.father_first_name || ''} ${parents.father_middle_name || ''} ${parents.father_last_name || ''} (DOB: ${parents.father_dob || 'N/A'})` : 'N/A'}</td></tr>
                                                                <tr><td class="p-2 border font-semibold">Mother's Full Name & DOB</td><td class="p-2 border">${parents ? `${parents.mother_first_name || ''} ${parents.mother_middle_name || ''} ${parents.mother_last_name || ''} (DOB: ${parents.mother_dob || 'N/A'})` : 'N/A'}</td></tr>
                                                                <tr><td class="p-2 border font-semibold">Spouse Information</td><td class="p-2 border">${spouse ? `${spouse.spouse_full_name} (DOB: ${spouse.spouse_dob})` : 'N/A'}</td></tr>
                                                                <tr><td class="p-2 border font-semibold">Employment Status & Income</td><td class="p-2 border">${emp ? `${emp.employment_status} - ${emp.occupation || 'N/A'} (Income: ₱${emp.monthly_income || '0'})` : 'N/A'}</td></tr>
                                                            </tbody>
                                                        </table>
                                                    </div>

                                                    <!-- Beneficiaries -->
                                                    <div class="p-4 bg-gray-50 rounded-xl border">
                                                        <h3 class="font-bold text-gray-800 mb-2">Beneficiaries (${benList.length})</h3>
                                                        <div class="space-y-2">
                                                            ${benList.map(b => `
                                                                <div class="bg-white p-3 rounded border text-sm flex justify-between">
                                                                    <div>
                                                                        <p class="font-semibold text-gray-900">${b.full_name} <span class="text-xs bg-gray-200 px-2 py-0.5 rounded ml-2">${b.relationship}</span></p>
                                                                        <p class="text-xs text-gray-500">DOB: ${b.dob} | Sex: ${b.sex} | Address: ${b.address}</p>
                                                                    </div>
                                                                </div>
                                                            `).join('')}
                                                        </div>
                                                    </div>

                                                    <!-- Documents Management -->
                                                    <div class="p-4 bg-gray-50 rounded-xl border">
                                                        <h3 class="font-bold text-gray-800 mb-2">Customer Uploaded Documents</h3>
                                                        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                                                            ${docs.map(d => `
                                                                <div class="bg-white p-3 rounded border text-center">
                                                                    <p class="text-xs font-bold text-gray-700 mb-2">${d.doc_type}</p>
                                                                    <a href="/${d.file_path}" target="_blank" class="bg-blue-600 text-white px-3 py-1 rounded text-xs hover:bg-blue-700">Preview / Download</a>
                                                                </div>
                                                            `).join('')}
                                                        </div>
                                                    </div>

                                                    <!-- Admin Upload Completed Files -->
                                                    <div class="p-4 bg-gray-50 rounded-xl border space-y-4">
                                                        <h3 class="font-bold text-gray-800">Upload Completed / Processed Documents for Customer</h3>
                                                        <form method="POST" action="/admin/application/${app.id}/upload" enctype="multipart/form-data" class="grid grid-cols-1 md:grid-cols-4 gap-3">
                                                            <input type="text" name="description" placeholder="File Description (e.g. TIN ID / SSS Certificate)" required class="border p-2 rounded text-sm w-full">
                                                            <input type="file" name="completed_file" required class="border p-2 rounded text-sm bg-white w-full">
                                                            <button type="submit" class="bg-green-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-green-700 md:col-span-2">+ Upload Completed File</button>
                                                        </form>

                                                        <div class="space-y-2 mt-4">
                                                            <h4 class="font-semibold text-sm text-gray-700">Already Uploaded Files</h4>
                                                            ${adminFiles.length === 0 ? '<p class="text-xs text-gray-500">No files uploaded yet.</p>' : ''}
                                                            ${adminFiles.map(af => `
                                                                <div class="flex justify-between items-center bg-white p-2 rounded border text-sm">
                                                                    <div>
                                                                        <p class="font-semibold text-gray-800">${af.file_name} <span class="text-xs text-gray-400">(${af.description})</span></p>
                                                                    </div>
                                                                    <div class="flex space-x-2">
                                                                        <a href="/${af.file_path}" target="_blank" class="bg-blue-600 text-white px-3 py-1 rounded text-xs">Download</a>
                                                                        <a href="/admin/file/${af.id}/delete?app_id=${app.id}" class="bg-red-600 text-white px-3 py-1 rounded text-xs">Delete</a>
                                                                    </div>
                                                                </div>
                                                            `).join('')}
                                                        </div>
                                                    </div>

                                                    <!-- History Timeline -->
                                                    <div class="p-4 bg-gray-50 rounded-xl border">
                                                        <h3 class="font-bold text-gray-800 mb-3">Application History</h3>
                                                        <div class="space-y-3 border-l-2 border-blue-200 pl-4 ml-2">
                                                            ${history.map(h => `
                                                                <div class="relative">
                                                                    <div class="absolute -left-[21px] top-1 w-3 h-3 bg-blue-600 rounded-full border-2 border-white"></div>
                                                                    <p class="text-xs text-gray-400">${h.created_at}</p>
                                                                    <p class="font-medium text-gray-800">${h.action}</p>
                                                                    ${h.remarks ? `<p class="text-sm text-gray-600 bg-white p-2 rounded mt-1 border">${h.remarks}</p>` : ''}
                                                                </div>
                                                            `).join('')}
                                                        </div>
                                                    </div>
                                                </div>
                                            </body>
                                            </html>
                                            `);
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

// Admin Update Application Status
app.post('/admin/application/:id/status', requireAdmin, (req, res) => {
    const appId = req.params.id;
    const { status, remarks } = req.body;

    db.get(`SELECT user_id FROM applications WHERE id = ?`, [appId], (err, row) => {
        if(row) {
            db.run(`UPDATE applications SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [status, appId], () => {
                db.run(`INSERT INTO status_history (application_id, action, user_name, remarks) VALUES (?, ?, ?, ?)`,
                    [appId, `Status Updated to: ${status}`, req.session.adminName, remarks || '']);
                db.run(`INSERT INTO notifications (user_id, message) VALUES (?, ?)`,
                    [row.user_id, `Your application status has been updated to: ${status}. ${remarks ? 'Remarks: ' + remarks : ''}`]);
                res.redirect(`/admin/application/${appId}`);
            });
        } else {
            res.redirect('/admin');
        }
    });
});

// Admin Verify Payment
app.post('/admin/application/:id/payment', requireAdmin, (req, res) => {
    const appId = req.params.id;
    const { payment_status } = req.body;

    db.get(`SELECT user_id FROM applications WHERE id = ?`, [appId], (err, row) => {
        if(row) {
            db.run(`UPDATE applications SET payment_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [payment_status, appId], () => {
                db.run(`INSERT INTO status_history (application_id, action, user_name, remarks) VALUES (?, ?, ?, ?)`,
                    [appId, `Payment Status Updated to: ${payment_status}`, req.session.adminName, '']);
                db.run(`INSERT INTO notifications (user_id, message) VALUES (?, ?)`,
                    [row.user_id, `Your payment status has been updated to: ${payment_status}.`]);
                res.redirect(`/admin/application/${appId}`);
            });
        } else {
            res.redirect('/admin');
        }
    });
});

// Admin Upload Completed File
const uploadCompleted = multer().single('completed_file');
app.post('/admin/application/:id/upload', requireAdmin, upload.single('completed_file'), (req, res) => {
    const appId = req.params.id;
    const { description } = req.body;
    const file = req.file;

    if(file) {
        db.get(`SELECT user_id FROM applications WHERE id = ?`, [appId], (err, row) => {
            db.run(`INSERT INTO admin_uploaded_files (application_id, file_name, file_path, file_type, description) VALUES (?, ?, ?, ?, ?)`,
                [appId, file.originalname, file.path, file.mimetype, description], () => {
                    db.run(`INSERT INTO status_history (application_id, action, user_name, remarks) VALUES (?, ?, ?, ?)`,
                        [appId, 'Admin Uploaded Completed Document', req.session.adminName, description]);
                    if(row) {
                        db.run(`INSERT INTO notifications (user_id, message) VALUES (?, ?)`,
                            [row.user_id, `Admin has uploaded a completed document for your application: ${description}`]);
                    }
                    res.redirect(`/admin/application/${appId}`);
                });
        });
    } else {
        res.redirect(`/admin/application/${appId}`);
    }
});

// Admin Delete Uploaded File
app.get('/admin/file/:fileId/delete', requireAdmin, (req, res) => {
    const fileId = req.params.fileId;
    const appId = req.query.app_id;
    db.run(`DELETE FROM admin_uploaded_files WHERE id = ?`, [fileId], () => {
        res.redirect(`/admin/application/${appId}`);
    });
});

// Admin Print Application Summary & Transcription Sheet
app.get('/admin/application/:id/print', requireAdmin, (req, res) => {
    const appId = req.params.id;
    db.get(`SELECT a.*, u.full_name as user_fullname, u.email, u.mobile_number FROM applications a JOIN users u ON a.user_id = u.id WHERE a.id = ?`, [appId], (err, app) => {
        db.get(`SELECT * FROM applicant_information WHERE application_id = ?`, [appId], (err, info) => {
            db.get(`SELECT * FROM parents WHERE application_id = ?`, [appId], (err, parents) => {
                db.get(`SELECT * FROM spouses WHERE application_id = ?`, [appId], (err, spouse) => {
                    db.all(`SELECT * FROM beneficiaries WHERE application_id = ?`, [appId], (err, benList) => {
                        db.get(`SELECT * FROM employment WHERE application_id = ?`, [appId], (err, emp) => {
                            getSettings(settings => {
                                res.send(`
                                <!DOCTYPE html>
                                <html lang="en">
                                <head>
                                    <meta charset="UTF-8">
                                    <title>Print Application - ${app.tracking_number}</title>
                                    <script src="https://cdn.tailwindcss.com"></script>
                                    <style>@media print { body { print-color-adjust: exact; } }</style>
                                </head>
                                <body class="bg-white p-8 font-sans text-sm">
                                    <div class="max-w-3xl mx-auto space-y-6">
                                        <div class="text-center border-b pb-4">
                                            <h1 class="text-xl font-bold uppercase text-blue-900">${settings.business_name}</h1>
                                            <h2 class="text-lg font-bold uppercase text-gray-800 mt-1">Official Government Application Transcription Sheet</h2>
                                            <p class="text-xs text-gray-500">Service: <span class="uppercase font-bold">${app.service_type}</span> | Tracking No: <span class="font-mono">${app.tracking_number}</span></p>
                                        </div>

                                        <table class="w-full border-collapse border border-gray-400 text-xs">
                                            <thead>
                                                <tr class="bg-gray-100">
                                                    <th class="border border-gray-400 p-2 text-left w-1/3">FORM FIELD</th>
                                                    <th class="border border-gray-400 p-2 text-left">CUSTOMER ANSWER</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                <tr><td class="border border-gray-400 p-2 font-bold">First Name</td><td class="border border-gray-400 p-2">${info ? info.first_name : ''}</td></tr>
                                                <tr><td class="border border-gray-400 p-2 font-bold">Middle Name</td><td class="border border-gray-400 p-2">${info ? info.middle_name : ''}</td></tr>
                                                <tr><td class="border border-gray-400 p-2 font-bold">Last Name</td><td class="border border-gray-400 p-2">${info ? info.last_name : ''}</td></tr>
                                                <tr><td class="border border-gray-400 p-2 font-bold">Suffix</td><td class="border border-gray-400 p-2">${info ? info.suffix : ''}</td></tr>
                                                <tr><td class="border border-gray-400 p-2 font-bold">Date of Birth</td><td class="border border-gray-400 p-2">${info ? info.dob : ''}</td></tr>
                                                <tr><td class="border border-gray-400 p-2 font-bold">Place of Birth</td><td class="border border-gray-400 p-2">${info ? info.pob : ''}</td></tr>
                                                <tr><td class="border border-gray-400 p-2 font-bold">Sex</td><td class="border border-gray-400 p-2">${info ? info.sex : ''}</td></tr>
                                                <tr><td class="border border-gray-400 p-2 font-bold">Civil Status</td><td class="border border-gray-400 p-2">${info ? info.civil_status : ''}</td></tr>
                                                <tr><td class="border border-gray-400 p-2 font-bold">Nationality</td><td class="border border-gray-400 p-2">${info ? info.nationality : ''}</td></tr>
                                                <tr><td class="border border-gray-400 p-2 font-bold">Mobile Number</td><td class="border border-gray-400 p-2">${info ? info.mobile : ''}</td></tr>
                                                <tr><td class="border border-gray-400 p-2 font-bold">Email Address</td><td class="border border-gray-400 p-2">${info ? info.email : ''}</td></tr>
                                                <tr><td class="border border-gray-400 p-2 font-bold">Complete Address</td><td class="border border-gray-400 p-2">${info ? `${info.house_block_lot || ''} ${info.street || ''}, Brgy. ${info.barangay}, ${info.municipality_city}, ${info.province} - ${info.zip_code}` : ''}</td></tr>
                                                <tr><td class="border border-gray-400 p-2 font-bold">Father's Full Name</td><td class="border border-gray-400 p-2">${parents ? `${parents.father_first_name || ''} ${parents.father_middle_name || ''} ${parents.father_last_name || ''}` : ''}</td></tr>
                                                <tr><td class="border border-gray-400 p-2 font-bold">Father's DOB</td><td class="border border-gray-400 p-2">${parents ? parents.father_dob : ''}</td></tr>
                                                <tr><td class="border border-gray-400 p-2 font-bold">Mother's Full Name</td><td class="border border-gray-400 p-2">${parents ? `${parents.mother_first_name || ''} ${parents.mother_middle_name || ''} ${parents.mother_maiden_name || ''} ${parents.mother_last_name || ''}` : ''}</td></tr>
                                                <tr><td class="border border-gray-400 p-2 font-bold">Mother's DOB</td><td class="border border-gray-400 p-2">${parents ? parents.mother_dob : ''}</td></tr>
                                                <tr><td class="border border-gray-400 p-2 font-bold">Spouse Name & DOB</td><td class="border border-gray-400 p-2">${spouse ? `${spouse.spouse_full_name} (${spouse.spouse_dob})` : 'N/A'}</td></tr>
                                                <tr><td class="border border-gray-400 p-2 font-bold">Employment Status & Income</td><td class="border border-gray-400 p-2">${emp ? `${emp.employment_status} | Monthly Income: ₱${emp.monthly_income || 0}` : 'N/A'}</td></tr>
                                            </tbody>
                                        </table>

                                        <div class="mt-4">
                                            <h3 class="font-bold text-xs uppercase text-gray-700 mb-2">Beneficiaries</h3>
                                            <table class="w-full border-collapse border border-gray-400 text-xs">
                                                <tr class="bg-gray-100"><th class="border border-gray-400 p-1">Full Name</th><th class="border border-gray-400 p-1">Relationship</th><th class="border border-gray-400 p-1">DOB</th><th class="border border-gray-400 p-1">Sex</th></tr>
                                                ${benList.map(b => `<tr><td class="border border-gray-400 p-1">${b.full_name}</td><td class="border border-gray-400 p-1">${b.relationship}</td><td class="border border-gray-400 p-1">${b.dob}</td><td class="border border-gray-400 p-1">${b.sex}</td></tr>`).join('')}
                                            </table>
                                        </div>

                                        <div class="mt-8 pt-4 border-t text-center text-xs text-gray-500">
                                            <p>${settings.terms}</p>
                                        </div>
                                    </div>
                                    <script>window.print();</script>
                                </body>
                                </html>
                                `);
                            });
                        });
                    });
                });
            });
        });
    });
});

// Admin Settings Page (Fees, GCash QR, Business Info)
const uploadQR = upload.single('gcash_qr_file');
app.get('/admin/settings', requireAdmin, (req, res) => {
    getSettings(settings => {
        res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Admin Settings - ${settings.business_name}</title>
            <script src="https://cdn.tailwindcss.com"></script>
            <script src="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/js/all.min.js"></script>
        </head>
        <body class="bg-gray-100 font-sans">
            <div class="min-h-screen flex flex-col md:flex-row">
                <aside class="w-full md:w-64 bg-gray-900 text-white p-6 space-y-4">
                    <h2 class="text-xl font-bold border-b border-gray-800 pb-3">Admin Portal</h2>
                    <nav class="space-y-2 text-sm">
                        <a href="/admin" class="block p-2 rounded hover:bg-gray-800 text-gray-300"><i class="fas fa-chart-pie mr-2"></i> Dashboard</a>
                        <a href="/admin/settings" class="block p-2 rounded bg-gray-800 font-medium"><i class="fas.fa-cogs mr-2"></i> System Settings & Fees</a>
                        <a href="/admin/logout" class="block p-2 rounded hover:bg-red-800 text-red-400 mt-10"><i class="fas fa-sign-out-alt mr-2"></i> Logout</a>
                    </nav>
                </aside>

                <main class="flex-1 p-8 space-y-6">
                    <h1 class="text-2xl font-bold text-gray-900">System Settings & Configuration</h1>
                    ${req.query.success ? '<div class="p-3 bg-green-100 text-green-700 text-sm rounded">Settings updated successfully!</div>' : ''}
                    
                    <form method="POST" action="/admin/settings" enctype="multipart/form-data" class="bg-white p-6 rounded-xl shadow-sm border space-y-4 max-w-2xl">
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div><label class="block text-sm font-medium">Business / Service Name</label><input type="text" name="business_name" value="${settings.business_name || ''}" required class="w-full border p-2 rounded mt-1"></div>
                            <div><label class="block text-sm font-medium">Contact Number</label><input type="text" name="contact_number" value="${settings.contact_number || ''}" required class="w-full border p-2 rounded mt-1"></div>
                        </div>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div><label class="block text-sm font-medium">Support Email</label><input type="email" name="email" value="${settings.email || ''}" required class="w-full border p-2 rounded mt-1"></div>
                            <div><label class="block text-sm font-medium">Address</label><input type="text" name="address" value="${settings.address || ''}" required class="w-full border p-2 rounded mt-1"></div>
                        </div>

                        <hr>
                        <h3 class="font-bold text-gray-800">Service Fees (₱)</h3>
                        <div class="grid grid-cols-3 gap-4">
                            <div><label class="block text-sm font-medium">BIR / TIN Fee</label><input type="number" name="bir_fee" value="${settings.bir_fee || 500}" required class="w-full border p-2 rounded mt-1"></div>
                            <div><label class="block text-sm font-medium">SSS Fee</label><input type="number" name="sss_fee" value="${settings.sss_fee || 400}" required class="w-full border p-2 rounded mt-1"></div>
                            <div><label class="block text-sm font-medium">Pag-IBIG Fee</label><input type="number" name="pagibig_fee" value="${settings.pagibig_fee || 400}" required class="w-full border p-2 rounded mt-1"></div>
                        </div>

                        <hr>
                        <h3 class="font-bold text-gray-800">GCash Payment Configuration</h3>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div><label class="block text-sm font-medium">GCash Account Name</label><input type="text" name="gcash_account_name" value="${settings.gcash_account_name || ''}" class="w-full border p-2 rounded mt-1"></div>
                            <div><label class="block text-sm font-medium">GCash Number</label><input type="text" name="gcash_number" value="${settings.gcash_number || ''}" class="w-full border p-2 rounded mt-1"></div>
                        </div>
                        <div>
                            <label class="block text-sm font-medium">Upload GCash QR Code</label>
                            ${settings.gcash_qr ? `<div class="my-2"><img src="${settings.gcash_qr}" class="w-32 h-32 object-cover border rounded"></div>` : ''}
                            <input type="file" name="gcash_qr_file" accept="image/*" class="w-full border p-2 rounded mt-1 bg-white">
                        </div>

                        <div>
                            <label class="block text-sm font-medium">Cash Payment Instructions</label>
                            <textarea name="cash_instructions" rows="2" class="w-full border p-2 rounded mt-1">${settings.cash_instructions || ''}</textarea>
                        </div>

                        <div>
                            <label class="block text-sm font-medium">Terms and Government Disclaimer</label>
                            <textarea name="terms" rows="3" class="w-full border p-2 rounded mt-1">${settings.terms || ''}</textarea>
                        </div>

                        <button type="submit" class="bg-blue-600 text-white px-6 py-2 rounded font-medium hover:bg-blue-700">Save Settings</button>
                    </form>
                </main>
            </div>
        </body>
        </html>
        `);
    });
});

app.post('/admin/settings', requireAdmin, uploadQR, (req, res) => {
    const body = req.body;
    const file = req.file;

    db.serialize(() => {
        for (const [key, value] of Object.entries(body)) {
            db.run(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?`, [key, value, value]);
        }
        if(file) {
            db.run(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?`, ['gcash_qr', file.path, file.path]);
        }
        res.redirect('/admin/settings?success=1');
    });
});

// Root Redirect
app.get('/', (req, res) => {
    res.redirect('/customer/login');
});

// Start Server
app.listen(PORT, () => {
    console.log(`GovAssist PH Application Assistance System running on port ${PORT}`);
});
