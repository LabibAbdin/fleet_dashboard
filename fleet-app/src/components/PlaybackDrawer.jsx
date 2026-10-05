import Drawer from './Drawer.jsx'

// ── Trip playback: scrub any truck's recorded timeline; the map marker follows ─

function AreaChart({ data, cursor, color, height = 54, fmt = v => v.toFixed(0) }) {
  if (!data || data.length < 2) return <div className="pb-nochart">collecting data…</div>
  const w = 100
  const min = Math.min(...data), max = Math.max(...data)
  const range = max - min || 1
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${height - 3 - ((v - min) / range) * (height - 8)}`)
  const cursorX = cursor != null ? (cursor / (data.length - 1)) * w : null
  return (
    <div className="pb-chart-wrap">
      <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="pb-chart">
        <polygon points={`0,${height} ${pts.join(' ')} ${w},${height}`} fill={color} opacity="0.12" />
        <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
        {cursorX != null && <line x1={cursorX} y1="0" x2={cursorX} y2={height} stroke="var(--text-dim)" strokeWidth="1" vectorEffect="non-scaling-stroke" strokeDasharray="3,2" />}
      </svg>
      {cursor != null && data[cursor] != null && <span className="pb-chart-val" style={{ color }}>{fmt(data[cursor])}</span>}
    </div>
  )
}

const SPEEDS = [0.5, 1, 2, 4]

export default function PlaybackDrawer({
  trucks, selected, onSelectTruck, timeline,
  replayIdx, setReplayIdx, replayPlaying, setReplayPlaying,
  replaySpeed, setReplaySpeed, onClose,
}) {
  const tl = timeline || []
  const idx = replayIdx ?? (tl.length ? tl.length - 1 : 0)
  const snap = tl[idx]
  const fmtT = ms => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const durationMin = tl.length > 1 ? Math.max(1, Math.round((tl[tl.length - 1].time - tl[0].time) / 60000)) : 0

  return (
    <Drawer title="Trip Playback" icon="🎬" onClose={onClose}>
      <div className="pb-truck-row">
        {trucks.slice(0, 24).map(t => (
          <button key={t.id}
            className={`pb-truck-chip${selected?.id === t.id ? ' active' : ''}`}
            onClick={() => onSelectTruck(t)}>
            {t.licensePlate}
          </button>
        ))}
      </div>

      {tl.length < 2 ? (
        <div className="pb-empty">📡 Recording {selected ? selected.licensePlate : 'truck'} — playback available after a few position updates.</div>
      ) : (
        <>
          <div className="pb-meta">
            <span>{tl.length} snapshots</span>
            <span>·</span>
            <span>{durationMin} min recorded</span>
            <span>·</span>
            <span>{fmtT(tl[0].time)} → {fmtT(tl[tl.length - 1].time)}</span>
          </div>

          <input type="range" className="pb-scrubber" min={0} max={tl.length - 1} value={idx}
            onChange={e => { setReplayPlaying(false); setReplayIdx(Number(e.target.value)) }}
            aria-label="Playback position" />

          <div className="pb-controls">
            <button className="pb-btn" onClick={() => { setReplayIdx(0); setReplayPlaying(false) }} title="Jump to start">⏮</button>
            <button className="pb-btn" onClick={() => { setReplayPlaying(false); setReplayIdx(Math.max(0, idx - 1)) }} title="Step back">◂</button>
            <button className={`pb-btn pb-play${replayPlaying ? ' active' : ''}`}
              onClick={() => {
                if (replayIdx === null || replayIdx >= tl.length - 1) setReplayIdx(0)
                setReplayPlaying(p => !p)
              }}>
              {replayPlaying ? '⏸' : '▶'}
            </button>
            <button className="pb-btn" onClick={() => { setReplayPlaying(false); setReplayIdx(Math.min(tl.length - 1, idx + 1)) }} title="Step forward">▸</button>
            <button className="pb-btn pb-live" onClick={() => { setReplayIdx(null); setReplayPlaying(false) }} title="Return to live tracking">⏹ LIVE</button>
            <div className="pb-speeds">
              {SPEEDS.map(s => (
                <button key={s} className={`pb-speed${replaySpeed === s ? ' active' : ''}`} onClick={() => setReplaySpeed(s)}>{s}×</button>
              ))}
            </div>
          </div>

          {snap && (
            <div className="pb-snapbar">
              <span className="pb-snap-time">🕐 {fmtT(snap.time)}</span>
              <span style={{ color: '#6366f1' }}>⚡ {snap.speed.toFixed(0)} km/h</span>
              <span style={{ color: 'var(--amber)' }}>⛽ {snap.fuel.toFixed(0)}%</span>
              <span style={{ color: 'var(--red)' }}>🌡 {snap.temp.toFixed(0)}°F</span>
            </div>
          )}

          <div className="pb-chart-block">
            <div className="pb-chart-label">Speed (km/h)</div>
            <AreaChart data={tl.map(s => s.speed)} cursor={idx} color="#6366f1" />
          </div>
          <div className="pb-chart-block">
            <div className="pb-chart-label">Fuel (%)</div>
            <AreaChart data={tl.map(s => s.fuel)} cursor={idx} color="#f59e0b" />
          </div>
          <div className="pb-chart-block">
            <div className="pb-chart-label">Engine temp (°F)</div>
            <AreaChart data={tl.map(s => s.temp)} cursor={idx} color="#ef4444" />
          </div>
          <div className="pb-hint">Scrub the timeline — the purple ▶ REPLAY marker on the map follows the truck's recorded position.</div>
        </>
      )}
    </Drawer>
  )
}
