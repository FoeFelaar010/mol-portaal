-- Elke nacht om 02:00 UTC (03:00/04:00 NL): rondes waarvan de laatste gespreksdag
-- meer dan 30 dagen geleden was verwijderen, met afspraken, opmerkingen en redenen.
-- Leerling- en docentlijsten blijven staan (die blijven het schooljaar lang).
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'mol-opschonen';
select cron.schedule('mol-opschonen', '0 2 * * *', $$select public.verwijder_oude_data()$$);
