-- ============================================================================
-- Viewifi · 009 · Interruptor maestro de cobros
-- ----------------------------------------------------------------------------
-- Todo el sistema de pagos queda montado pero apagado. Mientras
-- `pagos_activos` valga false:
--
--   · crear-suscripcion rechaza cualquier alta de plan de pago, y lo hace
--     ANTES de mirar la configuración de Wompi, así que la web funciona sin
--     haber configurado ni una llave;
--   · cobros-recurrentes no cobra ni vence a nadie;
--   · el área de cliente no enseña el formulario de tarjeta, enseña que todo
--     es gratis.
--
-- Se enciende desde el panel de administración, en Ajustes → Cobros. El
-- interruptor se comprueba en el servidor, no en el navegador: apagado, una
-- llamada directa a la Edge Function con curl tampoco cobra.
--
-- Es idempotente: si ya lo lanzaste, relanzarlo no cambia el valor que tengas
-- puesto (el `do nothing` protege un interruptor ya encendido de volver a
-- apagarse solo).
-- ============================================================================

insert into public.ajustes (clave, valor, descripcion, publico) values
    ('pagos_activos', 'false'::jsonb,
     'Interruptor maestro de los cobros. En false no se puede contratar ningún plan de pago y el cron no cobra. Público: la web lo lee para decidir si enseña el formulario de tarjeta.',
     true)
on conflict (clave) do nothing;
