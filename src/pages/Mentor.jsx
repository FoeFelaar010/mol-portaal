import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { dag, dagKey, dagTijd, datumLabel, hhmm, perDag, tijd } from '../lib/fmt.js'
import { download, maakCsv, maakIcs } from '../lib/files.js'
import { KopieerKnop, Laden, LeerlingLijst, Statistiek, Tabs, useActie, bevestig, bevestigTyp } from '../components/ui.jsx'
import { SCHOOL } from '../config.js'

export default function Mentor({ docent }) {
  const [rondes, setRondes] = useState(null)
  const [rondeId, setRondeId] = useState('')
  const [tab, setTab] = useState('overzicht')

  useEffect(() => {
    supabase.from('rondes').select('*').order('aangemaakt', { ascending: false }).then(({ data }) => {
      setRondes(data || [])
      const eerste = (data || []).find((r) => r.open) || (data || [])[0]
      if (eerste) setRondeId(eerste.id)
    })
  }, [])

  if (!rondes) return <Laden />
  const ronde = rondes.find((r) => r.id === rondeId)

  return (
    <>
      <h1>Hoi {docent.naam.split(' ')[0]}</h1>
      {!rondes.length && <div className="kaart"><p>Er is nog geen gespreksronde aangemaakt door de beheerder.</p></div>}
      {!!rondes.length && (
        <>
          <label className="inline">Gespreksronde
            <select value={rondeId} onChange={(e) => setRondeId(e.target.value)}>
              {rondes.map((r) => <option key={r.id} value={r.id}>{r.naam}{r.open ? ' (open)' : ' (dicht)'}</option>)}
            </select>
          </label>
          <Tabs actief={tab} kies={setTab} tabs={[
            ['overzicht', 'Overzicht'], ['beschikbaarheid', 'Tijden'],
            ['inplannen', 'Inplannen'], ['instellingen', 'Info'],
          ]} />
          {ronde && <MentorRonde key={ronde.id + tab} tab={tab} ronde={ronde} docent={docent} />}
        </>
      )}
    </>
  )
}

function useMentorData(ronde, docent) {
  const [data, setData] = useState(null)
  const laad = useCallback(async () => {
    const [km, slots, dagen] = await Promise.all([
      supabase.from('klas_mentoren').select('klas, docent_id, docenten(naam)'),
      supabase.from('slots').select('*, boekingen(id, opmerking, door_mentor, leerling_id, leerlingen(naam, klas, email))')
        .eq('ronde_id', ronde.id).eq('docent_id', docent.id).order('start'),
      supabase.from('ronde_dagen').select('*').eq('ronde_id', ronde.id).order('datum'),
    ])
    const mijnKlassen = [...new Set((km.data || []).filter((k) => k.docent_id === docent.id).map((k) => k.klas))].sort()
    const collegas = (km.data || []).filter((k) => mijnKlassen.includes(k.klas))
    let leerlingen = []
    let boekingen = []
    let kanNiet = []
    if (mijnKlassen.length) {
      const l = await supabase.from('leerlingen').select('*').in('klas', mijnKlassen).order('naam')
      leerlingen = l.data || []
      if (leerlingen.length) {
        const b = await supabase.from('boekingen').select('*, slots(start, eind, docent_id, docenten(naam))')
          .eq('ronde_id', ronde.id).in('leerling_id', leerlingen.map((x) => x.id))
        boekingen = b.data || []
        const k = await supabase.from('kan_niet').select('*').eq('ronde_id', ronde.id).in('leerling_id', leerlingen.map((x) => x.id))
        kanNiet = k.data || []
      }
    }
    // Duo-mentoren: ook de slots van collega-mentoren van mijn klassen (voor 'Hele klas')
    const andereIds = [...new Set(collegas.map((c) => c.docent_id).filter((id) => id !== docent.id))]
    let klasSlots = []
    if (andereIds.length) {
      const ks = await supabase.from('slots').select('*, docenten(naam), boekingen(id, opmerking, door_mentor, leerling_id, leerlingen(naam, klas, email))')
        .eq('ronde_id', ronde.id).in('docent_id', andereIds).order('start')
      klasSlots = ks.data || []
    }
    setData({ mijnKlassen, collegas, klasSlots, slots: slots.data || [], dagen: dagen.data || [], leerlingen, boekingen, kanNiet })
  }, [ronde.id, docent.id])
  useEffect(() => { laad() }, [laad])
  return [data, laad]
}

function MentorRonde({ tab, ronde, docent }) {
  const [data, laad] = useMentorData(ronde, docent)
  if (!data) return <Laden />
  if (tab === 'overzicht') return <Overzicht ronde={ronde} docent={docent} data={data} laad={laad} />
  if (tab === 'beschikbaarheid') return <Beschikbaarheid ronde={ronde} docent={docent} data={data} laad={laad} />
  if (tab === 'inplannen') return <Inplannen data={data} laad={laad} />
  return <Instellingen ronde={ronde} docent={docent} data={data} laad={laad} />
}

// ---------------------------------------------------------------- Overzicht
function Overzicht({ ronde, docent, data, laad }) {
  const { bezig, voer, melding } = useActie()
  const geboekt = data.slots.filter((s) => s.boekingen)
  const boekingPer = useMemo(() => Object.fromEntries(data.boekingen.map((b) => [b.leerling_id, {
    tekst: `${dag(b.slots.start)} ${tijd(b.slots.start)} · ${b.slots.docenten?.naam || ''}`, opmerking: b.opmerking,
  }])), [data.boekingen])
  const nietIngepland = data.leerlingen.filter((l) => !boekingPer[l.id])
  const kanNietPer = Object.fromEntries(data.kanNiet.map((k) => [k.leerling_id, k]))
  const kanNietLijst = nietIngepland.filter((l) => kanNietPer[l.id])

  function agenda() {
    download(`mol-${ronde.naam}.ics`.replace(/\s+/g, '-'), maakIcs(geboekt.map((s) => ({
      id: s.id, start: s.start, eind: s.eind,
      titel: `MOL: ${s.boekingen.leerlingen.naam} (${s.boekingen.leerlingen.klas})`,
      locatie: s.lokaal ? `Lokaal ${s.lokaal}` : '',
      omschrijving: s.boekingen.opmerking ? `Opmerking: ${s.boekingen.opmerking}` : '',
    }))), 'text/calendar')
  }
  function csv() {
    download(`mol-${docent.naam}.csv`.replace(/\s+/g, '-'), maakCsv([
      ['Dag', 'Start', 'Eind', 'Lokaal', 'Leerling', 'Klas', 'Opmerking'],
      ...data.slots.map((s) => [dag(s.start), tijd(s.start), tijd(s.eind), s.lokaal || '',
        s.boekingen?.leerlingen.naam || '', s.boekingen?.leerlingen.klas || '', s.boekingen?.opmerking || '']),
    ]), 'text/csv;charset=utf-8')
  }
  async function annuleer(b) {
    if (!await bevestig(`Afspraak van ${b.leerlingen.naam} annuleren?`)) return
    await voer(async () => {
      const { error } = await supabase.rpc('mentor_annuleer', { p_boeking: b.id })
      if (error) throw error
      await laad()
    }, 'Afspraak geannuleerd.')
  }

  return (
    <>
      <Statistiek items={[
        [data.boekingen.length, 'Ingepland'],
        [kanNietLijst.length, 'Contact nodig'],
        [nietIngepland.length - kanNietLijst.length, 'Niet ingepland'],
        [data.slots.length - geboekt.length, 'Vrije slots'],
      ]} />
      {!!kanNietLijst.length && (
        <div className="melding fout">
          <strong>{kanNietLijst.length} {kanNietLijst.length === 1 ? 'leerling geeft' : 'leerlingen geven'} aan dat geen moment past.</strong> Neem contact op en plan
          in via <em>Inplannen</em>. Je kunt daarvoor ook een extra tijd toevoegen bij <em>Tijden</em>.
        </div>
      )}
      <Uitnodiging ronde={ronde} docent={docent} />
      {melding}
      <div className="kaart">
        <div className="kop-rij">
          <h2>Gespreksagenda</h2>
          <div className="knoppen">
            <button className="secundair" onClick={csv} disabled={!data.slots.length}>Excel (.csv)</button>
            <button className="secundair" onClick={() => window.print()}>Printen</button>
          </div>
        </div>
        <AgendaRaster data={data} docent={docent} bezig={bezig} annuleer={annuleer} />
      </div>
      <AgendaKoppeling docent={docent} geboekt={geboekt.length} downloaden={agenda} />
      {!!data.leerlingen.length && (
        <div className="kaart">
          <div className="kop-rij">
            <h2>Mijn leerlingen ({data.boekingen.length}/{data.leerlingen.length})</h2>
            <KopieerKnop label={`E-mails niet ingepland (${nietIngepland.length})`}
              tekst={nietIngepland.map((l) => l.email).join('; ')} />
          </div>
          <p className="zacht klein">Kopieer de e-mailadressen en plak ze in Outlook (BCC) om een herinnering te sturen.</p>
          <LeerlingLijst leerlingen={data.leerlingen} boekingPer={boekingPer} kanNietPer={kanNietPer} />
        </div>
      )}
    </>
  )
}

// Compacte agenda: blokjes per dag, inklapbaar, duo-weergave 'Hele klas'
const MENTOR_KLEUREN = ['#5b2a86', '#0f766e', '#b45309', '#1d4ed8']
function AgendaRaster({ data, docent, bezig, annuleer }) {
  const [alles, setAlles] = useState(false)
  const [heleKlas, setHeleKlas] = useState(false)
  const [dicht, setDicht] = useState({})
  const [open, setOpen] = useState(null)
  const duo = data.klasSlots.length > 0 || new Set(data.collegas.map((c) => c.docent_id)).size > 1
  const eigen = data.slots.map((s) => ({ ...s, mentor: docent.naam }))
  const anderen = data.klasSlots.map((s) => ({ ...s, mentor: s.docenten?.naam || '' }))
  const bron = heleKlas ? [...eigen, ...anderen].sort((a, b) => a.start.localeCompare(b.start)) : eigen
  const mentoren = [...new Set([docent.naam, ...anderen.map((s) => s.mentor)])]
  const kleur = (m) => MENTOR_KLEUREN[mentoren.indexOf(m) % MENTOR_KLEUREN.length]
  const tellers = mentoren.map((m) => [m, data.boekingen.filter((b) => (b.slots?.docenten?.naam || '') === m).length])
  const zonder = data.leerlingen.length - data.boekingen.length
  return (
    <>
      <div className="knoppen raster-opties">
        <button className={alles ? 'secundair' : ''} onClick={() => setAlles(false)}>Alleen afspraken</button>
        <button className={alles ? '' : 'secundair'} onClick={() => setAlles(true)}>Alles</button>
        {duo && <>
          <span className="scheiding" />
          <button className={heleKlas ? 'secundair' : ''} onClick={() => setHeleKlas(false)}>Mijn afspraken</button>
          <button className={heleKlas ? '' : 'secundair'} onClick={() => setHeleKlas(true)}>Hele klas</button>
        </>}
      </div>
      {duo && heleKlas && (
        <p className="tellers">
          {tellers.map(([m, n]) => <span key={m}><i style={{ background: kleur(m) }} /> {m} {n}</span>)}
          <span>· niet ingepland {zonder}</span>
        </p>
      )}
      {!bron.length && <p className="zacht">Je hebt nog geen beschikbaarheid ingevuld.</p>}
      <div className="raster-dagen">
        {perDag(bron).map(([k, lijst]) => {
          const bezet = lijst.filter((s) => s.boekingen).length
          const toon = alles ? lijst : lijst.filter((s) => s.boekingen)
          return (
            <div key={k} className="dag-blok">
              <button className="dag-kop" onClick={() => setDicht({ ...dicht, [k]: !dicht[k] })}>
                <span>{dicht[k] ? '▸' : '▾'} {dag(lijst[0].start)}</span>
                <span className="zacht klein">{bezet} van {lijst.length} bezet</span>
              </button>
              {!dicht[k] && (
                <div className="blokjes">
                  {!toon.length && <span className="zacht klein">Nog geen afspraken</span>}
                  {toon.map((s) => {
                    const b = s.boekingen
                    return (
                      <button key={s.id} className={'blokje' + (b ? ' bezet' : '')}
                        style={b && heleKlas ? { background: kleur(s.mentor), borderColor: kleur(s.mentor) } : undefined}
                        onClick={() => b && setOpen(open === s.id ? null : s.id)} title={s.lokaal ? `Lokaal ${s.lokaal}` : ''}>
                        <span className="tijd">{tijd(s.start)}</span>
                        {b ? <span className="naam">{b.leerlingen.naam} <small>{b.leerlingen.klas}</small>{b.opmerking ? ' 💬' : ''}</span>
                          : <span className="naam zacht">vrij</span>}
                      </button>
                    )
                  })}
                </div>
              )}
              {toon.filter((s) => s.id === open).map((s) => (
                <div key={s.id} className="blok-details">
                  <strong>{s.boekingen.leerlingen.naam}</strong> ({s.boekingen.leerlingen.klas}) · {tijd(s.start)}–{tijd(s.eind)}
                  {s.lokaal && <> · lokaal {s.lokaal}</>}{heleKlas && <> · {s.mentor}</>}
                  {s.boekingen.door_mentor && <span className="label">door mentor ingepland</span>}
                  {s.boekingen.opmerking && <div className="opmerking">“{s.boekingen.opmerking}”</div>}
                  {s.docent_id === docent.id && (
                    <button className="link" disabled={bezig} onClick={() => annuleer(s.boekingen)}>Annuleren</button>
                  )}
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </>
  )
}

// ---------------------------------------------------------- Beschikbaarheid
// Naam voor leerlingen/ouders: ingestelde naam, anders voorletter + achternaam (zelfde als mentor_naam() in de database)
const mentorNaam = (d) => d.weergavenaam || (d.naam.includes(' ') ? `${d.naam[0].toUpperCase()}. ${d.naam.slice(d.naam.indexOf(' ') + 1)}` : d.naam)

const minuten = (t) => { const [h, m] = String(t || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0) }

function Beschikbaarheid({ ronde, docent, data, laad }) {
  const { bezig, voer, melding, setBericht } = useActie()
  const [form, setForm] = useState({
    datum: '', van: '', tot: '', duur: SCHOOL.standaardDuur, pauzeNa: 0, pauzeMin: 15, lokaal: data.slots.at(-1)?.lokaal || '',
    eetVan: SCHOOL.eetpauze?.[0] || '', eetTot: SCHOOL.eetpauze?.[1] || '',
  })
  const zet = (k) => (e) => { setBericht(null); setForm({ ...form, [k]: e.target.value }) }
  const dagInfo = data.dagen.find((d) => d.datum === form.datum)
  const [lokalen, setLokalen] = useState([]) // [{naam, capaciteit}]
  const [lokaalAnders, setLokaalAnders] = useState(false) // zelf een lokaal typen dat niet in de lijst staat
  useEffect(() => {
    supabase.from('lokalen').select('naam, capaciteit').order('volgorde').order('naam').then(({ data: d }) => {
      setLokalen(d || [])
      if (form.lokaal && !(d || []).some((x) => x.naam === form.lokaal)) setLokaalAnders(true)
    })
  }, []) // eslint-disable-line

  // Alle tijden met een lokaal in deze ronde (ook van andere mentoren), om de bezetting te tonen
  const [lokaalSlots, setLokaalSlots] = useState([])
  const laadBezetting = useCallback(async () => {
    const { data: d } = await supabase.from('slots').select('start, eind, lokaal, docent_id, docenten(naam, weergavenaam)')
      .eq('ronde_id', ronde.id).not('lokaal', 'is', null)
    setLokaalSlots(d || [])
  }, [ronde.id])
  useEffect(() => { laadBezetting() }, [laadBezetting])

  function kiesDag(e) {
    const d = data.dagen.find((x) => x.datum === e.target.value)
    setForm({ ...form, datum: e.target.value, van: hhmm(d?.van), tot: hhmm(d?.tot) })
  }

  // De delen waarin tijden gemaakt worden (vóór en na de eetpauze)
  const van = hhmm(form.van)
  const tot = hhmm(form.tot)
  const eet = form.eetVan && form.eetTot && form.eetVan < form.eetTot && form.eetVan < tot && form.eetTot > van
  const delen = !van || !tot ? [] : eet
    ? [[van, form.eetVan < van ? van : form.eetVan], [form.eetTot > tot ? tot : form.eetTot, tot]].filter(([a, b]) => a < b)
    : [[van, tot]]

  // Zelfde rekenwijze als genereer_slots: de tijden die gemaakt zouden worden, in minuten
  const kandidaten = useMemo(() => {
    const uit = []
    const duur = +form.duur
    if (!form.datum || !(duur >= 5)) return uit
    for (const [a, b] of delen) {
      let t = minuten(a)
      let n = 0
      while (t + duur <= minuten(b)) {
        uit.push([t, t + duur])
        n += 1
        t += duur
        if (+form.pauzeNa > 0 && n % +form.pauzeNa === 0) t += +form.pauzeMin || 0
      }
    }
    return uit
  }, [form.datum, form.duur, form.pauzeNa, form.pauzeMin, JSON.stringify(delen)]) // eslint-disable-line

  // Bezetting per lokaal op de gekozen dag, binnen de gekozen tijden
  const opDag = lokaalSlots.filter((s) => dagKey(s.start) === form.datum)
    .map((s) => ({ ...s, a: minuten(tijd(s.start)), b: minuten(tijd(s.eind)) }))
  function bezetting(naam) {
    const cap = lokalen.find((l) => l.naam.toLowerCase() === naam.toLowerCase())?.capaciteit ?? 2
    const hier = opDag.filter((s) => s.lokaal.toLowerCase() === naam.toLowerCase())
    const tellingen = kandidaten.map(([a, b]) => hier.filter((s) => s.a < b && s.b > a).length)
    const vol = tellingen.filter((n) => n >= cap).length
    return { cap, vol, totaal: kandidaten.length, piek: Math.max(0, ...tellingen), hier }
  }
  function lokaalLabel(naam) {
    if (!kandidaten.length) return naam
    const b = bezetting(naam)
    if (b.vol === b.totaal) return `${naam} — vol`
    if (b.vol) return `${naam} — deels vol (${b.vol} van ${b.totaal} tijden)`
    return b.piek ? `${naam} — ${b.piek}/${b.cap} in gebruik` : `${naam} — vrij (0/${b.cap})`
  }
  // Wie het gekozen lokaal die dag gebruikt (per docent eerste–laatste tijd)
  const gebruikers = (() => {
    if (!form.lokaal || !form.datum) return []
    const per = {}
    for (const s of opDag.filter((x) => x.lokaal.toLowerCase() === form.lokaal.toLowerCase())) {
      const p = per[s.docent_id] ??= { naam: s.docenten ? mentorNaam(s.docenten) : '?', a: s.start, b: s.eind, zelf: s.docent_id === docent.id }
      if (s.start < p.a) p.a = s.start
      if (s.eind > p.b) p.b = s.eind
    }
    return Object.values(per).sort((x, y) => x.a.localeCompare(y.a))
  })()

  async function maak(e) {
    e.preventDefault()
    const verwacht = kandidaten.length
    await voer(async () => {
      let n = 0
      for (const [a, b] of delen) {
        const { data: m, error } = await supabase.rpc('genereer_slots', {
          p_ronde: ronde.id, p_datum: form.datum, p_van: a, p_tot: b,
          p_duur: +form.duur, p_pauze_na: +form.pauzeNa || 0, p_pauze_min: +form.pauzeMin || 0,
          p_lokaal: form.lokaal || null,
        })
        if (error) throw error
        n += m || 0
      }
      await Promise.all([laad(), laadBezetting()])
      const alBezet = data.slots.some((s) => dagKey(s.start) === form.datum && tijd(s.start) < tot && tijd(s.eind) > van)
      const reden = alBezet && form.lokaal ? 'je had daar al tijden, of het lokaal was vol'
        : alBezet ? 'je had daar al tijden' : `lokaal ${form.lokaal} was op die tijden vol`
      if (n === 0) {
        throw new Error(alBezet
          ? `Er zijn geen nieuwe tijdslots gemaakt: je hebt op ${datumLabel(form.datum)} al tijden in dit tijdvak. Verwijder die eerst hieronder, of kies andere tijden.`
          : `Er zijn geen nieuwe tijdslots gemaakt: lokaal ${form.lokaal} is op die tijden al vol. Kies een ander lokaal.`)
      }
      if (n < verwacht) throw new Error(`${n} van de ${verwacht} tijden gemaakt; ${verwacht - n} overgeslagen (${reden}).`)
    }, `${kandidaten.length} tijdslots toegevoegd${eet ? ` (eetpauze ${form.eetVan}–${form.eetTot} vrijgehouden)` : ''}.`)
  }

  async function verwijder(ids) {
    if (!await bevestig(ids.length > 1 ? `${ids.length} vrije tijdslots verwijderen?` : 'Dit tijdslot verwijderen?')) return
    await voer(async () => {
      const { error } = await supabase.from('slots').delete().in('id', ids)
      if (error) throw error
      await Promise.all([laad(), laadBezetting()])
    })
  }

  return (
    <>
      <form className="kaart" onSubmit={maak}>
        <h2>Gesprekstijden toevoegen</h2>
        {!data.dagen.length && <p className="zacht">De beheerder heeft nog geen gespreksdagen ingesteld.</p>}
        <label>Dag
          <select value={form.datum} onChange={kiesDag} required>
            <option value="">Kies een dag</option>
            {data.dagen.map((d) => (
              <option key={d.id} value={d.datum}>{datumLabel(d.datum)} ({hhmm(d.van)}–{hhmm(d.tot)})</option>
            ))}
          </select>
        </label>
        <div className="raster2">
          <label>Van<input type="time" step="300" value={form.van} min={hhmm(dagInfo?.van)} max={hhmm(dagInfo?.tot)} onChange={zet('van')} required /></label>
          <label>Tot<input type="time" step="300" value={form.tot} min={hhmm(dagInfo?.van)} max={hhmm(dagInfo?.tot)} onChange={zet('tot')} required /></label>
          <label>Minuten per gesprek<input type="number" min="5" max="120" step="5" value={form.duur} onChange={zet('duur')} required /></label>
          <label>Lokaal
            <select value={lokaalAnders ? '__anders' : form.lokaal} onChange={(e) => {
              setBericht(null)
              if (e.target.value === '__anders') { setLokaalAnders(true); setForm({ ...form, lokaal: '' }) }
              else { setLokaalAnders(false); setForm({ ...form, lokaal: e.target.value }) }
            }}>
              <option value="">Geen lokaal</option>
              {lokalen.map((l) => {
                const b = kandidaten.length ? bezetting(l.naam) : null
                return <option key={l.naam} value={l.naam} disabled={!!b && b.vol === b.totaal && l.naam !== form.lokaal}>{lokaalLabel(l.naam)}</option>
              })}
              <option value="__anders">Ander lokaal…</option>
            </select>
            {lokaalAnders && <input value={form.lokaal} onChange={zet('lokaal')} placeholder="Typ het lokaal" maxLength={20} autoFocus />}
            {!kandidaten.length && <span className="zacht klein">Kies eerst een dag en tijden; dan zie je per lokaal hoe vol het is.</span>}
            {form.lokaal && kandidaten.length > 0 && (
              <span className={bezetting(form.lokaal).vol ? 'waarschuwing klein' : 'zacht klein'}>
                {lokaalLabel(form.lokaal).replace(`${form.lokaal} — `, `${form.lokaal}: `)}
                {gebruikers.length ? ` · die dag in gebruik door ${gebruikers.map((g) => `${g.zelf ? 'jou' : g.naam} ${tijd(g.a)}–${tijd(g.b)}`).join(', ')}` : ''}
              </span>
            )}
          </label>
          <label>Pauze na elke … gesprekken<input type="number" min="0" value={form.pauzeNa} onChange={zet('pauzeNa')} /></label>
          <label>Pauze (minuten)<input type="number" min="0" step="5" value={form.pauzeMin} onChange={zet('pauzeMin')} /></label>
          <label>Eetpauze van<input type="time" step="300" value={form.eetVan} onChange={zet('eetVan')} /></label>
          <label>Eetpauze tot<input type="time" step="300" value={form.eetTot} onChange={zet('eetTot')} /></label>
        </div>
        <p className="zacht klein">Zet 0 bij ‘pauze na’ voor geen korte pauzes. Maak de eetpauze leeg als je die niet wilt; in de eetpauze worden geen gesprekken gepland.</p>
        {melding}
        <button type="submit" disabled={bezig || !form.datum}>Tijdslots maken</button>
      </form>

      {perDag(data.slots).map(([k, lijst]) => {
        const vrij = lijst.filter((s) => !s.boekingen).map((s) => s.id)
        return (
          <div key={k} className="kaart">
            <div className="kop-rij">
              <h3>{dag(lijst[0].start)}</h3>
              {vrij.length > 1 && <button className="link" onClick={() => verwijder(vrij)}>Alle vrije slots verwijderen</button>}
            </div>
            <ul className="agenda compact">
              {lijst.map((s) => (
                <li key={s.id}>
                  <span className="tijd">{tijd(s.start)}–{tijd(s.eind)}</span>
                  <span className="groei">
                    {s.boekingen ? <span className="label ok">{s.boekingen.leerlingen.naam}</span> : <span className="zacht">vrij</span>}
                    {s.lokaal && <span className="zacht klein"> · {s.lokaal}</span>}
                  </span>
                  {!s.boekingen && <button className="link" aria-label="Verwijderen" onClick={() => verwijder([s.id])}>✕</button>}
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </>
  )
}

// ----------------------------------------------------------------- Inplannen
function Inplannen({ data, laad }) {
  const { bezig, voer, melding } = useActie()
  const [zoek, setZoek] = useState('')
  const [resultaten, setResultaten] = useState(null) // null = niet gezocht
  const [leerling, setLeerling] = useState('')
  const [slot, setSlot] = useState('')
  const geboekt = new Set(data.boekingen.map((b) => b.leerling_id))
  // Na zoeken: alleen de zoekresultaten. Anders: eigen klas, niet-ingeplande leerlingen eerst
  const keuzes = resultaten ?? [...data.leerlingen].sort((a, b) => geboekt.has(a.id) - geboekt.has(b.id))
  const vrij = data.slots.filter((s) => !s.boekingen)

  async function zoeken(e) {
    e.preventDefault()
    const t = zoek.trim().replace(/[,()*%]/g, ' ').trim()
    if (t.length < 2) { setResultaten(null); return }
    const q = `%${t}%`
    const { data: r } = await supabase.from('leerlingen').select('*').or(`naam.ilike.${q},klas.ilike.${q},email.ilike.${q}`).order('naam').limit(30)
    setResultaten(r || [])
    setLeerling(r?.length ? r[0].id : '')
  }

  async function plan(e) {
    e.preventDefault()
    await voer(async () => {
      const { error } = await supabase.rpc('mentor_plan_in', { p_slot: slot, p_leerling: leerling })
      if (error) throw error
      setSlot('')
      setLeerling('')
      await laad()
    }, 'Leerling ingepland. De leerling ziet de afspraak in het portaal.')
  }

  return (
    <form className="kaart" onSubmit={plan}>
      <h2>Leerling direct inplannen</h2>
      <p className="zacht">Voor leerlingen die je zeker wilt spreken. De leerling ziet de afspraak en kan die zolang de inschrijving open is nog zelf verplaatsen of annuleren.
        Een bestaande afspraak van de leerling wordt vervangen.</p>
      <div className="zoekrij">
        <input placeholder="Zoek leerling op naam, klas of e-mail (ook buiten je klas)" value={zoek}
          onChange={(e) => { setZoek(e.target.value); if (!e.target.value.trim()) setResultaten(null) }}
          onKeyDown={(e) => { if (e.key === 'Enter') zoeken(e) }} />
        <button type="button" className="secundair" onClick={zoeken}>Zoeken</button>
      </div>
      {resultaten && (
        <p className={resultaten.length ? 'zacht klein' : 'waarschuwing klein'}>
          {resultaten.length ? `${resultaten.length} leerling${resultaten.length === 1 ? '' : 'en'} gevonden: kies hieronder.` : `Geen leerling gevonden voor “${zoek.trim()}”.`}
          {' '}<button type="button" className="link" onClick={() => { setZoek(''); setResultaten(null); setLeerling('') }}>Toon mijn klas</button>
        </p>
      )}
      <label>Leerling
        <select value={leerling} onChange={(e) => setLeerling(e.target.value)} required>
          <option value="">Kies leerling</option>
          {keuzes.map((l) => <option key={l.id} value={l.id}>{l.naam} ({l.klas}){geboekt.has(l.id) ? ' – al ingepland' : ''}</option>)}
        </select>
      </label>
      <label>Tijdslot
        <select value={slot} onChange={(e) => setSlot(e.target.value)} required>
          <option value="">Kies tijdslot</option>
          {vrij.map((s) => <option key={s.id} value={s.id}>{dag(s.start)} {tijd(s.start)}{s.lokaal ? ` · ${s.lokaal}` : ''}</option>)}
        </select>
      </label>
      {!vrij.length && <p className="zacht">Je hebt geen vrije tijdslots. Voeg eerst beschikbaarheid toe.</p>}
      {melding}
      <button type="submit" disabled={bezig || !slot || !leerling}>Inplannen</button>
    </form>
  )
}

// -------------------------------------------------------------- Instellingen
function Instellingen({ ronde, docent, data, laad }) {
  const info = useActie()
  const [tekst, setTekst] = useState('')
  useEffect(() => {
    supabase.from('mentor_info').select('tekst').eq('ronde_id', ronde.id).eq('docent_id', docent.id).maybeSingle()
      .then(({ data: d }) => setTekst(d?.tekst || ''))
  }, [ronde.id, docent.id])

  async function bewaar(e) {
    e.preventDefault()
    await info.voer(async () => {
      const { error } = await supabase.from('mentor_info').upsert({ ronde_id: ronde.id, docent_id: docent.id, tekst })
      if (error) throw error
    }, 'Informatie opgeslagen.')
  }

  // Naam zoals leerlingen en ouders die zien, bijv. "Dhr. Bonte"
  const naamActie = useActie()
  const [weergave, setWeergave] = useState(docent.weergavenaam || '')
  async function bewaarNaam(e) {
    e.preventDefault()
    await naamActie.voer(async () => {
      const { error } = await supabase.rpc('zet_weergavenaam', { p_naam: weergave })
      if (error) throw error
      docent.weergavenaam = weergave.trim() || null
    }, 'Naam opgeslagen.')
  }

  return (
    <>
      <form className="kaart" onSubmit={bewaarNaam}>
        <h2>Je naam voor leerlingen en ouders</h2>
        <p className="zacht">Zo sta je in het portaal bij “Kies een moment”, bij de afspraak en onder je informatie.
          Leeg laten = {mentorNaam({ ...docent, weergavenaam: null })}.</p>
        <div className="zoekrij">
          <input value={weergave} onChange={(e) => setWeergave(e.target.value)} maxLength={40} placeholder={`Bijv. Dhr. ${docent.naam.split(' ').slice(-1)[0]} of Mevr. ${docent.naam.split(' ').slice(-1)[0]}`} />
          <button type="submit" disabled={naamActie.bezig || weergave === (docent.weergavenaam || '')}>Opslaan</button>
        </div>
        {naamActie.melding}
      </form>
      <form className="kaart" onSubmit={bewaar}>
        <h2>Informatie voor leerling en ouder(s)/verzorger(s)</h2>
        <p className="zacht">Dit ziet de leerling met ouder(s)/verzorger(s) na het inloggen, bijvoorbeeld waar het gesprek is en wat er voorbereid kan worden.
          Bij een duo-mentoraat ziet de leerling de berichten van beide mentoren onder elkaar, elk met de naam eronder.</p>
        <textarea rows={5} maxLength={1000} value={tekst} onChange={(e) => setTekst(e.target.value)}
          placeholder="Bijv. Het gesprek duurt 20 minuten en vindt plaats in lokaal M101. Neemt u het laatste rapport mee?" />
        {info.melding}
        <button type="submit" disabled={info.bezig}>Opslaan</button>
      </form>
      {data.mijnKlassen.map((k) => (
        <KlasInstelling key={k} klas={k} ronde={ronde} data={data} laad={laad} />
      ))}
    </>
  )
}

function KlasInstelling({ klas, ronde, data, laad }) {
  const { bezig, voer, melding } = useActie()
  const mentoren = data.collegas.filter((c) => c.klas === klas)
  const leerlingen = data.leerlingen.filter((l) => l.klas === klas)
  const [inst, setInst] = useState({ modus: 'vrij', max_per_mentor: '' })
  const [toew, setToew] = useState({})

  const laadKlas = useCallback(async () => {
    const [i, t] = await Promise.all([
      supabase.from('klas_instelling').select('*').eq('ronde_id', ronde.id).eq('klas', klas).maybeSingle(),
      supabase.from('toewijzing').select('*').eq('ronde_id', ronde.id).in('leerling_id', leerlingen.map((l) => l.id)),
    ])
    if (i.data) setInst({ modus: i.data.modus, max_per_mentor: i.data.max_per_mentor ?? '' })
    setToew(Object.fromEntries((t.data || []).map((x) => [x.leerling_id, x.docent_id])))
  }, [ronde.id, klas, leerlingen.length]) // eslint-disable-line
  useEffect(() => { laadKlas() }, [laadKlas])

  if (mentoren.length < 2) {
    return (
      <div className="kaart">
        <h3>Klas {klas}</h3>
        <p className="zacht">{leerlingen.length} leerlingen · jij bent de enige mentor. Alle leerlingen zien jouw tijden.</p>
      </div>
    )
  }

  async function bewaar() {
    await voer(async () => {
      const { error } = await supabase.from('klas_instelling').upsert({
        ronde_id: ronde.id, klas, modus: inst.modus,
        max_per_mentor: inst.modus === 'vrij' && inst.max_per_mentor ? +inst.max_per_mentor : null,
      })
      if (error) throw error
      await laad()
    }, 'Instelling opgeslagen.')
  }

  async function verdeelAlfabet() {
    if (!await bevestig('Leerlingen op alfabet verdelen over de mentoren? Bestaande verdeling wordt overschreven.')) return
    const gesorteerd = [...leerlingen].sort((a, b) => a.naam.localeCompare(b.naam))
    const per = Math.ceil(gesorteerd.length / mentoren.length)
    const rijen = gesorteerd.map((l, i) => ({ ronde_id: ronde.id, leerling_id: l.id, docent_id: mentoren[Math.floor(i / per)].docent_id }))
    await voer(async () => {
      const { error } = await supabase.from('toewijzing').upsert(rijen)
      if (error) throw error
      await laadKlas()
    }, 'Leerlingen verdeeld.')
  }

  async function wijs(leerlingId, docentId) {
    await voer(async () => {
      const { error } = await supabase.from('toewijzing').upsert({ ronde_id: ronde.id, leerling_id: leerlingId, docent_id: docentId })
      if (error) throw error
      setToew({ ...toew, [leerlingId]: docentId })
    })
  }

  const telling = mentoren.map((m) => [m.docenten?.naam, Object.values(toew).filter((d) => d === m.docent_id).length])

  return (
    <div className="kaart">
      <h3>Klas {klas} · duo-mentoraat</h3>
      <p className="zacht">Mentoren: {mentoren.map((m) => m.docenten?.naam).join(' en ')} · {leerlingen.length} leerlingen</p>
      <div className="keuzes">
        <label className="radio"><input type="radio" checked={inst.modus === 'vrij'} onChange={() => setInst({ ...inst, modus: 'vrij' })} />
          <span><strong>Vrije keuze</strong> — de leerling kiest een mentor. Stel een maximum in om het eerlijk te verdelen.</span></label>
        <label className="radio"><input type="radio" checked={inst.modus === 'verdelen'} onChange={() => setInst({ ...inst, modus: 'verdelen' })} />
          <span><strong>Verdelen</strong> — elke leerling ziet één vaste mentor.</span></label>
        <p className="zacht klein">Voeren jullie de gesprekken samen? Kies vrije keuze en laat één van jullie de tijden invullen.</p>
      </div>
      {inst.modus === 'vrij' && (
        <label className="inline">Maximum leerlingen per mentor
          <input type="number" min="1" value={inst.max_per_mentor} placeholder={String(Math.ceil(leerlingen.length / 2) + 2)}
            onChange={(e) => setInst({ ...inst, max_per_mentor: e.target.value })} />
        </label>
      )}
      {melding}
      <button onClick={bewaar} disabled={bezig}>Opslaan</button>

      {inst.modus === 'verdelen' && (
        <div className="verdeling">
          <div className="kop-rij">
            <span className="zacht">{telling.map(([n, c]) => `${n}: ${c}`).join(' · ')}</span>
            <button className="secundair" onClick={verdeelAlfabet} disabled={bezig}>Verdeel op alfabet</button>
          </div>
          <ul className="lijst">
            {leerlingen.map((l) => (
              <li key={l.id}>
                <span>{l.naam}</span>
                <select value={toew[l.id] || ''} onChange={(e) => wijs(l.id, e.target.value)}>
                  <option value="" disabled>Kies mentor</option>
                  {mentoren.map((m) => <option key={m.docent_id} value={m.docent_id}>{m.docenten?.naam}</option>)}
                </select>
              </li>
            ))}
          </ul>
          <p className="zacht klein">Leerlingen zonder toewijzing zien beide mentoren.</p>
        </div>
      )}
    </div>
  )
}

// --------------------------------------------------- Agenda-koppeling Outlook
function AgendaKoppeling({ docent, geboekt, downloaden }) {
  const [token, setToken] = useState(docent.agenda_token)
  const [open, setOpen] = useState(false)
  const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/agenda_feed?token=${token}&apikey=${import.meta.env.VITE_SUPABASE_ANON_KEY}`
  async function nieuw() {
    if (!await bevestig('Nieuwe link maken? De oude link werkt dan niet meer; je moet de agenda opnieuw toevoegen in Outlook.')) return
    const { data, error } = await supabase.rpc('nieuwe_agenda_link')
    if (!error && data) setToken(data)
  }
  return (
    <div className="kaart info">
      <div className="kop-rij">
        <h2>In je Outlook/Teams-agenda</h2>
        <button className="link" onClick={() => setOpen(!open)}>{open ? 'Verbergen' : 'Hoe werkt het?'}</button>
      </div>
      <p>Koppel één keer: daarna staan alle afspraken vanzelf in je agenda, ook nieuwe en gewijzigde.</p>
      <div className="knoppen">
        <KopieerKnop tekst={url} label="Agenda-link kopiëren" klaarLabel="Link gekopieerd ✓" />
        <button className="secundair" onClick={downloaden} disabled={!geboekt}>Eenmalig downloaden (.ics)</button>
      </div>
      {open && (
        <ol className="klein uitleg">
          <li>Klik op <strong>Agenda-link kopiëren</strong>.</li>
          <li>Open Outlook op het web of in de nieuwe Outlook → <strong>Agenda</strong> → <strong>Agenda toevoegen</strong> → <strong>Abonneren vanaf internet</strong>.</li>
          <li>Plak de link, geef de naam ‘MOL-gesprekken’ en klik op <strong>Importeren</strong>.</li>
          <li>De agenda verschijnt ook in Teams. Outlook ververst een geabonneerde agenda een paar keer per dag, dus een wijziging kan even duren.</li>
        </ol>
      )}
      <p className="zacht klein">Deel deze link niet: wie hem heeft, ziet je afspraken. <button className="link" onClick={nieuw}>Nieuwe link maken</button></p>
    </div>
  )
}

// ------------------------------------------ Uitnodiging voor ouders (kopiëren)
function Uitnodiging({ ronde, docent }) {
  const [open, setOpen] = useState(false)
  const site = window.location.origin + window.location.pathname
  const tekst = `Beste ouder(s)/verzorger(s),

Binnenkort vinden de mentorgesprekken plaats: een gesprek tussen u, uw zoon of dochter en de mentor (MOL-gesprek). Dit gesprek is verplicht. Graag nodig ik u hiervoor uit.

U kunt zelf een moment kiezen via ${site}
Log in met het schoolaccount van uw kind. U ziet dan de beschikbare tijden en kunt eventueel een vraag of opmerking voor mij achterlaten.
${ronde.inschrijven_tot ? `\nInschrijven en wijzigen kan tot ${dagTijd(ronde.inschrijven_tot)}.\n` : ''}
Past geen van de momenten? Geeft u dat dan aan via dezelfde website; ik neem daarna contact met u op.

Met vriendelijke groet,

${mentorNaam(docent)}
Mentor`
  return (
    <div className="kaart">
      <div className="kop-rij">
        <h2>Uitnodiging voor ouders</h2>
        <div className="knoppen">
          <KopieerKnop tekst={tekst} label="Tekst kopiëren" />
          <button className="link" onClick={() => setOpen(!open)}>{open ? 'Verbergen' : 'Bekijken'}</button>
        </div>
      </div>
      <p className="zacht klein">Plak deze tekst in een bericht aan de ouders van je klas, via Somtoday, Magister of Outlook.</p>
      {open && <div className="uitnodiging">{tekst}</div>}
    </div>
  )
}
