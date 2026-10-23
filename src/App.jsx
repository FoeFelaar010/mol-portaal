import { useEffect, useState } from 'react'
import { supabase, wachtwoordLink } from './lib/supabase.js'
import Login, { NieuwWachtwoord } from './pages/Login.jsx'
import Leerling from './pages/Leerling.jsx'
import Mentor from './pages/Mentor.jsx'
import Beheer from './pages/Beheer.jsx'
import { BevestigHost, Laden } from './components/ui.jsx'
import { SCHOOL } from './config.js'

export default function App() {
  const [sessie, setSessie] = useState(undefined)
  const [gebruiker, setGebruiker] = useState(null) // {type:'docent'|'leerling'|'onbekend', ...}
  const [weergave, setWeergave] = useState('mentor')
  const [versie, setVersie] = useState(0) // na kiezen testaccount opnieuw laden
  // Uitnodigings- of herstel-link uit de mail: eerst een wachtwoord laten kiezen
  const [nieuwWw, setNieuwWw] = useState(wachtwoordLink)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSessie(data.session))
    const { data } = supabase.auth.onAuthStateChange((e, s) => {
      if (e === 'PASSWORD_RECOVERY') setNieuwWw(true)
      setSessie(s)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!sessie) { setGebruiker(null); return }
    ;(async () => {
      let email = (sessie.user.email || '').toLowerCase()
      if (!email) { // anonieme sessie: testmodus
        const { data } = await supabase.rpc('mijn_email')
        email = (data || '').toLowerCase()
      }
      if (!email) { setGebruiker({ type: 'test' }); return }
      const { data: d } = await supabase.from('docenten').select('*').eq('email', email).maybeSingle()
      // Wachtwoord-accounts zijn alleen voor beheerders; anderen loggen in met Microsoft
      const alleenWachtwoord = !sessie.user.is_anonymous && (sessie.user.app_metadata?.providers || []).every((p) => p === 'email')
      if (alleenWachtwoord && !d?.is_admin) { setGebruiker({ type: 'onbekend', email, wachtwoord: true }); return }
      if (d) { setGebruiker({ type: 'docent', ...d }); setWeergave(d.is_admin ? 'beheer' : 'mentor'); return }
      const { data: l } = await supabase.from('leerlingen').select('*').eq('email', email).maybeSingle()
      if (l) { setGebruiker({ type: 'leerling', ...l }); return }
      setGebruiker({ type: 'onbekend', email })
    })()
  }, [sessie, versie])

  const uitloggen = () => supabase.auth.signOut()

  if (sessie === undefined) return <main className="pagina"><Laden /></main>

  return (
    <>
      <header className="kop">
        <div className="merk">
          <img src="./logo.png" alt={SCHOOL.naam} className="logo-img" />
          <span className="app-naam">MOL-gesprekken</span>
        </div>
        {sessie && gebruiker?.type !== 'test' && (
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
        {sessie && nieuwWw ? <NieuwWachtwoord klaar={() => { setNieuwWw(false); window.history.replaceState(null, '', window.location.pathname) }} /> : <>
        {(!sessie || gebruiker?.type === 'test') && <Login testSessie={gebruiker?.type === 'test'} klaar={() => setVersie((v) => v + 1)} />}
        {sessie && !gebruiker && <Laden />}
        {gebruiker?.type === 'onbekend' && (
          <div className="kaart">
            <h1>Geen toegang</h1>
            {gebruiker.wachtwoord ? (
              <p>Inloggen met een wachtwoord kan alleen voor beheerders. Log in met <strong>Microsoft (schoolaccount)</strong>.</p>
            ) : (
              <>
                <p>Het account <strong>{gebruiker.email}</strong> staat niet in de lijst van het MOL-portaal.</p>
                <p>Ben je leerling? Meld je bij je mentor. Ben je docent? Meld je bij de beheerder.</p>
              </>
            )}
            <button onClick={uitloggen}>Uitloggen</button>
          </div>
        )}
        {gebruiker?.type === 'leerling' && <Leerling leerling={gebruiker} />}
        {gebruiker?.type === 'docent' && weergave === 'mentor' && <Mentor docent={gebruiker} />}
        {gebruiker?.type === 'docent' && weergave === 'beheer' && <Beheer docent={gebruiker} />}
        </>}
      </main>
      <BevestigHost />
      <footer className="voet">
        MOL-portaal · {SCHOOL.naam} · Je gegevens worden alleen gebruikt om gesprekken te plannen
        en na afloop van de gespreksronde verwijderd.
      </footer>
    </>
  )
}
