import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { leesCsv } from '../lib/files.js'
import { SCHOOL } from '../config.js'
import { Melding, useActie } from '../components/ui.jsx'

// Velden per soort import, met woorden waarop kolomkoppen herkend worden (Somtoday, Zermelo, Magister, eigen Excel)
const VELDEN = {
  leerlingen: [
    { id: 'nummer', label: 'Leerlingnummer', woorden: ['leerlingnummer', 'llnr', 'lln nr', 'stamnummer', 'leerling nummer', 'nummer', 'code'] },
    { id: 'naam', label: 'Volledige naam', woorden: ['naam', 'volledige naam', 'leerling', 'weergavenaam', 'volledigenaam'] },
    { id: 'voornaam', label: 'Roepnaam', woorden: ['roepnaam', 'voornaam', 'voornamen'] },
    { id: 'tussen', label: 'Tussenvoegsel', woorden: ['tussenvoegsel', 'voorvoegsel', 'tussenvoegsels', 'prefix'] },
    { id: 'achternaam', label: 'Achternaam', woorden: ['achternaam'] },
    { id: 'klas', label: 'Klas', woorden: ['stamklas', 'stamgroep', 'klas', 'basisgroep', 'groep', 'mentorgroep'] },
    { id: 'email', label: 'E-mail (school)', woorden: ['e-mail', 'email', 'e-mailadres', 'emailadres', 'mail', 'schoolmail'] },
  ],
  mentoren: [
    { id: 'klas', label: 'Klas', woorden: ['klas', 'stamklas', 'stamgroep', 'groep'] },
    { id: 'naam', label: 'Naam mentor', woorden: ['naam', 'mentor', 'docent', 'naam mentor'] },
    { id: 'email', label: 'E-mail mentor', woorden: ['e-mail', 'email', 'mail', 'e-mailadres'] },
  ],
}

const norm = (s) => String(s ?? '').toLowerCase().replace(/[_.]/g, ' ').replace(/\s+/g, ' ').trim()

function herken(koppen, soort) {
  const gebruikt = new Set()
  const map = {}
  for (const v of VELDEN[soort]) {
    let i = koppen.findIndex((k, j) => !gebruikt.has(j) && v.woorden.includes(norm(k)))
    if (i < 0 && v.id !== 'naam') i = koppen.findIndex((k, j) => !gebruikt.has(j) && v.woorden.some((w) => w.length > 3 && norm(k).includes(w)))
    if (i >= 0) { map[v.id] = i; gebruikt.add(i) }
  }
  return map
}

async function leesRijen(file) {
  if (/\.(xlsx|xls|ods)$/i.test(file.name)) {
    const XLSX = await import('xlsx')
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    const rijen = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' })
    return rijen.map((r) => r.map((c) => String(c).trim())).filter((r) => r.some(Boolean))
  }
  return leesCsv(await file.text(), { houdKop: true })
}

const hoofdKlas = (k) => String(k || '').trim().toUpperCase()

export default function Import({ klaar }) {
  const [soort, setSoort] = useState('leerlingen')
  const [rijen, setRijen] = useState([])
  const [bestandNaam, setBestandNaam] = useState('')
  const [map, setMap] = useState({})
  const [patroon, setPatroon] = useState(() => {
    try { return localStorage.getItem('mol-emailpatroon') || SCHOOL.leerlingEmail } catch { return SCHOOL.leerlingEmail }
  })
  const [bestaand, setBestaand] = useState([])
  const [verwijderOud, setVerwijderOud] = useState(false)
  const { bezig, voer, melding, setBericht } = useActie()

  const koppen = rijen[0] || []
  const data = rijen.slice(1)

  useEffect(() => {
    supabase.from(soort === 'leerlingen' ? 'leerlingen' : 'klas_mentoren').select(soort === 'leerlingen' ? 'id, email' : 'klas')
      .then(({ data: d }) => setBestaand(d || []))
  }, [soort, bezig])

  function zetRijen(r, naam) {
    setRijen(r)
    setBestandNaam(naam)
    setMap(herken(r[0] || [], soort))
    setVerwijderOud(false)
    setBericht(null)
  }

  async function bestand(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    try { zetRijen(await leesRijen(f), f.name) } catch (err) { setBericht({ type: 'fout', tekst: 'Bestand kon niet gelezen worden: ' + err.message }) }
  }

  // Omzetten naar records + controle
  const resultaat = useMemo(() => {
    const ok = []
    const fouten = []
    const kolom = (r, id) => (map[id] !== undefined ? String(r[map[id]] ?? '').trim() : '')
    data.forEach((r, i) => {
      const regel = i + 2
      if (soort === 'leerlingen') {
        const nr = kolom(r, 'nummer')
        const naam = kolom(r, 'naam') || [kolom(r, 'voornaam'), kolom(r, 'tussen'), kolom(r, 'achternaam')].filter(Boolean).join(' ')
        const klas = hoofdKlas(kolom(r, 'klas'))
        let email = kolom(r, 'email').toLowerCase()
        if (!email && nr && patroon.includes('{nr}')) email = patroon.replace('{nr}', nr).toLowerCase()
        if (!naam || !klas || !/^\S+@\S+\.\S+$/.test(email)) {
          fouten.push(`Regel ${regel}: ${!naam ? 'naam ontbreekt' : !klas ? 'klas ontbreekt' : 'geen geldig e-mailadres'}`)
        } else ok.push({ naam, klas, email, leerlingnummer: nr || null })
      } else {
        const klas = hoofdKlas(kolom(r, 'klas'))
        const email = kolom(r, 'email').toLowerCase()
        const naam = kolom(r, 'naam') || email
        if (!klas || !/^\S+@\S+\.\S+$/.test(email)) fouten.push(`Regel ${regel}: ${!klas ? 'klas ontbreekt' : 'geen geldig e-mailadres'}`)
        else ok.push({ klas, naam, email })
      }
    })
    // dubbele e-mailadressen (leerlingen) eruit
    const gezien = new Map()
    if (soort === 'leerlingen') for (const x of ok) gezien.set(x.email, x)
    const uniek = soort === 'leerlingen' ? [...gezien.values()] : ok
    const klassen = {}
    for (const x of uniek) klassen[x.klas] = (klassen[x.klas] || 0) + 1
    return { ok: uniek, fouten, dubbel: ok.length - uniek.length, klassen }
  }, [data, map, patroon, soort])

  const nieuweEmails = new Set(resultaat.ok.map((x) => x.email))
  const nietMeer = soort === 'leerlingen' ? bestaand.filter((b) => !nieuweEmails.has(b.email)) : []
  const nieuw = soort === 'leerlingen' ? resultaat.ok.filter((x) => !bestaand.some((b) => b.email === x.email)).length : 0

  async function importeer() {
    await voer(async () => {
      try { localStorage.setItem('mol-emailpatroon', patroon) } catch { /* niet erg */ }
      if (soort === 'leerlingen') {
        for (let i = 0; i < resultaat.ok.length; i += 500) {
          const { error } = await supabase.from('leerlingen').upsert(resultaat.ok.slice(i, i + 500), { onConflict: 'email' })
          if (error) throw error
        }
        if (verwijderOud && nietMeer.length) {
          const { error } = await supabase.from('leerlingen').delete().in('id', nietMeer.map((x) => x.id))
          if (error) throw error
        }
      } else {
        const docenten = [...new Map(resultaat.ok.map((x) => [x.email, { email: x.email, naam: x.naam }])).values()]
        const d = await supabase.from('docenten').upsert(docenten, { onConflict: 'email' }).select('id, email')
        if (d.error) throw d.error
        const idPer = Object.fromEntries(d.data.map((x) => [x.email, x.id]))
        const klassen = Object.keys(resultaat.klassen)
        const del = await supabase.from('klas_mentoren').delete().in('klas', klassen)
        if (del.error) throw del.error
        const { error } = await supabase.from('klas_mentoren').insert(resultaat.ok.map((x) => ({ klas: x.klas, docent_id: idPer[x.email] })))
        if (error) throw error
      }
      setRijen([])
      setBestandNaam('')
      klaar?.()
    }, soort === 'leerlingen'
      ? `${resultaat.ok.length} leerlingen geïmporteerd${verwijderOud && nietMeer.length ? `, ${nietMeer.length} oude ${nietMeer.length === 1 ? 'leerling' : 'leerlingen'} verwijderd` : ''}.`
      : `Mentoren voor ${Object.keys(resultaat.klassen).length} klassen geïmporteerd.`)
  }

  const velden = VELDEN[soort]
  const heeft = (id) => map[id] !== undefined
  const herkendOk = soort === 'leerlingen'
    ? heeft('klas') && (heeft('naam') || heeft('achternaam')) && (heeft('email') || heeft('nummer'))
    : heeft('klas') && heeft('email')
  const zonderEmailKolom = soort === 'leerlingen' && map.email === undefined
  const voorbeeld = resultaat.ok.slice(0, 5)

  return (
    <div className="kaart">
      <div className="segment">
        <button className={soort === 'leerlingen' ? 'actief' : ''} onClick={() => { setSoort('leerlingen'); setRijen([]) }}>Leerlingen</button>
        <button className={soort === 'mentoren' ? 'actief' : ''} onClick={() => { setSoort('mentoren'); setRijen([]) }}>Mentoren</button>
      </div>

      {soort === 'leerlingen' ? (
        <p>Exporteer de leerlingenlijst uit Somtoday of Zermelo (Excel of CSV) en kies het bestand. Kolommen worden automatisch herkend.
          Nodig: <strong>naam</strong>, <strong>klas</strong> en <strong>leerlingnummer of e-mail</strong>.</p>
      ) : (
        <p>Eén regel per mentor: <code>klas;naam;e-mail</code>. Twee mentoren? Dan twee regels met dezelfde klas.
          De mentoren van de klassen in de lijst worden vervangen.</p>
      )}

      <label className="bestand secundair">Bestand kiezen (Excel of CSV)
        <input type="file" accept=".csv,.txt,.xlsx,.xls,.ods" onChange={bestand} hidden />
      </label>
      <details className="plakken">
        <summary>Of plak uit Excel</summary>
        <textarea rows={5} placeholder={soort === 'leerlingen' ? 'Leerlingnummer;Roepnaam;Tussenvoegsel;Achternaam;Stamklas\n312345;Sara;;Jansen;2A' : 'klas;naam;email\n2A;M. de Vries;m.devries@melanchthon.nl\n2A;J. Bakker;j.bakker@melanchthon.nl'}
          onChange={(e) => zetRijen(leesCsv(e.target.value, { houdKop: true }), 'geplakte lijst')} />
      </details>

      {rijen.length > 1 && (
        <>
          <details className="kolommen" open={!herkendOk}>
          <summary><strong>Kolommen in {bestandNaam}</strong> {herkendOk ? <span className="label ok">automatisch herkend</span> : <span className="label open">controleer</span>}</summary>
          <div className="raster2">
            {velden.map((v) => (
              <label key={v.id}>{v.label}
                <select value={map[v.id] ?? ''} onChange={(e) => setMap({ ...map, [v.id]: e.target.value === '' ? undefined : +e.target.value })}>
                  <option value="">— niet gebruiken —</option>
                  {koppen.map((k, i) => <option key={i} value={i}>{k || `Kolom ${i + 1}`}</option>)}
                </select>
              </label>
            ))}
          </div>
          {zonderEmailKolom && (
            <label>E-mailadres maken uit leerlingnummer
              <input value={patroon} onChange={(e) => setPatroon(e.target.value)} />
              <span className="zacht klein">{'{nr}'} wordt het leerlingnummer. Controleer bij ICT of dit klopt.</span>
            </label>
          )}
          </details>

          <h3>Controle</h3>
          <ul className="check">
            <li className={resultaat.ok.length ? 'ok' : 'fout'}>{resultaat.ok.length} {soort === 'leerlingen' ? 'leerlingen' : 'mentorregels'} in {Object.keys(resultaat.klassen).length} klassen</li>
            {soort === 'leerlingen' && <li className="ok">{nieuw} nieuw · {resultaat.ok.length - nieuw} bijgewerkt</li>}
            {!!resultaat.dubbel && <li className="let">{resultaat.dubbel} dubbele regels overgeslagen</li>}
            {!!resultaat.fouten.length && (
              <li className="fout">{resultaat.fouten.length} {resultaat.fouten.length === 1 ? 'regel' : 'regels'} overgeslagen
                <details><summary>Bekijk</summary><div className="klein">{resultaat.fouten.slice(0, 50).join(' · ')}</div></details>
              </li>
            )}
          </ul>
          <div className="chips">
            {Object.entries(resultaat.klassen).sort().map(([k, n]) => <span key={k} className="chip">{k} · {n}</span>)}
          </div>
          {!!voorbeeld.length && (
            <div className="scroll">
              <table className="tabel klein">
                <thead><tr>{Object.keys(voorbeeld[0]).map((k) => <th key={k}>{k}</th>)}</tr></thead>
                <tbody>{voorbeeld.map((r, i) => <tr key={i}>{Object.values(r).map((v, j) => <td key={j}>{v}</td>)}</tr>)}</tbody>
              </table>
            </div>
          )}
          {!!nietMeer.length && (
            <label className="radio">
              <input type="checkbox" checked={verwijderOud} onChange={(e) => setVerwijderOud(e.target.checked)} />
              <span><strong>{nietMeer.length} {nietMeer.length === 1 ? 'leerling' : 'leerlingen'}</strong> in het portaal {nietMeer.length === 1 ? 'staat' : 'staan'} niet in deze lijst (bijv. vertrokken).
                Verwijderen, met hun afspraken. Alleen aanvinken als dit de <em>volledige</em> leerlingenlijst is.</span>
            </label>
          )}
          {melding}
          <button onClick={importeer} disabled={bezig || !resultaat.ok.length}>
            {bezig ? 'Bezig…' : `${resultaat.ok.length} ${soort === 'leerlingen' ? 'leerlingen' : 'regels'} importeren`}
          </button>
        </>
      )}
      {rijen.length <= 1 && melding}
    </div>
  )
}

