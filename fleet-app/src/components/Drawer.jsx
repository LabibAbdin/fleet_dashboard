import { useEffect } from 'react'

// ── Reusable slide-in drawer (right edge) ─────────────────────────────────────
// Scrim click + Esc close it. Width via `wide` prop.
export default function Drawer({ title, icon, badge, onClose, children, wide = false, footer = null }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="drawer-scrim" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <aside className={`drawer${wide ? ' drawer-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="drawer-head">
          <span className="drawer-icon" aria-hidden="true">{icon}</span>
          <span className="drawer-title">{title}</span>
          {badge != null && badge !== 0 && <span className="drawer-badge">{badge}</span>}
          <button className="drawer-close" onClick={onClose} aria-label="Close panel">✕</button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </aside>
    </div>
  )
}
