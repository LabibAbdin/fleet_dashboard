import React, { useMemo } from 'react';

// =============================================================
// AI FLEET ADVISOR
// Reads live fleet data and produces ranked, actionable advice.
// Rule-based (no API key, no cost, works offline).
// =============================================================

const COST = {
  speedingPerMonth: 220,
  lowFuelPerMonth: 90,
  overheatPerMonth: 310,
  idlePerMonth: 140,
};

function analyzeTruck(truck) {
  const issues = [];
  const speed = truck.speed ?? 0;
  const fuel = truck.fuel ?? 100;
  const temp = truck.temperature ?? 90;
  const plate = truck.licensePlate || truck.id;

  if (speed > 70) {
    issues.push({
      severity: 'critical',
      title: `${plate} is speeding (${speed.toFixed(0)} mph)`,
      action: `Coach the driver to hold 65 mph. Above 70 mph fuel burn climbs sharply and you risk fines.`,
      monthlyCost: COST.speedingPerMonth,
    });
  }

  if (temp > 110) {
    issues.push({
      severity: 'critical',
      title: `${plate} is overheating (${temp.toFixed(0)}°F)`,
      action: `Schedule a cooling-system check now. Running this hot risks an engine failure that costs far more than the inspection.`,
      monthlyCost: COST.overheatPerMonth,
    });
  } else if (temp > 100) {
    issues.push({
      severity: 'warning',
      title: `${plate} running warm (${temp.toFixed(0)}°F)`,
      action: `Keep an eye on coolant levels — temperature is trending above normal.`,
      monthlyCost: Math.round(COST.overheatPerMonth * 0.3),
    });
  }

  if (fuel < 20) {
    issues.push({
      severity: 'critical',
      title: `${plate} critically low on fuel (${fuel.toFixed(0)}%)`,
      action: `Route to the nearest station now to avoid a roadside stop and lost delivery time.`,
      monthlyCost: COST.lowFuelPerMonth,
    });
  } else if (fuel < 30) {
    issues.push({
      severity: 'warning',
      title: `${plate} fuel getting low (${fuel.toFixed(0)}%)`,
      action: `Plan a refuel within the next leg so it never drops into the danger zone.`,
      monthlyCost: Math.round(COST.lowFuelPerMonth * 0.4),
    });
  }

  if (truck.status === 'idle' && speed < 5) {
    issues.push({
      severity: 'warning',
      title: `${plate} is idle`,
      action: `Confirm this stop is planned. Unplanned idling wastes fuel and eats into delivery windows.`,
      monthlyCost: COST.idlePerMonth,
    });
  }

  if (issues.length === 0) {
    issues.push({
      severity: 'good',
      title: `${plate} is running clean`,
      action: `Speed, fuel and temperature are all in healthy ranges. No action needed.`,
      monthlyCost: 0,
    });
  }

  return issues;
}

function generateAdvice(trucks) {
  const all = trucks.flatMap(analyzeTruck);

  const order = { critical: 0, warning: 1, good: 2 };
  all.sort((a, b) => {
    if (order[a.severity] !== order[b.severity]) {
      return order[a.severity] - order[b.severity];
    }
    return b.monthlyCost - a.monthlyCost;
  });

  const totalWaste = all.reduce((sum, i) => sum + i.monthlyCost, 0);
  const criticalCount = all.filter(i => i.severity === 'critical').length;
  const cleanCount = all.filter(i => i.severity === 'good').length;

  let headline;
  if (criticalCount > 0) {
    headline = `${criticalCount} issue${criticalCount > 1 ? 's need' : ' needs'} attention now. Acting on them saves an estimated $${totalWaste.toLocaleString()}/month.`;
  } else if (totalWaste > 0) {
    headline = `Fleet is mostly healthy. Small fixes could still save about $${totalWaste.toLocaleString()}/month.`;
  } else {
    headline = `Every truck is running clean. No action needed right now.`;
  }

  return { items: all, totalWaste, criticalCount, cleanCount, headline };
}

const FleetAdvisor = ({ trucks = [], darkMode = false }) => {
  const advice = useMemo(() => generateAdvice(trucks), [trucks]);

  const cardBg = darkMode ? '#2a2a2a' : '#ffffff';
  const textColor = darkMode ? '#f5f5f5' : '#1a1a1a';
  const subColor = darkMode ? '#9aa0a6' : '#5f6368';
  const borderColor = darkMode ? '#3c4043' : '#e0e0e0';

  const severityStyle = {
    critical: { dot: '#e53935', tag: 'Act now', tagBg: '#e5393520', tagColor: '#e53935' },
    warning:  { dot: '#fb8c00', tag: 'Watch',   tagBg: '#fb8c0020', tagColor: '#fb8c00' },
    good:     { dot: '#43a047', tag: 'Healthy', tagBg: '#43a04720', tagColor: '#43a047' },
  };

  if (!trucks || trucks.length === 0) {
    return (
      <div style={{
        padding: '24px', backgroundColor: cardBg, color: subColor,
        border: `1px solid ${borderColor}`, borderRadius: '12px', marginTop: '20px'
      }}>
        No fleet data yet — the advisor will analyze trucks as they come online.
      </div>
    );
  }

  return (
    <div style={{
      backgroundColor: cardBg,
      border: `1px solid ${borderColor}`,
      borderRadius: '12px',
      padding: '24px',
      marginTop: '20px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
        <span style={{ fontSize: '22px' }}>🧠</span>
        <h2 style={{ margin: 0, color: textColor, fontSize: '20px', letterSpacing: '-0.3px' }}>
          AI Fleet Advisor
        </h2>
      </div>

      <p style={{ margin: '0 0 18px 0', color: subColor, fontSize: '14px', lineHeight: 1.5 }}>
        {advice.headline}
      </p>

      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <Stat label="Est. monthly waste" value={`$${advice.totalWaste.toLocaleString()}`} color="#e53935" sub={subColor} bg={darkMode ? '#1f1f1f' : '#f7f7f7'} />
        <Stat label="Need action" value={advice.criticalCount} color="#fb8c00" sub={subColor} bg={darkMode ? '#1f1f1f' : '#f7f7f7'} />
        <Stat label="Running clean" value={advice.cleanCount} color="#43a047" sub={subColor} bg={darkMode ? '#1f1f1f' : '#f7f7f7'} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {advice.items.map((item, i) => {
          const s = severityStyle[item.severity];
          return (
            <div key={i} style={{
              display: 'flex',
              gap: '12px',
              padding: '14px 16px',
              borderRadius: '10px',
              backgroundColor: darkMode ? '#1f1f1f' : '#fafafa',
              border: `1px solid ${borderColor}`,
            }}>
              <div style={{
                width: '10px', height: '10px', borderRadius: '50%',
                backgroundColor: s.dot, marginTop: '5px', flexShrink: 0,
              }} />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <span style={{ color: textColor, fontWeight: 600, fontSize: '14px' }}>
                    {item.title}
                  </span>
                  <span style={{
                    fontSize: '11px', fontWeight: 600, padding: '3px 9px',
                    borderRadius: '20px', backgroundColor: s.tagBg, color: s.tagColor,
                    whiteSpace: 'nowrap',
                  }}>
                    {s.tag}
                  </span>
                </div>
                <p style={{ margin: '5px 0 0 0', color: subColor, fontSize: '13px', lineHeight: 1.5 }}>
                  {item.action}
                </p>
                {item.monthlyCost > 0 && (
                  <p style={{ margin: '6px 0 0 0', color: s.dot, fontSize: '12px', fontWeight: 600 }}>
                    ~${item.monthlyCost.toLocaleString()}/month at stake
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p style={{ margin: '16px 0 0 0', color: subColor, fontSize: '11px', fontStyle: 'italic' }}>
        Estimates are based on typical fleet cost models and update live as truck data changes.
      </p>
    </div>
  );
};

function Stat({ label, value, color, sub, bg }) {
  return (
    <div style={{
      flex: '1 1 120px',
      padding: '14px 16px',
      borderRadius: '10px',
      backgroundColor: bg,
    }}>
      <div style={{ fontSize: '22px', fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: '12px', color: sub, marginTop: '2px' }}>{label}</div>
    </div>
  );
}

export default FleetAdvisor;