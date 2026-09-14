-- ============================================================================
-- Viewifi · 005 · Funciones, disparadores y reglas de negocio
-- ============================================================================

-- ----------------------------------------------------------------------------
-- es_admin() — la usa casi toda política RLS.
--
-- SECURITY DEFINER a propósito: si consultara perfiles con los permisos del
-- usuario, la política de perfiles llamaría a es_admin(), que volvería a leer
-- perfiles, que volvería a evaluar la política… recursión infinita. Al correr
-- como propietario, la consulta se salta RLS y corta el bucle.
-- ----------------------------------------------------------------------------
create or replace function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select exists (
        select 1 from public.perfiles
        where id = auth.uid() and rol = 'admin' and not bloqueado
    );
$$;

-- ----------------------------------------------------------------------------
-- usuario_activo() — hay sesión, el perfil no está bloqueado y el acceso
-- global no está cerrado. Los administradores nunca se autobloquean por el
-- interruptor global: si no, cerrar el acceso te dejaría fuera de tu propio panel.
-- ----------------------------------------------------------------------------
create or replace function public.usuario_activo()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select exists (
        select 1 from public.perfiles p
        where p.id = auth.uid()
          and not p.bloqueado
          and (
                p.rol = 'admin'
                or coalesce(
                     (select (valor #>> '{}')::boolean from public.ajustes where clave = 'acceso_abierto'),
                     true
                   )
              )
    );
$$;

-- ----------------------------------------------------------------------------
-- ajuste_bool() — lee un interruptor con valor por defecto si no existe.
-- ----------------------------------------------------------------------------
create or replace function public.ajuste_bool(p_clave text, p_defecto boolean)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select coalesce(
        (select (valor #>> '{}')::boolean from public.ajustes where clave = p_clave),
        p_defecto
    );
$$;

-- ----------------------------------------------------------------------------
-- actualizado_en automático
-- ----------------------------------------------------------------------------
create or replace function public.tocar_actualizado_en()
returns trigger
language plpgsql
as $$
begin
    new.actualizado_en := now();
    return new;
end;
$$;

do $$
declare t text;
begin
    foreach t in array array['perfiles','planes','suscripciones','pagos','anuncios','ajustes']
    loop
        execute format('drop trigger if exists trg_%1$s_actualizado on public.%1$s', t);
        execute format(
            'create trigger trg_%1$s_actualizado before update on public.%1$s
             for each row execute function public.tocar_actualizado_en()', t);
    end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- Alta de usuario: crea el perfil y aplica el bloqueo de registro.
--
-- El interruptor se comprueba AQUÍ, en la base de datos, no en el navegador:
-- cerrar el registro desde el panel tiene que valer también contra alguien que
-- llame a la API de Supabase directamente con curl.
-- ----------------------------------------------------------------------------
create or replace function public.manejar_usuario_nuevo()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if not public.ajuste_bool('registro_abierto', true) then
        raise exception 'REGISTRO_CERRADO'
            using hint = 'El registro de nuevos usuarios está temporalmente cerrado.',
                  errcode = 'check_violation';
    end if;

    insert into public.perfiles (id, email, nombre, locale)
    values (
        new.id,
        new.email,
        nullif(trim(coalesce(new.raw_user_meta_data ->> 'nombre',
                             new.raw_user_meta_data ->> 'full_name', '')), ''),
        coalesce(nullif(new.raw_user_meta_data ->> 'locale', ''), 'es')
    )
    on conflict (id) do nothing;

    return new;
end;
$$;

drop trigger if exists trg_auth_usuario_nuevo on auth.users;
create trigger trg_auth_usuario_nuevo
    after insert on auth.users
    for each row execute function public.manejar_usuario_nuevo();

-- ----------------------------------------------------------------------------
-- referencia_pago() — determinista a propósito.
--
-- La misma suscripción, el mismo periodo y el mismo número de intento producen
-- SIEMPRE la misma referencia. Si la red se corta después de que Wompi haya
-- aceptado el cobro pero antes de que nos conteste, el reintento manda la misma
-- referencia y Wompi la rechaza por duplicada en vez de cobrar dos veces.
-- ----------------------------------------------------------------------------
create or replace function public.referencia_pago(
    p_suscripcion uuid, p_periodo timestamptz, p_intento smallint)
returns text
language sql
immutable
as $$
    select 'vwf-' || replace(p_suscripcion::text, '-', '')
        || '-' || to_char(p_periodo at time zone 'UTC', 'YYYYMMDD')
        || '-' || p_intento::text;
$$;

-- ----------------------------------------------------------------------------
-- siguiente_periodo() — suma un mes o un año. Postgres ya resuelve bien el
-- caso feo: 31 de enero + 1 mes = 28 de febrero, no un error.
-- ----------------------------------------------------------------------------
create or replace function public.siguiente_periodo(p_desde timestamptz, p_intervalo text)
returns timestamptz
language sql
immutable
as $$
    select case p_intervalo
        when 'mes'  then p_desde + interval '1 month'
        when 'anio' then p_desde + interval '1 year'
        else null
    end;
$$;

-- ----------------------------------------------------------------------------
-- plan_vigente() — qué plan tiene un usuario AHORA MISMO. Una suscripción
-- morosa sigue dando servicio mientras dura el periodo de reintentos; una
-- cancelada da servicio hasta que termina el periodo ya pagado.
-- ----------------------------------------------------------------------------
create or replace function public.plan_vigente(p_usuario uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select coalesce(
        (select pl.codigo
           from public.suscripciones s
           join public.planes pl on pl.id = s.plan_id
          where s.usuario_id = p_usuario
            and s.estado in ('activa', 'morosa')
            and (s.periodo_fin is null or s.periodo_fin > now())
          order by s.creado_en desc
          limit 1),
        'free');
$$;

-- ----------------------------------------------------------------------------
-- Auditoría automática de lo que cambia un administrador.
-- ----------------------------------------------------------------------------
create or replace function public.auditar_cambio()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_id text;
begin
    v_id := coalesce(
        to_jsonb(coalesce(new, old)) ->> 'id',
        to_jsonb(coalesce(new, old)) ->> 'clave');

    insert into public.admin_auditoria (admin_id, accion, tabla, registro_id, antes, despues)
    values (auth.uid(), tg_op, tg_table_name, v_id,
            case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
            case when tg_op in ('UPDATE','INSERT') then to_jsonb(new) end);

    return coalesce(new, old);
end;
$$;

do $$
declare t text;
begin
    foreach t in array array['planes','ajustes','anuncios','perfiles']
    loop
        execute format('drop trigger if exists trg_%1$s_auditoria on public.%1$s', t);
        execute format(
            'create trigger trg_%1$s_auditoria after insert or update or delete on public.%1$s
             for each row execute function public.auditar_cambio()', t);
    end loop;
end;
$$;
