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
