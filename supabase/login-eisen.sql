-- Login-eisen: wie telt als ingelogde leerling/docent.
--   Leerling: SSO-vinkje uit -> alleen met inlogcode; vinkje aan -> alleen via Microsoft (azure).
--   Docent: via Microsoft; met e-mail + wachtwoord alleen als beheerder.
--   Zelf aanmelden met e-mail kan alleen nog voor beheerders (anoniem en Microsoft blijven werken).

create or replace function public.my_email()
 returns text language sql stable security definer set search_path to 'public'
as $function$
  with t as (
    select lower(nullif(auth.jwt() ->> 'email', '')) e,
           auth.jwt() -> 'app_metadata' ->> 'provider' p,
           coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) anon)
  select coalesce(
    (select e from t where not anon and e is not null and (
       (p = 'azure' and not exists (select 1 from leerlingen l where lower(l.email) = t.e and not l.sso))
       or (p = 'email' and exists (select 1 from docenten d where lower(d.email) = t.e and d.is_admin)))),
    (select lower(l.email) from code_sessies c join leerlingen l on l.id = c.leerling_id
      where c.uid = auth.uid() and not l.sso and c.aangemaakt > now() - interval '12 hours'),
    '')
$function$;

-- Nieuwe accounts met e-mail alleen voor beheerders
create or replace function public.blokkeer_aanmelden()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if coalesce(new.is_anonymous, false) then return new; end if;
  if coalesce(new.raw_app_meta_data ->> 'provider', 'email') <> 'email' then return new; end if;
  if exists (select 1 from docenten where lower(email) = lower(new.email) and is_admin) then return new; end if;
  raise exception 'Aanmelden met e-mail is niet toegestaan';
end $function$;
revoke execute on function public.blokkeer_aanmelden() from public, anon, authenticated;

drop trigger if exists blokkeer_aanmelden on auth.users;
create trigger blokkeer_aanmelden before insert on auth.users
  for each row execute function public.blokkeer_aanmelden();

-- Algemene gegevens alleen voor mensen uit de lijsten
create or replace function public.is_bekend()
 returns boolean language sql stable security definer set search_path to 'public'
as $function$ select my_docent_id() is not null or my_leerling_id() is not null $function$;

alter policy inst_select on instellingen using (is_bekend());
alter policy ki_select on klas_instelling using (is_bekend());
alter policy km_select on klas_mentoren using (is_bekend());
alter policy lok_select on lokalen using (is_bekend());
alter policy mi_select on mentor_info using (is_bekend());
alter policy dagen_select on ronde_dagen using (is_bekend());
alter policy rondes_select on rondes using (is_bekend());

alter function public.mentor_naam(text, text) set search_path to 'public';
