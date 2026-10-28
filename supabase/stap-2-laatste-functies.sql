-- MOL-portaal · laatste 6 functies (annuleren, verplaatsen, opschonen)
-- Supabase → SQL Editor → New query → alles plakken → Run.
-- Waarschuwing "destructive operation"? Dat komt door de woorden 'delete' in de functies: klik op "Run this query".

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

create or replace function ruim_kan_niet_op() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from kan_niet where ronde_id = new.ronde_id and leerling_id = new.leerling_id;
  return new;
end $$;
drop trigger if exists boeking_ruimt_kan_niet_op on boekingen;
create trigger boeking_ruimt_kan_niet_op after insert on boekingen
  for each row execute function ruim_kan_niet_op();

create or replace function verwijder_oude_data()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
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

-- Daarna: maak jezelf beheerder (vul je eigen schoolmail en naam in) en Run:
-- insert into docenten (email, naam, is_admin) values ('j.bonte@melanchthon.nl', 'J. Bonte', true);
