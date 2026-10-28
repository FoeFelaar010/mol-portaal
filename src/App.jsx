import { lazy, Suspense, useEffect, useState } from 'react'
import { vindItem } from './catalogus.js'
import Top from './components/Top.jsx'
import Home from './pages/Home.jsx'
import Handleiding from './pages/Handleiding.jsx'
import Codeslot, { isOntgrendeld } from './components/Codeslot.jsx'
// Beheer (met Supabase) apart laden, zodat leerlingen die code niet hoeven te downloaden
const Beheer = lazy(() => import('./pages/Beheer.jsx'))

// Adressen zoals op de oude site: #/teams of #/teams/3-je-klas-openen
function leesHash() {
  const [slug = '', anker = ''] = location.hash.replace(/^#\/?/, '').split('/')
  return { slug, anker }
}

export default function App() {
  const [route, setRoute] = useState(leesHash)
  const [navOpen, setNavOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [groot, setGroot] = useState(null) // afbeelding in de lightbox
  const [, setOpen] = useState(0) // na het invullen van een code opnieuw tekenen

  useEffect(() => {
    const f = () => { setRoute(leesHash()); setMenuOpen(false); setNavOpen(false) }
    addEventListener('hashchange', f)
    return () => removeEventListener('hashchange', f)
  }, [])

  // eén klik-afhandeling voor zoomen en het sluiten van menu's
  useEffect(() => {
    const klik = (e) => {
      const z = e.target.closest('.zoom')
      if (z) { const im = z.querySelector('img'); if (im) setGroot({ src: im.src, knop: z }); return }
      if (!e.target.closest('.sitemenu, .top-menu')) setMenuOpen(false)
      if (!e.target.closest('#nav, .menu')) setNavOpen(false)
    }
    const toets = (e) => { if (e.key === 'Escape') { setGroot(null); setMenuOpen(false); setNavOpen(false) } }
    document.addEventListener('click', klik)
    document.addEventListener('keydown', toets)
    return () => { document.removeEventListener('click', klik); document.removeEventListener('keydown', toets) }
  }, [])

  const sluitGroot = () => { groot?.knop?.focus(); setGroot(null) }

  const item = vindItem(route.slug)
  const isBeheer = route.slug === 'beheer'
  useEffect(() => { if (!item && !isBeheer) { document.title = 'Handleidingen · Melanchthon Mavo Schiebroek'; window.scrollTo(0, 0) } }, [item])

  return (
    <>
      <Top metHoofdstukken={!!item && isOntgrendeld(item)} navOpen={navOpen} setNavOpen={setNavOpen} menuOpen={menuOpen} setMenuOpen={setMenuOpen} />
      {isBeheer ? <Suspense fallback={<main className="home"><p>Laden…</p></main>}><Beheer /></Suspense>
        : !item ? <Home />
        : !isOntgrendeld(item) ? <Codeslot key={item.slug} item={item} onOpen={() => setOpen((n) => n + 1)} />
        : <Handleiding key={item.slug} item={item} anker={route.anker} navOpen={navOpen} setNavOpen={setNavOpen} />}
      <div className="lb" hidden={!groot} onClick={(e) => { if (e.target.tagName !== 'IMG') sluitGroot() }}>
        <button className="lb-x" type="button">Sluiten</button>
        {groot && <img src={groot.src} alt="" />}
      </div>
    </>
  )
}
