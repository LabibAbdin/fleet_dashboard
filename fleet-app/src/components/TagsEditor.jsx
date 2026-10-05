import { useState } from 'react'

// ── Inline tag editor for a truck (chips + quick-add input) ───────────────────
export default function TagsEditor({ truckId, tags, onChange }) {
  const [draft, setDraft] = useState('')
  const list = tags[truckId] || []

  const add = () => {
    const v = draft.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 20)
    if (!v || list.includes(v)) { setDraft(''); return }
    onChange({ ...tags, [truckId]: [...list, v] })
    setDraft('')
  }
  const remove = (tag) => {
    onChange({ ...tags, [truckId]: list.filter(t => t !== tag) })
  }

  return (
    <div className="tags-editor">
      <span className="tags-editor-label">🏷 TAGS</span>
      {list.map(tag => (
        <span key={tag} className="tag-chip">
          {tag}
          <button className="tag-x" onClick={() => remove(tag)} aria-label={`Remove tag ${tag}`}>✕</button>
        </span>
      ))}
      <input
        className="tag-input"
        placeholder="+ add tag"
        value={draft}
        maxLength={20}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') add(); if (e.key === 'Escape') setDraft('') }}
        onBlur={() => draft.trim() && add()}
      />
    </div>
  )
}
