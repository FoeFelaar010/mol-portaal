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

  const kopIndex = useMemo(() => kiesKop(rijen, soort), [rijen, soort])
  const koppen = rijen[kopIndex] || []
  const data = useMemo(() => rijen.slice(kopIndex + 1), [rijen, kopIndex])
  const [mentorPatroon, setMentorPatroon] = useState(() => {
    try { return localStorage.getItem('mol-mentorpatroon') || SCHOOL.docentEmail } catch { return SCHOOL.docentEmail }
  })
  const [emailEigen, setEmailEigen] = useState({})
  const raster = soort === 'mentoren' ? isRaster(koppen, data, map) : null

  useEffect(() => {
    supabase.from(soort === 'leerlingen' ? 'leerlingen' : 'klas_mentoren').select(soort === 'leerlingen' ? 'id, email' : 'klas')
      .then(({ data: d }) => setBestaand(d || []))
  }, [soort, bezig])

  function zetRijen(r, naam) {
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
        const email = (emailEigen[sleutel] ?? (kolom(r, 'email') || maakEmail(mentorPatroon, d, code))).toLowerCase().trim()
        for (const k of raster) {
          if (!String(r[k] ?? '').trim()) continue
          if (!/^\S+@\S+\.\S+$/.test(email)) fouten.push(`Regel ${regel}: geen geldig e-mailadres voor ${d.volledig}`)
          else ok.push({ klas: hoofdKlas(koppen[k]), naam: d.volledig, email, sleutel })
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
  }, [data, map, patroon, soort, raster, mentorPatroon, emailEigen, kopIndex, koppen])

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
        <p>Kies de mentorexport uit Zermelo (docenten met klassen), of plak één regel per mentor: <code>klas;naam;e-mail</code>. Twee mentoren? Dan twee regels met dezelfde klas.
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

          {raster && (
            <div className="kaart info">
              <strong>Mentorenoverzicht uit Zermelo herkend</strong> ({raster.length} klassen).
              <p className="zacht klein">In deze export staan geen e-mailadressen. Ze worden gemaakt met het patroon hieronder.
                Controleer ze en pas aan waar nodig: met dit adres logt de mentor straks in.</p>
              <label>Patroon e-mail docent
                <input value={mentorPatroon} onChange={(e) => setMentorPatroon(e.target.value)} />
                <span className="zacht klein">Mogelijk: {'{v}'} = eerste letter voornaam, {'{voornaam}'}, {'{tussen}'}, {'{achternaam}'}, {'{code}'}</span>
              </label>
              <div className="scroll">
                <table className="tabel klein">
                  <thead><tr><th>Mentor</th><th>Klas</th><th>E-mail</th></tr></thead>
                  <tbody>
                    {[...new Map(resultaat.ok.map((x) => [x.sleutel, x])).values()].map((x) => (
                      <tr key={x.sleutel}>
                        <td>{x.naam}</td>
                        <td>{resultaat.ok.filter((y) => y.sleutel === x.sleutel).map((y) => y.klas).join(', ')}</td>
                        <td><input value={emailEigen[x.sleutel] ?? x.email} onChange={(e) => setEmailEigen({ ...emailEigen, [x.sleutel]: e.target.value })} /></td>
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

