// ============================================
// STEP 2: LOGIN PAGE - FRONTEND (React)
// This teaches you: useState, axios, localStorage
// ============================================

// File: frontend/src/pages/LoginPage.jsx

import React, { useState } from 'react';
import axios from 'axios';
import './LoginPage.css'; // We'll create this file

const LoginPage = ({ onLoginSuccess }) => {
  // ============================================
  // STATE MANAGEMENT (useState)
  // ============================================
  
  // Each useState returns [value, setter]
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [isLoginMode, setIsLoginMode] = useState(true); // Toggle login/register

  // ============================================
  // HANDLE LOGIN
  // ============================================
  
  const handleLogin = async (e) => {
    e.preventDefault(); // Prevent page refresh
    setError(''); // Clear previous errors
    setIsLoading(true);
    
    try {
      // Make request to backend
      const response = await axios.post(
        'http://localhost:5000/api/auth/login',
        {
          username: username,
          password: password
        }
      );
      
      // Extract token from response
      const { token, userId } = response.data;
      
      // IMPORTANT: Store token in localStorage
      // localStorage is browser storage that persists after page refresh
      localStorage.setItem('token', token);
      localStorage.setItem('userId', userId);
      localStorage.setItem('username', username);
      
      console.log('✅ Login successful! Token stored.');
      
      // Call parent function to move to next screen
      onLoginSuccess({ token, userId, username });
      
    } catch (err) {
      // Handle error
      const errorMsg = err.response?.data?.error || 'Login failed';
      setError(errorMsg);
      console.error('❌ Login error:', errorMsg);
    } finally {
      setIsLoading(false);
    }
  };

  // ============================================
  // HANDLE REGISTER
  // ============================================
  
  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    
    try {
      const response = await axios.post(
        'http://localhost:5000/api/auth/register',
        {
          username: username,
          password: password,
          email: `${username}@example.com`
        }
      );
      
      const { token, userId } = response.data;
      
      localStorage.setItem('token', token);
      localStorage.setItem('userId', userId);
      localStorage.setItem('username', username);
      
      console.log('✅ Registration successful!');
      onLoginSuccess({ token, userId, username });
      
    } catch (err) {
      const errorMsg = err.response?.data?.error || 'Registration failed';
      setError(errorMsg);
    } finally {
      setIsLoading(false);
    }
  };

  // ============================================
  // RENDER
  // ============================================
  
  return (
    <div className="login-container">
      {/* Header */}
      <div className="login-header">
        <h1>🚛 Fleet Tracking System</h1>
        <p>Monitor your trucks in real-time</p>
      </div>

      {/* Form */}
      <div className="login-box">
        <h2>{isLoginMode ? 'Login' : 'Create Account'}</h2>
        
        {/* Error Message */}
        {error && (
          <div className="error-message">
            ⚠️ {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={isLoginMode ? handleLogin : handleRegister}>
          {/* Username Input */}
          <div className="form-group">
            <label>Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
              disabled={isLoading}
              required
            />
          </div>

          {/* Password Input */}
          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              disabled={isLoading}
              required
            />
          </div>

          {/* Submit Button */}
          <button 
            type="submit" 
            disabled={isLoading}
            className="btn-submit"
          >
            {isLoading ? '⏳ Processing...' : (isLoginMode ? 'Login' : 'Register')}
          </button>
        </form>

        {/* Toggle Login/Register */}
        <div className="toggle-mode">
          <p>
            {isLoginMode ? "Don't have an account? " : "Already have an account? "}
            <button
              type="button"
              onClick={() => {
                setIsLoginMode(!isLoginMode);
                setError('');
                setUsername('');
                setPassword('');
              }}
              className="link-button"
            >
              {isLoginMode ? 'Register' : 'Login'}
            </button>
          </p>
        </div>

        {/* Test Credentials */}
        <div className="test-credentials">
          <p>🧪 <strong>Test Account:</strong></p>
          <p>Username: <code>driver1</code></p>
          <p>Password: <code>password123</code></p>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;

/*
============================================
KEY CONCEPTS YOU LEARNED:
============================================

1. useState - React's way to store data
   const [value, setValue] = useState(initialValue);
   
2. Controlled Inputs - Value comes from state
   <input value={username} onChange={(e) => setUsername(e.target.value)} />
   
3. Async/Await - Wait for server response
   const response = await axios.post(...)
   
4. Try/Catch - Handle errors
   try { ... } catch (err) { ... }
   
5. localStorage - Store data in browser
   localStorage.setItem('key', 'value');
   const value = localStorage.getItem('key');
   
6. Conditional Rendering - Show/hide based on state
   {isLoginMode ? 'Login' : 'Register'}

============================================
WHAT TO DO NEXT:
============================================

1. Copy this to: frontend/src/pages/LoginPage.jsx
2. Create the CSS file (next step)
3. Update App.js to use this component
4. Run backend: node STEP-1-backend-login.js
5. Run frontend: npm start
6. Test with username: driver1, password: password123
*/
