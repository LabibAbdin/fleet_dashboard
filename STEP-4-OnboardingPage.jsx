// ============================================
// STEP 4: ONBOARDING PAGE
// File: frontend/src/pages/OnboardingPage.jsx
// This teaches: Multi-step forms, conditional rendering, API calls
// ============================================

import React, { useState } from 'react';
import axios from 'axios';
import './OnboardingPage.css';

const OnboardingPage = ({ user, onComplete }) => {
  // ============================================
  // STATE MANAGEMENT
  // ============================================
  
  const [currentStep, setCurrentStep] = useState(0); // Which question
  const [formData, setFormData] = useState({
    age: '',
    experience: '',
    vehicleType: '',
    routes: '',
    speedLimit: 65,
    hardBrakeAlert: true,
    fuelAlertLevel: 20
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // ============================================
  // QUESTIONS FOR QUESTIONNAIRE
  // ============================================
  
  const questions = [
    {
      id: 0,
      title: "Welcome to Fleet Tracking! 👋",
      subtitle: "Let's set up your profile",
      type: "welcome",
      message: `Nice to meet you, ${user?.username}! We'll ask a few questions to customize your experience.`
    },
    {
      id: 1,
      title: "What's your age range?",
      type: "radio",
      field: "age",
      options: ["18-25", "25-35", "35-50", "50+"],
      emoji: "👤"
    },
    {
      id: 2,
      title: "Years of driving experience?",
      type: "number",
      field: "experience",
      min: 0,
      max: 60,
      emoji: "🚗",
      description: "Enter a number (0-60)"
    },
    {
      id: 3,
      title: "What vehicle will you drive?",
      type: "select",
      field: "vehicleType",
      options: ["Small Truck", "Medium Truck", "Large Truck", "Semi Truck"],
      emoji: "🚛"
    },
    {
      id: 4,
      title: "What's your typical route?",
      type: "text",
      field: "routes",
      placeholder: "e.g., Urban, Highway, Mixed",
      emoji: "🗺️"
    },
    {
      id: 5,
      title: "Speed limit preference (mph)",
      type: "slider",
      field: "speedLimit",
      min: 25,
      max: 80,
      emoji: "⚡",
      description: "Set alerts when you exceed this speed"
    },
    {
      id: 6,
      title: "Low fuel alert level?",
      type: "slider",
      field: "fuelAlertLevel",
      min: 5,
      max: 40,
      emoji: "⛽",
      description: "Alert when fuel drops below this %"
    },
    {
      id: 7,
      title: "Enable hard braking alerts?",
      type: "toggle",
      field: "hardBrakeAlert",
      emoji: "🛑",
      description: "Get notified when hard braking is detected"
    },
    {
      id: 8,
      title: "All set! 🎉",
      type: "summary",
      message: "Your profile is ready. Click 'Start Driving' to begin!"
    }
  ];

  const currentQuestion = questions[currentStep];

  // ============================================
  // HANDLE INPUT CHANGES
  // ============================================
  
  const handleInputChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  // ============================================
  // MOVE TO NEXT QUESTION
  // ============================================
  
  const handleNext = async () => {
    // Validate current step
    if (currentQuestion.type === "radio" && !formData[currentQuestion.field]) {
      setError("Please select an option");
      return;
    }
    if (currentQuestion.type === "number" && !formData[currentQuestion.field]) {
      setError("Please enter a number");
      return;
    }
    if (currentQuestion.type === "select" && !formData[currentQuestion.field]) {
      setError("Please select an option");
      return;
    }

    setError('');

    // If last question, submit form
    if (currentStep === questions.length - 1) {
      submitProfile();
    } else {
      setCurrentStep(prev => prev + 1);
    }
  };

  // ============================================
  // GO BACK TO PREVIOUS QUESTION
  // ============================================
  
  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  };

  // ============================================
  // SUBMIT PROFILE TO BACKEND
  // ============================================
  
  const submitProfile = async () => {
    setIsLoading(true);
    setError('');

    try {
      const token = localStorage.getItem('token');
      
      const response = await axios.post(
        'http://localhost:5000/api/onboarding/questionnaire',
        formData,
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );

      console.log('✅ Profile saved successfully!');
      
      // Call parent callback to move to dashboard
      onComplete();

    } catch (err) {
      const errorMsg = err.response?.data?.error || 'Failed to save profile';
      setError(errorMsg);
      console.error('❌ Error:', errorMsg);
    } finally {
      setIsLoading(false);
    }
  };

  // ============================================
  // RENDER DIFFERENT QUESTION TYPES
  // ============================================
  
  const renderQuestion = () => {
    const { type, field } = currentQuestion;

    switch (type) {
      case 'welcome':
        return (
          <div className="question-content welcome">
            <h2>{currentQuestion.title}</h2>
            <p>{currentQuestion.message}</p>
          </div>
        );

      case 'radio':
        return (
          <div className="question-content">
            <h2>{currentQuestion.emoji} {currentQuestion.title}</h2>
            <div className="options-group">
              {currentQuestion.options.map(option => (
                <label key={option} className="radio-label">
                  <input
                    type="radio"
                    name={field}
                    value={option}
                    checked={formData[field] === option}
                    onChange={(e) => handleInputChange(field, e.target.value)}
                  />
                  <span>{option}</span>
                </label>
              ))}
            </div>
          </div>
        );

      case 'select':
        return (
          <div className="question-content">
            <h2>{currentQuestion.emoji} {currentQuestion.title}</h2>
            <select
              value={formData[field]}
              onChange={(e) => handleInputChange(field, e.target.value)}
              className="select-input"
            >
              <option value="">Choose an option...</option>
              {currentQuestion.options.map(option => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        );

      case 'number':
        return (
          <div className="question-content">
            <h2>{currentQuestion.emoji} {currentQuestion.title}</h2>
            <p className="description">{currentQuestion.description}</p>
            <input
              type="number"
              value={formData[field]}
              onChange={(e) => handleInputChange(field, parseInt(e.target.value))}
              min={currentQuestion.min}
              max={currentQuestion.max}
              className="number-input"
              placeholder="Enter number..."
            />
          </div>
        );

      case 'text':
        return (
          <div className="question-content">
            <h2>{currentQuestion.emoji} {currentQuestion.title}</h2>
            <input
              type="text"
              value={formData[field]}
              onChange={(e) => handleInputChange(field, e.target.value)}
              className="text-input"
              placeholder={currentQuestion.placeholder}
            />
          </div>
        );

      case 'slider':
        return (
          <div className="question-content">
            <h2>{currentQuestion.emoji} {currentQuestion.title}</h2>
            <p className="description">{currentQuestion.description}</p>
            <input
              type="range"
              value={formData[field]}
              onChange={(e) => handleInputChange(field, parseInt(e.target.value))}
              min={currentQuestion.min}
              max={currentQuestion.max}
              className="slider-input"
            />
            <div className="slider-value">
              <span className="value">{formData[field]}</span>
              <span className="unit">
                {field === 'speedLimit' ? 'mph' : '%'}
              </span>
            </div>
          </div>
        );

      case 'toggle':
        return (
          <div className="question-content">
            <h2>{currentQuestion.emoji} {currentQuestion.title}</h2>
            <p className="description">{currentQuestion.description}</p>
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={formData[field]}
                onChange={(e) => handleInputChange(field, e.target.checked)}
              />
              <span className="toggle-switch"></span>
              <span className="toggle-text">
                {formData[field] ? 'Enabled' : 'Disabled'}
              </span>
            </label>
          </div>
        );

      case 'summary':
        return (
          <div className="question-content summary">
            <h2>{currentQuestion.title}</h2>
            <p>{currentQuestion.message}</p>
            <div className="summary-box">
              <p><strong>Age:</strong> {formData.age}</p>
              <p><strong>Experience:</strong> {formData.experience} years</p>
              <p><strong>Vehicle:</strong> {formData.vehicleType}</p>
              <p><strong>Speed Limit:</strong> {formData.speedLimit} mph</p>
              <p><strong>Low Fuel Alert:</strong> {formData.fuelAlertLevel}%</p>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  // ============================================
  // RENDER MAIN PAGE
  // ============================================
  
  return (
    <div className="onboarding-container">
      {/* Progress Bar */}
      <div className="progress-bar">
        <div
          className="progress-fill"
          style={{ width: `${((currentStep + 1) / questions.length) * 100}%` }}
        ></div>
      </div>

      {/* Onboarding Box */}
      <div className="onboarding-box">
        {/* Render Question */}
        {renderQuestion()}

        {/* Error Message */}
        {error && (
          <div className="error-message">
            ⚠️ {error}
          </div>
        )}

        {/* Navigation Buttons */}
        <div className="button-group">
          <button
            onClick={handlePrevious}
            disabled={currentStep === 0 || isLoading}
            className="btn-secondary"
          >
            ← Previous
          </button>

          <button
            onClick={handleNext}
            disabled={isLoading}
            className="btn-primary"
          >
            {isLoading ? '⏳ Saving...' : 
             currentStep === questions.length - 1 ? '🚀 Start Driving' : 
             'Next →'}
          </button>
        </div>

        {/* Step Counter */}
        <div className="step-counter">
          Step {currentStep + 1} of {questions.length}
        </div>
      </div>
    </div>
  );
};

export default OnboardingPage;

/*
============================================
KEY CONCEPTS LEARNED:
============================================

1. Multi-step Forms - Show one question at a time
   - currentStep tracks position
   - handleNext/handlePrevious navigate

2. Conditional Rendering - Show different UI based on question type
   - switch statement for different input types
   
3. Controlled Inputs - Form values stored in state
   - formData object holds all answers
   
4. Form Validation - Check before moving forward
   - handleNext validates current question
   
5. Progress Feedback - Show user where they are
   - Progress bar, step counter
   
6. Data Submission - Send form to backend
   - submitProfile() with axios

============================================
NEXT STEPS:
============================================

1. Create OnboardingPage.css for styling
2. Test with the backend
3. Add data validation
4. Add skip button for optional questions
5. Save progress (so users can continue later)
*/
