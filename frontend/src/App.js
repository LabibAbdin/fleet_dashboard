import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';
import Map from './components/map';
import FleetAdvisor from './components/FleetAdvisor';
import TruckHealthAnalyzer from './TruckHealthAnalyzer';
import CostCenter from './CostCentre';
import AIBriefing from './AIBriefing';

// =============================================================
// FLEET TRACKING SYSTEM — Clean, focused, actionable.
//
// Layout:
//   Header (fleet name + user + dark mode + logout)
//   Sidebar (truck list with live status indicators)
//   Main area:
//     1. Map (where the trucks are)
//     2. Quick stats bar (fleet health at a glance)
//     3. Fleet Advisor (instant issues + actions)
//     4. Truck Health Analyzer (trend detection + predictions)
//     5. Cost Center (money impact + ROI)
//     6. Selected truck detail card (telemetry for the clicked truck)
//
// No redundant charts. No clutter. Every panel is actionable.
// =============================================================

function App() {
  const [currentPage, setCurrentPage] = useState('landing');
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState(null);

  useEffect(() => {
    if (token) {
      checkAuth();
    } else {
      setLoading(false);
    }
  }, [token]);

  const checkAuth = async () => {
    try {
      const response = await axios.get('http://localhost:5000/api/me', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setUser(response.data);

      const profileResponse = await axios.get('http://localhost:5000/api/onboarding/profile', {
        headers: { Authorization: `Bearer ${token}` }
      });

      setCurrentPage(profileResponse.data ? 'dashboard' : 'onboarding');
    } catch (err) {
      localStorage.removeItem('token');
      setToken(null);
    }
    setLoading(false);
  };

  if (loading) {
    return <div style={{ padding: '50px', textAlign: 'center' }}>Loading...</div>;
  }

  if (!token && currentPage === 'landing') {
    return <LandingPage onStart={() => setCurrentPage('login')} />;
  }

  if (!token && currentPage === 'login') {
    return (
      <LoginPage
        onLogin={(t, u) => { setToken(t); setUser(u); localStorage.setItem('token', t); }}
        onBack={() => setCurrentPage('landing')}
      />
    );
  }

  if (token && currentPage === 'onboarding' && user) {
    return <OnboardingPage user={user} token={token} onComplete={() => setCurrentPage('dashboard')} />;
  }

  if (token && currentPage === 'dashboard' && user) {
    return (
      <Dashboard
        user={user}
        token={token}
        alert={alert}
        setAlert={setAlert}
        onLogout={() => {
          setToken(null); setUser(null);
          localStorage.removeItem('token');
          setCurrentPage('landing');
        }}
      />
    );
  }

  return <div style={{ padding: '50px', textAlign: 'center' }}>Loading...</div>;
}

// ======================== LANDING ========================

function LandingPage({ onStart }) {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{ textAlign: 'center', color: 'white', maxWidth: '600px', padding: '40px' }}>
        <h1 style={{ fontSize: '42px', fontWeight: 800, marginBottom: '12px', letterSpacing: '-1px' }}>
          🚛 Fleet Intelligence
        </h1>
        <p style={{ fontSize: '18px', opacity: 0.9, marginBottom: '40px', lineHeight: 1.6 }}>
          Real-time monitoring, AI-powered recommendations, and cost analysis — all in one place.
        </p>

        <div style={{ display: 'flex', gap: '20px', justifyContent: 'center', marginBottom: '40px', flexWrap: 'wrap' }}>
          {[
            { icon: '🔬', title: 'Trend Detection', desc: 'Spots problems before they happen' },
            { icon: '🧠', title: 'AI Advisor', desc: 'Actionable recommendations per truck' },
            { icon: '💰', title: 'Cost Engine', desc: 'Quantifies waste in SAR' },
          ].map((f, i) => (
            <div key={i} style={{
              background: 'rgba(255,255,255,0.15)', borderRadius: '12px',
              padding: '20px', flex: '1 1 150px', backdropFilter: 'blur(10px)',
            }}>
              <div style={{ fontSize: '28px', marginBottom: '8px' }}>{f.icon}</div>
              <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '4px' }}>{f.title}</div>
              <div style={{ fontSize: '12px', opacity: 0.8 }}>{f.desc}</div>
            </div>
          ))}
        </div>

        <button onClick={onStart} style={{
          padding: '14px 40px', fontSize: '16px', fontWeight: 700,
          background: 'white', color: '#6200ea', border: 'none',
          borderRadius: '8px', cursor: 'pointer', letterSpacing: '0.3px',
        }}>
          Get Started →
        </button>
      </div>
    </div>
  );
}

// ======================== LOGIN ========================

function LoginPage({ onLogin, onBack }) {
  const [username, setUsername] = useState('driver1');
  const [password, setPassword] = useState('password123');
  const [error, setError] = useState('');
  const [isLogin, setIsLogin] = useState(true);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const response = await axios.post(
        `http://localhost:5000/api/auth/${isLogin ? 'login' : 'register'}`,
        { username, password, email: `${username}@example.com` }
      );
      onLogin(response.data.token, { username: response.data.username });
    } catch (err) {
      setError(err.response?.data?.error || 'Error — is the backend running?');
    }
  };

  return (
    <div className="login-page" style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: 'white', borderRadius: '16px', padding: '40px',
        width: '100%', maxWidth: '400px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
      }}>
        <h2 style={{ margin: '0 0 24px 0', fontSize: '24px', textAlign: 'center' }}>
          {isLogin ? 'Login' : 'Register'}
        </h2>
        {error && (
          <div style={{
            padding: '10px 14px', borderRadius: '8px', marginBottom: '16px',
            background: '#fde8e8', color: '#c62828', fontSize: '13px',
            borderLeft: '3px solid #c62828',
          }}>{error}</div>
        )}
        <form onSubmit={handleSubmit}>
          <input
            type="text" value={username} onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
            style={{
              width: '100%', padding: '12px 14px', marginBottom: '12px',
              border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px',
              boxSizing: 'border-box',
            }}
          />
          <input
            type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            style={{
              width: '100%', padding: '12px 14px', marginBottom: '16px',
              border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px',
              boxSizing: 'border-box',
            }}
          />
          <button type="submit" style={{
            width: '100%', padding: '12px', fontSize: '15px', fontWeight: 700,
            background: 'linear-gradient(135deg, #667eea, #764ba2)', color: 'white',
            border: 'none', borderRadius: '8px', cursor: 'pointer',
          }}>
            {isLogin ? 'Login' : 'Register'}
          </button>
        </form>
        <p style={{ textAlign: 'center', marginTop: '16px', fontSize: '13px', color: '#666' }}>
          {isLogin ? "Don't have account? " : "Have account? "}
          <span onClick={() => setIsLogin(!isLogin)}
            style={{ color: '#6200ea', cursor: 'pointer', fontWeight: 600 }}>
            {isLogin ? 'Register' : 'Login'}
          </span>
        </p>
        <button onClick={onBack} style={{
          display: 'block', margin: '12px auto 0', background: 'none',
          border: 'none', color: '#999', cursor: 'pointer', fontSize: '13px',
        }}>← Back</button>
        <div style={{
          marginTop: '20px', padding: '10px 14px', borderRadius: '8px',
          background: '#f0f4ff', fontSize: '12px', color: '#555', textAlign: 'center',
        }}>
          <strong>Test:</strong> driver1 / password123
        </div>
      </div>
    </div>
  );
}

// ======================== ONBOARDING ========================

function OnboardingPage({ user, token, onComplete }) {
  const [step, setStep] = useState(0);
  const [data, setData] = useState({ age: '', experience: '', vehicleType: '', speedLimit: 65 });
  const [saving, setSaving] = useState(false);

  const handleNext = async () => {
    if (step < 3) {
      setStep(step + 1);
    } else {
      setSaving(true);
      try {
        await axios.post('http://localhost:5000/api/onboarding/questionnaire', data, {
          headers: { Authorization: `Bearer ${token}` }
        });
        onComplete();
      } catch (err) {
        alert('Error saving profile');
      }
      setSaving(false);
    }
  };

  const questions = [
    { title: 'Welcome! 👋', desc: `Nice to meet you, ${user?.username}!` },
    { title: 'Age Range?', type: 'select', options: ['18-25', '25-35', '35-50', '50+'], field: 'age' },
    { title: 'Years Driving?', type: 'number', field: 'experience' },
    { title: 'Vehicle Type?', type: 'select', options: ['Small Truck', 'Medium Truck', 'Large Truck'], field: 'vehicleType' },
  ];

  const q = questions[step];

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: 'white', borderRadius: '16px', padding: '40px',
        width: '100%', maxWidth: '450px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
      }}>
        <h2 style={{ margin: '0 0 12px 0' }}>{q.title}</h2>
        {q.desc && <p style={{ color: '#666', margin: '0 0 20px 0' }}>{q.desc}</p>}

        {q.type === 'select' && (
          <select value={data[q.field]} onChange={(e) => setData({ ...data, [q.field]: e.target.value })}
            style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '14px', marginBottom: '16px' }}>
            <option value="">Choose...</option>
            {q.options?.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        )}

        {q.type === 'number' && (
          <input type="number" value={data[q.field]}
            onChange={(e) => setData({ ...data, [q.field]: e.target.value })}
            style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '14px', marginBottom: '16px', boxSizing: 'border-box' }}
          />
        )}

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'space-between' }}>
          <button onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}
            style={{ padding: '10px 20px', borderRadius: '8px', border: '1px solid #ddd', background: 'white', cursor: 'pointer' }}>
            ← Back
          </button>
          <button onClick={handleNext} disabled={saving}
            style={{
              padding: '10px 20px', borderRadius: '8px', border: 'none',
              background: '#6200ea', color: 'white', fontWeight: 600, cursor: 'pointer',
            }}>
            {step === questions.length - 1 ? 'Finish ✓' : 'Next →'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ======================== DASHBOARD ========================

function Dashboard({ user, token, alert, setAlert, onLogout }) {
  const [trucks, setTrucks] = useState([]);
  const [selectedTruck, setSelectedTruck] = useState(null);
  const [telemetry, setTelemetry] = useState(null);
  const [loading, setLoading] = useState(true);
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    fetchTrucks();
    const interval = setInterval(fetchTrucks, 2000);
    return () => clearInterval(interval);
  }, []);

  const fetchTrucks = async () => {
    try {
      const response = await axios.get('http://localhost:5000/api/trucks', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setTrucks(response.data);
      if (!selectedTruck && response.data.length > 0) {
        selectTruck(response.data[0]);
      }
    } catch (err) {
      console.error('Error fetching trucks:', err);
    }
    setLoading(false);
  };

  const playAlertSound = () => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 800;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.5);
    } catch (err) { /* silent fail */ }
  };

  const selectTruck = async (truck) => {
    setSelectedTruck(truck);
    try {
      const response = await axios.get(`http://localhost:5000/api/truck-telemetry/${truck.id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setTelemetry(response.data);

      if (response.data?.truck?.speed > 70) {
        playAlertSound();
        setAlert({ type: 'SPEEDING', speed: response.data.truck.speed });
        setTimeout(() => setAlert(null), 5000);
      }
    } catch (err) {
      console.error('Error fetching telemetry:', err);
    }
  };

  // --- Theme ---
  const bg = darkMode ? '#111' : '#f4f5f7';
  const textColor = darkMode ? '#f5f5f5' : '#1a1a1a';
  const subColor = darkMode ? '#9aa0a6' : '#5f6368';
  const cardBg = darkMode ? '#1e1e1e' : '#ffffff';
  const borderColor = darkMode ? '#333' : '#e0e0e0';
  const sidebarBg = darkMode ? '#1a1a1a' : '#ffffff';

  // --- Quick fleet stats ---
  const activeTrucks = trucks.filter(t => t.status === 'active').length;
  const avgFuel = trucks.length > 0
    ? (trucks.reduce((s, t) => s + (t.fuel ?? 0), 0) / trucks.length).toFixed(0)
    : 0;
  const speedingTrucks = trucks.filter(t => (t.speed ?? 0) > 70).length;
  const overheatingTrucks = trucks.filter(t => (t.temperature ?? 0) > 110).length;

  return (
    <div style={{ backgroundColor: bg, color: textColor, minHeight: '100vh', transition: 'all 0.3s ease' }}>

      {/* Speeding alert banner */}
      {alert && (
        <div style={{
          background: '#e53935', color: 'white', padding: '14px 20px',
          textAlign: 'center', fontSize: '16px', fontWeight: 700,
          animation: 'pulse 1s infinite',
        }}>
          🚨 SPEEDING DETECTED — {alert.speed?.toFixed(0)} mph
        </div>
      )}

      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '16px 24px', borderBottom: `1px solid ${borderColor}`,
        backgroundColor: cardBg,
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 800, letterSpacing: '-0.5px', color: textColor }}>
            🚛 Fleet Intelligence
          </h1>
          <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: subColor }}>
            Real-time monitoring • AI recommendations • Cost analysis
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button onClick={() => setDarkMode(!darkMode)} style={{
            padding: '8px 14px', borderRadius: '6px', border: `1px solid ${borderColor}`,
            background: cardBg, color: textColor, cursor: 'pointer', fontSize: '13px',
          }}>
            {darkMode ? '☀️' : '🌙'}
          </button>
          <span style={{ fontSize: '13px', color: subColor }}>
            <strong style={{ color: textColor }}>{user?.username}</strong>
          </span>
          <button onClick={onLogout} style={{
            padding: '8px 14px', borderRadius: '6px', border: 'none',
            background: '#e53935', color: 'white', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
          }}>Logout</button>
        </div>
      </div>

      <div style={{ display: 'flex', minHeight: 'calc(100vh - 65px)' }}>

        {/* Sidebar — truck list */}
        <div style={{
          width: '240px', flexShrink: 0, backgroundColor: sidebarBg,
          borderRight: `1px solid ${borderColor}`, padding: '16px',
          overflowY: 'auto',
        }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: subColor, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '12px' }}>
            Fleet — {trucks.length} trucks
          </div>
          {trucks.map(truck => {
            const isSelected = selectedTruck?.id === truck.id;
            const isActive = truck.status === 'active';
            const isSpeeding = (truck.speed ?? 0) > 70;
            return (
              <div key={truck.id} onClick={() => selectTruck(truck)}
                style={{
                  padding: '12px', marginBottom: '6px', borderRadius: '8px', cursor: 'pointer',
                  backgroundColor: isSelected ? '#6200ea' : (darkMode ? '#252525' : '#f8f8f8'),
                  color: isSelected ? 'white' : textColor,
                  border: `1px solid ${isSelected ? '#6200ea' : 'transparent'}`,
                  transition: 'all 0.15s ease',
                }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{
                    width: '8px', height: '8px', borderRadius: '50%',
                    backgroundColor: isSpeeding ? '#e53935' : isActive ? '#43a047' : '#999',
                  }} />
                  <span style={{ fontWeight: 700, fontSize: '14px' }}>{truck.licensePlate}</span>
                </div>
                <div style={{
                  fontSize: '11px', marginTop: '4px', paddingLeft: '16px',
                  color: isSelected ? 'rgba(255,255,255,0.8)' : subColor,
                }}>
                  {(truck.speed ?? 0).toFixed(0)} mph • {(truck.fuel ?? 0).toFixed(0)}% fuel
                </div>
              </div>
            );
          })}
        </div>

        {/* Main content */}
        <div style={{ flex: 1, padding: '20px 24px', overflowY: 'auto' }}>

          {telemetry && selectedTruck ? (
            <>
              {/* Quick stats bar */}
              <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
                {[
                  { label: 'Active', value: `${activeTrucks}/${trucks.length}`, color: '#43a047' },
                  { label: 'Avg Fuel', value: `${avgFuel}%`, color: parseInt(avgFuel) < 30 ? '#e53935' : '#43a047' },
                  { label: 'Speeding', value: speedingTrucks, color: speedingTrucks > 0 ? '#e53935' : '#43a047' },
                  { label: 'Overheating', value: overheatingTrucks, color: overheatingTrucks > 0 ? '#e53935' : '#43a047' },
                ].map((s, i) => (
                  <div key={i} style={{
                    flex: '1 1 100px', padding: '14px 16px', borderRadius: '10px',
                    backgroundColor: cardBg, border: `1px solid ${borderColor}`,
                  }}>
                    <div style={{ fontSize: '24px', fontWeight: 800, color: s.color }}>{s.value}</div>
                    <div style={{ fontSize: '11px', color: subColor, marginTop: '2px' }}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Map */}
              <div style={{
                borderRadius: '12px', overflow: 'hidden',
                border: `1px solid ${borderColor}`, marginBottom: '4px',
              }}>
                <Map trucks={trucks} selectedTruck={selectedTruck} onSelectTruck={selectTruck} />
                <AIBriefing trucks={trucks} token={token} darkMode={darkMode} />
              </div>

              {/* Selected truck detail card */}
              <div style={{
                padding: '18px 20px', borderRadius: '12px', marginTop: '16px',
                backgroundColor: cardBg, border: `1px solid ${borderColor}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '16px', color: textColor }}>
                      {selectedTruck.licensePlate}
                    </h3>
                    <span style={{
                      fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '12px', marginTop: '4px', display: 'inline-block',
                      backgroundColor: selectedTruck.status === 'active' ? '#43a04720' : '#99999920',
                      color: selectedTruck.status === 'active' ? '#43a047' : '#999',
                    }}>
                      {selectedTruck.status}
                    </span>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '12px' }}>
                  {[
                    { icon: '🚗', label: 'Speed', value: `${telemetry?.truck?.speed?.toFixed(0) || 0}`, unit: 'mph', warn: (telemetry?.truck?.speed ?? 0) > 70 },
                    { icon: '⛽', label: 'Fuel', value: `${telemetry?.truck?.fuel?.toFixed(0) || 0}`, unit: '%', warn: (telemetry?.truck?.fuel ?? 100) < 20 },
                    { icon: '🌡️', label: 'Temp', value: `${telemetry?.truck?.temperature?.toFixed(0) || 0}`, unit: '°F', warn: (telemetry?.truck?.temperature ?? 0) > 110 },
                    { icon: '⚙️', label: 'RPM', value: `${((telemetry?.truck?.rpm || 0) / 1000).toFixed(1)}`, unit: 'K', warn: false },
                    { icon: '📍', label: 'Lat', value: `${telemetry?.truck?.location?.lat?.toFixed(4) || '—'}`, unit: '', warn: false },
                    { icon: '📍', label: 'Lng', value: `${telemetry?.truck?.location?.lng?.toFixed(4) || '—'}`, unit: '', warn: false },
                  ].map((item, i) => (
                    <div key={i} style={{
                      padding: '12px', borderRadius: '8px', textAlign: 'center',
                      backgroundColor: item.warn ? '#e5393510' : (darkMode ? '#252525' : '#f8f8f8'),
                      border: item.warn ? '1px solid #e5393540' : `1px solid transparent`,
                    }}>
                      <div style={{ fontSize: '12px', color: subColor, marginBottom: '4px' }}>{item.icon} {item.label}</div>
                      <div style={{
                        fontSize: '20px', fontWeight: 800,
                        color: item.warn ? '#e53935' : textColor,
                      }}>
                        {item.value}<span style={{ fontSize: '12px', fontWeight: 400, color: subColor }}> {item.unit}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Active alerts for this truck */}
                {telemetry?.events && telemetry.events.length > 0 && (
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '14px' }}>
                    {telemetry.events.map((event, i) => (
                      <span key={i} style={{
                        padding: '5px 12px', borderRadius: '20px', fontSize: '11px', fontWeight: 700,
                        backgroundColor: '#e5393520', color: '#e53935',
                      }}>
                        {event.type}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* AI Fleet Advisor */}
              <FleetAdvisor trucks={trucks} darkMode={darkMode} />

              {/* Truck Health & Trends Analyzer */}
              <TruckHealthAnalyzer trucks={trucks} darkMode={darkMode} />

              {/* Cost & Savings Command Center */}
              <CostCenter trucks={trucks} darkMode={darkMode} />

            </>
          ) : (
            <div style={{ padding: '60px 20px', textAlign: 'center', color: subColor }}>
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>🚛</div>
              <div style={{ fontSize: '16px' }}>Loading fleet data...</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;