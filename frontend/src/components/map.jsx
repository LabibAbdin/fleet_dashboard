import React from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle } from 'react-leaflet';
import L from 'leaflet';

// Fix default marker icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
  iconUrl: require('leaflet/dist/images/marker-icon.png'),
  shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});

const Map = ({ trucks = [], selectedTruck, onSelectTruck }) => {
  const mapCenter = [24.7136, 46.6753]; // Riyadh

  const getTruckColor = (truck) => {
    if (truck.speed > 70) return '#FF0000'; // Red = Speeding
    if (truck.fuel < 25) return '#FF6600'; // Orange = Low fuel
    if (truck.status === 'active') return '#00AA00'; // Green = Active
    return '#999999'; // Gray = Inactive
  };

  const getTruckIcon = (truck) => {
    return L.divIcon({
      html: `
        <div style="
          background: ${getTruckColor(truck)};
          color: white;
          border-radius: 50%;
          width: 40px;
          height: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: bold;
          font-size: 16px;
          border: 3px solid white;
          box-shadow: 0 0 15px rgba(0,0,0,0.6);
          cursor: pointer;
          z-index: 400;
        ">
          🚛
        </div>
      `,
      iconSize: [40, 40],
      iconAnchor: [20, 20],
      popupAnchor: [0, -20]
    });
  };

  if (!trucks || trucks.length === 0) {
    return (
      <div style={{
        padding: '50px',
        textAlign: 'center',
        backgroundColor: '#f5f5f5',
        borderRadius: '8px',
        marginBottom: '20px'
      }}>
        <p>Loading trucks...</p>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: '20px' }}>
      {/* Map Container */}
      <div style={{ height: '500px', width: '100%', marginBottom: '10px', borderRadius: '8px', overflow: 'hidden', border: '1px solid #ddd' }}>
        <MapContainer
          center={mapCenter}
          zoom={11}
          style={{
            height: '100%',
            width: '100%'
          }}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; OpenStreetMap contributors'
          />

          {/* Render all trucks */}
          {trucks.map((truck) => (
            <React.Fragment key={truck.id}>
              {/* Truck Marker */}
              <Marker
                position={[truck.location.lat, truck.location.lng]}
                icon={getTruckIcon(truck)}
                eventHandlers={{
                  click: () => {
                    onSelectTruck(truck);
                  }
                }}
              >
                <Popup>
                  <div style={{ minWidth: '220px', fontSize: '13px' }}>
                    <h4 style={{ margin: '0 0 12px 0', color: '#333' }}>
                      {truck.licensePlate}
                    </h4>
                    <div style={{ marginBottom: '10px' }}>
                      <p style={{ margin: '5px 0' }}>
                        <strong>Speed:</strong> {truck.speed?.toFixed(1) || '0'} mph
                      </p>
                      <p style={{ margin: '5px 0' }}>
                        <strong>Fuel:</strong> {truck.fuel?.toFixed(1) || '0'}%
                      </p>
                      <p style={{ margin: '5px 0' }}>
                        <strong>Status:</strong> <span style={{ 
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: '3px',
                          backgroundColor: truck.status === 'active' ? '#4CAF50' : '#999',
                          color: 'white',
                          fontSize: '11px'
                        }}>
                          {truck.status}
                        </span>
                      </p>
                    </div>
                    <button
                      onClick={() => onSelectTruck(truck)}
                      style={{
                        width: '100%',
                        padding: '8px',
                        backgroundColor: '#6200ea',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontWeight: 'bold',
                        fontSize: '12px'
                      }}
                    >
                      View Details
                    </button>
                  </div>
                </Popup>
              </Marker>

              {/* Speeding warning circle */}
              {truck.speed > 70 && (
                <Circle
                  center={[truck.location.lat, truck.location.lng]}
                  radius={500}
                  pathOptions={{
                    color: '#FF0000',
                    fillColor: '#FF0000',
                    fillOpacity: 0.1,
                    weight: 2,
                    dashArray: '5, 5'
                  }}
                />
              )}
            </React.Fragment>
          ))}
        </MapContainer>
      </div>

      {/* Legend */}
      <div style={{
        padding: '15px',
        backgroundColor: '#f9f9f9',
        borderRadius: '8px',
        border: '1px solid #ddd',
        fontSize: '13px'
      }}>
        <p style={{ margin: '0 0 10px 0', fontWeight: 'bold', color: '#333' }}>📍 Map Legend:</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{
              display: 'inline-block',
              width: '20px',
              height: '20px',
              backgroundColor: '#00AA00',
              borderRadius: '50%',
              border: '2px solid white',
              boxShadow: '0 0 8px rgba(0,0,0,0.3)'
            }}></span>
            <span>Active Truck</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{
              display: 'inline-block',
              width: '20px',
              height: '20px',
              backgroundColor: '#FF0000',
              borderRadius: '50%',
              border: '2px solid white',
              boxShadow: '0 0 8px rgba(0,0,0,0.3)'
            }}></span>
            <span>Speeding (70+ mph)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{
              display: 'inline-block',
              width: '20px',
              height: '20px',
              backgroundColor: '#FF6600',
              borderRadius: '50%',
              border: '2px solid white',
              boxShadow: '0 0 8px rgba(0,0,0,0.3)'
            }}></span>
            <span>Low Fuel (&lt;25%)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{
              display: 'inline-block',
              width: '20px',
              height: '20px',
              backgroundColor: '#999999',
              borderRadius: '50%',
              border: '2px solid white',
              boxShadow: '0 0 8px rgba(0,0,0,0.3)'
            }}></span>
            <span>Inactive</span>
          </div>
        </div>
        <p style={{ margin: '10px 0 0 0', fontSize: '12px', color: '#666' }}>
          💡 Click any truck marker to select it and see details
        </p>
      </div>
    </div>
  );
};

export default Map;


