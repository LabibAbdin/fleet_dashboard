import { useState, useRef, useEffect, useMemo } from 'react'

// ── Maintenance intervals ─────────────────────────────────────────────────────
const MI_OIL_KM  = 5_000
const MI_OIL_HRS = 250
const MI_TIRE_KM = 10_000
const MI_SVC_KM  = 20_000

function getMaintStatus(t) {
  const km  = t.odometer    || 0
  const hrs = t.engineHours || 0
  const oilKm  = MI_OIL_KM  - (km  % MI_OIL_KM)
  const oilHrs = MI_OIL_HRS - (hrs % MI_OIL_HRS)
  const tireKm = MI_TIRE_KM - (km  % MI_TIRE_KM)
  const svcKm  = MI_SVC_KM  - (km  % MI_SVC_KM)
  const urgent = oilKm <= 300 || oilHrs <= 15
  const warn   = !urgent && (oilKm <= 800 || oilHrs <= 40)
  return {
    oilKm:  Math.round(oilKm),
    oilHrs: Math.round(oilHrs),
    tireKm: Math.round(tireKm),
    svcKm:  Math.round(svcKm),
    urgent, warn,
  }
}

function CommandPalette({ trucks, ST, onSelect, onMessage, onClose }) {
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const [prevQ, setPrevQ] = useState(q)
  const inputRef = useRef(null)
  useEffect(() => { inputRef.current?.focus() }, [])

  const results = useMemo(() => {
    const ql = q.toLowerCase().trim()
    const list = ql
      ? trucks.filter(t => t.licensePlate.toLowerCase().includes(ql) || t.driver?.name?.toLowerCase().includes(ql))
      : trucks
    return list.slice(0, 9)
  }, [q, trucks])

  // Reset selection when the search query changes (adjusting state during
  // render, per https://react.dev/learn/you-might-not-need-an-effect)
  if (q !== prevQ) {
    setPrevQ(q)
    setIdx(0)
  }

  const commit = (t) => { onSelect(t); onClose() }

  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i + 1, results.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)) }
    if (e.key === 'Enter' && results[idx]) commit(results[idx])
    if (e.key === 'Escape') onClose()
  }

  const tickerColor = { active: 'var(--green)', idle: 'var(--text-dim)', speeding: 'var(--red)' }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="palette-box" onClick={e => e.stopPropagation()}>
        <div className="palette-search">
          <span className="palette-kbd">⌘K</span>
          <input ref={inputRef} className="palette-input"
            placeholder="Search trucks, plates, drivers…"
            value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey} />
          {q && <button className="palette-clear" onClick={() => setQ('')}>✕</button>}
        </div>
        <div className="palette-results">
          {results.length === 0
            ? <div className="palette-empty">No match for "{q}"</div>
            : results.map((t, i) => {
              const maint = getMaintStatus(t)
              const statusColor = t.speed > ST ? 'var(--red)' : tickerColor[t.status] || 'var(--text-dim)'
              return (
                <div key={t.id} className={`palette-item ${i === idx ? 'sel' : ''}`}
                  onMouseEnter={() => setIdx(i)} onClick={() => commit(t)}>
                  <div className="pi-left">
                    <span className="pi-plate">{t.licensePlate}</span>
                    <span className="pi-driver">{t.driver?.name || '–'}</span>
                  </div>
                  <div className="pi-meta">
                    <span style={{ color: statusColor, fontSize: 11, fontWeight: 600 }}>
                      {t.speed > ST ? `⚡ ${t.speed.toFixed(0)} mph` : t.status}
                    </span>
                    <span style={{ color: t.fuel < 20 ? 'var(--red)' : 'var(--text-dim)', fontSize: 11 }}>
                      ⛽ {t.fuel.toFixed(0)}%
                    </span>
                    {maint.urgent && <span className="pi-tag red">🔧 Service due</span>}
                    {(t.activeDTCs?.length > 0) && <span className="pi-tag red">⚠️ {t.activeDTCs.length} DTC</span>}
                  </div>
                  <button className="pi-msg" title="Message driver"
                    onClick={e => { e.stopPropagation(); onMessage(t); onClose() }}>📱</button>
                </div>
              )
            })
          }
        </div>
        <div className="palette-footer">
          <span>↑↓ navigate</span><span>↵ select</span><span>📱 message driver</span><span>Esc close</span>
        </div>
      </div>
    </div>
  )
}

export default CommandPalette
