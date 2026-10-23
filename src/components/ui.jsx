import { useState } from 'react'

export function Tabs({ tabs, actief, kies }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(([id, label]) => (
        <button key={id} role="tab" aria-selected={actief === id}
          className={actief === id ? 'tab actief' : 'tab'} onClick={() => kies(id)}>
          {label}
        </button>
      ))}
    </div>
  )
}

export function Melding({ type = 'info', children }) {
  if (!children) return null
  return <div className={`melding ${type}`}>{children}</div>
}

// Knop die een async actie uitvoert en fouten/succes toont
export function useActie() {
  const [bezig, setBezig] = useState(false)
  const [bericht, setBericht] = useState(null)
  async function voer(fn, succes) {
    setBezig(true)
    setBericht(null)
    try {
      await fn()
      if (succes) setBericht({ type: 'ok', tekst: succes })
    } catch (e) {
      setBericht({ type: 'fout', tekst: e.message || String(e) })
    } finally {
      setBezig(false)
    }
  }
  const melding = bericht ? <Melding type={bericht.type}>{bericht.tekst}</Melding> : null
  return { bezig, voer, melding, setBericht }
}

export function KopieerKnop({ tekst, label, klaarLabel = 'Gekopieerd ✓' }) {
  const [klaar, setKlaar] = useState(false)
  async function kopieer() {
    try { await navigator.clipboard.writeText(tekst) } catch {
      const t = document.createElement('textarea'); t.value = tekst; document.body.appendChild(t); t.select()
      document.execCommand('copy'); t.remove()
    }
    setKlaar(true); setTimeout(() => setKlaar(false), 2000)
  }
  return <button type="button" className="secundair" onClick={kopieer} disabled={!tekst}>{klaar ? klaarLabel : label}</button>
}

export function Laden() {
  return <p className="zacht">Laden…</p>
}

export function Statistiek({ items }) {
  return (
    <div className="stats">
      {items.map(([n, label]) => (
        <div key={label}><strong>{n}</strong><span>{label}</span></div>
      ))}
    </div>
  )
}

export function Voortgang({ waarde, totaal }) {
  const p = totaal ? Math.round((waarde / totaal) * 100) : 0
  return <div className="balk" aria-label={`${waarde} van ${totaal}`}><div style={{ width: p + '%' }} /></div>
}

// Zoek- en filterlijst met leerlingen + status (ingepland / contact nodig / niet ingepland)
export function LeerlingLijst({ leerlingen, boekingPer, kanNietPer = {}, extra }) {
  const [zoek, setZoek] = useState('')
  const [klas, setKlas] = useState('')
  const [status, setStatus] = useState('')
  const klassen = [...new Set(leerlingen.map((l) => l.klas))].sort()
  const st = (l) => (boekingPer[l.id] ? 'ja' : kanNietPer[l.id] ? 'contact' : 'nee')
  const volgorde = { contact: 0, nee: 1, ja: 2 }
  const lijst = leerlingen
    .filter((l) => !klas || l.klas === klas)
    .filter((l) => !status || st(l) === status)
    .filter((l) => !zoek || `${l.naam} ${l.email} ${l.klas}`.toLowerCase().includes(zoek.toLowerCase()))
    .sort((a, b) => (volgorde[st(a)] - volgorde[st(b)]) || a.klas.localeCompare(b.klas) || a.naam.localeCompare(b.naam))
  return (
    <div>
      <div className="filters">
        <input placeholder="Zoek naam, e-mail of klas" value={zoek} onChange={(e) => setZoek(e.target.value)} />
        <select value={klas} onChange={(e) => setKlas(e.target.value)}>
          <option value="">Alle klassen</option>
          {klassen.map((k) => <option key={k}>{k}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Alle statussen</option>
          <option value="contact">Contact nodig</option>
          <option value="nee">Niet ingepland</option>
          <option value="ja">Ingepland</option>
        </select>
      </div>
      <ul className="lijst">
        {lijst.map((l) => {
          const b = boekingPer[l.id]
          const k = kanNietPer[l.id]
          return (
            <li key={l.id}>
              <div>
                <strong>{l.naam}</strong> <span className="zacht">{l.klas}</span>
                {b && <div className="zacht klein">{b.tekst}</div>}
                {b?.opmerking && <div className="opmerking">“{b.opmerking}”</div>}
                {!b && k && <div className="opmerking let">Geen moment past: “{k.reden}”{k.voorkeur ? ` · kan wel: ${k.voorkeur}` : ''}</div>}
              </div>
              <div className="rij-acties">
                <span className={b ? 'label ok' : k ? 'label contact' : 'label open'}>
                  {b ? 'Ingepland' : k ? 'Contact nodig' : 'Niet ingepland'}
                </span>
                {extra && extra(l)}
              </div>
            </li>
          )
        })}
        {!lijst.length && <li className="zacht">Geen leerlingen gevonden.</li>}
      </ul>
    </div>
  )
}

// --- Eigen bevestigingsvenster (werkt ook waar browser-pop-ups geblokkeerd zijn) ---
let toonVraag = null
export function bevestig(tekst, opties = {}) {
  return new Promise((klaar) => (toonVraag ? toonVraag({ tekst, ...opties, klaar }) : klaar(false)))
}
// Vraagt om een woord te typen; geeft dat woord terug of null
export async function bevestigTyp(tekst, woord = 'VERWIJDER') {
  return (await bevestig(tekst, { typ: woord, gevaar: true, knop: 'Verwijderen' })) ? woord : null
}
export function BevestigHost() {
  const [v, setV] = useState(null)
  const [invoer, setInvoer] = useState('')
  toonVraag = (x) => { setInvoer(''); setV(x) }
  if (!v) return null
  const sluit = (ok) => { v.klaar(ok); setV(null) }
  const magOk = !v.typ || invoer.trim().toUpperCase() === v.typ
  return (
    <div className="vraag-achter" onClick={() => sluit(false)}>
      <div className="vraag" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <p>{v.tekst}</p>
        {v.typ && <input autoFocus value={invoer} onChange={(e) => setInvoer(e.target.value)} placeholder={v.typ} />}
        <div className="knoppen">
          <button className={v.gevaar ? 'gevaar-vol' : ''} disabled={!magOk} onClick={() => sluit(true)} autoFocus={!v.typ}>{v.knop || 'Ja, doorgaan'}</button>
          <button className="secundair" onClick={() => sluit(false)}>Annuleren</button>
        </div>
      </div>
    </div>
  )
}
