import React, { useState, useEffect, useMemo } from 'react';

// =============================================================
// TRUCK HEALTH & TRENDS ANALYZER
//
// HOW IT WORKS (explain this in interviews):
//   1. Every time trucks data updates (every 2 seconds), this
//      component records the data into a history buffer per truck.
//   2. With enough history, it calculates TRENDS:
//      - fuel burn rate (how fast fuel is dropping)
//      - temperature trend (rising, stable, falling)
//      - speed volatility (erratic driving detection)
//      - idle time ratio
//   3. It detects ANOMALIES by comparing current behaviour to
//      the truck's own baseline (e.g., fuel burning 30% faster
//      than its average = anomaly).
//   4. For each anomaly, it generates a root-cause hypothesis
//      and a specific action recommendation.
//
//   This is the difference between a dashboard that shows "fuel
//   is 45%" and a system that says "fuel consumption jumped 35%
//   in the last 20 minutes — likely aggressive acceleration —
//   coach the driver." That's what "actionable AI" means.
// =============================================================

// --- How many data points to keep per truck ---
const MAX_HISTORY = 60; // ~2 minutes at 2-second intervals

// --- Thresholds for anomaly detection ---
const THRESHOLDS = {
  fuelBurnRateHigh: 1.5,      // fuel dropping 1.5x faster than baseline
  fuelBurnRateCritical: 2.5,  // fuel dropping 2.5x faster than baseline
  tempRisingFast: 0.5,        // degrees per reading, sustained
  tempDanger: 108,             // absolute temp danger zone
  speedVolatilityHigh: 12,    // std deviation of speed readings
  idleRatioHigh: 0.4,         // idle more than 40% of readings
};

// --- Cost estimates per issue (SAR/month) ---
const COST_IMPACT = {
  highFuelBurn: 950,
  criticalFuelBurn: 1800,
  risingTemp: 1200,
  dangerTemp: 2400,
  erraticDriving: 650,
  excessiveIdle: 700,
};

function calcMean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function calcStdDev(arr) {
  if (arr.length < 2) return 0;
  const mean = calcMean(arr);
  const sq = arr.map(v => (v - mean) ** 2);
  return Math.sqrt(sq.reduce((a, b) => a + b, 0) / arr.length);
}

function calcTrendSlope(arr) {
  // Simple linear regression slope
  if (arr.length < 3) return 0;
  const n = arr.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  arr.forEach((y, x) => {
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  });
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

function analyzeTruckTrends(plate, history) {
  const findings = [];
  if (history.length < 5) return findings; // need minimum data

  const fuels = history.map(h => h.fuel);
  const temps = history.map(h => h.temp);
  const speeds = history.map(h => h.speed);
  const statuses = history.map(h => h.status);

  // --- Fuel burn rate analysis ---
  const fuelSlope = calcTrendSlope(fuels); // negative = fuel dropping
  const avgFuelDrop = fuels.length > 1
    ? (fuels[0] - fuels[fuels.length - 1]) / fuels.length
    : 0;

  // Compare recent burn rate to baseline
  const recentFuels = fuels.slice(-10);
  const baselineFuels = fuels.slice(0, Math.max(5, Math.floor(fuels.length / 2)));
  const recentBurnRate = recentFuels.length > 1
    ? Math.max(0, recentFuels[0] - recentFuels[recentFuels.length - 1]) / recentFuels.length
    : 0;
  const baselineBurnRate = baselineFuels.length > 1
    ? Math.max(0, baselineFuels[0] - baselineFuels[baselineFuels.length - 1]) / baselineFuels.length
    : 0;

  const burnRatio = baselineBurnRate > 0.01 ? recentBurnRate / baselineBurnRate : 1;

  if (burnRatio >= THRESHOLDS.fuelBurnRateCritical && recentBurnRate > 0.05) {
    findings.push({
      severity: 'critical',
      category: 'Fuel',
      title: `${plate} — fuel consumption spiking`,
      detail: `Fuel burn rate is ${burnRatio.toFixed(1)}x higher than this truck's baseline. Current rate: ${(recentBurnRate * 30).toFixed(1)}% per minute.`,
      cause: 'Likely causes: aggressive acceleration, heavy load, engine fault, or driving into headwind.',
      action: `Check ${plate}'s driving pattern immediately. If speed is normal, schedule an engine diagnostics check.`,
      cost: COST_IMPACT.criticalFuelBurn,
      confidence: fuels.length > 20 ? 'High' : 'Medium',
    });
  } else if (burnRatio >= THRESHOLDS.fuelBurnRateHigh && recentBurnRate > 0.03) {
    findings.push({
      severity: 'warning',
      category: 'Fuel',
      title: `${plate} — fuel consumption above normal`,
      detail: `Fuel burn rate is ${burnRatio.toFixed(1)}x higher than baseline. This adds up over a full day.`,
      cause: 'Likely causes: slightly aggressive driving, suboptimal route, or tyre pressure.',
      action: `Coach ${plate}'s driver on smooth acceleration. Check tyre pressure at next stop.`,
      cost: COST_IMPACT.highFuelBurn,
      confidence: fuels.length > 15 ? 'High' : 'Medium',
    });
  }

  // --- Temperature trend analysis ---
  const tempSlope = calcTrendSlope(temps);
  const currentTemp = temps[temps.length - 1];
  const recentTemps = temps.slice(-10);
  const tempTrend = recentTemps.length > 2 ? calcTrendSlope(recentTemps) : 0;

  if (currentTemp > THRESHOLDS.tempDanger && tempTrend > 0) {
    findings.push({
      severity: 'critical',
      category: 'Engine',
      title: `${plate} — temperature rising into danger zone`,
      detail: `Engine at ${currentTemp.toFixed(0)}°F and still climbing (+${(tempTrend * 30).toFixed(1)}°F/min). Risk of breakdown.`,
      cause: 'Likely causes: coolant leak, radiator blockage, thermostat failure, or prolonged heavy load.',
      action: `Pull ${plate} over for inspection if temperature exceeds 115°F. Schedule cooling system service immediately.`,
      cost: COST_IMPACT.dangerTemp,
      confidence: 'High',
    });
  } else if (tempTrend > THRESHOLDS.tempRisingFast) {
    const minsToWarning = currentTemp < THRESHOLDS.tempDanger
      ? ((THRESHOLDS.tempDanger - currentTemp) / (tempTrend * 30)).toFixed(0)
      : 0;
    findings.push({
      severity: 'warning',
      category: 'Engine',
      title: `${plate} — temperature trending upward`,
      detail: `Engine temp rising at +${(tempTrend * 30).toFixed(1)}°F/min. At this rate, reaches danger zone in ~${minsToWarning} minutes.`,
      cause: 'Likely causes: heavy load, hot weather, or early cooling system issue.',
      action: `Monitor ${plate} closely. If trend continues for 10 more minutes, schedule a cooling check.`,
      cost: COST_IMPACT.risingTemp,
      confidence: temps.length > 15 ? 'High' : 'Medium',
    });
  }

  // --- Speed volatility (erratic driving) ---
  const speedStdDev = calcStdDev(speeds);
  const avgSpeed = calcMean(speeds);

  if (speedStdDev > THRESHOLDS.speedVolatilityHigh && avgSpeed > 20) {
    findings.push({
      severity: 'warning',
      category: 'Driving',
      title: `${plate} — erratic speed pattern detected`,
      detail: `Speed varies by ±${speedStdDev.toFixed(0)} mph around ${avgSpeed.toFixed(0)} mph average. This suggests frequent hard acceleration and braking.`,
      cause: 'Likely causes: congested route, aggressive driver behaviour, or frequent stops.',
      action: `Review ${plate}'s route. If the route is clear, coach the driver on maintaining steady speed — it cuts fuel waste by 15-20%.`,
      cost: COST_IMPACT.erraticDriving,
      confidence: speeds.length > 15 ? 'High' : 'Medium',
    });
  }

  // --- Idle time analysis ---
  const idleCount = statuses.filter(s => s === 'idle').length;
  const idleRatio = idleCount / statuses.length;

  if (idleRatio > THRESHOLDS.idleRatioHigh && statuses.length > 10) {
    findings.push({
      severity: 'warning',
      category: 'Utilisation',
      title: `${plate} — excessive idle time`,
      detail: `Idle ${(idleRatio * 100).toFixed(0)}% of tracked time. Every hour of idling wastes roughly 3-4 litres of diesel.`,
      cause: 'Likely causes: waiting for loading/unloading, traffic, driver resting with engine on.',
      action: `Investigate why ${plate} is stationary so often. Implement an anti-idle policy (engine off after 5 min).`,
      cost: COST_IMPACT.excessiveIdle,
      confidence: 'High',
    });
  }

  // --- Healthy truck ---
  if (findings.length === 0 && history.length > 10) {
    findings.push({
      severity: 'good',
      category: 'Overall',
      title: `${plate} — running healthy`,
      detail: 'Fuel consumption, temperature, and driving patterns are all within normal ranges.',
      cause: '',
      action: 'No action needed. Continue monitoring.',
      cost: 0,
      confidence: 'High',
    });
  }

  return findings;
}

const TruckHealthAnalyzer = ({ trucks = [], darkMode = false }) => {
  const [truckHistory, setTruckHistory] = useState({});

  // Record truck data into history every time trucks update
  useEffect(() => {
    if (!trucks || trucks.length === 0) return;

    setTruckHistory(prev => {
      const next = { ...prev };
      trucks.forEach(t => {
        const plate = t.licensePlate || t.id;
        if (!next[plate]) next[plate] = [];
        next[plate] = [
          ...next[plate].slice(-(MAX_HISTORY - 1)),
          {
            time: Date.now(),
            fuel: t.fuel ?? 100,
            temp: t.temperature ?? 90,
            speed: t.speed ?? 0,
            status: t.status ?? 'unknown',
          }
        ];
      });
      return next;
    });
  }, [trucks]);

  const allFindings = useMemo(() => {
    const results = [];
    Object.entries(truckHistory).forEach(([plate, history]) => {
      results.push(...analyzeTruckTrends(plate, history));
    });

    const order = { critical: 0, warning: 1, good: 2 };
    results.sort((a, b) => {
      if (order[a.severity] !== order[b.severity]) return order[a.severity] - order[b.severity];
      return b.cost - a.cost;
    });

    return results;
  }, [truckHistory]);

  const totalRisk = allFindings.reduce((sum, f) => sum + f.cost, 0);
  const criticalCount = allFindings.filter(f => f.severity === 'critical').length;
  const dataPoints = Object.values(truckHistory).reduce((sum, h) => sum + h.length, 0);

  const cardBg = darkMode ? '#2a2a2a' : '#ffffff';
  const textColor = darkMode ? '#f5f5f5' : '#1a1a1a';
  const subColor = darkMode ? '#9aa0a6' : '#5f6368';
  const borderColor = darkMode ? '#3c4043' : '#e0e0e0';
  const panelBg = darkMode ? '#1f1f1f' : '#fafafa';

  const severityStyle = {
    critical: { dot: '#e53935', tag: 'Critical', tagBg: '#e5393520' },
    warning:  { dot: '#fb8c00', tag: 'Watch',    tagBg: '#fb8c0020' },
    good:     { dot: '#43a047', tag: 'Healthy',  tagBg: '#43a04720' },
  };

  const fmt = (n) => 'SAR ' + Math.round(n).toLocaleString();

  return (
    <div style={{
      backgroundColor: cardBg,
      border: `1px solid ${borderColor}`,
      borderRadius: '12px',
      padding: '24px',
      marginTop: '20px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
        <span style={{ fontSize: '22px' }}>🔬</span>
        <h2 style={{ margin: 0, color: textColor, fontSize: '20px', letterSpacing: '-0.3px' }}>
          Truck Health & Trends Analyzer
        </h2>
      </div>
      <p style={{ margin: '0 0 18px 0', color: subColor, fontSize: '14px', lineHeight: 1.5 }}>
        Tracks each truck over time to detect anomalies, predict issues, and recommend actions.
        {dataPoints < 30 && (
          <span style={{ color: '#fb8c00', fontWeight: 600 }}>
            {' '}Collecting data — analysis improves as more readings come in ({dataPoints} points so far).
          </span>
        )}
      </p>

      {/* Summary stats */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 120px', padding: '14px 16px', borderRadius: '10px', backgroundColor: panelBg }}>
          <div style={{ fontSize: '22px', fontWeight: 700, color: '#e53935' }}>{fmt(totalRisk)}</div>
          <div style={{ fontSize: '12px', color: subColor, marginTop: '2px' }}>Monthly risk from detected trends</div>
        </div>
        <div style={{ flex: '1 1 120px', padding: '14px 16px', borderRadius: '10px', backgroundColor: panelBg }}>
          <div style={{ fontSize: '22px', fontWeight: 700, color: criticalCount > 0 ? '#e53935' : '#43a047' }}>{criticalCount}</div>
          <div style={{ fontSize: '12px', color: subColor, marginTop: '2px' }}>Critical trends detected</div>
        </div>
        <div style={{ flex: '1 1 120px', padding: '14px 16px', borderRadius: '10px', backgroundColor: panelBg }}>
          <div style={{ fontSize: '22px', fontWeight: 700, color: textColor }}>{dataPoints}</div>
          <div style={{ fontSize: '12px', color: subColor, marginTop: '2px' }}>Data points collected</div>
        </div>
      </div>

      {/* Findings list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {allFindings.length === 0 && (
          <div style={{ padding: '16px', borderRadius: '10px', backgroundColor: panelBg, color: subColor, fontSize: '14px' }}>
            Collecting initial data — trends will appear after ~10 seconds of monitoring.
          </div>
        )}

        {allFindings.map((f, i) => {
          const s = severityStyle[f.severity];
          return (
            <div key={i} style={{
              padding: '16px 18px',
              borderRadius: '10px',
              backgroundColor: panelBg,
              border: `1px solid ${borderColor}`,
            }}>
              {/* Header row */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: s.dot }} />
                  <span style={{ color: textColor, fontWeight: 600, fontSize: '14px' }}>{f.title}</span>
                </div>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <span style={{
                    fontSize: '11px', fontWeight: 600, padding: '3px 9px',
                    borderRadius: '20px', backgroundColor: s.tagBg, color: s.dot,
                  }}>{s.tag}</span>
                  {f.confidence && (
                    <span style={{
                      fontSize: '10px', fontWeight: 600, padding: '3px 8px',
                      borderRadius: '20px', backgroundColor: darkMode ? '#333' : '#eee', color: subColor,
                    }}>{f.confidence} confidence</span>
                  )}
                </div>
              </div>

              {/* Detail */}
              <p style={{ margin: '0 0 6px 18px', color: textColor, fontSize: '13px', lineHeight: 1.5 }}>
                {f.detail}
              </p>

              {/* Cause */}
              {f.cause && (
                <p style={{ margin: '0 0 6px 18px', color: subColor, fontSize: '12px', lineHeight: 1.5, fontStyle: 'italic' }}>
                  {f.cause}
                </p>
              )}

              {/* Action */}
              <div style={{
                margin: '8px 0 0 18px',
                padding: '10px 14px',
                borderRadius: '8px',
                backgroundColor: '#6200ea10',
                borderLeft: '3px solid #6200ea',
              }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#6200ea', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '3px' }}>
                  Recommended action
                </div>
                <div style={{ fontSize: '13px', color: textColor, lineHeight: 1.5 }}>
                  {f.action}
                </div>
              </div>

              {/* Cost */}
              {f.cost > 0 && (
                <p style={{ margin: '8px 0 0 18px', fontSize: '12px', fontWeight: 600, color: s.dot }}>
                  ~{fmt(f.cost)}/month at stake if unaddressed
                </p>
              )}
            </div>
          );
        })}
      </div>

      <p style={{ margin: '16px 0 0 0', color: subColor, fontSize: '11px', fontStyle: 'italic' }}>
        Analysis is based on trend detection across {dataPoints} data points. Confidence increases as more data is collected.
      </p>
    </div>
  );
};

export default TruckHealthAnalyzer;
