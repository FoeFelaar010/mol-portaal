-- =====================================================================
-- TESTMODUS: inloggen als testaccount (@test.nl) zonder wachtwoord.
-- Werkt via anonieme Supabase-login + koppeling aan een testaccount.
-- Uitzetten: Beheer → Meer → Testmodus uit (of: update instellingen set testmodus = false;)
-- =====================================================================
create table if not exists instellingen (
  id int primary key default 1 check (id = 1),
  testmodus boolean not null default true
);
insert into instellingen (id) values (1) on conflict do nothing;
alter table instellingen enable row level security;
create policy inst_select on instellingen for select using (auth.role() = 'authenticated');
create policy inst_admin  on instellingen for update using (is_admin()) with check (is_admin());

create table if not exists test_sessies (
  uid uuid primary key,
  email text not null check (email like '%@test.nl'),
  aangemaakt timestamptz not null default now()
);
alter table test_sessies enable row level security; -- geen policies: alleen via functies

-- Wie ben ik? Echte login (e-mail in token) of, in testmodus, het gekozen testaccount.
create or replace function my_email() returns text
language sql stable security definer set search_path = public as $$
  select lower(coalesce(
    nullif(auth.jwt() ->> 'email', ''),
    (select t.email from test_sessies t
      where t.uid = auth.uid() and (select testmodus from instellingen where id = 1)),
    ''))
$$;

create or replace function mijn_email() returns text
language sql stable security definer set search_path = public as $$ select my_email() $$;

create or replace function test_accounts()
returns table (email text, naam text, rol text, klas text)
language sql stable security definer set search_path = public as $$
  select email, naam, case when is_admin then 'beheer' else 'mentor' end, null::text
    from docenten where email like '%@test.nl' and (select testmodus from instellingen where id = 1)
  union all
  select email, naam, 'leerling', klas
    from leerlingen where email like '%@test.nl' and (select testmodus from instellingen where id = 1)
  order by 3, 2
$$;

create or replace function test_inloggen(p_email text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not coalesce((select testmodus from instellingen where id = 1), false) then
    raise exception 'De testmodus staat uit. Log in met je schoolaccount.';
  end if;
  if auth.uid() is null then raise exception 'Geen sessie'; end if;
  p_email := lower(trim(p_email));
  if p_email not like '%@test.nl'
     or not exists (select 1 from docenten where email = p_email union all select 1 from leerlingen where email = p_email) then
    raise exception 'Alleen testaccounts (@test.nl) kunnen zo inloggen';
  end if;
  insert into test_sessies (uid, email) values (auth.uid(), p_email)
  on conflict (uid) do update set email = excluded.email, aangemaakt = now();
end $$;

revoke execute on function mijn_email(), test_accounts(), test_inloggen(text) from anon, public;
grant execute on function mijn_email(), test_accounts(), test_inloggen(text) to authenticated;
