import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { dag, datumLabel, dagTijd, hhmm, naarInput, tijd, vanInput } from '../lib/fmt.js'
import { download, maakCsv } from '../lib/files.js'
import { KopieerKnop, Laden, LeerlingLijst, Tabs, Voortgang, useActie, bevestig, bevestigTyp } from '../components/ui.jsx'
import Import from './Import.jsx'
import Gebruikers from './Gebruikers.jsx'
import { WachtwoordWijzigen } from './Login.jsx'

export default function Beheer({ docent }) {
  const [tab, setTab] = useState('start')
  const [versie, setVersie] = useState(0)
  const ververs = () => setVersie((v) => v + 1)
  return (
    <>
      <h1>Beheer</h1>
      <Tabs actief={tab} kies={setTab} tabs={[
        ['start', 'Start'], ['import', 'Lijsten'], ['gebruikers', 'Klassen & gebruikers'], ['rondes', 'Rondes'], ['overzicht', 'Overzicht'], ['beheerders', 'Meer'],
      ]} />
      {tab === 'start' && <Start key={versie} ga={setTab} />}
      {tab === 'import' && <><Import klaar={ververs} /><Klassen key={versie} /></>}
      {tab === 'gebruikers' && <Gebruikers zelf={docent} />}
      {tab === 'rondes' && <Rondes />}
      {tab === 'overzicht' && <Overzicht />}
      {tab === 'beheerders' && <Beheerders zelf={docent} />}
    </>
  )
}

// ------------------------------------------------------------- Stappenlijst
function Start({ ga }) {
  const [s, setS] = useState(null)
  useEffect(() => {
    (async () => {
      const [ll, km, rondes, slots, boek] = await Promise.all([
        supabase.from('leerlingen').select('klas'),
        supabase.from('klas_mentoren').select('klas, docent_id'),
        supabase.from('rondes').select('*, ronde_dagen(id)').order('aangemaakt', { ascending: false }),
        supabase.from('slots').select('ronde_id, docent_id'),
        supabase.from('boekingen').select('ronde_id'),
      ])
      const klassen = [...new Set((ll.data || []).map((x) => x.klas))]
      const metMentor = new Set((km.data || []).map((x) => x.klas))
      const ronde = (rondes.data || []).find((r) => r.open) || (rondes.data || [])[0]
      const mentorenMetTijden = new Set((slots.data || []).filter((x) => x.ronde_id === ronde?.id).map((x) => x.docent_id))
      setS({
        leerlingen: (ll.data || []).length, klassen: klassen.length,
        zonderMentor: klassen.filter((k) => !metMentor.has(k)),
        ronde, mentorenMetTijden: mentorenMetTijden.size, mentorTotaal: new Set((km.data || []).map((x) => x.docent_id)).size,
        boekingen: (boek.data || []).filter((x) => x.ronde_id === ronde?.id).length,
      })
    })()
  }, [])
  if (!s) return <Laden />
  const nu = new Date()
  const openNu = s.ronde?.open && (!s.ronde.inschrijven_vanaf || nu >= new Date(s.ronde.inschrijven_vanaf)) && (!s.ronde.inschrijven_tot || nu < new Date(s.ronde.inschrijven_tot))
  const stappen = [
    { ok: s.leerlingen > 0, titel: 'Leerlingen importeren', tekst: s.leerlingen ? `${s.leerlingen} leerlingen in ${s.klassen} klassen` : 'Export uit Somtoday of Zermelo', tab: 'import' },
    { ok: s.klassen > 0 && !s.zonderMentor.length, titel: 'Mentoren koppelen', tekst: s.zonderMentor.length ? `Nog geen mentor: ${s.zonderMentor.join(', ')}` : s.klassen ? 'Alle klassen hebben een mentor' : '', tab: 'gebruikers' },
    { ok: !!s.ronde && s.ronde.ronde_dagen.length > 0 && !!s.ronde.inschrijven_tot, titel: 'Gespreksronde aanmaken', tekst: s.ronde ? `${s.ronde.naam} · ${s.ronde.ronde_dagen.length} gespreksdag(en)${s.ronde.inschrijven_tot ? '' : ' · sluitdatum ontbreekt'}` : 'Naam, gespreksdagen en sluitdatum', tab: 'rondes' },
    { ok: s.mentorenMetTijden > 0 && s.mentorenMetTijden >= s.mentorTotaal, titel: 'Mentoren vullen hun tijden in', tekst: s.ronde ? `${s.mentorenMetTijden} mentor(en) hebben tijden ingevuld` : 'Na stap 3', tab: 'overzicht' },
    { ok: openNu, titel: 'Inschrijving openen', tekst: openNu ? `Open tot ${dagTijd(s.ronde.inschrijven_tot)} · ${s.boekingen} ingeschreven` : 'Zet de ronde open bij Rondes', tab: 'rondes' },
  ]
  return (
    <div className="kaart">
      <h2>Zo zet je een gespreksronde klaar</h2>
      <ol className="stappen">
        {stappen.map((st, i) => (
          <li key={i} className={st.ok ? 'klaar' : ''}>
            <span className="bol">{st.ok ? '✓' : i + 1}</span>
            <div className="groei"><strong>{st.titel}</strong><div className="zacht klein">{st.tekst}</div></div>
            <button className="secundair" onClick={() => ga(st.tab)}>Open</button>
          </li>
        ))}
      </ol>
      <p className="zacht klein">Mentoren loggen zelf in om hun tijden in te vullen. Stuur ze de link van deze site.</p>
    </div>
  )
}

// ------------------------------------------------------------------- Rondes
function Rondes() {
  const [rondes, setRondes] = useState(null)
  const [naam, setNaam] = useState('')
  const { bezig, voer, melding } = useActie()

  const laad = useCallback(async () => {
    const { data } = await supabase.from('rondes').select('*, ronde_dagen(*)').order('aangemaakt', { ascending: false })
    setRondes(data || [])
  }, [])
  useEffect(() => { laad() }, [laad])

  async function nieuw(e) {
    e.preventDefault()
    await voer(async () => {
      const { error } = await supabase.from('rondes').insert({ naam: naam.trim() })
      if (error) throw error
      setNaam('')
      await laad()
    })
  }

  if (!rondes) return <Laden />
  return (
    <>
      <form className="kaart zoekrij" onSubmit={nieuw}>
        <input placeholder="Naam, bijv. MOL november" value={naam} onChange={(e) => setNaam(e.target.value)} required />
        <button type="submit" disabled={bezig}>Ronde toevoegen</button>
      </form>
      {melding}
      {rondes.map((r) => <Ronde key={r.id} ronde={r} laad={laad} />)}
      {!rondes.length && <p className="zacht">Nog geen gespreksrondes.</p>}
    </>
  )
}

function Ronde({ ronde, laad }) {
  const { bezig, voer, melding } = useActie()
  const [vanaf, setVanaf] = useState(naarInput(ronde.inschrijven_vanaf))
  const [tot, setTot] = useState(naarInput(ronde.inschrijven_tot))
  const [dagForm, setDagForm] = useState({ datum: '', van: '15:00', tot: '20:00' })
  const [open, setOpen] = useState(ronde.open)
  useEffect(() => setOpen(ronde.open), [ronde.open])

  const wijzig = (veld, ok = 'Opgeslagen.') => voer(async () => {
    const { error } = await supabase.from('rondes').update(veld).eq('id', ronde.id)
    if (error) throw error
    await laad()
  }, ok)

  async function verwijderRonde() {
    const antwoord = await bevestigTyp(`Typ VERWIJDER om "${ronde.naam}" met alle tijden en afspraken te verwijderen.`)
    if (antwoord?.trim().toUpperCase() !== 'VERWIJDER') return
    await voer(async () => {
      const { error } = await supabase.from('rondes').delete().eq('id', ronde.id)
      if (error) throw error
      await laad()
    })
  }

  async function dagToevoegen(e) {
    e.preventDefault()
    await voer(async () => {
      const { error } = await supabase.from('ronde_dagen').insert({ ronde_id: ronde.id, ...dagForm })
      if (error) throw error.code === '23505' ? new Error('Deze dag bestaat al.') : error.code === '23514' ? new Error('De eindtijd moet na de begintijd liggen.') : error
      setDagForm({ ...dagForm, datum: '' })
      await laad()
    })
  }

  const [dagBewerk, setDagBewerk] = useState(null) // { id, datum, van, tot }
  async function bewaarDag(e) {
    e.preventDefault()
    await voer(async () => {
      const { id, ...veld } = dagBewerk
      const { error } = await supabase.from('ronde_dagen').update(veld).eq('id', id)
      if (error) throw error.code === '23505' ? new Error('Deze dag bestaat al.') : error.code === '23514' ? new Error('De eindtijd moet na de begintijd liggen.') : error
      setDagBewerk(null)
      await laad()
    }, 'Gespreksdag aangepast. Tijden die mentoren al hebben ingevuld blijven staan.')
  }

  async function verwijderDag(d) {
    if (!await bevestig(`${datumLabel(d.datum)} verwijderen? Tijden die mentoren op deze dag al hebben ingevuld blijven staan.`)) return
    await voer(async () => {
      const { error } = await supabase.from('ronde_dagen').delete().eq('id', d.id)
      if (error) throw error
      await laad()
    })
  }

  const dagen = [...ronde.ronde_dagen].sort((a, b) => a.datum.localeCompare(b.datum))
  const sluitInVerleden = ronde.inschrijven_tot && new Date(ronde.inschrijven_tot) < new Date()

  return (
    <div className="kaart">
      <div className="kop-rij">
        <h2>{ronde.naam}</h2>
        <label className="schakel">
          <input type="checkbox" checked={open}
            onChange={(e) => { setOpen(e.target.checked); wijzig({ open: e.target.checked }, e.target.checked ? 'Ronde staat open.' : 'Ronde is gesloten.') }} />
          <span>{open ? 'Open' : 'Gesloten'}</span>
        </label>
      </div>
      <p className="zacht klein">Open = leerlingen zien de ronde en kunnen inschrijven tussen de twee momenten hieronder. Mentoren kunnen altijd tijden invullen.</p>

      <h3>1. Gespreksdagen</h3>
      <p className="zacht klein">Mentoren kunnen alleen binnen deze dagen en tijden hun beschikbaarheid invullen.</p>
      <ul className="lijst">
        {dagen.map((d) => dagBewerk?.id === d.id ? (
          <li key={d.id}>
            <form className="bewerk" onSubmit={bewaarDag}>
              <input type="date" value={dagBewerk.datum} onChange={(e) => setDagBewerk({ ...dagBewerk, datum: e.target.value })} required />
              <input type="time" value={dagBewerk.van} onChange={(e) => setDagBewerk({ ...dagBewerk, van: e.target.value })} required />
              <input type="time" value={dagBewerk.tot} onChange={(e) => setDagBewerk({ ...dagBewerk, tot: e.target.value })} required />
              <div className="knoppen">
                <button type="submit" disabled={bezig}>Opslaan</button>
                <button type="button" className="secundair" onClick={() => setDagBewerk(null)}>Annuleren</button>
              </div>
            </form>
          </li>
        ) : (
          <li key={d.id}>
            <span>{datumLabel(d.datum)} · {hhmm(d.van)}–{hhmm(d.tot)}</span>
            <span className="rij-acties">
              <button className="link" onClick={() => setDagBewerk({ id: d.id, datum: d.datum, van: hhmm(d.van), tot: hhmm(d.tot) })}>Wijzigen</button>
              <button className="link" onClick={() => verwijderDag(d)}>Verwijderen</button>
            </span>
          </li>
        ))}
        {!dagen.length && <li className="zacht">Nog geen dagen.</li>}
      </ul>
      <form className="dagform" onSubmit={dagToevoegen}>
        <label>Datum<input type="date" value={dagForm.datum} onChange={(e) => setDagForm({ ...dagForm, datum: e.target.value })} required /></label>
        <label>Van<input type="time" value={dagForm.van} onChange={(e) => setDagForm({ ...dagForm, van: e.target.value })} required /></label>
        <label>Tot<input type="time" value={dagForm.tot} onChange={(e) => setDagForm({ ...dagForm, tot: e.target.value })} required /></label>
        <button type="submit" className="secundair" disabled={bezig}>Dag toevoegen</button>
      </form>

      <h3>2. Inschrijfperiode</h3>
      <div className="raster2">
        <label>Inschrijving opent <span className="zacht">(leeg = zodra open)</span>
          <input type="datetime-local" value={vanaf} onChange={(e) => setVanaf(e.target.value)}
            onBlur={() => vanaf !== naarInput(ronde.inschrijven_vanaf) && wijzig({ inschrijven_vanaf: vanInput(vanaf) })} /></label>
        <label>Inschrijving sluit
          <input type="datetime-local" value={tot} onChange={(e) => setTot(e.target.value)}
            onBlur={() => tot !== naarInput(ronde.inschrijven_tot) && wijzig({ inschrijven_tot: vanInput(tot) })} /></label>
      </div>
      {ronde.inschrijven_tot && <p className={sluitInVerleden ? 'waarschuwing klein' : 'zacht klein'}>
        {sluitInVerleden ? 'Let op: de sluitdatum ligt in het verleden. ' : ''}Leerlingen zien: inschrijven tot {dagTijd(ronde.inschrijven_tot)}.</p>}
      {melding}
      <button className="gevaar" onClick={verwijderRonde} disabled={bezig}>Ronde verwijderen</button>
    </div>
  )
}

// ---------------------------------------------------------- Klassen-tabel
function Klassen() {
  const [d, setD] = useState(null)
  useEffect(() => {
    Promise.all([
      supabase.from('klas_mentoren').select('klas, docenten(naam, email)'),
      supabase.from('leerlingen').select('klas'),
    ]).then(([km, ll]) => {
      const perKlas = {}
      for (const l of ll.data || []) perKlas[l.klas] = (perKlas[l.klas] || 0) + 1
      for (const k of km.data || []) perKlas[k.klas] ??= 0
      setD({ km: km.data || [], perKlas })
    })
  }, [])
  if (!d) return null
  const klassen = Object.keys(d.perKlas).sort()
  if (!klassen.length) return null
  return (
    <div className="kaart">
      <h2>Klassen in het portaal</h2>
      <div className="scroll">
        <table className="tabel">
          <thead><tr><th>Klas</th><th>Leerlingen</th><th>Mentor(en)</th></tr></thead>
          <tbody>
            {klassen.map((k) => {
              const m = d.km.filter((x) => x.klas === k).map((x) => x.docenten?.naam)
              return <tr key={k}><td>{k}</td><td>{d.perKlas[k] || <span className="waarschuwing">0</span>}</td>
                <td>{m.length ? m.join(', ') : <span className="waarschuwing">geen mentor</span>}</td></tr>
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- Overzicht
function Overzicht() {
  const [rondes, setRondes] = useState(null)
  const [rondeId, setRondeId] = useState('')
  const [d, setD] = useState(null)

  useEffect(() => {
    supabase.from('rondes').select('*').order('aangemaakt', { ascending: false }).then(({ data }) => {
      setRondes(data || [])
      if (data?.length) setRondeId((data.find((r) => r.open) || data[0]).id)
    })
  }, [])

  useEffect(() => {
    if (!rondeId) return
    setD(null)
    Promise.all([
      supabase.from('leerlingen').select('*').order('naam'),
      supabase.from('boekingen').select('*, slots(start, eind, lokaal, docenten(naam))').eq('ronde_id', rondeId),
      supabase.from('klas_mentoren').select('klas, docent_id, docenten(naam)'),
      supabase.from('slots').select('docent_id').eq('ronde_id', rondeId),
      supabase.from('kan_niet').select('*').eq('ronde_id', rondeId),
    ]).then(([l, b, km, sl, kn]) => setD({ leerlingen: l.data || [], boekingen: b.data || [], km: km.data || [], slots: sl.data || [], kanNiet: kn.data || [] }))
  }, [rondeId])

  const boekingPer = useMemo(() => Object.fromEntries((d?.boekingen || []).map((b) => [b.leerling_id, {
    tekst: `${dag(b.slots.start)} ${tijd(b.slots.start)} · ${b.slots.docenten?.naam || ''}`, opmerking: b.opmerking, b,
  }])), [d])

  if (!rondes) return <Laden />
  if (!rondes.length) return <p className="zacht">Nog geen gespreksrondes.</p>
  if (!d) return <Laden />

  const klassen = [...new Set(d.leerlingen.map((l) => l.klas))].sort()
  const slotsPer = {}
  for (const s of d.slots) slotsPer[s.docent_id] = (slotsPer[s.docent_id] || 0) + 1
  const mentoren = [...new Map(d.km.map((x) => [x.docent_id, x.docenten?.naam])).entries()]
  const zonderTijden = mentoren.filter(([id]) => !slotsPer[id]).map(([, n]) => n)
  const nietIngepland = d.leerlingen.filter((l) => !boekingPer[l.id])

  function exporteer() {
    download('mol-overzicht.csv', maakCsv([
      ['Klas', 'Leerling', 'E-mail', 'Status', 'Dag', 'Tijd', 'Mentor', 'Lokaal', 'Opmerking / reden'],
      ...d.leerlingen.map((l) => {
        const b = boekingPer[l.id]?.b
        const k = d.kanNiet.find((x) => x.leerling_id === l.id)
        return [l.klas, l.naam, l.email, b ? 'Ingepland' : k ? 'Contact nodig' : 'Niet ingepland',
          b ? dag(b.slots.start) : '', b ? tijd(b.slots.start) : '', b?.slots.docenten?.naam || '',
          b?.slots.lokaal || '', b?.opmerking || (k ? `${k.reden}${k.voorkeur ? ' · kan wel: ' + k.voorkeur : ''}` : '')]
      }),
    ]), 'text/csv;charset=utf-8')
  }

  return (
    <>
      <div className="kop-rij">
        <select value={rondeId} onChange={(e) => setRondeId(e.target.value)}>
          {rondes.map((r) => <option key={r.id} value={r.id}>{r.naam}</option>)}
        </select>
        <div className="knoppen">
          <KopieerKnop tekst={nietIngepland.map((l) => l.email).join('; ')} label={`E-mails niet ingepland (${nietIngepland.length})`} />
          <button className="secundair" onClick={exporteer}>Excel (.csv)</button>
        </div>
      </div>
      {!!zonderTijden.length && (
        <div className="melding info">Nog geen tijden ingevuld: <strong>{zonderTijden.join(', ')}</strong></div>
      )}
      <div className="klasraster">
        {klassen.map((k) => {
          const ll = d.leerlingen.filter((l) => l.klas === k)
          const n = ll.filter((l) => boekingPer[l.id]).length
          return (
            <div key={k} className="kaart klaskaart">
              <div className="kop-rij"><strong>{k}</strong><span>{n}/{ll.length}</span></div>
              <div className="zacht klein">{d.km.filter((x) => x.klas === k).map((x) => x.docenten?.naam).join(', ') || 'geen mentor'}</div>
              <Voortgang waarde={n} totaal={ll.length} />
            </div>
          )
        })}
      </div>
      <div className="kaart">
        <h2>Leerlingen ({d.boekingen.length}/{d.leerlingen.length})</h2>
        <LeerlingLijst leerlingen={d.leerlingen} boekingPer={boekingPer} kanNietPer={Object.fromEntries(d.kanNiet.map((k) => [k.leerling_id, k]))} />
      </div>
    </>
  )
}

// -------------------------------------------------------------- Beheerders
function Beheerders({ zelf }) {
  const [lijst, setLijst] = useState([])
  const [form, setForm] = useState({ naam: '', email: '' })
  const { bezig, voer, melding } = useActie()

  const [wwStatus, setWwStatus] = useState({}) // email → { heeft_wachtwoord, laatst_ingelogd }
  const laad = useCallback(async () => {
    const [{ data }, st] = await Promise.all([
      supabase.from('docenten').select('*').eq('is_admin', true).order('naam'),
      supabase.rpc('beheer_wachtwoord_status'),
    ])
    setLijst(data || [])
    setWwStatus(Object.fromEntries((st.data || []).map((x) => [x.email, x])))
  }, [])
  useEffect(() => { laad() }, [laad])

  async function voegToe(e) {
    e.preventDefault()
    const email = form.email.trim().toLowerCase()
    await voer(async () => {
      const bestaand = await supabase.from('docenten').select('id').eq('email', email).maybeSingle()
      const { error } = bestaand.data
        ? await supabase.from('docenten').update({ is_admin: true }).eq('id', bestaand.data.id)
        : await supabase.from('docenten').insert({ email, naam: form.naam.trim() || email, is_admin: true })
      if (error) throw error
      setForm({ naam: '', email: '' })
      await laad()
    }, 'Beheerder toegevoegd.')
  }

  async function verwijder(d) {
    if (!await bevestig(`${d.naam} is dan geen beheerder meer. Doorgaan?`)) return
    await voer(async () => {
      const { error } = await supabase.from('docenten').update({ is_admin: false }).eq('id', d.id)
      if (error) throw error
      await laad()
    })
  }

  // Wachtwoord instellen voor een andere beheerder (functie beheer_zet_wachtwoord, zie supabase/beheer-wachtwoord.sql)
  const [wwVoor, setWwVoor] = useState(null)
  const [ww, setWw] = useState({ a: '', b: '' })
  async function zetWachtwoord(e, d) {
    e.preventDefault()
    await voer(async () => {
      if (ww.a.length < 10) throw new Error('Kies een wachtwoord van minstens 10 tekens.')
      if (ww.a !== ww.b) throw new Error('De wachtwoorden zijn niet gelijk.')
      const { error } = await supabase.rpc('beheer_zet_wachtwoord', { p_email: d.email, p_ww: ww.a })
      if (error) throw error.code === 'PGRST202' ? new Error('De functie ontbreekt nog in Supabase: voer supabase/beheer-wachtwoord.sql uit.') : error
      setWwVoor(null)
      setWw({ a: '', b: '' })
      await laad()
    }, `Wachtwoord ingesteld voor ${d.naam}. Geef het persoonlijk door; ${d.naam} kan het daarna zelf wijzigen bij Meer.`)
  }

  // Ingelogd met een wachtwoord-account? Dan kan de beheerder hier zijn wachtwoord wijzigen
  const [metWachtwoord, setMetWachtwoord] = useState(false)
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMetWachtwoord((data.user?.app_metadata?.providers || []).includes('email')))
  }, [])

  async function opschonen() {
    if (!await bevestig('Rondes waarvan de laatste gespreksdag meer dan 30 dagen geleden was, worden met alle afspraken en opmerkingen verwijderd. Doorgaan?')) return
    await voer(async () => {
      const { data, error } = await supabase.rpc('verwijder_oude_data')
      if (error) throw error
      if (!data) throw new Error('Er waren geen oude rondes om te verwijderen.')
    }, 'Oude gegevens verwijderd.')
  }

  return (
    <>
      <div className="kaart">
        <h2>Beheerders</h2>
        <ul className="lijst">
          {lijst.map((d) => (
            <li key={d.id}>
              {wwVoor === d.id ? (
                <form className="bewerk" onSubmit={(e) => zetWachtwoord(e, d)}>
                  <strong>Wachtwoord voor {d.naam}</strong>
                  <input type="password" autoComplete="new-password" placeholder="Nieuw wachtwoord (min. 10 tekens)" value={ww.a} onChange={(e) => setWw({ ...ww, a: e.target.value })} required minLength={10} />
                  <input type="password" autoComplete="new-password" placeholder="Herhaal wachtwoord" value={ww.b} onChange={(e) => setWw({ ...ww, b: e.target.value })} required />
                  <div className="knoppen">
                    <button type="submit" disabled={bezig}>Opslaan</button>
                    <button type="button" className="secundair" onClick={() => setWwVoor(null)}>Annuleren</button>
                  </div>
                </form>
              ) : (
                <>
                  <span><strong>{d.naam}</strong> <span className="zacht">{d.email}</span>
                    {wwStatus[d.email] && (wwStatus[d.email].heeft_wachtwoord
                      ? <span className="slot-icoon" role="img" aria-label="Wachtwoord ingesteld" title="Wachtwoord ingesteld">🔒</span>
                      : <span className="label open slot-label">nog geen wachtwoord</span>)}
                    {wwStatus[d.email]?.laatst_ingelogd && <span className="zacht klein"> · laatst ingelogd {dagTijd(wwStatus[d.email].laatst_ingelogd)}</span>}
                  </span>
                  {d.id !== zelf.id && (
                    <span className="rij-acties">
                      <button className="link" onClick={() => { setWw({ a: '', b: '' }); setWwVoor(d.id) }}>Wachtwoord instellen</button>
                      <button className="link" onClick={() => verwijder(d)}>Verwijderen</button>
                    </span>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
        <form onSubmit={voegToe}>
          <div className="raster2">
            <label>Naam<input value={form.naam} onChange={(e) => setForm({ ...form, naam: e.target.value })} placeholder="Bijv. A. Jansen" /></label>
            <label>E-mail<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required placeholder="naam@school.nl" /></label>
          </div>
          <button type="submit" disabled={bezig}>Beheerder toevoegen</button>
        </form>
      </div>
      {metWachtwoord && <WachtwoordWijzigen />}
      <LokalenBeheer />
      <div className="kaart">
        <h2>Privacy: oude gegevens opschonen</h2>
        <p className="zacht">Verwijdert rondes, afspraken en opmerkingen waarvan de laatste gespreksdag meer dan 30 dagen geleden was.
          Kan ook automatisch elke nacht (zie handleiding).</p>
        <button className="secundair" onClick={opschonen} disabled={bezig}>Nu opschonen</button>
      </div>
      {melding}
    </>
  )
}

// ------------------------------------------------------------- Lokalen
function LokalenBeheer() {
  const [lijst, setLijst] = useState([])
  const [nieuw, setNieuw] = useState('')
  const { bezig, voer, melding } = useActie()
  const laad = useCallback(async () => {
    const { data } = await supabase.from('lokalen').select('naam, volgorde, capaciteit').order('volgorde').order('naam')
    setLijst(data || [])
  }, [])
  useEffect(() => { laad() }, [laad])
  async function voegToe(e) {
    e.preventDefault()
    const namen = nieuw.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean)
    if (!namen.length) return
    const start = lijst.reduce((m, l) => Math.max(m, l.volgorde), 0)
    await voer(async () => {
      const { error } = await supabase.from('lokalen').upsert(namen.map((naam, i) => ({ naam, volgorde: start + i + 1 })), { onConflict: 'naam', ignoreDuplicates: true })
      if (error) throw error
      setNieuw('')
      await laad()
    })
  }
  async function zetCapaciteit(naam, capaciteit) {
    await voer(async () => {
      const { error } = await supabase.from('lokalen').update({ capaciteit }).eq('naam', naam)
      if (error) throw error
      await laad()
    }, `${naam}: maximaal ${capaciteit} gesprek${capaciteit === 1 ? '' : 'ken'} tegelijk.`)
  }
  async function verwijder(naam) {
    if (!await bevestig(`Lokaal ${naam} uit de lijst halen? Bestaande afspraken in dit lokaal blijven staan.`, { knop: 'Uit lijst halen' })) return
    await voer(async () => {
      const { error } = await supabase.from('lokalen').delete().eq('naam', naam)
      if (error) throw error
      await laad()
    })
  }
  return (
    <div className="kaart">
      <h2>Lokalen</h2>
      <p className="zacht klein">Mentoren kiezen uit deze lijst bij het invullen van hun tijden (of typen zelf een lokaal).
        Het getal is het aantal gesprekken dat tegelijk in het lokaal mag (standaard 2, kleine kamers 1). Een lokaal dat niet in de lijst staat: 2.</p>
      <div className="chips">
        {lijst.map((l) => (
          <span key={l.naam} className="chip">{l.naam}
            <select className="cap" value={l.capaciteit ?? 2} disabled={bezig} aria-label={`Gesprekken tegelijk in ${l.naam}`}
              onChange={(e) => zetCapaciteit(l.naam, +e.target.value)}>
              {[1, 2, 3].map((n) => <option key={n} value={n}>{n}×</option>)}
            </select>
            <button className="link" aria-label={`${l.naam} verwijderen`} onClick={() => verwijder(l.naam)}>✕</button>
          </span>
        ))}
        {!lijst.length && <span className="zacht">Nog geen lokalen.</span>}
      </div>
      <form className="zoekrij" onSubmit={voegToe}>
        <input placeholder="Nieuw lokaal, of meerdere met komma's: m301, m302" value={nieuw} onChange={(e) => setNieuw(e.target.value)} />
        <button type="submit" disabled={bezig}>Toevoegen</button>
      </form>
      {melding}
    </div>
  )
}
