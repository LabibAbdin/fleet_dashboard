import Drawer from './Drawer.jsx'
import { polygonAreaKm2 } from '../lib/geo.js'

// ── Zone manager: create circle or drawn polygon zones, see live occupancy ────
export default function ZonesDrawer({ geozones, countInZone, onRemove, onStartCircle, onStartPolygon, onClose }) {
  return (
    <Drawer title="Geofence Zones" icon="📍" badge={geozones.length} onClose={onClose}>
      <div className="zn-actions">
        <button className="zn-new-btn" onClick={() => { onStartCircle(); onClose() }}>
          ⭕ Circle zone
          <span className="zn-new-sub">click map to place</span>
        </button>
        <button className="zn-new-btn" onClick={() => { onStartPolygon(); onClose() }}>
          ✏️ Draw polygon
          <span className="zn-new-sub">click corners, then finish</span>
        </button>
      </div>
      <div className="zn-hint">
        Trucks entering or leaving any zone raise a live alert. Polygons let you trace real
        depots, districts, or restricted areas instead of approximating with circles.
      </div>
      {geozones.length === 0 ? (
        <div className="zn-empty">No zones yet — create your first one above.</div>
      ) : geozones.map(z => {
        const inside = countInZone(z)
        return (
          <div key={z.id} className="zn-row" style={{ borderLeftColor: z.color }}>
            <span className="zn-shape" aria-hidden="true">{z.type === 'polygon' ? '⬠' : '⭕'}</span>
            <div className="zn-body">
              <div className="zn-name">{z.name}</div>
              <div className="zn-meta">
                {z.type === 'polygon'
                  ? `${z.points.length} corners · ${polygonAreaKm2(z.points).toFixed(2)} km²`
                  : `radius ${z.radius >= 1000 ? (z.radius / 1000).toFixed(1) + ' km' : z.radius + ' m'}`}
              </div>
            </div>
            <span className={`zn-count${inside > 0 ? ' hot' : ''}`}>{inside} 🚛</span>
            <button className="zn-del" onClick={() => onRemove(z.id)} title="Delete zone">✕</button>
          </div>
        )
      })}
    </Drawer>
  )
}
