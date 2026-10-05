import { useState } from 'react'

const MSG_TEMPLATES = [
  { id: 'speed',  label: '🚨 Slow Down',      text: 'Alert: You are exceeding the speed limit. Please reduce your speed immediately.' },
  { id: 'return', label: '🏠 Return to Base',  text: 'Please return to base as soon as possible. Contact dispatch for route details.' },
  { id: 'fuel',   label: '⛽ Refuel Now',      text: 'Your fuel is critically low. Proceed to the nearest fueling station immediately.' },
  { id: 'call',   label: '📞 Call Dispatch',   text: 'Please call dispatch immediately. This is urgent.' },
  { id: 'safety', label: '⚠️ Safety Check',    text: 'Please pull over safely and inspect your vehicle. Contact dispatch when complete.' },
]

function MessageModal({ truck, onClose }) {
  const [copied, setCopied] = useState(null)
  const sendSMS = (tpl) => {
    if (truck.driver?.phone) window.open(`sms:${truck.driver.phone}?body=${encodeURIComponent(tpl.text)}`)
  }
  const copy = (tpl) => {
    navigator.clipboard?.writeText(tpl.text).catch(() => {})
    setCopied(tpl.id)
    setTimeout(() => setCopied(null), 2000)
  }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="message-panel" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">💬 Message Driver</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        {truck.driver && (
          <div className="msg-driver-info">
            <span className="msg-driver-photo">
              <img src={truck.driver.photo} alt={truck.driver.name} onError={e => { e.target.style.display='none'; e.target.nextSibling.style.display='flex' }} />
              <span className="driver-photo-fallback" style={{ display: 'none' }}>{truck.driver.name[0]}</span>
            </span>
            <div>
              <div className="msg-driver-name">{truck.driver.name}</div>
              <div className="msg-driver-sub">{truck.licensePlate} · {truck.driver.phone || 'No phone on record'}</div>
            </div>
          </div>
        )}
        <div className="msg-templates">
          {MSG_TEMPLATES.map(tpl => (
            <div key={tpl.id} className="msg-tpl">
              <div className="msg-tpl-top">
                <span className="msg-tpl-label">{tpl.label}</span>
                <div className="msg-tpl-actions">
                  <button className="msg-copy-btn" onClick={() => copy(tpl)}>
                    {copied === tpl.id ? '✓ Copied' : '📋 Copy'}
                  </button>
                  {truck.driver?.phone && (
                    <button className="msg-sms-btn" onClick={() => sendSMS(tpl)}>📱 SMS</button>
                  )}
                </div>
              </div>
              <div className="msg-tpl-text">{tpl.text}</div>
            </div>
          ))}
        </div>
        {!truck.driver?.phone && (
          <div className="msg-no-phone">⚠️ No phone number on record for this driver. Use Copy to share via other channels.</div>
        )}
      </div>
    </div>
  )
}

export default MessageModal
