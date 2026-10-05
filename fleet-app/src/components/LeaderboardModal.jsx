function ScoreRing({ score }) {
  const r = 16, circ = 2 * Math.PI * r
  const fill = (Math.max(0, score) / 100) * circ
  const color = score >= 80 ? '#22c55e' : score >= 55 ? '#f59e0b' : '#ef4444'
  return (
    <svg width={40} height={40} viewBox="0 0 40 40">
      <circle cx={20} cy={20} r={r} fill="none" stroke="rgba(148,163,184,.1)" strokeWidth="3.5" />
      <circle cx={20} cy={20} r={r} fill="none" stroke={color} strokeWidth="3.5"
        strokeDasharray={`${fill} ${circ - fill}`} strokeLinecap="round" transform="rotate(-90 20 20)"
        style={{ filter: `drop-shadow(0 0 5px ${color})` }} />
      <text x={20} y={24} textAnchor="middle" fill={color} fontSize="9" fontWeight="900" fontFamily="Inter">{score}</text>
    </svg>
  )
}

function LeaderboardModal({ data, onClose }) {
  const medals = ['🥇', '🥈', '🥉', '4th', '5th']
  const medalColors = ['#ffd700', '#c0c0c0', '#cd7f32', 'var(--text-dim)', 'var(--text-dim)']
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">🏆 Driver Safety Leaderboard</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="lb-table">
          <div className="lb-head">
            <div className="lb-c rank">Rank</div>
            <div className="lb-c driver">Driver</div>
            <div className="lb-c score">Score</div>
            <div className="lb-c num">Speeding</div>
            <div className="lb-c num">Hard Brake</div>
            <div className="lb-c num">Fuel</div>
            <div className="lb-c num">Eng. Hrs</div>
            <div className="lb-c status">Status</div>
          </div>
          {data.map((t, i) => (
            <div key={t.id} className={`lb-row ${i < 3 ? `top-${i + 1}` : ''}`}>
              <div className="lb-c rank" style={{ color: medalColors[i], fontWeight: 900, fontSize: i < 3 ? 18 : 13 }}>{medals[i]}</div>
              <div className="lb-c driver">
                <span className="lb-photo">
                  {t.driver?.photo
                    ? <img src={t.driver.photo} alt={t.driver.name} onError={e => { e.target.style.display='none'; e.target.nextSibling.style.display='flex' }} />
                    : null}
                  <span className="driver-photo-fallback" style={{ display: 'none' }}>{t.driver?.name?.[0]}</span>
                </span>
                <div>
                  <div className="lb-name">{t.driver?.name}</div>
                  <div className="lb-plate">{t.licensePlate}</div>
                </div>
              </div>
              <div className="lb-c score"><ScoreRing score={t.safetyScore} /></div>
              <div className="lb-c num" style={{ color: t.safety?.speeding > 3 ? 'var(--red)' : 'inherit' }}>{t.safety?.speeding ?? 0}</div>
              <div className="lb-c num" style={{ color: t.safety?.harshBraking > 5 ? 'var(--amber)' : 'inherit' }}>{t.safety?.harshBraking ?? 0}</div>
              <div className="lb-c num" style={{ color: t.fuel < 20 ? 'var(--red)' : t.fuel < 40 ? 'var(--amber)' : 'var(--green)' }}>{Math.round(t.fuel)}%</div>
              <div className="lb-c num" style={{ color: (t.engineHours || 0) > 3500 ? 'var(--amber)' : 'inherit' }}>{(t.engineHours || 0).toLocaleString()}</div>
              <div className="lb-c status">
                <span className={`status-badge ${t.speed > 70 ? 'red' : t.status === 'active' ? 'green' : 'gray'}`}>
                  {t.speed > 70 ? 'Speeding' : t.status === 'active' ? 'Active' : 'Idle'}
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="modal-footer">
          <span className="kb-hint">Press <kbd>L</kbd> to toggle · <kbd>Esc</kbd> to close</span>
          <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>Ranked by real-time safety score</span>
        </div>
      </div>
    </div>
  )
}

export default LeaderboardModal
