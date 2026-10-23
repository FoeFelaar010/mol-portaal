import { createClient } from '@supabase/supabase-js'

// Uitnodigings- of herstel-link uit de mail? Lezen vóórdat Supabase de URL opruimt
export const wachtwoordLink = /type=(invite|recovery)/.test(window.location.hash)

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

// Nette Nederlandse foutmelding uit een Supabase-fout
export function fout(err) {
  if (!err) return ''
  return err.message || String(err)
}
