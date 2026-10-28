-- =====================================================================
-- Naam voor ouders/leerlingen per docent (bv. "Dhr. Bonte"). Al uitgevoerd als migratie
-- "weergavenaam_docent". Daarin zijn ook beschikbare_mentoren, beheer_mentoren_voor,
-- slots_voor_leerling en beheer_slots_voor aangepast: die geven
-- coalesce(nullif(weergavenaam, ''), naam) terug als naam van de mentor.
-- Later (migratie mentornaam_voorletter): functie mentor_naam(naam, weergavenaam) = ingestelde naam,
-- anders voorletter + achternaam ("J. Boelijn"); de vier functies gebruiken die nu.
-- =====================================================================
alter table docenten add column if not exists weergavenaam text check (weergavenaam is null or length(weergavenaam) <= 40);

create or replace function zet_weergavenaam(p_naam text) returns void
language sql security definer set search_path = public as $$
  update docenten set weergavenaam = nullif(left(trim(coalesce(p_naam, '')), 40), '') where id = my_docent_id()
$$;
revoke all on function zet_weergavenaam(text) from public, anon;
grant execute on function zet_weergavenaam(text) to authenticated;
