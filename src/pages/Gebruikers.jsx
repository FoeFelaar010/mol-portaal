import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { Laden, useActie, bevestig, bevestigTyp } from '../components/ui.jsx'
import Leerling from './Leerling.jsx'
import { download, maakCsv } from '../lib/files.js'

const hoofdKlas = (k) => String(k || '').trim().toUpperCase()
const geldigMail = (m) => /^\S+@\S+\.\S+$/.test(m)
// Nette melding bij dubbel e-mailadres
const dbFout = (error) => (error.code === '23505' ? new Error('Dit e-mailadres bestaat al.') : error)

export default function Gebruikers({ zelf }) {
  const [soort, setSoort] = useState('klassen')
  const [d, setD] = useState(null)
  const [bekijk, setBekijk] = useState(null) // leerling waarvan de beheerder het scherm bekijkt

  const laad = useCallback(async () => {
    const [doc, ll, km, cs, dcs] = await Promise.all([
      supabase.from('docenten').select('*').order('naam'),
      supabase.from('leerlingen').select('*').order('naam'),
      supabase.from('klas_mentoren').select('klas, docent_id'),
      supabase.rpc('beheer_code_status'),
      supabase.rpc('beheer_docentcode_status'),
    ])
    setD({
      docenten: doc.data || [], leerlingen: ll.data || [], km: km.data || [],
      codes: Object.fromEntries((cs.data || []).map((x) => [x.leerling_id, x.aangemaakt])),
      docentCodes: Object.fromEntries((dcs.data || []).map((x) => [x.docent_id, x.aangemaakt])),
    })
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
      const { error } = await supabase.from('docenten').update({ naam: bewerk.naam.trim(), email, weergavenaam: (bewerk.weergavenaam || '').trim() || null }).eq('id', bewerk.id)
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

  // --- Inlogcodes en SSO voor docenten (zie supabase/docentcodes.sql). Beheerders krijgen geen code. ---
  const [nieuweCodes, setNieuweCodes] = useState(null)
  const zonderSso = lijst.filter((x) => !x.sso && !x.is_admin)
  const metSso = lijst.filter((x) => x.sso && !x.is_admin)
  const metCode = zonderSso.filter((x) => d.docentCodes[x.id])
  const groep = zoek ? `deze ${lijst.length} docenten` : `alle ${lijst.length} docenten`

  async function maakCodes(wie = zonderSso) {
    if (!wie.length) return
    const oud = wie.filter((x) => d.docentCodes[x.id]).length
    if ((wie.length > 1 || oud) && !await bevestig(`${oud ? 'Nieuwe inlogcode' : 'Inlogcode'}${wie.length > 1 ? 's' : ''} maken voor ${wie.length === 1 ? wie[0].naam : `${wie.length} docenten zonder SSO`}?`
      + (oud ? ` ${oud === 1 && wie.length === 1 ? 'De oude code' : `${oud} oude code${oud === 1 ? '' : 's'}`} werkt daarna niet meer.` : ''), { knop: 'Codes maken' })) return
    await voer(async () => {
      const { data, error } = await supabase.rpc('maak_docentcodes', { p_docenten: wie.map((x) => x.id) })
      if (error) throw error
      setNieuweCodes(data || [])
      await laad()
    }, 'Inlogcodes gemaakt.')
  }

  async function toonCodes(wie) {
    await voer(async () => {
      const { data, error } = await supabase.rpc('beheer_docentcodes', { p_docenten: wie.map((x) => x.id) })
      if (error) throw error
      setNieuweCodes(data || [])
    })
  }

  async function zetSso(ids, aan) {
    if (!ids.length) return
    if (ids.length > 1 && !await bevestig(aan
      ? `SSO aanzetten voor ${ids.length} docenten? Hun inlogcodes werken dan direct niet meer; ze loggen in met Microsoft.`
      : `SSO uitzetten voor ${ids.length} docenten? Ze hebben dan een nieuwe inlogcode nodig.`, { knop: aan ? 'SSO aanzetten' : 'SSO uitzetten' })) return
    await voer(async () => {
      const { error } = await supabase.rpc('zet_sso_docent', { p_docenten: ids, p_aan: aan })
      if (error) throw error
      await laad()
    }, `SSO ${aan ? 'aan' : 'uit'} voor ${ids.length} docent${ids.length === 1 ? '' : 'en'}.`)
  }

  function printCodes() {
    document.body.classList.add('print-codes')
    window.print()
    setTimeout(() => document.body.classList.remove('print-codes'), 500)
  }

  return (
    <div className="kaart">
      <h2>Docenten</h2>
      <input placeholder="Zoek naam, e-mail of klas" value={zoek} onChange={(e) => setZoek(e.target.value)} />
      {melding}
      {nieuweCodes && (
        <div className="kaart info codelijst">
          <div className="kop-rij">
            <h3>Inlogcodes docenten ({nieuweCodes.length})</h3>
            <div className="knoppen">
              <button className="secundair" onClick={printCodes}>Printen</button>
              <button className="secundair" onClick={() => download('mol-inlogcodes-docenten.csv', maakCsv([['Docent', 'Inlogcode'],
                ...nieuweCodes.map((c) => [c.naam, c.code])]), 'text/csv;charset=utf-8')}>Excel (.csv)</button>
              <button className="link" onClick={() => setNieuweCodes(null)}>Sluiten</button>
            </div>
          </div>
          <p className="zacht klein">Geef elke docent persoonlijk zijn of haar code. Inloggen: MOL-portaal → “Andere manier van inloggen” → Inlogcode.
            De code werkt tot SSO bij de docent aan staat. Beheerders krijgen geen code.</p>
          <div className="scroll">
            <table className="tabel">
              <thead><tr><th>Docent</th><th>Inlogcode</th></tr></thead>
              <tbody>{nieuweCodes.map((c) => <tr key={c.docent_id}><td>{c.naam}</td>
                <td>{c.code ? <code className="code">{c.code}</code> : <span className="zacht klein">niet meer te tonen: maak een nieuwe</span>}</td></tr>)}</tbody>
            </table>
          </div>
          {!nieuweCodes.length && <p className="zacht">Geen codes gevonden.</p>}
        </div>
      )}
      {!!lijst.length && (
        <div className="knoppen codeknoppen">
          <span className="zacht klein">Voor {groep} · {metSso.length} met SSO, {metCode.length} met code:</span>
          <button className="secundair" disabled={bezig || !metCode.length} onClick={() => toonCodes(metCode)}>Codes tonen/printen ({metCode.length})</button>
          <button className="secundair" disabled={bezig || !zonderSso.length} onClick={() => maakCodes()}>Nieuwe codes maken ({zonderSso.length})</button>
          <button className="secundair" disabled={bezig || !zonderSso.length} onClick={() => zetSso(zonderSso.map((x) => x.id), true)}>SSO aan ({zonderSso.length})</button>
          <button className="secundair" disabled={bezig || !metSso.length} onClick={() => zetSso(metSso.map((x) => x.id), false)}>SSO uit ({metSso.length})</button>
        </div>
      )}
      <ul className="lijst">
        {lijst.map((x) => bewerk?.id === x.id ? (
          <li key={x.id}>
            <form className="bewerk" onSubmit={bewaar}>
              <input value={bewerk.naam} onChange={(e) => setBewerk({ ...bewerk, naam: e.target.value })} placeholder="Naam" required />
              <input type="email" value={bewerk.email} onChange={(e) => setBewerk({ ...bewerk, email: e.target.value })} placeholder="E-mail" required />
              <input value={bewerk.weergavenaam || ''} onChange={(e) => setBewerk({ ...bewerk, weergavenaam: e.target.value })} maxLength={40} placeholder="Naam voor ouders, bijv. Dhr. Bonte" />
              <div className="knoppen">
                <button type="submit" disabled={bezig}>Opslaan</button>
                <button type="button" className="secundair" onClick={() => setBewerk(null)}>Annuleren</button>
              </div>
            </form>
          </li>
        ) : (
          <li key={x.id}>
            <div>
              <strong>{x.naam}</strong> {x.weergavenaam && <span className="zacht">({x.weergavenaam})</span>} {x.is_admin && <span className="label">beheerder</span>}
              <div className="zacht klein">{x.email}{klassenVan(x.id).length ? ` · mentor ${klassenVan(x.id).join(', ')}` : ''}</div>
            </div>
            <div className="rij-acties">
              {!x.is_admin && !x.sso && (d.docentCodes[x.id]
                ? <button className="link" disabled={bezig} title={`Code gemaakt ${new Date(d.docentCodes[x.id]).toLocaleDateString('nl-NL')}`} onClick={() => toonCodes([x])}>Code tonen</button>
                : <button className="link" disabled={bezig} onClick={() => maakCodes([x])}>Code maken</button>)}
              {!x.is_admin && (
                <label className="sso-vink" title="Aan = alleen inloggen met Microsoft; de inlogcode werkt niet meer">
                  <input type="checkbox" checked={!!x.sso} disabled={bezig} onChange={(e) => zetSso([x.id], e.target.checked)} /> SSO
                </label>
              )}
              <button className="link" onClick={() => setBewerk({ id: x.id, naam: x.naam, email: x.email, weergavenaam: x.weergavenaam || '' })}>Wijzigen</button>
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

  // Alle leerlingen die nu in de lijst staan (na zoeken/klasfilter) in één keer verwijderen
  async function verwijderAlle() {
    const ids = gevonden.map((l) => l.id)
    if (!ids.length) return
    let afspraken = 0
    for (let i = 0; i < ids.length; i += 200) {
      const { count } = await supabase.from('boekingen').select('id', { count: 'exact', head: true }).in('leerling_id', ids.slice(i, i + 200))
      afspraken += count || 0
    }
    const wie = klas || zoek ? `${ids.length} leerlingen${klas ? ` uit ${klas}` : ''}${zoek ? ` (zoekterm “${zoek}”)` : ''}` : `alle ${ids.length} leerlingen`
    const tekst = `${wie[0].toUpperCase()}${wie.slice(1)} verwijderen?${afspraken ? ` Ook ${afspraken} afspra${afspraken === 1 ? 'ak' : 'ken'} gaan weg.` : ''} Mentoren en klassen-koppelingen blijven staan. Typ VERWIJDER om door te gaan.`
    if (!await bevestigTyp(tekst)) return
    await voer(async () => {
      for (let i = 0; i < ids.length; i += 200) {
        const { error } = await supabase.from('leerlingen').delete().in('id', ids.slice(i, i + 200))
        if (error) throw error
      }
      setBewerk(null)
      await laad()
    }, `${ids.length} leerlingen verwijderd.`)
  }

  // --- Inlogcodes en SSO (zie supabase/inlogcodes.sql) ---
  const [nieuweCodes, setNieuweCodes] = useState(null) // [{naam, klas, code}] — alleen nu zichtbaar
  const groep = klas || zoek ? `deze ${gevonden.length} leerlingen` : `alle ${gevonden.length} leerlingen`
  const zonderSso = gevonden.filter((l) => !l.sso)

  async function maakCodes(wie = zonderSso) {
    if (!wie.length) return
    const metCode = wie.filter((l) => d.codes[l.id]).length
    if ((wie.length > 1 || metCode) && !await bevestig(`${metCode ? 'Nieuwe inlogcode' : 'Inlogcode'}${wie.length > 1 ? 's' : ''} maken voor ${wie.length === 1 ? wie[0].naam : `${wie.length} leerlingen zonder SSO`}?`
      + (metCode ? ` ${metCode === 1 && wie.length === 1 ? 'De oude code' : `${metCode} oude code${metCode === 1 ? '' : 's'}`} werkt daarna niet meer.` : ''), { knop: 'Codes maken' })) return
    await voer(async () => {
      const { data, error } = await supabase.rpc('maak_inlogcodes', { p_leerlingen: wie.map((l) => l.id) })
      if (error) throw error
      setNieuweCodes(data || [])
      await laad()
    }, 'Inlogcodes gemaakt.')
  }

  // Bestaande codes tonen en printen (zonder ze te vernieuwen)
  async function toonCodes(wie) {
    await voer(async () => {
      const { data, error } = await supabase.rpc('beheer_codes', { p_leerlingen: wie.map((l) => l.id) })
      if (error) throw error
      setNieuweCodes(data || [])
    })
  }

  async function zetSso(ids, aan) {
    if (!ids.length) return
    if (ids.length > 1 && !await bevestig(aan
      ? `SSO aanzetten voor ${ids.length} leerlingen? Hun inlogcodes werken dan direct niet meer; ze loggen in met Office 365.`
      : `SSO uitzetten voor ${ids.length} leerlingen? Ze hebben dan een nieuwe inlogcode nodig.`, { knop: aan ? 'SSO aanzetten' : 'SSO uitzetten' })) return
    await voer(async () => {
      for (let i = 0; i < ids.length; i += 200) {
        const { error } = await supabase.rpc('zet_sso', { p_leerlingen: ids.slice(i, i + 200), p_aan: aan })
        if (error) throw error
      }
      await laad()
    }, `SSO ${aan ? 'aan' : 'uit'} voor ${ids.length} leerling${ids.length === 1 ? '' : 'en'}.`)
  }

  function printCodes() {
    document.body.classList.add('print-codes')
    window.print()
    setTimeout(() => document.body.classList.remove('print-codes'), 500)
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
      {nieuweCodes && (
        <div className="kaart info codelijst">
          <div className="kop-rij">
            <h3>Inlogcodes ({nieuweCodes.length})</h3>
            <div className="knoppen">
              <button className="secundair" onClick={printCodes}>Printen</button>
              <button className="secundair" onClick={() => download('mol-inlogcodes.csv', maakCsv([['Klas', 'Leerling', 'Inlogcode'],
                ...nieuweCodes.map((c) => [c.klas, c.naam, c.code])]), 'text/csv;charset=utf-8')}>Excel (.csv)</button>
              <button className="link" onClick={() => setNieuweCodes(null)}>Sluiten</button>
            </div>
          </div>
          <p className="zacht klein">Geef elke leerling persoonlijk zijn of haar code. Inloggen: MOL-portaal → “Andere manier van inloggen” → Inlogcode.
            De code werkt tot SSO bij de leerling aan staat.</p>
          <div className="scroll">
            <table className="tabel">
              <thead><tr><th>Klas</th><th>Leerling</th><th>Inlogcode</th></tr></thead>
              <tbody>{nieuweCodes.map((c) => <tr key={c.leerling_id}><td>{c.klas}</td><td>{c.naam}</td>
                <td>{c.code ? <code className="code">{c.code}</code> : <span className="zacht klein">oude code, niet meer te tonen: maak een nieuwe</span>}</td></tr>)}</tbody>
            </table>
          </div>
          {!nieuweCodes.length && <p className="zacht">Geen codes gevonden.</p>}
        </div>
      )}
      {!!gevonden.length && (
        <div className="knoppen codeknoppen">
          <span className="zacht klein">Voor {groep} · {gevonden.filter((l) => l.sso).length} met SSO, {zonderSso.filter((l) => d.codes[l.id]).length} met code:</span>
          <button className="secundair" disabled={bezig || !zonderSso.some((l) => d.codes[l.id])} onClick={() => toonCodes(zonderSso.filter((l) => d.codes[l.id]))}>
            Codes tonen/printen ({zonderSso.filter((l) => d.codes[l.id]).length})</button>
          <button className="secundair" disabled={bezig || !zonderSso.length} onClick={() => maakCodes()}>Nieuwe codes maken ({zonderSso.length})</button>
          <button className="secundair" disabled={bezig || !zonderSso.length} onClick={() => zetSso(zonderSso.map((l) => l.id), true)}>SSO aan ({zonderSso.length})</button>
          <button className="secundair" disabled={bezig || zonderSso.length === gevonden.length} onClick={() => zetSso(gevonden.filter((l) => l.sso).map((l) => l.id), false)}>
            SSO uit ({gevonden.length - zonderSso.length})</button>
        </div>
      )}
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
              {!l.sso && (d.codes[l.id]
                ? <button className="link" disabled={bezig} title={`Code gemaakt ${new Date(d.codes[l.id]).toLocaleDateString('nl-NL')}`} onClick={() => toonCodes([l])}>Code tonen</button>
                : <button className="link" disabled={bezig} onClick={() => maakCodes([l])}>Code maken</button>)}
              <label className="sso-vink" title="Aan = inloggen met Office 365; de inlogcode werkt niet meer">
                <input type="checkbox" checked={!!l.sso} disabled={bezig} onChange={(e) => zetSso([l.id], e.target.checked)} /> SSO
              </label>
              <button className="link" onClick={() => { bekijk(l); window.scrollTo(0, 0) }}>Bekijken</button>
              <button className="link" onClick={() => setBewerk({ ...l })}>Wijzigen</button>
              <button className="link" disabled={bezig} onClick={() => verwijder(l)}>Verwijderen</button>
            </div>
          </li>
        ))}
        {!lijst.length && <li className="zacht">Geen leerlingen gevonden.</li>}
      </ul>
      {gevonden.length > MAX && <p className="zacht klein">{MAX} van {gevonden.length} getoond. Zoek of kies een klas om te verfijnen.</p>}
      {!!gevonden.length && (
        <p><button className="gevaar" disabled={bezig} onClick={verwijderAlle}>
          {klas || zoek ? `Deze ${gevonden.length} leerlingen verwijderen` : `Alle ${gevonden.length} leerlingen verwijderen`}
        </button></p>
      )}
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
