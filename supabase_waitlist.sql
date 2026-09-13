-- Viewifi — tabla de lista de espera para la web
-- Ejecutar en el SQL Editor del proyecto de Supabase.
-- La web (viewifi.tech) inserta aquí con la clave anon; nadie puede leer
-- estas filas desde el cliente, solo desde el panel de Supabase.

-- ---------------------------------------------------------------------------
-- 1. waitlist: correos de interesados en Pro, el kit Raspberry Pi o Negocios
-- ---------------------------------------------------------------------------
create table if not exists public.waitlist (
    id bigint generated always as identity primary key,
    email text not null,
    interest text not null default 'pro',
    locale text not null default 'es',
    company text,
    message text,
    source text,
    created_at timestamptz not null default now()
);

alter table public.waitlist enable row level security;

-- Un solo registro por correo y tipo de interés: un reenvío devuelve 409 y la
-- web lo traduce a "ya estabas en la lista".
create unique index if not exists waitlist_email_interest_idx
    on public.waitlist (lower(email), interest);

-- Solo INSERT, y solo si los datos tienen buena pinta. No hay política de
-- SELECT, UPDATE ni DELETE: la clave anon no puede leer ni modificar nada.
drop policy if exists "waitlist_insert_public" on public.waitlist;
create policy "waitlist_insert_public"
    on public.waitlist for insert
    to anon, authenticated
    with check (
        email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$'
        and char_length(email) <= 254
        and interest in ('pro', 'kit', 'b2b', 'play')
        and locale in ('es', 'en')
        and char_length(coalesce(company, '')) <= 200
        and char_length(coalesce(message, '')) <= 2000
        and char_length(coalesce(source, '')) <= 200
    );

-- ---------------------------------------------------------------------------
-- 2. Consultas útiles (ejecutar desde el panel, no desde el cliente)
-- ---------------------------------------------------------------------------
-- Cuántos hay por interés:
--   select interest, count(*) from public.waitlist group by interest order by 2 desc;
--
-- Últimos apuntados:
--   select created_at, email, interest, locale, company from public.waitlist
--   order by created_at desc limit 50;
--
-- Exportar los de Pro para el correo de lanzamiento:
--   select email from public.waitlist where interest = 'pro' order by created_at;
