-- =====================================================================
-- Inlogcodes voor docenten (testfase / zolang Microsoft-login er niet is).
-- * Zelfde werkwijze als leerlingcodes: anonieme sessie + code_inloggen(), 12 uur geldig.
-- * Vinkje docenten.sso aan = code en code-sessies werken niet meer.
-- * Beheerders krijgen geen code (zij loggen in met wachtwoord of Microsoft).
-- * Microsoft-login blijft voor docenten altijd werken (vinkje is alleen voor de code).
-- =====================================================================
alter table docenten add column if not exists sso boolean not null default false;

create table if not exists docent_codes (
  docent_id  uuid primary key references docenten(id) on delete cascade,
  code_hash  text not null unique,
  code       text,
  aangemaakt timestamptz not null default now()
);
alter table docent_codes enable row level security;

alter table code_sessies alter column leerling_id drop not null;
alter table code_sessies add column if not exists docent_id uuid references docenten(id) on delete cascade;
alter table code_sessies drop constraint if exists code_sessies_een;
alter table code_sessies add constraint code_sessies_een check (num_nonnulls(leerling_id, docent_id) = 1);

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
    (select lower(coalesce(l.email, d.email)) from code_sessies c
       left join leerlingen l on l.id = c.leerling_id and not l.sso
       left join docenten d on d.id = c.docent_id and not d.sso and not d.is_admin
      where c.uid = auth.uid() and c.aangemaakt > now() - interval '12 hours'),
    '')
$function$;

create or replace function public.code_inloggen(p_code text)
 returns text language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_leerling uuid;
  v_docent uuid;
begin
  if v_uid is null or not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Gebruik de inlogcode op het inlogscherm.';
  end if;
  if (select count(*) from code_pogingen where uid = v_uid and at > now() - interval '15 minutes') >= 5 then
    return 'teveel';
  end if;
  select c.leerling_id into v_leerling
    from leerling_codes c join leerlingen l on l.id = c.leerling_id
   where c.code_hash = code_hash(p_code) and not l.sso;
  if v_leerling is null then
    select c.docent_id into v_docent
      from docent_codes c join docenten d on d.id = c.docent_id
     where c.code_hash = code_hash(p_code) and not d.sso and not d.is_admin;
  end if;
  if v_leerling is null and v_docent is null then
    insert into code_pogingen (uid) values (v_uid);
    return 'fout';
  end if;
  insert into code_sessies (uid, leerling_id, docent_id) values (v_uid, v_leerling, v_docent)
    on conflict (uid) do update set leerling_id = excluded.leerling_id, docent_id = excluded.docent_id, aangemaakt = now();
  delete from code_pogingen where uid = v_uid;
  return 'ok';
end $function$;

-- Beheer: nieuwe docentcodes (oude code en sessies vervallen)
create or replace function public.maak_docentcodes(p_docenten uuid[])
 returns table (docent_id uuid, naam text, code text)
 language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
#variable_conflict use_column
declare
  d docenten;
  v_code text;
  v_alfabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  i int;
begin
  if not is_admin() then raise exception 'Alleen voor beheerders'; end if;
  for d in select * from docenten where id = any(p_docenten) and not sso and not is_admin order by naam loop
    v_code := '';
    for i in 1..8 loop
      v_code := v_code || substr(v_alfabet, (get_byte(gen_random_bytes(1), 0) % 32) + 1, 1);
    end loop;
    v_code := substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4);
    insert into docent_codes (docent_id, code_hash, code) values (d.id, code_hash(v_code), v_code)
      on conflict (docent_id) do update set code_hash = excluded.code_hash, code = excluded.code, aangemaakt = now();
    delete from code_sessies cs where cs.docent_id = d.id;
    docent_id := d.id; naam := d.naam; code := v_code;
    return next;
  end loop;
end $function$;

-- Beheer: bestaande docentcodes tonen
create or replace function public.beheer_docentcodes(p_docenten uuid[])
 returns table (docent_id uuid, naam text, code text, aangemaakt timestamptz)
 language sql stable security definer set search_path to 'public'
as $function$
  select d.id, d.naam, c.code, c.aangemaakt
    from docent_codes c join docenten d on d.id = c.docent_id
   where is_admin() and d.id = any(p_docenten) and not d.sso
   order by d.naam
$function$;

-- Beheer: welke docenten hebben een code
create or replace function public.beheer_docentcode_status()
 returns table (docent_id uuid, aangemaakt timestamptz)
 language sql stable security definer set search_path to 'public'
as $function$ select c.docent_id, c.aangemaakt from docent_codes c where is_admin() $function$;

-- Beheer: SSO aan/uit voor docenten. Aan = codes en code-sessies weg.
create or replace function public.zet_sso_docent(p_docenten uuid[], p_aan boolean)
 returns int language plpgsql security definer set search_path to 'public'
as $function$
declare n int;
begin
  if not is_admin() then raise exception 'Alleen voor beheerders'; end if;
  update docenten set sso = p_aan where id = any(p_docenten);
  get diagnostics n = row_count;
  if p_aan then
    delete from docent_codes where docent_id = any(p_docenten);
    delete from code_sessies where docent_id = any(p_docenten);
  end if;
  return n;
end $function$;

revoke all on function public.maak_docentcodes(uuid[]) from public, anon;
revoke all on function public.beheer_docentcodes(uuid[]) from public, anon;
revoke all on function public.beheer_docentcode_status() from public, anon;
revoke all on function public.zet_sso_docent(uuid[], boolean) from public, anon;
grant execute on function public.maak_docentcodes(uuid[]) to authenticated;
grant execute on function public.beheer_docentcodes(uuid[]) to authenticated;
grant execute on function public.beheer_docentcode_status() to authenticated;
grant execute on function public.zet_sso_docent(uuid[], boolean) to authenticated;
