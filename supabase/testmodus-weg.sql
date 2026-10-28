-- =====================================================================
-- Testmodus definitief verwijderd (okt 2026). Vervangt supabase/testmodus.sql.
-- my_email() leest weer alleen het e-mailadres uit het inlogtoken.
-- =====================================================================
create or replace function my_email() returns text
language sql stable as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

drop function if exists test_inloggen(text);
drop function if exists test_accounts();
drop function if exists mijn_email();
drop table if exists test_sessies;

-- Triggerfunctie hoort niet via de API aan te roepen te zijn
revoke all on function check_lokaal_capaciteit() from public, anon, authenticated;
