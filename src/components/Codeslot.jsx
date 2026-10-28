import { useState } from 'react'

// Drempel, geen beveiliging: de inhoud staat openbaar op GitHub. Bedoeld voor handleidingen die leerlingen
// alleen mogen gebruiken met toestemming (bijv. Lovable: 18+ of toestemming ouders). In catalogus.json staat
// bij "slot" de SHA-256 van de code; de docent geeft de code in de les.
const sleutel = (slug) => `ontgrendeld-${slug}`

export function isOntgrendeld(item) {
  if (!item.slot) return true
  try { return localStorage.getItem(sleutel(item.slug)) === item.slot } catch { return false }
}

async function sha256(tekst) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(tekst))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export default function Codeslot({ item, onOpen }) {
  const [code, setCode] = useState('')
  const [fout, setFout] = useState(false)

  async function controleer(e) {
    e.preventDefault()
    if ((await sha256(code.trim().toLowerCase())) === item.slot) {
      try { localStorage.setItem(sleutel(item.slug), item.slot) } catch {}
      onOpen()
    } else setFout(true)
  }

  return (
    <main id="main" className="home">
      <p className="crumb"><a href="#/">Alle handleidingen</a> / {item.groep}</p>
      <h1>{item.titel}</h1>
      <form className="slot" onSubmit={controleer}>
        <p>Deze handleiding gebruik je alleen als je docent het zegt. Vul de code in die je van je docent hebt gekregen.</p>
        <label htmlFor="slotcode">Code</label>
        <div className="slot-rij">
          <input id="slotcode" value={code} autoComplete="off" autoCapitalize="none"
            onChange={(e) => { setCode(e.target.value); setFout(false) }} />
          <button type="submit">Openen</button>
        </div>
        {fout && <p className="slot-fout" role="alert">Deze code klopt niet. Vraag het je docent.</p>}
      </form>
    </main>
  )
}
