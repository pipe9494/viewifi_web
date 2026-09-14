-- ============================================================================
-- Viewifi · 008 · Programación de los cobros
-- ----------------------------------------------------------------------------
-- Wompi no tiene suscripciones: cada cobro mensual lo lanzamos nosotros. Este
-- archivo programa la llamada diaria a la Edge Function que hace el trabajo.
--
-- ANTES de ejecutarlo:
--   1. Despliega la función cobros-recurrentes.
--   2. Database → Extensions → activa pg_cron y pg_net.
--   3. Sustituye TU_PROYECTO y TU_SERVICE_ROLE_KEY abajo.
--
-- La service_role key queda guardada en la definición del cron, dentro de tu
-- propia base de datos. Es la forma que documenta Supabase; aun así, trátala
-- como lo que es y no compartas volcados de esta tabla.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Quita la programación anterior si la hubiera, para poder relanzar el archivo.
select cron.unschedule('viewifi-cobros-diarios')
where exists (select 1 from cron.job where jobname = 'viewifi-cobros-diarios');

-- 09:00 UTC = 04:00 en Colombia. A esa hora casi nadie está comprando, y si un
-- cobro falla queda toda la jornada por delante para que el usuario reaccione
-- al correo antes del siguiente reintento.
select cron.schedule(
    'viewifi-cobros-diarios',
    '0 9 * * *',
    $$
    select net.http_post(
        url     := 'https://TU_PROYECTO.supabase.co/functions/v1/cobros-recurrentes',
        headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'Authorization', 'Bearer TU_SERVICE_ROLE_KEY'
        ),
        body    := jsonb_build_object('origen', 'cron'),
        timeout_milliseconds := 120000
    );
    $$
);

-- ----------------------------------------------------------------------------
-- Comprobaciones útiles
-- ----------------------------------------------------------------------------
-- ¿Está programado?
--   select jobid, jobname, schedule, active from cron.job;
--
-- ¿Cómo fueron las últimas ejecuciones?
--   select start_time, status, return_message
--     from cron.job_run_details
--    where jobname = 'viewifi-cobros-diarios'
--    order by start_time desc limit 10;
--
-- Lanzarlo a mano ahora mismo, sin esperar a mañana:
--   select net.http_post(
--       url     := 'https://TU_PROYECTO.supabase.co/functions/v1/cobros-recurrentes',
--       headers := jsonb_build_object('Content-Type','application/json',
--                                     'Authorization','Bearer TU_SERVICE_ROLE_KEY'),
--       body    := jsonb_build_object('origen','manual'));
