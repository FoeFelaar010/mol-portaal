// --- CSV ---------------------------------------------------------------
// Leest CSV of uit Excel geplakte tekst. Scheidingsteken (; tab ,) wordt herkend.
export function leesCsv(tekst, { houdKop = false } = {}) {
  const regels = tekst.replace(/^\uFEFF/, '').split(/\r?\n/).filter((r) => r.trim())
  if (!regels.length) return []
  const eerste = regels[0]
  const sep = eerste.includes('\t') ? '\t' : eerste.includes(';') ? ';' : ','
  let rijen = regels.map((r) => splits(r, sep))
  if (!houdKop && /naam|email|e-mail|klas/.test(rijen[0].join(' ').toLowerCase())) rijen = rijen.slice(1)
  return rijen
}

function splits(regel, sep) {
  const uit = []
  let cel = ''
  let quote = false
  for (let i = 0; i < regel.length; i++) {
    const c = regel[i]
    if (c === '"') {
      if (quote && regel[i + 1] === '"') { cel += '"'; i++ } else quote = !quote
    } else if (c === sep && !quote) { uit.push(cel.trim()); cel = '' } else cel += c
  }
  uit.push(cel.trim())
  return uit
}

export function maakCsv(rijen) {
  return rijen
    .map((r) => r.map((c) => {
      const s = String(c ?? '')
      return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }).join(';'))
    .join('\r\n')
}

// --- ICS (Outlook / Teams / Google agenda) ----------------------------
const z = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (m) => '\\' + m)

export function maakIcs(events) {
  const r = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Melanchthon Schiebroek//MOL-portaal//NL', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH']
  for (const e of events) {
    r.push('BEGIN:VEVENT', `UID:${e.id}@mol.melanchthon.xyz`, `DTSTAMP:${z(new Date())}`,
      `DTSTART:${z(e.start)}`, `DTEND:${z(e.eind)}`, `SUMMARY:${esc(e.titel)}`)
    if (e.locatie) r.push(`LOCATION:${esc(e.locatie)}`)
    if (e.omschrijving) r.push(`DESCRIPTION:${esc(e.omschrijving)}`)
    r.push('END:VEVENT')
  }
  r.push('END:VCALENDAR')
  return r.join('\r\n')
}

export function download(naam, inhoud, type) {
  const bom = type.startsWith('text/csv') ? '\uFEFF' : ''
  const url = URL.createObjectURL(new Blob([bom + inhoud], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = naam
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function leesBestand(file) {
  return await file.text()
}
