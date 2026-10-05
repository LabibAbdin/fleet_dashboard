import React, { useMemo } from 'react';

// =============================================================
// COST & SAVINGS COMMAND CENTER  (Saudi Riyal / SAR)
// Turns live fleet data into money: monthly waste, where it goes,
// system ROI, and the single top priority to fix.
//
// HOW IT WORKS (explain this in interviews):
//   1. Receives the live `trucks` array.
//   2. For each truck, detects costly behaviours (speeding, low fuel,
//      overheating, idling) and assigns each a monthly SAR cost.
//   3. Sums them into a fleet-wide waste figure.
//   4. Compares that waste to the system's running cost to show ROI
//      ("pays for itself in X days").
//   5. Surfaces the single highest-cost fix as the top priority.
// =============================================================

// --- Cost model (the "business knowledge"), in SAR per month per truck ---
const MONTHLY_COST = {
  speeding: 1100,   // extra fuel burn + tyre wear + fine risk
  lowFuel: 450,     // emergency refuels + downtime
  overheat: 1550,   // accelerated engine wear / breakdown risk
  idle: 700,        // wasted fuel while stationary
};

// What the tracking system itself costs to run, per month (SAR).
const SYSTEM_COST_PER_MONTH = 1000;

function computeCosts(trucks) {
  const breakdown = { speeding: 0, lowFuel: 0, overheat: 0, idle: 0 };
  let topIssue = null;

  const consider = (candidate) => {
    if (!topIssue || candidate.cost > topIssue.cost) topIssue = candidate;
  };

  trucks.forEach((t) => {
    const speed = t.speed ?? 0;
    const fuel = t.fuel ?? 100;
    const temp = t.temperature ?? 90;
    const plate = t.licensePlate || t.id;

    if (speed > 70) {
      breakdown.speeding += MONTHLY_COST.speeding;
      consider({ plate, label: 'Speeding', cost: MONTHLY_COST.speeding,
        action: `Slow ${plate} to 65 mph to cut fuel burn and fine risk.` });
    }
    if (fuel < 20) {
      breakdown.lowFuel += MONTHLY_COST.lowFuel;
      consider({ plate, label: 'Low fuel', cost: MONTHLY_COST.lowFuel,
        action: `Refuel ${plate} now to avoid an emergency stop.` });
    }
    if (temp > 110) {
      breakdown.overheat += MONTHLY_COST.overheat;
      consider({ plate, label: 'Overheating', cost: MONTHLY_COST.overheat,
        action: `Service ${plate}'s cooling system before it fails.` });
    }
    if (t.status === 'idle' && speed < 5) {
      breakdown.idle += MONTHLY_COST.idle;
      consider({ plate, label: 'Idling', cost: MONTHLY_COST.idle,
        action: `Check why ${plate} is idling — it's burning fuel for nothing.` });
    }
  });

  const totalWaste =
    breakdown.speeding + breakdown.lowFuel + breakdown.overheat + breakdown.idle;

  const netSaving = Math.max(0, totalWaste - SYSTEM_COST_PER_MONTH);

  let paybackDays = null;
  if (totalWaste > 0) {
    const dailyWaste = totalWaste / 30;
    paybackDays = Math.max(1, Math.round(SYSTEM_COST_PER_MONTH / dailyWaste));
  }

  return { breakdown, totalWaste, netSaving, paybackDays, topIssue };
}

const CostCenter = ({ trucks = [], darkMode = false }) => {
  const data = useMemo(() => computeCosts(trucks), [trucks]);

  const cardBg = darkMode ? '#2a2a2a' : '#ffffff';
  const textColor = darkMode ? '#f5f5f5' : '#1a1a1a';
  const subColor = darkMode ? '#9aa0a6' : '#5f6368';
  const borderColor = darkMode ? '#3c4043' : '#e0e0e0';
  const panelBg = darkMode ? '#1f1f1f' : '#fafafa';

  // Format as Saudi Riyal, e.g. "SAR 1,100"
  const fmt = (n) => 'SAR ' + Math.round(n).toLocaleString();

  const breakdownRows = [
    { key: 'speeding', label: 'Speeding', color: '#e53935' },
    { key: 'overheat', label: 'Overheating', color: '#fb8c00' },
    { key: 'lowFuel', label: 'Low fuel', color: '#fbc02d' },
    { key: 'idle', label: 'Idling', color: '#8e24aa' },
  ];

  const maxRow = Math.max(...breakdownRows.map(r => data.breakdown[r.key]), 1);

  return (
    <div style={{
      backgroundColor: cardBg,
      border: `1px solid ${borderColor}`,
      borderRadius: '12px',
      padding: '24px',
      marginTop: '20px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
        <span style={{ fontSize: '22px' }}>💰</span>
        <h2 style={{ margin: 0, color: textColor, fontSize: '20px', letterSpacing: '-0.3px' }}>
          Cost & Savings Command Center
        </h2>
      </div>
      <p style={{ margin: '0 0 20px 0', color: subColor, fontSize: '14px' }}>
        Live view of what poor fleet performance is costing you.
      </p>

      {/* The money headline */}
      <div style={{
        padding: '20px',
        borderRadius: '10px',
        backgroundColor: data.totalWaste > 0 ? '#e5393515' : '#43a04715',
        border: `1px solid ${data.totalWaste > 0 ? '#e5393540' : '#43a04740'}`,
        marginBottom: '20px',
      }}>
        <div style={{ fontSize: '13px', color: subColor, marginBottom: '4px' }}>
          Estimated monthly waste, right now
        </div>
        <div style={{ fontSize: '38px', fontWeight: 800, color: data.totalWaste > 0 ? '#e53935' : '#43a047', lineHeight: 1.1 }}>
          {fmt(data.totalWaste)}<span style={{ fontSize: '16px', fontWeight: 500, color: subColor }}> /month</span>
        </div>
      </div>

      {/* Where the money goes */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: textColor, marginBottom: '10px' }}>
          Where it's going
        </div>
        {breakdownRows.map((r) => {
          const val = data.breakdown[r.key];
          return (
            <div key={r.key} style={{ marginBottom: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: textColor, marginBottom: '4px' }}>
                <span>{r.label}</span>
                <span style={{ fontWeight: 600 }}>{fmt(val)}/mo</span>
              </div>
              <div style={{ height: '8px', borderRadius: '4px', backgroundColor: panelBg, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${(val / maxRow) * 100}%`,
                  backgroundColor: r.color,
                  transition: 'width 0.4s ease',
                }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* ROI line */}
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '20px' }}>
        <div style={{ flex: '1 1 140px', padding: '14px 16px', borderRadius: '10px', backgroundColor: panelBg }}>
          <div style={{ fontSize: '22px', fontWeight: 700, color: '#43a047' }}>{fmt(data.netSaving)}</div>
          <div style={{ fontSize: '12px', color: subColor, marginTop: '2px' }}>Net monthly saving after system cost ({fmt(SYSTEM_COST_PER_MONTH)})</div>
        </div>
        <div style={{ flex: '1 1 140px', padding: '14px 16px', borderRadius: '10px', backgroundColor: panelBg }}>
          <div style={{ fontSize: '22px', fontWeight: 700, color: textColor }}>
            {data.paybackDays ? `${data.paybackDays} day${data.paybackDays > 1 ? 's' : ''}` : '—'}
          </div>
          <div style={{ fontSize: '12px', color: subColor, marginTop: '2px' }}>System pays for itself in</div>
        </div>
      </div>

      {/* Top priority */}
      {data.topIssue ? (
        <div style={{
          padding: '16px 18px',
          borderRadius: '10px',
          backgroundColor: '#6200ea15',
          border: '1px solid #6200ea40',
        }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#6200ea', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
            Fix this first
          </div>
          <div style={{ fontSize: '14px', color: textColor, lineHeight: 1.5 }}>
            {data.topIssue.action}
          </div>
          <div style={{ fontSize: '12px', color: '#43a047', fontWeight: 600, marginTop: '6px' }}>
            Saves {fmt(data.topIssue.cost)}/month
          </div>
        </div>
      ) : (
        <div style={{
          padding: '16px 18px', borderRadius: '10px',
          backgroundColor: '#43a04715', border: '1px solid #43a04740',
          color: textColor, fontSize: '14px',
        }}>
          ✅ No waste detected right now — the fleet is running efficiently.
        </div>
      )}

      <p style={{ margin: '16px 0 0 0', color: subColor, fontSize: '11px', fontStyle: 'italic' }}>
        Estimates based on typical fleet cost models; figures update live as truck data changes.
      </p>
    </div>
  );
};

export default CostCenter;
