import { groepen } from '../catalogus.js'
import Icoon from '../components/Icoon.jsx'
import Portals from '../components/Portals.jsx'

export default function Home() {
  return (
    <main className="home" id="main">
      <Portals variant="home" />
      <div className="home-hero">
        <h1>Handleidingen</h1>
        <p className="lead">Leer zelf werken met de programma's en machines van school. Kies een handleiding en werk stap voor stap, in je eigen tempo.</p>
      </div>
      {groepen.map((g) => (
        <section className="grp" key={g.titel}>
          <h2>{g.titel}</h2>
          <p>{g.tekst}</p>
          <ul className="cards">
            {g.items.map((it) => (
              <li key={it.slug}>
                <a className="card" href={`#/${it.slug}`}>
                  <Icoon naam={it.icoon} />
                  <span className="ct">
                    <b>{it.titel}{it.slot && <> <span className="beta slot-label">🔒 Code</span></>}{it.beta && !it.slot && <> <span className="beta">Beta</span></>}</b>
                    <span>{it.tekst}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <footer className="foot">Handleidingen · Melanchthon Mavo Schiebroek</footer>
    </main>
  )
}
