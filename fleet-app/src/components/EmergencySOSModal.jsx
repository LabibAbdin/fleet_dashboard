import { useState } from 'react'

function EmergencySOSModal({ criticalTrucks, onClose }) {
  const [checked, setChecked] = useState({})
  const steps = [
    { id: 'dispatch',   text: 'Contact dispatch center — Radio Ch.7 or +966-11-DISPATCH' },
    { id: 'location',   text: 'Confirm truck GPS coordinates transmitted to control room' },
    { id: 'emergency',  text: 'Call emergency services if injuries or hazards present (911)' },
    { id: 'welfare',    text: 'Verify driver welfare and physical condition' },
    { id: 'secure',     text: 'Secure vehicle — hazard lights on, place emergency triangles' },
    { id: 'document',   text: 'Document incident: timestamp, location, photos, witness details' },
  ]
  const doneCount = steps.filter(s => checked[s.id]).length
  const allDone = doneCount === steps.length
  return (
    <div className="modal-overlay sos-overlay" onClick={onClose}>
      <div className="sos-modal" onClick={e => e.stopPropagation()}>
        <div className="sos-header">
          <div className="sos-alarm-row">
            <div className="sos-icon-pulse">🚨</div>
            <div className="sos-title-block">
              <div className="sos-title">EMERGENCY PROTOCOL ACTIVE</div>
              <div className="sos-subtitle">Activated {new Date().toLocaleTimeString('en-SA', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
            </div>
            <button className="modal-close" onClick={onClose} style={{ marginLeft: 'auto' }}>✕</button>
          </div>
          {criticalTrucks.length > 0 && (
            <div className="sos-trucks">
              <div className="sos-trucks-label">VEHICLES REQUIRING ATTENTION</div>
              {criticalTrucks.map(t => (
                <div key={t.id} className="sos-truck-row">
                  <span className="sos-t-plate">{t.licensePlate}</span>
                  <span className="sos-t-driver">{t.driver?.name || '–'}</span>
                  <span className="sos-t-loc">📍 {t.location.lat.toFixed(4)}°N {t.location.lng.toFixed(4)}°E</span>
                  {t.driver?.phone && <a href={`tel:${t.driver.phone}`} className="sos-call">📞 Call</a>}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="sos-checklist">
          <div className="sos-cl-header">
            <span>EMERGENCY RESPONSE CHECKLIST</span>
            <span className="sos-progress">{doneCount} / {steps.length} COMPLETE</span>
          </div>
          {steps.map((s, i) => (
            <div key={s.id} className={`sos-step ${checked[s.id] ? 'done' : ''}`}
              onClick={() => setChecked(p => ({ ...p, [s.id]: !p[s.id] }))}>
              <span className="sos-step-num">{checked[s.id] ? '✓' : i + 1}</span>
              <span className="sos-step-text">{s.text}</span>
            </div>
          ))}
        </div>
        <div className="sos-footer">
          <div className="sos-emergency-contacts">
            <a href="tel:911" className="sos-ec red">🚑 Emergency 911</a>
            <a href="tel:993" className="sos-ec amber">🚔 Traffic Police 993</a>
            <a href="tel:998" className="sos-ec blue">🚒 Fire Department 998</a>
          </div>
          {allDone
            ? <button className="sos-resolve" onClick={onClose}>✓ Protocol Complete — Close Emergency</button>
            : <div className="sos-note">Check off each step to resolve the emergency protocol</div>
          }
        </div>
      </div>
    </div>
  )
}

export default EmergencySOSModal
