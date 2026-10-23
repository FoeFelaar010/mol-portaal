const TZ = 'Europe/Amsterdam'
const f = (opts) => new Intl.DateTimeFormat('nl-NL', { timeZone: TZ, ...opts })

export const dag = (d) => f({ weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(d))
export const tijd = (d) => f({ hour: '2-digit', minute: '2-digit' }).format(new Date(d))
export const dagTijd = (d) => `${dag(d)} om ${tijd(d)}`
export const dagKey = (d) => new Intl.DateTimeFormat('sv-SE', { timeZone: TZ }).format(new Date(d))
export const datumLabel = (iso) => dag(iso + 'T12:00:00Z')

export function perDag(items, key = 'start') {
  const m = new Map()
  for (const it of items) {
    const k = dagKey(it[key])
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(it)
  }
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b))
}

// Invoervelden (datetime-local) altijd in Nederlandse tijd, ongeacht de tijdzone van de computer
const wand = (d) => new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d).replace(' ', 'T')

export function naarInput(iso) {
  return iso ? wand(new Date(iso)) : ''
}
export function vanInput(v) {
  if (!v) return null
  const [d, t] = v.split('T')
  const [j, m, dg] = d.split('-').map(Number)
  const [u, mi] = t.split(':').map(Number)
  let ts = Date.UTC(j, m - 1, dg, u, mi)
  for (let i = 0; i < 2; i++) { // corrigeer voor het verschil met Amsterdam (zomer-/wintertijd)
    const [wd, wt] = wand(new Date(ts)).split('T')
    const [wj, wm, wdg] = wd.split('-').map(Number)
    const [wu, wmi] = wt.split(':').map(Number)
    ts -= Date.UTC(wj, wm - 1, wdg, wu, wmi) - Date.UTC(j, m - 1, dg, u, mi)
  }
  return new Date(ts).toISOString()
}

export const hhmm = (t) => (t || '').slice(0, 5)
