import { svgIconen } from '../iconen.js'

// Logo van het programma (bestand in public/img) of een SVG-icoon uit iconen.js
export default function Icoon({ naam, maat = 44 }) {
  if (/\.(webp|png|svg|jpg)$/.test(naam)) {
    return <span className={`ico ico${maat}`}><img src={`img/${naam}`} alt="" width={maat} height={maat} /></span>
  }
  return (
    <span className={`ico ico${maat} ico-svg`}>
      <svg viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svgIconen[naam] || svgIconen.code }} />
    </span>
  )
}
