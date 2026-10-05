function EmissionsModal({ co2Stats, trucks, ST, speedingCount, idleCount, onClose }) {
  const envScore = Math.max(10, Math.min(100,
    100 - speedingCount * 15 - idleCount * 8
    - trucks.filter(t => (t.activeDTCs?.length || 0) > 0).length * 5
  ))
  const envColor = envScore >= 70 ? '#22c55e' : envScore >= 45 ? '#f59e0b' : '#ef4444'
  const envLabel = envScore >= 80 ? 'Excellent' : envScore >= 60 ? 'Good' : envScore >= 40 ? 'Fair' : 'Needs Improvement'
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="emissions-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">🌿 Fleet Emissions &amp; Environmental Impact</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="em-kpis">
          <div className="em-kpi">
            <div className="em-kv" style={{ color: '#22c55e' }}>{co2Stats.co2Kg} kg</div>
            <div className="em-kl">CO₂ This Session</div>
          </div>
          <div className="em-kpi">
            <div className="em-kv" style={{ color: '#f59e0b' }}>{co2Stats.totalLiters} L</div>
            <div className="em-kl">Total Fuel Burned</div>
          </div>
          <div className="em-kpi">
            <div className="em-kv" style={{ color: '#ef4444' }}>{co2Stats.projMonthlyKg.toLocaleString()} kg</div>
            <div className="em-kl">Projected Monthly CO₂</div>
          </div>
          <div className="em-kpi">
            <div className="em-kv" style={{ color: '#6366f1' }}>SAR {co2Stats.offsetCostSAR}</div>
            <div className="em-kl">Carbon Offset Cost</div>
          </div>
        </div>
        <div className="em-body">
          <div className="em-score-wrap">
            <div className="em-env-ring" style={{ borderColor: envColor, color: envColor }}>
              <div className="em-env-val">{envScore}</div>
              <div className="em-env-lbl">Env. Score</div>
            </div>
            <div className="em-env-detail">
              <div className="em-env-grade" style={{ color: envColor }}>{envLabel}</div>
              <div className="em-env-tip">
                {speedingCount > 0 && <div className="em-tip-row">⚡ {speedingCount} speeding truck{speedingCount > 1 ? 's' : ''} burning excess fuel</div>}
                {idleCount > 0 && <div className="em-tip-row">⏸ {idleCount} idle truck{idleCount > 1 ? 's' : ''} wasting fuel &amp; emitting CO₂</div>}
                {speedingCount === 0 && idleCount === 0 && <div className="em-tip-row" style={{ color: '#22c55e' }}>✓ No active speeding or idle waste detected</div>}
                <div className="em-tip-row muted">Diesel: 2.68 kg CO₂ per litre burned · Carbon offset: ~SAR 0.15/kg</div>
              </div>
            </div>
          </div>
          <div className="em-table">
            <div className="em-table-head">
              <span>Plate</span><span>Driver</span><span>Burn Rate</span><span>CO₂ Emitted</span>
            </div>
            {co2Stats.perTruck.map(t => (
              <div key={t.plate} className="em-table-row">
                <span className="em-plate">{t.plate}</span>
                <span className="em-t-name">{t.driver || '–'}</span>
                <span className="em-t-burn">{t.lph > 0 ? `${t.lph} L/hr` : <span style={{ color: 'var(--text-dim)' }}>Collecting…</span>}</span>
                <span className="em-t-co2" style={{ color: parseFloat(t.co2Kg) > 5 ? '#ef4444' : parseFloat(t.co2Kg) > 1 ? '#f59e0b' : '#22c55e' }}>
                  {parseFloat(t.co2Kg) > 0.01 ? `${t.co2Kg} kg` : <span style={{ color: 'var(--text-dim)' }}>—</span>}
                </span>
              </div>
            ))}
          </div>
          <div className="em-green-tips">
            <div className="em-tips-title">🌱 Green Fleet Action Plan</div>
            <div className="em-tips-body">
              <div>• Reduce idle time 30 min/truck/day → save ~{(0.5 * 3 * 2.68).toFixed(1)} kg CO₂ per truck</div>
              <div>• Keep speeds under {ST} mph → ~15% better fuel economy across the fleet</div>
              <div>• Regular maintenance schedule → up to 25% emissions reduction</div>
              <div>• AI-optimized routing can cut total distance by 10–20%</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default EmissionsModal
