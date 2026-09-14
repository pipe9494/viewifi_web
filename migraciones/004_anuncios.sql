-- ============================================================================
-- Viewifi · 004 · Anuncios de la web
-- ----------------------------------------------------------------------------
-- El banner discreto que el administrador puede publicar en la web: un aviso
-- de mantenimiento, una alerta de seguridad o una noticia de versión nueva.
-- Bilingüe, con ventana de fechas y descartable por el visitante.
-- ============================================================================

create table if not exists public.anuncios (
    id             uuid primary key default gen_random_uuid(),

    -- El tipo decide el color y el icono, no el tono del texto.
    tipo           text        not null default 'noticia'
                   check (tipo in ('noticia', 'aviso', 'alerta', 'mantenimiento')),

    titulo_es      text        not null check (char_length(titulo_es) between 1 and 120),
    titulo_en      text        not null check (char_length(titulo_en) between 1 and 120),
    mensaje_es     text        not null check (char_length(mensaje_es) between 1 and 400),
    mensaje_en     text        not null check (char_length(mensaje_en) between 1 and 400),

    -- Enlace opcional. Si va vacío el banner no muestra botón.
    enlace_url     text        check (enlace_url is null or enlace_url ~ '^(https?://|/)'),
    enlace_texto_es text       check (char_length(enlace_texto_es) <= 40),
    enlace_texto_en text       check (char_length(enlace_texto_en) <= 40),

    activo         boolean     not null default false,
    descartable    boolean     not null default true,
    -- Prioridad alta gana cuando hay varios activos a la vez. Solo se muestra uno:
    -- apilar banners es justo lo que hace que la gente deje de leerlos.
    prioridad      smallint    not null default 0,

    -- null en inicia_en = desde ya. null en termina_en = hasta que se apague.
    inicia_en      timestamptz,
    termina_en     timestamptz,

    -- Rutas donde aparece. '*' = todas. Ej: '{/kit/,/en/kit/}'
    rutas          text[]      not null default array['*'],

    creado_en      timestamptz not null default now(),
    actualizado_en timestamptz not null default now(),
    creado_por     uuid references public.perfiles (id) on delete set null,

    constraint anuncios_ventana_coherente check (
        inicia_en is null or termina_en is null or termina_en > inicia_en
    )
);

comment on table public.anuncios is
    'Banner informativo de la web pública. Solo se muestra el activo de mayor prioridad.';
comment on column public.anuncios.rutas is
    'Rutas donde aparece; ''*'' significa todas. Se compara con location.pathname.';

create index if not exists anuncios_visibles_idx
    on public.anuncios (prioridad desc, creado_en desc)
    where activo;

-- ----------------------------------------------------------------------------
-- Vista que consume la web anónima. Resuelve la ventana de fechas en el
-- servidor: así el visitante no puede ver un anuncio programado antes de
-- tiempo simplemente cambiando el reloj de su equipo.
-- ----------------------------------------------------------------------------
create or replace view public.anuncios_visibles
with (security_invoker = true) as
select id, tipo, titulo_es, titulo_en, mensaje_es, mensaje_en,
       enlace_url, enlace_texto_es, enlace_texto_en,
       descartable, prioridad, rutas, actualizado_en
from public.anuncios
where activo
  and (inicia_en  is null or inicia_en  <= now())
  and (termina_en is null or termina_en >  now())
order by prioridad desc, creado_en desc;

comment on view public.anuncios_visibles is
    'Lo que la web pública puede leer: solo anuncios activos y dentro de su ventana de fechas.';
