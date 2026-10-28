-- =====================================================================
-- Wachtwoord instellen voor een beheerder, vanuit Beheer → Meer (zonder mail).
-- Uitvoeren in: Supabase dashboard → SQL Editor → plakken → Run
--
-- Veiligheid:
--  * alleen een echte ingelogde beheerder (geen anonieme testsessie)
--  * alleen voor adressen die in het portaal beheerder zijn
--  * minstens 10 tekens
-- Bestaat het account nog niet, dan wordt het aangemaakt (e-mail meteen bevestigd).
-- =====================================================================
create or replace function beheer_zet_wachtwoord(p_email text, p_ww text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_email text := lower(trim(p_email));
  v_id uuid;
begin
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, true) then
    raise exception 'Log in met je eigen beheerdersaccount (niet in de testmodus).';
  end if;
  if not is_admin() then raise exception 'Alleen beheerders kunnen wachtwoorden instellen.'; end if;
  if not exists (select 1 from docenten where email = v_email and is_admin) then
    raise exception 'Dit adres is geen beheerder in het portaal.';
  end if;
  if length(coalesce(p_ww, '')) < 10 then raise exception 'Kies een wachtwoord van minstens 10 tekens.'; end if;

  select id into v_id from auth.users where email = v_email;
  if v_id is null then
    v_id := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
      crypt(p_ww, gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_id, v_id::text,
      jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true), 'email', now(), now(), now());
  else
    update auth.users
      set encrypted_password = crypt(p_ww, gen_salt('bf')),
          email_confirmed_at = coalesce(email_confirmed_at, now()),
          updated_at = now()
      where id = v_id;
  end if;
end $$;

revoke all on function beheer_zet_wachtwoord(text, text) from public, anon;
grant execute on function beheer_zet_wachtwoord(text, text) to authenticated;

-- Per beheerder: is er al een wachtwoord ingesteld? (alleen ja/nee, alleen voor beheerders)
create or replace function beheer_wachtwoord_status()
returns table (email text, heeft_wachtwoord boolean, laatst_ingelogd timestamptz)
language sql stable security definer set search_path = public as $$
  select d.email,
         coalesce(u.encrypted_password is not null and u.encrypted_password <> '', false),
         u.last_sign_in_at
    from docenten d
    left join auth.users u on lower(u.email) = d.email
   where d.is_admin and is_admin()
$$;
revoke all on function beheer_wachtwoord_status() from public, anon;
grant execute on function beheer_wachtwoord_status() to authenticated;
