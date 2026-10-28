-- =====================================================================
-- Lokaal-capaciteit: hoeveel gesprekken tegelijk in één lokaal (standaard 2).
-- Kleine kamers (VMT, decaan) op 1. Lokalen die niet in de lijst staan: 2.
-- Vervangt de oude regel "een lokaal kan niet dubbel bezet zijn".
-- =====================================================================
alter table lokalen add column if not exists capaciteit int not null default 2
  check (capaciteit between 1 and 5);
update lokalen set capaciteit = 1 where lower(naam) in ('vmt', 'decaan');

alter table slots drop constraint if exists slots_lower_tstzrange_excl;

create or replace function check_lokaal_capaciteit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_cap int;
  v_bezet int;
begin
  if new.lokaal is null then return new; end if;
  -- gelijktijdige invoer voor hetzelfde lokaal na elkaar afhandelen
  perform pg_advisory_xact_lock(hashtext(lower(new.lokaal)));
  select capaciteit into v_cap from lokalen where lower(naam) = lower(new.lokaal);
  v_cap := coalesce(v_cap, 2);
  select count(*) into v_bezet from slots s
   where lower(s.lokaal) = lower(new.lokaal)
     and s.id <> new.id
     and tstzrange(s.start, s.eind) && tstzrange(new.start, new.eind);
  if v_bezet >= v_cap then
    raise exception 'Lokaal % is op dat moment vol (max % tegelijk)', new.lokaal, v_cap
      using errcode = 'exclusion_violation';  -- genereer_slots slaat zo'n slot over
  end if;
  return new;
end $$;

drop trigger if exists slots_lokaal_capaciteit on slots;
create trigger slots_lokaal_capaciteit before insert or update of lokaal, start, eind on slots
  for each row execute function check_lokaal_capaciteit();
