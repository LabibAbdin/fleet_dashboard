// ═══════════════════════════════════════════════════════════════════════════════
// PROVIDER ADAPTER ENGINE
//   Give it any JSON telemetry feed (a GPS provider REST endpoint, a GeoJSON
//   layer, a raw device list) and it structurally analyzes the payload:
//   finds the vehicle array, classifies every field by name + value shape,
//   scores confidence, and emits a reusable field mapping. Mapped records are
//   adapted into FleetPulse truck objects so any provider can be tracked live.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Safe path access ("a.b.0.c") ─────────────────────────────────────────────
export function getPath(obj, path) {
  if (path == null || path === '') return undefined
  return String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
}

// Flatten one record into dot-paths → sample values (arrays indexed 0/1)
function flatten(obj, prefix = '', out = {}, depth = 0) {
  if (depth > 4 || obj == null) return out
  if (Array.isArray(obj)) {
    obj.slice(0, 2).forEach((v, i) => {
      if (typeof v === 'object' && v !== null) flatten(v, `${prefix}${i}.`, out, depth + 1)
      else out[`${prefix}${i}`] = v
    })
    return out
  }
  for (const [k, v] of Object.entries(obj)) {
    const p = `${prefix}${k}`
    if (typeof v === 'object' && v !== null) flatten(v, `${p}.`, out, depth + 1)
    else out[p] = v
  }
  return out
}

// ── Locate the vehicle-record array anywhere in the payload ──────────────────
function coordScore(sample) {
  const flat = flatten(sample)
  let s = 0
  for (const [k, v] of Object.entries(flat)) {
    const key = k.toLowerCase()
    if (/\b(lat|latitude)\b|(^|[._])lat($|[._])/.test(key) && typeof v === 'number' && Math.abs(v) <= 90) s += 3
    if (/lon|lng|longitude/.test(key) && typeof v === 'number' && Math.abs(v) <= 180) s += 3
    if (/coordinates/.test(key)) s += 2
    if (/speed|velocity/.test(key)) s += 1
    if (/plate|vehicle|device|unit|imei|vin/.test(key)) s += 1
  }
  return s
}

export function findRecordArray(json, path = '', best = { score: -1 }) {
  if (Array.isArray(json)) {
    if (json.length > 0 && typeof json[0] === 'object' && json[0] !== null) {
      const score = coordScore(json[0]) + Math.min(json.length, 5) * 0.1
      if (score > best.score) { best.score = score; best.path = path; best.records = json }
    }
    return best
  }
  if (typeof json === 'object' && json !== null) {
    for (const [k, v] of Object.entries(json)) {
      findRecordArray(v, path ? `${path}.${k}` : k, best)
    }
  }
  return best
}

// ── Field classification ─────────────────────────────────────────────────────
const FIELD_RULES = {
  lat:     { name: /(^|[._-])(lat|latitude|y)([._-]|$)/i,                      test: v => typeof v === 'number' && Math.abs(v) <= 90 && v !== 0 },
  lng:     { name: /(^|[._-])(lng|lon|long|longitude|x)([._-]|$)/i,            test: v => typeof v === 'number' && Math.abs(v) <= 180 && v !== 0 },
  id:      { name: /(^|[._-])(id|uid|guid|imei|device_?id|vehicle_?id|unit_?id|object_?id)([._-]|$)/i, test: v => typeof v === 'string' || typeof v === 'number' },
  plate:   { name: /(plate|registration|reg_?num|license)/i,                   test: v => typeof v === 'string' },
  name:    { name: /(^|[._-])(name|label|title|alias|unit|callsign)([._-]|$)/i, test: v => typeof v === 'string' },
  driver:  { name: /driver/i,                                                  test: v => typeof v === 'string' },
  speed:   { name: /(speed|velocity|spd|kmh|kph)/i,                            test: v => typeof v === 'number' && v >= 0 && v <= 250 },
  fuel:    { name: /(fuel|soc|charge|tank)/i,                                  test: v => typeof v === 'number' && v >= 0 && v <= 100 },
  heading: { name: /(heading|course|bearing|direction|azimuth)/i,              test: v => typeof v === 'number' && v >= 0 && v <= 360 },
  temp:    { name: /(temp|temperature|coolant)/i,                              test: v => typeof v === 'number' && v > -60 && v < 400 },
  weight:  { name: /(weight|payload|load|mass|cargo|tonnage)/i,                test: v => typeof v === 'number' && v >= 0 },
  odometer:{ name: /(odo|mileage|total_?dist)/i,                               test: v => typeof v === 'number' && v >= 0 },
  status:  { name: /(status|state|ignition|moving|online)/i,                   test: () => true },
  time:    { name: /(time|timestamp|updated|last_?seen|date)/i,                test: v => typeof v === 'string' || typeof v === 'number' },
}

export const MAPPABLE_FIELDS = Object.keys(FIELD_RULES)
export const REQUIRED_FIELDS = ['lat', 'lng']

export function detectMapping(records) {
  const sample = records[0]
  const flatKeys = Object.keys(flatten(sample))
  const mapping = {}    // field -> path
  const confidence = {} // field -> 0..1

  for (const [field, rule] of Object.entries(FIELD_RULES)) {
    let bestPath = null, bestScore = 0
    for (const path of flatKeys) {
      const leaf = path.split('.').pop()
      let score = 0
      if (rule.name.test(leaf)) score += 0.6
      else if (rule.name.test(path)) score += 0.35
      if (score === 0) continue
      // Value plausibility checked across up to 5 records
      const vals = records.slice(0, 5).map(r => getPath(r, path)).filter(v => v !== undefined && v !== null)
      if (vals.length && vals.every(rule.test)) score += 0.4
      else score *= 0.4
      if (score > bestScore) { bestScore = score; bestPath = path }
    }
    if (bestPath && bestScore >= 0.35) { mapping[field] = bestPath; confidence[field] = Math.min(1, bestScore) }
  }

  // GeoJSON special-case: geometry.coordinates is [lng, lat]
  if ((!mapping.lat || !mapping.lng) && getPath(sample, 'geometry.coordinates.0') !== undefined) {
    mapping.lng = 'geometry.coordinates.0'
    mapping.lat = 'geometry.coordinates.1'
    confidence.lat = confidence.lng = 0.9
  }
  return { mapping, confidence, flatKeys }
}

// ── Full analysis of a fetched payload ───────────────────────────────────────
export function analyzeFeed(json) {
  const found = findRecordArray(json)
  if (!found.records || !found.records.length) {
    // Single-object payload → treat as one record
    if (json && typeof json === 'object' && !Array.isArray(json) && coordScore(json) >= 3) {
      found.records = [json]; found.path = '(root object)'
    } else {
      return { ok: false, error: 'No array of vehicle records with coordinates found in this payload.' }
    }
  }
  const { mapping, confidence, flatKeys } = detectMapping(found.records)
  const missing = REQUIRED_FIELDS.filter(f => !mapping[f])
  return {
    ok: missing.length === 0,
    error: missing.length ? `Could not detect required field(s): ${missing.join(', ')}. Map them manually below.` : null,
    records: found.records,
    recordPath: found.path || '(root)',
    mapping, confidence, flatKeys,
  }
}

// ── Adapt one provider record → FleetPulse truck object ──────────────────────
const num = (v, fb) => { const n = typeof v === 'string' ? parseFloat(v) : v; return Number.isFinite(n) ? n : fb }

export function adaptRecord(rec, mapping, providerId, idx) {
  const g = f => getPath(rec, mapping[f])
  const lat = num(g('lat'), null), lng = num(g('lng'), null)
  if (lat === null || lng === null) return null
  const speed = num(g('speed'), 0)
  const rawStatus = g('status')
  const status = typeof rawStatus === 'string'
    ? (/off|stop|idle|park|0|false/i.test(rawStatus) ? 'idle' : 'active')
    : (speed > 2 ? 'active' : 'idle')
  const id = `EXT-${providerId}-${g('id') ?? g('plate') ?? g('name') ?? idx}`
  return {
    id,
    licensePlate: String(g('plate') ?? g('name') ?? g('id') ?? `UNIT ${idx + 1}`).slice(0, 14),
    status,
    speed,
    fuel: num(g('fuel'), 100),
    temperature: num(g('temp'), 185),
    rpm: speed > 2 ? 1500 + speed * 14 : 800,
    heading: num(g('heading'), 0),
    weight: num(g('weight'), null),
    batteryVoltage: 12.6,
    odometer: num(g('odometer'), 0),
    engineHours: 0,
    safetyScore: 90,
    location: { lat, lng },
    driver: g('driver') ? { name: String(g('driver')), phone: '', experience: '—', license: '—', rating: 0, photo: '' } : null,
    safety: { speeding: 0, harshBraking: 0, rapidAcceleration: 0, sharpCornering: 0, excessiveIdle: 0, recentEvents: [] },
    activeDTCs: [],
    vehicle: null,
    _ext: true,
    _providerId: providerId,
    _lastSeen: Date.now(),
  }
}

export function adaptFeed(json, provider) {
  const found = provider.recordPath && provider.recordPath !== '(root)' && provider.recordPath !== '(root object)'
    ? getPath(json, provider.recordPath)
    : (Array.isArray(json) ? json : findRecordArray(json).records)
  const records = Array.isArray(found) ? found : (found ? [found] : [])
  return records
    .map((r, i) => adaptRecord(r, provider.mapping, provider.id, i))
    .filter(Boolean)
    .slice(0, 100)
}

// ── Built-in sample feed (lets users try the connector with zero setup) ──────
export function sampleFeed() {
  const base = [
    { device_id: 'GT06-9917', plate_no: 'EXT 1042', latitude: 24.7742, longitude: 46.7386, speed_kmh: 63, fuel_level: 71, course: 128, driver_name: 'Sami External', gross_weight_kg: 18400, ignition: 'ON' },
    { device_id: 'GT06-4471', plate_no: 'EXT 2260', latitude: 24.6231, longitude: 46.5901, speed_kmh: 0,  fuel_level: 44, course: 0,   driver_name: 'Hani External', gross_weight_kg: 9200,  ignition: 'OFF' },
    { device_id: 'GT06-8823', plate_no: 'EXT 3785', latitude: 24.8412, longitude: 46.6120, speed_kmh: 88, fuel_level: 18, course: 251, driver_name: 'Rami External', gross_weight_kg: 26100, ignition: 'ON' },
  ]
  // Slight jitter each call so the demo feed looks live
  return {
    api_version: '2.1',
    result: {
      devices: base.map(d => ({
        ...d,
        latitude: d.latitude + (Math.random() - 0.5) * 0.004,
        longitude: d.longitude + (Math.random() - 0.5) * 0.004,
        speed_kmh: d.ignition === 'ON' ? Math.max(0, d.speed_kmh + (Math.random() - 0.5) * 14) : 0,
      })),
    },
  }
}

export const SAMPLE_FEED_URL = 'sample://provider-demo'

export async function fetchFeed(url) {
  if (url === SAMPLE_FEED_URL) return sampleFeed()
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
  const text = await res.text()
  try { return JSON.parse(text) }
  catch { throw new Error('Response is not JSON. The connector currently supports JSON APIs (REST / GeoJSON).') }
}
