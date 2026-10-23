import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { dag, dagTijd, perDag, tijd } from '../lib/fmt.js'
import { download, maakIcs } from '../lib/files.js'
import { Laden, Melding, useActie, bevestig, bevestigTyp } from '../components/ui.jsx'

// kijk = true: een beheerder bekijkt het portaal als deze leerling (alleen kijken, niets opslaan)
export default function Leerling({ leerling, kijk = false }) {
  const [rondes, setRondes] = useState(null)

  useEffect(() => {
    supabase.from('rondes').select('*').eq('open', true).order('aangemaakt', { ascending: false })
      .then(({ data }) => setRondes(data || []))
  }, [])

  const voornaam = leerling.naam.split(' ')[0]

  return (
    <>
      <h1>Beste {voornaam} en ouder(s)/verzorger(s)</h1>
      <p>Hier plant u samen het <strong>mentor-ouder-leerlinggesprek</strong> (MOL). Het gesprek is verplicht: kies een moment dat voor u allebei past.</p>
      <p className="zacht">Klas {leerling.klas}</p>
      {!rondes && <Laden />}
      {rondes && !rondes.length && (
        <div className="kaart"><p>Er is op dit moment geen gespreksronde open. Je krijgt bericht als je kunt inschrijven.</p></div>
      )}
      {rondes?.map((r) => <Ronde key={r.id} ronde={r} kijk={kijk ? leerling.id : null} />)}
    </>
  )
}

function Ronde({ ronde, kijk }) {
  const [mentoren, setMentoren] = useState(null)
  const [slots, setSlots] = useState([])
  const [boeking, setBoeking] = useState(null)
  const [opmerking, setOpmerking] = useState('')
  const [verplaats, setVerplaats] = useState(false)
  const [kanNiet, setKanNiet] = useState(null)
  const { bezig, voer, melding } = useActie()

  const laad = useCallback(async () => {
    // Leerling zelf: RLS laat alleen de eigen rijen zien. Beheerder (kijk): expliciet op deze leerling filteren
    const eigenRij = (tabel) => {
      const q = supabase.from(tabel).select('*').eq('ronde_id', ronde.id)
      return (kijk ? q.eq('leerling_id', kijk) : q).maybeSingle()
    }
    const [m, s, b, k] = await Promise.all([
      kijk ? supabase.rpc('beheer_mentoren_voor', { p_ronde: ronde.id, p_leerling: kijk })
        : supabase.rpc('beschikbare_mentoren', { p_ronde: ronde.id }),
      kijk ? supabase.rpc('beheer_slots_voor', { p_ronde: ronde.id, p_leerling: kijk })
        : supabase.rpc('slots_voor_leerling', { p_ronde: ronde.id }),
      eigenRij('boekingen'),
      eigenRij('kan_niet'),
    ])
    setKanNiet(k.data || null)
    setMentoren(m.data || [])
    setSlots(s.data || [])
    setBoeking(b.data || null)
    setOpmerking(b.data?.opmerking || '')
  }, [ronde.id, kijk])

  useEffect(() => { laad() }, [laad])

  const nu = new Date()
  const open = ronde.open
    && (!ronde.inschrijven_vanaf || nu >= new Date(ronde.inschrijven_vanaf))
    && (!ronde.inschrijven_tot || nu < new Date(ronde.inschrijven_tot))
  const eigen = slots.find((s) => s.eigen)

  async function kies(slot) {
    if (kijk) return
    const tekst = eigen
      ? `Je afspraak verplaatsen naar ${dagTijd(slot.start)}?`
      : `Gesprek inplannen op ${dagTijd(slot.start)} met ${slot.docent_naam}?`
    if (!await bevestig(tekst, { knop: eigen ? 'Ja, verplaatsen' : 'Ja, inplannen' })) return
    await voer(async () => {
      const { error } = await supabase.rpc('boek', { p_slot: slot.slot_id, p_opmerking: opmerking })
      if (error) throw error
      await laad()
      setVerplaats(false)
    }, 'Je gesprek is ingepland. Je kunt het in je agenda zetten.')
  }

  async function annuleer() {
    if (kijk) return
    if (!await bevestig('Weet je zeker dat je je afspraak wilt annuleren?')) return
    await voer(async () => {
      const { error } = await supabase.rpc('annuleer', { p_ronde: ronde.id })
      if (error) throw error
      await laad()
    }, 'Je afspraak is geannuleerd.')
  }

  async function bewaarOpmerking() {
    await voer(async () => {
      const { error } = await supabase.rpc('wijzig_opmerking', { p_ronde: ronde.id, p_opmerking: opmerking })
      if (error) throw error
      await laad()
    }, 'Opgeslagen.')
  }

  function agenda() {
    download('mol-gesprek.ics', maakIcs([{
      id: boeking?.id || eigen.slot_id,
      start: eigen.start, eind: eigen.eind,
      titel: `MOL-gesprek met ${eigen.docent_naam}`,
      locatie: eigen.lokaal ? `Lokaal ${eigen.lokaal}, Melanchthon Schiebroek` : 'Melanchthon Schiebroek',
      omschrijving: 'Gesprek mentor, ouder(s) en leerling.',
    }]), 'text/calendar')
  }

  if (!mentoren) return <Laden />

  const perMentor = mentoren.map((m) => ({ ...m, slots: slots.filter((s) => s.docent_id === m.docent_id) }))

  return (
    <section>
      <h2>{ronde.naam}</h2>
      {ronde.inschrijven_tot && (
        <p className="zacht">Inschrijven en wijzigen kan tot {dagTijd(ronde.inschrijven_tot)}.</p>
      )}
      {!open && <Melding type="info">De inschrijving is nu gesloten.</Melding>}
      {melding}

      {mentoren.filter((m) => m.info).map((m) => (
        <div key={m.docent_id} className="kaart info">
          <strong>Informatie van {m.naam}</strong>
          <p className="witregels">{m.info}</p>
        </div>
      ))}

      {eigen && (
        <div className="kaart afspraak">
          <span className="label ok">Jouw afspraak</span>
          <h3>{dag(eigen.start)}</h3>
          <p>{tijd(eigen.start)} – {tijd(eigen.eind)} met <strong>{eigen.docent_naam}</strong>
            {eigen.lokaal && <> · lokaal <strong>{eigen.lokaal}</strong></>}</p>
          {boeking?.door_mentor && <p className="zacht">Deze afspraak is in overleg door de mentor ingepland. Past het moment toch niet? Neem dan contact op met de mentor; wijzigen kan alleen via de mentor.</p>}
          <div className="knoppen">
            <button onClick={agenda}>Zet in agenda</button>
            {open && !boeking?.door_mentor && <button className="secundair" onClick={() => setVerplaats(!verplaats)}>{verplaats ? 'Niet verplaatsen' : 'Verplaatsen'}</button>}
            {open && !boeking?.door_mentor && <button className="secundair" onClick={annuleer} disabled={bezig || !!kijk}>Annuleren</button>}
          </div>
        </div>
      )}

      {(eigen || open) && (
        <div className="kaart">
          <label>Vraag of opmerking voor je mentor (niet verplicht)
            <textarea maxLength={100} rows={2} value={opmerking} disabled={!open || !!kijk}
              placeholder="Bijv. ik wil het hebben over mijn planning"
              onChange={(e) => setOpmerking(e.target.value)} />
          </label>
          <div className="zacht klein">{opmerking.length}/100 · Vul geen gevoelige of medische informatie in.</div>
          {eigen && open && !kijk && (
            <button onClick={bewaarOpmerking} disabled={bezig || opmerking === (boeking?.opmerking || '')}>Opmerking opslaan</button>
          )}
        </div>
      )}

      {open && !boeking?.door_mentor && (!eigen || verplaats) && perMentor.map((m) => (
        <div key={m.docent_id} className="kaart">
          <h3>{eigen ? 'Ander moment kiezen' : 'Kies een moment'} · {m.naam}</h3>
          {m.vol && <p className="zacht">Deze mentor is vol. Kies een andere mentor.</p>}
          {!m.vol && !m.slots.length && <p className="zacht">Deze mentor heeft nog geen tijden opengezet.</p>}
          {!m.vol && perDag(m.slots).map(([k, lijst]) => (
            <div key={k} className="dag">
              <h4>{dag(lijst[0].start)}</h4>
              <div className="slots">
                {lijst.map((s) => (
                  <button key={s.slot_id} className={s.eigen ? 'slot eigen' : 'slot'}
                    disabled={s.bezet || bezig || !!kijk} onClick={() => kies(s)}
                    aria-label={`${tijd(s.start)}${s.bezet ? ' bezet' : ''}`}>
                    {tijd(s.start)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
      {kijk && kanNiet && <p className="opmerking let">Leerling gaf door dat geen moment past: “{kanNiet.reden}”{kanNiet.voorkeur ? ` · kan wel: ${kanNiet.voorkeur}` : ''}</p>}
      {open && !eigen && !kijk && !!mentoren.length && <KanNiet ronde={ronde} kanNiet={kanNiet} klaar={laad} />}
      {!mentoren.length && <p className="zacht">Er is nog geen mentor aan je klas gekoppeld.</p>}
    </section>
  )
}

function KanNiet({ ronde, kanNiet, klaar }) {
  const [open, setOpen] = useState(false)
  const [reden, setReden] = useState(kanNiet?.reden || '')
  const [voorkeur, setVoorkeur] = useState(kanNiet?.voorkeur || '')
  const { bezig, voer, melding } = useActie()

  async function verstuur(e) {
    e.preventDefault()
    await voer(async () => {
      const { error } = await supabase.rpc('meld_kan_niet', { p_ronde: ronde.id, p_reden: reden, p_voorkeur: voorkeur })
      if (error) throw error
      setOpen(false)
      await klaar()
    })
  }

  if (kanNiet && !open) {
    return (
      <div className="kaart kan-niet">
        <span className="label open">Doorgegeven aan je mentor</span>
        <p>Je hebt laten weten dat geen enkel moment past: <em>“{kanNiet.reden}”</em>
          {kanNiet.voorkeur && <> · Voorkeur: <em>{kanNiet.voorkeur}</em></>}</p>
        <p>Het gesprek is verplicht. <strong>Je mentor neemt contact op</strong> om samen een moment te vinden.
          Past er toch een moment hierboven? Kies het dan gewoon.</p>
        <button className="link" onClick={() => setOpen(true)}>Bericht aanpassen</button>
      </div>
    )
  }
  if (!open) {
    return <p className="kan-niet-link"><button className="link" onClick={() => setOpen(true)}>Geen enkel moment past?</button></p>
  }
  return (
    <form className="kaart kan-niet" onSubmit={verstuur}>
      <h3>Geen enkel moment past</h3>
      <p>Het MOL-gesprek is <strong>verplicht</strong>. Laat je mentor weten waarom de tijden niet passen.
        Je mentor neemt daarna contact op om samen een ander moment te vinden.</p>
      <label>Waarom past geen enkel moment?
        <textarea rows={2} maxLength={200} required minLength={3} value={reden} onChange={(e) => setReden(e.target.value)}
          placeholder="Bijv. beide ouders werken op die dagen tot 18:00" />
      </label>
      <label>Wanneer kan het wel? <span className="zacht">(niet verplicht)</span>
        <input maxLength={100} value={voorkeur} onChange={(e) => setVoorkeur(e.target.value)} placeholder="Bijv. dinsdag of donderdag na 17:00" />
      </label>
      {melding}
      <div className="knoppen">
        <button type="submit" disabled={bezig}>Doorgeven aan mentor</button>
        <button type="button" className="secundair" onClick={() => setOpen(false)}>Toch een moment kiezen</button>
      </div>
    </form>
  )
}
