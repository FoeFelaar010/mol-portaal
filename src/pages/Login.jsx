import { useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { Melding } from '../components/ui.jsx'

export default function Login({ klaar }) {
  const [fout, setFout] = useState('')

  async function microsoft() {
    setFout('')
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'azure',
      options: { scopes: 'email', redirectTo: window.location.href.split('#')[0] },
    })
    if (error) setFout(error.message)
  }

  return (
    <div className="kaart smal">
      <h1>MOL-gesprekken</h1>
      <p>Plan hier het gesprek tussen mentor, ouder(s) en leerling. Log in met je schoolaccount.</p>
      <button className="groot" onClick={microsoft}>Inloggen met Microsoft (schoolaccount)</button>
      <Melding type="fout">{fout}</Melding>
      <CodeLogin klaar={klaar} />
      <BeheerLogin />
    </div>
  )
}

// Leerling zonder (werkend) Office 365-account: inloggen met de code van de mentor
function CodeLogin({ klaar }) {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [fout, setFout] = useState('')
  const [bezig, setBezig] = useState(false)

  async function inloggen(e) {
    e.preventDefault()
    setFout('')
    setBezig(true)
    try {
      const { data: s } = await supabase.auth.getSession()
      if (!s.session?.user?.is_anonymous) {
        const { error } = await supabase.auth.signInAnonymously()
        if (error) throw error
      }
      const { data, error } = await supabase.rpc('code_inloggen', { p_code: code })
      if (error) throw error
      if (data === 'ok') { klaar?.(); return }
      setFout(data === 'teveel' ? 'Te veel pogingen. Probeer het over een kwartier opnieuw.'
        : 'Deze code klopt niet of werkt niet meer. Log dan in met je schoolaccount, of vraag je mentor om een nieuwe code.')
    } catch (err) {
      setFout('Inloggen met code lukt nu niet: ' + (err.message || err))
    } finally {
      setBezig(false)
    }
  }

  if (!open) return <p className="kan-niet-link"><button className="link" onClick={() => setOpen(true)}>Leerling met een inlogcode van je mentor?</button></p>
  return (
    <form className="beheer-login" onSubmit={inloggen}>
      <h3>Inloggen met inlogcode</h3>
      <p className="zacht klein">Gebruik dit alleen als je nog niet met je schoolaccount kunt inloggen.</p>
      <label>Inlogcode<input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Bijv. K7QM-3XRT"
        autoComplete="off" autoCapitalize="characters" spellCheck={false} required minLength={8} maxLength={12} /></label>
      <Melding type="fout">{fout}</Melding>
      <button type="submit" disabled={bezig}>Inloggen</button>
    </form>
  )
}

// Reserve-inlog met e-mail en wachtwoord, alleen voor beheerders.
// Geen mail-links: de linkcontrole van Outlook gebruikt eenmalige links al op.
function BeheerLogin() {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [ww, setWw] = useState('')
  const [bericht, setBericht] = useState(null)
  const [bezig, setBezig] = useState(false)

  async function inloggen(e) {
    e.preventDefault()
    setBezig(true)
    setBericht(null)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: ww })
    setBezig(false)
    if (error) setBericht({ type: 'fout', tekst: error.message === 'Invalid login credentials' ? 'E-mailadres of wachtwoord klopt niet.' : error.message })
  }

  if (!open) return <p className="kan-niet-link"><button className="link" onClick={() => setOpen(true)}>Beheerder? Inloggen met wachtwoord</button></p>
  return (
    <form className="beheer-login" onSubmit={inloggen}>
      <h3>Inloggen als beheerder</h3>
      <label>E-mail<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
      <label>Wachtwoord<input type="password" autoComplete="current-password" value={ww} onChange={(e) => setWw(e.target.value)} required /></label>
      {bericht && <Melding type={bericht.type}>{bericht.tekst}</Melding>}
      <button type="submit" disabled={bezig}>Inloggen</button>
      <p className="zacht klein">Wachtwoord vergeten? Vraag de beheerder van het portaal om een nieuw wachtwoord.</p>
    </form>
  )
}

// Eigen wachtwoord wijzigen (ingelogde beheerder, bij Beheer → Meer)
export function WachtwoordWijzigen() {
  const [ww, setWw] = useState('')
  const [ww2, setWw2] = useState('')
  const [bericht, setBericht] = useState(null)
  const [bezig, setBezig] = useState(false)

  async function bewaar(e) {
    e.preventDefault()
    if (ww.length < 10) { setBericht({ type: 'fout', tekst: 'Kies een wachtwoord van minstens 10 tekens.' }); return }
    if (ww !== ww2) { setBericht({ type: 'fout', tekst: 'De wachtwoorden zijn niet gelijk.' }); return }
    setBezig(true)
    const { error } = await supabase.auth.updateUser({ password: ww })
    setBezig(false)
    if (error) setBericht({ type: 'fout', tekst: error.message })
    else { setBericht({ type: 'ok', tekst: 'Je wachtwoord is gewijzigd.' }); setWw(''); setWw2('') }
  }

  return (
    <form className="kaart" onSubmit={bewaar}>
      <h2>Mijn wachtwoord</h2>
      <div className="raster2">
        <label>Nieuw wachtwoord<input type="password" autoComplete="new-password" value={ww} onChange={(e) => setWw(e.target.value)} required minLength={10} /></label>
        <label>Herhaal wachtwoord<input type="password" autoComplete="new-password" value={ww2} onChange={(e) => setWw2(e.target.value)} required /></label>
      </div>
      {bericht && <Melding type={bericht.type}>{bericht.tekst}</Melding>}
      <button type="submit" disabled={bezig}>Wachtwoord wijzigen</button>
    </form>
  )
}
