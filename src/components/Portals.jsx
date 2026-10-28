import { portalGroepen } from '../portals.js'

function PortalLink({ link }) {
  return (
    <li>
      <a className="portal-link" href={link.url} target="_blank" rel="noopener noreferrer" aria-label={`${link.naam} (nieuw tabblad)`}>
        <span className="portal-icon" aria-hidden="true"><img src={`img/${link.img}`} alt="" width="32" height="32" /></span>
        <span className="portal-name">{link.naam}</span>
        <svg className="portal-arrow" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3h8v8 M13 3 3 13" /></svg>
      </a>
    </li>
  )
}

// variant 'home' = rij kleine tegels boven aan de homepagina, 'menu' = blok in het Menu
export default function Portals({ variant }) {
  if (variant === 'home') {
    return (
      <nav className="home-portals" aria-label="Portals">
        <h2 className="hp-h">Portals</h2>
        {portalGroepen.map((g) => (
          <div key={g.titel}>
            <p className="hp-g">{g.kort}</p>
            <ul>{g.links.map((l) => <PortalLink key={l.naam} link={l} />)}</ul>
          </div>
        ))}
      </nav>
    )
  }
  return (
    <section className="sm-portals" aria-label="Portals">
      <h2 className="sm-h">Portals</h2>
      {portalGroepen.map((g) => (
        <div key={g.titel}>
          <p className="sm-pg">{g.titel}</p>
          <ul className="sm-portal-grid">{g.links.map((l) => <PortalLink key={l.naam} link={l} />)}</ul>
        </div>
      ))}
    </section>
  )
}
