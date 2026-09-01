/**
 * COMPLETE BIR/TIN, SSS & PAG-IBIG APPLICATION ASSISTANCE SYSTEM
 * Production-Ready Single-File Node.js Application (app.js)
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
const uploadDir = path.join(__dirname, 'public', 'uploads');
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
        cb(null, uniqueSuffix + '-' + file.originalname.replace(/\s+/g, '_'));
    }
});
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|pdf/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (extname && mimetype) {
            return cb(null, true);
        }
        cb(new Error('Only .png, .jpg, .jpeg and .pdf format allowed!'));
    }
});

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
        // Users Table (Customers)
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fullname TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            mobile TEXT NOT NULL,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Admin Users Table
        db.run(`CREATE TABLE IF NOT EXISTS admin_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL
        )`, () => {
            // Seed default admin if not exists
            db.get(`SELECT * FROM admin_users WHERE username = 'admin'`, async (err, row) => {
                if (!row) {
                    const hashed = await bcrypt.hash('admin123', 10);
                    db.run(`INSERT INTO admin_users (username, password) VALUES ('admin', ?)`, [hashed]);
                }
            });
        });

        // Settings Table
        db.run(`CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )`, () => {
            const defaults = [
                ['service_name', 'GovAssist PH - Independent Assistance Service'],
                ['contact_number', '+63 912 345 6789'],
                ['email', 'support@govassist.ph'],
                ['address', 'Makati City, Metro Manila, Philippines'],
                ['tin_fee', '500'],
                ['sss_fee', '500'],
                ['pagibig_fee', '500'],
                ['gcash_qr', ''],
                ['payment_instructions', 'Send payment via GCash to our official number and upload the receipt.'],
                ['application_instructions', 'Fill out the form accurately, upload valid IDs and requirements, and select your payment method.'],
                ['system_status', 'active']
            ];
            defaults.forEach(([k, v]) => {
                db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`, [k, v]);
            });
        });

        // Applications Table
        db.run(`CREATE TABLE IF NOT EXISTS applications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            service TEXT NOT NULL,
            tracking_number TEXT UNIQUE NOT NULL,
            status TEXT DEFAULT 'Submitted',
            payment_status TEXT DEFAULT 'Unpaid',
            payment_method TEXT,
            amount_due REAL,
            reference_number TEXT,
            payment_proof TEXT,
            rejection_reason TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )`);

        // Applicant Information
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
            city TEXT,
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

        // Parent Information
        db.run(`CREATE TABLE IF NOT EXISTS parent_information (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            application_id INTEGER,
            mother_first TEXT,
            mother_middle TEXT,
            mother_maiden TEXT,
            mother_dob TEXT,
            father_first TEXT,
            father_middle TEXT,
            father_last TEXT,
            father_dob TEXT,
            FOREIGN KEY(application_id) REFERENCES applications(id)
        )`);

        // Spouse Information
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

        // Beneficiaries
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

        // Documents
        db.run(`CREATE TABLE IF NOT EXISTS documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            application_id INTEGER,
            doc_type TEXT,
            file_path TEXT,
            original_name TEXT,
            uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(application_id) REFERENCES applications(id)
        )`);

        // Completed Files (Uploaded by Admin)
        db.run(`CREATE TABLE IF NOT EXISTS completed_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            application_id INTEGER,
            title TEXT,
            file_path TEXT,
            original_name TEXT,
            uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(application_id) REFERENCES applications(id)
        )`);

        // Status History
        db.run(`CREATE TABLE IF NOT EXISTS status_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            application_id INTEGER,
            status TEXT,
            remarks TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(application_id) REFERENCES applications(id)
        )`);

        // Notifications
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

// Middleware setup
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(session({
    secret: 'govassist-secure-secret-key-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // set to true if using HTTPS in production
}));

// Helper to log status history & notification
function updateAppStatus(appId, userId, newStatus, remarks = '') {
    db.run(`UPDATE applications SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [newStatus, appId], () => {
        db.run(`INSERT INTO status_history (application_id, status, remarks) VALUES (?, ?, ?)`, [appId, newStatus, remarks]);
        const notifMsg = `Your application status has been updated to: ${newStatus}.${remarks ? ' Remarks: ' + remarks : ''}`;
        db.run(`INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)`, [userId, `Application Status: ${newStatus}`, notifMsg]);
    });
}

// ==========================================
// VIEWS SETUP (Embedded EJS Templates)
// ==========================================
const viewsDir = path.join(__dirname, 'views');
if (!fs.existsSync(viewsDir)) {
    fs.mkdirSync(viewsDir, { recursive: true });
}

// Create embedded HTML/EJS views dynamically to keep single file rule clean
const ejsTemplates = {
    'layout.ejs': `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><%= title %></title>
    <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body class="bg-gray-50 text-gray-800 flex flex-col min-h-screen">
    <header class="bg-blue-900 text-white shadow-md">
        <div class="container mx-auto px-4 py-3 flex justify-between items-center">
            <a href="/" class="text-xl font-bold flex items-center gap-2"><i class="fa-solid fa-file-shield"></i> GovAssist PH</a>
            <nav class="flex items-center gap-4">
                <a href="/" class="hover:underline">Home</a>
                <a href="/track" class="hover:underline">Track Status</a>
                <% if (user) { %>
                    <a href="/customer/dashboard" class="hover:underline">Dashboard</a>
                    <a href="/customer/logout" class="bg-red-600 px-3 py-1 rounded text-sm hover:bg-red-700">Logout</a>
                <% } else if (admin) { %>
                    <a href="/admin/dashboard" class="hover:underline">Admin Dashboard</a>
                    <a href="/admin/logout" class="bg-red-600 px-3 py-1 rounded text-sm hover:bg-red-700">Admin Logout</a>
                <% } else { %>
                    <a href="/customer/login" class="hover:underline">Login</a>
                    <a href="/customer/register" class="bg-blue-600 px-3 py-1 rounded text-sm hover:bg-blue-500">Register</a>
                <% } %>
            </nav>
        </div>
    </header>

    <main class="flex-grow container mx-auto px-4 py-6">
        <%- body %>
    </main>

    <footer class="bg-gray-800 text-gray-300 py-6 mt-12 text-sm">
        <div class="container mx-auto px-4 text-center space-y-3">
            <p class="max-w-3xl mx-auto text-xs text-gray-400">
                <strong>Government Disclaimer:</strong> This is an independent application assistance and document processing/tracking service. It is not an official website of the BIR, SSS, or Pag-IBIG unless officially authorized or integrated.
            </p>
            <p>&copy; 2026 GovAssist PH. All rights reserved.</p>
        </div>
    </footer>
</body>
</html>`,

    'landing.ejs': `
<div class="max-w-5xl mx-auto space-y-12">
    <div class="text-center space-y-4">
        <h1 class="text-4xl font-extrabold text-blue-900">Fast & Secure Government Application Assistance</h1>
        <p class="text-lg text-gray-600 max-w-2xl mx-auto">Get professional guidance and assistance with your BIR/TIN, SSS, and Pag-IBIG applications without the long queues and hassle.</p>
        <div class="flex justify-center gap-4 pt-4">
            <a href="/customer/register" class="bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold shadow hover:bg-blue-700">Get Started</a>
            <a href="/track" class="bg-gray-200 text-gray-800 px-6 py-3 rounded-lg font-semibold hover:bg-gray-300">Track Application</a>
        </div>
    </div>

    <div class="grid md:grid-cols-3 gap-6">
        <div class="bg-white p-6 rounded-xl shadow border border-gray-100 space-y-4">
            <div class="w-12 h-12 bg-blue-100 text-blue-600 flex items-center justify-center rounded-lg text-xl"><i class="fa-solid fa-id-card"></i></div>
            <h3 class="text-xl font-bold text-gray-800">BIR / TIN Application</h3>
            <p class="text-gray-600 text-sm">Assistance for new TIN registration, replacement, and records update with expert document review.</p>
            <% if (user) { %>
                <a href="/customer/apply/tin" class="text-blue-600 font-semibold inline-flex items-center gap-1 hover:underline">Apply Now <i class="fa-solid fa-arrow-right text-xs"></i></a>
            <% } else { %>
                <a href="/customer/login" class="text-blue-600 font-semibold inline-flex items-center gap-1 hover:underline">Login to Apply <i class="fa-solid fa-arrow-right text-xs"></i></a>
            <% } %>
        </div>

        <div class="bg-white p-6 rounded-xl shadow border border-gray-100 space-y-4">
            <div class="w-12 h-12 bg-blue-100 text-blue-600 flex items-center justify-center rounded-lg text-xl"><i class="fa-solid fa-shield-halved"></i></div>
            <h3 class="text-xl font-bold text-gray-800">SSS Application</h3>
            <p class="text-gray-600 text-sm">New member registration, member data changes, and multi-beneficiary record management.</p>
            <% if (user) { %>
                <a href="/customer/apply/sss" class="text-blue-600 font-semibold inline-flex items-center gap-1 hover:underline">Apply Now <i class="fa-solid fa-arrow-right text-xs"></i></a>
            <% } else { %>
                <a href="/customer/login" class="text-blue-600 font-semibold inline-flex items-center gap-1 hover:underline">Login to Apply <i class="fa-solid fa-arrow-right text-xs"></i></a>
            <% } %>
        </div>

        <div class="bg-white p-6 rounded-xl shadow border border-gray-100 space-y-4">
            <div class="w-12 h-12 bg-blue-100 text-blue-600 flex items-center justify-center rounded-lg text-xl"><i class="fa-solid fa-house-chimney"></i></div>
            <h3 class="text-xl font-bold text-gray-800">Pag-IBIG Application</h3>
            <p class="text-gray-600 text-sm">MID number generation, membership registration, and comprehensive beneficiary updates.</p>
            <% if (user) { %>
                <a href="/customer/apply/pagibig" class="text-blue-600 font-semibold inline-flex items-center gap-1 hover:underline">Apply Now <i class="fa-solid fa-arrow-right text-xs"></i></a>
            <% } else { %>
                <a href="/customer/login" class="text-blue-600 font-semibold inline-flex items-center gap-1 hover:underline">Login to Apply <i class="fa-solid fa-arrow-right text-xs"></i></a>
            <% } %>
        </div>
    </div>
</div>`,

    'customer_login.ejs': `
<div class="max-w-md mx-auto bg-white p-8 rounded-xl shadow border border-gray-100 space-y-6">
    <h2 class="text-2xl font-bold text-center text-blue-900">Customer Login</h2>
    <% if (locals.error) { %>
        <div class="bg-red-100 text-red-700 p-3 rounded text-sm"><%= error %></div>
    <% } %>
    <form action="/customer/login" method="POST" class="space-y-4">
        <div>
            <label class="block text-sm font-medium text-gray-700">Username or Email</label>
            <input type="text" name="username" required class="w-full mt-1 p-2 border rounded-lg focus:ring focus:ring-blue-300">
        </div>
        <div>
            <label class="block text-sm font-medium text-gray-700">Password</label>
            <input type="password" name="password" required class="w-full mt-1 p-2 border rounded-lg focus:ring focus:ring-blue-300">
        </div>
        <button type="submit" class="w-full bg-blue-600 text-white p-2 rounded-lg font-semibold hover:bg-blue-700">Login</button>
    </form>
    <p class="text-center text-sm text-gray-600">Don't have an account? <a href="/customer/register" class="text-blue-600 font-semibold hover:underline">Register here</a></p>
</div>`,

    'customer_register.ejs': `
<div class="max-w-md mx-auto bg-white p-8 rounded-xl shadow border border-gray-100 space-y-6">
    <h2 class="text-2xl font-bold text-center text-blue-900">Customer Registration</h2>
    <% if (locals.error) { %>
        <div class="bg-red-100 text-red-700 p-3 rounded text-sm"><%= error %></div>
    <% } %>
    <form action="/customer/register" method="POST" class="space-y-4">
        <div>
            <label class="block text-sm font-medium text-gray-700">Full Name</label>
            <input type="text" name="fullname" required class="w-full mt-1 p-2 border rounded-lg">
        </div>
        <div>
            <label class="block text-sm font-medium text-gray-700">Email Address</label>
            <input type="email" name="email" required class="w-full mt-1 p-2 border rounded-lg">
        </div>
        <div>
            <label class="block text-sm font-medium text-gray-700">Mobile Number</label>
            <input type="text" name="mobile" placeholder="09123456789" required class="w-full mt-1 p-2 border rounded-lg">
        </div>
        <div>
            <label class="block text-sm font-medium text-gray-700">Username</label>
            <input type="text" name="username" required class="w-full mt-1 p-2 border rounded-lg">
        </div>
        <div>
            <label class="block text-sm font-medium text-gray-700">Password</label>
            <input type="password" name="password" required class="w-full mt-1 p-2 border rounded-lg">
        </div>
        <div>
            <label class="block text-sm font-medium text-gray-700">Confirm Password</label>
            <input type="password" name="confirm_password" required class="w-full mt-1 p-2 border rounded-lg">
        </div>
        <button type="submit" class="w-full bg-blue-600 text-white p-2 rounded-lg font-semibold hover:bg-blue-700">Create Account</button>
    </form>
    <p class="text-center text-sm text-gray-600">Already have an account? <a href="/customer/login" class="text-blue-600 font-semibold hover:underline">Login here</a></p>
</div>`,

    'customer_dashboard.ejs': `
<div class="space-y-6">
    <div class="bg-white p-6 rounded-xl shadow border border-gray-100 flex justify-between items-center">
        <div>
            <h1 class="text-2xl font-bold text-blue-900">Welcome, <%= user.fullname %>!</h1>
            <p class="text-gray-600 text-sm">Manage your applications, track statuses, and view completed documents.</p>
        </div>
        <div class="flex gap-3">
            <a href="/customer/apply/tin" class="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700"><i class="fa-solid fa-plus"></i> New TIN</a>
            <a href="/customer/apply/sss" class="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-emerald-700"><i class="fa-solid fa-plus"></i> New SSS</a>
            <a href="/customer/apply/pagibig" class="bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-amber-700"><i class="fa-solid fa-plus"></i> New Pag-IBIG</a>
        </div>
    </div>

    <% if (notifications.length > 0) { %>
        <div class="bg-blue-50 border-l-4 border-blue-600 p-4 rounded-r-lg space-y-2">
            <h3 class="font-bold text-blue-900 text-sm"><i class="fa-solid fa-bell"></i> Notifications</h3>
            <ul class="space-y-1 text-sm text-blue-800">
                <% notifications.forEach(n => { %>
                    <li>• <%= n.message %> <span class="text-xs text-gray-500">(<%= n.created_at %>)</span></li>
                <% }) %>
            </ul>
        </div>
    <% } %>

    <div class="bg-white p-6 rounded-xl shadow border border-gray-100 space-y-4">
        <h2 class="text-xl font-bold text-gray-800">My Applications</h2>
        <% if (applications.length === 0) { %>
            <p class="text-gray-500 text-sm">You haven't submitted any applications yet. Choose a service above to get started.</p>
        <% } else { %>
            <div class="grid md:grid-cols-2 gap-4">
                <% applications.forEach(app => { %>
                    <div class="border rounded-lg p-4 space-y-3 bg-gray-50">
                        <div class="flex justify-between items-start">
                            <div>
                                <span class="text-xs font-bold px-2 py-1 rounded bg-blue-100 text-blue-800"><%= app.service %></span>
                                <h4 class="font-bold text-gray-900 mt-1">Tracking: <%= app.tracking_number %></h4>
                            </div>
                            <span class="text-xs font-semibold px-2 py-1 rounded 
                                <%= app.status === 'Completed' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800' %>">
                                <%= app.status %>
                            </span>
                        </div>
                        <div class="text-sm text-gray-600 space-y-1">
                            <p>Submitted: <%= app.created_at %></p>
                            <p>Payment: <span class="font-semibold <%= app.payment_status === 'Paid' ? 'text-green-600' : 'text-orange-600' %>"><%= app.payment_status %></span></p>
                        </div>
                        <div class="flex gap-2 pt-2">
                            <a href="/customer/application/<%= app.id %>" class="bg-blue-600 text-white px-3 py-1.5 rounded text-xs font-semibold hover:bg-blue-700">View Details</a>
                            <% if (app.payment_status === 'Unpaid' || app.payment_status === 'Rejected') { %>
                                <a href="/customer/payment/<%= app.id %>" class="bg-emerald-600 text-white px-3 py-1.5 rounded text-xs font-semibold hover:bg-emerald-700">Pay / Upload Proof</a>
                            <% } %>
                        </div>
                    </div>
                <% }) %>
            </div>
        <% } %>
    </div>
</div>`,

    'application_form.ejs': `
<div class="max-w-3xl mx-auto bg-white p-8 rounded-xl shadow border border-gray-100 space-y-6">
    <h2 class="text-2xl font-bold text-blue-900"><%= serviceTitle %> Application</h2>
    <p class="text-sm text-gray-600">Please fill out all required fields accurately. Follow the steps carefully.</p>

    <% if (locals.error) { %>
        <div class="bg-red-100 text-red-700 p-3 rounded text-sm"><%= error %></div>
    <% } %>

    <form action="/customer/apply/<%= serviceCode %>" method="POST" enctype="multipart/form-data" class="space-y-6">
        
        <!-- Personal Info -->
        <div class="space-y-4">
            <h3 class="text-lg font-bold text-gray-800 border-b pb-2">1. Personal Information</h3>
            <div class="grid md:grid-cols-3 gap-4">
                <div>
                    <label class="block text-sm font-medium text-gray-700">First Name *</label>
                    <input type="text" name="first_name" required class="w-full mt-1 p-2 border rounded">
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700">Middle Name</label>
                    <input type="text" name="middle_name" class="w-full mt-1 p-2 border rounded">
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700">Last Name *</label>
                    <input type="text" name="last_name" required class="w-full mt-1 p-2 border rounded">
                </div>
            </div>
            <div class="grid md:grid-cols-3 gap-4">
                <div>
                    <label class="block text-sm font-medium text-gray-700">Suffix (Jr, III)</label>
                    <input type="text" name="suffix" class="w-full mt-1 p-2 border rounded">
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700">Date of Birth *</label>
                    <input type="date" name="dob" required class="w-full mt-1 p-2 border rounded">
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700">Place of Birth *</label>
                    <input type="text" name="pob" required class="w-full mt-1 p-2 border rounded">
                </div>
            </div>
            <div class="grid md:grid-cols-3 gap-4">
                <div>
                    <label class="block text-sm font-medium text-gray-700">Sex *</label>
                    <select name="sex" required class="w-full mt-1 p-2 border rounded">
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                    </select>
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700">Civil Status *</label>
                    <select name="civil_status" id="civil_status" required class="w-full mt-1 p-2 border rounded" onchange="toggleCivilStatus()">
                        <option value="Single">Single</option>
                        <option value="Married">Married</option>
                        <option value="Widowed">Widowed</option>
                        <option value="Separated">Separated</option>
                    </select>
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700">Nationality *</label>
                    <input type="text" name="nationality" value="Filipino" required class="w-full mt-1 p-2 border rounded">
                </div>
            </div>
        </div>

        <!-- Contact Info -->
        <div class="space-y-4">
            <h3 class="text-lg font-bold text-gray-800 border-b pb-2">2. Contact Information</h3>
            <div class="grid md:grid-cols-2 gap-4">
                <div>
                    <label class="block text-sm font-medium text-gray-700">Mobile Number *</label>
                    <input type="text" name="mobile" placeholder="09123456789" required class="w-full mt-1 p-2 border rounded">
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700">Email Address *</label>
                    <input type="email" name="email" required class="w-full mt-1 p-2 border rounded">
                </div>
            </div>
        </div>

        <!-- Address -->
        <div class="space-y-4">
            <h3 class="text-lg font-bold text-gray-800 border-b pb-2">3. Complete Address</h3>
            <div class="grid md:grid-cols-3 gap-4">
                <div>
                    <label class="block text-sm font-medium text-gray-700">House/Unit No.</label>
                    <input type="text" name="house_no" class="w-full mt-1 p-2 border rounded">
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700">Street *</label>
                    <input type="text" name="street" required class="w-full mt-1 p-2 border rounded">
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700">Barangay *</label>
                    <input type="text" name="barangay" required class="w-full mt-1 p-2 border rounded">
                </div>
            </div>
            <div class="grid md:grid-cols-3 gap-4">
                <div>
                    <label class="block text-sm font-medium text-gray-700">Municipality/City *</label>
                    <input type="text" name="city" required class="w-full mt-1 p-2 border rounded">
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700">Province *</label>
                    <input type="text" name="province" required class="w-full mt-1 p-2 border rounded">
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700">ZIP Code *</label>
                    <input type="text" name="zip_code" required class="w-full mt-1 p-2 border rounded">
                </div>
            </div>
        </div>

        <% if (serviceCode === 'tin') { %>
            <!-- TIN Specific Employment & Income -->
            <div class="space-y-4">
                <h3 class="text-lg font-bold text-gray-800 border-b pb-2">4. Employment & Income Information</h3>
                <div class="grid md:grid-cols-2 gap-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-700">Employment Status *</label>
                        <select name="employment_status" class="w-full mt-1 p-2 border rounded">
                            <option value="Employed">Employed</option>
                            <option value="Self-Employed">Self-Employed</option>
                            <option value="Unemployed">Unemployed</option>
                            <option value="Student">Student</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700">Source of Income *</label>
                        <input type="text" name="source_of_income" required class="w-full mt-1 p-2 border rounded">
                    </div>
                </div>
                <div class="grid md:grid-cols-2 gap-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-700">Employer Name (If applicable)</label>
                        <input type="text" name="employer_name" class="w-full mt-1 p-2 border rounded">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700">Employer Address</label>
                        <input type="text" name="employer_address" class="w-full mt-1 p-2 border rounded">
                    </div>
                </div>
            </div>
        <% } %>

        <% if (serviceCode === 'sss' || serviceCode === 'pagibig') { %>
            <!-- Parents Information -->
            <div class="space-y-4">
                <h3 class="text-lg font-bold text-gray-800 border-b pb-2">4. Parents Information</h3>
                <p class="text-xs text-gray-500">Required by government agencies for identity verification and record matching.</p>
                
                <div class="bg-gray-50 p-4 rounded-lg space-y-3">
                    <h4 class="font-semibold text-gray-700 text-sm">Mother's Maiden Name Details</h4>
                    <div class="grid md:grid-cols-4 gap-3">
                        <input type="text" name="mother_first" placeholder="First Name *" required class="p-2 border rounded text-sm">
                        <input type="text" name="mother_middle" placeholder="Middle Name" class="p-2 border rounded text-sm">
                        <input type="text" name="mother_maiden" placeholder="Maiden Last Name *" required class="p-2 border rounded text-sm">
                        <input type="date" name="mother_dob" placeholder="Date of Birth" class="p-2 border rounded text-sm">
                    </div>
                </div>

                <div class="bg-gray-50 p-4 rounded-lg space-y-3">
                    <h4 class="font-semibold text-gray-700 text-sm">Father's Name Details</h4>
                    <div class="grid md:grid-cols-4 gap-3">
                        <input type="text" name="father_first" placeholder="First Name *" required class="p-2 border rounded text-sm">
                        <input type="text" name="father_middle" placeholder="Middle Name" class="p-2 border rounded text-sm">
                        <input type="text" name="father_last" placeholder="Last Name *" required class="p-2 border rounded text-sm">
                        <input type="date" name="father_dob" placeholder="Date of Birth" class="p-2 border rounded text-sm">
                    </div>
                </div>
            </div>

            <!-- Beneficiaries (Multiple) -->
            <div class="space-y-4">
                <div class="flex justify-between items-center border-b pb-2">
                    <h3 class="text-lg font-bold text-gray-800">5. Beneficiaries Information</h3>
                    <button type="button" onclick="addBeneficiary()" class="bg-emerald-600 text-white px-3 py-1 rounded text-xs font-semibold">+ Add Beneficiary</button>
                </div>
                <div id="beneficiaries-container" class="space-y-4">
                    <div class="beneficiary-item bg-gray-50 p-4 rounded-lg space-y-3 border relative">
                        <div class="grid md:grid-cols-3 gap-3">
                            <input type="text" name="ben_fullname[]" placeholder="Full Name *" required class="p-2 border rounded text-sm">
                            <select name="ben_relationship[]" required class="p-2 border rounded text-sm">
                                <option value="Spouse">Spouse</option>
                                <option value="Child">Child</option>
                                <option value="Parent">Parent</option>
                                <option value="Sibling">Sibling</option>
                                <option value="Other">Other</option>
                            </select>
                            <input type="date" name="ben_dob[]" required class="p-2 border rounded text-sm">
                        </div>
                        <div class="grid md:grid-cols-3 gap-3">
                            <select name="ben_sex[]" required class="p-2 border rounded text-sm">
                                <option value="Male">Male</option>
                                <option value="Female">Female</option>
                            </select>
                            <input type="text" name="ben_address[]" placeholder="Address *" required class="p-2 border rounded text-sm">
                            <input type="text" name="ben_contact[]" placeholder="Contact Number" class="p-2 border rounded text-sm">
                        </div>
                    </div>
                </div>
            </div>
        <% } %>

        <!-- Spouse Section (Conditional) -->
        <div id="spouse-section" class="space-y-4 hidden bg-gray-50 p-4 rounded-lg border">
            <h3 class="text-lg font-bold text-gray-800">Spouse Information & Marriage Certificate</h3>
            <div class="grid md:grid-cols-3 gap-3">
                <input type="text" name="spouse_first" placeholder="Spouse First Name" class="p-2 border rounded text-sm">
                <input type="text" name="spouse_middle" placeholder="Spouse Middle Name" class="p-2 border rounded text-sm">
                <input type="text" name="spouse_last" placeholder="Spouse Last Name" class="p-2 border rounded text-sm">
            </div>
            <div class="grid md:grid-cols-2 gap-3">
                <input type="date" name="spouse_dob" class="p-2 border rounded text-sm">
                <input type="text" name="spouse_address" placeholder="Spouse Address" class="p-2 border rounded text-sm">
            </div>
            <div>
                <label class="block text-sm font-medium text-gray-700">Marriage Certificate (PDF or Image) *</label>
                <input type="file" name="marriage_cert" accept=".jpg,.jpeg,.png,.pdf" class="w-full mt-1 p-2 border rounded text-sm bg-white">
            </div>
        </div>

        <!-- Document Uploads -->
        <div class="space-y-4">
            <h3 class="text-lg font-bold text-gray-800 border-b pb-2">Document Requirements</h3>
            
            <div class="grid md:grid-cols-2 gap-4">
                <div>
                    <label class="block text-sm font-medium text-gray-700">Valid ID Type *</label>
                    <select name="id_type" required class="w-full mt-1 p-2 border rounded">
                        <option value="National ID">National ID</option>
                        <option value="Driver\\'s License">Driver\\'s License</option>
                        <option value="Passport">Passport</option>
                        <option value="UMID">UMID</option>
                        <option value="PhilHealth ID">PhilHealth ID</option>
                        <option value="Postal ID">Postal ID</option>
                        <option value="Other">Other Valid Government ID</option>
                    </select>
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700">ID Number *</label>
                    <input type="text" name="id_number" required class="w-full mt-1 p-2 border rounded">
                </div>
            </div>

            <div>
                <label class="block text-sm font-medium text-gray-700">Upload Valid ID Image/PDF *</label>
                <input type="file" name="valid_id_file" accept=".jpg,.jpeg,.png,.pdf" required class="w-full mt-1 p-2 border rounded bg-white">
            </div>

            <div>
                <label class="block text-sm font-medium text-gray-700">Photo Holding Valid ID *</label>
                <p class="text-xs text-gray-500">Take a clear photo while holding your valid ID near your face so both are visible.</p>
                <input type="file" name="photo_holding_id" accept="image/*" capture="user" required class="w-full mt-1 p-2 border rounded bg-white">
            </div>

            <div>
                <label class="block text-sm font-medium text-gray-700">ID Picture / Profile Picture *</label>
                <p class="text-xs text-gray-500">Clear face photo with neutral background.</p>
                <input type="file" name="id_picture" accept="image/*" required class="w-full mt-1 p-2 border rounded bg-white">
            </div>
        </div>

        <button type="submit" class="w-full bg-blue-600 text-white p-3 rounded-lg font-bold hover:bg-blue-700">Review & Submit Application</button>
    </form>
</div>

<script>
function toggleCivilStatus() {
    const status = document.getElementById('civil_status').value;
    const spouseSection = document.getElementById('spouse-section');
    if (status === 'Married') {
        spouseSection.classList.remove('hidden');
    } else {
        spouseSection.classList.add('hidden');
    }
}

function addBeneficiary() {
    const container = document.getElementById('beneficiaries-container');
    const div = document.createElement('div');
    div.className = 'beneficiary-item bg-gray-50 p-4 rounded-lg space-y-3 border relative';
    div.innerHTML = \`
        <div class="grid md:grid-cols-3 gap-3">
            <input type="text" name="ben_fullname[]" placeholder="Full Name *" required class="p-2 border rounded text-sm">
            <select name="ben_relationship[]" required class="p-2 border rounded text-sm">
                <option value="Spouse">Spouse</option>
                <option value="Child">Child</option>
                <option value="Parent">Parent</option>
                <option value="Sibling">Sibling</option>
                <option value="Other">Other</option>
            </select>
            <input type="date" name="ben_dob[]" required class="p-2 border rounded text-sm">
        </div>
        <div class="grid md:grid-cols-3 gap-3">
            <select name="ben_sex[]" required class="p-2 border rounded text-sm">
                <option value="Male">Male</option>
                <option value="Female">Female</option>
            </select>
            <input type="text" name="ben_address[]" placeholder="Address *" required class="p-2 border rounded text-sm">
            <input type="text" name="ben_contact[]" placeholder="Contact Number" class="p-2 border rounded text-sm">
        </div>
        <button type="button" onclick="this.parentElement.remove()" class="text-red-600 text-xs font-semibold hover:underline"><i class="fa-solid fa-trash"></i> Remove Beneficiary</button>
    \`;
    container.appendChild(div);
}
</script>`,

    'payment.ejs': `
<div class="max-w-xl mx-auto bg-white p-8 rounded-xl shadow border border-gray-100 space-y-6">
    <h2 class="text-2xl font-bold text-blue-900">Application Payment</h2>
    <div class="bg-blue-50 p-4 rounded-lg space-y-2 text-sm">
        <p><strong>Service:</strong> <%= app.service %></p>
        <p><strong>Tracking Number:</strong> <%= app.tracking_number %></p>
        <p class="text-lg font-bold text-blue-900">Amount Due: ₱<%= amount %></p>
    </div>

    <% if (locals.error) { %>
        <div class="bg-red-100 text-red-700 p-3 rounded text-sm"><%= error %></div>
    <% } %>

    <form action="/customer/payment/<%= app.id %>" method="POST" enctype="multipart/form-data" class="space-y-4">
        <div>
            <label class="block text-sm font-medium text-gray-700">Select Payment Method *</label>
            <select name="payment_method" id="payment_method" required class="w-full mt-1 p-2 border rounded" onchange="togglePaymentMethod()">
                <option value="GCash">GCash</option>
                <option value="Cash">Cash / Over-the-counter / Center</option>
            </select>
        </div>

        <div id="gcash-section" class="space-y-4 bg-gray-50 p-4 rounded-lg border">
            <h3 class="font-bold text-gray-800 text-sm">GCash Payment Instructions</h3>
            <p class="text-xs text-gray-600"><%= settings.payment_instructions %></p>
            <% if (settings.gcash_qr) { %>
                <div class="text-center">
                    <img src="/uploads/<%= settings.gcash_qr %>" alt="GCash QR" class="mx-auto w-48 h-48 object-contain border rounded bg-white p-2">
                </div>
            <% } else { %>
                <p class="text-xs text-orange-600">Admin QR code not uploaded yet. Contact support for GCash number.</p>
            <% } %>
            <div>
                <label class="block text-sm font-medium text-gray-700">GCash Reference Number *</label>
                <input type="text" name="reference_number" class="w-full mt-1 p-2 border rounded bg-white" placeholder="e.g., 1029384756">
            </div>
            <div>
                <label class="block text-sm font-medium text-gray-700">Upload Payment Proof (Screenshot) *</label>
                <input type="file" name="payment_proof" accept=".jpg,.jpeg,.png,.pdf" class="w-full mt-1 p-2 border rounded bg-white">
            </div>
        </div>

        <div id="cash-section" class="space-y-4 bg-gray-50 p-4 rounded-lg border hidden">
            <h3 class="font-bold text-gray-800 text-sm">Cash Payment Instructions</h3>
            <p class="text-xs text-gray-600">Your application will be marked as pending cash verification. Please coordinate with our office or representative according to instructions.</p>
        </div>

        <button type="submit" class="w-full bg-emerald-600 text-white p-3 rounded-lg font-bold hover:bg-emerald-700">Submit Payment Details</button>
    </form>
</div>

<script>
function togglePaymentMethod() {
    const method = document.getElementById('payment_method').value;
    const gcash = document.getElementById('gcash-section');
    const cash = document.getElementById('cash-section');
    if (method === 'GCash') {
        gcash.classList.remove('hidden');
        cash.classList.add('hidden');
    } else {
        gcash.classList.add('hidden');
        cash.classList.remove('hidden');
    }
}
</script>`,

    'customer_application_view.ejs': `
<div class="max-w-4xl mx-auto space-y-6">
    <div class="bg-white p-6 rounded-xl shadow border flex justify-between items-center">
        <div>
            <span class="text-xs font-bold px-2 py-1 rounded bg-blue-100 text-blue-800"><%= app.service %></span>
            <h1 class="text-2xl font-bold text-blue-900 mt-1">Tracking: <%= app.tracking_number %></h1>
            <p class="text-xs text-gray-500">Submitted on: <%= app.created_at %></p>
        </div>
        <div class="text-right">
            <span class="px-3 py-1 rounded-full text-xs font-bold 
                <%= app.status === 'Completed' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800' %>">
                <%= app.status %>
            </span>
            <p class="text-xs text-gray-500 mt-1">Payment: <strong class="<%= app.payment_status === 'Paid' ? 'text-green-600' : 'text-orange-600' %>"><%= app.payment_status %></strong></p>
        </div>
    </div>

    <% if (app.rejection_reason) { %>
        <div class="bg-red-100 border-l-4 border-red-600 p-4 rounded-r-lg space-y-1">
            <h3 class="font-bold text-red-900 text-sm">Admin Correction Request / Remarks</h3>
            <p class="text-sm text-red-800"><%= app.rejection_reason %></p>
        </div>
    <% } %>

    <!-- Completed Documents by Admin -->
    <div class="bg-white p-6 rounded-xl shadow border space-y-4">
        <h2 class="text-lg font-bold text-gray-800">Completed Documents (Uploaded by Admin)</h2>
        <% if (completedFiles.length === 0) { %>
            <p class="text-sm text-gray-500">No completed files uploaded by admin yet. Once processed, your final documents will appear here.</p>
        <% } else { %>
            <div class="grid md:grid-cols-2 gap-3">
                <% completedFiles.forEach(file => { %>
                    <div class="border p-3 rounded-lg flex justify-between items-center bg-gray-50">
                        <div>
                            <h4 class="font-bold text-sm text-gray-800"><%= file.title %></h4>
                            <span class="text-xs text-gray-500"><%= file.original_name %></span>
                        </div>
                        <a href="/uploads/<%= file.file_path %>" target="_blank" class="bg-blue-600 text-white px-3 py-1 rounded text-xs font-semibold hover:bg-blue-700">Download</a>
                    </div>
                <% }) %>
            </div>
        <% } %>
    </div>

    <!-- Application History -->
    <div class="bg-white p-6 rounded-xl shadow border space-y-4">
        <h2 class="text-lg font-bold text-gray-800">Application Progress Timeline</h2>
        <div class="border-l-2 border-blue-600 pl-4 space-y-4">
            <% history.forEach(h => { %>
                <div class="relative space-y-1">
                    <div class="absolute -left-[21px] top-1 w-3 h-3 bg-blue-600 rounded-full border-2 border-white"></div>
                    <h4 class="font-bold text-sm text-blue-900"><%= h.status %></h4>
                    <% if (h.remarks) { %>
                        <p class="text-xs text-gray-600"><%= h.remarks %></p>
                    <% } %>
                    <span class="text-[10px] text-gray-400"><%= h.created_at %></span>
                </div>
            <% }) %>
        </div>
    </div>
</div>`,

    'track.ejs': `
<div class="max-w-xl mx-auto space-y-6">
    <div class="bg-white p-8 rounded-xl shadow border text-center space-y-4">
        <h1 class="text-2xl font-bold text-blue-900">Track Your Application</h1>
        <p class="text-sm text-gray-600">Enter your tracking number below to check real-time status.</p>
        <form action="/track" method="GET" class="flex gap-2">
            <input type="text" name="tracking_number" placeholder="e.g., TIN-20260901-0001" required value="<%= locals.searchCode || '' %>" class="flex-grow p-2 border rounded-lg text-sm">
            <button type="submit" class="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700">Track</button>
        </form>
    </div>

    <% if (locals.searched) { %>
        <% if (app) { %>
            <div class="bg-white p-6 rounded-xl shadow border space-y-4">
                <div class="flex justify-between items-center border-b pb-3">
                    <div>
                        <span class="text-xs font-bold px-2 py-1 rounded bg-blue-100 text-blue-800"><%= app.service %></span>
                        <h3 class="text-lg font-bold text-gray-900 mt-1"><%= app.tracking_number %></h3>
                    </div>
                    <span class="px-3 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-800"><%= app.status %></span>
                </div>
                <div class="text-sm text-gray-600 space-y-2">
                    <p><strong>Applicant Name:</strong> <%= maskedName %></p>
                    <p><strong>Date Submitted:</strong> <%= app.created_at %></p>
                    <p><strong>Payment Status:</strong> <span class="font-semibold <%= app.payment_status === 'Paid' ? 'text-green-600' : 'text-orange-600' %>"><%= app.payment_status %></span></p>
                </div>
            </div>
        <% } else { %>
            <div class="bg-red-100 text-red-700 p-4 rounded-xl text-center text-sm">
                No application found with tracking number: <strong><%= searchCode %></strong>. Please check and try again.
            </div>
        <% } %>
    <% } %>
</div>`,

    'admin_login.ejs': `
<div class="max-w-md mx-auto bg-white p-8 rounded-xl shadow border space-y-6">
    <h2 class="text-2xl font-bold text-center text-blue-900">Admin Portal Login</h2>
    <% if (locals.error) { %>
        <div class="bg-red-100 text-red-700 p-3 rounded text-sm"><%= error %></div>
    <% } %>
    <form action="/admin/login" method="POST" class="space-y-4">
        <div>
            <label class="block text-sm font-medium text-gray-700">Admin Username</label>
            <input type="text" name="username" required class="w-full mt-1 p-2 border rounded-lg">
        </div>
        <div>
            <label class="block text-sm font-medium text-gray-700">Password</label>
            <input type="password" name="password" required class="w-full mt-1 p-2 border rounded-lg">
        </div>
        <button type="submit" class="w-full bg-blue-900 text-white p-2 rounded-lg font-semibold hover:bg-blue-800">Admin Login</button>
    </form>
</div>`,

    'admin_dashboard.ejs': `
<div class="space-y-6">
    <div class="flex justify-between items-center bg-white p-6 rounded-xl shadow border">
        <div>
            <h1 class="text-2xl font-bold text-blue-900">Admin Dashboard</h1>
            <p class="text-sm text-gray-600">Overview of applications, payments, and system operations.</p>
        </div>
        <div class="flex gap-2">
            <a href="/admin/applications" class="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700">Manage Applications</a>
            <a href="/admin/settings" class="bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-gray-700">Settings</a>
        </div>
    </div>

    <div class="grid md:grid-cols-4 gap-4">
        <div class="bg-white p-5 rounded-xl shadow border space-y-1">
            <span class="text-xs text-gray-500 font-semibold">Total Applications</span>
            <h3 class="text-2xl font-bold text-blue-900"><%= stats.totalApplications %></h3>
        </div>
        <div class="bg-white p-5 rounded-xl shadow border space-y-1">
            <span class="text-xs text-gray-500 font-semibold">Total Customers</span>
            <h3 class="text-2xl font-bold text-blue-900"><%= stats.totalCustomers %></h3>
        </div>
        <div class="bg-white p-5 rounded-xl shadow border space-y-1">
            <span class="text-xs text-gray-500 font-semibold">Pending Verification</span>
            <h3 class="text-2xl font-bold text-orange-600"><%= stats.pendingApps %></h3>
        </div>
        <div class="bg-white p-5 rounded-xl shadow border space-y-1">
            <span class="text-xs text-gray-500 font-semibold">Completed</span>
            <h3 class="text-2xl font-bold text-green-600"><%= stats.completedApps %></h3>
        </div>
    </div>

    <div class="bg-white p-6 rounded-xl shadow border space-y-4">
        <h2 class="text-lg font-bold text-gray-800">Recent Applications</h2>
        <div class="overflow-x-auto">
            <table class="w-full text-left text-sm">
                <thead class="bg-gray-50 border-b text-gray-700">
                    <tr>
                        <th class="p-3">Tracking</th>
                        <th class="p-3">Service</th>
                        <th class="p-3">Applicant</th>
                        <th class="p-3">Payment</th>
                        <th class="p-3">Status</th>
                        <th class="p-3">Action</th>
                    </tr>
                </thead>
                <tbody class="divide-y">
                    <% applications.forEach(app => { %>
                        <tr>
                            <td class="p-3 font-semibold"><%= app.tracking_number %></td>
                            <td class="p-3"><%= app.service %></td>
                            <td class="p-3"><%= app.fullname %></td>
                            <td class="p-3"><span class="px-2 py-0.5 rounded text-xs <%= app.payment_status === 'Paid' ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800' %>"><%= app.payment_status %></span></td>
                            <td class="p-3"><span class="px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-800"><%= app.status %></span></td>
                            <td class="p-3"><a href="/admin/application/<%= app.id %>" class="bg-blue-600 text-white px-3 py-1 rounded text-xs hover:bg-blue-700">Review</a></td>
                        </tr>
                    <% }) %>
                </tbody>
            </table>
        </div>
    </div>
</div>`,

    'admin_applications.ejs': `
<div class="space-y-6">
    <div class="bg-white p-6 rounded-xl shadow border flex justify-between items-center">
        <h1 class="text-2xl font-bold text-blue-900">All Applications Management</h1>
        <form action="/admin/applications" method="GET" class="flex gap-2">
            <input type="text" name="search" placeholder="Search name or tracking..." value="<%= locals.search || '' %>" class="p-2 border rounded text-sm">
            <button type="submit" class="bg-blue-600 text-white px-4 py-2 rounded text-sm font-semibold hover:bg-blue-700">Search</button>
        </form>
    </div>

    <div class="bg-white p-6 rounded-xl shadow border">
        <div class="overflow-x-auto">
            <table class="w-full text-left text-sm">
                <thead class="bg-gray-50 border-b text-gray-700">
                    <tr>
                        <th class="p-3">Tracking</th>
                        <th class="p-3">Service</th>
                        <th class="p-3">Applicant Name</th>
                        <th class="p-3">Date</th>
                        <th class="p-3">Payment</th>
                        <th class="p-3">Status</th>
                        <th class="p-3">Action</th>
                    </tr>
                </thead>
                <tbody class="divide-y">
                    <% applications.forEach(app => { %>
                        <tr>
                            <td class="p-3 font-semibold"><%= app.tracking_number %></td>
                            <td class="p-3"><%= app.service %></td>
                            <td class="p-3"><%= app.fullname %></td>
                            <td class="p-3 text-xs text-gray-500"><%= app.created_at %></td>
                            <td class="p-3"><span class="px-2 py-0.5 rounded text-xs <%= app.payment_status === 'Paid' ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800' %>"><%= app.payment_status %></span></td>
                            <td class="p-3"><span class="px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-800"><%= app.status %></span></td>
                            <td class="p-3"><a href="/admin/application/<%= app.id %>" class="bg-blue-600 text-white px-3 py-1 rounded text-xs hover:bg-blue-700">Full Review</a></td>
                        </tr>
                    <% }) %>
                </tbody>
            </table>
        </div>
    </div>
</div>`,

    'admin_application_detail.ejs': `
<div class="max-w-5xl mx-auto space-y-6">
    <div class="bg-white p-6 rounded-xl shadow border flex justify-between items-center">
        <div>
            <span class="text-xs font-bold px-2 py-1 rounded bg-blue-100 text-blue-800"><%= app.service %></span>
            <h1 class="text-2xl font-bold text-blue-900 mt-1">Application Review: <%= app.tracking_number %></h1>
            <p class="text-xs text-gray-500">Submitted by: <%= app.customer_name %> (<%= app.email %>)</p>
        </div>
        <div class="flex gap-2">
            <a href="/admin/application/<%= app.id %>/print" target="_blank" class="bg-gray-800 text-white px-4 py-2 rounded text-xs font-semibold hover:bg-gray-700"><i class="fa-solid fa-print"></i> Print Application</a>
        </div>
    </div>

    <!-- Applicant Full Details -->
    <div class="bg-white p-6 rounded-xl shadow border space-y-4">
        <h2 class="text-lg font-bold text-blue-900 border-b pb-2">Personal & Contact Information</h2>
        <div class="grid md:grid-cols-3 gap-4 text-sm">
            <p><strong>Full Name:</strong> <%= info.first_name %> <%= info.middle_name || '' %> <%= info.last_name %> <%= info.suffix || '' %></p>
            <p><strong>Date of Birth:</strong> <%= info.dob %></p>
            <p><strong>Place of Birth:</strong> <%= info.pob %></p>
            <p><strong>Sex:</strong> <%= info.sex %></p>
            <p><strong>Civil Status:</strong> <%= info.civil_status %></p>
            <p><strong>Nationality:</strong> <%= info.nationality %></p>
            <p><strong>Mobile:</strong> <%= info.mobile %></p>
            <p><strong>Email:</strong> <%= info.email %></p>
        </div>
        <div class="text-sm pt-2 border-t">
            <p><strong>Address:</strong> <%= info.house_no || '' %> <%= info.street %>, Brgy. <%= info.barangay %>, <%= info.city %>, <%= info.province %> - <%= info.zip_code %></p>
        </div>
    </div>

    <% if (parent && (parent.mother_first || parent.father_first)) { %>
        <div class="bg-white p-6 rounded-xl shadow border space-y-3">
            <h2 class="text-lg font-bold text-blue-900 border-b pb-2">Parents Information</h2>
            <div class="grid md:grid-cols-2 gap-4 text-sm">
                <div>
                    <p class="font-semibold text-gray-700">Mother's Details</p>
                    <p>Name: <%= parent.mother_first %> <%= parent.mother_middle || '' %> <%= parent.mother_maiden %></p>
                    <p>DOB: <%= parent.mother_dob || 'N/A' %></p>
                </div>
                <div>
                    <p class="font-semibold text-gray-700">Father's Details</p>
                    <p>Name: <%= parent.father_first %> <%= parent.father_middle || '' %> <%= parent.father_last %></p>
                    <p>DOB: <%= parent.father_dob || 'N/A' %></p>
                </div>
            </div>
        </div>
    <% } %>

    <% if (spouse && spouse.spouse_first) { %>
        <div class="bg-white p-6 rounded-xl shadow border space-y-3">
            <h2 class="text-lg font-bold text-blue-900 border-b pb-2">Spouse Information & Marriage Certificate</h2>
            <div class="grid md:grid-cols-2 gap-4 text-sm">
                <p><strong>Spouse Name:</strong> <%= spouse.spouse_first %> <%= spouse.spouse_middle || '' %> <%= spouse.spouse_last %></p>
                <p><strong>Spouse DOB:</strong> <%= spouse.spouse_dob %></p>
                <p><strong>Address:</strong> <%= spouse.spouse_address %></p>
                <% if (spouse.marriage_cert) { %>
                    <p><strong>Marriage Certificate:</strong> <a href="/uploads/<%= spouse.marriage_cert %>" target="_blank" class="text-blue-600 underline font-semibold">View Document</a></p>
                <% } %>
            </div>
        </div>
    <% } %>

    <% if (beneficiaries.length > 0) { %>
        <div class="bg-white p-6 rounded-xl shadow border space-y-3">
            <h2 class="text-lg font-bold text-blue-900 border-b pb-2">Beneficiaries (<%= beneficiaries.length %>)</h2>
            <div class="overflow-x-auto">
                <table class="w-full text-left text-sm">
                    <thead class="bg-gray-50 border-b">
                        <tr>
                            <th class="p-2">Full Name</th>
                            <th class="p-2">Relationship</th>
                            <th class="p-2">DOB</th>
                            <th class="p-2">Sex</th>
                            <th class="p-2">Address</th>
                            <th class="p-2">Contact</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y">
                        <% beneficiaries.forEach(b => { %>
                            <tr>
                                <td class="p-2 font-semibold"><%= b.fullname %></td>
                                <td class="p-2"><%= b.relationship %></td>
                                <td class="p-2"><%= b.dob %></td>
                                <td class="p-2"><%= b.sex %></td>
                                <td class="p-2"><%= b.address %></td>
                                <td class="p-2"><%= b.contact || 'N/A' %></td>
                            </tr>
                        <% }) %>
                    </tbody>
                </table>
            </div>
        </div>
    <% } %>

    <!-- Uploaded Documents -->
    <div class="bg-white p-6 rounded-xl shadow border space-y-3">
        <h2 class="text-lg font-bold text-blue-900 border-b pb-2">Customer Uploaded Documents</h2>
        <div class="grid md:grid-cols-3 gap-4">
            <% documents.forEach(doc => { %>
                <div class="border p-3 rounded-lg bg-gray-50 space-y-2">
                    <span class="text-xs font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-800 uppercase"><%= doc.doc_type %></span>
                    <p class="text-xs text-gray-600 truncate"><%= doc.original_name %></p>
                    <a href="/uploads/<%= doc.file_path %>" target="_blank" class="block text-center bg-blue-600 text-white py-1 rounded text-xs font-semibold hover:bg-blue-700">Preview / Download</a>
                </div>
            <% }) %>
        </div>
    </div>

    <!-- Payment Verification -->
    <div class="bg-white p-6 rounded-xl shadow border space-y-4">
        <h2 class="text-lg font-bold text-blue-900 border-b pb-2">Payment Verification</h2>
        <div class="grid md:grid-cols-2 gap-4 text-sm">
            <p><strong>Payment Method:</strong> <%= app.payment_method || 'Not Selected' %></p>
            <p><strong>Payment Status:</strong> <span class="font-bold <%= app.payment_status === 'Paid' ? 'text-green-600' : 'text-orange-600' %>"><%= app.payment_status %></span></p>
            <p><strong>Reference Number:</strong> <%= app.reference_number || 'N/A' %></p>
            <% if (app.payment_proof) { %>
                <p><strong>Payment Proof:</strong> <a href="/uploads/<%= app.payment_proof %>" target="_blank" class="text-blue-600 underline font-semibold">View Proof Receipt</a></p>
            <% } %>
        </div>

        <form action="/admin/application/<%= app.id %>/payment" method="POST" class="flex gap-4 items-center pt-2 border-t">
            <select name="payment_status" class="p-2 border rounded text-sm font-semibold">
                <option value="Unpaid" <%= app.payment_status === 'Unpaid' ? 'selected' : '' %>>Unpaid</option>
                <option value="Paid" <%= app.payment_status === 'Paid' ? 'selected' : '' %>>Paid / Verified</option>
                <option value="Rejected" <%= app.payment_status === 'Rejected' ? 'selected' : '' %>>Rejected</option>
            </select>
            <button type="submit" class="bg-emerald-600 text-white px-4 py-2 rounded text-sm font-semibold hover:bg-emerald-700">Update Payment Status</button>
        </form>
    </div>

    <!-- Status Update & Admin Actions -->
    <div class="bg-white p-6 rounded-xl shadow border space-y-4">
        <h2 class="text-lg font-bold text-blue-900 border-b pb-2">Application Status & Remarks</h2>
        <form action="/admin/application/<%= app.id %>/status" method="POST" class="space-y-4">
            <div class="grid md:grid-cols-2 gap-4">
                <div>
                    <label class="block text-sm font-medium text-gray-700">Update Status</label>
                    <select name="status" class="w-full mt-1 p-2 border rounded">
                        <option value="Submitted" <%= app.status === 'Submitted' ? 'selected' : '' %>>Submitted</option>
                        <option value="Payment Verification" <%= app.status === 'Payment Verification' ? 'selected' : '' %>>Payment Verification</option>
                        <option value="Under Review" <%= app.status === 'Under Review' ? 'selected' : '' %>>Under Review</option>
                        <option value="Need Correction" <%= app.status === 'Need Correction' ? 'selected' : '' %>>Need Correction</option>
                        <option value="Processing" <%= app.status === 'Processing' ? 'selected' : '' %>>Processing</option>
                        <option value="Ready" <%= app.status === 'Ready' ? 'selected' : '' %>>Ready</option>
                        <option value="Completed" <%= app.status === 'Completed' ? 'selected' : '' %>>Completed</option>
                        <option value="Rejected" <%= app.status === 'Rejected' ? 'selected' : '' %>>Rejected</option>
                    </select>
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700">Remarks / Correction Reason</label>
                    <input type="text" name="remarks" value="<%= app.rejection_reason || '' %>" placeholder="Optional notes or reason for correction..." class="w-full mt-1 p-2 border rounded">
                </div>
            </div>
            <button type="submit" class="bg-blue-600 text-white px-6 py-2 rounded font-semibold text-sm hover:bg-blue-700">Save Status & Notify Customer</button>
        </form>
    </div>

    <!-- Admin Completed Files Upload -->
    <div class="bg-white p-6 rounded-xl shadow border space-y-4">
        <h2 class="text-lg font-bold text-blue-900 border-b pb-2">Upload Completed Files (For Customer)</h2>
        <form action="/admin/application/<%= app.id %>/completed-file" method="POST" enctype="multipart/form-data" class="space-y-3">
            <div class="grid md:grid-cols-2 gap-4">
                <input type="text" name="title" placeholder="Document Title (e.g., TIN ID Copy, SSS Certificate)" required class="p-2 border rounded text-sm">
                <input type="file" name="completed_file" required class="p-2 border rounded text-sm bg-gray-50">
            </div>
            <button type="submit" class="bg-emerald-600 text-white px-4 py-2 rounded text-xs font-semibold hover:bg-emerald-700">+ Upload Completed Document</button>
        </form>

        <% if (completedFiles.length > 0) { %>
            <div class="pt-4 border-t space-y-2">
                <h4 class="font-bold text-xs text-gray-600 uppercase">Uploaded Files List</h4>
                <div class="space-y-2">
                    <% completedFiles.forEach(file => { %>
                        <div class="flex justify-between items-center p-2 border rounded bg-gray-50 text-sm">
                            <span><strong><%= file.title %></strong> (<%= file.original_name %>)</span>
                            <a href="/uploads/<%= file.file_path %>" target="_blank" class="text-blue-600 font-semibold underline">Download</a>
                        </div>
                    <% }) %>
                </div>
            </div>
        <% } %>
    </div>
</div>`,

    'admin_print.ejs': `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Print Application - <%= app.tracking_number %></title>
    <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
</head>
<body class="bg-white text-gray-900 p-8" onload="window.print()">
    <div class="max-w-3xl mx-auto space-y-6">
        <div class="text-center border-b pb-4">
            <h1 class="text-2xl font-bold text-blue-900">GovAssist PH - Application Summary</h1>
            <p class="text-sm text-gray-600">Service: <%= app.service %> | Tracking Number: <%= app.tracking_number %></p>
            <p class="text-xs text-gray-500">Date Submitted: <%= app.created_at %></p>
        </div>

        <div class="space-y-4 text-sm">
            <div>
                <h3 class="font-bold text-blue-900 border-b pb-1">Personal Information</h3>
                <p><strong>Name:</strong> <%= info.first_name %> <%= info.middle_name || '' %> <%= info.last_name %> <%= info.suffix || '' %></p>
                <p><strong>DOB & POB:</strong> <%= info.dob %> | <%= info.pob %></p>
                <p><strong>Sex / Civil Status:</strong> <%= info.sex %> | <%= info.civil_status %></p>
                <p><strong>Contact:</strong> <%= info.mobile %> | <%= info.email %></p>
                <p><strong>Address:</strong> <%= info.house_no || '' %> <%= info.street %>, Brgy. <%= info.barangay %>, <%= info.city %>, <%= info.province %> - <%= info.zip_code %></p>
            </div>

            <% if (parent && parent.mother_first) { %>
                <div>
                    <h3 class="font-bold text-blue-900 border-b pb-1">Parents Information</h3>
                    <p><strong>Mother:</strong> <%= parent.mother_first %> <%= parent.mother_middle || '' %> <%= parent.mother_maiden %></p>
                    <p><strong>Father:</strong> <%= parent.father_first %> <%= parent.father_middle || '' %> <%= parent.father_last %></p>
                </div>
            <% } %>

            <% if (spouse && spouse.spouse_first) { %>
                <div>
                    <h3 class="font-bold text-blue-900 border-b pb-1">Spouse Information</h3>
                    <p><strong>Spouse Name:</strong> <%= spouse.spouse_first %> <%= spouse.spouse_middle || '' %> <%= spouse.spouse_last %></p>
                </div>
            <% } %>

            <% if (beneficiaries.length > 0) { %>
                <div>
                    <h3 class="font-bold text-blue-900 border-b pb-1">Beneficiaries</h3>
                    <ul class="list-disc pl-5">
                        <% beneficiaries.forEach(b => { %>
                            <li><%= b.fullname %> (<%= b.relationship %>) - Born: <%= b.dob %></li>
                        <% }) %>
                    </ul>
                </div>
            <% } %>

            <div>
                <h3 class="font-bold text-blue-900 border-b pb-1">Payment Information</h3>
                <p><strong>Method:</strong> <%= app.payment_method %> | <strong>Status:</strong> <%= app.payment_status %> | <strong>Reference:</strong> <%= app.reference_number || 'N/A' %></p>
            </div>
        </div>
    </div>
</body>
</html>`,

    'admin_settings.ejs': `
<div class="max-w-2xl mx-auto bg-white p-8 rounded-xl shadow border space-y-6">
    <h2 class="text-2xl font-bold text-blue-900">Admin Settings & GCash QR</h2>
    <% if (locals.success) { %>
        <div class="bg-green-100 text-green-700 p-3 rounded text-sm"><%= success %></div>
    <% } %>
    <form action="/admin/settings" method="POST" enctype="multipart/form-data" class="space-y-4">
        <div>
            <label class="block text-sm font-medium text-gray-700">GCash QR Code Image</label>
            <% if (settings.gcash_qr) { %>
                <div class="my-2">
                    <img src="/uploads/<%= settings.gcash_qr %>" alt="Current QR" class="w-32 h-32 object-contain border rounded bg-gray-50 p-1">
                </div>
            <% } %>
            <input type="file" name="gcash_qr" accept=".jpg,.jpeg,.png" class="w-full mt-1 p-2 border rounded text-sm bg-white">
        </div>
        <div>
            <label class="block text-sm font-medium text-gray-700">Payment Instructions</label>
            <textarea name="payment_instructions" rows="3" class="w-full mt-1 p-2 border rounded text-sm"><%= settings.payment_instructions %></textarea>
        </div>
        <div>
            <label class="block text-sm font-medium text-gray-700">Application Instructions</label>
            <textarea name="application_instructions" rows="3" class="w-full mt-1 p-2 border rounded text-sm"><%= settings.application_instructions %></textarea>
        </div>
        <button type="submit" class="w-full bg-blue-900 text-white p-3 rounded-lg font-bold hover:bg-blue-800">Save Settings</button>
    </form>
</div>`
};

// Write EJS templates to views folder dynamically on startup
for (const [filename, content] of Object.entries(ejsTemplates)) {
    fs.writeFileSync(path.join(viewsDir, filename), content.trim());
}

// ==========================================
// ROUTES & CONTROLLERS
// ==========================================

// Helper to render with layout
function renderView(res, viewName, data = {}) {
    db.all(`SELECT * FROM settings`, [], (err, rows) => {
        const settings = {};
        if (rows) {
            rows.forEach(r => settings[r.key] = r.value);
        }
        data.settings = settings;
        res.render('layout', {
            body: fs.readFileSync(path.join(viewsDir, `${viewName}.ejs`), 'utf8'),
            ...data
        });
    });
}

// Landing Page
app.get('/', (req, res) => {
    renderView(res, 'landing', {
        title: 'GovAssist PH - Home',
        user: req.session.user || null,
        admin: req.session.admin || null
    });
});

// Customer Authentication
app.get('/customer/login', (req, res) => {
    renderView(res, 'customer_login', { title: 'Customer Login', user: null, admin: null });
});

app.post('/customer/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ? OR email = ?`, [username, username], async (err, user) => {
        if (user && await bcrypt.compare(password, user.password)) {
            req.session.user = user;
            res.redirect('/customer/dashboard');
        } else {
            renderView(res, 'customer_login', { title: 'Customer Login', error: 'Invalid username or password', user: null, admin: null });
        }
    });
});

app.get('/customer/register', (req, res) => {
    renderView(res, 'customer_register', { title: 'Customer Registration', user: null, admin: null });
});

app.post('/customer/register', async (req, res) => {
    const { fullname, email, mobile, username, password, confirm_password } = req.body;
    if (password !== confirm_password) {
        return renderView(res, 'customer_register', { title: 'Customer Registration', error: 'Passwords do not match', user: null, admin: null });
    }
    try {
        const hashed = await bcrypt.hash(password, 10);
        db.run(`INSERT INTO users (fullname, email, mobile, username, password) VALUES (?, ?, ?, ?, ?)`,
            [fullname, email, mobile, username, hashed], function(err) {
                if (err) {
                    return renderView(res, 'customer_register', { title: 'Customer Registration', error: 'Username or email already exists', user: null, admin: null });
                }
                req.session.user = { id: this.lastID, fullname, email, username };
                res.redirect('/customer/dashboard');
            });
    } catch (e) {
        renderView(res, 'customer_register', { title: 'Customer Registration', error: 'Registration error occurred', user: null, admin: null });
    }
});

app.get('/customer/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
});

// Customer Dashboard
app.get('/customer/dashboard', (req, res) => {
    if (!req.session.user) return res.redirect('/customer/login');
    const userId = req.session.user.id;

    db.all(`SELECT * FROM applications WHERE user_id = ? ORDER BY id DESC`, [userId], (err, apps) => {
        db.all(`SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 5`, [userId], (err2, notifs) => {
            renderView(res, 'customer_dashboard', {
                title: 'Customer Dashboard',
                user: req.session.user,
                admin: null,
                applications: apps || [],
                notifications: notifs || []
            });
        });
    });
});

// Service Application Form
app.get('/customer/apply/:service', (req, res) => {
    if (!req.session.user) return res.redirect('/customer/login');
    const serviceCode = req.params.service;
    if (!['tin', 'sss', 'pagibig'].includes(serviceCode)) return res.redirect('/customer/dashboard');

    const serviceTitles = { tin: 'BIR / TIN', sss: 'SSS', pagibig: 'Pag-IBIG' };
    renderView(res, 'application_form', {
        title: `${serviceTitles[serviceCode]} Application`,
        user: req.session.user,
        admin: null,
        serviceCode,
        serviceTitle: serviceTitles[serviceCode]
    });
});

app.post('/customer/apply/:service', upload.fields([
    { name: 'valid_id_file', maxCount: 1 },
    { name: 'photo_holding_id', maxCount: 1 },
    { name: 'id_picture', maxCount: 1 },
    { name: 'marriage_cert', maxCount: 1 }
]), (req, res) => {
    if (!req.session.user) return res.redirect('/customer/login');
    const serviceCode = req.params.service;
    const userId = req.session.user.id;
    const data = req.body;

    const trackingNumber = `${serviceCode.toUpperCase()}-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Math.floor(1000 + Math.random() * 9000)}`;
    const serviceTitles = { tin: 'BIR / TIN', sss: 'SSS', pagibig: 'Pag-IBIG' };

    db.run(`INSERT INTO applications (user_id, service, tracking_number, status, payment_status, amount_due) VALUES (?, ?, ?, 'Submitted', 'Unpaid', 500)`,
        [userId, serviceTitles[serviceCode], trackingNumber], function(err) {
            if (err) return res.redirect('/customer/dashboard');
            const appId = this.lastID;

            // Save Applicant Info
            db.run(`INSERT INTO applicant_information (application_id, first_name, middle_name, last_name, suffix, dob, pob, sex, civil_status, nationality, citizenship, mobile, email, house_no, street, barangay, city, province, zip_code, employment_status, occupation, employer_name, employer_address, business_name, business_address, source_of_income) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [appId, data.first_name, data.middle_name, data.last_name, data.suffix, data.dob, data.pob, data.sex, data.civil_status, data.nationality, data.nationality, data.mobile, data.email, data.house_no, data.street, data.barangay, data.city, data.province, data.zip_code, data.employment_status || '', data.occupation || '', data.employer_name || '', data.employer_address || '', data.business_name || '', data.business_address || '', data.source_of_income || '']);

            // Save Parents Info if SSS or Pag-IBIG
            if (data.mother_first) {
                db.run(`INSERT INTO parent_information (application_id, mother_first, mother_middle, mother_maiden, mother_dob, father_first, father_middle, father_last, father_dob) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [appId, data.mother_first, data.mother_middle, data.mother_maiden, data.mother_dob, data.father_first, data.father_middle, data.father_last, data.father_dob]);
            }

            // Save Spouse Info if Married
            if (data.civil_status === 'Married') {
                const marriageCert = req.files['marriage_cert'] ? req.files['marriage_cert'][0].filename : '';
                db.run(`INSERT INTO spouse_information (application_id, spouse_first, spouse_middle, spouse_last, spouse_dob, spouse_address, marriage_cert) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [appId, data.spouse_first, data.spouse_middle, data.spouse_last, data.spouse_dob, data.spouse_address, marriageCert]);
            }

            // Save Beneficiaries (Multiple)
            if (data.ben_fullname) {
                const names = Array.isArray(data.ben_fullname) ? data.ben_fullname : [data.ben_fullname];
                const rels = Array.isArray(data.ben_relationship) ? data.ben_relationship : [data.ben_relationship];
                const dobs = Array.isArray(data.ben_dob) ? data.ben_dob : [data.ben_dob];
                const sexes = Array.isArray(data.ben_sex) ? data.ben_sex : [data.ben_sex];
                const addrs = Array.isArray(data.ben_address) ? data.ben_address : [data.ben_address];
                const contacts = Array.isArray(data.ben_contact) ? data.ben_contact : [data.ben_contact];

                for (let i = 0; i < names.length; i++) {
                    if (names[i]) {
                        db.run(`INSERT INTO beneficiaries (application_id, fullname, relationship, dob, sex, address, contact) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                            [appId, names[i], rels[i], dobs[i], sexes[i], addrs[i], contacts[i]]);
                    }
                }
            }

            // Save Documents
            if (req.files['valid_id_file']) {
                db.run(`INSERT INTO documents (application_id, doc_type, file_path, original_name) VALUES (?, 'Valid ID', ?, ?)`,
                    [appId, req.files['valid_id_file'][0].filename, req.files['valid_id_file'][0].originalname]);
            }
            if (req.files['photo_holding_id']) {
                db.run(`INSERT INTO documents (application_id, doc_type, file_path, original_name) VALUES (?, 'Photo Holding ID', ?, ?)`,
                    [appId, req.files['photo_holding_id'][0].filename, req.files['photo_holding_id'][0].originalname]);
            }
            if (req.files['id_picture']) {
                db.run(`INSERT INTO documents (application_id, doc_type, file_path, original_name) VALUES (?, 'ID Picture', ?, ?)`,
                    [appId, req.files['id_picture'][0].filename, req.files['id_picture'][0].originalname]);
            }

            // Initial History & Notification
            updateAppStatus(appId, userId, 'Submitted', 'Application successfully submitted.');
            res.redirect(`/customer/payment/${appId}`);
        });
});

// Payment Route
app.get('/customer/payment/:id', (req, res) => {
    if (!req.session.user) return res.redirect('/customer/login');
    const appId = req.params.id;

    db.get(`SELECT * FROM applications WHERE id = ? AND user_id = ?`, [appId, req.session.user.id], (err, app) => {
        if (!app) return res.redirect('/customer/dashboard');
        renderView(res, 'payment', {
            title: 'Application Payment',
            user: req.session.user,
            admin: null,
            app,
            amount: app.amount_due || 500
        });
    });
});

app.post('/customer/payment/:id', upload.single('payment_proof'), (req, res) => {
    if (!req.session.user) return res.redirect('/customer/login');
    const appId = req.params.id;
    const { payment_method, reference_number } = req.body;
    const proof = req.file ? req.file.filename : '';

    db.run(`UPDATE applications SET payment_method = ?, reference_number = ?, payment_proof = ?, payment_status = 'Pending Verification', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`,
        [payment_method, reference_number, proof, appId, req.session.user.id], () => {
            updateAppStatus(appId, req.session.user.id, 'Payment Verification', 'Payment proof submitted for verification.');
            res.redirect('/customer/dashboard');
        });
});

// Customer Application View & History
app.get('/customer/application/:id', (req, res) => {
    if (!req.session.user) return res.redirect('/customer/login');
    const appId = req.params.id;

    db.get(`SELECT * FROM applications WHERE id = ? AND user_id = ?`, [appId, req.session.user.id], (err, app) => {
        if (!app) return res.redirect('/customer/dashboard');
        db.all(`SELECT * FROM status_history WHERE application_id = ? ORDER BY id DESC`, [appId], (err2, history) => {
            db.all(`SELECT * FROM completed_files WHERE application_id = ? ORDER BY id DESC`, [appId], (err3, completedFiles) => {
                renderView(res, 'customer_application_view', {
                    title: 'Application Details',
                    user: req.session.user,
                    admin: null,
                    app,
                    history: history || [],
                    completedFiles: completedFiles || []
                });
            });
        });
    });
});

// Public Tracking Page
app.get('/track', (req, res) => {
    const trackingNumber = req.query.tracking_number;
    if (!trackingNumber) {
        return renderView(res, 'track', { title: 'Track Application', user: req.session.user || null, admin: req.session.admin || null, searched: false });
    }

    db.get(`SELECT * FROM applications WHERE tracking_number = ?`, [trackingNumber], (err, app) => {
        let maskedName = '';
        if (app) {
            db.get(`SELECT first_name, last_name FROM applicant_information WHERE application_id = ?`, [app.id], (err2, info) => {
                if (info) {
                    maskedName = `${info.first_name[0]}*** ${info.last_name[0]}***`;
                }
                renderView(res, 'track', {
                    title: 'Track Application',
                    user: req.session.user || null,
                    admin: req.session.admin || null,
                    searched: true,
                    searchCode: trackingNumber,
                    app,
                    maskedName
                });
            });
        } else {
            renderView(res, 'track', {
                title: 'Track Application',
                user: req.session.user || null,
                admin: req.session.admin || null,
                searched: true,
                searchCode: trackingNumber,
                app: null
            });
        }
    });
});

// ==========================================
// ADMIN ROUTES
// ==========================================
app.get('/admin/login', (req, res) => {
    renderView(res, 'admin_login', { title: 'Admin Login', user: null, admin: null });
});

app.post('/admin/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM admin_users WHERE username = ?`, [username], async (err, admin) => {
        if (admin && await bcrypt.compare(password, admin.password)) {
            req.session.admin = admin;
            res.redirect('/admin/dashboard');
        } else {
            renderView(res, 'admin_login', { title: 'Admin Login', error: 'Invalid admin credentials', user: null, admin: null });
        }
    });
});

app.get('/admin/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/admin/login');
    });
});

app.get('/admin/dashboard', (req, res) => {
    if (!req.session.admin) return res.redirect('/admin/login');

    db.get(`SELECT COUNT(*) as count FROM applications`, [], (err, row1) => {
        db.get(`SELECT COUNT(*) as count FROM users`, [], (err2, row2) => {
            db.get(`SELECT COUNT(*) as count FROM applications WHERE payment_status = 'Pending Verification'`, [], (err3, row3) => {
                db.get(`SELECT COUNT(*) as count FROM applications WHERE status = 'Completed'`, [], (err4, row4) => {
                    db.all(`SELECT a.*, u.fullname FROM applications a JOIN users u ON a.user_id = u.id ORDER BY a.id DESC LIMIT 10`, [], (err5, apps) => {
                        renderView(res, 'admin_dashboard', {
                            title: 'Admin Dashboard',
                            user: null,
                            admin: req.session.admin,
                            stats: {
                                totalApplications: row1 ? row1.count : 0,
                                totalCustomers: row2 ? row2.count : 0,
                                pendingApps: row3 ? row3.count : 0,
                                completedApps: row4 ? row4.count : 0
                            },
                            applications: apps || []
                        });
                    });
                });
            });
        });
    });
});

app.get('/admin/applications', (req, res) => {
    if (!req.session.admin) return res.redirect('/admin/login');
    const search = req.query.search || '';

    const query = search ? 
        `SELECT a.*, u.fullname FROM applications a JOIN users u ON a.user_id = u.id WHERE a.tracking_number LIKE ? OR u.fullname LIKE ? ORDER BY a.id DESC` :
        `SELECT a.*, u.fullname FROM applications a JOIN users u ON a.user_id = u.id ORDER BY a.id DESC`;
    
    const params = search ? [`%${search}%`, `%${search}%`] : [];

    db.all(query, params, (err, apps) => {
        renderView(res, 'admin_applications', {
            title: 'Manage Applications',
            user: null,
            admin: req.session.admin,
            applications: apps || [],
            search
        });
    });
});

app.get('/admin/application/:id', (req, res) => {
    if (!req.session.admin) return res.redirect('/admin/login');
    const appId = req.params.id;

    db.get(`SELECT a.*, u.fullname as customer_name, u.email FROM applications a JOIN users u ON a.user_id = u.id WHERE a.id = ?`, [appId], (err, app) => {
        if (!app) return res.redirect('/admin/applications');
        db.get(`SELECT * FROM applicant_information WHERE application_id = ?`, [appId], (err2, info) => {
            db.get(`SELECT * FROM parent_information WHERE application_id = ?`, [appId], (err3, parent) => {
                db.get(`SELECT * FROM spouse_information WHERE application_id = ?`, [appId], (err4, spouse) => {
                    db.all(`SELECT * FROM beneficiaries WHERE application_id = ?`, [appId], (err5, beneficiaries) => {
                        db.all(`SELECT * FROM documents WHERE application_id = ?`, [appId], (err6, documents) => {
                            db.all(`SELECT * FROM completed_files WHERE application_id = ?`, [appId], (err7, completedFiles) => {
                                renderView(res, 'admin_application_detail', {
                                    title: `Review - ${app.tracking_number}`,
                                    user: null,
                                    admin: req.session.admin,
                                    app,
                                    info: info || {},
                                    parent: parent || {},
                                    spouse: spouse || {},
                                    beneficiaries: beneficiaries || [],
                                    documents: documents || [],
                                    completedFiles: completedFiles || []
                                });
                            });
                        });
                    });
                });
            });
        });
    });
});

app.get('/admin/application/:id/print', (req, res) => {
    if (!req.session.admin) return res.redirect('/admin/login');
    const appId = req.params.id;

    db.get(`SELECT * FROM applications WHERE id = ?`, [appId], (err, app) => {
        db.get(`SELECT * FROM applicant_information WHERE application_id = ?`, [appId], (err2, info) => {
            db.get(`SELECT * FROM parent_information WHERE application_id = ?`, [appId], (err3, parent) => {
                db.get(`SELECT * FROM spouse_information WHERE application_id = ?`, [appId], (err4, spouse) => {
                    db.all(`SELECT * FROM beneficiaries WHERE application_id = ?`, [appId], (err5, beneficiaries) => {
                        res.render('admin_print', {
                            app,
                            info: info || {},
                            parent: parent || {},
                            spouse: spouse || {},
                            beneficiaries: beneficiaries || []
                        });
                    });
                });
            });
        });
    });
});

app.post('/admin/application/:id/payment', (req, res) => {
    if (!req.session.admin) return res.redirect('/admin/login');
    const appId = req.params.id;
    const { payment_status } = req.body;

    db.get(`SELECT user_id FROM applications WHERE id = ?`, [appId], (err, app) => {
        db.run(`UPDATE applications SET payment_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [payment_status, appId], () => {
            if (app) {
                updateAppStatus(appId, app.user_id, 'Payment Verified', `Payment status updated to: ${payment_status}`);
            }
            res.redirect(`/admin/application/${appId}`);
        });
    });
});

app.post('/admin/application/:id/status', (req, res) => {
    if (!req.session.admin) return res.redirect('/admin/login');
    const appId = req.params.id;
    const { status, remarks } = req.body;

    db.get(`SELECT user_id FROM applications WHERE id = ?`, [appId], (err, app) => {
        db.run(`UPDATE applications SET rejection_reason = ? WHERE id = ?`, [remarks, appId], () => {
            if (app) {
                updateAppStatus(appId, app.user_id, status, remarks);
            }
            res.redirect(`/admin/application/${appId}`);
        });
    });
});

app.post('/admin/application/:id/completed-file', upload.single('completed_file'), (req, res) => {
    if (!req.session.admin) return res.redirect('/admin/login');
    const appId = req.params.id;
    const { title } = req.body;
    const filePath = req.file ? req.file.filename : '';
    const origName = req.file ? req.file.originalname : '';

    db.get(`SELECT user_id FROM applications WHERE id = ?`, [appId], (err, app) => {
        db.run(`INSERT INTO completed_files (application_id, title, file_path, original_name) VALUES (?, ?, ?, ?)`,
            [appId, title, filePath, origName], () => {
                if (app) {
                    db.run(`INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)`,
                        [app.user_id, 'Completed Document Uploaded', `Admin uploaded a completed document: ${title}`]);
                }
                res.redirect(`/admin/application/${appId}`);
            });
    });
});

app.get('/admin/settings', (req, res) => {
    if (!req.session.admin) return res.redirect('/admin/login');
    renderView(res, 'admin_settings', { title: 'Admin Settings', user: null, admin: req.session.admin, success: null });
});

app.post('/admin/settings', upload.single('gcash_qr'), (req, res) => {
    if (!req.session.admin) return res.redirect('/admin/login');
    const { payment_instructions, application_instructions } = req.body;

    db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('payment_instructions', ?)`, [payment_instructions]);
    db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('application_instructions', ?)`, [application_instructions]);

    if (req.file) {
        db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('gcash_qr', ?)`, [req.file.filename]);
    }

    renderView(res, 'admin_settings', { title: 'Admin Settings', user: null, admin: req.session.admin, success: 'Settings updated successfully!' });
});

// Start Server
app.listen(PORT, () => {
    console.log(`GovAssist PH system is running on port ${PORT}`);
});
