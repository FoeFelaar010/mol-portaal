-- Testdata. Uitvoeren in de SQL Editor NA schema.sql.
-- Maak de drie testgebruikers eerst aan bij Authentication → Users → Add user
-- (zet "Auto Confirm User" aan) met dezelfde e-mailadressen als hieronder.

insert into docenten (email, naam, is_admin) values
  ('jouw.email@melanchthon.nl', 'Jouw Naam', true),
  ('beheertest@test.nl',        'Beheer Test', true),
  ('docenttest@test.nl',        'Dirk Docenttest', false),
  ('mentor2test@test.nl',       'Anna Duomentor', false)
on conflict (email) do nothing;

insert into leerlingen (email, naam, klas, leerlingnummer) values
  ('leerlingtest@test.nl', 'Lisa Leerlingtest', 'TEST', '000001'),
  ('tom@test.nl',          'Tom Testleerling',  'TEST', '000002')
on conflict (email) do nothing;

insert into klas_mentoren (klas, docent_id)
select 'TEST', id from docenten where email in ('docenttest@test.nl', 'mentor2test@test.nl')
on conflict do nothing;
