-- ============================================================================
-- Viewifi · 002 · Planes y suscripciones
-- ============================================================================

-- ----------------------------------------------------------------------------
-- planes — lo que el panel de administración deja editar: nombre, precio en
-- pesos (lo que se cobra) y precio en dólares (lo que se muestra fuera de
-- Colombia). Wompi solo puede cobrar COP, así que precio_cop_centavos es el
-- único importe que llega a la pasarela.
-- ----------------------------------------------------------------------------
create table if not exists public.planes (
    id                  uuid primary key default gen_random_uuid(),
    codigo              text        not null unique,
    nombre_es           text        not null,
    nombre_en           text        not null,
    descripcion_es      text,
    descripcion_en      text,
    -- 'ninguno' = plan gratuito, no se cobra nunca.
    intervalo           text        not null check (intervalo in ('ninguno', 'mes', 'anio')),
    precio_cop_centavos bigint      not null default 0 check (precio_cop_centavos >= 0),
    precio_usd_centavos bigint      not null default 0 check (precio_usd_centavos >= 0),
    activo              boolean     not null default true,
    visible_en_web      boolean     not null default true,
    orden               smallint    not null default 0,
    creado_en           timestamptz not null default now(),
    actualizado_en      timestamptz not null default now(),

    -- Un plan de pago sin precio es casi siempre un error de dedo en el panel,
    -- y significaría cobrar 0 pesos a todo el mundo.
    constraint planes_precio_coherente check (
        intervalo = 'ninguno' or precio_cop_centavos > 0
    )
);

comment on column public.planes.precio_cop_centavos is
    'Importe REAL que se cobra por Wompi, en centavos de peso. 1190000 = $11.900.';
comment on column public.planes.precio_usd_centavos is
    'Solo para mostrar en la web en inglés. No se cobra nunca en esta moneda.';

create index if not exists planes_activos_idx on public.planes (orden) where activo;

-- ----------------------------------------------------------------------------
-- suscripciones — una fila por usuario y plan de pago. El gratuito no crea
-- suscripción: no tenerla ES ser Free.
--
-- La fuente de pago de Wompi (payment_source_id) es lo que permite cobrar mes
-- a mes sin pedirle la tarjeta otra vez al usuario. Wompi no tiene un producto
-- de suscripciones: el calendario de cobros lo llevamos nosotros aquí.
-- ----------------------------------------------------------------------------
create table if not exists public.suscripciones (
    id                     uuid primary key default gen_random_uuid(),
    usuario_id             uuid        not null references public.perfiles (id) on delete cascade,
    plan_id                uuid        not null references public.planes (id) on delete restrict,

    estado                 text        not null default 'pendiente'
                           check (estado in ('pendiente', 'activa', 'morosa', 'cancelada', 'expirada')),

    -- Fuente de pago tokenizada en Wompi. Null mientras el primer cobro no
    -- se haya completado, o si el usuario retiró la tarjeta.
    wompi_payment_source_id bigint,
    wompi_customer_email    text,
    tarjeta_marca           text,
    tarjeta_ultimos4        text check (tarjeta_ultimos4 is null or tarjeta_ultimos4 ~ '^[0-9]{4}$'),
    tarjeta_vence           text,
    cuotas                  smallint not null default 1 check (cuotas between 1 and 36),

    inicio_en              timestamptz not null default now(),
    periodo_inicio         timestamptz,
    periodo_fin            timestamptz,
    proximo_cobro_en       timestamptz,

    -- Reintentos: se ponen a 0 en cuanto un cobro entra APROBADO.
    intentos_fallidos      smallint    not null default 0 check (intentos_fallidos >= 0),
    ultimo_error           text,
    ultimo_intento_en      timestamptz,

    cancelar_al_final      boolean     not null default false,
    cancelada_en           timestamptz,
    motivo_cancelacion     text,

    creado_en              timestamptz not null default now(),
    actualizado_en         timestamptz not null default now(),

    constraint suscripciones_periodo_coherente check (
        periodo_fin is null or periodo_inicio is null or periodo_fin > periodo_inicio
    )
);

-- Un usuario no puede tener dos suscripciones vivas a la vez: sería cobrarle
-- dos veces. Las canceladas y expiradas sí pueden acumularse como histórico.
create unique index if not exists suscripciones_una_viva_por_usuario
    on public.suscripciones (usuario_id)
    where estado in ('pendiente', 'activa', 'morosa');

create index if not exists suscripciones_usuario_idx  on public.suscripciones (usuario_id, creado_en desc);
create index if not exists suscripciones_estado_idx   on public.suscripciones (estado);
-- Índice que usa el cron: "dame lo que toca cobrar hoy".
create index if not exists suscripciones_a_cobrar_idx
    on public.suscripciones (proximo_cobro_en)
    where estado in ('activa', 'morosa');
