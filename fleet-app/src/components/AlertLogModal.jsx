function AlertLogModal({ log, onClear, onClose }) {
  const colorMap = { speed: 'var(--red)', fuel: 'var(--amber)', temp: 'var(--red)', geo: 'var(--accent)', snooze: 'var(--text-dim)', ack: 'var(--green)' }
  const iconMap  = { speed: '⚡', fuel: '⛽', temp: '🌡️', geo: '📍', snooze: '⏸', ack: '✓' }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="log-panel" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">📋 Session Alert Log</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{log.length} event{log.length !== 1 ? 's' : ''} this session</span>
            {log.length > 0 && <button className="log-clear-btn" onClick={onClear}>Clear all</button>}
            <button className="modal-close" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="log-body">
          {log.length === 0
            ? <div className="log-empty">✅ No alerts this session — fleet running clean.</div>
            : log.map(e => (
              <div key={e.id} className="log-entry">
                <span className="log-icon" style={{ color: colorMap[e.type] || 'var(--text-dim)' }}>
                  {iconMap[e.type] || '•'}
                </span>
                <div className="log-content">
                  <div className="log-msg">{e.msg}</div>
                  {e.plate && <div className="log-plate">{e.plate}</div>}
                </div>
                <div className="log-time">{e.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
              </div>
            ))
          }
        </div>
      </div>
    </div>
  )
}

export default AlertLogModal
