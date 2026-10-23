import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { leesCsv } from '../lib/files.js'
import { SCHOOL } from '../config.js'
import { Melding, useActie } from '../components/ui.jsx'

// Velden per soort import, met woorden waarop kolomkoppen herkend worden (Somtoday, Zermelo, Magister, eigen Excel)
const VELDEN = {
  leerlingen: [
    { id: 'nummer', label: 'Leerlingnummer', woorden: ['leerlingnummer', 'leerlingcode', 'llnr', 'lln nr', 'stamnummer', 'leerling nummer', 'nummer', 'code'] },
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
    { id: 'voornaam', label: 'Voornaam', woorden: ['voornaam', 'roepnaam'] },
    { id: 'code', label: 'Docentcode', woorden: ['werknemerscode', 'docentcode', 'afkorting', 'code'] },
    { id: 'email', label: 'E-mail mentor', woorden: ['e-mail', 'email', 'mail', 'e-mailadres'] },
  ],
}

// Zoek de echte kopregel (Zermelo-exports hebben eerst een regel met groepsnamen)
function kiesKop(rijen, soort) {
  let beste = 0
  let score = -1
  rijen.slice(0, 5).forEach((r, i) => {
    const n = Object.keys(herken(r, soort)).length
    if (n > score) { score = n; beste = i }
  })
  return beste
}

// "Dijk, van, Zoë" → "Zoë van Dijk"; "Heiden, Filemon van der" → "Filemon van der Heiden"
export function draaiNaam(n) {
  const t = String(n || '').trim()
  if (!t.includes(',')) return t
  const d = t.split(',').map((x) => x.trim()).filter(Boolean)
  if (d.length === 2) return `${d[1]} ${d[0]}`
  if (d.length >= 3) return `${d.slice(2).join(' ')} ${d[1]} ${d[0]}`
  return t
}

const zonderAccent = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')

// Docent uit Zermelo: Naam "Eem, D. van der" + Voornaam "Danny"
function docentDelen(naam, voornaam) {
  const [achter, rest = ''] = String(naam || '').split(',').map((x) => x.trim())
  const tussen = rest.split(/\s+/).filter((w) => w && !w.endsWith('.')).join(' ')
  const vn = String(voornaam || '').trim() || rest.split(/\s+/)[0]?.replace('.', '') || ''
  return { achter: achter || '', tussen, voornaam: vn, volledig: [vn, tussen, achter].filter(Boolean).join(' ') }
}

function maakEmail(patroon, d, code) {
  const schoon = (s) => zonderAccent(String(s || '')).toLowerCase().replace(/[^a-z0-9-]/g, '')
  return patroon
    .replace('{v}', schoon(d.voornaam).charAt(0))
    .replace('{voornaam}', schoon(d.voornaam))
    .replace('{tussen}', schoon(d.tussen))
    .replace('{achternaam}', schoon(d.achter))
    .replace('{code}', schoon(code))
    .toLowerCase()
}

// Raster-export: per docent een rij, per klas een kolom met '-' of 'x' bij mentorschap
function isRaster(koppen, data, map) {
  const klasKolommen = koppen.map((k, i) => i).filter((i) =>
    !Object.values(map).includes(i) && /^[a-z]{0,3}\d[a-z0-9]{0,3}$/i.test(String(koppen[i]).trim()) &&
    data.every((r) => /^(|-|x|X|✓|1|ja)$/.test(String(r[i] ?? '').trim())))
  return klasKolommen.length >= 2 ? klasKolommen : null
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

// Werknemers-export uit Zermelo (Gebruikerscode + Email): geeft { code: email } of null als het die export niet is
const CODE_WOORDEN = ['gebruikerscode', 'werknemerscode', 'docentcode', 'afkorting', 'code']
const MAIL_WOORDEN = ['email', 'e-mail', 'e-mailadres', 'emailadres', 'mail']
export function leesWerknemers(rijen) {
  for (let i = 0; i < Math.min(rijen.length, 5); i++) {
    const kop = rijen[i].map(norm)
    const c = kop.findIndex((k) => CODE_WOORDEN.includes(k))
    const m = kop.findIndex((k) => MAIL_WOORDEN.includes(k))
    if (c < 0 || m < 0) continue
    const lijst = {}
    for (const r of rijen.slice(i + 1)) {
      const code = String(r[c] ?? '').trim().toLowerCase()
      const mail = String(r[m] ?? '').trim().toLowerCase()
      if (code && /^\S+@\S+\.\S+$/.test(mail)) lijst[code] = mail
    }
    return Object.keys(lijst).length ? lijst : null
  }
  return null
}

export default function Import({ klaar, ga }) {
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

  const kopIndex = useMemo(() => kiesKop(rijen, soort), [rijen, soort])
  const koppen = rijen[kopIndex] || []
  const data = useMemo(() => rijen.slice(kopIndex + 1), [rijen, kopIndex])
  const [mentorPatroon, setMentorPatroon] = useState(() => {
    try { return localStorage.getItem('mol-mentorpatroon') || SCHOOL.docentEmail } catch { return SCHOOL.docentEmail }
  })
  const [emailEigen, setEmailEigen] = useState({})
  const [werknemers, setWerknemers] = useState(null) // { code: email } uit de werknemers-export
  const raster = soort === 'mentoren' ? isRaster(koppen, data, map) : null

  useEffect(() => {
    supabase.from(soort === 'leerlingen' ? 'leerlingen' : 'klas_mentoren').select(soort === 'leerlingen' ? 'id, email' : 'klas')
      .then(({ data: d }) => setBestaand(d || []))
  }, [soort, bezig])

  // Stand van het portaal bovenaan de pagina
  const [stand, setStand] = useState(null)
  useEffect(() => {
    Promise.all([supabase.from('leerlingen').select('klas'), supabase.from('klas_mentoren').select('klas, docent_id')])
      .then(([ll, km]) => {
        const klassen = new Set((ll.data || []).map((x) => x.klas))
        const metMentor = new Set((km.data || []).map((x) => x.klas))
        setStand({
          leerlingen: (ll.data || []).length, klassen: klassen.size,
          mentoren: new Set((km.data || []).map((x) => x.docent_id)).size,
          zonderMentor: [...klassen].filter((k) => !metMentor.has(k)).sort(),
        })
      })
  }, [bezig])

  function zetRijen(r, naam) {
    if (soort === 'mentoren') {
      // Werknemers-export gekozen? Dan alleen de e-mailadressen onthouden
      const kop = kiesKop(r, soort)
      const m = herken(r[kop] || [], soort)
      const w = m.klas === undefined && !isRaster(r[kop] || [], r.slice(kop + 1), m) ? leesWerknemers(r) : null
      if (w) { zetWerknemers(w); return }
    }
    setRijen(r)
    setBestandNaam(naam)
    setMap(herken(r[kiesKop(r, soort)] || [], soort))
    setEmailEigen({})
    setVerwijderOud(false)
    setBericht(null)
  }

  async function bestand(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    try { zetRijen(await leesRijen(f), f.name) } catch (err) { setBericht({ type: 'fout', tekst: 'Bestand kon niet gelezen worden: ' + err.message }) }
  }

  function zetWerknemers(w) {
    setWerknemers(w)
    setEmailEigen({})
    setBericht({ type: 'ok', tekst: `Werknemers-export ingelezen: ${Object.keys(w).length} e-mailadressen. Kies nu (ook) de mentorexport.` })
  }

  async function bestandWerknemers(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    try {
      const w = leesWerknemers(await leesRijen(f))
      if (!w) throw new Error('geen kolommen Gebruikerscode en Email gevonden')
      zetWerknemers(w)
    } catch (err) { setBericht({ type: 'fout', tekst: 'Werknemers-export kon niet gelezen worden: ' + err.message }) }
  }

  // Omzetten naar records + controle
  const resultaat = useMemo(() => {
    const ok = []
    const fouten = []
    const kolom = (r, id) => (map[id] !== undefined ? String(r[map[id]] ?? '').trim() : '')
    data.forEach((r, i) => {
      const regel = i + kopIndex + 2
      if (soort === 'leerlingen') {
        const nr = kolom(r, 'nummer')
        const naam = draaiNaam(kolom(r, 'naam')) || [kolom(r, 'voornaam'), kolom(r, 'tussen'), kolom(r, 'achternaam')].filter(Boolean).join(' ')
        const klas = hoofdKlas(kolom(r, 'klas'))
        let email = kolom(r, 'email').toLowerCase()
        if (!email && nr && patroon.includes('{nr}')) email = patroon.replace('{nr}', nr).toLowerCase()
        if (!naam || !klas || !/^\S+@\S+\.\S+$/.test(email)) {
          fouten.push(`Regel ${regel}: ${!naam ? 'naam ontbreekt' : !klas ? 'klas ontbreekt' : 'geen geldig e-mailadres'}`)
        } else ok.push({ naam, klas, email, leerlingnummer: nr || null })
      } else if (raster) {
        const code = kolom(r, 'code')
        const d = docentDelen(kolom(r, 'naam'), kolom(r, 'voornaam'))
        const sleutel = code || d.volledig
        const uitExport = kolom(r, 'email') || werknemers?.[code.toLowerCase()]
        const bron = emailEigen[sleutel] !== undefined ? 'aangepast' : uitExport ? 'export' : 'geraden'
        const email = (emailEigen[sleutel] ?? (uitExport || maakEmail(mentorPatroon, d, code))).toLowerCase().trim()
        for (const k of raster) {
          if (!String(r[k] ?? '').trim()) continue
          if (!/^\S+@\S+\.\S+$/.test(email)) fouten.push(`Regel ${regel}: geen geldig e-mailadres voor ${d.volledig}`)
          else ok.push({ klas: hoofdKlas(koppen[k]), naam: d.volledig, email, sleutel, bron })
        }
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
  }, [data, map, patroon, soort, raster, mentorPatroon, emailEigen, werknemers, kopIndex, koppen])

  const nieuweEmails = new Set(resultaat.ok.map((x) => x.email))
  const nietMeer = soort === 'leerlingen' ? bestaand.filter((b) => !nieuweEmails.has(b.email)) : []
  const nieuw = soort === 'leerlingen' ? resultaat.ok.filter((x) => !bestaand.some((b) => b.email === x.email)).length : 0

  async function importeer() {
    await voer(async () => {
      try { localStorage.setItem('mol-emailpatroon', patroon); localStorage.setItem('mol-mentorpatroon', mentorPatroon) } catch { /* niet erg */ }
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
        // bestaande docenten behouden hun naam/beheerrechten; alleen nieuwe worden toegevoegd
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
    : raster ? heeft('naam') : heeft('klas') && heeft('email')
  const zonderEmailKolom = soort === 'leerlingen' && map.email === undefined
  const voorbeeld = resultaat.ok.slice(0, 5)
  const mentorLijst = [...new Map(resultaat.ok.map((x) => [x.sleutel, x])).values()]
  const geraden = mentorLijst.filter((x) => x.bron === 'geraden').length

  return (
    <>
    {stand && (
      <div className="kaart">
        <h2>Import uit Zermelo</h2>
        <p>Nu in het portaal: <strong>{stand.leerlingen} leerlingen</strong> in {stand.klassen} klassen · <strong>{stand.mentoren} mentoren</strong>.
          {' '}{ga && <button className="link" onClick={() => ga('gebruikers')}>Bekijken of aanpassen</button>}</p>
        {!!stand.zonderMentor.length && <p className="waarschuwing klein">Nog geen mentor: {stand.zonderMentor.join(', ')}. Importeer de mentoren (stap 2).</p>}
        <p className="zacht klein">Importeren voegt toe en werkt bij; er gaat niets weg tenzij je dat aanvinkt. Losse wijzigingen doe je bij Klassen &amp; gebruikers.</p>
      </div>
    )}
    <div className="kaart">
      <div className="segment">
        <button className={soort === 'leerlingen' ? 'actief' : ''} onClick={() => { setSoort('leerlingen'); setRijen([]); setBericht(null) }}>1. Leerlingen</button>
        <button className={soort === 'mentoren' ? 'actief' : ''} onClick={() => { setSoort('mentoren'); setRijen([]); setBericht(null) }}>2. Mentoren</button>
      </div>

      {soort === 'leerlingen' ? (
        <>
          <p>Kies de <strong>leerlingen-export uit Zermelo</strong> (afdelingsdeelnames, Excel of CSV). Kolommen worden automatisch herkend:
            leerlingcode, naam, stamklas en e-mail.</p>
          <label className="bestand secundair">Leerlingen-export kiezen
            <input type="file" accept=".csv,.txt,.xlsx,.xls,.ods" onChange={bestand} hidden />
          </label>
        </>
      ) : (
        <>
          <p>Mentoren hebben twee bestanden uit Zermelo nodig. De mentoren van de klassen in de lijst worden vervangen.</p>
          <ol className="stappen-import">
            <li>
              <label className="bestand secundair">a. Mentorexport kiezen
                <input type="file" accept=".csv,.txt,.xlsx,.xls,.ods" onChange={bestand} hidden />
              </label>
              <span className="zacht klein">Docenten met per klas een “-” bij mentorschap.</span>
              {rijen.length > 1 && <span className="label ok">{bestandNaam}</span>}
            </li>
            <li>
              <label className="bestand secundair">b. Werknemers-export kiezen
                <input type="file" accept=".csv,.txt,.xlsx,.xls,.ods" onChange={bestandWerknemers} hidden />
              </label>
              <span className="zacht klein">Voor de e-mailadressen (Gebruikerscode + Email).</span>
              {werknemers && <span className="label ok">{Object.keys(werknemers).length} e-mailadressen</span>}
            </li>
          </ol>
        </>
      )}
      {rijen.length <= 1 && melding}
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

          {raster && (
            <div className="kaart info">
              <strong>Mentorenoverzicht uit Zermelo herkend</strong> ({raster.length} klassen).
              <p className={geraden ? 'waarschuwing klein' : 'zacht klein'}>
                {werknemers ? `${mentorLijst.length - geraden} van ${mentorLijst.length} e-mailadressen uit de werknemers-export.` : 'Kies ook de werknemers-export (stap b) voor de juiste e-mailadressen.'}
                {geraden ? ` ${geraden} geraden: controleer die.` : ''} Met dit adres logt de mentor in.</p>
              {!!geraden && (
                <label>Patroon e-mail docent
                  <input value={mentorPatroon} onChange={(e) => setMentorPatroon(e.target.value)} />
                  <span className="zacht klein">Mogelijk: {'{v}'} = eerste letter voornaam, {'{voornaam}'}, {'{tussen}'}, {'{achternaam}'}, {'{code}'}</span>
                </label>
              )}
              <div className="scroll">
                <table className="tabel klein">
                  <thead><tr><th>Mentor</th><th>Klas</th><th>E-mail</th></tr></thead>
                  <tbody>
                    {mentorLijst.map((x) => (
                      <tr key={x.sleutel}>
                        <td>{x.naam}</td>
                        <td>{resultaat.ok.filter((y) => y.sleutel === x.sleutel).map((y) => y.klas).join(', ')}</td>
                        <td><input value={emailEigen[x.sleutel] ?? x.email} onChange={(e) => setEmailEigen({ ...emailEigen, [x.sleutel]: e.target.value })} />
                          {x.bron === 'geraden' && <span className="label open">geraden</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

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
          {soort === 'leerlingen' && !!voorbeeld.length && (
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
    </div>
    </>
  )
}

