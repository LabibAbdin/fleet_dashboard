function TrendChart({ speedData, fuelData, tempData }) {
  const W = 500, H = 110, PL = 34, PR = 34, PT = 14, PB = 18
  const CW = W - PL - PR, CH = H - PT - PB
  if (!speedData || speedData.length < 2) return <div className="chart-empty">Collecting data…</div>
  const n = speedData.length
  const line = (data, maxVal) => data.map((v, i) => {
    const x = PL + (i / (n - 1)) * CW
    const y = PT + (1 - Math.min(v, maxVal) / maxVal) * CH
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  const speedPts = line(speedData, 120)
  const fuelPts = fuelData ? line(fuelData, 100) : null
  const tempPts = tempData ? line(tempData, 130) : null
  const gridVals = [0, 25, 50, 75, 100]
  const lastOf = pts => pts.split(' ').pop()?.split(',') || []
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ display: 'block' }}>
      {gridVals.map(p => {
        const y = PT + (1 - p / 100) * CH
        return <line key={p} x1={PL} y1={y} x2={W - PR} y2={y} stroke="rgba(255,255,255,.05)" strokeWidth="1" />
      })}
      {[0, 60, 120].map(v => (
        <text key={v} x={PL - 4} y={PT + (1 - v / 120) * CH + 3} textAnchor="end" fill="rgba(99,102,241,.6)" fontSize="7" fontFamily="Inter">{v}</text>
      ))}
      {[0, 50, 100].map(v => (
        <text key={v} x={W - PR + 4} y={PT + (1 - v / 100) * CH + 3} textAnchor="start" fill="rgba(34,197,94,.6)" fontSize="7" fontFamily="Inter">{v}%</text>
      ))}
      {tempPts && <polyline points={tempPts} fill="none" stroke="#f59e0b" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" opacity=".55" strokeDasharray="3,2" />}
      {fuelPts && <polyline points={fuelPts} fill="none" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity=".75" />}
      <polyline points={speedPts} fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {(() => {
        const sp = lastOf(speedPts); const fp = fuelPts ? lastOf(fuelPts) : []
        return (<>
          {sp.length === 2 && <circle cx={sp[0]} cy={sp[1]} r="3.5" fill="#6366f1" style={{ filter: 'drop-shadow(0 0 4px #6366f1)' }} />}
          {fp.length === 2 && <circle cx={fp[0]} cy={fp[1]} r="3" fill="#22c55e" style={{ filter: 'drop-shadow(0 0 4px #22c55e)' }} />}
        </>)
      })()}
      <rect x={PL} y={2} width="7" height="7" fill="#6366f1" rx="1" />
      <text x={PL + 10} y={8} fill="rgba(148,163,184,.75)" fontSize="8" fontFamily="Inter">Speed (mph)</text>
      <rect x={PL + 78} y={2} width="7" height="7" fill="#22c55e" rx="1" />
      <text x={PL + 88} y={8} fill="rgba(148,163,184,.75)" fontSize="8" fontFamily="Inter">Fuel (%)</text>
      <rect x={PL + 148} y={2} width="7" height="7" fill="#f59e0b" rx="1" />
      <text x={PL + 158} y={8} fill="rgba(148,163,184,.75)" fontSize="8" fontFamily="Inter">Temp (°F)</text>
    </svg>
  )
}

export default TrendChart
