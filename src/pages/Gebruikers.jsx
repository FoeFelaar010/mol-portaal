import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { Laden, useActie, bevestig, bevestigTyp } from '../components/ui.jsx'
import Leerling from './Leerling.jsx'

const hoofdKlas = (k) => String(k || '').trim().toUpperCase()
const geldigMail = (m) => /^\S+@\S+\.\S+$/.test(m)
// Nette melding bij dubbel e-mailadres
const dbFout = (error) => (error.code === '23505' ? new Error('Dit e-mailadres bestaat al.') : error)

export default function Gebruikers({ zelf }) {
  const [soort, setSoort] = useState('klassen')
  const [d, setD] = useState(null)
  const [bekijk, setBekijk] = useState(null) // leerling waarvan de beheerder het scherm bekijkt

  const laad = useCallback(async () => {
    const [doc, ll, km] = await Promise.all([
      supabase.from('docenten').select('*').order('naam'),
      supabase.from('leerlingen').select('*').order('naam'),
      supabase.from('klas_mentoren').select('klas, docent_id'),
    ])
    setD({ docenten: doc.data || [], leerlingen: ll.data || [], km: km.data || [] })
  }, [])
  useEffect(() => { laad() }, [laad])

  if (!d) return <Laden />
  if (bekijk) {
    return (
      <>
        <div className="melding info kop-rij">
          <span>Je bekijkt het portaal als <strong>{bekijk.naam}</strong> ({bekijk.klas}). Alleen kijken: kiezen en annuleren werken hier niet.</span>
          <button className="secundair" onClick={() => setBekijk(null)}>Terug naar beheer</button>
        </div>
        <div className="bekijk-als"><Leerling leerling={bekijk} kijk /></div>
      </>
    )
  }
  return (
    <>
      <div className="segment">
        {[['klassen', 'Klassen'], ['docenten', `Docenten (${d.docenten.length})`], ['leerlingen', `Leerlingen (${d.leerlingen.length})`]].map(([id, label]) => (
          <button key={id} className={soort === id ? 'actief' : ''} onClick={() => setSoort(id)}>{label}</button>
        ))}
      </div>
      {soort === 'klassen' && <Klassen d={d} laad={laad} />}
      {soort === 'docenten' && <Docenten d={d} laad={laad} zelf={zelf} />}
      {soort === 'leerlingen' && <Leerlingen d={d} laad={laad} bekijk={setBekijk} />}
    </>
  )
}

// ------------------------------------------------------------- Klassen
function Klassen({ d, laad }) {
  const { bezig, voer, melding } = useActie()
  const [nieuw, setNieuw] = useState({ klas: '', docent: '' })
  const perKlas = {}
  for (const l of d.leerlingen) perKlas[l.klas] = (perKlas[l.klas] || 0) + 1
  for (const k of d.km) perKlas[k.klas] ??= 0
  const klassen = Object.keys(perKlas).sort()
  const naamVan = Object.fromEntries(d.docenten.map((x) => [x.id, x.naam]))

  async function koppel(klas, docentId) {
    if (!klas || !docentId) return
    await voer(async () => {
      const { error } = await supabase.from('klas_mentoren').insert({ klas: hoofdKlas(klas), docent_id: docentId })
      if (error) throw error.code === '23505' ? new Error('Deze docent is al mentor van die klas.') : error
      setNieuw({ klas: '', docent: '' })
      await laad()
    }, `${naamVan[docentId]} is mentor van ${hoofdKlas(klas)}.`)
  }

  async function ontkoppel(klas, docentId) {
    if (!await bevestig(`${naamVan[docentId]} is dan geen mentor meer van ${klas}. Ingevulde tijden en afspraken blijven staan.`, { knop: 'Ontkoppelen' })) return
    await voer(async () => {
      const { error } = await supabase.from('klas_mentoren').delete().eq('klas', klas).eq('docent_id', docentId)
      if (error) throw error
      await laad()
    }, 'Mentor ontkoppeld.')
  }

  // Klas weg: leerlingen (met hun afspraken), mentorkoppelingen en klasinstellingen
  async function verwijderKlas(klas) {
    const ids = d.leerlingen.filter((l) => l.klas === klas).map((l) => l.id)
    const nMentor = d.km.filter((x) => x.klas === klas).length
    let nAfspraak = 0
    if (ids.length) {
      const { count } = await supabase.from('boekingen').select('id', { count: 'exact', head: true }).in('leerling_id', ids)
      nAfspraak = count || 0
    }
    const gevolgen = [
      ids.length && `${ids.length} leerling${ids.length === 1 ? '' : 'en'}`,
      nAfspraak && `${nAfspraak} afspra${nAfspraak === 1 ? 'ak' : 'ken'}`,
      nMentor && `${nMentor} mentorkoppeling${nMentor === 1 ? '' : 'en'}`,
    ].filter(Boolean)
    const tekst = `Klas ${klas} verwijderen?` + (gevolgen.length ? ` Dit verwijdert: ${gevolgen.join(', ')}.` : '') + ' De docenten zelf blijven staan.'
    const ok = ids.length
      ? await bevestigTyp(`${tekst} Typ VERWIJDER om door te gaan.`)
      : await bevestig(tekst, { knop: 'Verwijderen', gevaar: true })
    if (!ok) return
    await voer(async () => {
      for (const [tabel, filter] of [['leerlingen', 'klas'], ['klas_mentoren', 'klas'], ['klas_instelling', 'klas']]) {
        const { error } = await supabase.from(tabel).delete().eq(filter, klas)
        if (error) throw error
      }
      await laad()
    }, `Klas ${klas} is verwijderd.`)
  }

  return (
    <div className="kaart">
      <h2>Mentoren per klas</h2>
      <p className="zacht klein">Klik op ✕ om een mentor te ontkoppelen, of kies een docent om toe te voegen. Twee mentoren = duo-mentoraat.</p>
      {melding}
      <div className="scroll">
        <table className="tabel">
          <thead><tr><th>Klas</th><th>Leerlingen</th><th>Mentor(en)</th><th></th></tr></thead>
          <tbody>
            {klassen.map((k) => {
              const mentoren = d.km.filter((x) => x.klas === k)
              return (
                <tr key={k}>
                  <td><strong>{k}</strong></td>
                  <td>{perKlas[k] || <span className="waarschuwing">0</span>}</td>
                  <td>
                    <div className="chips">
                      {mentoren.map((m) => (
                        <span key={m.docent_id} className="chip">{naamVan[m.docent_id] || '?'}
                          <button className="link" aria-label={`${naamVan[m.docent_id]} ontkoppelen`} disabled={bezig} onClick={() => ontkoppel(k, m.docent_id)}>✕</button>
                        </span>
                      ))}
                      {!mentoren.length && <span className="waarschuwing">geen mentor</span>}
                      <select value="" disabled={bezig} onChange={(e) => koppel(k, e.target.value)} aria-label={`Mentor toevoegen aan ${k}`}>
                        <option value="">+ mentor</option>
                        {d.docenten.filter((x) => !mentoren.some((m) => m.docent_id === x.id)).map((x) => <option key={x.id} value={x.id}>{x.naam}</option>)}
                      </select>
                    </div>
                  </td>
                  <td><button className="link" disabled={bezig} onClick={() => verwijderKlas(k)}>Verwijderen</button></td>
                </tr>
              )
            })}
            {!klassen.length && <tr><td colSpan={4} className="zacht">Nog geen klassen.</td></tr>}
          </tbody>
        </table>
      </div>
      <h3>Nieuwe klas of mentor koppelen</h3>
      <form className="zoekrij" onSubmit={(e) => { e.preventDefault(); koppel(nieuw.klas, nieuw.docent) }}>
        <input list="klassen-lijst" placeholder="Klas, bijv. M3A" value={nieuw.klas} onChange={(e) => setNieuw({ ...nieuw, klas: e.target.value })} required maxLength={10} />
        <datalist id="klassen-lijst">{klassen.map((k) => <option key={k} value={k} />)}</datalist>
        <select value={nieuw.docent} onChange={(e) => setNieuw({ ...nieuw, docent: e.target.value })} required>
          <option value="">Kies docent</option>
          {d.docenten.map((x) => <option key={x.id} value={x.id}>{x.naam}</option>)}
        </select>
        <button type="submit" disabled={bezig}>Koppelen</button>
      </form>
    </div>
  )
}

// ------------------------------------------------------------- Docenten
function Docenten({ d, laad, zelf }) {
  const { bezig, voer, melding } = useActie()
  const [zoek, setZoek] = useState('')
  const [bewerk, setBewerk] = useState(null) // { id, naam, email }
  const [nieuw, setNieuw] = useState({ naam: '', email: '' })
  const klassenVan = (id) => d.km.filter((x) => x.docent_id === id).map((x) => x.klas).sort()
  const lijst = d.docenten.filter((x) => !zoek || `${x.naam} ${x.email} ${klassenVan(x.id).join(' ')}`.toLowerCase().includes(zoek.toLowerCase()))

  async function bewaar(e) {
    e.preventDefault()
    const email = bewerk.email.trim().toLowerCase()
    await voer(async () => {
      if (!bewerk.naam.trim() || !geldigMail(email)) throw new Error('Vul een naam en een geldig e-mailadres in.')
      const { error } = await supabase.from('docenten').update({ naam: bewerk.naam.trim(), email }).eq('id', bewerk.id)
      if (error) throw dbFout(error)
      setBewerk(null)
      await laad()
    }, 'Docent opgeslagen.')
  }

  async function voegToe(e) {
    e.preventDefault()
    const email = nieuw.email.trim().toLowerCase()
    await voer(async () => {
      if (!geldigMail(email)) throw new Error('Vul een geldig e-mailadres in.')
      const { error } = await supabase.from('docenten').insert({ naam: nieuw.naam.trim() || email, email })
      if (error) throw dbFout(error)
      setNieuw({ naam: '', email: '' })
      await laad()
    }, 'Docent toegevoegd. Koppel hem of haar bij Klassen aan een klas.')
  }

  async function verwijder(x) {
    const { data: slots } = await supabase.from('slots').select('id, boekingen(id)').eq('docent_id', x.id)
    const n = (slots || []).length
    const b = (slots || []).filter((s) => s.boekingen).length
    const klassen = klassenVan(x.id)
    const gevolgen = [
      klassen.length && `mentor van ${klassen.join(', ')}`,
      n && `${n} tijdslot${n === 1 ? '' : 's'}`,
      b && `${b} afspra${b === 1 ? 'ak' : 'ken'} met leerlingen`,
    ].filter(Boolean)
    const tekst = `${x.naam} (${x.email}) verwijderen?` + (gevolgen.length ? ` Dit verwijdert ook: ${gevolgen.join(', ')}.` : '')
    if (!await bevestig(tekst, { knop: 'Verwijderen', gevaar: true })) return
    await voer(async () => {
      const { error } = await supabase.from('docenten').delete().eq('id', x.id)
      if (error) throw error
      await laad()
    }, `${x.naam} is verwijderd.`)
  }

  return (
    <div className="kaart">
      <h2>Docenten</h2>
      <input placeholder="Zoek naam, e-mail of klas" value={zoek} onChange={(e) => setZoek(e.target.value)} />
      {melding}
      <ul className="lijst">
        {lijst.map((x) => bewerk?.id === x.id ? (
          <li key={x.id}>
            <form className="bewerk" onSubmit={bewaar}>
              <input value={bewerk.naam} onChange={(e) => setBewerk({ ...bewerk, naam: e.target.value })} placeholder="Naam" required />
              <input type="email" value={bewerk.email} onChange={(e) => setBewerk({ ...bewerk, email: e.target.value })} placeholder="E-mail" required />
              <div className="knoppen">
                <button type="submit" disabled={bezig}>Opslaan</button>
                <button type="button" className="secundair" onClick={() => setBewerk(null)}>Annuleren</button>
              </div>
            </form>
          </li>
        ) : (
          <li key={x.id}>
            <div>
              <strong>{x.naam}</strong> {x.is_admin && <span className="label">beheerder</span>}
              <div className="zacht klein">{x.email}{klassenVan(x.id).length ? ` · mentor ${klassenVan(x.id).join(', ')}` : ''}</div>
            </div>
            <div className="rij-acties">
              <button className="link" onClick={() => setBewerk({ id: x.id, naam: x.naam, email: x.email })}>Wijzigen</button>
              {x.id !== zelf.id && <button className="link" disabled={bezig} onClick={() => verwijder(x)}>Verwijderen</button>}
            </div>
          </li>
        ))}
        {!lijst.length && <li className="zacht">Geen docenten gevonden.</li>}
      </ul>
      <h3>Docent toevoegen</h3>
      <form onSubmit={voegToe}>
        <div className="raster2">
          <label>Naam<input value={nieuw.naam} onChange={(e) => setNieuw({ ...nieuw, naam: e.target.value })} placeholder="Bijv. Joey Bonte" /></label>
          <label>E-mail<input type="email" value={nieuw.email} onChange={(e) => setNieuw({ ...nieuw, email: e.target.value })} required placeholder="naam@cvo.nl" /></label>
        </div>
        <button type="submit" disabled={bezig}>Toevoegen</button>
      </form>
    </div>
  )
}

// ----------------------------------------------------------- Leerlingen
const MAX = 100

function Leerlingen({ d, laad, bekijk }) {
  const { bezig, voer, melding } = useActie()
  const [zoek, setZoek] = useState('')
  const [klas, setKlas] = useState('')
  const [bewerk, setBewerk] = useState(null)
  const leeg = { naam: '', klas: '', email: '', leerlingnummer: '' }
  const [nieuw, setNieuw] = useState(leeg)
  const klassen = [...new Set([...d.leerlingen.map((l) => l.klas), ...d.km.map((k) => k.klas)])].sort()
  const gevonden = d.leerlingen
    .filter((l) => !klas || l.klas === klas)
    .filter((l) => !zoek || `${l.naam} ${l.email} ${l.klas} ${l.leerlingnummer || ''}`.toLowerCase().includes(zoek.toLowerCase()))
  const lijst = gevonden.slice(0, MAX)

  const schoon = (x) => ({
    naam: x.naam.trim(), klas: hoofdKlas(x.klas), email: x.email.trim().toLowerCase(),
    leerlingnummer: String(x.leerlingnummer || '').trim() || null,
  })
  const controleer = (x) => { if (!x.naam || !x.klas || !geldigMail(x.email)) throw new Error('Vul naam, klas en een geldig e-mailadres in.') }

  async function bewaar(e) {
    e.preventDefault()
    const rij = schoon(bewerk)
    await voer(async () => {
      controleer(rij)
      const { error } = await supabase.from('leerlingen').update(rij).eq('id', bewerk.id)
      if (error) throw dbFout(error)
      setBewerk(null)
      await laad()
    }, 'Leerling opgeslagen.')
  }

  async function voegToe(e) {
    e.preventDefault()
    const rij = schoon(nieuw)
    await voer(async () => {
      controleer(rij)
      const { error } = await supabase.from('leerlingen').insert(rij)
      if (error) throw dbFout(error)
      setNieuw(leeg)
      await laad()
    }, `${rij.naam} toegevoegd aan ${rij.klas}.`)
  }

  async function verwijder(l) {
    const { count } = await supabase.from('boekingen').select('id', { count: 'exact', head: true }).eq('leerling_id', l.id)
    const tekst = `${l.naam} (${l.klas}) verwijderen?` + (count ? ` Ook ${count === 1 ? 'de afspraak' : `${count} afspraken`} van deze leerling ${count === 1 ? 'wordt' : 'worden'} verwijderd.` : '')
    if (!await bevestig(tekst, { knop: 'Verwijderen', gevaar: true })) return
    await voer(async () => {
      const { error } = await supabase.from('leerlingen').delete().eq('id', l.id)
      if (error) throw error
      await laad()
    }, `${l.naam} is verwijderd.`)
  }

  return (
    <div className="kaart">
      <h2>Leerlingen</h2>
      <div className="filters">
        <input placeholder="Zoek naam, e-mail, klas of nummer" value={zoek} onChange={(e) => setZoek(e.target.value)} />
        <select value={klas} onChange={(e) => setKlas(e.target.value)}>
          <option value="">Alle klassen</option>
          {klassen.map((k) => <option key={k}>{k}</option>)}
        </select>
      </div>
      {melding}
      <ul className="lijst">
        {lijst.map((l) => bewerk?.id === l.id ? (
          <li key={l.id}>
            <form className="bewerk" onSubmit={bewaar}>
              <input value={bewerk.naam} onChange={(e) => setBewerk({ ...bewerk, naam: e.target.value })} placeholder="Naam" required />
              <input list="klassen-ll" value={bewerk.klas} onChange={(e) => setBewerk({ ...bewerk, klas: e.target.value })} placeholder="Klas" required maxLength={10} />
              <input type="email" value={bewerk.email} onChange={(e) => setBewerk({ ...bewerk, email: e.target.value })} placeholder="E-mail" required />
              <input value={bewerk.leerlingnummer || ''} onChange={(e) => setBewerk({ ...bewerk, leerlingnummer: e.target.value })} placeholder="Leerlingnummer" />
              <div className="knoppen">
                <button type="submit" disabled={bezig}>Opslaan</button>
                <button type="button" className="secundair" onClick={() => setBewerk(null)}>Annuleren</button>
              </div>
            </form>
          </li>
        ) : (
          <li key={l.id}>
            <div>
              <strong>{l.naam}</strong> <span className="zacht">{l.klas}</span>
              <div className="zacht klein">{l.email}{l.leerlingnummer ? ` · ${l.leerlingnummer}` : ''}</div>
            </div>
            <div className="rij-acties">
              <button className="link" onClick={() => { bekijk(l); window.scrollTo(0, 0) }}>Bekijken</button>
              <button className="link" onClick={() => setBewerk({ ...l })}>Wijzigen</button>
              <button className="link" disabled={bezig} onClick={() => verwijder(l)}>Verwijderen</button>
            </div>
          </li>
        ))}
        {!lijst.length && <li className="zacht">Geen leerlingen gevonden.</li>}
      </ul>
      {gevonden.length > MAX && <p className="zacht klein">{MAX} van {gevonden.length} getoond. Zoek of kies een klas om te verfijnen.</p>}
      <datalist id="klassen-ll">{klassen.map((k) => <option key={k} value={k} />)}</datalist>
      <h3>Leerling toevoegen</h3>
      <form onSubmit={voegToe}>
        <div className="raster2">
          <label>Naam<input value={nieuw.naam} onChange={(e) => setNieuw({ ...nieuw, naam: e.target.value })} required placeholder="Voornaam Achternaam" /></label>
          <label>Klas<input list="klassen-ll" value={nieuw.klas} onChange={(e) => setNieuw({ ...nieuw, klas: e.target.value })} required maxLength={10} placeholder="Bijv. M3A" /></label>
          <label>E-mail<input type="email" value={nieuw.email} onChange={(e) => setNieuw({ ...nieuw, email: e.target.value })} required placeholder="l3123456@cvo.nl" /></label>
          <label>Leerlingnummer<input value={nieuw.leerlingnummer} onChange={(e) => setNieuw({ ...nieuw, leerlingnummer: e.target.value })} placeholder="niet verplicht" /></label>
        </div>
        <button type="submit" disabled={bezig}>Toevoegen</button>
      </form>
    </div>
  )
}
