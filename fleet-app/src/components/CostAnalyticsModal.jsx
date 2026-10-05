import { useMemo } from 'react'

const TANK_LITRES = 400
const FUEL_PRICE_SAR = 2.18

function CostAnalyticsModal({ trucks, getFuelBurnRate, getIdleDuration, onClose }) {
  const rows = useMemo(() => trucks.map(t => {
    const litres = ((100 - t.fuel) / 100) * TANK_LITRES
    const fillSAR = litres * FUEL_PRICE_SAR
    const burn = getFuelBurnRate(t.id)
    const idleMins = getIdleDuration(t.id) || 0
    const idleSAR = (idleMins / 60) * 3 * FUEL_PRICE_SAR
    const eff = Math.max(0, 100 - (t.speed > 90 ? 25 : 0) - (idleMins > 15 ? 20 : 0) - (t.fuel < 20 ? 15 : 0))
    return { t, litres: litres.toFixed(0), fillSAR: fillSAR.toFixed(0), burn, idleMins, idleSAR: idleSAR.toFixed(2), eff }
  }).sort((a, b) => b.fillSAR - a.fillSAR), [trucks])

  const totalFill = rows.reduce((s, r) => s + +r.fillSAR, 0)
  const totalIdle = rows.reduce((s, r) => s + +r.idleSAR, 0)
  const avgEff = Math.round(rows.reduce((s, r) => s + r.eff, 0) / (rows.length || 1))

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="cost-panel" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">💰 Cost Analytics</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="cost-kpis">
          <div className="ck-item">
            <div className="ck-val">SAR {Math.round(totalFill).toLocaleString()}</div>
            <div className="ck-label">Total to fill fleet</div>
          </div>
          <div className="ck-item warn">
            <div className="ck-val">SAR {totalIdle.toFixed(2)}</div>
            <div className="ck-label">Idle waste this session</div>
          </div>
          <div className="ck-item">
            <div className="ck-val" style={{ color: avgEff >= 80 ? 'var(--green)' : avgEff >= 60 ? 'var(--amber)' : 'var(--red)' }}>{avgEff}</div>
            <div className="ck-label">Avg fleet efficiency</div>
          </div>
          <div className="ck-item">
            <div className="ck-val">{trucks.length}</div>
            <div className="ck-label">Trucks tracked</div>
          </div>
        </div>
        <div className="cost-table-wrap">
          <table className="cost-table">
            <thead>
              <tr>
                <th>Plate</th><th>Driver</th><th>Fuel</th><th>Fill Cost</th><th>Burn Rate</th><th>Idle Waste</th><th>Efficiency</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ t, litres, fillSAR, burn, idleMins, idleSAR, eff }) => (
                <tr key={t.id} className={+fillSAR > 500 ? 'ct-warn' : ''}>
                  <td className="ct-plate">{t.licensePlate}</td>
                  <td className="ct-driver">{t.driver?.name || '–'}</td>
                  <td>
                    <span style={{ color: t.fuel < 20 ? 'var(--red)' : t.fuel < 40 ? 'var(--amber)' : 'var(--green)', fontWeight: 700 }}>
                      {t.fuel.toFixed(0)}%
                    </span>
                    <span className="ct-sub">{litres}L</span>
                  </td>
                  <td style={{ fontWeight: 600, color: +fillSAR > 500 ? 'var(--amber)' : 'inherit' }}>SAR {fillSAR}</td>
                  <td className="ct-sub">{burn ? `${burn.lph} L/hr` : '—'}</td>
                  <td style={{ color: +idleSAR > 0 ? 'var(--amber)' : 'var(--text-dim)' }}>
                    {+idleSAR > 0 ? `SAR ${idleSAR}` : '—'}
                    {idleMins > 0 && <span className="ct-sub"> {idleMins}m</span>}
                  </td>
                  <td>
                    <div className="ct-eff-wrap">
                      <div className="ct-eff-track">
                        <div className="ct-eff-fill" style={{ width: `${eff}%`, background: eff >= 80 ? 'var(--green)' : eff >= 60 ? 'var(--amber)' : 'var(--red)' }} />
                      </div>
                      <span className="ct-eff-val">{eff}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="modal-footer">
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            SAR {FUEL_PRICE_SAR}/L · {TANK_LITRES}L tank · Idle cost estimated at 3L/hr
          </span>
        </div>
      </div>
    </div>
  )
}

export default CostAnalyticsModal
