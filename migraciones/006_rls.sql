-- ============================================================================
-- Viewifi · 006 · Row Level Security
-- ----------------------------------------------------------------------------
-- Regla de oro: la clave anon que va en el JavaScript de la web es PÚBLICA.
-- Cualquiera puede leerla del código fuente y llamar a la API con ella. Todo
-- lo que impide que un curioso lea los pagos de otro está en este archivo, no
-- en el navegador.
--
-- Las Edge Functions usan la service_role, que se salta RLS por diseño: por eso
-- ninguna política concede escritura sobre pagos ni suscripciones.
-- ============================================================================

-- Permisos de tabla. Supabase ya los concede por defecto en el esquema public,
-- pero dejarlo explícito evita sorpresas si alguien los revoca y hace que estas
-- migraciones se puedan aplicar en cualquier Postgres. RLS sigue mandando: sin
-- una política que lo permita, estos GRANT no dejan ver ni una fila.
grant select on public.planes, public.anuncios to anon, authenticated;
grant select on public.perfiles, public.suscripciones, public.pagos,
                public.eventos_wompi, public.admin_auditoria, public.ajustes
      to authenticated;
grant insert, update, delete on public.planes, public.anuncios, public.ajustes,
                                public.perfiles, public.suscripciones, public.pagos
      to authenticated;

alter table public.perfiles        enable row level security;
alter table public.ajustes         enable row level security;
alter table public.admin_auditoria enable row level security;
alter table public.planes          enable row level security;
alter table public.suscripciones   enable row level security;
alter table public.pagos           enable row level security;
alter table public.eventos_wompi   enable row level security;
alter table public.anuncios        enable row level security;

-- ----------------------------------------------------------------------------
-- perfiles
-- ----------------------------------------------------------------------------
drop policy if exists perfiles_lee_propio      on public.perfiles;
drop policy if exists perfiles_edita_propio    on public.perfiles;
drop policy if exists perfiles_admin_lee       on public.perfiles;
drop policy if exists perfiles_admin_escribe   on public.perfiles;
drop policy if exists perfiles_admin_borra     on public.perfiles;

create policy perfiles_lee_propio on public.perfiles
    for select to authenticated
    using (id = auth.uid());

-- El usuario puede cambiar su nombre y su idioma. No su rol ni su bloqueo:
-- eso lo impide la comprobación de abajo, que compara con la fila anterior.
create policy perfiles_edita_propio on public.perfiles
    for update to authenticated
    using (id = auth.uid() and not bloqueado)
    with check (
        id = auth.uid()
        and rol = (select p.rol from public.perfiles p where p.id = auth.uid())
        and bloqueado = false
    );

create policy perfiles_admin_lee on public.perfiles
    for select to authenticated using (public.es_admin());

create policy perfiles_admin_escribe on public.perfiles
    for update to authenticated using (public.es_admin()) with check (public.es_admin());

create policy perfiles_admin_borra on public.perfiles
    for delete to authenticated using (public.es_admin());

-- ----------------------------------------------------------------------------
-- planes — el catálogo es público: la web tiene que poder pintar los precios
-- sin que nadie haya iniciado sesión. Escribir, solo administradores.
-- ----------------------------------------------------------------------------
drop policy if exists planes_lee_publico  on public.planes;
drop policy if exists planes_admin_todo   on public.planes;

create policy planes_lee_publico on public.planes
    for select to anon, authenticated
    using (activo and visible_en_web);

create policy planes_admin_todo on public.planes
    for all to authenticated
    using (public.es_admin()) with check (public.es_admin());

-- ----------------------------------------------------------------------------
-- suscripciones y pagos — el usuario ve lo suyo y nada más. Nadie escribe
-- desde el cliente: los cobros solo los tocan las Edge Functions.
-- ----------------------------------------------------------------------------
drop policy if exists suscripciones_lee_propia on public.suscripciones;
drop policy if exists suscripciones_admin_todo on public.suscripciones;
drop policy if exists pagos_lee_propio         on public.pagos;
drop policy if exists pagos_admin_todo         on public.pagos;

create policy suscripciones_lee_propia on public.suscripciones
    for select to authenticated
    using (usuario_id = auth.uid() and public.usuario_activo());

create policy suscripciones_admin_todo on public.suscripciones
    for all to authenticated
    using (public.es_admin()) with check (public.es_admin());

create policy pagos_lee_propio on public.pagos
    for select to authenticated
    using (usuario_id = auth.uid() and public.usuario_activo());

create policy pagos_admin_todo on public.pagos
    for all to authenticated
    using (public.es_admin()) with check (public.es_admin());

-- ----------------------------------------------------------------------------
-- eventos_wompi y auditoría — solo lectura, solo administradores.
-- ----------------------------------------------------------------------------
drop policy if exists eventos_admin_lee   on public.eventos_wompi;
drop policy if exists auditoria_admin_lee on public.admin_auditoria;

create policy eventos_admin_lee on public.eventos_wompi
    for select to authenticated using (public.es_admin());

create policy auditoria_admin_lee on public.admin_auditoria
    for select to authenticated using (public.es_admin());

-- ----------------------------------------------------------------------------
-- ajustes — la tabla entera es de administradores. Lo que la web anónima
-- necesita (¿está abierto el registro?) sale por la vista de abajo, que solo
-- expone las claves marcadas como públicas.
-- ----------------------------------------------------------------------------
drop policy if exists ajustes_admin_todo on public.ajustes;

create policy ajustes_admin_todo on public.ajustes
    for all to authenticated
    using (public.es_admin()) with check (public.es_admin());

-- security_invoker = false: la vista corre con los permisos de su propietario
-- y por eso puede leer la tabla protegida, pero solo devuelve publico = true.
create or replace view public.ajustes_publicos
with (security_invoker = false) as
select clave, valor
from public.ajustes
where publico;

comment on view public.ajustes_publicos is
    'Subconjunto de ajustes que la web anónima puede leer. No añadas claves con secretos.';

grant select on public.ajustes_publicos to anon, authenticated;

-- ----------------------------------------------------------------------------
-- anuncios — la web lee la vista; la tabla es de administradores.
-- ----------------------------------------------------------------------------
drop policy if exists anuncios_admin_todo on public.anuncios;

create policy anuncios_admin_todo on public.anuncios
    for all to authenticated
    using (public.es_admin()) with check (public.es_admin());

-- La vista de 004 es security_invoker = true, así que hereda la política de
-- arriba y un anónimo no vería nada. La recreamos como definer para que el
-- visitante sin sesión pueda leer solo lo que está activo y en fecha.
create or replace view public.anuncios_visibles
with (security_invoker = false) as
select id, tipo, titulo_es, titulo_en, mensaje_es, mensaje_en,
       enlace_url, enlace_texto_es, enlace_texto_en,
       descartable, prioridad, rutas, actualizado_en
from public.anuncios
where activo
  and (inicia_en  is null or inicia_en  <= now())
  and (termina_en is null or termina_en >  now())
order by prioridad desc, creado_en desc;

grant select on public.anuncios_visibles to anon, authenticated;

-- ----------------------------------------------------------------------------
-- La waitlist que ya existía sigue igual: solo INSERT anónimo, sin lectura.
-- Aquí solo le añadimos lectura para administradores, que antes obligaba a
-- entrar al panel de Supabase.
-- ----------------------------------------------------------------------------
do $$
begin
    if to_regclass('public.waitlist') is not null then
        execute 'drop policy if exists waitlist_admin_lee on public.waitlist';
        execute 'create policy waitlist_admin_lee on public.waitlist
                 for select to authenticated using (public.es_admin())';
    end if;
end;
$$;
