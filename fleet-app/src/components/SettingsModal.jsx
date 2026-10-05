import { useState } from 'react'

const DEFAULT_SETTINGS = { speedThreshold: 70, fuelThreshold: 20, tempThreshold: 110 }

function SettingsModal({ settings, onChange, onClose }) {
  const [local, setLocal] = useState({ ...DEFAULT_SETTINGS, ...settings })
  const upd = (key, val) => setLocal(prev => ({ ...prev, [key]: val }))
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">⚙️ Alert Thresholds</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="settings-body">
          <div className="setting-row">
            <div className="setting-meta">
              <div className="setting-label">Speed Alert</div>
              <div className="setting-desc">Fire alert when truck exceeds this speed</div>
            </div>
            <div className="setting-control">
              <input type="range" min={50} max={120} step={5} value={local.speedThreshold}
                onChange={e => upd('speedThreshold', +e.target.value)} className="setting-slider" />
              <span className="setting-val" style={{ color: 'var(--red)' }}>{local.speedThreshold} mph</span>
            </div>
          </div>
          <div className="setting-row">
            <div className="setting-meta">
              <div className="setting-label">Low Fuel Alert</div>
              <div className="setting-desc">Fire alert when fuel drops below this level</div>
            </div>
            <div className="setting-control">
              <input type="range" min={5} max={50} step={5} value={local.fuelThreshold}
                onChange={e => upd('fuelThreshold', +e.target.value)} className="setting-slider" />
              <span className="setting-val" style={{ color: 'var(--amber)' }}>{local.fuelThreshold}%</span>
            </div>
          </div>
          <div className="setting-row">
            <div className="setting-meta">
              <div className="setting-label">Engine Temp Alert</div>
              <div className="setting-desc">Fire alert when engine temp exceeds this value</div>
            </div>
            <div className="setting-control">
              <input type="range" min={90} max={150} step={5} value={local.tempThreshold}
                onChange={e => upd('tempThreshold', +e.target.value)} className="setting-slider" />
              <span className="setting-val" style={{ color: 'var(--amber)' }}>{local.tempThreshold}°F</span>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="settings-reset" onClick={() => setLocal({ ...DEFAULT_SETTINGS })}>Reset Defaults</button>
          <button className="settings-save" onClick={() => { onChange(local); onClose() }}>Save &amp; Apply</button>
        </div>
      </div>
    </div>
  )
}

export default SettingsModal
