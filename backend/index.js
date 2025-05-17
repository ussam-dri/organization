const express = require('express');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const bodyParser = require('body-parser');
const cors = require('cors');
const multer = require('multer'); // For handling file uploads
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = 'your_jwt_secret_key'; // Replace with a secure key in production

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/'); // Ensure this directory exists
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|pdf/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error('File type not supported. Use PDF, JPG, or PNG.'));
  }
});

// MySQL connection pool
const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'oragniz',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Middleware to verify JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ message: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ message: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Signup route for participants (unchanged)
app.post('/signup-participant', async (req, res) => {
  const { fullName, email, password, phone, birthDate, acceptsTerms } = req.body;

  // Basic validation
  if (!fullName || !email || !password || !phone || !birthDate || !acceptsTerms) {
    return res.status(400).json({ message: 'All fields are required' });
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ message: 'Invalid email format' });
  }
  if (password.length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters' });
  }
  if (!phone.match(/^[0-9]{10}$/)) {
    return res.status(400).json({ message: 'Phone number must be 10 digits' });
  }
  const birth = new Date(birthDate);
  const age = new Date().getFullYear() - birth.getFullYear();
  if (age < 18) {
    return res.status(400).json({ message: 'You must be at least 18 years old' });
  }

  try {
    // Check if user already exists
    const [existingUsers] = await pool.query('SELECT * FROM participants WHERE email = ?', [email]);
    if (existingUsers.length > 0) {
      return res.status(409).json({ message: 'Email already registered' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user
    await pool.query(
      'INSERT INTO participants (full_name, email, password, phone, birth_date, accepts_terms) VALUES (?, ?, ?, ?, ?, ?)',
      [fullName, email, hashedPassword, phone, birthDate, acceptsTerms]
    );

    // Simulate sending verification email
    console.log(`Verification email sent to ${email}`);

    res.status(201).json({ message: 'Registration successful. Please check your email for verification.' });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Signup route for organizers
app.post('/signup-organizer', upload.single('idDocument'), async (req, res) => {
  const { fullName, email, password, phone, idNumber, portfolioLink, acceptsContract } = req.body;
  const idDocument = req.file ? req.file.path : null;

  // Validation
  if (!fullName || !email || !password || !phone || !idNumber || !idDocument || !acceptsContract) {
    return res.status(400).json({ message: 'All required fields must be provided' });
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ message: 'Invalid email format' });
  }
  if (password.length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters' });
  }
  if (!phone.match(/^[0-9]{10}$/)) {
    return res.status(400).json({ message: 'Phone number must be 10 digits' });
  }
 
  if (acceptsContract !== 'true') {
    return res.status(400).json({ message: 'You must accept the contract' });
  }

  try {
    // Check if organizer already exists
    const [existingOrganizers] = await pool.query('SELECT * FROM organizers WHERE email = ?', [email]);
    if (existingOrganizers.length > 0) {
      return res.status(409).json({ message: 'Email already registered' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert organizer
    await pool.query(
      'INSERT INTO organizers (full_name, email, password, phone, id_number, id_document_path, portfolio_link, accepts_contract, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [fullName, email, hashedPassword, phone, idNumber, idDocument, portfolioLink || null, true, 'pending']
    );

    // Simulate sending email for admin moderation
    console.log(`Organizer registration submitted for ${email}. Awaiting admin approval.`);

    res.status(201).json({ message: 'Registration submitted successfully. You will be notified after admin verification.' });
  } catch (error) {
    console.error('Organizer signup error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Login route for participants (unchanged)
app.post('/login-participant', async (req, res) => {
  const { email, password } = req.body;

  try {
    const [rows] = await pool.query('SELECT * FROM participants WHERE email = ?', [email]);

    if (rows.length === 0) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user.id, email: user.email, type: 'participant' }, JWT_SECRET, {
      expiresIn: '9h'
    });

    res.json({ token, id: user.id, email: user.email, type: 'participant' });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Login route for organizers (updated to check status)
app.post('/login-organizer', async (req, res) => {
  const { email, password } = req.body;

  try {
    const [rows] = await pool.query('SELECT * FROM organizers WHERE email = ?', [email]);

    if (rows.length === 0) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const user = rows[0];
    if (user.status !== 'approved') {
      return res.status(403).json({ message: 'Account pending approval or suspended' });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user.id, email: user.email, type: 'organizer' }, JWT_SECRET, {
      expiresIn: '1h'
    });

    res.json({ token, id: user.id, email: user.email, type: 'organizer' });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Login route for admins (unchanged)
app.post('/login-admin', async (req, res) => {
  const { email, password } = req.body;

  try {
    const [rows] = await pool.query('SELECT * FROM admins WHERE email = ?', [email]);

    if (rows.length === 0) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const user = rows[0];
    const isMatch = password=== user.password;

    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user.id, email: user.email, type: 'admin' }, JWT_SECRET, {
      expiresIn: '6h'
    });

    res.json({ token, type: 'admin' });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Example protected route (unchanged)
app.get('/protected', authenticateToken, (req, res) => {
  res.json({ message: 'This is a protected route', user: req.user });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});