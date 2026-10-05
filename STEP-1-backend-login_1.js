// ============================================
// STEP 1: LOGIN SYSTEM - BACKEND
// This teaches you: Express basics + JWT auth
// ============================================

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const app = express();

// Middleware (these run on every request)
app.use(express.json()); // Parse JSON from frontend
app.use(cors()); // Allow frontend to talk to backend

const JWT_SECRET = 'your-secret-key-123'; // Change this!

// ============================================
// STEP 1A: FAKE DATABASE (Replace later with MongoDB)
// ============================================

const users = new Map(); // Store users here temporarily

// Add a test user
const testUser = {
  id: 'user_1',
  username: 'driver1',
  password: bcrypt.hashSync('password123', 10), // Encrypted password
  email: 'driver@example.com'
};

users.set('driver1', testUser);

// ============================================
// STEP 1B: UNDERSTAND JWT (JSON Web Tokens)
// ============================================

/*
  JWT is like a ID card the server gives you:
  
  1. User logs in with username + password
  2. Server checks if correct
  3. Server creates a TOKEN (encrypted proof you're logged in)
  4. Frontend stores this token
  5. Frontend sends token with every request
  6. Server reads token to know who you are
  
  WHY? Because HTTP is STATELESS (server forgets you after each request)
  
  Token has 3 parts (separated by dots):
  header.payload.signature
  
  Example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyaWQiOiIxMjMifQ.TJVA95OrM7E2cBab30RMHrHDcEfxjoYZgeFONFh7HgQ
*/

// ============================================
// STEP 1C: LOGIN ROUTE
// ============================================

app.post('/api/auth/login', (req, res) => {
  // Get username and password from frontend
  const { username, password } = req.body;
  
  console.log(`Login attempt: ${username}`); // For debugging
  
  // Step 1: Check if user exists
  const user = users.get(username);
  
  if (!user) {
    return res.status(401).json({ 
      error: 'User not found' 
    });
  }
  
  // Step 2: Check if password is correct
  // bcrypt.compareSync compares plain text password with encrypted one
  const isPasswordCorrect = bcrypt.compareSync(password, user.password);
  
  if (!isPasswordCorrect) {
    return res.status(401).json({ 
      error: 'Wrong password' 
    });
  }
  
  // Step 3: Password is correct! Create JWT token
  const token = jwt.sign(
    { userId: user.id, username: user.username }, // What's IN the token
    JWT_SECRET, // Secret to sign it
    { expiresIn: '24h' } // Token expires in 24 hours
  );
  
  // Step 4: Send token to frontend
  res.json({ 
    success: true,
    token: token, // Frontend will store this
    userId: user.id,
    username: user.username,
    message: 'Login successful!'
  });
});

// ============================================
// STEP 1D: REGISTER ROUTE (New Users)
// ============================================

app.post('/api/auth/register', (req, res) => {
  const { username, password, email } = req.body;
  
  // Check if user already exists
  if (users.has(username)) {
    return res.status(400).json({ 
      error: 'Username already taken' 
    });
  }
  
  // Create new user
  const userId = 'user_' + Date.now(); // Generate unique ID
  
  const newUser = {
    id: userId,
    username: username,
    password: bcrypt.hashSync(password, 10), // Encrypt password
    email: email,
    createdAt: new Date()
  };
  
  users.set(username, newUser);
  
  // Create token for immediate login
  const token = jwt.sign(
    { userId: newUser.id, username: newUser.username },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
  
  res.json({ 
    success: true,
    token: token,
    userId: newUser.id,
    message: 'Account created and logged in!'
  });
});

// ============================================
// STEP 1E: PROTECTED ROUTE (Needs token)
// ============================================

// Middleware to check if user has valid token
const verifyToken = (req, res, next) => {
  // Token comes in header: "Authorization: Bearer token_here"
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(' ')[1]; // Extract token after "Bearer "
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  
  try {
    // Verify token is valid and not expired
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // Store user info in request
    next(); // Continue to next handler
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Example protected route
app.get('/api/me', verifyToken, (req, res) => {
  // This only runs if token is valid
  const user = users.get(req.user.username);
  
  res.json({ 
    id: user.id,
    username: user.username,
    email: user.email,
    message: `Hello ${user.username}!`
  });
});

// ============================================
// STEP 1F: TEST ROUTE
// ============================================

app.get('/api/test', (req, res) => {
  res.json({ 
    message: 'Backend is working! ✅',
    testCredentials: {
      username: 'driver1',
      password: 'password123'
    }
  });
});

// ============================================
// START SERVER
// ============================================

const PORT = 5000;
app.listen(PORT, () => {
  console.log(`
  ╔════════════════════════════════════════════╗
  ║  🚛 FLEET TRACKING - LOGIN SERVER         ║
  ║  http://localhost:${PORT}                    ║
  ║                                            ║
  ║  Test Route: http://localhost:${PORT}/api/test ║
  ║  Ready to connect to React frontend!      ║
  ╚════════════════════════════════════════════╝
  `);
});
