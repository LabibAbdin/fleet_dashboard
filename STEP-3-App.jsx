// ============================================
// STEP 3: APP STRUCTURE - MAIN COMPONENT
// File: frontend/src/App.jsx
// ============================================

import React, { useState, useEffect } from 'react';
import axios from 'axios';
import LoginPage from './pages/LoginPage';
import OnboardingPage from './pages/OnboardingPage';
import DashboardPage from './pages/DashboardPage';
import './App.css';

/*
  APP FLOW:
  
  1. User opens app → Check if token in localStorage
  2. If no token → Show LoginPage
  3. If token exists but no profile → Show OnboardingPage
  4. If token + profile → Show DashboardPage
*/

const App = () => {
  // ============================================
  // STATE MANAGEMENT
  // ============================================
  
  const [currentPage, setCurrentPage] = useState('loading'); // 'loading', 'login', 'onboarding', 'dashboard'
  const [user, setUser] = useState(null); // Current user info
  const [isLoading, setIsLoading] = useState(true);

  // ============================================
  // INITIALIZE APP (Run on page load)
  // ============================================
  
  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      // Check if token exists in localStorage
      const token = localStorage.getItem('token');
      const userId = localStorage.getItem('userId');
      const username = localStorage.getItem('username');

      if (!token) {
        // No token = not logged in
        setCurrentPage('login');
        setIsLoading(false);
        return;
      }

      // Token exists, verify it's valid
      const response = await axios.get('http://localhost:5000/api/me', {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      // Token is valid
      setUser({
        id: userId,
        username: username,
        email: response.data.email
      });

      // Check if user has completed onboarding
      const profileResponse = await axios.get(
        'http://localhost:5000/api/onboarding/profile',
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );

      if (profileResponse.data) {
        // User has profile → Go to dashboard
        setCurrentPage('dashboard');
      } else {
        // User logged in but no profile → Go to onboarding
        setCurrentPage('onboarding');
      }

    } catch (err) {
      console.log('Token invalid or expired');
      // Clear invalid token
      localStorage.removeItem('token');
      localStorage.removeItem('userId');
      localStorage.removeItem('username');
      setCurrentPage('login');
    } finally {
      setIsLoading(false);
    }
  };

  // ============================================
  // HANDLE LOGIN SUCCESS
  // ============================================
  
  const handleLoginSuccess = (userData) => {
    setUser(userData);
    setCurrentPage('onboarding');
  };

  // ============================================
  // HANDLE ONBOARDING COMPLETE
  // ============================================
  
  const handleOnboardingComplete = () => {
    setCurrentPage('dashboard');
  };

  // ============================================
  // HANDLE LOGOUT
  // ============================================
  
  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('userId');
    localStorage.removeItem('username');
    setUser(null);
    setCurrentPage('login');
  };

  // ============================================
  // RENDER BASED ON CURRENT PAGE
  // ============================================
  
  if (isLoading) {
    return (
      <div className="loading-screen">
        <div className="spinner"></div>
        <p>Loading Fleet Tracking System...</p>
      </div>
    );
  }

  switch (currentPage) {
    case 'login':
      return (
        <LoginPage onLoginSuccess={handleLoginSuccess} />
      );

    case 'onboarding':
      return (
        <OnboardingPage 
          user={user}
          onComplete={handleOnboardingComplete}
        />
      );

    case 'dashboard':
      return (
        <DashboardPage 
          user={user}
          onLogout={handleLogout}
        />
      );

    default:
      return <div>Unknown page</div>;
  }
};

export default App;

/*
============================================
KEY CONCEPTS:
============================================

1. useEffect - Run code when component loads
   useEffect(() => { ... }, []) - Runs once on load
   useEffect(() => { ... }, [dependency]) - Runs when dependency changes

2. Conditional Rendering - Show different UI based on state
   {currentPage === 'login' ? <LoginPage /> : <Dashboard />}
   OR
   if (currentPage === 'login') return <LoginPage />;

3. localStorage - Persist data across sessions
   localStorage.setItem('token', value);
   localStorage.getItem('token');

4. Props - Pass data to child components
   <LoginPage onLoginSuccess={handleLoginSuccess} />

5. State Lifting - Parent manages state for multiple children
   App.jsx manages which page to show

6. Async/Await with Axios - Make API calls
   const response = await axios.get(url, config);
*/
