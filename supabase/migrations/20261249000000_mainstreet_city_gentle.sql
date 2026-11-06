-- MainstreetAI › city building, gently: the database is small and shared with the live app, so one worker at a time —
-- the loader on even minutes, the builder on odd minutes — never both at once. Additive only.
select cron.unschedule(jobname) from cron.job where jobname like 'ms-city-%';
select cron.schedule('ms-city-autoload', '*/2 * * * *', 'select public.ms_city_autoload_step()');
select cron.schedule('ms-city-jobs', '1-59/2 * * * *', 'select public.ms_city_jobs_drain()');
