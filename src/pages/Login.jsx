import { useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { Melding } from '../components/ui.jsx'

const TESTLOGIN = import.meta.env.VITE_TESTLOGIN !== 'false'

export default function Login() {
  const [email, setEmail] = useState('')
  const [ww, setWw] = useState('')
  const [fout, setFout] = useState('')

  async function microsoft() {
    setFout('')
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'azure',
      options: { scopes: 'email', redirectTo: window.location.origin },
    })
    if (error) setFout(error.message)
  }

  async function test(e) {
    e.preventDefault()
    setFout('')
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: ww })
    if (error) setFout('Inloggen mislukt. Controleer e-mail en wachtwoord.')
  }

  return (
    <div className="kaart smal">
      <h1>MOL-gesprekken</h1>
      <p>Plan hier het gesprek tussen mentor, ouder(s) en leerling. Log in met je schoolaccount.</p>
      <button className="groot" onClick={microsoft}>Inloggen met Microsoft (schoolaccount)</button>
      <Melding type="fout">{fout}</Melding>
      {TESTLOGIN && (
        <details className="test">
          <summary>Inloggen met testaccount</summary>
          <form onSubmit={test}>
            <label>E-mail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
            <label>Wachtwoord<input type="password" value={ww} onChange={(e) => setWw(e.target.value)} required /></label>
            <button type="submit">Inloggen</button>
          </form>
        </details>
      )}
    </div>
  )
}
