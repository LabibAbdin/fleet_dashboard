import { useState } from 'react'
import Drawer from './Drawer.jsx'
import {
  analyzeFeed, adaptRecord, fetchFeed, MAPPABLE_FIELDS, REQUIRED_FIELDS, SAMPLE_FEED_URL,
} from '../lib/providerAdapter.js'

// ── AI Provider Connect ───────────────────────────────────────────────────────
// Paste any telemetry API link → the analyzer fetches a sample, finds the
// vehicle array, classifies every field, and proposes a mapping you can adjust
// before connecting it as a live data source.

const FIELD_LABELS = {
  lat: 'Latitude *', lng: 'Longitude *', id: 'Vehicle ID', plate: 'Plate / Reg',
  name: 'Unit name', driver: 'Driver', speed: 'Speed', fuel: 'Fuel level',
  heading: 'Heading', temp: 'Engine temp', weight: 'Weight / Payload',
  odometer: 'Odometer', status: 'Status / Ignition', time: 'Timestamp',
}

export default function ProviderConnectDrawer({ providers, providerStatus, onAddProvider, onRemoveProvider, onTogglePause, onClose }) {
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [interval, setIntervalSec] = useState(10)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null) // { records, recordPath, mapping, confidence, flatKeys }

  const analyze = async (targetUrl) => {
    const u = (targetUrl || url).trim()
    if (!u) { setError('Paste a provider API link first.'); return }
    setAnalyzing(true); setError(''); setResult(null)
    try {
      const json = await fetchFeed(u)
      const a = analyzeFeed(json)
      if (!a.records) { setError(a.error); setAnalyzing(false); return }
      setResult({ ...a, url: u })
      if (a.error) setError(a.error)
      if (!name) {
        try { setName(u === SAMPLE_FEED_URL ? 'Demo Provider' : new URL(u).hostname.replace(/^www\./, '')) }
        catch { setName('External Provider') }
      }
    } catch (e) {
      setError(`Could not analyze feed: ${e.message}. If this is a CORS error, the provider must allow browser requests (or route it through your backend).`)
    }
    setAnalyzing(false)
  }

  const setFieldPath = (field, path) => {
    setResult(r => ({
      ...r,
      mapping: { ...r.mapping, [field]: path || undefined },
      confidence: { ...r.confidence, [field]: path ? 1 : 0 }, // manual choice = certain
    }))
  }

  const preview = result
    ? result.records.slice(0, 5).map((rec, i) => adaptRecord(rec, result.mapping, 'preview', i)).filter(Boolean)
    : []
  const canConnect = result && REQUIRED_FIELDS.every(f => result.mapping[f]) && preview.length > 0

  const connect = () => {
    onAddProvider({
      id: `P${Date.now()}`,
      name: name.trim() || 'External Provider',
      url: result.url,
      recordPath: result.recordPath,
      mapping: result.mapping,
      intervalSec: Math.max(3, Number(interval) || 10),
      paused: false,
      addedAt: Date.now(),
    })
    setResult(null); setUrl(''); setName(''); setError('')
  }

  const confColor = c => (c >= 0.8 ? 'var(--green)' : c >= 0.5 ? 'var(--amber)' : 'var(--red)')

  return (
    <Drawer title="Connect Provider" icon="🔌" badge={providers.length} onClose={onClose} wide>
      {/* Connected providers */}
      {providers.length > 0 && (
        <div className="pc-section">
          <div className="pc-section-title">CONNECTED SOURCES</div>
          {providers.map(p => {
            const st = providerStatus[p.id] || {}
            return (
              <div key={p.id} className={`pc-provider${p.paused ? ' paused' : ''}`}>
                <span className={`pc-dot${st.error ? ' err' : p.paused ? ' off' : ''}`} />
                <div className="pc-pbody">
                  <div className="pc-pname">{p.name}</div>
                  <div className="pc-purl">{p.url === SAMPLE_FEED_URL ? 'built-in sample feed' : p.url}</div>
                  <div className="pc-pstat">
                    {st.error
                      ? <span style={{ color: 'var(--red)' }}>⚠ {st.error}</span>
                      : <span>{st.count ?? 0} vehicles · every {p.intervalSec}s{st.lastOk ? ` · last ok ${new Date(st.lastOk).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : ''}</span>}
                  </div>
                </div>
                <button className="pc-mini-btn" onClick={() => onTogglePause(p.id)} title={p.paused ? 'Resume polling' : 'Pause polling'}>{p.paused ? '▶' : '⏸'}</button>
                <button className="pc-mini-btn pc-del" onClick={() => onRemoveProvider(p.id)} title="Disconnect">✕</button>
              </div>
            )
          })}
        </div>
      )}

      {/* New connection */}
      <div className="pc-section">
        <div className="pc-section-title">ADD A NEW SOURCE</div>
        <div className="pc-explain">
          Paste any GPS / telematics API link that returns JSON. The analyzer inspects the
          response, finds the vehicle records, and auto-maps coordinates, speed, fuel,
          weight and identity fields — no manual integration code.
        </div>
        <div className="pc-url-row">
          <input className="pc-url-input" placeholder="https://api.your-provider.com/v1/vehicles?key=…"
            value={url} onChange={e => setUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && analyze()} />
          <button className="pc-analyze-btn" onClick={() => analyze()} disabled={analyzing}>
            {analyzing ? '⏳ Analyzing…' : '🧠 Analyze'}
          </button>
        </div>
        <button className="pc-sample-link" onClick={() => { setUrl(SAMPLE_FEED_URL); analyze(SAMPLE_FEED_URL) }}>
          ✨ No API handy? Try the built-in sample feed
        </button>
        {error && <div className="pc-error">⚠ {error}</div>}
      </div>

      {/* Analysis result */}
      {result && (
        <>
          <div className="pc-section">
            <div className="pc-section-title">ANALYSIS</div>
            <div className="pc-found">
              ✅ Found <b>{result.records.length}</b> vehicle record{result.records.length !== 1 ? 's' : ''} at
              <code className="pc-path"> {result.recordPath}</code> ·
              {' '}{Object.keys(result.mapping).length} fields auto-detected
            </div>
            <div className="pc-map-grid">
              {MAPPABLE_FIELDS.map(f => {
                const conf = result.confidence[f] || 0
                return (
                  <div key={f} className="pc-map-row">
                    <span className={`pc-map-field${REQUIRED_FIELDS.includes(f) ? ' req' : ''}`}>{FIELD_LABELS[f]}</span>
                    <select className="pc-map-sel" value={result.mapping[f] || ''} onChange={e => setFieldPath(f, e.target.value)}>
                      <option value="">— not mapped —</option>
                      {result.flatKeys.map(k => <option key={k} value={k}>{k}</option>)}
                    </select>
                    {result.mapping[f] && (
                      <span className="pc-conf" style={{ color: confColor(conf) }} title="Detection confidence">
                        {Math.round(conf * 100)}%
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          <div className="pc-section">
            <div className="pc-section-title">PREVIEW ({preview.length} mapped)</div>
            {preview.length === 0
              ? <div className="pc-error">No records produced valid coordinates with this mapping.</div>
              : (
                <div className="pc-preview">
                  {preview.map(t => (
                    <div key={t.id} className="pc-prev-row">
                      <span className="pc-prev-plate">{t.licensePlate}</span>
                      <span>{t.location.lat.toFixed(4)}, {t.location.lng.toFixed(4)}</span>
                      <span>⚡ {t.speed.toFixed(0)}</span>
                      <span>⛽ {t.fuel.toFixed(0)}%</span>
                      {t.weight != null && <span>⚖️ {Math.round(t.weight).toLocaleString()} kg</span>}
                      <span className={`pc-prev-st ${t.status}`}>{t.status}</span>
                    </div>
                  ))}
                </div>
              )}
            <div className="pc-connect-row">
              <input className="pc-name-input" placeholder="Provider name" value={name} onChange={e => setName(e.target.value)} />
              <label className="pc-int-label">
                poll every
                <input className="pc-int-input" type="number" min={3} max={300} value={interval} onChange={e => setIntervalSec(e.target.value)} />
                s
              </label>
              <button className="pc-connect-btn" disabled={!canConnect} onClick={connect}>🔗 Connect Live</button>
            </div>
          </div>
        </>
      )}
    </Drawer>
  )
}
