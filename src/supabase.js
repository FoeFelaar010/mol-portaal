import { createClient } from '@supabase/supabase-js'

// Zelfde Supabase-project als het MOL-portaal. De publishable key is openbaar bedoeld; de rechten zitten in Supabase
// (tabel hl_beheerders + Edge Function handleidingen-beheer). Eigen opslagsleutel, zodat het MOL-portaal op hetzelfde
// adres (foefelaar010.github.io) een eigen inlog houdt.
export const supabase = createClient(
  'https://icwpaomwjwlcxzuircgh.supabase.co',
  'sb_publishable_qDFI0ZCsGam0o2rfOjvsmw_EIL52UpD',
  { auth: { storageKey: 'handleidingen-beheer' } },
)

// Edge Function aanroepen; geeft de data terug of gooit een fout met de Nederlandse melding van de server
export async function beheer(body) {
  const { data, error } = await supabase.functions.invoke('handleidingen-beheer', { body })
  if (error) {
    let melding = error.message
    try { melding = (await error.context.json()).fout || melding } catch {}
    throw new Error(melding)
  }
  return data
}
