import React, { useState } from 'react';
import axios from 'axios';

// =============================================================
// AI FLEET BRIEFING (Real AI — Google Gemini)
//
// HOW IT WORKS:
//   1. User clicks "Generate AI Briefing"
//   2. This sends the live truck data to YOUR backend
//   3. Your backend calls Google Gemini AI (key is safe on server)
//   4. Gemini writes a real natural-language fleet analysis
//   5. We display it here
//
//   The AI key never touches the browser. The frontend only
//   talks to YOUR backend, which talks to Gemini.
// =============================================================

const AIBriefing = ({ trucks = [], token, darkMode = false }) => {
  const [analysis, setAnalysis] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdate, setLastUpdate] = useState(null);

  const cardBg = darkMode ? '#2a2a2a' : '#ffffff';
  const textColor = darkMode ? '#f5f5f5' : '#1a1a1a';
  const subColor = darkMode ? '#9aa0a6' : '#5f6368';
  const borderColor = darkMode ? '#3c4043' : '#e0e0e0';

  const getAnalysis = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await axios.post(
        'http://localhost:5000/api/ai-analysis',
        { trucks },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setAnalysis(response.data.analysis);
      setLastUpdate(new Date());
    } catch (err) {
      console.error('AI error:', err);
      setError('Could not get AI analysis. Check the backend is running and GEMINI_API_KEY is set in .env');
    }
    setLoading(false);
  };

  return (
    <div style={{
      backgroundColor: cardBg,
      border: `1px solid ${borderColor}`,
      borderRadius: '12px',
      padding: '24px',
      marginTop: '20px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '22px' }}>🤖</span>
          <h2 style={{ margin: 0, color: textColor, fontSize: '20px', letterSpacing: '-0.3px' }}>
            AI Fleet Intelligence
          </h2>
          <span style={{
            fontSize: '10px', fontWeight: 700, padding: '3px 8px',
            borderRadius: '12px', backgroundColor: '#43a04720', color: '#43a047',
          }}>
            LIVE AI
          </span>
        </div>
        {lastUpdate && (
          <span style={{ fontSize: '11px', color: subColor }}>
            {lastUpdate.toLocaleTimeString()}
          </span>
        )}
      </div>

      <p style={{ margin: '0 0 16px 0', color: subColor, fontSize: '13px', lineHeight: 1.5 }}>
        Real-time analysis powered by Google Gemini AI. Reads your live fleet data and writes actionable recommendations.
      </p>

      <button
        onClick={getAnalysis}
        disabled={loading}
        style={{
          padding: '12px 24px',
          backgroundColor: loading ? '#9aa0a6' : '#6200ea',
          color: 'white',
          border: 'none',
          borderRadius: '8px',
          cursor: loading ? 'default' : 'pointer',
          fontSize: '14px',
          fontWeight: 700,
          transition: 'all 0.2s ease',
        }}
      >
        {loading ? '🔄 Analyzing fleet...' : '🤖 Generate AI Briefing'}
      </button>

      {error && (
        <div style={{
          marginTop: '16px', padding: '12px 16px', borderRadius: '8px',
          backgroundColor: '#e5393510', borderLeft: '3px solid #e53935',
          color: '#e53935', fontSize: '13px',
        }}>
          {error}
        </div>
      )}

      {analysis && (
        <div style={{
          marginTop: '18px',
          padding: '20px 22px',
          borderRadius: '10px',
          backgroundColor: darkMode ? '#1f1f1f' : '#fafafa',
          border: `1px solid ${borderColor}`,
          borderLeft: '4px solid #6200ea',
        }}>
          <div style={{
            color: textColor,
            fontSize: '14px',
            lineHeight: 1.8,
            whiteSpace: 'pre-wrap',
            letterSpacing: '0.1px',
          }}>
            {analysis}
          </div>
        </div>
      )}

      {!analysis && !loading && !error && (
        <p style={{ margin: '16px 0 0 0', color: subColor, fontSize: '12px', fontStyle: 'italic' }}>
          Click the button above to generate a live AI analysis of your fleet's current status.
        </p>
      )}
    </div>
  );
};

export default AIBriefing;
