// ── Geometry helpers for geofence zones (circles + drawn polygons) ────────────

const EARTH_R = 6371000 // metres

export function distMetres(lat1, lng1, lat2, lng2) {
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return EARTH_R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Ray-casting point-in-polygon. points: [[lat,lng], ...]
export function pointInPolygon(lat, lng, points) {
  if (!points || points.length < 3) return false
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [yi, xi] = points[i]
    const [yj, xj] = points[j]
    const intersects = (xi > lng) !== (xj > lng) &&
      lat < ((yj - yi) * (lng - xi)) / (xj - xi) + yi
    if (intersects) inside = !inside
  }
  return inside
}

// Zone containment — works for both legacy circle zones ({lat,lng,radius})
// and polygon zones ({type:'polygon', points:[[lat,lng],...]})
export function isInsideZone(zone, lat, lng) {
  if (zone.type === 'polygon') return pointInPolygon(lat, lng, zone.points)
  return distMetres(lat, lng, zone.lat, zone.lng) <= zone.radius
}

// Approximate polygon area in km² (planar shoelace scaled by latitude)
export function polygonAreaKm2(points) {
  if (!points || points.length < 3) return 0
  const latRef = points[0][0] * Math.PI / 180
  const mPerDegLat = 111320
  const mPerDegLng = 111320 * Math.cos(latRef)
  let sum = 0
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i][1] * mPerDegLng, yi = points[i][0] * mPerDegLat
    const xj = points[j][1] * mPerDegLng, yj = points[j][0] * mPerDegLat
    sum += (xj + xi) * (yj - yi)
  }
  return Math.abs(sum / 2) / 1e6
}

// Centroid of a polygon zone (for labels / fly-to)
export function zoneCenter(zone) {
  if (zone.type !== 'polygon') return [zone.lat, zone.lng]
  const n = zone.points.length
  const lat = zone.points.reduce((s, p) => s + p[0], 0) / n
  const lng = zone.points.reduce((s, p) => s + p[1], 0) / n
  return [lat, lng]
}
