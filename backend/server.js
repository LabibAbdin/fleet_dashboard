// Load .env from the backend folder itself, no matter where the server is launched from
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { CopilotRuntime, GroqAdapter, copilotRuntimeNodeExpressEndpoint } = require('@copilotkit/runtime');

const app = express();
app.use(express.json());
app.use(cors());

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

// ============= IN-MEMORY DATABASE =============

const users = new Map();
const userProfiles = new Map();

users.set('driver1', {
  id: 'user1',
  username: 'driver1',
  password: bcrypt.hashSync('password123', 10),
  email: 'driver@example.com'
});

// ============= AUTHENTICATION =============`

app.post('/api/auth/register', async (req, res) => {
  const { username, password, email } = req.body;
  if (users.has(username)) return res.status(400).json({ error: 'User exists' });

  const userId = 'user_' + Date.now();
  users.set(username, {
    id: userId, username,
    password: bcrypt.hashSync(password, 10), email
  });

  const token = jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, userId, username });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const user = users.get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ userId: user.id, username }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, userId: user.id, username, hasProfile: userProfiles.has(user.id) });
});

const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

app.get('/api/me', verifyToken, (req, res) => {
  const user = users.get(req.user.username);
  res.json({ id: user.id, username: user.username, email: user.email });
});

// ============= ONBOARDING =============

app.post('/api/onboarding/questionnaire', verifyToken, (req, res) => {
  const { age, experience, vehicleType, speedLimit } = req.body;
  userProfiles.set(req.user.userId, {
    userId: req.user.userId, age, experience, vehicleType, speedLimit,
    completedAt: new Date(),
    preferences: { speedAlertLimit: speedLimit, harshBrakeThreshold: -0.8, fuelAlertLevel: 20 }
  });
  res.json({ success: true });
});

app.get('/api/onboarding/profile', verifyToken, (req, res) => {
  res.json(userProfiles.get(req.user.userId) || null);
});

// ============= TRUCKS & TELEMETRY =============

const trucks = new Map();
const routeHistory = new Map();
const safetyEvents = new Map();


const DTC_CODES = [
  { code: 'P0171', desc: 'System Too Lean (Bank 1)', severity: 'warning' },
  { code: 'P0300', desc: 'Random/Multiple Cylinder Misfire', severity: 'critical' },
  { code: 'P0420', desc: 'Catalyst System Efficiency Below Threshold', severity: 'warning' },
  { code: 'P0507', desc: 'Idle Air Control System RPM Higher Than Expected', severity: 'warning' },
  { code: 'P0128', desc: 'Coolant Thermostat Below Regulating Temperature', severity: 'warning' },
  { code: 'P0562', desc: 'System Voltage Low', severity: 'critical' },
  { code: 'P0217', desc: 'Engine Overtemperature Condition', severity: 'critical' },
  { code: 'P0087', desc: 'Fuel Rail Pressure Too Low', severity: 'critical' },
];

const truckData = [
  { id: 'truck1',  plate: 'ABC-123', lat: 24.7136, lng: 46.6753, status: 'active' },
  { id: 'truck2',  plate: 'XYZ-789', lat: 24.7500, lng: 46.7000, status: 'active' },
  { id: 'truck3',  plate: 'DEF-456', lat: 24.6800, lng: 46.6500, status: 'active' },
  { id: 'truck4',  plate: 'GHI-321', lat: 24.7200, lng: 46.5500, status: 'idle' },
  { id: 'truck5',  plate: 'JKL-654', lat: 24.7000, lng: 46.8000, status: 'active' },
  { id: 'truck6',  plate: 'KLN-441', lat: 24.7636, lng: 46.6853, status: 'active' },
  { id: 'truck7',  plate: 'BTH-779', lat: 24.6536, lng: 46.6953, status: 'active' },
  { id: 'truck8',  plate: 'QZM-115', lat: 24.7036, lng: 46.6553, status: 'idle' },
  { id: 'truck9',  plate: 'WRD-336', lat: 24.7336, lng: 46.7453, status: 'active' },
  { id: 'truck10', plate: 'JFS-992', lat: 24.6936, lng: 46.7253, status: 'active' },
  { id: 'truck11', plate: 'PCV-550', lat: 24.7536, lng: 46.7053, status: 'active' },
  { id: 'truck12', plate: 'HMD-228', lat: 24.6636, lng: 46.6653, status: 'active' },
];

const driverProfiles = {
  'truck1':  { name: 'Ahmed Al-Rashid',    experience: '6 years',  license: 'CDL-A', phone: '+966 50 123 4567', rating: 4.8, photo: 'https://randomuser.me/api/portraits/men/32.jpg' },
  'truck2':  { name: 'Mohammed Hassan',    experience: '3 years',  license: 'CDL-A', phone: '+966 55 234 5678', rating: 4.5, photo: 'https://randomuser.me/api/portraits/men/44.jpg' },
  'truck3':  { name: 'Khalid Al-Otaibi',  experience: '9 years',  license: 'CDL-B', phone: '+966 53 345 6789', rating: 4.9, photo: 'https://randomuser.me/api/portraits/men/55.jpg' },
  'truck4':  { name: 'Saud Al-Dosari',    experience: '2 years',  license: 'CDL-A', phone: '+966 56 456 7890', rating: 4.2, photo: 'https://randomuser.me/api/portraits/men/61.jpg' },
  'truck5':  { name: 'Faisal Al-Qahtani', experience: '5 years',  license: 'CDL-B', phone: '+966 54 567 8901', rating: 4.7, photo: 'https://randomuser.me/api/portraits/men/76.jpg' },
  'truck6':  { name: 'Saud Al-Qahtani',   experience: '6 years',  license: 'CDL-A', phone: '+966 53 456 7890', rating: 4.6, photo: 'https://randomuser.me/api/portraits/men/81.jpg' },
  'truck7':  { name: 'Fahad Al-Mutairi',  experience: '4 years',  license: 'CDL-B', phone: '+966 54 567 8902', rating: 4.0, photo: 'https://randomuser.me/api/portraits/men/22.jpg' },
  'truck8':  { name: 'Abdullah Al-Harbi', experience: '15 years', license: 'CDL-A', phone: '+966 55 678 9012', rating: 5.0, photo: 'https://randomuser.me/api/portraits/men/91.jpg' },
  'truck9':  { name: 'Nasser Al-Dosari',  experience: '5 years',  license: 'CDL-B', phone: '+966 56 789 0123', rating: 4.3, photo: 'https://randomuser.me/api/portraits/men/36.jpg' },
  'truck10': { name: 'Turki Al-Shammari', experience: '9 years',  license: 'CDL-A', phone: '+966 57 890 1234', rating: 4.8, photo: 'https://randomuser.me/api/portraits/men/49.jpg' },
  'truck11': { name: 'Bandar Al-Otaibi',  experience: '7 years',  license: 'CDL-A', phone: '+966 58 901 2345', rating: 4.5, photo: 'https://randomuser.me/api/portraits/men/17.jpg' },
  'truck12': { name: 'Majed Al-Ghamdi',   experience: '8 years',  license: 'CDL-A', phone: '+966 59 012 3456', rating: 4.7, photo: 'https://randomuser.me/api/portraits/men/29.jpg' },
};


truckData.forEach(data => {
  trucks.set(data.id, {
    id: data.id,
    licensePlate: data.plate,
    driverId: 'user1',
    driver: driverProfiles[data.id],
    status: data.status,
    ignition: data.status === 'active',
    location: { lat: data.lat, lng: data.lng },
    speed: Math.random() * 60,
    fuel: 50 + Math.random() * 35,
    temperature: 85 + Math.random() * 20,
    rpm: 1000 + Math.random() * 2000,
    batteryVoltage: 12.4 + Math.random() * 1.2,
    coolantTemp: 180 + Math.random() * 20,
    oilPressure: 25 + Math.random() * 20,
    engineHours: 1200 + Math.floor(Math.random() * 3000),
    odometer: 45000 + Math.floor(Math.random() * 80000),
    activeDTCs: [],
    firmwareVersion: 'v3.2.1',
    signalStrength: -60 + Math.floor(Math.random() * 30),
    satelliteCount: 8 + Math.floor(Math.random() * 6),
    deviceBattery: 85 + Math.floor(Math.random() * 15),
  });

  routeHistory.set(data.id, [{ lat: data.lat, lng: data.lng, time: Date.now() }]);

  safetyEvents.set(data.id, {
    harshBraking: 0,
    rapidAcceleration: 0,
    sharpCornering: 0,
    excessiveIdle: 0,
    speeding: 0,
    recentEvents: [],
  });
});

console.log(`\nâœ… Initialized ${trucks.size} trucks with full telemetry\n`);

// ============= HEALTH / TEST =============

app.get('/api/test', (req, res) => res.json({ status: 'online', ts: Date.now() }));
app.get('/api/health', (req, res) => res.json({ status: 'ok', trucks: trucks.size, uptime: process.uptime() }));

// ============= VEHICLE METADATA =============

const vehicleModels = [
  { make: 'Volvo',        model: 'FH16 750',      year: 2022, color: 'White',  vin: 'YV2RT40A4NB123001' },
  { make: 'Mercedes',     model: 'Actros 1851',    year: 2021, color: 'Silver', vin: 'WDB9634031L123002' },
  { make: 'MAN',          model: 'TGX 18.510',     year: 2023, color: 'White',  vin: 'WMA06XZZ1NM123003' },
  { make: 'Scania',       model: 'R500 XT',        year: 2020, color: 'Red',    vin: 'YS2R4X20006123004' },
  { make: 'DAF',          model: 'XF 480',         year: 2022, color: 'Blue',   vin: 'XLRTE47MS0E123005' },
  { make: 'Kenworth',     model: 'T680',           year: 2021, color: 'White',  vin: '1XKYD49X6LJ123006' },
  { make: 'Peterbilt',    model: '579 Ultraloft',  year: 2023, color: 'Black',  vin: '1XPBD49X5ND123007' },
  { make: 'Freightliner', model: 'Cascadia 126',   year: 2022, color: 'White',  vin: '3AKJHHDR0NSMN1008' },
  { make: 'International',model: 'LT Series',      year: 2021, color: 'Grey',   vin: '3HSDHAPR8NNO39009' },
  { make: 'Volvo',        model: 'VNL 860',        year: 2022, color: 'White',  vin: '4V4NC9EH6NN123010' },
  { make: 'Mack',         model: 'Anthem 64T',     year: 2020, color: 'Blue',   vin: '1M1AW07Y5LM123011' },
  { make: 'Scania',       model: 'G450 XT',        year: 2023, color: 'Green',  vin: 'YS2G4X20006123012' },
];

Array.from(trucks.values()).forEach((truck, i) => {
  const v = vehicleModels[i % vehicleModels.length];
  truck.vehicle = {
    make: v.make, model: v.model, year: v.year, color: v.color, vin: v.vin,
    regExpiry: '2026-12-31', insExpiry: '2026-06-30', lastInspection: '2025-11-15',
  };
  truck.safetyScore = 75 + Math.floor(Math.random() * 25);
});

// ============= CONTINUOUS LIVE SIMULATION LOOP (2s tick) =============

setInterval(() => {
  trucks.forEach((truck, id) => {
    const prevSpeed = truck.speed;
    if (truck.status === 'active') {
      truck.speed = Math.max(0, Math.min(110, truck.speed + (Math.random() - 0.48) * 8));
      truck.fuel = Math.max(5, truck.fuel - (Math.random() * 0.25));
      truck.temperature = Math.max(80, Math.min(130, truck.temperature + (Math.random() - 0.5) * 2));
      truck.rpm = Math.max(700, Math.min(4200, truck.rpm + (Math.random() - 0.5) * 200));
      truck.location.lat += (Math.random() - 0.5) * 0.002;
      truck.location.lng += (Math.random() - 0.5) * 0.002;
      truck.batteryVoltage = Math.max(11.5, Math.min(14.2, truck.batteryVoltage + (Math.random() - 0.5) * 0.05));
      truck.oilPressure = Math.max(15, Math.min(60, truck.oilPressure + (Math.random() - 0.5) * 2));
      truck.coolantTemp = Math.max(160, Math.min(230, truck.coolantTemp + (Math.random() - 0.5) * 3));
      truck.engineHours = (truck.engineHours || 0) + (2 / 3600);
      truck.odometer = (truck.odometer || 0) + (truck.speed * 2 / 3600);
    } else {
      truck.speed = Math.max(0, truck.speed - Math.random() * 2);
      truck.fuel = Math.max(5, truck.fuel - (Math.random() * 0.03));
      truck.temperature = Math.max(75, truck.temperature - Math.random() * 0.5);
    }
    // Occasional status flip
    if (Math.random() < 0.004) truck.status = truck.status === 'active' ? 'idle' : 'active';
    // DTC logic
    if (Math.random() < 0.008 && truck.activeDTCs.length < 2) {
      const dtc = DTC_CODES[Math.floor(Math.random() * DTC_CODES.length)];
      if (!truck.activeDTCs.find(d => d.code === dtc.code)) truck.activeDTCs.push({ ...dtc, detectedAt: new Date().toISOString() });
    }
    if (Math.random() < 0.012 && truck.activeDTCs.length > 0) truck.activeDTCs.pop();
    // Safety events
    const safety = safetyEvents.get(id);
    if (safety) {
      const delta = truck.speed - prevSpeed;
      if (delta < -8) safety.harshBraking++;
      if (delta > 8) safety.rapidAcceleration++;
      if (truck.speed > 70) safety.speeding++;
      if (truck.speed < 5 && truck.status === 'active') safety.excessiveIdle++;
    }
    // Recalculate safety score
    if (safety) {
      truck.safetyScore = Math.max(0, 100
        - (safety.harshBraking || 0) * 3
        - (safety.rapidAcceleration || 0) * 2
        - (safety.speeding || 0) * 5);
    }
    // Route breadcrumb
    const route = routeHistory.get(id);
    if (route) {
      route.push({ lat: truck.location.lat, lng: truck.location.lng, time: Date.now(), speed: truck.speed, fuel: truck.fuel });
      if (route.length > 300) route.splice(0, route.length - 300);
    }
    truck.lastUpdated = Date.now();
  });
}, 2000);

// ============= FLEET STATS =============

app.get('/api/fleet-stats', verifyToken, (req, res) => {
  const all = Array.from(trucks.values());
  const active = all.filter(t => t.status === 'active').length;
  const idle = all.filter(t => t.status === 'idle').length;
  const speeding = all.filter(t => t.speed > 70).length;
  const lowFuel = all.filter(t => t.fuel < 20).length;
  const highTemp = all.filter(t => t.temperature > 110).length;
  const avgFuel = Math.round(all.reduce((s, t) => s + t.fuel, 0) / all.length);
  const avgSpeed = Math.round(all.filter(t => t.status === 'active').reduce((s, t) => s + t.speed, 0) / Math.max(1, active));
  const dtcCount = all.reduce((s, t) => s + (t.activeDTCs?.length || 0), 0);
  const totalAlerts = speeding + lowFuel + highTemp + dtcCount;
  res.json({ total: all.length, active, idle, speeding, lowFuel, highTemp, avgFuel, avgSpeed, dtcCount, totalAlerts, ts: Date.now() });
});

// GET ALL TRUCKS
app.get('/api/trucks', verifyToken, (req, res) => {
  const allTrucks = Array.from(trucks.values()).map(truck => ({
    ...truck,
    safety: safetyEvents.get(truck.id) || {},
  }));
  res.json(allTrucks);
});

// GET SINGLE TRUCK
app.get('/api/trucks/:id', verifyToken, (req, res) => {
  const truck = trucks.get(req.params.id);
  if (!truck) return res.status(404).json({ error: 'Truck not found' });
  res.json(truck);
});

// GET ROUTE HISTORY
app.get('/api/truck-route/:id', verifyToken, (req, res) => {
  const history = routeHistory.get(req.params.id);
  if (!history) return res.status(404).json({ error: 'Truck not found' });
  res.json(history);
});

// GET SAFETY EVENTS
app.get('/api/truck-safety/:id', verifyToken, (req, res) => {
  const safety = safetyEvents.get(req.params.id);
  if (!safety) return res.status(404).json({ error: 'Truck not found' });
  res.json(safety);
});

// GET TRUCK TELEMETRY (real-time with simulation)
app.get('/api/truck-telemetry/:id', verifyToken, (req, res) => {
  const truck = trucks.get(req.params.id);
  if (!truck) return res.status(404).json({ error: 'Truck not found' });

  const prevSpeed = truck.speed;

  // Simulate real-time changes
  truck.speed = Math.max(0, Math.min(120, truck.speed + (Math.random() - 0.5) * 10));
  truck.fuel = Math.max(5, truck.fuel - Math.random() * 1.5);
  truck.temperature = 85 + Math.random() * 30;
  truck.rpm = Math.max(800, Math.min(5000, truck.rpm + (Math.random() - 0.5) * 300));
  truck.location.lat += (Math.random() - 0.5) * 0.005;
  truck.location.lng += (Math.random() - 0.5) * 0.005;

  truck.batteryVoltage = Math.max(11.0, Math.min(14.4, truck.batteryVoltage + (Math.random() - 0.5) * 0.2));
  truck.coolantTemp = Math.max(160, Math.min(230, truck.coolantTemp + (Math.random() - 0.5) * 5));
  truck.oilPressure = Math.max(15, Math.min(55, truck.oilPressure + (Math.random() - 0.5) * 3));
  truck.signalStrength = Math.max(-90, Math.min(-40, truck.signalStrength + Math.floor((Math.random() - 0.5) * 5)));
  truck.satelliteCount = Math.max(4, Math.min(14, truck.satelliteCount + Math.floor((Math.random() - 0.5) * 2)));
  truck.ignition = truck.status === 'active';

  // Simulate DTC codes
  if (Math.random() < 0.03 && truck.activeDTCs.length < 3) {
    const randomDTC = DTC_CODES[Math.floor(Math.random() * DTC_CODES.length)];
    if (!truck.activeDTCs.find(d => d.code === randomDTC.code)) {
      truck.activeDTCs.push({ ...randomDTC, detectedAt: new Date().toISOString() });
    }
  }
  if (Math.random() < 0.02 && truck.activeDTCs.length > 0) {
    truck.activeDTCs.pop();
  }

  // Record route breadcrumb
  const route = routeHistory.get(truck.id);
  if (route) {
    route.push({ lat: truck.location.lat, lng: truck.location.lng, time: Date.now() });
    if (route.length > 200) route.splice(0, route.length - 200);
  }

  // Simulate driver safety events
  const safety = safetyEvents.get(truck.id);
  if (safety) {
    const speedDelta = truck.speed - prevSpeed;

    if (speedDelta < -8) {
      safety.harshBraking++;
      safety.recentEvents.push({ type: 'HARSH_BRAKE', time: new Date().toISOString(), value: speedDelta.toFixed(1) + ' mph/s' });
    }

    if (speedDelta > 8) {
      safety.rapidAcceleration++;
      safety.recentEvents.push({ type: 'RAPID_ACCEL', time: new Date().toISOString(), value: '+' + speedDelta.toFixed(1) + ' mph/s' });
    }

    if (truck.speed > 30 && Math.random() < 0.04) {
      safety.sharpCornering++;
      safety.recentEvents.push({ type: 'SHARP_CORNER', time: new Date().toISOString(), value: (15 + Math.random() * 10).toFixed(0) + 'Â° lateral' });
    }

    if (truck.speed > 70) {
      safety.speeding++;
    }

    if (truck.speed < 5 && truck.ignition) {
      safety.excessiveIdle++;
    }

    if (safety.recentEvents.length > 50) {
      safety.recentEvents = safety.recentEvents.slice(-50);
    }
  }

  // Detect events/alerts
  const events = [];
  if (truck.speed > 70) events.push({ type: 'SPEEDING', severity: 'high' });
  if (truck.fuel < 20) events.push({ type: 'LOW_FUEL', severity: 'high' });
  if (truck.temperature > 110) events.push({ type: 'HIGH_TEMP', severity: 'critical' });
  if (truck.batteryVoltage < 11.8) events.push({ type: 'LOW_BATTERY', severity: 'high' });
  if (truck.coolantTemp > 220) events.push({ type: 'COOLANT_HIGH', severity: 'critical' });
  if (truck.oilPressure < 20) events.push({ type: 'LOW_OIL_PRESSURE', severity: 'critical' });

  truck.activeDTCs.forEach(dtc => {
    events.push({ type: `DTC: ${dtc.code}`, severity: dtc.severity, desc: dtc.desc });
  });

  res.json({
    truck,
    events,
    safety: safetyEvents.get(truck.id),
    routePoints: (routeHistory.get(truck.id) || []).length,
  });
});


// ============= FLEET OVERVIEW (all trucks + safety scores) =============

app.get('/api/fleet-overview', verifyToken, (req, res) => {
  const overview = Array.from(trucks.values()).map(truck => {
    const safety = safetyEvents.get(truck.id) || {};
    const alerts = [];
    if (truck.speed > 70) alerts.push({ type: 'SPEEDING', severity: 'high' });
    if (truck.fuel < 20) alerts.push({ type: 'LOW_FUEL', severity: 'high' });
    if (truck.temperature > 110) alerts.push({ type: 'HIGH_TEMP', severity: 'critical' });
    (truck.activeDTCs || []).forEach(d => alerts.push({ type: `DTC ${d.code}`, severity: d.severity }));
    const safetyScore = Math.max(0, 100
      - (safety.harshBraking || 0) * 3
      - (safety.rapidAcceleration || 0) * 2
      - (safety.sharpCornering || 0) * 2
      - (safety.speeding || 0) * 5);
    return {
      id: truck.id,
      licensePlate: truck.licensePlate,
      driver: truck.driver,
      status: truck.status,
      speed: truck.speed,
      fuel: truck.fuel,
      temperature: truck.temperature,
      engineHours: truck.engineHours || 0,
      odometer: truck.odometer || 0,
      activeDTCs: truck.activeDTCs || [],
      safety: {
        harshBraking: safety.harshBraking || 0,
        rapidAcceleration: safety.rapidAcceleration || 0,
        sharpCornering: safety.sharpCornering || 0,
        speeding: safety.speeding || 0,
        excessiveIdle: safety.excessiveIdle || 0,
      },
      safetyScore,
      alerts,
      maintenanceDue: (truck.engineHours || 0) > 3500 || (truck.activeDTCs || []).length > 0,
    };
  }).sort((a, b) => b.safetyScore - a.safetyScore);
  res.json(overview);
});
// ============= REAL AI ANALYSIS (Google Gemini) =============

// ============================================================
// REPLACE your entire /api/ai-analysis with this
// ============================================================
app.post('/api/ai-analysis', verifyToken, async (req, res) => {
  try {
    const { trucks } = req.body;
    if (!trucks || trucks.length === 0) {
      return res.json({ analysis: 'No fleet data available to analyze.' });
    }

    // --- Build prompt (same as before) ---
    const fleetSummary = trucks.map(t => ({
      plate: t.licensePlate,
      speed: Math.round(t.speed),
      fuel: Math.round(t.fuel),
      temperature: Math.round(t.temperature),
      status: t.status,
    }));

    const critCount = trucks.filter(t => t.speed > 90 || t.temperature > 105 || t.fuel < 15).length;
    const speeders = trucks.filter(t => t.speed > 90).map(t => `${t.licensePlate} ${Math.round(t.speed)}mph`).join(', ');
    const overheating = trucks.filter(t => t.temperature > 105).map(t => `${t.licensePlate} ${Math.round(t.temperature)}°F`).join(', ');
    const lowFuel = trucks.filter(t => t.fuel < 15).map(t => `${t.licensePlate} ${Math.round(t.fuel)}%`).join(', ');

    const prompt = `You are a senior fleet operations manager for a logistics company in Riyadh, Saudi Arabia. Analyze this live truck telemetry and produce a CONCISE actionable briefing.

Fleet data:
${JSON.stringify(fleetSummary, null, 2)}

${speeders ? `SPEEDING: ${speeders}` : ''}
${overheating ? `OVERHEATING: ${overheating}` : ''}
${lowFuel ? `LOW FUEL: ${lowFuel}` : ''}

Respond ONLY in this exact format (no intro, no conclusion):

SITUATION: [1 sentence: fleet status right now]

CRITICAL (${critCount}):
• [Most urgent issue + specific truck plate + recommended action]
• [Second most urgent issue + action]
• [If no critical issues, write "All clear — fleet operating within safe parameters"]

COST RISK:
• [Estimated SAR cost if top issue unresolved — speeding fine, fuel stranding, engine damage]
• [One preventive action that saves the most money today]

NEXT ACTION: [Single most important thing manager should do right now, imperative sentence]`;


    // --- Try Groq (if API key is set), otherwise fallback to mock ---
    let analysis = null;
    const groqApiKey = process.env.GROQ_API_KEY;

    if (groqApiKey) {
      try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${groqApiKey}`
          },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.7,
            max_tokens: 600
          })
        });
        const data = await response.json();
        analysis = data.choices?.[0]?.message?.content;
      } catch (err) {
        console.warn('Groq API error, falling back to mock.');
      }
    }

    // --- Fallback: mock analysis (no API call) ---
    if (!analysis) {
      analysis = generateMockAnalysis(trucks);
    }

    res.json({ analysis });
  } catch (err) {
    console.error('AI analysis error:', err);
    // Always return something – use mock if anything fails
    const mock = generateMockAnalysis(req.body.trucks || []);
    res.json({ analysis: mock });
  }
});

// --- MOCK function (place it right after the route) ---
function generateMockAnalysis(trucks) {
  if (!trucks || trucks.length === 0) return 'No fleet data available.';
  
  const speeding = trucks.filter(t => t.speed > 70);
  const lowFuel = trucks.filter(t => t.fuel < 25);
  const highTemp = trucks.filter(t => t.temperature > 105);
  
  let report = `Fleet Status: ${trucks.length} trucks online. `;
  if (speeding.length + lowFuel.length + highTemp.length === 0) {
    report += 'All systems nominal. No critical issues detected.';
  } else {
    if (speeding.length) {
      report += `Speeding: ${speeding.map(t => t.licensePlate).join(', ')}. Recommend immediate speed reduction. `;
    }
    if (lowFuel.length) {
      report += `Low Fuel: ${lowFuel.map(t => t.licensePlate).join(', ')}. Reroute to nearest station. `;
    }
    if (highTemp.length) {
      report += `High Temperature: ${highTemp.map(t => t.licensePlate).join(', ')}. Check cooling system. `;
    }
    report += 'Estimated monthly cost impact: ~SAR 12,500 if unaddressed. Priority: Address speeding trucks immediately.';
  }
  return report;
}

// ============= AI CHAT (Groq — no API key required from user) =============

app.post('/api/chat', verifyToken, async (req, res) => {
  const { messages, systemPrompt } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array required' });
  }
  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) {
    return res.status(503).json({ error: 'AI service not configured' });
  }
  try {
    const groqMessages = systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...messages]
      : messages;
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqApiKey}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: groqMessages,
        temperature: 0.7,
        max_tokens: 1500,
      }),
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error?.message || 'Groq error' });
    res.json({ content: data.choices[0].message.content });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Chat service unavailable' });
  }
});

// ============= COPILOTKIT RUNTIME =============

if (process.env.GROQ_API_KEY) {
  app.use('/api/copilotkit', copilotRuntimeNodeExpressEndpoint({
    endpoint: '/api/copilotkit',
    runtime: new CopilotRuntime(),
    serviceAdapter: new GroqAdapter({
      apiKey: process.env.GROQ_API_KEY,
      model: 'llama-3.3-70b-versatile',
    }),
  }));
} else {
  // Without a key the GroqAdapter throws and takes the whole server down —
  // keep tracking online and answer chat requests with a clear error instead.
  app.use('/api/copilotkit', (req, res) => res.status(503).json({ error: 'AI chat disabled — GROQ_API_KEY not set in backend/.env' }));
  console.warn('⚠ GROQ_API_KEY not set — AI chat endpoint disabled, everything else runs normally.');
}

// ============= START SERVER =============

const PORT = 5000;
app.listen(PORT, () => {
  console.log(`â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—`);
  console.log(`â•‘  ðŸš› FLEET TRACKING BACKEND v2.0        â•‘`);
  console.log(`â•‘  http://localhost:${PORT}                 â•‘`);
  console.log(`â•‘  ðŸ“Š Trucks: ${trucks.size}                           â•‘`);
  console.log(`â•‘  ðŸ”§ Engine Health: ON                   â•‘`);
  console.log(`â•‘  ðŸ›¡ï¸  Driver Safety: ON                   â•‘`);
  console.log(`â•‘  ðŸ“ Route History: ON                   â•‘`);
  console.log(`â•‘  âš ï¸  DTC Codes: ON                       â•‘`);
  console.log(`â•‘  ðŸ¤– AI Analysis: ON                     â•‘`);
  console.log(`â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•\n`);
});



  