-- ============================================================================
-- Viewifi · 003 · Pagos y eventos de Wompi
-- ============================================================================

-- ----------------------------------------------------------------------------
-- pagos — un intento de cobro. Existe ANTES de llamar a Wompi, no después:
-- así, si la red se cae a mitad de la petición, al reintentar encontramos la
-- fila y su referencia en vez de crear un cobro duplicado.
--
-- `referencia` es lo que viaja a Wompi y es única a nivel de comercio. La
-- construimos de forma determinista (ver 005) para que un reintento del mismo
-- periodo genere exactamente la misma referencia y Wompi la rechace como
-- duplicada en lugar de cobrar dos veces.
-- ----------------------------------------------------------------------------
create table if not exists public.pagos (
    id                   uuid primary key default gen_random_uuid(),
    suscripcion_id       uuid        references public.suscripciones (id) on delete set null,
    usuario_id           uuid        not null references public.perfiles (id) on delete cascade,
    plan_id              uuid        references public.planes (id) on delete set null,

    referencia           text        not null unique,
    wompi_transaction_id text        unique,

    estado               text        not null default 'PENDIENTE'
                         check (estado in ('PENDIENTE', 'APROBADO', 'RECHAZADO', 'ERROR', 'ANULADO')),

    monto_centavos       bigint      not null check (monto_centavos > 0),
    moneda               text        not null default 'COP' check (moneda = 'COP'),

    metodo_pago          text,
    cuotas               smallint,
    -- 1 = cobro normal. 2, 3, 4 = reintentos tras un rechazo.
    intento              smallint    not null default 1 check (intento between 1 and 10),
    -- Periodo que este cobro paga. Sirve para no cobrar dos veces el mismo mes.
    periodo_inicio       timestamptz,
    periodo_fin          timestamptz,

    codigo_error         text,
    mensaje_error        text,
    respuesta            jsonb,

    creado_en            timestamptz not null default now(),
    actualizado_en       timestamptz not null default now(),
    finalizado_en        timestamptz
);

comment on column public.pagos.referencia is
    'Referencia única enviada a Wompi. Determinista por suscripción+periodo+intento.';
comment on column public.pagos.respuesta is
    'Último cuerpo devuelto por Wompi. Para depurar sin tener que entrar al panel de Wompi.';

create index if not exists pagos_usuario_idx      on public.pagos (usuario_id, creado_en desc);
create index if not exists pagos_suscripcion_idx  on public.pagos (suscripcion_id, creado_en desc);
create index if not exists pagos_estado_idx       on public.pagos (estado);
-- Los que hay que reconciliar: llevan demasiado tiempo sin resolverse porque
-- el webhook no llegó (Wompi reintenta, pero puede fallar del todo).
create index if not exists pagos_pendientes_idx
    on public.pagos (creado_en)
    where estado = 'PENDIENTE';

-- Un mismo periodo no puede tener dos cobros aprobados. Esta es la última
-- línea de defensa contra el doble cobro, por debajo de la referencia única.
create unique index if not exists pagos_un_aprobado_por_periodo
    on public.pagos (suscripcion_id, periodo_inicio)
    where estado = 'APROBADO' and suscripcion_id is not null and periodo_inicio is not null;

-- ----------------------------------------------------------------------------
-- eventos_wompi — bitácora cruda de los webhooks. Dos motivos:
--   1. Idempotencia: Wompi reenvía el mismo evento si no respondemos 200 a
--      tiempo. Sin esta tabla, un reenvío volvería a aplicar el mismo cambio.
--   2. Auditoría: si un cobro se comporta raro, aquí está lo que llegó,
--      literal, incluido lo que rechazamos por firma inválida.
-- ----------------------------------------------------------------------------
create table if not exists public.eventos_wompi (
    id             bigint generated always as identity primary key,
    evento         text        not null,
    transaccion_id text,
    checksum       text        not null,
    firma_valida   boolean     not null,
    procesado      boolean     not null default false,
    error          text,
    payload        jsonb       not null,
    enviado_en     timestamptz,
    recibido_en    timestamptz not null default now(),
    procesado_en   timestamptz
);

-- El checksum es un SHA256 de los datos + timestamp + secreto: un reenvío del
-- mismo evento trae exactamente el mismo checksum. Es la clave de idempotencia.
create unique index if not exists eventos_wompi_checksum_idx on public.eventos_wompi (checksum);
create index if not exists eventos_wompi_transaccion_idx    on public.eventos_wompi (transaccion_id);
create index if not exists eventos_wompi_recibido_idx       on public.eventos_wompi (recibido_en desc);
create index if not exists eventos_wompi_sin_procesar_idx
    on public.eventos_wompi (recibido_en)
    where not procesado;
