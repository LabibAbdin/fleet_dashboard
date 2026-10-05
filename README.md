# FleetPulse: AI Fleet Monitoring Dashboard

A full-stack web app for monitoring a fleet of trucks in real time: a live map, vehicle telemetry, safety alerts, analytics and an AI assistant that answers questions about the fleet.

> **Demo version.** The app runs on simulated data for a fleet of trucks around Riyadh. It contains no real company or customer data.

## Features

- **Live fleet map.** Every truck on an interactive map, with geofence zones and alerts when a truck leaves a zone.
- **Vehicle telemetry.** Speed, fuel, engine temperature, RPM, battery voltage, coolant temperature, oil pressure, engine hours and diagnostic trouble codes for each truck.
- **Safety alerts.** Speeding, harsh braking and driving-hours warnings, with a full alert log.
- **AI fleet assistant.** A chat assistant that reads live fleet data and answers questions, powered by Llama 3.3 70B on Groq through CopilotKit.
- **AI fleet briefing.** A generated summary of fleet issues and recommended actions, with a built-in fallback report when no AI key is set.
- **Analytics.** Cost analytics, emissions, trend charts and a driver leaderboard.
- **Operations tools.** Route playback, driver messaging, an emergency SOS view, notes and tags per truck, and a command palette.
- **Provider adapter.** Paste in any JSON telemetry feed and the app detects the vehicle records, maps the fields (location, speed, fuel and so on) and tracks those vehicles live.
- **Authentication.** Register and log in with bcrypt-hashed passwords and JWT tokens, plus a demo mode.

## Tech stack

| Part | Technologies |
| --- | --- |
| Dashboard (`fleet-app/`) | React 19, Vite, Tailwind CSS 4, shadcn/ui (Radix), React Leaflet, CopilotKit |
| API (`backend/`) | Node.js, Express 5, JSON Web Tokens, bcryptjs, Groq API (Llama 3.3 70B), CopilotKit runtime |
| First version (`frontend/`) | Create React App, Recharts, Axios, React Leaflet |

## Project structure

```
fleet-app/   Main dashboard (React + Vite)
backend/     REST API with simulated fleet data (Express)
frontend/    First version of the dashboard (Create React App)
```

## Running it locally

You need Node.js 20 or later.

**1. Start the API**

```bash
cd backend
npm install
```

Create a file called `.env` in the `backend` folder:

```
JWT_SECRET=any_long_random_text
GROQ_API_KEY=your_groq_api_key
```

`GROQ_API_KEY` is optional. Without it, the AI chat is turned off and the fleet briefing uses the built-in fallback report. You can get a free key at [console.groq.com](https://console.groq.com).

```bash
npm start
```

The API runs at `http://localhost:5000`.

**2. Start the dashboard**

In a second terminal:

```bash
cd fleet-app
npm install
npm run dev
```

Open the address Vite prints (usually `http://localhost:5173`), then click **Enter Demo Mode**, or log in with username `driver1` and password `password123`.

## API overview

| Endpoint | What it does |
| --- | --- |
| `POST /api/auth/register`, `POST /api/auth/login` | Create an account and log in (returns a JWT) |
| `GET /api/trucks`, `GET /api/trucks/:id` | All trucks, or one truck |
| `GET /api/truck-telemetry/:id` | Live telemetry for one truck |
| `GET /api/truck-route/:id`, `GET /api/truck-safety/:id` | Route history and safety events |
| `GET /api/fleet-overview`, `GET /api/fleet-stats` | Fleet-wide summary and statistics |
| `POST /api/ai-analysis` | AI fleet briefing |
| `POST /api/chat` | AI assistant chat |
| `GET /api/health` | Health check |

All endpoints except login, register and health need a `Bearer` token.

## Author

Labib Abdin, Computer Science student at Brunel University of London.
