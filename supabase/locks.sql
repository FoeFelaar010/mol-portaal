-- Advisory locks: voorkomt dubbel-klik-meldingen en overschrijden van max per mentor bij gelijktijdig boeken
CREATE OR REPLACE FUNCTION public.boek(p_slot uuid, p_opmerking text DEFAULT NULL::text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_leerling uuid := my_leerling_id();
  s slots;
  bestaand boekingen;
begin
  if v_leerling is null then raise exception 'Alleen leerlingen kunnen inschrijven'; end if;
  select * into s from slots where id = p_slot;
  if not found then raise exception 'Tijdslot bestaat niet'; end if;
  perform pg_advisory_xact_lock(hashtext('leerling:' || v_leerling));
  perform pg_advisory_xact_lock(hashtext('docent:' || s.docent_id));
  if not inschrijving_open(s.ronde_id) then raise exception 'De inschrijving is gesloten'; end if;
  select * into bestaand from boekingen where ronde_id = s.ronde_id and leerling_id = v_leerling;
  if bestaand.slot_id = s.id then return; end if;  -- dubbel-klik: al geboekt
  if s.docent_id not in (select docent_id from beschikbare_mentoren(s.ronde_id) where not vol)
     and not exists (select 1 from boekingen b join slots x on x.id = b.slot_id
                     where b.id = bestaand.id and x.docent_id = s.docent_id) then
    raise exception 'Je kunt bij deze docent geen gesprek inplannen';
  end if;
  delete from boekingen where ronde_id = s.ronde_id and leerling_id = v_leerling;
  insert into boekingen (ronde_id, slot_id, leerling_id, opmerking)
  values (s.ronde_id, s.id, v_leerling, nullif(left(trim(coalesce(p_opmerking, coalesce(bestaand.opmerking, ''))), 100), ''));
exception when unique_violation then
  raise exception 'Dit tijdslot is net door iemand anders gekozen. Kies een ander moment.';
end $function$;

CREATE OR REPLACE FUNCTION public.mentor_plan_in(p_slot uuid, p_leerling uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare s slots;
begin
  select * into s from slots where id = p_slot;
  if not found then raise exception 'Tijdslot bestaat niet'; end if;
  if s.docent_id <> my_docent_id() and not is_admin() then raise exception 'Dit is niet jouw tijdslot'; end if;
  perform pg_advisory_xact_lock(hashtext('leerling:' || p_leerling));
  perform pg_advisory_xact_lock(hashtext('docent:' || s.docent_id));
  delete from boekingen where ronde_id = s.ronde_id and leerling_id = p_leerling;
  insert into boekingen (ronde_id, slot_id, leerling_id, door_mentor) values (s.ronde_id, s.id, p_leerling, true);
exception when unique_violation then
  raise exception 'Dit tijdslot is al bezet';
end $function$;
