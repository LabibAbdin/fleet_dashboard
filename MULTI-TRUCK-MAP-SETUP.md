# 📍 MULTI-TRUCK MAP - SETUP GUIDE

## What You Get

✅ **Map showing all trucks at once** with color-coded status indicators  
✅ **Real-time updates** - positions update every 5 seconds  
✅ **Truck list sidebar** - click any truck to see details  
✅ **Dashboard with stats** - overview of fleet at a glance  
✅ **Interactive popups** - click markers to see truck info  
✅ **Responsive design** - works on mobile and desktop  

---

## 🚀 Quick Setup (5 minutes)

### Step 1: Copy the Map Component (Already Done)
The updated `map.jsx` is in `frontend/src/components/map.jsx`
- Now accepts an array of trucks instead of one
- Creates multiple markers with color coding
- Auto-fits all trucks in viewport

### Step 2: Copy Dashboard Files

**Option A - Manual Copy:**
```bash
# Copy the DashboardPage component
cp STEP-5-DashboardPage.jsx frontend/src/pages/DashboardPage.jsx

# Copy the styles
cp STEP-5-DashboardPage.css frontend/src/pages/DashboardPage.css
```

**Option B - Copy Paste:**
1. Open `STEP-5-DashboardPage.jsx`
2. Copy all content
3. Create `frontend/src/pages/DashboardPage.jsx`
4. Paste content

Same for CSS file.

### Step 3: Update App.jsx

Edit `frontend/src/App.jsx` and add DashboardPage import at top:

```javascript
import DashboardPage from './pages/DashboardPage';
```

Then add this to the switch statement (around line 153):

```javascript
case 'dashboard':
  return (
    <DashboardPage 
      user={user}
      onLogout={handleLogout}
    />
  );
```

### Step 4: Make Sure Backend is Running

```bash
# Terminal 1: Start backend
cd backend
node server.js
```

You should see:
```
🚛 FLEET TRACKING BACKEND
Running on: http://localhost:5000
```

### Step 5: Start Frontend

```bash
# Terminal 2: Start frontend
cd frontend
npm start
```

Should open `http://localhost:3000` automatically

---

## 🧪 Test It

1. **Login** with:
   - Username: `driver1`
   - Password: `password123`

2. **Skip or complete onboarding** (should go to dashboard)

3. **See the map** with all 5 trucks displayed:
   - ABC-123 (center)
   - XYZ-789 (north)
   - DEF-456 (south)
   - GHI-321 (west)
   - JKL-654 (east)

4. **Click a truck** in the sidebar to see details

5. **Watch it update** - positions change every 5 seconds (simulated)

---

## 📊 What's on the Dashboard

### Top Section - Stats Cards
- Total Trucks
- Active Trucks  
- Average Speed
- Total Miles

### Main Map
- All trucks visible
- Green circle = Active
- Orange circle = Idle
- Click marker for popup with:
  - License plate
  - Status
  - Speed
  - Fuel
  - Temperature

### Right Sidebar - Truck List
- Scrollable list of all trucks
- Click to select and see details
- Fuel bar showing level
- Real-time speed/temp/status

### Bottom Section - Truck Details
- Shows when you click a truck
- Location coordinates
- All telemetry data
- Speed, fuel, RPM, temperature

---

## 🎨 Customization Ideas

### Change Update Speed
In `DashboardPage.jsx`, line 34:
```javascript
const interval = setInterval(fetchTrucks, 5000); // Change 5000 to milliseconds
```

### Change Map Colors
In `map.jsx`, update `getIconForStatus` function:
```javascript
const colors = {
  active: '#4CAF50',      // Change to any color
  idle: '#FF9800',        // Orange
  inactive: '#999999',    // Gray
  maintenance: '#F44336'  // Red
};
```

### Add More Trucks
In `backend/server.js`, add to `truckData` array (around line 109):
```javascript
{ id: 'truck6', plate: 'NEW-666', lat: 24.75, lng: 46.68, status: 'active' }
```

### Change Refresh Speed
In `backend/server.js`, modify telemetry endpoint (line 156):
```javascript
truck.location.lat += (Math.random() - 0.5) * 0.02; // Increase movement
```

---

## 🐛 Troubleshooting

### "Cannot GET /api/trucks"
- Backend not running
- Make sure `node server.js` is running in backend folder

### Map not showing
- Check browser console (F12)
- Make sure leaflet CSS is imported (already done)
- Try refreshing page

### Trucks not updating
- Check Network tab in DevTools
- Verify 5-second refresh is happening
- Backend telemetry endpoint might be failing

### Styling looks wrong
- Make sure CSS file is copied correctly
- Check file path is `frontend/src/pages/DashboardPage.css`
- Try: `npm start` (clear cache)

---

## 📚 File Organization

After setup, your structure should be:
```
frontend/src/
├── App.jsx ✓ (Updated with DashboardPage import)
├── App.css
├── pages/
│   ├── LoginPage.jsx
│   ├── LoginPage.css
│   ├── OnboardingPage.jsx
│   ├── OnboardingPage.css
│   ├── DashboardPage.jsx ✓ (NEW)
│   └── DashboardPage.css ✓ (NEW)
└── components/
    └── map.jsx ✓ (UPDATED - multiple trucks)
```

---

## 🎯 Next Steps

1. **Add real database** - Replace in-memory Map() with MongoDB/PostgreSQL
2. **Real GPS tracking** - Integrate actual GPS data instead of simulation
3. **Event alerts** - Show notifications when trucks brake hard, speed, etc.
4. **Driver info** - Show which driver is in each truck
5. **Route planning** - Plan and assign routes to trucks
6. **Historical data** - Track and visualize past truck movements
7. **Mobile app** - React Native version

---

## 💡 How It Works

### Data Flow:
```
Backend (server.js)
  ↓
  └─ /api/trucks → Returns array of all trucks
      ├─ id, licensePlate, status
      ├─ location: {lat, lng}
      ├─ speed, fuel, temperature, rpm

Frontend (DashboardPage.jsx)
  ↓
  └─ Fetches /api/trucks every 5 seconds
      ├─ Passes trucks array to Map component
      ├─ Displays in list sidebar
      ├─ Shows stats

Map Component (map.jsx)
  ↓
  └─ Receives trucks array
      ├─ Creates marker for each truck
      ├─ Colors by status (green=active, orange=idle)
      ├─ Fits all markers in viewport
      ├─ Updates positions on refresh
```

---

**You now have a fully functional multi-truck map! 🚀**

For questions or issues, check the console (F12) for error messages.
