-- Beheer van de Handleidingen-site (al uitgevoerd op 28 okt 2026 in project icwpaomwjwlcxzuircgh, zelfde als MOL-portaal)
create table if not exists public.hl_beheerders (
  email text primary key check (email = lower(email)),
  toegevoegd timestamptz not null default now()
);
alter table public.hl_beheerders enable row level security;
revoke all on public.hl_beheerders from anon, authenticated;

create or replace function public.is_hl_beheerder()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.hl_beheerders
                 where email = lower(coalesce(auth.jwt() ->> 'email', ''))
                   and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false))
$$;
revoke all on function public.is_hl_beheerder() from public, anon;
grant execute on function public.is_hl_beheerder() to authenticated;

create table if not exists public.hl_logboek (
  id bigint generated always as identity primary key,
  wanneer timestamptz not null default now(),
  wie text not null,
  wat text not null,
  commit_sha text
);
alter table public.hl_logboek enable row level security;
revoke all on public.hl_logboek from anon, authenticated;
grant select on public.hl_logboek to authenticated;
create policy "beheerders lezen logboek" on public.hl_logboek for select to authenticated using (public.is_hl_beheerder());

insert into public.hl_beheerders (email) values ('j.bonte@cvo.nl') on conflict do nothing;
