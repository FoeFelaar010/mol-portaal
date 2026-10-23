import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase.js'
import Login from './pages/Login.jsx'
import Leerling from './pages/Leerling.jsx'
import Mentor from './pages/Mentor.jsx'
import Beheer from './pages/Beheer.jsx'
import { Laden } from './components/ui.jsx'
import { SCHOOL } from './config.js'

export default function App() {
  const [sessie, setSessie] = useState(undefined)
  const [gebruiker, setGebruiker] = useState(null) // {type:'docent'|'leerling'|'onbekend', ...}
  const [weergave, setWeergave] = useState('mentor')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSessie(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSessie(s))
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!sessie) { setGebruiker(null); return }
    const email = (sessie.user.email || '').toLowerCase()
    ;(async () => {
      const { data: d } = await supabase.from('docenten').select('*').eq('email', email).maybeSingle()
      if (d) { setGebruiker({ type: 'docent', ...d }); setWeergave(d.is_admin ? 'beheer' : 'mentor'); return }
      const { data: l } = await supabase.from('leerlingen').select('*').eq('email', email).maybeSingle()
      if (l) { setGebruiker({ type: 'leerling', ...l }); return }
      setGebruiker({ type: 'onbekend', email })
    })()
  }, [sessie])

  const uitloggen = () => supabase.auth.signOut()

  if (sessie === undefined) return <main className="pagina"><Laden /></main>

  return (
    <>
      <header className="kop">
        <div className="merk">
          <img src="/logo.png" alt={SCHOOL.naam} className="logo-img" />
          <span className="app-naam">MOL-gesprekken</span>
        </div>
        {sessie && (
          <div className="kop-acties">
            {gebruiker?.type === 'docent' && gebruiker.is_admin && (
              <button className="kop-knop" onClick={() => setWeergave(weergave === 'beheer' ? 'mentor' : 'beheer')}>
                {weergave === 'beheer' ? 'Mentor' : 'Beheer'}
              </button>
            )}
            <button className="kop-knop" onClick={uitloggen} aria-label="Uitloggen">Uitloggen</button>
          </div>
        )}
      </header>
      <main className="pagina">
        {!sessie && <Login />}
        {sessie && !gebruiker && <Laden />}
        {gebruiker?.type === 'onbekend' && (
          <div className="kaart">
            <h1>Geen toegang</h1>
            <p>Het account <strong>{gebruiker.email}</strong> staat niet in de lijst van het MOL-portaal.</p>
            <p>Ben je leerling? Meld je bij je mentor. Ben je docent? Meld je bij de beheerder.</p>
            <button onClick={uitloggen}>Uitloggen</button>
          </div>
        )}
        {gebruiker?.type === 'leerling' && <Leerling leerling={gebruiker} />}
        {gebruiker?.type === 'docent' && weergave === 'mentor' && <Mentor docent={gebruiker} />}
        {gebruiker?.type === 'docent' && weergave === 'beheer' && <Beheer docent={gebruiker} />}
      </main>
      <footer className="voet">
        MOL-portaal · {SCHOOL.naam} · Je gegevens worden alleen gebruikt om gesprekken te plannen
        en na afloop van de gespreksronde verwijderd.
      </footer>
    </>
  )
}
