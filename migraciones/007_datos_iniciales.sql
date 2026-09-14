-- ============================================================================
-- Viewifi · 007 · Datos iniciales
-- ----------------------------------------------------------------------------
-- Precios de partida. Cámbialos desde el panel de administración, no aquí:
-- este archivo solo siembra la primera vez (on conflict do nothing).
-- ============================================================================

insert into public.planes
    (codigo, nombre_es, nombre_en, descripcion_es, descripcion_en,
     intervalo, precio_cop_centavos, precio_usd_centavos, orden)
values
    ('free', 'Free', 'Free',
     'Un host, detección en tiempo real y alertas por Telegram.',
     'One host, real-time detection and Telegram alerts.',
     'ninguno', 0, 0, 0),

    -- 1190000 centavos = $11.900 COP. Ajusta al cambio del día que publiques.
    ('pro_mensual', 'Pro mensual', 'Pro monthly',
     'Hosts ilimitados, evidencia completa e historial en la nube.',
     'Unlimited hosts, full evidence and cloud history.',
     'mes', 1190000, 299, 1),

    -- 7990000 centavos = $79.900 COP.
    ('pro_anual', 'Pro anual', 'Pro yearly',
     'Todo lo de Pro con dos meses de regalo frente al pago mensual.',
     'Everything in Pro with two months free versus paying monthly.',
     'anio', 7990000, 1999, 2)
on conflict (codigo) do nothing;

-- ----------------------------------------------------------------------------
-- Interruptores. `publico` decide si la web anónima puede leerlos.
-- ----------------------------------------------------------------------------
insert into public.ajustes (clave, valor, descripcion, publico) values
    ('registro_abierto', 'true'::jsonb,
     'Permite crear cuentas nuevas. En false, el disparador de auth.users rechaza el alta.', true),

    ('acceso_abierto', 'true'::jsonb,
     'Permite entrar a los usuarios ya existentes. Los administradores nunca quedan fuera.', true),

    ('mensaje_cerrado_es', '"Estamos haciendo mantenimiento. Vuelve en un rato."'::jsonb,
     'Texto que ve quien intenta registrarse o entrar con el acceso cerrado.', true),

    ('mensaje_cerrado_en', '"We are doing maintenance. Please come back shortly."'::jsonb,
     'English version of the closed-access message.', true),

    ('wompi_ambiente', '"sandbox"'::jsonb,
     'sandbox o produccion. Debe coincidir con el prefijo de las llaves configuradas.', false),

    ('reintentos_max', '3'::jsonb,
     'Cuántas veces se reintenta un cobro rechazado antes de bajar la cuenta a Free.', false),

    ('reintento_dias', '[1, 3, 5]'::jsonb,
     'Días tras el fallo en que se reintenta cada cobro.', false),

    ('conciliar_tras_minutos', '30'::jsonb,
     'Un pago que sigue PENDIENTE pasado este tiempo se consulta directamente a Wompi.', false),

    ('moneda_cobro', '"COP"'::jsonb,
     'Wompi Colombia solo cobra en pesos. No lo cambies sin cambiar la pasarela.', true)
on conflict (clave) do nothing;

-- ----------------------------------------------------------------------------
-- Nombra tu primer administrador.
--
-- Regístrate primero por la web con tu correo y después ejecuta ESTA línea
-- descomentada, con tu correo. Sin un administrador, el panel no deja entrar
-- a nadie y las políticas RLS bloquean todo.
-- ----------------------------------------------------------------------------
-- update public.perfiles set rol = 'admin' where lower(email) = lower('tu@correo.com');
