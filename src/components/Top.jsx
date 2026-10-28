import { groepen } from '../catalogus.js'
import Portals from './Portals.jsx'

// Paarse menubalk + uitklapmenu met alle handleidingen en portals
export default function Top({ metHoofdstukken, navOpen, setNavOpen, menuOpen, setMenuOpen }) {
  return (
    <>
      <header className="top">
        <a className="top-school" href="#/">
          <img src="img/logo-school.png" alt="Melanchthon Mavo Schiebroek, naar alle handleidingen" width="1163" height="275" />
        </a>
        {metHoofdstukken && (
          <button className="menu" type="button" aria-controls="nav" aria-expanded={navOpen}
            onClick={() => { setNavOpen(!navOpen); setMenuOpen(false) }}>Hoofdstukken</button>
        )}
        <button className="top-menu" type="button" aria-haspopup="true" aria-expanded={menuOpen}
          onClick={() => { setMenuOpen(!menuOpen); setNavOpen(false) }}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          <span>Menu</span>
        </button>
      </header>
      <div className="sitemenu" hidden={!menuOpen}>
        <div className="sm-in">
          <a className="sm-home" href="#/">Alle handleidingen</a>
          <Portals variant="menu" />
          <div className="sm-cols">
            {groepen.map((g) => (
              <div className="sm-g" key={g.titel}>
                <p className="sm-h">{g.titel}</p>
                <ul>{g.items.map((it) => <li key={it.slug}><a href={`#/${it.slug}`}>{it.titel}</a></li>)}</ul>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
