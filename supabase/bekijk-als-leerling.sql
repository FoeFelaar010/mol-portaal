-- =====================================================================
-- "Bekijk als leerling": een beheerder ziet wat een leerling ziet.
-- Alleen lezen; dezelfde uitkomst als beschikbare_mentoren / slots_voor_leerling,
-- maar voor een gekozen leerling. Uitvoeren in: SQL Editor → plakken → Run
-- =====================================================================
create or replace function beheer_mentoren_voor(p_ronde uuid, p_leerling uuid)
returns table (docent_id uuid, naam text, info text, vol boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  l leerlingen;
  v_modus text := 'vrij';
  v_max int;
begin
  if not is_admin() then raise exception 'Alleen voor beheerders'; end if;
  select * into l from leerlingen where id = p_leerling;
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

create or replace function beheer_slots_voor(p_ronde uuid, p_leerling uuid)
returns table (slot_id uuid, docent_id uuid, docent_naam text, start timestamptz, eind timestamptz,
               lokaal text, bezet boolean, eigen boolean)
language sql stable security definer set search_path = public as $$
  select s.id, s.docent_id, d.naam, s.start, s.eind, s.lokaal,
         b.id is not null,
         coalesce(b.leerling_id = p_leerling, false)
    from slots s
    join docenten d on d.id = s.docent_id
    left join boekingen b on b.slot_id = s.id
   where s.ronde_id = p_ronde
     and is_admin()
     and (s.docent_id in (select bm.docent_id from beheer_mentoren_voor(p_ronde, p_leerling) bm where not bm.vol)
          or b.leerling_id = p_leerling)
   order by s.start
$$;

revoke all on function beheer_mentoren_voor(uuid, uuid) from public, anon;
revoke all on function beheer_slots_voor(uuid, uuid) from public, anon;
grant execute on function beheer_mentoren_voor(uuid, uuid) to authenticated;
grant execute on function beheer_slots_voor(uuid, uuid) to authenticated;
