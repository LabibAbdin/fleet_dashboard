import { useState } from 'react'
import Drawer from './Drawer.jsx'

// ── Fuel / Speed / Weight monitoring hub ──────────────────────────────────────

function Spark({ data, color, width = 90, height = 26 }) {
  if (!data || data.length < 2) return <span className="mon-nospark">—</span>
  const min = Math.min(...data), max = Math.max(...data)
  const range = max - min || 1
  const pts = data.map((v, i) =>
    `${(i / (data.length - 1)) * width},${height - 2 - ((v - min) / range) * (height - 4)}`
  ).join(' ')
  return (
    <svg width={width} height={height} className="mon-spark" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

const METRICS = [
  { key: 'speed',  label: '⚡ Speed',  unit: 'km/h' },
  { key: 'fuel',   label: '⛽ Fuel',   unit: '%' },
  { key: 'weight', label: '⚖️ Weight', unit: 'kg' },
  { key: 'temp',   label: '🌡 Temp',   unit: '°F' },
]

export default function MonitoringDrawer({ trucks, truckHistory, ST, FT, TT, maxWeightKg, onSelect, onClose }) {
  const [metric, setMetric] = useState('speed')
  const [asc, setAsc] = useState(false)

  const val = (t) =>
    metric === 'speed' ? t.speed :
    metric === 'fuel' ? t.fuel :
    metric === 'weight' ? (t.weight ?? -1) :
    t.temperature

  const isWarn = (t) =>
    metric === 'speed' ? t.speed > ST :
    metric === 'fuel' ? t.fuel < FT :
    metric === 'weight' ? (t.weight ?? 0) > maxWeightKg :
    t.temperature > TT

  const sorted = [...trucks].sort((a, b) => (asc ? val(a) - val(b) : val(b) - val(a)))
  const m = METRICS.find(x => x.key === metric)
  const warnCount = trucks.filter(isWarn).length

  const histKey = metric === 'weight' ? null : metric === 'temp' ? 'temp' : metric
  const barMax =
    metric === 'speed' ? Math.max(ST * 1.3, 130) :
    metric === 'fuel' ? 100 :
    metric === 'weight' ? maxWeightKg * 1.25 :
    Math.max(TT * 1.15, 250)

  const summary = {
    speed:  `${trucks.filter(t => t.speed > ST).length} over the ${ST} km/h limit`,
    fuel:   `${trucks.filter(t => t.fuel < FT).length} below ${FT}% reserve`,
    weight: `${trucks.filter(t => (t.weight ?? 0) > maxWeightKg).length} over ${(maxWeightKg / 1000).toFixed(0)}t GVW limit`,
    temp:   `${trucks.filter(t => t.temperature > TT).length} above ${TT}°F`,
  }

  return (
    <Drawer title="Fleet Monitoring" icon="📡" badge={warnCount} onClose={onClose} wide>
      <div className="mon-tabs" role="tablist">
        {METRICS.map(x => (
          <button key={x.key} role="tab" aria-selected={metric === x.key}
            className={`mon-tab${metric === x.key ? ' active' : ''}`}
            onClick={() => setMetric(x.key)}>
            {x.label}
          </button>
        ))}
        <button className="mon-sort" onClick={() => setAsc(a => !a)} title="Flip sort order">
          {asc ? '↑ low first' : '↓ high first'}
        </button>
      </div>
      <div className="mon-summary">{summary[metric]}</div>
      <div className="mon-list">
        {sorted.map(t => {
          const v = val(t)
          const warn = isWarn(t)
          const noData = metric === 'weight' && t.weight == null
          const color = warn ? 'var(--red)' : metric === 'fuel' && t.fuel < FT * 2 ? 'var(--amber)' : 'var(--green)'
          const hist = histKey ? (truckHistory[t.id] || []).map(h => h[histKey]) : null
          return (
            <button key={t.id} className={`mon-row${warn ? ' warn' : ''}`} onClick={() => { onSelect(t); onClose() }}>
              <span className="mon-plate">{t.licensePlate}{t._ext && <span className="mon-ext">EXT</span>}</span>
              {hist ? <Spark data={hist.slice(-40)} color={warn ? '#ef4444' : '#6366f1'} /> : <span className="mon-nospark">static</span>}
              <span className="mon-bar-track">
                <span className="mon-bar-fill" style={{ width: `${Math.min(100, Math.max(0, (v / barMax) * 100))}%`, background: color }} />
              </span>
              <span className="mon-val" style={{ color: warn ? 'var(--red)' : 'var(--text)' }}>
                {noData ? 'n/a' : `${metric === 'weight' ? Math.round(v).toLocaleString() : v.toFixed(0)} ${m.unit}`}
              </span>
            </button>
          )
        })}
        {sorted.length === 0 && <div className="mon-empty">No trucks reporting yet.</div>}
      </div>
    </Drawer>
  )
}
