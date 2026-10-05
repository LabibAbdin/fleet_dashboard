function HelpModal({ onClose }) {
  const shortcuts = [
    { key: '1 – 5', desc: 'Select truck by number' },
    { key: 'B', desc: 'Open Fleet Command Brief' },
    { key: 'D', desc: 'Open dispatch board' },
    { key: 'F', desc: 'Toggle fullscreen ops map' },
    { key: 'P', desc: 'Export PDF fleet report' },
    { key: 'E', desc: 'Export fleet data as CSV' },
    { key: 'L', desc: 'Toggle driver leaderboard' },
    { key: 'O', desc: 'AI route optimization engine' },
    { key: 'M', desc: 'Predictive maintenance intelligence' },
    { key: 'V', desc: 'Fleet financial intelligence (P&L)' },
    { key: 'G', desc: 'Open CO₂ emissions dashboard' },
    { key: 'X', desc: 'Activate emergency SOS protocol' },
    { key: 'H', desc: 'Open alert history log' },
    { key: 'S', desc: 'Toggle sound alerts on / off' },
    { key: '⌘K  /', desc: 'Open command palette' },
    { key: ',', desc: 'Open alert threshold settings' },
    { key: 'Esc', desc: 'Close any open panel' },
  ]
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="help-panel" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">⌨️ Keyboard Shortcuts</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="help-list">
          {shortcuts.map(s => (
            <div key={s.key} className="help-row">
              <kbd className="kbd">{s.key}</kbd>
              <span>{s.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default HelpModal
