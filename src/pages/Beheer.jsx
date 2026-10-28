import { useEffect, useRef, useState } from 'react'
import { supabase, beheer } from '../supabase.js'
import { svgIconen } from '../iconen.js'

// Beheer (#/beheer): Word-bestand vervangen en kaarten aanpassen. Alles gaat via de Edge Function handleidingen-beheer,
// die het op GitHub zet; daarna bouwt "Online zetten" de site opnieuw (± 2 minuten).
export default function Beheer() {
  const [sessie, setSessie] = useState(undefined)
  useEffect(() => {
    document.title = 'Beheer · Handleidingen'
    supabase.auth.getSession().then(({ data }) => setSessie(data.session))
    const { data } = supabase.auth.onAuthStateChange((_, s) => setSessie(s))
    return () => data.subscription.unsubscribe()
  }, [])

  return (
    <main id="main" className="home beheer">
      <p className="crumb"><a href="#/">Alle handleidingen</a> / Beheer</p>
      <h1>Beheer</h1>
      {sessie === undefined ? <p>Laden…</p> : !sessie ? <Inloggen /> : <Overzicht email={sessie.user.email} />}
    </main>
  )
}

function Inloggen() {
  const [email, setEmail] = useState('')
  const [ww, setWw] = useState('')
  const [fout, setFout] = useState('')
  const [bezig, setBezig] = useState(false)

  async function inloggen(e) {
    e.preventDefault()
    setBezig(true); setFout('')
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: ww })
    setBezig(false)
    if (error) setFout('Inloggen lukt niet. Controleer je e-mailadres en wachtwoord.')
  }

  return (
    <form className="slot" onSubmit={inloggen}>
      <p>Log in met je beheeraccount (hetzelfde als in het MOL-portaal).</p>
      <label htmlFor="b-email">E-mailadres</label>
      <input id="b-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <label htmlFor="b-ww">Wachtwoord</label>
      <div className="slot-rij">
        <input id="b-ww" type="password" autoComplete="current-password" value={ww} onChange={(e) => setWw(e.target.value)} required />
        <button type="submit" disabled={bezig}>{bezig ? 'Bezig…' : 'Inloggen'}</button>
      </div>
      {fout && <p className="slot-fout" role="alert">{fout}</p>}
    </form>
  )
}

function Overzicht({ email }) {
  const [stand, setStand] = useState(null)
  const [fout, setFout] = useState('')
  const [run, setRun] = useState(null) // { commit, wat, slug }
  const [nieuw, setNieuw] = useState(false)

  async function laden() {
    setFout('')
    try { setStand(await beheer({ actie: 'stand' })) } catch (e) { setFout(e.message) }
  }
  useEffect(() => { laden() }, [])

  async function bewaarCatalogus(cat, omschrijving) {
    const uit = await beheer({ actie: 'catalogus', catalogus: cat, catalogusSha: stand.catalogusSha, omschrijving })
    setStand({ ...stand, catalogus: cat, catalogusSha: uit.catalogusSha })
    setRun({ commit: uit.commit, wat: omschrijving })
  }

  const kop = (
    <p className="b-wie">Ingelogd als <b>{email}</b> · <button type="button" className="b-link" onClick={() => supabase.auth.signOut()}>Uitloggen</button></p>
  )
  if (fout) return <>{kop}<p className="slot-fout" role="alert">{fout}</p><button type="button" className="b-knop" onClick={laden}>Opnieuw</button></>
  if (!stand) return <>{kop}<p>Gegevens van GitHub ophalen…</p></>

  return (
    <>
      {kop}
      {run && <Status key={run.commit} run={run} sluit={() => setRun(null)} />}
      <p className="b-uitleg">Een nieuwe versie van een Word-bestand kiezen vervangt de handleiding op de site. Het versienummer
        gaat vanzelf omhoog; oude versies blijven in de geschiedenis op GitHub. Na elke wijziging duurt het ongeveer 2 minuten
        voordat de site bijgewerkt is.</p>
      <p><button type="button" className="b-knop" onClick={() => setNieuw(!nieuw)}>{nieuw ? 'Annuleren' : '+ Nieuwe handleiding'}</button></p>
      {nieuw && <Nieuw stand={stand} bewaar={bewaarCatalogus} klaar={(r) => { setNieuw(false); if (r) { setRun(r); laden() } }} />}
      {stand.catalogus.groepen.map((g, gi) => (
        <section key={g.titel} className="b-groep">
          <h2>{g.titel}</h2>
          {g.items.map((it, ii) => (
            <Rij key={it.slug} it={it} word={stand.word[it.bron] || []} iconen={stand.iconen}
              bewaar={(nieuwItem, omschrijving) => {
                const cat = structuredClone(stand.catalogus)
                if (nieuwItem) cat.groepen[gi].items[ii] = nieuwItem
                else cat.groepen[gi].items.splice(ii, 1)
                return bewaarCatalogus(cat, omschrijving)
              }}
              geupload={(uit) => { setRun({ commit: uit.commit, wat: `${uit.bestand} geüpload`, slug: it.slug }); laden() }} />
          ))}
        </section>
      ))}
      <Logboek />
    </>
  )
}

function Rij({ it, word, iconen, bewaar, geupload }) {
  const [bewerk, setBewerk] = useState(false)
  const [bezig, setBezig] = useState('')
  const [fout, setFout] = useState('')
  const invoer = useRef()

  async function upload(e) {
    const f = e.target.files[0]
    e.target.value = ''
    if (!f) return
    if (!confirm(`${f.name} op de site zetten als nieuwe versie van "${it.titel}"?`)) return
    setBezig('upload'); setFout('')
    const fd = new FormData()
    fd.append('bron', it.bron)
    fd.append('bestand', f)
    try { geupload(await beheer(fd)) } catch (e) { setFout(e.message) }
    setBezig('')
  }

  async function weg() {
    if (!confirm(`"${it.titel}" van de site halen? Het Word-bestand blijft op GitHub staan.`)) return
    setBezig('weg'); setFout('')
    try { await bewaar(null, `${it.titel} van de site gehaald`) } catch (e) { setFout(e.message); setBezig('') }
  }

  return (
    <div className="b-rij">
      <div className="b-rij-kop">
        <div>
          <b>{it.titel}</b>{it.beta && <span className="beta">Beta</span>}
          <span className="b-sub">{it.tekst}</span>
          <span className="b-sub">{word.length ? `${word[0].pad.split('/').pop()}` : 'Nog geen Word-bestand'} · <a href={`#/${it.slug}`}>bekijken</a></span>
        </div>
        <div className="b-acties">
          <input ref={invoer} type="file" accept=".docx" hidden onChange={upload} />
          <button type="button" className="b-knop" disabled={!!bezig} onClick={() => invoer.current.click()}>
            {bezig === 'upload' ? 'Uploaden…' : 'Nieuwe versie'}</button>
          <button type="button" className="b-knop b-licht" disabled={!!bezig} onClick={() => setBewerk(!bewerk)}>Aanpassen</button>
        </div>
      </div>
      {fout && <p className="slot-fout" role="alert">{fout}</p>}
      {bewerk && <Bewerk it={it} iconen={iconen} weg={weg}
        bewaar={async (n) => { await bewaar(n, `${n.titel} aangepast`); setBewerk(false) }} />}
    </div>
  )
}

function Bewerk({ it, iconen, bewaar, weg }) {
  const [v, setV] = useState({ titel: it.titel, tekst: it.tekst || '', icoon: it.icoon, beta: !!it.beta })
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState('')

  async function opslaan(e) {
    e.preventDefault()
    const n = { ...it, titel: v.titel.trim(), tekst: v.tekst.trim(), icoon: v.icoon }
    if (v.beta) n.beta = true; else delete n.beta
    setBezig(true); setFout('')
    try { await bewaar(n) } catch (e) { setFout(e.message) }
    setBezig(false)
  }

  return (
    <form className="b-form" onSubmit={opslaan}>
      <Velden v={v} setV={setV} iconen={iconen} />
      <div className="b-acties">
        <button type="submit" className="b-knop" disabled={bezig}>{bezig ? 'Opslaan…' : 'Opslaan'}</button>
        <button type="button" className="b-knop b-gevaar" disabled={bezig} onClick={weg}>Van de site halen</button>
      </div>
      {fout && <p className="slot-fout" role="alert">{fout}</p>}
    </form>
  )
}

function Velden({ v, setV, iconen }) {
  const zet = (k) => (e) => setV({ ...v, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  return (
    <>
      <label>Titel<input value={v.titel} onChange={zet('titel')} required maxLength={60} /></label>
      <label>Korte tekst op de kaart<input value={v.tekst} onChange={zet('tekst')} maxLength={90} /></label>
      <label>Icoon
        <select value={v.icoon} onChange={zet('icoon')}>
          {[...Object.keys(svgIconen), ...iconen].map((i) => <option key={i} value={i}>{i.replace(/^ico-|\.webp$/g, '')}</option>)}
        </select>
      </label>
      <label className="b-check"><input type="checkbox" checked={v.beta} onChange={zet('beta')} /> Beta-label tonen</label>
    </>
  )
}

const slugVan = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

function Nieuw({ stand, bewaar, klaar }) {
  const groepen = stand.catalogus.groepen
  const [v, setV] = useState({ titel: '', tekst: '', icoon: 'code', beta: true, groep: 0, soort: 'Handleiding' })
  const [bestand, setBestand] = useState(null)
  const [bezig, setBezig] = useState('')
  const [fout, setFout] = useState('')
  const slug = slugVan(v.titel)
  const bron = `${v.soort}_${v.titel.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')}`

  async function toevoegen(e) {
    e.preventDefault()
    if (!slug) return setFout('Vul een titel in.')
    if (groepen.some((g) => g.items.some((it) => it.slug === slug))) return setFout(`Er is al een handleiding met adres ${slug}.`)
    setFout('')
    try {
      setBezig('Kaart toevoegen…')
      const cat = structuredClone(stand.catalogus)
      const it = { slug, bron, titel: v.titel.trim(), tekst: v.tekst.trim(), icoon: v.icoon }
      if (v.beta) it.beta = true
      cat.groepen[v.groep].items.push(it)
      await bewaar(cat, `${it.titel} toegevoegd`)
      let commit = null
      if (bestand) {
        setBezig('Word-bestand uploaden…')
        const fd = new FormData()
        fd.append('bron', bron)
        fd.append('bestand', bestand)
        commit = (await beheer(fd)).commit
      }
      if (commit) klaar({ commit, wat: `${it.titel} toegevoegd`, slug })
      else klaar(null)
    } catch (e) { setFout(e.message) }
    setBezig('')
  }

  return (
    <form className="b-form b-nieuw" onSubmit={toevoegen}>
      <label>Groep
        <select value={v.groep} onChange={(e) => setV({ ...v, groep: +e.target.value })}>
          {groepen.map((g, i) => <option key={g.titel} value={i}>{g.titel}</option>)}
        </select>
      </label>
      <label>Soort
        <select value={v.soort} onChange={(e) => setV({ ...v, soort: e.target.value })}>
          <option>Handleiding</option><option>Informatie</option>
        </select>
      </label>
      <Velden v={v} setV={setV} iconen={stand.iconen} />
      <label>Word-bestand (.docx, met sjabloon v27)
        <input type="file" accept=".docx" onChange={(e) => setBestand(e.target.files[0] || null)} />
      </label>
      {slug && <p className="b-sub">Adres: #/{slug} · bestandsnaam op GitHub: {bron}_v27_01.docx</p>}
      <button type="submit" className="b-knop" disabled={!!bezig}>{bezig || 'Toevoegen'}</button>
      {fout && <p className="slot-fout" role="alert">{fout}</p>}
    </form>
  )
}

// Volgt de Actions-run "Online zetten" en toont daarna wat de omzetter meldde
function Status({ run, sluit }) {
  const [s, setS] = useState({ stand: 'wachten' })
  useEffect(() => {
    let stop = false, t
    const kijk = async () => {
      try {
        const r = await beheer({ actie: 'status', commit: run.commit })
        if (stop) return
        setS(r)
        if (r.stand !== 'completed') t = setTimeout(kijk, 10000)
      } catch (e) { if (!stop) setS({ stand: 'fout', melding: e.message }) }
    }
    t = setTimeout(kijk, 4000)
    return () => { stop = true; clearTimeout(t) }
  }, [run.commit])

  const klaar = s.stand === 'completed'
  const goed = klaar && s.uitkomst === 'success'
  const regels = (s.omzetter || []).filter((l) => !run.slug || l.includes(`${run.slug}:`) || l.startsWith('##[error]'))
  return (
    <aside className={`blk ${!klaar ? 'info' : goed ? 'tip' : 'warn'} b-status`} role="status">
      <p><b>{run.wat}</b></p>
      <p>{s.stand === 'fout' ? `Stand ophalen lukt niet: ${s.melding}`
        : !klaar ? 'De site wordt bijgewerkt… (± 2 minuten)'
        : goed ? 'Klaar: de site is bijgewerkt. Ververs de pagina als je de oude versie nog ziet.'
        : s.uitkomst === 'cancelled' ? 'Deze run is vervangen door een nieuwere wijziging.'
        : 'Bijwerken is mislukt. Bekijk de details op GitHub.'}</p>
      {regels.length > 0 && <ul>{regels.map((l, i) => <li key={i}>{l.replace(/^##\[(warning|error)\]/, (_, w) => w === 'error' ? 'Fout: ' : 'Let op: ')}</li>)}</ul>}
      <p>{s.url && <a href={s.url} target="_blank" rel="noreferrer">Details op GitHub</a>}{klaar && <> · <button type="button" className="b-link" onClick={sluit}>Sluiten</button></>}</p>
    </aside>
  )
}

function Logboek() {
  const [rijen, setRijen] = useState(null)
  useEffect(() => {
    supabase.from('hl_logboek').select('wanneer, wie, wat').order('wanneer', { ascending: false }).limit(15)
      .then(({ data }) => setRijen(data || []))
  }, [])
  if (!rijen?.length) return null
  return (
    <section className="b-groep">
      <h2>Laatste wijzigingen</h2>
      <ul className="b-log">
        {rijen.map((r, i) => <li key={i}>{new Date(r.wanneer).toLocaleString('nl-NL', { dateStyle: 'short', timeStyle: 'short' })} · {r.wie} · {r.wat}</li>)}
      </ul>
    </section>
  )
}
