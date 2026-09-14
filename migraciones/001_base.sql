-- ============================================================================
-- Viewifi · 001 · Base: perfiles y ajustes
-- ----------------------------------------------------------------------------
-- Ejecuta las migraciones EN ORDEN (001, 002, …) en el SQL Editor de Supabase.
-- Todas son idempotentes: volver a lanzarlas no rompe nada.
--
-- Convención de dinero: SIEMPRE en centavos, como bigint. Wompi trabaja en
-- centavos y usar float para dinero acaba en descuadres de un peso que nadie
-- sabe explicar.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- perfiles — extiende auth.users con lo que la aplicación necesita saber.
-- No duplicamos la contraseña ni nada de auth: solo referenciamos el id.
-- ----------------------------------------------------------------------------
create table if not exists public.perfiles (
    id            uuid primary key references auth.users (id) on delete cascade,
    email         text        not null,
    nombre        text,
    locale        text        not null default 'es' check (locale in ('es', 'en')),
    rol           text        not null default 'usuario' check (rol in ('usuario', 'admin')),
    -- bloqueado lo pone un administrador; el usuario sigue existiendo y
    -- conserva sus datos, pero no puede entrar ni consumir la API.
    bloqueado     boolean     not null default false,
    motivo_bloqueo text,
    notas_admin   text,
    pais          text,
    telefono      text,
    creado_en     timestamptz not null default now(),
    actualizado_en timestamptz not null default now(),
    ultimo_acceso_en timestamptz
);

comment on table public.perfiles is
    'Datos de aplicación de cada usuario. 1:1 con auth.users.';
comment on column public.perfiles.bloqueado is
    'true = el administrador le ha cerrado el acceso. Ver hook de login en 005.';

create index if not exists perfiles_rol_idx        on public.perfiles (rol) where rol = 'admin';
create index if not exists perfiles_creado_en_idx  on public.perfiles (creado_en desc);
create unique index if not exists perfiles_email_idx on public.perfiles (lower(email));

-- ----------------------------------------------------------------------------
-- ajustes — configuración global editable desde el panel.
-- Clave/valor con jsonb para no tener que migrar la tabla cada vez que se
-- añade un interruptor nuevo. `publico` marca las claves que la web anónima
-- puede leer (se exponen por la vista ajustes_publicos, no por la tabla).
-- ----------------------------------------------------------------------------
create table if not exists public.ajustes (
    clave          text primary key,
    valor          jsonb       not null,
    descripcion    text,
    publico        boolean     not null default false,
    actualizado_en timestamptz not null default now(),
    actualizado_por uuid references public.perfiles (id) on delete set null
);

comment on table public.ajustes is
    'Interruptores y parámetros globales. Solo los marcados publico=true son legibles sin sesión.';

-- ----------------------------------------------------------------------------
-- admin_auditoria — quién tocó qué. Sin esto, "el precio cambió solo".
-- ----------------------------------------------------------------------------
create table if not exists public.admin_auditoria (
    id          bigint generated always as identity primary key,
    admin_id    uuid references public.perfiles (id) on delete set null,
    accion      text        not null,
    tabla       text        not null,
    registro_id text,
    antes       jsonb,
    despues     jsonb,
    creado_en   timestamptz not null default now()
);

create index if not exists auditoria_creado_en_idx on public.admin_auditoria (creado_en desc);
create index if not exists auditoria_tabla_idx     on public.admin_auditoria (tabla, registro_id);
