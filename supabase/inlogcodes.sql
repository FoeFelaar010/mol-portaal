-- =====================================================================
-- Inlogcodes voor leerlingen die (nog) niet met Office 365 kunnen inloggen.
-- * Beheer maakt per leerling een code (8 tekens, bv. K7QM-3XRT); alleen de hash wordt bewaard.
-- * Inloggen met code = anonieme Supabase-sessie + code_inloggen(); geldig 12 uur.
-- * Staat bij de leerling het vinkje sso aan, dan werken code en code-sessies niet meer.
-- * Max. 5 foute pogingen per sessie per kwartier.
-- =====================================================================
alter table leerlingen add column if not exists sso boolean not null default false;

create table if not exists leerling_codes (
  leerling_id uuid primary key references leerlingen(id) on delete cascade,
  code_hash   text not null unique,
  aangemaakt  timestamptz not null default now()
);
create table if not exists code_sessies (
  uid         uuid primary key,
  leerling_id uuid not null references leerlingen(id) on delete cascade,
  aangemaakt  timestamptz not null default now()
);
create table if not exists code_pogingen (
  uid uuid not null,
  at  timestamptz not null default now()
);
create index if not exists code_pogingen_uid_at on code_pogingen (uid, at);
-- RLS aan zonder policies: alleen bereikbaar via de functies hieronder
alter table leerling_codes enable row level security;
alter table code_sessies   enable row level security;
alter table code_pogingen  enable row level security;

create or replace function code_hash(p text) returns text
language sql immutable set search_path = public, extensions as $$
  select encode(digest(upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')), 'sha256'), 'hex')
$$;
revoke all on function code_hash(text) from public, anon, authenticated;

-- Wie ben ik? E-mail uit het inlogtoken, of de leerling van een geldige code-sessie
create or replace function my_email() returns text
language sql stable security definer set search_path = public as $$
  select lower(coalesce(
    nullif(auth.jwt() ->> 'email', ''),
    (select l.email from code_sessies c join leerlingen l on l.id = c.leerling_id
      where c.uid = auth.uid() and not l.sso and c.aangemaakt > now() - interval '12 hours'),
    ''))
$$;

-- Inloggen met code (vanuit een anonieme sessie). Geeft 'ok', 'fout' of 'teveel'.
create or replace function code_inloggen(p_code text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_leerling uuid;
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
    insert into code_pogingen (uid) values (v_uid);
    return 'fout';
  end if;
  insert into code_sessies (uid, leerling_id) values (v_uid, v_leerling)
    on conflict (uid) do update set leerling_id = excluded.leerling_id, aangemaakt = now();
  delete from code_pogingen where uid = v_uid;
  return 'ok';
end $$;

-- Beheer: nieuwe codes maken (oude code en sessies vervallen). Code wordt maar één keer getoond.
create or replace function maak_inlogcodes(p_leerlingen uuid[])
returns table (leerling_id uuid, naam text, klas text, code text)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  l leerlingen;
  v_code text;
  v_alfabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- 32 tekens, geen 0/O/1/I
  i int;
begin
  if not is_admin() then raise exception 'Alleen voor beheerders'; end if;
  for l in select * from leerlingen where id = any(p_leerlingen) and not sso order by klas, naam loop
    v_code := '';
    for i in 1..8 loop
      v_code := v_code || substr(v_alfabet, (get_byte(gen_random_bytes(1), 0) % 32) + 1, 1);
    end loop;
    insert into leerling_codes (leerling_id, code_hash) values (l.id, code_hash(v_code))
      on conflict (leerling_id) do update set code_hash = excluded.code_hash, aangemaakt = now();
    delete from code_sessies cs where cs.leerling_id = l.id;
    leerling_id := l.id; naam := l.naam; klas := l.klas;
    code := substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4);
    return next;
  end loop;
end $$;

-- Beheer: SSO aan/uit voor een groep leerlingen in één keer. Aan = codes en code-sessies weg.
create or replace function zet_sso(p_leerlingen uuid[], p_aan boolean) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not is_admin() then raise exception 'Alleen voor beheerders'; end if;
  update leerlingen set sso = p_aan where id = any(p_leerlingen);
  get diagnostics n = row_count;
  if p_aan then
    delete from leerling_codes where leerling_id = any(p_leerlingen);
    delete from code_sessies where leerling_id = any(p_leerlingen);
  end if;
  return n;
end $$;

-- Beheer: welke leerlingen hebben een code (alleen ja/nee + datum)
create or replace function beheer_code_status()
returns table (leerling_id uuid, aangemaakt timestamptz)
language sql stable security definer set search_path = public as $$
  select c.leerling_id, c.aangemaakt from leerling_codes c where is_admin()
$$;

revoke all on function code_inloggen(text) from public, anon;
revoke all on function maak_inlogcodes(uuid[]) from public, anon;
revoke all on function zet_sso(uuid[], boolean) from public, anon;
revoke all on function beheer_code_status() from public, anon;
grant execute on function code_inloggen(text) to authenticated;
grant execute on function maak_inlogcodes(uuid[]) to authenticated;
grant execute on function zet_sso(uuid[], boolean) to authenticated;
grant execute on function beheer_code_status() to authenticated;

-- Afscherming: lezen alleen voor herkende gebruikers (niet voor een lege anonieme sessie)
alter policy inst_select   on instellingen    using (my_email() <> '');
alter policy ki_select     on klas_instelling using (my_email() <> '');
alter policy km_select     on klas_mentoren   using (my_email() <> '');
alter policy lok_select    on lokalen         using (my_email() <> '');
alter policy mi_select     on mentor_info     using (my_email() <> '');
alter policy dagen_select  on ronde_dagen     using (my_email() <> '');
alter policy rondes_select on rondes          using (my_email() <> '');

-- Later toegevoegd (migratie inlogcodes_terugzien): kolom leerling_codes.code (leesbaar, alleen via functies),
-- maak_inlogcodes slaat de code op, en beheer_codes(uuid[]) toont bestaande codes aan beheerders.

-- Opruimen: verlopen code-sessies en oude pogingen, elk uur
select cron.unschedule(jobid) from cron.job where jobname = 'mol-codes-opschonen';
select cron.schedule('mol-codes-opschonen', '17 * * * *',
  $$delete from public.code_sessies where aangemaakt < now() - interval '12 hours';
    delete from public.code_pogingen where at < now() - interval '1 day'$$);
