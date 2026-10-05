import { useState, useEffect } from 'react'

function BootScreen({ onDone }) {
  const lines = [
    'Initializing telemetry uplink…',
    'Acquiring GPS satellites [12/12]…',
    'Syncing fleet vehicles…',
    'Authenticating secure channel…',
    'Loading AI intelligence core…',
    'Calibrating geofence boundaries…',
    'Establishing real-time data stream…',
    'System ready.',
  ]
  const [step, setStep] = useState(0)
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (step >= lines.length) {
      const t = setTimeout(() => { setDone(true); setTimeout(onDone, 620) }, 360)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => setStep(s => s + 1), 230 + Math.random() * 160)
    return () => clearTimeout(t)
  }, [step]) // eslint-disable-line
  const pct = Math.round((step / lines.length) * 100)
  return (
    <div className={`boot-screen ${done ? 'boot-out' : ''}`}>
      <div className="boot-grid" />
      <div className="boot-core">
        <div className="boot-logo-ring">
          <div className="boot-logo">🚛</div>
          <svg className="boot-orbit" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="54" fill="none" stroke="rgba(99,102,241,.15)" strokeWidth="1.5" />
            <circle cx="60" cy="60" r="54" fill="none" stroke="#6366f1" strokeWidth="2.5"
              strokeDasharray="339.3" strokeDashoffset={339.3 - (pct / 100) * 339.3}
              strokeLinecap="round" transform="rotate(-90 60 60)"
              style={{ transition: 'stroke-dashoffset .3s ease', filter: 'drop-shadow(0 0 6px #6366f1)' }} />
          </svg>
        </div>
        <div className="boot-brand">Fleet<span>Pulse</span></div>
        <div className="boot-tag">AI FLEET INTELLIGENCE PLATFORM</div>
        <div className="boot-bar-track"><div className="boot-bar-fill" style={{ width: `${pct}%` }} /></div>
        <div className="boot-log">
          {lines.slice(0, step).map((l, i) => (
            <div key={i} className="boot-log-line">
              <span className="boot-check">✓</span> {l}
            </div>
          ))}
          {step < lines.length && (
            <div className="boot-log-line active">
              <span className="boot-spin">◌</span> {lines[step]}
            </div>
          )}
        </div>
        <div className="boot-pct">{pct}%</div>
      </div>
    </div>
  )
}

export default BootScreen
