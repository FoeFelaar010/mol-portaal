-- =====================================================================
-- MOL-portaal  ·  databaseschema voor Supabase (Postgres 15+)
-- Uitvoeren in: Supabase dashboard → SQL Editor → plakken → Run
-- Tijdzone voor alle gespreksplanning: Europe/Amsterdam
-- =====================================================================

create extension if not exists btree_gist;

-- ---------------------------------------------------------------------
-- Tabellen
-- ---------------------------------------------------------------------
create table if not exists docenten (
  id        uuid primary key default gen_random_uuid(),
  email     text not null unique check (email = lower(email)),
  naam      text not null,
  is_admin  boolean not null default false,
  -- geheime sleutel voor de agenda-koppeling (Outlook/Teams abonnement)
  agenda_token uuid not null unique default gen_random_uuid()
);

create table if not exists leerlingen (
  id              uuid primary key default gen_random_uuid(),
  email           text not null unique check (email = lower(email)),
  naam            text not null,
  klas            text not null,
  leerlingnummer  text
);
create index if not exists leerlingen_klas_idx on leerlingen(klas);

create table if not exists klas_mentoren (
  klas      text not null,
  docent_id uuid not null references docenten(id) on delete cascade,
  primary key (klas, docent_id)
);

create table if not exists rondes (
  id                uuid primary key default gen_random_uuid(),
  naam              text not null,
  inschrijven_vanaf timestamptz,
  inschrijven_tot   timestamptz,
  open              boolean not null default false,
  aangemaakt        timestamptz not null default now()
);

create table if not exists ronde_dagen (
  id        uuid primary key default gen_random_uuid(),
  ronde_id  uuid not null references rondes(id) on delete cascade,
  datum     date not null,
  van       time not null,
  tot       time not null,
  check (tot > van),
  unique (ronde_id, datum)
);

-- Per klas per ronde: hoe duo-mentoren de leerlingen verdelen
--   vrij     = leerling kiest zelf (optioneel maximum per mentor)
--   verdelen = elke leerling is toegewezen aan één mentor
-- (Gesprekken samen voeren: laat één mentor de tijden invullen.)
create table if not exists klas_instelling (
  ronde_id        uuid not null references rondes(id) on delete cascade,
  klas            text not null,
  modus           text not null default 'vrij' check (modus in ('vrij','verdelen')),
  max_per_mentor  int check (max_per_mentor is null or max_per_mentor > 0),
  primary key (ronde_id, klas)
);

create table if not exists toewijzing (
  ronde_id    uuid not null references rondes(id) on delete cascade,
  leerling_id uuid not null references leerlingen(id) on delete cascade,
  docent_id   uuid not null references docenten(id) on delete cascade,
  primary key (ronde_id, leerling_id)
);

create table if not exists mentor_info (
  ronde_id  uuid not null references rondes(id) on delete cascade,
  docent_id uuid not null references docenten(id) on delete cascade,
  tekst     text not null default '' check (length(tekst) <= 1000),
  primary key (ronde_id, docent_id)
);

create table if not exists slots (
  id        uuid primary key default gen_random_uuid(),
  ronde_id  uuid not null references rondes(id) on delete cascade,
  docent_id uuid not null references docenten(id) on delete cascade,
  start     timestamptz not null,
  eind      timestamptz not null,
  lokaal    text,
  check (eind > start),
  -- een docent kan niet twee gesprekken tegelijk hebben
  exclude using gist (docent_id with =, tstzrange(start, eind) with &&),
  -- een lokaal kan niet dubbel bezet zijn
  exclude using gist (lower(lokaal) with =, tstzrange(start, eind) with &&) where (lokaal is not null)
);
create index if not exists slots_ronde_idx on slots(ronde_id, docent_id);

create table if not exists boekingen (
  id          uuid primary key default gen_random_uuid(),
  ronde_id    uuid not null references rondes(id) on delete cascade,
  slot_id     uuid not null unique references slots(id) on delete restrict,
  leerling_id uuid not null references leerlingen(id) on delete cascade,
  opmerking   text check (opmerking is null or length(opmerking) <= 100),
  door_mentor boolean not null default false,
  aangemaakt  timestamptz not null default now(),
  unique (ronde_id, leerling_id)
);

-- ---------------------------------------------------------------------
-- Hulpfuncties (wie is de ingelogde gebruiker?)
-- Koppeling gaat op e-mailadres uit het inlogtoken (Microsoft SSO of test).
-- ---------------------------------------------------------------------
create or replace function my_email() returns text
language sql stable as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

create or replace function my_docent_id() returns uuid
language sql stable security definer set search_path = public as
$$ select id from docenten where email = my_email() $$;

create or replace function my_leerling_id() returns uuid
language sql stable security definer set search_path = public as
$$ select id from leerlingen where email = my_email() $$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce((select is_admin from docenten where email = my_email()), false) $$;

create or replace function is_docent() returns boolean
language sql stable as $$ select my_docent_id() is not null $$;

create or replace function is_mentor_van_klas(p_klas text) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from klas_mentoren where klas = p_klas and docent_id = my_docent_id()) $$;

create or replace function is_mentor_van_leerling(p_leerling uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from leerlingen l join klas_mentoren km on km.klas = l.klas
                  where l.id = p_leerling and km.docent_id = my_docent_id()) $$;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table docenten        enable row level security;
alter table leerlingen      enable row level security;
alter table klas_mentoren   enable row level security;
alter table rondes          enable row level security;
alter table ronde_dagen     enable row level security;
alter table klas_instelling enable row level security;
alter table toewijzing      enable row level security;
alter table mentor_info     enable row level security;
alter table slots           enable row level security;
alter table boekingen       enable row level security;

-- docenten: docenten zien collega's; alleen beheer wijzigt
create policy docenten_select on docenten for select using (is_docent() or email = my_email());
create policy docenten_admin  on docenten for all using (is_admin()) with check (is_admin());

-- leerlingen: leerling ziet zichzelf, docenten zien leerlingen, beheer wijzigt
create policy leerlingen_select on leerlingen for select using (email = my_email() or is_docent());
create policy leerlingen_admin  on leerlingen for all using (is_admin()) with check (is_admin());

-- klas_mentoren
create policy km_select on klas_mentoren for select using (auth.role() = 'authenticated');
create policy km_admin  on klas_mentoren for all using (is_admin()) with check (is_admin());

-- rondes, dagen: iedereen ingelogd leest, beheer wijzigt
create policy rondes_select on rondes      for select using (auth.role() = 'authenticated');
create policy rondes_admin  on rondes      for all using (is_admin()) with check (is_admin());
create policy dagen_select  on ronde_dagen for select using (auth.role() = 'authenticated');
create policy dagen_admin   on ronde_dagen for all using (is_admin()) with check (is_admin());

-- klas_instelling: mentor van de klas of beheer
create policy ki_select on klas_instelling for select using (auth.role() = 'authenticated');
create policy ki_write  on klas_instelling for all using (is_admin() or is_mentor_van_klas(klas))
                                              with check (is_admin() or is_mentor_van_klas(klas));

-- toewijzing
create policy tw_select on toewijzing for select using (is_docent() or leerling_id = my_leerling_id());
create policy tw_write  on toewijzing for all
  using (is_admin() or is_mentor_van_leerling(leerling_id))
  with check (is_admin() or is_mentor_van_leerling(leerling_id));

-- mentor_info: iedereen leest, docent schrijft eigen tekst
create policy mi_select on mentor_info for select using (auth.role() = 'authenticated');
create policy mi_write  on mentor_info for all using (docent_id = my_docent_id() or is_admin())
                                          with check (docent_id = my_docent_id() or is_admin());

-- slots: docenten lezen alles (lokaalconflicten), leerlingen gaan via functies.
-- Aanmaken gaat via genereer_slots(); verwijderen mag eigen docent of beheer.
create policy slots_select on slots for select using (is_docent());
create policy slots_delete on slots for delete using (docent_id = my_docent_id() or is_admin());
create policy slots_admin  on slots for all using (is_admin()) with check (is_admin());

-- boekingen: leerling eigen, docent van het slot, mentor van de leerling, beheer.
-- Boeken/annuleren alleen via functies hieronder.
create policy boek_select on boekingen for select using (
  leerling_id = my_leerling_id()
  or is_admin()
  or is_mentor_van_leerling(leerling_id)
  or exists (select 1 from slots s where s.id = slot_id and s.docent_id = my_docent_id())
);
create policy boek_admin on boekingen for delete using (is_admin());

-- ---------------------------------------------------------------------
-- Functies voor docenten
-- ---------------------------------------------------------------------

-- Maak tijdslots binnen een toegestane gespreksdag
create or replace function genereer_slots(
  p_ronde uuid, p_datum date, p_van time, p_tot time,
  p_duur int, p_pauze_na int default 0, p_pauze_min int default 0, p_lokaal text default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_docent uuid := my_docent_id();
  v_dag ronde_dagen;
  t timestamptz;
  grens timestamptz;
  n int := 0;
  gemaakt int := 0;
begin
  if v_docent is null then raise exception 'Alleen docenten kunnen beschikbaarheid invullen'; end if;
  if p_duur < 5 or p_duur > 120 then raise exception 'Gespreksduur moet tussen 5 en 120 minuten liggen'; end if;
  select * into v_dag from ronde_dagen where ronde_id = p_ronde and datum = p_datum;
  if not found then raise exception 'Deze datum hoort niet bij de gespreksronde'; end if;
  if p_van < v_dag.van or p_tot > v_dag.tot then
    raise exception 'Kies tijden tussen % en %', to_char(v_dag.van, 'HH24:MI'), to_char(v_dag.tot, 'HH24:MI');
  end if;
  p_lokaal := nullif(trim(p_lokaal), '');

  t     := (p_datum + p_van) at time zone 'Europe/Amsterdam';
  grens := (p_datum + p_tot) at time zone 'Europe/Amsterdam';
  while t + make_interval(mins => p_duur) <= grens loop
    begin
      insert into slots (ronde_id, docent_id, start, eind, lokaal)
      values (p_ronde, v_docent, t, t + make_interval(mins => p_duur), p_lokaal);
      gemaakt := gemaakt + 1;
    exception when exclusion_violation then
      null; -- overlapt met eigen slot of lokaal is bezet: overslaan
    end;
    n := n + 1;
    t := t + make_interval(mins => p_duur);
    if p_pauze_na > 0 and n % p_pauze_na = 0 then
      t := t + make_interval(mins => p_pauze_min);
    end if;
  end loop;
  return gemaakt;
end $$;

-- Mentor plant een leerling direct in (leerling kan dit niet zelf annuleren)
create or replace function mentor_plan_in(p_slot uuid, p_leerling uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s slots;
begin
  select * into s from slots where id = p_slot;
  if not found then raise exception 'Tijdslot bestaat niet'; end if;
  if s.docent_id <> my_docent_id() and not is_admin() then raise exception 'Dit is niet jouw tijdslot'; end if;
  delete from boekingen where ronde_id = s.ronde_id and leerling_id = p_leerling;
  insert into boekingen (ronde_id, slot_id, leerling_id, door_mentor) values (s.ronde_id, s.id, p_leerling, true);
exception when unique_violation then
  raise exception 'Dit tijdslot is al bezet';
end $$;

create or replace function mentor_annuleer(p_boeking uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from boekingen b using slots s
   where b.id = p_boeking and s.id = b.slot_id
     and (s.docent_id = my_docent_id() or is_admin() or is_mentor_van_leerling(b.leerling_id));
end $$;

-- ---------------------------------------------------------------------
-- Functies voor leerlingen
-- ---------------------------------------------------------------------

create or replace function inschrijving_open(p_ronde uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select open
                     and (inschrijven_vanaf is null or now() >= inschrijven_vanaf)
                     and (inschrijven_tot   is null or now() <  inschrijven_tot)
                   from rondes where id = p_ronde), false)
$$;

-- Welke mentoren mag deze leerling kiezen?
create or replace function beschikbare_mentoren(p_ronde uuid)
returns table (docent_id uuid, naam text, info text, vol boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  l leerlingen;
  v_modus text := 'vrij';
  v_max int;
begin
  select * into l from leerlingen where id = my_leerling_id();
  if not found then return; end if;
  select ki.modus, ki.max_per_mentor into v_modus, v_max
    from klas_instelling ki where ki.ronde_id = p_ronde and ki.klas = l.klas;
  v_modus := coalesce(v_modus, 'vrij');

  return query
  select d.id, d.naam, coalesce(mi.tekst, ''),
         case when v_modus = 'vrij' and v_max is not null then
           (select count(*) from boekingen b
              join slots s on s.id = b.slot_id
              join leerlingen l2 on l2.id = b.leerling_id
             where b.ronde_id = p_ronde and s.docent_id = d.id
               and l2.klas = l.klas and b.leerling_id <> l.id) >= v_max
         else false end
    from klas_mentoren km
    join docenten d on d.id = km.docent_id
    left join mentor_info mi on mi.ronde_id = p_ronde and mi.docent_id = d.id
   where km.klas = l.klas
     and (v_modus <> 'verdelen'
          or not exists (select 1 from toewijzing t where t.ronde_id = p_ronde and t.leerling_id = l.id)
          or exists (select 1 from toewijzing t where t.ronde_id = p_ronde and t.leerling_id = l.id and t.docent_id = d.id))
   order by d.naam;
end $$;

-- Tijdslots die de leerling ziet: bezet zonder naam
create or replace function slots_voor_leerling(p_ronde uuid)
returns table (slot_id uuid, docent_id uuid, docent_naam text, start timestamptz, eind timestamptz,
               lokaal text, bezet boolean, eigen boolean)
language sql stable security definer set search_path = public as $$
  select s.id, s.docent_id, d.naam, s.start, s.eind, s.lokaal,
         b.id is not null,
         coalesce(b.leerling_id = my_leerling_id(), false)
    from slots s
    join docenten d on d.id = s.docent_id
    left join boekingen b on b.slot_id = s.id
   where s.ronde_id = p_ronde
     and my_leerling_id() is not null
     and (s.docent_id in (select bm.docent_id from beschikbare_mentoren(p_ronde) bm where not bm.vol)
          or b.leerling_id = my_leerling_id())
   order by s.start
$$;

create or replace function boek(p_slot uuid, p_opmerking text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_leerling uuid := my_leerling_id();
  s slots;
  bestaand boekingen;
begin
  if v_leerling is null then raise exception 'Alleen leerlingen kunnen inschrijven'; end if;
  select * into s from slots where id = p_slot;
  if not found then raise exception 'Tijdslot bestaat niet'; end if;
  if not inschrijving_open(s.ronde_id) then raise exception 'De inschrijving is gesloten'; end if;
  if s.docent_id not in (select docent_id from beschikbare_mentoren(s.ronde_id) where not vol) then
    raise exception 'Je kunt bij deze docent geen gesprek inplannen';
  end if;
  select * into bestaand from boekingen where ronde_id = s.ronde_id and leerling_id = v_leerling;
  if found and bestaand.door_mentor then
    raise exception 'Je mentor heeft je al ingepland. Neem contact op met je mentor om te wijzigen.';
  end if;
  delete from boekingen where ronde_id = s.ronde_id and leerling_id = v_leerling;
  insert into boekingen (ronde_id, slot_id, leerling_id, opmerking)
  values (s.ronde_id, s.id, v_leerling, nullif(left(trim(coalesce(p_opmerking, coalesce(bestaand.opmerking, ''))), 100), ''));
exception when unique_violation then
  raise exception 'Dit tijdslot is net door iemand anders gekozen. Kies een ander moment.';
end $$;

create or replace function annuleer(p_ronde uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not inschrijving_open(p_ronde) then raise exception 'De inschrijving is gesloten'; end if;
  if exists (select 1 from boekingen where ronde_id = p_ronde and leerling_id = my_leerling_id() and door_mentor) then
    raise exception 'Je mentor heeft deze afspraak gemaakt. Neem contact op met je mentor.';
  end if;
  delete from boekingen where ronde_id = p_ronde and leerling_id = my_leerling_id();
end $$;

create or replace function wijzig_opmerking(p_ronde uuid, p_opmerking text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not inschrijving_open(p_ronde) then raise exception 'De inschrijving is gesloten'; end if;
  update boekingen set opmerking = nullif(left(trim(coalesce(p_opmerking, '')), 100), '')
   where ronde_id = p_ronde and leerling_id = my_leerling_id();
end $$;

-- ---------------------------------------------------------------------
-- AVG: opschonen. Verwijdert boekingen, slots en opmerkingen van rondes
-- waarvan de laatste gespreksdag meer dan 30 dagen geleden was.
-- ---------------------------------------------------------------------
create or replace function verwijder_oude_data()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  -- alleen beheer, of de nachtelijke taak (pg_cron draait als database-eigenaar zonder login)
  if not is_admin() and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'Alleen beheer';
  end if;
  with oud as (
    select r.id from rondes r
     where (select max(datum) from ronde_dagen d where d.ronde_id = r.id) < current_date - 30
  )
  delete from rondes where id in (select id from oud);
  get diagnostics n = row_count;
  return n;
end $$;

-- Optioneel: dagelijks automatisch opschonen (Database → Extensions → pg_cron aanzetten)
-- select cron.schedule('mol-opschonen', '0 3 * * *', $$ select verwijder_oude_data(); $$);

-- ---------------------------------------------------------------------
-- Agenda-abonnement voor Outlook / Teams
-- URL: <supabase-url>/rest/v1/rpc/agenda_feed?token=<agenda_token>&apikey=<anon key>
-- Outlook haalt deze agenda automatisch opnieuw op; wijzigingen komen vanzelf mee.
-- ---------------------------------------------------------------------
-- "*/*" = PostgREST geeft de ruwe inhoud terug, ongeacht wat de agenda-app vraagt
do $$ begin
  create domain "*/*" as bytea;
exception when duplicate_object then null; end $$;

create or replace function ics_tekst(t text) returns text language sql immutable as $$
  select replace(replace(replace(replace(replace(coalesce(t, ''), '\', '\\'), E'\n', '\n'), E'\r', ''), ',', '\,'), ';', '\;')
$$;

create or replace function agenda_feed(token uuid) returns "*/*"
language plpgsql stable security definer set search_path = public as $$
declare
  d docenten;
  r record;
  uit text;
  fmt constant text := 'YYYYMMDD"T"HH24MISS"Z"';
begin
  select * into d from docenten where agenda_token = token;
  if not found then raise exception 'Onbekende agenda'; end if;
  perform set_config('response.headers',
    '[{"Content-Type": "text/calendar; charset=utf-8"}, {"Content-Disposition": "inline; filename=mol.ics"}, {"Cache-Control": "no-cache"}]', true);
  uit := 'BEGIN:VCALENDAR' || E'\r\n' || 'VERSION:2.0' || E'\r\n' ||
         'PRODID:-//MOL-portaal//NL' || E'\r\n' || 'METHOD:PUBLISH' || E'\r\n' ||
         'X-WR-CALNAME:MOL-gesprekken ' || ics_tekst(d.naam) || E'\r\n' ||
         'REFRESH-INTERVAL;VALUE=DURATION:PT1H' || E'\r\n' || 'X-PUBLISHED-TTL:PT1H' || E'\r\n';
  for r in
    select s.id, s.start, s.eind, s.lokaal, l.naam, l.klas, b.opmerking
      from slots s
      join boekingen b on b.slot_id = s.id
      join leerlingen l on l.id = b.leerling_id
     where s.docent_id = d.id and s.eind > now() - interval '60 days'
     order by s.start
  loop
    uit := uit || 'BEGIN:VEVENT' || E'\r\n' ||
      'UID:' || r.id || '@mol-portaal' || E'\r\n' ||
      'DTSTAMP:' || to_char(now() at time zone 'UTC', fmt) || E'\r\n' ||
      'DTSTART:' || to_char(r.start at time zone 'UTC', fmt) || E'\r\n' ||
      'DTEND:' || to_char(r.eind at time zone 'UTC', fmt) || E'\r\n' ||
      'SUMMARY:' || ics_tekst('MOL: ' || r.naam || ' (' || r.klas || ')') || E'\r\n' ||
      case when r.lokaal is not null then 'LOCATION:' || ics_tekst('Lokaal ' || r.lokaal) || E'\r\n' else '' end ||
      case when r.opmerking is not null then 'DESCRIPTION:' || ics_tekst('Opmerking: ' || r.opmerking) || E'\r\n' else '' end ||
      'END:VEVENT' || E'\r\n';
  end loop;
  return convert_to(uit || 'END:VCALENDAR' || E'\r\n', 'UTF8');
end $$;

-- Nieuwe agenda-link (oude werkt dan niet meer)
create or replace function nieuwe_agenda_link() returns uuid
language sql security definer set search_path = public as $$
  update docenten set agenda_token = gen_random_uuid() where id = my_docent_id() returning agenda_token
$$;

-- Alle functies controleren zelf wie er ingelogd is; agenda_feed is beveiligd met het geheime token.

-- ---------------------------------------------------------------------
-- "Geen enkel moment past": leerling/ouder meldt dit met reden + voorkeur.
-- Het gesprek blijft verplicht; de mentor neemt contact op en plant zelf in.
-- ---------------------------------------------------------------------
create table if not exists kan_niet (
  ronde_id    uuid not null references rondes(id) on delete cascade,
  leerling_id uuid not null references leerlingen(id) on delete cascade,
  reden       text not null check (length(reden) between 3 and 200),
  voorkeur    text check (voorkeur is null or length(voorkeur) <= 100),
  aangemaakt  timestamptz not null default now(),
  primary key (ronde_id, leerling_id)
);
alter table kan_niet enable row level security;
create policy kn_select on kan_niet for select
  using (leerling_id = my_leerling_id() or is_admin() or is_mentor_van_leerling(leerling_id));
create policy kn_delete on kan_niet for delete
  using (is_admin() or is_mentor_van_leerling(leerling_id));

create or replace function meld_kan_niet(p_ronde uuid, p_reden text, p_voorkeur text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_leerling uuid := my_leerling_id();
begin
  if v_leerling is null then raise exception 'Alleen leerlingen kunnen dit doorgeven'; end if;
  if not inschrijving_open(p_ronde) then raise exception 'De inschrijving is gesloten. Neem contact op met je mentor.'; end if;
  if exists (select 1 from boekingen where ronde_id = p_ronde and leerling_id = v_leerling) then
    raise exception 'Je hebt al een afspraak. Annuleer die eerst of kies een ander moment.';
  end if;
  if length(trim(coalesce(p_reden, ''))) < 3 then raise exception 'Geef kort aan waarom geen moment past.'; end if;
  insert into kan_niet (ronde_id, leerling_id, reden, voorkeur)
  values (p_ronde, v_leerling, left(trim(p_reden), 200), nullif(left(trim(coalesce(p_voorkeur, '')), 100), ''))
  on conflict (ronde_id, leerling_id) do update set reden = excluded.reden, voorkeur = excluded.voorkeur, aangemaakt = now();
end $$;

-- Een afspraak maken ruimt de melding automatisch op
create or replace function ruim_kan_niet_op() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from kan_niet where ronde_id = new.ronde_id and leerling_id = new.leerling_id;
  return new;
end $$;
drop trigger if exists boeking_ruimt_kan_niet_op on boekingen;
create trigger boeking_ruimt_kan_niet_op after insert on boekingen
  for each row execute function ruim_kan_niet_op();
