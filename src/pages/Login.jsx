import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { Melding } from '../components/ui.jsx'

const TESTLOGIN = import.meta.env.VITE_TESTLOGIN !== 'false'
const ROL = { beheer: 'Beheerder', mentor: 'Docent / mentor', leerling: 'Leerling / ouder' }

export default function Login({ testSessie, klaar }) {
  const [fout, setFout] = useState('')
  const [accounts, setAccounts] = useState(null)
  const [bezig, setBezig] = useState(false)

  async function microsoft() {
    setFout('')
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'azure',
      options: { scopes: 'email', redirectTo: window.location.href.split('#')[0] },
    })
    if (error) setFout(error.message)
  }

  async function laadAccounts() {
    const { data, error } = await supabase.rpc('test_accounts')
    if (error) { setFout(error.message); return }
    setAccounts(data || [])
  }

  // Al een anonieme sessie (bijv. na uitloggen van een testaccount): direct de lijst tonen
  useEffect(() => { if (testSessie) laadAccounts() }, [testSessie])

  async function startTest() {
    setFout('')
    setBezig(true)
    const { error } = await supabase.auth.signInAnonymously()
    setBezig(false)
    if (error) setFout('Testmodus werkt niet: zet in Supabase "Allow anonymous sign-ins" aan. (' + error.message + ')')
  }

  async function kies(a) {
    setBezig(true)
    const { error } = await supabase.rpc('test_inloggen', { p_email: a.email })
    setBezig(false)
    if (error) { setFout(error.message); return }
    klaar?.()
  }

  return (
    <div className="kaart smal">
      <h1>MOL-gesprekken</h1>
      <p>Plan hier het gesprek tussen mentor, ouder(s) en leerling. Log in met je schoolaccount.</p>
      <button className="groot" onClick={microsoft}>Inloggen met Microsoft (schoolaccount)</button>
      <Melding type="fout">{fout}</Melding>
      {!testSessie && <BeheerLogin />}
      {TESTLOGIN && (
        <div className="testmodus">
          <h3>Testmodus</h3>
          {!testSessie && (
            <>
              <p className="zacht klein">Probeer het portaal uit met een testaccount, zonder wachtwoord.</p>
              <button className="secundair" onClick={startTest} disabled={bezig}>Testaccount kiezen</button>
            </>
          )}
          {testSessie && !accounts && <p className="zacht">Laden…</p>}
          {testSessie && accounts && !accounts.length && (
            <p className="zacht">De testmodus staat uit of er zijn geen testaccounts.</p>
          )}
          {testSessie && accounts?.length > 0 && (
            <ul className="lijst testaccounts">
              {accounts.map((a) => (
                <li key={a.email}>
                  <span><strong>{a.email}</strong>
                    <span className="zacht klein"> · {ROL[a.rol]}{a.klas ? ` ${a.klas}` : ''}</span></span>
                  <button className="secundair" onClick={() => kies(a)} disabled={bezig}>Inloggen</button>
                </li>
              ))}
            </ul>
          )}
          {testSessie && <button className="link" onClick={() => supabase.auth.signOut()}>Stoppen</button>}
        </div>
      )}
    </div>
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
