import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react'
import { useCopilotReadable, useCopilotAction } from '@copilotkit/react-core'
import { CopilotSidebar } from '@copilotkit/react-ui'
import { MapContainer, TileLayer, Marker, Popup, Polyline, Polygon, Circle, CircleMarker, useMap, useMapEvents, ZoomControl } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './App.css'
import './drawers.css'
import { isInsideZone } from './lib/geo.js'
import { adaptFeed, fetchFeed } from './lib/providerAdapter.js'
import MonitoringDrawer from './components/MonitoringDrawer.jsx'
import PlaybackDrawer from './components/PlaybackDrawer.jsx'
import ProviderConnectDrawer from './components/ProviderConnectDrawer.jsx'
import ZonesDrawer from './components/ZonesDrawer.jsx'
import TagsEditor from './components/TagsEditor.jsx'

const API = 'http://localhost:5000'
const GEOFENCE_CENTER = [24.7136, 46.6753]
const GEOFENCE_RADIUS_DEG = 0.09
const GEOFENCE_RADIUS_M = 10000
const FUEL_PRICE_SAR = 2.18
const TANK_LITRES = 400
const MAX_WEIGHT_KG = 25000   // GVW limit — overweight monitoring threshold

const DEFAULT_SETTINGS = { speedThreshold: 120, fuelThreshold: 20, tempThreshold: 220 }

// ── Maintenance intervals ─────────────────────────────────────────────────────
const MI_OIL_KM   = 5_000    // km between oil changes
const MI_OIL_HRS  = 250      // engine-hours between oil changes
const MI_TIRE_KM  = 10_000   // km between tire rotations
const MI_SVC_KM   = 20_000   // km between full services

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

// ── Breakdown risk score (0-100) ─────────────────────────────────────────────
function getBreakdownRisk(t) {
  let risk = 0
  if ((t.activeDTCs?.length || 0) > 0) risk += 30
  if (t.temperature > 115)     risk += 25
  else if (t.temperature > 105) risk += 12
  if ((t.batteryVoltage ?? 12.6) < 12.0)  risk += 18
  else if ((t.batteryVoltage ?? 12.6) < 12.3) risk += 8
  const ms = getMaintStatus(t)
  if (ms.urgent) risk += 20
  else if (ms.warn) risk += 8
  if ((t.safety?.harshBraking || 0) > 5) risk += 10
  if ((t.safety?.rapidAcceleration || 0) > 3) risk += 5
  if ((t.rpm || 0) > 3400) risk += 5
  return Math.min(100, risk)
}

const MSG_TEMPLATES = [
  { id: 'speed',  label: '🚨 Slow Down',      text: 'Alert: You are exceeding the speed limit. Please reduce your speed immediately.' },
  { id: 'return', label: '🏠 Return to Base',  text: 'Please return to base as soon as possible. Contact dispatch for route details.' },
  { id: 'fuel',   label: '⛽ Refuel Now',      text: 'Your fuel is critically low. Proceed to the nearest fueling station immediately.' },
  { id: 'call',   label: '📞 Call Dispatch',   text: 'Please call dispatch immediately. This is urgent.' },
  { id: 'safety', label: '⚠️ Safety Check',    text: 'Please pull over safely and inspect your vehicle. Contact dispatch when complete.' },
]

// ── Demo mode mock data (used when backend is unreachable) ───────────────────
const DEMO_TRUCKS = [
  {
    id: 'DEMO-1', licensePlate: 'ARY 1847', status: 'active',
    speed: 58, fuel: 74, temperature: 193, rpm: 2700, batteryVoltage: 12.8,
    odometer: 48230, engineHours: 1842, safetyScore: 88,
    location: { lat: 24.7436, lng: 46.6053 },
    driver: { name: 'Ahmad Al-Rashid', photo: 'https://randomuser.me/api/portraits/men/32.jpg', phone: '+966501234567', experience: '8 yrs', license: 'CDL-A', rating: 4.8 },
    safety: { speeding: 1, harshBraking: 2, rapidAcceleration: 1, sharpCornering: 0, excessiveIdle: 0, recentEvents: [] },
    activeDTCs: [],
    vehicle: { make: 'Volvo', model: 'FH16 750', year: 2022, color: 'White', vin: 'YV2RT40A4NB123456', regExpiry: '2026-03-15', insExpiry: '2025-12-31', lastInspection: '2025-01-10' },
  },
  {
    id: 'DEMO-2', licensePlate: 'MXK 2231', status: 'active',
    speed: 84, fuel: 32, temperature: 208, rpm: 3500, batteryVoltage: 12.4,
    odometer: 92150, engineHours: 3640, safetyScore: 59,
    location: { lat: 24.6736, lng: 46.7353 },
    driver: { name: 'Mohammed Hassan', photo: 'https://randomuser.me/api/portraits/men/47.jpg', phone: '+966507654321', experience: '5 yrs', license: 'CDL-B', rating: 4.5 },
    safety: { speeding: 5, harshBraking: 7, rapidAcceleration: 4, sharpCornering: 3, excessiveIdle: 1,
      recentEvents: [{ type: 'SPEEDING', value: '84 km/h', time: new Date().toISOString() }, { type: 'HARSH_BRAKING', value: '0.8g', time: new Date(Date.now() - 300000).toISOString() }] },
    activeDTCs: [{ code: 'P0420', desc: 'Catalyst System Efficiency Below Threshold', severity: 'warning', detectedAt: new Date().toISOString() }],
    vehicle: { make: 'Mercedes-Benz', model: 'Actros 2653', year: 2020, color: 'Silver', vin: 'WDB9634031L234567', regExpiry: '2025-11-20', insExpiry: '2025-09-01', lastInspection: '2024-09-15' },
  },
  {
    id: 'DEMO-3', licensePlate: 'RNB 5534', status: 'idle',
    speed: 0, fuel: 88, temperature: 178, rpm: 820, batteryVoltage: 13.1,
    odometer: 31450, engineHours: 1240, safetyScore: 96,
    location: { lat: 24.7236, lng: 46.7153 },
    driver: { name: 'Khalid Al-Saud', photo: 'https://randomuser.me/api/portraits/men/11.jpg', phone: '+966512345678', experience: '12 yrs', license: 'CDL-A', rating: 4.9 },
    safety: { speeding: 0, harshBraking: 1, rapidAcceleration: 0, sharpCornering: 0, excessiveIdle: 4, recentEvents: [] },
    activeDTCs: [],
    vehicle: { make: 'Scania', model: 'R500 XT', year: 2023, color: 'Blue', vin: 'YS2R4X20005345678', regExpiry: '2026-08-30', insExpiry: '2026-07-15', lastInspection: '2025-03-22' },
  },
  {
    id: 'DEMO-4', licensePlate: 'FDK 8821', status: 'active',
    speed: 52, fuel: 16, temperature: 201, rpm: 2500, batteryVoltage: 11.9,
    odometer: 67800, engineHours: 2890, safetyScore: 71,
    location: { lat: 24.7436, lng: 46.6453 },
    driver: { name: 'Omar Farouq', photo: 'https://randomuser.me/api/portraits/men/67.jpg', phone: '+966598765432', experience: '3 yrs', license: 'CDL-B', rating: 4.2 },
    safety: { speeding: 2, harshBraking: 4, rapidAcceleration: 2, sharpCornering: 1, excessiveIdle: 0, recentEvents: [] },
    activeDTCs: [],
    vehicle: { make: 'MAN', model: 'TGX 26.540', year: 2019, color: 'Red', vin: 'WMA06XZZ0KM456789', regExpiry: '2025-08-05', insExpiry: '2025-06-30', lastInspection: '2024-06-10' },
  },
  {
    id: 'DEMO-5', licensePlate: 'ZWT 3390', status: 'active',
    speed: 41, fuel: 58, temperature: 189, rpm: 2100, batteryVoltage: 12.7,
    odometer: 55100, engineHours: 2110, safetyScore: 83,
    location: { lat: 24.6836, lng: 46.6353 },
    driver: { name: 'Yusuf Al-Amri', photo: 'https://randomuser.me/api/portraits/men/22.jpg', phone: '+966523456789', experience: '7 yrs', license: 'CDL-A', rating: 4.7 },
    safety: { speeding: 1, harshBraking: 2, rapidAcceleration: 1, sharpCornering: 0, excessiveIdle: 0, recentEvents: [] },
    activeDTCs: [],
    vehicle: { make: 'DAF', model: 'XF 530 FT', year: 2021, color: 'Black', vin: 'XLRTE47MS0E567890', regExpiry: '2026-05-18', insExpiry: '2026-04-30', lastInspection: '2025-02-14' },
  },
  {
    id: 'DEMO-6', licensePlate: 'KLN 4412', status: 'active',
    speed: 67, fuel: 45, temperature: 197, rpm: 2900, batteryVoltage: 12.6,
    odometer: 73420, engineHours: 2640, safetyScore: 79,
    location: { lat: 24.7636, lng: 46.6853 },
    driver: { name: 'Saud Al-Qahtani', photo: 'https://randomuser.me/api/portraits/men/14.jpg', phone: '+966534567890', experience: '6 yrs', license: 'CDL-A', rating: 4.6 },
    safety: { speeding: 1, harshBraking: 3, rapidAcceleration: 2, sharpCornering: 1, excessiveIdle: 0, recentEvents: [] },
    activeDTCs: [],
    vehicle: { make: 'Iveco', model: 'S-Way 570', year: 2022, color: 'White', vin: 'WJMM1VTH40C678901', regExpiry: '2026-09-12', insExpiry: '2026-06-20', lastInspection: '2025-04-05' },
  },
  {
    id: 'DEMO-7', licensePlate: 'BTH 7790', status: 'active',
    speed: 91, fuel: 61, temperature: 214, rpm: 3700, batteryVoltage: 12.3,
    odometer: 104230, engineHours: 4120, safetyScore: 52,
    location: { lat: 24.6536, lng: 46.6953 },
    driver: { name: 'Fahad Al-Mutairi', photo: 'https://randomuser.me/api/portraits/men/52.jpg', phone: '+966545678901', experience: '4 yrs', license: 'CDL-B', rating: 4.0 },
    safety: { speeding: 6, harshBraking: 8, rapidAcceleration: 5, sharpCornering: 4, excessiveIdle: 2,
      recentEvents: [{ type: 'SPEEDING', value: '91 km/h', time: new Date().toISOString() }] },
    activeDTCs: [{ code: 'P0128', desc: 'Coolant Thermostat Below Regulating Temperature', severity: 'warning', detectedAt: new Date().toISOString() }],
    vehicle: { make: 'Renault', model: 'T High 520', year: 2018, color: 'Yellow', vin: 'VF640ABA000789012', regExpiry: '2025-07-22', insExpiry: '2025-05-15', lastInspection: '2024-05-18' },
  },
  {
    id: 'DEMO-8', licensePlate: 'QZM 1156', status: 'idle',
    speed: 0, fuel: 93, temperature: 174, rpm: 790, batteryVoltage: 13.0,
    odometer: 21870, engineHours: 870, safetyScore: 98,
    location: { lat: 24.7036, lng: 46.6553 },
    driver: { name: 'Abdullah Al-Harbi', photo: 'https://randomuser.me/api/portraits/men/76.jpg', phone: '+966556789012', experience: '15 yrs', license: 'CDL-A', rating: 5.0 },
    safety: { speeding: 0, harshBraking: 0, rapidAcceleration: 0, sharpCornering: 0, excessiveIdle: 3, recentEvents: [] },
    activeDTCs: [],
    vehicle: { make: 'Volvo', model: 'FH 540', year: 2024, color: 'Silver', vin: 'YV2RT40A4PB890123', regExpiry: '2027-01-15', insExpiry: '2026-12-10', lastInspection: '2025-05-01' },
  },
  {
    id: 'DEMO-9', licensePlate: 'WRD 3367', status: 'active',
    speed: 48, fuel: 12, temperature: 199, rpm: 2400, batteryVoltage: 11.7,
    odometer: 88940, engineHours: 3380, safetyScore: 64,
    location: { lat: 24.7336, lng: 46.7453 },
    driver: { name: 'Nasser Al-Dosari', photo: 'https://randomuser.me/api/portraits/men/85.jpg', phone: '+966567890123', experience: '5 yrs', license: 'CDL-B', rating: 4.3 },
    safety: { speeding: 2, harshBraking: 5, rapidAcceleration: 3, sharpCornering: 2, excessiveIdle: 1, recentEvents: [] },
    activeDTCs: [{ code: 'P0562', desc: 'System Voltage Low', severity: 'warning', detectedAt: new Date().toISOString() }],
    vehicle: { make: 'Mercedes-Benz', model: 'Actros 1845', year: 2019, color: 'Blue', vin: 'WDB9634031L901234', regExpiry: '2025-10-30', insExpiry: '2025-08-22', lastInspection: '2024-08-11' },
  },
  {
    id: 'DEMO-10', licensePlate: 'JFS 9928', status: 'active',
    speed: 55, fuel: 70, temperature: 191, rpm: 2600, batteryVoltage: 12.9,
    odometer: 39600, engineHours: 1510, safetyScore: 91,
    location: { lat: 24.6936, lng: 46.7253 },
    driver: { name: 'Turki Al-Shammari', photo: 'https://randomuser.me/api/portraits/men/93.jpg', phone: '+966578901234', experience: '9 yrs', license: 'CDL-A', rating: 4.8 },
    safety: { speeding: 0, harshBraking: 1, rapidAcceleration: 1, sharpCornering: 0, excessiveIdle: 0, recentEvents: [] },
    activeDTCs: [],
    vehicle: { make: 'Scania', model: 'S730', year: 2023, color: 'Green', vin: 'YS2S6X20005012345', regExpiry: '2026-11-08', insExpiry: '2026-09-30', lastInspection: '2025-03-15' },
  },
  {
    id: 'DEMO-11', licensePlate: 'PCV 5503', status: 'active',
    speed: 73, fuel: 38, temperature: 205, rpm: 3100, batteryVoltage: 12.5,
    odometer: 61250, engineHours: 2380, safetyScore: 76,
    location: { lat: 24.7536, lng: 46.7053 },
    driver: { name: 'Bandar Al-Otaibi', photo: 'https://randomuser.me/api/portraits/men/41.jpg', phone: '+966589012345', experience: '7 yrs', license: 'CDL-A', rating: 4.5 },
    safety: { speeding: 3, harshBraking: 3, rapidAcceleration: 2, sharpCornering: 1, excessiveIdle: 0, recentEvents: [] },
    activeDTCs: [],
    vehicle: { make: 'MAN', model: 'TGX 18.640', year: 2021, color: 'Red', vin: 'WMA06XZZ0KM012346', regExpiry: '2026-04-25', insExpiry: '2026-02-18', lastInspection: '2025-01-28' },
  },
  {
    id: 'DEMO-12', licensePlate: 'HMD 2284', status: 'active',
    speed: 44, fuel: 82, temperature: 187, rpm: 2200, batteryVoltage: 12.8,
    odometer: 45780, engineHours: 1720, safetyScore: 87,
    location: { lat: 24.6636, lng: 46.6653 },
    driver: { name: 'Majed Al-Ghamdi', photo: 'https://randomuser.me/api/portraits/men/60.jpg', phone: '+966590123456', experience: '8 yrs', license: 'CDL-A', rating: 4.7 },
    safety: { speeding: 1, harshBraking: 2, rapidAcceleration: 1, sharpCornering: 1, excessiveIdle: 0, recentEvents: [] },
    activeDTCs: [],
    vehicle: { make: 'DAF', model: 'XG+ 530', year: 2022, color: 'White', vin: 'XLRTE47MS0E123457', regExpiry: '2026-12-03', insExpiry: '2026-10-15', lastInspection: '2025-04-20' },
  },
]

// ── Dispatch jobs (demo) ──────────────────────────────────────────────────────
const DEMO_JOBS = [
  { id: 'J001', title: 'Morning Cargo Run',      from: 'Depot A, King Khalid Rd',     to: 'Port Terminal B',            priority: 'high',   eta: '09:30', status: 'enroute',  truckId: 'DEMO-1' },
  { id: 'J002', title: 'Airport Transfer',        from: 'Terminal 3, KAIA',            to: 'Downtown Office Complex',    priority: 'high',   eta: '10:00', status: 'pending',  truckId: null },
  { id: 'J003', title: 'Hospital Supply Run',     from: 'Medical Supply Warehouse',    to: 'King Faisal Hospital',       priority: 'high',   eta: '08:45', status: 'complete', truckId: null },
  { id: 'J004', title: 'Retail Distribution',     from: 'Distribution Centre',         to: 'Mall of Arabia',             priority: 'normal', eta: '11:00', status: 'pending',  truckId: null },
  { id: 'J005', title: 'Construction Delivery',   from: 'Building Supplies Depot',     to: 'Al Malqa Construction Site', priority: 'normal', eta: '12:00', status: 'enroute',  truckId: 'DEMO-4' },
  { id: 'J006', title: 'Return to Base',          from: 'Current Position',            to: 'Main Depot — Riyadh',        priority: 'low',    eta: '16:00', status: 'complete', truckId: null },
]

// ── Haversine distance (km) ─────────────────────────────────────────────────
function haversineDist(lat1, lng1, lat2, lng2) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE OPTIMIZATION ENGINE — Vehicle Routing Problem solver
//   Cheapest-insertion assignment + 2-opt sequencing. Genuine operations research:
//   minimizes total fleet distance (loaded legs + deadhead between stops).
// ═══════════════════════════════════════════════════════════════════════════════
const RIYADH = [24.7136, 46.6753]
const DIESEL_L_PER_KM = 0.34      // heavy truck avg consumption
const AVG_ROUTE_KMH   = 46        // urban+highway blended
const CO2_PER_L       = 2.68      // kg CO₂ per litre diesel

// Deterministic pseudo-geocode — stable coords per location string around Riyadh
function geoFor(seed) {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619) }
  const r1 = ((h >>> 0) % 10000) / 10000
  const r2 = (((h >>> 13) >>> 0) % 10000) / 10000
  return [RIYADH[0] + (r1 - 0.5) * 0.46, RIYADH[1] + (r2 - 0.5) * 0.58]
}

// Total km for one truck servicing an ordered list of jobs (pickup→drop + deadhead)
function routeKm(start, ordered) {
  if (!ordered.length) return 0
  let d = haversineDist(start[0], start[1], ordered[0].fromC[0], ordered[0].fromC[1])
  for (let i = 0; i < ordered.length; i++) {
    const j = ordered[i]
    d += haversineDist(j.fromC[0], j.fromC[1], j.toC[0], j.toC[1])          // loaded leg
    if (i < ordered.length - 1) {
      const n = ordered[i + 1]
      d += haversineDist(j.toC[0], j.toC[1], n.fromC[0], n.fromC[1])         // deadhead
    }
  }
  return d
}

// 2-opt local search — reverses segments to escape crossings, returns optimal order
function twoOpt(start, jobs) {
  let best = jobs.slice()
  let bestD = routeKm(start, best)
  if (best.length < 3) return { order: best, dist: bestD }
  let improved = true, guard = 0
  while (improved && guard++ < 40) {
    improved = false
    for (let i = 0; i < best.length - 1; i++) {
      for (let k = i + 1; k < best.length; k++) {
        const cand = best.slice(0, i).concat(best.slice(i, k + 1).reverse(), best.slice(k + 1))
        const d = routeKm(start, cand)
        if (d < bestD - 1e-6) { best = cand; bestD = d; improved = true }
      }
    }
  }
  return { order: best, dist: bestD }
}

// Full fleet optimizer: assign each pending job to the truck of least marginal cost
function optimizeFleet(trucks, pendingJobs) {
  const prio = { high: 0, normal: 1, low: 2 }
  const jobs = pendingJobs.map(j => ({ ...j, fromC: geoFor(j.from || j.title), toC: geoFor(j.to) }))
                          .sort((a, b) => (prio[a.priority] ?? 1) - (prio[b.priority] ?? 1))
  const plan = new Map(trucks.map(t => [t.id, []]))
  for (const job of jobs) {
    let target = null, bestMarginal = Infinity, bestSeq = null
    for (const t of trucks) {
      const start = [t.location.lat, t.location.lng]
      const cur = plan.get(t.id)
      const base = routeKm(start, cur)
      const { order, dist } = twoOpt(start, cur.concat([job]))
      // Marginal cost, lightly favouring trucks with more fuel headroom
      const fuelBias = (100 - t.fuel) * 0.012
      const marginal = (dist - base) + fuelBias
      if (marginal < bestMarginal) { bestMarginal = marginal; target = t; bestSeq = order }
    }
    if (target) plan.set(target.id, bestSeq)
  }
  return plan
}

// Baseline (what a dispatcher does by hand): round-robin in submitted order, no re-sequencing
function baselineFleet(trucks, pendingJobs) {
  const jobs = pendingJobs.map(j => ({ ...j, fromC: geoFor(j.from || j.title), toC: geoFor(j.to) }))
  const plan = new Map(trucks.map(t => [t.id, []]))
  jobs.forEach((job, i) => {
    if (trucks.length) plan.get(trucks[i % trucks.length].id).push(job)
  })
  return plan
}

function planTotals(trucks, plan) {
  let km = 0
  for (const t of trucks) km += routeKm([t.location.lat, t.location.lng], plan.get(t.id) || [])
  const litres = km * DIESEL_L_PER_KM
  return { km, litres, sar: litres * FUEL_PRICE_SAR, hrs: km / AVG_ROUTE_KMH, co2: litres * CO2_PER_L }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PREDICTIVE MAINTENANCE ENGINE — per-component Remaining Useful Life (RUL)
//   Models degradation from live telemetry, predicts days-to-failure, and prices
//   proactive repair vs. roadside breakdown to quantify avoidable cost.
// ═══════════════════════════════════════════════════════════════════════════════
const COMPONENT_SPECS = {
  engine:  { name: 'Engine Oil & Filter', icon: '🛢️', lifeKm: 5000,  proactive: 350,  reactive: 4200 },
  brakes:  { name: 'Brake System',        icon: '🛑', lifeKm: 55000, proactive: 1400, reactive: 7800 },
  tires:   { name: 'Tire Set',            icon: '🛞', lifeKm: 42000, proactive: 3200, reactive: 9500 },
  battery: { name: 'Battery & Charging',  icon: '🔋', lifeKm: 80000, proactive: 650,  reactive: 2400 },
  cooling: { name: 'Cooling System',      icon: '🌡️', lifeKm: 65000, proactive: 900,  reactive: 11000 },
  trans:   { name: 'Transmission',        icon: '⚙️', lifeKm: 120000,proactive: 4500, reactive: 22000 },
}

// Estimate km/day from the truck's own usage intensity (km per engine-hour × ~9h shift)
function dailyKm(t) {
  const km = t.odometer || 0, hrs = t.engineHours || 1
  return Math.max(120, Math.min(650, (km / hrs) * 9))
}

function predictComponents(t) {
  const km = t.odometer || 0
  const perDay = dailyKm(t)
  const dtcCount = t.activeDTCs?.length || 0
  const harsh = t.safety?.harshBraking || 0
  const corner = t.safety?.sharpCornering || 0
  const volts = t.batteryVoltage ?? 12.6
  const temp = t.temperature || 190

  // remaining-km within current cycle, adjusted by stressors → health & days-to-failure
  const build = (key, remainKm, stressPct = 0) => {
    const s = COMPONENT_SPECS[key]
    const adjRemain = Math.max(0, remainKm * (1 - stressPct))
    const health = Math.max(0, Math.min(100, (adjRemain / s.lifeKm) * 100))
    const days = Math.round(adjRemain / perDay)
    const sev = health < 12 || days <= 3 ? 'critical' : health < 30 || days <= 10 ? 'warning' : 'ok'
    return { key, ...s, health: Math.round(health), days, sev, remainKm: Math.round(adjRemain) }
  }

  const comps = [
    build('engine',  COMPONENT_SPECS.engine.lifeKm  - (km % COMPONENT_SPECS.engine.lifeKm),  dtcCount > 0 ? 0.12 : 0),
    build('brakes',  COMPONENT_SPECS.brakes.lifeKm  - (km % COMPONENT_SPECS.brakes.lifeKm),  Math.min(0.5, harsh * 0.05)),
    build('tires',   COMPONENT_SPECS.tires.lifeKm   - (km % COMPONENT_SPECS.tires.lifeKm),   Math.min(0.4, corner * 0.06)),
    build('battery', COMPONENT_SPECS.battery.lifeKm - (km % COMPONENT_SPECS.battery.lifeKm), volts < 12.0 ? 0.55 : volts < 12.3 ? 0.25 : 0),
    build('cooling', COMPONENT_SPECS.cooling.lifeKm - (km % COMPONENT_SPECS.cooling.lifeKm), temp > 215 ? 0.5 : temp > 205 ? 0.22 : 0),
    build('trans',   COMPONENT_SPECS.trans.lifeKm   - (km % COMPONENT_SPECS.trans.lifeKm),   0),
  ]
  return comps.sort((a, b) => a.days - b.days)
}

// ═══════════════════════════════════════════════════════════════════════════════
// FLEET FINANCIAL INTELLIGENCE — per-vehicle P&L / Total Cost of Ownership
//   Models monthly operating cost, billable revenue, margin, cost-per-km and the
//   break-even utilization for every truck — the core economics of a fleet.
// ═══════════════════════════════════════════════════════════════════════════════
const FIN = {
  workDays: 26,
  revenuePerKm: 4.65,     // SAR billable rate per km
  maintPerKm: 0.22,       // SAR maintenance accrual / km
  tirePerKm: 0.09,        // SAR tire accrual / km
  insuranceMo: 1750,      // SAR / month
  driverWageMo: 4800,     // SAR / month
  depRateYr: 0.12,        // annual depreciation
}

function truckValue(t) {
  const age = Math.max(0, new Date().getFullYear() - (t.vehicle?.year || 2020))
  return Math.max(95000, 480000 - age * 38000)
}

function truckFinancials(t) {
  const perDay = dailyKm(t)
  const monthlyKm = perDay * FIN.workDays
  const util = Math.max(28, Math.min(95, Math.round(
    55 + ((t.safetyScore ?? 70) - 60) * 0.4 + (t.status === 'active' ? 20 : 0) - (t.status === 'idle' ? 16 : 0)
  )))
  const fuelCost = monthlyKm * DIESEL_L_PER_KM * FUEL_PRICE_SAR
  const maintCost = monthlyKm * FIN.maintPerKm
  const tireCost = monthlyKm * FIN.tirePerKm
  const depreciation = truckValue(t) * FIN.depRateYr / 12
  const totalCost = fuelCost + maintCost + tireCost + depreciation + FIN.insuranceMo + FIN.driverWageMo
  const billableKm = monthlyKm * (util / 100)
  const revenue = billableKm * FIN.revenuePerKm
  const profit = revenue - totalCost
  const margin = revenue > 0 ? (profit / revenue) * 100 : 0
  const costPerKm = monthlyKm > 0 ? totalCost / monthlyKm : 0
  const breakevenUtil = monthlyKm > 0 ? (totalCost / (monthlyKm * FIN.revenuePerKm)) * 100 : 100
  return {
    monthlyKm: Math.round(monthlyKm), util, revenue, totalCost, profit, margin, costPerKm,
    breakevenUtil: Math.min(100, breakevenUtil),
    breakdown: { fuel: fuelCost, maintenance: maintCost, tires: tireCost, depreciation, insurance: FIN.insuranceMo, driver: FIN.driverWageMo },
  }
}

// ── map helpers ──────────────────────────────────────────────────────────────
const makeTruckIcon = (color, pulse, plate = '', showLabel = false, heading = 0) => L.divIcon({
  className: 'truck-marker',
  html: `<div class="truck-pin ${pulse ? 'pulse' : ''}" style="--c:${color}">
    <div class="truck-dot">
      ${pulse ? `<div class="truck-arrow" style="transform:rotate(${heading}deg)"></div>` : ''}
    </div>
    ${showLabel && plate ? `<div class="truck-map-label">${plate}</div>` : ''}
  </div>`,
  iconSize: [32, 32], iconAnchor: [16, 16],
})

// ── Animated counter hook ─────────────────────────────────────────────────────
function useCountUp(target, duration = 700) {
  const [value, setValue] = useState(target)
  const prev = useRef(target)
  useEffect(() => {
    const from = prev.current
    const diff = target - from
    if (diff === 0) return
    const start = Date.now()
    let raf
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      setValue(from + diff * eased)
      if (t < 1) { raf = requestAnimationFrame(tick) } else { prev.current = target; setValue(target) }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return value
}

// ── Wall clock for header ─────────────────────────────────────────────────────
function WallClock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])
  return (
    <div className="wall-clock">
      <div className="wc-time">{now.toLocaleTimeString('en-SA', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</div>
      <div className="wc-date">{now.toLocaleDateString('en-SA', { weekday: 'short', month: 'short', day: 'numeric' })}</div>
    </div>
  )
}

function FlyTo({ lat, lng }) {
  const map = useMap()
  // Only fly when the truck changes identity (lat/lng rounded to 4dp), not every pixel move
  const key = lat != null ? `${lat.toFixed(4)},${lng.toFixed(4)}` : null
  useEffect(() => { if (key) map.flyTo([lat, lng], 13, { duration: 1.4 }) }, [key]) // eslint-disable-line
  return null
}

function MapResizer({ trigger }) {
  const map = useMap()
  useEffect(() => { const t = setTimeout(() => map.invalidateSize(), 120); return () => clearTimeout(t) }, [trigger, map])
  return null
}

const SmoothMarker = memo(function SmoothMarker({ truck, color, pulse, isSelected, onSelect }) {
  const markerRef = useRef(null)
  const target = useRef([truck.location.lat, truck.location.lng])
  const current = useRef([truck.location.lat, truck.location.lng])
  const frameRef = useRef(null)
  // Captured once on mount — the marker's live position thereafter is driven
  // imperatively via markerRef.current.setLatLng() in the animate loop below,
  // not by re-rendering with a new `position` prop.
  const [initialPos] = useState(() => [truck.location.lat, truck.location.lng])

  // Build the Leaflet icon only when its visual inputs change — not every tick.
  const icon = useMemo(() => makeTruckIcon(color, pulse, truck.licensePlate, isSelected, truck.heading ?? 0), [color, pulse, truck.licensePlate, isSelected, truck.heading])

  // Animate toward the new position, then STOP. Restarts only when a new
  // position arrives — no permanent 60fps loop burning CPU on parked trucks.
  useEffect(() => {
    target.current = [truck.location.lat, truck.location.lng]
    if (frameRef.current != null) return
    const animate = () => {
      const [clat, clng] = current.current
      const [tlat, tlng] = target.current
      const dlat = tlat - clat, dlng = tlng - clng
      if (Math.abs(dlat) < 1e-6 && Math.abs(dlng) < 1e-6) {
        current.current = [tlat, tlng]
        markerRef.current?.setLatLng([tlat, tlng])
        frameRef.current = null            // settled — stop the loop
        return
      }
      current.current = [clat + dlat * 0.16, clng + dlng * 0.16]
      markerRef.current?.setLatLng(current.current)
      frameRef.current = requestAnimationFrame(animate)
    }
    frameRef.current = requestAnimationFrame(animate)
  }, [truck.location.lat, truck.location.lng])

  useEffect(() => () => { if (frameRef.current != null) cancelAnimationFrame(frameRef.current) }, [])

  return (
    <Marker ref={markerRef} position={initialPos} icon={icon} eventHandlers={{ click: () => onSelect(truck) }}>
      <Popup>
        <div className="map-popup">
          <div className="mp-header">
            <span className="mp-plate">{truck.licensePlate}</span>
            <span className={`mp-status mp-s-${truck.status}`}>{truck.status}</span>
          </div>
          {truck.driver?.name && <div className="mp-driver">{truck.driver.name}</div>}
          <div className="mp-metrics">
            <div className="mp-metric">
              <span className="mp-icon">⚡</span>
              <span className="mp-val">{truck.speed.toFixed(0)}</span>
              <span className="mp-unit">km/h</span>
            </div>
            <div className="mp-metric">
              <span className="mp-icon">⛽</span>
              <span className="mp-val">{truck.fuel.toFixed(0)}</span>
              <span className="mp-unit">%</span>
            </div>
            <div className="mp-metric">
              <span className="mp-icon">🌡</span>
              <span className="mp-val">{truck.temperature.toFixed(0)}</span>
              <span className="mp-unit">°F</span>
            </div>
          </div>
          {truck.heading != null && (
            <div className="mp-heading">↑ {truck.heading}° · {['N','NE','E','SE','S','SW','W','NW'][Math.round(truck.heading / 45) % 8]}</div>
          )}
        </div>
      </Popup>
    </Marker>
  )
})

// ── Sparkline ─────────────────────────────────────────────────────────────────
function Sparkline({ data, color = '#22c55e', width = 120, height = 36, maxVal }) {
  if (!data || data.length < 2) return <div style={{ width, height }} />
  const min = 0
  const max = maxVal ? maxVal : Math.max(...data, 1)
  const range = max - min || 1
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width
    const y = height - 4 - ((v - min) / range) * (height - 8)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  const area = `0,${height} ${pts} ${width},${height}`
  const gid = `sg${color.replace(/[^a-z0-9]/gi, '')}`
  const lastPt = pts.split(' ').pop()?.split(',') || []
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ overflow: 'visible', display: 'block' }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gid})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      {lastPt.length === 2 && <circle cx={lastPt[0]} cy={lastPt[1]} r="3" fill={color} />}
    </svg>
  )
}

// ── Trend chart ───────────────────────────────────────────────────────────────
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
      <text x={PL + 10} y={8} fill="rgba(148,163,184,.75)" fontSize="8" fontFamily="Inter">Speed (km/h)</text>
      <rect x={PL + 78} y={2} width="7" height="7" fill="#22c55e" rx="1" />
      <text x={PL + 88} y={8} fill="rgba(148,163,184,.75)" fontSize="8" fontFamily="Inter">Fuel (%)</text>
      <rect x={PL + 148} y={2} width="7" height="7" fill="#f59e0b" rx="1" />
      <text x={PL + 158} y={8} fill="rgba(148,163,184,.75)" fontSize="8" fontFamily="Inter">Temp (°F)</text>
    </svg>
  )
}

// ── Score ring ────────────────────────────────────────────────────────────────
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

// ── Leaderboard modal ─────────────────────────────────────────────────────────
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

// ── Settings modal ────────────────────────────────────────────────────────────
function SettingsModal({ settings, onChange, onClose }) {
  const [local, setLocal] = useState({ ...DEFAULT_SETTINGS, ...settings })
  const upd = (key, val) => setLocal(prev => ({ ...prev, [key]: val }))
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">⚙️ Alert Thresholds</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="settings-body">
          <div className="setting-row">
            <div className="setting-meta">
              <div className="setting-label">Speed Alert</div>
              <div className="setting-desc">Fire alert when truck exceeds this speed</div>
            </div>
            <div className="setting-control">
              <input type="range" min={60} max={160} step={5} value={local.speedThreshold}
                onChange={e => upd('speedThreshold', +e.target.value)} className="setting-slider" />
              <span className="setting-val" style={{ color: 'var(--red)' }}>{local.speedThreshold} km/h</span>
            </div>
          </div>
          <div className="setting-row">
            <div className="setting-meta">
              <div className="setting-label">Low Fuel Alert</div>
              <div className="setting-desc">Fire alert when fuel drops below this level</div>
            </div>
            <div className="setting-control">
              <input type="range" min={5} max={50} step={5} value={local.fuelThreshold}
                onChange={e => upd('fuelThreshold', +e.target.value)} className="setting-slider" />
              <span className="setting-val" style={{ color: 'var(--amber)' }}>{local.fuelThreshold}%</span>
            </div>
          </div>
          <div className="setting-row">
            <div className="setting-meta">
              <div className="setting-label">Engine Temp Alert</div>
              <div className="setting-desc">Fire alert when engine temp exceeds this value</div>
            </div>
            <div className="setting-control">
              <input type="range" min={190} max={250} step={5} value={local.tempThreshold}
                onChange={e => upd('tempThreshold', +e.target.value)} className="setting-slider" />
              <span className="setting-val" style={{ color: 'var(--amber)' }}>{local.tempThreshold}°F</span>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="settings-reset" onClick={() => setLocal({ ...DEFAULT_SETTINGS })}>Reset Defaults</button>
          <button className="settings-save" onClick={() => { onChange(local); onClose() }}>Save &amp; Apply</button>
        </div>
      </div>
    </div>
  )
}

// ── Message templates modal ───────────────────────────────────────────────────
function MessageModal({ truck, onClose }) {
  const [copied, setCopied] = useState(null)
  const sendSMS = (tpl) => {
    if (truck.driver?.phone) window.open(`sms:${truck.driver.phone}?body=${encodeURIComponent(tpl.text)}`)
  }
  const copy = (tpl) => {
    navigator.clipboard?.writeText(tpl.text).catch(() => {})
    setCopied(tpl.id)
    setTimeout(() => setCopied(null), 2000)
  }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="message-panel" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">💬 Message Driver</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        {truck.driver && (
          <div className="msg-driver-info">
            <span className="msg-driver-photo">
              <img src={truck.driver.photo} alt={truck.driver.name} onError={e => { e.target.style.display='none'; e.target.nextSibling.style.display='flex' }} />
              <span className="driver-photo-fallback" style={{ display: 'none' }}>{truck.driver.name[0]}</span>
            </span>
            <div>
              <div className="msg-driver-name">{truck.driver.name}</div>
              <div className="msg-driver-sub">{truck.licensePlate} · {truck.driver.phone || 'No phone on record'}</div>
            </div>
          </div>
        )}
        <div className="msg-templates">
          {MSG_TEMPLATES.map(tpl => (
            <div key={tpl.id} className="msg-tpl">
              <div className="msg-tpl-top">
                <span className="msg-tpl-label">{tpl.label}</span>
                <div className="msg-tpl-actions">
                  <button className="msg-copy-btn" onClick={() => copy(tpl)}>
                    {copied === tpl.id ? '✓ Copied' : '📋 Copy'}
                  </button>
                  {truck.driver?.phone && (
                    <button className="msg-sms-btn" onClick={() => sendSMS(tpl)}>📱 SMS</button>
                  )}
                </div>
              </div>
              <div className="msg-tpl-text">{tpl.text}</div>
            </div>
          ))}
        </div>
        {!truck.driver?.phone && (
          <div className="msg-no-phone">⚠️ No phone number on record for this driver. Use Copy to share via other channels.</div>
        )}
      </div>
    </div>
  )
}

// ── Help modal ────────────────────────────────────────────────────────────────
function HelpModal({ onClose }) {
  const shortcuts = [
    { key: '1 – 5', desc: 'Select truck by number' },
    { key: 'B', desc: 'Open Fleet Command Brief' },
    { key: 'D', desc: 'Open dispatch board' },
    { key: 'F', desc: 'Toggle fullscreen ops map' },
    { key: 'P', desc: 'Export PDF fleet report' },
    { key: 'E', desc: 'Export fleet data as CSV' },
    { key: 'L', desc: 'Toggle driver leaderboard' },
    { key: 'O', desc: 'AI route optimization engine' },
    { key: 'M', desc: 'Predictive maintenance intelligence' },
    { key: 'V', desc: 'Fleet financial intelligence (P&L)' },
    { key: 'G', desc: 'Open CO₂ emissions dashboard' },
    { key: 'X', desc: 'Activate emergency SOS protocol' },
    { key: 'H', desc: 'Open alert history log' },
    { key: 'T', desc: 'Switch Tracking (FMS) ⇄ Operations (TMS)' },
    { key: 'W', desc: 'Fleet monitoring — fuel · speed · weight' },
    { key: 'R', desc: 'Trip playback drawer' },
    { key: 'Z', desc: 'Geofence zones drawer' },
    { key: 'C', desc: 'Connect external GPS provider' },
    { key: 'S', desc: 'Toggle sound alerts on / off' },
    { key: '⌘K  /', desc: 'Open command palette' },
    { key: ',', desc: 'Open alert threshold settings' },
    { key: 'Esc', desc: 'Close any open panel' },
  ]
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="help-panel" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">⌨️ Keyboard Shortcuts</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="help-list">
          {shortcuts.map(s => (
            <div key={s.key} className="help-row">
              <kbd className="kbd">{s.key}</kbd>
              <span>{s.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Command palette ───────────────────────────────────────────────────────────
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
                      {t.speed > ST ? `⚡ ${t.speed.toFixed(0)} km/h` : t.status}
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

// ── Alert history log modal ───────────────────────────────────────────────────
function AlertLogModal({ log, onClear, onClose }) {
  const colorMap = { speed: 'var(--red)', fuel: 'var(--amber)', temp: 'var(--red)', geo: 'var(--accent)', snooze: 'var(--text-dim)', ack: 'var(--green)' }
  const iconMap  = { speed: '⚡', fuel: '⛽', temp: '🌡️', geo: '📍', snooze: '⏸', ack: '✓' }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="log-panel" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">📋 Session Alert Log</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{log.length} event{log.length !== 1 ? 's' : ''} this session</span>
            {log.length > 0 && <button className="log-clear-btn" onClick={onClear}>Clear all</button>}
            <button className="modal-close" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="log-body">
          {log.length === 0
            ? <div className="log-empty">✅ No alerts this session — fleet running clean.</div>
            : log.map(e => (
              <div key={e.id} className="log-entry">
                <span className="log-icon" style={{ color: colorMap[e.type] || 'var(--text-dim)' }}>
                  {iconMap[e.type] || '•'}
                </span>
                <div className="log-content">
                  <div className="log-msg">{e.msg}</div>
                  {e.plate && <div className="log-plate">{e.plate}</div>}
                </div>
                <div className="log-time">{e.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
              </div>
            ))
          }
        </div>
      </div>
    </div>
  )
}

// ── Cost Analytics modal ──────────────────────────────────────────────────────
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

// ── Smart truck scoring for dispatch ─────────────────────────────────────────
function scoreTruckForJob(truck, speedThreshold) {
  if (truck.status === 'maintenance') return { score: 0, grade: 'F', pros: [], cons: ['In maintenance — unavailable'] }
  let score = 100
  const pros = [], cons = []
  // Fuel
  if (truck.fuel < 15)      { score -= 35; cons.push(`Critical fuel (${truck.fuel.toFixed(0)}%) — needs refueling first`) }
  else if (truck.fuel < 25) { score -= 18; cons.push(`Low fuel (${truck.fuel.toFixed(0)}%) — plan a fuel stop en route`) }
  else if (truck.fuel > 70) pros.push(`Excellent fuel level (${truck.fuel.toFixed(0)}%)`)
  // Safety score
  const sb = Math.round(((truck.safetyScore || 50) - 65) / 35 * 15)
  score += Math.max(-15, Math.min(15, sb))
  if (sb > 8)  pros.push(`Strong safety score (${truck.safetyScore}/100)`)
  else if (sb < -5) cons.push(`Low safety score (${truck.safetyScore}/100) — higher incident risk`)
  // Speeding
  if (truck.speed > speedThreshold) { score -= 22; cons.push(`Currently speeding (${truck.speed.toFixed(0)} km/h) — compliance risk`) }
  // Engine temp
  if (truck.temperature > 215) { score -= 12; cons.push(`Elevated engine temp (${truck.temperature.toFixed(0)}°F)`) }
  // DTCs
  if (truck.activeDTCs?.length > 0) {
    const p = Math.min(truck.activeDTCs.length * 10, 25); score -= p
    cons.push(`${truck.activeDTCs.length} active fault code${truck.activeDTCs.length > 1 ? 's' : ''} — inspect before dispatch`)
  }
  // Availability bonus
  if (truck.status === 'idle')        { score += 12; pros.push('Idle and immediately available') }
  else if (truck.status === 'active') { score += 4;  pros.push('Currently active and on-road') }
  // Driver rating
  const rating = truck.driver?.rating || 4.0
  if (rating >= 4.7)  { score += 8; pros.push(`Top-rated driver (${rating}★)`) }
  else if (rating < 4.0) { score -= 5; cons.push(`Below-average driver rating (${rating}★)`) }
  // Battery
  if ((truck.batteryVoltage || 12.6) < 11.8) { score -= 8; cons.push('Low battery voltage — risk of electrical issues') }
  score = Math.max(0, Math.min(100, Math.round(score)))
  const grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'F'
  return { score, grade, pros, cons }
}

function getDriverGrade(safetyScore) {
  if (safetyScore >= 92) return { grade: 'A+', color: 'var(--green)', label: 'Exceptional', emoji: '🏆' }
  if (safetyScore >= 80) return { grade: 'A',  color: 'var(--green)', label: 'Excellent',   emoji: '✅' }
  if (safetyScore >= 70) return { grade: 'B',  color: '#84cc16', label: 'Good',         emoji: '👍' }
  if (safetyScore >= 58) return { grade: 'C',  color: 'var(--amber)', label: 'Fair',         emoji: '⚠️' }
  if (safetyScore >= 45) return { grade: 'D',  color: 'var(--amber)', label: 'Needs coaching','emoji': '📉' }
  return { grade: 'F', color: 'var(--red)', label: 'Review required', emoji: '🚨' }
}

// ── Dispatch Board modal ───────────────────────────────────────────────────────
function DispatchBoard({ trucks, jobs, onAssign, onStatusChange, onAddJob, onClose, ST = 70, embedded = false }) {
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ title: '', from: '', to: '', priority: 'normal', eta: '' })
  const cols = [
    { key: 'pending',  label: 'Unassigned', icon: '🕐', cls: 'pend' },
    { key: 'enroute',  label: 'En Route',   icon: '🚛', cls: 'enrt' },
    { key: 'complete', label: 'Completed',  icon: '✅', cls: 'comp' },
  ]
  const pColors = { high: 'var(--red)', normal: 'var(--amber)', low: 'var(--text-dim)' }
  const pLabels = { high: '🔴 High', normal: '🟡 Normal', low: '⚪ Low' }
  const assignedIds = new Set(jobs.filter(j => j.truckId && j.status === 'enroute').map(j => j.truckId))
  const availableTrucks = trucks.filter(t => !assignedIds.has(t.id))
  const submitJob = () => {
    if (!form.title.trim() || !form.to.trim()) return
    onAddJob({ ...form, id: `J${Date.now()}`, status: 'pending', truckId: null, from: form.from || 'Depot' })
    setForm({ title: '', from: '', to: '', priority: 'normal', eta: '' })
    setShowForm(false)
  }

  const board = (
      <div className="dispatch-panel" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">📋 Dispatch Board</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
              {jobs.filter(j => j.status === 'enroute').length} en route · {jobs.filter(j => j.status === 'pending').length} pending
            </span>
            {!embedded && <button className="modal-close" onClick={onClose}>✕</button>}
          </div>
        </div>
        <div className="dispatch-cols">
          {cols.map(col => (
            <div key={col.key} className={`dispatch-col dc-${col.cls}`}>
              <div className="dc-head">
                <span className="dc-icon">{col.icon}</span>
                <span className="dc-label">{col.label}</span>
                <span className="dc-count">{jobs.filter(j => j.status === col.key).length}</span>
                {col.key === 'pending' && (
                  <button className="dc-add-btn" onClick={() => setShowForm(p => !p)} title="Add new job">
                    {showForm ? '✕' : '＋'}
                  </button>
                )}
              </div>
              {col.key === 'pending' && showForm && (
                <div className="add-job-form">
                  <input className="ajf-input" placeholder="Job title *" value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} />
                  <input className="ajf-input" placeholder="From location" value={form.from} onChange={e => setForm(p => ({ ...p, from: e.target.value }))} />
                  <input className="ajf-input" placeholder="To location *" value={form.to} onChange={e => setForm(p => ({ ...p, to: e.target.value }))} />
                  <div className="ajf-row">
                    <select className="ajf-sel" value={form.priority} onChange={e => setForm(p => ({ ...p, priority: e.target.value }))}>
                      <option value="high">🔴 High</option>
                      <option value="normal">🟡 Normal</option>
                      <option value="low">⚪ Low</option>
                    </select>
                    <input className="ajf-input ajf-eta" placeholder="ETA (e.g. 14:30)" value={form.eta} onChange={e => setForm(p => ({ ...p, eta: e.target.value }))} />
                  </div>
                  <button className="ajf-submit" onClick={submitJob}>＋ Add Job</button>
                </div>
              )}
              <div className="dc-cards">
                {jobs.filter(j => j.status === col.key).map(job => {
                  const truck = trucks.find(t => t.id === job.truckId)
                  return (
                    <div key={job.id} className={`job-card jc-${col.cls}`}>
                      <div className="jc-top">
                        <span className="jc-title">{job.title}</span>
                        <span className="jc-priority" style={{ color: pColors[job.priority] }}>{pLabels[job.priority]}</span>
                      </div>
                      <div className="jc-route">
                        <div className="jc-from"><span className="jc-dot from" />From: {job.from}</div>
                        <div className="jc-to"><span className="jc-dot to" />To: {job.to}</div>
                      </div>
                      <div className="jc-meta">
                        <span className="jc-eta">🕐 ETA {job.eta}</span>
                        {truck && <span className="jc-truck">🚛 {truck.licensePlate} — {truck.driver?.name?.split(' ')[0]}</span>}
                      </div>
                      {col.key === 'pending' && (
                        <div className="jc-actions">
                          {availableTrucks.length === 0
                            ? <div className="sd-none">All trucks currently assigned to active jobs</div>
                            : (() => {
                                const ranked = availableTrucks
                                  .map(t => ({ truck: t, ...scoreTruckForJob(t, ST) }))
                                  .sort((a, b) => b.score - a.score)
                                return (
                                  <div className="smart-dispatch">
                                    <div className="sd-header">
                                      <span className="sd-label">AI DISPATCH RECOMMENDATION</span>
                                      <span className="sd-sub">{ranked.length} truck{ranked.length !== 1 ? 's' : ''} scored</span>
                                    </div>
                                    {ranked.slice(0, 3).map((item, idx) => {
                                      const scoreColor = item.score >= 75 ? 'var(--green)' : item.score >= 55 ? 'var(--amber)' : 'var(--red)'
                                      return (
                                        <div key={item.truck.id} className={`sd-truck ${idx === 0 ? 'sd-best' : ''}`}>
                                          <div className="sd-row1">
                                            {idx === 0 && <span className="sd-badge">BEST MATCH</span>}
                                            <span className="sd-plate">{item.truck.licensePlate}</span>
                                            <span className="sd-score" style={{ color: scoreColor }}>
                                              {item.score}/100 · {item.grade}
                                            </span>
                                          </div>
                                          <div className="sd-driver">
                                            {item.truck.driver?.name} · ⛽ {item.truck.fuel.toFixed(0)}% · ★ {item.truck.driver?.rating}
                                          </div>
                                          {item.pros[0] && <div className="sd-pro">✓ {item.pros[0]}</div>}
                                          {item.cons[0] && <div className="sd-con">✗ {item.cons[0]}</div>}
                                          <button className={`sd-assign ${idx === 0 ? 'sd-assign-best' : ''}`}
                                            onClick={() => onAssign(job.id, item.truck.id)}>
                                            {idx === 0 ? '⚡ Assign (Recommended)' : `Assign ${item.truck.licensePlate}`}
                                          </button>
                                        </div>
                                      )
                                    })}
                                    {ranked.length > 3 && (
                                      <div style={{ fontSize: 10, color: 'var(--text-dim)', textAlign: 'center', padding: '4px 0' }}>
                                        + {ranked.length - 3} more available
                                      </div>
                                    )}
                                  </div>
                                )
                              })()
                          }
                        </div>
                      )}
                      {col.key === 'enroute' && (
                        <div className="jc-actions">
                          <button className="jc-complete-btn" onClick={() => onStatusChange(job.id, 'complete')}>✓ Mark Complete</button>
                          <button className="jc-unassign-btn" onClick={() => onAssign(job.id, null)}>✕ Unassign</button>
                        </div>
                      )}
                    </div>
                  )
                })}
                {jobs.filter(j => j.status === col.key).length === 0 && (
                  <div className="dc-empty">No {col.label.toLowerCase()} jobs</div>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="modal-footer">
          <span className="kb-hint">Press <kbd>D</kbd> to toggle · <kbd>Esc</kbd> to close</span>
          <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>
            {trucks.length} trucks · {jobs.filter(j => j.status !== 'complete').length} active jobs
          </span>
        </div>
      </div>
  )
  if (embedded) return board
  return (
    <div className="modal-overlay" onClick={onClose}>
      {board}
    </div>
  )
}

// ── Offline AI briefing generator ────────────────────────────────────────────
function buildDemoAnalysis(trucks, ST, FT, TT, fleetHealth, alertLog, idleStartTimes) {
  if (!trucks.length) return 'No trucks in fleet.'
  const speeders  = trucks.filter(t => t.speed > ST)
  const lowFuel   = trucks.filter(t => t.fuel < FT)
  const overTemp  = trucks.filter(t => t.temperature > TT)
  const idleList  = trucks.filter(t => t.status === 'idle')
  const dtcList   = trucks.filter(t => (t.activeDTCs?.length || 0) > 0)
  const avgFuel   = Math.round(trucks.reduce((s, t) => s + t.fuel, 0) / trucks.length)
  const totalRef  = Math.round(trucks.reduce((s, t) => s + ((100 - t.fuel) / 100) * TANK_LITRES * FUEL_PRICE_SAR, 0))
  const best  = trucks.reduce((b, t) => (t.safetyScore || 0) > (b?.safetyScore || 0) ? t : b, null)
  const worst = trucks.reduce((b, t) => (t.safetyScore || 100) < (b?.safetyScore || 100) ? t : b, null)
  const idleWaste = Object.keys(idleStartTimes).reduce((s, id) => {
    const m = Math.floor((Date.now() - idleStartTimes[id]) / 60000)
    return s + (m > 0 ? (m / 60) * 3 * FUEL_PRICE_SAR : 0)
  }, 0)

  const lines = [`📊 FLEET BRIEFING — ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}\n`]
  const statusWord = fleetHealth >= 80 ? 'NOMINAL' : fleetHealth >= 55 ? 'DEGRADED' : 'CRITICAL'
  lines.push(`Fleet health is ${statusWord} at ${fleetHealth}/100. ${trucks.length} trucks tracked — ${trucks.filter(t => t.status === 'active').length} active, ${idleList.length} idle.\n`)

  if (speeders.length > 0) {
    lines.push(`⚡ SPEEDING (${speeders.length}): ${speeders.map(t => `${t.licensePlate} ${t.speed.toFixed(0)} km/h (${t.driver?.name?.split(' ')[0] || '–'})`).join(' · ')}. Send immediate slow-down message.\n`)
  } else {
    lines.push(`✅ Speed compliance: All ${trucks.length} trucks within limits.\n`)
  }

  if (lowFuel.length > 0) {
    const emergency = lowFuel.reduce((s, t) => s + ((FT * 2 - t.fuel) / 100) * TANK_LITRES * FUEL_PRICE_SAR, 0)
    lines.push(`⛽ LOW FUEL (${lowFuel.length}): ${lowFuel.map(t => `${t.licensePlate} at ${t.fuel.toFixed(0)}%`).join(', ')}. SAR ${Math.round(emergency)} needed to reach safe levels.\n`)
  }

  if (overTemp.length > 0) {
    lines.push(`🌡️ HIGH TEMP (${overTemp.length}): ${overTemp.map(t => `${t.licensePlate} at ${t.temperature.toFixed(0)}°F`).join(', ')}. Risk of engine damage — pull over if sustained.\n`)
  }

  if (dtcList.length > 0) {
    lines.push(`⚠️ FAULT CODES: ${dtcList.map(t => `${t.licensePlate} — ${t.activeDTCs.map(d => d.code).join(', ')}`).join('; ')}. Workshop inspection required.\n`)
  }

  if (idleWaste > 0.5) {
    lines.push(`⏸ IDLE WASTE: SAR ${idleWaste.toFixed(2)} burned in idle fuel this session. Dispatch idle trucks or shut down engines to reduce cost.\n`)
  }

  if (best && worst && best.id !== worst.id) {
    lines.push(`🏆 DRIVERS: Top performer — ${best.driver?.name || best.licensePlate} (score ${best.safetyScore}). Needs coaching — ${worst.driver?.name || worst.licensePlate} (score ${worst.safetyScore}).\n`)
  }

  lines.push(`💰 COST SUMMARY: SAR ${totalRef.toLocaleString()} to fully refuel fleet (avg ${avgFuel}% remaining). ${alertLog.length} alerts logged this session.`)
  return lines.join('')
}

// ── Fleet Analytics chart panel ────────────────────────────────────────────────
function FleetAnalytics({ trucks, ST, FT }) {
  const [tab, setTab] = useState('fuel')
  if (!trucks.length) return null

  const byFuel   = [...trucks].sort((a, b) => b.fuel - a.fuel)
  const byScore  = [...trucks].sort((a, b) => (b.safetyScore || 0) - (a.safetyScore || 0))
  const bySpeed  = [...trucks].sort((a, b) => b.speed - a.speed)
  const fuelAvg  = Math.round(trucks.reduce((s, t) => s + t.fuel, 0) / trucks.length)
  const scoreAvg = Math.round(trucks.reduce((s, t) => s + (t.safetyScore || 0), 0) / trucks.length)
  const speedAvg = Math.round(trucks.reduce((s, t) => s + t.speed, 0) / trucks.length)

  const tabs = [
    { id: 'fuel',   label: '⛽ Fuel',   avg: `${fuelAvg}% avg` },
    { id: 'safety', label: '🛡️ Safety', avg: `${scoreAvg} avg` },
    { id: 'speed',  label: '🚗 Speed',  avg: `${speedAvg} km/h avg` },
  ]

  return (
    <div className="analytics-panel" role="region" aria-label="Fleet analytics">
      <div className="analytics-head">
        <div className="analytics-tabs" role="tablist">
          {tabs.map(t => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`analytics-tab${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              <span className="analytics-tab-avg">{t.avg}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="analytics-body" role="tabpanel">
        {tab === 'fuel' && byFuel.map(t => {
          const fc = t.fuel < FT ? 'var(--red)' : t.fuel < FT * 2 ? 'var(--amber)' : 'var(--green)'
          return (
            <div key={t.id} className="bar-row">
              <div className="bar-label" title={t.driver?.name}>{t.licensePlate}</div>
              <div className="bar-track" role="meter" aria-valuenow={Math.round(t.fuel)} aria-valuemin={0} aria-valuemax={100} aria-label={`${t.licensePlate} fuel ${t.fuel.toFixed(0)}%`}>
                <div className="bar-fill" style={{ width: `${Math.min(100, t.fuel)}%`, background: fc, transition: 'width .4s ease' }} />
                <div className="bar-avg-line" style={{ left: `${fuelAvg}%` }} title={`Fleet avg: ${fuelAvg}%`} />
              </div>
              <div className="bar-val" style={{ color: fc }}>{t.fuel.toFixed(0)}%</div>
            </div>
          )
        })}
        {tab === 'safety' && byScore.map(t => {
          const sc = t.safetyScore || 0
          const sc_c = sc >= 80 ? 'var(--green)' : sc >= 55 ? 'var(--amber)' : 'var(--red)'
          return (
            <div key={t.id} className="bar-row">
              <div className="bar-label" title={t.licensePlate}>{t.driver?.name?.split(' ')[0] || t.licensePlate}</div>
              <div className="bar-track" role="meter" aria-valuenow={sc} aria-valuemin={0} aria-valuemax={100}>
                <div className="bar-fill" style={{ width: `${sc}%`, background: sc_c, transition: 'width .4s ease' }} />
                <div className="bar-avg-line" style={{ left: `${scoreAvg}%` }} title={`Fleet avg: ${scoreAvg}`} />
              </div>
              <div className="bar-val" style={{ color: sc_c }}>{sc}</div>
            </div>
          )
        })}
        {tab === 'speed' && bySpeed.map(t => {
          const sp_c = t.speed > ST ? 'var(--red)' : t.speed > ST * 0.85 ? 'var(--amber)' : 'var(--green)'
          return (
            <div key={t.id} className="bar-row">
              <div className="bar-label">{t.licensePlate}</div>
              <div className="bar-track" role="meter" aria-valuenow={Math.round(t.speed)} aria-valuemin={0} aria-valuemax={120}>
                <div className="bar-fill" style={{ width: `${Math.min(100, (t.speed / 120) * 100)}%`, background: sp_c, transition: 'width .4s ease' }} />
                <div className="bar-avg-line" style={{ left: `${(ST / 120) * 100}%` }} title={`Speed limit: ${ST} km/h`} />
              </div>
              <div className="bar-val" style={{ color: sp_c }}>{t.speed.toFixed(0)}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Driver Coaching Panel ─────────────────────────────────────────────────────
function DriverCoachPanel({ truck, idleDuration, shiftMins, ST, FT, TT, onSendMessage }) {
  const { grade, color, label, emoji } = getDriverGrade(truck.safetyScore || 0)

  const tips = useMemo(() => {
    const tips = []
    // Speeding tip
    if (truck.speed > ST) {
      const excess = truck.speed - ST
      const monthlyFuelWaste = Math.round(excess * 0.4 * FUEL_PRICE_SAR * 260)
      tips.push({
        sev: 'red', icon: '⚡', title: 'Excessive Speed',
        impact: `SAR ${monthlyFuelWaste.toLocaleString()}/month in excess fuel`,
        detail: `${truck.speed.toFixed(0)} km/h — ${excess.toFixed(0)} km/h over limit. Higher speed increases fuel burn 25–40% and raises accident risk 3×. Insurance premium risk if violations are recorded.`,
        action: { label: 'Send Speed Warning', key: 'speed' }
      })
    }
    // Harsh braking
    if ((truck.safety?.harshBraking || 0) >= 3) {
      const events = truck.safety.harshBraking
      tips.push({
        sev: 'amber', icon: '🛑', title: 'Frequent Harsh Braking',
        impact: `SAR ${Math.round(events * 18)}/month tyre wear + SAR ${Math.round(events * 5)}/event fuel spike`,
        detail: `${events} harsh braking events recorded. Each event increases tyre wear, wastes fuel (2–4% per event), and creates injury liability. Encourage anticipatory driving — look 12 seconds ahead.`,
        action: { label: 'Send Coaching Note', key: 'safety' }
      })
    }
    // Idle tip
    if (idleDuration > 5) {
      const idleHrs = idleDuration / 60
      const idleCost = (idleHrs * 3 * FUEL_PRICE_SAR).toFixed(2)
      const monthlyProjection = Math.round(idleHrs * 3 * FUEL_PRICE_SAR * 22)
      tips.push({
        sev: 'amber', icon: '⏸', title: 'Prolonged Engine Idle',
        impact: `SAR ${idleCost} this session · SAR ${monthlyProjection.toLocaleString()}/month if daily`,
        detail: `Engine has been idling for ${idleDuration} minutes. Idle burns ~3L/hr with zero productivity. Rule: turn off engine if stopped >3 minutes. Also accelerates engine wear by the equivalent of 80km of driving per hour idle.`,
        action: { label: 'Send Idle Reminder', key: 'return' }
      })
    }
    // DTC tip
    if (truck.activeDTCs?.length > 0) {
      const dtc = truck.activeDTCs[0]
      tips.push({
        sev: 'red', icon: '⚠️', title: `Active Fault: ${dtc.code}`,
        impact: 'Est. SAR 3,500–8,000 engine damage if driven without repair',
        detail: `${dtc.desc}. Operating with active fault codes voids warranty, risks catastrophic engine failure, and may trigger roadside inspection fines. Schedule workshop visit immediately.`,
        action: { label: 'Send Safety Check', key: 'safety' }
      })
    }
    // Shift hours
    if (shiftMins > 480) {
      const hrs = Math.floor(shiftMins / 60)
      const mins = shiftMins % 60
      tips.push({
        sev: shiftMins >= 600 ? 'red' : 'amber', icon: '⏱', title: 'Extended Shift Hours',
        impact: 'Fatigue accidents 2–3× more likely after 8 hours',
        detail: `${truck.driver?.name?.split(' ')[0] || 'Driver'} has been on shift ${hrs}h ${mins}m. Saudi traffic law limits driving to 10h/day. Fatigue is a factor in 20% of all HGV accidents. Plan a mandatory rest break or rotation.`,
        action: { label: 'Send Return Message', key: 'return' }
      })
    }
    // High temp tip
    if (truck.temperature > TT) {
      tips.push({
        sev: 'red', icon: '🌡️', title: 'Engine Overheating',
        impact: 'SAR 12,000–45,000 engine replacement if seizure occurs',
        detail: `Engine temperature at ${truck.temperature.toFixed(0)}°F — above safe operating range. Continued driving risks coolant boil-off, head gasket failure, or complete engine seizure. Pull over and idle down immediately.`,
        action: { label: 'Send Safety Check', key: 'safety' }
      })
    }
    // Rapid acceleration
    if ((truck.safety?.rapidAcceleration || 0) >= 3) {
      tips.push({
        sev: 'amber', icon: '⚡', title: 'Aggressive Acceleration',
        impact: `SAR ${Math.round(truck.safety.rapidAcceleration * 8)}/day additional fuel`,
        detail: `${truck.safety.rapidAcceleration} rapid acceleration events. Aggressive acceleration increases fuel consumption 15–30% and strains the drivetrain. Smooth progressive acceleration saves fuel and reduces wear.`,
        action: null
      })
    }
    if (tips.length === 0) {
      tips.push({
        sev: 'green', icon: '✅', title: 'All Systems Nominal',
        impact: 'Estimated savings vs fleet avg: SAR 340/month',
        detail: `${truck.driver?.name?.split(' ')[0] || 'Driver'} is operating within all safety, compliance, and efficiency parameters. Speed, fuel handling, idle time, and driving behaviour are all at acceptable levels. Excellent work!`,
        action: null
      })
    }
    return tips
  }, [truck, idleDuration, shiftMins, ST, FT, TT])

  const totalImpact = tips.filter(t => t.sev !== 'green').length

  return (
    <div className="coach-panel">
      {/* Grade header */}
      <div className="coach-head">
        <div className="coach-grade" style={{ color, borderColor: color + '40', background: color + '10' }}>
          {emoji} {grade}
        </div>
        <div className="coach-meta">
          <div className="coach-name">{truck.driver?.name || truck.licensePlate}</div>
          <div className="coach-score-row">
            <div className="coach-score-bar">
              <div className="coach-score-fill" style={{ width: `${truck.safetyScore || 0}%`, background: color }} />
            </div>
            <span className="coach-score-val" style={{ color }}>{truck.safetyScore || 0}/100 · {label}</span>
          </div>
          <div className="coach-issues">
            {totalImpact === 0 ? '✅ No active issues' : `${totalImpact} issue${totalImpact > 1 ? 's' : ''} requiring attention`}
          </div>
        </div>
      </div>

      {/* Benchmarks */}
      <div className="coach-bench">
        <div className="cb-item">
          <span className="cb-label">Safety rank</span>
          <span className="cb-val" style={{ color }}>#{ Math.round((100 - (truck.safetyScore||0)) / 20) + 1 } / fleet</span>
        </div>
        <div className="cb-item">
          <span className="cb-label">Rating</span>
          <span className="cb-val">★ {truck.driver?.rating || 'N/A'}</span>
        </div>
        <div className="cb-item">
          <span className="cb-label">Experience</span>
          <span className="cb-val">{truck.driver?.experience || 'N/A'}</span>
        </div>
      </div>

      {/* Tips */}
      <div className="coach-tips">
        {tips.map((tip, i) => (
          <div key={i} className={`coach-tip tip-${tip.sev}`}>
            <div className="ct-top">
              <span className="ct-icon">{tip.icon}</span>
              <div>
                <div className="ct-title">{tip.title}</div>
                <div className="ct-impact">💰 {tip.impact}</div>
              </div>
            </div>
            <div className="ct-detail">{tip.detail}</div>
            {tip.action && (
              <button className={`ct-action ct-action-${tip.sev}`} onClick={() => onSendMessage(tip.action.key)}>
                💬 {tip.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Map click handler (for adding geofence zones) ─────────────────────────────
function MapClickHandler({ onMapClick, active }) {
  useMapEvents({ click: (e) => { if (active) onMapClick(e.latlng) } })
  return null
}

// ── Zone naming modal — replaces window.prompt() ──────────────────────────────
const ZONE_COLORS = ['#6366f1','#22c55e','#f59e0b','#ef4444','#a855f7','#22d3ee']
function ZoneNameModal({ latlng, shape = 'circle', pointCount = 0, onConfirm, onCancel }) {
  const [name, setName] = useState('')
  const [radius, setRadius] = useState(800)
  const [color, setColor] = useState(ZONE_COLORS[0])
  const inputRef = useRef(null)
  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 50) }, [])
  const submit = () => { if (name.trim()) onConfirm(name.trim(), radius, color) }
  return (
    <div className="zone-modal-overlay" onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="zone-modal">
        <div className="zone-modal-head">
          <span className="zone-modal-title">{shape === 'polygon' ? '⬠ New Polygon Zone' : '📍 New Zone'}</span>
          <span className="zone-modal-coords">
            {shape === 'polygon' ? `${pointCount} corners` : `${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`}
          </span>
        </div>
        <input
          ref={inputRef}
          className="zone-modal-input"
          placeholder='Zone name (e.g. "Depot A", "Restricted Area")'
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel() }}
          maxLength={40}
        />
        {shape === 'circle' && (
          <div className="zone-modal-row">
            <span className="zone-modal-label">Radius</span>
            <input
              type="range" min={200} max={3000} step={100}
              value={radius} onChange={e => setRadius(+e.target.value)}
              className="zone-modal-slider"
            />
            <span className="zone-modal-rval">
              {radius >= 1000 ? `${(radius/1000).toFixed(1)} km` : `${radius} m`}
            </span>
          </div>
        )}
        <div className="zone-modal-row">
          <span className="zone-modal-label">Color</span>
          <div className="zone-modal-colors">
            {ZONE_COLORS.map(c => (
              <button key={c} className={`zone-color-swatch${color === c ? ' zcs-sel' : ''}`}
                style={{ background: c }} onClick={() => setColor(c)} />
            ))}
          </div>
        </div>
        <div className="zone-modal-actions">
          <button className="zone-modal-cancel" onClick={onCancel}>Cancel</button>
          <button className="zone-modal-confirm" onClick={submit} disabled={!name.trim()}>
            Add Zone
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Toast container ───────────────────────────────────────────────────────────
const ToastContainer = memo(function ToastContainer({ toasts, onDismiss }) {
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.type}`} onClick={() => onDismiss(t.id)}>
          <span>{t.msg}</span><span className="toast-x">×</span>
        </div>
      ))}
    </div>
  )
})

// ── Real AI: build system prompt from live fleet data ────────────────────────
function buildFleetSystemPrompt(trucks, jobs, alertLog, ST, FT, TT, fleetHealth, idleStartTimes) {
  const speeders = trucks.filter(t => t.speed > ST)
  const lowFuel  = trucks.filter(t => t.fuel < FT)
  const overTemp = trucks.filter(t => t.temperature > TT)
  const idling   = trucks.filter(t => t.status === 'idle')
  const pending  = (jobs||[]).filter(j => j.status === 'pending')
  const enroute  = (jobs||[]).filter(j => j.status === 'enroute')

  const truckLines = trucks.map(t => {
    const idleMin = t.status === 'idle' && (idleStartTimes||{})[t.id]
      ? Math.floor((Date.now() - (idleStartTimes||{})[t.id]) / 60000) : 0
    const ms = getMaintStatus(t)
    return [
      `• ${t.licensePlate} (${t.vehicle?.make} ${t.vehicle?.model} ${t.vehicle?.year || ''}):`,
      `  Driver: ${t.driver?.name || 'Unknown'} | Rating: ${t.driver?.rating || 'N/A'}★ | Exp: ${t.driver?.experience || 'N/A'}`,
      `  Status: ${t.status} | Speed: ${t.speed.toFixed(1)} km/h${t.speed > ST ? ' ⚡SPEEDING' : ''}`,
      `  Fuel: ${t.fuel.toFixed(1)}%${t.fuel < FT ? ' ⛽LOW' : ''} | Temp: ${t.temperature.toFixed(1)}°F${t.temperature > TT ? ' 🌡️HOT' : ''}`,
      `  Safety Score: ${t.safetyScore || 'N/A'}/100 | Odometer: ${(t.odometer||0).toLocaleString()}km | Engine Hours: ${(t.engineHours||0).toLocaleString()}hrs`,
      `  Battery: ${(t.batteryVoltage||12.6).toFixed(1)}V | RPM: ${Math.round(t.rpm||0)}`,
      t.activeDTCs?.length ? `  FAULT CODES: ${t.activeDTCs.map(d => `${d.code} (${d.desc})`).join(', ')}` : '',
      t.safety?.harshBraking ? `  Safety Events: ${t.safety.harshBraking} harsh braking, ${t.safety.rapidAcceleration} rapid accel, ${t.safety.speeding} speeding events` : '',
      ms.urgent ? `  ⚠️ MAINTENANCE OVERDUE: Oil change past due` : ms.warn ? `  Maintenance: Oil due in ${ms.oilKm}km` : '',
      idleMin > 0 ? `  ⏸ IDLE: ${idleMin}min — SAR ${(idleMin/60*3*FUEL_PRICE_SAR).toFixed(2)} wasted` : '',
    ].filter(Boolean).join('\n')
  }).join('\n\n')

  const totalRefuel = Math.round(trucks.reduce((s, t) => s + ((100-t.fuel)/100)*TANK_LITRES*FUEL_PRICE_SAR, 0))
  const totalIdleWaste = Object.entries(idleStartTimes||{}).reduce((s,[,ts]) => {
    const m = Math.floor((Date.now()-ts)/60000)
    return s + (m>0 ? (m/60)*3*FUEL_PRICE_SAR : 0)
  }, 0)

  return `You are FleetPulse AI — an expert fleet intelligence system with real-time telemetry for a commercial truck fleet in Riyadh, Saudi Arabia.

FLEET OVERVIEW
==============
Health Score: ${fleetHealth}/100
Trucks: ${trucks.length} total — ${trucks.filter(t=>t.status==='active').length} active, ${idling.length} idle
Critical: ${speeders.length} speeding | ${lowFuel.length} low fuel | ${overTemp.length} overheating
Thresholds: Speed >${ST} km/h | Fuel <${FT}% | Temp >${TT}°F
Session alerts: ${(alertLog||[]).length}
Financials: SAR ${totalRefuel.toLocaleString()} to refuel fleet | SAR ${totalIdleWaste.toFixed(2)} idle waste this session
Fuel: SAR ${FUEL_PRICE_SAR}/L | Tank: ${TANK_LITRES}L

LIVE TRUCK TELEMETRY
====================
${truckLines}

DISPATCH
========
Pending (${pending.length}): ${pending.map(j=>`"${j.title}" [${j.priority}] ${j.from}→${j.to}`).join(' | ')||'none'}
En Route (${enroute.length}): ${enroute.map(j=>{const t=trucks.find(x=>x.id===j.truckId);return `"${j.title}" — ${t?.licensePlate||'?'}→${j.to}`}).join(' | ')||'none'}

ROLE: Give specific, actionable, quantified advice. Reference truck plates and driver names directly. Calculate costs in SAR. Prioritize by urgency and financial impact. Be concise but thorough. Use markdown.`
}

// ── AI chat via backend (Groq — free, no user API key needed) ────────────────
async function callFleetAI(messages, systemPrompt, token, onToken, onDone) {
  const res = await fetch(`${API}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messages: messages.map(m => ({ role: m.role, content: m.content })), systemPrompt }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  const { content } = await res.json()
  // Simulate token streaming for smooth UX
  const words = content.split(' ')
  for (let i = 0; i < words.length; i++) {
    onToken((i === 0 ? '' : ' ') + words[i])
    await new Promise(r => setTimeout(r, 18))
  }
  onDone()
}

// ── AI Chat Widget ─────────────────────────────────────────────────────────────
const CHAT_SUGGESTIONS = [
  'What needs my immediate attention right now?',
  'Which truck should I dispatch to the next job?',
  'How much money am I wasting today — and how do I fix it?',
  'Which driver needs coaching most urgently?',
  'Is any truck at risk of breaking down today?',
  'Recommend the best truck for the Airport Transfer job',
  'Give me a full fleet risk assessment for the next 6 hours',
]

function AIChatWidget({ trucks, jobs, alertLog, ST, FT, TT, fleetHealth, idleStartTimes, authToken }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState(null)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 120) }, [open])

  const sysPrompt = useMemo(
    () => buildFleetSystemPrompt(trucks, jobs, alertLog, ST, FT, TT, fleetHealth, idleStartTimes),
    [trucks, jobs, alertLog, ST, FT, TT, fleetHealth, idleStartTimes]
  )

  const send = useCallback(async (text) => {
    const msg = (typeof text === 'string' ? text : input).trim()
    if (!msg || streaming) return

    const userMsg = { role: 'user', content: msg }
    const history = [...messages, userMsg]
    setMessages([...history, { role: 'assistant', content: '', streaming: true }])
    setInput('')
    setStreaming(true)
    setError(null)

    try {
      let full = ''
      await callFleetAI(
        history.map(m => ({ role: m.role, content: m.content })),
        sysPrompt, authToken,
        (token) => {
          full += token
          setMessages(prev => {
            const next = [...prev]
            next[next.length - 1] = { role: 'assistant', content: full, streaming: true }
            return next
          })
        },
        () => {
          setMessages(prev => {
            const next = [...prev]
            next[next.length - 1] = { ...next[next.length - 1], streaming: false }
            return next
          })
          setStreaming(false)
        }
      )
    } catch (err) {
      const errMsg = err.message?.includes('429') ? 'Rate limit — wait a moment and retry'
        : `Error: ${err.message}`
      setError(errMsg)
      setMessages(prev => prev.slice(0, -1))
      setStreaming(false)
    }
  }, [input, messages, streaming, authToken, sysPrompt])

  const urgentCount = trucks.filter(t => t.speed > ST || t.fuel < FT || t.temperature > TT || (t.activeDTCs?.length > 0)).length

  return (
    <>
      {/* Floating action button */}
      <div className="ai-fab-wrap">
        <button className={`ai-fab ${open ? 'ai-fab-open' : ''} ${urgentCount > 0 && !open ? 'ai-fab-urgent' : ''}`}
          onClick={() => setOpen(p => !p)} title="Fleet AI Assistant">
          <span className="ai-fab-glyph">{open ? '✕' : '🤖'}</span>
          {!open && <span className="ai-fab-text">AI</span>}
          {!open && urgentCount > 0 && <span className="ai-fab-badge">{urgentCount}</span>}
        </button>
      </div>

      {/* Chat panel */}
      {open && (
        <div className="ai-chat-panel">
          {/* Header */}
          <div className="ai-chat-head">
            <div className="ai-head-brand">
              <div className="ai-head-orb">🤖</div>
              <div>
                <div className="ai-head-title">Fleet Intelligence AI</div>
                <div className="ai-head-sub">
                  <span className="ai-dot ai-dot-on" />
                  {`Llama 3.3 · ${trucks.length} trucks · live context`}
                </div>
              </div>
            </div>
            <div className="ai-head-btns">
              {messages.length > 0 && (
                <button className="ai-hbtn" onClick={() => { setMessages([]); setError(null) }} title="Clear">🗑️</button>
              )}
              <button className="ai-hbtn" onClick={() => setOpen(false)} title="Close">✕</button>
            </div>
          </div>

          {/* Messages */}
          <div className="ai-messages">
            {messages.length === 0 ? (
              <div className="ai-welcome">
                <div className="ai-welcome-orb">🛰️</div>
                <div className="ai-welcome-h">Fleet AI Ready</div>
                <div className="ai-welcome-p">
                  {`I have live telemetry for all ${trucks.length} trucks — speed, fuel, temperature, faults, driver scores, dispatch jobs. Ask me anything.`}
                </div>
                <div className="ai-sugg-list">
                  {CHAT_SUGGESTIONS.map((s, i) => (
                    <button key={i} className="ai-sugg" onClick={() => send(s)}>{s}</button>
                  ))}
                </div>
              </div>
            ) : messages.map((m, i) => (
              <div key={i} className={`ai-msg ${m.role === 'user' ? 'ai-msg-u' : 'ai-msg-a'}`}>
                <div className="ai-msg-av">{m.role === 'user' ? '👤' : '🤖'}</div>
                <div className="ai-msg-bubble">
                  {m.content || (m.streaming ? '' : '...')}
                  {m.streaming && <span className="ai-cursor">▋</span>}
                </div>
              </div>
            ))}
            {error && <div className="ai-err">⚠️ {error}</div>}
            <div ref={bottomRef} />
          </div>

          {/* Quick suggestions when in conversation */}
          {messages.length > 0 && !streaming && (
            <div className="ai-quick-chips">
              {CHAT_SUGGESTIONS.slice(0, 3).map((s, i) => (
                <button key={i} className="ai-quick-chip" onClick={() => send(s)}>{s}</button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="ai-input-row">
            <input ref={inputRef} className="ai-input"
              placeholder="Ask anything about your fleet…"
              value={input} disabled={streaming}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
            <button className={`ai-send ${streaming ? 'ai-send-busy' : ''}`}
              disabled={!input.trim() || streaming} onClick={() => send()}>
              {streaming ? '⟳' : '➤'}
            </button>
          </div>
        </div>
      )}
    </>
  )
}

// ── Emergency SOS Protocol Modal ─────────────────────────────────────────────
function EmergencySOSModal({ criticalTrucks, onClose }) {
  const [checked, setChecked] = useState({})
  const steps = [
    { id: 'dispatch',   text: 'Contact dispatch center — Radio Ch.7 or +966-11-DISPATCH' },
    { id: 'location',   text: 'Confirm truck GPS coordinates transmitted to control room' },
    { id: 'emergency',  text: 'Call emergency services if injuries or hazards present (911)' },
    { id: 'welfare',    text: 'Verify driver welfare and physical condition' },
    { id: 'secure',     text: 'Secure vehicle — hazard lights on, place emergency triangles' },
    { id: 'document',   text: 'Document incident: timestamp, location, photos, witness details' },
  ]
  const doneCount = steps.filter(s => checked[s.id]).length
  const allDone = doneCount === steps.length
  return (
    <div className="modal-overlay sos-overlay" onClick={onClose}>
      <div className="sos-modal" onClick={e => e.stopPropagation()}>
        <div className="sos-header">
          <div className="sos-alarm-row">
            <div className="sos-icon-pulse">🚨</div>
            <div className="sos-title-block">
              <div className="sos-title">EMERGENCY PROTOCOL ACTIVE</div>
              <div className="sos-subtitle">Activated {new Date().toLocaleTimeString('en-SA', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
            </div>
            <button className="modal-close" onClick={onClose} style={{ marginLeft: 'auto' }}>✕</button>
          </div>
          {criticalTrucks.length > 0 && (
            <div className="sos-trucks">
              <div className="sos-trucks-label">VEHICLES REQUIRING ATTENTION</div>
              {criticalTrucks.map(t => (
                <div key={t.id} className="sos-truck-row">
                  <span className="sos-t-plate">{t.licensePlate}</span>
                  <span className="sos-t-driver">{t.driver?.name || '–'}</span>
                  <span className="sos-t-loc">📍 {t.location.lat.toFixed(4)}°N {t.location.lng.toFixed(4)}°E</span>
                  {t.driver?.phone && <a href={`tel:${t.driver.phone}`} className="sos-call">📞 Call</a>}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="sos-checklist">
          <div className="sos-cl-header">
            <span>EMERGENCY RESPONSE CHECKLIST</span>
            <span className="sos-progress">{doneCount} / {steps.length} COMPLETE</span>
          </div>
          {steps.map((s, i) => (
            <div key={s.id} className={`sos-step ${checked[s.id] ? 'done' : ''}`}
              onClick={() => setChecked(p => ({ ...p, [s.id]: !p[s.id] }))}>
              <span className="sos-step-num">{checked[s.id] ? '✓' : i + 1}</span>
              <span className="sos-step-text">{s.text}</span>
            </div>
          ))}
        </div>
        <div className="sos-footer">
          <div className="sos-emergency-contacts">
            <a href="tel:911" className="sos-ec red">🚑 Emergency 911</a>
            <a href="tel:993" className="sos-ec amber">🚔 Traffic Police 993</a>
            <a href="tel:998" className="sos-ec blue">🚒 Fire Department 998</a>
          </div>
          {allDone
            ? <button className="sos-resolve" onClick={onClose}>✓ Protocol Complete — Close Emergency</button>
            : <div className="sos-note">Check off each step to resolve the emergency protocol</div>
          }
        </div>
      </div>
    </div>
  )
}

// ── CO₂ Emissions & Environmental Impact Modal ───────────────────────────────
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
              <div>• Keep speeds under {ST} km/h → ~15% better fuel economy across the fleet</div>
              <div>• Regular maintenance schedule → up to 25% emissions reduction</div>
              <div>• AI-optimized routing can cut total distance by 10–20%</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Cinematic boot sequence ──────────────────────────────────────────────────
function BootScreen({ onDone }) {
  const lines = [
    'Initializing telemetry uplink…',
    'Acquiring GPS satellites [12/12]…',
    'Syncing fleet vehicles…',
    'Authenticating secure channel…',
    'Loading AI intelligence core…',
    'Calibrating geofence boundaries…',
    'Establishing real-time data stream…',
    'System ready.',
  ]
  const [step, setStep] = useState(0)
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (step >= lines.length) {
      const t = setTimeout(() => { setDone(true); setTimeout(onDone, 620) }, 360)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => setStep(s => s + 1), 230 + Math.random() * 160)
    return () => clearTimeout(t)
  }, [step]) // eslint-disable-line
  const pct = Math.round((step / lines.length) * 100)
  return (
    <div className={`boot-screen ${done ? 'boot-out' : ''}`}>
      <div className="boot-grid" />
      <div className="boot-core">
        <div className="boot-logo-ring">
          <div className="boot-logo">🚛</div>
          <svg className="boot-orbit" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="54" fill="none" stroke="rgba(99,102,241,.15)" strokeWidth="1.5" />
            <circle cx="60" cy="60" r="54" fill="none" stroke="#6366f1" strokeWidth="2.5"
              strokeDasharray="339.3" strokeDashoffset={339.3 - (pct / 100) * 339.3}
              strokeLinecap="round" transform="rotate(-90 60 60)"
              style={{ transition: 'stroke-dashoffset .3s ease', filter: 'drop-shadow(0 0 6px #6366f1)' }} />
          </svg>
        </div>
        <div className="boot-brand">Fleet<span>Pulse</span></div>
        <div className="boot-tag">AI FLEET INTELLIGENCE PLATFORM</div>
        <div className="boot-bar-track"><div className="boot-bar-fill" style={{ width: `${pct}%` }} /></div>
        <div className="boot-log">
          {lines.slice(0, step).map((l, i) => (
            <div key={i} className="boot-log-line">
              <span className="boot-check">✓</span> {l}
            </div>
          ))}
          {step < lines.length && (
            <div className="boot-log-line active">
              <span className="boot-spin">◌</span> {lines[step]}
            </div>
          )}
        </div>
        <div className="boot-pct">{pct}%</div>
      </div>
    </div>
  )
}

// ── Route Optimization Modal ─────────────────────────────────────────────────
function RouteOptimizerModal({ trucks, jobs, onApply, onClose }) {
  const [applied, setApplied] = useState(false)
  const result = useMemo(() => {
    const assignedIds = new Set(jobs.filter(j => j.truckId && j.status === 'enroute').map(j => j.truckId))
    const avail = trucks.filter(t => !assignedIds.has(t.id))
    const pending = jobs.filter(j => j.status === 'pending')
    if (!avail.length || !pending.length) return null
    const opt  = optimizeFleet(avail, pending)
    const base = baselineFleet(avail, pending)
    const optT = planTotals(avail, opt)
    const baseT = planTotals(avail, base)
    const perTruck = avail.map(t => ({
      truck: t,
      stops: (opt.get(t.id) || []),
      km: routeKm([t.location.lat, t.location.lng], opt.get(t.id) || []),
    })).filter(r => r.stops.length).sort((a, b) => b.stops.length - a.stops.length)
    return { avail, pending, opt, optT, baseT, perTruck }
  }, [trucks, jobs])

  if (!result) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="optimizer-modal" onClick={e => e.stopPropagation()}>
          <div className="modal-header">
            <div className="modal-title">🧭 AI Route Optimization Engine</div>
            <button className="modal-close" onClick={onClose}>✕</button>
          </div>
          <div className="opt-empty">
            <div className="opt-empty-icon">📦</div>
            <div className="opt-empty-h">No pending jobs to optimize</div>
            <div className="opt-empty-p">Add unassigned jobs in the Dispatch Board, then run the optimizer to compute the minimum-distance fleet plan.</div>
          </div>
        </div>
      </div>
    )
  }

  const { optT, baseT, perTruck, pending } = result
  const kmSaved  = baseT.km - optT.km
  const pctSaved = baseT.km > 0 ? (kmSaved / baseT.km) * 100 : 0
  const sarSaved = baseT.sar - optT.sar
  const hrsSaved = baseT.hrs - optT.hrs
  const co2Saved = baseT.co2 - optT.co2
  const annualSar = sarSaved * 260 // working days/yr

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="optimizer-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">🧭 AI Route Optimization Engine</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="opt-algo-badge">2-OPT · CHEAPEST-INSERTION</span>
            <button className="modal-close" onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="opt-hero">
          <div className="opt-hero-main">
            <div className="opt-hero-pct">−{pctSaved.toFixed(1)}%</div>
            <div className="opt-hero-lbl">total distance vs. manual dispatch</div>
          </div>
          <div className="opt-hero-savings">
            <div className="ohs-row"><span className="ohs-ico">📏</span><span className="ohs-v">{kmSaved.toFixed(1)} km</span><span className="ohs-l">deadhead eliminated</span></div>
            <div className="ohs-row"><span className="ohs-ico">⛽</span><span className="ohs-v">SAR {sarSaved.toFixed(0)}</span><span className="ohs-l">fuel saved / cycle</span></div>
            <div className="ohs-row"><span className="ohs-ico">⏱️</span><span className="ohs-v">{(hrsSaved * 60).toFixed(0)} min</span><span className="ohs-l">driver-hours recovered</span></div>
            <div className="ohs-row"><span className="ohs-ico">🌿</span><span className="ohs-v">{co2Saved.toFixed(1)} kg</span><span className="ohs-l">CO₂ avoided</span></div>
          </div>
        </div>

        <div className="opt-compare">
          <div className="opt-cmp-col base">
            <div className="opt-cmp-h">Manual Dispatch</div>
            <div className="opt-cmp-km">{baseT.km.toFixed(1)} km</div>
            <div className="opt-cmp-sar">SAR {baseT.sar.toFixed(0)}</div>
          </div>
          <div className="opt-cmp-arrow">→</div>
          <div className="opt-cmp-col opt">
            <div className="opt-cmp-h">AI-Optimized</div>
            <div className="opt-cmp-km">{optT.km.toFixed(1)} km</div>
            <div className="opt-cmp-sar">SAR {optT.sar.toFixed(0)}</div>
          </div>
        </div>

        <div className="opt-annual">
          💡 Projected annual saving at this volume: <strong>SAR {annualSar.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong> · {(co2Saved * 260).toFixed(0)} kg CO₂/yr
        </div>

        <div className="opt-plan">
          <div className="opt-plan-h">Optimized Assignment — {pending.length} job{pending.length !== 1 ? 's' : ''} across {perTruck.length} truck{perTruck.length !== 1 ? 's' : ''}</div>
          {perTruck.map(({ truck, stops, km }) => (
            <div key={truck.id} className="opt-truck">
              <div className="opt-truck-head">
                <span className="opt-t-plate">{truck.licensePlate}</span>
                <span className="opt-t-driver">{truck.driver?.name || '–'}</span>
                <span className="opt-t-km">{km.toFixed(1)} km · {stops.length} stop{stops.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="opt-stops">
                <span className="opt-stop start">📍 {truck.licensePlate}</span>
                {stops.map((j, i) => (
                  <span key={j.id} className="opt-stop-wrap">
                    <span className="opt-arrow">→</span>
                    <span className={`opt-stop p-${j.priority}`}>{i + 1}. {j.to.split(',')[0]}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="opt-footer">
          {applied
            ? <div className="opt-applied">✓ Optimized plan applied to dispatch board</div>
            : <button className="opt-apply" onClick={() => { onApply(result.opt); setApplied(true) }}>
                ⚡ Apply Optimized Plan to Dispatch
              </button>}
        </div>
      </div>
    </div>
  )
}

// ── Predictive Maintenance Modal ─────────────────────────────────────────────
function PredictiveMaintModal({ trucks, onSelectTruck, onClose }) {
  const fleet = useMemo(() => {
    const rows = trucks.map(t => {
      const comps = predictComponents(t)
      const worst = comps[0]
      const avoidable = comps
        .filter(c => c.sev !== 'ok')
        .reduce((s, c) => s + (c.reactive - c.proactive), 0)
      return { truck: t, comps, worst, avoidable }
    })
    const workOrders = []
    rows.forEach(r => r.comps.forEach(c => {
      if (c.sev !== 'ok') workOrders.push({ truck: r.truck, ...c })
    }))
    workOrders.sort((a, b) => {
      const rank = { critical: 0, warning: 1 }
      return (rank[a.sev] - rank[b.sev]) || (a.days - b.days)
    })
    const totalAvoidable = rows.reduce((s, r) => s + r.avoidable, 0)
    const criticalCount = workOrders.filter(w => w.sev === 'critical').length
    return { rows, workOrders, totalAvoidable, criticalCount }
  }, [trucks])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="pmaint-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">🔧 Predictive Maintenance Intelligence</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="opt-algo-badge">RUL · TELEMETRY-DRIVEN</span>
            <button className="modal-close" onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="pm-kpis">
          <div className="pm-kpi">
            <div className="pm-kv" style={{ color: fleet.criticalCount > 0 ? '#ef4444' : '#22c55e' }}>{fleet.criticalCount}</div>
            <div className="pm-kl">Critical Failures Predicted</div>
          </div>
          <div className="pm-kpi">
            <div className="pm-kv" style={{ color: '#f59e0b' }}>{fleet.workOrders.length}</div>
            <div className="pm-kl">Open Work Orders</div>
          </div>
          <div className="pm-kpi">
            <div className="pm-kv" style={{ color: '#22c55e' }}>SAR {fleet.totalAvoidable.toLocaleString()}</div>
            <div className="pm-kl">Breakdown Cost Avoidable</div>
          </div>
        </div>

        <div className="pm-body">
          <div className="pm-section-h">⚡ Prioritized Work-Order Queue</div>
          {fleet.workOrders.length === 0 && (
            <div className="pm-clear">✅ All components nominal — no predicted failures across the fleet.</div>
          )}
          {fleet.workOrders.slice(0, 8).map((w, i) => (
            <div key={`${w.truck.id}-${w.key}`} className={`pm-wo sev-${w.sev}`} onClick={() => { onSelectTruck(w.truck); onClose() }}>
              <span className="pm-wo-rank">#{i + 1}</span>
              <span className="pm-wo-ico">{w.icon}</span>
              <div className="pm-wo-main">
                <div className="pm-wo-top">
                  <span className="pm-wo-comp">{w.name}</span>
                  <span className="pm-wo-plate">{w.truck.licensePlate}</span>
                </div>
                <div className="pm-wo-meta">
                  {w.sev === 'critical' ? '🚨 Fail in' : '⚠️ Service within'} <strong>{w.days <= 0 ? 'now' : `~${w.days} day${w.days !== 1 ? 's' : ''}`}</strong> · {w.remainKm.toLocaleString()} km left
                </div>
                <div className="pm-wo-bar"><div className="pm-wo-fill" style={{ width: `${w.health}%`, background: w.sev === 'critical' ? '#ef4444' : '#f59e0b' }} /></div>
              </div>
              <div className="pm-wo-cost">
                <div className="pm-wo-save">save SAR {(w.reactive - w.proactive).toLocaleString()}</div>
                <div className="pm-wo-vs">{w.proactive} now vs {w.reactive.toLocaleString()} on failure</div>
              </div>
            </div>
          ))}

          <div className="pm-section-h" style={{ marginTop: 14 }}>🚛 Fleet Component Health Matrix</div>
          <div className="pm-matrix">
            <div className="pm-mx-head">
              <span>Truck</span>
              {Object.values(COMPONENT_SPECS).map(s => <span key={s.name} title={s.name}>{s.icon}</span>)}
            </div>
            {fleet.rows.map(r => (
              <div key={r.truck.id} className="pm-mx-row" onClick={() => { onSelectTruck(r.truck); onClose() }}>
                <span className="pm-mx-plate">{r.truck.licensePlate}</span>
                {['engine','brakes','tires','battery','cooling','trans'].map(key => {
                  const c = r.comps.find(x => x.key === key)
                  const color = c.sev === 'critical' ? '#ef4444' : c.sev === 'warning' ? '#f59e0b' : '#22c55e'
                  return <span key={key} className="pm-mx-cell" title={`${c.name}: ${c.health}% · ${c.days}d`}>
                    <span className="pm-mx-dot" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
                  </span>
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Fleet Financial Intelligence Modal ───────────────────────────────────────
function FinancialModal({ trucks, onSelectTruck, onClose }) {
  const [sortBy, setSortBy] = useState('profit')
  const fin = useMemo(() => {
    const rows = trucks.map(t => ({ truck: t, f: truckFinancials(t) }))
    const totals = rows.reduce((a, { f }) => ({
      revenue: a.revenue + f.revenue, cost: a.cost + f.totalCost, profit: a.profit + f.profit, km: a.km + f.monthlyKm,
      fuel: a.fuel + f.breakdown.fuel, maintenance: a.maintenance + f.breakdown.maintenance,
      tires: a.tires + f.breakdown.tires, depreciation: a.depreciation + f.breakdown.depreciation,
      insurance: a.insurance + f.breakdown.insurance, driver: a.driver + f.breakdown.driver,
    }), { revenue: 0, cost: 0, profit: 0, km: 0, fuel: 0, maintenance: 0, tires: 0, depreciation: 0, insurance: 0, driver: 0 })
    const margin = totals.revenue > 0 ? (totals.profit / totals.revenue) * 100 : 0
    const costPerKm = totals.km > 0 ? totals.cost / totals.km : 0
    const sorted = [...rows].sort((a, b) =>
      sortBy === 'profit' ? b.f.profit - a.f.profit
      : sortBy === 'margin' ? b.f.margin - a.f.margin
      : sortBy === 'cpk' ? a.f.costPerKm - b.f.costPerKm
      : b.f.util - a.f.util)
    const best = [...rows].sort((a, b) => b.f.profit - a.f.profit)[0]
    const worst = [...rows].sort((a, b) => a.f.profit - b.f.profit)[0]
    return { rows: sorted, totals, margin, costPerKm, best, worst }
  }, [trucks, sortBy])

  const catColors = { fuel: '#f59e0b', maintenance: '#22d3ee', tires: '#a855f7', depreciation: '#6366f1', insurance: '#64748b', driver: '#22c55e' }
  const catLabels = { fuel: 'Fuel', maintenance: 'Maintenance', tires: 'Tires', depreciation: 'Depreciation', insurance: 'Insurance', driver: 'Driver Wages' }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="fin-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">💵 Fleet Financial Intelligence</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="opt-algo-badge">P&amp;L · TCO · /MONTH</span>
            <button className="modal-close" onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="fin-kpis">
          <div className="fin-kpi">
            <div className="fin-kv" style={{ color: fin.totals.profit >= 0 ? '#22c55e' : '#ef4444' }}>
              {fin.totals.profit >= 0 ? '+' : ''}SAR {Math.round(fin.totals.profit).toLocaleString()}
            </div>
            <div className="fin-kl">Net Monthly Profit</div>
          </div>
          <div className="fin-kpi">
            <div className="fin-kv">SAR {Math.round(fin.totals.revenue).toLocaleString()}</div>
            <div className="fin-kl">Monthly Revenue</div>
          </div>
          <div className="fin-kpi">
            <div className="fin-kv" style={{ color: fin.margin >= 20 ? '#22c55e' : fin.margin >= 8 ? '#f59e0b' : '#ef4444' }}>{fin.margin.toFixed(1)}%</div>
            <div className="fin-kl">Operating Margin</div>
          </div>
          <div className="fin-kpi">
            <div className="fin-kv" style={{ color: '#22d3ee' }}>SAR {fin.costPerKm.toFixed(2)}</div>
            <div className="fin-kl">Fleet Cost / km</div>
          </div>
        </div>

        <div className="fin-body">
          {/* Cost structure */}
          <div className="fin-cost-struct">
            <div className="fin-cs-h">Monthly Cost Structure — SAR {Math.round(fin.totals.cost).toLocaleString()}/mo</div>
            <div className="fin-cs-bar">
              {Object.keys(catColors).map(k => {
                const pct = fin.totals.cost > 0 ? (fin.totals[k] / fin.totals.cost) * 100 : 0
                return pct > 0.5 ? <div key={k} className="fin-cs-seg" style={{ width: `${pct}%`, background: catColors[k] }} title={`${catLabels[k]}: ${pct.toFixed(0)}%`} /> : null
              })}
            </div>
            <div className="fin-cs-legend">
              {Object.keys(catColors).map(k => (
                <div key={k} className="fin-cs-leg">
                  <span className="fin-cs-dot" style={{ background: catColors[k] }} />
                  {catLabels[k]} <strong>SAR {Math.round(fin.totals[k]).toLocaleString()}</strong>
                </div>
              ))}
            </div>
          </div>

          {/* Best / worst */}
          <div className="fin-callouts">
            <div className="fin-callout good">
              <div className="fin-co-tag">🏆 Top Earner</div>
              <div className="fin-co-plate">{fin.best.truck.licensePlate}</div>
              <div className="fin-co-val" style={{ color: '#22c55e' }}>+SAR {Math.round(fin.best.f.profit).toLocaleString()}/mo · {fin.best.f.margin.toFixed(0)}% margin</div>
            </div>
            <div className="fin-callout bad">
              <div className="fin-co-tag">⚠️ Needs Review</div>
              <div className="fin-co-plate">{fin.worst.truck.licensePlate}</div>
              <div className="fin-co-val" style={{ color: fin.worst.f.profit < 0 ? '#ef4444' : '#f59e0b' }}>
                {fin.worst.f.profit >= 0 ? '+' : ''}SAR {Math.round(fin.worst.f.profit).toLocaleString()}/mo · break-even at {fin.worst.f.breakevenUtil.toFixed(0)}% util
              </div>
            </div>
          </div>

          {/* P&L table */}
          <div className="fin-table-controls">
            <span className="fin-tc-label">Per-Vehicle P&amp;L</span>
            <div className="fin-sort">
              {[['profit','Profit'],['margin','Margin'],['cpk','Cost/km'],['util','Utilization']].map(([k, l]) => (
                <button key={k} className={`fin-sort-btn ${sortBy === k ? 'active' : ''}`} onClick={() => setSortBy(k)}>{l}</button>
              ))}
            </div>
          </div>
          <div className="fin-table">
            <div className="fin-th">
              <span>Truck</span><span>Util</span><span>km/mo</span><span>Revenue</span><span>Cost</span><span>Profit</span><span>Margin</span>
            </div>
            {fin.rows.map(({ truck, f }) => (
              <div key={truck.id} className="fin-tr" onClick={() => { onSelectTruck(truck); onClose() }}>
                <span className="fin-plate">{truck.licensePlate}</span>
                <span className={f.util >= f.breakevenUtil ? 'fin-ok' : 'fin-warn'}>{f.util}%</span>
                <span className="fin-dim">{f.monthlyKm.toLocaleString()}</span>
                <span>SAR {Math.round(f.revenue).toLocaleString()}</span>
                <span className="fin-dim">SAR {Math.round(f.totalCost).toLocaleString()}</span>
                <span style={{ color: f.profit >= 0 ? '#22c55e' : '#ef4444', fontWeight: 700 }}>{f.profit >= 0 ? '+' : ''}{Math.round(f.profit).toLocaleString()}</span>
                <span style={{ color: f.margin >= 15 ? '#22c55e' : f.margin >= 0 ? '#f59e0b' : '#ef4444' }}>{f.margin.toFixed(0)}%</span>
              </div>
            ))}
          </div>
          <div className="fin-assumptions">
            Model: SAR {FIN.revenuePerKm}/km billable · {FIN.workDays} working days/mo · diesel SAR {FUEL_PRICE_SAR}/L · {(FIN.depRateYr * 100).toFixed(0)}%/yr depreciation · driver SAR {FIN.driverWageMo.toLocaleString()}/mo. Utilization derived from live status &amp; safety score.
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Fleet Command Grid View ───────────────────────────────────────────────────
const FleetGridView = memo(function FleetGridView({
  trucks, truckTimeline, selected, onSelect, ST, FT, TT, jobs,
  fleetHealth, activeCount, speedingCount, alertCount, onClose
}) {
  return (
    <div className="grid-view">
      <div className="gv-bar">
        <div className="gv-bar-left">
          <div className="gv-live-dot" />
          <span className="gv-title">FLEET COMMAND</span>
          <span className="gv-count">{trucks.length} VEHICLES</span>
        </div>
        <div className="gv-bar-center">
          <span className="gv-bstat ok">{activeCount} ACTIVE</span>
          {speedingCount > 0 && <span className="gv-bstat crit">{speedingCount} SPEEDING</span>}
          {alertCount > 0 && <span className="gv-bstat crit">{alertCount} ALERTS</span>}
          <div className="gv-health-wrap">
            <div className="gv-health-bar">
              <div className="gv-health-fill" style={{
                width: `${fleetHealth}%`,
                background: fleetHealth >= 80 ? 'var(--green)' : fleetHealth >= 55 ? 'var(--amber)' : 'var(--red)'
              }} />
            </div>
            <span className="gv-health-pct">{fleetHealth}%</span>
          </div>
        </div>
        <button className="gv-close" onClick={onClose}>✕ MAP VIEW</button>
      </div>

      <div className="gv-grid">
        {trucks.map(t => {
          const isAlert = t.speed > ST || t.fuel < FT || t.temperature > TT
          const speedColor = t.speed > ST ? 'var(--red)' : t.speed > ST * 0.8 ? 'var(--amber)' : 'var(--green)'
          const fuelColor = t.fuel < FT ? 'var(--red)' : t.fuel < FT * 2 ? 'var(--amber)' : 'var(--green)'
          const speedHistory = (truckTimeline[t.id] || []).map(h => h.speed)
          const activeJob = jobs.find(j => j.truckId === t.id && j.status === 'enroute')
          const isSelected = selected?.id === t.id
          const statusColor = t.speed > ST || t.temperature > TT ? 'var(--red)' : t.fuel < FT ? 'var(--amber)' : t.status === 'active' ? 'var(--green)' : 'rgba(148,163,184,.3)'
          return (
            <div key={t.id}
              className={`gv-card ${isSelected ? 'gv-sel' : ''} ${isAlert ? 'gv-alrt' : ''}`}
              onClick={() => onSelect(t)}>
              <div className="gv-top-bar" style={{ background: `linear-gradient(90deg, ${statusColor}, transparent)` }} />
              <div className="gv-head">
                <span className="gv-plate">{t.licensePlate}</span>
                <div className="gv-sdot" style={{
                  background: statusColor,
                  boxShadow: `0 0 8px ${statusColor}`,
                  animation: t.status === 'active' ? 'live-pulse 2s ease-in-out infinite' : 'none'
                }} />
              </div>
              {t.driver && (
                <div className="gv-driver">
                  <div className="gv-av">
                    <img src={t.driver.photo} alt="" onError={e => { e.target.style.display = 'none' }} />
                  </div>
                  <div className="gv-dname">{t.driver.name}</div>
                  <span className="gv-drating">★{t.driver.rating}</span>
                </div>
              )}
              {speedHistory.length >= 4 && (
                <div className="gv-spark">
                  <Sparkline data={speedHistory} color={speedColor} width={180} height={38} />
                  <span className="gv-spark-lbl">speed history</span>
                </div>
              )}
              <div className="gv-mets">
                <div className="gv-met" style={{ color: speedColor }}>
                  <div className="gv-mv">{t.speed.toFixed(0)}</div>
                  <div className="gv-mu">km/h</div>
                  <div className="gv-mbar"><div style={{ width: `${Math.min(100,(t.speed/(ST*1.5))*100)}%`, height: '100%', background: speedColor, borderRadius: 2, boxShadow: `0 0 4px ${speedColor}` }} /></div>
                </div>
                <div className="gv-met" style={{ color: fuelColor }}>
                  <div className="gv-mv">{t.fuel.toFixed(0)}%</div>
                  <div className="gv-mu">fuel</div>
                  <div className="gv-mbar"><div style={{ width: `${t.fuel}%`, height: '100%', background: fuelColor, borderRadius: 2, boxShadow: `0 0 4px ${fuelColor}` }} /></div>
                </div>
                <div className="gv-met" style={{ color: t.temperature > TT ? 'var(--red)' : 'rgba(148,163,184,.7)' }}>
                  <div className="gv-mv">{t.temperature.toFixed(0)}°</div>
                  <div className="gv-mu">°F</div>
                </div>
              </div>
              {activeJob && (
                <div className="gv-job">
                  <span>📋</span>
                  <span className="gv-job-txt">{activeJob.to.split(',')[0]}</span>
                </div>
              )}
              {isAlert && (
                <div className="gv-alert-strip">
                  {t.speed > ST && `⚡ ${t.speed.toFixed(0)} km/h `}
                  {t.fuel < FT && `⛽ ${t.fuel.toFixed(0)}% `}
                  {t.temperature > TT && `🌡️ ${t.temperature.toFixed(0)}°F`}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
})

// ── Fleet Command Brief — the synthesis layer ──────────────────────────────────
// Reads the entire fleet state and produces a single prioritized, money-attached
// action plan. This is the "one screen that tells you what matters" flagship view.
function CommandBrief({
  trucks, fleetHealth, activeCount, idleCount, speedingCount, lowFuelCount,
  avgFuel, alertCount, totalRefuelSAR, totalIdleWasteSAR, co2Stats,
  criticalTrucks, maintenanceTrucks, predictions, jobs, alertLog,
  ST, FT, TT, isOnline, getFuelETA,
  onSelectTruck, onOpenDispatch, onOpenOptimizer, onOpenSOS, onClose,
}) {
  const now = new Date()
  const hour = now.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  // ── Synthesize a single prioritized action plan across every signal ──
  const actions = []
  criticalTrucks.forEach(t => {
    if (t.speed > ST) {
      const over = t.speed - ST
      actions.push({
        key: `spd-${t.id}`, sev: 0, icon: '⚡', truck: t,
        title: `${t.licensePlate} speeding — ${t.speed.toFixed(0)} km/h`,
        detail: `${over.toFixed(0)} km/h over limit · ${t.driver?.name || 'driver'} needs correction now`,
        sar: over > 20 ? 800 : over > 10 ? 400 : 150, sarLabel: 'fine risk',
        cta: 'Open truck', onCta: () => { onSelectTruck(t); onClose() },
      })
    }
    if (t.temperature > TT) {
      actions.push({
        key: `tmp-${t.id}`, sev: 0, icon: '🌡️', truck: t,
        title: `${t.licensePlate} overheating — ${t.temperature.toFixed(0)}°F`,
        detail: `Engine damage risk if not addressed · call driver to pull over`,
        sar: t.temperature > TT * 1.1 ? 3500 : 1200, sarLabel: 'repair risk',
        cta: 'Open truck', onCta: () => { onSelectTruck(t); onClose() },
      })
    }
    if (t.fuel < FT) {
      const eta = getFuelETA?.(t.id)
      const refuel = ((100 - t.fuel) / 100) * 400 * 2.18
      actions.push({
        key: `fuel-${t.id}`, sev: t.fuel < FT * 0.5 ? 0 : 1, icon: '⛽', truck: t,
        title: `${t.licensePlate} low fuel — ${t.fuel.toFixed(0)}%`,
        detail: eta ? `Runs dry in ~${eta} min · route to nearest station` : 'Critically low · route to station',
        sar: Math.round(refuel), sarLabel: 'refuel cost',
        cta: 'Open truck', onCta: () => { onSelectTruck(t); onClose() },
      })
    }
  })
  ;(predictions || []).forEach(p => {
    if (p.severity === 'critical') {
      const t = trucks.find(x => x.id === p.truckId)
      actions.push({
        key: `pred-${p.truckId}-${p.type}`, sev: 1, icon: p.type === 'fuel' ? '⛽' : p.type === 'maint' ? '🔧' : '⏸', truck: t,
        title: `Predicted: ${p.msg}`,
        detail: 'AI forecast from telemetry trend · schedule ahead to avoid breakdown',
        sar: 0, sarLabel: '',
        cta: t ? 'Open truck' : null, onCta: () => { if (t) { onSelectTruck(t); onClose() } },
      })
    }
  })
  maintenanceTrucks.slice(0, 3).forEach(t => {
    actions.push({
      key: `mnt-${t.id}`, sev: 1, icon: '🔧', truck: t,
      title: `${t.licensePlate} service overdue`,
      detail: `${(t.engineHours || 0).toLocaleString()} engine hrs${(t.activeDTCs?.length || 0) > 0 ? ` · ${t.activeDTCs.length} active fault code${t.activeDTCs.length > 1 ? 's' : ''}` : ''}`,
      sar: 400, sarLabel: 'service est.',
      cta: 'Open truck', onCta: () => { onSelectTruck(t); onClose() },
    })
  })
  const pendingJobs = jobs.filter(j => j.status === 'pending').length
  if (idleCount > 0 && pendingJobs > 0) {
    actions.push({
      key: 'idle-dispatch', sev: 1, icon: '⏸', truck: null,
      title: `${idleCount} idle truck${idleCount > 1 ? 's' : ''} with ${pendingJobs} job${pendingJobs > 1 ? 's' : ''} waiting`,
      detail: `SAR ${Math.round(totalIdleWasteSAR)} burned idling · dispatch to recover utilization`,
      sar: Math.round(totalIdleWasteSAR), sarLabel: 'idle waste',
      cta: 'Open dispatch', onCta: () => { onOpenDispatch(); onClose() },
    })
  }
  actions.sort((a, b) => a.sev - b.sev || b.sar - a.sar)

  const totalAtRisk = actions.reduce((s, a) => s + (a.sar || 0), 0)
  const critCount = actions.filter(a => a.sev === 0).length
  const tier = fleetHealth >= 80 ? 'ok' : fleetHealth >= 55 ? 'warn' : 'crit'
  const tierColor = tier === 'ok' ? '#22c55e' : tier === 'warn' ? '#f59e0b' : '#ef4444'
  const headline = actions.length === 0
    ? 'All systems nominal — no action required'
    : critCount > 0
      ? `${critCount} critical issue${critCount > 1 ? 's' : ''} need${critCount === 1 ? 's' : ''} immediate attention`
      : `${actions.length} item${actions.length > 1 ? 's' : ''} to review — no emergencies`

  const vitals = [
    { label: 'Fleet Health', value: `${fleetHealth}`, unit: '%', color: tierColor },
    { label: 'Active', value: `${activeCount}`, unit: `/${trucks.length}`, color: '#22c55e' },
    { label: 'Idle', value: `${idleCount}`, unit: '', color: idleCount > 0 ? '#94a3b8' : '#22c55e' },
    { label: 'Avg Fuel', value: `${avgFuel}`, unit: '%', color: avgFuel < 30 ? '#f59e0b' : '#22c55e' },
    { label: 'Alerts', value: `${alertCount}`, unit: '', color: alertCount > 0 ? '#ef4444' : '#22c55e' },
    { label: 'CO₂ / session', value: co2Stats.co2Kg, unit: 'kg', color: '#22d3ee' },
  ]

  return (
    <div className="cb-overlay" onClick={onClose}>
      <div className="cb-panel" onClick={e => e.stopPropagation()} role="dialog" aria-label="Fleet Command Brief">
        {/* Header */}
        <div className="cb-head">
          <div className="cb-head-left">
            <div className="cb-greeting">{greeting}, Operations</div>
            <div className="cb-datetime">
              {now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
              <span className="cb-sep">·</span>
              {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              <span className="cb-sep">·</span>
              <span className={`cb-live ${isOnline ? 'on' : 'off'}`}>{isOnline ? '● LIVE' : '● DEMO'}</span>
            </div>
          </div>
          <button className="cb-close" onClick={onClose} aria-label="Close brief">✕</button>
        </div>

        {/* Hero status band */}
        <div className={`cb-hero cb-hero-${tier}`}>
          <div className="cb-hero-ring" style={{ '--ring': tierColor }}>
            <svg viewBox="0 0 100 100" className="cb-ring-svg">
              <circle cx="50" cy="50" r="42" className="cb-ring-track" />
              <circle cx="50" cy="50" r="42" className="cb-ring-fill"
                style={{ stroke: tierColor, strokeDasharray: `${2 * Math.PI * 42}`, strokeDashoffset: `${2 * Math.PI * 42 * (1 - fleetHealth / 100)}` }} />
            </svg>
            <div className="cb-ring-inner">
              <div className="cb-ring-num" style={{ color: tierColor }}>{fleetHealth}</div>
              <div className="cb-ring-lbl">HEALTH</div>
            </div>
          </div>
          <div className="cb-hero-text">
            <div className="cb-hero-headline" style={{ color: tierColor }}>{headline}</div>
            <div className="cb-hero-sub">
              {actions.length === 0
                ? `All ${trucks.length} trucks operating within thresholds. Fleet is running clean.`
                : `Across ${trucks.length} trucks, ${actions.length} item${actions.length > 1 ? 's' : ''} flagged.`}
              {totalAtRisk > 0 && <> Est. <strong>SAR {totalAtRisk.toLocaleString()}</strong> exposure if unaddressed.</>}
            </div>
            <div className="cb-hero-actions">
              {actions.length > 0 && <button className="cb-hero-btn primary" onClick={() => { onOpenDispatch(); onClose() }}>📋 Open Dispatch</button>}
              {(speedingCount + lowFuelCount) > 0 && <button className="cb-hero-btn" onClick={() => { onOpenOptimizer(); onClose() }}>🧭 Optimize Routes</button>}
              {critCount > 0 && <button className="cb-hero-btn danger" onClick={() => { onOpenSOS(); onClose() }}>🚨 Emergency</button>}
            </div>
          </div>
        </div>

        {/* Vitals */}
        <div className="cb-vitals">
          {vitals.map(v => (
            <div key={v.label} className="cb-vital">
              <div className="cb-vital-val" style={{ color: v.color }}>{v.value}<span className="cb-vital-unit">{v.unit}</span></div>
              <div className="cb-vital-lbl">{v.label}</div>
            </div>
          ))}
        </div>

        {/* Priority action plan */}
        <div className="cb-section-title">
          <span>Priority Action Plan</span>
          {actions.length > 0 && <span className="cb-section-count">{actions.length}</span>}
        </div>
        <div className="cb-actions">
          {actions.length === 0 ? (
            <div className="cb-empty">
              <span className="cb-empty-icon">✅</span>
              <div>
                <div className="cb-empty-title">Nothing needs your attention</div>
                <div className="cb-empty-sub">No speeding, low fuel, overheating, overdue service, or predicted failures. Well run.</div>
              </div>
            </div>
          ) : actions.map((a, i) => (
            <div key={a.key} className={`cb-action ${a.sev === 0 ? 'crit' : 'warn'}`}>
              <div className="cb-action-rank">{i + 1}</div>
              <div className="cb-action-icon">{a.icon}</div>
              <div className="cb-action-body">
                <div className="cb-action-title">{a.title}</div>
                <div className="cb-action-detail">{a.detail}</div>
              </div>
              {a.sar > 0 && (
                <div className="cb-action-cost">
                  <div className="cb-action-sar">SAR {a.sar.toLocaleString()}</div>
                  <div className="cb-action-sarlbl">{a.sarLabel}</div>
                </div>
              )}
              {a.cta && <button className={`cb-action-cta ${a.sev === 0 ? 'crit' : ''}`} onClick={a.onCta}>{a.cta} →</button>}
            </div>
          ))}
        </div>

        {/* Financial footer */}
        <div className="cb-money">
          <div className="cb-money-item">
            <span className="cb-money-val" style={{ color: '#ef4444' }}>SAR {totalRefuelSAR.toLocaleString()}</span>
            <span className="cb-money-lbl">to refuel fleet</span>
          </div>
          <div className="cb-money-item">
            <span className="cb-money-val" style={{ color: '#f59e0b' }}>SAR {Math.round(totalIdleWasteSAR).toLocaleString()}</span>
            <span className="cb-money-lbl">idle waste this session</span>
          </div>
          <div className="cb-money-item">
            <span className="cb-money-val" style={{ color: totalAtRisk > 0 ? '#ef4444' : '#22c55e' }}>SAR {totalAtRisk.toLocaleString()}</span>
            <span className="cb-money-lbl">exposure at risk</span>
          </div>
          <div className="cb-money-item">
            <span className="cb-money-val" style={{ color: '#22d3ee' }}>{alertLog.length}</span>
            <span className="cb-money-lbl">events logged</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Global Top Bar ────────────────────────────────────────────────────────────
const TopBar = memo(function TopBar({
  isOnline, fleetHealth, activeCount, speedingCount, alertCount, avgFuel, lowFuelCount,
  alertLog, jobs, dark, soundEnabled, notifPermission, showGridView, focusMode,
  setFleetFilter, setSearch, setShowDispatch, setShowSOS, setShowAlertLog,
  setDark, setSoundEnabled, exportCSV, setShowOptimizer, setShowPredMaint,
  setShowFinancials, setShowLeaderboard, setShowSettings, setShowHelp, setShowPalette,
  enableNotifications, setShowEmissions, setShowCostAnalytics, setShowGridView, setFocusMode,
  setShowBrief, briefCount, sidebarOpen, setSidebarOpen,
  appMode, setAppMode, setShowMonitoring, setShowPlayback, setShowConnect, setShowZones, extCount,
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)
  useEffect(() => {
    const close = e => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])
  const hc = fleetHealth >= 80 ? 'var(--green)' : fleetHealth >= 55 ? 'var(--amber)' : 'var(--red)'
  const enroute = jobs.filter(j => j.status === 'enroute').length
  const mi = (icon, label, fn, badge) => (
    <button key={label} className="tb-mi" onClick={() => { fn(); setMenuOpen(false) }}>
      <span className="tb-mi-icon">{icon}</span>
      <span className="tb-mi-label">{label}</span>
      {badge > 0 && <span className="tb-mi-badge">{badge}</span>}
    </button>
  )
  return (
    <header className="topbar" role="banner">
      <button
        className="tb-icon-btn tb-mob-menu"
        aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
        aria-expanded={sidebarOpen}
        onClick={() => setSidebarOpen(o => !o)}
      >☰</button>
      <div className="tb-brand">
        <div className="tb-logo" aria-hidden="true">🚛</div>
        <div className="tb-identity">
          <span className="tb-name">Fleet<span className="tb-dim">Pulse</span></span>
          <div className="tb-live">
            <span className={`tb-dot${isOnline ? '' : ' demo'}`} />
            <span>{isOnline ? 'LIVE' : 'DEMO'}</span>
            <span className="tb-sep">·</span>
            <span>KSA</span>
          </div>
        </div>
      </div>
      <div className="mode-switch" role="tablist" aria-label="Application mode">
        <button role="tab" aria-selected={appMode === 'fms'}
          className={`mode-btn${appMode === 'fms' ? ' active' : ''}`}
          onClick={() => setAppMode('fms')} title="Fleet tracking — live map, telemetry, zones, playback">
          🛰 <span className="mode-label">Tracking</span>
        </button>
        <button role="tab" aria-selected={appMode === 'tms'}
          className={`mode-btn${appMode === 'tms' ? ' active' : ''}`}
          onClick={() => setAppMode('tms')} title="Operations — jobs, assignment, dispatch, route planning">
          📋 <span className="mode-label">Operations</span>
        </button>
      </div>
      <div className="tb-health" title={`Fleet health ${fleetHealth}%`}>
        <div className="tb-htrack"><div className="tb-hfill" style={{ width:`${fleetHealth}%`, background:hc }} /></div>
        <span className="tb-hpct" style={{ color:hc }}>{fleetHealth}%</span>
      </div>
      <div className="tb-pills">
        <button className="tb-pill pill-dim" onClick={() => { setFleetFilter('active'); setSearch('') }}>
          <span className="tb-pv">{activeCount}</span><span className="tb-pl">Active</span>
        </button>
        <button className={`tb-pill${speedingCount > 0 ? ' pill-amber' : ' pill-dim'}`}
          onClick={speedingCount > 0 ? () => { setFleetFilter('speeding'); setSearch('') } : undefined}>
          <span className="tb-pv">{speedingCount}</span><span className="tb-pl">Speed</span>
        </button>
        <button className={`tb-pill${alertCount > 0 ? ' pill-alert' : ' pill-dim'}`}
          onClick={alertLog.length > 0 ? () => setShowAlertLog(true) : undefined}>
          <span className="tb-pv">{alertCount}</span><span className="tb-pl">Alerts</span>
        </button>
        <button className={`tb-pill${avgFuel < 30 ? ' pill-amber' : ' pill-dim'}`}
          onClick={lowFuelCount > 0 ? () => { setFleetFilter('lowfuel'); setSearch('') } : undefined}>
          <span className="tb-pv">{avgFuel}%</span><span className="tb-pl">Fuel</span>
        </button>
      </div>
      <div style={{ flex:1 }} />
      <div className="tb-actions">
        <button className="tb-brief-btn" onClick={() => setShowBrief(true)} title="Fleet Command Brief (B)">
          <span className="tb-brief-icon">◆</span> Brief
          {briefCount > 0 && <span className="tb-brief-badge">{briefCount}</span>}
        </button>
        <button className={`tb-icon-btn${showGridView ? ' tb-active' : ''}`}
          onClick={() => setShowGridView(v => !v)} title={showGridView ? 'Map view' : 'Grid view'}>
          {showGridView ? '🗺️' : '⊞'}
        </button>
        {appMode === 'tms' ? (
          <button className="tb-primary" onClick={() => setShowDispatch(true)} title="Dispatch board (D)">
            📋 Dispatch{enroute > 0 && <span className="tb-pbadge">{enroute}</span>}
          </button>
        ) : (
          <>
            <button className="tb-icon-btn" onClick={() => setShowMonitoring(true)} title="Fuel / speed / weight monitoring (W)">📡</button>
            <button className="tb-icon-btn" onClick={() => setShowPlayback(true)} title="Trip playback (R)">🎬</button>
            <button className="tb-icon-btn" onClick={() => setShowZones(true)} title="Geofence zones (Z)">📍</button>
            <button className="tb-icon-btn" onClick={() => setShowConnect(true)} title="Connect a GPS provider (C)" style={{ position: 'relative' }}>
              🔌{extCount > 0 && <span className="tb-pbadge">{extCount}</span>}
            </button>
          </>
        )}
        <button className="tb-sos" onClick={() => setShowSOS(true)} aria-label="Emergency SOS">SOS</button>
        <button className="tb-icon-btn" onClick={() => setDark(d => !d)} title="Toggle theme" aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}>{dark ? '☀️' : '🌙'}</button>
        <div className="tb-overflow-wrap" ref={menuRef}>
          <button className={`tb-icon-btn${menuOpen ? ' tb-active' : ''}`} onClick={() => setMenuOpen(o => !o)}>⋯</button>
          {menuOpen && (
            <div className="tb-menu">
              <div className="tb-mg">
                {mi(notifPermission === 'granted' ? '🔔' : '🔕', notifPermission === 'granted' ? 'Notifications on' : 'Enable notifications', enableNotifications, 0)}
                {mi(soundEnabled ? '🔊' : '🔇', `Sound ${soundEnabled ? 'on' : 'off'}`, () => setSoundEnabled(p => !p), 0)}
                {mi('📥', 'Export CSV', exportCSV, 0)}
              </div>
              <div className="tb-msep" />
              <div className="tb-mg">
                {mi('📡', 'Fleet Monitoring  W', () => setShowMonitoring(true), 0)}
                {mi('🎬', 'Trip Playback  R', () => setShowPlayback(true), 0)}
                {mi('📍', 'Geofence Zones  Z', () => setShowZones(true), 0)}
                {mi('🔌', 'Connect Provider  C', () => setShowConnect(true), extCount)}
              </div>
              <div className="tb-msep" />
              <div className="tb-mg">
                {mi('◆', 'Command Brief  B', () => setShowBrief(true), briefCount)}
                {mi('🧭', 'Route Optimizer', () => setShowOptimizer(true), 0)}
                {mi('🔧', 'Predictive Maintenance', () => setShowPredMaint(true), 0)}
                {mi('💰', 'Financial Intelligence', () => setShowFinancials(true), 0)}
                {mi('🌿', 'CO₂ Emissions', () => setShowEmissions(true), 0)}
                {mi('📊', 'Cost Analytics', () => setShowCostAnalytics(true), 0)}
              </div>
              <div className="tb-msep" />
              <div className="tb-mg">
                {mi('🗂️', 'Alert Log', () => setShowAlertLog(true), alertLog.length)}
                {mi('🏆', 'Driver Leaderboard', () => setShowLeaderboard(true), 0)}
              </div>
              <div className="tb-msep" />
              <div className="tb-mg">
                {mi('⛶', focusMode ? 'Exit Focus Mode' : 'Focus Mode', () => setFocusMode(f => !f), 0)}
                {mi('🔍', 'Command Palette  ⌘K', () => setShowPalette(true), 0)}
                {mi('⚙️', 'Settings', () => setShowSettings(true), 0)}
                {mi('⌨️', 'Keyboard Shortcuts', () => setShowHelp(true), 0)}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  )
})

// ═══════════════════════════════════════════════════════════════════════════════
// APP
// ═══════════════════════════════════════════════════════════════════════════════
function App() {
  const [token, setToken] = useState(null)
  const [loginUser, setLoginUser] = useState('')
  const [loginPass, setLoginPass] = useState('')
  const [loginErr, setLoginErr] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)
  const [trucks, setTrucks] = useState([])
  const [trucksLoading, setTrucksLoading] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [selected, setSelected] = useState(null)
  const [telemetry, setTelemetry] = useState(null)
  const [routes, setRoutes] = useState({})
  const [search, setSearch] = useState('')
  const [fleetFilter, setFleetFilter] = useState('all')
  const [aiAnalysis, setAiAnalysis] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  // NOTE: no UI currently lets the user change this after first load — it's
  // seeded from localStorage and persisted back, but never re-set in-app.
  const [aiApiKey] = useState(() => localStorage.getItem('fp-ai-key') || '')
  const [aiLastUpdated, setAiLastUpdated] = useState(null)
  const [dark, setDark] = useState(true)
  const [focusMode, setFocusMode] = useState(false)
  const [detailTab, setDetailTab] = useState('overview')
  const [detailCollapsed, setDetailCollapsed] = useState(false)
  const [truckHistory, setTruckHistory] = useState({})
  const [toasts, setToasts] = useState([])
  const [acknowledged, setAcknowledged] = useState(new Set())
  const [acknowledgedMaint, setAcknowledgedMaint] = useState(new Set())
  const [snoozed, setSnoozed] = useState({}) // { truckId: snoozeUntilTimestamp }
  const [fleetOverview, setFleetOverview] = useState([])
  const [showLeaderboard, setShowLeaderboard] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showMessage, setShowMessage] = useState(null) // truck object to message
  const [alertLog, setAlertLog] = useState([])         // session alert history
  const [showAlertLog, setShowAlertLog] = useState(false)
  const [showPalette, setShowPalette] = useState(false)
  const [showCostAnalytics, setShowCostAnalytics] = useState(false)
  const [showDispatch, setShowDispatch] = useState(false)
  const [showFullMap, setShowFullMap] = useState(false)
  const [showSOS, setShowSOS] = useState(false)
  const [showEmissions, setShowEmissions] = useState(false)
  const [showOptimizer, setShowOptimizer] = useState(false)
  const [showPredMaint, setShowPredMaint] = useState(false)
  const [showFinancials, setShowFinancials] = useState(false)
  const [showGridView, setShowGridView] = useState(false)
  const [booting, setBooting] = useState(() => !sessionStorage.getItem('fp-booted'))
  const [notifPermission, setNotifPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'denied'
  )
  const [jobs, setJobs] = useState(DEMO_JOBS)
  const [idleStartTimes, setIdleStartTimes] = useState({}) // { truckId: timestamp }
  const [shiftStart, setShiftStart] = useState({})         // { truckId: timestamp }
  const [geozones, setGeozones] = useState(() => {
    try { return JSON.parse(localStorage.getItem('fp-zones') || '[]') } catch { return [] }
  })
  const [addingZone, setAddingZone] = useState(false)
  const [pendingZoneLatlng, setPendingZoneLatlng] = useState(null)
  // FMS (tracking) vs TMS (operations) separation
  const [appMode, setAppMode] = useState(() => localStorage.getItem('fp-mode') || 'fms')
  // Drawers
  const [showMonitoring, setShowMonitoring] = useState(false)
  const [showPlayback, setShowPlayback] = useState(false)
  const [showConnect, setShowConnect] = useState(false)
  const [showZones, setShowZones] = useState(false)
  // Polygon zone drawing
  const [zoneTypeChooser, setZoneTypeChooser] = useState(false)
  const [polyDraft, setPolyDraft] = useState(null)        // null | [[lat,lng],...] while drawing
  const [pendingPolyZone, setPendingPolyZone] = useState(null) // finished points awaiting name
  // Truck tags
  const [truckTags, setTruckTags] = useState(() => {
    try { return JSON.parse(localStorage.getItem('fp-tags') || '{}') } catch { return {} }
  })
  const [tagFilter, setTagFilter] = useState(null)
  // External providers (AI-connected feeds)
  const [providers, setProviders] = useState(() => {
    try { return JSON.parse(localStorage.getItem('fp-providers') || '[]') } catch { return [] }
  })
  const [providerStatus, setProviderStatus] = useState({})
  const [replaySpeed, setReplaySpeed] = useState(1)
  const [showBrief, setShowBrief] = useState(false)
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [isOnline, setIsOnline] = useState(true)
  const [truckTimeline, setTruckTimeline] = useState({}) // {id:[{lat,lng,speed,fuel,temp,time},...]}
  const [replayIdx, setReplayIdx] = useState(null)
  const [replayPlaying, setReplayPlaying] = useState(false)
  const sessionStart = useRef(Date.now())

  // localStorage-persisted: alert thresholds
  const [settings, setSettings] = useState(() => {
    try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('fp-settings') || '{}') } }
    catch { return { ...DEFAULT_SETTINGS } }
  })
  // localStorage-persisted: per-truck notes
  const [truckNotes, setTruckNotes] = useState(() => {
    try { return JSON.parse(localStorage.getItem('fp-notes') || '{}') }
    catch { return {} }
  })

  const { speedThreshold: ST, fuelThreshold: FT, tempThreshold: TT } = settings

  const audioCtxRef = useRef(null)
  const soundEnabledRef = useRef(true)
  const trucksRef = useRef([])
  const selectedRef = useRef(null)
  const prevAlertKeysRef = useRef(new Set())
  const settingsRef = useRef(settings)
  const snoozedRef = useRef(snoozed)
  const mockRef = useRef({ initialized: false, trucks: [] })
  const shiftStartRef = useRef({})
  const isOnlineRef = useRef(true)
  const fleetHealthRef = useRef(100)
  const alertLogRef = useRef([])
  const idleStartTimesRef = useRef({})
  const alertCooldownRef = useRef({}) // { 'truckId::type': lastFiredTimestamp }
  // Single ref for keyboard handler — updated every render, never causes re-registration
  const kbRef = useRef({})
  const extTrucksRef = useRef([])        // trucks merged in from connected providers
  const geozonesRef = useRef([])
  const zoneMembershipRef = useRef(new Set()) // 'truckId::zoneId' currently inside

  useEffect(() => { soundEnabledRef.current = soundEnabled }, [soundEnabled])
  useEffect(() => { isOnlineRef.current = isOnline }, [isOnline])
  useEffect(() => { trucksRef.current = trucks }, [trucks])
  useEffect(() => { selectedRef.current = selected }, [selected])
  useEffect(() => { settingsRef.current = settings }, [settings])
  useEffect(() => { snoozedRef.current = snoozed }, [snoozed])
  useEffect(() => { shiftStartRef.current = shiftStart }, [shiftStart])
  useEffect(() => { geozonesRef.current = geozones }, [geozones])

  // Persist to localStorage
  useEffect(() => { localStorage.setItem('fp-settings', JSON.stringify(settings)) }, [settings])
  useEffect(() => { localStorage.setItem('fp-notes', JSON.stringify(truckNotes)) }, [truckNotes])
  useEffect(() => { localStorage.setItem('fp-ai-key', aiApiKey) }, [aiApiKey])
  useEffect(() => { localStorage.setItem('fp-zones', JSON.stringify(geozones)) }, [geozones])
  useEffect(() => { localStorage.setItem('fp-mode', appMode) }, [appMode])
  useEffect(() => { localStorage.setItem('fp-tags', JSON.stringify(truckTags)) }, [truckTags])
  useEffect(() => { localStorage.setItem('fp-providers', JSON.stringify(providers)) }, [providers])

  // Dynamic document title with live alert count
  useEffect(() => {
    const alerts = trucks.filter(t => t.speed > ST || t.fuel < FT || t.temperature > TT).length
    document.title = alerts > 0 ? `🚨 ${alerts} Alert${alerts > 1 ? 's' : ''} · FleetPulse` : '🚛 FleetPulse · Fleet Intelligence'
  }, [trucks, ST, FT, TT])

  // Auto-generate AI briefing 12 seconds after first truck load
  const autoAiDoneRef = useRef(false)
  useEffect(() => {
    if (autoAiDoneRef.current || trucks.length === 0) return
    autoAiDoneRef.current = true
    const t = setTimeout(() => {
      if (!aiAnalysis) getAI()
    }, 12000)
    return () => clearTimeout(t)
  }, [trucks.length, token]) // eslint-disable-line

  // Replay auto-advance
  useEffect(() => {
    if (!replayPlaying || replayIdx === null) return
    const timeline = truckTimeline[selected?.id] || []
    if (replayIdx >= timeline.length - 1) { setReplayPlaying(false); return }
    const t = setTimeout(() => setReplayIdx(i => i + 1), 400 / replaySpeed)
    return () => clearTimeout(t)
  }, [replayPlaying, replayIdx, selected?.id, truckTimeline, replaySpeed])

  // Connection check — skipped in explicit demo mode (token==='demo')
  useEffect(() => {
    if (token === 'demo') return
    const check = () => fetch(`${API}/api/test`).then(() => setIsOnline(true)).catch(() => setIsOnline(false))
    check()
    const t = setInterval(check, 15000)
    return () => clearInterval(t)
  }, [token])

  // Demo mode — single effect handles trucks + telemetry (fixes stale selected data bug)
  useEffect(() => {
    if (isOnline) return
    const m = mockRef.current
    if (!m.initialized) {
      m.trucks = DEMO_TRUCKS.map((t, i) => ({ ...t, _heading: Math.random() * 360, _targetSpeed: t.speed, weight: 6000 + ((i * 4327) % 21000) }))
      m.initialized = true
    }
    const tick = () => {
      m.trucks = m.trucks.map(t => {
        if (t.status === 'idle') {
          return { ...t, rpm: 800 + Math.random() * 80, temperature: 175 + Math.random() * 10 }
        }
        const heading = t._heading + (Math.random() - 0.5) * 18
        const rad = (heading * Math.PI) / 180
        const step = 0.00005 + Math.random() * 0.00005
        const lat = t.location.lat + Math.cos(rad) * step
        const lng = t.location.lng + Math.sin(rad) * step
        const targetSpeed = Math.max(20, Math.min(110, t._targetSpeed + (Math.random() - 0.5) * 12))
        const speed = Math.max(0, t.speed * 0.75 + targetSpeed * 0.25)
        const fuel = t.fuel - 0.012 < 12 ? 55 + Math.random() * 35 : t.fuel - 0.012
        const temperature = 185 + Math.random() * 30
        return { ...t, _heading: heading, _targetSpeed: targetSpeed, location: { lat, lng }, speed, fuel, temperature, rpm: 1600 + speed * 14 + Math.random() * 200 }
      })
      const snapshot = [
        ...m.trucks.map(({ _heading, _targetSpeed, ...rest }) => ({ ...rest, heading: Math.round(_heading) })),
        ...extTrucksRef.current,
      ]
      // Always sync selected to its latest live data (fixes stale detail card)
      const selId = selectedRef.current?.id
      const selectedSnap = (selId ? snapshot.find(t => t.id === selId) : null) ?? snapshot[0]
      setTrucks(snapshot)
      setTrucksLoading(false)
      setSelected(prev => {
        if (!prev) return selectedSnap
        return snapshot.find(t => t.id === prev.id) ?? prev
      })
      setFleetOverview(snapshot)
      setRoutes(prev => {
        const next = { ...prev }
        snapshot.forEach(t => {
          const pt = [t.location.lat, t.location.lng]
          if (!next[t.id]) next[t.id] = []
          const last = next[t.id][next[t.id].length - 1]
          // Skip if position hasn't moved meaningfully (reduces jitter in route lines)
          if (!last || Math.abs(pt[0] - last[0]) > 0.000005 || Math.abs(pt[1] - last[1]) > 0.000005)
            next[t.id] = [...next[t.id].slice(-50), pt]
        })
        return next
      })
      setTruckTimeline(prev => {
        const next = { ...prev }
        snapshot.forEach(t => {
          if (!next[t.id]) next[t.id] = []
          const snap = { lat: t.location.lat, lng: t.location.lng, speed: t.speed, fuel: t.fuel, temp: t.temperature, time: Date.now() }
          next[t.id] = [...next[t.id].slice(-60), snap]
        })
        return next
      })
      // Track idle start times and shift start times in demo mode
      setIdleStartTimes(prev => {
        const next = { ...prev }
        snapshot.forEach(t => {
          if (t.status === 'idle' && !next[t.id]) next[t.id] = Date.now()
          else if (t.status !== 'idle' && next[t.id]) delete next[t.id]
        })
        return next
      })
      setShiftStart(prev => {
        const next = { ...prev }
        snapshot.forEach(t => { if (!next[t.id]) next[t.id] = Date.now() })
        return next
      })

      // Demo alert detection with cooldown (prevents toast flooding)
      const { speedThreshold, fuelThreshold, tempThreshold } = settingsRef.current
      snapshot.forEach(t => {
        const fire = (type, msg, sev) => {
          const key = `${t.id}::${type}`
          const last = alertCooldownRef.current[key] || 0
          if (Date.now() - last < 90000) return
          alertCooldownRef.current[key] = Date.now()
          addToast(msg, sev)
          logEvent(type, msg, t.licensePlate)
        }
        if (t.speed > speedThreshold) fire('speed', `🚨 ${t.licensePlate} SPEEDING — ${t.speed.toFixed(0)} km/h`, 'red')
        if (t.fuel < fuelThreshold) fire('fuel', `⛽ ${t.licensePlate} LOW FUEL — ${t.fuel.toFixed(0)}%`, 'amber')
        if (t.temperature > tempThreshold) fire('temp', `🌡️ ${t.licensePlate} HIGH TEMP — ${t.temperature.toFixed(0)}°F`, 'red')
        if ((t.weight ?? 0) > MAX_WEIGHT_KG) fire('weight', `⚖️ ${t.licensePlate} OVERWEIGHT — ${(t.weight / 1000).toFixed(1)}t (limit ${(MAX_WEIGHT_KG / 1000).toFixed(0)}t)`, 'amber')
      })

      // Telemetry + history for the currently selected truck (no stale ref problem here)
      if (selectedSnap) {
        setTelemetry({
          truck: { ...selectedSnap, coolantTemp: 188 + Math.random() * 28, oilPressure: 38 + Math.random() * 18, signalStrength: -74 + Math.floor(Math.random() * 10), satelliteCount: 7 + Math.floor(Math.random() * 3) },
          safety: selectedSnap.safety || { speeding: 0, harshBraking: 0, rapidAcceleration: 0, sharpCornering: 0, excessiveIdle: 0, recentEvents: [] },
          events: [],
        })
        setTruckHistory(prev => {
          const hist = prev[selectedSnap.id] || []
          return { ...prev, [selectedSnap.id]: [...hist.slice(-59), { speed: selectedSnap.speed, fuel: selectedSnap.fuel, temp: selectedSnap.temperature, rpm: selectedSnap.rpm || 2000 }] }
        })
      }
    }
    tick()
    const interval = setInterval(tick, 2000)
    return () => clearInterval(interval)
  }, [isOnline])

  // Sound alert


  const playAlert = useCallback((type = 'warning') => {
    if (!soundEnabledRef.current) return
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)()
      const ctx = audioCtxRef.current
      const beep = (freq, start, dur) => {
        const osc = ctx.createOscillator(); const g = ctx.createGain()
        osc.connect(g); g.connect(ctx.destination)
        osc.type = 'sine'
        osc.frequency.setValueAtTime(freq, ctx.currentTime + start)
        g.gain.setValueAtTime(0, ctx.currentTime + start)
        g.gain.linearRampToValueAtTime(0.12, ctx.currentTime + start + 0.02)
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur)
        osc.start(ctx.currentTime + start); osc.stop(ctx.currentTime + start + dur)
      }
      if (type === 'critical') { beep(880, 0, 0.18); beep(880, 0.22, 0.18) }
      else { beep(660, 0, 0.28) }
    } catch { /* silently fail */ }
  }, [])

  const addToast = useCallback((msg, type = 'amber') => {
    const id = crypto.randomUUID()
    setToasts(prev => [...prev.slice(-4), { id, msg, type }])
    playAlert(type === 'red' ? 'critical' : 'warning')
    if (type === 'red' && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try { new Notification('FleetPulse 🚨', { body: msg, tag: 'fleet-alert', icon: '/favicon.ico' }) } catch {}
    }
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 6000)
  }, [playAlert])

  const dismissToast = (id) => setToasts(prev => prev.filter(t => t.id !== id))

  const logEvent = useCallback((type, msg, plate = null) => {
    setAlertLog(prev => [{ id: crypto.randomUUID(), time: new Date(), type, msg, plate }, ...prev.slice(0, 499)])
  }, [])

  const isOutsideGeofence = (lat, lng) => {
    const dLat = lat - GEOFENCE_CENTER[0], dLng = lng - GEOFENCE_CENTER[1]
    return Math.sqrt(dLat * dLat + dLng * dLng) > GEOFENCE_RADIUS_DEG
  }

  // Snooze helpers
  const snoozeAlert = useCallback((truckId, minutes) => {
    setSnoozed(prev => ({ ...prev, [truckId]: Date.now() + minutes * 60 * 1000 }))
    const label = minutes < 60 ? `${minutes} min` : `${minutes / 60} hr`
    const plate = trucksRef.current.find(t => t.id === truckId)?.licensePlate
    addToast(`⏸ Alert snoozed for ${label}`, 'amber')
    logEvent('snooze', `Alert snoozed for ${label}`, plate)
  }, [addToast, logEvent])
  const isSnoozed = (truckId) => snoozedRef.current[truckId] && snoozedRef.current[truckId] > Date.now()

  // ── External provider polling — feeds connected via AI Provider Connect ──────
  useEffect(() => {
    const active = providers.filter(p => !p.paused)
    if (!active.length) {
      if (extTrucksRef.current.length) {
        extTrucksRef.current = []
        setTrucks(prev => prev.filter(t => !t._ext))
      }
      return
    }
    const timers = active.map(p => {
      const poll = async () => {
        try {
          const json = await fetchFeed(p.url)
          const ext = adaptFeed(json, p)
          // Replace this provider's trucks inside the shared ext pool
          extTrucksRef.current = [...extTrucksRef.current.filter(t => t._providerId !== p.id), ...ext]
          setProviderStatus(prev => ({ ...prev, [p.id]: { count: ext.length, lastOk: Date.now(), error: null } }))
          setTrucks(prev => [...prev.filter(t => !t._ext), ...extTrucksRef.current])
          // Trails + playback timeline for external trucks too
          setRoutes(prev => {
            const next = { ...prev }
            ext.forEach(t => {
              const pt = [t.location.lat, t.location.lng]
              if (!next[t.id]) next[t.id] = []
              const last = next[t.id][next[t.id].length - 1]
              if (!last || last[0] !== pt[0] || last[1] !== pt[1]) next[t.id] = [...next[t.id].slice(-50), pt]
            })
            return next
          })
          setTruckTimeline(prev => {
            const next = { ...prev }
            ext.forEach(t => {
              if (!next[t.id]) next[t.id] = []
              next[t.id] = [...next[t.id].slice(-60), { lat: t.location.lat, lng: t.location.lng, speed: t.speed, fuel: t.fuel, temp: t.temperature, time: Date.now() }]
            })
            return next
          })
        } catch (e) {
          setProviderStatus(prev => ({ ...prev, [p.id]: { ...(prev[p.id] || {}), error: e.message } }))
        }
      }
      poll()
      return setInterval(poll, Math.max(3, p.intervalSec) * 1000)
    })
    return () => timers.forEach(clearInterval)
  }, [providers])

  // ── Per-zone entry/exit alerts (circle + polygon zones) ──────────────────────
  useEffect(() => {
    if (!trucks.length || !geozonesRef.current.length) return
    const zones = geozonesRef.current
    const current = new Set()
    trucks.forEach(t => zones.forEach(z => {
      if (isInsideZone(z, t.location.lat, t.location.lng)) current.add(`${t.id}::${z.id}`)
    }))
    const prev = zoneMembershipRef.current
    const fire = (key, entered) => {
      const sep = key.indexOf('::')
      const t = trucks.find(x => x.id === key.slice(0, sep))
      const z = zones.find(x => String(x.id) === key.slice(sep + 2))
      if (!t || !z) return
      const cdKey = `${key}::zone`
      const last = alertCooldownRef.current[cdKey] || 0
      if (Date.now() - last < 60000) return
      alertCooldownRef.current[cdKey] = Date.now()
      const msg = entered
        ? `📍 ${t.licensePlate} ENTERED "${z.name}"`
        : `📤 ${t.licensePlate} LEFT "${z.name}"`
      addToast(msg, 'amber')
      logEvent('zone', msg, t.licensePlate)
    }
    if (prev.size || current.size) {
      current.forEach(k => { if (!prev.has(k)) fire(k, true) })
      prev.forEach(k => {
        // Only alert exit if the truck still exists (avoids noise when feeds drop out)
        if (!current.has(k) && trucks.some(t => t.id === k.slice(0, k.indexOf('::')))) fire(k, false)
      })
    }
    zoneMembershipRef.current = current
  }, [trucks, addToast, logEvent])

  // Trucks polling
  useEffect(() => {
    if (!token) return
    const poll = () => {
      fetch(`${API}/api/trucks`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then(raw => {
          const data = [...raw, ...extTrucksRef.current]
          setTrucks(data)
          setTrucksLoading(false)
          // Use ref so adding this dep doesn't re-register the interval on every truck select
          if (!selectedRef.current && data.length > 0) setSelected(data[0])
          setRoutes(prev => {
            const next = { ...prev }
            data.forEach(t => {
              const pt = [t.location.lat, t.location.lng]
              if (!next[t.id]) next[t.id] = []
              const last = next[t.id][next[t.id].length - 1]
              if (!last || last[0] !== pt[0] || last[1] !== pt[1])
                next[t.id] = [...next[t.id].slice(-50), pt]
            })
            return next
          })
          // Timeline for trip replay (lat/lng + telemetry snapshot)
          setTruckTimeline(prev => {
            const next = { ...prev }
            data.forEach(t => {
              if (!next[t.id]) next[t.id] = []
              const last = next[t.id][next[t.id].length - 1]
              const snap = { lat: t.location.lat, lng: t.location.lng, speed: t.speed, fuel: t.fuel, temp: t.temperature, time: Date.now() }
              if (!last || last.lat !== snap.lat || last.lng !== snap.lng)
                next[t.id] = [...next[t.id].slice(-60), snap]
            })
            return next
          })
          // Track idle start times
          setIdleStartTimes(prev => {
            const next = { ...prev }
            data.forEach(t => {
              if (t.status === 'idle' && !next[t.id]) next[t.id] = Date.now()
              else if (t.status !== 'idle' && next[t.id]) delete next[t.id]
            })
            return next
          })
          // Track shift start times (first time we see each truck)
          setShiftStart(prev => {
            const next = { ...prev }
            data.forEach(t => { if (!next[t.id]) next[t.id] = Date.now() })
            return next
          })
          // Alert detection using current thresholds via ref
          const { speedThreshold, fuelThreshold, tempThreshold } = settingsRef.current
          const currentKeys = new Set()
          data.forEach(t => {
            // Use '::' separator so IDs containing underscores parse correctly
            if (t.speed > speedThreshold) currentKeys.add(`${t.id}::speed`)
            if (t.fuel < fuelThreshold) currentKeys.add(`${t.id}::fuel`)
            if (t.temperature > tempThreshold) currentKeys.add(`${t.id}::temp`)
            if ((t.weight ?? 0) > MAX_WEIGHT_KG) currentKeys.add(`${t.id}::weight`)
            if (isOutsideGeofence(t.location.lat, t.location.lng)) currentKeys.add(`${t.id}::geo`)
            const shiftMins = shiftStartRef.current[t.id] ? Math.floor((Date.now() - shiftStartRef.current[t.id]) / 60000) : 0
            if (shiftMins >= 600) currentKeys.add(`${t.id}::hos10`)
            else if (shiftMins >= 480) currentKeys.add(`${t.id}::hos8`)
          })
          const canAlert = (truckId, type, cooldownMs = 90000) => {
            const key = `${truckId}::${type}`
            const last = alertCooldownRef.current[key] || 0
            if (Date.now() - last < cooldownMs) return false
            alertCooldownRef.current[key] = Date.now()
            return true
          }
          currentKeys.forEach(key => {
            if (!prevAlertKeysRef.current.has(key)) {
              const sep = key.indexOf('::')
              const id = key.slice(0, sep)
              const type = key.slice(sep + 2)
              const truck = data.find(t => t.id === id)
              if (!truck || acknowledged.has(id) || isSnoozed(id)) return
              if (!canAlert(id, type)) return
              const msgs = {
                speed: `🚨 ${truck.licensePlate} SPEEDING — ${truck.speed.toFixed(0)} km/h`,
                fuel:  `⛽ ${truck.licensePlate} LOW FUEL — ${truck.fuel.toFixed(0)}%`,
                temp:  `🌡️ ${truck.licensePlate} HIGH TEMP — ${truck.temperature.toFixed(0)}°F`,
                weight: `⚖️ ${truck.licensePlate} OVERWEIGHT — ${((truck.weight || 0) / 1000).toFixed(1)}t (limit ${(MAX_WEIGHT_KG / 1000).toFixed(0)}t)`,
                geo:   `📍 ${truck.licensePlate} LEFT GEOFENCE ZONE`,
                hos8:  `⏱ ${truck.licensePlate} — Driver at 8-hour shift limit`,
                hos10: `🚨 ${truck.licensePlate} — Driver exceeded 10-hour HOS maximum`,
              }
              if (msgs[type]) {
                addToast(msgs[type], type === 'speed' || type === 'temp' || type === 'hos10' ? 'red' : 'amber')
                logEvent(type, msgs[type], truck.licensePlate)
              }
            }
          })
          prevAlertKeysRef.current = currentKeys
        }).catch(() => {})
    }
    poll()
    const t = setInterval(poll, 2000)
    return () => clearInterval(t)
  }, [token, acknowledged, addToast, logEvent])

  // Telemetry + history
  useEffect(() => {
    if (!token || !selected) return
    // External provider trucks have no backend telemetry endpoint — read live state directly
    if (selected._ext) {
      const poll = () => {
        const t = trucksRef.current.find(x => x.id === selected.id)
        if (!t) return
        setTelemetry({ truck: t, safety: t.safety, events: [] })
        setTruckHistory(prev => {
          const hist = prev[t.id] || []
          return { ...prev, [t.id]: [...hist.slice(-59), { speed: t.speed, fuel: t.fuel, temp: t.temperature, rpm: t.rpm ?? 0 }] }
        })
      }
      poll()
      const t = setInterval(poll, 2000)
      return () => clearInterval(t)
    }
    const poll = () => {
      fetch(`${API}/api/truck-telemetry/${selected.id}`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then(data => {
          setTelemetry(data)
          setTruckHistory(prev => {
            const hist = prev[selected.id] || []
            return { ...prev, [selected.id]: [...hist.slice(-59), { speed: data.truck.speed, fuel: data.truck.fuel, temp: data.truck.temperature, rpm: data.truck.rpm ?? 0 }] }
          })
        }).catch(() => {})
    }
    poll()
    const t = setInterval(poll, 2000)
    return () => clearInterval(t)
  }, [token, selected])

  // Fleet overview (leaderboard)
  useEffect(() => {
    if (!token) return
    const poll = () => {
      fetch(`${API}/api/fleet-overview`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json()).then(setFleetOverview).catch(() => {})
    }
    poll()
    const t = setInterval(poll, 8000)
    return () => clearInterval(t)
  }, [token])

  const selectTruck = useCallback((t) => {
    setSelected(t); setDetailTab('overview'); setDetailCollapsed(false)
    setReplayIdx(null); setReplayPlaying(false)
  }, [])

  const getAI = useCallback(() => {
    setAiLoading(true)
    setAiAnalysis('')
    if (!isOnlineRef.current) {
      const analysis = buildDemoAnalysis(trucksRef.current, ST, FT, TT, fleetHealthRef.current, alertLogRef.current, idleStartTimesRef.current)
      setTimeout(() => { setAiAnalysis(analysis); setAiLoading(false); setAiLastUpdated(new Date()) }, 1200)
      return
    }
    fetch(`${API}/api/ai-analysis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ trucks: trucksRef.current }),
    }).then(r => r.json())
      .then(d => { setAiAnalysis(d.analysis); setAiLoading(false); setAiLastUpdated(new Date()) })
      .catch(() => { setAiAnalysis('Could not generate analysis.'); setAiLoading(false) })
  }, [token, ST, FT, TT])

  // Route export CSV
  const exportRoute = useCallback((truck) => {
    const pts = routes[truck.id] || []
    if (pts.length < 2) { addToast('Not enough route data yet.', 'amber'); return }
    const csv = 'lat,lng\n' + pts.map(([lat, lng]) => `${lat},${lng}`).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${truck.licensePlate}_route_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    addToast(`📥 Route exported for ${truck.licensePlate}`, 'amber')
  }, [routes, addToast])

  // Keyboard shortcuts — registered once only (empty deps); reads live functions via kbRef
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.key >= '1' && e.key <= '5') {
        const t = trucksRef.current[parseInt(e.key) - 1]
        if (t) kbRef.current.selectTruck(t)
      }
      if (e.key === 'b' || e.key === 'B') setShowBrief(p => !p)
      if (e.key === 'd' || e.key === 'D') setShowDispatch(p => !p)
      if (e.key === 'f' || e.key === 'F') setShowFullMap(p => !p)
      if (e.key === 'p' || e.key === 'P') kbRef.current.exportPDF()
      if (e.key === 'e' || e.key === 'E') kbRef.current.exportCSV()
      if (e.key === 'l' || e.key === 'L') setShowLeaderboard(p => !p)
      if (e.key === 's' || e.key === 'S') setSoundEnabled(p => !p)
      if (e.key === ',') setShowSettings(p => !p)
      if (e.key === '?') setShowHelp(p => !p)
      if (e.key === 'h' || e.key === 'H') setShowAlertLog(p => !p)
      if (e.key === 'g' || e.key === 'G') setShowEmissions(p => !p)
      if (e.key === 'x' || e.key === 'X') setShowSOS(p => !p)
      if (e.key === 'o' || e.key === 'O') setShowOptimizer(p => !p)
      if (e.key === 'm' || e.key === 'M') setShowPredMaint(p => !p)
      if (e.key === 'v' || e.key === 'V') setShowFinancials(p => !p)
      if (e.key === 'w' || e.key === 'W') setShowMonitoring(p => !p)
      if (e.key === 'r' || e.key === 'R') setShowPlayback(p => !p)
      if (e.key === 'c' || e.key === 'C') setShowConnect(p => !p)
      if (e.key === 'z' || e.key === 'Z') setShowZones(p => !p)
      if (e.key === 't' || e.key === 'T') setAppMode(m => m === 'fms' ? 'tms' : 'fms')
      if (e.key === '`') setFocusMode(p => !p)
      if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); setShowPalette(p => !p) }
      if (e.key === '/' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); setShowPalette(true) }
      if (e.key === 'Escape') {
        setShowFullMap(false); setShowLeaderboard(false); setShowHelp(false)
        setShowSettings(false); setShowMessage(null); setShowAlertLog(false)
        setShowPalette(false); setShowCostAnalytics(false); setShowDispatch(false)
        setAddingZone(false); setShowSOS(false); setShowEmissions(false)
        setShowMonitoring(false); setShowPlayback(false); setShowConnect(false)
        setShowZones(false); setZoneTypeChooser(false); setPolyDraft(null); setPendingPolyZone(null)
        setShowOptimizer(false); setShowPredMaint(false); setShowFinancials(false); setShowBrief(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Computed values ────────────────────────────────────────────────────────
  const truckColor = (t) => t.speed > ST ? '#ef4444' : t.fuel < FT ? '#f59e0b' : t.status === 'idle' ? '#94a3b8' : '#22c55e'
  const truckStatus = (t) => {
    if (t.speed > ST) return { label: 'Speeding', cls: 'red' }
    if (t.fuel < FT) return { label: 'Low Fuel', cls: 'amber' }
    if (t.status === 'idle') return { label: 'Idle', cls: 'gray' }
    return { label: 'In Transit', cls: 'green' }
  }

  const {
    activeCount, idleCount, speedingCount, lowFuelCount,
    avgFuel, alertCount, totalRefuelSAR, fleetHealth,
  } = useMemo(() => {
    if (!trucks.length) return { activeCount:0, idleCount:0, speedingCount:0, lowFuelCount:0, avgFuel:0, alertCount:0, totalRefuelSAR:0, fleetHealth:100 }
    let active=0, idle=0, speeding=0, lowfuel=0, alerts=0, fuelSum=0, refuelCost=0, healthSum=0
    trucks.forEach(t => {
      if (t.status === 'active') active++
      if (t.status === 'idle')   idle++
      if (t.speed > ST)  { speeding++; alerts++ }
      if (t.fuel < FT)   { lowfuel++;  alerts++ }
      if (t.temperature > TT) alerts++
      fuelSum   += t.fuel
      refuelCost += ((100 - t.fuel) / 100) * TANK_LITRES * FUEL_PRICE_SAR
      let s = 100
      if (t.speed > ST) s -= 30
      if (t.fuel < FT) s -= 30; else if (t.fuel < FT * 2) s -= 10
      if (t.temperature > TT) s -= 25
      healthSum += Math.max(0, s)
    })
    return {
      activeCount: active, idleCount: idle, speedingCount: speeding, lowFuelCount: lowfuel,
      avgFuel: Math.round(fuelSum / trucks.length), alertCount: alerts,
      totalRefuelSAR: Math.round(refuelCost),
      fleetHealth: Math.round(healthSum / trucks.length),
    }
  }, [trucks, ST, FT, TT])

  const criticalTrucks = useMemo(() => trucks
    .filter(t => !acknowledged.has(t.id) && !isSnoozed(t.id) && (t.speed > ST || t.fuel < FT || t.temperature > TT))
    .sort((a, b) => {
      const sc = t => (t.speed > ST ? 3 : 0) + (t.fuel < FT ? 2 : 0) + (t.temperature > TT ? 1 : 0)
      return sc(b) - sc(a)
    }), [trucks, acknowledged, snoozed, ST, FT, TT])

  // Idle waste SAR — memoized so it doesn't recalculate on every UI render
  const totalIdleWasteSAR = useMemo(() =>
    Object.keys(idleStartTimes).reduce((sum, id) => {
      const mins = Math.floor((Date.now() - idleStartTimes[id]) / 60000)
      return sum + (mins > 0 ? (mins / 60) * 3 * FUEL_PRICE_SAR : 0)
    }, 0)
  , [idleStartTimes])

  const co2Stats = useMemo(() => {
    const CO2_PER_LITRE = 2.68
    const sessionHrs = Math.max(0.001, (Date.now() - sessionStart.current) / 3600000)
    const perTruck = trucks.map(t => {
      const hist = truckHistory[t.id]
      let lph = 0
      if (hist && hist.length >= 4) {
        const recent = hist.slice(-8)
        const drain = recent[0].fuel - recent[recent.length - 1].fuel
        if (drain > 0) {
          const secs = (recent.length - 1) * 2
          const rate = (drain / 100) * TANK_LITRES / (secs / 3600)
          if (rate >= 0.1 && rate <= 200) lph = parseFloat(rate.toFixed(1))
        }
      }
      const co2Kg = lph * sessionHrs * CO2_PER_LITRE
      return { plate: t.licensePlate, driver: t.driver?.name, lph, co2Kg: co2Kg.toFixed(2) }
    })
    const totalLph = perTruck.reduce((s, t) => s + t.lph, 0)
    const totalLiters = totalLph * sessionHrs
    const co2Kg = totalLiters * CO2_PER_LITRE
    const projMonthlyKg = totalLph * 24 * 30 * CO2_PER_LITRE
    return {
      co2Kg: co2Kg.toFixed(1),
      totalLiters: totalLiters.toFixed(1),
      projMonthlyKg: Math.round(projMonthlyKg),
      offsetCostSAR: (co2Kg * 0.15).toFixed(2),
      burnLph: totalLph.toFixed(1),
      perTruck,
    }
  }, [trucks, truckHistory])

  const maintenanceTrucks = useMemo(() => trucks.filter(t =>
    !acknowledgedMaint.has(t.id) && ((t.engineHours || 0) > 3500 || (t.activeDTCs?.length || 0) > 0)
  ), [trucks, acknowledgedMaint])

  const getFuelETA = (truckId) => {
    const hist = truckHistory[truckId]
    if (!hist || hist.length < 6) return null
    const recent = hist.slice(-6)
    const drain = recent[0].fuel - recent[recent.length - 1].fuel
    if (drain <= 0) return null
    const ratePerInterval = drain / (recent.length - 1)
    const truck = trucks.find(t => t.id === truckId)
    if (!truck || ratePerInterval <= 0) return null
    const mins = Math.round((truck.fuel / ratePerInterval) * 2 / 60)
    return mins >= 1 && mins <= 180 ? mins : null
  }

  const getFuelBurnRate = (truckId) => {
    const hist = truckHistory[truckId]
    if (!hist || hist.length < 4) return null
    const recent = hist.slice(-8)
    const drain = recent[0].fuel - recent[recent.length - 1].fuel
    if (drain <= 0) return null
    const secs = (recent.length - 1) * 2
    const litresPerHour = (drain / 100) * TANK_LITRES / (secs / 3600)
    if (litresPerHour > 200 || litresPerHour < 0.1) return null
    return { lph: litresPerHour.toFixed(1), sar: (litresPerHour * FUEL_PRICE_SAR).toFixed(2) }
  }

  const getIdleDuration = (truckId) => {
    const start = idleStartTimes[truckId]
    if (!start) return null
    const mins = Math.floor((Date.now() - start) / 60000)
    return mins > 0 ? mins : null
  }

  const getShiftHours = (truckId) => {
    const start = shiftStart[truckId]
    if (!start) return null
    return Math.floor((Date.now() - start) / 60000)
  }

  const onMapClick = useCallback((latlng) => {
    if (polyDraft !== null) {
      setPolyDraft(prev => [...prev, [latlng.lat, latlng.lng]])
      return
    }
    if (!addingZone) return
    setAddingZone(false)
    setPendingZoneLatlng(latlng)
  }, [addingZone, polyDraft])

  const copyStatusReport = useCallback(() => {
    const sessionMins = Math.floor((Date.now() - sessionStart.current) / 60000)
    const lines = [
      `🚛 FleetPulse Status Report`,
      `${new Date().toLocaleString()}  |  Session: ${sessionMins < 60 ? sessionMins + 'm' : Math.floor(sessionMins / 60) + 'h ' + (sessionMins % 60) + 'm'}`,
      `─────────────────────────────────────`,
      `Fleet Health: ${fleetHealth}/100`,
      `Trucks: ${trucks.length} total · ${activeCount} active · ${idleCount} idle · ${speedingCount} speeding`,
      `Avg Fuel: ${avgFuel}%  |  Active Alerts: ${alertCount}`,
      `Est. Refuel Cost: SAR ${totalRefuelSAR.toLocaleString()}`,
      ``,
    ]
    if (criticalTrucks.length > 0) {
      lines.push(`⚡ Critical (${criticalTrucks.length}):`)
      criticalTrucks.forEach(t => {
        const issues = [
          t.speed > ST && `${t.speed.toFixed(0)} km/h`,
          t.fuel < FT && `${t.fuel.toFixed(0)}% fuel`,
          t.temperature > TT && `${t.temperature.toFixed(0)}°F`,
        ].filter(Boolean).join(', ')
        lines.push(`  • ${t.licensePlate} (${t.driver?.name || '–'}) — ${issues}`)
      })
      lines.push(``)
    }
    if (alertLog.length > 0) {
      lines.push(`📋 Recent Events:`)
      alertLog.slice(0, 5).forEach(e => {
        lines.push(`  ${e.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} — ${e.msg}`)
      })
    }
    navigator.clipboard?.writeText(lines.join('\n')).catch(() => {})
    addToast('📋 Status report copied to clipboard', 'amber')
  }, [trucks, activeCount, idleCount, speedingCount, avgFuel, alertCount, totalRefuelSAR,
      criticalTrucks, fleetHealth, alertLog, ST, FT, TT, addToast])

  // PDF fleet report — opens in new window, auto-prints
  const exportPDF = useCallback(() => {
    const now = new Date()
    const sessionMins = Math.floor((Date.now() - sessionStart.current) / 60000)
    const rows = trucks.map(t => {
      const isSpd = t.speed > ST, isLF = t.fuel < FT, isHT = t.temperature > TT
      const stObj = truckStatus(t)
      const maint = getMaintStatus(t)
      return `<tr class="${isSpd || isHT ? 'crit' : isLF ? 'warn' : ''}">
        <td class="plate">${t.licensePlate}</td>
        <td>${t.driver?.name || '–'}</td>
        <td ${isSpd ? 'style="color:#ef4444;font-weight:700"' : ''}>${t.speed.toFixed(0)} km/h</td>
        <td ${isLF ? 'style="color:#ef4444;font-weight:700"' : t.fuel < FT * 2 ? 'style="color:#f59e0b;font-weight:700"' : ''}>${t.fuel.toFixed(0)}%</td>
        <td ${isHT ? 'style="color:#ef4444;font-weight:700"' : ''}>${t.temperature.toFixed(0)}°F</td>
        <td><span class="badge ${stObj.cls}">${stObj.label}</span></td>
        <td>${(t.odometer || 0).toLocaleString()} km</td>
        <td ${maint.urgent ? 'style="color:#ef4444;font-weight:700"' : maint.warn ? 'style="color:#f59e0b;font-weight:700"' : ''}>${maint.urgent ? '⚠️ Due now' : maint.oilKm.toLocaleString() + ' km'}</td>
      </tr>`
    }).join('')
    const critRows = criticalTrucks.map(t => {
      const issues = [t.speed > ST && `Speeding: ${t.speed.toFixed(0)} km/h`, t.fuel < FT && `Low Fuel: ${t.fuel.toFixed(0)}%`, t.temperature > TT && `High Temp: ${t.temperature.toFixed(0)}°F`].filter(Boolean).join(' · ')
      return `<li><strong>${t.licensePlate}</strong> — ${t.driver?.name || '–'} · ${issues}</li>`
    }).join('')
    const eventRows = alertLog.slice(0, 10).map(e => `<li>${e.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} — ${e.msg}</li>`).join('')
    const html = `<!DOCTYPE html><html><head><title>FleetPulse Report — ${now.toLocaleDateString()}</title><meta charset="utf-8">
<style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:system-ui,sans-serif;color:#1e293b;background:#fff;padding:28px;font-size:12px;}
.hd{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;padding-bottom:14px;border-bottom:2px solid #e2e8f0;}
.logo{font-size:24px;font-weight:900;color:#0f172a;}.logo span{color:#6366f1;}
.meta{font-size:10px;color:#64748b;text-align:right;line-height:1.9;}
.kpis{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:20px;}
.kpi{background:#f8fafc;border:1px solid #e2e8f0;border-radius:7px;padding:10px;text-align:center;}
.kv{font-size:20px;font-weight:900;color:#0f172a;}.kv.r{color:#ef4444;}.kv.a{color:#f59e0b;}.kv.g{color:#22c55e;}
.kl{font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-top:3px;}
h2{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#475569;margin:16px 0 8px;padding-bottom:5px;border-bottom:1px solid #e2e8f0;}
table{width:100%;border-collapse:collapse;font-size:11px;}
th{background:#f1f5f9;text-align:left;padding:6px 9px;font-size:9px;text-transform:uppercase;letter-spacing:.04em;color:#64748b;font-weight:600;}
td{padding:6px 9px;border-bottom:1px solid #f8fafc;}tr.crit td{background:#fff5f5;}tr.warn td{background:#fffbf0;}
td.plate{font-weight:700;font-family:monospace;}
.badge{display:inline-block;padding:1px 6px;border-radius:8px;font-size:9px;font-weight:700;}
.badge.red{background:#fee2e2;color:#dc2626;}.badge.amber{background:#fef3c7;color:#d97706;}
.badge.green{background:#dcfce7;color:#16a34a;}.badge.gray{background:#f1f5f9;color:#475569;}
.box{border-radius:7px;padding:12px;margin-bottom:12px;}
.crit-box{background:#fff5f5;border:1px solid #fecaca;}.warn-box{background:#fffbf0;border:1px solid #fde68a;}
.box li{list-style:none;padding:4px 0;border-bottom:1px solid rgba(0,0,0,.05);font-size:11px;}
.box li:last-child{border:none;}
.ft{margin-top:24px;padding-top:8px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;font-size:9px;color:#94a3b8;}
@media print{body{padding:12px;}@page{margin:.7cm;}}</style></head><body>
<div class="hd">
  <div><div class="logo">Fleet<span>Pulse</span></div><div style="font-size:10px;color:#64748b;margin-top:3px;">Fleet Management Report</div></div>
  <div class="meta">Generated: ${now.toLocaleString()}<br>Session: ${sessionMins < 60 ? sessionMins + ' min' : Math.floor(sessionMins / 60) + 'h ' + (sessionMins % 60) + 'm'}<br>Health: <strong style="color:${fleetHealth >= 80 ? '#22c55e' : fleetHealth >= 55 ? '#f59e0b' : '#ef4444'}">${fleetHealth}/100</strong></div>
</div>
<div class="kpis">
  <div class="kpi"><div class="kv">${trucks.length}</div><div class="kl">Total</div></div>
  <div class="kpi"><div class="kv g">${activeCount}</div><div class="kl">Active</div></div>
  <div class="kpi"><div class="kv ${speedingCount > 0 ? 'r' : ''}">${speedingCount}</div><div class="kl">Speeding</div></div>
  <div class="kpi"><div class="kv ${idleCount > 0 ? 'a' : ''}">${idleCount}</div><div class="kl">Idle</div></div>
  <div class="kpi"><div class="kv ${avgFuel < 30 ? 'a' : ''}">${avgFuel}%</div><div class="kl">Avg Fuel</div></div>
  <div class="kpi"><div class="kv">SAR ${totalRefuelSAR.toLocaleString()}</div><div class="kl">Refuel Cost</div></div>
</div>
${criticalTrucks.length > 0 ? `<h2>⚡ Critical — Immediate Action (${criticalTrucks.length})</h2><ul class="box crit-box">${critRows}</ul>` : ''}
<h2>Fleet Status — All ${trucks.length} Trucks</h2>
<table><thead><tr><th>Plate</th><th>Driver</th><th>Speed</th><th>Fuel</th><th>Temp</th><th>Status</th><th>Odometer</th><th>Next Oil Change</th></tr></thead><tbody>${rows}</tbody></table>
${alertLog.length > 0 ? `<h2>📋 Session Events (${Math.min(10, alertLog.length)} of ${alertLog.length})</h2><ul class="box warn-box">${eventRows}</ul>` : ''}
<div class="ft"><span>FleetPulse · AI Fleet Intelligence</span><span>Confidential — Internal use only</span><span>${now.toLocaleDateString()}</span></div>
<script>setTimeout(()=>window.print(),350)</script></body></html>`
    const w = window.open('', '_blank', 'width=960,height=720')
    if (w) { w.document.write(html); w.document.close() }
    else addToast('Allow popups to export PDF report', 'amber')
  }, [trucks, criticalTrucks, alertLog, activeCount, idleCount, speedingCount, avgFuel, totalRefuelSAR, fleetHealth, ST, FT, TT, addToast])

  const enableNotifications = useCallback(async () => {
    if (typeof Notification === 'undefined') { addToast('Push notifications not supported in this browser', 'amber'); return }
    if (Notification.permission === 'denied') { addToast('Notifications blocked — enable them in browser settings', 'amber'); return }
    const result = await Notification.requestPermission()
    setNotifPermission(result)
    if (result === 'granted') {
      addToast('🔔 Push notifications enabled — alerts will appear even when tab is in background', 'amber')
      try { new Notification('FleetPulse', { body: 'Notifications active. You\'ll receive critical alerts here.', icon: '/favicon.ico' }) } catch {}
    }
  }, [addToast])

  const exportCSV = useCallback(() => {
    const stamp = new Date().toISOString().slice(0, 10)
    const fleetRows = [
      'Plate,Driver,Status,Speed(km/h),Fuel(%),Temp(°F),RPM,Odometer(km),EngineHours,SafetyScore,ShiftHours,ActiveDTCs',
      ...trucks.map(t => [
        t.licensePlate,
        `"${t.driver?.name || '–'}"`,
        t.status,
        t.speed.toFixed(1),
        t.fuel.toFixed(1),
        t.temperature.toFixed(1),
        Math.round(t.rpm || 0),
        t.odometer || 0,
        t.engineHours || 0,
        t.safetyScore || 0,
        t.shiftHours?.toFixed(1) || 0,
        `"${(t.activeDTCs || []).map(d => d.code).join(';') || 'none'}"`,
      ].join(','))
    ].join('\n')
    const dl = (content, name) => {
      const blob = new Blob([content], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = Object.assign(document.createElement('a'), { href: url, download: name })
      a.click(); URL.revokeObjectURL(url)
    }
    dl(fleetRows, `fleet_data_${stamp}.csv`)
    if (alertLog.length > 0) {
      const alertRows = [
        'Time,Type,Message,Plate',
        ...alertLog.map(e => `${e.time.toISOString()},${e.type},"${e.msg}",${e.plate || ''}`)
      ].join('\n')
      setTimeout(() => dl(alertRows, `alert_log_${stamp}.csv`), 400)
    }
    addToast(`📥 Exported ${trucks.length} trucks${alertLog.length > 0 ? ` + ${alertLog.length} alerts` : ''} as CSV`, 'amber')
  }, [trucks, alertLog, addToast])

  // Keep kbRef fresh on every render so keyboard handler calls latest versions of getAI/exportPDF
  kbRef.current = { selectTruck, getAI, exportPDF, exportCSV }
  // Sync late-computed values into refs so callbacks declared earlier can read them
  fleetHealthRef.current = fleetHealth
  alertLogRef.current = alertLog
  idleStartTimesRef.current = idleStartTimes

  // Fleet filter + search — memoized so it only recomputes when inputs change
  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return trucks.filter(t => {
      const tTags = truckTags[t.id] || []
      const matchesSearch = !search
        || t.licensePlate.toLowerCase().includes(q)
        || t.driver?.name.toLowerCase().includes(q)
        || tTags.some(tag => tag.includes(q))
      const matchesFilter =
        fleetFilter === 'all'      ? true :
        fleetFilter === 'active'   ? t.status === 'active' :
        fleetFilter === 'speeding' ? t.speed > ST :
        fleetFilter === 'lowfuel'  ? t.fuel < FT :
        fleetFilter === 'idle'     ? t.status === 'idle' : true
      const matchesTag = !tagFilter || tTags.includes(tagFilter)
      return matchesSearch && matchesFilter && matchesTag
    })
  }, [trucks, search, fleetFilter, ST, FT, truckTags, tagFilter])

  // All tags in use across the fleet (for the filter row)
  const allTags = useMemo(() => {
    const s = new Set()
    Object.values(truckTags).forEach(list => list.forEach(t => s.add(t)))
    return [...s].sort()
  }, [truckTags])

  const countInZone = useCallback((zone) =>
    trucksRef.current.filter(t => isInsideZone(zone, t.location.lat, t.location.lng)).length
  , [])
  const extCount = useMemo(() => trucks.filter(t => t._ext).length, [trucks])

  // Proactive predictions — what's about to go wrong
  const predictions = useMemo(() => {
    const preds = []
    trucks.forEach(t => {
      const eta = getFuelETA(t.id)
      if (eta !== null && eta <= 30) preds.push({ type: 'fuel', severity: eta <= 15 ? 'critical' : 'warn', msg: `${t.licensePlate} empty in ~${eta}m`, plate: t.licensePlate, truckId: t.id })
      const ms = getMaintStatus(t)
      if (ms.urgent) preds.push({ type: 'maint', severity: 'warn', msg: `${t.licensePlate} oil change due now`, plate: t.licensePlate, truckId: t.id })
      const idle = getIdleDuration(t.id)
      if (idle !== null && idle >= 20) preds.push({ type: 'idle', severity: 'info', msg: `${t.licensePlate} idle ${idle}m — SAR ${(idle / 60 * 3 * FUEL_PRICE_SAR).toFixed(2)} wasted`, plate: t.licensePlate, truckId: t.id })
    })
    return preds.slice(0, 6)
  }, [trucks, truckHistory, idleStartTimes])

  const tr = telemetry?.truck
  const driver = tr?.driver
  const safety = telemetry?.safety
  const events = telemetry?.events || []
  const dtcs = tr?.activeDTCs || []
  const safetyScore = safety
    ? Math.max(0, 100 - safety.harshBraking * 3 - safety.rapidAcceleration * 2 - safety.sharpCornering * 2 - safety.speeding * 5) : null
  const selectedHistory = truckHistory[selected?.id] || []

  // ── CopilotKit ───────────────────────────────────────────────────────────────
  useCopilotReadable({ description: 'Live telemetry for all fleet trucks', value: trucks })
  useCopilotReadable({ description: 'Detailed telemetry for selected truck', value: telemetry })
  useCopilotReadable({ description: 'Fleet KPIs: health score, alerts, cost', value: { fleetHealth, total: trucks.length, active: activeCount, speeding: speedingCount, avgFuel, alerts: alertCount, refuelCostSAR: totalRefuelSAR } })
  useCopilotReadable({ description: 'Driver leaderboard with safety scores', value: fleetOverview })
  useCopilotReadable({ description: 'Alert thresholds (configurable)', value: settings })
  useCopilotReadable({ description: 'Trucks needing immediate action', value: criticalTrucks.map(t => ({ plate: t.licensePlate, driver: t.driver?.name, issues: [t.speed > ST && 'speeding', t.fuel < FT && 'low fuel', t.temperature > TT && 'high temp'].filter(Boolean) })) })

  useCopilotAction({
    name: 'selectTruck',
    description: 'Focus the map on a specific truck',
    parameters: [{ name: 'licensePlate', type: 'string', description: 'License plate' }],
    handler: ({ licensePlate }) => {
      const truck = trucks.find(t => t.licensePlate.toLowerCase() === licensePlate.toLowerCase())
      if (truck) { selectTruck(truck); return `Now showing ${truck.licensePlate}` }
      return `No truck found with plate ${licensePlate}`
    },
  })
  useCopilotAction({ name: 'generateFleetBriefing', description: 'Run live AI fleet analysis', parameters: [], handler: () => { getAI(); return 'Generating…' } })

  // ── Render ───────────────────────────────────────────────────────────────────

  // Login gate — shown until token is obtained
  if (!token) {
    const handleLogin = async e => {
      e.preventDefault()
      setLoginLoading(true); setLoginErr('')
      try {
        const r = await fetch(`${API}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: loginUser || 'driver1', password: loginPass || 'password123' }),
        })
        const d = await r.json()
        if (d.token) setToken(d.token)
        else setLoginErr(d.error || 'Invalid credentials')
      } catch { setLoginErr('Cannot reach server — ensure the backend is running on port 5000') }
      setLoginLoading(false)
    }
    const handleDemo = () => {
      setIsOnline(false)
      setToken('demo')
    }
    const features = [
      { icon: '🗺️', label: 'Live GPS Tracking' },
      { icon: '🤖', label: 'AI Fleet Intelligence' },
      { icon: '⚡', label: 'Real-time Alerts' },
      { icon: '📊', label: 'Cost Analytics' },
      { icon: '🔧', label: 'Predictive Maintenance' },
      { icon: '🌿', label: 'Emissions Monitoring' },
    ]
    return (
      <div className={`app ${dark ? 'dark' : 'light'} login-gate`}>
        <div className="login-bg-grid" aria-hidden="true" />
        <div className="login-container">
          <div className="login-brand">
            <div className="login-logo" aria-hidden="true">🚛</div>
            <h1 className="login-title">Fleet<span>Pulse</span></h1>
            <p className="login-subtitle">AI Fleet Intelligence Platform · Riyadh, KSA</p>
          </div>

          <div className="login-demo-banner">
            <div className="ldb-left">
              <span className="ldb-icon">🚀</span>
              <div>
                <div className="ldb-title">No backend? No problem.</div>
                <div className="ldb-sub">Explore all 12 trucks, live telemetry, AI dispatch &amp; analytics with demo data.</div>
              </div>
            </div>
            <button className="login-demo-btn" onClick={handleDemo}>
              Enter Demo Mode →
            </button>
          </div>

          <div className="login-divider"><span>or sign in with credentials</span></div>

          <form className="login-form" onSubmit={handleLogin} noValidate>
            <div className="login-field">
              <label className="login-label" htmlFor="login-user">Username</label>
              <input
                id="login-user"
                className="login-input"
                value={loginUser}
                onChange={e => setLoginUser(e.target.value)}
                placeholder="driver1"
                autoComplete="username"
                aria-describedby={loginErr ? 'login-error' : undefined}
              />
            </div>
            <div className="login-field">
              <label className="login-label" htmlFor="login-pass">Password</label>
              <input
                id="login-pass"
                className="login-input"
                type="password"
                value={loginPass}
                onChange={e => setLoginPass(e.target.value)}
                placeholder="password123"
                autoComplete="current-password"
                aria-describedby={loginErr ? 'login-error' : undefined}
              />
            </div>
            {loginErr && (
              <div className="login-err" id="login-error" role="alert" aria-live="assertive">
                ⚠️ {loginErr}
              </div>
            )}
            <button className="login-btn" type="submit" disabled={loginLoading} aria-busy={loginLoading}>
              {loginLoading ? 'Connecting…' : 'Sign In →'}
            </button>
          </form>

          <div className="login-features" role="list" aria-label="Platform features">
            {features.map(f => (
              <div key={f.label} className="login-feature" role="listitem">
                <span aria-hidden="true">{f.icon}</span> {f.label}
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`app ${dark ? 'dark' : 'light'}${focusMode ? ' focus-mode' : ''}`}>
      <a href="#main-content" className="skip-link">Skip to main content</a>
      {booting && <BootScreen onDone={() => { sessionStorage.setItem('fp-booted', '1'); setBooting(false) }} />}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      <AIChatWidget
        trucks={trucks} jobs={jobs} alertLog={alertLog}
        ST={ST} FT={FT} TT={TT}
        fleetHealth={fleetHealth}
        idleStartTimes={idleStartTimes}
        authToken={token}
      />
      {showLeaderboard && <LeaderboardModal data={fleetOverview.length > 0 ? fleetOverview : trucks} onClose={() => setShowLeaderboard(false)} />}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      {showSettings && <SettingsModal settings={settings} onChange={setSettings} onClose={() => setShowSettings(false)} />}
      {showMessage && <MessageModal truck={showMessage} onClose={() => setShowMessage(null)} />}
      {showAlertLog && <AlertLogModal log={alertLog} onClear={() => setAlertLog([])} onClose={() => setShowAlertLog(false)} />}
      {showPalette && <CommandPalette trucks={trucks} ST={ST} onSelect={selectTruck} onMessage={t => setShowMessage(t)} onClose={() => setShowPalette(false)} />}
      {showCostAnalytics && <CostAnalyticsModal trucks={trucks} getFuelBurnRate={getFuelBurnRate} getIdleDuration={getIdleDuration} onClose={() => setShowCostAnalytics(false)} />}
      {showSOS && <EmergencySOSModal criticalTrucks={criticalTrucks} onClose={() => setShowSOS(false)} />}
      {showEmissions && <EmissionsModal co2Stats={co2Stats} trucks={trucks} ST={ST} speedingCount={speedingCount} idleCount={idleCount} onClose={() => setShowEmissions(false)} />}
      {showOptimizer && <RouteOptimizerModal trucks={trucks} jobs={jobs}
        onApply={(plan) => {
          setJobs(prev => prev.map(j => {
            for (const [truckId, stops] of plan.entries()) {
              if (stops.some(s => s.id === j.id)) return { ...j, truckId, status: 'enroute' }
            }
            return j
          }))
          addToast('🧭 Optimized route plan applied to dispatch', 'amber')
        }}
        onClose={() => setShowOptimizer(false)} />}
      {showBrief && (
        <CommandBrief
          trucks={trucks} fleetHealth={fleetHealth} activeCount={activeCount}
          idleCount={idleCount} speedingCount={speedingCount} lowFuelCount={lowFuelCount}
          avgFuel={avgFuel} alertCount={alertCount} totalRefuelSAR={totalRefuelSAR}
          totalIdleWasteSAR={totalIdleWasteSAR} co2Stats={co2Stats}
          criticalTrucks={criticalTrucks} maintenanceTrucks={maintenanceTrucks}
          predictions={predictions} jobs={jobs} alertLog={alertLog}
          ST={ST} FT={FT} TT={TT} isOnline={isOnline}
          getFuelETA={getFuelETA}
          onSelectTruck={selectTruck}
          onOpenDispatch={() => setShowDispatch(true)}
          onOpenOptimizer={() => setShowOptimizer(true)}
          onOpenSOS={() => setShowSOS(true)}
          onClose={() => setShowBrief(false)}
        />
      )}
      {showPredMaint && <PredictiveMaintModal trucks={trucks} onSelectTruck={(t) => { selectTruck(t); setDetailTab('engine') }} onClose={() => setShowPredMaint(false)} />}
      {showFinancials && <FinancialModal trucks={trucks} onSelectTruck={(t) => selectTruck(t)} onClose={() => setShowFinancials(false)} />}
      {showDispatch && (
        <DispatchBoard
          trucks={trucks}
          jobs={jobs}
          ST={ST}
          onAssign={(jobId, truckId) => setJobs(p => p.map(j =>
            j.id === jobId ? { ...j, truckId: truckId || null, status: truckId ? 'enroute' : 'pending' } : j
          ))}
          onStatusChange={(jobId, status) => setJobs(p => p.map(j =>
            j.id === jobId ? { ...j, status } : j
          ))}
          onAddJob={(job) => setJobs(p => [...p, job])}
          onClose={() => setShowDispatch(false)}
        />
      )}

      {/* ── Drawers ── */}
      {showMonitoring && (
        <MonitoringDrawer
          trucks={trucks} truckHistory={truckHistory}
          ST={ST} FT={FT} TT={TT} maxWeightKg={MAX_WEIGHT_KG}
          onSelect={selectTruck}
          onClose={() => setShowMonitoring(false)}
        />
      )}
      {showPlayback && (
        <PlaybackDrawer
          trucks={trucks} selected={selected} onSelectTruck={selectTruck}
          timeline={truckTimeline[selected?.id] || []}
          replayIdx={replayIdx} setReplayIdx={setReplayIdx}
          replayPlaying={replayPlaying} setReplayPlaying={setReplayPlaying}
          replaySpeed={replaySpeed} setReplaySpeed={setReplaySpeed}
          onClose={() => setShowPlayback(false)}
        />
      )}
      {showConnect && (
        <ProviderConnectDrawer
          providers={providers} providerStatus={providerStatus}
          onAddProvider={(p) => { setProviders(prev => [...prev, p]); addToast(`🔌 Provider "${p.name}" connected`, 'amber'); logEvent('provider', `Provider "${p.name}" connected`) }}
          onRemoveProvider={(id) => setProviders(prev => prev.filter(p => p.id !== id))}
          onTogglePause={(id) => setProviders(prev => prev.map(p => p.id === id ? { ...p, paused: !p.paused } : p))}
          onClose={() => setShowConnect(false)}
        />
      )}
      {showZones && (
        <ZonesDrawer
          geozones={geozones} countInZone={countInZone}
          onRemove={(id) => setGeozones(p => p.filter(z => z.id !== id))}
          onStartCircle={() => { setAppMode('fms'); setAddingZone(true) }}
          onStartPolygon={() => { setAppMode('fms'); setPolyDraft([]) }}
          onClose={() => setShowZones(false)}
        />
      )}

      {focusMode && (
        <button className="focus-exit-btn" onClick={() => setFocusMode(false)} title="Exit focus mode (`)">⛶ EXIT FOCUS</button>
      )}

      <TopBar
        isOnline={isOnline} fleetHealth={fleetHealth}
        activeCount={activeCount} speedingCount={speedingCount}
        alertCount={alertCount} avgFuel={avgFuel} lowFuelCount={lowFuelCount}
        alertLog={alertLog} jobs={jobs} dark={dark}
        soundEnabled={soundEnabled} notifPermission={notifPermission}
        showGridView={showGridView} focusMode={focusMode}
        setFleetFilter={setFleetFilter} setSearch={setSearch}
        setShowDispatch={setShowDispatch} setShowSOS={setShowSOS}
        setShowAlertLog={setShowAlertLog} setDark={setDark}
        setSoundEnabled={setSoundEnabled} exportCSV={exportCSV}
        setShowOptimizer={setShowOptimizer} setShowPredMaint={setShowPredMaint}
        setShowFinancials={setShowFinancials} setShowLeaderboard={setShowLeaderboard}
        setShowSettings={setShowSettings} setShowHelp={setShowHelp}
        setShowPalette={setShowPalette} enableNotifications={enableNotifications}
        setShowEmissions={setShowEmissions} setShowCostAnalytics={setShowCostAnalytics}
        setShowGridView={setShowGridView} setFocusMode={setFocusMode}
        setShowBrief={setShowBrief}
        briefCount={criticalTrucks.length + maintenanceTrucks.slice(0, 3).length + predictions.filter(p => p.severity === 'critical').length + (idleCount > 0 && jobs.some(j => j.status === 'pending') ? 1 : 0)}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        appMode={appMode} setAppMode={setAppMode}
        setShowMonitoring={setShowMonitoring} setShowPlayback={setShowPlayback}
        setShowConnect={setShowConnect} setShowZones={setShowZones}
        extCount={extCount}
      />

      <div className="app-body">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && <div className="mob-overlay" onClick={() => setSidebarOpen(false)} aria-hidden="true" />}
      {/* ── SIDEBAR ── */}
      <aside className={`sidebar${sidebarOpen ? ' mob-open' : ''}`} aria-label="Fleet control panel">
        {/* ─── ACTION QUEUE — unified actionable alerts ─── */}
        {(() => {
          const items = []

          // Operational critical alerts — with cost impact
          trucks.forEach(t => {
            if (acknowledged.has(t.id) || isSnoozed(t.id)) return
            if (t.speed > ST) {
              const overBy = t.speed - ST
              const fineRisk = overBy > 20 ? 800 : overBy > 10 ? 400 : 150
              items.push({
                id: `spd-${t.id}`, sev: 0, icon: '⚡', plate: t.licensePlate, truckId: t.id,
                issue: `Speeding ${t.speed.toFixed(0)} km/h — ${overBy.toFixed(0)} over limit · fine risk`,
                action: '💬 Warn driver', color: 'red',
                costSAR: fineRisk,
                onAction: () => { selectTruck(t); setShowMessage(t) },
                onSelect: () => selectTruck(t),
              })
            }
            if (t.fuel < FT) {
              const refuelCost = ((100 - t.fuel) / 100) * TANK_LITRES * FUEL_PRICE_SAR
              const eta = getFuelETA(t.id)
              items.push({
                id: `fuel-${t.id}`, sev: t.fuel < FT * 0.5 ? 0 : 1, icon: '⛽', plate: t.licensePlate, truckId: t.id,
                issue: `${t.fuel.toFixed(0)}% fuel${eta ? ` — runs out in ~${eta} min` : ' — critically low'}`,
                action: '⛽ Route to station', color: 'amber',
                costSAR: refuelCost,
                onAction: () => { selectTruck(t); addToast(`⛽ Routing ${t.licensePlate} → Al Olaya Petrol · SAR ${refuelCost.toFixed(0)} est.`, 'amber') },
                onSelect: () => selectTruck(t),
              })
            }
            if (t.temperature > TT) {
              const repairCost = t.temperature > TT * 1.1 ? 3500 : 1200
              items.push({
                id: `tmp-${t.id}`, sev: 0, icon: '🌡️', plate: t.licensePlate, truckId: t.id,
                issue: `Engine ${t.temperature.toFixed(0)}°F — overheating · engine damage risk`,
                action: '📞 Call driver', color: 'red',
                costSAR: repairCost,
                onAction: () => { selectTruck(t); if (t.driver?.phone) window.open(`tel:${t.driver.phone}`) },
                onSelect: () => selectTruck(t),
              })
            }
            if ((t.activeDTCs?.length || 0) > 0) {
              const hasCritDTC = t.activeDTCs.some(d => d.severity === 'critical')
              items.push({
                id: `dtc-${t.id}`, sev: hasCritDTC ? 0 : 1, icon: '⚠️', plate: t.licensePlate, truckId: t.id,
                issue: `${t.activeDTCs.length} fault${t.activeDTCs.length > 1 ? 's' : ''}: ${t.activeDTCs.map(d => d.code).join(', ')}`,
                action: '🔍 View codes', color: hasCritDTC ? 'red' : 'amber',
                costSAR: hasCritDTC ? 2000 : 500,
                onAction: () => { selectTruck(t); setDetailTab('engine') },
                onSelect: () => selectTruck(t),
              })
            }
          })

          // Predictive failures (critical severity only)
          trucks.forEach(t => {
            if (acknowledged.has(t.id)) return
            const c = predictComponents(t).find(x => x.sev === 'critical')
            if (c) items.push({
              id: `pred-${t.id}`, sev: 0, icon: c.icon, plate: t.licensePlate, truckId: t.id,
              issue: `${c.name} predicted to fail in ~${c.days <= 0 ? 'now' : c.days + ' days'}`,
              action: '🔧 Schedule fix', color: 'amber',
              costSAR: c.reactive - c.proactive,
              onAction: () => setShowPredMaint(true),
              onSelect: () => selectTruck(t),
            })
          })

          // Maintenance overdue
          maintenanceTrucks.filter(t => !acknowledgedMaint.has(t.id)).slice(0, 2).forEach(t => {
            items.push({
              id: `mnt-${t.id}`, sev: 1, icon: '🔧', plate: t.licensePlate, truckId: t.id,
              issue: `Service overdue · ${(t.engineHours || 0).toLocaleString()} engine hrs on clock`,
              action: '📋 Book service', color: 'amber',
              costSAR: 400,
              onAction: () => { selectTruck(t); setDetailTab('engine') },
              onSelect: () => selectTruck(t),
            })
          })

          // Idle waste + pending jobs
          const idleFleet = trucks.filter(t => t.status === 'idle')
          const totalIdleMin = idleFleet.reduce((s, t) => s + (idleStartTimes[t.id] ? Math.floor((Date.now() - idleStartTimes[t.id]) / 60000) : 0), 0)
          const idleWasteSAR = parseFloat((totalIdleMin / 60 * 3 * FUEL_PRICE_SAR).toFixed(0))
          const pendingJobCount = jobs.filter(j => j.status === 'pending').length
          if (totalIdleMin > 15 && pendingJobCount > 0) items.push({
            id: 'idle', sev: 1, icon: '⏸',
            plate: `${idleFleet.length} idle truck${idleFleet.length > 1 ? 's' : ''}`,
            issue: `${totalIdleMin} min idle with ${pendingJobCount} job${pendingJobCount > 1 ? 's' : ''} waiting`,
            action: '📋 Open dispatch', color: 'amber',
            costSAR: idleWasteSAR,
            onAction: () => setShowDispatch(true),
            onSelect: null
          })

          // Attach truckId + costSAR to each item (needed for snooze + cost display)
          items.forEach(item => {
            if (!item.truckId) {
              const t = trucks.find(x => x.licensePlate === item.plate)
              if (t) item.truckId = t.id
            }
            if (!item.costSAR) item.costSAR = 0
          })

          items.sort((a, b) => a.sev - b.sev)
          const shown = items.slice(0, 8)
          const overflow = items.length - shown.length
          const totalCostAtRisk = items.reduce((s, x) => s + (x.costSAR || 0), 0)

          return (
            <div className={`action-queue${items.length > 0 ? ' has-items' : ''}`} role="region" aria-label="Action queue" aria-live="polite">
              <div className="aq-header">
                <div className="aq-header-left">
                  <span className="aq-htitle">ACTION QUEUE</span>
                  <span className={`aq-count${items.length > 0 ? ' hot' : ''}`}>{items.length}</span>
                </div>
                <div className="aq-header-right">
                  {totalCostAtRisk > 0 && (
                    <span className="aq-cost-impact">≈ SAR {Math.round(totalCostAtRisk).toLocaleString()} at risk</span>
                  )}
                  {items.length > 0 && (
                    <button className="aq-ack-all"
                      onClick={() => {
                        const ids = new Set(items.map(x => x.truckId).filter(Boolean))
                        setAcknowledged(p => new Set([...p, ...ids]))
                      }}>
                      ✓ Clear all
                    </button>
                  )}
                </div>
              </div>
              {shown.length === 0 ? (
                <div className="aq-all-clear">
                  <span className="aq-clear-icon">✅</span>
                  <div>
                    <div className="aq-clear-title">Fleet nominal</div>
                    <div className="aq-clear-sub">All {trucks.length} trucks within thresholds</div>
                  </div>
                </div>
              ) : shown.map(item => (
                <div key={item.id}
                  className={`aq-item aq-${item.color}${item.sev === 0 ? ' aq-critical' : ''}`}
                  onClick={() => item.onSelect?.()}>
                  <div className={`aq-severity-bar sev-${item.color}`} />
                  <span className="aq-iicon">{item.icon}</span>
                  <div className="aq-ibody">
                    <div className="aq-iplate">{item.plate}</div>
                    <div className="aq-iissue">{item.issue}</div>
                    {item.costSAR > 0 && (
                      <div className="aq-icost">SAR {Math.round(item.costSAR).toLocaleString()} cost impact</div>
                    )}
                  </div>
                  <div className="aq-actions-col" onClick={e => e.stopPropagation()}>
                    <button className={`aq-act aq-act-${item.color}`} onClick={() => item.onAction()}>
                      {item.action}
                    </button>
                    {item.truckId && (
                      <button className="aq-snooze" title="Snooze 15 min"
                        onClick={() => setSnoozed(p => ({ ...p, [item.truckId]: Date.now() + 15 * 60 * 1000 }))}>
                        ⏱ 15m
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {overflow > 0 && (
                <div className="aq-overflow" onClick={() => setFleetFilter('all')}>
                  +{overflow} more — scroll truck list ↓
                </div>
              )}
            </div>
          )
        })()}

        {/* Search */}
        <div className="search-wrap" role="search">
          <input
            className="search"
            placeholder="Search plate or driver…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label="Search trucks by plate number or driver name"
            type="search"
          />
          {search && <button className="search-clear" onClick={() => setSearch('')} title="Clear search" aria-label="Clear search">✕</button>}
        </div>

        {/* Filter chips */}
        <div className="filter-chips" role="group" aria-label="Filter trucks by status">
          {[
            { key: 'all',      label: 'All',    count: trucks.length },
            { key: 'active',   label: 'Active', count: activeCount },
            { key: 'speeding', label: 'Speed',  count: speedingCount },
            { key: 'lowfuel',  label: 'Fuel',   count: lowFuelCount },
            { key: 'idle',     label: 'Idle',   count: idleCount },
          ].map(f => (
            <button
              key={f.key}
              className={`filter-chip ${fleetFilter === f.key ? 'active' : ''} ${f.key !== 'all' && f.count === 0 ? 'chip-empty' : ''}`}
              onClick={() => { setFleetFilter(f.key); setSearch('') }}
              aria-pressed={fleetFilter === f.key}
              aria-label={`Show ${f.label.toLowerCase()} trucks${f.count > 0 ? ` (${f.count})` : ''}`}
            >
              {f.label}
              {(f.key === 'all' || f.count > 0) && <span className="chip-count" aria-hidden="true">{f.count}</span>}
            </button>
          ))}
        </div>

        {/* Tag filter */}
        {allTags.length > 0 && (
          <div className="tag-filter-row" role="group" aria-label="Filter trucks by tag">
            {allTags.map(tag => (
              <button key={tag}
                className={`tag-filter-chip${tagFilter === tag ? ' active' : ''}`}
                onClick={() => setTagFilter(prev => prev === tag ? null : tag)}
                aria-pressed={tagFilter === tag}>
                🏷 {tag}
              </button>
            ))}
          </div>
        )}

        {/* Truck list */}
        <div className="truck-list" role="list" aria-label="Fleet trucks" aria-busy={trucksLoading}>
          {trucksLoading && (
            <>
              {[1,2,3,4].map(i => (
                <div key={i} className="truck-card-skeleton" aria-hidden="true">
                  <div className="skel-stripe" />
                  <div className="skel-body">
                    <div className="skel-row">
                      <div className="skel-chip skel-w-24" />
                      <div className="skel-chip skel-w-16" />
                    </div>
                    <div className="skel-row" style={{marginTop:6}}>
                      <div className="skel-chip skel-w-32" />
                      <div className="skel-chip skel-w-12" />
                      <div className="skel-chip skel-w-12" />
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
          {!trucksLoading && filtered.length === 0 && (
            <div className="truck-empty" role="status">
              <div className="truck-empty-icon">🔍</div>
              <div className="truck-empty-msg">
                {search ? `No trucks match "${search}"` : `No ${fleetFilter === 'all' ? '' : fleetFilter} trucks`}
              </div>
              {(search || fleetFilter !== 'all') && (
                <button className="truck-empty-clear" onClick={() => { setSearch(''); setFleetFilter('all') }}>Clear filters</button>
              )}
            </div>
          )}
          {!trucksLoading && filtered.map(t => {
            const st = truckStatus(t)
            const fc = t.fuel < FT ? 'var(--red)' : t.fuel < FT * 2 ? 'var(--amber)' : 'var(--green)'
            const sc = t.speed > ST ? 'var(--red)' : t.speed > ST * 0.8 ? 'var(--amber)' : 'var(--green)'
            const tc2 = t.temperature > TT ? 'var(--red)' : t.temperature > TT * 0.9 ? 'var(--amber)' : 'var(--text-dim)'
            const eta = getFuelETA(t.id)
            const idleMins = t.status === 'idle' ? getIdleDuration(t.id) : null
            const maint = getMaintStatus(t)
            const outside = isOutsideGeofence(t.location.lat, t.location.lng)
            const activeJob = jobs.find(j => j.truckId === t.id && j.status === 'enroute')
            const shiftMins = getShiftHours(t.id)
            const risk = getBreakdownRisk(t)
            const accentCls = (t.speed > ST || t.temperature > TT) ? 'crit' : t.fuel < FT ? 'warn' : t.status === 'idle' ? 'idle' : 'ok'
            const showRisk = risk >= 40
            const hasChips = idleMins !== null || outside || activeJob || (shiftMins && shiftMins >= 480) || showRisk
            const hasActions = t.speed > ST || t.fuel < FT || t.status === 'idle' || (t.activeDTCs?.length > 0)
            return (
              <div key={t.id}
                role="listitem"
                tabIndex={0}
                aria-selected={selected?.id === t.id}
                aria-label={`${t.licensePlate}, ${st.label}, speed ${t.speed.toFixed(0)} km/h, fuel ${t.fuel.toFixed(0)}%`}
                onKeyDown={e => e.key === 'Enter' && selectTruck(t)}
                className={`truck-card v4${selected?.id === t.id ? ' v4-sel' : ''}${accentCls === 'crit' ? ' v4-crit' : accentCls === 'warn' ? ' v4-warn' : ''}`}
                onClick={() => selectTruck(t)}>
                <div className={`v4-stripe v4s-${accentCls}`} />
                <div className="v4-body">
                  <div className="v4-row1">
                    <span className="v4-plate">{t.licensePlate}</span>
                    {outside && <span className="v4-flag" title="Outside geofence">📍</span>}
                    {maint.urgent && <span className="v4-flag" title="Maintenance due" style={{animation:'badge-pulse 1.6s ease-in-out infinite'}}>🔧</span>}
                    {activeJob && <span className="v4-enroute">en route</span>}
                  </div>
                  <div className="v4-row2">
                    {t.driver && <span className="v4-dname">{t.driver.name.split(' ').slice(0,2).join(' ')}</span>}
                    <span className="v4-met">⚡{t.speed.toFixed(0)}</span>
                    <span className="v4-met">⛽{t.fuel.toFixed(0)}%</span>
                    <span className="v4-met">🌡{t.temperature.toFixed(0)}°</span>
                  </div>
                  {(truckTags[t.id]?.length > 0 || t._ext) && (
                    <div className="v4-tags">
                      {t._ext && <span className="tag-chip" style={{ borderColor: 'rgba(34,211,238,.4)', color: 'var(--cyan)' }}>ext feed</span>}
                      {(truckTags[t.id] || []).slice(0, 4).map(tag => <span key={tag} className="tag-chip">{tag}</span>)}
                    </div>
                  )}
                  <div className="v4-fuelbar">
                    <div className="v4-fuelbar-fill" style={{
                      width: `${Math.min(100, t.fuel)}%`,
                      background: t.fuel < FT ? 'var(--red)' : t.fuel < FT * 2 ? 'var(--amber)' : 'var(--green)'
                    }} />
                  </div>
                  {(() => {
                    let alert = null
                    if (t.speed > ST) alert = {
                      cls: 'crit', msg: `⚡ ${t.speed.toFixed(0)} km/h — ${(t.speed - ST).toFixed(0)} over`,
                      btn: '💬 Warn', onBtn: () => { selectTruck(t); setShowMessage(t) }
                    }
                    else if (t.temperature > TT) alert = {
                      cls: 'crit', msg: `🌡️ ${t.temperature.toFixed(0)}°F — overheating`,
                      btn: '📞 Call', onBtn: () => t.driver?.phone && window.open(`tel:${t.driver.phone}`)
                    }
                    else if (t.fuel < FT) alert = {
                      cls: 'warn', msg: `⛽ ${t.fuel.toFixed(0)}% fuel${eta ? ` · ~${eta}m` : ''}`,
                      btn: '⛽ Route', onBtn: () => addToast(`⛽ Routing ${t.licensePlate} → Al Olaya Petrol`, 'amber')
                    }
                    else if ((t.activeDTCs?.length || 0) > 0) alert = {
                      cls: 'warn', msg: `⚠️ ${t.activeDTCs.length} fault code${t.activeDTCs.length > 1 ? 's' : ''}: ${t.activeDTCs[0]?.code}`,
                      btn: '🔍 Codes', onBtn: () => { selectTruck(t); setDetailTab('engine') }
                    }
                    else if (idleMins !== null && idleMins > 10) alert = {
                      cls: 'idle', msg: `⏸ Idle ${idleMins}m — SAR ${(idleMins/60*3*FUEL_PRICE_SAR).toFixed(1)} wasted`,
                      btn: jobs.some(j => j.status === 'pending') ? '📋 Assign' : null,
                      onBtn: () => setShowDispatch(true)
                    }
                    else if (shiftMins && shiftMins >= 480) alert = {
                      cls: shiftMins >= 600 ? 'crit' : 'warn',
                      msg: `⏱ ${Math.floor(shiftMins/60)}h ${shiftMins%60}m shift${shiftMins >= 600 ? ' — HOS exceeded' : ''}`,
                      btn: null, onBtn: null
                    }
                    if (!alert) return null
                    return (
                      <div className={`v4-alert v4a-${alert.cls}`} onClick={e => e.stopPropagation()}>
                        <span className="v4-amsg">{alert.msg}</span>
                        {alert.btn && <button className={`v4-abtn v4ab-${alert.cls}`} onClick={alert.onBtn}>{alert.btn}</button>}
                      </div>
                    )
                  })()}
                </div>
              </div>
            )
          })}
        </div>
        {/* Financial summary footer */}
        <div className="fin-footer">
          <span className="fin-footer-label">Cost Monitor</span>
          {totalIdleWasteSAR > 0 && <>
            <div className="fin-item">
              <span className="fin-item-val amber">SAR {totalIdleWasteSAR.toFixed(0)}</span>
              <span className="fin-item-lbl">idle waste</span>
            </div>
            <div className="fin-divider" />
          </>}
          <div className="fin-item" style={{cursor:'pointer'}} onClick={() => setShowCostAnalytics(true)} title="View cost breakdown">
            <span className="fin-item-val red">SAR {totalRefuelSAR.toLocaleString()}</span>
            <span className="fin-item-lbl">to refuel ↗</span>
          </div>
          <div className="fin-divider" />
          <div className="fin-item">
            <span className="fin-item-val green">{alertLog.length}</span>
            <span className="fin-item-lbl">alerts</span>
          </div>
          <div className="fin-footer-right">{(() => { const m = Math.floor((Date.now() - sessionStart.current) / 60000); return m < 60 ? `${m}m session` : `${Math.floor(m / 60)}h ${m % 60}m session` })()}</div>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <main className="main" id="main-content" aria-label="Fleet map and truck details">

        {/* ── OPERATIONS (TMS) WORKSPACE — jobs, assignment, dispatch ── */}
        {appMode === 'tms' && (
          <div className="ops-workspace">
            <div className="ops-ws-head">
              <div>
                <div className="ops-ws-title">📋 Operations</div>
                <div className="ops-ws-sub">Transport management — jobs, assignment &amp; dispatch. Switch to 🛰 Tracking for live telemetry.</div>
              </div>
              <div className="ops-ws-kpis">
                <div className="ops-ws-kpi"><b>{jobs.filter(j => j.status === 'pending').length}</b><span>Pending</span></div>
                <div className="ops-ws-kpi"><b>{jobs.filter(j => j.status === 'enroute').length}</b><span>En route</span></div>
                <div className="ops-ws-kpi"><b>{jobs.filter(j => j.status === 'complete').length}</b><span>Done</span></div>
                <div className="ops-ws-kpi"><b>{idleCount}</b><span>Idle trucks</span></div>
              </div>
              <div className="ops-ws-actions">
                <button className="ops-ws-btn" onClick={() => setShowOptimizer(true)}>🧭 Optimize Routes</button>
                <button className="ops-ws-btn" onClick={() => setShowFinancials(true)}>💰 Financials</button>
              </div>
            </div>
            <DispatchBoard
              embedded
              trucks={trucks}
              jobs={jobs}
              ST={ST}
              onAssign={(jobId, truckId) => setJobs(p => p.map(j =>
                j.id === jobId ? { ...j, truckId: truckId || null, status: truckId ? 'enroute' : 'pending' } : j
              ))}
              onStatusChange={(jobId, status) => setJobs(p => p.map(j =>
                j.id === jobId ? { ...j, status } : j
              ))}
              onAddJob={(job) => setJobs(p => [...p, job])}
              onClose={() => {}}
            />
          </div>
        )}

        {/* Fleet Command Grid View */}
        {appMode === 'fms' && showGridView && (
          <FleetGridView
            trucks={trucks} truckTimeline={truckTimeline}
            selected={selected} onSelect={selectTruck}
            ST={ST} FT={FT} TT={TT} jobs={jobs}
            fleetHealth={fleetHealth} activeCount={activeCount}
            speedingCount={speedingCount} alertCount={alertCount}
            onClose={() => setShowGridView(false)}
          />
        )}

        {/* Predictions Intelligence Panel */}
        {appMode === 'fms' && !showGridView && predictions.length > 0 && (
          <div className="predictions-bar">
            <span className="pred-label">⚡ INTEL</span>
            {predictions.map((p, i) => (
              <div key={i} className={`pred-card pred-${p.severity}`} onClick={() => { const t = trucks.find(x => x.id === p.truckId); if (t) selectTruck(t) }}>
                <span className="pred-icon">{p.type === 'fuel' ? '⛽' : p.type === 'maint' ? '🔧' : '⏸'}</span>
                <span className="pred-msg">{p.msg}</span>
              </div>
            ))}
          </div>
        )}

        {/* Map */}
        {pendingZoneLatlng && (
          <ZoneNameModal
            latlng={pendingZoneLatlng}
            onConfirm={(name, radius, color) => {
              const zone = { id: Date.now(), type: 'circle', name, lat: pendingZoneLatlng.lat, lng: pendingZoneLatlng.lng, radius, color }
              setGeozones(prev => [...prev, zone])
              setPendingZoneLatlng(null)
              addToast(`📍 Zone "${name}" added`, 'amber')
            }}
            onCancel={() => setPendingZoneLatlng(null)}
          />
        )}
        {pendingPolyZone && (
          <ZoneNameModal
            latlng={{ lat: pendingPolyZone[0][0], lng: pendingPolyZone[0][1] }}
            shape="polygon"
            pointCount={pendingPolyZone.length}
            onConfirm={(name, _radius, color) => {
              const zone = { id: Date.now(), type: 'polygon', name, points: pendingPolyZone, color }
              setGeozones(prev => [...prev, zone])
              setPendingPolyZone(null)
              addToast(`⬠ Polygon zone "${name}" added`, 'amber')
            }}
            onCancel={() => setPendingPolyZone(null)}
          />
        )}
        <div className={`map-wrap${showFullMap ? ' fullscreen' : ''}${showGridView || appMode === 'tms' ? ' hidden' : ''}${addingZone || polyDraft !== null ? ' placing' : ''}`}>
          {addingZone && (
            <div className="zone-place-hint">
              <span>🖱️ Click anywhere on the map to place the zone</span>
              <button className="zone-place-cancel" onClick={() => setAddingZone(false)}>✕ Cancel</button>
            </div>
          )}
          {polyDraft !== null && (
            <div className="poly-finish-bar">
              <span>✏️ Click the map to add corners — {polyDraft.length} placed{polyDraft.length < 3 ? ` (need ${3 - polyDraft.length} more)` : ''}</span>
              <button className="poly-finish-btn" disabled={polyDraft.length < 3}
                onClick={() => { setPendingPolyZone(polyDraft); setPolyDraft(null) }}>
                ✓ Finish Zone
              </button>
              {polyDraft.length > 0 && (
                <button className="poly-cancel-btn" onClick={() => setPolyDraft(p => p.slice(0, -1))} title="Remove last corner">↩ Undo</button>
              )}
              <button className="poly-cancel-btn" onClick={() => setPolyDraft(null)}>✕ Cancel</button>
            </div>
          )}
          {zoneTypeChooser && (
            <div className="zone-type-pop">
              <button className="ztp-btn" onClick={() => { setZoneTypeChooser(false); setAddingZone(true) }}>
                ⭕ Circle
                <span>click one point + radius</span>
              </button>
              <button className="ztp-btn" onClick={() => { setZoneTypeChooser(false); setPolyDraft([]) }}>
                ✏️ Polygon
                <span>draw any shape you need</span>
              </button>
              <button className="ztp-cancel" onClick={() => setZoneTypeChooser(false)}>✕</button>
            </div>
          )}
          <MapContainer center={[24.7136, 46.6753]} zoom={12} className="map" zoomControl={false}>
            <TileLayer
              key={dark ? 'dark' : 'light'}
              url='https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
              attribution='&copy; OpenStreetMap contributors'
              className={dark ? 'dark-tiles' : 'light-tiles'}
            />
            <ZoomControl position="bottomright" />
            <MapResizer trigger={showFullMap} />
            {selected && replayIdx === null && <FlyTo lat={selected.location.lat} lng={selected.location.lng} />}
            {selected && replayIdx !== null && (() => {
              const snap = (truckTimeline[selected.id] || [])[replayIdx]
              if (!snap) return null
              return <FlyTo lat={snap.lat} lng={snap.lng} />
            })()}
            <MapClickHandler onMapClick={onMapClick} active={addingZone || polyDraft !== null} />
            <Circle center={GEOFENCE_CENTER} radius={GEOFENCE_RADIUS_M}
              pathOptions={{ color: '#6366f1', fillColor: '#6366f1', fillOpacity: 0.03, weight: 1.5, dashArray: '6,4' }} />
            {geozones.map(z => {
              const popup = (
                <Popup><b>{z.name}</b><br /><button style={{ fontSize: 11, cursor: 'pointer', color: 'var(--red)' }} onClick={() => setGeozones(p => p.filter(x => x.id !== z.id))}>Remove zone</button></Popup>
              )
              return z.type === 'polygon' ? (
                <Polygon key={z.id} positions={z.points}
                  pathOptions={{ color: z.color, fillColor: z.color, fillOpacity: 0.07, weight: 1.5, dashArray: '4,3' }}>
                  {popup}
                </Polygon>
              ) : (
                <Circle key={z.id} center={[z.lat, z.lng]} radius={z.radius}
                  pathOptions={{ color: z.color, fillColor: z.color, fillOpacity: 0.07, weight: 1.5, dashArray: '4,3' }}>
                  {popup}
                </Circle>
              )
            })}
            {/* Polygon draft preview while drawing */}
            {polyDraft !== null && polyDraft.length > 0 && (
              <>
                {polyDraft.length >= 3
                  ? <Polygon positions={polyDraft} pathOptions={{ color: '#22d3ee', fillColor: '#22d3ee', fillOpacity: 0.08, weight: 2, dashArray: '5,4' }} />
                  : <Polyline positions={polyDraft} pathOptions={{ color: '#22d3ee', weight: 2, dashArray: '5,4' }} />}
                {polyDraft.map((p, i) => (
                  <CircleMarker key={i} center={p} radius={5}
                    pathOptions={{ color: '#22d3ee', fillColor: '#0b1120', fillOpacity: 1, weight: 2 }} />
                ))}
              </>
            )}
            {/* Trail — only for selected truck, fades oldest→newest like Google Maps */}
            {selected && (() => {
              const pts = routes[selected.id] || []
              if (pts.length < 2) return null
              const color = truckColor(trucks.find(t => t.id === selected.id) || selected)
              // Split into 3 segments: old (faded) → mid → recent (bright)
              const t1 = Math.max(1, Math.floor(pts.length / 3))
              const t2 = Math.max(t1 + 1, Math.floor(pts.length * 2 / 3))
              const old    = pts.slice(0, t1 + 1)
              const mid    = pts.slice(t1, t2 + 1)
              const recent = pts.slice(t2)
              return <>
                {old.length    > 1 && <Polyline positions={old}    pathOptions={{ color, weight: 2,   opacity: 0.18, lineCap: 'round', lineJoin: 'round' }} />}
                {mid.length    > 1 && <Polyline positions={mid}    pathOptions={{ color, weight: 2.5, opacity: 0.45, lineCap: 'round', lineJoin: 'round' }} />}
                {recent.length > 1 && <Polyline positions={recent} pathOptions={{ color, weight: 3.5, opacity: 0.85, lineCap: 'round', lineJoin: 'round' }} />}
              </>
            })()}
            {trucks.map(t => (
              <SmoothMarker key={t.id} truck={t} color={truckColor(t)} pulse={t.status === 'active'} isSelected={selected?.id === t.id} onSelect={selectTruck} />
            ))}
            {selected && replayIdx !== null && (() => {
              const snap = (truckTimeline[selected.id] || [])[replayIdx]
              if (!snap) return null
              return <Marker position={[snap.lat, snap.lng]} icon={makeTruckIcon('#a855f7', false, '▶ REPLAY')} />
            })()}
          </MapContainer>

          {/* ── Ops Mode overlay (shown when fullscreen) ── */}
          {showFullMap && (
            <div className="ops-overlay">
              <div className="ops-brand">
                <span className="ops-logo">🚛</span>
                <span className="ops-name">FleetPulse</span>
                {!isOnline && <span className="demo-badge">DEMO</span>}
                <WallClock />
              </div>
              <div className="ops-kpis">
                {[
                  { label: 'Active', value: activeCount, color: 'var(--green)', icon: '🟢' },
                  { label: 'Speeding', value: speedingCount, color: speedingCount > 0 ? 'var(--red)' : 'var(--text-dim)', icon: '⚡' },
                  { label: 'Low Fuel', value: lowFuelCount, color: lowFuelCount > 0 ? 'var(--amber)' : 'var(--text-dim)', icon: '⛽' },
                  { label: 'Avg Fuel', value: `${Math.round(avgFuel)}%`, color: avgFuel < 30 ? 'var(--red)' : avgFuel < 50 ? 'var(--amber)' : 'var(--green)', icon: '📊' },
                  { label: 'Health', value: `${fleetHealth}/100`, color: fleetHealth >= 80 ? 'var(--green)' : fleetHealth >= 55 ? 'var(--amber)' : 'var(--red)', icon: '❤️' },
                  { label: 'Alerts', value: alertCount, color: alertCount > 0 ? 'var(--red)' : 'var(--text-dim)', icon: '🚨' },
                ].map(kpi => (
                  <div key={kpi.label} className="ops-kpi">
                    <div className="ops-kpi-val" style={{ color: kpi.color }}>{kpi.value}</div>
                    <div className="ops-kpi-lbl">{kpi.label}</div>
                  </div>
                ))}
              </div>
              <button className="ops-exit" onClick={() => setShowFullMap(false)} title="Exit fullscreen (Esc)">⊠ Exit</button>
            </div>
          )}

          {/* Reopen pill */}
          {tr && detailCollapsed && (
            <button className="detail-reopen" onClick={() => setDetailCollapsed(false)}>
              📊 {tr.licensePlate} · {truckStatus(tr).label}
            </button>
          )}

          {/* Map legend */}
          <div className="map-legend">
            {[['#22c55e','In Transit'],['#ef4444','Speeding'],['#f59e0b','Low Fuel'],['#94a3b8','Idle'],['#6366f1','Geofence']].map(([c,l]) => (
              <div key={l} className="legend-row">
                <span className="legend-dot" style={{ background: c, boxShadow: `0 0 5px ${c}` }} />
                <span className="legend-label">{l}</span>
              </div>
            ))}
            <div style={{ marginTop: 6, borderTop: '1px solid var(--border)', paddingTop: 6 }}>
              <button className="fullmap-btn" onClick={() => setShowFullMap(p => !p)} title="Fullscreen map (F)">
                {showFullMap ? '⊠ Exit Fullscreen' : '⊞ Fullscreen (F)'}
              </button>
              <button
                className={`zone-add-btn ${addingZone || polyDraft !== null ? 'active' : ''}`}
                onClick={() => {
                  if (addingZone || polyDraft !== null) { setAddingZone(false); setPolyDraft(null) }
                  else setZoneTypeChooser(p => !p)
                }}
                title="Add a circle or drawn polygon zone">
                {addingZone || polyDraft !== null ? '✕ Cancel' : '📍 Add Zone'}
              </button>
              {geozones.length > 0 && geozones.map(z => (
                <div key={z.id} className="zone-pill" style={{ borderColor: z.color }}>
                  <span className="zone-dot" style={{ background: z.color }} />{z.type === 'polygon' ? '⬠ ' : ''}{z.name}
                </div>
              ))}
            </div>
          </div>

          {/* Right-edge drawer dock — one-click access to the FMS tool drawers */}
          <div className="drawer-dock" role="toolbar" aria-label="Tracking tools">
            <button className="dock-btn" onClick={() => setShowMonitoring(true)} title="Monitoring — fuel · speed · weight (W)">📡</button>
            <button className="dock-btn" onClick={() => setShowPlayback(true)} title="Trip playback (R)">🎬</button>
            <button className="dock-btn" onClick={() => setShowZones(true)} title="Geofence zones (Z)">
              📍{geozones.length > 0 && <span className="dock-badge">{geozones.length}</span>}
            </button>
            <button className="dock-btn" onClick={() => setShowConnect(true)} title="Connect provider (C)">
              🔌{extCount > 0 && <span className="dock-badge">{extCount}</span>}
            </button>
          </div>

          {/* Detail card */}
          {tr && !detailCollapsed && (
            <div className="detail-card">
              <div className="detail-head">
                <div className="detail-head-top">
                  <span className="detail-plate">{tr.licensePlate}</span>
                  <span className={`status-badge ${truckStatus(tr).cls}`}>{truckStatus(tr).label}</span>
                  {events.length > 0 && <span className="event-badge">🚨 {events.length}</span>}
                  {isOutsideGeofence(tr.location.lat, tr.location.lng) && <span className="geo-badge">📍 Outside Zone</span>}
                  <button className="detail-close" onClick={() => setDetailCollapsed(true)} title="Minimize detail panel" aria-label="Minimize detail panel">✕</button>
                </div>
                <div className="detail-tabs" role="tablist" aria-label="Truck detail sections">
                  {[
                    { id: 'overview', icon: '📊', label: 'Overview' },
                    { id: 'engine',   icon: '⚙️', label: 'Engine' },
                    { id: 'coach',    icon: '💡', label: 'Coach', count: (() => { const ms = getMaintStatus(tr); const issues = [tr.speed > ST, tr.fuel < FT, tr.temperature > TT, (tr.activeDTCs?.length||0)>0, ms.urgent].filter(Boolean).length; return issues > 0 ? issues : 0 })() },
                    { id: 'safety',   icon: '🛡️', label: 'Safety' },
                    { id: 'codes',    icon: '⚠️', label: 'Codes', count: dtcs.length + events.filter(e => !e.type.startsWith('DTC')).length },
                    { id: 'trends',   icon: '📈', label: 'Trends' },
                    { id: 'vehicle',  icon: '🔩', label: 'Vehicle' },
                    { id: 'notes',    icon: '📝', label: 'Notes', count: truckNotes[tr.id]?.trim() ? 1 : 0 },
                    { id: 'trip',     icon: '🗺️', label: 'Trip' },
                  ].map(tab => (
                    <button
                      key={tab.id}
                      role="tab"
                      aria-selected={detailTab === tab.id}
                      aria-controls={`detail-panel-${tab.id}`}
                      className={`detail-tab ${detailTab === tab.id ? 'active' : ''}`}
                      onClick={() => setDetailTab(tab.id)}
                    >
                      <span aria-hidden="true">{tab.icon}</span> {tab.label}
                      {tab.count > 0 && <span className="tab-badge" aria-label={`${tab.count} issues`}>{tab.count}</span>}
                    </button>
                  ))}
                </div>
              </div>

              <div className="detail-body" role="tabpanel" id={`detail-panel-${detailTab}`} aria-label={detailTab}>
                {detailTab === 'overview' && (
                  <>
                    {/* Critical action strip — shows when there's an active alert on this truck */}
                    {(() => {
                      const issues = []
                      if (tr.speed > ST) issues.push({
                        sev: 'crit', icon: '⚡',
                        msg: `Speeding ${tr.speed.toFixed(0)} km/h — ${(tr.speed - ST).toFixed(0)} over limit`,
                        sub: `Fine risk up to SAR 800 · ${driver?.name || 'driver'} needs immediate correction`,
                        btn: '💬 Send Warning', onBtn: () => setShowMessage(tr)
                      })
                      if (tr.temperature > TT) issues.push({
                        sev: 'crit', icon: '🌡️',
                        msg: `Engine overheating — ${tr.temperature.toFixed(0)}°F`,
                        sub: `Sustained overheating = engine damage. Estimated repair: SAR 2,000–5,000`,
                        btn: '📞 Call Driver', onBtn: () => driver?.phone && window.open(`tel:${driver.phone}`)
                      })
                      if (tr.fuel < FT * 0.5) issues.push({
                        sev: 'crit', icon: '⛽',
                        msg: `Critical fuel — ${tr.fuel.toFixed(0)}% remaining`,
                        sub: `ETA to empty${getFuelETA(tr.id) ? ` ~${getFuelETA(tr.id)} min` : ' unknown'} · nearest station: Al Olaya`,
                        btn: '⛽ Route to Station', onBtn: () => addToast(`⛽ Routing ${tr.licensePlate} → Al Olaya Petrol`, 'amber')
                      })
                      else if (tr.fuel < FT) issues.push({
                        sev: 'warn', icon: '⛽',
                        msg: `Low fuel — ${tr.fuel.toFixed(0)}%`,
                        sub: `Refuel cost: SAR ${(((100 - tr.fuel) / 100) * TANK_LITRES * FUEL_PRICE_SAR).toFixed(0)} · plan stop soon`,
                        btn: '⛽ Route', onBtn: () => addToast(`⛽ Routing ${tr.licensePlate} → Al Olaya Petrol`, 'amber')
                      })
                      ;(tr.activeDTCs || []).filter(d => d.severity === 'critical').forEach(d => issues.push({
                        sev: 'warn', icon: '⚠️',
                        msg: `Fault code ${d.code} — ${d.desc}`,
                        sub: `Critical DTC detected · ${truckStatus(tr).label.toLowerCase()} · inspect before next route`,
                        btn: '🔍 View Codes', onBtn: () => setDetailTab('codes')
                      }))
                      if (!issues.length) return null
                      const top = issues[0]
                      return (
                        <div className={`das ${top.sev}`}>
                          <div className="das-icon-wrap">
                            <span className="das-icon">{top.icon}</span>
                          </div>
                          <div className="das-body">
                            <div className="das-msg">{top.msg}</div>
                            <div className="das-sub">{top.sub}</div>
                            {issues.length > 1 && <div className="das-extra">+{issues.length - 1} more issue{issues.length > 2 ? 's' : ''} on this truck</div>}
                          </div>
                          <button className={`das-btn das-btn-${top.sev}`} onClick={top.onBtn}>{top.btn}</button>
                        </div>
                      )
                    })()}

                    {driver && (
                      <div className="driver-row">
                        <div className="driver-photo">
                          <img src={driver.photo} alt={driver.name} onError={e => { e.target.style.display='none'; e.target.nextSibling.style.display='flex' }} />
                          <span className="driver-photo-fallback" style={{ display: 'none' }}>{driver.name[0]}</span>
                        </div>
                        <div className="driver-info">
                          <div className="driver-name">{driver.name}</div>
                          <div className="driver-meta">{driver.experience} · {driver.license} · ⭐ {driver.rating}</div>
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="driver-msg-btn" onClick={() => setShowMessage(tr)} title="Message driver">💬</button>
                          <a className="driver-call" href={`tel:${driver.phone}`}>📞 Call</a>
                        </div>
                      </div>
                    )}
                    <TagsEditor truckId={tr.id} tags={truckTags} onChange={setTruckTags} />
                    {selectedHistory.length >= 4 && (
                      <div className="sparkline-row">
                        <div className="spark-item">
                          <div className="spark-header"><span className="spark-label">Speed</span><span className="spark-val" style={{ color: tr.speed > ST ? 'var(--red)' : 'var(--green)' }}>{tr.speed.toFixed(0)} km/h</span></div>
                          <Sparkline data={selectedHistory.map(h => h.speed)} color={tr.speed > ST ? '#ef4444' : '#22c55e'} width={115} height={34} />
                        </div>
                        <div className="spark-divider" />
                        <div className="spark-item">
                          <div className="spark-header">
                            <span className="spark-label">Fuel</span>
                            <span className="spark-val">
                              {tr.fuel.toFixed(0)}%
                              {getFuelETA(tr.id) && <span style={{ color: 'var(--amber)', fontSize: 9, marginLeft: 5 }}>~{getFuelETA(tr.id)}m</span>}
                            </span>
                          </div>
                          <Sparkline data={selectedHistory.map(h => h.fuel)} color={tr.fuel < FT ? '#ef4444' : tr.fuel < FT * 2 ? '#f59e0b' : '#22c55e'} width={115} height={34} />
                        </div>
                        <div className="spark-divider" />
                        <div className="spark-item">
                          <div className="spark-header"><span className="spark-label">RPM</span><span className="spark-val">{Math.round(tr.rpm ?? 0).toLocaleString()}</span></div>
                          <Sparkline data={selectedHistory.map(h => h.rpm)} color="#6366f1" width={90} height={34} />
                        </div>
                      </div>
                    )}
                    <div className="detail-grid">
                      <Metric icon="🚗" label="Speed" value={tr.speed.toFixed(0)} unit="km/h" warn={tr.speed > ST} />
                      <Metric icon="⛽" label="Fuel" value={tr.fuel.toFixed(0)} unit="%" warn={tr.fuel < FT} />
                      <Metric icon="🌡️" label="Engine" value={tr.temperature.toFixed(0)} unit="°F" warn={tr.temperature > TT} />
                      <Metric icon="🔋" label="Battery" value={(tr.batteryVoltage ?? 12.6).toFixed(1)} unit="V" warn={(tr.batteryVoltage ?? 12.6) < 11.8} />
                      {tr.weight != null && <Metric icon="⚖️" label="Weight" value={(tr.weight / 1000).toFixed(1)} unit={`t / ${(MAX_WEIGHT_KG / 1000).toFixed(0)}t`} warn={tr.weight > MAX_WEIGHT_KG} />}
                    </div>
                    {/* Breakdown Risk */}
                    {(() => {
                      const risk = getBreakdownRisk(tr)
                      const rColor = risk >= 70 ? '#ef4444' : risk >= 40 ? '#f59e0b' : '#22c55e'
                      const rLabel = risk >= 70 ? 'High Risk — Inspect Soon' : risk >= 40 ? 'Moderate Risk — Monitor Closely' : 'Low Risk — Good Condition'
                      const rFill = (risk / 100) * 100
                      return (
                        <div className="risk-bar-wrap">
                          <div className="risk-bar-head">
                            <span className="risk-bar-label">🔩 Breakdown Risk</span>
                            <span className="risk-bar-val" style={{ color: rColor }}>{risk}% — {rLabel}</span>
                          </div>
                          <div className="risk-bar-track">
                            <div className="risk-bar-fill" style={{ width: `${rFill}%`, background: rColor, boxShadow: `0 0 8px ${rColor}` }} />
                          </div>
                        </div>
                      )
                    })()}
                    {/* Route export */}
                    <button className="export-btn" onClick={() => exportRoute(tr)}>
                      📥 Export Route CSV ({(routes[tr.id] || []).length} points)
                    </button>
                  </>
                )}

                {detailTab === 'coach' && (
                  <DriverCoachPanel
                    truck={tr}
                    idleDuration={getIdleDuration(tr.id) || 0}
                    shiftMins={getShiftHours(tr.id) || 0}
                    ST={ST} FT={FT} TT={TT}
                    onSendMessage={(templateKey) => {
                      const tpl = MSG_TEMPLATES.find(m => m.id === templateKey)
                      if (tpl && tr.driver?.phone) {
                        window.open(`sms:${tr.driver.phone}?body=${encodeURIComponent(tpl.text)}`)
                      } else {
                        setShowMessage(tr)
                      }
                    }}
                  />
                )}

                {detailTab === 'engine' && (() => {
                  const ms = getMaintStatus(tr)
                  return (
                    <div className="engine-tab-body">
                      <div className="engine-grid">
                        <EngineMetric icon="⚙️" label="RPM" value={Math.round(tr.rpm ?? 0).toLocaleString()} unit="rpm" warn={(tr.rpm ?? 0) > 4500} />
                        <EngineMetric icon="🌡️" label="Coolant" value={Math.round(tr.coolantTemp ?? 0)} unit="°F" warn={(tr.coolantTemp ?? 0) > 220} />
                        <EngineMetric icon="🛢️" label="Oil Pressure" value={Math.round(tr.oilPressure ?? 0)} unit="psi" warn={(tr.oilPressure ?? 0) < 20} />
                        <EngineMetric icon="🔋" label="Battery" value={(tr.batteryVoltage ?? 12.6).toFixed(1)} unit="V" warn={(tr.batteryVoltage ?? 12.6) < 11.8} />
                        <EngineMetric icon="📡" label="Signal" value={tr.signalStrength ?? 0} unit="dBm" />
                        <EngineMetric icon="🛰️" label="Satellites" value={tr.satelliteCount ?? 0} unit="GPS" />
                        <EngineMetric icon="🕐" label="Eng. Hours" value={(tr.engineHours ?? 0).toLocaleString()} unit="hrs" warn={(tr.engineHours ?? 0) > 3500} />
                        <EngineMetric icon="📏" label="Odometer" value={(tr.odometer ?? 0).toLocaleString()} unit="km" />
                      </div>
                      <div className="maint-panel">
                        <div className="maint-title">🔧 Service Intervals</div>
                        {[
                          { label: 'Oil Change',    km: ms.oilKm,  max: MI_OIL_KM,  extra: `or ${ms.oilHrs} hrs`, urgent: ms.urgent, warn: ms.warn },
                          { label: 'Tire Rotation', km: ms.tireKm, max: MI_TIRE_KM },
                          { label: 'Full Service',  km: ms.svcKm,  max: MI_SVC_KM  },
                        ].map(row => {
                          const pct   = Math.max(0, Math.min(100, ((row.max - row.km) / row.max) * 100))
                          const color = row.urgent ? 'var(--red)' : row.warn ? 'var(--amber)' : 'var(--green)'
                          return (
                            <div key={row.label} className="maint-row">
                              <div className="maint-row-head">
                                <span className="maint-row-label">{row.label}</span>
                                <span className="maint-row-val" style={{ color }}>
                                  {row.urgent ? '⚠️ Due now' : `${row.km.toLocaleString()} km`}
                                  {row.extra && !row.urgent && <span className="maint-row-alt"> · {row.extra}</span>}
                                </span>
                              </div>
                              <div className="maint-bar-track">
                                <div className="maint-bar-fill" style={{ width: `${pct}%`, background: color }} />
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })()}

                {detailTab === 'safety' && (
                  <div className="safety-panel">
                    {safetyScore !== null && (
                      <div className="safety-score-wrap">
                        <div className={`safety-score ${safetyScore >= 80 ? 'good' : safetyScore >= 55 ? 'fair' : 'poor'}`}>{safetyScore}</div>
                        <div>
                          <div className="safety-score-label">Driver Safety Score</div>
                          <div className="safety-score-sub">{safetyScore >= 80 ? '✅ Excellent driver' : safetyScore >= 55 ? '⚠️ Needs coaching' : '🚨 Review required'}</div>
                        </div>
                      </div>
                    )}
                    {safety && (
                      <div className="safety-grid">
                        <SafetyStat icon="🛑" label="Harsh Braking" value={safety.harshBraking} />
                        <SafetyStat icon="⚡" label="Rapid Accel" value={safety.rapidAcceleration} />
                        <SafetyStat icon="↩️" label="Sharp Corner" value={safety.sharpCornering} />
                        <SafetyStat icon="🐢" label="Idle Events" value={safety.excessiveIdle} />
                        <SafetyStat icon="🚨" label="Speeding" value={safety.speeding} warn={safety.speeding > 0} />
                      </div>
                    )}
                    {safety?.recentEvents?.length > 0 && (
                      <div className="event-timeline">
                        <div className="timeline-label">Recent Events</div>
                        {[...safety.recentEvents].reverse().slice(0, 6).map((e, i) => (
                          <div key={i} className="timeline-item">
                            <span className="timeline-type">{e.type.replace(/_/g, ' ')}</span>
                            <span className="timeline-val">{e.value}</span>
                            <span className="timeline-time">{new Date(e.time).toLocaleTimeString()}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {!safety?.recentEvents?.length && <div className="dtc-empty">✅ No recent safety events</div>}
                  </div>
                )}

                {detailTab === 'codes' && (
                  <div className="dtc-panel">
                    {dtcs.length === 0 && events.length === 0 && <div className="dtc-empty">✅ No active codes or alerts</div>}
                    {dtcs.map((d, i) => (
                      <div key={i} className={`dtc-item ${d.severity}`}>
                        <div className="dtc-left">
                          <div className="dtc-code">{d.code}</div>
                          <div className="dtc-desc">{d.desc}</div>
                          <div className="dtc-time">Detected {new Date(d.detectedAt).toLocaleTimeString()}</div>
                        </div>
                        <span className={`dtc-sev ${d.severity}`}>{d.severity}</span>
                      </div>
                    ))}
                    {events.filter(e => !e.type.startsWith('DTC')).map((e, i) => (
                      <div key={`ev${i}`} className={`dtc-item ${e.severity}`}>
                        <div className="dtc-left">
                          <div className="dtc-code">{e.type.replace(/_/g, ' ')}</div>
                          <div className="dtc-desc">Active alert — requires immediate action</div>
                        </div>
                        <span className={`dtc-sev ${e.severity}`}>{e.severity}</span>
                      </div>
                    ))}
                  </div>
                )}

                {detailTab === 'trends' && (() => {
                  const timeline = truckTimeline[tr.id] || []
                  const snap = replayIdx !== null ? timeline[replayIdx] : null
                  return (
                  <div className="trends-panel">
                    <div className="trends-header">Live trend — last {selectedHistory.length} readings (2s intervals)</div>
                    <TrendChart
                      speedData={selectedHistory.map(h => h.speed)}
                      fuelData={selectedHistory.map(h => h.fuel)}
                      tempData={selectedHistory.map(h => h.temp)}
                    />
                    {/* Trip Replay */}
                    {timeline.length > 1 && (
                      <div className="replay-panel">
                        <div className="replay-head">
                          <span className="replay-title">🎬 Trip Replay</span>
                          <span className="replay-count">{timeline.length} snapshots · {Math.round((timeline[timeline.length-1]?.time - timeline[0]?.time) / 60000)}m recorded</span>
                        </div>
                        <input type="range" className="replay-scrubber"
                          min={0} max={timeline.length - 1} value={replayIdx ?? timeline.length - 1}
                          onChange={e => { setReplayPlaying(false); setReplayIdx(Number(e.target.value)) }} />
                        <div className="replay-controls">
                          <button className="replay-btn"
                            onClick={() => { setReplayIdx(0); setReplayPlaying(false) }}>⏮</button>
                          <button className={`replay-btn play ${replayPlaying ? 'active' : ''}`}
                            onClick={() => {
                              if (replayIdx === null || replayIdx >= timeline.length - 1) setReplayIdx(0)
                              setReplayPlaying(p => !p)
                            }}>
                            {replayPlaying ? '⏸' : '▶'}
                          </button>
                          <button className="replay-btn"
                            onClick={() => { setReplayIdx(null); setReplayPlaying(false) }}>⏹ Live</button>
                          {snap && (
                            <div className="replay-snap-stats">
                              <span style={{ color: '#6366f1' }}>⚡ {snap.speed.toFixed(0)} km/h</span>
                              <span style={{ color: 'var(--amber)' }}>⛽ {snap.fuel.toFixed(0)}%</span>
                              <span style={{ color: 'var(--red)' }}>🌡️ {snap.temp.toFixed(0)}°F</span>
                              <span style={{ color: 'var(--text-dim)' }}>{new Date(snap.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    <div className="trends-stats">
                      <div className="ts-item"><span className="ts-label">Peak Speed</span><span className="ts-val" style={{ color: '#6366f1' }}>{selectedHistory.length ? Math.max(...selectedHistory.map(h => h.speed)).toFixed(0) : '--'} km/h</span></div>
                      <div className="ts-item"><span className="ts-label">Min Fuel</span><span className="ts-val" style={{ color: 'var(--amber)' }}>{selectedHistory.length ? Math.min(...selectedHistory.map(h => h.fuel)).toFixed(0) : '--'}%</span></div>
                      <div className="ts-item"><span className="ts-label">Peak RPM</span><span className="ts-val">{selectedHistory.length ? Math.max(...selectedHistory.map(h => h.rpm)).toFixed(0) : '--'}</span></div>
                      <div className="ts-item"><span className="ts-label">Peak Temp</span><span className="ts-val" style={{ color: 'var(--red)' }}>{selectedHistory.length ? Math.max(...selectedHistory.map(h => h.temp)).toFixed(0) : '--'}°F</span></div>
                    </div>
                  </div>
                  )
                })()}

                {detailTab === 'vehicle' && (() => {
                  const v = tr.vehicle
                  const now = new Date()
                  const expiry = (dateStr) => {
                    if (!dateStr) return { label: 'N/A', cls: '' }
                    const d = new Date(dateStr)
                    const days = Math.ceil((d - now) / 86400000)
                    if (days < 0)  return { label: `Expired ${Math.abs(days)}d ago`, cls: 'expired' }
                    if (days < 30) return { label: `Expires in ${days}d`, cls: 'expiring' }
                    return { label: d.toLocaleDateString('en-SA', { year: 'numeric', month: 'short', day: 'numeric' }), cls: 'valid' }
                  }
                  const reg = expiry(v?.regExpiry)
                  const ins = expiry(v?.insExpiry)
                  return (
                    <div className="vehicle-panel">
                      {v ? (
                        <>
                          <div className="veh-hero">
                            <div className="veh-make">{v.make}</div>
                            <div className="veh-model">{v.model}</div>
                            <div className="veh-year-color">{v.year} · {v.color}</div>
                          </div>
                          <div className="veh-grid">
                            <div className="veh-item"><span className="veh-lbl">VIN</span><span className="veh-val mono">{v.vin}</span></div>
                            <div className="veh-item"><span className="veh-lbl">Plate</span><span className="veh-val mono">{tr.licensePlate}</span></div>
                            <div className="veh-item"><span className="veh-lbl">Odometer</span><span className="veh-val">{(tr.odometer || 0).toLocaleString()} km</span></div>
                            <div className="veh-item"><span className="veh-lbl">Engine Hours</span><span className="veh-val">{(tr.engineHours || 0).toLocaleString()} hrs</span></div>
                            <div className="veh-item">
                              <span className="veh-lbl">Registration</span>
                              <span className={`veh-val veh-exp ${reg.cls}`}>{reg.label}</span>
                            </div>
                            <div className="veh-item">
                              <span className="veh-lbl">Insurance</span>
                              <span className={`veh-val veh-exp ${ins.cls}`}>{ins.label}</span>
                            </div>
                            <div className="veh-item">
                              <span className="veh-lbl">Last Inspection</span>
                              <span className="veh-val">{v.lastInspection ? new Date(v.lastInspection).toLocaleDateString('en-SA', { year: 'numeric', month: 'short', day: 'numeric' }) : 'N/A'}</span>
                            </div>
                            <div className="veh-item">
                              <span className="veh-lbl">Battery</span>
                              <span className="veh-val" style={{ color: (tr.batteryVoltage || 12.6) < 11.8 ? 'var(--red)' : 'inherit' }}>{(tr.batteryVoltage || 12.6).toFixed(1)} V</span>
                            </div>
                          </div>
                          {(reg.cls === 'expired' || reg.cls === 'expiring' || ins.cls === 'expired' || ins.cls === 'expiring') && (
                            <div className="veh-alert">
                              ⚠️ {[reg.cls === 'expired' && 'Registration expired', ins.cls === 'expired' && 'Insurance expired', reg.cls === 'expiring' && 'Registration expiring soon', ins.cls === 'expiring' && 'Insurance expiring soon'].filter(Boolean).join(' · ')} — contact compliance team.
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="dtc-empty">No vehicle profile on record</div>
                      )}
                    </div>
                  )
                })()}

                {detailTab === 'notes' && (
                  <div className="notes-panel">
                    <div className="notes-hint">Notes are saved locally on this device.</div>
                    <textarea
                      className="notes-area"
                      placeholder={`Notes for ${tr.licensePlate}…\n\ne.g. "Check tire pressure before next trip"\n"Driver assigned new Riyadh North route"\n"Scheduled for oil change Friday"`}
                      value={truckNotes[tr.id] || ''}
                      onChange={e => setTruckNotes(prev => ({ ...prev, [tr.id]: e.target.value }))}
                    />
                    {truckNotes[tr.id]?.trim() && (
                      <div className="notes-footer">
                        <span className="notes-saved">✓ Saved automatically</span>
                        <button className="notes-clear" onClick={() => setTruckNotes(prev => ({ ...prev, [tr.id]: '' }))}>Clear</button>
                      </div>
                    )}
                  </div>
                )}

                {detailTab === 'trip' && (() => {
                  const routePts = routes[tr.id] || []
                  let totalKm = 0
                  for (let i = 1; i < routePts.length; i++) {
                    totalKm += haversineDist(routePts[i-1][0], routePts[i-1][1], routePts[i][0], routePts[i][1])
                  }
                  const hist = selectedHistory
                  const fuelUsedPct = hist.length >= 2 ? Math.max(0, hist[0].fuel - hist[hist.length - 1].fuel) : 0
                  const fuelUsedL = (fuelUsedPct / 100) * TANK_LITRES
                  const fuelCostSAR = fuelUsedL * FUEL_PRICE_SAR
                  const avgSpd = hist.length ? hist.reduce((s, h) => s + h.speed, 0) / hist.length : 0
                  const maxSpd = hist.length ? Math.max(...hist.map(h => h.speed)) : 0
                  const truckAlerts = alertLog.filter(e => e.plate === tr.licensePlate).length
                  const activeJob = jobs.find(j => j.truckId === tr.id && j.status === 'enroute')
                  return (
                    <div className="trip-panel">
                      {activeJob && (
                        <div className="trip-job-card">
                          <div className="tjc-label">Active Job</div>
                          <div className="tjc-title">{activeJob.title}</div>
                          <div className="tjc-route">{activeJob.from} → {activeJob.to}</div>
                          <div className="tjc-meta">
                            <span className="tjc-eta">🕐 ETA {activeJob.eta}</span>
                            <button className="tjc-done-btn" onClick={() => setJobs(p => p.map(j => j.id === activeJob.id ? { ...j, status: 'complete' } : j))}>
                              ✓ Mark Complete
                            </button>
                          </div>
                        </div>
                      )}
                      <div className="trip-stats">
                        <div className="trip-stat">
                          <span className="trip-stat-icon">📏</span>
                          <div>
                            <div className="trip-val">{totalKm < 1 ? `${(totalKm * 1000).toFixed(0)} m` : `${totalKm.toFixed(2)} km`}</div>
                            <div className="trip-label">Distance this session</div>
                          </div>
                        </div>
                        <div className="trip-stat">
                          <span className="trip-stat-icon">⛽</span>
                          <div>
                            <div className="trip-val">{fuelUsedL.toFixed(1)} L</div>
                            <div className="trip-label">Fuel used · SAR {fuelCostSAR.toFixed(2)}</div>
                          </div>
                        </div>
                        <div className="trip-stat">
                          <span className="trip-stat-icon">🚗</span>
                          <div>
                            <div className="trip-val">{avgSpd.toFixed(0)} <span style={{ fontSize: 12, fontWeight: 500 }}>avg</span> / {maxSpd.toFixed(0)} <span style={{ fontSize: 12, fontWeight: 500 }}>max km/h</span></div>
                            <div className="trip-label">Speed this session</div>
                          </div>
                        </div>
                        <div className="trip-stat">
                          <span className="trip-stat-icon">🚨</span>
                          <div>
                            <div className="trip-val" style={{ color: truckAlerts > 0 ? 'var(--red)' : 'var(--green)' }}>{truckAlerts}</div>
                            <div className="trip-label">Alerts triggered this session</div>
                          </div>
                        </div>
                      </div>
                      {routePts.length < 2 && (
                        <div className="trip-empty">📡 Collecting route data — check back in a moment</div>
                      )}
                      <button className="export-btn" style={{ marginTop: 4 }} onClick={() => setShowDispatch(true)}>
                        📋 Open Dispatch Board
                      </button>
                    </div>
                  )
                })()}
              </div>
            </div>
          )}
        </div>

        {/* AI Intelligence Panel */}
        <div className="ai-panel" role="region" aria-label="AI fleet intelligence" style={appMode === 'tms' ? { display: 'none' } : undefined}>
          <div className="ai-head">
            <div className="ai-head-left">
              <div className="ai-title">AI Intelligence</div>
              {aiLastUpdated && (
                <span className="ai-timestamp" aria-label={`Last updated at ${aiLastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}>
                  Updated {aiLastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>
            <div className="ai-actions">
              <div className="ai-tools">
                <button className="ai-tool-btn" onClick={() => setShowOptimizer(true)} title="AI route optimization (O)" aria-label="Route optimizer">🧭</button>
                <button className="ai-tool-btn" onClick={() => setShowPredMaint(true)} title="Predictive maintenance (M)" aria-label="Predictive maintenance">🔧</button>
                <button className="ai-tool-btn" onClick={() => setShowFinancials(true)} title="Financial intelligence (V)" aria-label="Financials">💰</button>
                <button className="ai-tool-btn" onClick={copyStatusReport} title="Copy status report" aria-label="Copy report">📋</button>
                <button className="ai-tool-btn" onClick={exportPDF} title="Export PDF report (P)" aria-label="Export PDF">📄</button>
              </div>
              <button className="ai-btn" onClick={getAI} disabled={aiLoading} aria-busy={aiLoading}>
                {aiLoading
                  ? <><span className="ai-spinner" aria-hidden="true" />Analyzing…</>
                  : <>⚡ Briefing</>}
              </button>
            </div>
          </div>
          {aiLoading && (
            <div className="ai-loading-bar" aria-hidden="true">
              <div className="ai-loading-fill" />
            </div>
          )}
          {aiAnalysis
            ? <div className="ai-text" role="article" aria-label="AI fleet briefing">
                {aiAnalysis.split('\n').map((line, i) => {
                  if (!line.trim()) return <div key={i} style={{height:6}} />
                  if (line.startsWith('NEXT ACTION:')) return <div key={i} className="ai-next-action">{line}</div>
                  if (/^(SITUATION|CRITICAL|COST RISK|NEXT ACTION):/.test(line)) return <div key={i} className="ai-section-head">{line}</div>
                  if (line.trim().startsWith('•')) return <div key={i} className="ai-bullet">{line}</div>
                  return <div key={i} className="ai-line">{line}</div>
                })}
              </div>
            : <div className="ai-empty" role="status">
                <div className="ai-empty-icon" aria-hidden="true">◆</div>
                <div className="ai-empty-text">AI-powered analysis of your fleet — critical trucks, cost impact, and recommended next actions.</div>
                <button className="ai-empty-cta" onClick={getAI} disabled={aiLoading} aria-label="Generate AI fleet briefing">
                  {aiLoading ? <><span className="ai-spinner" aria-hidden="true" />Analyzing…</> : <>⚡ Generate Briefing</>}
                </button>
                {!isOnline && <div className="ai-demo-note">Works in demo mode — no backend required.</div>}
              </div>}
        </div>

        {appMode === 'fms' && <FleetAnalytics trucks={trucks} ST={ST} FT={FT} />}
      </main>
      </div>{/* end app-body */}

      {isOnline && <CopilotSidebar
        labels={{
          title: '🚛 Fleet AI Assistant',
          initial: "I have live access to all trucks — speed, fuel, DTC codes, safety scores, geofence status, and refuel costs.\n\nTry:\n• \"Which trucks need attention right now?\"\n• \"Who has the highest safety score?\"\n• \"What's the total refuel cost?\"\n• \"Generate a fleet briefing\"",
        }}
      />}

      {/* ── Live Events Ticker ── */}
      {alertLog.length > 0 && (
        <div className="event-ticker">
          <span className="ticker-label">LIVE</span>
          <div className="ticker-scroll">
            <div className="ticker-track">
              {[...alertLog.slice(0, 8), ...alertLog.slice(0, 8)].map((e, i) => (
                <span key={i} className={`ticker-event t-${e.type}`}>
                  {e.msg}
                  <span className="ticker-time">{e.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  <span className="ticker-sep">•</span>
                </span>
              ))}
            </div>
          </div>
          <button className="ticker-close" onClick={() => setAlertLog([])} title="Clear ticker">✕</button>
        </div>
      )}
    </div>
  )
}

// ── Sub-components (all memoised — skip re-render if props unchanged) ──────────
const StatCard = memo(function StatCard({ icon, label, value, cls = '', onClick }) {
  const numericTarget = typeof value === 'number' ? value : parseFloat(value)
  const animated = useCountUp(isNaN(numericTarget) ? 0 : numericTarget)
  const displayVal = typeof value === 'number' ? Math.round(animated) : isNaN(numericTarget) ? value : `${Math.round(animated)}${String(value).replace(/^[\d.]+/, '')}`
  const prevRef = useRef(null)
  const [trend, setTrend] = useState(null) // 'up' | 'down' | null
  useEffect(() => {
    if (!isNaN(numericTarget) && prevRef.current !== null && prevRef.current !== numericTarget) {
      setTrend(numericTarget > prevRef.current ? 'up' : 'down')
      const t = setTimeout(() => setTrend(null), 2500)
      prevRef.current = numericTarget
      return () => clearTimeout(t)
    }
    if (prevRef.current === null) prevRef.current = numericTarget
  }, [numericTarget])
  return (
    <div className={`stat ${cls} ${onClick ? 'clickable' : ''}`} onClick={onClick} title={onClick ? `Click to filter by ${label}` : undefined}>
      <div className="stat-icon-wrap">
        <span className="stat-icon">{icon}</span>
      </div>
      <div className="stat-body">
        <div className="stat-val">
          {displayVal}
          {trend && <span className={`stat-trend stat-trend-${trend}`}>{trend === 'up' ? '▲' : '▼'}</span>}
        </div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  )
})
const Metric = memo(function Metric({ icon, label, value, unit, warn }) {
  return (
    <div className={`metric ${warn ? 'warn' : ''}`}>
      <div className="metric-label">{icon} {label}</div>
      <div className="metric-value">{value}<span className="metric-unit"> {unit}</span></div>
    </div>
  )
})
const EngineMetric = memo(function EngineMetric({ icon, label, value, unit, warn }) {
  return (
    <div className={`engine-metric ${warn ? 'warn' : ''}`}>
      <div className="em-icon">{icon}</div>
      <div className="em-body">
        <div className="em-label">{label}</div>
        <div className="em-value">{value}<span className="em-unit"> {unit}</span></div>
      </div>
    </div>
  )
})
const SafetyStat = memo(function SafetyStat({ icon, label, value, warn }) {
  return (
    <div className={`safety-stat ${warn ? 'warn' : ''}`}>
      <span className="ss-icon">{icon}</span>
      <span className="ss-label">{label}</span>
      <span className={`ss-val ${warn ? 'red' : ''}`}>{value}</span>
    </div>
  )
})

export default App
