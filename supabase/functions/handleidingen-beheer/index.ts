// Beheer van de Handleidingen-site: Word-bestanden en catalogus.json op GitHub zetten.
// Het GitHub-token (secret HL_GITHUB_TOKEN) blijft hier op de server; de website zelf kan niets op GitHub schrijven.
// Acties: stand · upload · catalogus · status. Alleen voor adressen in tabel hl_beheerders.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'
import { encodeBase64, decodeBase64 } from 'jsr:@std/encoding@1.0.5/base64'

const REPO = 'FoeFelaar010/Handleidingen'
const TAK = 'main'
const MAX_MB = 20

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const antwoord = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
class Fout extends Error { constructor(msg: string, public status = 400) { super(msg) } }

async function gh(pad: string, init: RequestInit = {}) {
  const token = Deno.env.get('HL_GITHUB_TOKEN')
  if (!token) throw new Fout('Het GitHub-token (HL_GITHUB_TOKEN) is nog niet ingesteld in Supabase.', 500)
  const r = await fetch(`https://api.github.com/repos/${REPO}${pad}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'handleidingen-beheer', ...(init.headers ?? {}) },
  })
  return r
}
async function ghJson(pad: string, init: RequestInit = {}) {
  const r = await gh(pad, init)
  if (!r.ok) throw new Fout(`GitHub gaf een fout (${r.status}) bij ${pad}: ${(await r.text()).slice(0, 200)}`, 502)
  return r.json()
}

const tekst = (b64: string) => new TextDecoder().decode(decodeBase64(b64.replace(/\n/g, '')))

// Word-bestanden per bron: Handleiding_Teams_v27_01.docx → { bron: Handleiding_Teams, versie: [27, 1] }
function wordBestanden(tree: { path: string; type: string; sha: string }[]) {
  const uit: { pad: string; bron: string; versie: [number, number] }[] = []
  for (const t of tree) {
    if (t.type !== 'blob') continue
    const naam = t.path.split('/').pop()!
    const m = naam.match(/^(.+)_v(\d+)_(\d+)\.docx$/)
    if (m && !naam.startsWith('~$')) uit.push({ pad: t.path, bron: m[1], versie: [+m[2], +m[3]] })
  }
  return uit
}
const nieuwer = (a: [number, number], b: [number, number]) => a[0] - b[0] || a[1] - b[1]

async function kop() {
  const ref = await ghJson(`/git/ref/heads/${TAK}`)
  const commit = await ghJson(`/git/commits/${ref.object.sha}`)
  return { sha: ref.object.sha as string, tree: commit.tree.sha as string }
}

async function commit(bestanden: { path: string; sha: string | null }[], bericht: string) {
  const k = await kop()
  const tree = await ghJson('/git/trees', { method: 'POST', body: JSON.stringify({
    base_tree: k.tree, tree: bestanden.map((b) => ({ path: b.path, mode: '100644', type: 'blob', sha: b.sha })) }) })
  const c = await ghJson('/git/commits', { method: 'POST', body: JSON.stringify({ message: bericht, tree: tree.sha, parents: [k.sha] }) })
  const r = await gh(`/git/refs/heads/${TAK}`, { method: 'PATCH', body: JSON.stringify({ sha: c.sha }) })
  if (!r.ok) throw new Fout('Er is net iets anders op GitHub gezet. Probeer het opnieuw.', 409)
  return c.sha as string
}

// Zelfde opmaak als het met de hand gemaakte bestand: één regel per handleiding
function catalogusTekst(cat: { groepen: Record<string, unknown>[] }) {
  const groepen = cat.groepen.map((g) => {
    const { items, ...rest } = g as { items: unknown[] }
    const kop = Object.entries(rest).map(([k, v]) => `      ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n')
    const regels = items.map((it) => `        { ${Object.entries(it as object).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')} }`).join(',\n')
    return `    {\n${kop}\n      "items": [\n${regels}\n      ]\n    }`
  })
  return `{\n  "groepen": [\n${groepen.join(',\n')}\n  ]\n}\n`
}

function controleerCatalogus(cat: any) {
  if (!cat || !Array.isArray(cat.groepen) || !cat.groepen.length) throw new Fout('Catalogus heeft geen groepen.')
  const slugs = new Set<string>()
  for (const g of cat.groepen) {
    if (typeof g.titel !== 'string' || !g.titel.trim()) throw new Fout('Elke groep heeft een titel nodig.')
    if (!Array.isArray(g.items)) throw new Fout(`Groep ${g.titel} heeft geen lijst met handleidingen.`)
    for (const it of g.items) {
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(it.slug ?? '')) throw new Fout(`Ongeldig adres: "${it.slug}" (alleen kleine letters, cijfers en -).`)
      if (slugs.has(it.slug)) throw new Fout(`Adres ${it.slug} komt twee keer voor.`)
      slugs.add(it.slug)
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(it.bron ?? '')) throw new Fout(`Ongeldige bron bij ${it.slug}.`)
      if (typeof it.titel !== 'string' || !it.titel.trim()) throw new Fout(`${it.slug} heeft geen titel.`)
      if (typeof it.icoon !== 'string' || !it.icoon) throw new Fout(`${it.slug} heeft geen icoon.`)
    }
  }
}

async function stand() {
  const k = await kop()
  const tree = await ghJson(`/git/trees/${k.tree}?recursive=1`)
  const cat = await ghJson(`/contents/src/catalogus.json?ref=${k.sha}`)
  const per: Record<string, { pad: string; versie: string }[]> = {}
  for (const w of wordBestanden(tree.tree).sort((a, b) => nieuwer(b.versie, a.versie)))
    (per[w.bron] ??= []).push({ pad: w.pad, versie: `${w.versie[0]}.${String(w.versie[1]).padStart(2, '0')}` })
  const iconen = tree.tree.filter((t: any) => /^public\/img\/ico-.+\.webp$/.test(t.path)).map((t: any) => t.path.slice('public/img/'.length))
  return { commit: k.sha, catalogus: JSON.parse(tekst(cat.content)), catalogusSha: cat.sha, word: per, iconen }
}

async function upload(form: FormData, wie: string) {
  const bron = String(form.get('bron') ?? '')
  const bestand = form.get('bestand')
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(bron)) throw new Fout('Onbekende handleiding.')
  if (!(bestand instanceof File)) throw new Fout('Geen bestand ontvangen.')
  if (bestand.size > MAX_MB * 1024 * 1024) throw new Fout(`Bestand is groter dan ${MAX_MB} MB.`)
  const bytes = new Uint8Array(await bestand.arrayBuffer())
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b || !bestand.name.toLowerCase().endsWith('.docx'))
    throw new Fout('Dit is geen Word-bestand (.docx).')

  const k = await kop()
  const cat = JSON.parse(tekst((await ghJson(`/contents/src/catalogus.json?ref=${k.sha}`)).content))
  if (!cat.groepen.some((g: any) => g.items.some((it: any) => it.bron === bron)))
    throw new Fout('Deze handleiding staat niet in de catalogus. Voeg hem eerst toe.')
  const tree = await ghJson(`/git/trees/${k.tree}?recursive=1`)
  const oud = wordBestanden(tree.tree).filter((w) => w.bron === bron).sort((a, b) => nieuwer(b.versie, a.versie))
  // nieuwe versie = hoogste + 1, in dezelfde map als de vorige; oude versies weg (blijven in de GitHub-geschiedenis)
  const v: [number, number] = oud.length ? [oud[0].versie[0], oud[0].versie[1] + 1] : [27, 1]
  const map = oud.length ? oud[0].pad.split('/').slice(0, -1).join('/') : 'word'
  const naam = `${bron}_v${v[0]}_${String(v[1]).padStart(2, '0')}.docx`
  const pad = `${map}/${naam}`

  const blob = await ghJson('/git/blobs', { method: 'POST', body: JSON.stringify({ content: encodeBase64(bytes), encoding: 'base64' }) })
  const sha = await commit([{ path: pad, sha: blob.sha }, ...oud.map((o) => ({ path: o.pad, sha: null }))],
    `Beheer: ${naam} (${wie})`)
  return { commit: sha, bestand: naam, weg: oud.map((o) => o.pad) }
}

async function catalogus(body: any, wie: string) {
  controleerCatalogus(body.catalogus)
  const r = await gh('/contents/src/catalogus.json', { method: 'PUT', body: JSON.stringify({
    message: `Beheer: catalogus aangepast (${wie})`, sha: body.catalogusSha, branch: TAK,
    content: encodeBase64(new TextEncoder().encode(catalogusTekst(body.catalogus))) }) })
  if (r.status === 409 || r.status === 422) throw new Fout('De catalogus is intussen op GitHub veranderd. Laad de pagina opnieuw.', 409)
  if (!r.ok) throw new Fout(`GitHub gaf een fout (${r.status}).`, 502)
  const d = await r.json()
  return { commit: d.commit.sha, catalogusSha: d.content.sha }
}

// Stand van de Actions-run voor een commit + de regels van "Word naar site"
async function status(sha: string) {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Fout('Ongeldige commit.')
  const runs = await ghJson(`/actions/runs?head_sha=${sha}&per_page=5`)
  const run = runs.workflow_runs?.[0]
  if (!run) return { stand: 'wachten' }
  const uit: Record<string, unknown> = { stand: run.status, uitkomst: run.conclusion, url: run.html_url }
  if (run.status !== 'completed') return uit
  const jobs = await ghJson(`/actions/runs/${run.id}/jobs`)
  const bouwen = jobs.jobs?.find((j: any) => j.name === 'bouwen')
  if (bouwen) {
    const r = await gh(`/actions/jobs/${bouwen.id}/logs`)
    if (r.ok) {
      const regels = (await r.text()).split('\n').map((l) => l.replace(/^\S+Z /, '').trim())
      const start = regels.findIndex((l) => l.includes('python scripts/word-naar-json.py'))
      const eind = regels.findIndex((l, i) => i > start && l.startsWith('##[group]Run actions/setup-node'))
      uit.omzetter = regels.slice(start + 1, eind > 0 ? eind : undefined)
        .filter((l) => / · |^##\[(warning|error)\]/.test(l))
    }
  }
  return uit
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
    const { data: { user } } = await sb.auth.getUser()
    if (!user?.email) throw new Fout('Niet ingelogd.', 401)
    const { data: mag } = await sb.rpc('is_hl_beheerder')
    if (!mag) throw new Fout('Dit account mag de handleidingen niet beheren.', 403)
    const wie = user.email

    const log = (wat: string, sha?: string) => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
      .from('hl_logboek').insert({ wie, wat, commit_sha: sha ?? null })

    if ((req.headers.get('content-type') ?? '').startsWith('multipart/form-data')) {
      const uit = await upload(await req.formData(), wie)
      await log(`Upload ${uit.bestand}`, uit.commit)
      return antwoord(uit)
    }
    const body = await req.json()
    if (body.actie === 'stand') return antwoord(await stand())
    if (body.actie === 'status') return antwoord(await status(String(body.commit ?? '')))
    if (body.actie === 'catalogus') {
      const uit = await catalogus(body, wie)
      await log(body.omschrijving ? `Catalogus: ${String(body.omschrijving).slice(0, 200)}` : 'Catalogus aangepast', uit.commit)
      return antwoord(uit)
    }
    throw new Fout('Onbekende actie.')
  } catch (e) {
    return antwoord({ fout: e instanceof Error ? e.message : String(e) }, e instanceof Fout ? e.status : 500)
  }
})
