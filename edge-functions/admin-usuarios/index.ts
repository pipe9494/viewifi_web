// ============================================================================
// admin-usuarios — crear y eliminar cuentas desde el panel
// ----------------------------------------------------------------------------
// Existe porque crear o borrar un usuario de verdad toca auth.users, y eso
// solo puede hacerlo la service_role. Esa llave no puede estar en el navegador:
// quien la tenga lee y escribe toda la base de datos saltándose RLS.
//
// El resto del panel (planes, ajustes, anuncios, ver usuarios) NO pasa por
// aquí: va directo a PostgREST con la sesión del administrador y son las
// políticas de 006_rls.sql las que deciden qué puede tocar.
// ============================================================================
import { autorizadoComoAdmin } from "../_compartido/admins.ts";
import { error, json, leerJson, responderPreflight } from "../_compartido/http.ts";
import { clienteAdmin, usuarioDeLaPeticion } from "../_compartido/supabase.ts";

interface Peticion {
  accion: "crear" | "eliminar" | "restablecer_clave";
  email?: string;
  password?: string;
  nombre?: string;
  locale?: "es" | "en";
  rol?: "usuario" | "admin";
  usuario_id?: string;
}

Deno.serve(async (req) => {
  const origen = req.headers.get("Origin");
  if (req.method === "OPTIONS") return responderPreflight(origen);
  if (req.method !== "POST") return error("METODO", "Usa POST.", 405, origen);

  const db = clienteAdmin();

  const solicitante = await usuarioDeLaPeticion(req);
  if (!solicitante) return error("SIN_SESION", "Inicia sesión.", 401, origen);

  const { data: quien } = await db.from("perfiles")
    .select("rol, bloqueado, email").eq("id", solicitante.id).maybeSingle();

  // Dos cerraduras: el rol en la base de datos y el correo en ADMINS_PERMITIDOS.
  // Si alguien consigue cambiar un rol saltándose el panel, esta función sigue
  // negándose porque su correo no está en el secreto.
  const permiso = autorizadoComoAdmin(quien?.rol, quien?.bloqueado, quien?.email ?? solicitante.email);
  if (!permiso.ok) {
    return error("SIN_PERMISO", "Solo un administrador puede hacer esto.", 403, origen, permiso.motivo);
  }

  let p: Peticion;
  try {
    p = await leerJson<Peticion>(req);
  } catch (e) {
    return error("CUERPO", (e as Error).message, 400, origen);
  }

  // --------------------------------------------------------------------------
  if (p.accion === "crear") {
    if (!p.email || !p.password) return error("DATOS", "Hacen falta correo y contraseña.", 400, origen);
    if (p.password.length < 8) return error("CLAVE_CORTA", "La contraseña debe tener 8 caracteres o más.", 400, origen);

    // email_confirm: true porque lo está dando de alta un administrador a mano;
    // obligarle luego a confirmar un correo que quizá no controla no aporta nada.
    const { data, error: err } = await db.auth.admin.createUser({
      email: p.email.trim().toLowerCase(),
      password: p.password,
      email_confirm: true,
      user_metadata: { nombre: p.nombre ?? null, locale: p.locale ?? "es" },
    });

    if (err) {
      const yaExiste = /already|exists|registered/i.test(err.message);
      return error(
        yaExiste ? "YA_EXISTE" : "ALTA",
        yaExiste ? "Ya hay una cuenta con ese correo." : "No se pudo crear la cuenta.",
        yaExiste ? 409 : 400, origen, err.message,
      );
    }

    // El disparador de 005 ya creó el perfil. Aquí solo se completa lo que el
    // administrador haya puesto y que el disparador no puede saber.
    await db.from("perfiles").update({
      nombre: p.nombre ?? null,
      locale: p.locale ?? "es",
      rol: p.rol === "admin" ? "admin" : "usuario",
    }).eq("id", data.user!.id);

    await db.from("admin_auditoria").insert({
      admin_id: solicitante.id, accion: "CREAR_USUARIO", tabla: "auth.users",
      registro_id: data.user!.id, despues: { email: p.email, rol: p.rol ?? "usuario" },
    });

    return json({ ok: true, usuario_id: data.user!.id }, 201, origen);
  }

  // --------------------------------------------------------------------------
  if (p.accion === "eliminar") {
    if (!p.usuario_id) return error("DATOS", "Falta el usuario.", 400, origen);
    if (p.usuario_id === solicitante.id) {
      return error("AUTOBORRADO", "No puedes eliminar tu propia cuenta desde aquí.", 400, origen);
    }

    // Quedarse sin ningún administrador deja el panel inaccesible y solo se
    // arregla entrando al SQL Editor de Supabase. Mejor impedirlo.
    const { data: objetivo } = await db.from("perfiles")
      .select("rol, email").eq("id", p.usuario_id).maybeSingle();
    if (!objetivo) return error("NO_EXISTE", "Ese usuario no existe.", 404, origen);

    if (objetivo.rol === "admin") {
      const { count } = await db.from("perfiles")
        .select("id", { count: "exact", head: true }).eq("rol", "admin").eq("bloqueado", false);
      if ((count ?? 0) <= 1) {
        return error("ULTIMO_ADMIN", "Es el último administrador. Nombra otro antes de eliminarlo.", 409, origen);
      }
    }

    // Un usuario con cobros aprobados no se borra: sus pagos son contabilidad.
    // Se bloquea, que conserva el historial y le cierra el acceso igual.
    const { count: pagosAprobados } = await db.from("pagos")
      .select("id", { count: "exact", head: true })
      .eq("usuario_id", p.usuario_id).eq("estado", "APROBADO");

    if ((pagosAprobados ?? 0) > 0) {
      return error(
        "TIENE_PAGOS",
        `Ese usuario tiene ${pagosAprobados} cobro(s) aprobado(s). ` +
          `Bloquéalo en vez de eliminarlo: borrarlo se llevaría por delante su historial de pagos.`,
        409, origen,
      );
    }

    const { error: err } = await db.auth.admin.deleteUser(p.usuario_id);
    if (err) return error("BORRADO", "No se pudo eliminar la cuenta.", 400, origen, err.message);

    await db.from("admin_auditoria").insert({
      admin_id: solicitante.id, accion: "ELIMINAR_USUARIO", tabla: "auth.users",
      registro_id: p.usuario_id, antes: { email: objetivo.email, rol: objetivo.rol },
    });

    return json({ ok: true }, 200, origen);
  }

  // --------------------------------------------------------------------------
  if (p.accion === "restablecer_clave") {
    if (!p.usuario_id || !p.password) return error("DATOS", "Faltan el usuario o la contraseña.", 400, origen);
    if (p.password.length < 8) return error("CLAVE_CORTA", "La contraseña debe tener 8 caracteres o más.", 400, origen);

    const { error: err } = await db.auth.admin.updateUserById(p.usuario_id, { password: p.password });
    if (err) return error("CLAVE", "No se pudo cambiar la contraseña.", 400, origen, err.message);

    await db.from("admin_auditoria").insert({
      admin_id: solicitante.id, accion: "RESTABLECER_CLAVE", tabla: "auth.users",
      registro_id: p.usuario_id,
    });

    return json({ ok: true }, 200, origen);
  }

  return error("ACCION", "Acción no reconocida.", 400, origen);
});
